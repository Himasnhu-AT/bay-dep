//! The Deliver page: render settings, range, and the render queue.
//!
//! A child module of [`super`], so it can reach `EditorView`'s private fields; a sibling could
//! not.
//!
//! # The one thing this page is for
//!
//! `pages.md` gives every page a thing it must not become, and Deliver's is *"a second, ungated
//! output path beside the toolbar's Export."* That was not a hypothetical when this was
//! written — it was `fixes.md` entry 6, and it was the toolbar's own Export button:
//!
//! | | `render` over MCP | the old Export Video button |
//! |---|---|---|
//! | `render_gate` | yes | **no** |
//! | `frame_check` | yes | **no** |
//! | resolution | the project's canvas | **capped at 1280px wide** |
//! | thread | a worker with its own GPU device | **the UI thread, frozen for the encode** |
//!
//! So this page does not encode. It builds arguments for the same `render` tool an agent calls
//! ([`bay_agent::deliver::DeliverSettings::render_args`]) and hands them to the same
//! [`bay_agent::slow::run`] on a background thread. `render_gate` and `frame_check` are reached
//! because that function reaches them, not because this file remembered to — which is the only
//! version of "both paths run the same gate" that survives the next person editing one of them.
//! `deliver::no_ui_call_site_encodes_for_itself` is what stops the old shape growing back.
//!
//! # Why a second GPU device rather than the editor's
//!
//! `bay-agent`'s render arm already answers this: *"The worker gets its own GPU device. It
//! cannot borrow the editor's — that one belongs to the main thread, and a second adapter is
//! what makes rendering concurrent with editing rather than instead of it."* Taking
//! `self.preview` for the duration would be cheaper in GPU memory and would darken the preview
//! for minutes; more to the point it would have been a *third* way to encode, and this page
//! exists to remove the second.

use std::path::PathBuf;
use std::time::Duration;

use bay_agent::deliver::{QueuedRender, Range};
use bay_preview::{ExportPreset, VideoCodec};

use super::*;
use crate::controls::{DragNumber, Select, SelectOption, Slider};

/// The settings column, in place of the browser column every other page puts here.
const SETTINGS_WIDTH: f32 = 320.0;

/// The two bands under the transport.
///
/// **They sum to 340, and that number is not free.** `pages.md` calls the transport band the
/// horizon line of the app: it must land at the same distance from the window top on every page
/// that has one. On the Cut page the transport is followed by the scene bar (40px) and the
/// timeline (300px), so anything under Deliver's transport has to come to the same total or the
/// horizon moves when you change page.
///
/// Those two are literals in `toolbar.rs` and `timeline.rs` rather than shared constants, so
/// [`the_bands_under_the_transport_hold_the_horizon_line`] can only guard this end of the
/// equality. Lifting all four into one place belongs with whoever owns `editor/mod.rs`.
const RANGE_BAND: f32 = 100.0;
const QUEUE_BAND: f32 = 240.0;

/// Cut's scene bar (40) plus its timeline (300). Read only by the test below, which is the
/// whole point of writing it down.
#[cfg(test)]
const CUT_BANDS_BELOW_TRANSPORT: f32 = 340.0;

/// The reduced transport's height, matching `transport()`'s own.
const TRANSPORT_HEIGHT: f32 = 54.0;

/// How often the window redraws while a render is running.
///
/// The queue's numbers live in a registry a worker thread writes and this view reads, so
/// something has to ask for a repaint while they change. 250ms: fast enough that the bar reads
/// as live, slow enough not to spend the main thread on a job that is not on it.
const QUEUE_REFRESH: Duration = Duration::from_millis(250);

/// Where renders are written. Somewhere the user will actually find them, not the working
/// directory — which for a double-clicked app is anyone's guess.
fn output_directory() -> PathBuf {
    bay_paths::output_dir().unwrap_or_else(std::env::temp_dir)
}

/// The presets the picker offers, in the order it offers them.
const PRESETS: [ExportPreset; 3] = [
    ExportPreset::Social,
    ExportPreset::Youtube,
    ExportPreset::Master,
];

fn preset_label(preset: ExportPreset) -> &'static str {
    match preset {
        ExportPreset::Social => "Social",
        ExportPreset::Youtube => "YouTube",
        ExportPreset::Master => "Master",
    }
}

fn preset_detail(preset: ExportPreset) -> &'static str {
    match preset {
        ExportPreset::Social => "Reels, TikTok, Shorts — H.264, CRF 20, −14 LUFS",
        ExportPreset::Youtube => "A little more bitrate; the second encode is the platform's",
        ExportPreset::Master => "ProRes 4444, no loudness processing — hand this to an editor",
    }
}

const CODECS: [VideoCodec; 3] = [VideoCodec::H264, VideoCodec::Hevc, VideoCodec::ProRes];

fn codec_label(codec: VideoCodec) -> &'static str {
    match codec {
        VideoCodec::H264 => "H.264",
        VideoCodec::Hevc => "HEVC",
        VideoCodec::ProRes => "ProRes 4444",
    }
}

fn codec_detail(codec: VideoCodec) -> &'static str {
    match codec {
        VideoCodec::H264 => "Plays everywhere. The right answer unless there is a reason.",
        VideoCodec::Hevc => "Half the size; not every player takes it.",
        VideoCodec::ProRes => "Huge, no generation loss. Writes a .mov.",
    }
}

impl EditorView {
    // ------------------------------------------------------------------------------------
    // The page
    // ------------------------------------------------------------------------------------

    pub(super) fn deliver_page(&self, cx: &mut gpui::Context<Self>) -> Div {
        // Built here rather than taken from the router, which hands one only to the Cut page.
        // A second walk of the scene per frame on one page; cheap next to the composite the
        // preview above it is already doing.
        let vm = EditorViewModel::build(&self.editor);

        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h(px(0.0))
            .child(self.toolbar(&vm, cx))
            .child(
                div()
                    .flex()
                    .flex_row()
                    .flex_1()
                    .min_h(px(0.0))
                    .child(self.deliver_settings(cx))
                    .child(
                        // Preview and transport are one column here for the same reason they are
                        // on Cut: the transport belongs under the picture it drives.
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w(px(0.0))
                            .child(self.preview(&vm))
                            .child(self.deliver_transport(&vm, cx)),
                    ),
            )
            .child(self.deliver_range(&vm, cx))
            .child(self.deliver_queue(cx))
    }

    // ------------------------------------------------------------------------------------
    // Settings
    // ------------------------------------------------------------------------------------

    fn deliver_settings(&self, cx: &mut Context<Self>) -> Div {
        let form = &self.deliver;
        let preset_index = form
            .preset
            .and_then(|preset| PRESETS.iter().position(|candidate| *candidate == preset));
        let codec_index = CODECS.iter().position(|candidate| *candidate == form.codec);

        let mut column = div()
            .w(px(SETTINGS_WIDTH))
            .flex_none()
            .flex()
            .flex_col()
            .gap(px(14.0))
            .p(px(14.0))
            .bg(rgb(theme::PANEL))
            .border_r_1()
            .border_color(rgb(theme::BORDER))
            .overflow_hidden()
            .child(widgets::section("Render settings"))
            .child(
                self.deliver_field(
                    "Preset",
                    Select::new(
                        "deliver-preset",
                        PRESETS
                            .iter()
                            .map(|preset| {
                                SelectOption::new(preset_label(*preset))
                                    .detail(preset_detail(*preset))
                            })
                            .collect(),
                    )
                    .selected(preset_index)
                    // A preset is a starting point, never a lock — so once a field below has
                    // been touched by hand the picker shows nothing rather than claiming a
                    // preset whose values are no longer on screen.
                    .placeholder("Custom")
                    .width(180.0)
                    .render(self, cx, |view, index, _cx| {
                        if let Some(preset) = PRESETS.get(index) {
                            view.deliver.apply_preset(*preset);
                        }
                    }),
                ),
            )
            .child(
                self.deliver_field(
                    "Codec",
                    Select::new(
                        "deliver-codec",
                        CODECS
                            .iter()
                            .map(|codec| {
                                SelectOption::new(codec_label(*codec)).detail(codec_detail(*codec))
                            })
                            .collect(),
                    )
                    .selected(codec_index)
                    .width(180.0)
                    .render(self, cx, |view, index, _cx| {
                        if let Some(codec) = CODECS.get(index) {
                            view.deliver.customise(|form| form.codec = *codec);
                        }
                    }),
                ),
            );

        // The disabled control on this page, and the reason `pages.md` says draw it rather than
        // hide it: ProRes is quality-fixed by its profile, so a live CRF slider over it would
        // move and change nothing about the file.
        let quality_live = form.quality_applies();
        column = column
            .child(
                self.deliver_field(
                    "Quality",
                    Slider::new(
                        "deliver-quality",
                        form.quality as f32,
                        bay_agent::deliver::MIN_QUALITY as f32,
                        bay_agent::deliver::MAX_QUALITY as f32,
                    )
                    .step(1.0)
                    .width(140.0)
                    .enabled(quality_live)
                    .render(self, cx, |view, value, _cx| {
                        view.deliver
                            .customise(|form| form.quality = value.round() as u32);
                    }),
                )
                .child(widgets::readout(
                    if quality_live {
                        format!("CRF {}", form.quality)
                    } else {
                        "fixed".to_string()
                    },
                    !quality_live,
                )),
            )
            .children((!quality_live).then(|| {
                widgets::note(
                    "ProRes is quality-fixed by its profile — bay writes 4444 at yuv444p10le. \
                     The CRF is ignored, so it is shown disabled rather than hidden.",
                )
            }));

        let loudness_on = form.loudness_lufs.is_some();
        column = column
            .child(
                self.deliver_field(
                    "Loudness",
                    self.deliver_toggle(
                        "deliver-loudness",
                        if loudness_on {
                            "Normalise"
                        } else {
                            "Leave as mixed"
                        },
                        loudness_on,
                        cx,
                        move |view| {
                            view.deliver.customise(|form| {
                                form.loudness_lufs = if loudness_on { None } else { Some(-14.0) };
                            });
                        },
                    )
                    .into_any_element(),
                )
                .child(
                    DragNumber::new(
                        "deliver-lufs",
                        form.loudness_lufs.unwrap_or(-14.0) as f32,
                        -40.0,
                        0.0,
                        0.1,
                    )
                    .step(0.5)
                    .width(72.0)
                    .enabled(loudness_on)
                    .format(|value| format!("{value:.1} LUFS"))
                    .render(self, cx, |view, value, _cx| {
                        view.deliver
                            .customise(|form| form.loudness_lufs = Some(f64::from(value)));
                    }),
                ),
            )
            .child(
                self.deliver_field(
                    "Audio",
                    DragNumber::new(
                        "deliver-audio-kbps",
                        form.audio_bitrate_kbps as f32,
                        bay_agent::deliver::MIN_AUDIO_KBPS as f32,
                        bay_agent::deliver::MAX_AUDIO_KBPS as f32,
                        1.0,
                    )
                    .step(16.0)
                    .width(96.0)
                    .format(|value| format!("{} kbps", value.round() as u32))
                    .render(self, cx, |view, value, _cx| {
                        view.deliver
                            .customise(|form| form.audio_bitrate_kbps = value.round() as u32);
                    }),
                ),
            );

        let canvas = self.editor.project().settings.canvas;
        column
            .child(
                widgets::card()
                    .flex()
                    .flex_col()
                    .gap(px(4.0))
                    .child(
                        widgets::row().justify_between().gap(px(8.0)).child(
                            div()
                                .text_xs()
                                .text_color(rgb(theme::MUTED))
                                .child("Writes"),
                        ),
                    )
                    .child(widgets::readout(form.file_name(), false))
                    // The resolution line, because the button this replaced quietly capped the
                    // export at 1280px wide and said nothing. It renders the canvas now, and
                    // the canvas is what it says.
                    .child(widgets::note(format!(
                        "{}×{} · {} · {}",
                        canvas.width,
                        canvas.height,
                        self.editor.project().settings.fps.as_f64(),
                        output_directory().display()
                    ))),
            )
            .child(div().flex_1())
            .children(self.deliver_alpha_note())
            .child(self.deliver_render_button(cx))
    }

    /// One labelled row of the settings form.
    fn deliver_field(&self, label: &str, control: gpui::AnyElement) -> Div {
        widgets::row()
            .justify_between()
            .gap(px(10.0))
            .child(
                div()
                    .flex_none()
                    .w(px(64.0))
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(label.to_string())),
            )
            .child(control)
    }

    /// A two-state button. Not a `Select`, because two options do not need a list.
    fn deliver_toggle(
        &self,
        id: &'static str,
        label: &str,
        on: bool,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView) + 'static,
    ) -> gpui::Stateful<Div> {
        widgets::pressable(
            widgets::ButtonKind::Normal,
            widgets::button_face(widgets::ButtonKind::Normal, true)
                .id(id)
                .h(px(24.0))
                .px(px(10.0))
                .flex()
                .items_center()
                .rounded(px(5.0))
                .text_xs()
                .text_color(rgb(if on { theme::TEXT } else { theme::MUTED }))
                .bg(rgb(if on {
                    theme::SELECTED
                } else {
                    theme::PANEL_ALT
                }))
                .child(Self::shared(label.to_string())),
        )
        .cursor_pointer()
        .on_click(cx.listener(move |this, _event, _window, cx| {
            handler(this);
            cx.notify();
        }))
    }

    /// Why there is no transparent-background option, stated where someone would look for one.
    ///
    /// Not a disabled control, because there is nothing behind it to enable: `bay_project::
    /// Background` has only `Color` and `Blur`, so a transparent canvas cannot be authored in
    /// the first place. A greyed-out "keep alpha" checkbox would imply the model has an alpha
    /// this build declines to write, and it does not have one.
    fn deliver_alpha_note(&self) -> Option<Div> {
        Some(widgets::note(
            "No export carries alpha: H.264 and HEVC are yuv420p, ProRes is yuv444p10le. \
             A transparent background cannot be authored either, so nothing is lost.",
        ))
    }

    fn deliver_render_button(&self, cx: &mut Context<Self>) -> Div {
        let timeline = self.editor.duration().to_seconds_f64();
        let refusal = self.deliver.refusal(timeline);
        let enabled = refusal.is_none();
        let length = self
            .deliver
            .range
            .seconds(timeline)
            .map(|seconds| format!("Render {seconds:.1}s"))
            .unwrap_or_else(|| "Render".to_string());

        div()
            .flex()
            .flex_col()
            .gap(px(6.0))
            .children(refusal.map(|reason| widgets::banner(reason, theme::WARN)))
            .child(
                widgets::pressable(
                    widgets::ButtonKind::Normal,
                    widgets::button_face(widgets::ButtonKind::Normal, enabled)
                        .id("deliver-render")
                        .h(px(30.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(px(6.0))
                        .text_sm()
                        .bg(rgb(if enabled {
                            theme::ACCENT
                        } else {
                            theme::DISABLED
                        }))
                        .text_color(rgb(if enabled {
                            theme::ON_ACCENT
                        } else {
                            theme::DISABLED_TEXT
                        }))
                        .child(Self::shared(length)),
                )
                .cursor_pointer()
                .on_click(cx.listener(|this, _event, _window, cx| {
                    this.queue_render(cx);
                    cx.notify();
                })),
            )
    }

    // ------------------------------------------------------------------------------------
    // Transport and range
    // ------------------------------------------------------------------------------------

    /// The Cut page's transport minus its zoom cluster.
    ///
    /// Same height, so the horizon line does not move. The zoom buttons are gone because this
    /// page's timeline is the whole film scaled to the band below — there is no zoom for them
    /// to change, and three buttons that do nothing is the failure this page is named after.
    fn deliver_transport(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        widgets::row()
            .h(px(TRANSPORT_HEIGHT))
            .flex_none()
            .justify_center()
            .gap(px(14.0))
            .px(px(16.0))
            .bg(rgb(theme::PANEL))
            .border_t_1()
            .border_color(rgb(theme::BORDER))
            .child(
                widgets::row()
                    .gap(px(2.0))
                    .child(self.transport_button("deliver-start", "|◀", cx, |this| {
                        this.editor.seek(MediaTime::ZERO)
                    }))
                    .child(self.transport_button("deliver-back", "◀◀", cx, |this| {
                        let ticks = this.editor.playhead().as_ticks();
                        this.editor
                            .seek(MediaTime::from_ticks(ticks - TICKS_PER_SECOND));
                    })),
            )
            .child(
                div()
                    .id("deliver-play")
                    .w(px(44.0))
                    .h(px(32.0))
                    .rounded(px(6.0))
                    .bg(rgb(theme::ACCENT))
                    .text_color(rgb(theme::ON_ACCENT))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(if self.playing { "❚❚" } else { "▶" })
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        this.toggle_play();
                        cx.notify();
                    })),
            )
            .child(
                widgets::row()
                    .gap(px(2.0))
                    .child(self.transport_button("deliver-fwd", "▶▶", cx, |this| {
                        let ticks = this.editor.playhead().as_ticks();
                        this.editor
                            .seek(MediaTime::from_ticks(ticks + TICKS_PER_SECOND));
                    }))
                    .child(self.transport_button("deliver-end", "▶|", cx, |this| {
                        this.editor.seek(this.editor.duration())
                    })),
            )
            .child(
                widgets::row()
                    .gap(px(6.0))
                    .ml(px(6.0))
                    .child(
                        div()
                            .font_family("ui-monospace")
                            .text_color(rgb(theme::TEXT))
                            .child(shared_text(timecode(vm.playhead_seconds))),
                    )
                    .child(
                        div()
                            .font_family("ui-monospace")
                            .text_xs()
                            .text_color(rgb(theme::FAINT))
                            .child(shared_text(format!("/ {}", timecode(vm.duration_seconds)))),
                    ),
            )
    }

    /// The reduced timeline: the whole film as one strip, with the in and out points on it.
    ///
    /// Whole-film rather than zoomable on purpose. A range is a statement about the film, and
    /// the question it answers — "which part of this am I sending?" — is one you want to see
    /// all of at once. That is also why the strip is laid out in *fractions* of its own width
    /// rather than in pixels: nothing here needs to know how wide the window is.
    fn deliver_range(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let duration = vm.duration_seconds.max(f64::MIN_POSITIVE);
        let range = self.deliver.range;
        let start = range.start().clamp(0.0, duration);
        let end = range.end().unwrap_or(duration).clamp(0.0, duration);
        let fraction = |seconds: f64| (seconds / duration).clamp(0.0, 1.0) as f32;
        let playhead = self.editor.playhead().to_seconds_f64();
        let ranged = matches!(range, Range::InOut { .. });

        let strip = div()
            .relative()
            .h(px(28.0))
            .bg(rgb(theme::LANE))
            .rounded(px(4.0))
            .overflow_hidden()
            // The part that will be encoded. Everything outside it is the lane colour, so the
            // range reads as "this much of the film" without a legend.
            .child(
                div()
                    .absolute()
                    .top(px(0.0))
                    .bottom(px(0.0))
                    .left(gpui::relative(fraction(start)))
                    .w(gpui::relative((fraction(end) - fraction(start)).max(0.0)))
                    .bg(rgb(theme::SELECTED)),
            )
            // The playhead, so "Set In" and "Set Out" have something visible to take from.
            .child(
                div()
                    .absolute()
                    .top(px(0.0))
                    .bottom(px(0.0))
                    .left(gpui::relative(fraction(playhead)))
                    .w(px(1.0))
                    .bg(rgb(theme::ACCENT_SOFT)),
            );

        div()
            .h(px(RANGE_BAND))
            .flex_none()
            .flex()
            .flex_col()
            .gap(px(8.0))
            .px(px(TIMELINE_PADDING))
            .py(px(10.0))
            .bg(rgb(theme::PANEL))
            .border_t_1()
            .border_color(rgb(theme::BORDER))
            .child(
                widgets::row()
                    .gap(px(8.0))
                    .child(widgets::section("Range"))
                    .child(
                        self.button("deliver-set-in", "Set In", true, cx, |this, _cx| {
                            this.set_range_in();
                        }),
                    )
                    .child(
                        self.button("deliver-set-out", "Set Out", true, cx, |this, _cx| {
                            this.set_range_out();
                        }),
                    )
                    .child(self.button(
                        "deliver-whole",
                        "Whole timeline",
                        ranged,
                        cx,
                        |this, _cx| {
                            this.deliver.range = Range::Whole;
                        },
                    ))
                    .child(div().flex_1())
                    .child(widgets::readout(
                        format!("{} — {}", timecode(start), timecode(end)),
                        !ranged,
                    )),
            )
            .child(strip)
    }

    /// Move the in point to the playhead, keeping the out point where it was.
    fn set_range_in(&mut self) {
        let duration = self.editor.duration().to_seconds_f64();
        let end = self.deliver.range.end().unwrap_or(duration);
        self.deliver.range = Range::InOut {
            start: self.editor.playhead().to_seconds_f64(),
            end,
        };
    }

    fn set_range_out(&mut self) {
        let start = self.deliver.range.start();
        self.deliver.range = Range::InOut {
            start,
            end: self.editor.playhead().to_seconds_f64(),
        };
    }

    // ------------------------------------------------------------------------------------
    // The queue
    // ------------------------------------------------------------------------------------

    fn deliver_queue(&self, cx: &mut Context<Self>) -> Div {
        let renders = bay_agent::deliver::queue();
        let running = renders.iter().filter(|render| !render.finished).count();

        let mut band = div()
            .h(px(QUEUE_BAND))
            .flex_none()
            .flex()
            .flex_col()
            .gap(px(8.0))
            .p(px(TIMELINE_PADDING))
            .bg(rgb(theme::PANEL))
            .border_t_1()
            .border_color(rgb(theme::BORDER))
            .overflow_hidden()
            .child(
                widgets::row()
                    .gap(px(8.0))
                    .child(widgets::section("Render queue"))
                    .child(div().flex_1())
                    .children(
                        (running > 0).then(|| widgets::chip_on(format!("{running} running"))),
                    ),
            );

        if renders.is_empty() {
            return band.child(widgets::note(
                "Nothing queued. Renders started by an agent over MCP appear here too — there \
                 is one queue, because there is one way to encode.",
            ));
        }

        let mut list = div()
            .flex()
            .flex_col()
            .gap(px(6.0))
            .flex_1()
            .min_h(px(0.0))
            .overflow_hidden();
        // Newest first: the one you just started is the one you are looking for.
        for (index, render) in renders.iter().rev().enumerate() {
            list = list.child(self.deliver_queue_row(index, render, cx));
        }
        band = band.child(list);
        band
    }

    fn deliver_queue_row(
        &self,
        index: usize,
        render: &QueuedRender,
        cx: &mut Context<Self>,
    ) -> Div {
        let id = render.id;
        let colour = if render.error.is_some() {
            theme::WARN
        } else if render.finished {
            theme::OK
        } else {
            theme::ACCENT
        };

        widgets::card_edged(colour)
            .flex()
            .flex_col()
            .gap(px(5.0))
            .child(
                widgets::row()
                    .gap(px(8.0))
                    .child(
                        div()
                            .flex_1()
                            .min_w(px(0.0))
                            .text_xs()
                            .text_color(rgb(theme::TEXT))
                            .overflow_hidden()
                            .child(Self::shared(render.label.clone())),
                    )
                    .children(render.fraction.map(|fraction| {
                        widgets::readout(format!("{}%", (fraction * 100.0).round() as u32), false)
                    }))
                    .children(render.can_cancel().then(|| {
                        // Real cancel, not a dialog that hides the row: `bay_jobs::cancel` sets
                        // a flag the encoder reads every frame, so the file it was writing is
                        // abandoned rather than left half-finished and playable.
                        div()
                            .id(("deliver-cancel", index))
                            .h(px(20.0))
                            .px(px(8.0))
                            .flex()
                            .items_center()
                            .rounded(px(4.0))
                            .bg(rgb(theme::PANEL_ALT))
                            .text_xs()
                            .text_color(rgb(theme::MUTED))
                            .cursor_pointer()
                            .hover(|style| style.bg(rgb(theme::HOVER)))
                            .child("Cancel")
                            .on_click(cx.listener(move |this, _event, _window, cx| {
                                this.cancel_render(id);
                                cx.notify();
                            }))
                    })),
            )
            .child(widgets::progress(render.fraction, colour))
            .child(widgets::note(
                render
                    .error
                    .clone()
                    .unwrap_or_else(|| render.message.clone()),
            ))
    }

    // ------------------------------------------------------------------------------------
    // Starting and stopping a render
    // ------------------------------------------------------------------------------------

    /// Queue a render of the current project.
    ///
    /// The whole point of the page, and deliberately thin: it snapshots, gates, registers a job
    /// and hands the arguments to [`bay_agent::slow::run`] on a worker. Every decision about
    /// *how* to encode was made in `bay-agent` and every check is `slow::run`'s, so this
    /// function cannot drift away from the path an agent takes — there is nothing here to
    /// drift.
    fn queue_render(&mut self, cx: &mut Context<Self>) {
        let timeline = self.editor.duration().to_seconds_f64();
        if let Some(reason) = self.deliver.refusal(timeline) {
            self.status = Some(format!("Cannot render: {reason}"));
            return;
        }

        let path = self.deliver.output_path(&output_directory());
        let args = self.deliver.render_args(&path);
        let context = self.slow_context();

        // The gate, before a job exists. `headless_render_job` does exactly this and for the
        // same reason: a refusal the user can act on is worth more than a queue row that turns
        // red a second later. This is the call site `fixes.md` entry 6 says the button did not
        // have — with it, `grep render_gate` finds the editor as well as the server.
        if let Err(reason) = bay_agent::slow::render_stamp(&context.project, &args) {
            self.status = Some(format!("Render refused: {reason}"));
            return;
        }

        let label = path.to_string_lossy().to_string();
        let handle = bay_jobs::start("render", &label, bay_jobs::Unit::Frames, 0);
        let id = handle.id();
        self.status = Some(format!("Rendering to {label}"));

        // The background executor is Send+Sync — unlike the foreground one, which is why this
        // cannot simply be awaited where it was asked for.
        let worker = handle.clone();
        let job = cx.background_executor().spawn(async move {
            bay_agent::slow::run("render", &args, &context, Some(&worker)).and_then(|result| {
                if !matches!(result.follow_up, bay_agent::slow::FollowUp::None) {
                    return Err("a render unexpectedly requested a document follow-up".into());
                }
                Ok(result.value)
            })
        });

        // Two tasks, because they wait on different things. This one asks for a repaint while
        // the counters move; without it the queue would only redraw when something else
        // happened to touch the window, and a progress bar that updates when you wiggle the
        // mouse is the meter that never moves wearing a hat.
        cx.spawn(async move |view, cx| loop {
            cx.background_executor().timer(QUEUE_REFRESH).await;
            let finished = bay_jobs::state(id).is_none_or(|state| state.finished);
            if view.update(cx, |_, cx| cx.notify()).is_err() {
                break;
            }
            if finished {
                break;
            }
        })
        .detach();

        cx.spawn(async move |view, cx| {
            let outcome = job.await;
            let status = match &outcome {
                Ok(_) => format!("Rendered {label}"),
                Err(reason) => format!("Render failed: {reason}"),
            };
            bay_jobs::finish(&handle, outcome);
            let _ = view.update(cx, |view, cx| {
                view.status = Some(status);
                cx.notify();
            });
        })
        .detach();
    }

    fn cancel_render(&mut self, id: bay_jobs::JobId) {
        self.status = Some(if bay_jobs::cancel(id) {
            "Stopping the render — it stops at the next frame boundary.".to_string()
        } else {
            "That render had already finished; nothing was cancelled.".to_string()
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{size, TestAppContext, VisualTestContext};

    /// **The test that stops the second output path growing back.**
    ///
    /// `fixes.md` entry 6: bay had two ways to produce a file, and the one behind the window's
    /// own Export button reached neither `render_gate` nor `frame_check`, ran the whole encode
    /// on the UI thread, and capped the result at 1280px wide. The fix was not only to delete
    /// that button — it was to make the shape unreachable, so that the next person who wants an
    /// export button in a corner of some page cannot quietly re-create it.
    ///
    /// So: no file in this crate may call the encoder. `bay-ui` renders *frames* through
    /// `PreviewRenderer` and encodes nothing; encoding goes through `bay_agent::slow::run`,
    /// which gates first.
    #[test]
    fn no_ui_call_site_encodes_for_itself() {
        // Split so this test's own source is not a hit — the scan below reads every `.rs` in
        // the crate, this file included.
        let call = format!("{}_{}(", "export", "video");
        let observed = format!("{}_{}_observed(", "export", "video");

        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut scanned = 0usize;
        let mut offenders: Vec<String> = Vec::new();
        let mut stack = vec![root.clone()];
        while let Some(dir) = stack.pop() {
            let entries = std::fs::read_dir(&dir)
                .unwrap_or_else(|error| panic!("cannot read {}: {error}", dir.display()));
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                    continue;
                }
                scanned += 1;
                let source = std::fs::read_to_string(&path).expect("a source file bay just built");
                if source.contains(&call) || source.contains(&observed) {
                    offenders.push(path.display().to_string());
                }
            }
        }

        // If the scan found nothing at all it is not passing, it is broken.
        assert!(
            scanned >= 10,
            "the scan of {} found only {scanned} source files — has the crate layout moved?",
            root.display()
        );
        assert!(
            offenders.is_empty(),
            "bay-ui must never encode for itself: {offenders:?} calls PreviewRenderer's encoder \
             directly, which bypasses render_gate and frame_check and blocks the UI thread. \
             Queue it through bay_agent::slow::run instead — see fixes.md entry 6."
        );
    }

    /// `pages.md` calls the transport band the horizon line of the app: it must land at the same
    /// distance from the window top on every page that has one. Cut spends 40px on the scene bar
    /// and 300px on the timeline below its transport, so Deliver's two bands have to come to the
    /// same total or the picture jumps when you change page.
    ///
    /// Those two are literals in `toolbar.rs` and `timeline.rs`, so this guards only this end of
    /// the equality — enough to catch someone resizing the queue, not enough to catch someone
    /// resizing the Cut timeline.
    #[test]
    fn the_bands_under_the_transport_hold_the_horizon_line() {
        assert_eq!(
            RANGE_BAND + QUEUE_BAND,
            CUT_BANDS_BELOW_TRANSPORT,
            "the Deliver bands no longer sum to Cut's scene bar plus timeline, so the transport \
             moves when the page changes"
        );
    }

    /// Set In and Set Out take the playhead and leave the other end alone.
    #[gpui::test]
    fn the_range_buttons_take_the_playhead_one_end_at_a_time(cx: &mut TestAppContext) {
        let (view, cx) = cx.add_window_view(|_window, cx| {
            EditorView::new(Editor::starter(), cx.focus_handle(), None, None)
        });
        view.update(cx, |view, _| {
            let seconds = |value: f64| MediaTime::from_seconds_f64(value).expect("a finite time");
            view.editor.seek(seconds(1.5));
            view.set_range_in();
            assert_eq!(view.deliver.range.start(), 1.5);
            // With no out point set, the range still runs to the end of the timeline.
            assert_eq!(
                view.deliver.range.end(),
                Some(view.editor.duration().to_seconds_f64())
            );

            view.editor.seek(seconds(2.5));
            view.set_range_out();
            assert_eq!(
                view.deliver.range.start(),
                1.5,
                "the in point must not move"
            );
            assert_eq!(view.deliver.range.end(), Some(2.5));

            // And "Whole timeline" puts it back, which is the only way out of a range.
            view.deliver.range = Range::Whole;
            assert_eq!(view.deliver.range.end(), None);
        });
    }

    /// A render the form can already tell is impossible never becomes a queue row.
    ///
    /// The refusal arrives as a status line, which is something the user can act on before
    /// pressing anything; a row that turns red a second later is not. Uses an inverted range
    /// because it is the refusal a person can actually produce by clicking — Set Out before
    /// Set In.
    #[gpui::test]
    fn a_render_the_form_refuses_never_becomes_a_queue_row(cx: &mut TestAppContext) {
        let (view, cx) = cx.add_window_view(|_window, cx| {
            EditorView::new(Editor::starter(), cx.focus_handle(), None, None)
        });
        let expected = view.update(cx, |view, cx| {
            view.deliver.file_stem = format!("bay-refused-{}", std::process::id());
            view.deliver.range = Range::InOut {
                start: 6.0,
                end: 4.0,
            };
            let expected = view.deliver.output_path(&output_directory());
            view.queue_render(cx);
            let status = view.status.clone().expect("a refusal says why");
            assert!(status.contains("Cannot render"), "{status}");
            assert!(status.contains("out point"), "{status}");
            expected
        });

        // Keyed on this render's own output path, not on how long the queue is. `bay_jobs` is
        // a process-global registry and Rust runs these tests in parallel, so a count is a
        // shared machine resource wearing an assertion — the class of defect `fixes.md` 11 and
        // 13 are both about, and one this file would have taught by example.
        let label = expected.to_string_lossy().to_string();
        assert!(
            !bay_agent::deliver::queue()
                .iter()
                .any(|render| render.label == label),
            "a refused render must not leave a job in the queue"
        );
    }

    fn windowed(cx: &mut TestAppContext) -> (gpui::Entity<EditorView>, &mut VisualTestContext) {
        let (view, cx) = cx.add_window_view(|_window, cx| {
            let mut editor = EditorView::new(Editor::starter(), cx.focus_handle(), None, None);
            editor.show_page(Page::Deliver);
            editor
        });
        (view, cx)
    }

    fn paint(view: &gpui::Entity<EditorView>, cx: &mut VisualTestContext, width: f32, height: f32) {
        cx.simulate_resize(size(px(width), px(height)));
        let view = view.clone();
        cx.draw(
            gpui::point(px(0.0), px(0.0)),
            size(px(width), px(height)),
            |_, _| view.into_any_element(),
        );
    }

    /// `pages.md`: every page milestone is done only after it has been looked at, at 1440×900
    /// **and** at a small window. This is the half a machine can check — that nothing panics.
    #[gpui::test]
    fn the_deliver_page_paints_at_both_sizes(cx: &mut TestAppContext) {
        let (view, cx) = windowed(cx);
        paint(&view, cx, 1440.0, 900.0);
        paint(&view, cx, 640.0, 420.0);
        paint(&view, cx, 320.0, 240.0);
    }

    /// A queue with rows in it is a different tree from an empty one, and the row carries the
    /// progress bar and the cancel button. Painted with a live job so neither is skipped.
    #[gpui::test]
    fn the_queue_paints_with_a_render_in_it(cx: &mut TestAppContext) {
        // Per-process labels: nothing here writes a file, but two copies of this binary
        // sharing a name in one registry is how a queue assertion elsewhere starts matching
        // somebody else's job.
        let pid = std::process::id();
        let running = bay_jobs::start(
            "render",
            &format!("/tmp/bay-paint-{pid}.mp4"),
            bay_jobs::Unit::Frames,
            120,
        );
        running.progress(30, 120, "encoding frame 30 of 120");
        let failed = bay_jobs::start(
            "render",
            &format!("/tmp/bay-failed-{pid}.mp4"),
            bay_jobs::Unit::Frames,
            10,
        );
        bay_jobs::finish(&failed, Err("ffmpeg is not installed".into()));

        let (view, cx) = windowed(cx);
        paint(&view, cx, 1440.0, 900.0);
        paint(&view, cx, 320.0, 240.0);

        bay_jobs::finish(&running, Ok(serde_json::json!({})));
    }

    /// The select lists are `deferred`, and GPUI aborts on a `defer_draw` during deferred
    /// drawing. Painting this page with one open is what proves the settings column is not
    /// inside a deferred subtree.
    #[gpui::test]
    fn the_deliver_page_paints_with_a_picker_open(cx: &mut TestAppContext) {
        let (view, cx) = windowed(cx);
        view.update(cx, |view, _| {
            view.widgets.toggle_popover("deliver-codec".into());
        });
        paint(&view, cx, 1440.0, 900.0);
        paint(&view, cx, 320.0, 240.0);
    }

    /// ProRes disables the CRF slider rather than hiding it, and the page has to paint both
    /// states — a disabled control that panics is worse than one that lies.
    #[gpui::test]
    fn the_page_paints_with_the_quality_slider_disabled(cx: &mut TestAppContext) {
        let (view, cx) = windowed(cx);
        view.update(cx, |view, _| {
            view.deliver.apply_preset(ExportPreset::Master);
            assert!(!view.deliver.quality_applies());
        });
        paint(&view, cx, 1440.0, 900.0);
    }
}
