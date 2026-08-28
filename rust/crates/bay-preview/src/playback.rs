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
use std::sync::mpsc::{Receiver, TryRecvError, sync_channel};

/// Frames held ahead of the playhead.
///
/// Small on purpose. Each is a decoded preview-sized frame, and the point is to absorb decode
/// jitter, not to cache the clip — that is what the whole-clip path is for, and holding more
/// here would reintroduce the memory pressure this design exists to avoid.
const QUEUE_DEPTH: usize = 8;

/// How far ahead a request may be before it is cheaper to re-seek than to read forward.
///
/// Reading forward means pulling and discarding every intervening frame through the pipe. Past
/// roughly a second that costs more than respawning ffmpeg at the new position.
const RESEEK_AHEAD_FRAMES: u64 = 30;

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
    /// The most recent frame handed to the compositor. Held so a frame that has not arrived yet
    /// shows the last one rather than nothing.
    latest: Option<Decoded>,
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

    /// Take everything the worker has produced, keeping the newest frame at or before `wanted`.
    ///
    /// Never blocks: `try_recv` until the queue is empty. Frames past `wanted` are kept as
    /// `latest` too — the playhead is about to reach them, and dropping them would mean decoding
    /// them again.
    fn drain_to(&mut self, wanted: u64) {
        loop {
            match self.frames.try_recv() {
                Ok(frame) => {
                    let reached = frame.0 >= wanted;
                    self.latest = Some(frame);
                    if reached {
                        return;
                    }
                }
                Err(TryRecvError::Empty) | Err(TryRecvError::Disconnected) => return,
            }
        }
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
        let reseek = match self.open.get(element_id) {
            Some(worker) => {
                let wanted = worker.index_for(source_seconds);
                match worker.latest.as_ref().map(|(index, _)| *index) {
                    Some(have) => wanted + 1 < have || wanted > have + RESEEK_AHEAD_FRAMES,
                    None => false,
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
        worker.drain_to(wanted);
        let (width, height) = (worker.width, worker.height);
        let _ = path;
        worker
            .latest
            .as_ref()
            .map(|(_, pixels)| (width, height, pixels.as_slice()))
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
            latest: None,
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

    fn worker_from(frames: Vec<Decoded>, fps: f32) -> Worker {
        let (tx, rx) = sync_channel::<Decoded>(64);
        for frame in frames {
            tx.send(frame).expect("capacity");
        }
        drop(tx);
        Worker {
            frames: rx,
            stop: Arc::new(AtomicBool::new(false)),
            origin_seconds: 0.0,
            fps,
            width: 2,
            height: 1,
            latest: None,
        }
    }

    #[test]
    fn draining_stops_at_the_frame_that_was_asked_for() {
        let mut worker = worker_from((0..10).map(|i| (i, vec![i as u8])).collect(), 30.0);
        worker.drain_to(3);
        assert_eq!(
            worker.latest.as_ref().map(|(i, _)| *i),
            Some(3),
            "it must stop at the wanted frame, not run to the end of the queue"
        );
    }

    /// The property that keeps the UI alive: an empty queue returns immediately with whatever
    /// was last decoded, rather than waiting for the next frame.
    #[test]
    fn an_empty_queue_keeps_the_last_frame_and_does_not_block() {
        let mut worker = worker_from(vec![(0, vec![7])], 30.0);
        worker.drain_to(0);
        assert_eq!(worker.latest.as_ref().map(|(i, _)| *i), Some(0));

        // Nothing more will arrive; asking for a later frame must return, not hang.
        worker.drain_to(99);
        assert_eq!(
            worker.latest.as_ref().map(|(i, _)| *i),
            Some(0),
            "a frame that has not been decoded shows the previous one"
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
