//! Placement arguments that must survive the call rather than being quietly dropped.
//!
//! **Why this file exists.** `add_shape` and `add_text` build their transform with
//! `..Transform::default()`, so a new field is accepted by the JSON schema, ignored by the
//! builder, and reported as success. That is not hypothetical: it is exactly how gradients
//! shipped "working" once — the tool took `gradient`, the planner it was wired through was
//! never the one being called, and a flat frame was read as a ramp. The cost is always the
//! same, and it is always paid late: the call succeeds, the picture is wrong, and nothing says
//! why until somebody looks at a rendered frame.
//!
//! So every argument that reaches an element through a struct-update expression gets a line
//! here, asserting on the stored element rather than on the tool's reply.

use bay_mcp::{Studio, tools};
use serde_json::{Value, json};

fn call(studio: &mut Studio, name: &str, args: Value) -> Value {
    tools::dispatch(studio, name, &args).unwrap_or_else(|error| panic!("{name}: {error}"))
}

fn studio() -> Studio {
    let mut studio = Studio::with_library_root(Some(std::env::temp_dir().join("bay-tools-test")));
    call(
        &mut studio,
        "project_create",
        json!({ "name": "placement", "width": 640, "height": 360, "fps": 30, "kit": "swiss" }),
    );
    studio
}

fn element<'a>(studio: &'a Studio, id: &str) -> &'a bay_project::Element {
    studio
        .project()
        .active_scene()
        .elements()
        .find(|element| element.id() == id)
        .unwrap_or_else(|| panic!("{id} is not in the scene"))
}

#[test]
fn a_tilt_given_at_placement_reaches_the_element() {
    let mut studio = studio();
    call(
        &mut studio,
        "add_shape",
        json!({
            "id": "panel", "shape": "rect", "role": "ground", "tone": "dim",
            "start": 0.0, "duration": 2.0, "tiltX": -9.0, "tiltY": 4.0
        }),
    );
    let transform = element(&studio, "panel")
        .transform()
        .expect("a shape has a transform");
    assert_eq!(transform.tilt_x, -9.0, "tiltX was dropped on the way in");
    assert_eq!(transform.tilt_y, 4.0, "tiltY was dropped on the way in");
}

#[test]
fn a_typed_line_keeps_its_rate_and_its_caret() {
    let mut studio = studio();
    call(
        &mut studio,
        "add_text",
        json!({
            "id": "call", "content": "add_text", "role": "label",
            "start": 0.0, "duration": 3.0,
            "typeOn": { "charsPerSecond": 26.0, "caret": true }
        }),
    );
    let bay_project::Element::Text(text) = element(&studio, "call") else {
        panic!("add_text made something that is not text");
    };
    let spec = text.type_on.expect("typeOn was dropped on the way in");
    assert_eq!(spec.chars_per_second, 26.0);
    assert!(spec.caret);
}

/// A rate of zero means the line never finishes arriving. Refused at the door rather than
/// clamped, because the symptom — a title that is simply never on screen — costs a render to
/// find and looks like a bug in the renderer rather than in the call.
#[test]
fn a_typing_rate_of_zero_is_refused() {
    let mut studio = studio();
    let error = tools::dispatch(
        &mut studio,
        "add_text",
        &json!({
            "content": "never arrives", "role": "label", "start": 0.0, "duration": 3.0,
            "typeOn": { "charsPerSecond": 0.0 }
        }),
    )
    .expect_err("a zero rate has to be refused");
    assert!(
        format!("{error:?}").contains("greater than zero"),
        "the refusal should say what is wrong: {error:?}"
    );
}

/// An outline as wide as the shape is a fill, and asking for one is a mistake worth naming.
///
/// This shipped in a film: a timeline panel asked for with `strokeWidth: 0.9`, meaning "a
/// border", drew as a grey slab across the middle of the frame. The call succeeded, `check`
/// was clean, and the only way to find it was to look at a rendered frame.
#[test]
fn a_stroke_as_wide_as_the_shape_is_refused() {
    let mut studio = studio();
    let error = tools::dispatch(
        &mut studio,
        "add_shape",
        &json!({
            "shape": "rect", "role": "ground", "tone": "dim",
            "start": 0.0, "duration": 2.0, "strokeWidth": 0.9
        }),
    )
    .expect_err("a stroke that wide has to be refused");
    assert!(
        format!("{error:?}").contains("outline"),
        "the refusal should say what it drew instead: {error:?}"
    );

    // A real border still works.
    call(
        &mut studio,
        "add_shape",
        json!({
            "id": "bordered", "shape": "rect", "role": "ground", "tone": "dim",
            "start": 0.0, "duration": 2.0, "strokeWidth": 0.012
        }),
    );
    let bay_project::Element::Shape(shape) = element(&studio, "bordered") else {
        panic!("add_shape made something that is not a shape");
    };
    assert!(shape.stroke.is_some(), "a hairline border should survive");
}

/// A corner radius given in pixels draws a stadium, because the field is a fraction and the
/// rasteriser clamps it. Both panels in a launch film came out as lozenges this way.
#[test]
fn a_corner_radius_in_pixels_is_refused() {
    let mut studio = studio();
    let error = tools::dispatch(
        &mut studio,
        "add_shape",
        &json!({
            "shape": "rect", "role": "ground", "tone": "dim",
            "start": 0.0, "duration": 2.0, "radius": 10.0
        }),
    )
    .expect_err("a radius of 10 has to be refused");
    assert!(
        format!("{error:?}").contains("pixel"),
        "the refusal should name the mistake: {error:?}"
    );
}
