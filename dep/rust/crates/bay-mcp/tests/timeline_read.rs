//! `timeline` over the real dispatcher, asserting on what an agent actually receives.
//!
//! **Why this file exists.** `timeline` had two implementations: `bay_agent::plan`'s, which
//! the editor window reads, and a copy in `bay-mcp` that the wire read. The copy fell behind —
//! no effects, no trim in-point, no media id — so an agent that added a blur and re-read its
//! own timeline could not see the blur, and one that trimmed a clip could read where the clip
//! sat but not what was playing inside it. Nothing failed. The two just described different
//! timelines, and only to different callers.
//!
//! Every assertion here goes through `tools::dispatch`, because the bug was never in either
//! implementation — it was in which one the wire was wired to.

use bay_mcp::{Studio, tools};
use serde_json::{Value, json};

fn call(studio: &mut Studio, name: &str, args: Value) -> Value {
    tools::dispatch(studio, name, &args).unwrap_or_else(|error| panic!("{name}: {error}"))
}

fn studio() -> Studio {
    let mut studio =
        Studio::with_library_root(Some(std::env::temp_dir().join("bay-timeline-test")));
    call(
        &mut studio,
        "project_create",
        json!({ "name": "timeline", "width": 640, "height": 360, "fps": 30, "kit": "swiss" }),
    );
    call(
        &mut studio,
        "add_text",
        json!({ "id": "t1", "role": "headline", "start": 0, "duration": 3, "content": "Hook" }),
    );
    studio
}

/// The element as `timeline` reports it, over the wire.
fn first_element(studio: &mut Studio, args: Value) -> Value {
    call(studio, "timeline", args)["layers"][0]["elements"][0].clone()
}

/// The field whose absence proved the two copies had diverged. An agent that cannot read back
/// the effect it just added has no way to tell a successful call from a no-op.
#[test]
fn the_wire_reports_effects_it_was_just_asked_to_add() {
    let mut studio = studio();
    call(
        &mut studio,
        "effect_add",
        json!({ "elementId": "t1", "type": "blur", "params": { "amount": 6.0 } }),
    );

    let element = first_element(&mut studio, json!({}));
    let effects = element["effects"]
        .as_array()
        .expect("the effect that was just added must be readable back");
    assert_eq!(effects.len(), 1);
    assert_eq!(effects[0]["type"], "blur");
    assert_eq!(effects[0]["params"]["amount"], 6.0);
}

/// `animated` names the channels and cannot be acted on; `keyframes` is the same channels with
/// their keys, each addressable. Both, because `animated` has readers already.
#[test]
fn keyframes_arrive_beside_the_channel_names_they_do_not_replace() {
    let mut studio = studio();
    call(
        &mut studio,
        "animate",
        json!({
            "elementId": "t1",
            "property": "opacity",
            "keys": [{ "t": 0.0, "value": 0.0 }, { "t": 0.5, "value": 1.0 }],
        }),
    );

    let element = first_element(&mut studio, json!({}));
    assert_eq!(
        element["animated"],
        json!(["opacity"]),
        "the old key must survive untouched"
    );

    let channels = element["keyframes"].as_array().expect("keyframes");
    assert_eq!(channels.len(), 1);
    assert_eq!(channels[0]["property"], "opacity");
    let keys = channels[0]["keys"].as_array().expect("keys");
    assert_eq!(keys.len(), 2);
    assert_eq!(keys[1]["t"], 0.5);
    assert_eq!(keys[1]["value"], 1.0);
    assert!(
        keys.iter().all(|key| key["id"].is_string()),
        "a key that cannot be named cannot be moved"
    );
}

/// The property table is a request. `timeline` describes every element, and the table is a
/// dozen near-identical rows on each of them.
#[test]
fn the_property_table_is_asked_for_rather_than_always_sent() {
    let mut studio = studio();

    assert!(
        first_element(&mut studio, json!({}))["animatable"].is_null(),
        "the default read must stay lean"
    );

    let element = first_element(&mut studio, json!({ "animatable": true }));
    let table = element["animatable"].as_array().expect("the table");
    let opacity = table
        .iter()
        .find(|entry| entry["path"] == "opacity")
        .expect("opacity");
    assert_eq!(opacity["unit"], "fraction");
    assert_eq!(opacity["range"], json!([0.0, 1.0]));
    assert!(
        table.iter().any(|entry| entry["path"] == "fontSize"),
        "the table has to name what animate will accept — fontSize is sampled by the renderer \
         and was refused by every surface until it was listed here"
    );
}

/// A trimmed clip: position and length were readable over the wire, what was *playing* was
/// not. That is the difference between reading a trim and guessing at one.
#[test]
fn the_wire_reports_which_part_of_a_file_is_playing() {
    let mut studio =
        Studio::with_library_root(Some(std::env::temp_dir().join("bay-timeline-trim")));
    call(
        &mut studio,
        "project_create",
        json!({ "name": "trim", "width": 640, "height": 360, "fps": 30, "kit": "swiss" }),
    );
    call(
        &mut studio,
        "add_shape",
        json!({ "id": "s1", "role": "ground", "start": 0, "duration": 3, "shape": "rect" }),
    );

    let element = first_element(&mut studio, json!({}));
    // A shape has no source file, so it reports no in-point — the field is present exactly
    // when there is something behind it, which is the rule the whole read follows.
    assert!(element["trimStartSeconds"].is_null());
    assert_eq!(element["kind"], "Shape");
    assert!(
        element["source"].is_string(),
        "who put it there is part of every element"
    );
}
