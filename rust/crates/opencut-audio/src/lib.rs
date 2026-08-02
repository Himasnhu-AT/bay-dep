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
    let output = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin", "-loglevel", "error", "-i", path, "-ac", "2", "-ar",
            &sample_rate.to_string(), "-f", "f32le", "pipe:1",
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

// -- Waveform peak extraction --------------------------------------------------------------

/// Extract `buckets` normalized peak amplitudes from an audio/video file. `None` if ffmpeg is
/// unavailable, the decode fails, or the file has no audio.
pub fn waveform_peaks(path: &str, buckets: usize) -> Option<Vec<f32>> {
    if buckets == 0 {
        return None;
    }
    let output = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", "8000", "-f",
            "s16le", "pipe:1",
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
