//! Shared, stateless pieces of chrome.
//!
//! Four screens draw the same card, the same section heading and the same status dot. Without a
//! single definition they drift — the launcher's card gets a 1px border and the settings card
//! keeps a 2px one, and nobody notices until the two are on screen together.
//!
//! Everything here is a plain `Div` with no click handler. Interaction needs a `Context<V>`,
//! which would tie these to one view; the caller wraps what it needs in `.id().on_click()`.

use gpui::prelude::*;
use gpui::{div, px, rgb, Div, SharedString};

use crate::theme;

pub fn text(value: impl Into<String>) -> SharedString {
    SharedString::from(value.into())
}

/// "INSPECTOR", "TOOLS EXPOSED" — a quiet, letter-spaced heading over a group.
pub fn section(label: impl Into<String>) -> Div {
    div()
        .text_xs()
        .text_color(rgb(theme::FAINT))
        .child(text(label))
}

/// The standard panel card: one object on the ground, with a soft edge.
pub fn card() -> Div {
    div()
        .flex()
        .flex_col()
        .p(px(13.0))
        .rounded(px(8.0))
        .bg(rgb(theme::PANEL))
        .border_1()
        .border_color(rgb(theme::BORDER_SOFT))
}

/// [`card`], outlined in a colour that says something — a live server, a selected option.
pub fn card_edged(color: u32) -> Div {
    card().border_color(rgb(color))
}

/// A small status light.
pub fn dot(color: u32) -> Div {
    div()
        .w(px(8.0))
        .h(px(8.0))
        .rounded_full()
        .flex_none()
        .bg(rgb(color))
}

/// A rounded label: a tag, a chip under a compute option, a plan badge.
pub fn chip(label: impl Into<String>) -> Div {
    div()
        .px(px(7.0))
        .py(px(2.0))
        .rounded(px(5.0))
        .bg(rgb(theme::LANE))
        .border_1()
        .border_color(rgb(theme::BORDER))
        .text_xs()
        .text_color(rgb(theme::MUTED))
        .child(text(label))
}

/// A chip that is switched on.
pub fn chip_on(label: impl Into<String>) -> Div {
    div()
        .px(px(7.0))
        .py(px(2.0))
        .rounded(px(5.0))
        .bg(rgb(theme::SELECTED))
        .text_xs()
        .text_color(rgb(theme::TEXT))
        .child(text(label))
}

/// A read-only field: a key hint, an endpoint, a config line. Monospaced, because every value
/// that lands in one is a token or a command and proportional digits make those hard to read.
pub fn readout(value: impl Into<String>, muted: bool) -> Div {
    div()
        .flex_1()
        .min_w(px(0.0))
        .px(px(9.0))
        .py(px(6.0))
        .rounded(px(5.0))
        .bg(rgb(theme::LANE))
        .border_1()
        .border_color(rgb(theme::BORDER))
        .font_family("ui-monospace")
        .text_xs()
        .text_color(rgb(if muted { theme::FAINT } else { theme::TEXT }))
        .overflow_hidden()
        .child(text(value))
}

/// A progress trough with a bar in it.
///
/// `fraction` of `None` draws an empty trough: the venv step has no byte count, and a bar that
/// invents a position there tells the user a download is further along than anyone knows.
pub fn progress(fraction: Option<f32>, color: u32) -> Div {
    let trough = div()
        .h(px(4.0))
        .rounded(px(3.0))
        .bg(rgb(theme::LANE))
        .overflow_hidden();
    match fraction {
        Some(fraction) => trough.child(
            div()
                .h_full()
                .w(gpui::relative(fraction.clamp(0.0, 1.0)))
                .bg(rgb(color)),
        ),
        None => trough,
    }
}

/// A one-line note in the app's quietest voice.
pub fn note(value: impl Into<String>) -> Div {
    div()
        .text_xs()
        .text_color(rgb(theme::FAINT))
        .child(text(value))
}

/// A message the user should read once — a status, a complaint, an explanation.
pub fn banner(message: impl Into<String>, accent: u32) -> Div {
    div()
        .px(px(10.0))
        .py(px(8.0))
        .rounded(px(6.0))
        .bg(rgb(theme::PANEL))
        .border_l_2()
        .border_color(rgb(accent))
        .text_xs()
        .text_color(rgb(theme::TEXT))
        .child(text(message))
}

/// A row that pushes its children apart.
pub fn row() -> Div {
    div().flex().flex_row().items_center().gap(px(8.0))
}

/// The circular avatar. Initials, because bay has no profile pictures and a generic silhouette
/// would imply it is waiting for one.
pub fn avatar(initial: impl Into<String>, size: f32) -> Div {
    div()
        .w(px(size))
        .h(px(size))
        .rounded_full()
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .bg(rgb(theme::SELECTED))
        .text_xs()
        .text_color(rgb(theme::TEXT))
        .child(text(initial))
}
