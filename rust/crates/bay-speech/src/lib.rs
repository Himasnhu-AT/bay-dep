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
pub use subtitles::{
    Cue, CueStyle, MIN_CUE_SECONDS, MIN_SECONDS_PER_WORD, closes_sentence, cues_from_spoken,
    cues_from_words, parse, sentence_ends, shift, to_srt, to_vtt,
};

/// What Kokoro speaks at `speed: 1.0`, in words a second.
///
/// **Measured, not documented.** The skill said 2.5 and every plan was built on it. The delivered
/// narration of the project this comes from ran at 2.99 — a 179 wpm read, and a 20 % error in
/// every duration an agent budgeted from it — and a direct probe of the sidecar (`af_heart`,
/// 40 words over three sentences, `kokoro.rs::a_stated_rate_lands_within_five_words_a_minute_of_it`)
/// puts `speed: 1.0` higher still, at **3.30 words a second**. The two disagree because a real
/// script is slower than a probe: commas and sentence ends buy silence the words do not.
///
/// 3.30 is the number used, because it is the one measured through the code path this constant
/// feeds. Over the working range (0.7–1.0) the rate is proportional to `speed` to within 1.5 %;
/// above about 1.1 it flattens out, which is one more reason the rate is stated and the
/// multiplier derived rather than the other way round.
pub const BASE_WORDS_PER_SECOND: f64 = 3.30;

/// The rate a reel should be read at: 150 words a minute, the middle of the broadcast band.
pub const TARGET_WORDS_PER_SECOND: f64 = 2.5;

/// The longest a single narration clip may be.
///
/// A 10.30 s, 29-word run-on landed on the turn of the video this comes from, and there is no
/// caption discipline that repairs a sentence nobody can follow. The fix is upstream of the
/// speech: say it in two clips.
pub const MAX_NARRATION_SECONDS: f64 = 8.0;

/// The `speed` that reads `words` at `target` words a second.
///
/// Clamped to the range Kokoro stays intelligible in. Exposed because the caller wants to say
/// how fast the read is in the unit the read is planned in — a rate — rather than in a
/// multiplier of an engine constant nobody measured.
pub fn speed_for_rate(target_words_per_second: f64) -> f32 {
    let target = target_words_per_second.clamp(1.0, 5.0);
    ((target / BASE_WORDS_PER_SECOND) as f32).clamp(0.5, 2.0)
}

/// How many words a script will be spoken as. Whitespace-separated tokens carrying a letter or
/// a digit — the same count the sidecar's word timings come back with.
pub fn word_count(text: &str) -> usize {
    text.split_whitespace()
        .filter(|token| token.chars().any(char::is_alphanumeric))
        .count()
}

/// Roughly how long `text` will take to speak at `words_per_second`. Used to refuse a clip that
/// is going to be too long *before* paying for the synthesis.
pub fn estimated_seconds(text: &str, words_per_second: f64) -> f64 {
    if words_per_second <= 0.0 {
        return f64::INFINITY;
    }
    word_count(text) as f64 / words_per_second
}

/// The refusal for a line too long to be one clip, with the sentences to split it at.
///
/// Naming the split points rather than only the rule: the caller's next call has to be the two
/// halves, and it should not have to work out where they are. Lives here so the wire and the
/// editor window refuse the same line with the same words.
pub fn over_length_message(text: &str, words: usize, seconds: f64, verb: &str) -> String {
    let sentences = sentence_split(text);
    let ceiling = MAX_NARRATION_SECONDS;
    let split = if sentences.len() > 1 {
        format!(
            " It is {} sentences — narrate them as separate clips:\n  - {}",
            sentences.len(),
            sentences.join("\n  - ")
        )
    } else {
        " It is one sentence, so it has to be rewritten as two before it can be spoken.".to_string()
    };
    format!(
        "that line is {words} words and {verb} {seconds:.2}s, over the {ceiling:.1}s a single \
         narration clip may run. A sentence longer than that outlives the picture it was written \
         for.{split}"
    )
}

/// A script cut into sentences — the split points a caller is handed when a line is refused
/// for being too long to say in one clip.
pub fn sentence_split(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut current = String::new();
    for token in text.split_whitespace() {
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(token);
        if closes_sentence(token) {
            out.push(std::mem::take(&mut current));
        }
    }
    if !current.trim().is_empty() {
        out.push(current);
    }
    out
}

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
    ///
    /// Prefer [`cues_for`](Self::cues_for): without the script this cannot see a full stop, and
    /// a caption that spans one is the defect this whole path exists to stop.
    pub fn cues(&self, style: &CueStyle) -> Vec<Cue> {
        cues_from_words(&self.words, style)
    }

    /// Captions for this utterance, split against the script it was spoken from.
    pub fn cues_for(&self, script: &str, style: &CueStyle) -> Vec<Cue> {
        cues_from_spoken(&self.words, script, style)
    }

    /// How fast this actually came out, in words a second. The number the caller planned with
    /// was an estimate; this one is a measurement, and reporting it is what closes the loop.
    pub fn words_per_second(&self) -> Option<f64> {
        if self.duration_seconds <= 0.0 || self.words.is_empty() {
            return None;
        }
        Some(self.words.len() as f64 / self.duration_seconds)
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
