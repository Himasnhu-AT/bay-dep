//! The single owned editor state: the `Project` being edited plus the editor-session
//! selection and clipboard. Free-function modules (`crate::selection`, `crate::clipboard`)
//! and the command patches mutate `&mut` slices of this — one owner, no aliasing, no locks.

use serde::{Deserialize, Serialize};

use opencut_project::{Element, MediaTime, Project};

use crate::refs::{ElementRef, KeyframeRef, MaskPointSelection};

/// What is currently selected. A clone of this is a selection snapshot.
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
    /// The most specific non-empty selection (mask points > keyframes > elements).
    pub fn active_kind(&self) -> Option<SelectionKind> {
        if self
            .mask_points
            .as_ref()
            .is_some_and(|m| !m.point_ids.is_empty())
        {
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

/// A clipboard payload: the actual copied element data (not references), so paste works
/// across scenes/projects and survives the originals being deleted.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardEntry {
    pub elements: Vec<Element>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardState {
    pub entry: Option<ClipboardEntry>,
}

/// The whole editor state — the single value `Editor` owns.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorState {
    pub project: Project,
    pub selection: SelectionState,
    pub clipboard: ClipboardState,
    /// The transport playhead position (non-undoable UI state).
    #[serde(default)]
    pub playhead: MediaTime,
}

impl EditorState {
    pub fn new(project: Project) -> Self {
        Self {
            project,
            selection: SelectionState::default(),
            clipboard: ClipboardState::default(),
            playhead: MediaTime::ZERO,
        }
    }
}
