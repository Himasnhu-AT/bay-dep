//! Finding the pulse of a track, so a cut can land on it.
//!
//! This exists because three videos were cut to a grid computed by a throwaway Python script —
//! decode with ffmpeg, spectral flux with numpy, autocorrelation, phase by comb filter. That
//! script was 40 lines, it lived in a scratch directory, and every piece that needed a beat grid
//! needed it again. A tempo is a property of an audio file; the editor should be able to answer
//! it.
//!
//! # No FFT
//!
//! The usual onset detector is spectral flux over an FFT. This uses a four-band filterbank of
//! one-pole filters instead, and takes the positive change in log energy per band. It is less
//! precise than an FFT on ambiguous material and entirely adequate on anything with a pulse,
//! which is what a music bed is — and it keeps a numeric dependency out of the workspace for a
//! feature that is ultimately advisory.
//!
//! # What it will and will not tell you
//!
//! It returns a tempo, a phase and a **confidence**. Confidence is the autocorrelation at the
//! winning lag: near 1 the track has an unmistakable pulse, near 0 it does not have one at all
//! and the grid is arithmetic rather than music. Rubato, live playing and ambient beds all land
//! low, and the honest response to a low number is to place cuts by hand rather than to trust
//! four decimal places.

use crate::AudioPcm;

/// The slowest and fastest we will call a tempo. Outside this a detector locks onto half or
/// double time and reports it with total confidence.
const MIN_BPM: f64 = 60.0;
const MAX_BPM: f64 = 180.0;

/// Frames per second of the onset envelope. 172 Hz at 44.1 kHz — fine enough to place a beat
/// well inside a video frame at 30 fps, coarse enough that autocorrelation stays cheap.
const HOP: usize = 256;

/// What a track's pulse looks like.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Beats {
    pub bpm: f64,
    /// Seconds per beat.
    pub beat_seconds: f64,
    /// Where the grid starts — the first beat, not zero.
    pub first_beat_seconds: f64,
    /// Autocorrelation at the winning lag, 0..1. Below ~0.2 there is no usable pulse.
    pub confidence: f64,
    /// Every beat, in seconds, to the end of the audio.
    pub beat_times: Vec<f64>,
    pub duration_seconds: f64,
    /// The other tempos that nearly won, best first, with octaves of each other collapsed.
    ///
    /// A single number hides how close the call was. On real music the top two are often within
    /// a couple of BPM and differ by half a second of drift across a minute — which is visible
    /// when the last cut is supposed to land on the last beat. Look here before trusting `bpm`,
    /// and pass an explicit tempo if you disagree.
    pub candidates: Vec<Candidate>,
}

/// One plausible reading of the tempo.
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub bpm: f64,
    pub confidence: f64,
}

impl Beats {
    /// Whether the pulse is strong enough to cut to.
    ///
    /// The threshold is deliberately low: a value of 0.2 already means the envelope repeats
    /// visibly at that period. What it excludes is speech and ambience, where the winning lag is
    /// noise and the grid would be a fiction.
    pub fn is_usable(&self) -> bool {
        self.confidence >= 0.2
    }

    /// The beat grid thinned to every `n`th beat — the cut rate, rather than the pulse.
    pub fn every(&self, n: usize) -> Vec<f64> {
        if n == 0 {
            return Vec::new();
        }
        self.beat_times.iter().copied().step_by(n).collect()
    }
}

/// Detect the pulse of already-decoded audio.
pub fn detect(pcm: &AudioPcm) -> Option<Beats> {
    let sample_rate = pcm.sample_rate as f64;
    if pcm.samples.is_empty() || sample_rate <= 0.0 {
        return None;
    }
    let mono = downmix(pcm);
    let duration = mono.len() as f64 / sample_rate;
    let envelope = onset_envelope(&mono, sample_rate);
    // Two seconds of envelope is the least that can show a repeat at 60 BPM.
    if envelope.len() < 64 {
        return None;
    }

    let fps = sample_rate / HOP as f64;
    let (bpm, confidence) = best_tempo(&envelope, fps)?;
    let candidates = rival_tempos(&envelope, fps, bpm);
    let period = 60.0 / bpm * fps;
    let offset = best_phase(&envelope, period);

    let first = offset / fps;
    let beat_seconds = 60.0 / bpm;
    let mut beat_times = Vec::new();
    let mut at = first;
    while at < duration {
        beat_times.push((at * 1000.0).round() / 1000.0);
        at += beat_seconds;
    }

    Some(Beats {
        bpm: (bpm * 100.0).round() / 100.0,
        beat_seconds: (beat_seconds * 100000.0).round() / 100000.0,
        first_beat_seconds: (first * 1000.0).round() / 1000.0,
        confidence: (confidence * 10000.0).round() / 10000.0,
        beat_times,
        duration_seconds: (duration * 1000.0).round() / 1000.0,
        candidates,
    })
}

/// Decode and detect in one step. `None` when ffmpeg cannot read the file.
pub fn detect_file(path: &str) -> Option<Beats> {
    detect(&crate::decode_pcm(path, 44100)?)
}

fn downmix(pcm: &AudioPcm) -> Vec<f32> {
    let channels = pcm.channels.max(1) as usize;
    if channels == 1 {
        return pcm.samples.clone();
    }
    pcm.samples
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

/// Positive change in log energy, summed over four bands.
///
/// Bands rather than the whole signal because a kick and a hi-hat land at different times and a
/// broadband energy measure lets the loudest one hide the other. Log rather than linear because
/// a snare in a quiet bar and a snare in a loud one are the same event.
fn onset_envelope(mono: &[f32], sample_rate: f64) -> Vec<f32> {
    // One-pole lowpass corners. The bands are the differences between successive lowpasses,
    // which is crude but costs four multiplies a sample.
    let corners = [120.0, 800.0, 3000.0];
    let mut coefficients = [0.0f32; 3];
    for (i, corner) in corners.iter().enumerate() {
        let x = (-2.0 * std::f64::consts::PI * corner / sample_rate).exp();
        coefficients[i] = x as f32;
    }

    let frames = mono.len() / HOP;
    let mut energies = vec![[0.0f64; 4]; frames];
    // Three lowpasses of the *same* input at rising corners. The bands are the differences
    // between them, taken in the order low-to-high — subtracting the other way round gives
    // negative bands and an envelope with no relation to the music, which is what the first
    // version of this did.
    let mut state = [0.0f32; 3];
    for (f, energy) in energies.iter_mut().enumerate() {
        for &sample in &mono[f * HOP..(f + 1) * HOP] {
            for band in 0..3 {
                state[band] =
                    coefficients[band] * state[band] + (1.0 - coefficients[band]) * sample;
            }
            let bands = [
                state[0],            // below 120 Hz — the kick
                state[1] - state[0], // 120-800
                state[2] - state[1], // 800-3000
                sample - state[2],   // above 3000 — the hats
            ];
            for (slot, value) in energy.iter_mut().zip(bands) {
                *slot += (value as f64) * (value as f64);
            }
        }
    }

    let mut envelope = Vec::with_capacity(frames.saturating_sub(1));
    for pair in energies.windows(2) {
        let flux: f64 = pair[1]
            .iter()
            .zip(pair[0])
            .map(|(now, before)| ((now + 1e-12).ln() - (before + 1e-12).ln()).max(0.0))
            .sum();
        envelope.push(flux as f32);
    }
    normalise(envelope)
}

/// Zero mean, unit variance. Autocorrelation of a signal with a DC offset finds the offset.
fn normalise(mut values: Vec<f32>) -> Vec<f32> {
    if values.is_empty() {
        return values;
    }
    let mean = values.iter().map(|v| *v as f64).sum::<f64>() / values.len() as f64;
    let variance = values
        .iter()
        .map(|v| (*v as f64 - mean).powi(2))
        .sum::<f64>()
        / values.len() as f64;
    let sd = variance.sqrt().max(1e-9);
    for value in &mut values {
        *value = ((*value as f64 - mean) / sd) as f32;
    }
    values
}

/// The lag whose autocorrelation is highest, searched in tempo rather than in samples.
///
/// Two corrections, and without either the detector reports half time with total confidence —
/// which it did, calling a 138 BPM track 68.5:
///
/// - **A tempo prior.** Autocorrelation is just as happy at 2× and ½× the true period, so the
///   raw peak is an octave lottery. Scores are weighted by a log-normal centred on 120 BPM,
///   which is the standard fix and encodes the fact that most music people cut to is nearer 120
///   than 60 or 180.
/// - **An octave check.** After picking, if double the winning tempo is still in range and
///   scores nearly as well, take the double. A pulse that repeats every beat also repeats every
///   two beats; the faster reading is the one that is actually the beat.
fn best_tempo(envelope: &[f32], fps: f64) -> Option<(f64, f64)> {
    let score_at = |bpm: f64| -> Option<f64> {
        let lag = 60.0 / bpm * fps;
        (lag >= 2.0 && lag < envelope.len() as f64 / 2.0).then(|| autocorrelation(envelope, lag))
    };
    // exp(-½(ln(bpm/120)/0.9)²) — flat enough not to override a clear answer, steep enough to
    // break the tie between a tempo and its own half.
    let prior = |bpm: f64| (-0.5 * ((bpm / 120.0).ln() / 0.9).powi(2)).exp();

    let mut best: Option<(f64, f64)> = None;
    let mut bpm = MIN_BPM;
    while bpm <= MAX_BPM {
        if let Some(score) = score_at(bpm) {
            let weighted = score * prior(bpm);
            if best.is_none_or(|(_, b)| weighted > b) {
                best = Some((bpm, weighted));
            }
        }
        bpm += 0.25;
    }
    let (mut chosen, _) = best?;

    let mut raw = score_at(chosen)?;
    let doubled = chosen * 2.0;
    if doubled <= MAX_BPM
        && let Some(faster) = score_at(doubled)
        && faster >= raw * 0.85
    {
        chosen = doubled;
        raw = faster;
    }
    Some((chosen, raw.clamp(0.0, 1.0)))
}

/// The tempos worth showing beside the winner.
///
/// Local maxima of the raw correlation, with anything within 2 BPM of an already-listed tempo
/// dropped so the list is five distinct readings rather than five samples of one peak.
fn rival_tempos(envelope: &[f32], fps: f64, winner: f64) -> Vec<Candidate> {
    let mut scored: Vec<Candidate> = Vec::new();
    let mut bpm = MIN_BPM;
    while bpm <= MAX_BPM {
        let lag = 60.0 / bpm * fps;
        if lag >= 2.0 && lag < envelope.len() as f64 / 2.0 {
            scored.push(Candidate {
                bpm,
                confidence: (autocorrelation(envelope, lag).clamp(0.0, 1.0) * 10000.0).round()
                    / 10000.0,
            });
        }
        bpm += 0.25;
    }
    scored.sort_by(|a, b| b.confidence.total_cmp(&a.confidence));
    let mut kept: Vec<Candidate> = Vec::new();
    for candidate in scored {
        if kept.len() >= 5 {
            break;
        }
        let near_winner = (candidate.bpm - winner).abs() < 2.0 && !kept.is_empty();
        if near_winner || kept.iter().any(|k| (k.bpm - candidate.bpm).abs() < 2.0) {
            continue;
        }
        kept.push(candidate);
    }
    kept
}

/// Normalised autocorrelation at a **fractional** lag, bounded to −1..1.
///
/// Two things here, and the detector was wrong without either:
///
/// - **Fractional lag, interpolated.** 138 BPM is 37.45 envelope frames, not 37. Rounding the lag
///   to an integer misaligns every click a little, and the misalignment happens to cancel at
///   *twice* the period — so the honest peak is at half time. Interpolating between samples is
///   what lets a tempo that is not a whole number of frames win.
/// - **Normalised by segment energy**, not by overlap length. Dividing by the overlap alone
///   rewards long lags: fewer terms, noisier mean, higher peaks — another push towards half time.
fn autocorrelation(values: &[f32], lag: f64) -> f64 {
    let whole = lag.floor();
    if whole < 0.0 || whole as usize + 1 >= values.len() {
        return 0.0;
    }
    let base = whole as usize;
    let frac = lag - whole;
    let n = values.len() - base - 1;
    let (mut dot, mut left, mut right) = (0.0f64, 0.0f64, 0.0f64);
    for i in 0..n {
        let a = values[i] as f64;
        let b = values[i + base] as f64 * (1.0 - frac) + values[i + base + 1] as f64 * frac;
        dot += a * b;
        left += a * a;
        right += b * b;
    }
    let scale = (left * right).sqrt();
    if scale <= f64::EPSILON {
        return 0.0;
    }
    dot / scale
}

/// Which offset within one period puts the most onset energy on the beat.
fn best_phase(envelope: &[f32], period: f64) -> f64 {
    let whole = period.round().max(1.0) as usize;
    let mut best = (0.0f64, f64::NEG_INFINITY);
    for offset in 0..whole {
        let mut sum = 0.0;
        let mut at = offset as f64;
        while at < envelope.len() as f64 {
            sum += envelope[at as usize] as f64;
            at += period;
        }
        if sum > best.1 {
            best = (offset as f64, sum);
        }
    }
    best.0
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A click train at a known tempo, with a little noise so the detector is not being handed a
    /// perfectly silent background it will never see.
    fn click_track(bpm: f64, seconds: f64, sample_rate: u32) -> AudioPcm {
        let n = (seconds * sample_rate as f64) as usize;
        let period = 60.0 / bpm * sample_rate as f64;
        let mut samples = vec![0.0f32; n];
        // A deterministic pseudo-noise floor — no rand dependency, and the same every run.
        let mut seed = 0x2545_F491_4F6C_DD1Du64;
        for (i, sample) in samples.iter_mut().enumerate() {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            *sample = ((seed >> 40) as f32 / 8_388_608.0 - 1.0) * 0.02;
            let since = (i as f64 % period) / sample_rate as f64;
            if since < 0.02 {
                // A short decaying thump, which is what a kick looks like to the filterbank.
                let t = since as f32;
                *sample += (-60.0 * t).exp() * (2.0 * std::f32::consts::PI * 70.0 * t).sin() * 0.8;
            }
        }
        AudioPcm {
            sample_rate,
            channels: 1,
            samples,
        }
    }

    #[test]
    fn a_click_track_reports_its_own_tempo() {
        for wanted in [90.0, 120.0, 138.0] {
            let beats = detect(&click_track(wanted, 20.0, 44100)).expect("a pulse");
            assert!(
                (beats.bpm - wanted).abs() < 1.5,
                "wanted {wanted} BPM, got {} (confidence {})",
                beats.bpm,
                beats.confidence
            );
            assert!(
                beats.is_usable(),
                "a click track must be usable, got confidence {}",
                beats.confidence
            );
        }
    }

    /// The grid has to be dense enough to cut against, and land inside the audio.
    #[test]
    fn the_grid_covers_the_track_at_the_reported_spacing() {
        let beats = detect(&click_track(120.0, 20.0, 44100)).expect("a pulse");
        assert!((beats.beat_seconds - 0.5).abs() < 0.02);
        assert!(beats.beat_times.len() > 35, "{}", beats.beat_times.len());
        assert!(*beats.beat_times.last().unwrap() <= beats.duration_seconds);
        let gaps: Vec<f64> = beats
            .beat_times
            .windows(2)
            .map(|pair| pair[1] - pair[0])
            .collect();
        for gap in gaps {
            assert!((gap - beats.beat_seconds).abs() < 0.002, "uneven gap {gap}");
        }
    }

    /// The phase must land on the clicks, not between them. A grid at the right tempo and the
    /// wrong phase cuts exactly off the beat, which is worse than not cutting to it at all.
    #[test]
    fn the_first_beat_lands_on_a_click_not_between_them() {
        let beats = detect(&click_track(120.0, 20.0, 44100)).expect("a pulse");
        let into_period = beats.first_beat_seconds % beats.beat_seconds;
        let error = into_period.min(beats.beat_seconds - into_period);
        assert!(
            error < 0.06,
            "phase is {error:.3}s off the click (first beat {})",
            beats.first_beat_seconds
        );
    }

    /// Noise has no pulse, and the honest answer is a low confidence rather than a confident
    /// wrong number. This is the check that stops a grid being invented for an ambient bed.
    #[test]
    fn noise_reports_a_low_confidence() {
        let n = 44100 * 10;
        let mut seed = 0x9E37_79B9_7F4A_7C15u64;
        let samples = (0..n)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 7;
                seed ^= seed << 17;
                (seed >> 40) as f32 / 8_388_608.0 - 1.0
            })
            .collect();
        let beats = detect(&AudioPcm {
            sample_rate: 44100,
            channels: 1,
            samples,
        })
        .expect("an answer");
        assert!(
            !beats.is_usable(),
            "white noise must not report a usable pulse, got {}",
            beats.confidence
        );
    }

    #[test]
    fn silence_and_emptiness_are_answered_rather_than_panicking() {
        assert!(
            detect(&AudioPcm {
                sample_rate: 44100,
                channels: 2,
                samples: Vec::new(),
            })
            .is_none()
        );
        let quiet = detect(&AudioPcm {
            sample_rate: 44100,
            channels: 1,
            samples: vec![0.0; 44100 * 5],
        });
        assert!(quiet.is_none_or(|b| !b.is_usable()));
    }

    #[test]
    fn every_nth_beat_is_the_cut_rate() {
        let beats = detect(&click_track(120.0, 20.0, 44100)).expect("a pulse");
        let cuts = beats.every(3);
        assert!((cuts[1] - cuts[0] - beats.beat_seconds * 3.0).abs() < 0.002);
        assert!(beats.every(0).is_empty());
    }

    /// Stereo must reduce to the same answer as mono; a track is not a different tempo in one ear.
    #[test]
    fn stereo_and_mono_agree() {
        let mono = click_track(138.0, 16.0, 44100);
        let stereo = AudioPcm {
            sample_rate: mono.sample_rate,
            channels: 2,
            samples: mono.samples.iter().flat_map(|s| [*s, *s]).collect(),
        };
        let a = detect(&mono).expect("mono");
        let b = detect(&stereo).expect("stereo");
        assert!((a.bpm - b.bpm).abs() < 0.5, "{} vs {}", a.bpm, b.bpm);
    }
}
