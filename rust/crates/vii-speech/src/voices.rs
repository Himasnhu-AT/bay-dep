//! The Kokoro voice catalogue.
//!
//! A constant, mirrored from `script/vii-kokoro.py`. It lives here as well because asking the
//! sidecar for it means starting the sidecar — loading a multi-gigabyte torch runtime to read a
//! hardcoded dictionary. That is slow enough that the in-editor `speech_status` refused to do
//! it at all and told agents to close the app to see which voices exist, which is a strange
//! thing to ask of someone choosing a voice.
//!
//! Two copies need a guard, so [`tests`] parses the Python and fails on any divergence.

/// Every voice Kokoro can speak, grouped by its language code.
///
/// The code is the first letter of the voice name and must be passed to `narrate` as
/// `langCode` — `af_heart` needs `"a"`. Getting it wrong produces wrong pronunciation rather
/// than an error, so the grouping is the useful part of this table, not decoration.
pub const VOICES: &[(&str, &str, &[&str])] = &[
    (
        "a",
        "American English",
        &[
            "af_heart",
            "af_alloy",
            "af_aoede",
            "af_bella",
            "af_jessica",
            "af_kore",
            "af_nicole",
            "af_nova",
            "af_river",
            "af_sarah",
            "af_sky",
            "am_adam",
            "am_echo",
            "am_eric",
            "am_fenrir",
            "am_liam",
            "am_michael",
            "am_onyx",
            "am_puck",
            "am_santa",
        ],
    ),
    (
        "b",
        "British English",
        &[
            "bf_alice",
            "bf_emma",
            "bf_isabella",
            "bf_lily",
            "bm_daniel",
            "bm_fable",
            "bm_george",
            "bm_lewis",
        ],
    ),
    ("e", "Spanish", &["ef_dora", "em_alex", "em_santa"]),
    ("f", "French", &["ff_siwis"]),
    ("h", "Hindi", &["hf_alpha", "hf_beta", "hm_omega", "hm_psi"]),
    ("i", "Italian", &["if_sara", "im_nicola"]),
    (
        "j",
        "Japanese",
        &[
            "jf_alpha",
            "jf_gongitsune",
            "jf_nezumi",
            "jf_tebukuro",
            "jm_kumo",
        ],
    ),
    (
        "p",
        "Brazilian Portuguese",
        &["pf_dora", "pm_alex", "pm_santa"],
    ),
    (
        "z",
        "Mandarin Chinese",
        &[
            "zf_xiaobei",
            "zf_xiaoni",
            "zf_xiaoxiao",
            "zf_xiaoyi",
            "zm_yunjian",
            "zm_yunxi",
            "zm_yunxia",
            "zm_yunyang",
        ],
    ),
];

/// The catalogue as `{ "a": [...], "b": [...] }` — the shape the sidecar's `/voices` returns,
/// so a caller cannot tell which one answered.
pub fn catalogue() -> serde_json::Value {
    let mut map = serde_json::Map::new();
    for (code, _, names) in VOICES {
        map.insert(
            (*code).to_string(),
            serde_json::Value::Array(
                names
                    .iter()
                    .map(|n| serde_json::Value::String((*n).to_string()))
                    .collect(),
            ),
        );
    }
    serde_json::Value::Object(map)
}

/// Which language code a voice belongs to, from its name.
///
/// Saves a caller from passing `langCode` by hand and getting it silently wrong — the code is
/// always the first character, but that is a convention worth encoding once.
pub fn lang_code_for(voice: &str) -> Option<&'static str> {
    let first = voice.chars().next()?;
    VOICES
        .iter()
        .find(|(code, _, _)| code.starts_with(first))
        .map(|(code, _, _)| *code)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two copies of the catalogue, in two languages. Nothing but this test keeps them equal,
    /// and a divergence would offer a voice the sidecar rejects — or hide one that works.
    #[test]
    fn the_rust_catalogue_matches_the_python_sidecar() {
        let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .expect("repo root")
            .join("script/vii-kokoro.py");
        let Ok(source) = std::fs::read_to_string(&script) else {
            eprintln!("skipping: {} not found", script.display());
            return;
        };

        let start = source.find("VOICES = {").expect("VOICES table");
        let end = source[start..].find("\n}").expect("end of table") + start;
        let table = &source[start..end];

        // Each `"x": [ ... ]` entry, across the line breaks the table is wrapped over.
        let mut python: Vec<(String, Vec<String>)> = Vec::new();
        let mut rest = table;
        while let Some(open) = rest.find('"') {
            let after = &rest[open + 1..];
            let Some(close) = after.find('"') else { break };
            let key = after[..close].to_string();
            let Some(bracket) = after[close..].find('[') else {
                break;
            };
            let list_start = close + bracket + 1;
            let Some(list_end) = after[list_start..].find(']') else {
                break;
            };
            let names: Vec<String> = after[list_start..list_start + list_end]
                .split(',')
                .map(|n| n.trim().trim_matches('"').to_string())
                .filter(|n| !n.is_empty())
                .collect();
            python.push((key, names));
            rest = &after[list_start + list_end..];
        }

        assert!(!python.is_empty(), "parsed no voices out of the sidecar");
        assert_eq!(
            python.len(),
            VOICES.len(),
            "the sidecar has {} language groups, Rust has {}",
            python.len(),
            VOICES.len()
        );
        for (code, names) in &python {
            let (_, _, ours) = VOICES
                .iter()
                .find(|(c, _, _)| c == code)
                .unwrap_or_else(|| panic!("Rust is missing language {code:?}"));
            assert_eq!(
                names,
                &ours.iter().map(|n| (*n).to_string()).collect::<Vec<_>>(),
                "voices for {code:?} differ between the sidecar and Rust"
            );
        }
    }

    #[test]
    fn a_voice_name_resolves_to_its_language() {
        assert_eq!(lang_code_for("af_heart"), Some("a"));
        assert_eq!(lang_code_for("bm_george"), Some("b"));
        assert_eq!(lang_code_for("zf_xiaoni"), Some("z"));
        assert_eq!(lang_code_for("qq_nobody"), None);
    }

    #[test]
    fn the_catalogue_is_the_shape_the_sidecar_returns() {
        let value = catalogue();
        assert!(
            value["a"]
                .as_array()
                .is_some_and(|v| v.iter().any(|n| n == "af_heart")),
            "American English should list af_heart: {value}"
        );
    }
}
