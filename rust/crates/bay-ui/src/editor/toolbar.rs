//! The top chrome: the toolbar row, the scene bar, and the two exports its buttons run.
//!
//! A child module of [`super`], so it can reach `EditorView`'s private fields; a sibling
//! could not.

use super::*;

impl EditorView {
    /// Render the composited frame at the playhead at full canvas resolution and save it as a PNG.
    pub(super) fn export_frame(&mut self) {
        if self.preview.is_none() {
            return;
        }
        let canvas = self.editor.project().settings.canvas;
        let playhead = self.editor.playhead();
        let background = self.editor.project().settings.background.clone();
        let renderer = self.preview.as_mut().unwrap();
        let scene = self.editor.active_scene();
        let media = self.editor.media();
        let frame = renderer.render(
            scene,
            playhead,
            canvas.width,
            canvas.height,
            &background,
            media,
        );

        let Some(frame) = frame else {
            self.status = Some("Frame export failed: the GPU could not render a frame".to_string());
            return;
        };
        let mut rgba = frame.bgra;
        for texel in rgba.chunks_exact_mut(4) {
            texel.swap(0, 2); // BGRA → RGBA for PNG
        }
        if let Some(buffer) = image::RgbaImage::from_raw(frame.width, frame.height, rgba) {
            let path = export_frame_path();
            self.status = Some(match buffer.save(&path) {
                Ok(()) => format!("Exported frame to {}", path.display()),
                Err(error) => format!("Frame export failed: {error}"),
            });
        }
    }

    /// Encode the whole timeline to an MP4 (via the ffmpeg sidecar), capped at 1280px wide.
    pub(super) fn export_video(&mut self) {
        if self.preview.is_none() {
            return;
        }
        let canvas = self.editor.project().settings.canvas;
        let fps = self.editor.project().settings.fps.as_f64().max(1.0);
        let duration = self.editor.duration().to_seconds_f64().max(0.1);
        let background = self.editor.project().settings.background.clone();

        // Even dimensions (yuv420p), capped for reasonable export time.
        let scale = (1280.0 / canvas.width as f32).min(1.0);
        let width = (((canvas.width as f32 * scale) as u32) / 2) * 2;
        let height = (((canvas.height as f32 * scale) as u32) / 2) * 2;

        let renderer = self.preview.as_mut().unwrap();
        let scene = self.editor.active_scene();
        let media = self.editor.media();
        let out = export_video_path();
        let result = renderer.export_video(
            scene,
            duration,
            fps,
            width.max(2),
            height.max(2),
            &background,
            media,
            &out.to_string_lossy(),
            &bay_preview::ExportSettings::default(),
        );
        self.status = Some(match result {
            Ok(()) => format!("Exported video to {}", out.display()),
            // The old text asked "is ffmpeg installed?" for every failure, including the ones
            // where ffmpeg ran fine and said exactly what was wrong.
            Err(reason) => format!("Video export failed: {reason}"),
        });
    }

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
                    .child(
                        widgets::row()
                            .gap(px(1.0))
                            .child(self.tool_button(
                                "export-frame",
                                "Export Frame",
                                self.preview.is_some(),
                                cx,
                                |this| this.export_frame(),
                            ))
                            .child(
                                div()
                                    .id("export-video")
                                    .h(px(22.0))
                                    .px(px(10.0))
                                    .flex()
                                    .items_center()
                                    .bg(rgb(theme::ACCENT))
                                    .text_xs()
                                    .text_color(rgb(theme::ON_ACCENT))
                                    .child("Export Video")
                                    .on_click(cx.listener(|this, _event, _window, cx| {
                                        this.export_video();
                                        cx.notify();
                                    })),
                            ),
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
