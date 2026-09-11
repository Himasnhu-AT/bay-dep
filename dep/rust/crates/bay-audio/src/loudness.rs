//! EBU R128 loudness, measured on samples bay already holds.
//!
//! # Why this exists next to the ffmpeg probe
//!
//! Every level bay reasons about is in LUFS, because a `volume` multiplier says nothing about
//! how loud a clip will be. That measurement normally comes from ffmpeg
//! (`bay_preview::probe::probe_loudness`), which is right for a file somebody imported: it has
//! to be decoded anyway.
//!
//! A **synthesised** sound is different. `sfx_add` renders its PCM here, in this process, and
//! then writes it out — so asking ffmpeg to decode the file bay just encoded, to recover numbers
//! bay could compute from the samples in its hand, would cost a subprocess and a decode, and
//! would silently produce *nothing* on a machine with no ffmpeg. That mattered: an audio asset
//! with no loudness makes the whole mix envelope unmeasurable ([`bay_project::mix`]), so one
//! unmeasured click turned the mix gate off for the entire project.
//!
//! # Why it is R128 and not "loud enough"
//!
//! The number has to be comparable with the ffmpeg-measured ones, since the mix compares a bed
//! against a voice against an effect in one unit. So this is BS.1770-4 as ffmpeg's `ebur128`
//! implements it — K-weighting, 400 ms blocks on a 100 ms hop, absolute gate at −70 LUFS and a
//! relative gate 10 LU under the ungated mean — and `rms_db`/`peak_db` are what `volumedetect`
//! reports (mean square in dBFS, and sample peak). `tests/loudness.rs` measures the same file
//! both ways and holds them to a tenth of a LU.
//!
//! **A sound shorter than one 400 ms block has no integrated loudness at all**, and this says so
//! by reporting [`R128_FLOOR_LUFS`] rather than inventing one — exactly what ffmpeg does with
//! bay's 45 ms `tick`. That is not a hole: [`bay_project::AssetLoudness::level_lufs`] falls back
//! to the mean for precisely this case, so a click that peaks at −1 dBFS is still placed in the
//! mix at the level it will be heard at.

use crate::AudioPcm;

/// The lowest level this will report, in dB. Digital silence has no level, and `-inf` is not a
/// number that can survive a round trip through the project file — `serde_json` writes a
/// non-finite float as `null`, which then fails to load as an `f32`. So silence is floored here
/// rather than producing a project that cannot be reopened.
pub const FLOOR_DB: f32 = -120.0;

/// What R128 reports for a signal that never crosses its gate — because it is quiet, or because
/// it is shorter than one 400 ms gating block. The same value ffmpeg prints, and the one
/// [`bay_project::AssetLoudness::FLOOR_LUFS`] tests for.
pub const R128_FLOOR_LUFS: f32 = -70.0;

/// R128's block length and hop.
const BLOCK_SECONDS: f64 = 0.4;
const HOP_SECONDS: f64 = 0.1;

/// The gates: blocks below this absolutely, and blocks this far under the ungated mean, are
/// excluded from the integrated measurement.
const ABSOLUTE_GATE_LUFS: f64 = -70.0;
const RELATIVE_GATE_LU: f64 = 10.0;

/// BS.1770's calibration constant, which is what puts a K-weighted mean square on the LUFS
/// scale.
pub(crate) const OFFSET_LU: f64 = -0.691;

/// What a signal measures, independent of any gain a timeline later applies to it.
///
/// Deliberately *not* `bay_project::AssetLoudness`: this crate is the DSP, and knowing what a
/// project file looks like is not its job. The caller that owns both converts.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Loudness {
    /// Sample peak in dBFS. `0.0` is full scale.
    pub peak_db: f32,
    /// Mean square in dBFS — what `volumedetect` calls `mean_volume`.
    pub rms_db: f32,
    /// EBU R128 integrated loudness in LUFS, or [`R128_FLOOR_LUFS`] when nothing crossed the
    /// gate.
    pub lufs: f32,
}

impl Loudness {
    /// Whether R128 found a level at all. False means "too short or too quiet to integrate",
    /// never "silent" — see the module docs.
    pub fn is_audible(&self) -> bool {
        self.lufs > R128_FLOOR_LUFS
    }
}

/// Measure interleaved PCM.
///
/// Pure and allocation-only: no ffmpeg, no IO, no device. Channels are weighted the way
/// BS.1770 weights the front three (1.0); a mono file therefore measures 3 LU under the same
/// signal delivered as dual mono, which is exactly what ffmpeg reports for the same file and is
/// what keeps the two paths comparable.
pub fn measure(pcm: &AudioPcm) -> Loudness {
    let channels = pcm.channels.max(1) as usize;
    let rate = pcm.sample_rate.max(1) as f64;

    let peak = pcm
        .samples
        .iter()
        .filter(|sample| sample.is_finite())
        .fold(0.0f32, |worst, sample| worst.max(sample.abs()));
    let mean_square = if pcm.samples.is_empty() {
        0.0
    } else {
        pcm.samples
            .iter()
            .map(|sample| {
                let value = f64::from(*sample);
                if value.is_finite() {
                    value * value
                } else {
                    0.0
                }
            })
            .sum::<f64>()
            / pcm.samples.len() as f64
    };

    Loudness {
        peak_db: to_db(f64::from(peak) * f64::from(peak)),
        rms_db: to_db(mean_square),
        lufs: integrated(&pcm.samples, channels, rate)
            .map(|level| level as f32)
            .unwrap_or(R128_FLOOR_LUFS)
            .max(R128_FLOOR_LUFS),
    }
}

/// Power (a mean square, or a squared peak) as dB, floored so silence is a number.
pub(crate) fn to_db(power: f64) -> f32 {
    if !power.is_finite() || power <= 0.0 {
        return FLOOR_DB;
    }
    ((10.0 * power.log10()) as f32).max(FLOOR_DB)
}

/// The gated integrated loudness, or `None` when not one block crossed the absolute gate —
/// which includes every signal shorter than [`BLOCK_SECONDS`].
fn integrated(samples: &[f32], channels: usize, rate: f64) -> Option<f64> {
    let frames = samples.len() / channels;
    let block = (BLOCK_SECONDS * rate).round() as usize;
    let hop = (HOP_SECONDS * rate).round() as usize;
    if frames < block || block == 0 || hop == 0 {
        return None;
    }

    // K-weight each channel once, then read blocks off the filtered signal. Filtering per block
    // would restart the filter's memory 4× per block and colour every one of them.
    let mut weighted: Vec<Vec<f64>> = Vec::with_capacity(channels);
    for channel in 0..channels {
        let mut shelf = Biquad::high_shelf(rate);
        let mut high_pass = Biquad::high_pass(rate);
        let mut out = Vec::with_capacity(frames);
        for frame in 0..frames {
            let sample = f64::from(samples[frame * channels + channel]);
            let sample = if sample.is_finite() { sample } else { 0.0 };
            out.push(high_pass.step(shelf.step(sample)));
        }
        weighted.push(out);
    }

    // One number per block: the channel-summed mean square, which is what both gates and the
    // final mean are computed over.
    let mut powers: Vec<f64> = Vec::new();
    let mut start = 0;
    while start + block <= frames {
        let mut sum = 0.0;
        for channel in &weighted {
            let mean: f64 = channel[start..start + block]
                .iter()
                .map(|value| value * value)
                .sum::<f64>()
                / block as f64;
            sum += mean;
        }
        powers.push(sum);
        start += hop;
    }

    let loudness_of = |power: f64| OFFSET_LU + 10.0 * power.max(f64::MIN_POSITIVE).log10();
    let above: Vec<f64> = powers
        .iter()
        .copied()
        .filter(|power| loudness_of(*power) > ABSOLUTE_GATE_LUFS)
        .collect();
    if above.is_empty() {
        return None;
    }
    let relative_gate =
        loudness_of(above.iter().sum::<f64>() / above.len() as f64) - RELATIVE_GATE_LU;
    let gated: Vec<f64> = above
        .iter()
        .copied()
        .filter(|power| loudness_of(*power) > relative_gate)
        .collect();
    let kept = if gated.is_empty() { &above } else { &gated };
    Some(loudness_of(kept.iter().sum::<f64>() / kept.len() as f64))
}

/// One biquad section, transposed direct form II.
pub(crate) struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}

impl Biquad {
    /// BS.1770's stage 1: the "head" high shelf that stands in for the acoustic effect of a
    /// head in the sound field. Coefficients are derived from the sample rate rather than
    /// tabulated at 48 kHz, so a 44.1 kHz asset measures correctly instead of being measured
    /// through a filter designed for a different rate.
    pub(crate) fn high_shelf(rate: f64) -> Self {
        let f0 = 1681.974450955533;
        let gain_db = 3.999843853973347;
        let q = 0.7071752369554196;
        let k = (std::f64::consts::PI * f0 / rate).tan();
        let vh = 10.0_f64.powf(gain_db / 20.0);
        let vb = vh.powf(0.4996667741545416);
        let a0 = 1.0 + k / q + k * k;
        Self {
            b0: (vh + vb * k / q + k * k) / a0,
            b1: 2.0 * (k * k - vh) / a0,
            b2: (vh - vb * k / q + k * k) / a0,
            a1: 2.0 * (k * k - 1.0) / a0,
            a2: (1.0 - k / q + k * k) / a0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    /// BS.1770's stage 2: the RLB high pass, which is what stops a rumble under the programme
    /// counting as loudness.
    pub(crate) fn high_pass(rate: f64) -> Self {
        let f0 = 38.13547087602444;
        let q = 0.5003270373238773;
        let k = (std::f64::consts::PI * f0 / rate).tan();
        let a0 = 1.0 + k / q + k * k;
        Self {
            b0: 1.0,
            b1: -2.0,
            b2: 1.0,
            a1: 2.0 * (k * k - 1.0) / a0,
            a2: (1.0 - k / q + k * k) / a0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    pub(crate) fn step(&mut self, input: f64) -> f64 {
        let output = self.b0 * input + self.z1;
        self.z1 = self.b1 * input - self.a1 * output + self.z2;
        self.z2 = self.b2 * input - self.a2 * output;
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A sine at `amplitude`, `seconds` long, mono at 48 kHz.
    fn sine(amplitude: f32, hz: f64, seconds: f64) -> AudioPcm {
        let rate = 48_000;
        let frames = (seconds * f64::from(rate)) as usize;
        let samples = (0..frames)
            .map(|index| {
                let t = index as f64 / f64::from(rate);
                (amplitude as f64 * (std::f64::consts::TAU * hz * t).sin()) as f32
            })
            .collect();
        AudioPcm {
            sample_rate: rate,
            channels: 1,
            samples,
        }
    }

    /// The calibration BS.1770 is defined by: at 1 kHz the K-weighting's gain and the standard's
    /// 0.691 LU offset cancel, so a 1 kHz sine's loudness *is* its mean level in dBFS. ffmpeg
    /// agrees on the same file — a 1 kHz mono sine reports `I: -21.1 LUFS` beside
    /// `mean_volume: -21.1 dB`. Getting the offset wrong would put every synthesised sound at a
    /// level no imported file shares, which is worse than not measuring it at all.
    #[test]
    fn a_sine_measures_where_the_standard_says() {
        let measured = measure(&sine(1.0, 1000.0, 3.0));
        assert!((measured.peak_db - 0.0).abs() < 0.1, "{measured:?}");
        assert!((measured.rms_db - (-3.01)).abs() < 0.1, "{measured:?}");
        assert!(
            (measured.lufs - measured.rms_db).abs() < 0.1,
            "at 1 kHz the loudness is the mean level: {measured:?}"
        );
    }

    /// Twenty dB quieter is twenty LU quieter, on every one of the three numbers. This is the
    /// property the mix depends on: the difference between two measurements is the mix.
    #[test]
    fn a_quieter_signal_measures_exactly_as_much_quieter() {
        let loud = measure(&sine(1.0, 1000.0, 3.0));
        let quiet = measure(&sine(0.1, 1000.0, 3.0));
        assert!(
            (loud.lufs - quiet.lufs - 20.0).abs() < 0.05,
            "{loud:?} {quiet:?}"
        );
        assert!(
            (loud.peak_db - quiet.peak_db - 20.0).abs() < 0.05,
            "{loud:?} {quiet:?}"
        );
        assert!(
            (loud.rms_db - quiet.rms_db - 20.0).abs() < 0.05,
            "{loud:?} {quiet:?}"
        );
    }

    /// Shorter than one gating block, so R128 has nothing to integrate — and says so instead of
    /// reporting the level of a block that never completed. A loud click reads as `-70 LUFS`
    /// with a peak near full scale, which is the pair `level_lufs()` exists to interpret.
    #[test]
    fn a_sound_shorter_than_a_gating_block_has_no_integrated_loudness() {
        let measured = measure(&sine(0.9, 1000.0, 0.05));
        assert!(!measured.is_audible(), "{measured:?}");
        assert_eq!(measured.lufs, R128_FLOOR_LUFS);
        assert!(measured.peak_db > -2.0, "{measured:?}");
        assert!(measured.rms_db > -10.0, "{measured:?}");
    }

    /// Silence is floored rather than reported as `-inf`. A non-finite float is written into
    /// the project file as `null`, and the project then fails to load.
    #[test]
    fn silence_is_a_number() {
        let measured = measure(&AudioPcm {
            sample_rate: 48_000,
            channels: 1,
            samples: vec![0.0; 48_000],
        });
        assert!(measured.peak_db.is_finite() && measured.rms_db.is_finite());
        assert!(measured.lufs.is_finite());
        assert_eq!(measured.peak_db, FLOOR_DB);
        assert_eq!(measured.lufs, R128_FLOOR_LUFS);
    }

    /// A pause does not make a programme quieter. R128's relative gate is what buys that, and
    /// it is why the sound of a piece is independent of how much silence it contains.
    #[test]
    fn silence_between_the_sounds_does_not_drag_the_level_down() {
        let mut padded = sine(0.5, 1000.0, 2.0);
        padded.samples.extend(std::iter::repeat_n(0.0, 48_000 * 4));
        let plain = measure(&sine(0.5, 1000.0, 2.0));
        let with_gap = measure(&padded);
        assert!(
            (plain.lufs - with_gap.lufs).abs() < 0.5,
            "{plain:?} vs {with_gap:?}"
        );
    }

    /// Every synthesised effect measures a finite level at its default length. A `NaN` here
    /// would reach the project file and take the mix envelope with it.
    #[test]
    fn every_effect_measures_a_finite_level() {
        for effect in crate::sfx::EFFECTS {
            let pcm = effect.render(crate::sfx::SfxParams {
                seconds: effect.default_seconds,
                ..Default::default()
            });
            let measured = measure(&pcm);
            assert!(
                measured.lufs.is_finite() && measured.rms_db.is_finite(),
                "{}: {measured:?}",
                effect.id
            );
            // Rendered to a peak of `level`, so the peak is the one number that is known in
            // advance — 0.7 is -3.1 dBFS.
            assert!(
                (measured.peak_db - (-3.1)).abs() < 0.3,
                "{} peaks at {:.2} dBFS, not the level it was asked for",
                effect.id,
                measured.peak_db
            );
        }
    }
}
