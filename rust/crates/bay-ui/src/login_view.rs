//! The sign-in screen.
//!
//! It exists because the design has one, and because a place to connect an account is a real
//! product decision worth keeping on screen. It is *not* a door: bay opens on the launcher and
//! every project is editable without ever visiting this screen. A local editor that will not
//! open a local file until a server says so is precisely the thin client the manifesto rules
//! out.
//!
//! Pressing the button calls the real [`bay_settings::account::AccountService`]. This build has
//! no service, so what comes back is a refusal that says so, and the screen prints it. The
//! alternative — a short sleep and a hardcoded name — would put an identity in the title bar
//! that nothing granted.

use gpui::prelude::*;
use gpui::{div, px, rgb, Context, Div};

use crate::app_view::{BayApp, Screen};
use crate::theme;
use crate::widgets::{self, text};

impl BayApp {
    pub(crate) fn sign_in_screen(&mut self, cx: &mut Context<Self>) -> Div {
        let waiting = self.sign_in_note.is_some();

        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .bg(rgb(theme::BG))
            .text_color(rgb(theme::TEXT))
            .child(
                div()
                    .w(px(380.0))
                    .flex()
                    .flex_col()
                    .gap(px(4.0))
                    .child(div().text_2xl().text_color(rgb(theme::TEXT)).child("bay"))
                    .child(widgets::note(
                        "Connect an account. You do not need one to edit.",
                    ))
                    .child(
                        div()
                            .id("sign-in")
                            .mt(px(22.0))
                            .px(px(12.0))
                            .py(px(10.0))
                            .rounded(px(6.0))
                            .bg(rgb(if waiting {
                                theme::PANEL_ALT
                            } else {
                                theme::ACCENT
                            }))
                            .text_color(rgb(if waiting {
                                theme::MUTED
                            } else {
                                theme::ON_ACCENT
                            }))
                            .text_center()
                            .child("Sign in")
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                this.begin_sign_in();
                                cx.notify();
                            })),
                    )
                    .children(
                        self.sign_in_note.clone().map(|note| {
                            div().mt(px(12.0)).child(widgets::banner(note, theme::WARN))
                        }),
                    )
                    .child(
                        div()
                            .id("continue-offline")
                            .mt(px(10.0))
                            .px(px(12.0))
                            .py(px(10.0))
                            .rounded(px(6.0))
                            .bg(rgb(theme::PANEL_ALT))
                            .text_color(rgb(theme::TEXT))
                            .text_center()
                            .child("Continue to your projects")
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                this.screen = Screen::Launcher;
                                this.sign_in_note = None;
                                cx.notify();
                            })),
                    )
                    .child(div().mt(px(20.0)).child(widgets::note(text(
                        "bay stores your projects on this Mac and sends nothing anywhere. \
                                 An account would only be for services that run elsewhere.",
                    )))),
            )
    }
}
