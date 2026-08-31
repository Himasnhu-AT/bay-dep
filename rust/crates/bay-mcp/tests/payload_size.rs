//! A ceiling on `tools/list`, so the schema surface cannot silently regrow.
//!
//! `optimizations.md` measured the payload at 126 KB across 101 tools and found 27.8% of it
//! reachable from six shared helper functions — each spliced into up to twelve tools, so a
//! sentence in one costs twelve times its length on the wire. A client without tool search
//! carries the whole thing in its system prompt on every request.
//!
//! This is the "test asserting the payload stays under a ceiling" that document asks for. The
//! number is deliberately a little above the measured size: room to add a tool, not room to put
//! an essay back into `visual_properties`.

/// Whole-payload ceiling. Raise it when a tool is genuinely added; do not raise it to make a
/// re-expanded description fit.
const CEILING: usize = 120_000;

#[test]
fn the_tool_surface_stays_under_its_ceiling() {
    let defs = bay_mcp::tools::all_definitions();
    let payload = serde_json::to_string(&serde_json::json!({ "tools": defs })).unwrap();
    println!("tools/list: {} tools, {} bytes", defs.len(), payload.len());
    assert!(
        payload.len() < CEILING,
        "tools/list is {} B, over its {CEILING} B ceiling. It was 126,236 B before the shared \
         helpers were trimmed; check what grew before raising this.",
        payload.len()
    );
}

/// The trims must not have emptied a shared helper's description.
///
/// Scoped to the properties the six helpers contribute, and to the placement tools they are
/// spliced into. The first version of this asserted that *every* property in the surface had
/// prose and found 120 that never did — `elementId`, `width`, `start` — which is a fine thing
/// for a self-describing name and not a standard this codebase ever held. A test that fails for
/// something the change did not touch is one people learn to skip.
#[test]
fn the_shared_helpers_still_describe_their_properties() {
    // Keys that come from `visual_properties`, `role_property`, `tone_property` and
    // `caption_properties` — the four that were trimmed.
    const FROM_HELPERS: &[&str] = &[
        "cover",
        "framing",
        "layer",
        "scale",
        "tiltX",
        "tiltY",
        "anchorX",
        "anchorY",
        "blendMode",
        "role",
        "tone",
        "captionStyle",
        "captionX",
        "captionY",
        "speakerLabels",
        "speakerColors",
    ];
    // Only the tools the helpers are spliced into. A handful of others declare their own bare
    // `layer` or `anchorY` — undescribed long before this change and not what it touched.
    const SPLICED: &[&str] = &[
        "add_text",
        "add_image",
        "add_video",
        "add_shape",
        "group_create",
        "narrate",
        "subtitles_add",
        "subtitles_to_video",
        "text_update",
    ];
    let defs = bay_mcp::tools::all_definitions();
    let mut thin = Vec::new();
    for def in &defs {
        let name = def["name"].as_str().unwrap_or("?");
        if !SPLICED.contains(&name) {
            continue;
        }
        let Some(props) = def["inputSchema"]["properties"].as_object() else {
            continue;
        };
        for key in FROM_HELPERS {
            let Some(schema) = props.get(*key) else {
                continue;
            };
            let described = schema["description"].as_str().unwrap_or("");
            if described.len() < 40 {
                thin.push(format!("{name}.{key} ({} chars)", described.len()));
            }
        }
    }
    assert!(
        thin.is_empty(),
        "a shared helper's property lost its prose — the size saving must not buy a parameter \
         the model has to guess at: {thin:?}"
    );
}

/// The vocabulary hoisted out of the schemas has to actually be somewhere. Moving the ROLE and
/// TONE glossaries into the server instructions is only a saving if the instructions carry them —
/// otherwise it is a deletion, and the model is left with bare enum names.
#[test]
fn the_hoisted_vocabulary_reaches_the_client() {
    let instructions = bay_mcp::server::server_instructions();
    for term in [
        "ROLE", "TONE", "headline", "kicker", "lockup", "accent2", "surface",
    ] {
        assert!(
            instructions.contains(term),
            "{term} left the tool schemas and did not arrive in the instructions block"
        );
    }
}

/// Every tool a profile names has to exist.
///
/// A profile is a hand-written list against a surface that changes, so a renamed tool leaves a
/// dead entry — and a dead entry is invisible: the profile simply keeps one fewer tool than its
/// author meant, and nothing says so.
#[test]
fn every_profile_names_real_tools() {
    let names = bay_mcp::tools::all_tool_names();
    let mut dead = Vec::new();
    for profile in bay_settings::mcp::PROFILES {
        for tool in profile.tools {
            if !names.iter().any(|known| known == tool) {
                dead.push(format!("{}.{tool}", profile.id));
            }
        }
    }
    assert!(
        dead.is_empty(),
        "profiles naming tools that do not exist: {dead:?}"
    );
}

/// A profile has to leave a usable surface. The failure this guards is the one that presents as
/// bay being broken rather than configured: a client connects, sees almost nothing, and there is
/// no error anywhere to explain it.
#[test]
fn every_profile_leaves_a_workable_session() {
    let names = bay_mcp::tools::all_tool_names();
    for profile in bay_settings::mcp::PROFILES {
        let mut settings = bay_settings::McpSettings::default();
        settings.apply_profile(&profile, &names);
        let kept: Vec<&String> = names.iter().filter(|n| settings.allows(n)).collect();

        // You cannot start, look at, or finish a session without these.
        for essential in ["project_create", "timeline", "render", "check", "snapshot"] {
            assert!(
                kept.iter().any(|k| *k == essential),
                "the {} profile drops {essential}, which no session works without",
                profile.id
            );
        }
        assert!(
            kept.len() >= 15,
            "the {} profile keeps only {} tools — that reads as a broken connection",
            profile.id,
            kept.len()
        );
    }
}

/// The point of the exercise: a profile has to actually shrink the payload a client carries.
#[test]
fn a_profile_shrinks_what_a_client_carries() {
    let names = bay_mcp::tools::all_tool_names();
    let whole = serde_json::to_string(&bay_mcp::tools::all_definitions())
        .unwrap()
        .len();

    let mut narrowed = bay_settings::McpSettings::default();
    let dialogue = bay_settings::mcp::profile("dialogue").expect("a dialogue profile");
    narrowed.apply_profile(dialogue, &names);
    let after = serde_json::to_string(&bay_mcp::tools::definitions_with(&narrowed))
        .unwrap()
        .len();

    println!("dialogue profile: {whole} B -> {after} B");
    assert!(
        after * 2 < whole,
        "the dialogue profile carries {after} B against the full {whole} B — it is meant to be \
         roughly half, or it is not worth offering"
    );

    // "Everything" must not shrink anything, or the default silently hides tools.
    let mut all = bay_settings::McpSettings::default();
    all.apply_profile(
        bay_settings::mcp::profile("everything").expect("an everything profile"),
        &names,
    );
    assert_eq!(
        bay_mcp::tools::definitions_with(&all).len(),
        bay_mcp::tools::all_definitions().len(),
        "the default profile dropped a tool"
    );
}
