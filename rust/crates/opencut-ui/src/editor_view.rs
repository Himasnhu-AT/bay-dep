//! The root GPUI editor view: toolbar, media panel, preview, inspector, and timeline. Owns the
//! `opencut_core::Editor` directly, so an interaction mutates it and calls `cx.notify()` to
//! re-render. All editing goes through `Command`s (undoable); clicks use direct selection.

use gpui::prelude::*;
use gpui::{div, px, rgb, Context, Div, SharedString, Window};

use opencut_core::{
    AudioElement, Command, Editor, Element, ImageElement, MediaTime, TextElement, VideoElement,
};

use crate::theme;
use crate::view_model::{EditorViewModel, TrackRow};

/// Pixels per timeline second.
const PIXELS_PER_SECOND: f32 = 48.0;
const TRACK_LABEL_WIDTH: f32 = 132.0;
const LANE_HEIGHT: f32 = 40.0;
const TICKS_PER_SECOND: i64 = 120_000;
/// Inspector nudge step (0.5s) and minimum element duration (0.1s), in ticks.
const NUDGE_TICKS: i64 = TICKS_PER_SECOND / 2;
const MIN_DURATION_TICKS: i64 = TICKS_PER_SECOND / 10;

pub struct EditorView {
    editor: Editor,
    add_counter: u64,
}

impl EditorView {
    pub fn new(editor: Editor) -> Self {
        Self {
            editor,
            add_counter: 0,
        }
    }

    fn shared(text: impl Into<String>) -> SharedString {
        SharedString::from(text.into())
    }

    fn button(
        &self,
        id: &'static str,
        label: &str,
        enabled: bool,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView, &mut Context<EditorView>) + 'static,
    ) -> gpui::Stateful<Div> {
        let base = div()
            .id(id)
            .px_3()
            .py_1()
            .rounded_md()
            .bg(rgb(theme::PANEL_ALT))
            .text_sm()
            .text_color(rgb(if enabled { theme::TEXT } else { theme::MUTED }))
            .child(Self::shared(label.to_string()));
        if enabled {
            base.on_click(cx.listener(move |this, _event, _window, cx| {
                handler(this, cx);
                cx.notify();
            }))
        } else {
            base
        }
    }

    fn toolbar(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let title = format!("vii — {}", vm.project_name);
        let clipboard = format!("clipboard: {}", vm.clipboard_len);

        div()
            .flex()
            .flex_row()
            .items_center()
            .justify_between()
            .h(px(50.0))
            .px_3()
            .bg(rgb(theme::PANEL))
            .border_b_1()
            .border_color(rgb(theme::BORDER))
            .child(
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap_2()
                    .text_color(rgb(theme::TEXT))
                    .child(Self::shared(title))
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(theme::MUTED))
                            .child(Self::shared(clipboard)),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap_2()
                    .child(self.button("add-text", "+ Text", true, cx, |this, cx| {
                        this.add_counter += 1;
                        let id = format!("text-{}", this.add_counter);
                        let element = Element::Text(TextElement {
                            id,
                            name: "Text".into(),
                            start: MediaTime::ZERO,
                            duration: MediaTime::from_ticks(240_000),
                            content: "New text".into(),
                            font_size: 48.0,
                            color: "#ffffff".into(),
                        });
                        this.editor.execute(Command::AddElement {
                            track_id: "track-main".into(),
                            element,
                            select: true,
                        });
                        let _ = cx;
                    }))
                    .child(self.button("delete", "Delete", vm.selected.is_some(), cx, |this, _cx| {
                        if let Some(reference) = this.editor.selection().first().cloned() {
                            this.editor.execute(Command::RemoveElement { reference });
                        }
                    }))
                    .child(self.button("copy", "Copy", vm.selected.is_some(), cx, |this, _cx| {
                        this.editor.copy();
                    }))
                    .child(self.button("paste", "Paste", vm.clipboard_len > 0, cx, |this, _cx| {
                        this.editor.execute(Command::Paste);
                    }))
                    .child(self.button("undo", "Undo", vm.can_undo, cx, |this, _cx| {
                        this.editor.undo();
                    }))
                    .child(self.button("redo", "Redo", vm.can_redo, cx, |this, _cx| {
                        this.editor.redo();
                    })),
            )
    }

    fn media_panel(&self, cx: &mut Context<Self>) -> Div {
        // (element-id, display name, kind).
        let items: [(&'static str, &'static str, &'static str); 3] = [
            ("media-clip", "Clip.mp4", "video"),
            ("media-logo", "Logo.png", "image"),
            ("media-music", "Music.mp3", "audio"),
        ];

        let mut buttons: Vec<gpui::Stateful<Div>> = Vec::new();
        for (id, name, kind) in items {
            buttons.push(
                div()
                    .id(id)
                    .px_2()
                    .py_1()
                    .rounded_md()
                    .bg(rgb(theme::PANEL_ALT))
                    .text_sm()
                    .text_color(rgb(theme::TEXT))
                    .child(name)
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.add_counter += 1;
                        let uid = this.add_counter;
                        let start = this.editor.playhead();
                        let duration = MediaTime::from_ticks(TICKS_PER_SECOND * 5);
                        let (track_id, element) = match kind {
                            "video" => (
                                "track-main".to_string(),
                                Element::Video(VideoElement {
                                    id: format!("clip-{uid}"),
                                    name: name.into(),
                                    start,
                                    duration,
                                    media_id: id.into(),
                                    trim_start: MediaTime::ZERO,
                                    trim_end: duration,
                                }),
                            ),
                            "image" => (
                                "track-main".to_string(),
                                Element::Image(ImageElement {
                                    id: format!("img-{uid}"),
                                    name: name.into(),
                                    start,
                                    duration,
                                    media_id: id.into(),
                                }),
                            ),
                            _ => (
                                "track-audio".to_string(),
                                Element::Audio(AudioElement {
                                    id: format!("aud-{uid}"),
                                    name: name.into(),
                                    start,
                                    duration,
                                    media_id: id.into(),
                                    muted: false,
                                    volume: 1.0,
                                }),
                            ),
                        };
                        this.editor.execute(Command::AddElement {
                            track_id,
                            element,
                            select: true,
                        });
                        cx.notify();
                    })),
            );
        }

        div()
            .flex()
            .flex_col()
            .w(px(200.0))
            .h_full()
            .p_3()
            .gap_2()
            .bg(rgb(theme::PANEL))
            .border_r_1()
            .border_color(rgb(theme::BORDER))
            .child(div().text_xs().text_color(rgb(theme::MUTED)).child("MEDIA"))
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child("Click to add at playhead"),
            )
            .children(buttons)
    }

    fn preview(&self, vm: &EditorViewModel) -> Div {
        let (width, height) = vm.canvas;
        let fill = vm
            .background_color
            .as_deref()
            .map(theme::hex_to_rgb)
            .unwrap_or(0x202028);

        div()
            .flex()
            .flex_1()
            .flex_col()
            .items_center()
            .justify_center()
            .gap_2()
            .bg(rgb(theme::BG))
            .child(
                div()
                    .w(px(480.0))
                    .h(px(270.0))
                    .rounded_md()
                    .bg(rgb(fill))
                    .border_1()
                    .border_color(rgb(theme::BORDER)),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(format!("{width} × {height}"))),
            )
    }

    fn info_row(&self, label: &str, value: &str) -> Div {
        div()
            .flex()
            .flex_row()
            .justify_between()
            .gap_2()
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(label.to_string())),
            )
            .child(
                div()
                    .text_sm()
                    .text_color(rgb(theme::TEXT))
                    .child(Self::shared(value.to_string())),
            )
    }

    fn mini_button(
        &self,
        id: SharedString,
        label: &str,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView) + 'static,
    ) -> gpui::Stateful<Div> {
        div()
            .id(id)
            .w(px(22.0))
            .flex()
            .items_center()
            .justify_center()
            .rounded_md()
            .bg(rgb(theme::PANEL_ALT))
            .text_sm()
            .text_color(rgb(theme::TEXT))
            .child(Self::shared(label.to_string()))
            .on_click(cx.listener(move |this, _event, _window, cx| {
                handler(this);
                cx.notify();
            }))
    }

    /// A label + value with `−`/`+` steppers that call `handler(this, delta_ticks)`.
    fn nudge_row(
        &self,
        label: &str,
        value: String,
        id_prefix: &'static str,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView, i64) + Clone + 'static,
    ) -> Div {
        let minus = {
            let handler = handler.clone();
            self.mini_button(
                SharedString::from(format!("{id_prefix}-minus")),
                "−",
                cx,
                move |this| handler(this, -NUDGE_TICKS),
            )
        };
        let plus = self.mini_button(
            SharedString::from(format!("{id_prefix}-plus")),
            "+",
            cx,
            move |this| handler(this, NUDGE_TICKS),
        );
        div()
            .flex()
            .flex_row()
            .items_center()
            .justify_between()
            .gap_2()
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(label.to_string())),
            )
            .child(
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap_1()
                    .child(minus)
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(theme::TEXT))
                            .child(Self::shared(value)),
                    )
                    .child(plus),
            )
    }

    fn inspector(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let panel = div()
            .flex()
            .flex_col()
            .w(px(260.0))
            .h_full()
            .p_3()
            .gap_3()
            .bg(rgb(theme::PANEL))
            .border_l_1()
            .border_color(rgb(theme::BORDER))
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child("INSPECTOR"),
            );

        let Some(selected) = &vm.selected else {
            return panel.child(
                div()
                    .text_sm()
                    .text_color(rgb(theme::MUTED))
                    .child("Select a clip to inspect it."),
            );
        };

        let start_ref = selected.reference.clone();
        let duration_ref = selected.reference.clone();

        let mut body = div()
            .flex()
            .flex_col()
            .gap_2()
            .child(self.info_row("Name", &selected.name))
            .child(self.info_row("Kind", &selected.kind_label))
            .child(self.nudge_row(
                "Start",
                format!("{:.2}s", selected.start_seconds),
                "start",
                cx,
                move |this, delta| {
                    let current = this
                        .editor
                        .active_scene()
                        .element(&start_ref)
                        .map(|element| element.start().as_ticks());
                    if let Some(ticks) = current {
                        this.editor.execute(Command::MoveElement {
                            reference: start_ref.clone(),
                            start: MediaTime::from_ticks((ticks + delta).max(0)),
                        });
                    }
                },
            ))
            .child(self.nudge_row(
                "Duration",
                format!("{:.2}s", selected.duration_seconds),
                "duration",
                cx,
                move |this, delta| {
                    let current = this
                        .editor
                        .active_scene()
                        .element(&duration_ref)
                        .map(|element| element.duration().as_ticks());
                    if let Some(ticks) = current {
                        this.editor.execute(Command::SetElementDuration {
                            reference: duration_ref.clone(),
                            duration: MediaTime::from_ticks(
                                (ticks + delta).max(MIN_DURATION_TICKS),
                            ),
                        });
                    }
                },
            ));

        if let Some(content) = &selected.text_content {
            body = body.child(self.info_row("Text", content));
        }

        panel.child(body)
    }

    fn transport_button(
        &self,
        id: &'static str,
        label: &str,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView) + 'static,
    ) -> gpui::Stateful<Div> {
        div()
            .id(id)
            .px_2()
            .py_1()
            .rounded_md()
            .bg(rgb(theme::PANEL_ALT))
            .text_xs()
            .text_color(rgb(theme::TEXT))
            .child(Self::shared(label.to_string()))
            .on_click(cx.listener(move |this, _event, _window, cx| {
                handler(this);
                cx.notify();
            }))
    }

    fn timeline(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let mut rows: Vec<Div> = Vec::new();
        let mut block_index: usize = 0;
        for track in &vm.tracks {
            rows.push(self.track_row(track, vm.playhead_seconds, &mut block_index, cx));
        }

        let readout = format!("{:.2}s / {:.2}s", vm.playhead_seconds, vm.duration_seconds);
        let transport = div()
            .flex()
            .flex_row()
            .items_center()
            .gap_2()
            .child(self.transport_button("seek-start", "|◀", cx, |this| {
                this.editor.seek(MediaTime::ZERO)
            }))
            .child(self.transport_button("seek-back", "◀ 1s", cx, |this| {
                let ticks = this.editor.playhead().as_ticks();
                this.editor.seek(MediaTime::from_ticks(ticks - TICKS_PER_SECOND));
            }))
            .child(self.transport_button("seek-fwd", "1s ▶", cx, |this| {
                let ticks = this.editor.playhead().as_ticks();
                this.editor.seek(MediaTime::from_ticks(ticks + TICKS_PER_SECOND));
            }))
            .child(self.transport_button("seek-end", "▶|", cx, |this| {
                this.editor.seek(this.editor.duration())
            }))
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(readout)),
            );

        div()
            .flex()
            .flex_col()
            .h(px(250.0))
            .p_2()
            .gap_1()
            .bg(rgb(theme::PANEL))
            .border_t_1()
            .border_color(rgb(theme::BORDER))
            .child(transport)
            .children(rows)
    }

    fn track_row(
        &self,
        track: &TrackRow,
        playhead_seconds: f64,
        block_index: &mut usize,
        cx: &mut Context<Self>,
    ) -> Div {
        let mut blocks: Vec<gpui::Stateful<Div>> = Vec::new();
        for block in &track.elements {
            let id = *block_index;
            *block_index += 1;
            let reference = block.reference.clone();
            let left = block.start_seconds as f32 * PIXELS_PER_SECOND;
            let width = (block.duration_seconds as f32 * PIXELS_PER_SECOND).max(24.0);
            let fill = theme::element_color(&block.kind_label);

            let mut element = div()
                .id(id)
                .absolute()
                .left(px(left))
                .top(px(4.0))
                .h(px(LANE_HEIGHT - 8.0))
                .w(px(width))
                .px_2()
                .rounded_md()
                .bg(rgb(fill))
                .text_xs()
                .text_color(rgb(theme::TEXT))
                .overflow_hidden()
                .child(Self::shared(block.label.clone()))
                .on_click(cx.listener(move |this, _event, _window, cx| {
                    this.editor.select(vec![reference.clone()]);
                    cx.notify();
                }));
            if block.selected {
                element = element.border_1().border_color(rgb(theme::SELECTED_BORDER));
            }
            blocks.push(element);
        }

        div()
            .flex()
            .flex_row()
            .items_center()
            .gap_2()
            .h(px(LANE_HEIGHT + 6.0))
            .child(
                div()
                    .w(px(TRACK_LABEL_WIDTH))
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(format!("{} · {}", track.name, track.kind_label))),
            )
            .child(
                div()
                    .relative()
                    .flex_1()
                    .h(px(LANE_HEIGHT))
                    .rounded_md()
                    .bg(rgb(theme::LANE))
                    .overflow_hidden()
                    .children(blocks)
                    .child(
                        // Playhead line across this lane.
                        div()
                            .absolute()
                            .left(px(playhead_seconds as f32 * PIXELS_PER_SECOND))
                            .top(px(0.0))
                            .w(px(2.0))
                            .h(px(LANE_HEIGHT))
                            .bg(rgb(theme::ACCENT)),
                    ),
            )
    }
}

impl Render for EditorView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let vm = EditorViewModel::build(&self.editor);

        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(rgb(theme::BG))
            .text_color(rgb(theme::TEXT))
            .child(self.toolbar(&vm, cx))
            .child(
                div()
                    .flex()
                    .flex_row()
                    .flex_1()
                    .min_h(px(0.0))
                    .child(self.media_panel(cx))
                    .child(self.preview(&vm))
                    .child(self.inspector(&vm, cx)),
            )
            .child(self.timeline(&vm, cx))
    }
}
