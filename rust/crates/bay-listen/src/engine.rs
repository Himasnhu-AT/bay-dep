use std::path::{Path, PathBuf};

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::{Transcript, TranscriptUtterance, TranscriptWord};

const SAMPLE_RATE: u32 = 16_000;
pub const MODEL_FILE: &str = "ggml-small.en-q5_1.bin";

#[derive(Debug, Clone)]
pub struct ListenConfig {
    pub model_path: PathBuf,
    /// ISO-639-1 language, or `None` for Whisper's detector.
    pub language: Option<String>,
    pub threads: i32,
    /// Only useful with a tinydiarize model. Standard models still return utterances but no
    /// speaker labels.
    pub detect_speaker_turns: bool,
}

impl Default for ListenConfig {
    fn default() -> Self {
        let model_path = std::env::var_os("BAY_WHISPER_MODEL")
            .map(PathBuf::from)
            .or_else(|| {
                bay_provision::root()
                    .ok()
                    .map(|root| root.join("models/whisper").join(MODEL_FILE))
            })
            .unwrap_or_else(|| PathBuf::from(MODEL_FILE));
        Self {
            model_path,
            language: Some("en".into()),
            threads: std::thread::available_parallelism()
                .map(|count| count.get().min(8) as i32)
                .unwrap_or(4),
            detect_speaker_turns: false,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ListenError {
    #[error(
        "transcription is not installed yet. bay can install its local Whisper model (~190 MB): \
         call runtime_install with component \"listen\". Looked for {0}"
    )]
    ModelMissing(String),
    #[error("could not load the Whisper model at {path}: {detail}")]
    ModelLoad { path: String, detail: String },
    #[error(
        "could not decode audio from {0}. Transcription needs ffmpeg; runtime_status explains \
         whether bay's video runtime is ready"
    )]
    Decode(String),
    #[error("Whisper could not create a transcription state: {0}")]
    State(String),
    #[error("Whisper transcription failed: {0}")]
    Transcribe(String),
}

pub struct Listener {
    config: ListenConfig,
    context: WhisperContext,
}

impl Listener {
    pub fn new(config: ListenConfig) -> Result<Self, ListenError> {
        if !config.model_path.is_file() {
            return Err(ListenError::ModelMissing(
                config.model_path.display().to_string(),
            ));
        }
        let model = config.model_path.display().to_string();
        let context = WhisperContext::new_with_params(&model, WhisperContextParameters::default())
            .map_err(|error| ListenError::ModelLoad {
                path: model,
                detail: error.to_string(),
            })?;
        Ok(Self { config, context })
    }

    pub fn model_path(&self) -> &Path {
        &self.config.model_path
    }

    /// Decode `media_path` to 16 kHz mono PCM and recognise it locally.
    pub fn transcribe_file(&self, media_path: &str) -> Result<Transcript, ListenError> {
        let pcm = bay_audio::decode_pcm(media_path, SAMPLE_RATE)
            .ok_or_else(|| ListenError::Decode(media_path.to_string()))?;
        let channels = usize::from(pcm.channels.max(1));
        let mono = if channels == 1 {
            pcm.samples
        } else {
            pcm.samples
                .chunks_exact(channels)
                .map(|frame| frame.iter().sum::<f32>() / channels as f32)
                .collect()
        };
        self.transcribe_pcm(&mono)
    }

    /// Recognise mono 16 kHz floating-point PCM. Exposed for deterministic integration tests and
    /// for callers that already decoded the media.
    pub fn transcribe_pcm(&self, mono: &[f32]) -> Result<Transcript, ListenError> {
        let mut state = self
            .context
            .create_state()
            .map_err(|error| ListenError::State(error.to_string()))?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(self.config.threads.max(1));
        params.set_translate(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_special(false);
        params.set_print_timestamps(false);
        params.set_token_timestamps(true);
        params.set_split_on_word(true);
        params.set_tdrz_enable(self.config.detect_speaker_turns);
        match self.config.language.as_deref() {
            Some(language) => params.set_language(Some(language)),
            None => params.set_detect_language(true),
        }
        state
            .full(params, mono)
            .map_err(|error| ListenError::Transcribe(error.to_string()))?;

        let raw: Vec<RawUtterance> = state
            .as_iter()
            .map(|segment| {
                let start_seconds = segment.start_timestamp() as f64 / 100.0;
                let end_seconds = segment.end_timestamp() as f64 / 100.0;
                let words = token_words(&segment).unwrap_or_else(|| {
                    estimated_words(
                        &segment.to_string(),
                        start_seconds,
                        end_seconds,
                        1.0 - segment.no_speech_probability(),
                    )
                });
                let text = words
                    .iter()
                    .map(|word| word.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" ");
                RawUtterance {
                    text,
                    start_seconds,
                    end_seconds,
                    words,
                    speaker_turn_after: segment.next_segment_speaker_turn(),
                }
            })
            .filter(|segment| !segment.text.is_empty())
            .collect();

        let has_speakers = raw.iter().any(|segment| segment.speaker_turn_after);
        let mut words = Vec::new();
        let mut utterances = Vec::new();
        let mut speaker_index = 1usize;
        for segment in raw {
            let speaker = has_speakers.then(|| format!("speaker-{speaker_index}"));
            let word_start = words.len();
            words.extend(segment.words.into_iter().map(|mut word| {
                word.speaker.clone_from(&speaker);
                word
            }));
            utterances.push(TranscriptUtterance {
                text: segment.text,
                start_seconds: segment.start_seconds,
                end_seconds: segment.end_seconds,
                speaker: speaker.clone(),
                word_start,
                word_end: words.len(),
            });
            if segment.speaker_turn_after {
                speaker_index += 1;
            }
        }

        let language = whisper_rs::get_lang_str(state.full_lang_id_from_state())
            .or(self.config.language.as_deref())
            .unwrap_or("unknown")
            .to_string();
        Ok(Transcript {
            language,
            model: self
                .config
                .model_path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| MODEL_FILE.into()),
            duration_seconds: mono.len() as f64 / f64::from(SAMPLE_RATE),
            words,
            utterances,
        })
    }
}

struct RawUtterance {
    text: String,
    start_seconds: f64,
    end_seconds: f64,
    words: Vec<TranscriptWord>,
    speaker_turn_after: bool,
}

fn token_words(segment: &whisper_rs::WhisperSegment<'_>) -> Option<Vec<TranscriptWord>> {
    let mut words: Vec<TranscriptWord> = Vec::new();
    let mut probabilities: Vec<(f32, usize)> = Vec::new();
    for index in 0..segment.n_tokens() {
        let token = segment.get_token(index)?;
        let raw = token.to_str_lossy().ok()?;
        let trimmed = raw.trim();
        if raw.starts_with("<|") || (trimmed.starts_with("[_") && trimmed.ends_with(']')) {
            continue;
        }
        let data = token.token_data();
        if data.t0 < 0 || data.t1 < data.t0 {
            continue;
        }
        let pieces: Vec<&str> = raw.split_whitespace().collect();
        if pieces.is_empty() {
            continue;
        }
        let duration = (data.t1 - data.t0).max(0) as f64 / 100.0;
        for (piece_index, piece) in pieces.iter().enumerate() {
            let start_seconds =
                data.t0 as f64 / 100.0 + duration * piece_index as f64 / pieces.len() as f64;
            let end_seconds =
                data.t0 as f64 / 100.0 + duration * (piece_index + 1) as f64 / pieces.len() as f64;
            let starts_word = raw.starts_with(char::is_whitespace) || pieces.len() > 1;
            if starts_word || words.is_empty() {
                words.push(TranscriptWord {
                    text: (*piece).to_string(),
                    start_seconds,
                    end_seconds,
                    confidence: token.token_probability().clamp(0.0, 1.0),
                    speaker: None,
                });
                probabilities.push((token.token_probability().clamp(0.0, 1.0), 1));
            } else {
                let word = words.last_mut()?;
                word.text.push_str(piece);
                word.end_seconds = end_seconds;
                let aggregate = probabilities.last_mut()?;
                aggregate.0 += token.token_probability().clamp(0.0, 1.0);
                aggregate.1 += 1;
                word.confidence = aggregate.0 / aggregate.1 as f32;
            }
        }
    }
    (!words.is_empty()).then_some(words)
}

fn estimated_words(text: &str, start: f64, end: f64, confidence: f32) -> Vec<TranscriptWord> {
    let pieces: Vec<&str> = text.split_whitespace().collect();
    let duration = (end - start).max(0.0);
    pieces
        .iter()
        .enumerate()
        .map(|(index, piece)| TranscriptWord {
            text: (*piece).to_string(),
            start_seconds: start + duration * index as f64 / pieces.len() as f64,
            end_seconds: start + duration * (index + 1) as f64 / pieces.len() as f64,
            confidence: confidence.clamp(0.0, 1.0),
            speaker: None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_word_timing_covers_the_segment() {
        let words = estimated_words("one two three", 2.0, 5.0, 0.75);
        assert_eq!(words.len(), 3);
        assert_eq!(words[0].start_seconds, 2.0);
        assert_eq!(words[2].end_seconds, 5.0);
        assert_eq!(words[1].confidence, 0.75);
    }

    #[test]
    fn missing_model_names_the_managed_install() {
        let config = ListenConfig {
            model_path: PathBuf::from("/definitely/missing/whisper.bin"),
            ..ListenConfig::default()
        };
        let error = Listener::new(config).err().expect("missing model");
        let message = error.to_string();
        assert!(message.contains("runtime_install"), "{message}");
        assert!(message.contains("listen"), "{message}");
    }
}
