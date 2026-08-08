//! `bay-speech` — narration and captions for bay.
//!
//! Two halves that meet in the middle:
//!
//! - [`engine`] drives a **Kokoro** text-to-speech sidecar (see [`SpeechEngine`]) and returns
//!   an [`Utterance`]: a WAV on disk plus the timing of every word in it.
//! - [`subtitles`] turns those word timings into readable [`Cue`]s, and reads/writes SRT and
//!   WebVTT.
//!
//! Because Kokoro reports real per-word timestamps, captions built from an utterance are
//! synchronised to the audio rather than estimated from character counts.

pub mod engine;
pub mod subtitles;
pub mod voices;

pub use engine::{SpeechConfig, SpeechEngine, speak_once};
pub use subtitles::{Cue, CueStyle, cues_from_words, parse, shift, to_srt, to_vtt};

/// One spoken word and when it is heard, in seconds from the start of the utterance.
#[derive(Debug, Clone, PartialEq)]
pub struct WordSpan {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

/// A synthesized line of speech: the audio file, how long it runs, and its word timings.
#[derive(Debug, Clone, PartialEq)]
pub struct Utterance {
    pub path: String,
    pub duration_seconds: f64,
    pub sample_rate: u32,
    pub voice: String,
    pub words: Vec<WordSpan>,
}

impl Utterance {
    /// Captions for this utterance, grouped by `style`.
    pub fn cues(&self, style: &CueStyle) -> Vec<Cue> {
        cues_from_words(&self.words, style)
    }
}

/// Everything that can go wrong reaching or using the speech sidecar. Each variant says what
/// a caller can do about it, because these surface directly as MCP tool errors.
#[derive(Debug)]
pub enum SpeechError {
    /// Kokoro is not set up on this machine.
    NotInstalled(String),
    /// The sidecar process could not be started.
    Spawn(String),
    /// It started but never became ready.
    Timeout(String),
    /// Something else already holds the port and does not accept our token.
    PortBusy(u16),
    /// The socket failed.
    Transport(String),
    /// The reply was not what the protocol promises.
    Protocol(String),
    /// The sidecar rejected our token.
    Unauthorized,
    /// The request was refused as invalid.
    BadRequest(String),
    /// Synthesis itself failed.
    Synthesis(String),
}

impl std::fmt::Display for SpeechError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SpeechError::NotInstalled(detail) => write!(f, "Kokoro is not installed: {detail}"),
            SpeechError::Spawn(detail) => write!(f, "could not start the Kokoro sidecar: {detail}"),
            SpeechError::Timeout(detail) => write!(f, "{detail}"),
            SpeechError::PortBusy(port) => write!(
                f,
                "port {port} is held by a process that does not accept this session's token; \
                 close it, or set BAY_KOKORO_PORT to a free port"
            ),
            SpeechError::Transport(detail) => write!(f, "could not reach the sidecar: {detail}"),
            SpeechError::Protocol(detail) => {
                write!(f, "unexpected reply from the sidecar: {detail}")
            }
            SpeechError::Unauthorized => write!(f, "the sidecar rejected this session's token"),
            SpeechError::BadRequest(detail) => write!(f, "{detail}"),
            SpeechError::Synthesis(detail) => write!(f, "speech synthesis failed: {detail}"),
        }
    }
}

impl std::error::Error for SpeechError {}

pub type SpeechResult<T> = Result<T, SpeechError>;

#[cfg(test)]
mod promise_tests {
    /// bay installs its own runtimes. No error a user can reach may tell them to do it by hand.
    ///
    /// This exists because the guard that was supposed to cover it only checked one function in
    /// `bay-provision`, so two strings walked straight past it: the `NotInstalled` error from
    /// `SpeechEngine::ensure` — the exact thing a user hits the first time they ask for
    /// narration — told them to run `uv venv` and `uv pip install`, and `speech_status` in
    /// `bay-mcp` said the same. Both named tools the user does not have.
    ///
    /// Scanned as source text rather than by calling each site, because the point is that no
    /// *new* message reintroduces the advice, and a test that only knows today's call sites
    /// cannot catch tomorrow's.
    #[test]
    fn no_user_facing_message_tells_someone_to_install_a_toolchain() {
        let sources = [
            ("bay-speech/engine.rs", include_str!("engine.rs")),
            ("bay-speech/lib.rs", include_str!("lib.rs")),
        ];
        // `brew install ffmpeg` is deliberately allowed in one place: the ffmpeg-missing message
        // offers bay's own install first and lists it only as "use one you already have".
        let forbidden = ["uv venv", "uv pip install", "pip install", "astral.sh"];

        for (name, source) in sources {
            // Only the code above this test module — otherwise the test trips on its own list.
            let source = source.split("mod promise_tests").next().unwrap_or(source);
            for line in source.lines() {
                let code = line.trim_start();
                // Doc comments and explanatory comments may name the tools; user-facing strings
                // may not. This test's own list is skipped for the same reason.
                if code.starts_with("//") || code.starts_with("///") {
                    continue;
                }
                for phrase in forbidden {
                    assert!(
                        !line.contains(phrase),
                        "{name}: a message a user can reach mentions {phrase:?} — \
                         bay installs this itself, so point at runtime_install instead:\n  {line}"
                    );
                }
            }
        }
    }
}
