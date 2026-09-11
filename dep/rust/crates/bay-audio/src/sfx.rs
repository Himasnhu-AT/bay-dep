//! Motion-graphics sound effects, synthesised rather than downloaded.
//!
//! Whooshes, risers, clicks, impacts — the sounds that go *under an edit* rather than in the
//! world of the picture. They are here as code for the same reason the looks are, plus one
//! that matters more:
//!
//! **A whoosh has to be as long as the transition it accompanies.** A downloaded 0.6s whoosh
//! under a 0.35s dissolve is either cut off or trailing, and the only fixes are to retime the
//! edit around the asset or to stretch the asset and change its pitch. A synthesised one is
//! rendered at the length asked for, which is the whole point of it.
//!
//! This is also, genuinely, how these sounds are made in a real library: a whoosh *is* filtered
//! noise with an envelope, and a riser *is* a noise sweep. Synthesising them is not a
//! substitute for the recorded thing — for these, it is the thing.
//!
//! Recorded sound — a door, footsteps, a room tone — is a different problem and wants a real
//! library. See `docs/native/content-packs.md` for the licence rules that apply to one.

use crate::AudioPcm;

/// Sample rate everything is rendered at. 48 kHz because that is what the export mixer and
/// every delivery format expect; resampling a sound effect for no reason is a way to make it
/// slightly worse.
pub const SAMPLE_RATE: u32 = 48_000;

/// One synthesisable sound.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sfx {
    pub id: &'static str,
    pub name: &'static str,
    /// What it is for. This is what a picker shows and what an agent reads to choose.
    pub description: &'static str,
    /// A sensible length in seconds, when the caller does not say.
    pub default_seconds: f64,
}

/// Everything bay can synthesise, in the order a picker should show them.
pub const EFFECTS: &[Sfx] = &[
    Sfx {
        id: "whoosh",
        name: "Whoosh",
        description: "A filtered noise sweep that rises and falls. The sound under a fast cut, \
                      a wipe, or type flying in. Make it the same length as the move it covers.",
        default_seconds: 0.45,
    },
    Sfx {
        id: "whoosh-reverse",
        name: "Reverse Whoosh",
        description: "A whoosh played into the cut rather than out of it — it swells and stops \
                      dead. Put the END of it on the frame the cut lands.",
        default_seconds: 0.5,
    },
    Sfx {
        id: "riser",
        name: "Riser",
        description: "Noise climbing in pitch and volume towards a hit. Goes before a reveal; \
                      end it exactly where the thing appears.",
        default_seconds: 1.6,
    },
    Sfx {
        id: "sub-drop",
        name: "Sub Drop",
        description: "A sine falling to nearly nothing. Felt more than heard on a phone \
                      speaker, which is the point — it lands a cut without adding clutter.",
        default_seconds: 0.9,
    },
    Sfx {
        id: "impact",
        name: "Impact",
        description: "A low hit with a short tail. Under a title landing, or the frame a \
                      number appears on.",
        default_seconds: 0.7,
    },
    Sfx {
        id: "click",
        name: "Click",
        description: "A short, bright transient. Punctuation for a UI beat, a checklist item, \
                      a line of type appearing.",
        default_seconds: 0.06,
    },
    Sfx {
        id: "tick",
        name: "Tick",
        description: "Quieter and duller than a click. For a run of them — a counter, a list \
                      building up — where a click would become annoying.",
        default_seconds: 0.04,
    },
    Sfx {
        id: "pop",
        name: "Pop",
        description: "A tuned blip with a fast decay. A dot appearing, a bubble, a small \
                      element arriving.",
        default_seconds: 0.16,
    },
    Sfx {
        id: "chime",
        name: "Chime",
        description: "Two tones a fifth apart, ringing out. Something completed, a tick \
                      landing, a total revealed. The positive one.",
        default_seconds: 0.9,
    },
    Sfx {
        id: "error",
        name: "Error",
        description: "Two low tones falling. The negative counterpart to the chime — a \
                      rejection, a wrong answer, a stat going the wrong way.",
        default_seconds: 0.45,
    },
    Sfx {
        id: "beep",
        name: "Beep",
        description: "A clean square-ish tone. Machine-made on purpose: a readout, a timer, a \
                      step in a sequence.",
        default_seconds: 0.12,
    },
    Sfx {
        id: "glitch",
        name: "Glitch",
        description: "Stuttered noise in bursts. Digital interference, a corrupted cut, the \
                      moment before something breaks.",
        default_seconds: 0.35,
    },
    Sfx {
        id: "swell",
        name: "Swell",
        description: "A low tone growing under everything else. Tension for the seconds before \
                      a reveal; sits beneath narration rather than competing with it.",
        default_seconds: 2.5,
    },
];

/// How a sound should be rendered.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SfxParams {
    /// Length in seconds. A whoosh should be the length of the move it covers.
    pub seconds: f64,
    /// Brightness, 0..1. Low is dull and distant, high is close and sharp. 0.5 is neutral.
    pub tone: f32,
    /// Peak level, 0..1. Sound effects sit *under* narration, so the default is well below
    /// full scale.
    pub level: f32,
}

impl Default for SfxParams {
    fn default() -> Self {
        Self {
            seconds: 0.0, // replaced by the effect's own default
            tone: 0.5,
            level: 0.7,
        }
    }
}

impl Sfx {
    pub fn by_id(id: &str) -> Option<&'static Sfx> {
        EFFECTS.iter().find(|effect| effect.id == id)
    }

    /// Render this effect to mono PCM.
    ///
    /// Deterministic: the noise comes from a counter-seeded generator, not from the system, so
    /// the same call renders the same samples on every machine and every run. A render that
    /// differed between the preview and the export would be a sound the author never heard.
    pub fn render(&self, params: SfxParams) -> AudioPcm {
        let seconds = if params.seconds.is_finite() && params.seconds > 0.0 {
            params.seconds.min(30.0)
        } else {
            self.default_seconds
        };
        let tone = params.tone.clamp(0.0, 1.0);
        let level = params.level.clamp(0.0, 1.0);

        let frames = (seconds * SAMPLE_RATE as f64).ceil().max(1.0) as usize;
        let mut samples = vec![0.0f32; frames];
        let mut noise = Noise::new(self.id);
        // A one-pole low-pass whose cutoff moves; `state` is its memory across samples.
        let mut low = 0.0f32;
        let mut previous = 0.0f32;

        for (index, sample) in samples.iter_mut().enumerate() {
            let t = index as f32 / frames as f32; // 0..1 through the sound
            let seconds_in = index as f32 / SAMPLE_RATE as f32;
            let white = noise.next();

            let value = match self.id {
                "whoosh" | "whoosh-reverse" => {
                    // A whoosh is noise whose brightness sweeps. Forwards it opens then
                    // closes; reversed it only opens, and stops.
                    let sweep = if self.id == "whoosh" {
                        (t * std::f32::consts::PI).sin()
                    } else {
                        t
                    };
                    let cutoff = 0.02 + sweep * (0.10 + 0.30 * tone);
                    low += cutoff * (white - low);
                    // Subtracting the low-passed signal from itself one sample late gives a
                    // gentle high-pass, which is what stops a whoosh sounding like a rumble.
                    let banded = low - previous * 0.55;
                    previous = low;
                    let envelope = if self.id == "whoosh" {
                        (t * std::f32::consts::PI).sin().powf(1.3)
                    } else {
                        t.powf(2.2)
                    };
                    banded * envelope * 3.2
                }
                "riser" => {
                    // Brightness and level both climb, and the climb accelerates — a linear
                    // riser does not read as tension.
                    let climb = t.powf(2.0);
                    let cutoff = 0.01 + climb * (0.12 + 0.35 * tone);
                    low += cutoff * (white - low);
                    let banded = low - previous * 0.5;
                    previous = low;
                    // A quiet tone rising underneath gives it a pitch to follow.
                    let hz = 220.0 + 900.0 * climb;
                    let tonal = (std::f32::consts::TAU * hz * seconds_in).sin() * 0.18;
                    (banded * 3.0 + tonal) * climb
                }
                "sub-drop" => {
                    // A sine falling from chest to floor. Exponential, because pitch is heard
                    // logarithmically and a linear fall sounds like it stalls.
                    let hz = 120.0 * (1.0 - t).powf(1.5) + 28.0;
                    let phase = std::f32::consts::TAU * hz * seconds_in;
                    phase.sin() * (1.0 - t).powf(1.4)
                }
                "impact" => {
                    // A low body plus a noise transient at the very start: the transient is
                    // what makes it read as a hit rather than a note.
                    let hz = 90.0 * (1.0 - t).powf(0.8) + 40.0;
                    let body = (std::f32::consts::TAU * hz * seconds_in).sin();
                    let decay = (-6.0 * t).exp();
                    let crack = white * (-70.0 * t).exp() * (0.25 + 0.4 * tone);
                    (body * 0.85 + crack) * decay
                }
                "click" | "tick" => {
                    // A transient and nothing else: a very fast decay on band-limited noise.
                    let sharpness = if self.id == "click" { 150.0 } else { 220.0 };
                    let cutoff = 0.25 + 0.45 * tone;
                    low += cutoff * (white - low);
                    let banded = low - previous * 0.75;
                    previous = low;
                    let quieter = if self.id == "click" { 1.0 } else { 0.55 };
                    banded * (-sharpness * t).exp() * 4.0 * quieter
                }
                "pop" => {
                    // A pitched blip: a sine bent downwards fast, with a click on the front.
                    let hz = 420.0 + 520.0 * (1.0 - t).powf(3.0) * (0.6 + 0.8 * tone);
                    let body = (std::f32::consts::TAU * hz * seconds_in).sin();
                    let attack = white * (-120.0 * t).exp() * 0.35;
                    (body + attack) * (-16.0 * t).exp()
                }
                "chime" | "error" => {
                    // Two tones. Rising a fifth for the positive one, falling for the
                    // negative — the interval is what carries the meaning, not the timbre.
                    let (root, interval) = if self.id == "chime" {
                        (660.0, 1.5) // a fifth up
                    } else {
                        (300.0, 0.75) // a fourth down
                    };
                    let second_in = if self.id == "chime" { 0.12 } else { 0.10 };
                    let first = (std::f32::consts::TAU * root * seconds_in).sin();
                    // The second note starts late and is quieter, so the two read as one
                    // gesture rather than a chord.
                    let started = (seconds_in - second_in).max(0.0);
                    let second = if seconds_in > second_in {
                        (std::f32::consts::TAU * root * interval * started).sin() * 0.7
                    } else {
                        0.0
                    };
                    let decay = if self.id == "chime" {
                        (-3.5 * t).exp()
                    } else {
                        (-7.0 * t).exp()
                    };
                    // A touch of the octave gives it a bell edge instead of a pure sine.
                    let shimmer =
                        (std::f32::consts::TAU * root * 2.0 * seconds_in).sin() * 0.12 * tone;
                    (first + second + shimmer) * decay
                }
                "beep" => {
                    // Deliberately synthetic. A soft-clipped sine is a square without the
                    // aliasing a real square would bring at this sample rate.
                    let hz = 880.0 * (0.6 + 0.8 * tone);
                    let raw = (std::f32::consts::TAU * hz * seconds_in).sin();
                    let squared = (raw * 3.0).clamp(-1.0, 1.0);
                    // Ramp both ends over a few ms, or a tone stops with a click.
                    let gate = (t * 12.0).min(1.0).min(((1.0 - t) * 12.0).min(1.0));
                    squared * gate
                }
                "glitch" => {
                    // Noise gated by a stutter that is itself quantised — steady bursts read
                    // as a machine fault, random ones read as a broken speaker.
                    let step = (t * 14.0).floor();
                    let open = ((step as u32).wrapping_mul(2_654_435_761) >> 28) > 4;
                    let cutoff = 0.15 + 0.5 * tone;
                    low += cutoff * (white - low);
                    let banded = low - previous * 0.6;
                    previous = low;
                    if open {
                        banded * 3.0 * (1.0 - t * 0.4)
                    } else {
                        0.0
                    }
                }
                "swell" => {
                    // Two detuned low tones. The beat between them is what makes it feel like
                    // it is growing rather than simply getting louder.
                    let hz = 110.0;
                    let a = (std::f32::consts::TAU * hz * seconds_in).sin();
                    let b = (std::f32::consts::TAU * (hz * 1.008) * seconds_in).sin();
                    let air = white * 0.08 * tone;
                    (a + b * 0.8 + air) * t.powf(1.8)
                }
                _ => 0.0,
            };
            *sample = value;
        }

        // De-click the ends *before* normalising, in that order for a reason: a click's whole
        // energy is in its first millisecond, so fading after normalisation would crush the
        // transient it exists to protect and leave the sound inaudible.
        //
        // The head fade is a tenth of the tail's — long enough that the first sample is not a
        // step, short enough that it does not blunt an attack.
        let tail = (SAMPLE_RATE as usize / 1000).min(frames / 4).max(1);
        let head = (tail / 10).max(1);
        for (i, sample) in samples.iter_mut().take(head).enumerate() {
            *sample *= i as f32 / head as f32;
        }
        for (i, sample) in samples.iter_mut().rev().take(tail).enumerate() {
            *sample *= i as f32 / tail as f32;
        }

        // Normalise last, so the asked-for level is the level that comes out. Synthesised
        // peaks vary with the parameters, and an effect that is sometimes twice as loud as the
        // last one is unusable.
        let peak = samples.iter().fold(0.0f32, |worst, s| worst.max(s.abs()));
        if peak > 1e-6 {
            let gain = level / peak;
            for sample in &mut samples {
                *sample *= gain;
            }
        }

        AudioPcm {
            sample_rate: SAMPLE_RATE,
            channels: 1,
            samples,
        }
    }
}

/// A small deterministic noise source.
///
/// Seeded from the effect's own id so two effects do not share a noise sequence, and
/// reproducible so a render is the same every time — the preview and the export must not hear
/// different noise.
struct Noise {
    state: u32,
}

impl Noise {
    fn new(seed: &str) -> Self {
        // FNV-1a over the id: any stable hash would do, but this one is three lines and does
        // not drag in a dependency for eight bytes of state.
        let mut hash: u32 = 2_166_136_261;
        for byte in seed.as_bytes() {
            hash ^= *byte as u32;
            hash = hash.wrapping_mul(16_777_619);
        }
        Self {
            state: hash | 1, // xorshift stalls at zero
        }
    }

    /// White noise in −1..1.
    fn next(&mut self) -> f32 {
        self.state ^= self.state << 13;
        self.state ^= self.state >> 17;
        self.state ^= self.state << 5;
        (self.state as f32 / u32::MAX as f32) * 2.0 - 1.0
    }
}

/// Encode mono/stereo PCM as a 16-bit WAV.
///
/// Hand-written rather than pulled in: a RIFF header is forty lines, and this is the only
/// place bay writes audio. Samples are clamped, because a value past ±1 wraps to the opposite
/// sign in 16-bit and a wrap is a loud crack.
pub fn encode_wav(pcm: &AudioPcm) -> Vec<u8> {
    let channels = pcm.channels.max(1);
    let sample_rate = pcm.sample_rate.max(1);
    let bits = 16u16;
    let block_align = channels * bits / 8;
    let byte_rate = sample_rate * u32::from(block_align);
    let data_len = (pcm.samples.len() * 2) as u32;

    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVE");

    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // PCM chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // format: PCM
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bits.to_le_bytes());

    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for sample in &pcm.samples {
        let clamped = sample.clamp(-1.0, 1.0);
        out.extend_from_slice(&((clamped * i16::MAX as f32) as i16).to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render(id: &str, seconds: f64) -> AudioPcm {
        Sfx::by_id(id).unwrap().render(SfxParams {
            seconds,
            ..SfxParams::default()
        })
    }

    fn peak(pcm: &AudioPcm) -> f32 {
        pcm.samples.iter().fold(0.0f32, |w, s| w.max(s.abs()))
    }

    /// Energy in the second half against the first — a crude way to ask "does this rise or
    /// fall?", which is the one thing each of these sounds must get right.
    fn tilt(pcm: &AudioPcm) -> f32 {
        let half = pcm.samples.len() / 2;
        let energy = |slice: &[f32]| slice.iter().map(|s| s * s).sum::<f32>().max(1e-9);
        energy(&pcm.samples[half..]) / energy(&pcm.samples[..half])
    }

    #[test]
    fn every_effect_renders_something_audible_at_the_length_asked_for() {
        for effect in EFFECTS {
            let pcm = render(effect.id, 0.5);
            assert_eq!(pcm.sample_rate, SAMPLE_RATE, "{}", effect.id);
            assert_eq!(pcm.channels, 1, "{}", effect.id);
            assert_eq!(
                pcm.samples.len(),
                24_000,
                "{} is the wrong length",
                effect.id
            );
            assert!(peak(&pcm) > 0.5, "{} came out inaudible", effect.id);
            assert!(
                pcm.samples.iter().all(|s| s.is_finite() && s.abs() <= 1.0),
                "{} produced a sample outside the rails",
                effect.id
            );
        }
    }

    /// The reason these are synthesised rather than downloaded: the sound is as long as the
    /// move it covers, whatever that turns out to be.
    #[test]
    fn a_whoosh_is_rendered_at_whatever_length_the_edit_needs() {
        for seconds in [0.2, 0.45, 1.5] {
            let pcm = render("whoosh", seconds);
            let expected = (seconds * SAMPLE_RATE as f64) as usize;
            assert!(
                pcm.samples.len().abs_diff(expected) <= 1,
                "{seconds}s came out as {} samples",
                pcm.samples.len()
            );
        }
    }

    /// The same call must render the same samples every time, or the preview and the export
    /// would carry different noise.
    #[test]
    fn rendering_is_deterministic() {
        assert_eq!(render("whoosh", 0.4).samples, render("whoosh", 0.4).samples);
        assert_eq!(render("riser", 1.0).samples, render("riser", 1.0).samples);
    }

    /// Two effects must not share a noise sequence, or a whoosh and a riser layered together
    /// would correlate and sound like one louder thing.
    #[test]
    fn different_effects_use_different_noise() {
        assert_ne!(render("whoosh", 0.5).samples, render("riser", 0.5).samples);
    }

    /// Each of these is named for its shape. A riser that does not rise is a lie in a picker.
    #[test]
    fn each_sound_has_the_shape_its_name_claims() {
        assert!(tilt(&render("riser", 1.2)) > 4.0, "a riser must build");
        assert!(
            tilt(&render("sub-drop", 0.9)) < 0.5,
            "a drop must fall away"
        );
        assert!(tilt(&render("impact", 0.7)) < 0.2, "an impact decays");
        assert!(
            tilt(&render("click", 0.06)) < 0.05,
            "a click is a transient"
        );
        // A whoosh swells in the middle, so its halves are roughly matched.
        let whoosh = tilt(&render("whoosh", 0.5));
        assert!((0.2..5.0).contains(&whoosh), "whoosh tilt was {whoosh}");
        // A reverse whoosh does the opposite: all its energy is at the end.
        assert!(
            tilt(&render("whoosh-reverse", 0.5)) > 3.0,
            "a reverse whoosh builds into the cut"
        );
        assert!(tilt(&render("swell", 2.0)) > 3.0, "a swell grows");
        assert!(
            tilt(&render("chime", 0.9)) < 0.5,
            "a chime rings out and decays"
        );
        assert!(tilt(&render("error", 0.45)) < 0.5, "so does an error");
    }

    /// The two tonal signals mean opposite things, and the interval is what carries it: the
    /// chime rises, the error falls. Compared by where the energy sits in frequency, via a
    /// zero-crossing count — a crude pitch proxy that needs no FFT.
    #[test]
    fn the_chime_is_brighter_than_the_error() {
        let crossings = |pcm: &AudioPcm| {
            pcm.samples
                .windows(2)
                .filter(|w| (w[0] < 0.0) != (w[1] < 0.0))
                .count()
        };
        let chime = render("chime", 0.5);
        let error = render("error", 0.5);
        assert!(
            crossings(&chime) > crossings(&error),
            "chime {} vs error {}",
            crossings(&chime),
            crossings(&error)
        );
    }

    /// A tone that starts or stops instantly clicks. The beep gates its own ends for exactly
    /// that reason, and it is the sound most likely to be placed in a run of ten.
    #[test]
    fn the_beep_does_not_click_at_its_edges() {
        let pcm = render("beep", 0.12);
        assert!(pcm.samples[0].abs() < 0.02);
        assert!(pcm.samples.last().unwrap().abs() < 0.02);
    }

    /// A glitch is bursts, not a continuous tone: it must contain real silence.
    #[test]
    fn a_glitch_stutters() {
        let pcm = render("glitch", 0.5);
        let silent = pcm.samples.iter().filter(|s| s.abs() < 1e-4).count();
        assert!(
            silent > pcm.samples.len() / 10,
            "only {silent} silent samples of {}",
            pcm.samples.len()
        );
    }

    /// Sound effects sit under narration, so `level` has to actually control the peak.
    #[test]
    fn level_sets_the_peak() {
        let quiet = Sfx::by_id("click").unwrap().render(SfxParams {
            seconds: 0.06,
            level: 0.2,
            ..SfxParams::default()
        });
        assert!((peak(&quiet) - 0.2).abs() < 0.01, "got {}", peak(&quiet));
    }

    /// A step at the first or last sample is a click, on exactly the sounds meant to be
    /// unobtrusive.
    #[test]
    fn every_effect_starts_and_ends_at_silence() {
        for effect in EFFECTS {
            let pcm = render(effect.id, 0.3);
            assert!(
                pcm.samples[0].abs() < 0.02,
                "{} starts on a step",
                effect.id
            );
            assert!(
                pcm.samples.last().unwrap().abs() < 0.02,
                "{} ends on a step",
                effect.id
            );
        }
    }

    #[test]
    fn a_nonsense_length_falls_back_to_the_effects_own_default() {
        for seconds in [0.0, -3.0, f64::NAN] {
            let pcm = render("whoosh", seconds);
            let expected = (0.45 * SAMPLE_RATE as f64) as usize;
            assert!(pcm.samples.len().abs_diff(expected) <= 1, "{seconds}");
        }
    }

    #[test]
    fn ids_are_unique_and_resolvable() {
        for effect in EFFECTS {
            assert_eq!(Sfx::by_id(effect.id).map(|e| e.name), Some(effect.name));
            assert_eq!(EFFECTS.iter().filter(|o| o.id == effect.id).count(), 1);
        }
        assert!(Sfx::by_id("explosion").is_none());
    }

    #[test]
    fn the_wav_header_says_what_the_samples_are() {
        let pcm = render("click", 0.05);
        let wav = encode_wav(&pcm);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[36..40], b"data");
        assert_eq!(
            u32::from_le_bytes(wav[24..28].try_into().unwrap()),
            SAMPLE_RATE,
            "sample rate in the header"
        );
        assert_eq!(u16::from_le_bytes(wav[22..24].try_into().unwrap()), 1);
        assert_eq!(wav.len(), 44 + pcm.samples.len() * 2);
        assert_eq!(
            u32::from_le_bytes(wav[4..8].try_into().unwrap()) as usize,
            wav.len() - 8,
            "RIFF size counts everything after itself"
        );
    }

    /// A sample past ±1 wraps sign in 16-bit, and a wrap is a loud crack.
    #[test]
    fn out_of_range_samples_clamp_rather_than_wrap() {
        let pcm = AudioPcm {
            sample_rate: SAMPLE_RATE,
            channels: 1,
            samples: vec![2.0, -2.0],
        };
        let wav = encode_wav(&pcm);
        assert_eq!(
            i16::from_le_bytes(wav[44..46].try_into().unwrap()),
            i16::MAX
        );
        assert_eq!(
            i16::from_le_bytes(wav[46..48].try_into().unwrap()),
            -i16::MAX
        );
    }
}
