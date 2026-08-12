//! Editor engine tests: real editing commands over the Project model, reversible undo/redo,
//! web-faithful selectionOverride semantics, coalesced one-event-per-command, and paste.

use std::sync::mpsc;

use bay_core::{Command, Editor, EditorEvent, ElementRef, TextElement, TrackLane};
use bay_project::{Element, MediaTime};

fn text(id: &str, name: &str) -> Element {
    Element::Text(TextElement {
        id: id.into(),
        name: name.into(),
        start: MediaTime::ZERO,
        duration: MediaTime::from_ticks(120_000),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        content: "x".into(),
        font_size: 48.0,
        color: "#fff".into(),
        transform: bay_project::Transform::default(),
        effects: Vec::new(),
        animations: Default::default(),
        blend_mode: Default::default(),
        mask: None,
        font_family: None,
        font_weight: 400,
        align: Default::default(),
        letter_spacing: 0.0,
        line_height: 1.2,
        source: Default::default(),
        role: Default::default(),
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
    let mut editor = Editor::new(bay_project::Project::starter());
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
    use bay_core::Transform;
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
        ..Transform::default()
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
    let json = serde_json::to_string(&bay_project::Project::starter()).unwrap();
    let loaded: bay_project::Project = serde_json::from_str(&json).unwrap();
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
    use bay_core::Effect;
    let mut editor = Editor::starter();
    let reference = main_ref("el-title");
    let brightness = Effect {
        id: "fx1".into(),
        effect_type: "brightness".into(),
        enabled: true,
        params: [("amount".to_string(), 1.5)].into_iter().collect(),
        asset: None,
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
            asset: None,
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
    use bay_core::{AnimationChannel, Effect, Keyframe};
    let mut editor = Editor::starter();
    let reference = main_ref("el-title");

    let mut animations = std::collections::BTreeMap::new();
    animations.insert(
        "opacity".to_string(),
        AnimationChannel {
            keys: vec![Keyframe::new(MediaTime::ZERO, 0.2)],
            easing: Default::default(),
        },
    );
    assert!(editor.execute(Command::ApplyMotionPreset {
        reference: reference.clone(),
        effects: vec![Effect {
            id: "p-fx".into(),
            effect_type: "brightness".into(),
            enabled: true,
            params: [("amount".to_string(), 1.5)].into_iter().collect(),
            asset: None,
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
    use bay_project::BlendMode;
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
    use bay_project::BlendMode;
    let mut seen = std::collections::HashSet::new();
    let mut mode = BlendMode::Normal;
    for _ in 0..BlendMode::ALL.len() {
        assert!(seen.insert(mode), "next() must not repeat before wrapping");
        mode = mode.next();
    }
    assert_eq!(mode, BlendMode::Normal, "cycling wraps back to the start");
    assert_eq!(seen.len(), 17);
}

#[test]
fn blend_mode_wire_format_is_kebab_case_for_interop() {
    use bay_project::BlendMode;
    // The compositor (rust/crates/compositor/src/blend_mode.rs) and the web app
    // (apps/web/src/rendering/index.ts) both use kebab-case. A camelCase project file would
    // silently fail to round-trip between the native and web editors.
    for (mode, wire) in [
        (BlendMode::ColorBurn, "\"color-burn\""),
        (BlendMode::PlusLighter, "\"plus-lighter\""),
        (BlendMode::SoftLight, "\"soft-light\""),
        (BlendMode::Normal, "\"normal\""),
    ] {
        assert_eq!(serde_json::to_string(&mode).unwrap(), wire);
        let back: BlendMode = serde_json::from_str(wire).unwrap();
        assert_eq!(back, mode);
    }
}

// ---------------------------------------------------------------------------------------
// Source in/out points.
//
// The distinction these tests pin down: a **trim** moves an edge and eats the source behind
// it, so the frame under the edge does not change; a **move** slides the clip and changes
// nothing about what it plays; a **slip** changes what it plays without moving it. Before
// this existed, all three did the same thing — which is why dragging a clip's head only ever
// re-showed the same first frame.

const SECOND: i64 = 120_000;

fn seconds(n: f64) -> MediaTime {
    MediaTime::from_seconds_f64(n).expect("representable")
}

fn video(id: &str, start: f64, duration: f64, trim_start: f64) -> Element {
    Element::Video(bay_project::VideoElement {
        id: id.into(),
        name: id.into(),
        start: seconds(start),
        duration: seconds(duration),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        media_id: "clip".into(),
        trim_start: seconds(trim_start),
        trim_end: seconds(trim_start + duration),
        transform: bay_project::Transform::default(),
        effects: Vec::new(),
        animations: Default::default(),
        blend_mode: Default::default(),
        mask: None,
        source: Default::default(),
        role: Default::default(),
    })
}

/// A project holding one video clip over a source of `source_seconds` (or an unprobed source
/// when `None`, which is what a machine with no ffprobe produces).
fn with_video(source_seconds: Option<f64>, element: Element) -> Editor {
    let mut project = bay_project::Project::starter();
    let mut asset = bay_project::MediaAsset::new("clip", "clip.mp4", "/tmp/clip.mp4");
    asset.duration_seconds = source_seconds;
    project.media.push(asset);
    let scene = project.active_scene_mut();
    scene.tracks.main.elements.clear();
    scene.tracks.main.elements.push(element);
    Editor::new(project)
}

fn source_start_of(editor: &Editor, id: &str) -> MediaTime {
    editor
        .active_scene()
        .element(&main_ref(id))
        .unwrap()
        .source_start()
        .expect("a video has an in-point")
}

/// The whole point: the head moving forward one second skips one second of footage, so the
/// frame at the new edge is the frame that was already sitting there.
#[test]
fn trimming_the_head_consumes_source() {
    let mut editor = with_video(Some(60.0), video("v", 0.0, 10.0, 2.0));
    assert!(editor.execute(Command::TrimElement {
        reference: main_ref("v"),
        start: seconds(3.0),
        duration: seconds(7.0),
    }));
    assert_eq!(source_start_of(&editor, "v"), seconds(5.0));

    // And it is one undo step, source included.
    editor.undo();
    assert_eq!(source_start_of(&editor, "v"), seconds(2.0));
    let element = editor.active_scene().element(&main_ref("v")).unwrap();
    assert_eq!(element.start(), MediaTime::ZERO);
    assert_eq!(element.duration(), seconds(10.0));
}

/// Moving a clip is not trimming it. Sliding it down the timeline must leave what it plays
/// exactly where it was, or every reposition would silently re-cut the shot.
#[test]
fn moving_a_clip_leaves_its_footage_alone() {
    let mut editor = with_video(Some(60.0), video("v", 0.0, 10.0, 2.0));
    assert!(editor.execute(Command::MoveElement {
        reference: main_ref("v"),
        start: seconds(4.0),
    }));
    assert_eq!(source_start_of(&editor, "v"), seconds(2.0));
}

/// There is no footage before the first frame. A head dragged past it gives back the
/// overshoot instead of pretending frames exist.
#[test]
fn a_head_trim_stops_at_the_start_of_the_file() {
    let mut editor = with_video(Some(60.0), video("v", 5.0, 10.0, 1.0));
    // Asking to start 3s earlier would need source -2s.
    assert!(editor.execute(Command::TrimElement {
        reference: main_ref("v"),
        start: seconds(2.0),
        duration: seconds(13.0),
    }));
    let element = editor.active_scene().element(&main_ref("v")).unwrap();
    assert_eq!(source_start_of(&editor, "v"), MediaTime::ZERO);
    assert_eq!(
        element.start(),
        seconds(4.0),
        "gave back the 2s it overshot"
    );
    assert_eq!(element.duration(), seconds(11.0));
}

/// And none past the last frame — a tail dragged beyond the end is shortened to fit.
#[test]
fn a_tail_trim_stops_at_the_end_of_the_file() {
    let mut editor = with_video(Some(10.0), video("v", 0.0, 2.0, 8.0));
    assert!(editor.execute(Command::TrimElement {
        reference: main_ref("v"),
        start: MediaTime::ZERO,
        duration: seconds(5.0), // would read to source 13s of a 10s file
    }));
    let element = editor.active_scene().element(&main_ref("v")).unwrap();
    assert_eq!(element.duration(), seconds(2.0));
}

/// A file nobody could probe has no known end, so the trim has nothing to stop at. Guessing a
/// length would be worse: it would refuse edits that are actually fine.
#[test]
fn an_unprobed_source_has_no_far_edge() {
    let mut editor = with_video(None, video("v", 0.0, 2.0, 8.0));
    assert!(editor.execute(Command::TrimElement {
        reference: main_ref("v"),
        start: MediaTime::ZERO,
        duration: seconds(5.0),
    }));
    assert_eq!(
        editor
            .active_scene()
            .element(&main_ref("v"))
            .unwrap()
            .duration(),
        seconds(5.0)
    );
}

/// Slip: the clip stays exactly where it is on the timeline, and plays a different part of
/// the shot.
#[test]
fn slipping_changes_what_plays_and_nothing_else() {
    let mut editor = with_video(Some(60.0), video("v", 3.0, 10.0, 2.0));
    assert!(editor.execute(Command::SetSourceStart {
        reference: main_ref("v"),
        trim_start: seconds(20.0),
    }));
    let element = editor.active_scene().element(&main_ref("v")).unwrap();
    assert_eq!(element.start(), seconds(3.0));
    assert_eq!(element.duration(), seconds(10.0));
    assert_eq!(source_start_of(&editor, "v"), seconds(20.0));
}

/// A slip cannot push the clip's tail off the end of the file either.
#[test]
fn a_slip_is_clamped_to_the_file() {
    let mut editor = with_video(Some(30.0), video("v", 0.0, 10.0, 0.0));
    editor.execute(Command::SetSourceStart {
        reference: main_ref("v"),
        trim_start: seconds(999.0),
    });
    assert_eq!(source_start_of(&editor, "v"), seconds(20.0));

    editor.execute(Command::SetSourceStart {
        reference: main_ref("v"),
        trim_start: MediaTime::from_ticks(-5 * SECOND),
    });
    assert_eq!(source_start_of(&editor, "v"), MediaTime::ZERO);
}

/// Splitting a shot must produce a cut, not the same section twice. The second half picks up
/// in the source exactly where the first one stopped.
#[test]
fn splitting_advances_the_second_halfs_in_point() {
    let mut editor = with_video(Some(60.0), video("v", 0.0, 10.0, 4.0));
    assert!(editor.execute(Command::SplitElement {
        reference: main_ref("v"),
        at: seconds(6.0),
        new_id: "v-b".into(),
    }));
    assert_eq!(source_start_of(&editor, "v"), seconds(4.0));
    assert_eq!(source_start_of(&editor, "v-b"), seconds(10.0));
}

/// Text has no timeline inside it, so trimming a title is still exactly a change of placement
/// and length — and slipping one is a no-op rather than an error.
#[test]
fn a_title_has_no_in_point_to_move() {
    let mut editor = Editor::starter();
    editor.execute(Command::TrimElement {
        reference: main_ref("el-title"),
        start: seconds(0.5),
        duration: seconds(1.5),
    });
    let element = editor
        .active_scene()
        .element(&main_ref("el-title"))
        .unwrap();
    assert_eq!(element.start(), seconds(0.5));
    assert_eq!(element.duration(), seconds(1.5));
    assert!(element.source_start().is_none());

    assert!(
        !editor.execute(Command::SetSourceStart {
            reference: main_ref("el-title"),
            trim_start: seconds(1.0),
        }),
        "there is nothing to slip inside a title"
    );
}

/// An edge dragged all the way through its own clip would leave nothing to grab again.
#[test]
fn a_trim_that_would_erase_the_clip_is_refused() {
    let mut editor = with_video(Some(60.0), video("v", 0.0, 10.0, 0.0));
    assert!(!editor.execute(Command::TrimElement {
        reference: main_ref("v"),
        start: MediaTime::ZERO,
        duration: MediaTime::ZERO,
    }));
    assert_eq!(
        editor
            .active_scene()
            .element(&main_ref("v"))
            .unwrap()
            .duration(),
        seconds(10.0)
    );
}

/// The out-point is derived, never independent: it must track every change to the in-point
/// and the length, because the web app reads it out of the project file.
#[test]
fn the_out_point_tracks_the_clip() {
    let mut editor = with_video(Some(60.0), video("v", 0.0, 10.0, 2.0));
    editor.execute(Command::TrimElement {
        reference: main_ref("v"),
        start: seconds(1.0),
        duration: seconds(4.0),
    });
    let bay_project::Element::Video(clip) = editor.active_scene().element(&main_ref("v")).unwrap()
    else {
        panic!("still a video");
    };
    assert_eq!(clip.trim_start, seconds(3.0));
    assert_eq!(clip.trim_end, seconds(7.0), "in-point plus the length");
}

/// Ripple delete: take a clip out and close the hole behind it. A plain delete leaves a gap
/// that reads as a stall in the finished video, which is why this is the one you usually want.
#[test]
fn ripple_delete_closes_the_gap_and_undo_reopens_it() {
    let mut editor = Editor::starter(); // el-title 0..3s, el-logo 3..7s on the main lane
    assert!(editor.execute(Command::RippleDelete {
        reference: main_ref("el-title"),
    }));

    let main = &editor.active_scene().tracks.main;
    assert!(main.element("el-title").is_none());
    assert_eq!(
        main.element("el-logo").unwrap().start(),
        MediaTime::ZERO,
        "the clip behind it moved back by the removed clip's length"
    );

    editor.undo();
    let main = &editor.active_scene().tracks.main;
    assert!(
        main.element("el-title").is_some(),
        "one undo brings it all back"
    );
    assert_eq!(main.element("el-logo").unwrap().start(), seconds(3.0));
}

/// Only the lane the clip was on moves. The lanes under it are not necessarily cut to the
/// same rhythm, and shifting them would silently re-sync the whole film.
#[test]
fn a_ripple_delete_leaves_other_lanes_where_they_are() {
    let mut editor = Editor::starter();
    let caption_start = editor
        .active_scene()
        .element(&ElementRef::new("track-overlay", "el-caption"))
        .unwrap()
        .start();

    editor.execute(Command::RippleDelete {
        reference: main_ref("el-title"),
    });

    assert_eq!(
        editor
            .active_scene()
            .element(&ElementRef::new("track-overlay", "el-caption"))
            .unwrap()
            .start(),
        caption_start
    );
}

#[test]
fn markers_land_in_time_order_and_reverse() {
    let mut editor = Editor::starter();
    for (id, at) in [("b", 4.0), ("a", 1.0), ("c", 9.0)] {
        assert!(editor.execute(Command::AddMarker {
            id: id.into(),
            time: seconds(at),
            label: format!("marker {id}"),
        }));
    }
    let times: Vec<f64> = editor
        .active_scene()
        .markers
        .iter()
        .map(|marker| marker.time.to_seconds_f64())
        .collect();
    assert_eq!(times, vec![1.0, 4.0, 9.0], "kept sorted as they arrive");

    // A duplicate id is refused rather than shadowing the original.
    assert!(!editor.execute(Command::AddMarker {
        id: "a".into(),
        time: seconds(2.0),
        label: String::new(),
    }));

    assert!(editor.execute(Command::RemoveMarker { id: "b".into() }));
    assert_eq!(editor.active_scene().markers.len(), 2);
    editor.undo();
    assert_eq!(editor.active_scene().markers.len(), 3);
    assert_eq!(editor.active_scene().markers[1].time, seconds(4.0));
}

/// What a drag can land on. A clip must not offer its own edges, or it would refuse to move.
#[test]
fn snap_targets_are_every_edge_but_the_dragged_clips_own() {
    let mut editor = Editor::starter();
    editor.execute(Command::AddMarker {
        id: "m".into(),
        time: seconds(5.5),
        label: String::new(),
    });

    let all = editor.active_scene().snap_targets(None);
    assert!(all.contains(&MediaTime::ZERO), "the start of the timeline");
    assert!(all.contains(&seconds(3.0)), "a clip boundary");
    assert!(all.contains(&seconds(5.5)), "the marker");
    assert!(
        all.windows(2).all(|pair| pair[0] < pair[1]),
        "sorted, no duplicates"
    );

    // Moved somewhere its edges belong to nothing else, so their absence means something.
    editor.execute(Command::MoveElement {
        reference: main_ref("el-logo"),
        start: seconds(20.0),
    });
    let dragging = editor
        .active_scene()
        .snap_targets(Some(&main_ref("el-logo")));
    assert!(
        !dragging.contains(&seconds(20.0)),
        "a clip cannot snap to its own head"
    );
    assert!(!dragging.contains(&seconds(24.0)), "nor to its own tail");
    assert!(
        dragging.contains(&seconds(3.0)),
        "its neighbours are still there"
    );
}

/// Re-registering an id **replaces** the asset rather than shadowing it with a second copy.
///
/// An id is what every clip on the timeline points at, so two assets sharing one makes "which
/// file does this clip play" depend on iteration order. It is also what lets `audio_probe`
/// update a file imported before loudness was recorded: pushing a measured duplicate behind the
/// unmeasured original would have left every reader still seeing the unmeasured one.
#[test]
fn re_registering_a_media_id_updates_it_instead_of_duplicating_it() {
    use bay_project::{AssetLoudness, MediaAsset};

    let mut editor = Editor::new(bay_project::Project::starter());
    let before = editor.media().len();
    editor.add_media(MediaAsset::new("m-bed", "bed.wav", "/tmp/bed.wav"));
    assert_eq!(editor.media().len(), before + 1);

    let mut measured = MediaAsset::new("m-bed", "bed.wav", "/tmp/bed.wav");
    measured.loudness = Some(AssetLoudness {
        peak_db: -23.8,
        rms_db: -35.0,
        lufs: -35.3,
        accent_seconds: Vec::new(),
    });
    editor.add_media(measured);

    let held: Vec<&MediaAsset> = editor
        .media()
        .iter()
        .filter(|asset| asset.id == "m-bed")
        .collect();
    assert_eq!(held.len(), 1, "one id, one asset");
    assert_eq!(
        held[0].loudness.as_ref().map(|l| l.lufs),
        Some(-35.3),
        "and it is the measured one"
    );
}
