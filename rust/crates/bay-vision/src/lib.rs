//! Finding a picture by describing it.
//!
//! A keyword search over an image archive answers with the *filename*, not the picture. Ask
//! Wikimedia Commons for "Barings Bank" and the first hit is a Barclays branch on Baring Road in
//! Beaconsfield — the words match perfectly and the photograph is of nothing to do with the
//! subject. That is the failure this crate exists to fix: [SigLIP] embeds an image and a phrase
//! into the same space, so "a 1920s German street with a queue outside a bakery" can be scored
//! against what is actually *in* the frame.
//!
//! [SigLIP]: https://arxiv.org/abs/2303.15343
//!
//! # What this crate is not
//!
//! It is not a classifier and it does not decide anything. It returns a cosine similarity per
//! candidate and the caller ranks with it. A score is a number between −1 and 1 whose *absolute*
//! value means very little — SigLIP's sigmoid training leaves the useful signal in the ordering
//! and in the gap between the best and the median, not in the value. [`Ranked::separation`]
//! reports that gap so a caller can tell "the top hit is right" from "nothing here matches".
//!
//! # Degradation
//!
//! The model is a provisioned component, not a build dependency. With nothing installed every
//! entry point returns [`VisionError::NotInstalled`], which names the tool that installs it. It
//! never names a shell command — the same rule `bay-speech` enforces on itself with a test, and
//! which [`tests::no_message_tells_someone_to_run_a_command`] enforces here.

use std::path::PathBuf;

mod encoder;
pub mod mcp;
mod preprocess;
mod rank;

pub use encoder::{Embedding, Encoder};
pub use rank::{Ranked, Scored, cosine, rank};

/// The width and height SigLIP's patch-16-224 towers expect.
pub const IMAGE_SIZE: usize = 224;

/// The embedding width both towers project into.
pub const DIMENSIONS: usize = 768;

/// Every text is padded to exactly this many tokens.
///
/// Not a tuning knob. `TextTransformer` reads the hidden state at the *last* position, so a
/// shorter pad would read the state at a different index than the one the checkpoint was trained
/// to put the sentence summary in, and the embeddings would be quietly wrong rather than
/// obviously broken.
pub const TEXT_TOKENS: usize = 64;

/// What went wrong, in terms the caller can act on.
#[derive(Debug, thiserror::Error)]
pub enum VisionError {
    /// The component is not installed. The message names the tool, never a shell command.
    #[error(
        "visual search needs the SigLIP encoder, which is not installed yet — \
         run runtime_install with component \"vision\" (about 780 MB), then try again"
    )]
    NotInstalled,

    #[error("the SigLIP weights at {path} could not be loaded: {detail}")]
    Load { path: PathBuf, detail: String },

    #[error("{path} could not be read as an image: {detail}")]
    Image { path: PathBuf, detail: String },

    #[error("encoding failed: {0}")]
    Encode(String),

    /// Asking for the embedding of nothing is a caller bug, not an empty answer.
    #[error("nothing was given to encode")]
    Empty,
}

/// Where the provisioned encoder lives, if it is there.
///
/// The probe is the weights file rather than the directory: an interrupted install leaves the
/// directory behind, and a directory that exists but holds nothing is the state most likely to
/// produce a baffling load error several seconds later instead of a clean "not installed".
pub fn provisioned_model_dir() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os("BAY_VISION_MODEL_DIR").filter(|v| !v.is_empty()) {
        let dir = PathBuf::from(explicit);
        return dir.join("model.safetensors").is_file().then_some(dir);
    }
    let dir = bay_paths::runtime_dir()?.join("models").join("siglip");
    dir.join("model.safetensors").is_file().then_some(dir)
}

/// What `vision_status` reports, answerable without loading 780 MB of weights.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub available: bool,
    pub model: Option<PathBuf>,
    pub tokenizer: Option<PathBuf>,
    pub dimensions: usize,
    /// `"metal"` or `"cpu"` — which device an encode would run on if one were started now.
    pub device: &'static str,
    pub hint: String,
}

/// Answer whether visual search would work, cheaply.
pub fn status() -> Status {
    match provisioned_model_dir() {
        Some(dir) => {
            let tokenizer = dir.join("tokenizer.json");
            let has_tokenizer = tokenizer.is_file();
            Status {
                available: has_tokenizer,
                model: Some(dir.join("model.safetensors")),
                tokenizer: has_tokenizer.then_some(tokenizer),
                dimensions: DIMENSIONS,
                device: encoder::preferred_device_name(),
                hint: if has_tokenizer {
                    "ready — stock_search ranks its results with this, and image_rank scores \
                     any images you already have"
                        .into()
                } else {
                    "the weights are installed but the tokenizer is missing — \
                     run runtime_install with component \"vision\" to repair it"
                        .into()
                },
            }
        }
        None => Status {
            available: false,
            model: None,
            tokenizer: None,
            dimensions: DIMENSIONS,
            device: encoder::preferred_device_name(),
            hint: "not installed — run runtime_install with component \"vision\" (about 780 MB). \
                   Until then stock_search still works and returns the provider's own keyword \
                   ranking, which is markedly worse."
                .into(),
        },
    }
}

#[cfg(test)]
mod promise_tests {
    /// The wording rule, copied from `bay-speech` because the failure mode is identical: a user
    /// told to install something by hand is a user bay has given up on. A model is exactly the
    /// case most likely to reintroduce the advice, because the whole ML world documents itself
    /// with a download command.
    ///
    /// Scanned as source text, for the reason the original gives: a test that only knows today's
    /// call sites cannot catch tomorrow's message.
    #[test]
    fn no_user_facing_message_tells_someone_to_install_a_toolchain() {
        let sources = [
            ("bay-vision/lib.rs", include_str!("lib.rs")),
            ("bay-vision/encoder.rs", include_str!("encoder.rs")),
            ("bay-vision/preprocess.rs", include_str!("preprocess.rs")),
            ("bay-vision/rank.rs", include_str!("rank.rs")),
        ];
        let forbidden = [
            "pip install",
            "uv pip install",
            "brew install",
            "astral.sh",
            "huggingface-cli",
        ];

        for (name, source) in sources {
            // Only the code above this test module — otherwise the test trips on its own list.
            let source = source.split("mod promise_tests").next().unwrap_or(source);
            for line in source.lines() {
                let code = line.trim_start();
                if code.starts_with("//") {
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

    /// `status()` must answer on a machine with nothing installed, and must not claim to be ready.
    #[test]
    fn status_answers_without_the_model() {
        let status = super::status();
        assert_eq!(status.dimensions, super::DIMENSIONS);
        if !status.available {
            assert!(status.model.is_none() || status.tokenizer.is_none());
            assert!(
                status.hint.contains("runtime_install"),
                "an unavailable status must say how to fix it: {}",
                status.hint
            );
        }
    }
}
