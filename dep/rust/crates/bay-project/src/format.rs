//! What kind of video this is, and what that changes.
//!
//! bay's gating checks were written against one genre — composed motion graphics, where a beat
//! is built out of elements and consecutive beats are expected to carry something across the
//! seam. They are right for that and wrong for others. Cutting a two-camera conversation makes
//! `broken-continuity` fire on *every cut*, because a hard cut between locked-off angles shares
//! no element by design; the only way to export was `ignoreChecks` with a written reason, on
//! every render, which trains people to pass `ignoreChecks` without reading what it silenced.
//!
//! So the project says what it is, and the check set follows. Two rules keep this from becoming
//! a way to turn checks off:
//!
//! 1. **A format may only suspend a code it names a reason for.** The reason is in the registry,
//!    not typed at the call site, so it is reviewable in one place.
//! 2. **A suspended check still runs and still reports.** It is downgraded to a note carrying
//!    the format's reason — it stops *blocking* an export, it does not stop being *seen*. A
//!    check that vanishes is a check nobody can audit.
//!
//! Adding a format is adding a row here. What a format may eventually carry beyond suspensions
//! — which tools are worth offering, which templates, what a sensible canvas is — belongs in
//! this registry too, for the same reason: one place, reviewable.

use serde::{Deserialize, Serialize};

/// A named kind of video.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Format {
    /// Stable id, and what a project stores.
    pub id: &'static str,
    pub name: &'static str,
    /// What this format is, in one sentence, and who should pick it.
    pub note: &'static str,
    /// What it is built out of. Read by anything deciding which features to put in front of
    /// someone — a shape vocabulary is central to a composed film and irrelevant to a podcast.
    pub built_from: &'static [&'static str],
    /// `(code, why)` — the checks this format suspends, each with the reason it does not apply.
    pub suspends: &'static [(&'static str, &'static str)],
}

impl Format {
    /// Why this format suspends `code`, if it does.
    pub fn suspends(&self, code: &str) -> Option<&'static str> {
        self.suspends
            .iter()
            .find(|(name, _)| *name == code)
            .map(|(_, why)| *why)
    }
}

/// The default: every check applies. What a project is until it says otherwise.
pub const GENERAL: Format = Format {
    id: "general",
    name: "General",
    note: "No genre declared, so nothing is relaxed. Correct for anything composed, and the \
           right answer when you are not sure — a format that suspends a check you needed is \
           worse than an export you had to justify once.",
    built_from: &["text", "shapes", "images", "video", "audio"],
    suspends: &[],
};

/// Composed motion graphics: the genre the checks were written against.
pub const PRODUCT_FILM: Format = Format {
    id: "product-film",
    name: "Product film",
    note: "A launch or explainer film built out of type, shapes and interface mock-ups on a flat \
           canvas, cut to music. Nothing is suspended: this is the genre every gating check was \
           written for, so a continuity or response failure here is a real one.",
    built_from: &[
        "text",
        "shapes",
        "groups",
        "masks",
        "images",
        "music",
        "narration",
    ],
    suspends: &[],
};

/// Live action, several locked-off cameras, one conversation.
pub const MULTICAM_CONVERSATION: Format = Format {
    id: "multicam-conversation",
    name: "Multicam conversation",
    note: "An interview or podcast cut between two or more locked-off cameras, with a microphone \
           per speaker. The picture is a recording rather than a composition, so the checks that \
           read a frame as a built arrangement do not describe it.",
    built_from: &["video", "audio", "captions", "lower thirds"],
    suspends: &[
        (
            "broken-continuity",
            "a hard cut between locked-off angles of one conversation shares no element by \
             design — the room is continuous, the composition graph is not, and every \
             well-cut episode of this genre is hard cuts throughout",
        ),
        (
            "no-response",
            "nothing on screen answers an arrival because nothing arrives: the frame is a \
             camera angle, not an arrangement being added to",
        ),
        (
            "unreadable-dwell",
            "a caption under speech is read and heard at once, so it does not need the dwell a \
             standalone title does",
        ),
        (
            "no-hook",
            "the opening is a person beginning to talk, and the first line is the hook — there \
             is no built frame to carry one",
        ),
    ],
};

/// Portrait, no voice, archival stills cut to a beat grid.
pub const ARCHIVE_REEL: Format = Format {
    id: "archive-reel",
    name: "Archive reel",
    note: "Portrait, no narration, archival stills cut to a beat grid. Composed, so the craft \
           checks apply; see the skill's own reference for the numbers it wants.",
    built_from: &["images", "text", "music"],
    suspends: &[],
};

pub const FORMATS: &[Format] = &[GENERAL, PRODUCT_FILM, MULTICAM_CONVERSATION, ARCHIVE_REEL];

/// The format with this id, if it is one bay knows.
pub fn by_id(id: &str) -> Option<Format> {
    FORMATS.iter().copied().find(|format| format.id == id)
}

/// Every format id, for an error message that lists the alternatives.
pub fn ids() -> Vec<&'static str> {
    FORMATS.iter().map(|format| format.id).collect()
}

/// The format a project declared, or [`GENERAL`] if it declared none.
pub fn resolve(declared: Option<&str>) -> Format {
    declared.and_then(by_id).unwrap_or(GENERAL)
}

/// The id a project stores. A newtype only so serde has somewhere to hang a default.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct FormatId(pub String);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_resolvable() {
        let mut seen = std::collections::BTreeSet::new();
        for format in FORMATS {
            assert!(seen.insert(format.id), "duplicate format id {}", format.id);
            assert_eq!(by_id(format.id).map(|f| f.id), Some(format.id));
        }
        assert_eq!(by_id("no-such-format"), None);
    }

    /// A format may only suspend a code that exists, and must say why.
    ///
    /// The reason is the whole safeguard: a suspension with no reason is a check turned off,
    /// and the point of putting them in a registry is that somebody can read the list and
    /// disagree with it.
    #[test]
    fn every_suspension_carries_a_reason() {
        for format in FORMATS {
            for (code, why) in format.suspends {
                assert!(!code.is_empty(), "{}: empty code", format.id);
                assert!(
                    why.len() > 40,
                    "{} suspends {code} without saying why: {why:?}",
                    format.id
                );
            }
        }
    }

    #[test]
    fn an_undeclared_project_is_general_and_suspends_nothing() {
        assert_eq!(resolve(None).id, "general");
        assert_eq!(resolve(Some("not-a-format")).id, "general");
        assert!(GENERAL.suspends.is_empty());
        assert!(
            PRODUCT_FILM.suspends.is_empty(),
            "the origin genre relaxes nothing"
        );
        assert!(
            MULTICAM_CONVERSATION
                .suspends("broken-continuity")
                .is_some()
        );
        assert!(MULTICAM_CONVERSATION.suspends("missing-media").is_none());
    }
}
