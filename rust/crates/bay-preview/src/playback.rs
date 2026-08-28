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
///
/// Ahead matters more, and for a different reason: it is the memory bound. At preview size a
/// frame is about half a megabyte, so 96 ahead and 48 behind is roughly 70 MB per playing clip.
/// [`Worker::drain`] enforces both edges; enforcing only the trailing one cost 1.5 GB in six
/// seconds, because the decoder runs an order of magnitude faster than the playhead.
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
    fn drain(&mut self, wanted: u64) -> u64 {
        let mut decoded = 0;
        // Bounded **ahead** as well as behind, and the ahead half is the one that matters.
        //
        // The first version drained until the channel was empty. That looks like it inherits the
        // `sync_channel`'s backpressure and it does not: emptying the queue every tick frees the
        // worker to decode the next 48 immediately, so the only real limit becomes how fast
        // ffmpeg runs — measured at ~500 fps against a playhead moving at 24. The map grew by
        // ~475 frames a second, half a megabyte each, and `bay-bench` caught it holding 2,951
        // frames (1.5 GB) after six seconds. A minute of playback was tens of gigabytes and the
        // machine went to swap, which is a far better explanation of "laggy" than any frame cost.
        //
        // Stopping the drain at the window edge leaves the frames in the channel, where the
        // bound is enforced by `send` blocking — which is what `QUEUE_DEPTH` was for all along.
        let ceiling = wanted + WINDOW_FRAMES as u64;
        while self.window.last_key_value().map_or(0, |(index, _)| *index) < ceiling {
            let Ok((index, pixels)) = self.frames.try_recv() else {
                break;
            };
            self.window.insert(index, pixels);
            decoded += 1;
        }
        // Evict well behind the playhead. Split rather than retain: the map is ordered, so this
        // is a pointer move rather than a walk of every frame held.
        let floor = wanted.saturating_sub(WINDOW_FRAMES as u64 / 2);
        if floor > 0 {
            self.window = self.window.split_off(&floor);
        }
        decoded
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

/// What the playback window did, counted so a stall can be attributed rather than guessed.
///
/// Every field here distinguishes a *different* cause of the same symptom — a picture that does
/// not move. Without them "playback is laggy" has at least four explanations and no way to pick
/// one: the decoder is too slow (`starved`), the presentation side is asking too rarely
/// (`served` far below the source rate), the window keeps being thrown away (`reseeks`), or the
/// frames are arriving fine and the same one is being shown twice (`repeats`).
#[derive(Default, Clone, Copy, Debug, PartialEq, Eq)]
pub struct PlaybackStats {
    /// Frames asked for.
    pub requests: u64,
    /// Requests answered with a frame.
    pub served: u64,
    /// Requests answered with the *same* index as the previous one — the picture stood still
    /// because the next frame had not arrived.
    pub repeats: u64,
    /// Requests answered with nothing at all: the window held no frame at or before the
    /// playhead. Before the first frame of a clip this is expected; sustained, it is starvation.
    pub starved: u64,
    /// Decoders respawned. Each one is an ffmpeg process start, so this should be near zero
    /// during steady playback and a handful after a seek.
    pub reseeks: u64,
    /// Frames the workers handed over.
    pub decoded: u64,
    /// Newest decoded index minus the one asked for, at the last request — the head start, in
    /// frames. A number that trends to zero is a decoder losing the race.
    pub head_start: i64,
}

/// The decoders playback has running, one per video element.
#[derive(Default)]
pub struct PlaybackStreams {
    open: std::collections::HashMap<String, Worker>,
    stats: PlaybackStats,
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

    /// Counters since the last [`Self::take_stats`]. See [`PlaybackStats`].
    pub fn take_stats(&mut self) -> PlaybackStats {
        std::mem::take(&mut self.stats)
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
        self.stats.requests += 1;

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
            self.stats.reseeks += 1;
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
        let decoded = worker.drain(wanted);
        let (width, height) = (worker.width, worker.height);
        let previous = worker.last_served;
        let newest = worker.window.keys().next_back().copied();
        let _ = path;
        let frame = worker.frame(wanted);
        let served = frame.is_some();
        // Borrow of `worker` ends here; the counters live on `self`.
        let index = self.open.get(element_id).and_then(|w| w.last_served);

        self.stats.decoded += decoded;
        self.stats.head_start = newest.map_or(0, |n| n as i64 - wanted as i64);
        if served {
            self.stats.served += 1;
            if index == previous {
                self.stats.repeats += 1;
            }
        } else {
            self.stats.starved += 1;
        }

        // Re-lookup rather than hold the borrow across the counter writes above. The window is a
        // `BTreeMap` and this is one comparison-chain per painted frame, not per decoded frame.
        let worker = self.open.get(element_id)?;
        let index = worker.last_served?;
        worker
            .window
            .get(&index)
            .map(|pixels| (width, height, pixels.as_slice()))
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

    /// The window is bounded **ahead** of the playhead, which is what makes it a window rather
    /// than a slow whole-clip cache.
    ///
    /// This is the one that caught a real leak. `drain` used to read until the channel was empty,
    /// which reads like it respects the `sync_channel` bound and does not: emptying the queue
    /// releases the worker to fill it again, so the map's only limit was ffmpeg's speed. The
    /// decoder runs at ~500 fps and the playhead at 24, so the window grew by ~475 frames per
    /// second of playback - half a megabyte each. `bay-bench` measured 2,951 frames held after
    /// six seconds; a minute of playback would have been tens of gigabytes.
    #[test]
    fn the_window_does_not_grow_ahead_without_bound() {
        // Far more frames available than the window may hold, all decoded and waiting.
        let plenty = WINDOW_FRAMES * 10;
        let mut worker = worker_from(
            (0..plenty as u64).map(|i| (i, vec![i as u8])).collect(),
            30.0,
        );

        worker.drain(0);

        let newest = *worker
            .window
            .keys()
            .next_back()
            .expect("frames were drained");
        assert!(
            newest <= WINDOW_FRAMES as u64,
            "the window kept {newest} frames ahead of the playhead, bound is {WINDOW_FRAMES}"
        );
        assert!(
            worker.window.len() <= WINDOW_FRAMES + 1,
            "the window holds {} frames, bound is {WINDOW_FRAMES}",
            worker.window.len()
        );
        // The rest stay in the channel, where `send` blocking is the backpressure.
        assert!(
            worker.frames.try_recv().is_ok(),
            "undrained frames are still queued rather than dropped"
        );
    }

    /// Advancing the playhead pulls the window along, so the bound above is not a one-shot cap
    /// that starves playback after the first `WINDOW_FRAMES`.
    #[test]
    fn the_window_follows_the_playhead_forward() {
        let plenty = WINDOW_FRAMES * 4;
        let mut worker = worker_from(
            (0..plenty as u64).map(|i| (i, vec![i as u8])).collect(),
            30.0,
        );

        worker.drain(0);
        let first = *worker
            .window
            .keys()
            .next_back()
            .expect("frames were drained");
        worker.drain(WINDOW_FRAMES as u64);
        let second = *worker
            .window
            .keys()
            .next_back()
            .expect("frames were drained");

        assert!(
            second > first,
            "the window edge stayed at {first} as the playhead advanced"
        );
        assert!(
            worker.frame(WINDOW_FRAMES as u64).is_some(),
            "the frame under the advanced playhead is present"
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
