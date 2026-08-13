//! Finding the parts with nothing in them.
//!
//! The first thing anyone does to a recorded conversation is take the dead air out: the pause
//! before someone answers, the gap while a question is being thought about, the run-up at the
//! head and the tail after the last word. On a six-minute interview it is routinely a fifth of
//! the runtime, and removing it is most of what makes a raw take feel edited.
//!
//! # The threshold is measured, not typed
//!
//! A fixed dBFS threshold is wrong on the next file. A room with air conditioning sits 20 dB
//! above a treated booth, and −40 dB is the noise floor in one and the speech in the other.
//!
//! So the default is derived from the material: the noise floor is the 10th percentile of frame
//! levels, the speech level is the 75th, and anything within [`FLOOR_MARGIN`] of the floor is
//! silence. On a real interview that put the threshold at −45 dB with the floor at −51 and
//! speech at −31 — which is the number a person would have picked, arrived at without picking.
//!
//! # It reports, it does not cut
//!
//! `detect` returns ranges. Deciding what to do with them is an edit: a 0.4 s pause after a
//! question is a beat, and removing every one of them produces the breathless cadence that makes
//! an over-edited podcast exhausting. [`SilenceScan::keep_ranges`] gives the complement for a
//! caller that does want to close every gap, and `minimum` is the knob that keeps the beats.

use crate::AudioPcm;

/// Analysis window. 20 ms is short enough to catch the edge of a word and long enough that one
/// glottal pulse does not read as speech.
const WINDOW_SECONDS: f64 = 0.02;

/// How far above the measured noise floor still counts as silence.
///
/// 6 dB is deliberately conservative — it removes what is unambiguously nothing and leaves
/// anything that might be a breath, a chair, or the start of a word. A tighter number removes
/// more and starts clipping consonants.
const FLOOR_MARGIN: f64 = 6.0;

/// The threshold is clamped into this band however quiet or loud the material is, so a file of
/// pure silence or pure clipping cannot produce a threshold that removes everything or nothing.
const MIN_THRESHOLD_DB: f64 = -60.0;
const MAX_THRESHOLD_DB: f64 = -25.0;

/// One stretch with nothing in it.
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Silence {
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub duration_seconds: f64,
    /// The loudest frame inside it — how close this was to not being silence at all.
    pub peak_db: f64,
}

/// What a scan found.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SilenceScan {
    /// The level used, whether given or derived.
    pub threshold_db: f64,
    /// The 10th percentile of frame levels — the room.
    pub noise_floor_db: f64,
    /// The 75th percentile — what someone talking measures.
    pub speech_db: f64,
    pub silences: Vec<Silence>,
    pub removable_seconds: f64,
    pub duration_seconds: f64,
    /// What fraction of the recording is nothing, 0..1.
    pub removable_share: f64,
}

impl SilenceScan {
    /// The complement: the stretches worth keeping, in order.
    ///
    /// This is what an edit is actually made of — a list of ranges to take from the source and
    /// butt together. Adjacent keeps are already merged, so a caller can trim one clip per range
    /// and be done.
    pub fn keep_ranges(&self) -> Vec<(f64, f64)> {
        let mut keeps = Vec::new();
        let mut at = 0.0;
        for silence in &self.silences {
            if silence.start_seconds > at + 1e-6 {
                keeps.push((at, silence.start_seconds));
            }
            at = silence.end_seconds;
        }
        if at < self.duration_seconds - 1e-6 {
            keeps.push((at, self.duration_seconds));
        }
        keeps
    }

    /// How long the piece would run with every silence closed.
    pub fn tightened_seconds(&self) -> f64 {
        (self.duration_seconds - self.removable_seconds).max(0.0)
    }
}

/// How to look.
#[derive(Debug, Clone, Copy)]
pub struct Options {
    /// Level below which a frame is nothing. `None` derives it from the material.
    pub threshold_db: Option<f64>,
    /// Ignore anything shorter than this. A pause is not dead air.
    pub minimum_seconds: f64,
    /// Leave this much of the silence at each end, so a cut does not clip the breath before a
    /// word or the tail of the one before it.
    pub pad_seconds: f64,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            threshold_db: None,
            // Half a second: below this it is the rhythm of speech, not a gap in it.
            minimum_seconds: 0.5,
            pad_seconds: 0.08,
        }
    }
}

/// Find the stretches with nothing in them.
pub fn detect(pcm: &AudioPcm, options: Options) -> Option<SilenceScan> {
    let sample_rate = pcm.sample_rate as f64;
    if pcm.samples.is_empty() || sample_rate <= 0.0 {
        return None;
    }
    let channels = pcm.channels.max(1) as usize;
    let window = (WINDOW_SECONDS * sample_rate) as usize;
    if window == 0 {
        return None;
    }
    let frames = pcm.samples.len() / channels;
    let duration = frames as f64 / sample_rate;
    let count = frames / window;
    if count < 2 {
        return None;
    }

    let mut levels = Vec::with_capacity(count);
    for f in 0..count {
        let mut sum = 0.0f64;
        for i in 0..window {
            let frame = f * window + i;
            let mut mono = 0.0f32;
            for c in 0..channels {
                mono += pcm.samples[frame * channels + c];
            }
            let mono = (mono / channels as f32) as f64;
            sum += mono * mono;
        }
        levels.push(db(sum / window as f64));
    }

    let noise_floor = percentile(&levels, 10.0);
    let speech = percentile(&levels, 75.0);
    let threshold = options
        .threshold_db
        .unwrap_or((noise_floor + FLOOR_MARGIN).clamp(MIN_THRESHOLD_DB, MAX_THRESHOLD_DB));

    let mut silences = Vec::new();
    let mut run: Option<usize> = None;
    for (i, level) in levels.iter().enumerate() {
        if *level < threshold {
            run.get_or_insert(i);
        } else if let Some(start) = run.take() {
            push_silence(&mut silences, &levels, start, i, options, duration);
        }
    }
    if let Some(start) = run {
        push_silence(
            &mut silences,
            &levels,
            start,
            levels.len(),
            options,
            duration,
        );
    }

    let removable: f64 = silences.iter().map(|s| s.duration_seconds).sum();
    Some(SilenceScan {
        threshold_db: round(threshold),
        noise_floor_db: round(noise_floor),
        speech_db: round(speech),
        silences,
        removable_seconds: round(removable),
        duration_seconds: round(duration),
        removable_share: round(removable / duration.max(1e-9)),
    })
}

fn push_silence(
    out: &mut Vec<Silence>,
    levels: &[f64],
    start: usize,
    end: usize,
    options: Options,
    duration: f64,
) {
    let raw_start = start as f64 * WINDOW_SECONDS;
    let raw_end = (end as f64 * WINDOW_SECONDS).min(duration);
    if raw_end - raw_start < options.minimum_seconds {
        return;
    }
    // Give the padding back to the audio on both sides. A range that is all padding is not worth
    // cutting — it would be a splice with nothing removed.
    let padded_start = raw_start + options.pad_seconds;
    let padded_end = raw_end - options.pad_seconds;
    if padded_end - padded_start < WINDOW_SECONDS {
        return;
    }
    let peak = levels[start..end].iter().copied().fold(f64::MIN, f64::max);
    out.push(Silence {
        start_seconds: round(padded_start),
        end_seconds: round(padded_end),
        duration_seconds: round(padded_end - padded_start),
        peak_db: round(peak),
    });
}

/// Power as dB, floored so digital silence is a number rather than `-inf` — the same rule the
/// loudness module follows, and for the same reason: a non-finite float serialises as `null`.
fn db(power: f64) -> f64 {
    if power <= 1e-12 {
        return -120.0;
    }
    10.0 * power.log10()
}

fn percentile(values: &[f64], p: f64) -> f64 {
    if values.is_empty() {
        return -120.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let index = ((p / 100.0) * (sorted.len() - 1) as f64).round() as usize;
    sorted[index.min(sorted.len() - 1)]
}

fn round(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tone, gap, tone, gap, tone — with a realistic room floor under the whole thing.
    fn speech_and_gaps(sample_rate: u32) -> AudioPcm {
        let mut samples = Vec::new();
        let mut seed = 0x2545_F491_4F6C_DD1Du64;
        let mut noise = || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            ((seed >> 40) as f32 / 8_388_608.0 - 1.0) * 0.002 // about -54 dB
        };
        let push =
            |samples: &mut Vec<f32>, seconds: f64, loud: bool, noise: &mut dyn FnMut() -> f32| {
                let n = (seconds * sample_rate as f64) as usize;
                for i in 0..n {
                    let t = i as f32 / sample_rate as f32;
                    let voice = if loud {
                        (2.0 * std::f32::consts::PI * 180.0 * t).sin() * 0.3
                    } else {
                        0.0
                    };
                    samples.push(voice + noise());
                }
            };
        push(&mut samples, 1.0, true, &mut noise);
        push(&mut samples, 1.5, false, &mut noise);
        push(&mut samples, 1.0, true, &mut noise);
        push(&mut samples, 0.2, false, &mut noise); // too short to count
        push(&mut samples, 1.0, true, &mut noise);
        push(&mut samples, 2.0, false, &mut noise);
        AudioPcm {
            sample_rate,
            channels: 1,
            samples,
        }
    }

    #[test]
    fn it_finds_the_long_gaps_and_ignores_the_short_one() {
        let scan = detect(&speech_and_gaps(16000), Options::default()).expect("a scan");
        // The 1.5 s gap and the 2 s tail. The 0.2 s beat between the second and third phrases
        // is the rhythm of speech and must survive.
        assert_eq!(
            scan.silences.len(),
            2,
            "the 1.5 s gap and the tail, and not the 0.2 s beat: {:?}",
            scan.silences
        );
        let first = scan.silences[0];
        assert!(
            (first.start_seconds - 1.08).abs() < 0.1,
            "first gap starts at {}",
            first.start_seconds
        );
    }

    /// The threshold has to come from the file. This is the whole reason the module exists.
    #[test]
    fn the_threshold_is_derived_between_the_floor_and_the_speech() {
        let scan = detect(&speech_and_gaps(16000), Options::default()).expect("a scan");
        assert!(
            scan.threshold_db > scan.noise_floor_db,
            "threshold {} must sit above the floor {}",
            scan.threshold_db,
            scan.noise_floor_db
        );
        assert!(
            scan.threshold_db < scan.speech_db,
            "threshold {} must sit below speech {}",
            scan.threshold_db,
            scan.speech_db
        );
    }

    /// The same recording 20 dB quieter must produce the same edit — that is what "measured"
    /// buys, and a fixed dBFS threshold fails it outright.
    #[test]
    fn a_quieter_recording_yields_the_same_cuts() {
        let loud = speech_and_gaps(16000);
        let quiet = AudioPcm {
            sample_rate: loud.sample_rate,
            channels: loud.channels,
            samples: loud.samples.iter().map(|s| s * 0.1).collect(),
        };
        let a = detect(&loud, Options::default()).unwrap();
        let b = detect(&quiet, Options::default()).unwrap();
        assert_eq!(a.silences.len(), b.silences.len());
        for (x, y) in a.silences.iter().zip(&b.silences) {
            assert!(
                (x.start_seconds - y.start_seconds).abs() < 0.05,
                "{x:?} vs {y:?}"
            );
        }
    }

    /// Keeps and silences must tile the recording exactly. A gap between them is footage that
    /// would vanish from the edit without anyone asking.
    #[test]
    fn the_keeps_are_the_exact_complement_of_the_silences() {
        let scan = detect(&speech_and_gaps(16000), Options::default()).unwrap();
        let keeps = scan.keep_ranges();
        let kept: f64 = keeps.iter().map(|(a, b)| b - a).sum();
        assert!(
            (kept + scan.removable_seconds - scan.duration_seconds).abs() < 0.05,
            "kept {kept} + removed {} != {}",
            scan.removable_seconds,
            scan.duration_seconds
        );
        for pair in keeps.windows(2) {
            assert!(pair[0].1 <= pair[1].0 + 1e-9, "keeps overlap: {pair:?}");
        }
        assert!(keeps.iter().all(|(a, b)| b > a), "an empty keep range");
    }

    /// `minimum` is the knob that keeps the beats. Raising it must never find *more* gaps.
    #[test]
    fn a_longer_minimum_finds_fewer_gaps() {
        let pcm = speech_and_gaps(16000);
        let loose = detect(
            &pcm,
            Options {
                minimum_seconds: 0.3,
                ..Options::default()
            },
        )
        .unwrap();
        let strict = detect(
            &pcm,
            Options {
                minimum_seconds: 1.8,
                ..Options::default()
            },
        )
        .unwrap();
        assert!(
            strict.silences.len() < loose.silences.len(),
            "{} vs {}",
            strict.silences.len(),
            loose.silences.len()
        );
    }

    /// Padding is what stops a cut clipping the word either side of it.
    #[test]
    fn padding_shrinks_each_range_at_both_ends() {
        let pcm = speech_and_gaps(16000);
        let bare = detect(
            &pcm,
            Options {
                pad_seconds: 0.0,
                ..Options::default()
            },
        )
        .unwrap();
        let padded = detect(
            &pcm,
            Options {
                pad_seconds: 0.2,
                ..Options::default()
            },
        )
        .unwrap();
        assert_eq!(bare.silences.len(), padded.silences.len());
        assert!(padded.silences[0].start_seconds > bare.silences[0].start_seconds);
        assert!(padded.silences[0].end_seconds < bare.silences[0].end_seconds);
        assert!(padded.removable_seconds < bare.removable_seconds);
    }

    /// Silence throughout is a real answer, and so is a recording with no gap in it at all.
    #[test]
    fn the_degenerate_recordings_are_answered() {
        let quiet = AudioPcm {
            sample_rate: 16000,
            channels: 1,
            samples: vec![0.0; 16000 * 3],
        };
        let scan = detect(&quiet, Options::default()).unwrap();
        assert!(scan.removable_share > 0.9, "{:?}", scan.removable_share);

        assert!(
            detect(
                &AudioPcm {
                    sample_rate: 16000,
                    channels: 1,
                    samples: Vec::new()
                },
                Options::default()
            )
            .is_none()
        );
    }

    #[test]
    fn stereo_is_measured_as_the_sum_not_one_channel() {
        let mono = speech_and_gaps(16000);
        let stereo = AudioPcm {
            sample_rate: mono.sample_rate,
            channels: 2,
            samples: mono.samples.iter().flat_map(|s| [*s, *s]).collect(),
        };
        let a = detect(&mono, Options::default()).unwrap();
        let b = detect(&stereo, Options::default()).unwrap();
        assert_eq!(a.silences.len(), b.silences.len());
    }
}
