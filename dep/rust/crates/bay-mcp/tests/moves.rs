//! The move registry and `animate`, over the wire.
//!
//! **The bug these exist for.** There used to be two implementations of `animate`: one in
//! `bay_agent::plan`, which the editor window used, and a second inside the headless studio,
//! which the MCP transport used. They diverged, as two implementations of one verb always do,
//! and the divergence was measurable in the output. The headless one:
//!
//! - knew 8 of the 14 easings, so it **rejected `spring-out`** — the curve five separate
//!   documents call the house entrance, and which appeared 4 times in a 188-element project;
//! - checked `property` against the global transform list instead of the element's own kind, so
//!   it **refused `volume`** on an audio clip, which is why a music bed was built as 13 clips
//!   with stepped gains and zero volume keyframes, and why the duck ran backwards;
//! - dropped per-key easing on the floor, so "arrive fast, hold, leave slowly" was unsayable.
//!
//! Each of those is a test here. The fix was not to repair the second implementation but to
//! delete it, which is why there is also a test that the schema and the parser agree.

use bay_mcp::{Studio, tools};
use serde_json::{Value, json};

fn scratch_studio(tag: &str) -> (Studio, std::path::PathBuf) {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("bay-moves-{tag}-{stamp}"));
    std::fs::create_dir_all(&root).unwrap();
    (Studio::with_library_root(Some(root.clone())), root)
}

fn call(studio: &mut Studio, name: &str, args: Value) -> Value {
    tools::dispatch(studio, name, &args).unwrap_or_else(|e| panic!("{name}: {e}"))
}

fn call_err(studio: &mut Studio, name: &str, args: Value) -> String {
    match tools::dispatch(studio, name, &args) {
        Ok(value) => panic!("{name} should have been refused, got {value}"),
        Err(error) => error.to_string(),
    }
}

fn headline(studio: &mut Studio, id: &str) {
    call(
        studio,
        "add_text",
        json!({ "role": "headline", "id": id, "start": 0, "duration": 6, "content": "Line" }),
    );
}

fn channel(studio: &Studio, element_id: &str, property: &str) -> bay_project::AnimationChannel {
    studio
        .project()
        .active_scene()
        .elements()
        .find(|e| e.id() == element_id)
        .unwrap_or_else(|| panic!("no element {element_id}"))
        .animations()
        .expect("animatable")
        .get(property)
        .unwrap_or_else(|| panic!("no {property} channel on {element_id}"))
        .clone()
}

// ------------------------------------------------------------------- the transport divergence

/// Every easing the schema advertises is one the wire actually accepts. The headless parser
/// knew eight names; the schema offered fourteen; the six in the gap failed with an error that
/// listed the eight, and `spring-out` was one of them.
#[test]
fn every_advertised_easing_is_reachable_over_mcp() {
    let (mut studio, _root) = scratch_studio("easings");
    call(&mut studio, "project_create", json!({ "kit": "swiss" }));
    headline(&mut studio, "t");

    for easing in bay_agent::plan::EASINGS {
        call(
            &mut studio,
            "animate",
            json!({ "elementId": "t", "property": "y", "easing": easing,
                    "keys": [{ "t": 0, "value": 0.5 }, { "t": 0.8, "value": 0.4 }] }),
        );
        let channel = channel(&studio, "t", "y");
        assert_eq!(
            serde_json::to_value(channel.easing).unwrap(),
            json!(easing),
            "{easing} did not survive the wire"
        );
    }

    let error = call_err(
        &mut studio,
        "animate",
        json!({ "elementId": "t", "property": "y", "easing": "wobble",
                "keys": [{ "t": 0, "value": 0.5 }, { "t": 0.8, "value": 0.4 }] }),
    );
    assert!(error.contains("wobble"), "{error}");
    assert!(
        error.contains("spring-out"),
        "the refusal lists what there is: {error}"
    );
}

/// A music bed's volume is keyframable over the wire. The headless path validated `property`
/// against the transform list, so this was refused outright — and a duck that cannot be
/// keyframed is a bed cut into 13 clips with stepped gains, which is what shipped.
#[test]
fn a_music_beds_volume_is_keyframable_over_mcp() {
    let (mut studio, root) = scratch_studio("volume");
    call(&mut studio, "project_create", json!({ "kit": "swiss" }));
    // Any file will do: an unprobeable asset is reported, not refused, and this test is about
    // the animation surface rather than about decode.
    let path = root.join("bed.wav");
    std::fs::write(&path, b"RIFF....WAVEfmt ").unwrap();
    let media = call(
        &mut studio,
        "media_import",
        json!({ "path": path.to_string_lossy(), "id": "bed-media" }),
    );
    assert_eq!(media["mediaId"], json!("bed-media"));
    call(
        &mut studio,
        "add_audio",
        json!({ "mediaId": "bed-media", "id": "bed", "start": 0, "duration": 20, "role": "bed" }),
    );

    call(
        &mut studio,
        "animate",
        json!({ "elementId": "bed", "property": "volume", "easing": "sine-in-out",
                "keys": [{ "t": 0, "value": 0.9 }, { "t": 1.0, "value": 0.28 },
                         { "t": 8.0, "value": 0.28 }, { "t": 9.0, "value": 0.9 }] }),
    );
    let volume = channel(&studio, "bed", "volume");
    assert_eq!(volume.keys.len(), 4);
    assert!((volume.keys[1].value - 0.28).abs() < 1e-6, "{volume:?}");

    // …and a channel an audio clip does not have is still refused, by name.
    let error = call_err(
        &mut studio,
        "animate",
        json!({ "elementId": "bed", "property": "x",
                "keys": [{ "t": 0, "value": 0.0 }, { "t": 1, "value": 0.2 }] }),
    );
    assert!(error.contains("volume"), "{error}");
}

/// Per-key easing survives the wire. Without it, "arrive fast, hold, then leave slowly" has to
/// be faked with dense keys — which samples back out as a straight line, so the fake does not
/// even work.
#[test]
fn per_key_easing_survives_the_wire() {
    let (mut studio, _root) = scratch_studio("perkey");
    call(&mut studio, "project_create", json!({ "kit": "swiss" }));
    headline(&mut studio, "t");
    call(
        &mut studio,
        "animate",
        json!({ "elementId": "t", "property": "y", "easing": "linear",
                "keys": [{ "t": 0, "value": 0.6, "easing": "spring-out" },
                         { "t": 0.8, "value": 0.4, "easing": "hold" },
                         { "t": 3.0, "value": 0.4, "easing": "power4-in" },
                         { "t": 3.4, "value": 0.7 }] }),
    );
    let y = channel(&studio, "t", "y");
    let easings: Vec<Option<bay_project::Easing>> = y.keys.iter().map(|k| k.easing).collect();
    assert_eq!(
        easings,
        vec![
            Some(bay_project::Easing::SpringOut),
            Some(bay_project::Easing::Hold),
            Some(bay_project::Easing::Power4In),
            None,
        ],
        "the segment curves were dropped"
    );
}

// ------------------------------------------------------------------- the registry, over the wire

/// The registry is discoverable without knowing a new tool name, because a live MCP session's
/// tool list was cached when it connected.
#[test]
fn the_vocabulary_is_listable_from_a_tool_a_live_session_already_has() {
    let (mut studio, _root) = scratch_studio("catalogue");
    call(&mut studio, "project_create", json!({ "kit": "swiss" }));

    let catalogue = call(&mut studio, "apply_move", json!({}));
    let listed = catalogue["moves"].as_array().expect("the registry");
    assert_eq!(listed.len(), bay_project::moves::MOVES.len());
    assert!(
        listed
            .iter()
            .all(|m| m["summary"].as_str().unwrap_or_default().len() > 40),
        "every entry says what it is for: {catalogue}"
    );
    assert!(
        listed
            .iter()
            .all(|m| bay_project::moves::LEAD_CHANNELS.contains(&m["lead"].as_str().unwrap())),
        "and none of them leads with opacity: {catalogue}"
    );

    // The same list off an existing tool name, for a session whose schemas predate apply_move.
    let looks = call(&mut studio, "looks_list", json!({}));
    assert_eq!(
        looks["moves"].as_array().map(|m| m.len()),
        Some(bay_project::moves::MOVES.len()),
        "{looks}"
    );
}

/// `apply_move` and `animate` with `move` are one implementation reached two ways — required,
/// because a new tool name is uncallable in a session whose schemas are already cached.
#[test]
fn a_named_move_lands_the_same_through_either_door() {
    let (mut studio, _root) = scratch_studio("doors");
    call(&mut studio, "project_create", json!({ "kit": "swiss" }));
    headline(&mut studio, "a");
    headline(&mut studio, "b");

    call(
        &mut studio,
        "apply_move",
        json!({ "elementId": "a", "move": "lift" }),
    );
    call(
        &mut studio,
        "animate",
        json!({ "elementId": "b", "move": "lift" }),
    );
    assert_eq!(channel(&studio, "a", "y"), channel(&studio, "b", "y"));
    assert_eq!(
        channel(&studio, "a", "opacity"),
        channel(&studio, "b", "opacity")
    );

    // A move carries a geometric channel, always. The opacity is a passenger and is done first.
    let y = channel(&studio, "a", "y");
    let opacity = channel(&studio, "a", "opacity");
    assert!(y.keys[0].value > y.keys[1].value, "{y:?}");
    assert!(opacity.keys.last().unwrap().time < y.keys.last().unwrap().time);

    let error = call_err(
        &mut studio,
        "animate",
        json!({ "elementId": "a", "move": "zoomy" }),
    );
    assert!(error.contains("zoomy"), "{error}");
    assert!(error.contains("lift"), "it lists what there is: {error}");

    let error = call_err(
        &mut studio,
        "apply_move",
        json!({ "elementId": "a", "move": "lift", "direction": "cw" }),
    );
    assert!(error.contains("cw"), "{error}");
}

/// A group move brings its own stagger, and `counter-cascade` alternates sides — so a group
/// arrival is one call rather than four numbers copied out of a document.
#[test]
fn a_group_move_staggers_itself() {
    let (mut studio, _root) = scratch_studio("group");
    call(&mut studio, "project_create", json!({ "kit": "swiss" }));
    for id in ["w1", "w2", "w3", "w4"] {
        headline(&mut studio, id);
    }
    call(
        &mut studio,
        "animate_many",
        json!({ "elementIds": ["w1", "w2", "w3", "w4"], "move": "counter-cascade" }),
    );

    let firsts: Vec<f64> = ["w1", "w2", "w3", "w4"]
        .iter()
        .map(|id| channel(&studio, id, "x").keys[0].time.to_seconds_f64())
        .collect();
    assert!(
        firsts.windows(2).all(|w| w[1] > w[0]),
        "each member starts after the one before: {firsts:?}"
    );
    // Shrinking gaps: a cascade accelerates across the line rather than running at a flat delay.
    let gaps: Vec<f64> = firsts.windows(2).map(|w| w[1] - w[0]).collect();
    assert!(gaps[1] < gaps[0] && gaps[2] < gaps[1], "{gaps:?}");

    // Odd members come from the other side, which is direction diversity by construction.
    let even = channel(&studio, "w1", "x").keys[0].value;
    let odd = channel(&studio, "w2", "x").keys[0].value;
    let rest = channel(&studio, "w1", "x").keys[1].value;
    assert!(
        (even - rest).signum() != (odd - rest).signum(),
        "{even} and {odd} both sit on the same side of {rest}"
    );

    assert!(
        bay_project::moves::off_vocabulary(studio.project().active_scene(), 30.0).is_empty(),
        "the registry's own output is not off-vocabulary"
    );
}

/// `by` is a delta from where each element already rests, appended to the animation it already
/// has. This is the call that makes a *response* affordable: with absolute from/to, "everyone
/// already here shifts up to open a slot" means rewriting every incumbent's whole key list, and
/// that cost is why a crossfade won at all five seams in the project this exists to prevent.
#[test]
fn animate_many_by_moves_each_element_from_where_it_already_is() {
    let (mut studio, _root) = scratch_studio("by");
    call(&mut studio, "project_create", json!({ "kit": "swiss" }));
    for (id, y) in [("a", 0.30), ("b", 0.45), ("c", 0.60)] {
        call(
            &mut studio,
            "add_text",
            json!({ "role": "label", "id": id, "start": 0, "duration": 8,
                    "content": id, "y": y }),
        );
    }
    // They arrive first…
    call(
        &mut studio,
        "animate_many",
        json!({ "elementIds": ["a", "b", "c"], "move": "cascade" }),
    );
    let before = channel(&studio, "b", "y").keys.len();

    // …and then the whole stack opens a slot, in one call, without anybody restating where it is.
    call(
        &mut studio,
        "animate_many",
        json!({ "elementIds": ["a", "b", "c"], "property": "y", "by": -0.05,
                "at": 4.0, "duration": 0.5, "stagger": 0.0 }),
    );

    for (id, y) in [("a", 0.30_f32), ("b", 0.45), ("c", 0.60)] {
        let channel = channel(&studio, id, "y");
        let last = channel.keys.last().unwrap();
        assert!(
            (last.value - (y - 0.05)).abs() < 1e-5,
            "{id} ended at {} rather than {}",
            last.value,
            y - 0.05
        );
    }
    assert!(
        channel(&studio, "b", "y").keys.len() > before,
        "the delta appended to the entrance instead of erasing it"
    );
    // The entrance is still there: the first key is still above the rest position.
    let b = channel(&studio, "b", "y");
    assert!(b.keys[0].value > 0.45, "{b:?}");

    // Neither shape is required by the other: absolute from/to still works, and a call with
    // neither says so.
    let error = call_err(
        &mut studio,
        "animate_many",
        json!({ "elementIds": ["a"], "property": "y" }),
    );
    assert!(error.contains("by"), "{error}");
    assert!(error.contains("from"), "{error}");
}

/// Hand-written keys are legal — and named. The report says which element and which channel, so
/// the cost of going around the vocabulary scales with how much of the project goes around it.
#[test]
fn hand_written_keys_are_legal_and_reported_by_name() {
    let (mut studio, _root) = scratch_studio("raw");
    call(&mut studio, "project_create", json!({ "kit": "swiss" }));
    headline(&mut studio, "hand");
    headline(&mut studio, "named");

    call(
        &mut studio,
        "animate",
        json!({ "elementId": "hand", "property": "opacity", "easing": "ease-out",
                "keys": [{ "t": 0, "value": 0 }, { "t": 0.098, "value": 1 }] }),
    );
    call(
        &mut studio,
        "animate",
        json!({ "elementId": "named", "move": "lift" }),
    );

    let info = call(&mut studio, "project_info", json!({}));
    let findings = info["offVocabularyMotion"]
        .as_array()
        .expect("the finding is exposed");
    assert_eq!(findings.len(), 1, "{info}");
    let message = findings[0].as_str().unwrap();
    assert!(
        message.starts_with("hand: opacity"),
        "the finding names the element and the channel: {message}"
    );
    assert!(
        message.contains("core frames"),
        "…and why three frames is not a move: {message}"
    );
    assert!(
        !findings
            .iter()
            .any(|f| f.as_str().unwrap_or_default().starts_with("named")),
        "a registry move is not off-vocabulary: {findings:?}"
    );
    assert_eq!(
        bay_project::OffVocabularyMotion::CODE,
        "off-vocabulary-motion"
    );

    // …and the histogram the two-sided gate is computed from is there too.
    assert_eq!(info["moveHistogram"]["lift"], json!(1), "{info}");
    assert_eq!(info["motionSignatures"]["lift"], json!(1), "{info}");
}
