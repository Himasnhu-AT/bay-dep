//! The installed sound library: recorded effects on disk, indexed and searchable.
//!
//! The companion to [`crate::sfx`], and the division between them is the point:
//!
//! - **Synthesised** sounds are abstract — a whoosh, a riser, an impact. They have no
//!   real-world referent, they are made from noise and envelopes in a real library too, and
//!   they must come out at whatever length the edit needs. Code, not files.
//! - **Recorded** sounds are the hundreds — a click, a switch, glass, a latch. Synthesis is
//!   genuinely bad at these, and no amount of code fixes that.
//!
//! So the recorded half is not "implement 300 sounds". It is one index over whatever packs are
//! installed, and adding the 151st sound is a file, not a function. Nothing is downloaded until
//! the user asks for it (`runtime_install sfx`); until then this returns an empty library and
//! says so, which is a different answer from "there are no sounds".

use std::path::{Path, PathBuf};

/// One recorded sound on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sound {
    /// Stable id: `<pack>/<file stem>`, e.g. `kenney-interface/click_001`.
    pub id: String,
    /// The file stem, tidied for reading: `click_001` → "click 001".
    pub name: String,
    /// The pack it came from.
    pub pack: String,
    pub path: PathBuf,
    /// Words this sound answers to, from its filename. `mouseclick1` yields `mouseclick`,
    /// `mouse` and `click`, so a search for "click" finds it.
    pub tags: Vec<String>,
}

/// Extensions worth indexing. Anything else in a pack — a preview, a licence, a `.url`
/// shortcut — is not a sound and must not appear in a picker.
const AUDIO_EXTENSIONS: &[&str] = &["ogg", "wav", "mp3", "flac", "m4a", "aac"];

/// Files that are in these packs but are not sounds anyone wants to place.
const NOT_A_SOUND: &[&str] = &["preview"];

/// Everything installed under `root`, sorted by id.
///
/// `root` is the `sfx` directory inside bay's runtime dir — the one directory the user can
/// delete to reclaim everything bay downloaded. A missing directory is an empty library, not an
/// error: it means nothing has been installed yet.
pub fn installed(root: &Path) -> Vec<Sound> {
    let mut sounds = Vec::new();
    let Ok(packs) = std::fs::read_dir(root) else {
        return sounds;
    };
    for pack in packs.filter_map(Result::ok) {
        if !pack.path().is_dir() {
            continue;
        }
        let pack_name = pack.file_name().to_string_lossy().into_owned();
        collect(&pack.path(), &pack_name, &mut sounds);
    }
    sounds.sort_by(|a, b| a.id.cmp(&b.id));
    sounds.dedup_by(|a, b| a.id == b.id);
    sounds
}

/// Walk a pack directory. Packs put their audio in a subdirectory (`Audio/`), and a future one
/// may nest further, so this recurses rather than assuming a layout.
fn collect(directory: &Path, pack: &str, into: &mut Vec<Sound>) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.is_dir() {
            collect(&path, pack, into);
            continue;
        }
        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !AUDIO_EXTENSIONS.contains(&extension.as_str()) {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let lower = stem.to_lowercase();
        if NOT_A_SOUND.iter().any(|skip| lower == *skip) {
            continue;
        }
        into.push(Sound {
            id: format!("{pack}/{stem}"),
            name: stem.replace(['_', '-'], " "),
            pack: pack.to_string(),
            tags: tags_from_stem(&lower),
            path,
        });
    }
}

/// Words a filename should answer to.
///
/// Pack filenames are terse and inconsistent — `click_001`, `mouseclick1`, `switch2`. Splitting
/// on separators is not enough: `mouseclick1` has to be findable by searching "click", which
/// means the compound names have to come apart. A short list of the parts that actually occur
/// does that without pretending to be a stemmer.
fn tags_from_stem(stem: &str) -> Vec<String> {
    /// Words that appear glued to the front or back of another in these packs.
    const PARTS: &[&str] = &[
        "mouse", "click", "release", "over", "roll", "switch", "toggle", "button", "back", "close",
        "open", "select", "confirm", "error", "glass", "glitch", "drop", "scroll", "tick", "bong",
        "pluck", "question", "scratch", "maximize", "minimize", "hover",
    ];

    let mut tags: Vec<String> = Vec::new();
    // Strip the trailing index — `click_001` and `click3` are both "click".
    let trimmed = stem.trim_end_matches(|c: char| c.is_ascii_digit());
    for word in trimmed.split(['_', '-', ' ']).filter(|w| !w.is_empty()) {
        let word = word.trim_end_matches(|c: char| c.is_ascii_digit());
        if word.is_empty() {
            continue;
        }
        tags.push(word.to_string());
        // And whatever known parts it is built from.
        for part in PARTS {
            if word != *part && word.contains(part) {
                tags.push((*part).to_string());
            }
        }
    }
    tags.sort();
    tags.dedup();
    tags
}

impl Sound {
    /// Whether this sound answers to `query`. Case-insensitive, and matches a tag prefix so
    /// "conf" finds "confirmation" — a picker where you have to know the exact word is a list,
    /// not a search.
    pub fn matches(&self, query: &str) -> bool {
        let query = query.trim().to_lowercase();
        if query.is_empty() {
            return true;
        }
        query.split_whitespace().all(|term| {
            self.tags
                .iter()
                .any(|tag| tag.starts_with(term) || term.starts_with(tag.as_str()))
                || self.id.to_lowercase().contains(term)
        })
    }
}

/// Installed sounds matching `query`, best-guess ordering: shortest id first, so `click_001`
/// comes before `mouseclick1` for a search of "click".
pub fn search(root: &Path, query: &str) -> Vec<Sound> {
    let mut found: Vec<Sound> = installed(root)
        .into_iter()
        .filter(|sound| sound.matches(query))
        .collect();
    found.sort_by(|a, b| a.id.len().cmp(&b.id.len()).then_with(|| a.id.cmp(&b.id)));
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A pack laid out the way the real ones are: a subdirectory of audio, plus the files that
    /// come with it and are not sounds.
    fn fixture(tag: &str) -> PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("bay-sfx-library-{tag}-{stamp}"));
        let audio = root.join("kenney-interface").join("Audio");
        std::fs::create_dir_all(&audio).unwrap();
        for name in [
            "click_001.ogg",
            "click_002.ogg",
            "switch2.ogg",
            "mouseclick1.ogg",
            "confirmation_001.ogg",
            "error_004.ogg",
        ] {
            std::fs::write(audio.join(name), b"not really audio").unwrap();
        }
        // The things a real pack ships alongside its sounds.
        std::fs::write(root.join("kenney-interface").join("License.txt"), b"CC0").unwrap();
        std::fs::write(root.join("kenney-interface").join("Patreon.url"), b"[url]").unwrap();
        std::fs::write(
            root.join("kenney-interface").join("Preview.ogg"),
            b"a demo reel",
        )
        .unwrap();
        root
    }

    #[test]
    fn nothing_installed_is_an_empty_library_not_a_failure() {
        assert!(installed(Path::new("/tmp/bay-definitely-not-installed")).is_empty());
    }

    #[test]
    fn only_audio_files_are_indexed() {
        let root = fixture("indexing");
        let sounds = installed(&root);
        assert_eq!(sounds.len(), 6, "{sounds:#?}");
        assert!(
            !sounds.iter().any(|s| s.id.contains("License")),
            "a licence file is not a sound"
        );
        assert!(
            !sounds
                .iter()
                .any(|s| s.id.to_lowercase().contains("preview")),
            "a pack's demo reel is not a sound to place"
        );
    }

    #[test]
    fn ids_carry_their_pack_and_names_read() {
        let root = fixture("ids");
        let sound = installed(&root)
            .into_iter()
            .find(|s| s.id.ends_with("click_001"))
            .expect("the click");
        assert_eq!(sound.id, "kenney-interface/click_001");
        assert_eq!(sound.name, "click 001");
        assert_eq!(sound.pack, "kenney-interface");
    }

    /// The reason tags exist at all: pack filenames are terse and glued together, and a search
    /// for "click" has to find `mouseclick1`.
    #[test]
    fn a_compound_filename_is_findable_by_its_parts() {
        let root = fixture("compound");
        let found = search(&root, "click");
        let ids: Vec<&str> = found.iter().map(|s| s.id.as_str()).collect();
        assert!(ids.contains(&"kenney-interface/click_001"), "{ids:?}");
        assert!(ids.contains(&"kenney-interface/mouseclick1"), "{ids:?}");
        // And the plain one comes first.
        assert!(ids[0].ends_with("click_001"), "{ids:?}");
    }

    /// Numbered variants of the same sound are the same search result.
    #[test]
    fn a_trailing_index_is_not_part_of_the_name() {
        assert_eq!(tags_from_stem("click_001"), vec!["click"]);
        assert_eq!(tags_from_stem("switch2"), vec!["switch"]);
    }

    #[test]
    fn a_prefix_finds_the_whole_word() {
        let root = fixture("prefix");
        assert!(
            !search(&root, "conf").is_empty(),
            "searching 'conf' should find 'confirmation'"
        );
    }

    #[test]
    fn every_term_has_to_match() {
        let root = fixture("terms");
        assert!(!search(&root, "mouse click").is_empty());
        assert!(
            search(&root, "mouse error").is_empty(),
            "two terms means both, not either"
        );
    }

    #[test]
    fn an_empty_query_lists_everything() {
        let root = fixture("empty-query");
        assert_eq!(search(&root, "").len(), installed(&root).len());
    }
}
