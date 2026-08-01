//! Stateless clipboard operations. `copy` reads the current selection and writes the
//! clipboard (a non-undoable mutation, exactly as the web `ClipboardManager.copy`).
//! Paste is *not* here — it is a `Command`, because it mutates the document and must be
//! undoable; see `crate::command`.

use crate::state::{ClipboardEntry, ClipboardState, SelectionState};

/// Capture the selected elements into a clipboard entry. Returns `false` (no-op) when
/// there is nothing to copy, matching web semantics.
pub fn copy(clipboard: &mut ClipboardState, selection: &SelectionState) -> bool {
    if selection.elements.is_empty() {
        return false;
    }
    clipboard.entry = Some(ClipboardEntry {
        elements: selection.elements.clone(),
    });
    true
}
