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
