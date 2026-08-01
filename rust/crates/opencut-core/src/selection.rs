//! Stateless selection operations. Every function takes `&mut SelectionState` (or
//! `&SelectionState`) — the web `SelectionManager` methods with `this` replaced by an
//! explicit borrow. No listeners here: change notification is the `Editor`/`EventBus`'s
//! job, so these stay pure and trivially testable.

use serde::{Deserialize, Serialize};

use crate::refs::{ElementRef, KeyframeRef, MaskPointSelection};
use crate::state::SelectionState;

/// A full-fidelity copy of the selection, used by history to restore on undo.
pub type SelectionSnapshot = SelectionState;

/// A partial selection change. Fields left `None` are untouched — mirrors the web
/// `EditorSelectionPatch`, which is how commands declare "I changed this part of the
/// selection" and thereby opt into undo restoring it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionPatch {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub elements: Option<Vec<ElementRef>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub keyframes: Option<Vec<KeyframeRef>>,
    /// Double option: outer `None` = leave anchor as-is; `Some(None)` = clear it.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub keyframe_anchor: Option<Option<KeyframeRef>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub mask_points: Option<Option<MaskPointSelection>>,
}

impl SelectionPatch {
    /// Convenience: a patch that selects exactly these elements.
    pub fn select_elements(elements: Vec<ElementRef>) -> Self {
        Self {
            elements: Some(elements),
            ..Self::default()
        }
    }
}

pub fn snapshot(state: &SelectionState) -> SelectionSnapshot {
    state.clone()
}

pub fn restore(state: &mut SelectionState, snapshot: SelectionSnapshot) {
    *state = snapshot;
}

/// Replace the element selection, clearing the more-specific keyframe/mask selections —
/// matches web `setSelectedElements`.
pub fn set_elements(state: &mut SelectionState, elements: Vec<ElementRef>) {
    state.elements = elements;
    state.keyframes.clear();
    state.keyframe_anchor = None;
    state.mask_points = None;
}

pub fn clear(state: &mut SelectionState) {
    *state = SelectionState::default();
}

/// Apply a partial change and return the resulting snapshot (what the command manager
/// records as the `selectionOverride`). Mirrors web `applySelectionPatch`.
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
