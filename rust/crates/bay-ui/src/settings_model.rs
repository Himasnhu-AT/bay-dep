//! What the settings screen draws, as plain data.
//!
//! GPUI-free and pure: every pane is a function of a [`SettingsSnapshot`], which the view
//! gathers once per frame from `bay-settings`, `bay-provision` and the agent registry. That
//! split is what makes "a model that is downloading shows Cancel, and the bar reflects real
//! bytes" a unit test rather than something you check by eye with a gigabyte in flight.

use bay_settings::compute::{ComputeMode, PLANS};
use bay_settings::mcp::CLIENTS;
use bay_settings::providers::{CatalogEntry, CATALOG};
use bay_settings::Settings;

use crate::theme;

/// The five panes, in sidebar order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pane {
    Account,
    Providers,
    Models,
    Mcp,
    Compute,
}

impl Pane {
    pub const ALL: [Pane; 5] = [
        Pane::Account,
        Pane::Providers,
        Pane::Models,
        Pane::Mcp,
        Pane::Compute,
    ];

    pub fn title(self) -> &'static str {
        match self {
            Pane::Account => "Account",
            Pane::Providers => "AI providers",
            Pane::Models => "Models",
            Pane::Mcp => "MCP access",
            Pane::Compute => "Compute",
        }
    }

    /// The second line in the sidebar.
    pub fn subtitle(self) -> &'static str {
        match self {
            Pane::Account => "Session & identity",
            Pane::Providers => "Keys & routing",
            Pane::Models => "What bay has installed",
            Pane::Mcp => "Drive bay from an agent",
            Pane::Compute => "Where work runs",
        }
    }

    /// The paragraph under the pane heading.
    pub fn blurb(self) -> &'static str {
        match self {
            Pane::Account => {
                "bay runs on this Mac and needs no account. This is where one would connect."
            }
            Pane::Providers => {
                "Bring your own keys. A provider is offered to the agent only once it is enabled \
                 and has a key; keys are stored outside this file, readable only by you."
            }
            Pane::Models => {
                "Everything bay can install for itself, from a pinned and checksummed manifest. \
                 Nothing downloads until you ask."
            }
            Pane::Mcp => {
                "bay exposes itself as an MCP server so Claude Code and other agents can edit \
                 your timeline. Blocking a tool here refuses it, and hides it from the agent."
            }
            Pane::Compute => "Choose where renders and model inference run.",
        }
    }
}

/// One installable component, as the view already knows it from `bay-provision`.
///
/// A flattened copy rather than a borrow of `Plan`, so this module can be tested without
/// constructing a provisioning report — and so a change to the provisioner's internals does not
/// reach into the settings model.
#[derive(Debug, Clone, PartialEq)]
pub struct ComponentSnapshot {
    pub id: String,
    pub title: String,
    pub detail: String,
    /// True when bay can already do this job, however that came about.
    pub installed: bool,
    /// Set when it is satisfied by something bay did not install (a Homebrew ffmpeg).
    pub satisfied_via: Option<String>,
    /// False where the manifest pins nothing for this platform.
    pub supported: bool,
    /// What it costs to get, as a human size.
    pub download_size: String,
    /// Bytes it occupies once installed — the honest number for a button, since narration
    /// downloads 43 MB of pinned artifacts and then resolves about a gigabyte of wheels.
    pub disk_size: String,
    /// The install job for this component, when one is running.
    pub job: Option<JobSnapshot>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct JobSnapshot {
    pub id: u64,
    pub message: String,
    /// `None` while the size is not yet known — the venv step downloads through uv, whose byte
    /// count bay does not see, and a bar that invents a number there is lying.
    pub fraction: Option<f32>,
    pub finished: bool,
    pub error: Option<String>,
}

/// An agent that has been talking to this machine.
#[derive(Debug, Clone, PartialEq)]
pub struct ClientSnapshot {
    pub name: String,
    pub detail: String,
    pub live: bool,
}

/// Everything the settings screen reads, gathered once.
#[derive(Debug, Clone, PartialEq)]
pub struct SettingsSnapshot {
    pub settings: Settings,
    pub identity: LocalIdentity,
    pub components: Vec<ComponentSnapshot>,
    pub clients: Vec<ClientSnapshot>,
    /// `None` when the token file could not be read; the pane says so rather than showing a
    /// blank field that looks like an empty credential.
    pub token: Option<String>,
    pub cloud_available: bool,
    pub has_gpu: bool,
    /// Every MCP tool bay implements, sorted. Drawn from the full list, not the allowed one:
    /// a pane built from the filtered list would lose the row that switches a tool back on.
    pub tools: Vec<String>,
    /// The port the server actually bound, which the client snippet has to name.
    ///
    /// The real one, not the default: `bay --mcp --port N` exists, and a snippet that hardcoded
    /// 7333 would be a copy-pasteable command that connects to nothing on any machine where the
    /// default was taken.
    pub agent_port: u16,
}

/// The machine's own answer to "who is this?", with no account involved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalIdentity {
    pub display_name: String,
    pub initial: String,
    pub host: Option<String>,
}

impl From<bay_settings::account::LocalIdentity> for LocalIdentity {
    fn from(identity: bay_settings::account::LocalIdentity) -> Self {
        Self {
            display_name: identity.display_name(),
            initial: identity.initial(),
            host: identity.host.clone(),
        }
    }
}

/// A label/value pair in a small card.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FactRow {
    pub label: String,
    pub value: String,
}

/// The Account pane.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountPane {
    pub name: String,
    pub initial: String,
    /// What sits under the name — an email when signed in, the honest local line when not.
    pub secondary: String,
    pub badge: String,
    pub signed_in: bool,
    pub rows: Vec<FactRow>,
    /// The button, and what it will actually do.
    pub action_label: String,
    /// Shown under the button. Never blank: an inert button with no explanation is the worst
    /// version of this pane.
    pub action_note: String,
}

pub fn account_pane(snapshot: &SettingsSnapshot) -> AccountPane {
    let identity = &snapshot.identity;
    match snapshot.settings.session.account() {
        Some(account) => AccountPane {
            name: account.name.clone(),
            initial: account.initial(),
            secondary: account.email.clone(),
            badge: account.plan.clone(),
            signed_in: true,
            rows: vec![
                FactRow {
                    label: "NAME".into(),
                    value: account.name.clone(),
                },
                FactRow {
                    label: "EMAIL".into(),
                    value: account.email.clone(),
                },
                FactRow {
                    label: "PLAN".into(),
                    value: account.plan.clone(),
                },
                FactRow {
                    label: "DEVICE".into(),
                    value: identity.display_name.clone(),
                },
            ],
            action_label: "Sign out".into(),
            action_note: "Signing out leaves every project on this Mac exactly where it is.".into(),
        },
        None => AccountPane {
            name: identity.display_name.clone(),
            initial: identity.initial.clone(),
            secondary: match &identity.host {
                Some(host) => format!("Local session on {host}"),
                None => "Local session on this Mac".into(),
            },
            badge: "Offline".into(),
            signed_in: false,
            rows: vec![
                FactRow {
                    label: "USER".into(),
                    value: identity.display_name.clone(),
                },
                FactRow {
                    label: "MACHINE".into(),
                    value: identity.host.clone().unwrap_or_else(|| "this Mac".into()),
                },
                FactRow {
                    label: "ACCOUNT".into(),
                    value: "none — bay needs none".into(),
                },
                FactRow {
                    label: "PROJECTS".into(),
                    value: "stored locally".into(),
                },
            ],
            action_label: "Sign in".into(),
            action_note: bay_settings::account::AccountService::describe(
                &bay_settings::account::Unconfigured,
            ),
        },
    }
}

/// One row in the Providers pane.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderRow {
    pub id: String,
    pub name: String,
    pub models: String,
    pub key_label: String,
    /// "Set key" / "Replace".
    pub key_action: String,
    pub needs_key: bool,
    /// Whether the field is showing a real hint or a placeholder, so the view can grey it.
    pub key_absent: bool,
    pub enabled: bool,
    /// Enabled *and* able to serve a request. The dot follows this, not `enabled`.
    pub usable: bool,
    pub toggle_label: String,
    pub dot: crate::theme::Role,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProvidersPane {
    pub rows: Vec<ProviderRow>,
    /// Catalog entries not yet added.
    pub addable: Vec<(String, String)>,
    /// The one-line truth about what is configured.
    pub summary: String,
}

pub fn providers_pane(snapshot: &SettingsSnapshot) -> ProvidersPane {
    let providers = &snapshot.settings.providers;
    let rows = providers
        .list
        .iter()
        .map(|provider| ProviderRow {
            id: provider.id.clone(),
            name: provider.name.clone(),
            models: provider.models.clone(),
            key_label: provider.key_label(),
            key_action: if provider.key_hint.is_some() {
                "Replace".into()
            } else {
                "Set key".into()
            },
            needs_key: provider.needs_key(),
            key_absent: provider.key_hint.is_none(),
            enabled: provider.enabled,
            usable: provider.usable(),
            toggle_label: if provider.enabled {
                "Enabled".into()
            } else {
                "Disabled".into()
            },
            // Amber for "switched on but cannot serve a request" — the state a green dot would
            // hide, and the one that produces a baffling failure at the moment of use.
            dot: match (provider.enabled, provider.usable()) {
                (_, true) => theme::OK,
                (true, false) => theme::WARN,
                (false, false) => theme::DIM_DOT,
            },
        })
        .collect::<Vec<_>>();

    let usable = rows.iter().filter(|row| row.usable).count();
    let summary = match (rows.len(), usable) {
        (0, _) => "No provider is configured. bay talks to nothing until you add one.".into(),
        (_, 0) => "Nothing is usable yet — an enabled provider still needs a key.".into(),
        (_, 1) => "1 provider is ready.".to_string(),
        (_, n) => format!("{n} providers are ready."),
    };

    ProvidersPane {
        rows,
        addable: providers
            .addable()
            .into_iter()
            .map(|entry: &CatalogEntry| (entry.id.to_string(), entry.name.to_string()))
            .collect(),
        summary,
    }
}

/// What the primary button on a model row does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelAction {
    Install,
    Cancel,
    Remove,
    /// Nothing to do: the manifest pins no build for this platform.
    None,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ModelRow {
    pub id: String,
    pub title: String,
    pub detail: String,
    /// "Installed" / "Downloading 42%" / "Not downloaded" / "Not available for this Mac".
    pub state_label: String,
    pub state_color: crate::theme::Role,
    /// 0.0–1.0, or `None` when there is no meaningful number to draw.
    pub progress: Option<f32>,
    pub primary_label: String,
    pub primary: ModelAction,
    pub can_remove: bool,
    /// The advisory when the job is satisfied by a copy bay did not install.
    pub note: Option<String>,
    pub local_selected: bool,
    pub cloud_selectable: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ModelsPane {
    pub rows: Vec<ModelRow>,
    pub footer: String,
}

pub fn models_pane(snapshot: &SettingsSnapshot) -> ModelsPane {
    let rows: Vec<ModelRow> = snapshot
        .components
        .iter()
        .map(|component| {
            let job = component.job.as_ref().filter(|job| !job.finished);
            let failed = component
                .job
                .as_ref()
                .and_then(|job| job.error.clone())
                .filter(|_| !component.installed);

            let (state_label, state_color) = if let Some(error) = &failed {
                (format!("Failed — {error}"), theme::DANGER_TEXT)
            } else if let Some(job) = job {
                (
                    match job.fraction {
                        Some(fraction) => {
                            format!("Downloading {}%", (fraction * 100.0).round() as u32)
                        }
                        None => job.message.clone(),
                    },
                    theme::ACCENT_SOFT,
                )
            } else if !component.supported {
                ("Not available for this Mac".to_string(), theme::FAINT)
            } else if component.installed {
                ("Installed".to_string(), theme::OK)
            } else {
                ("Not downloaded".to_string(), theme::FAINT)
            };

            let primary = if job.is_some() {
                ModelAction::Cancel
            } else if !component.supported {
                ModelAction::None
            } else if component.installed {
                // Only removable when bay installed it. A Homebrew ffmpeg is not bay's to
                // delete, and offering the button implies it is.
                if component.satisfied_via.is_some() {
                    ModelAction::None
                } else {
                    ModelAction::Remove
                }
            } else {
                ModelAction::Install
            };

            ModelRow {
                id: component.id.clone(),
                title: component.title.clone(),
                detail: component.detail.clone(),
                state_label,
                state_color,
                progress: match (job, component.installed) {
                    (Some(job), _) => job.fraction,
                    (None, true) => Some(1.0),
                    (None, false) => Some(0.0),
                },
                primary_label: match primary {
                    ModelAction::Install => format!("Download {}", component.disk_size),
                    ModelAction::Cancel => "Cancel".into(),
                    ModelAction::Remove => "Remove".into(),
                    ModelAction::None => "—".into(),
                },
                primary,
                can_remove: matches!(primary, ModelAction::Remove),
                note: component.satisfied_via.clone(),
                local_selected: snapshot.settings.models.location(&component.id)
                    == bay_settings::models::RunLocation::Local,
                cloud_selectable: snapshot.cloud_available,
            }
        })
        .collect();

    let installed = rows
        .iter()
        .filter(|row| row.state_label == "Installed")
        .count();
    ModelsPane {
        footer: format!(
            "{installed} of {} installed. Every artifact is checked against a pinned SHA-256 \
             before it is unpacked.",
            rows.len()
        ),
        rows,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolRow {
    pub name: String,
    pub allowed: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct McpPane {
    pub running: bool,
    pub status_line: String,
    pub dot: crate::theme::Role,
    pub toggle_label: String,
    /// The endpoint line, with the token abbreviated. The full token is never *drawn* — it
    /// reaches the user through the clipboard, which is a deliberate act rather than something
    /// a screenshot of this screen carries away.
    pub endpoint: String,
    /// The full credential, for the copy button and nothing else. Empty when the token file
    /// could not be read, which the button reports rather than copying an empty string.
    pub token: String,
    pub client_tabs: Vec<(String, String, bool)>,
    pub snippet: String,
    pub client_hint: String,
    pub tools: Vec<ToolRow>,
    pub blocked_count: usize,
    pub clients: Vec<ClientSnapshot>,
}

pub fn mcp_pane(snapshot: &SettingsSnapshot) -> McpPane {
    let settings = &snapshot.settings.mcp;
    let token = snapshot.token.clone();
    let selected = settings.client.as_str();

    McpPane {
        running: settings.enabled,
        status_line: settings.status_line(),
        dot: if settings.enabled {
            theme::OK
        } else {
            theme::DIM_DOT
        },
        toggle_label: if settings.enabled { "Running" } else { "Start" }.into(),
        endpoint: match &token {
            Some(token) => format!("bay --mcp  ·  token {}", bay_settings::token::short(token)),
            None => {
                "bay --mcp  ·  token unavailable — bay could not read its data directory".into()
            }
        },
        client_tabs: CLIENTS
            .iter()
            .map(|client| {
                (
                    client.id.to_string(),
                    client.label.to_string(),
                    client.id == selected,
                )
            })
            .collect(),
        token: token.clone().unwrap_or_default(),
        snippet: match &token {
            Some(token) => settings.config_snippet(selected, token, snapshot.agent_port),
            None => "No token — bay could not read its data directory, so there is nothing to \
                     configure a client with."
                .into(),
        },
        client_hint: bay_settings::mcp::client(selected)
            .map(|client| client.hint.to_string())
            .unwrap_or_default(),
        tools: snapshot
            .tools
            .iter()
            .map(|name| ToolRow {
                allowed: !settings.blocked.contains(name),
                name: name.clone(),
            })
            .collect(),
        blocked_count: settings.blocked.len(),
        clients: snapshot.clients.clone(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputeOption {
    pub id: &'static str,
    pub name: &'static str,
    pub price: String,
    pub price_color: crate::theme::Role,
    pub body: String,
    pub chips: Vec<String>,
    pub selected: bool,
    pub selectable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanRow {
    pub id: &'static str,
    pub name: &'static str,
    pub price: &'static str,
    pub detail: &'static str,
    pub current: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputePane {
    pub options: Vec<ComputeOption>,
    /// Present only when a cloud exists. Otherwise the pane says why there is nothing to buy.
    pub plans: Vec<PlanRow>,
    pub note: String,
}

pub fn compute_pane(snapshot: &SettingsSnapshot) -> ComputePane {
    let installed = snapshot
        .components
        .iter()
        .filter(|component| component.installed)
        .count();
    let mode = snapshot.settings.compute.mode;

    let options = vec![
        ComputeOption {
            id: "local",
            name: "This machine",
            price: "Free".into(),
            price_color: theme::OK,
            body: "Renders and inference use your GPU. Nothing leaves the device.".into(),
            chips: bay_settings::ComputeSettings::local_chips(installed, snapshot.has_gpu),
            selected: mode == ComputeMode::ThisMachine,
            selectable: true,
        },
        ComputeOption {
            id: "cloud",
            name: "bay Cloud",
            price: if snapshot.cloud_available {
                "Paid".into()
            } else {
                "Unavailable".into()
            },
            price_color: if snapshot.cloud_available {
                theme::WARN
            } else {
                theme::FAINT
            },
            body: if snapshot.cloud_available {
                "Queue renders and model runs on managed GPUs.".into()
            } else {
                bay_settings::compute::cloud_unavailable_reason()
            },
            chips: if snapshot.cloud_available {
                vec!["render queue".into(), "all models".into()]
            } else {
                vec!["not in this build".into()]
            },
            selected: mode == ComputeMode::Cloud,
            selectable: snapshot.cloud_available,
        },
    ];

    ComputePane {
        options,
        plans: if snapshot.cloud_available {
            PLANS
                .iter()
                .map(|plan| PlanRow {
                    id: plan.id,
                    name: plan.name,
                    price: plan.price,
                    detail: plan.detail,
                    current: snapshot.settings.compute.plan.as_deref() == Some(plan.id),
                })
                .collect()
        } else {
            Vec::new()
        },
        note: if snapshot.cloud_available {
            "Cloud runs are billed to your plan's render minutes.".into()
        } else {
            "There is nothing to bill: every render in this build happens on your own GPU.".into()
        },
    }
}

/// The whole catalog of providers, for the "add" menu.
pub fn provider_catalog() -> &'static [CatalogEntry] {
    &CATALOG
}

#[cfg(test)]
mod tests {
    use super::*;
    use bay_settings::providers::{catalog_entry, KeyHint, Provider};

    fn snapshot() -> SettingsSnapshot {
        SettingsSnapshot {
            settings: Settings::default(),
            identity: LocalIdentity {
                display_name: "himanshu".into(),
                initial: "H".into(),
                host: Some("studio".into()),
            },
            components: Vec::new(),
            clients: Vec::new(),
            token: Some("a".repeat(64)),
            cloud_available: false,
            has_gpu: true,
            tools: vec!["add_clip".into(), "render".into(), "snapshot".into()],
            agent_port: bay_agent::registry::DEFAULT_PORT,
        }
    }

    fn component(id: &str, installed: bool) -> ComponentSnapshot {
        ComponentSnapshot {
            id: id.into(),
            title: format!("{id} tools"),
            detail: "does a thing".into(),
            installed,
            satisfied_via: None,
            supported: true,
            download_size: "57 MB".into(),
            disk_size: "120 MB".into(),
            job: None,
        }
    }

    // ---- Account ----------------------------------------------------------------------

    /// The default state of every install. It must read as a working local app, not as a
    /// logged-out one.
    #[test]
    fn the_offline_account_pane_describes_the_machine_not_a_missing_login() {
        let pane = account_pane(&snapshot());
        assert!(!pane.signed_in);
        assert_eq!(pane.name, "himanshu");
        assert_eq!(pane.initial, "H");
        assert_eq!(pane.secondary, "Local session on studio");
        assert!(
            pane.rows
                .iter()
                .any(|row| row.value.contains("bay needs none")),
            "the pane must say an account is not required: {:?}",
            pane.rows
        );
        assert!(
            !pane.action_note.is_empty(),
            "an inert button with no explanation is the worst version of this pane"
        );
        assert!(pane.action_note.contains("offline"), "{}", pane.action_note);
    }

    /// And when a service does exist, the same pane shows the identity it vouched for.
    #[test]
    fn a_signed_in_account_pane_shows_the_service_identity() {
        let mut snapshot = snapshot();
        snapshot.settings.session = bay_settings::Session::SignedIn {
            account: bay_settings::Account {
                name: "Ava Mehta".into(),
                email: "ava@studio.co".into(),
                plan: "Studio".into(),
            },
        };
        let pane = account_pane(&snapshot);
        assert!(pane.signed_in);
        assert_eq!(pane.initial, "A");
        assert_eq!(pane.secondary, "ava@studio.co");
        assert_eq!(pane.action_label, "Sign out");
        assert!(
            pane.action_note.contains("every project"),
            "{}",
            pane.action_note
        );
    }

    // ---- Providers --------------------------------------------------------------------

    #[test]
    fn an_unconfigured_providers_pane_says_bay_talks_to_nothing() {
        let pane = providers_pane(&snapshot());
        assert!(pane.rows.is_empty());
        assert_eq!(pane.addable.len(), CATALOG.len());
        assert!(
            pane.summary.contains("talks to nothing"),
            "{}",
            pane.summary
        );
    }

    /// The state a green dot would hide: switched on, no key, and it will fail at the moment of
    /// use with an error nobody can connect back to this pane.
    #[test]
    fn a_keyless_enabled_provider_is_amber_not_green() {
        let mut snapshot = snapshot();
        snapshot
            .settings
            .providers
            .upsert(Provider::from_catalog(catalog_entry("anthropic").unwrap()));
        snapshot.settings.providers.toggle("anthropic").unwrap();

        let row = &providers_pane(&snapshot).rows[0];
        assert!(row.enabled);
        assert!(!row.usable);
        assert_eq!(row.dot, theme::WARN);
        assert_eq!(row.key_label, "no key set");
        assert_eq!(row.key_action, "Set key");
    }

    #[test]
    fn a_keyed_provider_is_green_and_offers_to_replace_the_key() {
        let mut snapshot = snapshot();
        snapshot
            .settings
            .providers
            .upsert(Provider::from_catalog(catalog_entry("anthropic").unwrap()));
        snapshot
            .settings
            .providers
            .set_key_hint("anthropic", KeyHint::of("sk-ant-api03-aaaabbbb4f2a"))
            .unwrap();

        let pane = providers_pane(&snapshot);
        let row = &pane.rows[0];
        assert!(row.usable);
        assert_eq!(row.dot, theme::OK);
        assert_eq!(row.key_action, "Replace");
        assert!(row.key_label.contains("4f2a"));
        assert!(
            !row.key_label.contains("aaaabbbb"),
            "the pane must not show the key body"
        );
        assert_eq!(pane.summary, "1 provider is ready.");
        assert!(!pane.addable.iter().any(|(id, _)| id == "anthropic"));
    }

    #[test]
    fn a_disabled_provider_has_a_dim_dot() {
        let mut snapshot = snapshot();
        snapshot
            .settings
            .providers
            .upsert(Provider::from_catalog(catalog_entry("google").unwrap()));
        let row = &providers_pane(&snapshot).rows[0];
        assert_eq!(row.dot, theme::DIM_DOT);
        assert_eq!(row.toggle_label, "Disabled");
    }

    // ---- Models -----------------------------------------------------------------------

    #[test]
    fn a_missing_component_offers_a_download_with_its_size() {
        let mut snapshot = snapshot();
        snapshot.components = vec![component("video", false)];
        let row = &models_pane(&snapshot).rows[0];
        assert_eq!(row.primary, ModelAction::Install);
        assert_eq!(row.primary_label, "Download 120 MB");
        assert_eq!(row.state_label, "Not downloaded");
        assert_eq!(row.progress, Some(0.0));
    }

    #[test]
    fn an_installed_component_offers_removal_and_reads_as_done() {
        let mut snapshot = snapshot();
        snapshot.components = vec![component("speech", true)];
        let row = &models_pane(&snapshot).rows[0];
        assert_eq!(row.primary, ModelAction::Remove);
        assert_eq!(row.state_label, "Installed");
        assert_eq!(row.state_color, theme::OK);
        assert_eq!(row.progress, Some(1.0));
        assert!(models_pane(&snapshot)
            .footer
            .starts_with("1 of 1 installed"));
    }

    /// A Homebrew ffmpeg is not bay's to delete, and a Remove button implies it is.
    #[test]
    fn a_component_bay_did_not_install_cannot_be_removed_here() {
        let mut snapshot = snapshot();
        let mut video = component("video", true);
        video.satisfied_via = Some("already available at /opt/homebrew/bin/ffmpeg".into());
        snapshot.components = vec![video];

        let row = &models_pane(&snapshot).rows[0];
        assert_eq!(row.primary, ModelAction::None);
        assert!(!row.can_remove);
        assert_eq!(
            row.note.as_deref(),
            Some("already available at /opt/homebrew/bin/ffmpeg"),
            "the pane must say where the working copy came from"
        );
    }

    #[test]
    fn a_running_install_shows_real_progress_and_offers_cancel() {
        let mut snapshot = snapshot();
        let mut listen = component("listen", false);
        listen.job = Some(JobSnapshot {
            id: 7,
            message: "downloading whisper".into(),
            fraction: Some(0.42),
            finished: false,
            error: None,
        });
        snapshot.components = vec![listen];

        let row = &models_pane(&snapshot).rows[0];
        assert_eq!(row.primary, ModelAction::Cancel);
        assert_eq!(row.state_label, "Downloading 42%");
        assert_eq!(row.progress, Some(0.42));
    }

    /// The venv step downloads through uv, whose byte count bay does not see. A bar that
    /// invents a number there is the dishonest option.
    #[test]
    fn a_step_with_no_byte_count_shows_its_message_and_no_percentage() {
        let mut snapshot = snapshot();
        let mut speech = component("speech", false);
        speech.job = Some(JobSnapshot {
            id: 9,
            message: "building the Kokoro environment".into(),
            fraction: None,
            finished: false,
            error: None,
        });
        snapshot.components = vec![speech];

        let row = &models_pane(&snapshot).rows[0];
        assert_eq!(row.state_label, "building the Kokoro environment");
        assert_eq!(row.progress, None);
    }

    #[test]
    fn a_failed_install_shows_the_whole_error_and_offers_the_download_again() {
        let mut snapshot = snapshot();
        let mut vision = component("vision", false);
        vision.job = Some(JobSnapshot {
            id: 3,
            message: "".into(),
            fraction: Some(0.6),
            finished: true,
            error: Some("digest mismatch for siglip-model".into()),
        });
        snapshot.components = vec![vision];

        let row = &models_pane(&snapshot).rows[0];
        assert!(
            row.state_label.contains("digest mismatch"),
            "{}",
            row.state_label
        );
        assert_eq!(
            row.primary,
            ModelAction::Install,
            "a failure must be retryable"
        );
    }

    /// A platform with no pinned build must not be offered a download that cannot happen.
    #[test]
    fn an_unsupported_component_offers_nothing() {
        let mut snapshot = snapshot();
        let mut local_gen = component("generation-local", false);
        local_gen.supported = false;
        snapshot.components = vec![local_gen];

        let row = &models_pane(&snapshot).rows[0];
        assert_eq!(row.primary, ModelAction::None);
        assert_eq!(row.state_label, "Not available for this Mac");
    }

    #[test]
    fn cloud_routing_is_not_offered_without_a_cloud() {
        let mut snapshot = snapshot();
        snapshot.components = vec![component("listen", true)];
        assert!(!models_pane(&snapshot).rows[0].cloud_selectable);
        assert!(models_pane(&snapshot).rows[0].local_selected);

        snapshot.cloud_available = true;
        assert!(models_pane(&snapshot).rows[0].cloud_selectable);
    }

    // ---- MCP --------------------------------------------------------------------------

    #[test]
    fn the_mcp_pane_lists_every_tool_with_its_current_state() {
        let mut snapshot = snapshot();
        snapshot.settings.mcp.block("render");
        let pane = mcp_pane(&snapshot);

        assert_eq!(
            pane.tools.len(),
            3,
            "every tool keeps a row, blocked or not"
        );
        let render = pane.tools.iter().find(|t| t.name == "render").unwrap();
        assert!(!render.allowed);
        assert!(
            pane.tools
                .iter()
                .find(|t| t.name == "add_clip")
                .unwrap()
                .allowed
        );
        assert_eq!(pane.blocked_count, 1);
        assert!(
            pane.status_line.contains("1 tool is blocked"),
            "{}",
            pane.status_line
        );
    }

    /// The full credential belongs in the copyable snippet, not in a line that ends up in a
    /// screenshot of the settings screen.
    #[test]
    fn the_endpoint_line_abbreviates_the_token_but_the_snippet_carries_it() {
        let snapshot = snapshot();
        let token = snapshot.token.clone().unwrap();
        let pane = mcp_pane(&snapshot);
        assert!(!pane.endpoint.contains(&token), "{}", pane.endpoint);
        assert!(pane.endpoint.contains("aaaaaaaa…"), "{}", pane.endpoint);
        assert!(
            pane.snippet.contains(&token),
            "the snippet must be pasteable"
        );
        // `--transport http`, not `--mcp`. This asserted the latter, which is the flag for
        // spawning a *second* headless bay — the snippet's original bug, pinned by its own test.
        assert!(
            pane.snippet.contains("--transport http"),
            "the snippet must register the running server, not spawn one: {}",
            pane.snippet
        );
        assert!(
            pane.snippet
                .contains(&format!("127.0.0.1:{}/mcp", snapshot.agent_port)),
            "the snippet must name the bound port: {}",
            pane.snippet
        );
    }

    /// What the copy buttons put on the clipboard is the *full* credential, not the elided one
    /// that is safe to show.
    ///
    /// The pane deliberately abbreviates the token in the endpoint line, because that line ends
    /// up in screenshots. That is only a good decision if the full one is reachable some other
    /// way — otherwise the abbreviation is just an obstacle, and a user transcribes 64 hex
    /// characters off their own screen. One did.
    #[test]
    fn the_copyable_fields_carry_the_whole_token() {
        let snapshot = snapshot();
        let token = snapshot.token.clone().unwrap();
        let pane = mcp_pane(&snapshot);

        assert_eq!(
            pane.token, token,
            "the copy button would paste the wrong thing"
        );
        assert!(
            !pane.endpoint.contains(&token),
            "the drawn line must stay abbreviated: {}",
            pane.endpoint
        );
        assert!(pane.snippet.contains(&token), "the snippet is copied whole");
    }

    /// A missing token must not copy an empty string that looks like it worked.
    #[test]
    fn a_missing_token_leaves_nothing_to_copy() {
        let mut snapshot = snapshot();
        snapshot.token = None;
        let pane = mcp_pane(&snapshot);
        assert!(
            pane.token.is_empty(),
            "an absent credential must be empty, so the button can refuse rather than paste"
        );
    }

    /// A blank token field looks like an empty credential. It has to say what went wrong.
    #[test]
    fn a_missing_token_is_explained_rather_than_left_blank() {
        let mut snapshot = snapshot();
        snapshot.token = None;
        let pane = mcp_pane(&snapshot);
        assert!(pane.endpoint.contains("unavailable"), "{}", pane.endpoint);
        assert!(pane.snippet.contains("No token"), "{}", pane.snippet);
    }

    #[test]
    fn a_stopped_server_reads_as_stopped() {
        let mut snapshot = snapshot();
        snapshot.settings.mcp.enabled = false;
        let pane = mcp_pane(&snapshot);
        assert!(!pane.running);
        assert_eq!(pane.toggle_label, "Start");
        assert_eq!(pane.dot, theme::DIM_DOT);
        assert!(pane.status_line.contains("no agent can reach bay"));
    }

    #[test]
    fn exactly_one_client_tab_is_selected_and_it_drives_the_snippet() {
        let mut snapshot = snapshot();
        snapshot.settings.mcp.client = "desktop".into();
        let pane = mcp_pane(&snapshot);
        let selected: Vec<&String> = pane
            .client_tabs
            .iter()
            .filter(|(_, _, on)| *on)
            .map(|(id, _, _)| id)
            .collect();
        assert_eq!(selected, vec!["desktop"]);
        assert!(pane.snippet.contains("mcpServers"), "{}", pane.snippet);
        assert!(pane.client_hint.contains("claude_desktop_config.json"));
    }

    // ---- Compute ----------------------------------------------------------------------

    /// The pane may show the cloud option — it is a real product idea — but it must not let it
    /// be chosen, and it must say why.
    #[test]
    fn the_cloud_option_is_shown_unselectable_and_explained() {
        let pane = compute_pane(&snapshot());
        let cloud = pane.options.iter().find(|o| o.id == "cloud").unwrap();
        assert!(!cloud.selectable);
        assert!(!cloud.selected);
        assert_eq!(cloud.price, "Unavailable");
        assert!(cloud.body.contains("this Mac"), "{}", cloud.body);
        assert!(pane.plans.is_empty(), "nothing to buy without a service");
        assert!(pane.note.contains("your own GPU"), "{}", pane.note);
    }

    #[test]
    fn the_local_option_is_selected_and_counts_what_is_installed() {
        let mut snapshot = snapshot();
        snapshot.components = vec![component("video", true), component("speech", false)];
        let pane = compute_pane(&snapshot);
        let local = pane.options.iter().find(|o| o.id == "local").unwrap();
        assert!(local.selected);
        assert!(local.selectable);
        assert!(
            local.chips.iter().any(|chip| chip == "1 runtime installed"),
            "{:?}",
            local.chips
        );
        assert!(local.chips.iter().any(|chip| chip == "GPU compositor"));
    }

    /// A machine with no adapter must say so here, because that is where a failed export sends
    /// the user looking.
    #[test]
    fn a_machine_with_no_gpu_says_so_on_the_local_card() {
        let mut snapshot = snapshot();
        snapshot.has_gpu = false;
        let pane = compute_pane(&snapshot);
        let local = pane.options.iter().find(|o| o.id == "local").unwrap();
        assert!(
            local.chips.iter().any(|chip| chip == "no GPU adapter"),
            "{:?}",
            local.chips
        );
    }

    #[test]
    fn with_a_cloud_the_plans_appear_and_mark_the_current_one() {
        let mut snapshot = snapshot();
        snapshot.cloud_available = true;
        snapshot.settings.compute.plan = Some("studio".into());
        let pane = compute_pane(&snapshot);
        assert_eq!(pane.plans.len(), PLANS.len());
        assert_eq!(
            pane.plans.iter().filter(|plan| plan.current).count(),
            1,
            "exactly one plan is current"
        );
        assert!(
            pane.options
                .iter()
                .find(|o| o.id == "cloud")
                .unwrap()
                .selectable
        );
    }

    #[test]
    fn every_pane_has_a_distinct_title_subtitle_and_blurb() {
        let mut titles: Vec<&str> = Pane::ALL.iter().map(|p| p.title()).collect();
        let mut subtitles: Vec<&str> = Pane::ALL.iter().map(|p| p.subtitle()).collect();
        let mut blurbs: Vec<&str> = Pane::ALL.iter().map(|p| p.blurb()).collect();
        for list in [&mut titles, &mut subtitles, &mut blurbs] {
            list.sort_unstable();
            list.dedup();
        }
        assert_eq!(titles.len(), 5);
        assert_eq!(subtitles.len(), 5);
        assert_eq!(blurbs.len(), 5);
    }
}
