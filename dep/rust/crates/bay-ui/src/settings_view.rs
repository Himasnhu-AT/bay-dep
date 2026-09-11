//! The settings screen: five panes over `bay-settings`, `bay-provision` and the agent registry.
//!
//! Drawing only. Every value comes from [`crate::settings_model`], which is pure and tested;
//! every click calls a method on the shell that changes real state and persists it. Nothing in
//! this file decides what a pane says — if a claim is wrong, it is wrong in the model, where
//! there is a test for it.

use crate::theme::rgb;
use gpui::prelude::*;
use gpui::{div, px, Context, Div, SharedString};

use crate::app_view::{BayApp, Screen};
use crate::input::TextField;
use crate::settings_model::{
    self, ClientSnapshot, ComponentSnapshot, JobSnapshot, ModelAction, Pane, SettingsSnapshot,
};
use crate::theme;
use crate::widgets::{self, text};

/// How many tool switches to draw before asking the user to narrow the list.
///
/// bay exposes about ninety tools. Drawing all of them is a wall of switches that takes seconds
/// to scan and makes the pane feel broken; drawing a subset without saying so would hide the
/// one the user came to find. So it draws a page and says how many it did not.
const TOOL_PAGE: usize = 24;

impl BayApp {
    /// Gather everything the screen reads, once per frame.
    ///
    /// The provisioning report walks the filesystem, and the registry reads a directory. Doing
    /// either inside a pane function would mean five stats per frame for one answer.
    pub(crate) fn settings_snapshot(&self) -> SettingsSnapshot {
        let report = bay_provision::report();
        let components = report
            .components
            .iter()
            .map(|plan| ComponentSnapshot {
                id: plan.component.clone(),
                title: plan.title.clone(),
                detail: plan.detail.clone(),
                installed: plan.satisfied,
                satisfied_via: plan.satisfied_via.clone(),
                supported: !plan.unsupported,
                download_size: bay_provision::human_bytes(plan.download_bytes),
                // The honest number for a button: narration's two pinned archives are 43 MB,
                // and installing it occupies about 1.2 GB once uv has resolved the wheels.
                disk_size: bay_provision::human_bytes(plan.disk_bytes.max(plan.download_bytes)),
                job: bay_provision::jobs::running_for(&plan.component)
                    .and_then(bay_provision::jobs::state)
                    .map(|state| JobSnapshot {
                        id: state.id,
                        message: state.message.clone(),
                        fraction: state.fraction(),
                        finished: state.finished,
                        error: state.error.clone(),
                    }),
            })
            .collect();

        SettingsSnapshot {
            settings: self.settings.clone(),
            identity: bay_settings::account::LocalIdentity::detect().into(),
            components,
            clients: connected_clients(),
            token: self.mcp_token.clone(),
            cloud_available: bay_settings::compute::cloud_available(),
            has_gpu: self.gpu_available,
            tools: bay_mcp_tool_names(),
            // The bound port, falling back to the default only when the server is not running —
            // in which case the snippet describes where it *will* listen.
            agent_port: self.agent_port.unwrap_or(bay_agent::registry::DEFAULT_PORT),
        }
    }

    pub(crate) fn settings_screen(&mut self, cx: &mut Context<Self>) -> Div {
        let snapshot = self.settings_snapshot();
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(rgb(theme::BG))
            .text_color(rgb(theme::TEXT))
            .child(self.settings_header(cx))
            .child(
                div()
                    .flex()
                    .flex_row()
                    .flex_1()
                    .min_h(px(0.0))
                    .child(self.settings_sidebar(cx))
                    .child(
                        div()
                            .id("settings-pane")
                            .flex_1()
                            .min_w(px(0.0))
                            .flex()
                            .flex_col()
                            .gap(px(10.0))
                            .px(px(26.0))
                            .py(px(22.0))
                            .overflow_y_scroll()
                            .child(
                                div()
                                    .text_lg()
                                    .text_color(rgb(theme::TEXT))
                                    .child(self.settings_pane.title()),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(rgb(theme::MUTED))
                                    .child(self.settings_pane.blurb()),
                            )
                            .children(
                                self.settings_complaint
                                    .clone()
                                    .map(|complaint| widgets::banner(complaint, theme::WARN)),
                            )
                            .child(match self.settings_pane {
                                Pane::Account => self.account_pane(&snapshot, cx),
                                Pane::Providers => self.providers_pane(&snapshot, cx),
                                Pane::Models => self.models_pane(&snapshot, cx),
                                Pane::Mcp => self.mcp_pane(&snapshot, cx),
                                Pane::Compute => self.compute_pane(&snapshot, cx),
                                Pane::Captions => self.captions_pane(&snapshot, cx),
                            }),
                    ),
            )
    }

    fn settings_header(&self, cx: &mut Context<Self>) -> Div {
        widgets::row()
            .h(px(52.0))
            .flex_none()
            .justify_between()
            .px(px(14.0))
            .bg(rgb(theme::PANEL))
            .border_b_1()
            .border_color(rgb(theme::BORDER))
            .child(
                widgets::row()
                    .child(
                        self.button("close-settings", "‹ Projects", false, cx, |this, _cx| {
                            this.screen = Screen::Launcher;
                            this.keying = None;
                        }),
                    )
                    .child(div().text_color(rgb(theme::TEXT)).child("Settings")),
            )
            .child(widgets::avatar(self.account_initial(), 26.0))
    }

    fn settings_sidebar(&self, cx: &mut Context<Self>) -> Div {
        let mut sidebar = div()
            .w(px(212.0))
            .flex_none()
            .flex()
            .flex_col()
            .gap(px(3.0))
            .px(px(10.0))
            .py(px(12.0))
            .bg(rgb(theme::PANEL))
            .border_r_1()
            .border_color(rgb(theme::BORDER));

        for (index, pane) in Pane::ALL.into_iter().enumerate() {
            let on = self.settings_pane == pane;
            sidebar = sidebar.child(
                div()
                    .id(("settings-tab", index))
                    .flex()
                    .flex_col()
                    .px(px(10.0))
                    .py(px(7.0))
                    .rounded(px(6.0))
                    .bg(rgb(if on { theme::SELECTED } else { theme::PANEL }))
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(theme::TEXT))
                            .child(pane.title()),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(if on { theme::ACCENT_SOFT } else { theme::FAINT }))
                            .child(pane.subtitle()),
                    )
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.settings_pane = pane;
                        this.keying = None;
                        cx.notify();
                    })),
            );
        }
        sidebar
    }

    // ---- Account -------------------------------------------------------------------------

    fn account_pane(&self, snapshot: &SettingsSnapshot, cx: &mut Context<Self>) -> Div {
        let pane = settings_model::account_pane(snapshot);
        let signed_in = pane.signed_in;

        let mut facts = div().flex().flex_col().gap(px(10.0));
        for pair in pane.rows.chunks(2) {
            let mut row = div().flex().flex_row().gap(px(10.0));
            for fact in pair {
                row = row.child(
                    widgets::card()
                        .flex_1()
                        .min_w(px(0.0))
                        .child(widgets::section(fact.label.clone()))
                        .child(
                            div()
                                .mt(px(5.0))
                                .text_sm()
                                .text_color(rgb(theme::TEXT))
                                .overflow_hidden()
                                .child(text(fact.value.clone())),
                        ),
                );
            }
            if pair.len() == 1 {
                row = row.child(div().flex_1());
            }
            facts = facts.child(row);
        }

        div()
            .flex()
            .flex_col()
            .gap(px(10.0))
            .mt(px(6.0))
            .child(
                widgets::card()
                    .flex_row()
                    .items_center()
                    .gap(px(12.0))
                    .p(px(14.0))
                    .child(widgets::avatar(pane.initial.clone(), 44.0))
                    .child(
                        div()
                            .flex_1()
                            .min_w(px(0.0))
                            .flex()
                            .flex_col()
                            .child(
                                div()
                                    .text_color(rgb(theme::TEXT))
                                    .child(text(pane.name.clone())),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(rgb(theme::MUTED))
                                    .child(text(pane.secondary.clone())),
                            ),
                    )
                    .child(widgets::chip(pane.badge.clone()))
                    .child(self.button(
                        "account-action",
                        pane.action_label.clone(),
                        false,
                        cx,
                        move |this, _cx| {
                            if signed_in {
                                this.sign_out();
                            } else {
                                this.screen = Screen::SignIn;
                            }
                        },
                    )),
            )
            .child(widgets::note(pane.action_note.clone()))
            .child(facts)
    }

    // ---- Providers -----------------------------------------------------------------------

    fn providers_pane(&self, snapshot: &SettingsSnapshot, cx: &mut Context<Self>) -> Div {
        let pane = settings_model::providers_pane(snapshot);
        let mut body = div()
            .flex()
            .flex_col()
            .gap(px(10.0))
            .mt(px(6.0))
            .child(widgets::note(pane.summary.clone()));

        for (index, row) in pane.rows.iter().enumerate() {
            let id = row.id.clone();
            let keying = self
                .keying
                .as_ref()
                .filter(|(provider, _)| *provider == row.id);

            let mut card = widgets::card()
                .gap(px(6.0))
                .child(
                    widgets::row()
                        .child(widgets::dot(row.dot))
                        .child(
                            div()
                                .flex_1()
                                .min_w(px(0.0))
                                .text_color(rgb(theme::TEXT))
                                .child(text(row.name.clone())),
                        )
                        .child(
                            div()
                                .id(("provider-toggle", index))
                                .px(px(8.0))
                                .py(px(2.0))
                                .rounded(px(5.0))
                                .bg(rgb(if row.enabled {
                                    theme::SELECTED
                                } else {
                                    theme::PANEL_ALT
                                }))
                                .text_xs()
                                .text_color(rgb(if row.enabled {
                                    theme::TEXT
                                } else {
                                    theme::MUTED
                                }))
                                .child(text(row.toggle_label.clone()))
                                .on_click({
                                    let id = id.clone();
                                    cx.listener(move |this, _event, _window, cx| {
                                        let _ = this.settings.providers.toggle(&id);
                                        this.save_settings();
                                        cx.notify();
                                    })
                                }),
                        )
                        .child(
                            div()
                                .id(("provider-remove", index))
                                .px(px(8.0))
                                .py(px(2.0))
                                .rounded(px(5.0))
                                .bg(rgb(theme::PANEL_ALT))
                                .text_xs()
                                .text_color(rgb(theme::MUTED))
                                .child("✕")
                                .on_click({
                                    let id = id.clone();
                                    cx.listener(move |this, _event, _window, cx| {
                                        this.forget_provider(&id);
                                        cx.notify();
                                    })
                                }),
                        ),
                )
                .child(
                    div()
                        .text_xs()
                        .text_color(rgb(theme::MUTED))
                        .child(text(row.models.clone())),
                )
                .child(
                    widgets::row()
                        .gap(px(6.0))
                        .child(widgets::readout(row.key_label.clone(), row.key_absent))
                        .children(row.needs_key.then(|| {
                            div()
                                .id(("provider-key", index))
                                .px(px(9.0))
                                .py(px(5.0))
                                .rounded(px(5.0))
                                .bg(rgb(theme::PANEL_ALT))
                                .text_xs()
                                .text_color(rgb(theme::TEXT))
                                .child(text(row.key_action.clone()))
                                .on_click({
                                    let id = id.clone();
                                    cx.listener(move |this, _event, _window, cx| {
                                        this.keying =
                                            Some((id.clone(), TextField::new("paste key")));
                                        cx.notify();
                                    })
                                })
                        })),
                );

            if let Some((_, field)) = keying {
                card = card.child(
                    div()
                        .mt(px(8.0))
                        .p(px(10.0))
                        .rounded(px(6.0))
                        .bg(rgb(theme::LANE))
                        .border_1()
                        .border_color(rgb(theme::ACCENT))
                        .flex()
                        .flex_col()
                        .child(widgets::section(format!("API KEY · {}", row.name)))
                        .child(
                            div()
                                .mt(px(6.0))
                                .font_family("ui-monospace")
                                .text_sm()
                                .text_color(rgb(if field.showing_placeholder() {
                                    theme::MUTED
                                } else {
                                    theme::TEXT
                                }))
                                .child(text(field.display())),
                        )
                        .child(widgets::note(
                            "Enter to save · Esc to cancel. Stored in a file only you can read.",
                        )),
                );
            }
            body = body.child(card);
        }

        if !pane.addable.is_empty() {
            let mut add = div()
                .flex()
                .flex_row()
                .flex_wrap()
                .gap(px(6.0))
                .items_center()
                .child(widgets::section("ADD A PROVIDER"));
            for (index, (id, name)) in pane.addable.iter().enumerate() {
                let id = id.clone();
                add = add.child(
                    div()
                        .id(("add-provider", index))
                        .px(px(10.0))
                        .py(px(4.0))
                        .rounded(px(5.0))
                        .bg(rgb(theme::PANEL_ALT))
                        .text_xs()
                        .text_color(rgb(theme::TEXT))
                        .child(text(format!("＋ {name}")))
                        .on_click(cx.listener(move |this, _event, _window, cx| {
                            this.add_provider(&id);
                            cx.notify();
                        })),
                );
            }
            body = body.child(add);
        }
        body
    }

    // ---- Models --------------------------------------------------------------------------

    fn models_pane(&self, snapshot: &SettingsSnapshot, cx: &mut Context<Self>) -> Div {
        let pane = settings_model::models_pane(snapshot);
        let mut body = div().flex().flex_col().gap(px(10.0)).mt(px(6.0));

        for (index, row) in pane.rows.iter().enumerate() {
            let id = row.id.clone();
            let action = row.primary;
            body = body.child(
                widgets::card()
                    .gap(px(6.0))
                    .child(
                        widgets::row()
                            .child(
                                div()
                                    .flex_1()
                                    .min_w(px(0.0))
                                    .flex()
                                    .flex_col()
                                    .child(
                                        div()
                                            .text_color(rgb(theme::TEXT))
                                            .child(text(row.title.clone())),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(rgb(theme::MUTED))
                                            .child(text(row.detail.clone())),
                                    ),
                            )
                            .child(self.run_location_switch(
                                &row.id,
                                row.local_selected,
                                row.cloud_selectable,
                                index,
                                cx,
                            )),
                    )
                    .child(div().mt(px(8.0)).child(widgets::progress(
                        row.progress,
                        if row.state_label == "Installed" {
                            theme::OK
                        } else {
                            theme::ACCENT
                        },
                    )))
                    .child(
                        widgets::row()
                            .mt(px(9.0))
                            .children((action != ModelAction::None).then(|| {
                                div()
                                    .id(("model-primary", index))
                                    .px(px(10.0))
                                    .py(px(5.0))
                                    .rounded(px(5.0))
                                    .bg(rgb(match action {
                                        ModelAction::Install => theme::ACCENT,
                                        _ => theme::PANEL_ALT,
                                    }))
                                    .text_xs()
                                    .text_color(rgb(match action {
                                        ModelAction::Install => theme::ON_ACCENT,
                                        _ => theme::MUTED,
                                    }))
                                    .child(text(row.primary_label.clone()))
                                    .on_click(cx.listener(move |this, _event, _window, cx| {
                                        this.run_model_action(&id, action);
                                        cx.notify();
                                    }))
                            }))
                            .child(div().flex_1())
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(rgb(row.state_color))
                                    .child(text(row.state_label.clone())),
                            ),
                    )
                    .children(row.note.clone().map(widgets::note)),
            );
        }

        body.child(widgets::note(pane.footer))
    }

    /// The "On this Mac / bay Cloud" switch.
    ///
    /// The cloud half is drawn but inert while there is no cloud, and clicking it says why
    /// rather than flipping a control that changes nothing.
    fn run_location_switch(
        &self,
        component: &str,
        local: bool,
        cloud_selectable: bool,
        index: usize,
        cx: &mut Context<Self>,
    ) -> Div {
        let for_local = component.to_string();
        let for_cloud = component.to_string();
        div()
            .flex()
            .flex_row()
            .flex_none()
            .rounded(px(5.0))
            .overflow_hidden()
            .border_1()
            .border_color(rgb(theme::BORDER))
            .child(
                div()
                    .id(("run-local", index))
                    .px(px(10.0))
                    .py(px(4.0))
                    .bg(rgb(if local {
                        theme::SELECTED
                    } else {
                        theme::PANEL_ALT
                    }))
                    .text_xs()
                    .text_color(rgb(if local { theme::TEXT } else { theme::MUTED }))
                    .child("On this Mac")
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.route_component(&for_local, bay_settings::models::RunLocation::Local);
                        cx.notify();
                    })),
            )
            .child(
                div()
                    .id(("run-cloud", index))
                    .px(px(10.0))
                    .py(px(4.0))
                    .bg(rgb(if !local {
                        theme::SELECTED
                    } else {
                        theme::PANEL_ALT
                    }))
                    .text_xs()
                    .text_color(rgb(if cloud_selectable {
                        if local {
                            theme::MUTED
                        } else {
                            theme::TEXT
                        }
                    } else {
                        theme::FAINT
                    }))
                    .child("bay Cloud")
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.route_component(&for_cloud, bay_settings::models::RunLocation::Cloud);
                        cx.notify();
                    })),
            )
    }

    // ---- MCP -----------------------------------------------------------------------------

    fn mcp_pane(&self, snapshot: &SettingsSnapshot, cx: &mut Context<Self>) -> Div {
        let pane = settings_model::mcp_pane(snapshot);
        let filter = self.tool_filter.trimmed().to_lowercase();
        let matching: Vec<&settings_model::ToolRow> = pane
            .tools
            .iter()
            .filter(|tool| filter.is_empty() || tool.name.to_lowercase().contains(&filter))
            .collect();
        let hidden = matching.len().saturating_sub(TOOL_PAGE);

        let mut tools = div().flex().flex_col().gap(px(6.0));
        for chunk in matching
            .iter()
            .take(TOOL_PAGE)
            .collect::<Vec<_>>()
            .chunks(2)
        {
            let mut row = div().flex().flex_row().gap(px(8.0));
            for tool in chunk {
                let name = tool.name.clone();
                let allowed = tool.allowed;
                row = row.child(
                    widgets::card()
                        .flex_1()
                        .min_w(px(0.0))
                        .flex_row()
                        .items_center()
                        .gap(px(9.0))
                        .p(px(10.0))
                        .child(
                            div()
                                .flex_1()
                                .min_w(px(0.0))
                                .font_family("ui-monospace")
                                .text_xs()
                                .text_color(rgb(theme::TEXT))
                                .overflow_hidden()
                                .child(text(tool.name.clone())),
                        )
                        .child(
                            div()
                                .id(SharedString::from(format!("tool-{}", tool.name)))
                                .px(px(8.0))
                                .py(px(2.0))
                                .rounded(px(5.0))
                                .bg(rgb(if allowed {
                                    theme::SELECTED
                                } else {
                                    theme::PANEL_ALT
                                }))
                                .text_xs()
                                .text_color(rgb(if allowed { theme::TEXT } else { theme::MUTED }))
                                .child(if allowed { "Allowed" } else { "Blocked" })
                                .on_click(cx.listener(move |this, _event, _window, cx| {
                                    this.settings.mcp.toggle(&name);
                                    this.save_settings();
                                    cx.notify();
                                })),
                        ),
                );
            }
            if chunk.len() == 1 {
                row = row.child(div().flex_1());
            }
            tools = tools.child(row);
        }

        let mut clients = div().flex().flex_col().gap(px(8.0));
        if pane.clients.is_empty() {
            clients = clients.child(widgets::note(
                "No agent is connected. Paste the snippet above into a client to connect one.",
            ));
        }
        for client in &pane.clients {
            clients = clients.child(client_row(client));
        }

        div()
            .flex()
            .flex_col()
            .gap(px(10.0))
            .mt(px(6.0))
            .child(self.mcp_server_card(&pane, cx))
            .child(widgets::section("ADD BAY TO A CLIENT"))
            .child(self.client_tabs(&pane, cx))
            .child(
                widgets::card()
                    .bg(rgb(theme::LANE))
                    .child(
                        widgets::row()
                            .items_start()
                            .gap(px(10.0))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w(px(0.0))
                                    .font_family("ui-monospace")
                                    .text_xs()
                                    .text_color(rgb(theme::ACCENT_SOFT))
                                    .child(text(pane.snippet.clone())),
                            )
                            // The snippet is a command with a 64-character token in it. Drawn as
                            // text and nothing else, the only way to run it was to read it off
                            // the screen — which is what someone actually did, via a screenshot.
                            .child(self.button("copy-snippet", "Copy", false, cx, {
                                let snippet = pane.snippet.clone();
                                move |this, cx| {
                                    this.copy_to_clipboard("snippet", snippet.clone(), cx);
                                }
                            })),
                    )
                    .child(
                        div()
                            .mt(px(8.0))
                            .child(widgets::note(pane.client_hint.clone())),
                    ),
            )
            // Named profiles, above the 101 checkboxes they exist to replace. The gating they
            // drive is `McpSettings::blocked`, which `bay --mcp` already enforces with no window
            // open — this is the missing *default*, not new machinery. A client that carries the
            // whole schema list on every request pays for narration tools whether it narrates or
            // not, and the dialogue profile measures at 52 KB against the full 116 KB.
            .child(self.mcp_profiles(cx))
            .child(
                widgets::row()
                    .child(widgets::section("TOOLS EXPOSED"))
                    .child(div().flex_1())
                    .child(
                        div()
                            .w(px(180.0))
                            .px(px(8.0))
                            .py(px(4.0))
                            .rounded(px(5.0))
                            .bg(rgb(theme::LANE))
                            .border_1()
                            .border_color(rgb(theme::BORDER))
                            .text_xs()
                            .text_color(rgb(if self.tool_filter.showing_placeholder() {
                                theme::MUTED
                            } else {
                                theme::TEXT
                            }))
                            .child(text(self.tool_filter.display())),
                    )
                    .child(widgets::note(format!(
                        "{} of {}",
                        matching.len(),
                        pane.tools.len()
                    ))),
            )
            .child(tools)
            .children((hidden > 0).then(|| {
                widgets::note(format!(
                    "{hidden} more match — type to narrow the list. Every tool not shown keeps \
                     whatever state it already has."
                ))
            }))
            .child(widgets::section("CONNECTED CLIENTS"))
            .child(clients)
    }

    /// The profile row: one press instead of a hundred and one.
    ///
    /// No profile is shown as "current". A profile is an *action* that sets the blocked list, not
    /// a stored mode — keeping a name beside the list would be a second answer to "which tools
    /// are exposed", and the two would disagree the first time someone ticked a box afterwards.
    fn mcp_profiles(&self, cx: &mut Context<Self>) -> Div {
        let mut row = widgets::row()
            .gap(px(6.0))
            .child(widgets::section("PRESETS"));
        for profile in bay_settings::mcp::PROFILES {
            row = row.child(self.button(profile.id, profile.label, false, cx, {
                move |this, cx| {
                    let names = bay_mcp_tool_names();
                    this.settings.mcp.apply_profile(&profile, &names);
                    this.save_settings();
                    let exposed = names.len() - this.settings.mcp.blocked.len();
                    this.settings_complaint = Some(format!(
                        "{} preset: {exposed} of {} tools exposed. {}",
                        profile.label,
                        names.len(),
                        profile.detail
                    ));
                    cx.notify();
                }
            }));
        }
        row
    }

    fn mcp_server_card(&self, pane: &settings_model::McpPane, cx: &mut Context<Self>) -> Div {
        widgets::card_edged(if pane.running {
            theme::BORDER
        } else {
            theme::BORDER_SOFT
        })
        .child(
            widgets::row()
                .child(widgets::dot(pane.dot))
                .child(
                    div()
                        .flex_1()
                        .min_w(px(0.0))
                        .flex()
                        .flex_col()
                        .child(div().text_color(rgb(theme::TEXT)).child("bay MCP server"))
                        .child(
                            div()
                                .text_xs()
                                .text_color(rgb(theme::MUTED))
                                .child(text(pane.status_line.clone())),
                        ),
                )
                .child(
                    div()
                        .id("mcp-toggle")
                        .px(px(10.0))
                        .py(px(4.0))
                        .rounded(px(5.0))
                        .bg(rgb(if pane.running {
                            theme::SELECTED
                        } else {
                            theme::ACCENT
                        }))
                        .text_xs()
                        .text_color(rgb(if pane.running {
                            theme::TEXT
                        } else {
                            theme::ON_ACCENT
                        }))
                        .child(text(pane.toggle_label.clone()))
                        .on_click(cx.listener(|this, _event, _window, cx| {
                            this.settings.mcp.enabled = !this.settings.mcp.enabled;
                            this.save_settings();
                            cx.notify();
                        })),
                ),
        )
        .child(
            widgets::row()
                .mt(px(11.0))
                .gap(px(6.0))
                .child(widgets::readout(pane.endpoint.clone(), false))
                // The readout abbreviates the token on purpose — it is the line that ends up in
                // a screenshot of this screen. That makes a way to copy the full one necessary
                // rather than convenient.
                .child(self.button("copy-token", "Copy token", false, cx, {
                    let token = pane.token.clone();
                    move |this, cx| {
                        this.copy_to_clipboard("token", token.clone(), cx);
                    }
                }))
                .child(
                    self.button("rotate-token", "Rotate token", false, cx, |this, _cx| {
                        this.rotate_token();
                    }),
                ),
        )
    }

    fn client_tabs(&self, pane: &settings_model::McpPane, cx: &mut Context<Self>) -> Div {
        let mut tabs = div().flex().flex_row().gap(px(2.0));
        for (index, (id, label, on)) in pane.client_tabs.iter().enumerate() {
            let id = id.clone();
            let on = *on;
            tabs = tabs.child(
                div()
                    .id(("mcp-client", index))
                    .px(px(10.0))
                    .py(px(4.0))
                    .rounded(px(5.0))
                    .bg(rgb(if on {
                        theme::SELECTED
                    } else {
                        theme::PANEL_ALT
                    }))
                    .text_xs()
                    .text_color(rgb(if on { theme::TEXT } else { theme::MUTED }))
                    .child(text(label.clone()))
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.settings.mcp.client = id.clone();
                        this.save_settings();
                        cx.notify();
                    })),
            );
        }
        tabs
    }

    // ---- Compute -------------------------------------------------------------------------

    /// The Captions pane.
    ///
    /// The preview strip is the point of this pane. A band position is a number between 0 and 1
    /// and means nothing on its own; what the user needs to see is where the line lands relative
    /// to the part of the frame Instagram is going to cover, which is why the reserved band and
    /// the caption line are drawn together against one frame.
    fn captions_pane(&self, snapshot: &SettingsSnapshot, cx: &mut Context<Self>) -> Div {
        let pane = settings_model::captions_pane(snapshot);

        // A 9:16 frame, small enough to sit beside the controls.
        let preview_height = 190.0;
        let mut frame = div()
            .relative()
            .w(px(preview_height * 9.0 / 16.0))
            .h(px(preview_height))
            .flex_none()
            .rounded(px(6.0))
            .bg(rgb(theme::LANE))
            .border_1()
            .border_color(rgb(theme::BORDER_SOFT))
            .overflow_hidden();

        if pane.reserved_bottom > 0.0 {
            frame = frame.child(
                div()
                    .absolute()
                    .left_0()
                    .right_0()
                    .bottom_0()
                    .h(gpui::relative(pane.reserved_bottom))
                    .bg(rgb(theme::PANEL))
                    .border_t_1()
                    .border_color(rgb(theme::WARN)),
            );
        }
        // Where captions will actually land.
        frame = frame.child(
            div()
                .absolute()
                .left(px(8.0))
                .right(px(8.0))
                .top(gpui::relative(pane.resolved_top.clamp(0.0, 0.98)))
                .h(px(3.0))
                .rounded(px(2.0))
                .bg(rgb(theme::ACCENT)),
        );
        // And where it was asked to go, when the safe area moved it.
        if pane.clamped {
            frame = frame.child(
                div()
                    .absolute()
                    .left(px(8.0))
                    .right(px(8.0))
                    .top(gpui::relative(pane.band_top.clamp(0.0, 0.98)))
                    .h(px(1.0))
                    .bg(rgb(theme::FAINT)),
            );
        }

        let position_label = if pane.follows_kit {
            "Following the style kit".to_string()
        } else {
            format!("{}% down the frame", (pane.band_top * 100.0).round())
        };

        let controls = div()
            .flex_1()
            .min_w(px(0.0))
            .flex()
            .flex_col()
            .gap(px(10.0))
            .child(widgets::section("BAND POSITION"))
            .child(
                widgets::row()
                    .child(
                        widgets::pressable(
                            widgets::ButtonKind::Normal,
                            div().id("caption-band-up").child("↑").on_click(cx.listener(
                                |this, _event, _window, cx| {
                                    this.nudge_caption_band(-0.01);
                                    cx.notify();
                                },
                            )),
                        )
                        .px(px(10.0))
                        .py(px(4.0)),
                    )
                    .child(
                        widgets::pressable(
                            widgets::ButtonKind::Normal,
                            div()
                                .id("caption-band-down")
                                .child("↓")
                                .on_click(cx.listener(|this, _event, _window, cx| {
                                    this.nudge_caption_band(0.01);
                                    cx.notify();
                                })),
                        )
                        .px(px(10.0))
                        .py(px(4.0)),
                    )
                    .child(
                        div()
                            .flex_1()
                            .text_xs()
                            .text_color(rgb(theme::TEXT))
                            .child(text(position_label)),
                    )
                    .child(
                        widgets::pressable(
                            widgets::ButtonKind::Normal,
                            div()
                                .id("caption-band-reset")
                                .child("Use the kit")
                                .on_click(cx.listener(|this, _event, _window, cx| {
                                    this.reset_caption_band();
                                    cx.notify();
                                })),
                        )
                        .px(px(10.0))
                        .py(px(4.0)),
                    ),
            );

        let mut areas = div().flex().flex_col().gap(px(6.0));
        for (index, area) in pane.safe_areas.iter().enumerate() {
            let id = area.id;
            areas = areas.child(
                div()
                    .id(("caption-safe-area", index))
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap(px(8.0))
                    .px(px(10.0))
                    .py(px(7.0))
                    .rounded(px(6.0))
                    .bg(rgb(theme::PANEL))
                    .border_1()
                    .border_color(rgb(if area.selected {
                        theme::ACCENT
                    } else {
                        theme::BORDER_SOFT
                    }))
                    .child(
                        div()
                            .w(px(10.0))
                            .h(px(10.0))
                            .rounded_full()
                            .flex_none()
                            .bg(rgb(if area.selected {
                                theme::ACCENT
                            } else {
                                theme::DIM_DOT
                            })),
                    )
                    .child(
                        div()
                            .flex_1()
                            .text_xs()
                            .text_color(rgb(theme::TEXT))
                            .child(area.label),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(theme::MUTED))
                            .child(text(area.reserves.clone())),
                    )
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.choose_caption_safe_area(match id {
                            "instagram-reels" => bay_settings::captions::SafeArea::InstagramReels,
                            "tiktok" => bay_settings::captions::SafeArea::TikTok,
                            "youtube-shorts" => bay_settings::captions::SafeArea::YouTubeShorts,
                            _ => bay_settings::captions::SafeArea::None,
                        });
                        cx.notify();
                    })),
            );
        }

        let mut aligns = widgets::row();
        for (index, align) in pane.aligns.iter().enumerate() {
            let id = align.id;
            aligns = aligns.child(
                div()
                    .id(("caption-align", index))
                    .px(px(10.0))
                    .py(px(5.0))
                    .rounded(px(6.0))
                    .bg(rgb(theme::PANEL))
                    .border_1()
                    .border_color(rgb(if align.selected {
                        theme::ACCENT
                    } else {
                        theme::BORDER_SOFT
                    }))
                    .text_xs()
                    .text_color(rgb(if align.selected {
                        theme::TEXT
                    } else {
                        theme::MUTED
                    }))
                    .child(align.label)
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.choose_caption_align(match id {
                            "center" => bay_settings::captions::CaptionAlign::Center,
                            "right" => bay_settings::captions::CaptionAlign::Right,
                            _ => bay_settings::captions::CaptionAlign::Left,
                        });
                        cx.notify();
                    })),
            );
        }

        let mut body = div()
            .flex()
            .flex_col()
            .gap(px(12.0))
            .child(
                div()
                    .flex()
                    .flex_row()
                    .gap(px(16.0))
                    .child(frame)
                    .child(controls),
            )
            .child(widgets::section("KEEP CLEAR OF"))
            .child(areas)
            .child(widgets::note(pane.note.clone()))
            .child(widgets::section("ALIGNMENT"))
            .child(aligns)
            .child(widgets::note(
                "Alignment and position follow the project's style kit until you choose here. \
                 Click a chosen alignment again to hand it back.",
            ));

        if pane.clamped {
            body = body.child(widgets::banner(
                format!(
                    "Moved up to {}% to clear {}. The faint line is where it was asked to go.",
                    (pane.resolved_top * 100.0).round(),
                    pane.safe_areas
                        .iter()
                        .find(|area| area.selected)
                        .map(|area| area.label)
                        .unwrap_or("the platform"),
                ),
                theme::WARN,
            ));
        }

        body
    }

    fn compute_pane(&self, snapshot: &SettingsSnapshot, cx: &mut Context<Self>) -> Div {
        let pane = settings_model::compute_pane(snapshot);
        let mut options = div().flex().flex_row().gap(px(10.0)).mt(px(6.0));

        for (index, option) in pane.options.iter().enumerate() {
            let cloud = option.id == "cloud";
            let mut chips = div()
                .flex()
                .flex_row()
                .flex_wrap()
                .gap(px(5.0))
                .mt(px(10.0));
            for chip in &option.chips {
                chips = chips.child(widgets::chip(chip.clone()));
            }
            options = options.child(
                div()
                    .id(("compute-option", index))
                    .flex_1()
                    .min_w(px(0.0))
                    .flex()
                    .flex_col()
                    .p(px(14.0))
                    .rounded(px(8.0))
                    .bg(rgb(theme::PANEL))
                    .border_1()
                    .border_color(rgb(if option.selected {
                        theme::ACCENT
                    } else {
                        theme::BORDER_SOFT
                    }))
                    .child(
                        widgets::row()
                            .child(
                                div()
                                    .w(px(12.0))
                                    .h(px(12.0))
                                    .rounded_full()
                                    .flex_none()
                                    .border_1()
                                    .border_color(rgb(if option.selected {
                                        theme::ACCENT
                                    } else {
                                        theme::DIM_DOT
                                    }))
                                    .bg(rgb(if option.selected {
                                        theme::ACCENT
                                    } else {
                                        theme::PANEL
                                    })),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .text_color(rgb(theme::TEXT))
                                    .child(option.name),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(rgb(option.price_color))
                                    .child(text(option.price.clone())),
                            ),
                    )
                    .child(
                        div()
                            .mt(px(8.0))
                            .text_xs()
                            .text_color(rgb(theme::MUTED))
                            .child(text(option.body.clone())),
                    )
                    .child(chips)
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.choose_compute(if cloud {
                            bay_settings::compute::ComputeMode::Cloud
                        } else {
                            bay_settings::compute::ComputeMode::ThisMachine
                        });
                        cx.notify();
                    })),
            );
        }

        let mut body = div()
            .flex()
            .flex_col()
            .gap(px(10.0))
            .child(options)
            .child(widgets::note(pane.note.clone()));

        if !pane.plans.is_empty() {
            let mut plans = div().flex().flex_row().gap(px(10.0));
            for (index, plan) in pane.plans.iter().enumerate() {
                let id = plan.id;
                plans = plans.child(
                    div()
                        .id(("plan", index))
                        .flex_1()
                        .min_w(px(0.0))
                        .flex()
                        .flex_col()
                        .p(px(13.0))
                        .rounded(px(8.0))
                        .bg(rgb(theme::PANEL))
                        .border_1()
                        .border_color(rgb(if plan.current {
                            theme::ACCENT
                        } else {
                            theme::BORDER_SOFT
                        }))
                        .child(
                            widgets::row()
                                .justify_between()
                                .child(
                                    div()
                                        .text_sm()
                                        .text_color(rgb(theme::TEXT))
                                        .child(plan.name),
                                )
                                .child(
                                    div()
                                        .text_xs()
                                        .text_color(rgb(theme::ACCENT_SOFT))
                                        .child(if plan.current { "current" } else { "" }),
                                ),
                        )
                        .child(
                            div()
                                .mt(px(6.0))
                                .text_lg()
                                .text_color(rgb(theme::TEXT))
                                .child(plan.price),
                        )
                        .child(div().mt(px(4.0)).child(widgets::note(plan.detail)))
                        .on_click(cx.listener(move |this, _event, _window, cx| {
                            this.choose_plan(id);
                            cx.notify();
                        })),
                );
            }
            body = body.child(widgets::section("CLOUD PLAN")).child(plans);
        }
        body
    }
}

fn client_row(client: &ClientSnapshot) -> Div {
    widgets::card()
        .flex_row()
        .items_center()
        .gap(px(10.0))
        .px(px(12.0))
        .py(px(10.0))
        .child(widgets::dot(if client.live {
            theme::OK
        } else {
            theme::DIM_DOT
        }))
        .child(
            div()
                .flex_1()
                .min_w(px(0.0))
                .text_sm()
                .text_color(rgb(theme::TEXT))
                .child(text(client.name.clone())),
        )
        .child(widgets::note(client.detail.clone()))
}

/// Who is serving agents right now, from the same registry `bay --agents` reads.
///
/// Not "who has ever connected": bay keeps no log of clients, and inventing "Cursor · last seen
/// yesterday" would be a history nobody recorded. What it can honestly show is what is live.
fn connected_clients() -> Vec<ClientSnapshot> {
    bay_agent::registry::live()
        .into_iter()
        .map(|instance| ClientSnapshot {
            name: match instance.kind {
                bay_agent::registry::Kind::Editor => "This editor window".to_string(),
                bay_agent::registry::Kind::Headless => "Headless bay --mcp".to_string(),
            },
            detail: format!("pid {} · port {}", instance.pid, instance.port),
            live: true,
        })
        .collect()
}

/// Every tool name bay implements.
///
/// The UI crate cannot depend on `bay-mcp` — that is the dependency cycle the workspace
/// forbids, since the server reaches back into the window. So the names come from `bay-agent`,
/// which both sides already share. `bay-mcp`'s `tool_vocabulary` test asserts the two lists
/// agree in both directions, so a tool added to the server without a switch here fails the
/// suite rather than shipping as a permission control with a hole in it.
fn bay_mcp_tool_names() -> Vec<String> {
    bay_agent::all_tool_names()
        .into_iter()
        .map(str::to_string)
        .collect()
}
