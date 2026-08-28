//! Frames for the transport, decoded on worker threads and never waited for.
//!
//! # Why this exists
//!
//! Playback first streamed frames by calling `ClipStream::frame_at` straight from the composite
//! path. That reads the ffmpeg pipe with `read_exact` — a **blocking read on the render thread**
//! — and a backward seek respawned ffmpeg there too. It replaced a 4 fps slideshow with a
//! stalling window, and it broke the rule in `CLAUDE.md` that decode never runs on the
//! interactive render path.
//!
//! This is the shape every serious player uses (ffplay, VDPAU, ExoPlayer): **a decoder thread
//! filling a bounded queue, and a presentation side that takes whatever is ready and never
//! blocks.** The queue is a `sync_channel`, so backpressure is free — a worker that runs ahead
//! blocks on `send` instead of decoding the whole clip into memory, which is the trap the
//! whole-clip cache fell into.
//!
//! # What it gives up, on purpose
//!
//! A frame that has not arrived yet is not waited for. The last decoded frame stays on screen
//! instead, which is a repeated frame rather than a stalled window — the trade every player
//! makes, and the right one: a late frame is invisible, a frozen UI is not.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, sync_channel};

/// Frames the worker may run ahead by before it blocks.
///
/// Deep enough to be a real head start. The first version used 8, which is a quarter-second at
/// 30 fps — the worker was permanently racing the playhead and lost whenever a decode came in
/// late. Scrubbing was smooth in the same build because the whole-clip cache had *already*
/// decoded everything; the difference was never the compositor, it was how far ahead the frames
/// were. 48 is about a second and a half, and at preview size costs a few megabytes.
const QUEUE_DEPTH: usize = 48;

/// Frames kept in the window, ahead of and behind the playhead.
///
/// Behind matters: playback nudges the playhead backwards on any correction, and a window that
/// only looks forward would re-seek — respawning ffmpeg — for a move of one frame.
const WINDOW_FRAMES: usize = 96;

/// How far past the newest decoded frame a request may be before re-seeking beats waiting.
///
/// Generous, because a re-seek respawns ffmpeg and that is the expensive thing. Playback drifting
/// a few frames ahead of the decoder is normal and self-corrects; treating it as a seek turns a
/// momentary lag into a spawn, which makes it worse — the failure the first version had.
const RESEEK_AHEAD_FRAMES: u64 = 90;

/// One decoded frame, with the index it sits at in the stream.
type Decoded = (u64, Vec<u8>);

/// A decoder running ahead of the playhead for one clip.
struct Worker {
    frames: Receiver<Decoded>,
    stop: Arc<AtomicBool>,
    origin_seconds: f64,
    fps: f32,
    width: u32,
    height: u32,
    /// Decoded frames by index, ahead of and behind the playhead.
    ///
    /// A *window*, not a single frame. Holding only the newest — which the first version did —
    /// means a request for anything already passed is a miss, and a miss is a re-seek. This is
    /// the whole-clip cache's shape (instant lookup by index) bounded to what playback needs.
    window: std::collections::BTreeMap<u64, Vec<u8>>,
    /// The newest index handed out, so a lookup that misses can fall back to something sensible.
    last_served: Option<u64>,
}

impl Drop for Worker {
    /// Tell the thread to stop. It notices on its next send and exits, which closes its
    /// `ClipStream` and kills the ffmpeg child with it.
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

impl Worker {
    /// Index of the frame covering `source_seconds`.
    fn index_for(&self, source_seconds: f64) -> u64 {
        (((source_seconds - self.origin_seconds) * self.fps as f64).floor()).max(0.0) as u64
    }

    /// Move everything the worker has produced into the window, and drop what is far behind.
    ///
    /// Never blocks: `try_recv` until empty. Everything decoded is *kept*, not consumed — that
    /// is the difference from the first version and the reason a frame the playhead has already
    /// passed is still there when something asks for it again.
    fn drain(&mut self, wanted: u64) {
        while let Ok((index, pixels)) = self.frames.try_recv() {
            self.window.insert(index, pixels);
        }
        // Evict well behind the playhead. Split rather than retain: the map is ordered, so this
        // is a pointer move rather than a walk of every frame held.
        let floor = wanted.saturating_sub(WINDOW_FRAMES as u64 / 2);
        if floor > 0 {
            self.window = self.window.split_off(&floor);
        }
    }

    /// The frame at `wanted`, or the newest one before it.
    ///
    /// Falling back to an earlier frame is what makes a late decode invisible: the picture holds
    /// for a frame instead of the window stalling for one.
    fn frame(&mut self, wanted: u64) -> Option<&[u8]> {
        let index = if self.window.contains_key(&wanted) {
            Some(wanted)
        } else {
            self.window.range(..=wanted).next_back().map(|(i, _)| *i)
        }?;
        self.last_served = Some(index);
        self.window.get(&index).map(|pixels| pixels.as_slice())
    }
}

/// The decoders playback has running, one per video element.
#[derive(Default)]
pub struct PlaybackStreams {
    open: std::collections::HashMap<String, Worker>,
    /// Elements whose decoder could not be started. Remembered so a broken path costs one failed
    /// spawn rather than one per frame.
    failed: std::collections::HashSet<String>,
}

impl PlaybackStreams {
    /// Close every decoder. Called when the transport stops, so a paused editor holds none.
    pub fn close_all(&mut self) {
        self.open.clear();
        self.failed.clear();
    }

    /// The frame for `element_id` at `source_seconds`, if one is ready.
    ///
    /// **Never blocks.** Returns the newest decoded frame at or before the requested time, the
    /// previous frame when the next has not arrived, and `None` only before the first frame of a
    /// clip has landed.
    pub fn frame_at(
        &mut self,
        element_id: &str,
        path: &str,
        source_seconds: f64,
        open: impl FnOnce(f64) -> Option<PlaybackSource>,
    ) -> Option<(u32, u32, &[u8])> {
        if self.failed.contains(element_id) {
            return None;
        }

        // Re-seek when the playhead moved backwards, or far enough forward that reading through
        // the intervening frames would cost more than a respawn.
        // Re-seek only when the window genuinely cannot answer: the request is before everything
        // held, or far enough past the newest frame that reading forward would take longer than
        // starting again. A request *inside* the window is a lookup, never a respawn.
        let reseek = match self.open.get(element_id) {
            Some(worker) => {
                let wanted = worker.index_for(source_seconds);
                match (
                    worker.window.keys().next().copied(),
                    worker.window.keys().next_back().copied(),
                ) {
                    (Some(oldest), Some(newest)) => {
                        wanted < oldest || wanted > newest + RESEEK_AHEAD_FRAMES
                    }
                    // Nothing decoded yet — wait for the worker rather than restart it.
                    _ => false,
                }
            }
            None => true,
        };

        if reseek {
            self.open.remove(element_id);
            match open(source_seconds) {
                Some(source) => {
                    self.open
                        .insert(element_id.to_string(), source.into_worker(source_seconds));
                }
                None => {
                    self.failed.insert(element_id.to_string());
                    return None;
                }
            }
        }

        let worker = self.open.get_mut(element_id)?;
        let wanted = worker.index_for(source_seconds);
        worker.drain(wanted);
        let (width, height) = (worker.width, worker.height);
        let _ = path;
        worker.frame(wanted).map(|pixels| (width, height, pixels))
    }

    /// Close decoders for elements no longer on screen, so a long timeline does not accumulate
    /// one ffmpeg process per clip it has ever shown.
    pub fn retain_only(&mut self, live: &std::collections::HashSet<String>) {
        self.open.retain(|id, _| live.contains(id));
    }
}

/// Everything needed to start decoding one clip, handed in by the caller so this module does not
/// have to know how a `ClipStream` is built.
pub struct PlaybackSource {
    pub width: u32,
    pub height: u32,
    pub fps: f32,
    /// Pulls the next frame, returning `None` at end of stream. Runs on the worker thread.
    pub next_frame: Box<dyn FnMut() -> Option<Vec<u8>> + Send>,
}

impl PlaybackSource {
    fn into_worker(mut self, origin_seconds: f64) -> Worker {
        // Bounded: a worker that runs ahead blocks on `send` rather than decoding the clip into
        // memory. That backpressure is the whole reason this is a `sync_channel`.
        let (tx, rx) = sync_channel::<Decoded>(QUEUE_DEPTH);
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);

        std::thread::spawn(move || {
            let mut index: u64 = 0;
            while !worker_stop.load(Ordering::Relaxed) {
                let Some(pixels) = (self.next_frame)() else {
                    return; // end of stream
                };
                // A closed receiver means the clip was dropped; stop rather than decode on.
                if tx.send((index, pixels)).is_err() {
                    return;
                }
                index += 1;
            }
        });

        Worker {
            frames: rx,
            stop,
            origin_seconds,
            fps: self.fps.max(1.0),
            width: self.width,
            height: self.height,
            window: std::collections::BTreeMap::new(),
            last_served: None,
        }
    }
}

/// A frame queue's behaviour, without a decoder.
///
/// The queue is the part that has to be right — a wrong `drain_to` shows a stale frame forever,
/// or spins, and neither is visible in a screenshot.
#[cfg(test)]
mod tests {
    use super::*;

    /// A worker pre-loaded with `frames` and no live decoder.
    ///
    /// The channel is sized to the batch. A fixed capacity deadlocks the moment a test sends
    /// more than it — `sync_channel` blocks on a full buffer, and the first version of this
    /// helper hung the suite by sending 300 frames into a 256-slot channel.
    fn worker_from(frames: Vec<Decoded>, fps: f32) -> Worker {
        let (tx, rx) = sync_channel::<Decoded>(frames.len().max(1));
        for frame in frames {
            tx.send(frame).expect("the channel is sized to the batch");
        }
        drop(tx);
        Worker {
            frames: rx,
            stop: Arc::new(AtomicBool::new(false)),
            origin_seconds: 0.0,
            fps,
            width: 2,
            height: 1,
            window: std::collections::BTreeMap::new(),
            last_served: None,
        }
    }

    /// The property the first version got wrong: a frame the playhead has already passed is
    /// still there. Keeping only the newest made every backward step a miss, and a miss is a
    /// re-seek — which respawns ffmpeg mid-playback.
    #[test]
    fn a_frame_already_passed_is_still_in_the_window() {
        let mut worker = worker_from((0..20).map(|i| (i, vec![i as u8])).collect(), 30.0);
        worker.drain(19);
        assert!(worker.frame(19).is_some(), "the newest frame is available");
        assert_eq!(
            worker.frame(5).map(|p| p[0]),
            Some(5),
            "and so is one the playhead went past"
        );
    }

    /// A frame that has not been decoded shows the newest one before it, rather than nothing.
    /// That is what makes a late decode invisible instead of a stall.
    #[test]
    fn a_missing_frame_falls_back_to_the_one_before_it() {
        let mut worker = worker_from(vec![(0, vec![0]), (1, vec![1]), (2, vec![2])], 30.0);
        worker.drain(2);
        assert_eq!(
            worker.frame(50).map(|p| p[0]),
            Some(2),
            "asking past the end holds the last decoded frame"
        );
    }

    /// An empty window answers immediately rather than waiting for a decode.
    #[test]
    fn an_empty_window_returns_none_without_blocking() {
        let mut worker = worker_from(vec![], 30.0);
        worker.drain(0);
        assert!(worker.frame(0).is_none());
    }

    /// Frames far behind are dropped, or a long playback holds the whole clip in memory — which
    /// is the trap the whole-clip cache fell into and this design exists to avoid.
    #[test]
    fn the_window_evicts_what_is_far_behind() {
        let mut worker = worker_from((0..300).map(|i| (i, vec![i as u8])).collect(), 30.0);
        worker.drain(299);
        assert!(
            worker.window.len() < 300,
            "the window must not grow without bound, held {}",
            worker.window.len()
        );
        assert!(
            worker.frame(299).is_some(),
            "and must still hold the frames near the playhead"
        );
    }

    #[test]
    fn the_index_follows_the_rate_and_the_origin() {
        let mut worker = worker_from(vec![], 25.0);
        worker.origin_seconds = 10.0;
        assert_eq!(worker.index_for(10.0), 0, "the origin is frame zero");
        assert_eq!(worker.index_for(11.0), 25, "a second later is 25 frames on");
        assert_eq!(
            worker.index_for(0.0),
            0,
            "a time before the origin clamps rather than underflowing"
        );
    }

    /// A dropped worker must tell its thread to stop, or a scrub leaves one ffmpeg per seek.
    #[test]
    fn dropping_a_worker_signals_its_thread() {
        let worker = worker_from(vec![], 30.0);
        let stop = Arc::clone(&worker.stop);
        assert!(!stop.load(Ordering::Relaxed));
        drop(worker);
        assert!(
            stop.load(Ordering::Relaxed),
            "the thread must be told to exit, or every re-seek leaks a decoder"
        );
    }
}
