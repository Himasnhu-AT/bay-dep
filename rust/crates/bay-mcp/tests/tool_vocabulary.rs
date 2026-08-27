//! The settings pane and the server must agree on what a tool is called.
//!
//! The MCP pane draws one switch per name from `bay_agent::available_tools()` — the UI crate
//! cannot depend on `bay-mcp`, so that is the only shared vocabulary it can read. The server
//! gates on the names in `tools::definitions()`. If those two lists drift, a tool the server
//! serves has no switch in settings, and a switch in settings turns nothing off. Neither
//! failure is visible until someone tries to block something and it keeps answering.

#[test]
fn every_served_tool_has_a_switch_in_settings() {
    let served = bay_mcp::tools::all_tool_names();
    let offered: std::collections::BTreeSet<&str> =
        bay_agent::all_tool_names().into_iter().collect();

    let missing: Vec<&String> = served
        .iter()
        .filter(|name| !offered.contains(name.as_str()))
        .collect();
    assert!(
        missing.is_empty(),
        "the MCP server serves tools the settings pane cannot switch off: {missing:?}"
    );
}

#[test]
fn every_switch_in_settings_controls_a_tool_that_exists() {
    let served: std::collections::BTreeSet<String> =
        bay_mcp::tools::all_tool_names().into_iter().collect();
    let dead: Vec<&str> = bay_agent::all_tool_names()
        .into_iter()
        .filter(|name| !served.contains(*name))
        .collect();
    assert!(
        dead.is_empty(),
        "the settings pane would draw switches for tools no server serves: {dead:?}"
    );
}

/// The same failure one level down, inside a single tool's schema.
///
/// `effect_add`'s `type` enum used to be written out longhand beside the list `bay-agent`
/// validates against. They drifted: `drop-shadow` was renderable and legal and missing from the
/// enum, so the shader an agent reaches for most could not be discovered from the tool
/// definition — and nothing failed, because neither list knows the other exists. The enum is
/// now read off `SUPPORTED_EFFECTS`; these two tests are what stops it being written out again.
fn effect_add_type_enum() -> Vec<String> {
    let definitions = bay_mcp::tools::definitions();
    let effect_add = definitions
        .iter()
        .find(|tool| tool["name"] == "effect_add")
        .expect("effect_add is served");
    effect_add["inputSchema"]["properties"]["type"]["enum"]
        .as_array()
        .expect("effect_add's type is an enum")
        .iter()
        .map(|value| {
            value
                .as_str()
                .expect("an effect name is a string")
                .to_string()
        })
        .collect()
}

#[test]
fn every_effect_the_engine_renders_is_offered_by_effect_add() {
    let offered = effect_add_type_enum();
    let missing: Vec<&&str> = bay_agent::plan::SUPPORTED_EFFECTS
        .iter()
        .filter(|effect| !offered.iter().any(|name| name == *effect))
        .collect();
    assert!(
        missing.is_empty(),
        "bay renders {missing:?} and effect_add's schema does not offer them"
    );
}

#[test]
fn every_effect_effect_add_offers_is_one_the_engine_renders() {
    let dead: Vec<String> = effect_add_type_enum()
        .into_iter()
        .filter(|name| !bay_agent::plan::SUPPORTED_EFFECTS.contains(&name.as_str()))
        .collect();
    assert!(
        dead.is_empty(),
        "effect_add offers {dead:?}, which the planner refuses and no shader renders"
    );
}

/// And the third surface on the same vocabulary: the panel palette in `bay-core`, which the
/// UI draws and an MCP client never sees. `bay-core` cannot check this itself — `bay-agent`
/// depends on it, not the other way round — so it is checked here, where both are in scope.
#[test]
fn the_effect_palette_and_the_planner_name_the_same_shaders() {
    let mut counter = 0;
    let mut fresh_id = |prefix: &str| {
        counter += 1;
        format!("{prefix}-{counter}")
    };
    let mut editor = bay_core::Editor::starter();
    let first = editor
        .active_scene()
        .elements()
        .next()
        .expect("the starter project has an element")
        .id()
        .to_string();
    let reference = bay_core::ElementRef::new(editor.active_scene().tracks.main.id.clone(), first);
    editor.select(vec![reference]);

    let mut palette: Vec<String> = Vec::new();
    for tile in bay_core::blocks::Panel::Effects.blocks() {
        let commands = bay_core::blocks::plan(&editor, tile.id, &mut fresh_id).expect(tile.id);
        if let Some(bay_core::Command::AddEffect { effect, .. }) = commands.first() {
            palette.push(effect.effect_type.clone());
        }
    }

    for effect in bay_agent::plan::SUPPORTED_EFFECTS {
        assert!(
            palette.iter().any(|name| name == effect),
            "the planner renders {effect:?} and no tile in the palette adds it"
        );
    }
    for effect in &palette {
        assert!(
            bay_agent::plan::SUPPORTED_EFFECTS.contains(&effect.as_str()),
            "a tile adds {effect:?}, which the planner refuses"
        );
    }
}
