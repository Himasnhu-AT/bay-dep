//! Stateless selection operations over `SelectionState`. No listeners — change notification
//! is the `Editor`/`EventBus`'s job. A command declares "I changed the selection" by carrying
//! a `SelectionPatch`, which is what makes undo restore the prior selection.

use serde::{Deserialize, Serialize};

use crate::refs::{ElementRef, KeyframeRef, MaskPointSelection};
use crate::state::SelectionState;

/// A full-fidelity copy of the selection, restored on undo.
pub type SelectionSnapshot = SelectionState;

/// A partial selection change. Fields left `None` are untouched.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionPatch {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub elements: Option<Vec<ElementRef>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub keyframes: Option<Vec<KeyframeRef>>,
    /// Double option: outer `None` = leave as-is; `Some(None)` = clear the anchor.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub keyframe_anchor: Option<Option<KeyframeRef>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub mask_points: Option<Option<MaskPointSelection>>,
}

impl SelectionPatch {
    /// A patch that selects exactly these elements (clearing keyframe/mask selections).
    pub fn select_elements(elements: Vec<ElementRef>) -> Self {
        Self {
            elements: Some(elements),
            keyframes: Some(Vec::new()),
            keyframe_anchor: Some(None),
            mask_points: Some(None),
        }
    }
}

pub fn snapshot(state: &SelectionState) -> SelectionSnapshot {
    state.clone()
}

pub fn restore(state: &mut SelectionState, snapshot: SelectionSnapshot) {
    *state = snapshot;
}

/// Replace the element selection, clearing the more-specific keyframe/mask selections.
pub fn set_elements(state: &mut SelectionState, elements: Vec<ElementRef>) {
    state.elements = elements;
    state.keyframes.clear();
    state.keyframe_anchor = None;
    state.mask_points = None;
}

pub fn clear(state: &mut SelectionState) {
    *state = SelectionState::default();
}

/// Apply a partial change and return the resulting snapshot (the command's `selectionOverride`).
pub fn apply_patch(state: &mut SelectionState, patch: SelectionPatch) -> SelectionSnapshot {
    if let Some(elements) = patch.elements {
        state.elements = elements;
    }
    if let Some(keyframes) = patch.keyframes {
        state.keyframes = keyframes;
    }
    if let Some(anchor) = patch.keyframe_anchor {
        state.keyframe_anchor = anchor;
    }
    if let Some(mask_points) = patch.mask_points {
        state.mask_points = mask_points.filter(|m| !m.point_ids.is_empty());
    }
    snapshot(state)
}
