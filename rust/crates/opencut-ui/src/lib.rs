//! `opencut-ui` — the native GPUI editor shell.
//!
//! Renders `opencut_core::Editor` state and turns user interaction into `Command`s. The pure,
//! testable presentation mapping lives in [`view_model`]; the GPUI views live in
//! [`editor_view`]. [`run`] opens the editor window.

pub mod editor_view;
pub mod theme;
pub mod view_model;

pub use editor_view::{key_bindings, EditorView};
pub use view_model::EditorViewModel;

use gpui::prelude::*;
use gpui::{px, size, App, Application, Bounds, WindowBounds, WindowOptions};
use opencut_core::Editor;

/// Launch the native editor window over the starter project.
pub fn run() {
    Application::new().run(|cx: &mut App| {
        cx.bind_keys(key_bindings());
        let bounds = Bounds::centered(None, size(px(1440.0), px(900.0)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            |_, cx| {
                let focus_handle = cx.focus_handle();
                cx.new(|_| EditorView::new(Editor::starter(), focus_handle))
            },
        )
        .expect("failed to open editor window");
        cx.activate(true);
    });
}
