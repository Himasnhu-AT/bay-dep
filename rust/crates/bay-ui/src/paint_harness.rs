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

use gpui::{px, size, Entity, IntoElement, Render, VisualTestContext};

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
