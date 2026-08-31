//! The keyframe commands: what can carry a key, moving one as a single edit, and setting the
//! curve on a key or on a whole channel.

use bay_core::{Command, Editor, ElementRef, KeyframeCurve};
use bay_project::{BezierHandles, Easing, Effect, Mask, MaskShape, MediaTime};
use std::collections::BTreeMap;

fn secs(seconds: f64) -> MediaTime {
    MediaTime::from_seconds_f64(seconds).expect("a representable time")
}

fn title() -> ElementRef {
    ElementRef::new("track-main", "el-title")
}

/// The starter project, with one channel already on the title so there is something to revise.
fn editor_with_a_channel(property: &str) -> Editor {
    let mut editor = Editor::starter();
    assert!(editor.execute(Command::AddKeyframe {
        reference: title(),
        property: property.into(),
        time: secs(0.0),
        value: 0.0,
    }));
    assert!(editor.execute(Command::AddKeyframe {
        reference: title(),
        property: property.into(),
        time: secs(1.0),
        value: 1.0,
    }));
    editor
}

fn channel(editor: &Editor, property: &str) -> bay_project::AnimationChannel {
    editor
        .active_scene()
        .element(&title())
        .expect("the title")
        .animations()
        .expect("animations")
        .get(property)
        .cloned()
        .unwrap_or_else(|| panic!("no {property} channel"))
}

// ------------------------------------------------------- what can carry a key

/// The defect. `AddKeyframe` validated against the flat thirteen while `animate` over MCP
/// accepted `effect.<id>.<param>`, so the same edit worked from an agent and vanished from
/// the editor — and vanished *silently*, since the lowering returns `None`: no patch, no undo
/// entry, no error.
#[test]
fn a_key_lands_on_an_effect_parameter() {
    let mut editor = Editor::starter();
    assert!(editor.execute(Command::AddEffect {
        reference: title(),
        effect: Effect {
            id: "fx-1".into(),
            effect_type: "blur".into(),
            enabled: true,
            params: BTreeMap::from([("amount".to_string(), 4.0)]),
            asset: None,
        },
    }));

    assert!(
        editor.execute(Command::AddKeyframe {
            reference: title(),
            property: "effect.fx-1.amount".into(),
            time: secs(0.5),
            value: 12.0,
        }),
        "an effect parameter the renderer samples must be keyable"
    );
    assert_eq!(channel(&editor, "effect.fx-1.amount").keys.len(), 1);
}

#[test]
fn a_key_lands_on_a_mask_field() {
    let mut editor = Editor::starter();
    let mut element = editor
        .active_scene()
        .element(&title())
        .expect("the title")
        .clone();
    if let bay_project::Element::Text(text) = &mut element {
        text.mask = Some(Mask {
            shape: MaskShape::Rect,
            x: 0.5,
            y: 0.5,
            width: 0.5,
            height: 0.5,
            feather: 0.0,
            inverted: false,
        });
    }
    assert!(editor.execute(Command::ReplaceElement {
        reference: title(),
        element,
    }));

    assert!(editor.execute(Command::AddKeyframe {
        reference: title(),
        property: "mask.x".into(),
        time: secs(0.0),
        value: 0.2,
    }));
    assert_eq!(channel(&editor, "mask.x").keys.len(), 1);
}

/// And the line still holds where it should: a path nothing reads is refused rather than
/// stored. A channel with no sampler behind it is a successful edit and an unchanged frame.
#[test]
fn a_key_on_a_property_nothing_reads_is_refused() {
    let mut editor = Editor::starter();
    for property in ["wobble", "effect.fx-9.amount", "mask.x"] {
        assert!(
            !editor.execute(Command::AddKeyframe {
                reference: title(),
                property: property.into(),
                time: secs(0.0),
                value: 1.0,
            }),
            "{property} has nothing behind it and must be refused"
        );
    }
    assert!(
        editor
            .active_scene()
            .element(&title())
            .and_then(|element| element.animations())
            .is_none_or(|animations| animations.is_empty()),
        "a refused key must not leave a channel behind"
    );
}

// ------------------------------------------------------------ moving a key

/// A drag is one edit. It used to be remove-plus-add: two undo entries, and the key ceased to
/// exist between them, so anything holding it was holding nothing.
#[test]
fn moving_a_key_is_one_undoable_edit_that_keeps_its_value_and_curve() {
    let mut editor = editor_with_a_channel("opacity");
    assert!(editor.execute(Command::SetKeyframeCurve {
        reference: title(),
        property: "opacity".into(),
        keyframe_id: channel(&editor, "opacity").keys[1].identity(),
        curve: KeyframeCurve::Named {
            easing: Easing::SpringOut
        },
    }));

    let before = channel(&editor, "opacity");
    let id = before.keys[1].identity();

    assert!(editor.execute(Command::MoveKeyframe {
        reference: title(),
        property: "opacity".into(),
        keyframe_id: id.clone(),
        time: secs(0.4),
    }));

    let after = channel(&editor, "opacity");
    let moved = after.key(&id).expect("still addressable by the same id");
    assert_eq!(moved.time, secs(0.4));
    assert_eq!(moved.value, 1.0, "a move changes when, not what");
    assert_eq!(moved.easing, Some(Easing::SpringOut), "and not the curve");

    // One entry, not two.
    assert!(editor.undo());
    assert_eq!(channel(&editor, "opacity"), before);
    assert!(editor.redo());
    assert_eq!(
        channel(&editor, "opacity").key(&id).unwrap().time,
        secs(0.4)
    );
}

#[test]
fn moving_a_key_that_is_not_there_is_not_an_edit() {
    let mut editor = editor_with_a_channel("opacity");
    let before = channel(&editor, "opacity");
    assert!(!editor.execute(Command::MoveKeyframe {
        reference: title(),
        property: "opacity".into(),
        keyframe_id: "k999".into(),
        time: secs(0.4),
    }));
    assert_eq!(channel(&editor, "opacity"), before);
}

/// Moving a key onto another replaces it, and the channel stays sorted — which is the
/// invariant `sample` walks `windows(2)` assuming.
#[test]
fn moving_a_key_onto_another_leaves_a_channel_still_in_order() {
    let mut editor = editor_with_a_channel("opacity");
    assert!(editor.execute(Command::AddKeyframe {
        reference: title(),
        property: "opacity".into(),
        time: secs(0.5),
        value: 0.5,
    }));
    let id = channel(&editor, "opacity").keys[2].identity();

    assert!(editor.execute(Command::MoveKeyframe {
        reference: title(),
        property: "opacity".into(),
        keyframe_id: id,
        time: secs(0.5),
    }));

    let after = channel(&editor, "opacity");
    assert_eq!(after.keys.len(), 2);
    assert!(
        after
            .keys
            .windows(2)
            .all(|pair| pair[0].time < pair[1].time),
        "the channel came back out of order"
    );
}

// ------------------------------------------------------------- setting curves

/// The three states of one setting. Whichever is chosen, the other two are cleared — a key
/// claiming a named curve and a drawn one at once would be resolved by the sampler's
/// precedence rather than by what the author last did.
#[test]
fn a_keys_curve_has_three_states_and_only_ever_one_of_them() {
    let mut editor = editor_with_a_channel("opacity");
    let id = channel(&editor, "opacity").keys[0].identity();
    let set = |editor: &mut Editor, curve| {
        editor.execute(Command::SetKeyframeCurve {
            reference: title(),
            property: "opacity".into(),
            keyframe_id: id.clone(),
            curve,
        })
    };

    assert!(set(
        &mut editor,
        KeyframeCurve::Named {
            easing: Easing::ExpoOut
        }
    ));
    let key = channel(&editor, "opacity").keys[0];
    assert_eq!(key.easing, Some(Easing::ExpoOut));
    assert_eq!(key.handles, None);

    let drawn = BezierHandles {
        out_x: 0.1,
        out_y: 0.9,
        in_x: 0.4,
        in_y: 1.0,
    };
    assert!(set(&mut editor, KeyframeCurve::Drawn { handles: drawn }));
    let key = channel(&editor, "opacity").keys[0];
    assert_eq!(key.handles, Some(drawn));
    assert_eq!(key.easing, None, "the named curve must be cleared");

    assert!(set(&mut editor, KeyframeCurve::Channel));
    let key = channel(&editor, "opacity").keys[0];
    assert_eq!(key.easing, None);
    assert_eq!(key.handles, None);
}

#[test]
fn setting_a_curve_undoes_and_redoes() {
    let mut editor = editor_with_a_channel("opacity");
    let before = channel(&editor, "opacity");
    let id = before.keys[0].identity();

    assert!(editor.execute(Command::SetKeyframeCurve {
        reference: title(),
        property: "opacity".into(),
        keyframe_id: id,
        curve: KeyframeCurve::Named {
            easing: Easing::BackOut
        },
    }));
    assert!(editor.undo());
    assert_eq!(channel(&editor, "opacity"), before);
    assert!(editor.redo());
    assert_eq!(
        channel(&editor, "opacity").keys[0].easing,
        Some(Easing::BackOut)
    );
}

#[test]
fn setting_the_channels_easing_changes_every_key_that_did_not_override_it() {
    let mut editor = editor_with_a_channel("opacity");
    assert_eq!(channel(&editor, "opacity").easing, Easing::Linear);

    assert!(editor.execute(Command::SetChannelEasing {
        reference: title(),
        property: "opacity".into(),
        easing: Easing::PowerOut,
    }));
    assert_eq!(channel(&editor, "opacity").easing, Easing::PowerOut);

    assert!(editor.undo());
    assert_eq!(channel(&editor, "opacity").easing, Easing::Linear);
}

/// Setting the easing it already has is not an edit. An undo entry that restores the state it
/// was already in is one press of Cmd+Z that appears to do nothing.
#[test]
fn setting_the_easing_a_channel_already_has_is_not_an_edit() {
    let mut editor = editor_with_a_channel("opacity");
    assert!(!editor.execute(Command::SetChannelEasing {
        reference: title(),
        property: "opacity".into(),
        easing: Easing::Linear,
    }));
}

#[test]
fn the_curve_commands_refuse_a_channel_that_is_not_there() {
    let mut editor = Editor::starter();
    assert!(!editor.execute(Command::SetChannelEasing {
        reference: title(),
        property: "opacity".into(),
        easing: Easing::PowerOut,
    }));
    assert!(!editor.execute(Command::SetKeyframeCurve {
        reference: title(),
        property: "opacity".into(),
        keyframe_id: "k1".into(),
        curve: KeyframeCurve::Channel,
    }));
    assert!(!editor.execute(Command::MoveKeyframe {
        reference: title(),
        property: "opacity".into(),
        keyframe_id: "k1".into(),
        time: secs(0.5),
    }));
}
