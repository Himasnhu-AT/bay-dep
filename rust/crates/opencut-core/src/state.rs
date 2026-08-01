//! The single owned editor state. Every manager the web app modeled as a separate
//! class with its own listener set collapses into one struct here. Free-function
//! modules (`crate::selection`, `crate::clipboard`) take `&mut` slices of this — so
//! there is exactly one owner, no `&mut` aliasing, and no per-manager lock.

use serde::{Deserialize, Serialize};

use crate::refs::{ElementRef, KeyframeRef, MaskPointSelection};

/// What is currently selected in the editor. Mirrors the web `SelectionManager`
/// fields; a clone of this is a selection snapshot.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionState {
    pub elements: Vec<ElementRef>,
    pub keyframes: Vec<KeyframeRef>,
    pub keyframe_anchor: Option<KeyframeRef>,
    pub mask_points: Option<MaskPointSelection>,
}

/// The three mutually-exclusive kinds of active selection, in specificity order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectionKind {
    MaskPoints,
    Keyframes,
    Elements,
}

impl SelectionState {
    /// The most specific non-empty selection, matching web `getActiveSelectionKind`.
    pub fn active_kind(&self) -> Option<SelectionKind> {
        if self.mask_points.as_ref().is_some_and(|m| !m.point_ids.is_empty()) {
            Some(SelectionKind::MaskPoints)
        } else if !self.keyframes.is_empty() {
            Some(SelectionKind::Keyframes)
        } else if !self.elements.is_empty() {
            Some(SelectionKind::Elements)
        } else {
            None
        }
    }
}

/// One clipboard payload. The web `ClipboardEntry` is a tagged union over element /
/// keyframe copies; the spike models the element case, which is enough to exercise
/// copy→paste→undo across selection + document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardEntry {
    pub elements: Vec<ElementRef>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardState {
    pub entry: Option<ClipboardEntry>,
}

/// A minimal stand-in for the timeline document: the flat set of elements that exist.
/// Insert/paste push here and undo removes — giving the history a real mutation to
/// invert, distinct from the selection change.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub elements: Vec<ElementRef>,
}

/// The whole editor state — the single value `Editor` owns.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorState {
    pub selection: SelectionState,
    pub clipboard: ClipboardState,
    pub document: Document,
}
