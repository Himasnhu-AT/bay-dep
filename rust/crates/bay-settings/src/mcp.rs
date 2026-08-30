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

/// A named set of tools, so switching surface is one choice rather than 101 checkboxes.
///
/// `optimizations.md` §2.5: the gating machinery already existed — `definitions_with` filters
/// `all_definitions` through [`McpSettings::allows`], and `bay --mcp` enforces it with no window
/// open. What was missing was **defaults**. A client that carries the whole schema list in its
/// system prompt on every request pays for 101 tools whether it narrates or not, and asking
/// someone to untick sixty boxes is not a feature.
///
/// The sets are deliberately *jobs*, not categories. "Everything about audio" is a taxonomy; "I
/// am cutting dialogue today" is what a person actually has in mind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Profile {
    pub id: &'static str,
    pub label: &'static str,
    pub detail: &'static str,
    /// Tools this profile keeps. Empty means every tool — see [`Profile::keeps`].
    pub tools: &'static [&'static str],
}

impl Profile {
    /// Whether `tool` survives this profile.
    ///
    /// An empty `tools` list means "everything", not "nothing". The inversion matters: a profile
    /// that silently blocked the entire surface would present as bay having no tools at all,
    /// which reads as a broken connection rather than a setting.
    pub fn keeps(&self, tool: &str) -> bool {
        self.tools.is_empty() || self.tools.contains(&tool)
    }
}

/// The tools every profile keeps, because without them there is no session.
///
/// Opening, saving and inspecting a project, and knowing what bay can do at all. A profile that
/// dropped `project_create` would be a surface you cannot start from.
const ALWAYS: &[&str] = &[
    "project_create",
    "project_load",
    "project_save",
    "project_list",
    "project_info",
    "timeline",
    "check",
    "render",
    "snapshot",
    "job_status",
    "job_cancel",
    "runtime_status",
    "media_import",
    "element_delete",
    "element_move",
];

/// Placing and arranging things on the timeline.
const EDIT: &[&str] = &[
    "add_text",
    "add_shape",
    "add_image",
    "add_video",
    "add_audio",
    "group_create",
    "animate",
    "animate_many",
    "apply_move",
    "transform_set",
    "text_update",
    "blend_set",
    "crop_set",
    "mask_set",
    "fade_set",
    "transition_add",
    "effect_add",
    "effect_set",
    "effect_remove",
    "element_trim",
    "element_split",
    "element_source",
    "element_duplicate",
    "element_rename",
    "element_retime",
    "element_ripple_delete",
    "marker_add",
    "fonts_check",
    "fonts_list",
    "looks_list",
    "style_pick",
    "templates_list",
    "template_place",
    "contact_sheet",
    "check_frames",
    "scopes_read",
    "media_index",
    "media_search",
    "auto_reframe",
    "shots_detect",
    "audio_set",
    "sound_add",
];

/// Cutting speech: transcripts, captions, narration, and the mix around them.
const DIALOGUE: &[&str] = &[
    "transcribe",
    "transcript_get",
    "transcript_search",
    "diarize",
    "cut_by_transcript",
    "remove_silence_and_fillers",
    "silence_detect",
    "room_tone",
    "narrate",
    "speech_status",
    "subtitles_add",
    "subtitles_export",
    "subtitles_to_video",
    "audio_set",
    "audio_probe",
    "audio_beats",
    "audio_smooth",
    "audio_react",
    "duck",
    "sound_add",
    "add_audio",
    "add_text",
    "text_update",
    "element_trim",
    "element_split",
    "element_source",
];

/// Getting a finished project out.
const DELIVER: &[&str] = &[
    "formats_list",
    "variant_create",
    "variant_register_render",
    "library_save",
    "library_list",
    "library_collect",
    "contact_sheet",
    "check_frames",
    "scopes_read",
    "subtitles_export",
    "runtime_install",
    "runtime_remove",
];

pub const PROFILES: [Profile; 4] = [
    Profile {
        id: "everything",
        label: "Everything",
        detail: "All 101 tools. The default, and the right one for a client with tool search.",
        tools: &[],
    },
    Profile {
        id: "edit",
        label: "Edit",
        detail: "Placing, arranging and animating. No transcripts, generation or stock.",
        tools: EDIT,
    },
    Profile {
        id: "dialogue",
        label: "Dialogue",
        detail: "Transcripts, captions, narration and the mix around them.",
        tools: DIALOGUE,
    },
    Profile {
        id: "deliver",
        label: "Deliver",
        detail: "Formats, variants, the library and the runtime.",
        tools: DELIVER,
    },
];

pub fn profile(id: &str) -> Option<&'static Profile> {
    PROFILES.iter().find(|entry| entry.id == id)
}

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
    /// Block everything outside `profile`, keeping the tools no session works without.
    ///
    /// Expressed as blocks rather than as a stored profile name, so there is exactly one thing
    /// deciding whether a tool is exposed. A `profile` field beside `blocked` would be a second
    /// answer to the same question, and the two would disagree the first time someone ticked a
    /// box after choosing a profile.
    pub fn apply_profile(&mut self, profile: &Profile, every_tool: &[String]) {
        self.blocked = every_tool
            .iter()
            .filter(|tool| !profile.keeps(tool) && !ALWAYS.contains(&tool.as_str()))
            .cloned()
            .collect();
    }

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

    /// The snippet that adds bay to `client_id`, for a server listening on `port`.
    ///
    /// Written from the real command, the real port and the caller's real token, so copying it
    /// out of the pane and pasting it into a terminal works. A snippet with a placeholder token
    /// would be a screenshot, not a feature.
    ///
    /// **These describe an HTTP connection, and the previous versions described a subprocess.**
    /// That was wrong three times over. `claude mcp add bay -- bay --mcp --token …` registers a
    /// *stdio* server, so the client spawns its own `bay --mcp`: it fails outright when `bay` is
    /// not on `PATH`, and when it is, it starts a second headless instance — which defeats the
    /// entire point of the pane, because agent edits then land in a process with nobody's project
    /// open instead of "the window you are looking at". The JSON form had a third fault on top:
    /// it passed the token as `BAY_TOKEN`, an environment variable **nothing in the workspace
    /// reads**. The server takes its credential from the token file and its requests from an
    /// `Authorization: Bearer` header.
    ///
    /// `bay --help` has printed the correct `--transport http` invocation all along, so the pane
    /// and the CLI disagreed about how to reach the same server. `the_snippets_agree_with_the_cli`
    /// is what stops them drifting apart again.
    pub fn config_snippet(&self, client_id: &str, token: &str, port: u16) -> String {
        let url = format!("http://127.0.0.1:{port}/mcp");
        match client_id {
            "code" => format!(
                "claude mcp add --transport http bay {url} --header \"Authorization: Bearer {token}\""
            ),
            // Cursor and current Claude Desktop both take a remote server as `url` plus
            // `headers`; neither needs a command, because bay is already running.
            _ => format!(
                "{{\n  \"mcpServers\": {{\n    \"bay\": {{\n      \"url\": \"{url}\",\n      \
                 \"headers\": {{ \"Authorization\": \"Bearer {token}\" }}\n    }}\n  }}\n}}"
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

    /// The snippet is meant to be pasted, so it must describe the server bay actually runs.
    ///
    /// The version this replaced asserted `claude mcp add bay`, `--mcp`, `command: "bay"` and
    /// `env.BAY_TOKEN` — every one of which was wrong, and it passed. It pinned a stdio
    /// subprocess for an HTTP server, and `BAY_TOKEN` is read by nothing in the workspace. A
    /// test can only be as right as the contract it was written against.
    #[test]
    fn the_config_snippet_describes_the_http_server() {
        let settings = McpSettings::default();
        let token = "dec566e0b899c66f0c69e80b80687b87b54d283945fb28c2bc2e8f116d7e2fd6";

        let code = settings.config_snippet("code", token, 7333);
        assert!(
            code.contains("--transport http"),
            "the pane must register an HTTP server, not spawn a subprocess: {code}"
        );
        assert!(code.contains("http://127.0.0.1:7333/mcp"), "{code}");
        assert!(
            code.contains(&format!("Authorization: Bearer {token}")),
            "the server authenticates on a bearer header: {code}"
        );
        assert!(
            !code.contains("bay --mcp"),
            "spawning a second bay would not be the window the user has open: {code}"
        );

        let desktop = settings.config_snippet("desktop", token, 7333);
        let parsed: serde_json::Value =
            serde_json::from_str(&desktop).expect("the JSON snippet must parse");
        assert_eq!(
            parsed["mcpServers"]["bay"]["url"],
            "http://127.0.0.1:7333/mcp"
        );
        assert_eq!(
            parsed["mcpServers"]["bay"]["headers"]["Authorization"],
            format!("Bearer {token}")
        );
        assert!(
            parsed["mcpServers"]["bay"]["command"].is_null(),
            "a command means a subprocess, and bay is already running: {desktop}"
        );
    }

    /// A non-default port has to reach the snippet, or `bay --mcp --port N` produces a
    /// copy-pasteable command that connects to nothing.
    #[test]
    fn the_snippet_names_the_port_the_server_bound() {
        let settings = McpSettings::default();
        for client in ["code", "desktop", "cursor"] {
            let snippet = settings.config_snippet(client, "t", 9876);
            assert!(
                snippet.contains("9876") && !snippet.contains("7333"),
                "{client} ignored the bound port: {snippet}"
            );
        }
    }

    /// The pane and `bay --help` must agree about how to reach the same server.
    ///
    /// They did not: the CLI printed the correct `--transport http` invocation while the pane
    /// printed a stdio one, and nothing compared them. Reading the binary's own help text is
    /// blunt, and it is the only thing that actually couples the two — a test asserting the
    /// shape of each separately is what allowed them to drift in the first place.
    #[test]
    fn the_snippets_agree_with_the_cli() {
        let help = include_str!("../../../desktop/src/main.rs");
        assert!(
            help.contains("claude mcp add --transport http bay"),
            "the CLI help no longer shows the http invocation — re-anchor this test"
        );
        let code = McpSettings::default().config_snippet("code", "t", 7333);
        assert!(
            code.starts_with("claude mcp add --transport http bay"),
            "the pane and `bay --help` disagree about how to reach the server: {code}"
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
