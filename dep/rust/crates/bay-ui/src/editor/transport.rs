//! Transport and playback: the button row, the clock, audio output, and playhead motion.
//!
//! A child module of [`super`], so it can reach `EditorView`'s private fields; a sibling
//! could not.

use super::*;

impl EditorView {
    /// Start playing the first active, non-muted audio clip from the playhead.
    pub(super) fn start_audio(&mut self) {
        const SAMPLE_RATE: u32 = 44_100;
        let Some(handle) = self.audio_output.as_ref().map(|(_, h)| h.clone()) else {
            return;
        };
        let playhead_sec = self.editor.playhead().to_seconds_f64();
        let total_sec = (self.editor.duration().to_seconds_f64() - playhead_sec).max(0.0);
        if total_sec <= 0.0 {
            return;
        }

        // Every non-muted audio clip still sounding at/after the playhead contributes to the mix.
        struct Active {
            media_id: String,
            start_sec: f64,
            end_sec: f64,
            /// In-point into the source file, in seconds.
            trim_start_sec: f64,
            volume: f32,
            /// The clip's level over its own length — fades and any volume keyframes,
            /// sampled from the model so preview and export agree.
            gain_points: Vec<(f64, f32)>,
        }
        let active: Vec<Active> = {
            let scene = self.editor.active_scene();
            let mut clips = Vec::new();
            for track in &scene.tracks.audio {
                if track.muted {
                    continue;
                }
                for element in &track.elements {
                    if let bay_core::Element::Audio(audio) = element {
                        let end_sec = element.end().to_seconds_f64();
                        if audio.muted || end_sec <= playhead_sec {
                            continue;
                        }
                        clips.push(Active {
                            media_id: audio.media_id.clone(),
                            start_sec: element.start().to_seconds_f64(),
                            end_sec,
                            trim_start_sec: audio.trim_start.to_seconds_f64().max(0.0),
                            volume: audio.volume,
                            gain_points: element.gain_points(),
                        });
                    }
                }
            }
            clips
        };
        if active.is_empty() {
            return;
        }

        // Decode each referenced media once (cached across seeks/plays).
        for clip in &active {
            if self.audio_cache.contains_key(&clip.media_id) {
                continue;
            }
            if let Some(path) = self
                .editor
                .project()
                .media_path(&clip.media_id)
                .map(|s| s.to_string())
            {
                if let Some(pcm) = bay_audio::decode_pcm(&path, SAMPLE_RATE) {
                    self.audio_cache
                        .insert(clip.media_id.clone(), std::sync::Arc::new(pcm));
                }
            }
        }

        // Mix all decoded clips into one buffer starting at the playhead (borrow ends with block).
        let mixed = {
            let specs: Vec<bay_audio::MixClip> = active
                .iter()
                .filter_map(|clip| {
                    let pcm = self.audio_cache.get(&clip.media_id)?;
                    Some(bay_audio::MixClip {
                        pcm: pcm.as_ref(),
                        // Where in the file to start reading: the clip's own in-point, plus
                        // however far the playhead already is into the clip.
                        src_start_secs: clip.trim_start_sec
                            + (playhead_sec - clip.start_sec).max(0.0),
                        dst_start_secs: (clip.start_sec - playhead_sec).max(0.0),
                        play_secs: clip.end_sec - clip.start_sec.max(playhead_sec),
                        volume: clip.volume.clamp(0.0, 2.0),
                        // Read against the clip's own timeline, so pressing play halfway
                        // through a fade hears the middle of the fade, not the start of it.
                        envelope: (clip.gain_points.len() > 1).then(|| bay_audio::GainEnvelope {
                            clip_offset_secs: (playhead_sec - clip.start_sec).max(0.0),
                            points: clip.gain_points.clone(),
                        }),
                    })
                })
                .collect();
            if specs.is_empty() {
                return;
            }
            bay_audio::mix_stereo(&specs, SAMPLE_RATE, total_sec)
        };

        let source = rodio::buffer::SamplesBuffer::new(2, SAMPLE_RATE, mixed);
        if let Ok(sink) = rodio::Sink::try_new(&handle) {
            sink.append(source);
            sink.play();
            self.audio_sink = Some(sink);
        }
    }

    pub(super) fn stop_audio(&mut self) {
        if let Some(sink) = self.audio_sink.take() {
            sink.stop();
        }
    }

    /// Step the playhead by whole frames, so a key press lands on a frame boundary rather than
    /// somewhere between two.
    pub(super) fn step_frames(&mut self, frames: i64) {
        let geometry = self.geometry();
        let current = geometry.frame_of(self.editor.playhead());
        self.editor.seek(geometry.time_of_frame(current + frames));
    }

    pub(super) fn seek_by(&mut self, delta_ticks: i64) {
        let ticks = self.editor.playhead().as_ticks();
        self.editor.seek(MediaTime::from_ticks(ticks + delta_ticks));
    }

    // ---- timeline geometry --------------------------------------------------------------

    /// Keep the playhead in view while the transport runs. Without this, playback walks off the
    /// right edge of the viewport and the user has to chase it by hand — the moment scrolling
    /// exists, following is not optional.
    ///
    /// Pages rather than centres: it lands the playhead a fifth of the way in and then leaves
    /// the view alone until it goes off the edge again, so the lanes are not sliding under the
    /// pointer on every frame.
    pub(super) fn follow_playhead(&mut self, lane_width: f32) {
        let x = self.geometry().ticks_to_px(self.editor.playhead());
        if (0.0..=lane_width).contains(&x) {
            return;
        }
        let absolute = self
            .geometry()
            .with_scroll_x(0.0)
            .ticks_to_px(self.editor.playhead());
        let content = self.content_width(lane_width);
        self.timeline = self.timeline.with_scroll_x(crate::geometry::clamp_scroll(
            absolute - lane_width * 0.2,
            content,
            lane_width,
        ));
    }

    /// Where the playhead sits inside the lane, clamped so a zoom anchored on it stays on
    /// screen even when it is scrolled out of view.
    pub(super) fn playhead_anchor_x(&self, lane_width: f32) -> f32 {
        self.geometry()
            .ticks_to_px(self.editor.playhead())
            .clamp(0.0, lane_width)
    }

    /// Start/stop transport playback. Restarts from 0 if pressed at the end.
    pub(super) fn toggle_play(&mut self) {
        if self.playing {
            self.playing = false;
            self.last_frame = None;
            self.stop_audio();
        } else {
            if self.editor.playhead() >= self.editor.duration() {
                self.editor.seek(MediaTime::ZERO);
            }
            self.playing = true;
            self.last_frame = None;
            self.start_audio();
        }
    }

    /// Advance the playhead by the real time elapsed since the last animated frame; stop at the end.
    pub(super) fn advance_playback(&mut self) {
        let now = std::time::Instant::now();
        let dt = self
            .last_frame
            .map(|prev| now.duration_since(prev).as_secs_f64())
            .unwrap_or(0.0);
        self.last_frame = Some(now);

        let duration = self.editor.duration();
        let next_ticks = self.editor.playhead().as_ticks() + (dt * TICKS_PER_SECOND as f64) as i64;
        let next = MediaTime::from_ticks(next_ticks);
        if next >= duration {
            self.editor.seek(duration);
            self.playing = false;
            self.last_frame = None;
            self.stop_audio();
        } else {
            self.editor.seek(next);
        }
    }

    pub(super) fn transport_button(
        &self,
        id: &'static str,
        label: &str,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView) + 'static,
    ) -> gpui::Stateful<Div> {
        widgets::pressable(
            widgets::ButtonKind::Normal,
            widgets::button_face(widgets::ButtonKind::Normal, true)
                .id(id)
                .px_2()
                .py_1()
                .rounded_md()
                .text_xs()
                .child(Self::shared(label.to_string())),
        )
        .cursor_pointer()
        .on_click(cx.listener(move |this, _event, _window, cx| {
            handler(this);
            cx.notify();
        }))
    }

    /// The bar under the preview: transport, timecode, and the zoom the timeline reads.
    ///
    /// It used to live in the timeline's header. Moving it here is not tidying — the transport
    /// drives the picture, and having "play" half a screen from the frame it plays is the kind
    /// of layout that makes an editor feel like a form.
    pub(super) fn transport(
        &self,
        vm: &EditorViewModel,
        lane_width: f32,
        cx: &mut Context<Self>,
    ) -> Div {
        let now = timecode(vm.playhead_seconds);
        let total = timecode(vm.duration_seconds);

        widgets::row()
            .h(px(54.0))
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
                    .child(self.transport_button("seek-start", "|◀", cx, |this| {
                        this.editor.seek(MediaTime::ZERO)
                    }))
                    .child(self.transport_button("seek-back", "◀◀", cx, |this| {
                        let ticks = this.editor.playhead().as_ticks();
                        this.editor
                            .seek(MediaTime::from_ticks(ticks - TICKS_PER_SECOND));
                    })),
            )
            .child(
                div()
                    .id("play")
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
                    .child(self.transport_button("seek-fwd", "▶▶", cx, |this| {
                        let ticks = this.editor.playhead().as_ticks();
                        this.editor
                            .seek(MediaTime::from_ticks(ticks + TICKS_PER_SECOND));
                    }))
                    .child(self.transport_button("seek-end", "▶|", cx, |this| {
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
                            .child(shared_text(now)),
                    )
                    .child(
                        div()
                            .font_family("ui-monospace")
                            .text_xs()
                            .text_color(rgb(theme::FAINT))
                            .child(shared_text(format!("/ {total}"))),
                    ),
            )
            .child(div().flex_1())
            .child(
                widgets::row()
                    .gap(px(2.0))
                    .child(self.transport_button("zoom-out", "−", cx, move |this| {
                        let anchor = this.playhead_anchor_x(lane_width);
                        this.zoom_by(1.0 / 1.5, anchor, lane_width);
                    }))
                    .child(
                        div()
                            .font_family("ui-monospace")
                            .text_xs()
                            .text_color(rgb(theme::MUTED))
                            .child(shared_text(format!(
                                "{} px/s",
                                self.timeline.pixels_per_second().round() as i64
                            ))),
                    )
                    .child(self.transport_button("zoom-in", "+", cx, move |this| {
                        let anchor = this.playhead_anchor_x(lane_width);
                        this.zoom_by(1.5, anchor, lane_width);
                    }))
                    .child(self.transport_button("fit", "Fit", cx, move |this| {
                        this.fit_to_window(lane_width);
                    })),
            )
    }
}
