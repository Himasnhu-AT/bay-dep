//! The command surface and the reversible patch model behind undo/redo.
//!
//! A serde-tagged [`Command`] is the caller-facing edit. It *lowers* against current state into
//! one or more [`ProjectPatch`]es (the concrete, replayable document mutations) plus an optional
//! selection change. Each `ProjectPatch::apply` mutates the project **and returns its own
//! inverse**, so history is just two patch lists (forward for redo, inverse for undo).

use serde::{Deserialize, Serialize};

use opencut_project::{Element, ElementRef, MediaTime, Track, TrackKind};

use crate::selection::SelectionPatch;
use crate::state::EditorState;

/// Which addable/removable lane a track lives in (the `main` lane is fixed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrackLane {
    Overlay,
    Audio,
}

impl TrackLane {
    fn track_kind(self) -> TrackKind {
        match self {
            TrackLane::Overlay => TrackKind::Overlay,
            TrackLane::Audio => TrackKind::Audio,
        }
    }
}

/// A caller-submitted edit. This enum is the undo/redo unit, the autosave/replay log entry, and
/// the future MCP tool surface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Command {
    /// Set the element selection (declares a selection override → undo restores prior selection).
    SetSelection { elements: Vec<ElementRef> },
    /// Append an element to a track; optionally select it.
    AddElement {
        track_id: String,
        element: Element,
        select: bool,
    },
    /// Remove an element; if it was selected, the selection is cleared (override).
    RemoveElement { reference: ElementRef },
    /// Move an element's start time.
    MoveElement {
        reference: ElementRef,
        start: MediaTime,
    },
    /// Set an element's duration.
    SetElementDuration {
        reference: ElementRef,
        duration: MediaTime,
    },
    /// Rename an element.
    RenameElement { reference: ElementRef, name: String },
    /// Set a text element's content (no-op for non-text elements).
    SetTextContent { reference: ElementRef, content: String },
    /// Add an empty overlay/audio track.
    AddTrack {
        lane: TrackLane,
        id: String,
        name: String,
    },
    /// Remove an overlay/audio track (the main lane cannot be removed).
    RemoveTrack { track_id: String },
    /// Paste the clipboard elements onto the main track and select them (ids are minted).
    Paste,
}

/// The kind label carried into history (diagnostics).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandKind {
    SetSelection,
    AddElement,
    RemoveElement,
    MoveElement,
    SetElementDuration,
    RenameElement,
    SetTextContent,
    AddTrack,
    RemoveTrack,
    Paste,
}

/// A concrete, self-inverting document mutation.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ProjectPatch {
    Noop,
    InsertElement {
        track_id: String,
        index: usize,
        element: Element,
    },
    RemoveElement {
        track_id: String,
        element_id: String,
    },
    SetElementStart {
        reference: ElementRef,
        start: MediaTime,
    },
    SetElementDuration {
        reference: ElementRef,
        duration: MediaTime,
    },
    SetElementName {
        reference: ElementRef,
        name: String,
    },
    SetTextContent {
        reference: ElementRef,
        content: String,
    },
    AddTrack {
        lane: TrackLane,
        index: usize,
        track: Track,
    },
    RemoveTrack {
        lane: TrackLane,
        track_id: String,
    },
}

impl ProjectPatch {
    /// Apply to the active scene, returning the inverse patch (or `Noop` if nothing changed).
    pub(crate) fn apply(self, project: &mut opencut_project::Project) -> ProjectPatch {
        let scene = project.active_scene_mut();
        match self {
            ProjectPatch::Noop => ProjectPatch::Noop,
            ProjectPatch::InsertElement {
                track_id,
                index,
                element,
            } => {
                let element_id = element.id().to_string();
                match scene.tracks.track_mut(&track_id) {
                    Some(track) => {
                        let idx = index.min(track.elements.len());
                        track.elements.insert(idx, element);
                        ProjectPatch::RemoveElement {
                            track_id,
                            element_id,
                        }
                    }
                    None => ProjectPatch::Noop,
                }
            }
            ProjectPatch::RemoveElement {
                track_id,
                element_id,
            } => {
                if let Some(track) = scene.tracks.track_mut(&track_id) {
                    if let Some(pos) = track.elements.iter().position(|e| e.id() == element_id) {
                        let element = track.elements.remove(pos);
                        return ProjectPatch::InsertElement {
                            track_id,
                            index: pos,
                            element,
                        };
                    }
                }
                ProjectPatch::Noop
            }
            ProjectPatch::SetElementStart { reference, start } => {
                match scene.element_mut(&reference) {
                    Some(element) => {
                        let previous = element.start();
                        element.set_start(start);
                        ProjectPatch::SetElementStart {
                            reference,
                            start: previous,
                        }
                    }
                    None => ProjectPatch::Noop,
                }
            }
            ProjectPatch::SetElementDuration {
                reference,
                duration,
            } => match scene.element_mut(&reference) {
                Some(element) => {
                    let previous = element.duration();
                    element.set_duration(duration);
                    ProjectPatch::SetElementDuration {
                        reference,
                        duration: previous,
                    }
                }
                None => ProjectPatch::Noop,
            },
            ProjectPatch::SetElementName { reference, name } => {
                match scene.element_mut(&reference) {
                    Some(element) => {
                        let previous = element.name().to_string();
                        element.set_name(name);
                        ProjectPatch::SetElementName {
                            reference,
                            name: previous,
                        }
                    }
                    None => ProjectPatch::Noop,
                }
            }
            ProjectPatch::SetTextContent { reference, content } => {
                match scene.element_mut(&reference) {
                    Some(Element::Text(text)) => {
                        let previous = std::mem::replace(&mut text.content, content);
                        ProjectPatch::SetTextContent {
                            reference,
                            content: previous,
                        }
                    }
                    _ => ProjectPatch::Noop,
                }
            }
            ProjectPatch::AddTrack { lane, index, track } => {
                let track_id = track.id.clone();
                let lane_tracks = match lane {
                    TrackLane::Overlay => &mut scene.tracks.overlay,
                    TrackLane::Audio => &mut scene.tracks.audio,
                };
                let idx = index.min(lane_tracks.len());
                lane_tracks.insert(idx, track);
                ProjectPatch::RemoveTrack { lane, track_id }
            }
            ProjectPatch::RemoveTrack { lane, track_id } => {
                let lane_tracks = match lane {
                    TrackLane::Overlay => &mut scene.tracks.overlay,
                    TrackLane::Audio => &mut scene.tracks.audio,
                };
                if let Some(pos) = lane_tracks.iter().position(|t| t.id == track_id) {
                    let track = lane_tracks.remove(pos);
                    return ProjectPatch::AddTrack {
                        lane,
                        index: pos,
                        track,
                    };
                }
                ProjectPatch::Noop
            }
        }
    }
}

/// A command resolved against current state into concrete patches + selection intent.
pub(crate) struct Lowered {
    pub kind: CommandKind,
    pub forward: Vec<ProjectPatch>,
    pub selection_patch: Option<SelectionPatch>,
}

impl Command {
    /// Resolve against `state`. Returns `None` for a no-op (unknown target, wrong element kind,
    /// nothing to do) so the executor records no history and emits no event. `Paste` is resolved
    /// in the editor (it mints fresh ids) and is a no-op here.
    pub(crate) fn lower(&self, state: &EditorState) -> Option<Lowered> {
        let scene = state.project.active_scene();
        match self {
            Command::SetSelection { elements } => Some(Lowered {
                kind: CommandKind::SetSelection,
                forward: Vec::new(),
                selection_patch: Some(SelectionPatch::select_elements(elements.clone())),
            }),

            Command::AddElement {
                track_id,
                element,
                select,
            } => {
                let index = scene.tracks.track(track_id)?.elements.len();
                let selection_patch = select.then(|| {
                    SelectionPatch::select_elements(vec![ElementRef::new(
                        track_id.clone(),
                        element.id().to_string(),
                    )])
                });
                Some(Lowered {
                    kind: CommandKind::AddElement,
                    forward: vec![ProjectPatch::InsertElement {
                        track_id: track_id.clone(),
                        index,
                        element: element.clone(),
                    }],
                    selection_patch,
                })
            }

            Command::RemoveElement { reference } => {
                scene.element(reference)?; // must exist
                let selection_patch = state
                    .selection
                    .elements
                    .contains(reference)
                    .then(|| SelectionPatch::select_elements(Vec::new()));
                Some(Lowered {
                    kind: CommandKind::RemoveElement,
                    forward: vec![ProjectPatch::RemoveElement {
                        track_id: reference.track_id.clone(),
                        element_id: reference.element_id.clone(),
                    }],
                    selection_patch,
                })
            }

            Command::MoveElement { reference, start } => {
                scene.element(reference)?;
                Some(Lowered {
                    kind: CommandKind::MoveElement,
                    forward: vec![ProjectPatch::SetElementStart {
                        reference: reference.clone(),
                        start: *start,
                    }],
                    selection_patch: None,
                })
            }

            Command::SetElementDuration {
                reference,
                duration,
            } => {
                scene.element(reference)?;
                Some(Lowered {
                    kind: CommandKind::SetElementDuration,
                    forward: vec![ProjectPatch::SetElementDuration {
                        reference: reference.clone(),
                        duration: *duration,
                    }],
                    selection_patch: None,
                })
            }

            Command::RenameElement { reference, name } => {
                scene.element(reference)?;
                Some(Lowered {
                    kind: CommandKind::RenameElement,
                    forward: vec![ProjectPatch::SetElementName {
                        reference: reference.clone(),
                        name: name.clone(),
                    }],
                    selection_patch: None,
                })
            }

            Command::SetTextContent { reference, content } => {
                // Only valid for text elements.
                matches!(scene.element(reference), Some(Element::Text(_))).then_some(())?;
                Some(Lowered {
                    kind: CommandKind::SetTextContent,
                    forward: vec![ProjectPatch::SetTextContent {
                        reference: reference.clone(),
                        content: content.clone(),
                    }],
                    selection_patch: None,
                })
            }

            Command::AddTrack { lane, id, name } => {
                let index = match lane {
                    TrackLane::Overlay => scene.tracks.overlay.len(),
                    TrackLane::Audio => scene.tracks.audio.len(),
                };
                Some(Lowered {
                    kind: CommandKind::AddTrack,
                    forward: vec![ProjectPatch::AddTrack {
                        lane: *lane,
                        index,
                        track: Track::new(id.clone(), name.clone(), lane.track_kind()),
                    }],
                    selection_patch: None,
                })
            }

            Command::RemoveTrack { track_id } => {
                let lane = if scene.tracks.overlay.iter().any(|t| &t.id == track_id) {
                    TrackLane::Overlay
                } else if scene.tracks.audio.iter().any(|t| &t.id == track_id) {
                    TrackLane::Audio
                } else {
                    return None; // main lane or unknown → not removable
                };
                let selection_patch = state
                    .selection
                    .elements
                    .iter()
                    .any(|reference| &reference.track_id == track_id)
                    .then(|| SelectionPatch::select_elements(Vec::new()));
                Some(Lowered {
                    kind: CommandKind::RemoveTrack,
                    forward: vec![ProjectPatch::RemoveTrack {
                        lane,
                        track_id: track_id.clone(),
                    }],
                    selection_patch,
                })
            }

            Command::Paste => None, // resolved in Editor::execute (mints ids)
        }
    }
}
