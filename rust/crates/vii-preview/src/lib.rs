//! Compositor-backed scene preview.
//!
//! [`PreviewRenderer`] owns a wgpu device + the real [`compositor::Compositor`]. Given a scene
//! and a playhead it builds a [`FrameDescriptor`] (one layer per on-screen visual element,
//! placed by its transform), renders it, and reads the pixels back as BGRA — the format GPUI's
//! `RenderImage` expects. Clip textures are solid-color placeholders until native media decode
//! lands; the compositing (background, transform, opacity, blend) is real.

pub mod probe;

use compositor::{
    BlendMode, CanvasClearDescriptor, Compositor, EffectPassDescriptor,
    EffectUniformValueDescriptor, FrameDescriptor, FrameItemDescriptor, LayerDescriptor,
    QuadTransformDescriptor,
};
use std::collections::HashSet;

use gpu::GpuContext;
use vii_project::{Background, Element, ElementKind, MediaAsset, MediaTime, Scene};
use vii_text::TextRaster;

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
                shader @ ("brightness" | "contrast" | "saturation") => {
                    Some(vec![EffectPassDescriptor {
                        shader: shader.to_string(),
                        uniforms: [("u_amount".to_string(), number(amount.unwrap_or(1.0)))].into(),
                    }])
                }
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

/// Map the project's GPU-free blend mode onto the compositor's WGSL blend set. The two enums
/// are deliberately separate so the data model carries no render dependency.
fn blend_mode(mode: vii_project::BlendMode) -> BlendMode {
    use vii_project::BlendMode as Src;
    match mode {
        Src::Normal => BlendMode::Normal,
        Src::Darken => BlendMode::Darken,
        Src::Multiply => BlendMode::Multiply,
        Src::ColorBurn => BlendMode::ColorBurn,
        Src::Lighten => BlendMode::Lighten,
        Src::Screen => BlendMode::Screen,
        Src::PlusLighter => BlendMode::PlusLighter,
        Src::ColorDodge => BlendMode::ColorDodge,
        Src::Overlay => BlendMode::Overlay,
        Src::SoftLight => BlendMode::SoftLight,
        Src::HardLight => BlendMode::HardLight,
        Src::Difference => BlendMode::Difference,
        Src::Exclusion => BlendMode::Exclusion,
        Src::Hue => BlendMode::Hue,
        Src::Saturation => BlendMode::Saturation,
        Src::Color => BlendMode::Color,
        Src::Luminosity => BlendMode::Luminosity,
    }
}

/// Fit a source of `natural` pixel size inside a `box_w × box_h` box without distorting it
/// (CSS `object-fit: contain`). Sources with no intrinsic size (text rasters, solid
/// placeholders) fill the box exactly, which is what `None` selects.
fn fit_contain(natural: Option<(u32, u32)>, box_w: f32, box_h: f32) -> (f32, f32) {
    let Some((nw, nh)) = natural else {
        return (box_w, box_h);
    };
    if nw == 0 || nh == 0 {
        return (box_w, box_h);
    }
    let scale = (box_w / nw as f32).min(box_h / nh as f32);
    ((nw as f32 * scale).max(1.0), (nh as f32 * scale).max(1.0))
}

/// Test hook for [`fit_contain`] — the geometry is pure, so it is worth asserting directly
/// rather than only through rendered pixels.
pub fn fit_contain_for_test(natural: Option<(u32, u32)>, box_w: f32, box_h: f32) -> (f32, f32) {
    fit_contain(natural, box_w, box_h)
}

/// Replace any non-finite transform component with a safe default. NaN/inf reaching the
/// compositor panics `f32::clamp` and crashes the editor; a sane layer is a better outcome.
fn sanitise_transform(t: vii_project::Transform) -> vii_project::Transform {
    fn finite(value: f32, fallback: f32) -> f32 {
        if value.is_finite() { value } else { fallback }
    }
    vii_project::Transform {
        x: finite(t.x, 0.5),
        y: finite(t.y, 0.5),
        scale: finite(t.scale, 1.0).max(0.0),
        rotation: finite(t.rotation, 0.0),
        opacity: finite(t.opacity, 1.0),
        // Axis scales are allowed to be 0 (a bar at the start of its grow animation) but not
        // negative — a negative extent would flip the quad rather than hide it.
        scale_x: finite(t.scale_x, 1.0).max(0.0),
        scale_y: finite(t.scale_y, 1.0).max(0.0),
        anchor_x: finite(t.anchor_x, 0.5).clamp(0.0, 1.0),
        anchor_y: finite(t.anchor_y, 0.5).clamp(0.0, 1.0),
    }
}

/// Texel dimensions for a shape raster of a given on-screen aspect ratio (`width / height`).
///
/// The raster is drawn at the layer's aspect and then stretched 1:1 by the quad. Drawing every
/// shape into a SQUARE buffer instead was a real rendering bug: a `radius 0.5` rect is a circle
/// in a square buffer, so a 390x24 bar came out a pointed lens rather than a pill.
///
/// The long side is quantized to a step so a bar animating its width reuses a handful of
/// rasters instead of demanding a new one every frame.
fn shape_raster_dimensions(aspect: f32) -> (u32, u32) {
    const SHORT: u32 = 64;
    const STEP: u32 = 16;
    const LONG_MAX: u32 = 512;

    let aspect = if aspect.is_finite() && aspect > 0.0 {
        aspect
    } else {
        1.0
    };
    // How many times longer the long side is than the short one.
    let ratio = if aspect >= 1.0 { aspect } else { 1.0 / aspect };
    let long = (SHORT as f32 * ratio).round() as u32;
    let long = long.div_ceil(STEP).max(1) * STEP;
    let long = long.clamp(SHORT, LONG_MAX);
    if aspect >= 1.0 {
        (long, SHORT)
    } else {
        (SHORT, long)
    }
}

/// Rasterize a shape into a tightly-packed RGBA8 image with antialiased edges.
///
/// Coverage comes from a signed distance field, so edges stay smooth however far the quad
/// stretches the result. `radius` is a fraction of the shape's SHORTER side, matching the CSS
/// intuition that `0.5` gives a pill with fully round ends.
fn rasterize_shape(
    shape: &vii_project::ShapeKind,
    color: &str,
    width: u32,
    height: u32,
) -> Vec<u8> {
    use vii_project::ShapeKind;

    let [r, g, b] = hex_to_rgb8(color);
    let (width, height) = (width.max(2), height.max(2));
    let mut rgba = vec![0u8; (width * height * 4) as usize];

    let (half_w, half_h) = (width as f32 / 2.0, height as f32 / 2.0);
    let short = half_w.min(half_h);
    let radius_px = match shape {
        ShapeKind::Rect { radius } => (radius.clamp(0.0, 0.5) * short * 2.0).max(0.0),
        ShapeKind::Ellipse => 0.0,
    };

    for py in 0..height {
        for px in 0..width {
            // Sample at the texel centre, relative to the shape's centre.
            let dx = (px as f32 + 0.5) - half_w;
            let dy = (py as f32 + 0.5) - half_h;
            // Signed distance to the shape boundary: negative inside, positive outside.
            let distance = match shape {
                ShapeKind::Rect { .. } => {
                    // Rounded-box SDF: pull the corner arc centres inward by `radius_px` on
                    // BOTH axes independently, which is what keeps the corners circular at a
                    // non-square aspect.
                    let qx = dx.abs() - (half_w - radius_px);
                    let qy = dy.abs() - (half_h - radius_px);
                    let outside = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt();
                    outside + qx.max(qy).min(0.0) - radius_px
                }
                ShapeKind::Ellipse => {
                    // Exact ellipse SDF needs iteration; scaling the unit-circle distance by
                    // the smaller radius is accurate to well under a texel at these sizes.
                    let k = ((dx / half_w).powi(2) + (dy / half_h).powi(2)).sqrt();
                    (k - 1.0) * short
                }
            };
            // One-texel-wide linear ramp across the boundary.
            let coverage = (0.5 - distance).clamp(0.0, 1.0);
            if coverage <= 0.0 {
                continue;
            }
            let alpha = (coverage * 255.0).round() as u8;
            let index = ((py * width + px) * 4) as usize;
            rgba[index] = r;
            rgba[index + 1] = g;
            rgba[index + 2] = b;
            rgba[index + 3] = alpha;
        }
    }
    rgba
}

/// Test hook for [`rasterize_shape`] — the coverage maths is pure and worth asserting directly.
pub fn rasterize_shape_for_test(
    shape: &vii_project::ShapeKind,
    color: &str,
    width: u32,
    height: u32,
) -> Vec<u8> {
    rasterize_shape(shape, color, width, height)
}

/// Test hook for [`shape_raster_dimensions`].
pub fn shape_raster_dimensions_for_test(aspect: f32) -> (u32, u32) {
    shape_raster_dimensions(aspect)
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

impl VideoClip {
    fn bytes(&self) -> usize {
        self.frames.len() * (self.width as usize) * (self.height as usize) * 4
    }
}

/// Decode budget for the cached video frames. The whole clip is decoded once and indexed by
/// time, so the budget is a memory ceiling: rather than truncating long clips (which froze
/// anything past ~15s on the last decoded frame), the sample rate is lowered so the cache still
/// spans the clip's full duration.
const VIDEO_MAX_WIDTH: u32 = 480;
const VIDEO_MAX_FPS: f32 = 30.0;
const VIDEO_MIN_FPS: f32 = 2.0;
const VIDEO_MEMORY_BUDGET: usize = 192 * 1024 * 1024;
/// Fallback decode size when the clip cannot be probed.
const VIDEO_FALLBACK_W: u32 = 320;
const VIDEO_FALLBACK_H: u32 = 180;

/// Choose decode dimensions, sample rate and frame count for a clip.
///
/// `natural` is the source's **coded** size and `rotation` its display-matrix rotation. ffmpeg
/// autorotates on decode, so a 90°/270° clip arrives transposed — planning against the coded
/// size would squash it into a landscape buffer, which is exactly the stretch bug this whole
/// change set is about. Pure so the budget policy is unit-testable.
fn plan_decode(natural: (u32, u32), rotation: i32, duration_secs: f64) -> (u32, u32, f32, u32) {
    let (nw, nh) = natural;
    let (nw, nh) = if nw == 0 || nh == 0 {
        (VIDEO_FALLBACK_W, VIDEO_FALLBACK_H)
    } else {
        (nw, nh)
    };
    // Plan against the DISPLAY size, which is what ffmpeg will hand us.
    let (nw, nh) = if rotation == 90 || rotation == 270 {
        (nh, nw)
    } else {
        (nw, nh)
    };

    let even = |v: f32| ((v.round() as u32).max(2) / 2) * 2;
    // Downscale to the preview budget, keeping aspect; ffmpeg wants even dimensions.
    let scale = (VIDEO_MAX_WIDTH as f32 / nw as f32).min(1.0);
    let (mut w, mut h) = (even(nw as f32 * scale), even(nh as f32 * scale));

    let duration = duration_secs.max(0.05);
    let frames_affordable =
        (VIDEO_MEMORY_BUDGET / ((w as usize) * (h as usize) * 4).max(1)).max(1) as f64;

    // Coverage of the whole clip is non-negotiable — truncating it is what made long clips
    // freeze on their last decoded frame. So spend the budget on frame RATE first, and only
    // when even the minimum rate will not fit do we shrink the frames themselves.
    let fps = (frames_affordable / duration)
        .min(VIDEO_MAX_FPS as f64)
        .max(VIDEO_MIN_FPS as f64) as f32;
    let frames = ((duration * fps as f64).ceil() as u32).max(1);

    // `frames` is now fixed by the coverage promise, so the budget can only be met by shrinking
    // the frames. Iterate: one shrink can land back on the same even dimensions (rounding), so
    // a single pass is not enough to guarantee the ceiling actually holds.
    while frames as usize * (w as usize) * (h as usize) * 4 > VIDEO_MEMORY_BUDGET && w > 2 && h > 2
    {
        let needed = frames as usize * (w as usize) * (h as usize) * 4;
        let shrink = (VIDEO_MEMORY_BUDGET as f64 / needed as f64)
            .sqrt()
            .min(0.95);
        let (next_w, next_h) = (
            even(w as f32 * shrink as f32),
            even(h as f32 * shrink as f32),
        );
        // Guarantee forward progress even when rounding would keep us in place.
        w = if next_w < w { next_w } else { w - 2 };
        h = if next_h < h {
            next_h
        } else {
            h.saturating_sub(2).max(2)
        };
    }

    (w, h, fps, frames)
}

/// Test hook for [`plan_decode`].
pub fn plan_decode_for_test(
    natural: (u32, u32),
    rotation: i32,
    duration_secs: f64,
) -> (u32, u32, f32, u32) {
    plan_decode(natural, rotation, duration_secs)
}

/// Max distinct text rasters kept resident in the compositor store before the least-recently
/// inserted is evicted. Static captions reuse one entry; inline editing churns keys, so we cap.
const TEXT_CACHE_CAP: usize = 64;

/// Ceiling on decoded video frames held across **all** clips. [`VIDEO_MEMORY_BUDGET`] bounds a
/// single clip; without a global cap, ten imported clips would each claim their own budget.
const GLOBAL_VIDEO_MEMORY_BUDGET: usize = 384 * 1024 * 1024;

/// Where a clip's decode has got to. Decoding runs on a worker thread so the render path never
/// blocks: a 10-minute clip took ~33s of frozen UI when this was a synchronous call.
enum ClipState {
    /// Worker is decoding; poll the channel each frame and draw a placeholder meanwhile.
    Pending(std::sync::mpsc::Receiver<Option<VideoClip>>),
    Ready(VideoClip),
    /// Decode failed. Remembered so an undecodable file is not retried every frame.
    Failed,
}

pub struct PreviewRenderer {
    ctx: GpuContext,
    compositor: Compositor,
    text: TextRaster,
    /// media id → natural pixel size for images already uploaded into the compositor store.
    uploaded_media: std::collections::HashMap<String, (u32, u32)>,
    /// media id → decode state (pending on a worker thread, ready, or permanently failed).
    video_cache: std::collections::HashMap<String, ClipState>,
    /// Ready clips in least-recently-used order, for eviction under the global byte budget.
    video_lru: std::collections::VecDeque<String>,
    /// Content+style keys of text textures already rasterised and uploaded, so unchanged text
    /// isn't re-shaped every frame. `order` is the eviction queue for the [`TEXT_CACHE_CAP`] LRU.
    raster_keys: HashSet<String>,
    raster_order: std::collections::VecDeque<String>,
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
            uploaded_media: std::collections::HashMap::new(),
            video_cache: std::collections::HashMap::new(),
            video_lru: std::collections::VecDeque::new(),
            raster_keys: HashSet::new(),
            raster_order: std::collections::VecDeque::new(),
        })
    }

    /// Rasterise + upload a text texture keyed by its content/style, reusing the cached texture
    /// when the exact same text was drawn before. Evicts the least-recently inserted entry (and
    /// releases its GPU texture) once the cache is full. Returns the texture id (the key).
    fn ensure_text_texture(
        &mut self,
        content: &str,
        font_px: f32,
        color: &str,
        tw: u32,
        th: u32,
        style: &vii_text::TextStyle<'_>,
    ) -> String {
        let key = format!(
            "text:{color}:{font}:{tw}x{th}:{style_key}:{content}",
            font = font_px.to_bits(),
            style_key = style.cache_key(),
        );
        if self.raster_keys.contains(&key) {
            return key;
        }
        let image = self
            .text
            .render_styled(content, font_px, color, tw, th, style);
        let texture =
            self.ctx
                .upload_rgba_texture(&image.rgba, image.width, image.height, "preview-text");
        self.compositor.upsert_texture(key.clone(), texture);
        self.remember_raster(key.clone());
        key
    }

    /// Upload (once) the RGBA raster for a shape+colour pair, returning its texture key.
    ///
    /// Shares the text raster LRU: both are CPU-rasterized, content-addressed textures, and a
    /// shape key can never collide with a text key because of the `shape:`/`text:` prefixes.
    /// The raster is square and gets stretched by the layer quad, so one texture serves a bar
    /// at any width.
    fn ensure_shape_texture(
        &mut self,
        shape: &vii_project::ShapeKind,
        color: &str,
        aspect: f32,
    ) -> String {
        use vii_project::ShapeKind;
        // A square-cornered rect has no curvature at all, so one tiny tile serves every size
        // and aspect. Anything curved must be rasterized at the layer's own aspect or the
        // quad's non-uniform stretch turns its round corners into ellipses.
        let (raster_w, raster_h) = match shape {
            ShapeKind::Rect { radius } if *radius <= 0.0 => (8, 8),
            _ => shape_raster_dimensions(aspect),
        };
        let key = match shape {
            ShapeKind::Rect { radius } => {
                format!(
                    "shape:rect:{}:{color}:{raster_w}x{raster_h}",
                    radius.to_bits()
                )
            }
            ShapeKind::Ellipse => format!("shape:ellipse:{color}:{raster_w}x{raster_h}"),
        };
        if self.raster_keys.contains(&key) {
            return key;
        }
        let rgba = rasterize_shape(shape, color, raster_w, raster_h);
        let texture = self
            .ctx
            .upload_rgba_texture(&rgba, raster_w, raster_h, "preview-shape");
        self.compositor.upsert_texture(key.clone(), texture);
        self.remember_raster(key.clone());
        key
    }

    /// Record a freshly uploaded CPU raster in the LRU.
    ///
    /// Deliberately does NOT evict. Evicting here released textures that the frame currently
    /// being assembled still referenced: once a single frame needed more than the cap's worth
    /// of distinct rasters, the earliest layers' textures were freed before the draw, and the
    /// compositor died with `MissingTexture`. Eviction now happens in [`Self::evict_rasters`]
    /// after the frame is submitted, and never touches a key that frame used.
    fn remember_raster(&mut self, key: String) {
        self.raster_keys.insert(key.clone());
        self.raster_order.push_back(key);
    }

    /// Trim the raster cache back to [`TEXT_CACHE_CAP`], skipping anything the frame just
    /// rendered still referenced. A key that is in use is rotated to the back rather than
    /// released, so a frame that legitimately needs more rasters than the cap simply keeps
    /// them all rather than failing.
    fn evict_rasters(&mut self, in_use: &HashSet<String>) {
        // Bounded by one full pass over the queue: every rotation increments `skipped`, and
        // any successful eviction resets it, so this cannot spin.
        let mut skipped = 0;
        while self.raster_order.len() > TEXT_CACHE_CAP && skipped < self.raster_order.len() {
            let Some(candidate) = self.raster_order.pop_front() else {
                break;
            };
            if in_use.contains(&candidate) {
                self.raster_order.push_back(candidate);
                skipped += 1;
                continue;
            }
            self.raster_keys.remove(&candidate);
            self.compositor.release_texture(&candidate);
            skipped = 0;
        }
    }

    /// Number of distinct text rasters currently resident in the cache (for tests/diagnostics).
    pub fn text_cache_len(&self) -> usize {
        self.raster_keys.len()
    }

    /// True while any clip is still decoding. The UI polls this to keep requesting frames so a
    /// finished decode is picked up even when playback is paused.
    pub fn has_pending_decodes(&self) -> bool {
        self.video_cache
            .values()
            .any(|s| matches!(s, ClipState::Pending(_)))
    }

    /// Bytes of decoded video currently resident across all clips.
    pub fn video_cache_bytes(&self) -> usize {
        self.video_cache
            .values()
            .filter_map(|s| match s {
                ClipState::Ready(clip) => Some(clip.bytes()),
                _ => None,
            })
            .sum()
    }

    /// Advance a clip's decode state: start a worker if this is the first sighting, otherwise
    /// check whether the worker has finished. Never blocks.
    fn poll_decode(&mut self, media_id: &str, path: Option<&str>) {
        match self.video_cache.get(media_id) {
            None => {
                let Some(path) = path else {
                    // Media is missing entirely — remember it so we do not look again.
                    self.video_cache
                        .insert(media_id.to_string(), ClipState::Failed);
                    return;
                };
                let (tx, rx) = std::sync::mpsc::channel();
                let owned = path.to_string();
                // Detached worker: the receiver is the only handle we keep. If the renderer is
                // dropped first the send simply fails and the thread exits.
                std::thread::spawn(move || {
                    let _ = tx.send(decode_video_clip(&owned));
                });
                self.video_cache
                    .insert(media_id.to_string(), ClipState::Pending(rx));
            }
            Some(ClipState::Pending(rx)) => match rx.try_recv() {
                Ok(Some(clip)) => {
                    self.video_cache
                        .insert(media_id.to_string(), ClipState::Ready(clip));
                    self.touch_clip(media_id);
                    self.enforce_video_budget();
                }
                Ok(None) | Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    self.video_cache
                        .insert(media_id.to_string(), ClipState::Failed);
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => {} // still decoding
            },
            Some(ClipState::Ready(_)) => self.touch_clip(media_id),
            Some(ClipState::Failed) => {}
        }
    }

    /// Move a clip to the most-recently-used end of the eviction queue.
    fn touch_clip(&mut self, media_id: &str) {
        if let Some(index) = self.video_lru.iter().position(|id| id == media_id) {
            self.video_lru.remove(index);
        }
        self.video_lru.push_back(media_id.to_string());
    }

    /// Evict least-recently-used decoded clips until the total fits the global budget.
    /// `VIDEO_MEMORY_BUDGET` bounds one clip; this bounds the whole cache.
    fn enforce_video_budget(&mut self) {
        while self.video_cache_bytes() > GLOBAL_VIDEO_MEMORY_BUDGET && self.video_lru.len() > 1 {
            let Some(oldest) = self.video_lru.pop_front() else {
                break;
            };
            self.video_cache.remove(&oldest);
        }
    }

    /// Decode + upload an image media asset once, returning its texture id, or `None` on failure.
    /// Returns the texture id and the image's natural pixel size (needed to fit it without
    /// distortion); the size is cached alongside the upload so repeats stay cheap.
    fn ensure_image_texture(
        &mut self,
        media_id: &str,
        media: &[MediaAsset],
    ) -> Option<(String, (u32, u32))> {
        if let Some(size) = self.uploaded_media.get(media_id) {
            return Some((media_id.to_string(), *size));
        }
        let path = media.iter().find(|m| m.id == media_id)?.path.clone();
        let decoded = image::open(&path).ok()?;
        let rgba = decoded.to_rgba8();
        let (width, height) = rgba.dimensions();
        let texture =
            self.ctx
                .upload_rgba_texture(&rgba.into_raw(), width, height, "preview-image");
        self.compositor
            .upsert_texture(media_id.to_string(), texture);
        self.uploaded_media
            .insert(media_id.to_string(), (width, height));
        Some((media_id.to_string(), (width, height)))
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
    /// Block until every video clip referenced by `scene` has finished decoding.
    ///
    /// The preview can draw a placeholder while a worker decodes, but an export cannot — a
    /// placeholder would be baked into the output file. Export therefore waits.
    pub fn await_decodes(&mut self, scene: &Scene, media: &[MediaAsset]) {
        for track in std::iter::once(&scene.tracks.main).chain(scene.tracks.overlay.iter()) {
            for element in &track.elements {
                let Element::Video(video) = element else {
                    continue;
                };
                let path = media
                    .iter()
                    .find(|m| m.id == video.media_id)
                    .map(|m| m.path.clone());
                loop {
                    self.poll_decode(&video.media_id, path.as_deref());
                    match self.video_cache.get(&video.media_id) {
                        Some(ClipState::Pending(_)) => {
                            std::thread::sleep(std::time::Duration::from_millis(10))
                        }
                        _ => break,
                    }
                }
            }
        }
    }

    /// Encoding needs the whole frame description; bundling these into a struct would add
    /// indirection at the single call site without clarifying anything.
    ///
    /// Renders every frame of the timeline and encodes an MP4 at `out_path`, mixing the audio
    /// lanes onto the picture. Returns whether ffmpeg exited successfully.
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

        // Every audible clip on the audio lanes, resolved to a file on disk. Until this
        // existed, `export_video` piped a single rawvideo input and never read `tracks.audio`
        // at all — every export was silent, which made the editor unable to produce the one
        // thing a social reel is: picture cut to music.
        let audio_clips = audible_clips(scene, media);

        let mut args: Vec<String> = vec![
            "-nostdin".into(),
            "-loglevel".into(),
            "error".into(),
            "-y".into(),
            // Input 0: the composited frames, piped in below.
            "-f".into(),
            "rawvideo".into(),
            "-pix_fmt".into(),
            "rgba".into(),
            "-s".into(),
            format!("{width}x{height}"),
            "-r".into(),
            format!("{fps}"),
            "-i".into(),
            "pipe:0".into(),
        ];
        // Inputs 1..n: one per audio clip, each seeked to its own trim point.
        for clip in &audio_clips {
            args.push("-i".into());
            args.push(clip.path.clone());
        }

        if !audio_clips.is_empty() {
            // Delay each clip to its timeline start, trim it to its own duration, apply its
            // gain, then sum them. `adelay` wants milliseconds per channel; `all=1` applies
            // the same delay to every channel rather than only the first.
            let mut filters = String::new();
            for (index, clip) in audio_clips.iter().enumerate() {
                filters.push_str(&format!(
                    "[{input}:a]atrim=start={start:.4}:duration={duration:.4},asetpts=PTS-STARTPTS,\
                     volume={volume:.4},adelay={delay_ms}:all=1[a{index}];",
                    input = index + 1,
                    start = clip.trim_start_seconds,
                    duration = clip.duration_seconds,
                    volume = clip.volume,
                    delay_ms = (clip.start_seconds * 1000.0).round() as i64,
                ));
            }
            for index in 0..audio_clips.len() {
                filters.push_str(&format!("[a{index}]"));
            }
            filters.push_str(&format!(
                "amix=inputs={count}:normalize=0:dropout_transition=0[aout]",
                count = audio_clips.len()
            ));

            args.push("-filter_complex".into());
            args.push(filters);
            args.push("-map".into());
            args.push("0:v".into());
            args.push("-map".into());
            args.push("[aout]".into());
            args.push("-c:a".into());
            args.push("aac".into());
            args.push("-b:a".into());
            args.push("192k".into());
            // The mixed bed can outlast the picture; the video track defines the duration.
            args.push("-shortest".into());
        }

        args.push("-pix_fmt".into());
        args.push("yuv420p".into());
        args.push(out_path.into());

        let Ok(mut child) = std::process::Command::new("ffmpeg")
            .args(&args)
            .stdin(std::process::Stdio::piped())
            .spawn()
        else {
            return false;
        };
        let Some(mut stdin) = child.stdin.take() else {
            return false;
        };

        // Placeholders must never be baked into an export, so wait for every decode first.
        self.await_decodes(scene, media);

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
                // A non-finite transform (NaN scale from a degenerate keyframe, say) would
                // propagate into f32::clamp and panic, taking the whole editor down. Skip the
                // layer instead — one missing layer beats a crashed app.
                let transform = sanitise_transform(transform);

                // Text → real glyphs; Image → decoded file (cached); others → solid placeholder.
                let (texture_id, natural_size) = match element {
                    Element::Text(text) => {
                        // The raster box comes from the element's BASE scale, never the sampled
                        // one. Sizing it from the animated value made `scale` a text *wrap box*
                        // rather than a visual scale: a scale keyframe reflowed the paragraph
                        // and re-shaped every glyph each frame. Rasterizing once at the base box
                        // and reporting that as the layer's natural size lets `fit_contain`
                        // scale the finished raster, so a scale-punch is a real scale-punch.
                        //
                        // `clamp(16.0, w)` panics when w < 16 (a tiny or zero-sized canvas),
                        // so clamp against the canvas first and only then apply the floor.
                        let base_scale = text.transform.scale.max(0.01);
                        let tw = (base_scale * width as f32).min(width as f32).max(1.0) as u32;
                        let th = (base_scale * height as f32).min(height as f32).max(1.0) as u32;
                        let (tw, th) = (tw.max(1), th.max(1));
                        let font_px = (text.font_size * height as f32 / 1080.0).max(8.0);
                        // Cached by content/style, so static captions aren't re-shaped per frame.
                        let style = vii_text::TextStyle {
                            family: text.font_family.as_deref(),
                            weight: text.font_weight,
                            align: match text.align {
                                vii_project::TextAlign::Left => vii_text::TextAlign::Left,
                                vii_project::TextAlign::Center => vii_text::TextAlign::Center,
                                vii_project::TextAlign::Right => vii_text::TextAlign::Right,
                            },
                            letter_spacing: text.letter_spacing,
                            line_height: text.line_height,
                        };
                        (
                            self.ensure_text_texture(
                                &text.content,
                                font_px,
                                &text.color,
                                tw,
                                th,
                                &style,
                            ),
                            Some((tw, th)),
                        )
                    }
                    Element::Shape(shape) => {
                        // A shape has no natural size, so its final on-screen extent is known
                        // without consulting the texture — and the texture needs that aspect
                        // in order to keep its corners round under a non-uniform stretch.
                        let aspect = (transform.scale_x * width as f32)
                            / (transform.scale_y * height as f32).max(f32::EPSILON);
                        (
                            self.ensure_shape_texture(&shape.shape, &shape.color, aspect),
                            None,
                        )
                    }
                    Element::Image(image_element) => {
                        match self.ensure_image_texture(&image_element.media_id, media) {
                            Some((texture_id, natural)) => (texture_id, Some(natural)),
                            None => (self.upload_solid_placeholder(element), None),
                        }
                    }
                    Element::Video(video) => {
                        let media_id = video.media_id.clone();
                        // Decode the clip once on a WORKER THREAD, then index frames by time.
                        // Doing this inline used to block the render path for the whole decode
                        // (~33s of frozen UI for a 10-minute clip).
                        let path = media
                            .iter()
                            .find(|m| m.id == media_id)
                            .map(|m| m.path.clone());
                        self.poll_decode(&media_id, path.as_deref());

                        let frame = self
                            .video_cache
                            .get(&media_id)
                            .and_then(|state| match state {
                                ClipState::Ready(clip) => Some(clip),
                                _ => None,
                            })
                            .and_then(|clip| {
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
                                (element.id().to_string(), Some((w, h)))
                            }
                            None => (self.upload_solid_placeholder(element), None),
                        }
                    }
                    _ => (self.upload_solid_placeholder(element), None),
                };

                // `scale` defines a box as a fraction of the canvas; a source with a natural
                // size is *fitted* inside that box (contain) so it keeps its aspect ratio.
                // Stretching every source to the box was a live rendering bug: a 16:9 clip and a
                // square image both filled the whole canvas.
                let (box_w, box_h) = (
                    (transform.scale * width as f32).max(1.0),
                    (transform.scale * height as f32).max(1.0),
                );
                let (fit_w, fit_h) = fit_contain(natural_size, box_w, box_h);
                // Per-axis scale multiplies the *fitted* size, so it composes with `contain`
                // rather than fighting it: at (1, 1) the geometry is bit-identical to before,
                // and a bar animating `scaleX` stretches from its fitted width.
                let (layer_w, layer_h) = (fit_w * transform.scale_x, fit_h * transform.scale_y);
                // A zero-extent quad has no pixels but still costs a full compositor pass, and
                // is exactly what frame 0 of every grow animation looks like.
                if layer_w <= 0.0 || layer_h <= 0.0 {
                    continue;
                }

                // `(x, y)` positions the element's ANCHOR, not necessarily its centre. The
                // compositor takes a centre, so offset by how far the anchor sits from it.
                // Note the anchor governs placement only: rotation is still about the quad's
                // centre, which is what every existing project expects.
                let center_x = transform.x * width as f32 + (0.5 - transform.anchor_x) * layer_w;
                let center_y = transform.y * height as f32 + (0.5 - transform.anchor_y) * layer_h;

                items.push(FrameItemDescriptor::Layer(LayerDescriptor {
                    texture_id,
                    transform: QuadTransformDescriptor {
                        center_x,
                        center_y,
                        width: layer_w,
                        height: layer_h,
                        rotation_degrees: transform.rotation,
                        flip_x: false,
                        flip_y: false,
                    },
                    opacity: transform.opacity.clamp(0.0, 1.0),
                    blend_mode: blend_mode(element.blend_mode().unwrap_or_default()),
                    effect_pass_groups: effect_groups(element),
                    mask: None,
                }));
            }
        }

        // Every CPU raster this frame depends on. Held until after the draw so the cache
        // cannot free a texture the compositor is about to sample.
        let in_use: HashSet<String> = items
            .iter()
            .filter_map(|item| match item {
                FrameItemDescriptor::Layer(layer) => Some(layer.texture_id.clone()),
                _ => None,
            })
            .collect();

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
        // Read straight back as BGRA (what GPUI's RenderImage wants). On Metal this is the raw
        // native order, so there is no per-frame channel swizzle on the hot path.
        let bgra = self.ctx.read_texture_bgra(&texture, width, height);

        self.evict_rasters(&in_use);

        PreviewFrame {
            width,
            height,
            bgra,
        }
    }
}

/// Decode an entire video clip to a sequence of RGBA frames in one ffmpeg invocation (the
/// sidecar-decoder escape hatch — no native ffmpeg linking), sized and sampled by
/// [`plan_decode`]. Returns `None` if ffmpeg is unavailable or there is no video.
///
/// NOTE: this blocks for the whole decode (seconds, for a long clip) and is currently called
/// from the render path. Moving it off-thread is tracked as M9 in the parity plan.
fn decode_video_clip(path: &str) -> Option<VideoClip> {
    // Probe first so the decode matches the source's real display aspect and length.
    let (natural, rotation, duration_secs) = match probe::probe_media(path) {
        Ok(meta) => (
            (meta.width, meta.height),
            meta.rotation,
            meta.duration.to_seconds_f64(),
        ),
        Err(_) => ((VIDEO_FALLBACK_W, VIDEO_FALLBACK_H), 0, 10.0),
    };
    let (decode_w, decode_h, fps, max_frames) = plan_decode(natural, rotation, duration_secs);

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
            &format!("{fps}"),
            "-s",
            &format!("{decode_w}x{decode_h}"),
            "-frames:v",
            &max_frames.to_string(),
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
    let frame_size = (decode_w * decode_h * 4) as usize;
    let frames: Vec<Vec<u8>> = output
        .stdout
        .chunks_exact(frame_size)
        .map(|chunk| chunk.to_vec())
        .collect();
    if frames.is_empty() {
        return None;
    }
    Some(VideoClip {
        fps,
        width: decode_w,
        height: decode_h,
        frames,
    })
}

/// One audio clip resolved for the export mixer: where its file is, where it sits on the
/// timeline, and how loud it plays.
#[derive(Debug, Clone, PartialEq)]
pub struct AudibleClip {
    pub path: String,
    /// Timeline position of the clip's first sample, in seconds.
    pub start_seconds: f64,
    /// How much of the source to skip, in seconds.
    pub trim_start_seconds: f64,
    pub duration_seconds: f64,
    /// Linear gain. 1.0 is unity.
    pub volume: f32,
}

/// Collect every audible clip on the scene's audio lanes, in timeline order.
///
/// Skips muted tracks, muted clips, silent clips (`volume <= 0`), zero-length clips, and any
/// clip whose `media_id` does not resolve to a file — each of those would otherwise become an
/// ffmpeg input that contributes nothing, and an unresolvable path would fail the whole encode.
fn audible_clips(scene: &Scene, media: &[MediaAsset]) -> Vec<AudibleClip> {
    let mut clips = Vec::new();
    for track in &scene.tracks.audio {
        if track.muted || track.hidden {
            continue;
        }
        for element in &track.elements {
            let Element::Audio(audio) = element else {
                continue;
            };
            if audio.muted || audio.volume <= 0.0 {
                continue;
            }
            let duration_seconds = audio.duration.to_seconds_f64();
            if duration_seconds <= 0.0 {
                continue;
            }
            let Some(asset) = media.iter().find(|m| m.id == audio.media_id) else {
                continue;
            };
            clips.push(AudibleClip {
                path: asset.path.clone(),
                start_seconds: audio.start.to_seconds_f64().max(0.0),
                // `AudioElement` has no trim field yet, so a clip always plays from its head.
                // Kept explicit so adding trim later is a one-line change here.
                trim_start_seconds: 0.0,
                duration_seconds,
                volume: audio.volume,
            });
        }
    }
    clips
}

/// Test hook for [`audible_clips`] — the selection rules are pure and worth asserting without
/// spawning ffmpeg.
pub fn audible_clips_for_test(scene: &Scene, media: &[MediaAsset]) -> Vec<AudibleClip> {
    audible_clips(scene, media)
}

fn kind_color(kind: ElementKind) -> [u8; 4] {
    match kind {
        ElementKind::Video => [0x33, 0x62, 0x8f, 0xff],
        ElementKind::Image => [0x7a, 0x4f, 0x95, 0xff],
        ElementKind::Text => [0xff, 0xff, 0xff, 0xff],
        ElementKind::Audio => [0x2f, 0x8f, 0x63, 0xff],
        // Shapes rasterize their own fill, so this is only reached if that ever fails.
        ElementKind::Shape => [0xa0, 0xa0, 0xa8, 0xff],
    }
}

/// Parse `#rrggbb` (or bare `rrggbb`) into 8-bit channels. Unparseable input falls back to
/// white, which is visible — a silently invisible shape would be much harder to debug.
fn hex_to_rgb8(hex: &str) -> [u8; 3] {
    let value = u32::from_str_radix(hex.trim_start_matches('#'), 16).unwrap_or(0xff_ff_ff);
    [
        ((value >> 16) & 0xff) as u8,
        ((value >> 8) & 0xff) as u8,
        (value & 0xff) as u8,
    ]
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
