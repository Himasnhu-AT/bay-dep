//! `vii-ui` — the native GPUI editor shell.
//!
//! Renders `vii_core::Editor` state and turns user interaction into `Command`s. The pure,
//! testable presentation mapping lives in [`view_model`]; the GPUI views live in
//! [`editor_view`]. [`run`] opens the editor window.

pub mod app_view;
pub mod editor_view;
pub mod geometry;
pub mod theme;
pub mod view_model;

pub use app_view::ViiApp;
pub use editor_view::{key_bindings, EditorView};
pub use view_model::{EditorViewModel, HomeViewModel};

use gpui::prelude::*;
use gpui::{px, size, App, Application, Bounds, WindowBounds, WindowOptions};

/// Launch the app: a window on the project library, from which a project opens into the editor.
pub fn run() {
    run_with_agent(None)
}

/// Launch the app, optionally draining agent tool calls from `pump`.
///
/// The pump is handed in rather than created here so `rust/desktop` owns the wiring: `vii-ui`
/// must not depend on `vii-mcp`, or the dependency graph gains a cycle the moment the server
/// wants to read editor state.
pub fn run_with_agent(pump: Option<vii_agent::AgentPump>) {
    // Build the GPU compositor preview up front (None if no adapter → layout-rect fallback).
    let preview = vii_preview::PreviewRenderer::new();

    Application::new().run(move |cx: &mut App| {
        cx.bind_keys(key_bindings());
        let bounds = Bounds::centered(None, size(px(1440.0), px(900.0)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            move |_, cx| {
                let focus_handle = cx.focus_handle();
                cx.new(|cx| ViiApp::new(focus_handle, preview, pump, cx))
            },
        )
        .expect("failed to open editor window");
        cx.activate(true);
    });
}
