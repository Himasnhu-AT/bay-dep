//! Pure presentation model: a snapshot of exactly what the editor UI needs to draw, derived
//! from `opencut_core::Editor`. GPUI-free, so it is unit-testable without a window.

use opencut_core::{Background, Editor, Element, ElementRef};

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
    pub tracks: Vec<TrackRow>,
    pub selected: Option<ElementInfo>,
}

pub struct TrackRow {
    pub id: String,
    pub name: String,
    pub kind_label: String,
    pub elements: Vec<ElementBlock>,
}

pub struct ElementBlock {
    pub reference: ElementRef,
    pub label: String,
    pub kind_label: String,
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
                        let reference =
                            ElementRef::new(track.id.clone(), element.id().to_string());
                        ElementBlock {
                            selected: editor.is_selected(&reference),
                            reference,
                            label: element.name().to_string(),
                            kind_label: element.kind().label().to_string(),
                            start_seconds: element.start().to_seconds_f64(),
                            duration_seconds: element.duration().to_seconds_f64(),
                        }
                    })
                    .collect();
                TrackRow {
                    id: track.id.clone(),
                    name: track.name.clone(),
                    kind_label: format!("{:?}", track.kind),
                    elements,
                }
            })
            .collect();

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
            })
        });

        Self {
            project_name: project.metadata.name.clone(),
            canvas: (project.settings.canvas.width, project.settings.canvas.height),
            background_color,
            can_undo: editor.can_undo(),
            can_redo: editor.can_redo(),
            clipboard_len: editor.clipboard_len(),
            playhead_seconds: editor.playhead().to_seconds_f64(),
            duration_seconds: editor.duration().to_seconds_f64(),
            tracks,
            selected,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use opencut_core::Command;

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
        assert_eq!(selected.text_content.as_deref(), Some("Hello, vii"));
        assert!(
            vm.tracks
                .iter()
                .flat_map(|t| &t.elements)
                .any(|b| b.selected && b.label == "Title")
        );
    }

    #[test]
    fn exposes_playhead_and_content_duration() {
        let mut editor = Editor::starter();
        let vm = EditorViewModel::build(&editor);
        assert_eq!(vm.playhead_seconds, 0.0);
        assert!(vm.duration_seconds >= 7.0); // the starter music clip runs 0..7s

        editor.seek(opencut_core::MediaTime::from_ticks(120_000)); // 1s
        assert_eq!(EditorViewModel::build(&editor).playhead_seconds, 1.0);
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
