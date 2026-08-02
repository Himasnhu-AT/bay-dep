//! Compositor-backed scene preview.
//!
//! [`PreviewRenderer`] owns a wgpu device + the real [`compositor::Compositor`]. Given a scene
//! and a playhead it builds a [`FrameDescriptor`] (one layer per on-screen visual element,
//! placed by its transform), renders it, and reads the pixels back as BGRA — the format GPUI's
//! `RenderImage` expects. Clip textures are solid-color placeholders until native media decode
//! lands; the compositing (background, transform, opacity, blend) is real.

use compositor::{
    BlendMode, CanvasClearDescriptor, Compositor, EffectPassDescriptor,
    EffectUniformValueDescriptor, FrameDescriptor, FrameItemDescriptor, LayerDescriptor,
    QuadTransformDescriptor,
};
use gpu::GpuContext;
use opencut_project::{Background, Element, ElementKind, MediaTime, Scene};
use opencut_text::TextRaster;

/// Map an element's enabled, supported effects to compositor effect-pass groups (one group per
/// effect). Only `brightness` is supported today; unknown effect types are skipped so the
/// compositor never errors on an unknown shader.
fn effect_groups(element: &Element) -> Vec<Vec<EffectPassDescriptor>> {
    element
        .effects()
        .iter()
        .filter(|effect| effect.enabled && effect.effect_type == "brightness")
        .map(|effect| {
            let amount = effect.params.get("amount").copied().unwrap_or(1.0);
            let mut uniforms = std::collections::HashMap::new();
            uniforms.insert(
                "u_amount".to_string(),
                EffectUniformValueDescriptor::Number(amount),
            );
            vec![EffectPassDescriptor {
                shader: "brightness".to_string(),
                uniforms,
            }]
        })
        .collect()
}

/// A composited frame as tightly-packed BGRA8 (`width * height * 4` bytes).
pub struct PreviewFrame {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

pub struct PreviewRenderer {
    ctx: GpuContext,
    compositor: Compositor,
    text: TextRaster,
}

impl PreviewRenderer {
    /// Create the renderer, or `None` if no GPU adapter is available (callers fall back to a
    /// non-GPU preview).
    pub fn new() -> Option<Self> {
        let ctx = pollster::block_on(GpuContext::new()).ok()?;
        let compositor = Compositor::new(&ctx);
        Some(Self {
            ctx,
            compositor,
            text: TextRaster::new(),
        })
    }

    /// Composite `scene` at `playhead` into a `width × height` BGRA frame.
    pub fn render(
        &mut self,
        scene: &Scene,
        playhead: MediaTime,
        width: u32,
        height: u32,
        background: &Background,
    ) -> PreviewFrame {
        let clear = match background {
            Background::Color { color } => hex_to_rgba(color),
            Background::Blur { .. } => [0.06, 0.06, 0.08, 1.0],
        };

        // Main lane first (bottom), then overlay lanes (on top) — the compositor blends in order.
        let mut items = Vec::new();
        for track in std::iter::once(&scene.tracks.main).chain(scene.tracks.overlay.iter()) {
            if track.hidden {
                continue;
            }
            for element in &track.elements {
                let Some(transform) = element.transform() else {
                    continue;
                };
                if !(element.start() <= playhead && playhead < element.end()) {
                    continue;
                }

                // Text elements are rasterized to real glyphs; other visuals use a solid
                // placeholder color (until native media decode provides real frames).
                let (tex_w, tex_h, rgba) = match element {
                    Element::Text(text) => {
                        let tw = (transform.scale * width as f32).clamp(16.0, width as f32) as u32;
                        let th =
                            (transform.scale * height as f32).clamp(16.0, height as f32) as u32;
                        let font_px = (text.font_size * height as f32 / 1080.0).max(8.0);
                        let image = self.text.render(&text.content, font_px, &text.color, tw, th);
                        (image.width, image.height, image.rgba)
                    }
                    _ => (8, 8, solid_rgba(kind_color(element.kind()))),
                };
                let texture = self
                    .ctx
                    .upload_rgba_texture(&rgba, tex_w, tex_h, "preview-layer");
                self.compositor
                    .upsert_texture(element.id().to_string(), texture);

                items.push(FrameItemDescriptor::Layer(LayerDescriptor {
                    texture_id: element.id().to_string(),
                    transform: QuadTransformDescriptor {
                        center_x: transform.x * width as f32,
                        center_y: transform.y * height as f32,
                        width: (transform.scale * width as f32).max(1.0),
                        height: (transform.scale * height as f32).max(1.0),
                        rotation_degrees: transform.rotation,
                        flip_x: false,
                        flip_y: false,
                    },
                    opacity: transform.opacity.clamp(0.0, 1.0),
                    blend_mode: BlendMode::Normal,
                    effect_pass_groups: effect_groups(element),
                    mask: None,
                }));
            }
        }

        let frame = FrameDescriptor {
            width,
            height,
            clear: CanvasClearDescriptor { color: clear },
            items,
        };

        let texture = self
            .compositor
            .render_frame_to_texture(&self.ctx, &frame)
            .expect("compositor render_frame_to_texture failed");
        let mut pixels = self.ctx.read_texture_rgba(&texture, width, height);
        // GPUI's RenderImage wants BGRA; read_texture_rgba returns RGBA.
        for texel in pixels.chunks_exact_mut(4) {
            texel.swap(0, 2);
        }

        PreviewFrame {
            width,
            height,
            bgra: pixels,
        }
    }
}

fn kind_color(kind: ElementKind) -> [u8; 4] {
    match kind {
        ElementKind::Video => [0x33, 0x62, 0x8f, 0xff],
        ElementKind::Image => [0x7a, 0x4f, 0x95, 0xff],
        ElementKind::Text => [0xff, 0xff, 0xff, 0xff],
        ElementKind::Audio => [0x2f, 0x8f, 0x63, 0xff],
    }
}

fn solid_rgba(color: [u8; 4]) -> Vec<u8> {
    color.iter().copied().cycle().take(8 * 8 * 4).collect()
}

fn hex_to_rgba(hex: &str) -> [f32; 4] {
    let value = u32::from_str_radix(hex.trim_start_matches('#'), 16).unwrap_or(0);
    [
        ((value >> 16) & 0xff) as f32 / 255.0,
        ((value >> 8) & 0xff) as f32 / 255.0,
        (value & 0xff) as f32 / 255.0,
        1.0,
    ]
}
