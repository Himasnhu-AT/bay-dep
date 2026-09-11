//! Every built-in style kit names typefaces that are actually on this machine.
//!
//! A kit naming an absent family — or a weight its family does not have — is a bug of the worst
//! kind: cosmic-text does not fall back to the nearest weight, it drops the family and renders
//! something else. The frame still comes out, every automated check still passes, and only a
//! human staring at the picture notices that the whole project is set in Menlo Bold.
//!
//! Lives here rather than in `bay-project` because the data model deliberately knows nothing
//! about fonts: [`bay_project::StyleKit::validate`] takes the resolver as an argument, and this
//! is the crate that owns a real one.

use bay_project::{StyleKit, builtin_kits};

/// The font set the kits were chosen against. Where it is missing entirely this is not a Mac
/// with the standard faces installed, and the test says so instead of failing for reasons
/// outside the repository.
fn have_system_fonts(raster: &mut bay_text::TextRaster) -> bool {
    raster.has_family("Helvetica Neue") && raster.has_family("Menlo")
}

#[test]
fn every_builtin_kit_resolves_on_this_machine() {
    let mut raster = bay_text::TextRaster::new();
    if !have_system_fonts(&mut raster) {
        eprintln!(
            "skipping: this machine does not have the macOS system font set (no Helvetica Neue \
             or no Menlo), so the kits cannot be checked against it"
        );
        return;
    }

    let mut failures: Vec<String> = Vec::new();
    for kit in builtin_kits() {
        for (slot, face) in faces(kit) {
            if !raster.has_family(&face.family) {
                failures.push(format!(
                    "{}/{slot}: {:?} is not installed",
                    kit.id, face.family
                ));
            } else if !raster.has_face(&face.family, face.weight) {
                failures.push(format!(
                    "{}/{slot}: {:?} has no upright face at weight {} — it would silently render \
                     in a substitute family",
                    kit.id, face.family, face.weight
                ));
            }
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

/// The same claim through the kit's own validation, which is what a `custom` kit has to clear.
#[test]
fn validation_agrees_with_the_font_database() {
    let mut raster = bay_text::TextRaster::new();
    if !have_system_fonts(&mut raster) {
        eprintln!("skipping: no macOS system font set on this machine");
        return;
    }
    for kit in builtin_kits() {
        let result = kit.validate(|family, weight| raster.has_face(family, weight));
        assert!(result.is_ok(), "{}: {:#?}", kit.id, result.unwrap_err());
    }
}

/// A family nobody has must fail validation rather than render in a fallback.
#[test]
fn a_kit_naming_a_family_this_machine_lacks_is_refused() {
    let mut raster = bay_text::TextRaster::new();
    let mut kit = builtin_kits()[0].clone();
    kit.faces.display.family = "Definitely Not An Installed Face".into();
    let problems = kit
        .validate(|family, weight| raster.has_face(family, weight))
        .expect_err("an absent family is a bug, not a fallback");
    assert!(
        problems
            .iter()
            .any(|p| p.contains("Definitely Not An Installed Face")),
        "{problems:#?}"
    );
}

fn faces(kit: &StyleKit) -> Vec<(&'static str, &bay_project::TypeFace)> {
    vec![
        ("display", &kit.faces.display),
        ("body", &kit.faces.body),
        ("mono", &kit.faces.mono),
    ]
}

// ---------------------------------------------------------------------------------------
// The tool surface: what a caller can and cannot say any more.

use bay_mcp::{Studio, tools};
use serde_json::{Value, json};

/// A studio whose library — and therefore whose style history — is a fresh scratch directory.
/// A test that read or wrote the user's own history would change which kits they are offered.
fn scratch_studio(tag: &str) -> (Studio, std::path::PathBuf) {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("bay-kit-{tag}-{stamp}"));
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

/// The four values that stopped being arguments. All four, on both tools.
#[test]
fn add_text_and_add_shape_refuse_a_raw_size_face_weight_or_colour() {
    let (mut studio, _root) = scratch_studio("raw");
    call(&mut studio, "project_create", json!({ "kit": "swiss" }));

    for (key, value) in [
        ("fontSize", json!(34)),
        ("fontFamily", json!("Menlo")),
        ("fontWeight", json!(400)),
        ("color", json!("#4A4A58")),
    ] {
        let error = call_err(
            &mut studio,
            "add_text",
            json!({ "role": "headline", "start": 0, "duration": 2, "content": "x", key: value }),
        );
        assert!(error.contains(key), "{error}");
        assert!(
            error.contains("role"),
            "the message names the way in: {error}"
        );
        assert!(
            error.contains("headline"),
            "and the role it is about: {error}"
        );
        assert!(error.contains("tone"), "{error}");
    }

    let error = call_err(
        &mut studio,
        "add_shape",
        json!({ "role": "data", "start": 0, "duration": 2, "color": "#ff0000" }),
    );
    assert!(error.contains("color"), "{error}");
    assert!(error.contains("style kit"), "{error}");
}

/// Placing type is now a statement about what the line is for, and the kit answers the rest.
#[test]
fn a_role_and_a_tone_resolve_to_the_kits_own_typography() {
    let (mut studio, _root) = scratch_studio("resolve");
    call(
        &mut studio,
        "project_create",
        json!({ "kit": "editorial-data" }),
    );
    let kit = bay_project::builtin_kit("editorial-data").unwrap();

    call(
        &mut studio,
        "add_text",
        json!({ "role": "hook", "id": "h", "start": 0, "duration": 2, "content": "Hook" }),
    );
    call(
        &mut studio,
        "add_text",
        json!({ "role": "kicker", "id": "k", "start": 0, "duration": 2, "content": "SECTION",
                "tone": "accent" }),
    );

    let scene = studio.project().active_scene();
    let hook = scene.elements().find(|e| e.id() == "h").unwrap();
    let kicker = scene.elements().find(|e| e.id() == "k").unwrap();
    let (bay_project::Element::Text(hook), bay_project::Element::Text(kicker)) = (hook, kicker)
    else {
        panic!("two titles")
    };

    assert_eq!(
        hook.font_family.as_deref(),
        Some(kit.faces.display.family.as_str()),
        "a hook is set in the kit's display face"
    );
    assert_eq!(hook.font_weight, kit.faces.display.weight);
    assert_eq!(hook.font_size, kit.ramp.hook.size);
    assert_eq!(
        hook.color, kit.palette.ink,
        "ink is the hook's default tone"
    );

    assert_eq!(
        kicker.font_family.as_deref(),
        Some(kit.faces.mono.family.as_str()),
        "a kicker is the kit's mono voice — its only job"
    );
    assert_eq!(kicker.color, kit.palette.accent, "the tone was asked for");
    assert!(
        hook.font_size / kicker.font_size >= 3.5,
        "the ramp is a hierarchy: {} vs {}",
        hook.font_size,
        kicker.font_size
    );
    assert!(
        kicker.letter_spacing > 0.1,
        "an uppercase kicker is tracked out by the ramp, not by the caller"
    );
}

/// The half of the frame the failing project never used. A framing is one word.
#[test]
fn a_named_framing_places_an_element_without_a_single_float() {
    let (mut studio, _root) = scratch_studio("framing");
    call(&mut studio, "project_create", json!({ "kit": "swiss" }));
    let kit = bay_project::builtin_kit("swiss").unwrap();
    let low = kit
        .framings
        .iter()
        .find(|f| f.is_bottom_weighted())
        .expect("every kit declares one");

    call(
        &mut studio,
        "add_text",
        json!({ "role": "label", "id": "l", "start": 0, "duration": 2, "content": "note",
                "framing": low.name }),
    );
    let element = studio
        .project()
        .active_scene()
        .elements()
        .find(|e| e.id() == "l")
        .unwrap();
    let transform = element.transform().unwrap();
    assert!((transform.x - low.x).abs() < 1e-6, "{transform:?}");
    assert!((transform.y - low.y).abs() < 1e-6, "{transform:?}");
    assert!(transform.y >= bay_project::kit::BOTTOM_WEIGHTED_Y);

    // An explicit value still wins — a framing is a starting point, not a cage.
    call(
        &mut studio,
        "add_text",
        json!({ "role": "label", "id": "l2", "start": 0, "duration": 2, "content": "note",
                "framing": low.name, "y": 0.31 }),
    );
    let element = studio
        .project()
        .active_scene()
        .elements()
        .find(|e| e.id() == "l2")
        .unwrap();
    assert!((element.transform().unwrap().y - 0.31).abs() < 1e-6);

    let error = call_err(
        &mut studio,
        "add_text",
        json!({ "role": "label", "start": 0, "duration": 2, "content": "x",
                "framing": "middle-of-nowhere" }),
    );
    assert!(error.contains("middle-of-nowhere"), "{error}");
    assert!(error.contains(&low.name), "it lists what there is: {error}");
}

/// `style_pick` offers three of the twelve, seeded by the brief and the date, and steps over
/// what this machine committed recently. The history is engine-owned — nothing on the tool
/// surface reaches it.
#[test]
fn style_pick_offers_three_and_remembers_what_was_taken() {
    let (mut studio, root) = scratch_studio("offer");

    let offered = call(
        &mut studio,
        "style_pick",
        json!({ "brief": "candlestick charts" }),
    );
    let offers = offered["offers"].as_array().expect("three offers");
    assert_eq!(offers.len(), 3, "{offered}");
    let ids: Vec<&str> = offers.iter().map(|o| o["id"].as_str().unwrap()).collect();
    assert!(
        offers
            .iter()
            .all(|o| o["note"].as_str().unwrap_or_default().len() > 24),
        "each offer says what it is for: {offered}"
    );
    assert!(
        offered["offers"][0]["palette"]["accent"].is_string(),
        "and what it looks like: {offered}"
    );

    // Offering commits nothing.
    assert!(!root.join(bay_project::kit::HISTORY_FILE).exists());

    let committed = call(&mut studio, "style_pick", json!({ "kit": ids[1] }));
    assert_eq!(committed["committed"], json!(ids[1]));
    assert_eq!(
        studio
            .project()
            .settings
            .kit
            .as_ref()
            .map(|k| k.id.as_str()),
        Some(ids[1])
    );

    // …and the choice is remembered, so the next offer steps over it.
    let history = bay_project::StyleHistory::at(root.join(bay_project::kit::HISTORY_FILE));
    assert_eq!(history.recent(5), vec![ids[1].to_string()]);
    let again = call(
        &mut studio,
        "style_pick",
        json!({ "brief": "candlestick charts" }),
    );
    let next: Vec<&str> = again["offers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["id"].as_str().unwrap())
        .collect();
    assert!(!next.contains(&ids[1]), "{again}");
}

/// The tool-surface constraint: a live session's tool list may predate `style_pick`, so every
/// part of it has to be reachable as parameters on `project_create` too — one implementation,
/// two doors.
#[test]
fn project_create_reaches_the_whole_picker_by_itself() {
    let (mut studio, root) = scratch_studio("create");

    let created = call(
        &mut studio,
        "project_create",
        json!({ "name": "Reel", "brief": "how a candlestick chart is read" }),
    );
    let chosen = created["kit"]["id"].as_str().expect("a kit was committed");
    assert!(bay_project::builtin_kit(chosen).is_some(), "{created}");
    assert_eq!(
        created["alternatives"].as_array().map(|a| a.len()),
        Some(3),
        "the two it did not pick are named: {created}"
    );
    assert_eq!(
        created["background"],
        json!(bay_project::builtin_kit(chosen).unwrap().palette.bg),
        "the ground is the kit's unless the caller insists"
    );
    let history = bay_project::StyleHistory::at(root.join(bay_project::kit::HISTORY_FILE));
    assert_eq!(history.recent(1), vec![chosen.to_string()]);

    // Naming one outright works the same way.
    let created = call(&mut studio, "project_create", json!({ "kit": "terminal" }));
    assert_eq!(created["kit"]["id"], json!("terminal"));

    let error = call_err(&mut studio, "project_create", json!({ "kit": "vaporwave" }));
    assert!(error.contains("vaporwave"), "{error}");
    assert!(
        error.contains("terminal"),
        "it lists what there is: {error}"
    );
}

/// A custom kit stays legal, and is validated — which is strictly more work than accepting an
/// offer. That asymmetry is the only thing keeping "write your own" from being the escape hatch
/// every rule here exists to close.
#[test]
fn a_custom_kit_is_legal_but_has_to_clear_every_rule() {
    let (mut studio, _root) = scratch_studio("custom");
    let mut kit = bay_project::builtin_kit("cinematic").unwrap().clone();
    kit.id = "custom".into();
    kit.name = "House".into();
    kit.palette.accent = "#7C5CFF".into();

    let committed = call(
        &mut studio,
        "style_pick",
        json!({ "customKit": serde_json::to_value(&kit).unwrap() }),
    );
    assert_eq!(committed["committed"], json!("custom"));
    assert_eq!(
        studio
            .project()
            .settings
            .kit
            .as_ref()
            .map(|k| k.id.as_str()),
        Some("custom")
    );

    // Every one of the four rules, refused with the number that failed.
    let mut flat = kit.clone();
    flat.ramp.hook.size = flat.ramp.label.size;
    let error = call_err(
        &mut studio,
        "style_pick",
        json!({ "customKit": serde_json::to_value(&flat).unwrap() }),
    );
    assert!(error.contains("cap ratio"), "{error}");

    let mut grey = kit.clone();
    grey.palette.accent = "#8E8E92".into();
    let error = call_err(
        &mut studio,
        "style_pick",
        json!({ "customKit": serde_json::to_value(&grey).unwrap() }),
    );
    assert!(error.contains("accent"), "{error}");

    let mut top_heavy = kit.clone();
    top_heavy.framings.retain(|f| !f.is_bottom_weighted());
    let error = call_err(
        &mut studio,
        "style_pick",
        json!({ "customKit": serde_json::to_value(&top_heavy).unwrap() }),
    );
    assert!(error.contains("bottom-weighted"), "{error}");

    let mut one_face = kit.clone();
    one_face.faces.body = one_face.faces.display.clone();
    one_face.faces.mono = one_face.faces.display.clone();
    let error = call_err(
        &mut studio,
        "style_pick",
        json!({ "customKit": serde_json::to_value(&one_face).unwrap() }),
    );
    assert!(error.contains("distinct families"), "{error}");

    let error = call_err(
        &mut studio,
        "style_pick",
        json!({ "customKit": { "id": "x" } }),
    );
    assert!(error.contains("customKit"), "{error}");
}

/// A project opened from before kits existed still draws — the first tool that needs a kit
/// commits one rather than refusing.
#[test]
fn an_old_project_without_a_kit_can_still_be_drawn_on() {
    let (mut studio, _root) = scratch_studio("old");
    assert!(
        studio.project().settings.kit.is_none(),
        "a blank studio has none"
    );
    call(
        &mut studio,
        "add_text",
        json!({ "role": "headline", "id": "t", "start": 0, "duration": 2, "content": "Hook" }),
    );
    assert!(
        studio.project().settings.kit.is_some(),
        "the first placement commits one"
    );
}
