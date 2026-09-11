//! Provider-neutral text-to-speech interface.

use crate::{SpeechEngine, SpeechError, SpeechResult, Utterance};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Prosody {
    pub rate: f32,
    pub pitch_semitones: f32,
    pub energy: f32,
}

impl Default for Prosody {
    fn default() -> Self {
        Self {
            rate: 1.0,
            pitch_semitones: 0.0,
            energy: 1.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProsodyCapabilities {
    pub rate: bool,
    pub pitch: bool,
    pub energy: bool,
}

pub struct SynthesisRequest<'a> {
    pub text: &'a str,
    pub voice: &'a str,
    pub language: &'a str,
    pub output_path: &'a str,
    pub prosody: Prosody,
}

/// Adapter boundary for local or explicitly opted-in cloud voices.
pub trait TtsProvider {
    fn id(&self) -> &'static str;
    fn prosody_capabilities(&self) -> ProsodyCapabilities;
    fn synthesize(&mut self, request: SynthesisRequest<'_>) -> SpeechResult<Utterance>;
}

impl TtsProvider for SpeechEngine {
    fn id(&self) -> &'static str {
        "kokoro"
    }

    fn prosody_capabilities(&self) -> ProsodyCapabilities {
        ProsodyCapabilities {
            rate: true,
            pitch: false,
            energy: true,
        }
    }

    fn synthesize(&mut self, request: SynthesisRequest<'_>) -> SpeechResult<Utterance> {
        let prosody = request.prosody;
        if !prosody.rate.is_finite() || !(0.1..=5.0).contains(&prosody.rate) {
            return Err(SpeechError::BadRequest(
                "prosody rate must be within 0.1..=5.0".into(),
            ));
        }
        if !prosody.pitch_semitones.is_finite() || prosody.pitch_semitones.abs() > f32::EPSILON {
            return Err(SpeechError::BadRequest(
                "the Kokoro provider does not support pitch control".into(),
            ));
        }
        if !prosody.energy.is_finite() || prosody.energy <= 0.0 {
            return Err(SpeechError::BadRequest(
                "prosody energy must be finite and greater than zero".into(),
            ));
        }
        let peak_db = (-2.0 + 20.0 * prosody.energy.log10()).min(0.0);
        self.speak_normalized(
            request.text,
            request.voice,
            prosody.rate,
            request.language,
            request.output_path,
            Some(peak_db),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kokoro_capabilities_do_not_claim_pitch_control() {
        let engine = SpeechEngine::new(Default::default());
        assert_eq!(engine.id(), "kokoro");
        assert_eq!(
            engine.prosody_capabilities(),
            ProsodyCapabilities {
                rate: true,
                pitch: false,
                energy: true,
            }
        );
    }
}
