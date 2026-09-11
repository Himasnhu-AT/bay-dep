//! Pure presentation model: a snapshot of exactly what the editor UI needs to draw, derived
//! from `bay_core::Editor`. GPUI-free, so it is unit-testable without a window.
//!
//! [`HomeViewModel`] does the same job for the project launcher — the screen that opens before
//! any project does.

use std::time::SystemTime;

use bay_core::project::ProjectSummary;
use bay_core::{Background, Editor, Element, ElementRef};

/// What the launcher screen draws: one card per project in the library, newest first.
pub struct HomeViewModel {
    pub projects: Vec<ProjectCard>,
}

pub struct ProjectCard {
    pub id: String,
    pub name: String,
    /// "1080 × 1920 · 30 fps · 12 clips"
    pub detail: String,
    /// Timeline length as "m:ss".
    pub duration: String,
    /// How long ago it was last written, in words.
    pub modified: String,
    /// The stage the project is at, as the coloured chip draws it.
    pub status: bay_core::ProjectStatus,
    pub status_label: String,
    /// A literal colour, not a role.
    ///
    /// `ProjectStatus::color` lives in `bay-project` and says why: "on hold" is grey in every
    /// skin, and a front end picking its own would make two bay windows disagree about what
    /// amber means. That is the case `theme::Paint::Rgb` exists for — a colour that comes from
    /// the document rather than the design.
    pub status_color: crate::theme::Paint,
    /// The user's labels, in the order they added them.
    pub tags: Vec<String>,
    /// Whether the card can show a still. bay does not cache a poster frame today, so this is
    /// false everywhere; the card draws "no render yet" rather than a coloured gradient that
    /// looks like a thumbnail of footage nobody has seen.
    pub has_poster: bool,
}

impl HomeViewModel {
    /// "3 projects" — the line under the wordmark.
    pub fn count_label(&self) -> String {
        match self.projects.len() {
            0 => "No projects yet".to_string(),
            n => plural(n, "project"),
        }
    }

    pub fn build(summaries: &[ProjectSummary], now: SystemTime) -> Self {
        Self {
            projects: summaries
                .iter()
                .map(|summary| ProjectCard {
                    id: summary.id.clone(),
                    name: if summary.name.trim().is_empty() {
                        "Untitled".to_string()
                    } else {
                        summary.name.clone()
                    },
                    detail: {
                        let mut detail = format!(
                            "{} × {} · {} fps · {}",
                            summary.canvas.width,
                            summary.canvas.height,
                            format_fps(summary.fps),
                            plural(summary.element_count, "clip"),
                        );
                        // Only when there is more than one. "· 1 scene" on every card is noise
                        // that pushes the useful half of the line out of a narrow column.
                        if summary.scene_count > 1 {
                            detail.push_str(&format!(" · {} scenes", summary.scene_count));
                        }
                        detail
                    },
                    duration: format_duration(summary.duration_seconds),
                    modified: summary
                        .modified
                        .map(|at| format_since(at, now))
                        .unwrap_or_else(|| "—".to_string()),
                    status: summary.shelf.status,
                    status_label: summary.shelf.status.label().to_string(),
                    status_color: summary.shelf.status.color().into(),
                    tags: summary.shelf.tags.clone(),
                    has_poster: false,
                })
                .collect(),
        }
    }
}

/// "30" rather than "30.00", but "29.97" when the rate really is fractional.
fn format_fps(fps: f64) -> String {
    if (fps - fps.round()).abs() < 0.01 {
        format!("{}", fps.round() as i64)
    } else {
        format!("{fps:.2}")
    }
}

fn plural(count: usize, noun: &str) -> String {
    if count == 1 {
        format!("1 {noun}")
    } else {
        format!("{count} {noun}s")
    }
}

fn format_duration(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as i64;
    format!("{}:{:02}", total / 60, total % 60)
}

/// Relative time in words. Absolute dates would need a calendar dependency for something the
/// launcher only uses to sort recent work by feel.
fn format_since(at: SystemTime, now: SystemTime) -> String {
    let Ok(elapsed) = now.duration_since(at) else {
        return "just now".to_string(); // clock skew, or a file written "in the future"
    };
    let secs = elapsed.as_secs();
    match secs {
        0..=59 => "just now".to_string(),
        60..=3599 => plural((secs / 60) as usize, "minute") + " ago",
        3600..=86_399 => plural((secs / 3600) as usize, "hour") + " ago",
        _ => plural((secs / 86_400) as usize, "day") + " ago",
    }
}

/// A flattened view of the editor for one render pass.
pub struct EditorViewModel {
    pub project_name: String,
    pub canvas: (u32, u32),
    /// Solid background color hex, if the background is a color (not a blur).
    pub background_color: Option<String>,
    pub can_undo: bool,
    pub can_redo: bool,
    pub clipboard_len: usize,
    pub playhead_seconds: f64,
    pub duration_seconds: f64,
    pub scenes: Vec<SceneTab>,
    pub tracks: Vec<TrackRow>,
    /// The project's imported media. Empty until the user imports something — the panel shows
    /// what is actually in the project, never a sample list.
    pub media: Vec<MediaItem>,
    /// Points on the timeline the ruler draws, and that a drag snaps to.
    pub markers: Vec<MarkerPin>,
    pub preview_layers: Vec<PreviewLayer>,
    pub selected: Option<ElementInfo>,
}

/// A marker as the ruler needs it.
pub struct MarkerPin {
    pub id: String,
    pub seconds: f64,
    pub label: String,
}

/// One imported asset, as the media panel needs it.
pub struct MediaItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: bay_core::MediaKind,
}

/// The media panel's groups.
///
/// bay has no folders in the project format, so grouping by kind is what the library can
/// honestly offer: it is derived from the files themselves rather than from a hierarchy nobody
/// created. Inventing "Footage / Graphics / Audio" folders and then having no way to move
/// anything between them would be a directory tree that does not exist.
pub struct MediaFolder {
    pub name: &'static str,
    pub items: Vec<MediaItem>,
}

impl MediaFolder {
    /// Split a library into its kind groups, dropping the empty ones.
    ///
    /// Order is fixed — video, images, audio — so the panel does not reshuffle when the first
    /// file of a kind arrives.
    pub fn group(media: Vec<MediaItem>) -> Vec<MediaFolder> {
        use bay_core::MediaKind;
        const ORDER: [(MediaKind, &str); 3] = [
            (MediaKind::Video, "Video"),
            (MediaKind::Image, "Images"),
            (MediaKind::Audio, "Audio"),
        ];
        let mut remaining = media;
        let mut folders = Vec::new();
        for (kind, name) in ORDER {
            let (mine, rest): (Vec<_>, Vec<_>) =
                remaining.into_iter().partition(|item| item.kind == kind);
            remaining = rest;
            if !mine.is_empty() {
                folders.push(MediaFolder { name, items: mine });
            }
        }
        // Nothing should be left — the match above is exhaustive over MediaKind — but if a
        // variant is ever added, its files land in a group rather than vanishing from the panel.
        if !remaining.is_empty() {
            folders.push(MediaFolder {
                name: "Other",
                items: remaining,
            });
        }
        folders
    }
}

/// A visual element on screen at the current playhead, for the layout preview.
pub struct PreviewLayer {
    pub label: String,
    pub kind_label: String,
    pub x: f32,
    pub y: f32,
    pub scale: f32,
    pub opacity: f32,
}

pub struct SceneTab {
    pub id: String,
    pub name: String,
    pub active: bool,
}

pub struct TrackRow {
    pub id: String,
    pub name: String,
    pub kind_label: String,
    pub hidden: bool,
    pub muted: bool,
    pub elements: Vec<ElementBlock>,
}

pub struct ElementBlock {
    pub reference: ElementRef,
    pub label: String,
    pub kind_label: String,
    pub media_id: Option<String>,
    pub start_seconds: f64,
    pub duration_seconds: f64,
    pub selected: bool,
}

pub struct ElementInfo {
    pub reference: ElementRef,
    pub name: String,
    pub kind_label: String,
    pub start_seconds: f64,
    pub duration_seconds: f64,
    pub text_content: Option<String>,
    /// In-point into the source file, for clips that have one. `None` for titles, shapes and
    /// stills — there is nothing inside them to choose.
    pub source_start_seconds: Option<f64>,
    pub fade_in_seconds: f64,
    pub fade_out_seconds: f64,
    /// How long the source file is, when the project knows. `None` means nobody probed it.
    pub source_length_seconds: Option<f64>,
    pub transform: Option<bay_core::Transform>,
    /// How the element composites over lower layers (`None` for audio).
    pub blend_mode: Option<bay_core::BlendMode>,
    pub effects: Vec<EffectInfo>,
    pub animated_count: usize,
}

pub struct EffectInfo {
    pub id: String,
    pub effect_type: String,
    pub enabled: bool,
    pub amount: Option<f32>,
}

impl EditorViewModel {
    pub fn build(editor: &Editor) -> Self {
        let project = editor.project();
        let scene = editor.active_scene();

        let background_color = match &project.settings.background {
            Background::Color { color } => Some(color.clone()),
            Background::Blur { .. } => None,
        };

        let tracks = scene
            .tracks
            .iter()
            .map(|track| {
                let elements = track
                    .elements
                    .iter()
                    .map(|element| {
                        let reference = ElementRef::new(track.id.clone(), element.id().to_string());
                        let media_id = match element {
                            bay_core::Element::Video(v) => Some(v.media_id.clone()),
                            bay_core::Element::Image(i) => Some(i.media_id.clone()),
                            bay_core::Element::Audio(a) => Some(a.media_id.clone()),
                            bay_core::Element::Text(_) => None,
                            bay_core::Element::Shape(_) => None,
                        };
                        ElementBlock {
                            selected: editor.is_selected(&reference),
                            reference,
                            label: element.name().to_string(),
                            kind_label: element.kind().label().to_string(),
                            media_id,
                            start_seconds: element.start().to_seconds_f64(),
                            duration_seconds: element.duration().to_seconds_f64(),
                        }
                    })
                    .collect();
                TrackRow {
                    id: track.id.clone(),
                    name: track.name.clone(),
                    kind_label: format!("{:?}", track.kind),
                    hidden: track.hidden,
                    muted: track.muted,
                    elements,
                }
            })
            .collect();

        // Visual elements on screen at the playhead, main lane first (bottom), overlay on top.
        let playhead = editor.playhead();
        let mut preview_layers = Vec::new();
        for track in std::iter::once(&scene.tracks.main).chain(scene.tracks.overlay.iter()) {
            if track.hidden {
                continue;
            }
            for element in &track.elements {
                let Some(transform) = element.transform() else {
                    continue;
                };
                if element.start() <= playhead && playhead < element.end() {
                    preview_layers.push(PreviewLayer {
                        label: element.name().to_string(),
                        kind_label: element.kind().label().to_string(),
                        x: transform.x,
                        y: transform.y,
                        scale: transform.scale,
                        opacity: transform.opacity,
                    });
                }
            }
        }

        let selected = editor.selected_element().and_then(|element| {
            let reference = editor.selection().first()?.clone();
            let text_content = match element {
                Element::Text(text) => Some(text.content.clone()),
                _ => None,
            };
            Some(ElementInfo {
                reference,
                name: element.name().to_string(),
                kind_label: element.kind().label().to_string(),
                start_seconds: element.start().to_seconds_f64(),
                duration_seconds: element.duration().to_seconds_f64(),
                text_content,
                source_start_seconds: element.source_start().map(|t| t.to_seconds_f64()),
                fade_in_seconds: element.fade_in().to_seconds_f64(),
                fade_out_seconds: element.fade_out().to_seconds_f64(),
                source_length_seconds: element
                    .media_id()
                    .and_then(|id| project.media.iter().find(|asset| asset.id == id))
                    .and_then(|asset| asset.duration_seconds),
                transform: element.transform(),
                blend_mode: element.blend_mode(),
                effects: element
                    .effects()
                    .iter()
                    .map(|effect| EffectInfo {
                        id: effect.id.clone(),
                        effect_type: effect.effect_type.clone(),
                        enabled: effect.enabled,
                        amount: effect.params.get("amount").copied(),
                    })
                    .collect(),
                animated_count: element.animated_property_count(),
            })
        });

        Self {
            project_name: project.metadata.name.clone(),
            canvas: (
                project.settings.canvas.width,
                project.settings.canvas.height,
            ),
            background_color,
            can_undo: editor.can_undo(),
            can_redo: editor.can_redo(),
            clipboard_len: editor.clipboard_len(),
            playhead_seconds: editor.playhead().to_seconds_f64(),
            duration_seconds: editor.duration().to_seconds_f64(),
            scenes: editor
                .scenes()
                .iter()
                .map(|scene| SceneTab {
                    id: scene.id.clone(),
                    name: scene.name.clone(),
                    active: scene.id == editor.active_scene_id(),
                })
                .collect(),
            tracks,
            media: project
                .media
                .iter()
                .map(|asset| MediaItem {
                    id: asset.id.clone(),
                    name: asset.name.clone(),
                    path: asset.path.clone(),
                    kind: bay_core::MediaKind::of_path(&asset.path),
                })
                .collect(),
            markers: scene
                .markers
                .iter()
                .map(|marker| MarkerPin {
                    id: marker.id.clone(),
                    seconds: marker.time.to_seconds_f64(),
                    label: marker.label.clone(),
                })
                .collect(),
            preview_layers,
            selected,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bay_core::Command;

    #[test]
    fn starter_maps_to_three_tracks_and_no_selection() {
        let vm = EditorViewModel::build(&Editor::starter());
        assert_eq!(vm.project_name, "Untitled");
        assert_eq!(vm.canvas, (1920, 1080));
        assert_eq!(vm.background_color.as_deref(), Some("#000000"));
        assert_eq!(vm.tracks.len(), 3);

        let main = vm.tracks.iter().find(|t| t.id == "track-main").unwrap();
        assert_eq!(main.elements.len(), 2);
        assert_eq!(main.elements[0].label, "Title");
        assert_eq!(main.elements[0].duration_seconds, 3.0);
        assert!(vm.selected.is_none());
        assert!(!vm.can_undo);
    }

    #[test]
    fn selecting_an_element_populates_the_inspector_view() {
        let mut editor = Editor::starter();
        editor.select(vec![ElementRef::new("track-main", "el-title")]);

        let vm = EditorViewModel::build(&editor);
        let selected = vm.selected.expect("a selection");
        assert_eq!(selected.kind_label, "Text");
        assert_eq!(selected.text_content.as_deref(), Some("Hello, bay"));
        assert!(vm
            .tracks
            .iter()
            .flat_map(|t| &t.elements)
            .any(|b| b.selected && b.label == "Title"));
    }

    /// The media panel lists this. A project nobody has imported into has an empty library, and
    /// the panel must show that rather than a sample list of files the user never added.
    #[test]
    fn the_media_library_holds_only_what_was_imported() {
        let mut editor = Editor::starter();
        assert!(EditorViewModel::build(&editor).media.is_empty());

        editor.add_media(bay_core::MediaAsset::new(
            "media-1",
            "bed.mp3",
            "/tmp/bed.mp3",
        ));
        let media = EditorViewModel::build(&editor).media;
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].name, "bed.mp3");
        assert_eq!(media[0].kind, bay_core::MediaKind::Audio);
    }

    #[test]
    fn exposes_playhead_and_content_duration() {
        let mut editor = Editor::starter();
        let vm = EditorViewModel::build(&editor);
        assert_eq!(vm.playhead_seconds, 0.0);
        assert!(vm.duration_seconds >= 7.0); // the starter music clip runs 0..7s

        editor.seek(bay_core::MediaTime::from_ticks(120_000)); // 1s
        assert_eq!(EditorViewModel::build(&editor).playhead_seconds, 1.0);
    }

    #[test]
    fn scenes_map_to_tabs_with_the_active_one_flagged() {
        let mut editor = Editor::starter();
        editor.execute(Command::AddScene {
            id: "s2".into(),
            name: "Scene 2".into(),
        });
        let vm = EditorViewModel::build(&editor);
        assert_eq!(vm.scenes.len(), 2);
        assert!(
            vm.scenes
                .iter()
                .find(|s| s.id == "scene-main")
                .unwrap()
                .active
        );

        editor.switch_scene("s2");
        let vm = EditorViewModel::build(&editor);
        assert!(vm.scenes.iter().find(|s| s.id == "s2").unwrap().active);
        assert!(
            !vm.scenes
                .iter()
                .find(|s| s.id == "scene-main")
                .unwrap()
                .active
        );
    }

    fn summary(name: &str, seconds_ago: u64) -> ProjectSummary {
        ProjectSummary {
            id: format!("id-{name}"),
            name: name.into(),
            path: std::path::PathBuf::from("/tmp").join(name),
            modified: Some(SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000))
                .map(|t| t - std::time::Duration::from_secs(seconds_ago)),
            canvas: bay_core::CanvasSize {
                width: 1080,
                height: 1920,
            },
            fps: 30.0,
            duration_seconds: 92.0,
            scene_count: 1,
            element_count: 3,
            shelf: Default::default(),
        }
    }

    fn now() -> SystemTime {
        SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000)
    }

    /// The card's chip. An unfiled project reads as "in progress" rather than as unlabelled.
    #[test]
    fn a_card_carries_the_projects_filing() {
        let mut filed = summary("Reel", 0);
        filed.shelf.status = bay_core::ProjectStatus::ClientReview;
        filed.shelf.add_tag("Priority");
        filed.shelf.add_tag("Reel");

        let card = &HomeViewModel::build(&[filed], now()).projects[0];
        assert_eq!(card.status_label, "Client review");
        assert_eq!(
            card.status_color,
            crate::theme::Paint::Rgb(bay_core::ProjectStatus::ClientReview.color())
        );
        assert_eq!(card.tags, vec!["Priority", "Reel"]);

        let plain = &HomeViewModel::build(&[summary("Reel", 0)], now()).projects[0];
        assert_eq!(plain.status_label, "In progress");
        assert!(plain.tags.is_empty());
    }

    /// bay caches no poster frame, so no card may claim one. A gradient in that slot would read
    /// as a still from footage nobody has rendered.
    #[test]
    fn no_card_claims_a_thumbnail_bay_does_not_have() {
        let card = &HomeViewModel::build(&[summary("Reel", 0)], now()).projects[0];
        assert!(!card.has_poster);
    }

    /// "· 1 scene" on every card is noise; more than one is information.
    #[test]
    fn the_scene_count_appears_only_when_there_is_more_than_one() {
        let single = &HomeViewModel::build(&[summary("Reel", 0)], now()).projects[0];
        assert!(!single.detail.contains("scene"), "{}", single.detail);

        let mut many = summary("Reel", 0);
        many.scene_count = 3;
        let card = &HomeViewModel::build(&[many], now()).projects[0];
        assert!(card.detail.ends_with("· 3 scenes"), "{}", card.detail);
    }

    #[test]
    fn the_count_line_reads_naturally_at_zero_one_and_many() {
        assert_eq!(
            HomeViewModel::build(&[], now()).count_label(),
            "No projects yet"
        );
        assert_eq!(
            HomeViewModel::build(&[summary("A", 0)], now()).count_label(),
            "1 project"
        );
        assert_eq!(
            HomeViewModel::build(&[summary("A", 0), summary("B", 0)], now()).count_label(),
            "2 projects"
        );
    }

    fn asset(name: &str) -> MediaItem {
        MediaItem {
            id: format!("m-{name}"),
            name: name.to_string(),
            path: format!("/tmp/{name}"),
            kind: bay_core::MediaKind::of_path(name),
        }
    }

    /// The panel groups by what the files are, in a fixed order, and never shows an empty group.
    #[test]
    fn media_groups_by_kind_in_a_stable_order() {
        let folders = MediaFolder::group(vec![
            asset("bed.mp3"),
            asset("b-roll.mp4"),
            asset("logo.png"),
            asset("skyline.mov"),
        ]);
        let names: Vec<&str> = folders.iter().map(|folder| folder.name).collect();
        assert_eq!(names, vec!["Video", "Images", "Audio"]);
        assert_eq!(folders[0].items.len(), 2, "both videos in one group");
        assert_eq!(folders[2].items[0].name, "bed.mp3");
    }

    /// An empty group is a heading with nothing under it — worse than no heading.
    #[test]
    fn an_empty_kind_gets_no_group() {
        let folders = MediaFolder::group(vec![asset("bed.mp3")]);
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].name, "Audio");
        assert!(MediaFolder::group(Vec::new()).is_empty());
    }

    /// Grouping must not lose a file. A library that silently drops one is a file the user
    /// imported and can never place.
    #[test]
    fn grouping_keeps_every_file() {
        let library = vec![
            asset("a.mp4"),
            asset("b.png"),
            asset("c.wav"),
            asset("d.weirdextension"),
        ];
        let total = library.len();
        let folders = MediaFolder::group(library);
        assert_eq!(
            folders
                .iter()
                .map(|folder| folder.items.len())
                .sum::<usize>(),
            total
        );
    }

    #[test]
    fn home_cards_describe_each_project() {
        let vm = HomeViewModel::build(&[summary("Reel", 0)], now());
        let card = &vm.projects[0];
        assert_eq!(card.name, "Reel");
        assert_eq!(card.detail, "1080 × 1920 · 30 fps · 3 clips");
        assert_eq!(card.duration, "1:32");
        assert_eq!(card.modified, "just now");
    }

    #[test]
    fn home_cards_report_age_in_words() {
        let ages = [
            (90, "1 minute ago"),
            (7200, "2 hours ago"),
            (172_800, "2 days ago"),
        ];
        for (seconds, expected) in ages {
            let vm = HomeViewModel::build(&[summary("P", seconds)], now());
            assert_eq!(vm.projects[0].modified, expected, "at {seconds}s");
        }
    }

    #[test]
    fn an_unnamed_project_still_shows_a_name() {
        let mut blank = summary("Reel", 0);
        blank.name = "   ".into();
        let vm = HomeViewModel::build(&[blank], now());
        assert_eq!(vm.projects[0].name, "Untitled");
    }

    #[test]
    fn a_fractional_frame_rate_keeps_its_decimals() {
        let mut ntsc = summary("Reel", 0);
        ntsc.fps = 30000.0 / 1001.0;
        ntsc.element_count = 1;
        let vm = HomeViewModel::build(&[ntsc], now());
        assert_eq!(vm.projects[0].detail, "1080 × 1920 · 29.97 fps · 1 clip");
    }

    #[test]
    fn undo_availability_reflects_history() {
        let mut editor = Editor::starter();
        editor.execute(Command::RenameElement {
            reference: ElementRef::new("track-main", "el-title"),
            name: "X".into(),
        });
        assert!(EditorViewModel::build(&editor).can_undo);
    }
}
