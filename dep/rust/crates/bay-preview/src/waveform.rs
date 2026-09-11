//! Waveform peaks for the timeline, extracted off the interactive render path.
//!
//! Peak extraction spawns ffmpeg and decodes the whole file to mono PCM
//! ([`bay_audio::waveform_peaks`]). On the UI thread that is the same mistake video decode
//! already made and already fixed: a long clip freezes the frame. So this mirrors
//! [`crate::PreviewRenderer`]'s decode state machine exactly — first sighting spawns a detached
//! worker, every later sighting polls the channel — rather than inventing a second concurrency
//! style.
//!
//! The cache lives here, not in the UI crate, because "which clips need a waveform, and has one
//! arrived" is logic: a headless client or a test must be able to reach it. The view holds this
//! handle and draws what is ready.

use bay_project::{Element, MediaAsset, Scene};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::mpsc::{Receiver, TryRecvError, channel};

/// How peaks are produced from a file. Swappable so a test can prove the request path is
/// non-blocking without an ffmpeg on the machine — the shape of the work is what matters here,
/// not the audio.
pub type PeakExtractor = Arc<dyn Fn(&str, usize) -> Option<Vec<f32>> + Send + Sync>;

/// A cache entry is per media *and* per bucket count: 48 peaks and 480 peaks are different
/// pictures of the same file, and a zoomed-in lane asking for more must not read the coarse one.
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
struct WaveformKey {
    media_id: String,
    buckets: usize,
}

/// Where one waveform's extraction has got to. Same three states as `ClipState`, same reasons.
enum WaveformState {
    /// Worker is extracting; poll the channel each frame and draw the clip bare meanwhile.
    Pending(Receiver<Option<Vec<f32>>>),
    Ready(Vec<f32>),
    /// Extraction failed, or there is no ffmpeg. Remembered so a file that cannot produce peaks
    /// is not re-spawned every frame — sixty ffmpeg processes a second, on a missing file.
    Failed,
}

/// Waveform peaks per (media, bucket count), extracted on worker threads.
///
/// The two halves are deliberately separate calls: [`Self::request_scene`] queues work and polls,
/// [`Self::peaks`] reads. A render pass calls the first once and the second per clip, and neither
/// ever blocks.
pub struct WaveformCache {
    entries: HashMap<WaveformKey, WaveformState>,
    extract: PeakExtractor,
}

impl Default for WaveformCache {
    fn default() -> Self {
        Self::new()
    }
}

impl WaveformCache {
    /// A cache backed by the real ffmpeg-based extractor.
    pub fn new() -> Self {
        Self::with_extractor(Arc::new(bay_audio::waveform_peaks))
    }

    /// A cache backed by `extract`. For tests that need to observe *when and where* extraction
    /// runs rather than what it returns.
    pub fn with_extractor(extract: PeakExtractor) -> Self {
        Self {
            entries: HashMap::new(),
            extract,
        }
    }

    /// Queue a waveform for every audio element in `scene`, and collect any that have finished.
    ///
    /// Never blocks: an element seen for the first time starts a worker and returns immediately,
    /// so the caller draws that clip without its waveform until a later tick collects it.
    pub fn request_scene(&mut self, scene: &Scene, media: &[MediaAsset], buckets: usize) {
        if buckets == 0 {
            return;
        }
        for track in scene.tracks.iter() {
            for element in &track.elements {
                let Element::Audio(audio) = element else {
                    continue;
                };
                let path = media
                    .iter()
                    .find(|asset| asset.id == audio.media_id)
                    .map(|asset| asset.path.as_str());
                self.poll(&audio.media_id, path, buckets);
            }
        }
    }

    /// Queue peaks for one media asset, whether or not it is on the timeline.
    ///
    /// [`Self::request_scene`] walks the scene, which is the right question for a lane — a
    /// waveform is drawn under the clip that uses it. A media pool asks a different one: it shows
    /// every imported asset, and most of them are not on the timeline at all. Same cache and same
    /// deduplication either way.
    pub fn request(&mut self, media_id: &str, path: Option<&str>, buckets: usize) {
        if buckets == 0 {
            return;
        }
        self.poll(media_id, path, buckets);
    }

    /// The peaks for one media id, if extraction has already finished. `None` while a worker is
    /// still running, when extraction failed, and when the media was never requested — the
    /// caller draws the clip without a waveform in every one of those cases.
    pub fn peaks(&self, media_id: &str, buckets: usize) -> Option<&[f32]> {
        match self.entries.get(&WaveformKey {
            media_id: media_id.to_string(),
            buckets,
        }) {
            Some(WaveformState::Ready(peaks)) => Some(peaks),
            _ => None,
        }
    }

    /// True while any extraction is still on a worker. The UI polls this to keep asking for
    /// frames, exactly as it does for [`crate::PreviewRenderer::has_pending_decodes`] — without
    /// it a finished waveform would sit uncollected until something unrelated repaints.
    pub fn has_pending(&self) -> bool {
        self.entries
            .values()
            .any(|state| matches!(state, WaveformState::Pending(_)))
    }

    /// Number of media/bucket pairs the cache knows about, in any state (tests, diagnostics).
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Drop every entry. Called when the editor switches project: media ids are per project, so
    /// keeping these would draw the old project's sound under the new project's clips.
    ///
    /// A worker still running for a dropped entry finds its receiver gone, its send fails, and
    /// the thread exits — the same detached-worker contract the decode path uses.
    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// Block until every audio element in `scene` has a waveform or has failed.
    ///
    /// The interactive path must never call this. It exists for headless callers, which have no
    /// later tick to collect on — the same split as `await_decodes` against `poll_decode`.
    /// Returns the media ids that could not produce peaks (no ffmpeg, or an unreadable file), so
    /// a caller that needs evidence can tell "not yet" from "never".
    pub fn await_scene(
        &mut self,
        scene: &Scene,
        media: &[MediaAsset],
        buckets: usize,
    ) -> Vec<String> {
        self.request_scene(scene, media, buckets);
        let mut failed = Vec::new();
        for track in scene.tracks.iter() {
            for element in &track.elements {
                let Element::Audio(audio) = element else {
                    continue;
                };
                let path = media
                    .iter()
                    .find(|asset| asset.id == audio.media_id)
                    .map(|asset| asset.path.as_str());
                let key = WaveformKey {
                    media_id: audio.media_id.clone(),
                    buckets,
                };
                loop {
                    self.poll(&audio.media_id, path, buckets);
                    match self.entries.get(&key) {
                        Some(WaveformState::Pending(_)) => {
                            std::thread::sleep(std::time::Duration::from_millis(10))
                        }
                        _ => break,
                    }
                }
                if !matches!(self.entries.get(&key), Some(WaveformState::Ready(_)))
                    && !failed.contains(&audio.media_id)
                {
                    failed.push(audio.media_id.clone());
                }
            }
        }
        failed
    }

    /// Advance one entry: start a worker on first sighting, otherwise check whether it finished.
    /// Never blocks.
    fn poll(&mut self, media_id: &str, path: Option<&str>, buckets: usize) {
        let key = WaveformKey {
            media_id: media_id.to_string(),
            buckets,
        };
        match self.entries.get(&key) {
            None => {
                let Some(path) = path else {
                    // Unregistered media — remember it so we do not look again every frame.
                    self.entries.insert(key, WaveformState::Failed);
                    return;
                };
                let (tx, rx) = channel();
                let owned = path.to_string();
                let extract = Arc::clone(&self.extract);
                // Detached worker: the receiver is the only handle kept. If the cache is cleared
                // or dropped first the send fails and the thread exits.
                std::thread::spawn(move || {
                    let _ = tx.send(extract(&owned, buckets));
                });
                self.entries.insert(key, WaveformState::Pending(rx));
            }
            Some(WaveformState::Pending(rx)) => match rx.try_recv() {
                Ok(Some(peaks)) => {
                    self.entries.insert(key, WaveformState::Ready(peaks));
                }
                // A worker that panicked drops its sender; that is a failure, not a wait.
                Ok(None) | Err(TryRecvError::Disconnected) => {
                    self.entries.insert(key, WaveformState::Failed);
                }
                Err(TryRecvError::Empty) => {} // still extracting
            },
            Some(WaveformState::Ready(_)) | Some(WaveformState::Failed) => {}
        }
    }
}
