//! Thumbnails per media asset, decoded on worker threads.
//!
//! Deliberately the same shape as [`crate::waveform::WaveformCache`], down to the three states
//! and the reason each exists. A media pool and an audio lane are the same problem twice: some
//! per-file picture that costs an ffmpeg process to produce, wanted by a render pass that must
//! never block, for files that may not exist.
//!
//! The two halves are separate calls on purpose. [`PosterCache::request`] queues work and polls;
//! [`PosterCache::poster`] reads. A render pass calls the first once per asset and the second
//! per tile, and neither ever blocks — which is the rule in `CLAUDE.md` that decode never runs
//! on the interactive render path.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::mpsc::{Receiver, TryRecvError, channel};

use crate::PosterFrame;

/// How a poster is produced. Injectable so a test can observe *when and where* decoding runs
/// without needing ffmpeg — the shape of the work is what matters, not the picture.
pub type PosterDecoder = Arc<dyn Fn(&str, f64) -> Option<PosterFrame> + Send + Sync>;

/// Where one thumbnail's decode has got to.
enum PosterState {
    /// Worker is decoding; poll each frame and draw the tile bare meanwhile.
    Pending(Receiver<Option<PosterFrame>>),
    Ready(Arc<PosterFrame>),
    /// Decode failed, there is no ffmpeg, or the asset has no path. **Remembered**, so a file
    /// that cannot produce a picture is not re-spawned every frame — that is sixty ffmpeg
    /// processes a second against a file that was already known to be missing.
    Failed,
}

/// One thumbnail per media id, decoded off the render path.
pub struct PosterCache {
    entries: HashMap<String, PosterState>,
    decode: PosterDecoder,
    /// Where in each clip to grab the frame from.
    ///
    /// Not zero: the first frame of real footage is very often black — a fade up, a slate, or a
    /// leader — and a pool of black rectangles is indistinguishable from the bug this replaces.
    at_seconds: f64,
}

impl Default for PosterCache {
    fn default() -> Self {
        Self::new()
    }
}

impl PosterCache {
    /// A cache backed by the real ffmpeg-based decoder.
    pub fn new() -> Self {
        Self::with_decoder(Arc::new(crate::poster_frame))
    }

    /// A cache backed by `decode`. For tests that need to observe the work, not the picture.
    pub fn with_decoder(decode: PosterDecoder) -> Self {
        Self {
            entries: HashMap::new(),
            decode,
            at_seconds: 1.0,
        }
    }

    /// Queue a thumbnail for `media_id` if one is not already made or failed, and poll it.
    ///
    /// `path` is `None` for media the project references but does not have — that is a `Failed`,
    /// recorded once, not a lookup repeated every frame.
    pub fn request(&mut self, media_id: &str, path: Option<&str>) {
        match self.entries.get(media_id) {
            None => {
                let Some(path) = path else {
                    self.entries
                        .insert(media_id.to_string(), PosterState::Failed);
                    return;
                };
                let (tx, rx) = channel();
                let owned = path.to_string();
                let decode = Arc::clone(&self.decode);
                let at = self.at_seconds;
                // Detached worker: the receiver is the only handle kept. If the cache is cleared
                // or dropped first the send fails and the thread exits.
                std::thread::spawn(move || {
                    let _ = tx.send(decode(&owned, at));
                });
                self.entries
                    .insert(media_id.to_string(), PosterState::Pending(rx));
            }
            Some(PosterState::Pending(rx)) => match rx.try_recv() {
                Ok(Some(frame)) => {
                    self.entries
                        .insert(media_id.to_string(), PosterState::Ready(Arc::new(frame)));
                }
                // A worker that panicked drops its sender; that is a failure, not a wait.
                Ok(None) | Err(TryRecvError::Disconnected) => {
                    self.entries
                        .insert(media_id.to_string(), PosterState::Failed);
                }
                Err(TryRecvError::Empty) => {} // still decoding
            },
            Some(PosterState::Ready(_)) | Some(PosterState::Failed) => {}
        }
    }

    /// The thumbnail for one media id, if its decode has finished.
    ///
    /// `None` while a worker runs, when decode failed, and when the media was never requested.
    /// The caller draws a placeholder in every one of those cases.
    pub fn poster(&self, media_id: &str) -> Option<Arc<PosterFrame>> {
        match self.entries.get(media_id) {
            Some(PosterState::Ready(frame)) => Some(Arc::clone(frame)),
            _ => None,
        }
    }

    /// Whether any decode is still running, so the caller knows to keep asking for frames.
    pub fn has_pending(&self) -> bool {
        self.entries
            .values()
            .any(|state| matches!(state, PosterState::Pending(_)))
    }

    /// Forget everything, so a project switch does not show the last project's pictures.
    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn frame(colour: u8) -> PosterFrame {
        PosterFrame {
            width: 2,
            height: 1,
            rgba: vec![colour, colour, colour, 255, 0, 0, 0, 255],
        }
    }

    /// Block until the worker has landed. Real code polls across frames; a test has no frames.
    fn settle(cache: &mut PosterCache, id: &str, path: Option<&str>) {
        for _ in 0..2000 {
            cache.request(id, path);
            if !cache.has_pending() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        panic!("the decode never settled");
    }

    #[test]
    fn a_poster_is_decoded_once_and_then_read_from_the_cache() {
        let calls = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&calls);
        let mut cache = PosterCache::with_decoder(Arc::new(move |_, _| {
            seen.fetch_add(1, Ordering::SeqCst);
            Some(frame(7))
        }));

        settle(&mut cache, "clip", Some("/x.mp4"));
        assert!(cache.poster("clip").is_some(), "the picture must arrive");

        // Sixty more render passes must not become sixty more ffmpeg processes.
        for _ in 0..60 {
            cache.request("clip", Some("/x.mp4"));
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1, "decoded exactly once");
    }

    /// The state that stops the pool melting the machine. A file that cannot produce a picture
    /// must be asked *once*.
    #[test]
    fn a_failed_decode_is_remembered_rather_than_retried_every_frame() {
        let calls = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&calls);
        let mut cache = PosterCache::with_decoder(Arc::new(move |_, _| {
            seen.fetch_add(1, Ordering::SeqCst);
            None
        }));

        settle(&mut cache, "gone", Some("/gone.mp4"));
        assert!(cache.poster("gone").is_none());

        for _ in 0..60 {
            cache.request("gone", Some("/gone.mp4"));
        }
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "a missing file must not spawn a decoder per frame"
        );
    }

    /// Media the project references but does not have never reaches a worker at all.
    #[test]
    fn media_with_no_path_fails_without_spawning_anything() {
        let calls = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&calls);
        let mut cache = PosterCache::with_decoder(Arc::new(move |_, _| {
            seen.fetch_add(1, Ordering::SeqCst);
            Some(frame(1))
        }));

        cache.request("unregistered", None);
        assert!(!cache.has_pending(), "nothing should be in flight");
        assert_eq!(calls.load(Ordering::SeqCst), 0, "no worker was started");
        assert!(cache.poster("unregistered").is_none());
    }

    /// A project switch must not leave the previous project's pictures on screen.
    #[test]
    fn clearing_forgets_the_previous_projects_pictures() {
        let mut cache = PosterCache::with_decoder(Arc::new(|_, _| Some(frame(3))));
        settle(&mut cache, "clip", Some("/x.mp4"));
        assert!(cache.poster("clip").is_some());
        cache.clear();
        assert!(cache.poster("clip").is_none());
    }

    /// The frame is taken from a second in, not from zero.
    ///
    /// Real footage very often opens black — a fade up, a slate, a leader — and a pool of black
    /// rectangles looks exactly like the bug thumbnails were added to remove.
    #[test]
    fn the_frame_is_taken_past_the_start_of_the_clip() {
        let at = Arc::new(std::sync::Mutex::new(0.0f64));
        let seen = Arc::clone(&at);
        let mut cache = PosterCache::with_decoder(Arc::new(move |_, seconds| {
            *seen.lock().expect("not poisoned") = seconds;
            Some(frame(2))
        }));
        settle(&mut cache, "clip", Some("/x.mp4"));
        assert!(
            *at.lock().expect("not poisoned") > 0.0,
            "a thumbnail taken at 0.0s is a black rectangle on most real footage"
        );
    }
}
