//! How a project is filed: what stage it is at, and the labels the user put on it.
//!
//! Library metadata, not document content. It changes nothing about how a project renders — it
//! exists so a launcher full of work can be read at a glance, which is the difference between a
//! project list and a project drawer.
//!
//! Both fields are optional on the wire. A project written before this module existed loads
//! with no status and no tags, which is exactly right: nobody filed it.

use serde::{Deserialize, Serialize};

/// The stage a project is at.
///
/// A closed set rather than free text, because the point is a coloured dot the eye can scan.
/// Free-text statuses become forty variants of "in progress" within a month.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectStatus {
    /// Where every project starts, and where an unfiled one stays.
    #[default]
    InProgress,
    ClientReview,
    OnHold,
    Done,
}

impl ProjectStatus {
    /// Every status, in the order the picker shows them: the order work moves through.
    pub const ALL: [ProjectStatus; 4] = [
        ProjectStatus::InProgress,
        ProjectStatus::ClientReview,
        ProjectStatus::OnHold,
        ProjectStatus::Done,
    ];

    pub fn label(self) -> &'static str {
        match self {
            ProjectStatus::InProgress => "In progress",
            ProjectStatus::ClientReview => "Client review",
            ProjectStatus::OnHold => "On hold",
            ProjectStatus::Done => "Done",
        }
    }

    /// The dot colour, as `0xRRGGBB`.
    ///
    /// Held here rather than in the theme because it is a property of the status: "on hold" is
    /// grey in every skin, and a front end that picked its own would make two bay windows
    /// disagree about what amber means.
    pub fn color(self) -> u32 {
        match self {
            ProjectStatus::InProgress => 0x5b8cff,
            ProjectStatus::ClientReview => 0xf2b03c,
            ProjectStatus::OnHold => 0x8a8a9a,
            ProjectStatus::Done => 0x2f8f63,
        }
    }

    /// The wire spelling, for an agent that wants to set one.
    pub fn as_str(self) -> &'static str {
        match self {
            ProjectStatus::InProgress => "inProgress",
            ProjectStatus::ClientReview => "clientReview",
            ProjectStatus::OnHold => "onHold",
            ProjectStatus::Done => "done",
        }
    }

    /// Parse a status leniently: an agent writes "in progress", a config file writes
    /// "in-progress", the wire writes "inProgress". All three mean the same thing, and
    /// rejecting two of them would make the tool feel arbitrary.
    pub fn parse(value: &str) -> Option<Self> {
        let normalised: String = value
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .map(|c| c.to_ascii_lowercase())
            .collect();
        match normalised.as_str() {
            "inprogress" | "progress" => Some(ProjectStatus::InProgress),
            "clientreview" | "review" => Some(ProjectStatus::ClientReview),
            "onhold" | "hold" => Some(ProjectStatus::OnHold),
            "done" | "complete" | "finished" => Some(ProjectStatus::Done),
            _ => None,
        }
    }
}

/// Tag names offered in the picker. The user can type anything; these are the shortcuts.
pub const TAG_SUGGESTIONS: [&str; 5] = [
    "Priority",
    "Needs audio pass",
    "Colour locked",
    "Reel",
    "Archive",
];

/// The maximum length of a tag. Long enough for "Needs a second audio pass", short enough that
/// one tag cannot push every other one off a card.
pub const MAX_TAG_LEN: usize = 32;

/// Clean a tag the user typed. `None` if there is nothing left worth storing.
///
/// Whitespace collapses, because "Needs  audio" and "Needs audio" are the same tag and having
/// both makes the filter useless.
pub fn normalise_tag(raw: &str) -> Option<String> {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return None;
    }
    Some(collapsed.chars().take(MAX_TAG_LEN).collect())
}

/// The filing on one project.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Shelf {
    pub status: ProjectStatus,
    /// In the order the user added them. A set would sort them alphabetically, which moves a
    /// tag under the cursor as soon as another is added.
    pub tags: Vec<String>,
}

impl Shelf {
    pub fn has_tag(&self, tag: &str) -> bool {
        self.tags.iter().any(|existing| existing == tag)
    }

    /// Add a tag, cleaned. Returns whether anything changed — an empty or duplicate tag is not
    /// an error, it is a no-op the caller can ignore.
    pub fn add_tag(&mut self, raw: &str) -> bool {
        let Some(tag) = normalise_tag(raw) else {
            return false;
        };
        if self.has_tag(&tag) {
            return false;
        }
        self.tags.push(tag);
        true
    }

    pub fn remove_tag(&mut self, tag: &str) -> bool {
        let before = self.tags.len();
        self.tags.retain(|existing| existing != tag);
        self.tags.len() != before
    }

    /// Add if absent, remove if present. What clicking a suggestion does.
    pub fn toggle_tag(&mut self, raw: &str) -> bool {
        match normalise_tag(raw) {
            Some(tag) if self.has_tag(&tag) => {
                self.remove_tag(&tag);
                false
            }
            Some(tag) => {
                self.tags.push(tag);
                true
            }
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An unfiled project is "in progress" — the state everything starts in.
    #[test]
    fn the_default_shelf_is_in_progress_and_untagged() {
        let shelf = Shelf::default();
        assert_eq!(shelf.status, ProjectStatus::InProgress);
        assert!(shelf.tags.is_empty());
    }

    /// A project written before this existed must still load, and must not arrive with a tag
    /// nobody added.
    #[test]
    fn an_older_project_loads_with_an_empty_shelf() {
        let shelf: Shelf = serde_json::from_str("{}").unwrap();
        assert_eq!(shelf, Shelf::default());
    }

    #[test]
    fn every_status_has_a_distinct_label_colour_and_wire_name() {
        let mut labels: Vec<&str> = ProjectStatus::ALL.iter().map(|s| s.label()).collect();
        let mut colors: Vec<u32> = ProjectStatus::ALL.iter().map(|s| s.color()).collect();
        let mut wire: Vec<&str> = ProjectStatus::ALL.iter().map(|s| s.as_str()).collect();
        labels.sort_unstable();
        labels.dedup();
        colors.sort_unstable();
        colors.dedup();
        wire.sort_unstable();
        wire.dedup();
        assert_eq!(labels.len(), 4);
        assert_eq!(
            colors.len(),
            4,
            "two statuses sharing a dot colour is unreadable"
        );
        assert_eq!(wire.len(), 4);
    }

    /// The wire name must survive a round trip, or a status set by an agent reads back wrong.
    #[test]
    fn the_wire_name_round_trips_through_serde_and_parse() {
        for status in ProjectStatus::ALL {
            let json = serde_json::to_string(&status).unwrap();
            assert_eq!(json, format!("\"{}\"", status.as_str()));
            assert_eq!(
                serde_json::from_str::<ProjectStatus>(&json).unwrap(),
                status
            );
            assert_eq!(ProjectStatus::parse(status.as_str()), Some(status));
        }
    }

    #[test]
    fn statuses_parse_from_the_spellings_people_actually_write() {
        for spelling in ["in progress", "In-Progress", "inprogress", "progress"] {
            assert_eq!(
                ProjectStatus::parse(spelling),
                Some(ProjectStatus::InProgress),
                "{spelling}"
            );
        }
        assert_eq!(
            ProjectStatus::parse("client review"),
            Some(ProjectStatus::ClientReview)
        );
        assert_eq!(ProjectStatus::parse("finished"), Some(ProjectStatus::Done));
        assert_eq!(ProjectStatus::parse("shipped"), None);
        assert_eq!(ProjectStatus::parse(""), None);
    }

    #[test]
    fn tags_are_added_in_order_and_never_duplicated() {
        let mut shelf = Shelf::default();
        assert!(shelf.add_tag("Reel"));
        assert!(shelf.add_tag("Priority"));
        assert!(!shelf.add_tag("Reel"), "a duplicate is not a change");
        assert_eq!(shelf.tags, vec!["Reel", "Priority"]);
    }

    /// "Needs  audio" and "Needs audio" are the same tag; storing both makes filtering useless.
    #[test]
    fn whitespace_in_a_tag_collapses() {
        let mut shelf = Shelf::default();
        shelf.add_tag("  Needs   audio   pass \n");
        assert_eq!(shelf.tags, vec!["Needs audio pass"]);
        assert!(!shelf.add_tag("Needs audio pass"));
    }

    #[test]
    fn an_empty_tag_is_ignored_rather_than_stored() {
        let mut shelf = Shelf::default();
        assert!(!shelf.add_tag("   "));
        assert!(!shelf.toggle_tag(""));
        assert!(shelf.tags.is_empty());
    }

    /// One very long tag must not be able to push everything else off a card.
    #[test]
    fn a_tag_is_capped_in_length() {
        let mut shelf = Shelf::default();
        shelf.add_tag(&"x".repeat(200));
        assert_eq!(shelf.tags[0].chars().count(), MAX_TAG_LEN);
    }

    #[test]
    fn toggling_adds_then_removes() {
        let mut shelf = Shelf::default();
        assert!(shelf.toggle_tag("Priority"));
        assert!(shelf.has_tag("Priority"));
        assert!(!shelf.toggle_tag("Priority"));
        assert!(!shelf.has_tag("Priority"));
        assert!(
            !shelf.remove_tag("Priority"),
            "removing twice is not a change"
        );
    }

    #[test]
    fn suggestions_are_unique_and_survive_normalising() {
        let mut seen: Vec<&str> = TAG_SUGGESTIONS.to_vec();
        seen.sort_unstable();
        seen.dedup();
        assert_eq!(seen.len(), TAG_SUGGESTIONS.len());
        for suggestion in TAG_SUGGESTIONS {
            assert_eq!(normalise_tag(suggestion).as_deref(), Some(suggestion));
        }
    }

    #[test]
    fn a_shelf_round_trips_through_json() {
        let mut shelf = Shelf {
            status: ProjectStatus::OnHold,
            ..Shelf::default()
        };
        shelf.add_tag("Reel");
        let text = serde_json::to_string(&shelf).unwrap();
        assert_eq!(serde_json::from_str::<Shelf>(&text).unwrap(), shelf);
    }
}
