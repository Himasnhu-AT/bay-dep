//! `bay-ui` — the native GPUI editor shell.
//!
//! Renders `bay_core::Editor` state and turns user interaction into `Command`s. The pure,
//! testable presentation mapping lives in [`view_model`]; the GPUI views live in
//! [`editor`]. [`run`] opens the editor window.

pub mod app_view;
pub mod controls;
pub mod drag;
pub mod draw;
pub mod editor;
pub mod geometry;
pub mod input;
pub mod lab;
pub mod launcher_view;
pub mod login_view;
pub mod page;
/// The shared `VisualTestContext::draw` call the five page test modules used to duplicate.
#[cfg(test)]
pub(crate) mod paint_harness;
pub mod settings_model;
pub mod settings_view;
pub mod theme;
pub mod view_model;
pub mod widgets;

pub use app_view::BayApp;
pub use editor::{key_bindings, EditorView};
pub use menus::menus;
pub use view_model::{EditorViewModel, HomeViewModel};

mod menus;

use gpui::prelude::*;
use gpui::{px, size, App, Application, Bounds, WindowBounds, WindowOptions};

/// Launch the app: a window on the project library, from which a project opens into the editor.
pub fn run() {
    run_with_agent(None, None, None)
}

/// Launch the app, optionally draining agent tool calls from `pump`.
///
/// The pump is handed in rather than created here so `rust/desktop` owns the wiring: `bay-ui`
/// must not depend on `bay-mcp`, or the dependency graph gains a cycle the moment the server
/// wants to read editor state.
/// `agent_note` explains why agent edits are unavailable, when they are. It reaches the window
/// because stderr does not: someone who double-clicked the app never sees a terminal, and a
/// window whose agent tools silently do nothing is indistinguishable from a broken one.
pub fn run_with_agent(
    pump: Option<bay_agent::AgentPump>,
    agent_port: Option<u16>,
    agent_note: Option<String>,
) {
    // Build the GPU compositor preview up front (None if no adapter → layout-rect fallback).
    let preview = bay_preview::PreviewRenderer::new();

    Application::new().run(move |cx: &mut App| {
        cx.bind_keys(key_bindings());
        cx.bind_keys(menus::key_bindings());
        // The menu bar has to exist before the window: GPUI only calls AppKit's `setMainMenu:`
        // from here, and without it there is no Cmd+Q, no Cmd+W, no Services and no OS Edit
        // menu — which is exactly the "doesn't feel like a Mac app" this fixes.
        menus::register_actions(cx);
        cx.set_menus(menus::menus());
        menus::quit_when_last_window_closes(cx);
        let bounds = Bounds::centered(None, size(px(1440.0), px(900.0)), cx);
        let window = cx
            .open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    ..Default::default()
                },
                move |_, cx| {
                    let focus_handle = cx.focus_handle();
                    cx.new(|cx| {
                        BayApp::new(focus_handle, preview, pump, agent_port, agent_note, cx)
                    })
                },
            )
            .expect("failed to open editor window");

        // Cmd+Q does not route through the "‹ Projects" button, which was the only path that
        // saved. Without this, the menu bar this commit adds would introduce a way to lose work
        // that did not exist before it.
        cx.on_app_quit(move |cx| {
            let _ = window.update(cx, |app, _, cx| app.save_before_quit(cx));
            async move {}
        })
        .detach();

        cx.activate(true);
    });
}
