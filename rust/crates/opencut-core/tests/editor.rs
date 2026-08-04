//! Editor engine tests: real editing commands over the Project model, reversible undo/redo,
//! web-faithful selectionOverride semantics, coalesced one-event-per-command, and paste.

use std::sync::mpsc;

use opencut_core::{Command, Editor, EditorEvent, ElementRef, TextElement, TrackLane};
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
        transform: opencut_project::Transform::default(),
        effects: Vec::new(),
        animations: Default::default(),
        blend_mode: Default::default(),
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
    assert!(
        editor
            .active_scene()
            .tracks
            .main
            .element("el-new")
            .is_some()
    );
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
    assert_eq!(
        editor.active_scene().element(&reference).unwrap().name(),
        "Renamed"
    );
    assert_eq!(
        editor.active_scene().element(&reference).unwrap().start(),
        MediaTime::from_ticks(600_000)
    );

    editor.undo(); // rename
    assert_eq!(
        editor.active_scene().element(&reference).unwrap().name(),
        "Title"
    );
    editor.undo(); // move
    assert_eq!(
        editor.active_scene().element(&reference).unwrap().start(),
        original_start
    );
}

#[test]
fn set_element_duration_is_reversible() {
    let mut editor = Editor::starter();
    let reference = main_ref("el-title");
    let original = editor
        .active_scene()
        .element(&reference)
        .unwrap()
        .duration();

    editor.execute(Command::SetElementDuration {
        reference: reference.clone(),
        duration: MediaTime::from_ticks(1_000_000),
    });
    assert_eq!(
        editor
            .active_scene()
            .element(&reference)
            .unwrap()
            .duration(),
        MediaTime::from_ticks(1_000_000)
    );

    editor.undo();
    assert_eq!(
        editor
            .active_scene()
            .element(&reference)
            .unwrap()
            .duration(),
        original
    );
}

#[test]
fn split_element_divides_it_and_undo_rejoins() {
    let mut editor = Editor::starter();
    // el-title runs 0..3s; split at 1s.
    assert!(editor.execute(Command::SplitElement {
        reference: main_ref("el-title"),
        at: MediaTime::from_ticks(120_000),
        new_id: "el-title-b".into(),
    }));

    let main = &editor.active_scene().tracks.main;
    assert_eq!(
        main.element("el-title").unwrap().duration(),
        MediaTime::from_ticks(120_000)
    );
    let right = main.element("el-title-b").unwrap();
    assert_eq!(right.start(), MediaTime::from_ticks(120_000));
    assert_eq!(right.duration(), MediaTime::from_ticks(240_000));
    assert!(editor.is_selected(&main_ref("el-title-b")));

    // A split point outside the element is a no-op.
    assert!(!editor.execute(Command::SplitElement {
        reference: main_ref("el-title"),
        at: MediaTime::ZERO,
        new_id: "nope".into(),
    }));

    editor.undo();
    assert!(
        editor
            .active_scene()
            .tracks
            .main
            .element("el-title-b")
            .is_none()
    );
    assert_eq!(
        editor
            .active_scene()
            .tracks
            .main
            .element("el-title")
            .unwrap()
            .duration(),
        MediaTime::from_ticks(360_000)
    );
}

#[test]
fn trim_element_sets_start_and_duration_in_one_undo_step() {
    let mut editor = Editor::starter();
    let reference = main_ref("el-title"); // starts 0, dur 3s
    editor.execute(Command::TrimElement {
        reference: reference.clone(),
        start: MediaTime::from_ticks(60_000),     // 0.5s
        duration: MediaTime::from_ticks(180_000), // 1.5s
    });
    let element = editor.active_scene().element(&reference).unwrap();
    assert_eq!(element.start(), MediaTime::from_ticks(60_000));
    assert_eq!(element.duration(), MediaTime::from_ticks(180_000));

    editor.undo(); // one step restores both
    let element = editor.active_scene().element(&reference).unwrap();
    assert_eq!(element.start(), MediaTime::ZERO);
    assert_eq!(element.duration(), MediaTime::from_ticks(360_000));
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
fn set_transform_applies_to_visuals_and_reverses() {
    use opencut_core::Transform;
    let mut editor = Editor::starter();
    let reference = main_ref("el-title");
    let original = editor
        .active_scene()
        .element(&reference)
        .unwrap()
        .transform()
        .unwrap();

    let moved = Transform {
        x: 0.1,
        y: 0.2,
        scale: 0.5,
        rotation: 15.0,
        opacity: 0.4,
    };
    assert!(editor.execute(Command::SetTransform {
        reference: reference.clone(),
        transform: moved,
    }));
    assert_eq!(
        editor
            .active_scene()
            .element(&reference)
            .unwrap()
            .transform()
            .unwrap(),
        moved
    );

    // Audio has no transform → no-op.
    assert!(!editor.execute(Command::SetTransform {
        reference: ElementRef::new("track-audio", "el-music"),
        transform: moved,
    }));

    editor.undo();
    assert_eq!(
        editor
            .active_scene()
            .element(&reference)
            .unwrap()
            .transform()
            .unwrap(),
        original
    );
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

    let title = editor
        .active_scene()
        .element(&main_ref("el-title"))
        .unwrap();
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
    assert!(
        editor
            .active_scene()
            .element(&main_ref("el-title"))
            .is_none()
    );
    assert!(!editor.is_selected(&main_ref("el-title")));

    editor.undo();
    assert!(
        editor
            .active_scene()
            .element(&main_ref("el-title"))
            .is_some()
    );
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
    assert_eq!(
        editor.active_scene().tracks.overlay.len(),
        overlay_before + 1
    );

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
fn add_and_remove_scene_are_reversible_and_switch_works() {
    let mut editor = Editor::starter();
    assert_eq!(editor.scenes().len(), 1);

    assert!(editor.execute(Command::AddScene {
        id: "scene-2".into(),
        name: "Scene 2".into(),
    }));
    assert_eq!(editor.scenes().len(), 2);

    // Switch to the new scene (non-undoable nav) — it starts empty.
    editor.switch_scene("scene-2");
    assert_eq!(editor.active_scene_id(), "scene-2");
    assert!(editor.active_scene().tracks.main.elements.is_empty());

    editor.undo(); // undo AddScene
    assert_eq!(editor.scenes().len(), 1);
    // Removing the now-missing active scene fell back to the first scene.
    assert_eq!(editor.active_scene_id(), "scene-main");
}

#[test]
fn the_last_scene_cannot_be_removed() {
    let mut editor = Editor::starter();
    assert!(!editor.execute(Command::RemoveScene {
        scene_id: "scene-main".into(),
    }));
    assert_eq!(editor.scenes().len(), 1);
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
    let pasted = editor
        .selected_element()
        .expect("a pasted element is selected");
    assert_ne!(pasted.id(), "el-title");
    assert!(pasted.id().starts_with("el-title-copy-"));

    editor.undo();
    assert_eq!(editor.active_scene().tracks.main.elements.len(), before);
}

#[test]
fn load_project_replaces_state_and_resets_history() {
    let mut editor = Editor::starter();
    editor.execute(Command::RenameElement {
        reference: main_ref("el-title"),
        name: "Edited".into(),
    });
    editor.select(vec![main_ref("el-title")]);
    assert!(editor.can_undo());

    // A fresh project (round-tripped through JSON, as a load would be).
    let json = serde_json::to_string(&opencut_project::Project::starter()).unwrap();
    let loaded: opencut_project::Project = serde_json::from_str(&json).unwrap();
    editor.load_project(loaded);

    // Original content is back, history/selection/playhead are reset.
    assert_eq!(
        editor
            .active_scene()
            .element(&main_ref("el-title"))
            .unwrap()
            .name(),
        "Title"
    );
    assert!(!editor.can_undo());
    assert!(editor.selection().is_empty());
    assert_eq!(editor.playhead(), MediaTime::ZERO);
}

#[test]
fn duplicate_element_places_a_copy_after_the_original() {
    let mut editor = Editor::starter();
    let before = editor.active_scene().tracks.main.elements.len();
    let original_end = editor
        .active_scene()
        .element(&main_ref("el-title"))
        .unwrap()
        .end();

    assert!(editor.execute(Command::DuplicateElement {
        reference: main_ref("el-title"),
        new_id: "el-title-dup".into(),
    }));
    assert_eq!(editor.active_scene().tracks.main.elements.len(), before + 1);
    let copy = editor
        .active_scene()
        .element(&main_ref("el-title-dup"))
        .unwrap();
    assert_eq!(copy.start(), original_end); // placed right after
    assert!(editor.is_selected(&main_ref("el-title-dup")));

    editor.undo();
    assert!(
        editor
            .active_scene()
            .element(&main_ref("el-title-dup"))
            .is_none()
    );
}

#[test]
fn track_hidden_and_muted_toggle_reversibly() {
    let mut editor = Editor::starter();
    assert!(!editor.active_scene().tracks.main.hidden);

    editor.execute(Command::SetTrackHidden {
        track_id: "track-main".into(),
        hidden: true,
    });
    assert!(editor.active_scene().tracks.main.hidden);

    editor.execute(Command::SetTrackMuted {
        track_id: "track-audio".into(),
        muted: true,
    });
    assert!(editor.active_scene().tracks.audio[0].muted);

    editor.undo(); // mute
    assert!(!editor.active_scene().tracks.audio[0].muted);
    editor.undo(); // hidden
    assert!(!editor.active_scene().tracks.main.hidden);
}

#[test]
fn effects_add_toggle_param_and_remove_all_reverse() {
    use opencut_core::Effect;
    let mut editor = Editor::starter();
    let reference = main_ref("el-title");
    let brightness = Effect {
        id: "fx1".into(),
        effect_type: "brightness".into(),
        enabled: true,
        params: [("amount".to_string(), 1.5)].into_iter().collect(),
    };

    // Add
    assert!(editor.execute(Command::AddEffect {
        reference: reference.clone(),
        effect: brightness,
    }));
    assert_eq!(
        editor
            .active_scene()
            .element(&reference)
            .unwrap()
            .effects()
            .len(),
        1
    );

    // Toggle enabled off
    assert!(editor.execute(Command::ToggleEffect {
        reference: reference.clone(),
        effect_id: "fx1".into(),
    }));
    assert!(!editor.active_scene().element(&reference).unwrap().effects()[0].enabled);

    // Set a param
    assert!(editor.execute(Command::SetEffectParam {
        reference: reference.clone(),
        effect_id: "fx1".into(),
        key: "amount".into(),
        value: 2.0,
    }));
    assert_eq!(
        editor.active_scene().element(&reference).unwrap().effects()[0].params["amount"],
        2.0
    );

    // Undo param, toggle, add → back to empty
    editor.undo();
    assert_eq!(
        editor.active_scene().element(&reference).unwrap().effects()[0].params["amount"],
        1.5
    );
    editor.undo();
    assert!(editor.active_scene().element(&reference).unwrap().effects()[0].enabled);
    editor.undo();
    assert!(
        editor
            .active_scene()
            .element(&reference)
            .unwrap()
            .effects()
            .is_empty()
    );

    // Audio can't take effects.
    assert!(!editor.execute(Command::AddEffect {
        reference: ElementRef::new("track-audio", "el-music"),
        effect: Effect {
            id: "fx2".into(),
            effect_type: "brightness".into(),
            enabled: true,
            params: Default::default(),
        },
    }));
}

#[test]
fn keyframes_animate_a_property_and_reverse() {
    let mut editor = Editor::starter();
    let reference = main_ref("el-title");

    // Two opacity keyframes: 1.0 at t=0, 0.0 at t=1s.
    editor.execute(Command::AddKeyframe {
        reference: reference.clone(),
        property: "opacity".into(),
        time: MediaTime::ZERO,
        value: 1.0,
    });
    editor.execute(Command::AddKeyframe {
        reference: reference.clone(),
        property: "opacity".into(),
        time: MediaTime::from_ticks(120_000),
        value: 0.0,
    });

    let element = editor.active_scene().element(&reference).unwrap();
    // Midpoint (0.5s) interpolates to 0.5 opacity.
    let sampled = element
        .sampled_transform(MediaTime::from_ticks(60_000))
        .unwrap();
    assert!(
        (sampled.opacity - 0.5).abs() < 1e-4,
        "got {}",
        sampled.opacity
    );
    assert_eq!(element.animated_property_count(), 1);

    // Undo both keyframes → no animation left.
    editor.undo();
    editor.undo();
    assert_eq!(
        editor
            .active_scene()
            .element(&reference)
            .unwrap()
            .animated_property_count(),
        0
    );

    // Keyframes only apply to visual elements.
    assert!(!editor.execute(Command::AddKeyframe {
        reference: ElementRef::new("track-audio", "el-music"),
        property: "opacity".into(),
        time: MediaTime::ZERO,
        value: 0.5,
    }));
}

#[test]
fn apply_motion_preset_adds_effects_and_animations_reversibly() {
    use opencut_core::{AnimationChannel, Effect, Keyframe};
    let mut editor = Editor::starter();
    let reference = main_ref("el-title");

    let mut animations = std::collections::BTreeMap::new();
    animations.insert(
        "opacity".to_string(),
        AnimationChannel {
            keys: vec![Keyframe {
                time: MediaTime::ZERO,
                value: 0.2,
            }],
        },
    );
    assert!(editor.execute(Command::ApplyMotionPreset {
        reference: reference.clone(),
        effects: vec![Effect {
            id: "p-fx".into(),
            effect_type: "brightness".into(),
            enabled: true,
            params: [("amount".to_string(), 1.5)].into_iter().collect(),
        }],
        animations,
    }));

    let element = editor.active_scene().element(&reference).unwrap();
    assert_eq!(element.effects().len(), 1);
    assert_eq!(element.animated_property_count(), 1);

    editor.undo();
    let element = editor.active_scene().element(&reference).unwrap();
    assert!(element.effects().is_empty());
    assert_eq!(element.animated_property_count(), 0);
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

#[test]
fn set_blend_mode_is_undoable_and_ignores_audio() {
    use opencut_project::BlendMode;
    let mut editor = Editor::starter();
    let reference = main_ref("el-title");

    assert_eq!(
        editor
            .project()
            .active_scene()
            .element(&reference)
            .unwrap()
            .blend_mode(),
        Some(BlendMode::Normal),
        "elements default to Normal"
    );

    assert!(editor.execute(Command::SetBlendMode {
        reference: reference.clone(),
        blend_mode: BlendMode::Screen,
    }));
    assert_eq!(
        editor
            .project()
            .active_scene()
            .element(&reference)
            .unwrap()
            .blend_mode(),
        Some(BlendMode::Screen)
    );

    // Undo restores the previous mode (the patch is self-inverting).
    assert!(editor.undo());
    assert_eq!(
        editor
            .project()
            .active_scene()
            .element(&reference)
            .unwrap()
            .blend_mode(),
        Some(BlendMode::Normal)
    );
    assert!(editor.redo());
    assert_eq!(
        editor
            .project()
            .active_scene()
            .element(&reference)
            .unwrap()
            .blend_mode(),
        Some(BlendMode::Screen)
    );

    // Audio has no blend mode, so the command must not record history.
    let audio = ElementRef::new("track-audio", "el-music");
    assert!(!editor.execute(Command::SetBlendMode {
        reference: audio,
        blend_mode: BlendMode::Multiply,
    }));
}

#[test]
fn blend_mode_cycles_through_every_mode() {
    use opencut_project::BlendMode;
    let mut seen = std::collections::HashSet::new();
    let mut mode = BlendMode::Normal;
    for _ in 0..BlendMode::ALL.len() {
        assert!(seen.insert(mode), "next() must not repeat before wrapping");
        mode = mode.next();
    }
    assert_eq!(mode, BlendMode::Normal, "cycling wraps back to the start");
    assert_eq!(seen.len(), 17);
}
