//! Which agents may drive bay, and which tools they may call.
//!
//! This is the one pane in the settings design with real teeth. The MCP server answers
//! `tools/list` and `tools/call` with no window open, so "export_video: Blocked" cannot be a
//! flag a view consults — the gate has to live somewhere the headless server can reach, which
//! is here. [`Gate`] is what both call sites use.
//!
//! **Default-allow, not default-deny.** Everything is allowed until the user blocks it. A
//! default-deny list would break every existing agent workflow the moment this shipped, and
//! silently: `tools/list` would come back short and the agent would conclude bay cannot do the
//! thing rather than that it was refused.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

/// Client applications the pane can write a config snippet for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientKind {
    pub id: &'static str,
    pub label: &'static str,
    pub hint: &'static str,
}

pub const CLIENTS: [ClientKind; 3] = [
    ClientKind {
        id: "code",
        label: "Claude Code",
        hint: "Run in your project root, then ask Claude to edit the timeline.",
    },
    ClientKind {
        id: "desktop",
        label: "Claude Desktop",
        hint: "Add to claude_desktop_config.json, then restart Desktop.",
    },
    ClientKind {
        id: "cursor",
        label: "Cursor",
        hint: "Drop into .cursor/mcp.json in the workspace.",
    },
];

pub fn client(id: &str) -> Option<&'static ClientKind> {
    CLIENTS.iter().find(|entry| entry.id == id)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct McpSettings {
    /// Whether bay answers agents at all. On by default — the MCP server is a headline feature,
    /// and it is already bound to a loopback port with a token.
    pub enabled: bool,
    /// Tools the user has switched off, by name. Empty means everything is allowed.
    pub blocked: BTreeSet<String>,
    /// Which client the config snippet is written for. Presentation, but persisted because
    /// re-picking it every visit is annoying.
    pub client: String,
}

impl Default for McpSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            blocked: BTreeSet::new(),
            client: "code".to_string(),
        }
    }
}

impl McpSettings {
    pub fn allows(&self, tool: &str) -> bool {
        self.enabled && !self.blocked.contains(tool)
    }

    /// Block a tool. Returns whether this changed anything.
    pub fn block(&mut self, tool: &str) -> bool {
        self.blocked.insert(tool.to_string())
    }

    pub fn unblock(&mut self, tool: &str) -> bool {
        self.blocked.remove(tool)
    }

    /// Flip one tool, returning its new allowed state.
    pub fn toggle(&mut self, tool: &str) -> bool {
        if self.blocked.remove(tool) {
            true
        } else {
            self.blocked.insert(tool.to_string());
            false
        }
    }

    /// The line the pane shows under the server switch. Says what is true, including the
    /// partial state — "running, but six tools are blocked" is the fact an agent's user needs
    /// when a call comes back refused.
    pub fn status_line(&self) -> String {
        if !self.enabled {
            return "Stopped — no agent can reach bay".to_string();
        }
        match self.blocked.len() {
            0 => "Listening — external agents can read and edit this project".to_string(),
            1 => "Listening — 1 tool is blocked".to_string(),
            n => format!("Listening — {n} tools are blocked"),
        }
    }

    /// The snippet that adds bay to `client_id`.
    ///
    /// Written from the real command and the caller's real token, so copying it out of the pane
    /// and pasting it into a terminal works. A snippet with a placeholder token would be a
    /// screenshot, not a feature.
    pub fn config_snippet(&self, client_id: &str, token: &str) -> String {
        match client_id {
            "code" => format!("claude mcp add bay -- bay --mcp --token {token}"),
            _ => format!(
                "{{\n  \"mcpServers\": {{\n    \"bay\": {{\n      \"command\": \"bay\",\n      \
                 \"args\": [\"--mcp\"],\n      \"env\": {{ \"BAY_TOKEN\": \"{token}\" }}\n    \
                 }}\n  }}\n}}"
            ),
        }
    }
}

/// The decision, as the two MCP call sites see it.
///
/// A tiny type rather than a `bool` so a caller cannot accidentally use the reason-less form:
/// an agent told "no" without being told why will retry the same call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Gate {
    Allow,
    Deny(String),
}

impl Gate {
    pub fn is_allowed(&self) -> bool {
        matches!(self, Gate::Allow)
    }

    pub fn reason(&self) -> Option<&str> {
        match self {
            Gate::Allow => None,
            Gate::Deny(why) => Some(why),
        }
    }
}

/// Decide one tool call against a settings document.
///
/// Pure and public because the MCP server, the window's agent router and the tests all need the
/// same answer, and three copies of "is this blocked?" is how they drift apart.
pub fn gate(settings: &McpSettings, tool: &str) -> Gate {
    if !settings.enabled {
        return Gate::Deny(
            "bay's MCP server is switched off in Settings → MCP access. Turn it on there to let \
             agents edit this project."
                .to_string(),
        );
    }
    if settings.blocked.contains(tool) {
        return Gate::Deny(format!(
            "{tool} is blocked in Settings → MCP access. The user can allow it there; do not \
             retry until they have."
        ));
    }
    Gate::Allow
}

/// Filter a `tools/list` reply.
///
/// A blocked tool is removed from the listing as well as refused at the call, so an agent plans
/// with the set it can actually use rather than discovering the refusal halfway through a job.
pub fn allowed_names<'a>(
    settings: &McpSettings,
    names: impl IntoIterator<Item = &'a str>,
) -> Vec<&'a str> {
    if !settings.enabled {
        return Vec::new();
    }
    names
        .into_iter()
        .filter(|name| !settings.blocked.contains(*name))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Shipping this must not change what any existing agent can do.
    #[test]
    fn everything_is_allowed_by_default() {
        let settings = McpSettings::default();
        assert!(settings.enabled);
        assert!(settings.blocked.is_empty());
        for tool in ["add_clip", "export_video", "project_create"] {
            assert!(
                gate(&settings, tool).is_allowed(),
                "{tool} must start allowed"
            );
        }
    }

    /// The gate has to actually refuse, and the refusal has to tell the agent where the switch
    /// is — otherwise it retries forever.
    #[test]
    fn a_blocked_tool_is_refused_with_somewhere_to_go() {
        let mut settings = McpSettings::default();
        assert!(settings.block("export_video"));
        let decision = gate(&settings, "export_video");
        assert!(!decision.is_allowed());
        let reason = decision.reason().expect("a refusal must carry a reason");
        assert!(
            reason.contains("Settings"),
            "say where to change it: {reason}"
        );
        assert!(
            reason.contains("do not retry"),
            "an agent that retries a policy refusal loops: {reason}"
        );
        assert!(
            gate(&settings, "add_clip").is_allowed(),
            "only that one tool"
        );
    }

    #[test]
    fn switching_the_server_off_refuses_everything() {
        let settings = McpSettings {
            enabled: false,
            ..McpSettings::default()
        };
        assert!(!gate(&settings, "add_clip").is_allowed());
        assert!(allowed_names(&settings, ["add_clip", "export_video"]).is_empty());
        assert_eq!(settings.status_line(), "Stopped — no agent can reach bay");
    }

    /// A blocked tool must vanish from tools/list too. Leaving it listed makes an agent plan a
    /// job around a call that will be refused at the last step.
    #[test]
    fn a_blocked_tool_is_absent_from_the_listing() {
        let mut settings = McpSettings::default();
        settings.block("export_video");
        assert_eq!(
            allowed_names(&settings, ["add_clip", "export_video", "snapshot"]),
            vec!["add_clip", "snapshot"]
        );
    }

    #[test]
    fn toggling_reports_the_new_state_and_is_its_own_inverse() {
        let mut settings = McpSettings::default();
        assert!(!settings.toggle("split_clip"), "first toggle blocks");
        assert!(!settings.allows("split_clip"));
        assert!(settings.toggle("split_clip"), "second toggle allows");
        assert!(settings.allows("split_clip"));
        assert!(settings.blocked.is_empty());
    }

    #[test]
    fn blocking_twice_is_not_a_change() {
        let mut settings = McpSettings::default();
        assert!(settings.block("snapshot"));
        assert!(!settings.block("snapshot"));
        assert!(settings.unblock("snapshot"));
        assert!(!settings.unblock("snapshot"));
    }

    /// The status line is what a user reads when a call was refused, so a partially blocked
    /// server must not read as fully open.
    #[test]
    fn the_status_line_counts_blocked_tools() {
        let mut settings = McpSettings::default();
        assert!(settings.status_line().contains("read and edit"));
        settings.block("a");
        assert_eq!(settings.status_line(), "Listening — 1 tool is blocked");
        settings.block("b");
        assert_eq!(settings.status_line(), "Listening — 2 tools are blocked");
    }

    /// The snippet is meant to be pasted. It must carry the real token and the flag bay's own
    /// binary accepts, not an invented subcommand.
    #[test]
    fn the_config_snippet_is_runnable() {
        let settings = McpSettings::default();
        let code = settings.config_snippet("code", "bay_sk_7f3c9a21");
        assert!(code.starts_with("claude mcp add bay"), "{code}");
        assert!(code.contains("--mcp"), "bay's real flag: {code}");
        assert!(code.contains("bay_sk_7f3c9a21"));

        let desktop = settings.config_snippet("desktop", "bay_sk_7f3c9a21");
        let parsed: serde_json::Value =
            serde_json::from_str(&desktop).expect("the JSON snippet must parse");
        assert_eq!(parsed["mcpServers"]["bay"]["command"], "bay");
        assert_eq!(parsed["mcpServers"]["bay"]["args"][0], "--mcp");
        assert_eq!(
            parsed["mcpServers"]["bay"]["env"]["BAY_TOKEN"],
            "bay_sk_7f3c9a21"
        );
    }

    #[test]
    fn every_client_resolves_and_ids_are_unique() {
        for entry in CLIENTS {
            assert_eq!(client(entry.id).map(|c| c.label), Some(entry.label));
        }
        let mut ids: Vec<&str> = CLIENTS.iter().map(|c| c.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), CLIENTS.len());
        assert!(client("zed").is_none());
    }

    #[test]
    fn settings_round_trip_through_json() {
        let mut settings = McpSettings::default();
        settings.block("export_video");
        settings.client = "cursor".into();
        let text = serde_json::to_string(&settings).unwrap();
        assert_eq!(
            serde_json::from_str::<McpSettings>(&text).unwrap(),
            settings
        );
    }
}
