//! The command surface and the reversible patch model behind undo/redo.
//!
//! A serde-tagged [`Command`] is the caller-facing edit. It *lowers* against current state into
//! one or more [`ProjectPatch`]es (the concrete, replayable document mutations) plus an optional
//! selection change. Each `ProjectPatch::apply` mutates the project **and returns its own
//! inverse**, so history is just two patch lists (forward for redo, inverse for undo).

use serde::{Deserialize, Serialize};

use opencut_project::{
    AnimationChannel, Effect, Element, ElementKind, ElementRef, MediaTime, Project, Scene, Track,
    TrackKind, Transform,
};

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
    /// Split an element into two at `at` (must be strictly inside the element); the right part
    /// becomes a new element with id `new_id`, which is selected.
    SplitElement {
        reference: ElementRef,
        at: MediaTime,
        new_id: String,
    },
    /// Set an element's start and duration together (a timeline edge-trim), as one undo step.
    TrimElement {
        reference: ElementRef,
        start: MediaTime,
        duration: MediaTime,
    },
    /// Rename an element.
    RenameElement { reference: ElementRef, name: String },
    /// Set a text element's content (no-op for non-text elements).
    SetTextContent { reference: ElementRef, content: String },
    /// Set a visual element's on-canvas transform (no-op for audio).
    SetTransform {
        reference: ElementRef,
        transform: Transform,
    },
    /// Add an effect to a visual element.
    AddEffect {
        reference: ElementRef,
        effect: Effect,
    },
    /// Remove an effect from an element.
    RemoveEffect {
        reference: ElementRef,
        effect_id: String,
    },
    /// Toggle an effect's enabled flag.
    ToggleEffect {
        reference: ElementRef,
        effect_id: String,
    },
    /// Set one scalar parameter of an effect.
    SetEffectParam {
        reference: ElementRef,
        effect_id: String,
        key: String,
        value: f32,
    },
    /// Add/replace a keyframe on an animated property ("opacity"/"scale"/"x"/"y"/"rotation") at
    /// `time` (relative to the element start).
    AddKeyframe {
        reference: ElementRef,
        property: String,
        time: MediaTime,
        value: f32,
    },
    /// Remove the keyframe at `time` on a property.
    RemoveKeyframe {
        reference: ElementRef,
        property: String,
        time: MediaTime,
    },
    /// Add an empty overlay/audio track.
    AddTrack {
        lane: TrackLane,
        id: String,
        name: String,
    },
    /// Remove an overlay/audio track (the main lane cannot be removed).
    RemoveTrack { track_id: String },
    /// Add a new empty scene.
    AddScene { id: String, name: String },
    /// Remove a scene (never the last one).
    RemoveScene { scene_id: String },
    /// Duplicate an element (placed right after it) and select the copy.
    DuplicateElement {
        reference: ElementRef,
        new_id: String,
    },
    /// Show/hide a track.
    SetTrackHidden { track_id: String, hidden: bool },
    /// Mute/unmute a track.
    SetTrackMuted { track_id: String, muted: bool },
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
    SplitElement,
    TrimElement,
    RenameElement,
    SetTextContent,
    SetTransform,
    AddEffect,
    RemoveEffect,
    ToggleEffect,
    SetEffectParam,
    AddKeyframe,
    RemoveKeyframe,
    AddTrack,
    RemoveTrack,
    AddScene,
    RemoveScene,
    DuplicateElement,
    SetTrackHidden,
    SetTrackMuted,
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
    SetElementTransform {
        reference: ElementRef,
        transform: Transform,
    },
    AddEffect {
        reference: ElementRef,
        index: usize,
        effect: Effect,
    },
    RemoveEffect {
        reference: ElementRef,
        effect_id: String,
    },
    ReplaceEffect {
        reference: ElementRef,
        effect_id: String,
        effect: Effect,
    },
    SetAnimationChannel {
        reference: ElementRef,
        property: String,
        channel: Option<AnimationChannel>,
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
    SetTrackHidden {
        track_id: String,
        hidden: bool,
    },
    SetTrackMuted {
        track_id: String,
        muted: bool,
    },
    AddScene {
        index: usize,
        scene: Scene,
    },
    RemoveScene {
        scene_id: String,
    },
}

impl ProjectPatch {
    /// Apply to the project, returning the inverse patch (or `Noop` if nothing changed).
    pub(crate) fn apply(self, project: &mut Project) -> ProjectPatch {
        // Scene-level patches act on the whole project rather than the active scene.
        match &self {
            ProjectPatch::AddScene { .. } | ProjectPatch::RemoveScene { .. } => {
                return self.apply_scene(project);
            }
            _ => {}
        }

        let scene = project.active_scene_mut();
        match self {
            ProjectPatch::AddScene { .. } | ProjectPatch::RemoveScene { .. } => unreachable!(),
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
            ProjectPatch::SetElementTransform {
                reference,
                transform,
            } => match scene.element_mut(&reference) {
                Some(element) => match element.transform() {
                    Some(previous) => {
                        element.set_transform(transform);
                        ProjectPatch::SetElementTransform {
                            reference,
                            transform: previous,
                        }
                    }
                    None => ProjectPatch::Noop, // audio has no transform
                },
                None => ProjectPatch::Noop,
            },
            ProjectPatch::AddEffect {
                reference,
                index,
                effect,
            } => {
                let effect_id = effect.id.clone();
                match scene.element_mut(&reference).and_then(|e| e.effects_mut()) {
                    Some(effects) => {
                        let idx = index.min(effects.len());
                        effects.insert(idx, effect);
                        ProjectPatch::RemoveEffect {
                            reference,
                            effect_id,
                        }
                    }
                    None => ProjectPatch::Noop,
                }
            }
            ProjectPatch::RemoveEffect {
                reference,
                effect_id,
            } => {
                if let Some(effects) = scene.element_mut(&reference).and_then(|e| e.effects_mut()) {
                    if let Some(pos) = effects.iter().position(|f| f.id == effect_id) {
                        let effect = effects.remove(pos);
                        return ProjectPatch::AddEffect {
                            reference,
                            index: pos,
                            effect,
                        };
                    }
                }
                ProjectPatch::Noop
            }
            ProjectPatch::ReplaceEffect {
                reference,
                effect_id,
                effect,
            } => {
                if let Some(effects) = scene.element_mut(&reference).and_then(|e| e.effects_mut()) {
                    if let Some(pos) = effects.iter().position(|f| f.id == effect_id) {
                        let previous = std::mem::replace(&mut effects[pos], effect);
                        return ProjectPatch::ReplaceEffect {
                            reference,
                            effect_id,
                            effect: previous,
                        };
                    }
                }
                ProjectPatch::Noop
            }
            ProjectPatch::SetAnimationChannel {
                reference,
                property,
                channel,
            } => match scene.element_mut(&reference).and_then(|e| e.animations_mut()) {
                Some(animations) => {
                    let previous = animations.get(&property).cloned();
                    match channel {
                        Some(channel) => {
                            animations.insert(property.clone(), channel);
                        }
                        None => {
                            animations.remove(&property);
                        }
                    }
                    ProjectPatch::SetAnimationChannel {
                        reference,
                        property,
                        channel: previous,
                    }
                }
                None => ProjectPatch::Noop,
            },
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
            ProjectPatch::SetTrackHidden { track_id, hidden } => {
                match scene.tracks.track_mut(&track_id) {
                    Some(track) => {
                        let previous = track.hidden;
                        track.hidden = hidden;
                        ProjectPatch::SetTrackHidden {
                            track_id,
                            hidden: previous,
                        }
                    }
                    None => ProjectPatch::Noop,
                }
            }
            ProjectPatch::SetTrackMuted { track_id, muted } => {
                match scene.tracks.track_mut(&track_id) {
                    Some(track) => {
                        let previous = track.muted;
                        track.muted = muted;
                        ProjectPatch::SetTrackMuted {
                            track_id,
                            muted: previous,
                        }
                    }
                    None => ProjectPatch::Noop,
                }
            }
        }
    }

    fn apply_scene(self, project: &mut Project) -> ProjectPatch {
        match self {
            ProjectPatch::AddScene { index, scene } => {
                let scene_id = scene.id.clone();
                let idx = index.min(project.scenes.len());
                project.scenes.insert(idx, scene);
                ProjectPatch::RemoveScene { scene_id }
            }
            ProjectPatch::RemoveScene { scene_id } => {
                // Never remove the last remaining scene.
                if project.scenes.len() <= 1 {
                    return ProjectPatch::Noop;
                }
                match project.scenes.iter().position(|s| s.id == scene_id) {
                    Some(pos) => {
                        let scene = project.scenes.remove(pos);
                        if project.current_scene_id == scene_id {
                            project.current_scene_id = project.scenes[0].id.clone();
                        }
                        ProjectPatch::AddScene { index: pos, scene }
                    }
                    None => ProjectPatch::Noop,
                }
            }
            _ => ProjectPatch::Noop,
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

            Command::SplitElement {
                reference,
                at,
                new_id,
            } => {
                let element = scene.element(reference)?;
                let start = element.start();
                let end = element.end();
                if *at <= start || *at >= end {
                    return None; // split point must be strictly inside the element
                }
                let track = scene.tracks.track(&reference.track_id)?;
                let index = track
                    .elements
                    .iter()
                    .position(|e| e.id() == reference.element_id)?;

                let first_duration = MediaTime::from_ticks(at.as_ticks() - start.as_ticks());
                let second_duration = MediaTime::from_ticks(end.as_ticks() - at.as_ticks());
                let mut right = element.clone();
                right.set_id(new_id.clone());
                right.set_start(*at);
                right.set_duration(second_duration);

                Some(Lowered {
                    kind: CommandKind::SplitElement,
                    forward: vec![
                        ProjectPatch::SetElementDuration {
                            reference: reference.clone(),
                            duration: first_duration,
                        },
                        ProjectPatch::InsertElement {
                            track_id: reference.track_id.clone(),
                            index: index + 1,
                            element: right,
                        },
                    ],
                    selection_patch: Some(SelectionPatch::select_elements(vec![ElementRef::new(
                        reference.track_id.clone(),
                        new_id.clone(),
                    )])),
                })
            }

            Command::TrimElement {
                reference,
                start,
                duration,
            } => {
                scene.element(reference)?;
                Some(Lowered {
                    kind: CommandKind::TrimElement,
                    forward: vec![
                        ProjectPatch::SetElementStart {
                            reference: reference.clone(),
                            start: *start,
                        },
                        ProjectPatch::SetElementDuration {
                            reference: reference.clone(),
                            duration: *duration,
                        },
                    ],
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

            Command::SetTransform {
                reference,
                transform,
            } => {
                // Only visual elements have a transform.
                scene.element(reference).and_then(|e| e.transform())?;
                Some(Lowered {
                    kind: CommandKind::SetTransform,
                    forward: vec![ProjectPatch::SetElementTransform {
                        reference: reference.clone(),
                        transform: *transform,
                    }],
                    selection_patch: None,
                })
            }

            Command::AddEffect { reference, effect } => {
                let element = scene.element(reference)?;
                if matches!(element.kind(), ElementKind::Audio) {
                    return None; // audio has no effects
                }
                Some(Lowered {
                    kind: CommandKind::AddEffect,
                    forward: vec![ProjectPatch::AddEffect {
                        reference: reference.clone(),
                        index: element.effects().len(),
                        effect: effect.clone(),
                    }],
                    selection_patch: None,
                })
            }

            Command::RemoveEffect {
                reference,
                effect_id,
            } => {
                let element = scene.element(reference)?;
                element.effects().iter().find(|f| &f.id == effect_id)?;
                Some(Lowered {
                    kind: CommandKind::RemoveEffect,
                    forward: vec![ProjectPatch::RemoveEffect {
                        reference: reference.clone(),
                        effect_id: effect_id.clone(),
                    }],
                    selection_patch: None,
                })
            }

            Command::ToggleEffect {
                reference,
                effect_id,
            } => {
                let element = scene.element(reference)?;
                let effect = element.effects().iter().find(|f| &f.id == effect_id)?;
                let mut toggled = effect.clone();
                toggled.enabled = !toggled.enabled;
                Some(Lowered {
                    kind: CommandKind::ToggleEffect,
                    forward: vec![ProjectPatch::ReplaceEffect {
                        reference: reference.clone(),
                        effect_id: effect_id.clone(),
                        effect: toggled,
                    }],
                    selection_patch: None,
                })
            }

            Command::SetEffectParam {
                reference,
                effect_id,
                key,
                value,
            } => {
                let element = scene.element(reference)?;
                let effect = element.effects().iter().find(|f| &f.id == effect_id)?;
                let mut updated = effect.clone();
                updated.params.insert(key.clone(), *value);
                Some(Lowered {
                    kind: CommandKind::SetEffectParam,
                    forward: vec![ProjectPatch::ReplaceEffect {
                        reference: reference.clone(),
                        effect_id: effect_id.clone(),
                        effect: updated,
                    }],
                    selection_patch: None,
                })
            }

            Command::AddKeyframe {
                reference,
                property,
                time,
                value,
            } => {
                let element = scene.element(reference)?;
                let animations = element.animations()?; // visual only
                let mut channel = animations.get(property).cloned().unwrap_or_default();
                channel.upsert(*time, *value);
                Some(Lowered {
                    kind: CommandKind::AddKeyframe,
                    forward: vec![ProjectPatch::SetAnimationChannel {
                        reference: reference.clone(),
                        property: property.clone(),
                        channel: Some(channel),
                    }],
                    selection_patch: None,
                })
            }

            Command::RemoveKeyframe {
                reference,
                property,
                time,
            } => {
                let element = scene.element(reference)?;
                let mut channel = element.animations()?.get(property).cloned()?;
                channel.keys.retain(|k| k.time != *time);
                let channel = (!channel.keys.is_empty()).then_some(channel);
                Some(Lowered {
                    kind: CommandKind::RemoveKeyframe,
                    forward: vec![ProjectPatch::SetAnimationChannel {
                        reference: reference.clone(),
                        property: property.clone(),
                        channel,
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

            Command::AddScene { id, name } => Some(Lowered {
                kind: CommandKind::AddScene,
                forward: vec![ProjectPatch::AddScene {
                    index: state.project.scenes.len(),
                    scene: Scene::empty(id.clone(), name.clone()),
                }],
                selection_patch: None,
            }),

            Command::RemoveScene { scene_id } => {
                if state.project.scenes.len() <= 1
                    || !state.project.scenes.iter().any(|s| &s.id == scene_id)
                {
                    return None;
                }
                Some(Lowered {
                    kind: CommandKind::RemoveScene,
                    forward: vec![ProjectPatch::RemoveScene {
                        scene_id: scene_id.clone(),
                    }],
                    selection_patch: None,
                })
            }

            Command::DuplicateElement { reference, new_id } => {
                let element = scene.element(reference)?;
                let track = scene.tracks.track(&reference.track_id)?;
                let index = track
                    .elements
                    .iter()
                    .position(|e| e.id() == reference.element_id)?;
                let mut copy = element.clone();
                copy.set_id(new_id.clone());
                copy.set_start(element.end()); // place immediately after the original
                Some(Lowered {
                    kind: CommandKind::DuplicateElement,
                    forward: vec![ProjectPatch::InsertElement {
                        track_id: reference.track_id.clone(),
                        index: index + 1,
                        element: copy,
                    }],
                    selection_patch: Some(SelectionPatch::select_elements(vec![ElementRef::new(
                        reference.track_id.clone(),
                        new_id.clone(),
                    )])),
                })
            }

            Command::SetTrackHidden { track_id, hidden } => {
                scene.tracks.track(track_id)?;
                Some(Lowered {
                    kind: CommandKind::SetTrackHidden,
                    forward: vec![ProjectPatch::SetTrackHidden {
                        track_id: track_id.clone(),
                        hidden: *hidden,
                    }],
                    selection_patch: None,
                })
            }

            Command::SetTrackMuted { track_id, muted } => {
                scene.tracks.track(track_id)?;
                Some(Lowered {
                    kind: CommandKind::SetTrackMuted,
                    forward: vec![ProjectPatch::SetTrackMuted {
                        track_id: track_id.clone(),
                        muted: *muted,
                    }],
                    selection_patch: None,
                })
            }

            Command::Paste => None, // resolved in Editor::execute (mints ids)
        }
    }
}
