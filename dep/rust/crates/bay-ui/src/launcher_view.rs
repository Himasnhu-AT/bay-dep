//! The project launcher: a grid of cards, one per project in the library.
//!
//! It used to be a list of rows. A card grid is not decoration — a card has room for the two
//! things a list could not show and a person with twenty projects actually navigates by: what
//! stage the work is at, and the labels they put on it. Both are stored on the project itself
//! (`bay_project::Shelf`), so filing survives copying the file to another machine.
//!
//! An `impl BayApp` block in its own file, because these methods need `Context<BayApp>` for
//! click handlers and the shell is already long enough.

use crate::theme::rgb;
use gpui::prelude::*;
use gpui::{div, px, Context, Div, SharedString};

use bay_core::project::shelf::{ProjectStatus, MAX_TAG_LEN, TAG_SUGGESTIONS};

use crate::app_view::{BayApp, Screen};
use crate::input::TextField;
use crate::theme;
use crate::view_model::{HomeViewModel, ProjectCard};
use crate::widgets::{self, text};

/// Cards per row. Three at the design's 1120px content width; the grid is fixed rather than
/// responsive because GPUI has no CSS grid and a hand-rolled reflow would be a lot of code for
/// a window nobody makes narrower than the timeline needs anyway.
const COLUMNS: usize = 3;

impl BayApp {
    pub(crate) fn launcher(&mut self, cx: &mut Context<Self>) -> Div {
        let vm = HomeViewModel::build(&self.projects, std::time::SystemTime::now());
        let count = vm.count_label();
        let cards: Vec<Div> = vm
            .projects
            .iter()
            .map(|card| self.project_card(card, cx))
            .collect();
        let empty = cards.is_empty();

        div()
            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .bg(rgb(theme::BG))
            .text_color(rgb(theme::TEXT))
            .child(
                div()
                    .id("launcher-scroll")
                    .w(px(1120.0))
                    .max_w_full()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h(px(0.0))
                    .px(px(32.0))
                    .py(px(36.0))
                    .gap(px(16.0))
                    .overflow_y_scroll()
                    .child(self.launcher_header(count, cx))
                    .children(self.library_error.clone().map(|error| {
                        widgets::banner(
                            format!("Project library unavailable: {error}"),
                            theme::DANGER,
                        )
                    }))
                    .children(
                        self.status
                            .clone()
                            .map(|message| widgets::banner(message, theme::ACCENT)),
                    )
                    .children(self.new_project_row(cx))
                    .child(if empty {
                        self.empty_state()
                    } else {
                        grid(cards)
                    }),
            )
    }

    fn launcher_header(&self, count: String, cx: &mut Context<Self>) -> Div {
        widgets::row()
            .justify_between()
            .items_start()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .child(div().text_2xl().text_color(rgb(theme::TEXT)).child("bay"))
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(theme::MUTED))
                            .child(text(count)),
                    ),
            )
            .child(
                widgets::row()
                    .child(self.button("import", "Open File…", false, cx, |this, _cx| {
                        this.import_project()
                    }))
                    .child(self.button("new", "New Project", true, cx, |this, _cx| {
                        this.new_name = Some(TextField::new("Untitled").with_limit(80));
                    }))
                    .child(self.button("settings", "Settings", false, cx, |this, _cx| {
                        this.screen = Screen::Settings;
                    }))
                    .child(
                        div()
                            .id("avatar")
                            .child(widgets::avatar(self.account_initial(), 28.0))
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                this.screen = Screen::Settings;
                                this.settings_pane = crate::settings_model::Pane::Account;
                                cx.notify();
                            })),
                    ),
            )
    }

    /// The inline name field shown after "New Project" — a typed buffer rather than a modal,
    /// because GPUI has no text input and a fake modal with a fake field is worse than a row.
    fn new_project_row(&self, cx: &mut Context<Self>) -> Option<Div> {
        let field = self.new_name.as_ref()?;
        let preset_label = crate::app_view::preset_label(self.new_preset);
        Some(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .p(px(16.0))
                .rounded(px(8.0))
                .bg(rgb(theme::PANEL))
                .border_1()
                .border_color(rgb(theme::ACCENT))
                .child(widgets::section(
                    "NEW PROJECT — type a name, Enter to create, Esc to cancel",
                ))
                .child(
                    widgets::row()
                        .child(
                            div()
                                .flex_1()
                                .px(px(12.0))
                                .py(px(8.0))
                                .rounded(px(6.0))
                                .bg(rgb(theme::LANE))
                                .border_1()
                                .border_color(rgb(theme::BORDER))
                                .text_color(rgb(if field.showing_placeholder() {
                                    theme::MUTED
                                } else {
                                    theme::TEXT
                                }))
                                .child(text(field.display())),
                        )
                        .child(self.button("preset", preset_label, false, cx, |this, _cx| {
                            this.new_preset = crate::app_view::next_preset(this.new_preset);
                        }))
                        .child(self.button("create", "Create", true, cx, |this, cx| {
                            let name = this
                                .new_name
                                .as_ref()
                                .map(|field| field.value().to_string())
                                .unwrap_or_default();
                            this.create_project(&name, cx);
                        })),
                ),
        )
    }

    fn project_card(&self, card: &ProjectCard, cx: &mut Context<Self>) -> Div {
        let id = card.id.clone();
        let confirming = self.pending_delete.as_deref() == Some(card.id.as_str());
        let menu_open = self.menu_for.as_deref() == Some(card.id.as_str());

        div()
            .flex()
            .flex_col()
            .rounded(px(10.0))
            .bg(rgb(theme::PANEL))
            .border_1()
            // `Paint` on both arms: the status colour is a literal from the document and the
            // border is a role, and the `if` has to unify to one type.
            .border_color(rgb(if menu_open {
                card.status_color
            } else {
                theme::Paint::Role(theme::BORDER_SOFT)
            }))
            .overflow_hidden()
            .child(self.card_poster(card, cx))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .gap(px(8.0))
                    .px(px(14.0))
                    .pt(px(12.0))
                    .pb(px(14.0))
                    .child(
                        div()
                            .id(SharedString::from(format!("open-{id}")))
                            .text_lg()
                            .text_color(rgb(theme::TEXT))
                            .overflow_hidden()
                            .child(text(card.name.clone()))
                            .on_click({
                                let id = id.clone();
                                cx.listener(move |this, _event, _window, cx| {
                                    this.open_project(&id, cx);
                                })
                            }),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(theme::MUTED))
                            .child(text(card.detail.clone())),
                    )
                    .child(self.card_chips(card, cx))
                    .children(if menu_open {
                        Some(self.card_menu(card, cx))
                    } else {
                        None
                    })
                    .child(div().flex_1())
                    .child(
                        widgets::row()
                            .justify_between()
                            .pt(px(10.0))
                            .border_t_1()
                            .border_color(rgb(theme::BORDER_SOFT))
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .child(
                                        div()
                                            .text_sm()
                                            .text_color(rgb(theme::TEXT))
                                            .child(text(card.duration.clone())),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(rgb(theme::MUTED))
                                            .child(text(card.modified.clone())),
                                    ),
                            )
                            .child(
                                div()
                                    .id(SharedString::from(format!("delete-{id}")))
                                    .px(px(10.0))
                                    .py(px(4.0))
                                    .rounded(px(6.0))
                                    .bg(rgb(if confirming {
                                        theme::DANGER
                                    } else {
                                        theme::PANEL_ALT
                                    }))
                                    .text_sm()
                                    .text_color(rgb(if confirming {
                                        theme::DANGER_TEXT
                                    } else {
                                        theme::MUTED
                                    }))
                                    .child(if confirming { "Confirm" } else { "Delete" })
                                    .on_click({
                                        let id = id.clone();
                                        cx.listener(move |this, _event, _window, cx| {
                                            this.confirm_or_delete(&id);
                                            cx.notify();
                                        })
                                    }),
                            ),
                    ),
            )
    }

    /// The area a thumbnail would occupy.
    ///
    /// bay caches no poster frame, so it says so rather than filling the space with a coloured
    /// gradient. A gradient there reads as a still from the film — the one thing this rectangle
    /// must not pretend to be when nobody has rendered anything.
    fn card_poster(&self, card: &ProjectCard, cx: &mut Context<Self>) -> gpui::Stateful<Div> {
        let id = card.id.clone();
        div()
            .id(SharedString::from(format!("poster-{id}")))
            .h(px(140.0))
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .bg(rgb(theme::LANE))
            .border_b_1()
            .border_color(rgb(theme::BORDER_SOFT))
            .text_xs()
            .text_color(rgb(theme::FAINT))
            .child(if card.has_poster {
                text(card.duration.clone())
            } else {
                text("no render yet")
            })
            .on_click(cx.listener(move |this, _event, _window, cx| {
                this.open_project(&id, cx);
            }))
    }

    /// The status chip and the project's tags.
    fn card_chips(&self, card: &ProjectCard, cx: &mut Context<Self>) -> Div {
        let id = card.id.clone();
        let mut row = div()
            .flex()
            .flex_row()
            .flex_wrap()
            .gap(px(6.0))
            .items_center()
            .child(
                div()
                    .id(SharedString::from(format!("status-{id}")))
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap(px(6.0))
                    .px(px(8.0))
                    .py(px(2.0))
                    .rounded(px(6.0))
                    .bg(rgb(theme::PANEL_ALT))
                    .border_1()
                    .border_color(rgb(theme::BORDER))
                    .child(widgets::dot(card.status_color))
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(theme::TEXT))
                            .child(text(card.status_label.clone())),
                    )
                    .child(div().text_xs().text_color(rgb(theme::MUTED)).child("▾"))
                    .on_click({
                        let id = id.clone();
                        cx.listener(move |this, _event, _window, cx| {
                            this.menu_for = if this.menu_for.as_deref() == Some(id.as_str()) {
                                None
                            } else {
                                Some(id.clone())
                            };
                            this.tagging = None;
                            cx.notify();
                        })
                    }),
            );

        for (index, tag) in card.tags.iter().enumerate() {
            let (id, tag) = (id.clone(), tag.clone());
            row = row.child(
                div()
                    .id(("card-tag", index))
                    .px(px(8.0))
                    .py(px(2.0))
                    .rounded(px(6.0))
                    .bg(rgb(theme::LANE))
                    .border_1()
                    .border_color(rgb(theme::BORDER))
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(text(format!("{tag} ✕")))
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        let tag = tag.clone();
                        this.file_project(&id, move |shelf| shelf.remove_tag(&tag));
                        cx.notify();
                    })),
            );
        }
        row
    }

    /// The status and tag picker, drawn inline under the chips.
    ///
    /// Inline rather than a floating popover: GPUI 0.2 has no overlay layer that escapes a
    /// scrolling parent, so an absolutely positioned menu is clipped by the card it belongs to.
    /// Pushing the card taller for as long as the menu is open is the honest version.
    fn card_menu(&self, card: &ProjectCard, cx: &mut Context<Self>) -> Div {
        let id = card.id.clone();
        let mut menu = div()
            .flex()
            .flex_col()
            .gap(px(4.0))
            .p(px(8.0))
            .rounded(px(8.0))
            .bg(rgb(theme::LANE))
            .border_1()
            .border_color(rgb(theme::BORDER))
            .child(widgets::section("STATUS"));

        for (index, status) in ProjectStatus::ALL.into_iter().enumerate() {
            let current = card.status == status;
            let id = id.clone();
            menu = menu.child(
                div()
                    .id(("status-option", index))
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap(px(8.0))
                    .px(px(8.0))
                    .py(px(4.0))
                    .rounded(px(5.0))
                    .bg(rgb(if current {
                        theme::PANEL_ALT
                    } else {
                        theme::LANE
                    }))
                    .child(widgets::dot(status.color()))
                    .child(
                        div()
                            .flex_1()
                            .text_xs()
                            .text_color(rgb(theme::TEXT))
                            .child(status.label()),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(theme::ACCENT_SOFT))
                            .child(if current { "✓" } else { "" }),
                    )
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.file_project(&id, |shelf| {
                            let changed = shelf.status != status;
                            shelf.status = status;
                            changed
                        });
                        this.menu_for = None;
                        cx.notify();
                    })),
            );
        }

        menu = menu.child(widgets::section("TAGS"));
        let mut suggestions = div().flex().flex_row().flex_wrap().gap(px(4.0));
        for (index, suggestion) in TAG_SUGGESTIONS.into_iter().enumerate() {
            let on = card.tags.iter().any(|tag| tag == suggestion);
            let id = id.clone();
            suggestions = suggestions.child(
                div()
                    .id(("tag-option", index))
                    .px(px(8.0))
                    .py(px(2.0))
                    .rounded(px(5.0))
                    .bg(rgb(if on {
                        theme::SELECTED
                    } else {
                        theme::PANEL_ALT
                    }))
                    .text_xs()
                    .text_color(rgb(if on { theme::TEXT } else { theme::MUTED }))
                    .child(suggestion)
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.file_project(&id, |shelf| {
                            shelf.toggle_tag(suggestion);
                            true
                        });
                        cx.notify();
                    })),
            );
        }
        menu = menu.child(suggestions);

        match self
            .tagging
            .as_ref()
            .filter(|(project, _)| *project == card.id)
        {
            Some((_, field)) => {
                menu = menu.child(
                    div()
                        .flex()
                        .flex_col()
                        .px(px(8.0))
                        .py(px(6.0))
                        .rounded(px(5.0))
                        .bg(rgb(theme::PANEL))
                        .border_1()
                        .border_color(rgb(theme::ACCENT))
                        .child(
                            div()
                                .text_sm()
                                .text_color(rgb(if field.showing_placeholder() {
                                    theme::MUTED
                                } else {
                                    theme::TEXT
                                }))
                                .child(text(field.display())),
                        )
                        .child(widgets::note("Enter to add · Esc to cancel")),
                );
            }
            None => {
                let id = id.clone();
                menu = menu.child(
                    div()
                        .id("custom-tag")
                        .px(px(10.0))
                        .py(px(4.0))
                        .rounded(px(5.0))
                        .bg(rgb(theme::PANEL_ALT))
                        .text_xs()
                        .text_color(rgb(theme::TEXT))
                        .child("＋ Custom tag…")
                        .on_click(cx.listener(move |this, _event, _window, cx| {
                            this.tagging = Some((
                                id.clone(),
                                TextField::new("Tag name").with_limit(MAX_TAG_LEN),
                            ));
                            cx.notify();
                        })),
                );
            }
        }
        menu
    }

    fn empty_state(&self) -> Div {
        div()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(8.0))
            .py(px(64.0))
            .rounded(px(8.0))
            .border_1()
            .border_color(rgb(theme::BORDER))
            .child(div().text_color(rgb(theme::TEXT)).child("No projects yet"))
            .child(widgets::note(
                "Create one to start editing, or open an existing project file.",
            ))
    }
}

/// Lay cards out in fixed-width rows.
///
/// GPUI has flexbox but no grid, and `flex_wrap` alone leaves the last row's cards stretched to
/// fill the width — three projects and four projects would draw different-sized cards. Chunking
/// into rows of [`COLUMNS`] keeps every card the same size, with the short row padded out by
/// invisible spacers rather than by stretching what is there.
fn grid(cards: Vec<Div>) -> Div {
    let mut grid = div().flex().flex_col().gap(px(16.0));
    let mut cards = cards.into_iter().peekable();
    while cards.peek().is_some() {
        let mut row = div().flex().flex_row().gap(px(16.0));
        let mut filled = 0;
        while filled < COLUMNS {
            let Some(card) = cards.next() else { break };
            row = row.child(div().flex_1().min_w(px(0.0)).flex().child(card));
            filled += 1;
        }
        for _ in filled..COLUMNS {
            row = row.child(div().flex_1().min_w(px(0.0)));
        }
        grid = grid.child(row);
    }
    grid
}
