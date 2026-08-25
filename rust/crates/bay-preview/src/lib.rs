//! Compositor-backed scene preview.
//!
//! [`PreviewRenderer`] owns a wgpu device + the real [`bay_compositor::Compositor`]. Given a scene
//! and a playhead it builds a [`FrameDescriptor`] (one layer per on-screen visual element,
//! placed by its transform), renders it, and reads the pixels back as BGRA — the format GPUI's
//! `RenderImage` expects. Clip textures are solid-color placeholders until native media decode
//! lands; the compositing (background, transform, opacity, blend) is real.

pub mod frame_check;
pub mod probe;

use bay_compositor::{
    BlendMode, CanvasClearDescriptor, Compositor, EffectPassDescriptor,
    EffectUniformValueDescriptor, FrameDescriptor, FrameItemDescriptor, LayerDescriptor,
    LayerMaskDescriptor, QuadTransformDescriptor,
};
use std::collections::HashSet;

use bay_gpu::GpuContext;
use bay_project::{Background, Element, ElementKind, MediaAsset, MediaTime, Scene};
use bay_text::TextRaster;

/// Map an element's enabled, supported effects to compositor effect-pass groups (one group per
/// effect). `brightness`/`contrast`/`saturation` are single-`amount` colour adjustments; `blur`
/// expands into a separable two-pass gaussian (horizontal then vertical). Unknown effect types
/// are skipped so the compositor never errors on an unknown shader.
fn effect_groups(
    effects: &[bay_project::Effect],
    luts: &mut LutCache,
) -> Vec<Vec<EffectPassDescriptor>> {
    fn number(amount: f32) -> EffectUniformValueDescriptor {
        EffectUniformValueDescriptor::Number(amount)
    }

    effects
        .iter()
        .filter(|effect| effect.enabled)
        .filter_map(|effect| {
            let amount = effect.params.get("amount").copied();
            match effect.effect_type.as_str() {
                // A whole grade in one pass. `amount` is how much of it to apply, so a look
                // can be dialled back without re-authoring the table.
                "lut" => {
                    // A LUT with no file behind it grades nothing. Dropping the pass is right:
                    // the alternative is a frame the shader cannot produce, and the missing
                    // file is reported by `check` rather than by a black frame.
                    let table = luts.resolve(effect.asset.as_deref()?)?;
                    Some(vec![EffectPassDescriptor {
                        shader: "lut".to_string(),
                        uniforms: [("u_amount".to_string(), number(amount.unwrap_or(1.0)))].into(),
                        lut: Some(table),
                    }])
                }
                // Colour adjustments: `amount` defaults to 1.0 (no change).
                shader @ ("brightness" | "contrast" | "saturation") => {
                    Some(vec![EffectPassDescriptor {
                        shader: shader.to_string(),
                        uniforms: [("u_amount".to_string(), number(amount.unwrap_or(1.0)))].into(),
                        lut: None,
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
                        lut: None,
                    };
                    Some(vec![pass([1.0, 0.0]), pass([0.0, 1.0])])
                }
                _ => None,
            }
        })
        .collect()
}

/// How far a card may lean before the projection stops being a picture.
pub const MAX_TILT_DEGREES: f32 = 85.0;

/// Map the project's GPU-free blend mode onto the compositor's WGSL blend set. The two enums
/// are deliberately separate so the data model carries no render dependency.
fn blend_mode(mode: bay_project::BlendMode) -> BlendMode {
    use bay_project::BlendMode as Src;
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

/// Draw a mask shape into a frame-sized RGBA buffer: opaque white inside the shape,
/// transparent outside it.
///
/// The edge is antialiased by sampling coverage rather than testing a single point, because a
/// hard-edged ellipse over a face reads as a cut-out. Softening beyond that is the feather
/// pass's job, on the GPU, where it belongs.
fn rasterize_mask(mask: &bay_project::Mask, width: u32, height: u32) -> Vec<u8> {
    use bay_project::MaskShape;
    let (width, height) = (width.max(1), height.max(1));
    let (w, h) = (width as f32, height as f32);
    let centre = (mask.x.clamp(-2.0, 3.0) * w, mask.y.clamp(-2.0, 3.0) * h);
    let half = (
        (mask.width.clamp(0.0, 4.0) * w / 2.0).max(0.5),
        (mask.height.clamp(0.0, 4.0) * h / 2.0).max(0.5),
    );

    let mut rgba = vec![0u8; (width * height * 4) as usize];
    for y in 0..height {
        for x in 0..width {
            let (dx, dy) = (
                (x as f32 + 0.5 - centre.0) / half.0,
                (y as f32 + 0.5 - centre.1) / half.1,
            );
            // Coverage rather than a point test, so the edge is antialiased — a hard-edged
            // ellipse over a face reads as a cut-out. Softening past one pixel is the feather
            // pass's job, on the GPU, where it belongs.
            let coverage = match mask.shape {
                MaskShape::Ellipse => {
                    let distance = (dx * dx + dy * dy).sqrt();
                    let scale = half.0.min(half.1).max(1.0);
                    (1.0 - (distance - 1.0) * scale).clamp(0.0, 1.0)
                }
                MaskShape::Rect => {
                    let inside_x = (1.0 - dx.abs()) * half.0;
                    let inside_y = (1.0 - dy.abs()) * half.1;
                    inside_x.min(inside_y).clamp(0.0, 1.0)
                }
            };
            let index = ((y * width + x) * 4) as usize;
            rgba[index] = 255;
            rgba[index + 1] = 255;
            rgba[index + 2] = 255;
            rgba[index + 3] = (coverage * 255.0).round() as u8;
        }
    }
    rgba
}

/// Test hook for [`rasterize_mask`].
pub fn rasterize_mask_for_test(mask: &bay_project::Mask, width: u32, height: u32) -> Vec<u8> {
    rasterize_mask(mask, width, height)
}

/// How a built-in look is named in an effect's `asset`, as opposed to a path on disk.
pub const LOOK_PREFIX: &str = "look:";

/// Grades in memory, by the name the effect gave — a built-in look or a `.cube` path.
///
/// Read once and held: a grade on twenty clips at thirty frames a second would otherwise open
/// and parse the same file six hundred times a second. A file that fails to parse is
/// remembered as a failure too, so a typo in a path does not retry the read every frame.
#[derive(Default)]
pub(crate) struct LutCache {
    tables: std::collections::HashMap<String, Option<std::sync::Arc<bay_effects::Lut3d>>>,
}

impl LutCache {
    /// Built-ins are checked first, and are not paths: `look:teal-orange` cannot be a filename,
    /// so the two namespaces cannot collide — and a project naming a built-in keeps working on
    /// a machine that has never downloaded anything.
    fn resolve(&mut self, asset: &str) -> Option<(String, std::sync::Arc<bay_effects::Lut3d>)> {
        let entry = self.tables.entry(asset.to_string()).or_insert_with(|| {
            if let Some(id) = asset.strip_prefix(LOOK_PREFIX) {
                return bay_effects::Look::by_id(id).map(|look| std::sync::Arc::new(look.to_lut()));
            }
            let text = std::fs::read_to_string(asset).ok()?;
            bay_effects::Lut3d::parse_cube(&text)
                .ok()
                .map(std::sync::Arc::new)
        });
        entry.clone().map(|table| (asset.to_string(), table))
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

/// The crop insets and scale that make a source **fill** a rectangle of the canvas.
///
/// `fit_contain` is unconditional on the render path, which is the right default — it never
/// distorts and never hides part of the picture. But a montage wants the opposite: a panel with
/// no letterbox in it, every frame the same shape, the source cropped to suit. That was being
/// done outside the editor entirely, by an ffmpeg pass per image
/// (`scale=…:force_original_aspect_ratio=increase,crop=…`) writing a normalised plate to disk
/// before import. Three videos were built that way.
///
/// The whole trick is that a crop changes the source's aspect, and `fit_contain` of something
/// whose aspect already matches the box fills it exactly. So: trim the source to the panel's
/// aspect, then choose the scale that makes the contained result the panel.
///
/// `panel_w`/`panel_h` are fractions of the canvas. Returns `(left, top, right, bottom, scale)`,
/// insets as fractions of the source. A source with no intrinsic size needs no crop.
pub fn cover_fit(
    natural: Option<(u32, u32)>,
    panel_w: f32,
    panel_h: f32,
    canvas_w: u32,
    canvas_h: u32,
) -> (f32, f32, f32, f32, f32) {
    // The scale is `max` because `fit_contain` picks the limiting axis for us: a panel wider
    // than it is tall is limited by width, a taller one by height, and after the crop the other
    // axis follows exactly.
    let scale = panel_w.max(panel_h);
    let Some((nw, nh)) = natural else {
        return (0.0, 0.0, 0.0, 0.0, scale);
    };
    if nw == 0 || nh == 0 || panel_w <= 0.0 || panel_h <= 0.0 || canvas_w == 0 || canvas_h == 0 {
        return (0.0, 0.0, 0.0, 0.0, scale);
    }
    let target = (panel_w * canvas_w as f32) / (panel_h * canvas_h as f32);
    let source = nw as f32 / nh as f32;

    // A crop of less than half a source pixel is not a crop. Panels are specified as canvas
    // fractions, so a panel meant to be exactly the source's shape almost never divides into one
    // — 1080×1121 against a panel of 0.584 canvas heights is out by 0.13 of a pixel. Reporting
    // that as a crop is noise in the project file and a lie in the timeline dump.
    let (side, axis_pixels) = if source > target {
        ((1.0 - target / source) / 2.0, nw as f32)
    } else {
        ((1.0 - source / target) / 2.0, nh as f32)
    };
    if side * axis_pixels < 0.5 {
        return (0.0, 0.0, 0.0, 0.0, scale);
    }
    if source > target {
        (side, 0.0, side, 0.0, scale) // wider than the panel: trim the sides
    } else {
        (0.0, side, 0.0, side, scale) // taller: trim top and bottom
    }
}

/// Test hook for [`fit_contain`] — the geometry is pure, so it is worth asserting directly
/// rather than only through rendered pixels.
pub fn fit_contain_for_test(natural: Option<(u32, u32)>, box_w: f32, box_h: f32) -> (f32, f32) {
    fit_contain(natural, box_w, box_h)
}

/// Replace any non-finite transform component with a safe default. NaN/inf reaching the
/// compositor panics `f32::clamp` and crashes the editor; a sane layer is a better outcome.
fn sanitise_transform(t: bay_project::Transform) -> bay_project::Transform {
    fn finite(value: f32, fallback: f32) -> f32 {
        if value.is_finite() { value } else { fallback }
    }
    bay_project::Transform {
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
        // `crop_rect` does its own sanitising, but the raw fields travel with the transform,
        // so they are cleaned here too rather than trusted downstream.
        crop_left: finite(t.crop_left, 0.0).clamp(0.0, 1.0),
        crop_top: finite(t.crop_top, 0.0).clamp(0.0, 1.0),
        crop_right: finite(t.crop_right, 0.0).clamp(0.0, 1.0),
        crop_bottom: finite(t.crop_bottom, 0.0).clamp(0.0, 1.0),
        // Past 90 degrees a card is edge-on and every point on it projects onto a line — the
        // picture is gone whatever the renderer does — so the lean is capped short of that.
        tilt_x: finite(t.tilt_x, 0.0).clamp(-MAX_TILT_DEGREES, MAX_TILT_DEGREES),
        tilt_y: finite(t.tilt_y, 0.0).clamp(-MAX_TILT_DEGREES, MAX_TILT_DEGREES),
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
    shape: &bay_project::ShapeKind,
    color: &str,
    gradient: Option<&bay_project::Gradient>,
    stroke: Option<&bay_project::Stroke>,
    width: u32,
    height: u32,
) -> Vec<u8> {
    use bay_project::ShapeKind;

    let [r, g, b] = hex_to_rgb8(color);
    // A gradient replaces the flat fill. Resolved once here rather than per texel: the ramp is
    // two colours and an angle, and the per-texel work is one dot product and a lerp.
    let ramp = gradient.map(|gradient| {
        let radians = gradient.angle.to_radians();
        (
            hex_to_rgb8(&gradient.from),
            hex_to_rgb8(&gradient.to),
            radians.cos(),
            radians.sin(),
        )
    });
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
            let mut coverage = (0.5 - distance).clamp(0.0, 1.0);
            // An outline is the band either side of the boundary. Same distance field, so a
            // rounded rect and an ellipse both get one without either being special-cased.
            if let Some(stroke) = stroke {
                let half = (stroke.width.max(0.0) * short).max(0.5);
                coverage = (0.5 - (distance.abs() - half)).clamp(0.0, 1.0);
                // Dashes run along the longer axis, which is what a connector is.
                if let Some(dash) = stroke.dash.filter(|dash| *dash > 0.0) {
                    let gap = stroke.gap.unwrap_or(dash).max(0.0);
                    let period = dash + gap;
                    if period > 0.0 {
                        let (along, extent) = if half_w >= half_h {
                            (dx + half_w, half_w * 2.0)
                        } else {
                            (dy + half_h, half_h * 2.0)
                        };
                        let phase = (along / extent / period).fract().abs();
                        if phase > dash / period {
                            coverage = 0.0;
                        }
                    }
                }
            }
            if coverage <= 0.0 {
                continue;
            }
            let alpha = (coverage * 255.0).round() as u8;
            let index = ((py * width + px) * 4) as usize;
            let [r, g, b] = match stroke {
                Some(stroke) => hex_to_rgb8(&stroke.color),
                None => [r, g, b],
            };
            let [fr, fg, fb] = match ramp {
                None => [r, g, b],
                Some(([ar, ag, ab], [br, bg, bb], cos, sin)) => {
                    // Project the texel onto the ramp's axis and normalise to 0..1 across the
                    // shape's extent along that axis, so the ramp spans the shape whatever its
                    // aspect and whichever way it points.
                    let extent = (half_w * cos).abs() + (half_h * sin).abs();
                    let t = if extent > 0.0 {
                        ((dx * cos + dy * sin) / (2.0 * extent) + 0.5).clamp(0.0, 1.0)
                    } else {
                        0.5
                    };
                    let mix = |a: u8, b: u8| {
                        (f32::from(a) + (f32::from(b) - f32::from(a)) * t).round() as u8
                    };
                    [mix(ar, br), mix(ag, bg), mix(ab, bb)]
                }
            };
            rgba[index] = fr;
            rgba[index + 1] = fg;
            rgba[index + 2] = fb;
            rgba[index + 3] = alpha;
        }
    }
    rgba
}

/// Test hook for [`rasterize_shape`] — the coverage maths is pure and worth asserting directly.
pub fn rasterize_shape_for_test(
    shape: &bay_project::ShapeKind,
    color: &str,
    gradient: Option<&bay_project::Gradient>,
    stroke: Option<&bay_project::Stroke>,
    width: u32,
    height: u32,
) -> Vec<u8> {
    rasterize_shape(shape, color, gradient, stroke, width, height)
}

/// The cache key for one rasterised shape.
///
/// **Everything that changes the pixels has to be in here.** The fill was, once the gradient
/// arrived; the stroke was not, and the failure that produced is worse than a wrong ramp. An
/// outlined panel and a filled bar of the same colour, kind and raster size hashed identically,
/// so whichever rasterised first served both: a red boundary box drew as a solid red plate over
/// the whole frame, and a solid mark came out as a hollow ring. Nothing errored — the picture
/// was simply wrong, and only in a project that happened to contain both.
pub fn shape_raster_key(
    shape: &bay_project::ShapeKind,
    color: &str,
    gradient: Option<&bay_project::Gradient>,
    stroke: Option<&bay_project::Stroke>,
    raster_w: u32,
    raster_h: u32,
) -> String {
    use bay_project::ShapeKind;
    let fill = match gradient {
        None => color.to_string(),
        Some(gradient) => format!(
            "{}>{}@{}",
            gradient.from,
            gradient.to,
            gradient.angle.to_bits()
        ),
    };
    let fill = match stroke {
        None => fill,
        Some(stroke) => format!(
            "{fill}|stroke:{}:{}:{}:{}",
            stroke.color,
            stroke.width.to_bits(),
            stroke.dash.map_or(0, f32::to_bits),
            stroke.gap.map_or(0, f32::to_bits),
        ),
    };
    match shape {
        ShapeKind::Rect { radius } => {
            format!(
                "shape:rect:{}:{fill}:{raster_w}x{raster_h}",
                radius.to_bits()
            )
        }
        ShapeKind::Ellipse => format!("shape:ellipse:{fill}:{raster_w}x{raster_h}"),
    }
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
/// Largest side an export will decode at.
///
/// 16384 is the ceiling real codec levels allow, so no genuine file is affected; it exists to
/// bound what a *claimed* dimension can cost. One 16384x16384 RGBA frame is ~1 GB, which is
/// survivable — the 100000x100000 a corrupt header can declare is not.
const EXPORT_MAX_DIMENSION: u32 = 16384;

/// Fallback decode size when the clip cannot be probed.
const VIDEO_FALLBACK_W: u32 = 320;
const VIDEO_FALLBACK_H: u32 = 180;

/// What a decode is *for*. Preview and export want opposite things from the same source, and
/// for a long time they shared one plan — so every export was composited from a ≤480px,
/// possibly 2 fps cache and then upscaled to the export size. A 4K export was not 4K.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum DecodeIntent {
    /// Interactive preview: the whole clip decoded once, small, and indexed by time so scrubbing
    /// is instant. Bounded by [`VIDEO_MEMORY_BUDGET`] because it lives in RAM.
    Preview,
    /// Export: source resolution at the delivered frame rate, **streamed**. No memory budget
    /// applies because no whole clip is ever resident — a 4K clip cannot fit one and must not try.
    Export { fps: f32 },
}

/// The outcome of [`plan_decode`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DecodePlan {
    pub width: u32,
    pub height: u32,
    pub fps: f32,
    /// How many frames to ask ffmpeg for. `None` under [`DecodeIntent::Export`]: the stream is
    /// bounded by the clip itself, not by a memory ceiling.
    pub max_frames: Option<u32>,
}

/// Choose decode dimensions, sample rate and frame count for a clip.
///
/// `natural` is the source's **coded** size and `rotation` its display-matrix rotation. ffmpeg
/// autorotates on decode, so a 90°/270° clip arrives transposed — planning against the coded
/// size would squash it into a landscape buffer, which is exactly the stretch bug this whole
/// change set is about. Pure so the budget policy is unit-testable.
fn plan_decode(
    natural: (u32, u32),
    rotation: i32,
    duration_secs: f64,
    intent: DecodeIntent,
) -> DecodePlan {
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

    // Export takes the source as it is. There is no downscale to undo later and no frame-rate
    // floor to smear frames across, because nothing is being held in memory to justify either.
    //
    // "As it is" still needs a ceiling. These dimensions come from ffprobe reading container
    // metadata, which is a claim rather than a measurement: a corrupt or crafted file can
    // declare 100000x100000, and a stream buffer sized from that is a 40 GB allocation and an
    // abort — on a path whose whole rule is that bad input must degrade, not abort. The preview
    // plan never had this exposure because it clamped to 480 anyway.
    if let DecodeIntent::Export { fps } = intent {
        let clamp = |v: u32| v.min(EXPORT_MAX_DIMENSION);
        return DecodePlan {
            width: clamp(even(nw as f32)),
            height: clamp(even(nh as f32)),
            fps: if fps.is_finite() && fps > 0.0 {
                fps
            } else {
                VIDEO_MAX_FPS
            },
            max_frames: None,
        };
    }

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

    DecodePlan {
        width: w,
        height: h,
        fps,
        max_frames: Some(frames),
    }
}

/// Test hook for the **preview** plan. Deliberately keeps its original tuple shape and
/// arguments so the budget-policy tests that pin today's behaviour need no edit at all: if
/// adding an export intent changed a single preview number, that is a regression, and a test
/// that had to be adjusted to keep passing would have hidden it.
pub fn plan_decode_for_test(
    natural: (u32, u32),
    rotation: i32,
    duration_secs: f64,
) -> (u32, u32, f32, u32) {
    let plan = plan_decode(natural, rotation, duration_secs, DecodeIntent::Preview);
    (
        plan.width,
        plan.height,
        plan.fps,
        plan.max_frames.unwrap_or(0),
    )
}

/// Test hook: read frames from an export stream at the given source times, in the order given.
///
/// `ClipStream` is private and export only ever walks forward, so the backward-seek branch has
/// no route through `export_video` at all. That is exactly why it needs a hook: an unreachable
/// branch is still a branch, and this one silently seeked to the wrong frame until it was
/// driven directly.
///
/// Returns the mean luma of each frame, or `None` where no frame could be produced.
pub fn clip_stream_samples_for_test(path: &str, fps: f32, at_seconds: &[f64]) -> Vec<Option<f64>> {
    let (natural, rotation, duration) = match probe::probe_media(path) {
        Ok(meta) => (
            (meta.width, meta.height),
            meta.rotation,
            meta.duration.to_seconds_f64(),
        ),
        Err(_) => ((VIDEO_FALLBACK_W, VIDEO_FALLBACK_H), 0, 10.0),
    };
    let plan = plan_decode(natural, rotation, duration, DecodeIntent::Export { fps });
    let start = at_seconds.first().copied().unwrap_or(0.0);
    let Some(mut stream) = ClipStream::open(path, plan, start) else {
        return at_seconds.iter().map(|_| None).collect();
    };
    at_seconds
        .iter()
        .map(|seconds| {
            stream.frame_at(*seconds).map(|(_, _, rgba)| {
                // RGBA in, so step by 4 and average the red channel — the fixtures are grey.
                let sum: f64 = rgba.iter().step_by(4).map(|v| *v as f64).sum();
                sum / (rgba.len() as f64 / 4.0)
            })
        })
        .collect()
}

/// Test hook for the **export** plan.
pub fn plan_export_decode_for_test(
    natural: (u32, u32),
    rotation: i32,
    duration_secs: f64,
    fps: f32,
) -> DecodePlan {
    plan_decode(
        natural,
        rotation,
        duration_secs,
        DecodeIntent::Export { fps },
    )
}

/// The ffmpeg arguments shared by both decode paths.
///
/// One builder because the whole-clip decode and the export stream differ *only* in size, rate
/// and seek — everything else (hwaccel, pixel format, loglevel) must stay identical or the two
/// paths quietly drift into producing different pixels from the same source.
///
/// # Seeking, and why it is a plain input seek
///
/// This matters more than it looks. The cached preview path applies `trim_start` by *indexing
/// into decoded frames*, which is exact. A streamed export seeks instead, so a seek that landed
/// on the nearest keyframe rather than the requested frame would shift every trimmed clip in
/// every export — a quieter bug than the upscaling this replaced, and a worse one.
///
/// The classic workaround is a two-stage seek: a coarse input seek to a keyframe a little early,
/// then an exact output seek for the remainder. It is unnecessary. `-accurate_seek` is ffmpeg's
/// default when transcoding and decodes-and-discards from the keyframe to the requested position
/// already. Measured against a source with keyframes 3s apart and scene-cut detection off, a
/// plain `-ss 2.5` returns the frame at 2.5s, not the keyframe at 0s.
///
/// So the two-stage version was written, measured, and deleted: it bought no accuracy and cost a
/// redundant decode-and-discard on every stream open. `-accurate_seek` is passed explicitly
/// rather than relied on as a default.
///
/// `a_trimmed_clip_exports_from_the_frame_it_was_trimmed_to` is the executable form of this.
fn decode_args(path: &str, plan: &DecodePlan, seek_to: Option<f64>) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-nostdin".into(),
        "-loglevel".into(),
        "error".into(),
        // Offload decode to the GPU when possible (VideoToolbox on macOS); ffmpeg falls back to
        // software automatically if no hardware decoder fits the input.
        "-hwaccel".into(),
        "auto".into(),
    ];

    // An accurate input seek — see the seeking note above.
    if let Some(target) = seek_to.filter(|t| *t > 0.0) {
        args.push("-accurate_seek".into());
        args.push("-ss".into());
        args.push(format!("{target}"));
    }

    args.push("-i".into());
    args.push(path.into());

    args.push("-r".into());
    args.push(format!("{}", plan.fps));
    // `-s` is always passed, including for export. For export it is the source's own size
    // rounded to even (yuv420p cannot encode an odd side), so it is a no-op on ordinary
    // footage and a 1-pixel adjustment on the rare odd-dimensioned source.
    args.push("-s".into());
    args.push(format!("{}x{}", plan.width, plan.height));
    if let Some(max_frames) = plan.max_frames {
        args.push("-frames:v".into());
        args.push(max_frames.to_string());
    }
    args.push("-f".into());
    args.push("rawvideo".into());
    args.push("-pix_fmt".into());
    args.push("rgba".into());
    args.push("pipe:1".into());
    args
}

/// One video clip's frames, streamed at source resolution for an export.
///
/// Holds exactly **one** frame, not the clip: a 4K RGBA frame is 33 MB, so a whole 60s clip
/// would be ~200 GB. That is precisely why the cached path caps itself at 480px, and why export
/// streams instead of asking for a bigger budget.
///
/// Export walks the timeline forward, so `frame_at` is a forward scan; a backward request
/// respawns ffmpeg at the new position rather than pretending it cannot happen.
struct ClipStream {
    path: String,
    plan: DecodePlan,
    child: std::process::Child,
    stdout: std::io::BufReader<std::process::ChildStdout>,
    /// Source time of the stream's first frame.
    origin_seconds: f64,
    /// Index (from `origin_seconds`) of the frame `buffer` currently holds, once `primed`.
    index: u64,
    buffer: Vec<u8>,
    primed: bool,
    /// The source ran out. Hold the last frame rather than dropping to a placeholder mid-export.
    exhausted: bool,
}

impl ClipStream {
    /// Spawn a decoder positioned at `start_seconds` of the source.
    fn open(path: &str, plan: DecodePlan, start_seconds: f64) -> Option<Self> {
        let seek = (start_seconds > 0.0).then_some(start_seconds);
        let mut child = bay_paths::tools::command(bay_paths::tools::Tool::Ffmpeg)
            .ok()?
            .args(decode_args(path, &plan, seek))
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .ok()?;
        let stdout = child.stdout.take()?;
        // Checked, because a dimension pair that survived the clamp can still multiply past
        // usize on a 32-bit target, and a wrapped length would desynchronise `read_exact`
        // against the real frame size rather than failing.
        let frame_bytes = (plan.width as usize)
            .checked_mul(plan.height as usize)
            .and_then(|pixels| pixels.checked_mul(4))?;
        Some(Self {
            path: path.to_string(),
            plan,
            child,
            // One frame of buffering, so a 33 MB frame is one read rather than thousands of
            // small ones.
            stdout: std::io::BufReader::with_capacity(frame_bytes.clamp(64 << 10, 8 << 20), stdout),
            origin_seconds: start_seconds.max(0.0),
            index: 0,
            buffer: vec![0u8; frame_bytes],
            primed: false,
            exhausted: false,
        })
    }

    /// Pull the next frame off the pipe into `buffer`. `false` once the source is exhausted.
    fn advance(&mut self) -> bool {
        if self.exhausted {
            return false;
        }
        match std::io::Read::read_exact(&mut self.stdout, &mut self.buffer) {
            Ok(()) => {
                if self.primed {
                    self.index += 1;
                }
                self.primed = true;
                true
            }
            // A short final read is a truncated frame, not a usable one.
            Err(_) => {
                self.exhausted = true;
                false
            }
        }
    }

    /// The frame covering `source_seconds`, decoded at source resolution.
    fn frame_at(&mut self, source_seconds: f64) -> Option<(u32, u32, &[u8])> {
        let mut wanted = (((source_seconds - self.origin_seconds) * self.plan.fps as f64).floor())
            .max(0.0) as u64;

        // Backward seek: respawn rather than rewinding a pipe that cannot be rewound. Assigning
        // through `*self` drops the old stream, which kills its ffmpeg child.
        if self.primed && wanted < self.index {
            let restarted = Self::open(&self.path, self.plan, source_seconds)?;
            *self = restarted;
            // The replacement starts AT source_seconds, so what we want is its very first
            // frame. Keeping the index computed against the OLD origin would skip that many
            // frames into the new stream — a silent seek to the wrong place.
            wanted = 0;
        }

        while !self.primed || self.index < wanted {
            if !self.advance() {
                break;
            }
        }
        if !self.primed {
            return None;
        }
        Some((self.plan.width, self.plan.height, &self.buffer))
    }
}

impl Drop for ClipStream {
    /// An export with eight video clips runs eight decoders plus the encoder. Without this they
    /// outlive a cancelled or failed export — the same leak class as a sidecar that outlives its
    /// parent, and just as easy to close.
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// The decoders an export has open, one per video element, opened on first use and closed once
/// the timeline has moved past the element that needed them.
#[derive(Default)]
struct ExportStreams {
    open: std::collections::HashMap<String, ClipStream>,
    /// Elements whose decoder could not be started. Remembered so a broken path costs one failed
    /// spawn rather than one per exported frame.
    failed: HashSet<String>,
    fps: f32,
}

impl ExportStreams {
    fn new(fps: f32) -> Self {
        Self {
            fps,
            ..Default::default()
        }
    }

    /// Frame for `element_id` at `source_seconds`, opening its decoder if this is the first ask.
    fn frame_at(
        &mut self,
        element_id: &str,
        path: &str,
        source_seconds: f64,
    ) -> Option<(u32, u32, &[u8])> {
        if self.failed.contains(element_id) {
            return None;
        }
        if !self.open.contains_key(element_id) {
            let (natural, rotation, duration) = match probe::probe_media(path) {
                Ok(meta) => (
                    (meta.width, meta.height),
                    meta.rotation,
                    meta.duration.to_seconds_f64(),
                ),
                Err(_) => ((VIDEO_FALLBACK_W, VIDEO_FALLBACK_H), 0, 10.0),
            };
            let plan = plan_decode(
                natural,
                rotation,
                duration,
                DecodeIntent::Export { fps: self.fps },
            );
            match ClipStream::open(path, plan, source_seconds) {
                Some(stream) => {
                    self.open.insert(element_id.to_string(), stream);
                }
                None => {
                    self.failed.insert(element_id.to_string());
                    return None;
                }
            }
        }
        self.open.get_mut(element_id)?.frame_at(source_seconds)
    }

    /// Close decoders for elements that are no longer on screen, so a long timeline does not
    /// accumulate one ffmpeg process per clip it has ever shown.
    fn retain_only(&mut self, live: &HashSet<String>) {
        self.open.retain(|id, _| live.contains(id));
    }
}

/// Where [`PreviewRenderer::render_inner`] gets video pixels from. Named rather than a bare
/// `Option` because the two are a real policy choice, not a present/absent flag.
enum FrameSource<'a> {
    /// Preview: the whole clip, decoded once at preview size, indexed by time.
    Cache,
    /// Export: source-resolution frames streamed in timeline order.
    Streams(&'a mut ExportStreams),
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
    /// Parsed `.cube` grades, read once per file.
    luts: LutCache,
    /// Ready clips in least-recently-used order, for eviction under the global byte budget.
    video_lru: std::collections::VecDeque<String>,
    /// Content+style keys of text textures already rasterised and uploaded, so unchanged text
    /// isn't re-shaped every frame. `order` is the eviction queue for the [`TEXT_CACHE_CAP`] LRU.
    raster_keys: HashSet<String>,
    raster_order: std::collections::VecDeque<String>,
}

/// The container the picture and sound are wrapped in — as opposed to what is on the timeline.
///
/// Before this existed the encoder was invoked with `-pix_fmt yuv420p` and nothing else, so
/// every export took libx264's defaults whatever it was for: no way to ask for a smaller file,
/// a better one, an alpha-capable codec, or a level a phone would play at a sensible volume.
#[derive(Debug, Clone, PartialEq)]
pub struct ExportSettings {
    pub codec: VideoCodec,
    /// Constant-quality target. Lower is better and larger: 18 is visually lossless for H.264,
    /// 23 is ffmpeg's own default, past 28 gradients start to band. Ignored by ProRes, which
    /// is quality-fixed by its profile.
    pub quality: u32,
    /// Seconds into the timeline at which the export starts. Everything before is not encoded,
    /// and the sound is shifted to match.
    pub start_seconds: f64,
    /// Normalise the mix towards a loudness target rather than exporting whatever level the
    /// timeline happened to sum to.
    ///
    /// On by default because the platforms these files are posted to all normalise anyway, and
    /// a mix that arrives quiet gets turned *up* by the platform along with its noise floor.
    /// One-pass `loudnorm`, so it is an approximation — good to about a dB, which is far
    /// closer than nothing.
    pub loudness_lufs: Option<f64>,
    pub audio_bitrate_kbps: u32,
    /// Written into the container's `comment` tag.
    ///
    /// This exists for one caller: a render that went ahead over a gating check carries the
    /// reason it was allowed to. A claim that lives only in a chat log is not a claim anybody
    /// can check later, so it travels with the file.
    pub metadata_comment: Option<String>,
}

impl Default for ExportSettings {
    fn default() -> Self {
        Self {
            codec: VideoCodec::H264,
            quality: 20,
            start_seconds: 0.0,
            // -14 LUFS is what Instagram, TikTok, YouTube and Spotify all normalise towards.
            loudness_lufs: Some(-14.0),
            audio_bitrate_kbps: 192,
            metadata_comment: None,
        }
    }
}

/// The video codecs bay can ask ffmpeg for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoCodec {
    /// Plays everywhere. The right answer unless there is a reason.
    H264,
    /// Half the bitrate for the same quality, and not every player takes it.
    Hevc,
    /// An editing codec: huge files, no generation loss, what you hand to someone else's
    /// timeline.
    ProRes,
}

impl VideoCodec {
    pub fn from_wire(name: &str) -> Option<Self> {
        match name {
            "h264" => Some(Self::H264),
            "hevc" | "h265" => Some(Self::Hevc),
            "prores" => Some(Self::ProRes),
            _ => None,
        }
    }

    pub fn wire_name(self) -> &'static str {
        match self {
            Self::H264 => "h264",
            Self::Hevc => "hevc",
            Self::ProRes => "prores",
        }
    }

    /// The encoder arguments for this codec at `quality`, and the pixel format that goes with
    /// it. `yuv420p` is what every consumer player expects; ProRes wants a 10-bit 4:2:2 layout
    /// and would otherwise be pointless.
    fn encoder_args(self, quality: u32) -> Vec<String> {
        let quality = quality.min(51).to_string();
        match self {
            Self::H264 => vec![
                "-c:v".into(),
                "libx264".into(),
                "-crf".into(),
                quality,
                "-preset".into(),
                "medium".into(),
                // Without this a phone or a browser may refuse the file outright.
                "-profile:v".into(),
                "high".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
            ],
            Self::Hevc => vec![
                "-c:v".into(),
                "libx265".into(),
                "-crf".into(),
                quality,
                "-preset".into(),
                "medium".into(),
                // QuickTime will not open an HEVC file without this tag.
                "-tag:v".into(),
                "hvc1".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
            ],
            Self::ProRes => vec![
                "-c:v".into(),
                "prores_ks".into(),
                "-profile:v".into(),
                "3".into(), // 422 HQ
                "-pix_fmt".into(),
                "yuv422p10le".into(),
            ],
        }
    }
}

/// The delivery targets worth having a name for, and what each one actually wants.
///
/// A preset is a *starting point*, not a lock: every field it sets can be overridden. It exists
/// because "what CRF should a TikTok be?" is a question nobody should have to answer twice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportPreset {
    /// Instagram Reels, TikTok, YouTube Shorts — vertical, watched on a phone, normalised hard
    /// by the platform.
    Social,
    /// Landscape YouTube. A little more bitrate, because the second encode is the platform's.
    Youtube,
    /// Handing the file to another editor: no generation loss, no loudness processing.
    Master,
}

impl ExportPreset {
    pub fn from_wire(name: &str) -> Option<Self> {
        match name {
            "social" | "reel" | "tiktok" | "shorts" => Some(Self::Social),
            "youtube" => Some(Self::Youtube),
            "master" | "prores" => Some(Self::Master),
            _ => None,
        }
    }

    pub fn settings(self) -> ExportSettings {
        match self {
            Self::Social => ExportSettings {
                codec: VideoCodec::H264,
                quality: 20,
                loudness_lufs: Some(-14.0),
                audio_bitrate_kbps: 192,
                ..ExportSettings::default()
            },
            Self::Youtube => ExportSettings {
                codec: VideoCodec::H264,
                quality: 18,
                loudness_lufs: Some(-14.0),
                audio_bitrate_kbps: 256,
                ..ExportSettings::default()
            },
            Self::Master => ExportSettings {
                codec: VideoCodec::ProRes,
                quality: 0,
                // A master is handed on for more work; normalising it would bake in a decision
                // the next person has to undo.
                loudness_lufs: None,
                audio_bitrate_kbps: 320,
                ..ExportSettings::default()
            },
        }
    }
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
            luts: LutCache::default(),
            video_lru: std::collections::VecDeque::new(),
            raster_keys: HashSet::new(),
            raster_order: std::collections::VecDeque::new(),
        })
    }

    /// Rasterise + upload a text texture keyed by its content/style, reusing the cached texture
    /// when the exact same text was drawn before. Evicts the least-recently inserted entry (and
    /// releases its GPU texture) once the cache is full. Returns the texture id (the key).
    ///
    /// `None` when the rasterizer handed back a buffer that disagrees with its own dimensions.
    /// The caller drops that one layer and still draws the frame — a bad raster must not take
    /// the editor down with it.
    fn ensure_text_texture(
        &mut self,
        element_id: &str,
        content: &str,
        font_px: f32,
        color: &str,
        size: (u32, u32),
        style: &bay_text::TextStyle<'_>,
    ) -> Option<String> {
        let (tw, th) = size;
        let key = format!(
            "text:{element_id}:{color}:{font}:{tw}x{th}:{style_key}:{content}",
            font = font_px.to_bits(),
            style_key = style.cache_key(),
        );
        if self.raster_keys.contains(&key) {
            return Some(key);
        }
        let image = self
            .text
            .render_styled(content, font_px, color, tw, th, style);
        let texture =
            self.ctx
                .upload_rgba_texture(&image.rgba, image.width, image.height, "preview-text")?;
        self.compositor.upsert_texture(key.clone(), texture);
        self.remember_raster(key.clone());
        Some(key)
    }

    /// Upload (once) the RGBA raster for a shape+colour pair, returning its texture key.
    ///
    /// Shares the text raster LRU: both are CPU-rasterized, content-addressed textures, and a
    /// shape key can never collide with a text key because of the `shape:`/`text:` prefixes.
    /// The raster is square and gets stretched by the layer quad, so one texture serves a bar
    /// at any width.
    ///
    /// `None` on a mis-sized raster, for the same reason as [`Self::ensure_text_texture`].
    fn ensure_shape_texture(
        &mut self,
        shape: &bay_project::ShapeKind,
        color: &str,
        gradient: Option<&bay_project::Gradient>,
        stroke: Option<&bay_project::Stroke>,
        aspect: f32,
    ) -> Option<String> {
        use bay_project::ShapeKind;
        // A square-cornered rect has no curvature at all, so one tiny tile serves every size
        // and aspect. Anything curved must be rasterized at the layer's own aspect or the
        // quad's non-uniform stretch turns its round corners into ellipses. An OUTLINE has
        // curvature everywhere — its border is a fraction of the shorter side, and an 8x8 tile
        // stretched to a full-width panel would draw a border hundreds of pixels thick on two
        // sides and hairline on the other two.
        let (raster_w, raster_h) = match shape {
            ShapeKind::Rect { radius } if *radius <= 0.0 && stroke.is_none() => (8, 8),
            _ => shape_raster_dimensions(aspect),
        };
        let key = shape_raster_key(shape, color, gradient, stroke, raster_w, raster_h);
        if self.raster_keys.contains(&key) {
            return Some(key);
        }
        let rgba = rasterize_shape(shape, color, gradient, stroke, raster_w, raster_h);
        let texture = self
            .ctx
            .upload_rgba_texture(&rgba, raster_w, raster_h, "preview-shape")?;
        self.compositor.upsert_texture(key.clone(), texture);
        self.remember_raster(key.clone());
        Some(key)
    }

    /// Rasterise a mask shape into a frame-sized coverage texture: opaque where the clip
    /// shows, transparent where it does not.
    ///
    /// Frame-sized because the compositor feathers and applies masks in frame space — a mask
    /// is a stencil over the canvas, not over the layer, which is what lets one cut across a
    /// rotated or scaled clip without inheriting its geometry. Cached like every other raster,
    /// so a static vignette is drawn once rather than per frame.
    fn ensure_mask_texture(
        &mut self,
        mask: &bay_project::Mask,
        width: u32,
        height: u32,
    ) -> Option<String> {
        let key = format!(
            "mask:{:?}:{}:{}:{}:{}:{width}x{height}",
            mask.shape,
            mask.x.to_bits(),
            mask.y.to_bits(),
            mask.width.to_bits(),
            mask.height.to_bits(),
        );
        if self.raster_keys.contains(&key) {
            return Some(key);
        }
        let rgba = rasterize_mask(mask, width, height);
        let texture = self
            .ctx
            .upload_rgba_texture(&rgba, width, height, "preview-mask")?;
        self.compositor.upsert_texture(key.clone(), texture);
        self.remember_raster(key.clone());
        Some(key)
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
                .upload_rgba_texture(&rgba.into_raw(), width, height, "preview-image")?;
        self.compositor
            .upsert_texture(media_id.to_string(), texture);
        self.uploaded_media
            .insert(media_id.to_string(), (width, height));
        Some((media_id.to_string(), (width, height)))
    }

    /// Upload an 8×8 solid placeholder for an element and return its texture id.
    ///
    /// The buffer is built here at a fixed 8×8, so the upload cannot fail on size — but the
    /// signature stays honest rather than unwrapping a value it happens to know is `Some`.
    fn upload_solid_placeholder(&mut self, element: &Element) -> Option<String> {
        let texture = self.ctx.upload_rgba_texture(
            &solid_rgba(kind_color(element.kind())),
            8,
            8,
            "preview-solid",
        )?;
        self.compositor
            .upsert_texture(element.id().to_string(), texture);
        Some(element.id().to_string())
    }

    /// Encode the timeline to a video file by rendering each frame and piping raw RGBA to the
    /// ffmpeg CLI. Returns `false` if ffmpeg is unavailable or encoding fails. Blocks until done.
    /// Block until every video clip referenced by `scene` has finished decoding.
    ///
    /// The preview can draw a placeholder while a worker decodes, but an export cannot — a
    /// placeholder would be baked into the output file. Export therefore waits.
    pub fn await_decodes(&mut self, scene: &Scene, media: &[MediaAsset]) {
        let _ = self.await_decodes_checked(scene, media);
    }

    /// Block until every referenced preview clip is decoded, and say when one could not be.
    ///
    /// Measurement callers use this checked form because a placeholder is an honest interactive
    /// preview fallback but is not evidence. Keeping the unchecked wrapper above preserves the
    /// UI's existing fire-and-poll behaviour.
    pub fn await_decodes_checked(
        &mut self,
        scene: &Scene,
        media: &[MediaAsset],
    ) -> Result<(), String> {
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
                if !matches!(
                    self.video_cache.get(&video.media_id),
                    Some(ClipState::Ready(_))
                ) {
                    let source = path.as_deref().unwrap_or("<unregistered media>");
                    return Err(format!(
                        "video media {:?} could not be decoded from {source:?}",
                        video.media_id
                    ));
                }
            }
        }
        Ok(())
    }

    /// Encoding needs the whole frame description; bundling these into a struct would add
    /// indirection at the single call site without clarifying anything.
    ///
    /// Renders every frame of the timeline and encodes an MP4 at `out_path`, mixing the audio
    /// lanes onto the picture.
    ///
    /// Encodes to a `.part` sibling and renames on success, so `out_path` either does not exist
    /// or is a complete file. A partial write used to be left at the destination, where nothing
    /// distinguished it from a good export.
    ///
    /// The `Err` carries ffmpeg's own stderr where there is any, because "is ffmpeg installed?"
    /// is the wrong question for a codec failure.
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
        settings: &ExportSettings,
    ) -> Result<(), String> {
        self.export_video_observed(
            scene,
            duration_seconds,
            fps,
            width,
            height,
            background,
            media,
            out_path,
            settings,
            &mut |_, _| true,
        )
    }

    /// [`Self::export_video`], reporting progress and able to stop.
    ///
    /// `on_frame(done, total)` is called once per encoded frame; returning `false` cancels the
    /// export, which deletes the staging file rather than leaving a partial one behind. This is
    /// what turns a four-minute render from an opaque wait into something with a bar and a stop
    /// button — and it is a per-frame check because that is the only boundary an encode has.
    #[allow(clippy::too_many_arguments)]
    pub fn export_video_observed(
        &mut self,
        scene: &Scene,
        duration_seconds: f64,
        fps: f64,
        width: u32,
        height: u32,
        background: &Background,
        media: &[MediaAsset],
        out_path: &str,
        settings: &ExportSettings,
        on_frame: &mut dyn FnMut(u64, u64) -> bool,
    ) -> Result<(), String> {
        use std::io::Write;

        let start_seconds = settings.start_seconds.max(0.0);

        // Every audible clip on the audio lanes, resolved to a file on disk. Until this
        // existed, `export_video` piped a single rawvideo input and never read `tracks.audio`
        // at all — every export was silent, which made the editor unable to produce the one
        // thing a social reel is: picture cut to music.
        let audio_clips =
            clips_in_range(audible_clips(scene, media), start_seconds, duration_seconds);

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
                    "[{input}:a]atrim=start={start:.4}:duration={source_duration:.4},\
                     asetpts=PTS-STARTPTS,{processing}{volume},\
                     atrim=duration={duration:.4},{fades}adelay={delay_ms}:all=1[a{index}];",
                    input = index + 1,
                    start = clip.trim_start_seconds,
                    source_duration = clip.duration_seconds * f64::from(clip.speed.max(0.01)),
                    duration = clip.duration_seconds,
                    processing = clip.processing_filters(),
                    volume = clip.volume_filter(),
                    // After the trim, so the tail fade is measured against the clip's real
                    // length, and before the delay, so `st` is clip-relative.
                    fades = clip.fade_filters(),
                    delay_ms = (clip.start_seconds * 1000.0).round() as i64,
                ));
            }
            for index in 0..audio_clips.len() {
                filters.push_str(&format!("[a{index}]"));
            }
            filters.push_str(&format!(
                "amix=inputs={count}:normalize=0:dropout_transition=0",
                count = audio_clips.len()
            ));
            // One-pass loudnorm. Two passes would measure first and be exact, but that means
            // decoding the whole mix twice; within about a dB is the difference between a reel
            // that arrives at a sensible level and one the platform turns up along with its
            // noise floor.
            if let Some(target) = settings.loudness_lufs {
                filters.push_str(&format!(",loudnorm=I={target:.1}:TP=-1.5:LRA=11"));
            }
            // `loudnorm` runs internally at 192 kHz and hands back 96 kHz, so a chain that ends
            // on it delivers a 96 kHz file — double the AAC bitrate for nothing, and a rate every
            // platform re-encodes anyway. `amix` separately takes its channel layout from its
            // FIRST input, so a mono narration clip placed before the bed collapsed the whole
            // mix to mono. Both were measured in shipped files. Pin the delivery format here,
            // after everything that could have changed it, rather than trusting the chain.
            filters.push_str(",aresample=48000,aformat=channel_layouts=stereo");
            // Pad the bed with silence, forever. `-shortest` below ends the file at the
            // shortest stream, and without this that stream is the audio whenever the last
            // audible clip stops before the picture does — an eight-second reel with a
            // 0.7 s stinger at 4.85 s came out 5.6 s long, missing its whole end card, and
            // ffmpeg reported success. Padding makes the audio effectively infinite, so the
            // picture is always the shortest stream and always the one that sets the length.
            // Placed after `loudnorm`, which must measure the real mix and not the silence.
            filters.push_str(",apad");
            filters.push_str("[aout]");

            args.push("-filter_complex".into());
            args.push(filters);
            args.push("-map".into());
            args.push("0:v".into());
            args.push("-map".into());
            args.push("[aout]".into());
            args.push("-c:a".into());
            args.push("aac".into());
            args.push("-b:a".into());
            args.push(format!("{}k", settings.audio_bitrate_kbps.clamp(32, 512)));
            // The picture defines the duration, in both directions: a bed that outlasts it is
            // cut here, and one that stops early was padded above so it cannot cut the picture.
            args.push("-shortest".into());
        }

        args.extend(settings.codec.encoder_args(settings.quality));
        // Travels with the file: a render that went ahead over a gating check says so in its own
        // metadata, where it outlives the session that authorised it.
        if let Some(comment) = settings.metadata_comment.as_deref() {
            args.push("-metadata".into());
            args.push(format!("comment={comment}"));
        }
        // Encode beside the destination, not at it. The pid keeps two concurrent exports of the
        // same path from clobbering each other's staging file.
        let part_path = staging_path(out_path);
        args.push(part_path.clone());

        let ffmpeg = bay_paths::tools::command(bay_paths::tools::Tool::Ffmpeg).map_err(|_| {
            // Resolution failed, not the encode. bay_paths has already looked everywhere it can.
            "ffmpeg was not found. Install it, or let bay install it for you with \
             runtime_install video."
                .to_string()
        })?;
        let mut ffmpeg = ffmpeg;
        let mut child = ffmpeg
            .args(&args)
            .stdin(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| {
                let _ = std::fs::remove_file(&part_path);
                format!("could not start ffmpeg: {e}")
            })?;
        // Drain stderr on its own thread. ffmpeg blocks once the pipe buffer fills, so reading it
        // only after `wait()` would deadlock on a chatty failure — which is exactly the case the
        // message matters for.
        let stderr_reader = child.stderr.take().map(|mut stderr| {
            std::thread::spawn(move || {
                let mut buf = String::new();
                let _ = std::io::Read::read_to_string(&mut stderr, &mut buf);
                buf
            })
        });
        let Some(mut stdin) = child.stdin.take() else {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_file(&part_path);
            return Err("could not open a pipe to ffmpeg".to_string());
        };

        // Export does NOT call await_decodes. That barrier exists so the *interactive* render
        // path never blocks on a decode; export instead streams every clip at source resolution,
        // and calling it here would kick off preview-intent decodes of clips export never reads.
        let mut streams = ExportStreams::new(fps as f32);

        let total_frames = (duration_seconds * fps).ceil().max(1.0) as u64;
        let mut failure: Option<String> = None;
        for index in 0..total_frames {
            // Frame 0 of the *file* is `start_seconds` into the timeline, which is what makes
            // this a ranged export rather than a full one with a trimmed head.
            let seconds = start_seconds + index as f64 / fps;
            let playhead = MediaTime::from_seconds_f64(seconds).unwrap_or(MediaTime::ZERO);
            // Close decoders for clips the playhead has left behind, so a long timeline does not
            // end up holding one ffmpeg process per clip it has ever shown.
            streams.retain_only(&live_video_elements(scene, playhead));
            // A frame the GPU could not produce must not be silently skipped: doing so would
            // shorten the output and shift every later frame's timing.
            let Some(frame) = self.render_inner(
                scene,
                playhead,
                width,
                height,
                background,
                media,
                FrameSource::Streams(&mut streams),
            ) else {
                failure = Some(format!(
                    "the GPU could not render frame {index} of {total_frames}"
                ));
                break;
            };
            let mut rgba = frame.bgra;
            for texel in rgba.chunks_exact_mut(4) {
                texel.swap(0, 2); // BGRA → RGBA for ffmpeg input
            }
            if let Err(e) = stdin.write_all(&rgba) {
                // Used to `break` and return whatever ffmpeg had written — a truncated MP4 at the
                // destination path, indistinguishable from a good one.
                failure = Some(format!("ffmpeg stopped accepting frames: {e}"));
                break;
            }
            if !on_frame(index + 1, total_frames) {
                failure = Some("cancelled".to_string());
                break;
            }
        }
        drop(stdin);

        let status = child.wait();
        let stderr = stderr_reader
            .and_then(|handle| handle.join().ok())
            .unwrap_or_default();

        if let Some(reason) = failure {
            let _ = std::fs::remove_file(&part_path);
            return Err(with_stderr(&reason, &stderr));
        }
        match status {
            Ok(status) if status.success() => {}
            Ok(status) => {
                let _ = std::fs::remove_file(&part_path);
                return Err(with_stderr(&format!("ffmpeg exited {status}"), &stderr));
            }
            Err(e) => {
                let _ = std::fs::remove_file(&part_path);
                return Err(with_stderr(
                    &format!("ffmpeg could not be waited on: {e}"),
                    &stderr,
                ));
            }
        }

        // Only now does the destination path come into existence, so a caller that finds a file
        // there knows ffmpeg wrote all of it.
        std::fs::rename(&part_path, out_path).map_err(|e| {
            let _ = std::fs::remove_file(&part_path);
            format!("could not move the finished export into place: {e}")
        })?;
        Ok(())
    }

    /// Composite `scene` at `playhead` into a `width × height` BGRA frame. `media` resolves image
    /// element `media_id`s to files on disk.
    ///
    /// `None` means **this frame could not be produced** — the compositor pass failed, or the
    /// readback did (device loss). It does not mean a layer was missing: a layer whose texture
    /// cannot be built is skipped and the rest of the frame still draws. Callers hold their last
    /// good frame rather than showing a lie.
    pub fn render(
        &mut self,
        scene: &Scene,
        playhead: MediaTime,
        width: u32,
        height: u32,
        background: &Background,
        media: &[MediaAsset],
    ) -> Option<PreviewFrame> {
        self.render_inner(
            scene,
            playhead,
            width,
            height,
            background,
            media,
            FrameSource::Cache,
        )
    }

    /// The one compositing implementation, shared by the preview and the export.
    ///
    /// Only where **video pixels** come from differs between the two, so that is the only thing
    /// `source` selects. Everything else — layer order, transforms, effects, masks, the readback
    /// — is common by construction rather than by discipline, which is what keeps an export from
    /// quietly diverging from what the preview showed.
    #[allow(clippy::too_many_arguments)]
    fn render_inner(
        &mut self,
        scene: &Scene,
        playhead: MediaTime,
        width: u32,
        height: u32,
        background: &Background,
        media: &[MediaAsset],
        mut source: FrameSource<'_>,
    ) -> Option<PreviewFrame> {
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
                let Some(transform) = scene.sampled_transform(element, local, playhead) else {
                    continue;
                };
                // A non-finite transform (NaN scale from a degenerate keyframe, say) would
                // propagate into f32::clamp and panic, taking the whole editor down. Skip the
                // layer instead — one missing layer beats a crashed app.
                let transform = sanitise_transform(transform);

                // Text → real glyphs; Image → decoded file (cached); others → solid placeholder.
                let (texture_id, natural_size, box_extra) = match element {
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
                        let active_word = text
                            .karaoke
                            .as_ref()
                            .and_then(|karaoke| karaoke.active_word(local));
                        let highlight = active_word
                            .and_then(|index| word_byte_range(&text.content, index))
                            .and_then(|(start, end)| {
                                text.karaoke
                                    .as_ref()
                                    .map(|karaoke| bay_text::HighlightStyle {
                                        start,
                                        end,
                                        color: karaoke.highlight_color.as_str(),
                                    })
                            });
                        // Cached by content/style, so static captions aren't re-shaped per frame.
                        let style =
                            bay_text::TextStyle {
                                family: text.font_family.as_deref(),
                                weight: text.font_weight,
                                align: match text.align {
                                    bay_project::TextAlign::Left => bay_text::TextAlign::Left,
                                    bay_project::TextAlign::Center => bay_text::TextAlign::Center,
                                    bay_project::TextAlign::Right => bay_text::TextAlign::Right,
                                },
                                letter_spacing: text.letter_spacing,
                                line_height: text.line_height,
                                stroke: text.decorations.as_ref().and_then(|decorations| {
                                    decorations.stroke.as_ref().map(|stroke| {
                                        bay_text::StrokeStyle {
                                            width: stroke.width,
                                            color: stroke.color.as_str(),
                                        }
                                    })
                                }),
                                shadow: text.decorations.as_ref().and_then(|decorations| {
                                    decorations.shadow.as_ref().map(|shadow| {
                                        bay_text::ShadowStyle {
                                            offset_x: shadow.offset_x,
                                            offset_y: shadow.offset_y,
                                            blur: shadow.blur,
                                            color: shadow.color.as_str(),
                                        }
                                    })
                                }),
                                plate: text.decorations.as_ref().and_then(|decorations| {
                                    decorations
                                        .plate
                                        .as_ref()
                                        .map(|plate| bay_text::PlateStyle {
                                            color: plate.color.as_str(),
                                            padding_x: plate.padding_x,
                                            padding_y: plate.padding_y,
                                            radius: plate.radius,
                                        })
                                }),
                                highlight,
                            };
                        let (margin_x, margin_y) = style.margins();
                        let raster_size = (
                            tw.saturating_add(margin_x.saturating_mul(2)),
                            th.saturating_add(margin_y.saturating_mul(2)),
                        );
                        // What is on screen this frame. A typing line re-shapes per prefix —
                        // it has to, because a line that will wrap does not know where until
                        // it gets there — so the raster cache holds one entry per character
                        // revealed. Bounded by the line's own length, and only for lines that
                        // asked to be typed.
                        let shown = match &text.type_on {
                            Some(spec) => std::borrow::Cow::Owned(
                                spec.revealed(&text.content, local.to_seconds_f64()),
                            ),
                            None => std::borrow::Cow::Borrowed(text.content.as_str()),
                        };
                        (
                            self.ensure_text_texture(
                                &text.id,
                                shown.as_ref(),
                                font_px,
                                &text.color,
                                (tw, th),
                                &style,
                            ),
                            Some(raster_size),
                            (margin_x as f32 * 2.0, margin_y as f32 * 2.0),
                        )
                    }
                    Element::Shape(shape) => {
                        // A shape has no natural size, so its final on-screen extent is known
                        // without consulting the texture — and the texture needs that aspect
                        // in order to keep its corners round under a non-uniform stretch.
                        let aspect = (transform.scale_x * width as f32)
                            / (transform.scale_y * height as f32).max(f32::EPSILON);
                        (
                            self.ensure_shape_texture(
                                &shape.shape,
                                &shape.color,
                                shape.gradient.as_ref(),
                                shape.stroke.as_ref(),
                                aspect,
                            ),
                            None,
                            (0.0, 0.0),
                        )
                    }
                    Element::Image(image_element) => {
                        match self.ensure_image_texture(&image_element.media_id, media) {
                            Some((texture_id, natural)) => {
                                (Some(texture_id), Some(natural), (0.0, 0.0))
                            }
                            None => (self.upload_solid_placeholder(element), None, (0.0, 0.0)),
                        }
                    }
                    Element::Video(video) => {
                        let media_id = video.media_id.clone();
                        let path = media
                            .iter()
                            .find(|m| m.id == media_id)
                            .map(|m| m.path.clone());
                        // How far into the SOURCE this timeline moment is.
                        let source_seconds = element
                            .source_time(local)
                            .unwrap_or(video.trim_start)
                            .to_seconds_f64();

                        let uploaded = match &mut source {
                            // Decode the clip once on a WORKER THREAD, then index frames by time.
                            // Doing this inline used to block the render path for the whole
                            // decode (~33s of frozen UI for a 10-minute clip).
                            FrameSource::Cache => {
                                self.poll_decode(&media_id, path.as_deref());
                                let frame = self
                                    .video_cache
                                    .get(&media_id)
                                    .and_then(|state| match state {
                                        ClipState::Ready(clip) => Some(clip),
                                        _ => None,
                                    })
                                    .and_then(|clip| {
                                        let index = ((source_seconds * clip.fps as f64).floor()
                                            as usize)
                                            .min(clip.frames.len().saturating_sub(1));
                                        clip.frames
                                            .get(index)
                                            .map(|rgba| (clip.width, clip.height, rgba.clone()))
                                    });
                                frame.and_then(|(w, h, rgba)| {
                                    self.ctx
                                        .upload_rgba_texture(&rgba, w, h, "preview-video")
                                        .map(|texture| (texture, w, h))
                                })
                            }
                            // Source-resolution frames, streamed. No clone: the frame is read
                            // straight out of the stream's single buffer into the texture.
                            FrameSource::Streams(streams) => path
                                .as_deref()
                                .and_then(|path| {
                                    streams.frame_at(element.id(), path, source_seconds)
                                })
                                .and_then(|(w, h, rgba)| {
                                    self.ctx
                                        .upload_rgba_texture(rgba, w, h, "export-video")
                                        .map(|texture| (texture, w, h))
                                }),
                        };

                        // A frame that is not ready, cannot be decoded, or whose byte count
                        // disagrees with its own dimensions all degrade the same way.
                        match uploaded {
                            Some((texture, w, h)) => {
                                self.compositor
                                    .upsert_texture(element.id().to_string(), texture);
                                (Some(element.id().to_string()), Some((w, h)), (0.0, 0.0))
                            }
                            None => (self.upload_solid_placeholder(element), None, (0.0, 0.0)),
                        }
                    }
                    _ => (self.upload_solid_placeholder(element), None, (0.0, 0.0)),
                };

                // No texture means this layer could not be built. Drop the layer, keep the frame.
                let Some(texture_id) = texture_id else {
                    continue;
                };

                // `scale` defines a box as a fraction of the canvas; a source with a natural
                // size is *fitted* inside that box (contain) so it keeps its aspect ratio.
                // Stretching every source to the box was a live rendering bug: a 16:9 clip and a
                // square image both filled the whole canvas.
                let (box_w, box_h) = (
                    (transform.scale * width as f32 + box_extra.0).max(1.0),
                    (transform.scale * height as f32 + box_extra.1).max(1.0),
                );
                // The visible source is what `contain` has to fit. Fitting the uncropped size
                // would letterbox the frame to the shape of a picture the crop just removed.
                let (_, _, crop_w, crop_h) = transform.crop_rect();
                let cropped_size = natural_size.map(|(w, h)| {
                    (
                        ((w as f32 * crop_w).round() as u32).max(1),
                        ((h as f32 * crop_h).round() as u32).max(1),
                    )
                });
                let (fit_w, fit_h) = fit_contain(cropped_size, box_w, box_h);
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

                // Rasterised before the descriptor is built: `ensure_mask_texture` borrows
                // `self` mutably, and the descriptor below holds a borrow of the element.
                let mask_descriptor = element.sampled_mask(local).and_then(|mask| {
                    let texture_id = self.ensure_mask_texture(&mask, width, height)?;
                    Some(LayerMaskDescriptor {
                        texture_id,
                        feather: mask.feather.max(0.0),
                        inverted: mask.inverted,
                    })
                });

                let effects = element.sampled_effects(local);
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
                        crop: transform.crop_rect(),
                        tilt_x_degrees: transform.tilt_x,
                        tilt_y_degrees: transform.tilt_y,
                    },
                    // The clip's own fade multiplies whatever opacity the transform (and any
                    // keyframes on it) asked for, rather than replacing it — a title can fade
                    // up while it is also animating its opacity, and neither cancels the other.
                    opacity: (transform.opacity * element.fade_gain(local)).clamp(0.0, 1.0),
                    blend_mode: blend_mode(element.blend_mode().unwrap_or_default()),
                    effect_pass_groups: effect_groups(&effects, &mut self.luts),
                    mask: mask_descriptor,
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

        // Read straight back as BGRA (what GPUI's RenderImage wants). On Metal this is the raw
        // native order, so there is no per-frame channel swizzle on the hot path.
        let bgra = match self.compositor.render_frame_to_texture(&self.ctx, &frame) {
            Ok(texture) => self.ctx.read_texture_bgra(&texture, width, height),
            Err(_) => None,
        };

        // Evict before the early return, so a failed frame cannot strand this frame's rasters
        // in the cache and shrink the budget available to the next one.
        self.evict_rasters(&in_use);

        Some(PreviewFrame {
            width,
            height,
            bgra: bgra?,
        })
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
    let plan = plan_decode(natural, rotation, duration_secs, DecodeIntent::Preview);
    let (decode_w, decode_h, fps) = (plan.width, plan.height, plan.fps);

    let output = bay_paths::tools::command(bay_paths::tools::Tool::Ffmpeg)
        .ok()?
        .args(decode_args(path, &plan, None))
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
    pub speed: f32,
    pub dialogue_chain: Option<bay_project::DialogueAudioChain>,
    /// Linear gain. 1.0 is unity. Constant when `gain_points` holds one point or none.
    pub volume: f32,
    /// The clip's level over its own length as `(seconds, gain)` — volume keyframes, taken
    /// from the same model function the preview mixer reads, so the export cannot duck in a
    /// different place than the room did.
    ///
    /// **Without the head and tail fades**, which [`AudibleClip::fade_filters`] applies
    /// separately. They are the same numbers either way; what differs is the resolution they
    /// are applied at, and a fade is the one thing here that cannot survive being rounded to
    /// an audio frame.
    pub gain_points: Vec<(f64, f32)>,
    /// Head fade, in seconds.
    pub fade_in_seconds: f64,
    /// Tail fade, in seconds.
    pub fade_out_seconds: f64,
}

/// How many points an ffmpeg `volume` expression may carry.
///
/// The expression is a nested `if()` chain, one level per point, and ffmpeg's parser accepts
/// **97** and rejects 98 — bisected against the real binary. Six eased volume keyframes
/// subdivide to 82 points and export; seven make 98 and the whole encode fails with "Missing
/// ')' or too many args". A duck of one narration line is four keys, so **two lines could not
/// be exported**, which is a complete explanation for a bed that was chopped into 13 clips with
/// stepped gains instead of being keyframed. 90 leaves room under the real limit.
const MAX_GAIN_EXPRESSION_POINTS: usize = 90;

/// How far the decimated polyline may sit from the one the model described, in dB.
///
/// 0.3 dB is below the level-difference limen for a sustained sound, so the export and the room
/// agree about the duck to the ear even though they no longer agree to the sample. What this
/// buys is that a 150 ms ease costs ~5 points instead of 16, and a flat hold costs 2.
const GAIN_DECIMATION_DB: f32 = 0.3;

/// Thin a level polyline until it fits an ffmpeg expression, keeping every point that carries
/// shape.
///
/// A run of points collapses to its two ends whenever **every** point in the run sits within
/// [`GAIN_DECIMATION_DB`] of the straight line between them — so the 16 subdivisions of an eased
/// segment collapse to the few that describe the curve, and the flat hold between two ducks
/// collapses to its ends. The error is measured against the original polyline rather than
/// against the previous survivor, because measuring it locally lets it accumulate: dropping ten
/// points that are each 0.05 dB from their neighbours can land the tenth half a dB from where
/// the model put it.
///
/// If that is still too many points, the tolerance is doubled and it runs again: a project with
/// more ducks than the expression can hold gets a coarser curve rather than a failed encode.
fn decimate_gain_points(points: &[(f64, f32)], limit: usize) -> Vec<(f64, f32)> {
    if points.len() <= 2 {
        return points.to_vec();
    }
    let mut tolerance = GAIN_DECIMATION_DB;
    for _ in 0..12 {
        let mut kept: Vec<(f64, f32)> = vec![points[0]];
        let mut anchor = 0usize;
        while anchor < points.len() - 1 {
            // The next point always fits — a segment with nothing between it and its anchor has
            // nothing to be wrong about — so the scan starts one past it.
            let mut furthest = anchor + 1;
            for end in anchor + 2..points.len() {
                if !run_fits(points, anchor, end, tolerance) {
                    break;
                }
                furthest = end;
            }
            kept.push(points[furthest]);
            anchor = furthest;
        }
        if kept.len() <= limit {
            return kept;
        }
        tolerance *= 2.0;
    }
    // Nothing survives twelve doublings except a curve with more corners than the limit; keep
    // the ends and an even sample of the middle rather than emitting an expression ffmpeg will
    // refuse outright.
    let stride = points.len().div_ceil(limit.max(2));
    let mut kept: Vec<(f64, f32)> = points.iter().step_by(stride).copied().collect();
    if kept.last() != points.last() {
        kept.push(points[points.len() - 1]);
    }
    kept
}

/// Whether every point between `anchor` and `end` is within `tolerance` dB of the straight
/// line joining them.
fn run_fits(points: &[(f64, f32)], anchor: usize, end: usize, tolerance: f32) -> bool {
    let ((from_time, from_gain), (to_time, to_gain)) = (points[anchor], points[end]);
    let span = to_time - from_time;
    points[anchor + 1..end].iter().all(|(time, gain)| {
        let approximated = if span <= 0.0 {
            to_gain
        } else {
            from_gain + (to_gain - from_gain) * ((time - from_time) / span) as f32
        };
        decibels_apart(*gain, approximated) <= tolerance
    })
}

/// Level difference in dB, with a floor so that two silences are zero apart rather than
/// infinitely so.
fn decibels_apart(a: f32, b: f32) -> f32 {
    const FLOOR: f32 = 1e-4;
    let (a, b) = (a.max(FLOOR), b.max(FLOOR));
    20.0 * (a / b).log10().abs()
}

impl AudibleClip {
    fn processing_filters(&self) -> String {
        let mut filters = Vec::new();
        let speed = if self.speed.is_finite() && self.speed > 0.0 {
            self.speed
        } else {
            1.0
        };
        filters.extend(atempo_filters(speed));
        if let Some(chain) = &self.dialogue_chain {
            if let Some(eq) = chain.eq {
                filters.push(format!(
                    "highpass=f={:.1},equalizer=f=3000:t=q:w=1:g={:.2}",
                    eq.high_pass_hz.clamp(20.0, 1000.0),
                    eq.presence_db.clamp(-12.0, 12.0)
                ));
            }
            if let Some(compressor) = chain.compressor {
                filters.push(format!(
                    "acompressor=threshold={:.2}dB:ratio={:.2}:attack={:.2}:release={:.2}:makeup={:.2}dB",
                    compressor.threshold_db.clamp(-80.0, 0.0),
                    compressor.ratio.clamp(1.0, 20.0),
                    compressor.attack_ms.clamp(0.01, 2000.0),
                    compressor.release_ms.clamp(0.01, 9000.0),
                    compressor.makeup_db.clamp(0.0, 24.0),
                ));
            }
            if let Some(limiter) = chain.limiter {
                let ceiling = 10.0_f32.powf(limiter.ceiling_db.min(0.0) / 20.0);
                // Oversample around the limiter so inter-sample peaks are included.
                filters.push(format!(
                    "aresample=192000,alimiter=limit={ceiling:.6}:attack=5:release=50,aresample=48000"
                ));
            }
        }
        if filters.is_empty() {
            String::new()
        } else {
            format!("{},", filters.join(","))
        }
    }

    /// The ffmpeg filter fragment that applies this clip's level.
    ///
    /// A flat clip is a plain `volume=`. A moving one becomes a piecewise-linear expression
    /// evaluated per frame — the same polyline the preview interpolates, written in ffmpeg's
    /// expression language. `t` there is seconds into the *trimmed* clip, which is exactly
    /// what `gain_points` is measured in.
    ///
    /// Decimated on the way in, because the expression parser has a hard limit the model does
    /// not — see [`MAX_GAIN_EXPRESSION_POINTS`]. The preview mixer keeps the full polyline;
    /// what the two share is the description, not the sample count.
    /// Head and tail fades, as `afade` — sample-accurate, unlike the `volume` expression.
    ///
    /// `volume` is evaluated once per audio frame (`eval=frame`, ~21 ms) and held for that
    /// frame. Fold a fade into it and the first frame of the fade is multiplied by whatever the
    /// curve reads at its very start, which for a fade-in is exactly zero — so a 35 ms
    /// crossfade reached the file as ~21 ms of digital silence on each side of the join, a hole
    /// where a smoothing was asked for. Measured on a two-clip repro: butt-joined with 35 ms
    /// fades produced 67 ms of exact zero, and the same two clips with no fades produced none.
    ///
    /// `afade` works on samples, so the ramp is the ramp however short it is. Linear, matching
    /// [`bay_project::Element::fade_gain`], so the export and the preview agree.
    fn fade_filters(&self) -> String {
        let mut out = String::new();
        if self.fade_in_seconds > 0.0 {
            out.push_str(&format!(
                "afade=t=in:curve=tri:st=0:d={:.4},",
                self.fade_in_seconds
            ));
        }
        if self.fade_out_seconds > 0.0 {
            let start = (self.duration_seconds - self.fade_out_seconds).max(0.0);
            out.push_str(&format!(
                "afade=t=out:curve=tri:st={start:.4}:d={:.4},",
                self.fade_out_seconds
            ));
        }
        out
    }

    fn volume_filter(&self) -> String {
        let decimated = decimate_gain_points(&self.gain_points, MAX_GAIN_EXPRESSION_POINTS);
        let points: Vec<&(f64, f32)> = decimated.iter().collect();
        if points.len() < 2 {
            let gain = points.first().map(|(_, g)| *g).unwrap_or(self.volume);
            return format!("volume={gain:.4}");
        }
        // Built from the last segment backwards, so each `if` only has to decide "before this
        // point or after it".
        let mut expression = format!("{:.4}", points[points.len() - 1].1);
        for pair in points.windows(2).rev() {
            let ((ta, va), (tb, vb)) = (pair[0], pair[1]);
            let segment = if (tb - ta).abs() < 1e-9 {
                format!("{vb:.4}")
            } else {
                // va + (vb - va) * (t - ta) / (tb - ta)
                format!("({va:.4}+({:.4})*(t-{ta:.4})/{:.4})", vb - va, tb - ta)
            };
            // Commas inside an ffmpeg expression must be escaped, or the filtergraph parser
            // reads one as the end of this filter.
            expression = format!(r"if(lt(t\,{tb:.4})\,{segment}\,{expression})");
        }
        format!("volume='{expression}':eval=frame")
    }
}

fn atempo_filters(speed: f32) -> Vec<String> {
    let mut remaining = speed.clamp(0.01, 100.0);
    let mut filters = Vec::new();
    while remaining < 0.5 {
        filters.push("atempo=0.5".to_string());
        remaining /= 0.5;
    }
    while remaining > 100.0 {
        filters.push("atempo=100".to_string());
        remaining /= 100.0;
    }
    if (remaining - 1.0).abs() > f32::EPSILON {
        filters.push(format!("atempo={remaining:.6}"));
    }
    filters
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
                trim_start_seconds: audio.trim_start.to_seconds_f64().max(0.0),
                duration_seconds,
                speed: audio.speed,
                dialogue_chain: audio.dialogue_chain.clone(),
                volume: audio.volume,
                gain_points: element.gain_points_without_fades(),
                fade_in_seconds: audio.fade_in.to_seconds_f64().max(0.0),
                fade_out_seconds: audio.fade_out.to_seconds_f64().max(0.0),
            });
        }
    }
    clips
}

/// Test hook for [`VideoCodec::encoder_args`] — the arguments are what actually reach ffmpeg,
/// and a codec that quietly fell back to the default would only show up when someone opened
/// the file.
pub fn encoder_args_for_test(codec: VideoCodec, quality: u32) -> Vec<String> {
    codec.encoder_args(quality)
}

/// Shift and clip a set of audible clips into an exported range.
///
/// A ranged export renumbers time from `start_seconds`, so every clip's position moves with it
/// and anything that finishes before the range begins is dropped rather than delayed into it.
/// A clip that straddles the start keeps its in-point advanced by the same amount it lost, so
/// the sound under the first frame is the sound that was under it in the timeline.
fn clips_in_range(clips: Vec<AudibleClip>, start_seconds: f64, duration: f64) -> Vec<AudibleClip> {
    if start_seconds <= 0.0 {
        return clips;
    }
    let end = start_seconds + duration.max(0.0);
    clips
        .into_iter()
        .filter_map(|clip| {
            let clip_end = clip.start_seconds + clip.duration_seconds;
            if clip_end <= start_seconds || clip.start_seconds >= end {
                return None;
            }
            let lost = (start_seconds - clip.start_seconds).max(0.0);
            let duration_seconds =
                (clip.duration_seconds - lost).min(end - start_seconds.max(clip.start_seconds));
            if duration_seconds <= 0.0 {
                return None;
            }
            Some(AudibleClip {
                start_seconds: (clip.start_seconds - start_seconds).max(0.0),
                trim_start_seconds: clip.trim_start_seconds + lost * f64::from(clip.speed.max(0.0)),
                duration_seconds,
                // The level curve is measured from the clip's own head, so the part that is
                // still playing has to be read from where the range picked it up.
                gain_points: clip
                    .gain_points
                    .iter()
                    .map(|(t, gain)| (t - lost, *gain))
                    .collect(),
                ..clip
            })
        })
        .collect()
}

/// Test hook for [`clips_in_range`].
pub fn clips_in_range_for_test(
    clips: Vec<AudibleClip>,
    start_seconds: f64,
    duration: f64,
) -> Vec<AudibleClip> {
    clips_in_range(clips, start_seconds, duration)
}

/// Test hook for [`AudibleClip::volume_filter`]. The expression is what ffmpeg actually
/// applies to the mix, and a syntax slip in it is a silent export, so it is worth asserting
/// without spawning an encoder.
pub fn volume_filter_for_test(clip: &AudibleClip) -> String {
    clip.volume_filter()
}

/// Test hook for [`decimate_gain_points`], with the limit the export uses.
pub fn decimate_gain_points_for_test(points: &[(f64, f32)]) -> Vec<(f64, f32)> {
    decimate_gain_points(points, MAX_GAIN_EXPRESSION_POINTS)
}

/// The point budget an exported level curve has to fit inside, for tests that assert a duck
/// is exportable rather than only well-shaped.
pub const GAIN_EXPRESSION_LIMIT: usize = MAX_GAIN_EXPRESSION_POINTS;

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

fn word_byte_range(text: &str, word_index: usize) -> Option<(usize, usize)> {
    let mut start = None;
    let mut current = 0usize;
    for (index, character) in text.char_indices() {
        if character.is_whitespace() {
            if let Some(word_start) = start.take() {
                if current == word_index {
                    return Some((word_start, index));
                }
                current += 1;
            }
        } else if start.is_none() {
            start = Some(index);
        }
    }
    start
        .filter(|_| current == word_index)
        .map(|word_start| (word_start, text.len()))
}

#[cfg(test)]
mod craft_tests {
    use super::{AudibleClip, word_byte_range};

    #[test]
    fn karaoke_word_ranges_follow_text_order() {
        assert_eq!(word_byte_range("Craft moves fast", 0), Some((0, 5)));
        assert_eq!(word_byte_range("Craft moves fast", 1), Some((6, 11)));
        assert_eq!(word_byte_range("Craft moves fast", 2), Some((12, 16)));
    }

    #[test]
    fn dialogue_chain_emits_the_complete_filter_order() {
        let clip = AudibleClip {
            path: "/tmp/voice.wav".into(),
            start_seconds: 0.0,
            trim_start_seconds: 0.0,
            duration_seconds: 2.0,
            speed: 1.25,
            dialogue_chain: Some(bay_project::DialogueAudioChain::default()),
            volume: 1.0,
            gain_points: vec![(0.0, 1.0)],
            fade_in_seconds: 0.0,
            fade_out_seconds: 0.0,
        };
        let filters = clip.processing_filters();
        let positions = [
            filters.find("atempo=").unwrap(),
            filters.find("highpass=").unwrap(),
            filters.find("acompressor=").unwrap(),
            filters.find("alimiter=").unwrap(),
        ];
        assert!(
            positions.windows(2).all(|pair| pair[0] < pair[1]),
            "{filters}"
        );
        assert!(filters.contains("equalizer="), "{filters}");
        assert!(filters.ends_with(','), "{filters}");
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

/// Ids of the video elements on screen at `playhead`.
///
/// Export uses this to close decoders it has finished with. Hidden tracks count as not on
/// screen, matching what the compositor draws.
fn live_video_elements(scene: &Scene, playhead: MediaTime) -> HashSet<String> {
    let mut live = HashSet::new();
    for track in std::iter::once(&scene.tracks.main).chain(scene.tracks.overlay.iter()) {
        if track.hidden {
            continue;
        }
        for element in &track.elements {
            if matches!(element, Element::Video(_))
                && element.start() <= playhead
                && playhead < element.end()
            {
                live.insert(element.id().to_string());
            }
        }
    }
    live
}

/// Where an export is encoded before it is renamed into place.
///
/// The staging suffix goes **before** the extension, not after it: ffmpeg infers the container
/// from the output filename, so `out.mp4.1234.part` makes it refuse with "Unable to choose an
/// output format". `out.1234.part.mp4` keeps the extension and stays obviously temporary.
///
/// The pid and a per-export counter keep two concurrent exports of the same destination off
/// each other's staging file. The pid alone was not enough: every export in a process shares it,
/// and two renders to one path are reachable now that each job builds its own renderer — both
/// ffmpegs would have opened the same `.part` with `-y` and interleaved their writes.
pub(crate) fn staging_path(out_path: &str) -> String {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nonce = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let pid = format!("{}-{nonce}", std::process::id());
    let path = std::path::Path::new(out_path);
    match (path.file_stem(), path.extension()) {
        (Some(stem), Some(ext)) => {
            let staged = format!(
                "{}.{pid}.part.{}",
                stem.to_string_lossy(),
                ext.to_string_lossy()
            );
            path.with_file_name(staged).to_string_lossy().into_owned()
        }
        // No extension to protect, so the simple suffix is fine.
        _ => format!("{out_path}.{pid}.part"),
    }
}

/// Append ffmpeg's own diagnostics to an export failure when it produced any.
///
/// Without this every encode failure reached the user as "is ffmpeg installed?", which is the
/// wrong question when ffmpeg ran fine and the codec, the path or the arguments were the problem.
fn with_stderr(reason: &str, stderr: &str) -> String {
    let stderr = stderr.trim();
    if stderr.is_empty() {
        reason.to_string()
    } else {
        format!("{reason} — ffmpeg said: {stderr}")
    }
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

#[cfg(test)]
mod staging_tests {
    use super::staging_path;

    /// ffmpeg chooses its container from the output filename. Appending the staging suffix
    /// *after* the extension made every audio-bearing export fail with "Unable to choose an
    /// output format" — the extension has to survive staging.
    #[test]
    fn the_staging_path_keeps_the_extension_ffmpeg_reads() {
        let staged = staging_path("/tmp/clip.mp4");
        assert!(
            staged.ends_with(".mp4"),
            "{staged} must still look like an mp4 to ffmpeg"
        );
        assert!(
            staged.contains(".part."),
            "{staged} must be recognisable as a staging file"
        );
        assert_ne!(
            staged, "/tmp/clip.mp4",
            "staging must not be the destination"
        );
        assert!(
            staged.starts_with("/tmp/"),
            "{staged} must stage beside the destination so the rename stays on one filesystem"
        );
    }

    /// A destination with no extension has nothing to protect, and must still get a distinct
    /// staging path rather than being written in place.
    #[test]
    fn a_destination_without_an_extension_still_stages() {
        let staged = staging_path("/tmp/clip");
        assert_ne!(staged, "/tmp/clip");
        assert!(staged.contains(".part"), "{staged}");
    }
}

#[cfg(test)]
mod staging_collision_tests {
    use super::staging_path;

    /// Two exports to the same destination must not share a staging file.
    ///
    /// The pid alone did not do this: every export in a process shares it, and two concurrent
    /// renders are reachable because each job builds its own renderer. Both ffmpegs would have
    /// opened the same `.part` with `-y` and interleaved their writes, so one call reported
    /// success over a corrupt file.
    #[test]
    fn two_exports_of_one_path_get_separate_staging_files() {
        let first = staging_path("/tmp/out.mp4");
        let second = staging_path("/tmp/out.mp4");
        assert_ne!(
            first, second,
            "concurrent exports of one destination must not share a staging file"
        );
        for path in [&first, &second] {
            assert!(
                path.ends_with(".mp4"),
                "{path} must stay readable by ffmpeg"
            );
            assert!(path.contains(".part."), "{path} must look temporary");
        }
    }
}
