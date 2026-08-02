//! Editor engine tests: real editing commands over the Project model, reversible undo/redo,
//! web-faithful selectionOverride semantics, coalesced one-event-per-command, and paste.

use std::sync::mpsc;

use opencut_core::{
    Command, Editor, EditorEvent, ElementRef, TextElement, TrackLane,
};
use opencut_project::{Element, MediaTime};

fn text(id: &str, name: &str) -> Element {
    Element::Text(TextElement {
        id: id.into(),
        name: name.into(),
        start: MediaTime::ZERO,
        duration: MediaTime::from_ticks(120_000),
        content: "x".into(),
        font_size: 48.0,
        color: "#fff".into(),
    })
}

fn main_ref(element_id: &str) -> ElementRef {
    ElementRef::new("track-main", element_id)
}

fn record_events(editor: &mut Editor) -> mpsc::Receiver<EditorEvent> {
    let (tx, rx) = mpsc::channel();
    editor.subscribe(move |event: &EditorEvent| {
        tx.send(*event).ok();
    });
    rx
}

#[test]
fn add_element_executes_undoes_and_redoes() {
    let mut editor = Editor::new(opencut_project::Project::starter());
    let before = editor.active_scene().tracks.main.elements.len();

    assert!(editor.execute(Command::AddElement {
        track_id: "track-main".into(),
        element: text("el-new", "New"),
        select: true,
    }));
    assert_eq!(editor.active_scene().tracks.main.elements.len(), before + 1);
    assert!(editor.is_selected(&main_ref("el-new")));

    assert!(editor.undo());
    assert_eq!(editor.active_scene().tracks.main.elements.len(), before);

    assert!(editor.redo());
    assert_eq!(editor.active_scene().tracks.main.elements.len(), before + 1);
    assert!(editor.active_scene().tracks.main.element("el-new").is_some());
}

#[test]
fn move_and_rename_are_reversible() {
    let mut editor = Editor::starter();
    let reference = main_ref("el-title");
    let original_start = editor.active_scene().element(&reference).unwrap().start();

    editor.execute(Command::MoveElement {
        reference: reference.clone(),
        start: MediaTime::from_ticks(600_000),
    });
    editor.execute(Command::RenameElement {
        reference: reference.clone(),
        name: "Renamed".into(),
    });
    assert_eq!(editor.active_scene().element(&reference).unwrap().name(), "Renamed");
    assert_eq!(
        editor.active_scene().element(&reference).unwrap().start(),
        MediaTime::from_ticks(600_000)
    );

    editor.undo(); // rename
    assert_eq!(editor.active_scene().element(&reference).unwrap().name(), "Title");
    editor.undo(); // move
    assert_eq!(editor.active_scene().element(&reference).unwrap().start(), original_start);
}

#[test]
fn set_element_duration_is_reversible() {
    let mut editor = Editor::starter();
    let reference = main_ref("el-title");
    let original = editor.active_scene().element(&reference).unwrap().duration();

    editor.execute(Command::SetElementDuration {
        reference: reference.clone(),
        duration: MediaTime::from_ticks(1_000_000),
    });
    assert_eq!(
        editor.active_scene().element(&reference).unwrap().duration(),
        MediaTime::from_ticks(1_000_000)
    );

    editor.undo();
    assert_eq!(
        editor.active_scene().element(&reference).unwrap().duration(),
        original
    );
}

#[test]
fn seek_clamps_to_content_duration() {
    let mut editor = Editor::starter();
    let duration = editor.duration();
    assert!(duration > MediaTime::ZERO);

    editor.seek(MediaTime::from_ticks(i64::MAX)); // past the end
    assert_eq!(editor.playhead(), duration);

    editor.seek(MediaTime::from_ticks(-100)); // before the start
    assert_eq!(editor.playhead(), MediaTime::ZERO);
}

#[test]
fn set_text_content_only_applies_to_text_elements() {
    let mut editor = Editor::starter();

    assert!(editor.execute(Command::SetTextContent {
        reference: main_ref("el-title"),
        content: "Updated".into(),
    }));
    // el-logo is an image → no-op.
    assert!(!editor.execute(Command::SetTextContent {
        reference: main_ref("el-logo"),
        content: "nope".into(),
    }));

    let title = editor.active_scene().element(&main_ref("el-title")).unwrap();
    assert!(matches!(title, Element::Text(t) if t.content == "Updated"));
}

#[test]
fn removing_a_selected_element_clears_it_and_undo_restores_both() {
    let mut editor = Editor::starter();
    editor.select(vec![main_ref("el-title")]);
    assert!(editor.is_selected(&main_ref("el-title")));

    assert!(editor.execute(Command::RemoveElement {
        reference: main_ref("el-title"),
    }));
    assert!(editor.active_scene().element(&main_ref("el-title")).is_none());
    assert!(!editor.is_selected(&main_ref("el-title")));

    editor.undo();
    assert!(editor.active_scene().element(&main_ref("el-title")).is_some());
    assert!(editor.is_selected(&main_ref("el-title"))); // selection restored (override)
}

#[test]
fn undo_leaves_a_later_ui_selection_untouched() {
    let mut editor = Editor::starter();
    // A move has no selection intent.
    editor.execute(Command::MoveElement {
        reference: main_ref("el-logo"),
        start: MediaTime::from_ticks(999),
    });
    editor.select(vec![main_ref("el-title")]); // user clicks something else

    editor.undo(); // undo the move
    assert!(editor.is_selected(&main_ref("el-title"))); // untouched
}

#[test]
fn add_and_remove_track_are_reversible() {
    let mut editor = Editor::starter();
    let overlay_before = editor.active_scene().tracks.overlay.len();

    assert!(editor.execute(Command::AddTrack {
        lane: TrackLane::Overlay,
        id: "track-x".into(),
        name: "Extra".into(),
    }));
    assert_eq!(editor.active_scene().tracks.overlay.len(), overlay_before + 1);

    assert!(editor.execute(Command::RemoveTrack {
        track_id: "track-x".into(),
    }));
    assert_eq!(editor.active_scene().tracks.overlay.len(), overlay_before);

    // The main lane cannot be removed.
    assert!(!editor.execute(Command::RemoveTrack {
        track_id: "track-main".into(),
    }));
}

#[test]
fn copy_paste_duplicates_selected_elements_with_fresh_ids() {
    let mut editor = Editor::starter();
    editor.select(vec![main_ref("el-title")]);
    assert!(editor.copy());
    assert_eq!(editor.clipboard_len(), 1);

    let before = editor.active_scene().tracks.main.elements.len();
    assert!(editor.execute(Command::Paste));
    assert_eq!(editor.active_scene().tracks.main.elements.len(), before + 1);

    // The pasted copy has a fresh id and is now selected.
    let pasted = editor.selected_element().expect("a pasted element is selected");
    assert_ne!(pasted.id(), "el-title");
    assert!(pasted.id().starts_with("el-title-copy-"));

    editor.undo();
    assert_eq!(editor.active_scene().tracks.main.elements.len(), before);
}

#[test]
fn each_command_emits_exactly_one_coalesced_event() {
    let mut editor = Editor::starter();
    let rx = record_events(&mut editor);

    editor.execute(Command::AddElement {
        track_id: "track-main".into(),
        element: text("el-a", "A"),
        select: true,
    }); // document + selection → 1 event
    editor.select(vec![main_ref("el-title")]); // 1
    editor.copy(); // 1
    editor.undo(); // 1
    editor.redo(); // 1

    let events: Vec<EditorEvent> = rx.try_iter().collect();
    assert_eq!(events.len(), 5, "one coalesced event per operation");
    assert_eq!(
        events.iter().map(|e| e.epoch).collect::<Vec<_>>(),
        vec![1, 2, 3, 4, 5]
    );
    // The AddElement touched both domains but surfaced as a single event.
    assert!(events[0].changed.document && events[0].changed.selection);
}

#[test]
fn no_op_commands_record_no_history_and_emit_no_event() {
    let mut editor = Editor::starter();
    let rx = record_events(&mut editor);

    assert!(!editor.execute(Command::Paste)); // empty clipboard
    assert!(!editor.execute(Command::RemoveElement {
        reference: main_ref("missing"),
    }));
    assert!(!editor.execute(Command::MoveElement {
        reference: ElementRef::new("no-track", "x"),
        start: MediaTime::ZERO,
    }));

    assert!(!editor.can_undo());
    assert_eq!(rx.try_iter().count(), 0);
}

#[test]
fn command_enum_is_a_stable_tagged_serde_surface() {
    let json = serde_json::to_string(&Command::MoveElement {
        reference: main_ref("el-title"),
        start: MediaTime::from_ticks(120_000),
    })
    .unwrap();
    assert!(json.contains("\"type\":\"moveElement\""));

    let round_tripped: Command = serde_json::from_str(&json).unwrap();
    assert!(matches!(round_tripped, Command::MoveElement { .. }));
}
