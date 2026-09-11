//! Audio decode + analysis via the ffmpeg CLI sidecar: waveform peaks for display, and full
//! interleaved f32 PCM for playback.

pub mod beats;
pub mod library;
pub mod loudness;
pub mod sfx;
pub mod silence;
pub mod stream;
pub mod wav;

/// Decoded interleaved PCM samples ready for playback.
///
/// `Debug` prints the *shape* rather than the samples: a decoded bed is tens of millions of
/// floats, and a `{:?}` that dumped them turns one failing assertion into an unreadable test
/// log.
pub struct AudioPcm {
    pub sample_rate: u32,
    pub channels: u16,
    /// Interleaved f32 samples (`channels` per frame).
    pub samples: Vec<f32>,
}

/// Decode a file to interleaved stereo f32 PCM at `sample_rate` via the ffmpeg CLI. `None` if
/// ffmpeg is unavailable, decode fails, or there is no audio.
pub fn decode_pcm(path: &str, sample_rate: u32) -> Option<AudioPcm> {
    let output = bay_paths::tools::command(bay_paths::tools::Tool::Ffmpeg)
        .ok()?
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-i",
            path,
            "-ac",
            "2",
            "-ar",
            &sample_rate.to_string(),
            "-f",
            "f32le",
            "pipe:1",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let samples: Vec<f32> = output
        .stdout
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    if samples.is_empty() {
        return None;
    }
    Some(AudioPcm {
        sample_rate,
        channels: 2,
        samples,
    })
}

impl std::fmt::Debug for AudioPcm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AudioPcm")
            .field("sample_rate", &self.sample_rate)
            .field("channels", &self.channels)
            .field(
                "frames",
                &(self.samples.len() / self.channels.max(1) as usize),
            )
            .finish()
    }
}

// -- Mixing --------------------------------------------------------------------------------

/// One clip's contribution to a mix: where to read from the source, where to place it on the
/// output timeline, how long it plays, and its gain.
pub struct MixClip<'a> {
    pub pcm: &'a AudioPcm,
    /// Seconds into `pcm` at which playback of this clip begins.
    pub src_start_secs: f64,
    /// Seconds into the output buffer at which this clip's audio is placed.
    pub dst_start_secs: f64,
    /// How many seconds of this clip to play.
    pub play_secs: f64,
    /// Linear gain applied to this clip's samples. Ignored when `envelope` is set.
    pub volume: f32,
    /// A level that moves over the clip — fades, or keyframed volume. Sampled per output
    /// frame, so a fade is a real ramp rather than a step at the clip boundary.
    ///
    /// `None` is a flat `volume`, which is what every caller wanted before ducking existed.
    pub envelope: Option<GainEnvelope>,
}

/// A gain curve read against a clip's *own* timeline.
///
/// Sampled by the mixer rather than baked in by the caller because playback can start in the
/// middle of a clip: the fade at 2s into a bed has to be the same whether the transport
/// started at 0s or at 1.9s.
#[derive(Debug, Clone, PartialEq)]
pub struct GainEnvelope {
    /// Seconds from the clip's own start at which this mix window begins.
    pub clip_offset_secs: f64,
    /// Level at each of these offsets into the clip, in order. One point is a constant.
    pub points: Vec<(f64, f32)>,
}

impl GainEnvelope {
    /// Level at `seconds` into the clip, linearly interpolated, clamped to the end values
    /// outside the range the points cover.
    pub fn gain_at(&self, seconds: f64) -> f32 {
        match self.points.as_slice() {
            [] => 1.0,
            [(_, only)] => *only,
            points => {
                if seconds <= points[0].0 {
                    return points[0].1;
                }
                let last = points[points.len() - 1];
                if seconds >= last.0 {
                    return last.1;
                }
                for pair in points.windows(2) {
                    let ((ta, va), (tb, vb)) = (pair[0], pair[1]);
                    if seconds >= ta && seconds <= tb {
                        if tb <= ta {
                            return vb;
                        }
                        let fraction = ((seconds - ta) / (tb - ta)) as f32;
                        return va + (vb - va) * fraction;
                    }
                }
                last.1
            }
        }
    }
}

/// Mix `clips` into one interleaved **stereo** buffer of `total_secs` at `sample_rate`. Overlapping
/// samples are summed and the result soft-clamped to [-1, 1]; mono sources feed both channels.
/// Pure and allocation-only — no IO — so mixing is unit-tested without an audio device.
pub fn mix_stereo(clips: &[MixClip], sample_rate: u32, total_secs: f64) -> Vec<f32> {
    let rate = sample_rate as f64;
    let out_frames = (total_secs.max(0.0) * rate).ceil() as usize;
    let mut out = vec![0.0f32; out_frames * 2];

    for clip in clips {
        accumulate_clip(
            &mut out,
            clip,
            MixWindow::of(clip, sample_rate),
            CENTRE,
            sample_rate,
        );
    }

    for sample in &mut out {
        *sample = sample.clamp(-1.0, 1.0);
    }
    out
}

/// Per-channel gains that leave a clip exactly where it was: unity on both sides.
pub const CENTRE: [f32; 2] = [1.0, 1.0];

/// Which frames of the source land at which frames of the output.
///
/// Split out from [`MixClip`] because the two callers know it to different precision.
/// [`mix_stereo`] mixes a whole timeline in one pass and derives the window from the clip's
/// seconds. The streaming mixer cuts that timeline into blocks and knows the answer in *frames*
/// — and going through seconds there is wrong: a clip 600 frames long, cut at frame 512, has a
/// remainder that computes to 88.00000000000001 frames, and a `ceil` turns that into 89. The
/// clip then sounds for one frame longer than it exists, which is a click at every block
/// boundary a clip happens to end in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MixWindow {
    pub src_start_frame: usize,
    pub dst_start_frame: usize,
    pub play_frames: usize,
}

impl MixWindow {
    /// The window described by a clip's seconds, rounded the way [`mix_stereo`] has always
    /// rounded them.
    pub fn of(clip: &MixClip, sample_rate: u32) -> Self {
        let rate = sample_rate.max(1) as f64;
        Self {
            src_start_frame: (clip.src_start_secs.max(0.0) * rate).floor() as usize,
            dst_start_frame: (clip.dst_start_secs.max(0.0) * rate).floor() as usize,
            play_frames: (clip.play_secs.max(0.0) * rate).ceil() as usize,
        }
    }
}

/// Sum one clip's samples into an interleaved stereo buffer, scaled by its level envelope and
/// by a fixed per-channel gain.
///
/// **The single summing loop.** [`mix_stereo`] is this called once per clip with [`CENTRE`],
/// and the streaming block mixer is this called once per clip per block with the clip's pan
/// gains. Writing a second loop for the block engine is how a preview and a bounce come to
/// disagree about a fade by one sample, so there is only one.
///
/// `out` is interleaved L,R and must have an even length; anything that would land outside it
/// is dropped rather than wrapped. Pure and allocation-free: safe to call from a mix worker,
/// and testable with no device.
pub fn accumulate_clip(
    out: &mut [f32],
    clip: &MixClip,
    window: MixWindow,
    channel_gains: [f32; 2],
    sample_rate: u32,
) {
    let rate = sample_rate.max(1) as f64;
    let out_frames = out.len() / 2;
    let channels = clip.pcm.channels.max(1) as usize;
    let src_frames = clip.pcm.samples.len() / channels;
    let MixWindow {
        src_start_frame: src_start,
        dst_start_frame: dst_start,
        play_frames,
    } = window;

    for f in 0..play_frames {
        let src_frame = src_start + f;
        let dst_frame = dst_start + f;
        if src_frame >= src_frames || dst_frame >= out_frames {
            break;
        }
        let base = src_frame * channels;
        let left = clip.pcm.samples[base];
        // Duplicate a mono source; otherwise take the real second channel.
        let right = if channels >= 2 {
            clip.pcm.samples[base + 1]
        } else {
            left
        };
        let gain = match &clip.envelope {
            Some(envelope) => envelope.gain_at(envelope.clip_offset_secs + f as f64 / rate),
            None => clip.volume,
        };
        out[dst_frame * 2] += left * gain * channel_gains[0];
        out[dst_frame * 2 + 1] += right * gain * channel_gains[1];
    }
}

// -- Pan -----------------------------------------------------------------------------------

/// Per-channel gains for a pan position: `-1.0` hard left, `0.0` centre, `1.0` hard right.
///
/// **The one pan law in bay.** The streaming block mixer multiplies by these; the export
/// filtergraph writes the same two numbers into an ffmpeg `pan=stereo|c0=…|c1=…`. A capability
/// that exists in only one of those is audible in the room and absent from the file, or the
/// reverse, and nobody finds out until the export is posted.
///
/// It is a **balance**, not a constant-power pan. Constant power puts centre at −3 dB, so
/// adopting it would have quietened every clip in every project already saved; normalising it
/// to unity at centre instead pushes a hard-panned clip 3 dB *up*, which clips a mix that was
/// mastered to the ceiling. So the near channel is left alone and the far one is attenuated
/// linearly: centre is `[1, 1]`, hard left is `[1, 0]`, and no pan setting ever adds gain.
///
/// Non-finite input is centre — a NaN reaching the mixer would silence the output, and the
/// render path is not allowed to be destroyed by bad input.
pub fn pan_gains(pan: f32) -> [f32; 2] {
    if !pan.is_finite() {
        return CENTRE;
    }
    let pan = pan.clamp(-1.0, 1.0);
    [
        if pan <= 0.0 { 1.0 } else { 1.0 - pan },
        if pan >= 0.0 { 1.0 } else { 1.0 + pan },
    ]
}

/// Compose two pan stages — a clip's own pan and the pan of the lane it sits on.
///
/// **Clip first, then track**, multiplied per channel: each is a gain stage, and gain stages
/// multiply. So a hard-left clip on a hard-right lane is silent, which is what two independent
/// balance controls in series do, and a centred stage is exactly a no-op at every position of
/// the other. Summing the two positions instead would make that pair read as *centred*, which
/// is a different and much stranger claim.
pub fn composed_pan_gains(clip_pan: f32, track_pan: f32) -> [f32; 2] {
    let clip = pan_gains(clip_pan);
    let track = pan_gains(track_pan);
    [clip[0] * track[0], clip[1] * track[1]]
}

// -- Waveform peak extraction --------------------------------------------------------------

/// Extract `buckets` normalized peak amplitudes from an audio/video file. `None` if ffmpeg is
/// unavailable, the decode fails, or the file has no audio.
pub fn waveform_peaks(path: &str, buckets: usize) -> Option<Vec<f32>> {
    if buckets == 0 {
        return None;
    }
    let output = bay_paths::tools::command(bay_paths::tools::Tool::Ffmpeg)
        .ok()?
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-i",
            path,
            "-ac",
            "1",
            "-ar",
            "8000",
            "-f",
            "s16le",
            "pipe:1",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let samples: Vec<i16> = output
        .stdout
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]))
        .collect();
    if samples.is_empty() {
        return None;
    }

    let per_bucket = samples.len().div_ceil(buckets).max(1);
    let peaks = (0..buckets)
        .map(|bucket| {
            let start = (bucket * per_bucket).min(samples.len());
            let end = ((bucket + 1) * per_bucket).min(samples.len());
            samples[start..end]
                .iter()
                .map(|s| (*s as f32).abs())
                .fold(0.0_f32, f32::max)
                / 32768.0
        })
        .collect();
    Some(peaks)
}
