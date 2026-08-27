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

use std::cell::RefCell;
use std::rc::Rc;

use gpui::prelude::*;
use gpui::{px, size, App, Application, Bounds, WindowBounds, WindowOptions};

/// Launch the app: a window on the project library, from which a project opens into the editor.
pub fn run() {
    run_with_agent(None, None, None)
}

/// bay's palette, in the component set's own theme format.
///
/// Every colour in it is one of `theme.rs`'s tokens, mapped onto the field the library reads for
/// the same job — so a `gpui_component::Button` and a `widgets::button_face` beside it are the
/// same grey rather than two greys that happen to be close.
///
/// The one mapping worth stating out loud: bay's `ACCENT` is `primary.background`, **not**
/// `accent.background`. In this library's vocabulary — shadcn's — `accent` is the *hover
/// surface*, a neutral. Mapping bay's blue onto it would turn every hover state in the app blue.
const BAY_DARK_THEME: &str = include_str!("../themes/bay-dark.json");

/// Parse [`BAY_DARK_THEME`] into the config the component set applies.
///
/// Separate from [`install_theme`] so a test can prove the file parses without opening a window.
/// It is `include_str!`'d, so a typo is a compile-time constant that fails at *runtime*, and the
/// failure mode is the quietest kind there is: the library keeps its own default palette and the
/// app merely looks wrong.
fn bay_dark_theme() -> Result<gpui_component::ThemeConfig, String> {
    let set: gpui_component::ThemeSet =
        serde_json::from_str(BAY_DARK_THEME).map_err(|error| error.to_string())?;
    set.themes
        .into_iter()
        .next()
        .ok_or_else(|| "the theme file declares no themes".to_string())
}

/// Make bay's palette the active theme.
fn install_theme(cx: &mut App) {
    match bay_dark_theme() {
        Ok(config) => {
            let config = Rc::new(config);
            let theme = gpui_component::Theme::global_mut(cx);
            theme.dark_theme = config.clone();
            theme.mode = gpui_component::ThemeMode::Dark;
            theme.apply_config(&config);
        }
        // A malformed theme must not stop the editor opening; the library's default stays.
        Err(error) => {
            eprintln!("bay: could not load the bundled theme ({error}); using the default")
        }
    }
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

    // `with_assets` is not optional. `gpui-component`'s icons are referenced by path
    // ("icons/chevron-down.svg") and resolved through the app's `AssetSource`; the default
    // source answers `Ok(None)` to everything, so without this every glyph in the component set
    // is simply absent and nothing says so.
    Application::new()
        .with_assets(gpui_component_assets::Assets)
        .run(move |cx: &mut App| {
            // Registers the component set's own globals — theme, root, popover, menu, table,
            // tooltip, notification and the rest. It must run before any of them is constructed.
            gpui_component::init(cx);
            install_theme(cx);
            cx.bind_keys(key_bindings());
            cx.bind_keys(menus::key_bindings());
            // The menu bar has to exist before the window: GPUI only calls AppKit's `setMainMenu:`
            // from here, and without it there is no Cmd+Q, no Cmd+W, no Services and no OS Edit
            // menu — which is exactly the "doesn't feel like a Mac app" this fixes.
            menus::register_actions(cx);
            cx.set_menus(menus::menus());
            menus::quit_when_last_window_closes(cx);
            let bounds = Bounds::centered(None, size(px(1440.0), px(900.0)), cx);
            // The window's root view is `gpui_component::Root`, with `BayApp` inside it. That is
            // a requirement of the component set, not a preference: `Root` is what hosts the
            // tooltip, dialog, sheet and notification overlays, and without it those simply do
            // not render — a tooltip would be dropped on the floor with nothing to say so.
            //
            // `BayApp`'s own handle is carried back out through `app_slot`, because the quit hook
            // below needs the *editor*, not the root. Reading it off the `WindowHandle` would now
            // hand back a `Root`.
            let app_slot: Rc<RefCell<Option<gpui::Entity<BayApp>>>> = Rc::new(RefCell::new(None));
            let slot = app_slot.clone();
            cx.open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    ..Default::default()
                },
                move |window, cx| {
                    let focus_handle = cx.focus_handle();
                    let app = cx.new(|cx| {
                        BayApp::new(focus_handle, preview, pump, agent_port, agent_note, cx)
                    });
                    *slot.borrow_mut() = Some(app.clone());
                    cx.new(|cx| gpui_component::Root::new(app, window, cx))
                },
            )
            .expect("failed to open editor window");
            let app = app_slot
                .borrow_mut()
                .take()
                .expect("the window builder always fills the slot");

            // Cmd+Q does not route through the "‹ Projects" button, which was the only path that
            // saved. Without this, the menu bar this commit adds would introduce a way to lose work
            // that did not exist before it.
            cx.on_app_quit(move |cx| {
                app.update(cx, |app, cx| app.save_before_quit(cx));
                async move {}
            })
            .detach();

            cx.activate(true);
        });
}

#[cfg(test)]
mod theme_file_tests {
    use super::*;

    /// The hex a token is written as in `themes/bay-dark.json`.
    fn hex(token: u32) -> String {
        format!("#{token:06x}")
    }

    /// A parse failure here is silent in production: [`install_theme`] logs to stderr and the
    /// library's own palette stays. Someone who double-clicked the app sees no terminal, so
    /// without this test the only symptom of a broken theme is "the colours look wrong".
    #[test]
    fn the_bundled_theme_parses() {
        let config = bay_dark_theme().expect("themes/bay-dark.json should parse");
        assert_eq!(config.name.as_ref(), "bay Dark");
        assert!(config.is_default);
        assert!(matches!(config.mode, gpui_component::ThemeMode::Dark));
    }

    /// The theme file and `theme.rs` must agree, or a library widget and bay's own chrome sitting
    /// beside it are two different greys — which is exactly the inconsistency adopting the
    /// library was meant to remove. Asserted per role rather than wholesale, so a failure names
    /// the token that drifted.
    #[test]
    fn the_theme_file_says_what_theme_rs_says() {
        let c = bay_dark_theme().expect("parses").colors;
        for (role, token, actual) in [
            ("background", theme::BG, c.background),
            ("foreground", theme::TEXT, c.foreground),
            ("border", theme::BORDER, c.border),
            ("muted.foreground", theme::MUTED, c.muted_foreground),
            ("muted.background", theme::PANEL_ALT, c.muted),
            ("primary.background", theme::ACCENT, c.primary),
            ("primary.foreground", theme::ON_ACCENT, c.primary_foreground),
            ("ring", theme::FOCUS_RING, c.ring),
            ("sidebar.background", theme::PANEL, c.sidebar),
            ("sidebar.border", theme::BORDER_SOFT, c.sidebar_border),
            ("list.background", theme::LANE, c.list),
            ("list.active.background", theme::SELECTED, c.list_active),
            (
                "list.active.border",
                theme::SELECTED_BORDER,
                c.list_active_border,
            ),
            ("list.hover.background", theme::HOVER, c.list_hover),
            ("danger.background", theme::DANGER, c.danger),
            ("danger.foreground", theme::DANGER_TEXT, c.danger_foreground),
            ("success.background", theme::OK, c.success),
            ("warning.background", theme::WARN, c.warning),
        ] {
            assert_eq!(
                actual.map(|value| value.to_string()),
                Some(hex(token)),
                "{role} should be theme::{role}'s hex"
            );
        }
    }

    /// The one mapping that produces a wrong-looking app rather than an error.
    ///
    /// In this library's vocabulary `accent` is the *hover surface* — a neutral — and `primary`
    /// is the primary-action colour. bay's `ACCENT` is a blue primary action. Wiring it to
    /// `accent.background` compiles, parses, and turns every hover state in all six pages blue.
    #[test]
    fn accent_is_the_hover_surface_not_bays_blue() {
        let c = bay_dark_theme().expect("parses").colors;
        assert_eq!(
            c.accent.clone().map(|v| v.to_string()),
            Some(hex(theme::HOVER)),
            "accent.background is the neutral hover surface, so it takes theme::HOVER"
        );
        assert_eq!(
            c.primary.clone().map(|v| v.to_string()),
            Some(hex(theme::ACCENT)),
            "theme::ACCENT is a primary action, so it belongs in primary.background"
        );
        assert_ne!(
            c.accent.map(|v| v.to_string()),
            c.primary.map(|v| v.to_string()),
            "if these are ever equal the two roles have been collapsed"
        );
    }
}
