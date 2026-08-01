//! The command surface. One serde-tagged enum is simultaneously (a) the undo/redo unit,
//! (b) the autosave/replay log entry, and (c) the future MCP tool surface — the single
//! choke point the architecture decision was built around.
//!
//! A `Command` is *lowered* against the current state into a concrete [`Lowered`] effect
//! at execute time (capturing, e.g., exactly which elements a `Paste` resolved to), so the
//! recorded history is deterministic to replay and invert regardless of later state.

use serde::{Deserialize, Serialize};

use crate::refs::ElementRef;
use crate::selection::SelectionPatch;
use crate::state::{Document, EditorState};

/// A caller-submitted command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Command {
    /// Programmatically set the element selection. Declares a selection change, so undo
    /// restores the prior selection.
    SetSelection { elements: Vec<ElementRef> },
    /// Insert elements into the document **without** touching the selection. Undo removes
    /// them but leaves whatever the user has since selected alone.
    InsertElements { elements: Vec<ElementRef> },
    /// Paste the clipboard entry: insert its elements into the document **and** select
    /// them. Undo removes them and restores the prior selection.
    Paste,
}

/// The kind label carried into history (for diagnostics / debugging).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandKind {
    SetSelection,
    InsertElements,
    Paste,
}

/// A concrete, replayable document mutation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocMutation {
    Insert(Vec<ElementRef>),
    Remove(Vec<ElementRef>),
    Nop,
}

impl DocMutation {
    /// The mutation that exactly reverses this one.
    pub fn inverse(&self) -> DocMutation {
        match self {
            DocMutation::Insert(elements) => DocMutation::Remove(elements.clone()),
            DocMutation::Remove(elements) => DocMutation::Insert(elements.clone()),
            DocMutation::Nop => DocMutation::Nop,
        }
    }

    /// Apply to the document; returns whether anything actually changed.
    pub fn apply(&self, document: &mut Document) -> bool {
        match self {
            DocMutation::Insert(elements) => {
                if elements.is_empty() {
                    return false;
                }
                document.elements.extend(elements.iter().cloned());
                true
            }
            DocMutation::Remove(elements) => {
                let before = document.elements.len();
                document.elements.retain(|e| !elements.contains(e));
                document.elements.len() != before
            }
            DocMutation::Nop => false,
        }
    }
}

/// A command resolved against current state into its concrete effect.
pub struct Lowered {
    pub kind: CommandKind,
    pub doc_forward: DocMutation,
    /// `Some` when the command changed editor-owned selection — this is the flag the
    /// history uses to decide whether undo restores the prior selection.
    pub selection_patch: Option<SelectionPatch>,
}

impl Command {
    /// Resolve against `state`. Returns `None` for a no-op (e.g. paste with an empty
    /// clipboard, insert of nothing) so the executor records no history and emits no event.
    pub fn lower(&self, state: &EditorState) -> Option<Lowered> {
        match self {
            Command::SetSelection { elements } => Some(Lowered {
                kind: CommandKind::SetSelection,
                doc_forward: DocMutation::Nop,
                selection_patch: Some(SelectionPatch::select_elements(elements.clone())),
            }),
            Command::InsertElements { elements } => {
                if elements.is_empty() {
                    return None;
                }
                Some(Lowered {
                    kind: CommandKind::InsertElements,
                    doc_forward: DocMutation::Insert(elements.clone()),
                    selection_patch: None,
                })
            }
            Command::Paste => {
                let entry = state.clipboard.entry.as_ref()?;
                if entry.elements.is_empty() {
                    return None;
                }
                let elements = entry.elements.clone();
                Some(Lowered {
                    kind: CommandKind::Paste,
                    doc_forward: DocMutation::Insert(elements.clone()),
                    selection_patch: Some(SelectionPatch::select_elements(elements)),
                })
            }
        }
    }
}
