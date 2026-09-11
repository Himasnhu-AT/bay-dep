//! The one place a test drives GPUI's whole render pipeline.
//!
//! Five page test modules each need to lay out, prepaint and paint a view at a given window
//! size, and until now each carried its own byte-identical copy of the call. That was five
//! places to edit every time `VisualTestContext::draw`'s signature moved — and it moves.
//! `bay-ui` is about to change UI libraries, so the copies were consolidated first.
//!
//! Only `paint` is shared. Each module keeps its own `windowed`, because those genuinely
//! differ: every page builds an `EditorView` and then sets a different [`crate::page::Page`].
//!
//! This is not a substitute for looking at the app. It is the part of "looking at it" that can
//! be checked on every run — a canvas that paints outside its phase, a `deferred` popover whose
//! layout is impossible, a path built from a NaN, or an element id that collides all fail here,
//! and none of them are visible to a test that only drives state.

use gpui::{
    px, size, Context, Entity, IntoElement, Render, TestAppContext, VisualTestContext, Window,
};

/// Open a test window, with the component set's globals registered first.
///
/// `gpui_component::init` is what installs the theme, popover, menu, tooltip and notification
/// globals. The real app calls it in `run_with_agent`; a test builds its view straight through
/// `TestAppContext` and never goes near that path, so without this any page that renders a
/// component would fail on a missing global — and it would fail as a panic deep inside the
/// library rather than as anything that names the cause.
///
/// Guarded on the theme global so a test that opens two windows does not re-register.
pub(crate) fn window<V: Render>(
    cx: &mut TestAppContext,
    build: impl FnOnce(&mut Window, &mut Context<V>) -> V,
) -> (Entity<V>, &mut VisualTestContext) {
    cx.update(|cx| {
        if !cx.has_global::<gpui_component::Theme>() {
            gpui_component::init(cx);
        }
    });
    cx.add_window_view(build)
}

/// Resize the window and run one full layout → prepaint → paint pass over `view`.
///
/// Generic over the view so this stays usable when a page is something other than an
/// `EditorView`; today every caller passes `Entity<EditorView>`.
pub(crate) fn paint<V: Render>(
    view: &Entity<V>,
    cx: &mut VisualTestContext,
    width: f32,
    height: f32,
) {
    cx.simulate_resize(size(px(width), px(height)));
    let view = view.clone();
    cx.draw(
        gpui::point(px(0.0), px(0.0)),
        size(px(width), px(height)),
        |_, _| view.into_any_element(),
    );
}
