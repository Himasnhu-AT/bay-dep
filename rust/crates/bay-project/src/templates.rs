//! Templates: a bundle of elements that lands on the timeline as one piece.
//!
//! A lower third, a kicker, an end card. The parts of a video that are the same shape every
//! time and only differ in their words — which is exactly the work an author should not be
//! redoing, and exactly the work an agent gets subtly wrong when it builds one from primitives.
//!
//! Two kinds, one format:
//!
//! - **Built-in** templates are code, like the looks. They exist on every machine, cannot go
//!   missing, and carry no licence.
//! - **Saved** templates are whatever the user made: select some clips, save, place again.
//!   These live in the library on disk. The motion presets that came before this were held in
//!   the editor window's memory and died with it — a preset you could use until you closed the
//!   app, which is not a preset.

use std::path::{Path, PathBuf};

use bay_time::MediaTime;
use serde::{Deserialize, Serialize};

use crate::element::{
    BlendMode, Element, ElementRole, ElementSource, ShapeElement, ShapeKind, TextAlign,
    TextElement, Transform,
};

/// A named bundle of elements, positioned relative to the template's own start.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub name: String,
    /// What it is for, in a sentence. This is what a picker shows and what an agent reads.
    pub description: String,
    /// The elements, with `start` measured from the template's own start rather than from the
    /// timeline's — so placing one at 4s does not require rewriting every time inside it.
    pub elements: Vec<Element>,
    /// Which element ids take the caller's words, in the order they should be filled. Anything
    /// not listed is decoration.
    #[serde(default)]
    pub text_slots: Vec<String>,
}

impl Template {
    /// How long the whole bundle runs.
    pub fn duration(&self) -> MediaTime {
        self.elements
            .iter()
            .map(|element| element.end())
            .max()
            .unwrap_or(MediaTime::ZERO)
    }

    /// The template's elements placed at `start`, with fresh ids and the given words dropped
    /// into its text slots.
    ///
    /// Ids are minted from `id_prefix` rather than kept, because a template placed twice would
    /// otherwise produce two elements sharing an id — and every later edit would address the
    /// wrong one.
    pub fn instantiate(&self, start: MediaTime, id_prefix: &str, words: &[String]) -> Vec<Element> {
        self.elements
            .iter()
            .enumerate()
            .map(|(index, element)| {
                let mut placed = element.clone();
                let original = element.id().to_string();
                placed.set_id(format!("{id_prefix}-{index}"));
                placed.set_start(MediaTime::from_ticks(
                    start.as_ticks() + element.start().as_ticks(),
                ));
                // Fill by slot order, not by element order: a template's second *slot* may be
                // its fourth element.
                if let Some(slot) = self.text_slots.iter().position(|slot| *slot == original)
                    && let Some(text) = words.get(slot)
                    && let Element::Text(target) = &mut placed
                {
                    target.content = text.clone();
                }
                placed
            })
            .collect()
    }
}

fn secs(seconds: f64) -> MediaTime {
    MediaTime::from_seconds_f64(seconds).unwrap_or(MediaTime::ZERO)
}

/// The type in a built-in template: what it says, when, how big, and where.
struct Line<'a> {
    id: &'a str,
    content: &'a str,
    start: f64,
    duration: f64,
    font_size: f32,
    color: &'a str,
    transform: Transform,
    align: TextAlign,
    /// What the line is for. A template knows this about its own slots — a lower third's first
    /// line is a headline and its second a kicker — so it says so rather than making whoever
    /// places it guess.
    role: ElementRole,
}

fn text_element(
    Line {
        id,
        content,
        start,
        duration,
        font_size,
        color,
        transform,
        align,
        role,
    }: Line<'_>,
) -> Element {
    Element::Text(TextElement {
        id: id.into(),
        name: id.into(),
        start: secs(start),
        duration: secs(duration),
        fade_in: secs(0.25),
        fade_out: secs(0.25),
        content: content.into(),
        font_size,
        color: color.into(),
        transform,
        effects: Vec::new(),
        animations: Default::default(),
        blend_mode: BlendMode::Normal,
        mask: None,
        font_family: None,
        font_weight: 700,
        align,
        letter_spacing: 0.0,
        line_height: 1.15,
        decorations: None,
        karaoke: None,
        source: ElementSource::Author,
        role,
    })
}

fn bar(
    id: &str,
    start: f64,
    duration: f64,
    color: &str,
    transform: Transform,
    role: ElementRole,
) -> Element {
    Element::Shape(ShapeElement {
        id: id.into(),
        name: id.into(),
        start: secs(start),
        duration: secs(duration),
        fade_in: secs(0.2),
        fade_out: secs(0.2),
        shape: ShapeKind::Rect { radius: 0.0 },
        color: color.into(),
        transform,
        effects: Vec::new(),
        animations: Default::default(),
        blend_mode: BlendMode::Normal,
        mask: None,
        source: ElementSource::Author,
        role,
    })
}

/// The templates bay ships with.
///
/// Deliberately few and deliberately plain. A template that imposes a strong look is one people
/// have to undo; these are correct placements with restrained type, which is the part that is
/// tedious to get right and easy to get wrong.
pub fn builtin_templates() -> Vec<Template> {
    let white = "#ffffff";
    vec![
        Template {
            id: "lower-third".into(),
            name: "Lower Third".into(),
            description: "A name and a role in the bottom-left, over a rule. The standard way \
                          to identify whoever is speaking."
                .into(),
            text_slots: vec!["name".into(), "role".into()],
            elements: vec![
                bar(
                    "rule",
                    0.0,
                    4.0,
                    white,
                    Transform {
                        x: 0.08,
                        y: 0.74,
                        scale: 0.34,
                        scale_y: 0.006,
                        anchor_x: 0.0,
                        anchor_y: 0.0,
                        ..Transform::default()
                    },
                    ElementRole::Chrome,
                ),
                text_element(Line {
                    id: "name",
                    content: "Name",
                    start: 0.1,
                    duration: 3.9,
                    font_size: 64.0,
                    color: white,
                    transform: Transform {
                        x: 0.08,
                        y: 0.76,
                        scale: 0.6,
                        anchor_x: 0.0,
                        anchor_y: 0.0,
                        ..Transform::default()
                    },
                    align: TextAlign::Left,
                    role: ElementRole::Headline,
                }),
                text_element(Line {
                    id: "role",
                    content: "Role",
                    start: 0.2,
                    duration: 3.8,
                    font_size: 38.0,
                    color: "#c9c9d4",
                    transform: Transform {
                        x: 0.08,
                        y: 0.83,
                        scale: 0.6,
                        anchor_x: 0.0,
                        anchor_y: 0.0,
                        ..Transform::default()
                    },
                    align: TextAlign::Left,
                    role: ElementRole::Kicker,
                }),
            ],
        },
        Template {
            id: "kicker".into(),
            name: "Kicker".into(),
            description: "A short line above a headline — a section marker or a category. \
                          Small, tracked out, sits above whatever follows it."
                .into(),
            text_slots: vec!["kicker".into(), "headline".into()],
            elements: vec![
                text_element(Line {
                    id: "kicker",
                    content: "SECTION",
                    start: 0.0,
                    duration: 3.0,
                    font_size: 30.0,
                    color: "#8a8a9a",
                    transform: Transform {
                        x: 0.5,
                        y: 0.38,
                        scale: 0.8,
                        ..Transform::default()
                    },
                    align: TextAlign::Center,
                    role: ElementRole::Kicker,
                }),
                text_element(Line {
                    id: "headline",
                    content: "Headline",
                    start: 0.15,
                    duration: 2.85,
                    font_size: 96.0,
                    color: white,
                    transform: Transform {
                        x: 0.5,
                        y: 0.46,
                        scale: 0.86,
                        ..Transform::default()
                    },
                    align: TextAlign::Center,
                    role: ElementRole::Headline,
                }),
            ],
        },
        Template {
            id: "end-card".into(),
            name: "End Card".into(),
            description: "A closing line and a call to action, centred, fading up from black. \
                          What goes after the last shot."
                .into(),
            text_slots: vec!["closing".into(), "cta".into()],
            elements: vec![
                text_element(Line {
                    id: "closing",
                    content: "Thanks for watching",
                    start: 0.0,
                    duration: 3.0,
                    font_size: 82.0,
                    color: white,
                    transform: Transform {
                        x: 0.5,
                        y: 0.44,
                        scale: 0.86,
                        ..Transform::default()
                    },
                    align: TextAlign::Center,
                    role: ElementRole::Lockup,
                }),
                text_element(Line {
                    id: "cta",
                    content: "@handle",
                    start: 0.35,
                    duration: 2.65,
                    font_size: 44.0,
                    color: "#c9c9d4",
                    transform: Transform {
                        x: 0.5,
                        y: 0.56,
                        scale: 0.8,
                        ..Transform::default()
                    },
                    align: TextAlign::Center,
                    role: ElementRole::Lockup,
                }),
            ],
        },
    ]
}

/// Templates the user saved, on disk.
///
/// One JSON file per template under the library, so a template can be copied to another machine
/// by copying a file, and a broken one cannot take the rest of the library down with it.
pub struct TemplateLibrary {
    root: PathBuf,
}

impl TemplateLibrary {
    pub fn with_root(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// The user's real template library, under bay's data directory.
    pub fn open_default() -> Option<Self> {
        bay_paths::data_dir().map(|data| Self::with_root(data.join("templates")))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Every template on disk, plus the built-ins.
    ///
    /// A file that will not parse is skipped rather than fatal: one bad template must not make
    /// the picker empty. Saved templates take precedence over a built-in of the same id, so a
    /// user can replace one they do not like.
    pub fn all(&self) -> Vec<Template> {
        let mut templates = builtin_templates();
        for saved in self.saved() {
            match templates.iter().position(|other| other.id == saved.id) {
                Some(index) => templates[index] = saved,
                None => templates.push(saved),
            }
        }
        templates
    }

    pub fn saved(&self) -> Vec<Template> {
        let Ok(entries) = std::fs::read_dir(&self.root) else {
            return Vec::new(); // nothing saved yet is not a failure
        };
        let mut saved: Vec<Template> = entries
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.path().extension().is_some_and(|e| e == "json"))
            .filter_map(|entry| std::fs::read_to_string(entry.path()).ok())
            .filter_map(|text| serde_json::from_str::<Template>(&text).ok())
            .collect();
        saved.sort_by(|a, b| a.id.cmp(&b.id));
        saved
    }

    pub fn get(&self, id: &str) -> Option<Template> {
        self.all().into_iter().find(|template| template.id == id)
    }

    /// Write a template to the library.
    pub fn save(&self, template: &Template) -> Result<PathBuf, String> {
        if template.id.trim().is_empty() || template.id.contains(['/', '\\', '.', ':']) {
            return Err(format!(
                "{:?} is not a usable template id — it becomes a filename, so no dots, colons \
                 or separators",
                template.id
            ));
        }
        std::fs::create_dir_all(&self.root)
            .map_err(|e| format!("could not create the template library: {e}"))?;
        let path = self.root.join(format!("{}.json", template.id));
        let text = serde_json::to_string_pretty(template)
            .map_err(|e| format!("could not serialise the template: {e}"))?;
        std::fs::write(&path, text).map_err(|e| format!("could not write {path:?}: {e}"))?;
        Ok(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn library(tag: &str) -> TemplateLibrary {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        TemplateLibrary::with_root(
            std::env::temp_dir().join(format!("bay-templates-{tag}-{stamp}")),
        )
    }

    #[test]
    fn every_builtin_is_well_formed() {
        for template in builtin_templates() {
            assert!(!template.elements.is_empty(), "{} is empty", template.id);
            assert!(template.duration() > MediaTime::ZERO, "{}", template.id);
            // Every named slot must resolve to a text element, or filling it silently does
            // nothing.
            for slot in &template.text_slots {
                let element = template
                    .elements
                    .iter()
                    .find(|element| element.id() == slot)
                    .unwrap_or_else(|| panic!("{} names a missing slot {slot}", template.id));
                assert!(
                    matches!(element, Element::Text(_)),
                    "{} slot {slot} is not text",
                    template.id
                );
            }
        }
    }

    /// Placing a template twice must not produce two elements sharing an id — every later edit
    /// would address the wrong one.
    #[test]
    fn placing_a_template_mints_fresh_ids_and_offsets_its_times() {
        let template = builtin_templates()
            .into_iter()
            .find(|t| t.id == "lower-third")
            .unwrap();
        let placed = template.instantiate(secs(4.0), "lt-1", &["Ada".into(), "Engineer".into()]);
        assert_eq!(placed.len(), template.elements.len());

        let ids: Vec<&str> = placed.iter().map(|e| e.id()).collect();
        assert!(ids.iter().all(|id| id.starts_with("lt-1-")), "{ids:?}");
        assert_eq!(
            ids.iter().collect::<std::collections::HashSet<_>>().len(),
            ids.len(),
            "ids must be unique"
        );

        // The rule starts at 0 inside the template, so it starts at 4s on the timeline.
        assert_eq!(placed[0].start(), secs(4.0));
        assert_eq!(placed[1].start(), secs(4.1));
    }

    #[test]
    fn words_land_in_their_slots_in_order() {
        let template = builtin_templates()
            .into_iter()
            .find(|t| t.id == "lower-third")
            .unwrap();
        let placed = template.instantiate(MediaTime::ZERO, "x", &["Ada".into(), "Engineer".into()]);
        let contents: Vec<&str> = placed
            .iter()
            .filter_map(|e| match e {
                Element::Text(text) => Some(text.content.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(contents, vec!["Ada", "Engineer"]);
    }

    /// Fewer words than slots leaves the rest at their placeholders rather than blanking them —
    /// an empty title is a `check` error, and a placeholder is a visible prompt to fill it.
    #[test]
    fn missing_words_leave_the_placeholder() {
        let template = builtin_templates()
            .into_iter()
            .find(|t| t.id == "lower-third")
            .unwrap();
        let placed = template.instantiate(MediaTime::ZERO, "x", &["Ada".into()]);
        let Element::Text(role) = &placed[2] else {
            panic!("the role slot is text")
        };
        assert_eq!(role.content, "Role");
    }

    #[test]
    fn a_saved_template_survives_a_round_trip() {
        let library = library("round-trip");
        let mut template = builtin_templates().remove(1);
        template.id = "my-kicker".into();
        template.name = "My Kicker".into();

        let path = library.save(&template).expect("saves");
        assert!(path.exists());
        assert_eq!(library.get("my-kicker"), Some(template));
        // And it appears alongside the built-ins rather than replacing them.
        assert!(library.all().len() > builtin_templates().len());
    }

    /// The id becomes a filename, so it cannot be a path.
    #[test]
    fn a_dangerous_id_is_refused() {
        let library = library("dangerous");
        let mut template = builtin_templates().remove(0);
        for bad in ["../escape", "with.dot", ""] {
            template.id = bad.into();
            assert!(
                library.save(&template).is_err(),
                "{bad:?} should be refused"
            );
        }
    }

    /// A saved template with a built-in's id replaces it: a user who does not like bay's lower
    /// third can have their own under the same name.
    #[test]
    fn a_saved_template_can_replace_a_builtin() {
        let library = library("replace");
        let mut template = builtin_templates().remove(0);
        template.name = "Mine".into();
        library.save(&template).expect("saves");

        assert_eq!(library.all().len(), builtin_templates().len());
        assert_eq!(library.get("lower-third").unwrap().name, "Mine");
    }

    /// One unreadable file must not empty the picker.
    #[test]
    fn a_broken_file_is_skipped_not_fatal() {
        let library = library("broken");
        std::fs::create_dir_all(library.root()).unwrap();
        std::fs::write(library.root().join("junk.json"), "{ not json").unwrap();
        assert_eq!(library.saved().len(), 0);
        assert_eq!(library.all().len(), builtin_templates().len());
    }
}
