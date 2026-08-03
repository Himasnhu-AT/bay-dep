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
use std::collections::HashSet;

use gpu::GpuContext;
use opencut_project::{Background, Element, ElementKind, MediaAsset, MediaTime, Scene};
use opencut_text::TextRaster;

/// Map an element's enabled, supported effects to compositor effect-pass groups (one group per
/// effect). `brightness`/`contrast`/`saturation` are single-`amount` colour adjustments; `blur`
/// expands into a separable two-pass gaussian (horizontal then vertical). Unknown effect types
/// are skipped so the compositor never errors on an unknown shader.
fn effect_groups(element: &Element) -> Vec<Vec<EffectPassDescriptor>> {
    fn number(amount: f32) -> EffectUniformValueDescriptor {
        EffectUniformValueDescriptor::Number(amount)
    }

    element
        .effects()
        .iter()
        .filter(|effect| effect.enabled)
        .filter_map(|effect| {
            let amount = effect.params.get("amount").copied();
            match effect.effect_type.as_str() {
                // Colour adjustments: `amount` defaults to 1.0 (no change).
                shader @ ("brightness" | "contrast" | "saturation") => Some(vec![
                    EffectPassDescriptor {
                        shader: shader.to_string(),
                        uniforms: [("u_amount".to_string(), number(amount.unwrap_or(1.0)))].into(),
                    },
                ]),
                // Separable gaussian blur: `amount` is sigma (px); split into H then V.
                "blur" => {
                    let sigma = amount.unwrap_or(2.0).max(0.1);
                    let pass = |dir: [f32; 2]| EffectPassDescriptor {
                        shader: "gaussian-blur".to_string(),
                        uniforms: [
                            ("u_sigma".to_string(), number(sigma)),
                            ("u_step".to_string(), number(1.0)),
                            (
                                "u_direction".to_string(),
                                EffectUniformValueDescriptor::Vector(vec![dir[0], dir[1]]),
                            ),
                        ]
                        .into(),
                    };
                    Some(vec![pass([1.0, 0.0]), pass([0.0, 1.0])])
                }
                _ => None,
            }
        })
        .collect()
}

/// A composited frame as tightly-packed BGRA8 (`width * height * 4` bytes).
pub struct PreviewFrame {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

/// All frames of a video clip decoded once at a fixed size (for smooth playback + fast scrub).
struct VideoClip {
    fps: f32,
    width: u32,
    height: u32,
    frames: Vec<Vec<u8>>, // RGBA, `width*height*4` each
}

/// Decode size + limits for the cached video frames.
const VIDEO_W: u32 = 320;
const VIDEO_H: u32 = 180;
const VIDEO_FPS: f32 = 30.0;
const VIDEO_MAX_FRAMES: u32 = 450; // ~15s cap

pub struct PreviewRenderer {
    ctx: GpuContext,
    compositor: Compositor,
    text: TextRaster,
    /// media ids whose decoded image is already uploaded into the compositor texture store.
    uploaded_media: HashSet<String>,
    /// media id → all decoded video frames (one ffmpeg decode per clip, then indexed by time).
    video_cache: std::collections::HashMap<String, VideoClip>,
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
            uploaded_media: HashSet::new(),
            video_cache: std::collections::HashMap::new(),
        })
    }

    /// Decode + upload an image media asset once, returning its texture id, or `None` on failure.
    fn ensure_image_texture(&mut self, media_id: &str, media: &[MediaAsset]) -> Option<String> {
        if self.uploaded_media.contains(media_id) {
            return Some(media_id.to_string());
        }
        let path = media.iter().find(|m| m.id == media_id)?.path.clone();
        let decoded = image::open(&path).ok()?;
        let rgba = decoded.to_rgba8();
        let (width, height) = rgba.dimensions();
        let texture = self
            .ctx
            .upload_rgba_texture(&rgba.into_raw(), width, height, "preview-image");
        self.compositor.upsert_texture(media_id.to_string(), texture);
        self.uploaded_media.insert(media_id.to_string());
        Some(media_id.to_string())
    }

    /// Upload an 8×8 solid placeholder for an element and return its texture id.
    fn upload_solid_placeholder(&mut self, element: &Element) -> String {
        let texture = self.ctx.upload_rgba_texture(
            &solid_rgba(kind_color(element.kind())),
            8,
            8,
            "preview-solid",
        );
        self.compositor
            .upsert_texture(element.id().to_string(), texture);
        element.id().to_string()
    }

    /// Encode the timeline to a video file by rendering each frame and piping raw RGBA to the
    /// ffmpeg CLI. Returns `false` if ffmpeg is unavailable or encoding fails. Blocks until done.
    #[allow(clippy::too_many_arguments)]
    pub fn export_video(
        &mut self,
        scene: &Scene,
        duration_seconds: f64,
        fps: f64,
        width: u32,
        height: u32,
        background: &Background,
        media: &[MediaAsset],
        out_path: &str,
    ) -> bool {
        use std::io::Write;

        let Ok(mut child) = std::process::Command::new("ffmpeg")
            .args([
                "-nostdin",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgba",
                "-s",
                &format!("{width}x{height}"),
                "-r",
                &format!("{fps}"),
                "-i",
                "pipe:0",
                "-pix_fmt",
                "yuv420p",
                out_path,
            ])
            .stdin(std::process::Stdio::piped())
            .spawn()
        else {
            return false;
        };
        let Some(mut stdin) = child.stdin.take() else {
            return false;
        };

        let total_frames = (duration_seconds * fps).ceil().max(1.0) as u64;
        for index in 0..total_frames {
            let seconds = index as f64 / fps;
            let playhead = MediaTime::from_seconds_f64(seconds).unwrap_or(MediaTime::ZERO);
            let frame = self.render(scene, playhead, width, height, background, media);
            let mut rgba = frame.bgra;
            for texel in rgba.chunks_exact_mut(4) {
                texel.swap(0, 2); // BGRA → RGBA for ffmpeg input
            }
            if stdin.write_all(&rgba).is_err() {
                break;
            }
        }
        drop(stdin);
        child.wait().map(|s| s.success()).unwrap_or(false)
    }

    /// Composite `scene` at `playhead` into a `width × height` BGRA frame. `media` resolves image
    /// element `media_id`s to files on disk.
    pub fn render(
        &mut self,
        scene: &Scene,
        playhead: MediaTime,
        width: u32,
        height: u32,
        background: &Background,
        media: &[MediaAsset],
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
                if !(element.start() <= playhead && playhead < element.end()) {
                    continue;
                }
                // Evaluate keyframe animations at the time into the clip.
                let local = MediaTime::from_ticks(playhead.as_ticks() - element.start().as_ticks());
                let Some(transform) = element.sampled_transform(local) else {
                    continue;
                };

                // Text → real glyphs; Image → decoded file (cached); others → solid placeholder.
                let texture_id = match element {
                    Element::Text(text) => {
                        let tw = (transform.scale * width as f32).clamp(16.0, width as f32) as u32;
                        let th =
                            (transform.scale * height as f32).clamp(16.0, height as f32) as u32;
                        let font_px = (text.font_size * height as f32 / 1080.0).max(8.0);
                        let image = self.text.render(&text.content, font_px, &text.color, tw, th);
                        let texture = self.ctx.upload_rgba_texture(
                            &image.rgba,
                            image.width,
                            image.height,
                            "preview-text",
                        );
                        self.compositor
                            .upsert_texture(element.id().to_string(), texture);
                        element.id().to_string()
                    }
                    Element::Image(image_element) => {
                        match self.ensure_image_texture(&image_element.media_id, media) {
                            Some(texture_id) => texture_id,
                            None => self.upload_solid_placeholder(element),
                        }
                    }
                    Element::Video(video) => {
                        let media_id = video.media_id.clone();
                        // Decode the whole clip once, then index frames by time (fast playback).
                        if !self.video_cache.contains_key(&media_id) {
                            if let Some(path) =
                                media.iter().find(|m| m.id == media_id).map(|m| m.path.clone())
                            {
                                if let Some(clip) = decode_video_clip(&path) {
                                    self.video_cache.insert(media_id.clone(), clip);
                                }
                            }
                        }
                        let frame = self.video_cache.get(&media_id).and_then(|clip| {
                            let seconds = video.trim_start.to_seconds_f64()
                                + (playhead.as_ticks() - video.start.as_ticks()).max(0) as f64
                                    / 120_000.0;
                            let index = ((seconds * clip.fps as f64).floor() as usize)
                                .min(clip.frames.len().saturating_sub(1));
                            clip.frames
                                .get(index)
                                .map(|rgba| (clip.width, clip.height, rgba.clone()))
                        });
                        match frame {
                            Some((w, h, rgba)) => {
                                let texture =
                                    self.ctx.upload_rgba_texture(&rgba, w, h, "preview-video");
                                self.compositor
                                    .upsert_texture(element.id().to_string(), texture);
                                element.id().to_string()
                            }
                            None => self.upload_solid_placeholder(element),
                        }
                    }
                    _ => self.upload_solid_placeholder(element),
                };

                items.push(FrameItemDescriptor::Layer(LayerDescriptor {
                    texture_id,
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

/// Decode an entire video clip to a sequence of RGBA frames at a fixed size/fps in one ffmpeg
/// invocation (the sidecar-decoder escape hatch — no native ffmpeg linking). Capped at
/// `VIDEO_MAX_FRAMES`. Returns `None` if ffmpeg is unavailable or there is no video.
fn decode_video_clip(path: &str) -> Option<VideoClip> {
    let output = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            // Offload decode to the GPU when possible (VideoToolbox on macOS); ffmpeg falls
            // back to software automatically if no hardware decoder fits the input.
            "-hwaccel",
            "auto",
            "-i",
            path,
            "-r",
            &format!("{VIDEO_FPS}"),
            "-s",
            &format!("{VIDEO_W}x{VIDEO_H}"),
            "-frames:v",
            &VIDEO_MAX_FRAMES.to_string(),
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "pipe:1",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let frame_size = (VIDEO_W * VIDEO_H * 4) as usize;
    let frames: Vec<Vec<u8>> = output
        .stdout
        .chunks_exact(frame_size)
        .map(|chunk| chunk.to_vec())
        .collect();
    if frames.is_empty() {
        return None;
    }
    Some(VideoClip {
        fps: VIDEO_FPS,
        width: VIDEO_W,
        height: VIDEO_H,
        frames,
    })
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
