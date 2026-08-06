//! Stateless clipboard capture. `copy` snapshots the *data* of the selected elements from the
//! active scene (a non-undoable mutation, as in the web app). Paste is a `Command` because it
//! mutates the project and must be undoable; see `crate::editor` / `crate::command`.

use vii_project::{Element, Project};

use crate::state::{ClipboardEntry, ClipboardState, SelectionState};

/// Copy the currently-selected elements' data into the clipboard. Returns `false` (no-op) when
/// nothing selected resolves to an element.
pub fn copy(clipboard: &mut ClipboardState, project: &Project, selection: &SelectionState) -> bool {
    let scene = project.active_scene();
    let elements: Vec<Element> = selection
        .elements
        .iter()
        .filter_map(|reference| scene.element(reference).cloned())
        .collect();

    if elements.is_empty() {
        return false;
    }
    clipboard.entry = Some(ClipboardEntry { elements });
    true
}
