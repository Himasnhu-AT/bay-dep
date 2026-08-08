//! Audio decode + analysis via the ffmpeg CLI sidecar: waveform peaks for display, and full
//! interleaved f32 PCM for playback.

/// Decoded interleaved PCM samples ready for playback.
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
    /// Linear gain applied to this clip's samples.
    pub volume: f32,
}

/// Mix `clips` into one interleaved **stereo** buffer of `total_secs` at `sample_rate`. Overlapping
/// samples are summed and the result soft-clamped to [-1, 1]; mono sources feed both channels.
/// Pure and allocation-only — no IO — so mixing is unit-tested without an audio device.
pub fn mix_stereo(clips: &[MixClip], sample_rate: u32, total_secs: f64) -> Vec<f32> {
    let rate = sample_rate as f64;
    let out_frames = (total_secs.max(0.0) * rate).ceil() as usize;
    let mut out = vec![0.0f32; out_frames * 2];

    for clip in clips {
        let channels = clip.pcm.channels.max(1) as usize;
        let src_frames = clip.pcm.samples.len() / channels;
        let src_start = (clip.src_start_secs.max(0.0) * rate).floor() as usize;
        let dst_start = (clip.dst_start_secs.max(0.0) * rate).floor() as usize;
        let play_frames = (clip.play_secs.max(0.0) * rate).ceil() as usize;

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
            out[dst_frame * 2] += left * clip.volume;
            out[dst_frame * 2 + 1] += right * clip.volume;
        }
    }

    for sample in &mut out {
        *sample = sample.clamp(-1.0, 1.0);
    }
    out
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
