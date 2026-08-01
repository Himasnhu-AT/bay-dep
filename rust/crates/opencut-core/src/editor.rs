//! The owned editor. Holds the single `EditorState`, the undo/redo stacks, and the event
//! bus — no `Arc`, no `RwLock`, no `RefCell`. Commands mutate state through exclusive
//! `&mut` borrows of disjoint fields, so the borrow checker alone guarantees no aliasing.

use crate::clipboard;
use crate::command::{Command, CommandKind, DocMutation};
use crate::event::{Domain, DomainSet, EditorEvent, EventBus};
use crate::refs::ElementRef;
use crate::selection::{self, SelectionPatch, SelectionSnapshot};
use crate::state::EditorState;

/// One recorded step. Stores the concrete forward and inverse document mutations plus the
/// selection bookkeeping that reproduces the web command-manager's `selectionOverride` rule.
struct HistoryEntry {
    #[allow(dead_code)]
    kind: CommandKind,
    doc_forward: DocMutation,
    doc_inverse: DocMutation,
    /// The forward selection change, replayed on redo. `None` for commands with no
    /// selection intent.
    selection_patch: Option<SelectionPatch>,
    /// Selection as it was *before* this command ran — restored on undo.
    previous_selection: SelectionSnapshot,
    /// `Some` iff this command changed editor-owned selection. This is the flag that
    /// decides whether undo restores `previous_selection` or leaves the current selection
    /// (a subsequent UI click / box-select) untouched.
    selection_override: Option<SelectionSnapshot>,
}

#[derive(Default)]
pub struct Editor {
    state: EditorState,
    history: Vec<HistoryEntry>,
    redo_stack: Vec<HistoryEntry>,
    bus: EventBus,
}

impl Editor {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn state(&self) -> &EditorState {
        &self.state
    }

    /// Subscribe to coalesced change events (exactly one per state-changing operation).
    pub fn subscribe(&mut self, subscriber: impl FnMut(&EditorEvent) + 'static) {
        self.bus.subscribe(subscriber);
    }

    pub fn can_undo(&self) -> bool {
        !self.history.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    /// Execute a command: lower it against current state, apply the document mutation and
    /// selection patch, record history, and emit exactly one coalesced event. Returns
    /// `false` (no history, no event) when the command lowers to a no-op.
    pub fn execute(&mut self, command: Command) -> bool {
        let Some(lowered) = command.lower(&self.state) else {
            return false;
        };

        self.bus.begin();
        let previous_selection = selection::snapshot(&self.state.selection);
        let mut changed = DomainSet::default();

        if lowered.doc_forward.apply(&mut self.state.document) {
            changed.document = true;
        }
        let doc_inverse = lowered.doc_forward.inverse();

        let selection_override = match lowered.selection_patch.clone() {
            Some(patch) => {
                let snapshot = selection::apply_patch(&mut self.state.selection, patch);
                changed.selection = true;
                Some(snapshot)
            }
            None => None,
        };

        self.bus.mark_set(changed);
        self.history.push(HistoryEntry {
            kind: lowered.kind,
            doc_forward: lowered.doc_forward,
            doc_inverse,
            selection_patch: lowered.selection_patch,
            previous_selection,
            selection_override,
        });
        self.redo_stack.clear();
        self.bus.commit();
        true
    }

    /// Undo the most recent command. Restores the prior selection **only** if that command
    /// declared a selection override; otherwise the current selection is left as-is.
    pub fn undo(&mut self) -> bool {
        let Some(entry) = self.history.pop() else {
            return false;
        };

        self.bus.begin();
        let mut changed = DomainSet::default();

        if entry.doc_inverse.apply(&mut self.state.document) {
            changed.document = true;
        }
        if entry.selection_override.is_some() {
            selection::restore(&mut self.state.selection, entry.previous_selection.clone());
            changed.selection = true;
        }

        self.bus.mark_set(changed);
        self.redo_stack.push(entry);
        self.bus.commit();
        true
    }

    /// Redo the most recently undone command, mirroring `execute`.
    pub fn redo(&mut self) -> bool {
        let Some(mut entry) = self.redo_stack.pop() else {
            return false;
        };

        self.bus.begin();
        let previous_selection = selection::snapshot(&self.state.selection);
        let mut changed = DomainSet::default();

        if entry.doc_forward.apply(&mut self.state.document) {
            changed.document = true;
        }
        let selection_override = match entry.selection_patch.clone() {
            Some(patch) => {
                let snapshot = selection::apply_patch(&mut self.state.selection, patch);
                changed.selection = true;
                Some(snapshot)
            }
            None => None,
        };

        self.bus.mark_set(changed);
        entry.previous_selection = previous_selection;
        entry.selection_override = selection_override;
        self.history.push(entry);
        self.bus.commit();
        true
    }

    /// Copy the current selection to the clipboard. Non-undoable (as in the web app);
    /// emits one event iff there was something to copy.
    pub fn copy(&mut self) -> bool {
        self.bus.begin();
        let copied = clipboard::copy(&mut self.state.clipboard, &self.state.selection);
        if copied {
            self.bus.mark(Domain::Clipboard);
        }
        self.bus.commit();
        copied
    }

    /// A direct, non-undoable selection change — models a UI-driven click / box-select that
    /// happens *between* commands. Emits one event; never recorded in history.
    pub fn set_selection_direct(&mut self, elements: Vec<ElementRef>) {
        self.bus.begin();
        selection::set_elements(&mut self.state.selection, elements);
        self.bus.mark(Domain::Selection);
        self.bus.commit();
    }
}
