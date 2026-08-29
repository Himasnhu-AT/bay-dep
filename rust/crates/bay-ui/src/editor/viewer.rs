//! The preview viewer: the composited image, its change signature, and its atlas bookkeeping.
//!
//! A child module of [`super`], so it can reach `EditorView`'s private fields; a sibling
//! could not.

use super::*;

impl EditorView {
    /// The playhead the preview draws: quantised to the project's frame rate, **unless the scene
    /// is animated**.
    ///
    /// **The picture changes once per frame, not once per tick, and the difference is 4x the
    /// GPU work on a 120 Hz display.** `MediaTime` counts 120,000 ticks a second, so the raw
    /// playhead is a different number on every display refresh; hashing it into the signature
    /// meant a full composite, readback, `RenderImage` and atlas upload 120 times a second to
    /// show a 24 or 30 fps source — measured at `pictures 120.0/s` against
    /// `30.0 new frames/s`, with three composites in four producing a picture identical to the
    /// last one.
    ///
    /// It is worse than wasteful when the playhead is over empty timeline. Nothing bounds a
    /// project's duration to its video: one long audio clip made the timeline 51 minutes, and
    /// playing past the last picture composited an empty frame 120 times a second for as long
    /// as the transport ran, with no clip on screen to show for it.
    ///
    /// Quantising is also more correct than the alternative of throttling. Two playhead
    /// positions inside the same frame *are* the same picture — that is what a frame is — and
    /// the timeline already quantises scrubs and drops the same way (`geometry::quantize_to_frame`).
    /// The model playhead is untouched, so the timecode still reads continuously.
    pub(super) fn preview_playhead(&self) -> MediaTime {
        // An animated scene is not quantised, and that exception is the whole of this method.
        //
        // Quantising asks "which video frame is this?", and for footage that is the right
        // question — a frame is a frame, and two playhead positions inside one show the same
        // picture. A keyframed graphic is a *continuous* function of time: a line drawing on, a
        // title sliding in. Rounding its playhead to the project's frame rate does not skip a
        // decode, it makes the motion itself step, and on a 120 Hz display that is the difference
        // between 120 samples a second and 30.
        //
        // The previous version quantised unconditionally and cost exactly that. It was written to
        // stop the preview compositing 120 times a second to show 30 fps of footage, which it
        // did — and it took animation smoothness with it, on the first intro anybody built.
        //
        // Nothing is given back on the video side by exempting animation: the frame lookup
        // quantises *itself*. `ClipStream`'s `index_for` floors to a frame index and the cache
        // lookup floors too, so a truer playhead resolves to the same frame and decodes nothing
        // extra. The only cost is compositing more often, which is what an animated scene needs.
        if self.scene_is_animated() {
            return self.editor.playhead();
        }
        crate::geometry::quantize_to_frame(
            self.editor.playhead(),
            self.editor.project().settings.fps,
        )
    }

    /// Whether any element under the playhead carries keyframes.
    ///
    /// Scoped to what is *on screen*: a title animated at 0:30 must not make the whole timeline
    /// composite at refresh rate while the playhead sits on plain footage at 0:05.
    fn scene_is_animated(&self) -> bool {
        let playhead = self.editor.playhead();
        let scene = self.editor.active_scene();
        std::iter::once(&scene.tracks.main)
            .chain(scene.tracks.overlay.iter())
            .filter(|track| !track.hidden)
            .flat_map(|track| track.elements.iter())
            .filter(|element| element.start() <= playhead && playhead < element.end())
            .any(|element| element.animations().is_some_and(|set| !set.is_empty()))
    }

    /// A cheap signature of everything that affects the composited preview.
    ///
    /// If this does not change, the picture cannot have changed, and `update_preview` returns
    /// without compositing. Anything that alters a pixel and is *not* hashed here is a preview
    /// that goes stale — which is why text content and effect params are in it.
    pub(super) fn preview_signature(&self) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        // The *drawn* playhead, so two ticks inside one frame hash the same and the second one
        // returns early instead of re-compositing an identical picture.
        self.preview_playhead().as_ticks().hash(&mut hasher);
        // Element activity still uses the true playhead: a clip boundary is not required to land
        // on a frame edge, and rounding it here would flicker the layer at the boundary.
        let playhead = self.editor.playhead();
        self.editor.active_scene_id().hash(&mut hasher);
        if let bay_core::Background::Color { color } = &self.editor.project().settings.background {
            color.hash(&mut hasher);
        }
        let scene = self.editor.active_scene();
        for track in std::iter::once(&scene.tracks.main).chain(scene.tracks.overlay.iter()) {
            if track.hidden {
                continue;
            }
            for element in &track.elements {
                if let Some(t) = element.transform() {
                    if element.start() <= playhead && playhead < element.end() {
                        element.id().hash(&mut hasher);
                        [
                            t.x.to_bits(),
                            t.y.to_bits(),
                            t.scale.to_bits(),
                            t.rotation.to_bits(),
                            t.opacity.to_bits(),
                        ]
                        .hash(&mut hasher);
                        element.blend_mode().hash(&mut hasher);
                        // Text content/style must be in the signature or the preview goes stale
                        // while the user types — which silently defeats inline text editing.
                        if let bay_core::Element::Text(text) = element {
                            text.content.hash(&mut hasher);
                            text.color.hash(&mut hasher);
                            text.font_size.to_bits().hash(&mut hasher);
                        }
                        for effect in element.effects() {
                            effect.id.hash(&mut hasher);
                            effect.effect_type.hash(&mut hasher);
                            effect.enabled.hash(&mut hasher);
                            for (key, value) in &effect.params {
                                key.hash(&mut hasher);
                                value.to_bits().hash(&mut hasher);
                            }
                        }
                        if let Some(animations) = element.animations() {
                            for (property, channel) in animations {
                                property.hash(&mut hasher);
                                for key in &channel.keys {
                                    key.time.as_ticks().hash(&mut hasher);
                                    key.value.to_bits().hash(&mut hasher);
                                }
                            }
                        }
                    }
                }
            }
        }
        hasher.finish()
    }

    /// Move the on-screen preview frame to the retirement queue. Not a drop: the atlas tile it
    /// owns outlives the `Arc` and is only released by [`Self::release_retired_images`].
    pub(super) fn retire_preview_image(&mut self) {
        if let Some(image) = self.preview_image.take() {
            self.retired_images.retire(image);
        }
    }

    /// Release the sprite-atlas tiles of every frame that has left the screen.
    ///
    /// Called at the top of `render`, before the element tree is rebuilt, so the only image this
    /// can free is one that was last painted in a frame already submitted — never the one this
    /// frame is about to draw.
    pub(super) fn release_retired_images(&mut self, window: &mut Window) {
        self.retired_images.release(window);
    }

    /// Collect a finished composite and submit a new one if anything affecting it changed.
    ///
    /// Two halves, in that order, because the compositor is pipelined: the frame shown now was
    /// submitted on an earlier tick. Collecting first also frees the single staging buffer that
    /// the submit below needs.
    pub(super) fn update_preview(&mut self) {
        if self.preview.is_none() {
            return;
        }
        crate::frametime::timed(crate::frametime::record_preview, || {
            self.update_preview_inner()
        })
    }

    fn update_preview_inner(&mut self) {
        // Told once, here, rather than at each of the four places `playing` is assigned
        // (toggle_play's two arms, the end-of-timeline stop, and open_project). Those can and
        // would drift; this cannot. `set_playing` is a no-op when the value is unchanged, so
        // saying it every frame costs a comparison.
        //
        // Playing switches the preview onto streams positioned at the playhead — preview size,
        // full rate, nothing resident — instead of the whole-clip cache, which spends its memory
        // budget on coverage and pays for it in frame rate.
        let playing = self.playing;
        if let Some(renderer) = self.preview.as_mut() {
            renderer.set_playing(playing);
            if crate::frametime::enabled() {
                crate::frametime::record_playback(renderer.take_playback_stats());
            }
        }

        // --- collect ---
        let collected = self.preview.as_mut().unwrap().collect_composite();
        match collected {
            CollectedFrame::Ready(frame) => {
                // `RgbaImage` is the container type, not a claim about channel order: gpui
                // documents `RenderImage` as "a cached and processed image, in BGRA format", so
                // handing it BGRA is correct and swapping first would turn every face blue.
                // The export path *does* swap (`lib.rs`, "BGRA → RGBA for ffmpeg input") because
                // ffmpeg wants the other order — the two are not inconsistent, they are two
                // different consumers, and this comment exists so nobody reconciles them.
                if self.page == crate::page::Page::Color {
                    self.measure_scopes(&frame);
                }
                if let Some(buffer) =
                    image::RgbaImage::from_raw(frame.width, frame.height, frame.bgra)
                {
                    let render_image = RenderImage::new(vec![image::Frame::new(buffer)]);
                    // The frame being replaced has to give its atlas tile back. Assigning over
                    // it would drop the `Arc` and leak the tile — see `draw::RetiredImages`.
                    self.retired_images
                        .replace(&mut self.preview_image, Some(Arc::new(render_image)));
                    // Counted here and nowhere else: this is the one line in the program where a
                    // new picture reaches the screen. Every other candidate (a render tick, a
                    // submit, a decode) can happen without the image changing.
                    crate::frametime::record_picture();
                }
            }
            // A frame the GPU could not produce (device loss on a laptop that slept) leaves the
            // last good one on screen. Showing nothing, or a black rectangle, would look like
            // the project is empty rather than like the GPU hiccuped.
            //
            // Clearing the signature is what makes that a hiccup rather than a permanent freeze:
            // leaving it set means this scene counts as already drawn and every later tick
            // returns early — forever, even after the GPU recovers.
            CollectedFrame::Failed => self.preview_sig = None,
            // Still compositing. `render` keeps asking for frames while a readback is pending,
            // so this is a tick to wait, not a reason to give up on the frame.
            CollectedFrame::Pending => return,
            CollectedFrame::Idle => {}
        }

        // --- submit ---
        let signature = self.preview_signature();
        // A decode finishing on a worker thread does NOT change the signature (the project is
        // unchanged), so while any decode is in flight we must re-composite unconditionally —
        // otherwise the placeholder would never be replaced by the real frame.
        let awaiting_decode = self
            .preview
            .as_ref()
            .is_some_and(|p| p.has_pending_decodes());
        if self.preview_sig == Some(signature) && !awaiting_decode {
            return;
        }

        // Composite the frame the signature agreed on, not the raw tick that happened to
        // trigger it — otherwise the same frame index draws a fractionally different picture
        // depending on when the display refreshed.
        let playhead = self.preview_playhead();
        let background = self.editor.project().settings.background.clone();
        // Disjoint field borrows: &mut self.preview and &self.editor.
        let renderer = self.preview.as_mut().unwrap();
        let scene = self.editor.active_scene();
        let media = self.editor.media();
        let submitted = renderer.submit_composite(
            scene,
            playhead,
            PREVIEW_RENDER_W,
            PREVIEW_RENDER_H,
            &background,
            media,
        );
        // Only claim this scene is drawn once its composite is actually on the GPU. Recording
        // the signature for a submit that never happened would mean no later tick re-tries it.
        self.preview_sig = submitted.then_some(signature);
    }

    pub(super) fn preview(&self, vm: &EditorViewModel) -> Div {
        let (width, height) = vm.canvas;
        let fill = vm
            .background_color
            .as_deref()
            .map(theme::hex_to_rgb)
            .unwrap_or(0x202028);

        const PREVIEW_W: f32 = 512.0;
        const PREVIEW_H: f32 = 288.0; // 16:9

        // Each active layer as a positioned/sized rect (center x/y, scale of canvas, opacity).
        let mut layers: Vec<Div> = Vec::new();
        for layer in &vm.preview_layers {
            let w = (layer.scale * PREVIEW_W).max(8.0);
            let h = (layer.scale * PREVIEW_H).max(8.0);
            let left = layer.x * PREVIEW_W - w / 2.0;
            let top = layer.y * PREVIEW_H - h / 2.0;
            layers.push(
                div()
                    .absolute()
                    .left(px(left))
                    .top(px(top))
                    .w(px(w))
                    .h(px(h))
                    .rounded_md()
                    .bg(rgb(theme::element_color(&layer.kind_label)))
                    .opacity(layer.opacity)
                    .border_1()
                    .border_color(rgb(theme::BORDER))
                    .overflow_hidden()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_xs()
                    .text_color(rgb(theme::TEXT))
                    .child(Self::shared(layer.label.clone())),
            );
        }

        div()
            .flex()
            .flex_1()
            .flex_col()
            .items_center()
            .justify_center()
            .gap_2()
            .bg(rgb(theme::BG))
            .child(if let Some(image) = &self.preview_image {
                // Real composited output from the wgpu compositor (CPU-readback path).
                div()
                    .relative()
                    .w(px(PREVIEW_W))
                    .h(px(PREVIEW_H))
                    .rounded_md()
                    .border_1()
                    .border_color(rgb(theme::BORDER))
                    .overflow_hidden()
                    .child(
                        img(ImageSource::Render(image.clone()))
                            .w(px(PREVIEW_W))
                            .h(px(PREVIEW_H)),
                    )
            } else {
                // Fallback layout view (no GPU adapter): elements as positioned rects.
                div()
                    .relative()
                    .w(px(PREVIEW_W))
                    .h(px(PREVIEW_H))
                    .rounded_md()
                    .bg(rgb(fill))
                    .border_1()
                    .border_color(rgb(theme::BORDER))
                    .overflow_hidden()
                    .children(layers)
            })
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(format!(
                        "{width} × {height}  ·  {} layer(s)  ·  {}",
                        vm.preview_layers.len(),
                        if self.preview_image.is_some() {
                            "compositor"
                        } else {
                            "layout"
                        }
                    ))),
            )
    }
}

#[cfg(test)]
mod preview_rate_tests {
    use super::*;
    use gpui::TestAppContext;

    fn view(cx: &mut TestAppContext) -> gpui::Entity<EditorView> {
        cx.update(|cx| {
            let focus = cx.focus_handle();
            cx.new(|_| EditorView::new(Editor::starter(), focus, None, None))
        })
    }

    /// Two playhead positions inside one frame are one picture, so they must hash the same.
    ///
    /// Without this the preview composites at the display's refresh rate rather than the
    /// project's frame rate: `MediaTime` has 120,000 ticks per second, so the raw playhead
    /// differs on every refresh and every refresh paid for a full composite, readback and atlas
    /// upload. Measured at 120 pictures/s for a source producing 30 new frames/s.
    #[gpui::test]
    fn two_ticks_inside_one_frame_are_one_picture(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |this, _| {
            let fps = this.editor.project().settings.fps;
            let frame = crate::geometry::time_of_frame(10, fps);

            this.editor.seek(frame);
            let at_frame = this.preview_signature();

            // One tick later — the same frame by any definition, since a frame at even 120 fps
            // is 1,000 ticks wide.
            this.editor
                .seek(MediaTime::from_ticks(frame.as_ticks() + 1));
            let a_tick_later = this.preview_signature();

            assert_eq!(
                at_frame, a_tick_later,
                "a playhead one tick along re-composited an identical picture"
            );
        });
    }

    /// The saving must not come from the preview refusing to advance at all: the next frame is a
    /// different picture and has to hash differently.
    #[gpui::test]
    fn the_next_frame_is_a_different_picture(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |this, _| {
            let fps = this.editor.project().settings.fps;

            this.editor.seek(crate::geometry::time_of_frame(10, fps));
            let tenth = this.preview_signature();
            this.editor.seek(crate::geometry::time_of_frame(11, fps));
            let eleventh = this.preview_signature();

            assert_ne!(
                tenth, eleventh,
                "consecutive frames hash the same, so the preview would never update"
            );
        });
    }

    /// The saving, counted rather than asserted: one second of playhead advanced at a 120 Hz
    /// display rate must produce one composite per *source* frame, not one per refresh.
    ///
    /// This is the number the frame-time probe reported as `pictures 120.0/s` against
    /// `30.0 new frames/s`. Three composites in four — each a full GPU readback, a fresh
    /// `RenderImage` and an atlas tile — produced a picture identical to the one before it.
    #[gpui::test]
    fn a_second_of_playback_composites_once_per_frame_not_once_per_refresh(
        cx: &mut TestAppContext,
    ) {
        let view = view(cx);
        view.update(cx, |this, _| {
            let fps = this.editor.project().settings.fps;
            let frames_per_second = crate::geometry::frame_of(
                MediaTime::from_seconds_f64(1.0).expect("one second is a valid time"),
                fps,
            );

            // Walk a second of timeline the way a 120 Hz display would sample it.
            const REFRESHES: i64 = 120;
            let second = TICKS_PER_SECOND;
            let mut signatures = std::collections::HashSet::new();
            for refresh in 0..REFRESHES {
                this.editor
                    .seek(MediaTime::from_ticks(refresh * second / REFRESHES));
                signatures.insert(this.preview_signature());
            }

            assert!(
                signatures.len() as i64 <= frames_per_second + 1,
                "a second of playback wanted {} composites for a {frames_per_second} fps project \
                 — the preview is drawing at the refresh rate, not the frame rate",
                signatures.len()
            );
            assert!(
                signatures.len() > 1,
                "the whole second collapsed to {} composite(s); the preview would not move",
                signatures.len()
            );
        });
    }

    /// An animated scene is **not** quantised, because its motion is continuous.
    ///
    /// The regression this guards: quantising asks "which video frame is this?", which is the
    /// right question for footage and the wrong one for a keyframed graphic. A title sliding in
    /// or a line drawing on is a continuous function of time, and rounding its playhead to the
    /// project's frame rate does not skip a decode — it makes the motion itself step. On a 120 Hz
    /// display that is 30 samples a second instead of 120, and it showed up on the first intro
    /// anybody built.
    #[gpui::test]
    fn an_animated_scene_is_not_quantised_to_the_frame_rate(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |this, _| {
            let fps = this.editor.project().settings.fps;
            let frame = crate::geometry::time_of_frame(10, fps);
            // Mid-frame: with quantisation this collapses onto the frame boundary.
            let between = MediaTime::from_ticks(frame.as_ticks() + 7);

            this.editor.seek(between);
            assert_eq!(
                this.preview_playhead(),
                frame,
                "an unanimated scene should still quantise — that saving is real"
            );

            // Give the element under the playhead a keyframe channel.
            let animated = {
                let scene = this.editor.project_mut().active_scene_mut();
                let element = scene
                    .tracks
                    .main
                    .elements
                    .first_mut()
                    .or_else(|| scene.tracks.overlay.first_mut()?.elements.first_mut());
                match element {
                    Some(element) => {
                        element.start() <= between && between < element.end() && {
                            if let Some(channels) = element.animations_mut() {
                                channels.insert(
                                    "opacity".into(),
                                    bay_core::AnimationChannel::default(),
                                );
                                true
                            } else {
                                false
                            }
                        }
                    }
                    None => false,
                }
            };
            assert!(
                animated,
                "the starter project has no element under the playhead to animate"
            );

            assert_eq!(
                this.preview_playhead(),
                between,
                "an animated scene was rounded to a frame boundary, which steps the motion"
            );
        });
    }

    /// The composite must draw the frame the signature agreed on. If the signature quantises and
    /// the composite does not, one frame index draws a slightly different picture depending on
    /// when the display happened to refresh.
    #[gpui::test]
    fn the_drawn_playhead_is_the_one_the_signature_agreed_on(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |this, _| {
            let fps = this.editor.project().settings.fps;
            let frame = crate::geometry::time_of_frame(10, fps);
            this.editor
                .seek(MediaTime::from_ticks(frame.as_ticks() + 7));

            assert_eq!(
                this.preview_playhead(),
                frame,
                "the drawn playhead is not quantised to the frame the signature hashed"
            );
        });
    }
}
