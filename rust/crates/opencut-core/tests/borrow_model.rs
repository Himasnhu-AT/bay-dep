//! P0-ARCH-01 exit-gate proofs: the owned-Editor / Command-enum / EventBus model executes
//! and undoes Selection + Clipboard commands, honours the web `selectionOverride` rule, and
//! emits exactly one coalesced event per command — with zero `Arc<RwLock>`/`RefCell`.

use std::sync::mpsc;

use opencut_core::{Command, Editor, EditorEvent, ElementRef};

fn el(id: &str) -> ElementRef {
    ElementRef::new("track-1", id)
}

/// Subscribe an mpsc-backed recorder (no `Arc`/`RwLock`/`RefCell`) and return the receiver.
fn record_events(editor: &mut Editor) -> mpsc::Receiver<EditorEvent> {
    let (tx, rx) = mpsc::channel();
    editor.subscribe(move |event: &EditorEvent| {
        tx.send(*event).ok();
    });
    rx
}

#[test]
fn document_command_executes_undoes_and_redoes() {
    let mut editor = Editor::new();

    assert!(editor.execute(Command::InsertElements {
        elements: vec![el("a"), el("b")],
    }));
    assert_eq!(editor.state().document.elements, vec![el("a"), el("b")]);
    assert!(editor.can_undo());

    assert!(editor.undo());
    assert!(editor.state().document.elements.is_empty());
    assert!(editor.can_redo());

    assert!(editor.redo());
    assert_eq!(editor.state().document.elements, vec![el("a"), el("b")]);
}

#[test]
fn undo_restores_selection_for_commands_that_declared_an_override() {
    let mut editor = Editor::new();

    editor.execute(Command::SetSelection {
        elements: vec![el("a")],
    });
    editor.execute(Command::SetSelection {
        elements: vec![el("b")],
    });
    assert_eq!(editor.state().selection.elements, vec![el("b")]);

    // Each SetSelection declared an override, so undo walks the selection back.
    editor.undo();
    assert_eq!(editor.state().selection.elements, vec![el("a")]);
    editor.undo();
    assert!(editor.state().selection.elements.is_empty());
}

#[test]
fn undo_leaves_selection_untouched_for_commands_without_selection_intent() {
    let mut editor = Editor::new();

    // A programmatic insert with no selection intent...
    editor.execute(Command::InsertElements {
        elements: vec![el("x")],
    });
    // ...then the user clicks to select something else (direct, non-undoable).
    editor.set_selection_direct(vec![el("clicked")]);

    // Undoing the insert must NOT clobber the user's live selection.
    editor.undo();
    assert!(editor.state().document.elements.is_empty());
    assert_eq!(editor.state().selection.elements, vec![el("clicked")]);
}

#[test]
fn copy_paste_round_trips_through_document_and_selection() {
    let mut editor = Editor::new();

    editor.set_selection_direct(vec![el("a"), el("b")]);
    assert!(editor.copy());
    assert_eq!(
        editor.state().clipboard.entry.as_ref().unwrap().elements,
        vec![el("a"), el("b")]
    );

    editor.set_selection_direct(vec![]); // deselect before pasting
    assert!(editor.execute(Command::Paste));
    assert_eq!(editor.state().document.elements, vec![el("a"), el("b")]);
    assert_eq!(editor.state().selection.elements, vec![el("a"), el("b")]);

    // Paste declared a selection override → undo clears both document and selection.
    editor.undo();
    assert!(editor.state().document.elements.is_empty());
    assert!(editor.state().selection.elements.is_empty());
}

#[test]
fn each_command_emits_exactly_one_coalesced_event() {
    let mut editor = Editor::new();
    let rx = record_events(&mut editor);

    editor.execute(Command::InsertElements {
        elements: vec![el("a")],
    });
    editor.execute(Command::SetSelection {
        elements: vec![el("a")],
    });
    editor.copy();
    editor.undo();
    editor.redo();

    // 5 state-changing operations → exactly 5 events, each with a distinct increasing epoch.
    let events: Vec<EditorEvent> = rx.try_iter().collect();
    assert_eq!(events.len(), 5, "one coalesced event per command");
    let epochs: Vec<u64> = events.iter().map(|e| e.epoch).collect();
    assert_eq!(epochs, vec![1, 2, 3, 4, 5]);
}

#[test]
fn multi_domain_command_coalesces_into_one_event_flagging_both_domains() {
    let mut editor = Editor::new();
    editor.set_selection_direct(vec![el("a")]);
    editor.copy();
    editor.set_selection_direct(vec![]);

    let rx = record_events(&mut editor);
    // Paste mutates document AND selection, but must surface as ONE event flagging both.
    editor.execute(Command::Paste);

    let events: Vec<EditorEvent> = rx.try_iter().collect();
    assert_eq!(events.len(), 1);
    assert!(events[0].changed.document);
    assert!(events[0].changed.selection);
    assert!(!events[0].changed.clipboard);
}

#[test]
fn no_op_commands_record_no_history_and_emit_no_event() {
    let mut editor = Editor::new();
    let rx = record_events(&mut editor);

    assert!(!editor.execute(Command::Paste)); // empty clipboard
    assert!(!editor.execute(Command::InsertElements { elements: vec![] }));
    assert!(!editor.copy()); // empty selection

    assert!(!editor.can_undo());
    assert_eq!(rx.try_iter().count(), 0, "no-ops emit nothing");
}

#[test]
fn command_enum_is_a_stable_tagged_serde_surface() {
    // The tagged JSON is the autosave/replay/MCP wire format — assert its shape is stable.
    let json = serde_json::to_string(&Command::SetSelection {
        elements: vec![el("a")],
    })
    .unwrap();
    assert_eq!(
        json,
        r#"{"type":"set-selection","elements":[{"trackId":"track-1","elementId":"a"}]}"#
    );

    let round_tripped: Command = serde_json::from_str(&json).unwrap();
    assert_eq!(
        round_tripped,
        Command::SetSelection {
            elements: vec![el("a")]
        }
    );
}
