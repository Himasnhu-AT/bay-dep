//! The preview viewer: the composited image, its change signature, and its atlas bookkeeping.
//!
//! A child module of [`super`], so it can reach `EditorView`'s private fields; a sibling
//! could not.

use super::*;

impl EditorView {
    /// A cheap signature of everything that affects the composited preview.
    pub(super) fn preview_signature(&self) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        let playhead = self.editor.playhead();
        playhead.as_ticks().hash(&mut hasher);
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

        let playhead = self.editor.playhead();
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
