//! Everything the settings screen edits, as headless state.
//!
//! This crate exists because of the workspace rule that `rust/` owns all non-UI logic. The
//! settings screen is the most tempting place to break it: "which MCP tools may an agent call"
//! looks like a checkbox, but it is enforced by the MCP server with no window open, and "where
//! does this model run" is read by the provisioner. Both answers therefore live here, and the
//! view only draws them.
//!
//! ## What is real and what is not
//!
//! bay is a local application. Three areas of the settings design describe things that do not
//! exist on this machine, and each is represented honestly rather than simulated:
//!
//! * **Accounts.** There is no bay.video service in this repository. [`account::AccountService`]
//!   is the seam; the only implementation compiled in is
//!   [`account::Unconfigured`], which reports that accounts are not configured. Signing in is
//!   never required — [`Session::Offline`] is the default and the editor works from it.
//! * **Cloud compute.** [`compute::ComputeMode::Cloud`] cannot be selected while
//!   [`compute::cloud_available`] is false, and it is false in every build that ships without a
//!   backend. Choosing it returns an error naming the reason instead of pretending to queue.
//! * **Cloud model routing.** Same rule: a component may be routed to the cloud only if the
//!   cloud is available, so the Models pane can never claim a run happened somewhere it did not.
//!
//! ## Secrets
//!
//! Provider API keys never enter [`Settings`], and therefore never enter `settings.json`. They
//! live in a separate file written `0600` (see [`keys`]), and what the rest of bay can read
//! from `Settings` is a [`providers::KeyHint`] — enough to draw "sk-••••4f2a", not enough to
//! make a request with.

pub mod account;
pub mod captions;
pub mod compute;
pub mod keys;
pub mod mcp;
pub mod models;
pub mod providers;
pub mod store;
pub mod token;

use serde::{Deserialize, Serialize};

pub use account::{Account, Session};
pub use captions::CaptionSettings;
pub use compute::ComputeSettings;
pub use mcp::McpSettings;
pub use models::ModelRouting;
pub use providers::{Provider, Providers};
pub use store::Store;

/// Everything persisted for a user, in one document.
///
/// Every field carries `#[serde(default)]` so a settings file written by an older build loads
/// into a newer one. A settings file that fails to parse is a settings file that locks the user
/// out of their own preferences, and there is no upside to that strictness here.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub session: Session,
    pub providers: Providers,
    pub models: ModelRouting,
    pub mcp: McpSettings,
    pub compute: ComputeSettings,
    /// Where captions sit. Enforced by the MCP server, not just drawn by the settings screen.
    pub captions: CaptionSettings,
}

/// Why a change was refused.
///
/// One type across the crate: every setter that can say no says no the same way, so a caller
/// showing the message never has to know which pane produced it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettingsError {
    /// The change describes a service this build does not have.
    Unavailable(String),
    /// The value itself is wrong — an empty token, an unknown component.
    Invalid(String),
    /// The settings file could not be read or written.
    Io(String),
}

impl std::fmt::Display for SettingsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SettingsError::Unavailable(why) => write!(f, "{why}"),
            SettingsError::Invalid(why) => write!(f, "{why}"),
            SettingsError::Io(why) => write!(f, "could not save settings: {why}"),
        }
    }
}

impl std::error::Error for SettingsError {}

#[cfg(test)]
mod tests {
    use super::*;

    /// The defaults are what a machine that has never opened settings uses, so they are the
    /// configuration most bay installs actually run. They must be the local-first ones.
    #[test]
    fn a_fresh_install_is_offline_local_and_ungated() {
        let settings = Settings::default();
        assert_eq!(settings.session, Session::Offline);
        assert_eq!(
            settings.compute.mode,
            compute::ComputeMode::ThisMachine,
            "compute defaults to the user's own GPU"
        );
        assert!(
            settings.models.routing.is_empty(),
            "no component is routed off the machine until someone asks"
        );
        assert!(
            settings.providers.list.is_empty(),
            "bay ships with no third-party provider enabled"
        );
    }

    /// A file written before a field existed must still load. Losing every preference because
    /// one key is new is the failure mode this guards.
    #[test]
    fn an_older_settings_file_still_loads() {
        let older = r#"{ "compute": { "mode": "thisMachine" } }"#;
        let settings: Settings = serde_json::from_str(older).expect("an older file must load");
        assert_eq!(settings.session, Session::Offline);
        assert!(settings.mcp.enabled);
    }

    /// An empty document is the same as the defaults — this is what a truncated write leaves
    /// behind, and it must not be a parse error.
    #[test]
    fn an_empty_document_is_the_default() {
        let settings: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn settings_round_trip_through_json() {
        let mut settings = Settings::default();
        settings.mcp.enabled = false;
        settings.mcp.block("export_video");
        settings
            .providers
            .upsert(Provider::new("anthropic", "Anthropic", "Claude Sonnet"));
        let text = serde_json::to_string(&settings).unwrap();
        assert_eq!(serde_json::from_str::<Settings>(&text).unwrap(), settings);
    }
}
