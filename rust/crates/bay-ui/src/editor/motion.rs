//! The motion page.
//!
//! Stub. The page bar routes here already, so what this draws is what a user sees when they
//! press the motion tab — a placeholder that says so, rather than an empty frame that looks broken.
//!
//! Registered in `mod.rs` ahead of the work so the page bodies can be written in parallel: one
//! agent owns one file and nobody edits the router. See `todo.pages.md`.
//!
//! The contract this must honour is `docs/native/pages.md`. The two rules that bind hardest:
//! a page is a *method* on `EditorView`, never its own GPUI view, and a control the engine
//! cannot back is drawn **disabled** rather than hidden — the disabled controls are the map of
//! the remaining engine work.

use gpui::prelude::*;
use gpui::Div;

use super::EditorView;
use crate::page::Page;

impl EditorView {
    pub(super) fn motion_page(&self, cx: &mut gpui::Context<Self>) -> Div {
        let _ = cx;
        self.placeholder_page(Page::Motion)
    }
}
