//! The streaming mixer: a real-time-safe render callback pulling from a ring buffer, fed by a
//! mix worker that renders one block at a time.
//!
//! # Why this exists
//!
//! Preview playback used to decode every source file in full, mix **the entire remaining
//! timeline** into one buffer, and hand that buffer to the audio device. Everything about a
//! mixer is impossible on top of that: a fader you can hear would have to re-mix and re-submit
//! the rest of the film, a meter has nothing to read because the mix already happened, and solo
//! is a re-render. What a mixer needs is for the mix to be *happening*, continuously, in blocks
//! small enough that a control moved now is audible now.
//!
//! So: [`BlockMixer`] renders [`BLOCK_FRAMES`] at a time from the same summing loop the offline
//! mixer uses ([`crate::accumulate_clip`]), a [`RingProducer`] pushes those blocks into a
//! lock-free ring, and [`StreamRenderer::render`] — the thing a device callback calls — pops
//! from the other end.
//!
//! # What "real-time-safe" means here, concretely
//!
//! [`StreamRenderer::render`] does not allocate, does not lock, and does not touch the
//! filesystem or a subprocess. The ring's slots are `AtomicU32` holding `f32` bits, so there is
//! no `UnsafeCell` and no `unsafe` block in this module at all — the price is one relaxed
//! atomic load per sample, which is nothing next to the decode it replaces. An empty ring is an
//! **underrun**: the callback zero-fills the remainder and counts it, because a callback that
//! blocked waiting for the worker would glitch every other application on the machine too.
//!
//! # Testable with no device
//!
//! Nothing in this module opens a device or requires one to exist. A test pulls blocks by
//! calling [`BlockMixer::render_block`], or drives the whole engine by calling
//! [`StreamEngine::pump`] and [`StreamRenderer::render`] by hand. That is deliberate: a mixer
//! whose behaviour can only be verified by listening is a mixer nobody can regress-test.

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering};

use crate::loudness::{self, Biquad};
use crate::{AudioPcm, GainEnvelope, MixClip, MixWindow, accumulate_clip, composed_pan_gains};

/// Frames per mix block. At 48 kHz this is ~10.7 ms — short enough that a fader move is
/// audible within a frame of video, long enough that the per-block bookkeeping disappears next
/// to the sample loop.
pub const BLOCK_FRAMES: usize = 512;

/// How many blocks the ring holds. Four blocks is ~43 ms at 48 kHz: enough that an ordinary
/// scheduling hiccup on the worker does not reach the ear, little enough that the meter is not
/// reporting sound from a noticeably different moment than the one being heard.
pub const RING_BLOCKS: usize = 4;

// -- The ring ------------------------------------------------------------------------------

/// A single-producer, single-consumer ring of interleaved stereo samples.
///
/// Positions are monotonic counts of samples written and read; the index into the slots is the
/// position masked by a power-of-two capacity. Only the producer writes `write`, only the
/// consumer writes `read`, so the pair needs no lock — `Release` on the write side pairs with
/// `Acquire` on the read side to publish the samples that were stored before it.
#[derive(Debug)]
struct Ring {
    slots: Vec<AtomicU32>,
    mask: usize,
    write: AtomicUsize,
    read: AtomicUsize,
    underruns: AtomicU64,
}

impl Ring {
    fn new(capacity_samples: usize) -> Self {
        let capacity = capacity_samples.max(2).next_power_of_two();
        Self {
            slots: (0..capacity).map(|_| AtomicU32::new(0)).collect(),
            mask: capacity - 1,
            write: AtomicUsize::new(0),
            read: AtomicUsize::new(0),
            underruns: AtomicU64::new(0),
        }
    }

    fn capacity(&self) -> usize {
        self.slots.len()
    }
}

/// The worker's end of the ring.
#[derive(Debug)]
pub struct RingProducer {
    ring: Arc<Ring>,
}

impl RingProducer {
    /// Copy as much of `samples` into the ring as there is room for, and say how much that was.
    /// A short write is not an error — it is the ring being full, which is the worker being
    /// ahead of the device, which is the state it should spend most of its life in.
    pub fn push(&self, samples: &[f32]) -> usize {
        let write = self.ring.write.load(Ordering::Relaxed);
        let read = self.ring.read.load(Ordering::Acquire);
        let room = self.ring.capacity() - write.wrapping_sub(read);
        let count = samples.len().min(room);
        for (offset, sample) in samples[..count].iter().enumerate() {
            self.ring.slots[write.wrapping_add(offset) & self.ring.mask]
                .store(sample.to_bits(), Ordering::Relaxed);
        }
        self.ring
            .write
            .store(write.wrapping_add(count), Ordering::Release);
        count
    }

    /// Samples the ring can accept right now.
    pub fn space(&self) -> usize {
        let write = self.ring.write.load(Ordering::Relaxed);
        let read = self.ring.read.load(Ordering::Acquire);
        self.ring.capacity() - write.wrapping_sub(read)
    }
}

/// The device's end of the ring. **The only thing a render callback touches.**
#[derive(Debug)]
pub struct StreamRenderer {
    ring: Arc<Ring>,
}

impl StreamRenderer {
    /// Fill `out` — interleaved stereo — with whatever the ring holds, zero-filling the rest.
    /// Returns how many samples were real.
    ///
    /// **This is the real-time callback.** No allocation, no locking, no IO, no `unsafe`, and
    /// no unbounded loop: it does exactly `out.len()` relaxed loads and two index updates.
    pub fn render(&mut self, out: &mut [f32]) -> usize {
        let read = self.ring.read.load(Ordering::Relaxed);
        let write = self.ring.write.load(Ordering::Acquire);
        let available = write.wrapping_sub(read);
        let count = out.len().min(available);
        for (offset, slot) in out[..count].iter_mut().enumerate() {
            *slot = f32::from_bits(
                self.ring.slots[read.wrapping_add(offset) & self.ring.mask].load(Ordering::Relaxed),
            );
        }
        self.ring
            .read
            .store(read.wrapping_add(count), Ordering::Release);
        for slot in &mut out[count..] {
            *slot = 0.0;
        }
        if count < out.len() {
            self.ring.underruns.fetch_add(1, Ordering::Relaxed);
        }
        count
    }

    /// How many times the callback has asked for more than the ring held.
    ///
    /// Exposed rather than logged: an underrun is the one failure of this design that is
    /// audible, and a number that a test can assert is zero is the only way to know a change to
    /// the worker did not start starving it.
    pub fn underruns(&self) -> u64 {
        self.ring.underruns.load(Ordering::Relaxed)
    }

    /// Samples waiting to be played.
    pub fn queued(&self) -> usize {
        let read = self.ring.read.load(Ordering::Relaxed);
        let write = self.ring.write.load(Ordering::Acquire);
        write.wrapping_sub(read)
    }
}

/// Build a ring and hand back its two ends.
pub fn ring(capacity_samples: usize) -> (RingProducer, StreamRenderer) {
    let ring = Arc::new(Ring::new(capacity_samples));
    (
        RingProducer {
            ring: Arc::clone(&ring),
        },
        StreamRenderer { ring },
    )
}

// -- Metering ------------------------------------------------------------------------------

/// What a meter shows, for one poll.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Levels {
    /// Sample peak per channel, linear, **unweighted**. A peak meter's job is to say whether
    /// the signal touched full scale; K-weighting it would hide a clip at 60 Hz, which is the
    /// clip most worth seeing.
    pub peak: [f32; 2],
    /// K-weighted RMS per channel, linear. Weighted because this is the number that is supposed
    /// to track *how loud it sounds*, and it is the same weighting
    /// [`crate::loudness::measure`] integrates — a meter and a measurement that disagree about
    /// what loud means is how a mix gets balanced against the wrong thing.
    pub rms: [f32; 2],
}

impl Levels {
    pub const SILENT: Levels = Levels {
        peak: [0.0, 0.0],
        rms: [0.0, 0.0],
    };

    /// Peak per channel in dBFS, floored at [`crate::loudness::FLOOR_DB`].
    pub fn peak_db(&self) -> [f32; 2] {
        [
            loudness::to_db(f64::from(self.peak[0]) * f64::from(self.peak[0])),
            loudness::to_db(f64::from(self.peak[1]) * f64::from(self.peak[1])),
        ]
    }

    /// K-weighted RMS per channel in dB, floored at [`crate::loudness::FLOOR_DB`].
    pub fn rms_db(&self) -> [f32; 2] {
        [
            loudness::to_db(f64::from(self.rms[0]) * f64::from(self.rms[0])),
            loudness::to_db(f64::from(self.rms[1]) * f64::from(self.rms[1])),
        ]
    }

    /// Momentary loudness of both channels together, on the LUFS scale — BS.1770's channel sum
    /// and its calibration offset, applied to the same weighted mean squares.
    pub fn lufs(&self) -> f32 {
        let power = f64::from(self.rms[0]) * f64::from(self.rms[0])
            + f64::from(self.rms[1]) * f64::from(self.rms[1]);
        if power <= 0.0 {
            return loudness::R128_FLOOR_LUFS;
        }
        ((loudness::OFFSET_LU + 10.0 * power.log10()) as f32).max(loudness::FLOOR_DB)
    }
}

/// The published side of the meter: four numbers a UI can poll from any thread without taking
/// a lock or stopping the mixer.
///
/// The four are stored independently, so a poll that lands exactly on a block boundary can read
/// one channel from the new block and the other from the old. That is deliberate — a coherent
/// snapshot would cost a seqlock on the audio worker to fix a discrepancy of one 10 ms block in
/// a number that is drawn as a moving bar.
#[derive(Debug)]
pub struct LevelMeter {
    peak: [AtomicU32; 2],
    rms: [AtomicU32; 2],
}

impl LevelMeter {
    fn new() -> Self {
        Self {
            peak: [AtomicU32::new(0), AtomicU32::new(0)],
            rms: [AtomicU32::new(0), AtomicU32::new(0)],
        }
    }

    fn publish(&self, levels: Levels) {
        for channel in 0..2 {
            self.peak[channel].store(levels.peak[channel].to_bits(), Ordering::Relaxed);
            self.rms[channel].store(levels.rms[channel].to_bits(), Ordering::Relaxed);
        }
    }

    /// Read the meter. Cheap, wait-free, and safe to call at whatever rate a UI redraws.
    pub fn read(&self) -> Levels {
        Levels {
            peak: [
                f32::from_bits(self.peak[0].load(Ordering::Relaxed)),
                f32::from_bits(self.peak[1].load(Ordering::Relaxed)),
            ],
            rms: [
                f32::from_bits(self.rms[0].load(Ordering::Relaxed)),
                f32::from_bits(self.rms[1].load(Ordering::Relaxed)),
            ],
        }
    }
}

/// How fast a held peak falls, in dB per second.
///
/// Without a hold, a peak that happened inside one 10 ms block is gone before a UI redrawing at
/// 60 Hz ever looks, so the meter would under-read every transient — which is the opposite of
/// what a peak meter is for. 20 dB/s is the usual broadcast fallback rate.
const PEAK_RELEASE_DB_PER_SECOND: f32 = 20.0;

/// The K-weighting filters, one pair per channel, carried across blocks.
///
/// Carried, not rebuilt: a biquad restarted every block re-attacks its own transient response
/// 94 times a second and colours everything. This is the same failure the offline measurement
/// avoids by filtering the whole signal once, expressed for a stream.
struct Weighting {
    shelf: Biquad,
    high_pass: Biquad,
}

impl Weighting {
    fn new(rate: f64) -> Self {
        Self {
            shelf: Biquad::high_shelf(rate),
            high_pass: Biquad::high_pass(rate),
        }
    }

    fn step(&mut self, sample: f64) -> f64 {
        self.high_pass.step(self.shelf.step(sample))
    }
}

// -- The block mixer -----------------------------------------------------------------------

/// One clip as the streaming mixer sees it: decoded samples, where it sits, how loud it is,
/// and where it sits across the stereo field once its lane has had its say.
#[derive(Debug, Clone)]
pub struct StreamClip {
    /// Decoded interleaved PCM. `Arc` because the same asset is usually on the timeline more
    /// than once and decoding it twice is the thing this design exists to stop.
    pub pcm: Arc<AudioPcm>,
    /// Where this clip's first sample sits on the **stream's** timeline, in seconds. A stream
    /// started at the playhead has its own zero.
    pub start_secs: f64,
    /// In-point into `pcm`, in seconds.
    pub source_start_secs: f64,
    /// How long this clip sounds for.
    pub play_secs: f64,
    /// Flat level, used when `gain_points` carries fewer than two points.
    pub volume: f32,
    /// The clip's level over its own length, `(seconds, gain)` — the polyline
    /// `bay_project::Element::gain_points` produces and the export's `volume` expression is
    /// built from. Read against the clip's own head, so starting playback in the middle of a
    /// duck hears the middle of the duck.
    pub gain_points: Vec<(f64, f32)>,
    /// The clip's own pan, `-1.0` left to `1.0` right.
    pub pan: f32,
    /// The lane's fader, linear.
    pub track_gain: f32,
    /// The lane's pan.
    pub track_pan: f32,
}

impl StreamClip {
    /// Where this clip stops sounding, on the stream's timeline.
    pub fn end_secs(&self) -> f64 {
        self.start_secs + self.play_secs.max(0.0)
    }

    /// The per-channel gain this clip is summed at: **clip pan first, then the lane's pan, then
    /// the lane's fader.**
    ///
    /// Pinned in that order because the export filtergraph composes it the same way and the two
    /// must not be allowed to drift. Both stages are gains, so both multiply — see
    /// [`crate::composed_pan_gains`] for why composing the *positions* instead would be wrong.
    pub fn channel_gains(&self) -> [f32; 2] {
        let pan = composed_pan_gains(self.pan, self.track_pan);
        let gain = if self.track_gain.is_finite() {
            self.track_gain.max(0.0)
        } else {
            1.0
        };
        [pan[0] * gain, pan[1] * gain]
    }

    fn envelope(&self) -> Option<GainEnvelope> {
        (self.gain_points.len() > 1).then(|| GainEnvelope {
            clip_offset_secs: 0.0,
            points: self.gain_points.clone(),
        })
    }
}

/// Renders the timeline one block at a time.
///
/// Owns no device and no thread. Pull a block with [`Self::render_block`] and you have the
/// exact samples the ring will carry — which is what makes every property of the mix
/// assertable in a unit test.
pub struct BlockMixer {
    sample_rate: u32,
    block_frames: usize,
    clips: Vec<StreamClip>,
    /// A `GainEnvelope` per clip, kept alive across blocks so a moving level costs no
    /// allocation per block. Parallel to `clips`.
    envelopes: Vec<Option<GainEnvelope>>,
    block: Vec<f32>,
    position_frames: u64,
    weighting: [Weighting; 2],
    held_peak: [f32; 2],
    meter: Arc<LevelMeter>,
}

impl BlockMixer {
    /// A mixer at `sample_rate` producing `block_frames` frames per block.
    pub fn new(sample_rate: u32, block_frames: usize) -> Self {
        let rate = f64::from(sample_rate.max(1));
        let frames = block_frames.max(1);
        Self {
            sample_rate: sample_rate.max(1),
            block_frames: frames,
            clips: Vec::new(),
            envelopes: Vec::new(),
            block: vec![0.0; frames * 2],
            position_frames: 0,
            weighting: [Weighting::new(rate), Weighting::new(rate)],
            held_peak: [0.0, 0.0],
            meter: Arc::new(LevelMeter::new()),
        }
    }

    /// Replace the timeline being played. Does not move the play position: this is what a
    /// fader, a mute, a solo or a trim does while the transport is running.
    pub fn set_clips(&mut self, clips: Vec<StreamClip>) {
        self.envelopes = clips.iter().map(StreamClip::envelope).collect();
        self.clips = clips;
    }

    pub fn clips(&self) -> &[StreamClip] {
        &self.clips
    }

    /// Move the play position. Resets the K-weighting, because the filters' memory belongs to
    /// the audio that was playing and carrying it across a jump would colour the first
    /// milliseconds after it.
    pub fn seek_seconds(&mut self, seconds: f64) {
        self.position_frames = (seconds.max(0.0) * f64::from(self.sample_rate)).round() as u64;
        let rate = f64::from(self.sample_rate);
        self.weighting = [Weighting::new(rate), Weighting::new(rate)];
        self.held_peak = [0.0, 0.0];
        self.meter.publish(Levels::SILENT);
    }

    /// Seconds from the stream's zero to the start of the next block.
    pub fn position_seconds(&self) -> f64 {
        self.position_frames as f64 / f64::from(self.sample_rate)
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn block_frames(&self) -> usize {
        self.block_frames
    }

    /// The meter this mixer publishes into. Clone it to whatever polls it.
    pub fn meter(&self) -> Arc<LevelMeter> {
        Arc::clone(&self.meter)
    }

    /// Whether every clip has finished sounding — the stream's natural end.
    pub fn is_finished(&self) -> bool {
        let position = self.position_seconds();
        self.clips.iter().all(|clip| clip.end_secs() <= position)
    }

    /// Render the next block and advance the play position.
    ///
    /// Sums through [`accumulate_clip`], the same loop [`crate::mix_stereo`] uses, so a fade
    /// heard here and a fade bounced offline come out of one piece of arithmetic. Allocation
    /// happens once, in [`Self::new`] and [`Self::set_clips`]; this reuses its buffers.
    pub fn render_block(&mut self) -> &[f32] {
        for sample in &mut self.block {
            *sample = 0.0;
        }
        let rate = f64::from(self.sample_rate);
        let block_start = self.position_frames;
        let block_end = block_start + self.block_frames as u64;

        for index in 0..self.clips.len() {
            let clip = &self.clips[index];
            // Everything below is decided in **frames**, not seconds: a clip's remainder inside
            // the block it ends in is an integer, and computing it through floats is how a clip
            // comes to sound for one frame longer than it exists. See [`MixWindow`].
            let clip_start = (clip.start_secs.max(0.0) * rate).round() as u64;
            let clip_end = clip_start + (clip.play_secs.max(0.0) * rate).round() as u64;
            if clip_end <= block_start || clip_start >= block_end {
                continue;
            }
            let from = clip_start.max(block_start);
            let to = clip_end.min(block_end);
            if to <= from {
                continue;
            }
            let into_clip_frames = from - clip_start;
            let into_clip = into_clip_frames as f64 / rate;
            let gains = clip.channel_gains();
            // `Arc::clone` so the borrow of `self.clips` ends before `self.block` is written —
            // a refcount bump, not a copy of the samples.
            let pcm = Arc::clone(&clip.pcm);
            let volume = clip.volume;
            let source_start_frame =
                (clip.source_start_secs.max(0.0) * rate).floor() as u64 + into_clip_frames;
            let window = MixWindow {
                src_start_frame: source_start_frame as usize,
                dst_start_frame: (from - block_start) as usize,
                play_frames: (to - from) as usize,
            };
            let envelope = self.envelopes[index].take().map(|mut envelope| {
                envelope.clip_offset_secs = into_clip;
                envelope
            });
            let mix = MixClip {
                pcm: &pcm,
                src_start_secs: source_start_frame as f64 / rate,
                dst_start_secs: (from - block_start) as f64 / rate,
                play_secs: (to - from) as f64 / rate,
                volume,
                envelope,
            };
            accumulate_clip(&mut self.block, &mix, window, gains, self.sample_rate);
            // Hand the envelope back so the next block reuses its points rather than cloning
            // the polyline ninety-four times a second.
            let MixClip { envelope, .. } = mix;
            self.envelopes[index] = envelope;
        }

        for sample in &mut self.block {
            *sample = sample.clamp(-1.0, 1.0);
        }
        self.meter_block();
        self.position_frames += self.block_frames as u64;
        &self.block
    }

    /// Measure the block that was just rendered and publish it.
    fn meter_block(&mut self) {
        let frames = self.block_frames.max(1);
        let mut peak = [0.0f32; 2];
        let mut weighted_square = [0.0f64; 2];
        for frame in 0..frames {
            for channel in 0..2 {
                let sample = self.block[frame * 2 + channel];
                let sample = if sample.is_finite() { sample } else { 0.0 };
                peak[channel] = peak[channel].max(sample.abs());
                let filtered = self.weighting[channel].step(f64::from(sample));
                weighted_square[channel] += filtered * filtered;
            }
        }

        // Peak-hold with a fixed release, so a transient inside one block survives long enough
        // for a UI that redraws at 60 Hz to see it.
        let block_seconds = frames as f32 / self.sample_rate as f32;
        let decay = 10.0f32.powf(-PEAK_RELEASE_DB_PER_SECOND * block_seconds / 20.0);
        let mut levels = Levels::SILENT;
        for channel in 0..2 {
            self.held_peak[channel] = peak[channel].max(self.held_peak[channel] * decay);
            levels.peak[channel] = self.held_peak[channel];
            levels.rms[channel] = (weighted_square[channel] / frames as f64).sqrt() as f32;
        }
        self.meter.publish(levels);
    }
}

// -- The engine ----------------------------------------------------------------------------

/// The worker half of the stream: a [`BlockMixer`] and the producing end of a ring.
///
/// Call [`Self::pump`] from whatever thread does the mixing. It is deliberately not a thread of
/// its own: who owns the worker thread is a decision for the shell driving playback, and a
/// crate that spawns one behind your back cannot be tested by pulling blocks by hand.
pub struct StreamEngine {
    mixer: BlockMixer,
    producer: RingProducer,
}

impl StreamEngine {
    /// A mixer, a ring `ring_blocks` blocks deep, and the renderer that drains it.
    pub fn new(
        sample_rate: u32,
        block_frames: usize,
        ring_blocks: usize,
    ) -> (Self, StreamRenderer) {
        let frames = block_frames.max(1);
        let (producer, renderer) = ring(frames * 2 * ring_blocks.max(2));
        (
            Self {
                mixer: BlockMixer::new(sample_rate, frames),
                producer,
            },
            renderer,
        )
    }

    /// The default shape: [`BLOCK_FRAMES`] blocks, [`RING_BLOCKS`] of them.
    pub fn with_defaults(sample_rate: u32) -> (Self, StreamRenderer) {
        Self::new(sample_rate, BLOCK_FRAMES, RING_BLOCKS)
    }

    pub fn mixer(&self) -> &BlockMixer {
        &self.mixer
    }

    pub fn mixer_mut(&mut self) -> &mut BlockMixer {
        &mut self.mixer
    }

    /// Render blocks until the ring is full or the timeline is done, and say how many blocks
    /// went in.
    ///
    /// Renders a block only when a **whole** one fits: a partial push would leave the tail of a
    /// block in the mixer's scratch buffer with nowhere to record that it had already been
    /// played, and the next pump would emit it twice.
    pub fn pump(&mut self) -> usize {
        let mut pushed = 0;
        while self.producer.space() >= self.mixer.block_frames() * 2 {
            if self.mixer.is_finished() {
                break;
            }
            let block = self.mixer.render_block();
            let wrote = self.producer.push(block);
            debug_assert_eq!(
                wrote,
                block.len(),
                "space() promised room for a whole block"
            );
            pushed += 1;
        }
        pushed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The ring is what makes the callback cheap, so its accounting has to be exact: what goes
    /// in comes out, in order, and asking for more than it holds is silence rather than stale
    /// samples from the last lap.
    #[test]
    fn the_ring_returns_what_was_written_in_order() {
        let (producer, mut renderer) = ring(8);
        assert_eq!(producer.push(&[1.0, 2.0, 3.0, 4.0]), 4);
        let mut out = [0.0f32; 6];
        assert_eq!(renderer.render(&mut out), 4);
        assert_eq!(out, [1.0, 2.0, 3.0, 4.0, 0.0, 0.0]);
        assert_eq!(renderer.underruns(), 1, "asking for six and getting four");
    }

    /// A full ring accepts a short write rather than overwriting samples nobody has heard yet.
    #[test]
    fn a_full_ring_refuses_the_overflow() {
        let (producer, mut renderer) = ring(4);
        assert_eq!(producer.push(&[1.0, 2.0, 3.0, 4.0, 5.0]), 4);
        let mut out = [0.0f32; 4];
        assert_eq!(renderer.render(&mut out), 4);
        assert_eq!(out, [1.0, 2.0, 3.0, 4.0]);
        // …and the space it frees is reusable, which is the whole point of a ring.
        assert_eq!(producer.push(&[6.0, 7.0]), 2);
        let mut out = [0.0f32; 2];
        renderer.render(&mut out);
        assert_eq!(out, [6.0, 7.0]);
    }

    /// The ring wraps past its capacity without losing a sample or reordering one — the case a
    /// masked index gets wrong if the arithmetic is off by one.
    #[test]
    fn the_ring_wraps_without_losing_a_sample() {
        let (producer, mut renderer) = ring(8);
        let mut expected = 0.0f32;
        let mut out = [0.0f32; 3];
        for _ in 0..20 {
            let batch = [expected, expected + 1.0, expected + 2.0];
            assert_eq!(producer.push(&batch), 3);
            assert_eq!(renderer.render(&mut out), 3);
            assert_eq!(out, batch);
            expected += 3.0;
        }
        assert_eq!(renderer.underruns(), 0);
    }
}
