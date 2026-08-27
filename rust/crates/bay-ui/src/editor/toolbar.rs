//! The top chrome: the toolbar row and the scene bar.
//!
//! A child module of [`super`], so it can reach `EditorView`'s private fields; a sibling
//! could not.
//!
//! **It used to run two exports, and both are gone.** `export_frame` and `export_video` lived
//! here and were called straight from their buttons, on the main thread. The video one was
//! `fixes.md` entry 6: it reached neither `render_gate` nor `frame_check`, capped the result at
//! 1280px wide without saying so, and froze the window for the length of the encode. Both are
//! now the Deliver page's, queued through `bay_agent::slow::run` — the same call an agent
//! makes, so one gate covers both callers. `editor::deliver::tests::
//! no_ui_call_site_encodes_for_itself` is what keeps them from coming back here.

use super::*;

impl EditorView {
    /// Whether an agent has touched the project recently enough to still be worth showing.
    pub(super) fn agent_chip(&self) -> Option<String> {
        self.agent_activity
            .as_ref()
            .filter(|(_, at)| at.elapsed() < Self::AGENT_CHIP)
            .map(|(label, _)| format!("● Claude · {label}"))
    }

    pub(super) fn toolbar(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let scene_line = format!(
            "{} · {:.2}s · {}",
            self.editor.active_scene().name,
            vm.duration_seconds,
            vm.tracks
                .iter()
                .map(|track| track.elements.len())
                .sum::<usize>()
        );

        widgets::row()
            .h(px(52.0))
            .flex_none()
            .justify_between()
            .gap(px(16.0))
            .px(px(12.0))
            .bg(rgb(theme::PANEL))
            .border_b_1()
            .border_color(rgb(theme::BORDER))
            .overflow_hidden()
            .child(
                widgets::row()
                    .min_w(px(0.0))
                    // Leaving saves first: an editor that drops work on the way out teaches
                    // people never to use the back button.
                    .child(
                        self.button("projects", "‹ Projects", false, cx, |this, cx| match this
                            .save_project()
                        {
                            Ok(_) => cx.emit(EditorViewEvent::CloseRequested),
                            Err(error) => {
                                this.status = Some(format!("Not closing — save failed: {error}"))
                            }
                        }),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .min_w(px(0.0))
                            .child(
                                div()
                                    .text_color(rgb(theme::TEXT))
                                    .overflow_hidden()
                                    .child(Self::shared(vm.project_name.clone())),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(rgb(theme::MUTED))
                                    .overflow_hidden()
                                    .child(Self::shared(format!("{scene_line} clips"))),
                            ),
                    )
                    .children(self.agent_chip().map(|label| {
                        div()
                            .px_2()
                            .py(px(2.0))
                            .rounded(px(6.0))
                            .bg(rgb(theme::SELECTED))
                            .border_1()
                            .border_color(rgb(theme::SELECTED_BORDER))
                            .text_xs()
                            .text_color(rgb(theme::TEXT))
                            .child(label)
                    }))
                    // Status line: the one place failures become visible to the user.
                    .children(self.status.clone().map(|message| {
                        let bad = message.contains("fail")
                            || message.contains("error")
                            || message.contains("Not closing");
                        div()
                            .id("status")
                            .max_w(px(360.0))
                            .px(px(8.0))
                            .py(px(3.0))
                            .rounded(px(6.0))
                            .bg(rgb(theme::PANEL_ALT))
                            .border_l_2()
                            .border_color(rgb(if bad { theme::DANGER } else { theme::ACCENT }))
                            .text_xs()
                            .text_color(rgb(theme::TEXT))
                            .overflow_hidden()
                            .child(Self::shared(message))
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                this.status = None; // click to dismiss
                                cx.notify();
                            }))
                    })),
            )
            .child(
                widgets::row()
                    .flex_none()
                    .gap(px(10.0))
                    .child(
                        widgets::row()
                            .gap(px(1.0))
                            .child(self.tool_button("undo", "Undo", vm.can_undo, cx, |this| {
                                this.editor.undo();
                            }))
                            .child(self.tool_button("redo", "Redo", vm.can_redo, cx, |this| {
                                this.editor.redo();
                            }))
                            .child(self.tool_button(
                                "copy",
                                "Copy",
                                vm.selected.is_some(),
                                cx,
                                |this| {
                                    this.editor.copy();
                                },
                            ))
                            .child(self.tool_button(
                                "paste",
                                "Paste",
                                vm.clipboard_len > 0,
                                cx,
                                |this| {
                                    this.editor.execute(Command::Paste);
                                },
                            )),
                    )
                    .child(self.button("save", "Save", false, cx, |this, _cx| {
                        this.status = Some(match this.save_project() {
                            Ok(path) => format!("Saved to {}", path.display()),
                            Err(error) => format!("Save failed: {error}"),
                        });
                    }))
                    // Where Export Frame and Export Video used to be. Output is the Deliver
                    // page's, and it is one button rather than two because there is one way to
                    // encode now — see this module's own header.
                    .child(
                        self.button("go-deliver", "Deliver ⇧", true, cx, |this, _cx| {
                            this.show_page(crate::page::Page::Deliver);
                        }),
                    ),
            )
    }

    /// The strip between the panels and the timeline: scenes on the left, what the machine is
    /// missing and what the project is on the right.
    pub(super) fn scene_bar(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let mut tabs: Vec<gpui::Stateful<Div>> = Vec::new();
        for (index, scene) in vm.scenes.iter().enumerate() {
            let id = scene.id.clone();
            let active = scene.active;
            let count = self
                .editor
                .scenes()
                .iter()
                .find(|candidate| candidate.id == scene.id)
                .map(|scene| scene.tracks.iter().map(|t| t.elements.len()).sum::<usize>())
                .unwrap_or(0);
            tabs.push(
                div()
                    .id(("scene", index))
                    .flex()
                    .flex_row()
                    .items_baseline()
                    .gap(px(6.0))
                    .px(px(10.0))
                    .py(px(3.0))
                    .rounded(px(6.0))
                    .bg(rgb(if active {
                        theme::SELECTED
                    } else {
                        theme::PANEL_ALT
                    }))
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(if active { theme::TEXT } else { theme::MUTED }))
                            .child(Self::shared(scene.name.clone())),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(if active {
                                theme::ACCENT_SOFT
                            } else {
                                theme::FAINT
                            }))
                            .child(Self::shared(if count == 0 {
                                "empty".to_string()
                            } else {
                                format!("{count} clips")
                            })),
                    )
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.editor.switch_scene(id.clone());
                        cx.notify();
                    })),
            );
        }

        let meta = format!(
            "{} × {} · {} tracks",
            vm.canvas.0,
            vm.canvas.1,
            vm.tracks.len()
        );

        widgets::row()
            .h(px(40.0))
            .flex_none()
            .justify_between()
            .gap(px(12.0))
            .px(px(12.0))
            .bg(rgb(theme::PANEL_ALT))
            .border_t_1()
            .border_color(rgb(theme::BORDER))
            .child(
                widgets::row()
                    .gap(px(6.0))
                    .min_w(px(0.0))
                    .overflow_hidden()
                    .child(widgets::section("SCENES"))
                    .children(tabs)
                    .child(self.transport_button("add-scene", "＋ Scene", cx, |this| {
                        this.add_counter += 1;
                        let id = format!("scene-{}", this.add_counter);
                        let name = format!("Scene {}", this.editor.scenes().len() + 1);
                        this.editor.execute(Command::AddScene {
                            id: id.clone(),
                            name,
                        });
                        this.editor.switch_scene(id);
                    })),
            )
            .child(
                widgets::row()
                    .flex_none()
                    .gap(px(12.0))
                    // Offers to install what is missing. Present only when something is, and
                    // hidden while an install runs — the status line carries the progress, and
                    // a second press would be a second 1.2 GB download.
                    .children(
                        self.runtime_offers
                            .iter()
                            .filter(|_| self.provision_job.is_none())
                            .map(|offer| {
                                let component = offer.id.clone();
                                // A distinct element id per offer. On a clean machine both
                                // video and speech are offered at once, and two sibling
                                // stateful elements sharing one id share interactive state.
                                self.button(
                                    offer.element_id,
                                    &offer.label,
                                    false,
                                    cx,
                                    move |this, cx| this.install_runtime(&component, cx),
                                )
                            }),
                    )
                    .child(widgets::note(format!("clipboard: {}", vm.clipboard_len)))
                    .child(widgets::note(meta)),
            )
    }
}
