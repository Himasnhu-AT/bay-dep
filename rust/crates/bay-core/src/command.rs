//! The command surface and the reversible patch model behind undo/redo.
//!
//! A serde-tagged [`Command`] is the caller-facing edit. It *lowers* against current state into
//! one or more [`ProjectPatch`]es (the concrete, replayable document mutations) plus an optional
//! selection change. Each `ProjectPatch::apply` mutates the project **and returns its own
//! inverse**, so history is just two patch lists (forward for redo, inverse for undo).

use serde::{Deserialize, Serialize};

use bay_project::{
    AnimationChannel, BezierHandles, BlendMode, Easing, Effect, Element, ElementGroup, ElementKind,
    ElementRef, MediaTime, PlanArtifact, Project, Scene, StyleKit, Track, TrackKind, Transform,
};

use crate::selection::SelectionPatch;
use crate::state::EditorState;

/// What curve the segment leaving a keyframe travels on.
///
/// The three states of one setting, so they cannot contradict. A key that carried both a named
/// easing and drawn handles would be resolved by the sampler's precedence rule rather than by
/// what the author last chose, and the inspector would show one while the frame showed the
/// other.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum KeyframeCurve {
    /// Clear the override: travel on the channel's own easing.
    Channel,
    /// One of the named curves from the vocabulary.
    Named { easing: Easing },
    /// A curve drawn by hand in the curve editor.
    Drawn { handles: BezierHandles },
}

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
    /// Remove an element and close the hole it leaves: every later clip on the same lane moves
    /// back by its length, as one undo step.
    ///
    /// The difference from [`Command::RemoveElement`] is the difference between cutting a
    /// sentence out of a paragraph and painting it white. Only the lane the clip was on moves,
    /// because the lanes below it are not necessarily cut to the same rhythm.
    RippleDelete { reference: ElementRef },
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
    /// Trim an element's edges, as one undo step.
    ///
    /// For video and audio this is a **real trim**, not a reposition: moving the head forward
    /// consumes the same amount of source, so the frame under the new head is the frame that
    /// was there. Both edges stop at the media boundary — a trim that would run off either end
    /// of the file is shortened to fit rather than showing frames that do not exist. Use
    /// [`Command::MoveElement`] to slide a clip without touching what it plays.
    TrimElement {
        reference: ElementRef,
        start: MediaTime,
        duration: MediaTime,
    },
    /// Slip: move the in-point *inside* a clip, keeping its position and length on the
    /// timeline. This is how you change which part of a shot plays without re-cutting around
    /// it. No-op for elements with no timeline inside them (text, shapes, stills).
    SetSourceStart {
        reference: ElementRef,
        trim_start: MediaTime,
    },
    /// Set a clip's fades: up from nothing over `fade_in` at its head, down over `fade_out`
    /// at its tail. On a visual element this multiplies opacity; on audio it multiplies gain.
    ///
    /// A cross-dissolve is two clips overlapping with the upper one fading in — there is no
    /// separate transition object, because the upper clip fading in over a lower one that is
    /// still at full is exactly a dissolve, and one that does not dip through the background
    /// the way two complementary fades would.
    SetFades {
        reference: ElementRef,
        fade_in: MediaTime,
        fade_out: MediaTime,
    },
    /// Set an audio clip's level. Linear gain; `1.0` is unity. No-op on anything silent.
    ///
    /// A command of its own rather than a [`Command::ReplaceElement`] with an edited copy,
    /// because a mixer strip is a control that is *dragged*: it emits a level a hundred times a
    /// second, each of which has to coalesce into history as one gesture and be undoable as
    /// one. Replacing the whole element on every sample of a drag puts a hundred copies of a
    /// clip in the undo stack.
    SetVolume { reference: ElementRef, volume: f32 },
    /// Set an audio clip's pan: `-1.0` hard left, `0.0` centre, `1.0` hard right.
    SetPan { reference: ElementRef, pan: f32 },
    /// Mute or unmute a single clip.
    SetMuted { reference: ElementRef, muted: bool },
    /// Set a lane's fader. Linear gain on top of every clip's own level.
    SetTrackVolume { track_id: String, gain: f32 },
    /// Set a lane's pan.
    SetTrackPan { track_id: String, pan: f32 },
    /// Solo a lane, silencing every audio lane that is not soloed.
    SetTrackSolo { track_id: String, solo: bool },
    /// Replace an element with an edited copy of itself, in place.
    ///
    /// For the properties that have no command of their own — typography, a shape's fill, an
    /// audio clip's gain. The replacement must keep the same id: an `ElementRef` is how every
    /// other edit and the selection address it, so changing the id here would strand them.
    ReplaceElement {
        reference: ElementRef,
        element: Element,
    },
    /// Rename an element.
    RenameElement { reference: ElementRef, name: String },
    /// Set a text element's content (no-op for non-text elements).
    SetTextContent {
        reference: ElementRef,
        content: String,
    },
    /// Set a visual element's on-canvas transform (no-op for audio).
    SetTransform {
        reference: ElementRef,
        transform: Transform,
    },
    /// Set how a visual element composites over the layers beneath it (no-op for audio).
    SetBlendMode {
        reference: ElementRef,
        blend_mode: BlendMode,
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
    /// Move one keyframe along the time axis, keeping its value, curve and identity.
    ///
    /// One command rather than remove-plus-add, which is what dragging a key used to be: two
    /// commands, so two undo entries for one drag, and the key ceased to exist in between —
    /// so whatever was holding it (a selection, a pointer) was holding nothing by the time the
    /// second landed.
    ///
    /// `keyframe_id` is [`bay_project::Keyframe::identity`], the same string
    /// [`crate::KeyframeRef`] carries.
    MoveKeyframe {
        reference: ElementRef,
        property: String,
        keyframe_id: String,
        time: MediaTime,
    },
    /// Set the curve for the segment leaving one keyframe.
    ///
    /// One command for both a named easing and a drawn one, because they are one setting with
    /// three states — inherit, named, drawn — and two commands writing two fields could leave
    /// a key claiming both, which the sampler would resolve by precedence rather than by what
    /// the author last did.
    SetKeyframeCurve {
        reference: ElementRef,
        property: String,
        keyframe_id: String,
        curve: KeyframeCurve,
    },
    /// Set the whole channel's default easing — the curve every key that does not override it
    /// travels on.
    SetChannelEasing {
        reference: ElementRef,
        property: String,
        easing: Easing,
    },
    /// Apply a motion preset (a bundle of effects + animation channels) to an element in one
    /// undoable step. Effect ids should be pre-minted by the caller to avoid collisions.
    ApplyMotionPreset {
        reference: ElementRef,
        effects: Vec<Effect>,
        animations: std::collections::BTreeMap<String, AnimationChannel>,
    },
    /// Add an empty overlay/audio track.
    AddTrack {
        lane: TrackLane,
        id: String,
        name: String,
    },
    /// Remove an overlay/audio track (the main lane cannot be removed).
    RemoveTrack { track_id: String },
    /// Drop a marker on the active scene's timeline.
    AddMarker {
        id: String,
        time: MediaTime,
        label: String,
    },
    /// Remove a marker by id.
    RemoveMarker { id: String },
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
    /// Commit the project to a style kit — the typography, palette and framings every element
    /// placed afterwards resolves against.
    ///
    /// A command rather than a write through `project_mut` because taking that handle clears the
    /// undo history: choosing a look would otherwise throw away the user's ability to undo
    /// everything they had done before choosing it.
    SetStyleKit { kit: Box<StyleKit> },
    /// Create or replace the inspectable editorial plan and its trust-loop state.
    SetPlan { plan: Box<PlanArtifact> },
    /// Create or replace a parent group in the active scene.
    SetGroup { group: ElementGroup },
    /// Paste the clipboard elements onto the main track and select them (ids are minted).
    Paste,
}

/// The kind label carried into history (diagnostics).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandKind {
    SetSelection,
    AddElement,
    RemoveElement,
    RippleDelete,
    MoveElement,
    SetElementDuration,
    SplitElement,
    TrimElement,
    SetSourceStart,
    SetFades,
    SetVolume,
    SetPan,
    SetMuted,
    SetTrackVolume,
    SetTrackPan,
    SetTrackSolo,
    ReplaceElement,
    RenameElement,
    SetTextContent,
    SetTransform,
    SetBlendMode,
    AddEffect,
    RemoveEffect,
    ToggleEffect,
    SetEffectParam,
    AddKeyframe,
    RemoveKeyframe,
    MoveKeyframe,
    SetKeyframeCurve,
    SetChannelEasing,
    ApplyMotionPreset,
    AddTrack,
    RemoveTrack,
    AddMarker,
    RemoveMarker,
    AddScene,
    RemoveScene,
    DuplicateElement,
    SetTrackHidden,
    SetTrackMuted,
    SetStyleKit,
    SetPlan,
    SetGroup,
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
    SetElementSourceStart {
        reference: ElementRef,
        trim_start: MediaTime,
    },
    SetElementFades {
        reference: ElementRef,
        fade_in: MediaTime,
        fade_out: MediaTime,
    },
    SetElementVolume {
        reference: ElementRef,
        volume: f32,
    },
    SetElementPan {
        reference: ElementRef,
        pan: f32,
    },
    SetElementMuted {
        reference: ElementRef,
        muted: bool,
    },
    ReplaceElement {
        reference: ElementRef,
        element: Element,
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
    SetElementBlendMode {
        reference: ElementRef,
        blend_mode: BlendMode,
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
    SetTrackGain {
        track_id: String,
        gain: f32,
    },
    SetTrackPan {
        track_id: String,
        pan: f32,
    },
    SetTrackSolo {
        track_id: String,
        solo: bool,
    },
    InsertMarker {
        index: usize,
        marker: bay_project::Marker,
    },
    RemoveMarker {
        id: String,
    },
    /// `None` restores a project that had not committed to a kit yet, which is what undoing the
    /// first commit has to do.
    SetStyleKit {
        kit: Option<Box<StyleKit>>,
    },
    SetPlan {
        plan: Option<Box<PlanArtifact>>,
    },
    SetGroup {
        id: String,
        group: Option<ElementGroup>,
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
        // Project-level patches act on the whole project rather than the active scene.
        match &self {
            ProjectPatch::AddScene { .. } | ProjectPatch::RemoveScene { .. } => {
                return self.apply_scene(project);
            }
            ProjectPatch::SetStyleKit { .. } => {
                let ProjectPatch::SetStyleKit { kit } = self else {
                    unreachable!()
                };
                let previous = project.settings.kit.take().map(Box::new);
                project.settings.kit = kit.map(|kit| *kit);
                return ProjectPatch::SetStyleKit { kit: previous };
            }
            ProjectPatch::SetPlan { .. } => {
                let ProjectPatch::SetPlan { plan } = self else {
                    unreachable!()
                };
                let previous = project.settings.plan.take().map(Box::new);
                project.settings.plan = plan.map(|plan| *plan);
                return ProjectPatch::SetPlan { plan: previous };
            }
            _ => {}
        }

        let scene = project.active_scene_mut();
        match self {
            ProjectPatch::AddScene { .. }
            | ProjectPatch::RemoveScene { .. }
            | ProjectPatch::SetStyleKit { .. }
            | ProjectPatch::SetPlan { .. } => unreachable!(),
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
                if let Some(track) = scene.tracks.track_mut(&track_id)
                    && let Some(pos) = track.elements.iter().position(|e| e.id() == element_id)
                {
                    let element = track.elements.remove(pos);
                    return ProjectPatch::InsertElement {
                        track_id,
                        index: pos,
                        element,
                    };
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
            ProjectPatch::SetElementSourceStart {
                reference,
                trim_start,
            } => match scene.element_mut(&reference) {
                // Elements with no timeline inside them have no in-point to move, and
                // `source_start` returning `None` is what says so.
                Some(element) => match element.source_start() {
                    Some(previous) => {
                        element.set_source_start(trim_start);
                        ProjectPatch::SetElementSourceStart {
                            reference,
                            trim_start: previous,
                        }
                    }
                    None => ProjectPatch::Noop,
                },
                None => ProjectPatch::Noop,
            },
            ProjectPatch::SetElementFades {
                reference,
                fade_in,
                fade_out,
            } => match scene.element_mut(&reference) {
                Some(element) => {
                    let previous = (element.fade_in(), element.fade_out());
                    element.set_fades(fade_in, fade_out);
                    ProjectPatch::SetElementFades {
                        reference,
                        fade_in: previous.0,
                        fade_out: previous.1,
                    }
                }
                None => ProjectPatch::Noop,
            },
            // The three mixer-strip writes. Each reports the value it displaced, which is what
            // makes a fader drag undoable in one step: the history keeps the level the strip
            // was at when the gesture began.
            ProjectPatch::SetElementVolume { reference, volume } => {
                match scene.element_mut(&reference).and_then(Element::audio_mut) {
                    Some(audio) => {
                        let previous = audio.volume;
                        audio.volume = sane_gain(volume);
                        ProjectPatch::SetElementVolume {
                            reference,
                            volume: previous,
                        }
                    }
                    None => ProjectPatch::Noop,
                }
            }
            ProjectPatch::SetElementPan { reference, pan } => {
                match scene.element_mut(&reference).and_then(Element::audio_mut) {
                    Some(audio) => {
                        let previous = audio.pan;
                        audio.pan = sane_pan(pan);
                        ProjectPatch::SetElementPan {
                            reference,
                            pan: previous,
                        }
                    }
                    None => ProjectPatch::Noop,
                }
            }
            ProjectPatch::SetElementMuted { reference, muted } => {
                match scene.element_mut(&reference).and_then(Element::audio_mut) {
                    Some(audio) => {
                        let previous = audio.muted;
                        audio.muted = muted;
                        ProjectPatch::SetElementMuted {
                            reference,
                            muted: previous,
                        }
                    }
                    None => ProjectPatch::Noop,
                }
            }
            ProjectPatch::ReplaceElement { reference, element } => {
                match scene.element_mut(&reference) {
                    Some(slot) => {
                        let previous = std::mem::replace(slot, element);
                        ProjectPatch::ReplaceElement {
                            reference,
                            element: previous,
                        }
                    }
                    None => ProjectPatch::Noop,
                }
            }
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
            ProjectPatch::SetElementBlendMode {
                reference,
                blend_mode,
            } => match scene.element_mut(&reference) {
                Some(element) => match element.blend_mode() {
                    Some(previous) => {
                        element.set_blend_mode(blend_mode);
                        ProjectPatch::SetElementBlendMode {
                            reference,
                            blend_mode: previous,
                        }
                    }
                    None => ProjectPatch::Noop, // audio does not composite
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
                if let Some(effects) = scene.element_mut(&reference).and_then(|e| e.effects_mut())
                    && let Some(pos) = effects.iter().position(|f| f.id == effect_id)
                {
                    let effect = effects.remove(pos);
                    return ProjectPatch::AddEffect {
                        reference,
                        index: pos,
                        effect,
                    };
                }
                ProjectPatch::Noop
            }
            ProjectPatch::ReplaceEffect {
                reference,
                effect_id,
                effect,
            } => {
                if let Some(effects) = scene.element_mut(&reference).and_then(|e| e.effects_mut())
                    && let Some(pos) = effects.iter().position(|f| f.id == effect_id)
                {
                    let previous = std::mem::replace(&mut effects[pos], effect);
                    return ProjectPatch::ReplaceEffect {
                        reference,
                        effect_id,
                        effect: previous,
                    };
                }
                ProjectPatch::Noop
            }
            ProjectPatch::SetAnimationChannel {
                reference,
                property,
                channel,
            } => match scene
                .element_mut(&reference)
                .and_then(|e| e.animations_mut())
            {
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
            ProjectPatch::SetGroup { id, group } => {
                let previous = scene.groups.remove(&id);
                if let Some(group) = group {
                    scene.groups.insert(id.clone(), group);
                }
                ProjectPatch::SetGroup {
                    id,
                    group: previous,
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
            ProjectPatch::InsertMarker { index, marker } => {
                let id = marker.id.clone();
                let at = index.min(scene.markers.len());
                scene.markers.insert(at, marker);
                ProjectPatch::RemoveMarker { id }
            }
            ProjectPatch::RemoveMarker { id } => {
                match scene.markers.iter().position(|marker| marker.id == id) {
                    Some(index) => {
                        let marker = scene.markers.remove(index);
                        ProjectPatch::InsertMarker { index, marker }
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
            ProjectPatch::SetTrackGain { track_id, gain } => {
                match scene.tracks.track_mut(&track_id) {
                    Some(track) => {
                        let previous = track.gain;
                        track.gain = sane_gain(gain);
                        ProjectPatch::SetTrackGain {
                            track_id,
                            gain: previous,
                        }
                    }
                    None => ProjectPatch::Noop,
                }
            }
            ProjectPatch::SetTrackPan { track_id, pan } => {
                match scene.tracks.track_mut(&track_id) {
                    Some(track) => {
                        let previous = track.pan;
                        track.pan = sane_pan(pan);
                        ProjectPatch::SetTrackPan {
                            track_id,
                            pan: previous,
                        }
                    }
                    None => ProjectPatch::Noop,
                }
            }
            ProjectPatch::SetTrackSolo { track_id, solo } => {
                match scene.tracks.track_mut(&track_id) {
                    Some(track) => {
                        let previous = track.solo;
                        track.solo = solo;
                        ProjectPatch::SetTrackSolo {
                            track_id,
                            solo: previous,
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

/// The shortest clip a trim may leave: one hundredth of a second. Zero-length elements render
/// nothing and cannot be grabbed again, so an edge that runs all the way through its own clip
/// is refused rather than obeyed.
const MIN_TRIMMED_TICKS: i64 = bay_time::TICKS_PER_SECOND / 100;

/// Where a trim actually lands once the media boundaries have had their say.
struct PlannedTrim {
    start: MediaTime,
    duration: MediaTime,
    /// The new in-point, for elements that read a timeline out of their source. `None` means
    /// the element has none to move (text, shape, still).
    source_start: Option<MediaTime>,
}

/// The source length of what an element plays, if the project knows it. `None` means nobody
/// probed the file — the trim then has no far edge to stop at, which is the honest answer.
fn source_length(project: &Project, element: &Element) -> Option<MediaTime> {
    let media_id = element.media_id()?;
    project
        .media
        .iter()
        .find(|asset| asset.id == media_id)?
        .source_duration()
}

/// Clamp an in-point so the clip it heads stays inside its file: never before the first frame,
/// and never so late that the clip runs past the last one.
fn clamp_source_start(
    requested: MediaTime,
    duration: MediaTime,
    source_length: Option<MediaTime>,
) -> MediaTime {
    let mut ticks = requested.as_ticks().max(0);
    if let Some(length) = source_length {
        let latest = (length.as_ticks() - duration.as_ticks()).max(0);
        ticks = ticks.min(latest);
    }
    MediaTime::from_ticks(ticks)
}

/// Work out what an edge-trim means for one element.
///
/// The rule that makes this a trim rather than a reposition: **the head consumes source**.
/// Moving the head one second later starts the clip one second later into the file, so the
/// frame under the new edge is the frame that was already there — which is the entire point of
/// dragging a clip's edge, and what bay did not do before.
///
/// Both edges then stop at the media boundary. A head dragged before the first frame, or a tail
/// dragged past the last one, is *shortened to fit* rather than obeyed: showing frames that do
/// not exist is not a thing an editor should be able to ask for. Returns `None` when nothing is
/// left to trim.
fn plan_trim(
    element: &Element,
    start: MediaTime,
    duration: MediaTime,
    source_length: Option<MediaTime>,
) -> Option<PlannedTrim> {
    if duration.as_ticks() < MIN_TRIMMED_TICKS {
        return None;
    }
    let Some(current_source) = element.source_start() else {
        // Text, shapes and stills have no source timeline: an edge-trim is exactly a change of
        // placement and length, which is what it always was.
        return Some(PlannedTrim {
            start: MediaTime::from_ticks(start.as_ticks().max(0)),
            duration,
            source_start: None,
        });
    };

    let mut start_ticks = start.as_ticks();
    let mut duration_ticks = duration.as_ticks();
    // How far the head moved, and therefore how much source it ate.
    let delta = start_ticks - element.start().as_ticks();
    let mut source_ticks = current_source.as_ticks() + delta;

    // The head cannot reach before the first frame of the file. Give back what it overshot.
    if source_ticks < 0 {
        start_ticks -= source_ticks;
        duration_ticks += source_ticks;
        source_ticks = 0;
    }
    // Nor can the tail run past the last frame.
    if let Some(length) = source_length {
        let overshoot = (source_ticks + duration_ticks) - length.as_ticks();
        if overshoot > 0 {
            duration_ticks -= overshoot;
        }
    }
    if duration_ticks < MIN_TRIMMED_TICKS || start_ticks < 0 {
        return None;
    }

    Some(PlannedTrim {
        start: MediaTime::from_ticks(start_ticks),
        duration: MediaTime::from_ticks(duration_ticks),
        source_start: Some(MediaTime::from_ticks(source_ticks)),
    })
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

            Command::RippleDelete { reference } => {
                let removed = scene.element(reference)?;
                let (gap, after) = (removed.duration(), removed.start());
                let track = scene.tracks.track(&reference.track_id)?;

                let mut forward = vec![ProjectPatch::RemoveElement {
                    track_id: reference.track_id.clone(),
                    element_id: reference.element_id.clone(),
                }];
                // Everything that started at or after the removed clip slides back by its
                // length. Comparing against its START, not its end, keeps a clip that
                // overlapped it (a dissolve partner) moving with the rest.
                for element in &track.elements {
                    if element.id() == reference.element_id || element.start() < after {
                        continue;
                    }
                    forward.push(ProjectPatch::SetElementStart {
                        reference: ElementRef::new(
                            reference.track_id.clone(),
                            element.id().to_string(),
                        ),
                        start: MediaTime::from_ticks(
                            (element.start().as_ticks() - gap.as_ticks()).max(0),
                        ),
                    });
                }
                let selection_patch = state
                    .selection
                    .elements
                    .contains(reference)
                    .then(|| SelectionPatch::select_elements(Vec::new()));
                Some(Lowered {
                    kind: CommandKind::RippleDelete,
                    forward,
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
                // The second half starts where the first one stopped *in the source*. Without
                // this a split produced two clips playing the same footage from the same
                // in-point — the first section twice, rather than a cut.
                if let Some(source) = element.source_start() {
                    right.set_source_start(MediaTime::from_ticks(
                        source.as_ticks() + first_duration.as_ticks(),
                    ));
                }

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
                let element = scene.element(reference)?;
                let trim = plan_trim(
                    element,
                    *start,
                    *duration,
                    source_length(&state.project, element),
                )?;
                let mut forward = vec![
                    ProjectPatch::SetElementStart {
                        reference: reference.clone(),
                        start: trim.start,
                    },
                    ProjectPatch::SetElementDuration {
                        reference: reference.clone(),
                        duration: trim.duration,
                    },
                ];
                if let Some(trim_start) = trim.source_start {
                    forward.push(ProjectPatch::SetElementSourceStart {
                        reference: reference.clone(),
                        trim_start,
                    });
                }
                Some(Lowered {
                    kind: CommandKind::TrimElement,
                    forward,
                    selection_patch: None,
                })
            }

            Command::SetSourceStart {
                reference,
                trim_start,
            } => {
                let element = scene.element(reference)?;
                element.source_start()?; // nothing to slip inside a still, a title or a shape
                let clamped = clamp_source_start(
                    *trim_start,
                    element.duration(),
                    source_length(&state.project, element),
                );
                Some(Lowered {
                    kind: CommandKind::SetSourceStart,
                    forward: vec![ProjectPatch::SetElementSourceStart {
                        reference: reference.clone(),
                        trim_start: clamped,
                    }],
                    selection_patch: None,
                })
            }

            Command::SetFades {
                reference,
                fade_in,
                fade_out,
            } => {
                let element = scene.element(reference)?;
                // Fades longer than the clip would leave it never reaching full, which is
                // almost always a typo rather than an intention.
                let duration = element.duration();
                let fade_in = (*fade_in).clamp(MediaTime::ZERO, duration);
                let fade_out = (*fade_out).clamp(MediaTime::ZERO, duration);
                if (fade_in, fade_out) == (element.fade_in(), element.fade_out()) {
                    return None;
                }
                Some(Lowered {
                    kind: CommandKind::SetFades,
                    forward: vec![ProjectPatch::SetElementFades {
                        reference: reference.clone(),
                        fade_in,
                        fade_out,
                    }],
                    selection_patch: None,
                })
            }

            Command::SetVolume { reference, volume } => {
                let audio = scene.element(reference)?.audio()?;
                let volume = sane_gain(*volume);
                if volume == audio.volume {
                    return None;
                }
                Some(Lowered {
                    kind: CommandKind::SetVolume,
                    forward: vec![ProjectPatch::SetElementVolume {
                        reference: reference.clone(),
                        volume,
                    }],
                    selection_patch: None,
                })
            }

            Command::SetPan { reference, pan } => {
                let audio = scene.element(reference)?.audio()?;
                let pan = sane_pan(*pan);
                if pan == audio.pan {
                    return None;
                }
                Some(Lowered {
                    kind: CommandKind::SetPan,
                    forward: vec![ProjectPatch::SetElementPan {
                        reference: reference.clone(),
                        pan,
                    }],
                    selection_patch: None,
                })
            }

            Command::SetMuted { reference, muted } => {
                let audio = scene.element(reference)?.audio()?;
                if *muted == audio.muted {
                    return None;
                }
                Some(Lowered {
                    kind: CommandKind::SetMuted,
                    forward: vec![ProjectPatch::SetElementMuted {
                        reference: reference.clone(),
                        muted: *muted,
                    }],
                    selection_patch: None,
                })
            }

            Command::SetTrackVolume { track_id, gain } => {
                let track = scene.tracks.track(track_id)?;
                let gain = sane_gain(*gain);
                if gain == track.gain {
                    return None;
                }
                Some(Lowered {
                    kind: CommandKind::SetTrackVolume,
                    forward: vec![ProjectPatch::SetTrackGain {
                        track_id: track_id.clone(),
                        gain,
                    }],
                    selection_patch: None,
                })
            }

            Command::SetTrackPan { track_id, pan } => {
                let track = scene.tracks.track(track_id)?;
                let pan = sane_pan(*pan);
                if pan == track.pan {
                    return None;
                }
                Some(Lowered {
                    kind: CommandKind::SetTrackPan,
                    forward: vec![ProjectPatch::SetTrackPan {
                        track_id: track_id.clone(),
                        pan,
                    }],
                    selection_patch: None,
                })
            }

            Command::SetTrackSolo { track_id, solo } => {
                let track = scene.tracks.track(track_id)?;
                if *solo == track.solo {
                    return None;
                }
                Some(Lowered {
                    kind: CommandKind::SetTrackSolo,
                    forward: vec![ProjectPatch::SetTrackSolo {
                        track_id: track_id.clone(),
                        solo: *solo,
                    }],
                    selection_patch: None,
                })
            }

            Command::ReplaceElement { reference, element } => {
                let current = scene.element(reference)?;
                // A replacement that renumbers the element would leave the selection, the
                // history and every later tool call pointing at something that no longer
                // exists. Refuse rather than half-apply.
                if element.id() != reference.element_id || element.kind() != current.kind() {
                    return None;
                }
                if element == current {
                    return None; // nothing to record
                }
                Some(Lowered {
                    kind: CommandKind::ReplaceElement,
                    forward: vec![ProjectPatch::ReplaceElement {
                        reference: reference.clone(),
                        element: element.clone(),
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

            Command::SetBlendMode {
                reference,
                blend_mode,
            } => {
                // Only visual elements composite.
                scene.element(reference).and_then(|e| e.blend_mode())?;
                Some(Lowered {
                    kind: CommandKind::SetBlendMode,
                    forward: vec![ProjectPatch::SetElementBlendMode {
                        reference: reference.clone(),
                        blend_mode: *blend_mode,
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
                // Against everything this element actually reads, not against the flat
                // thirteen. The old check refused `mask.x` and `effect.<id>.<param>` — which
                // `animate` over MCP accepts and the renderer samples — so the same edit
                // worked from an agent and silently vanished from the editor.
                if !element.can_animate(property) {
                    return None;
                }
                let animations = element.animations()?;
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

            Command::MoveKeyframe {
                reference,
                property,
                keyframe_id,
                time,
            } => {
                let element = scene.element(reference)?;
                let mut channel = element.animations()?.get(property).cloned()?;
                // Give the channel names before moving, so a key from a project written
                // before ids existed acquires one on its first drag rather than being
                // addressable only until it moves.
                channel.assign_missing_ids();
                if !channel.move_key(keyframe_id, *time) {
                    return None;
                }
                Some(Lowered {
                    kind: CommandKind::MoveKeyframe,
                    forward: vec![ProjectPatch::SetAnimationChannel {
                        reference: reference.clone(),
                        property: property.clone(),
                        channel: Some(channel),
                    }],
                    selection_patch: None,
                })
            }

            Command::SetKeyframeCurve {
                reference,
                property,
                keyframe_id,
                curve,
            } => {
                let element = scene.element(reference)?;
                let mut channel = element.animations()?.get(property).cloned()?;
                let index = channel.index_of(keyframe_id)?;
                let key = &mut channel.keys[index];
                // Set as a unit: whichever state is chosen, the other two are cleared, so the
                // key cannot end up claiming a named curve and a drawn one at once.
                match curve {
                    KeyframeCurve::Channel => {
                        key.easing = None;
                        key.handles = None;
                    }
                    KeyframeCurve::Named { easing } => {
                        key.easing = Some(*easing);
                        key.handles = None;
                    }
                    KeyframeCurve::Drawn { handles } => {
                        key.easing = None;
                        key.handles = Some(*handles);
                    }
                }
                Some(Lowered {
                    kind: CommandKind::SetKeyframeCurve,
                    forward: vec![ProjectPatch::SetAnimationChannel {
                        reference: reference.clone(),
                        property: property.clone(),
                        channel: Some(channel),
                    }],
                    selection_patch: None,
                })
            }

            Command::SetChannelEasing {
                reference,
                property,
                easing,
            } => {
                let element = scene.element(reference)?;
                let mut channel = element.animations()?.get(property).cloned()?;
                if channel.easing == *easing {
                    return None;
                }
                channel.easing = *easing;
                Some(Lowered {
                    kind: CommandKind::SetChannelEasing,
                    forward: vec![ProjectPatch::SetAnimationChannel {
                        reference: reference.clone(),
                        property: property.clone(),
                        channel: Some(channel),
                    }],
                    selection_patch: None,
                })
            }

            Command::ApplyMotionPreset {
                reference,
                effects,
                animations,
            } => {
                let element = scene.element(reference)?;
                // Audio has no effects but does have a level to animate, so refuse only the
                // half that cannot apply rather than the whole command.
                if matches!(element.kind(), ElementKind::Audio) && !effects.is_empty() {
                    return None;
                }
                let base = element.effects().len();
                let mut forward = Vec::new();
                for (offset, effect) in effects.iter().enumerate() {
                    forward.push(ProjectPatch::AddEffect {
                        reference: reference.clone(),
                        index: base + offset,
                        effect: effect.clone(),
                    });
                }
                for (property, channel) in animations {
                    forward.push(ProjectPatch::SetAnimationChannel {
                        reference: reference.clone(),
                        property: property.clone(),
                        channel: Some(channel.clone()),
                    });
                }
                if forward.is_empty() {
                    return None;
                }
                Some(Lowered {
                    kind: CommandKind::ApplyMotionPreset,
                    forward,
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

            Command::AddMarker { id, time, label } => {
                if scene.markers.iter().any(|marker| marker.id == *id) {
                    return None;
                }
                // Kept in time order, so the ruler draws them in order and `snap_targets` does
                // not have to sort on every drag.
                let index = scene
                    .markers
                    .iter()
                    .position(|marker| marker.time > *time)
                    .unwrap_or(scene.markers.len());
                Some(Lowered {
                    kind: CommandKind::AddMarker,
                    forward: vec![ProjectPatch::InsertMarker {
                        index,
                        marker: bay_project::Marker {
                            id: id.clone(),
                            time: *time,
                            label: label.clone(),
                        },
                    }],
                    selection_patch: None,
                })
            }

            Command::RemoveMarker { id } => {
                scene.markers.iter().find(|marker| marker.id == *id)?;
                Some(Lowered {
                    kind: CommandKind::RemoveMarker,
                    forward: vec![ProjectPatch::RemoveMarker { id: id.clone() }],
                    selection_patch: None,
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

            Command::SetStyleKit { kit } => Some(Lowered {
                kind: CommandKind::SetStyleKit,
                forward: vec![ProjectPatch::SetStyleKit {
                    kit: Some(kit.clone()),
                }],
                selection_patch: None,
            }),

            Command::SetPlan { plan } => Some(Lowered {
                kind: CommandKind::SetPlan,
                forward: vec![ProjectPatch::SetPlan {
                    plan: Some(plan.clone()),
                }],
                selection_patch: None,
            }),

            Command::SetGroup { group } => {
                if group.id.is_empty()
                    || group
                        .children
                        .iter()
                        .any(|id| !scene.elements().any(|element| element.id() == id))
                {
                    return None;
                }
                Some(Lowered {
                    kind: CommandKind::SetGroup,
                    forward: vec![ProjectPatch::SetGroup {
                        id: group.id.clone(),
                        group: Some(group.clone()),
                    }],
                    selection_patch: None,
                })
            }

            Command::Paste => None, // resolved in Editor::execute (mints ids)
        }
    }
}

/// The most gain a fader may apply.
///
/// Not a taste limit — a *render-path* limit. The summing mixer clamps to ±1 after summing, so
/// gain past a point buys nothing but distortion, and a fader dragged to a number with no top
/// can be handed `1e30` by a UI that scaled a drag wrong. 4× is +12 dB, which is as far up as a
/// clip that was mastered quiet ever needs to come.
const MAX_GAIN: f32 = 4.0;

/// A level a mixer may actually be set to. Non-finite is unity: a `NaN` level would silence a
/// clip and there would be nothing on screen saying why.
fn sane_gain(gain: f32) -> f32 {
    if gain.is_finite() {
        gain.clamp(0.0, MAX_GAIN)
    } else {
        1.0
    }
}

/// A pan position a mixer may actually be set to. Non-finite is centre, for the same reason.
fn sane_pan(pan: f32) -> f32 {
    if pan.is_finite() {
        pan.clamp(-1.0, 1.0)
    } else {
        0.0
    }
}
