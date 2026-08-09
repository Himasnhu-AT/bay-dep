//! Compositor-backed scene preview.
//!
//! [`PreviewRenderer`] owns a wgpu device + the real [`bay_compositor::Compositor`]. Given a scene
//! and a playhead it builds a [`FrameDescriptor`] (one layer per on-screen visual element,
//! placed by its transform), renders it, and reads the pixels back as BGRA — the format GPUI's
//! `RenderImage` expects. Clip textures are solid-color placeholders until native media decode
//! lands; the compositing (background, transform, opacity, blend) is real.

pub mod probe;

use bay_compositor::{
    BlendMode, CanvasClearDescriptor, Compositor, EffectPassDescriptor,
    EffectUniformValueDescriptor, FrameDescriptor, FrameItemDescriptor, LayerDescriptor,
    QuadTransformDescriptor,
};
use std::collections::HashSet;

use bay_gpu::GpuContext;
use bay_project::{Background, Element, ElementKind, MediaAsset, MediaTime, Scene};
use bay_text::TextRaster;

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
    width: u32,
    height: u32,
) -> Vec<u8> {
    use bay_project::ShapeKind;

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
    shape: &bay_project::ShapeKind,
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
    if let DecodeIntent::Export { fps } = intent {
        return DecodePlan {
            width: even(nw as f32),
            height: even(nh as f32),
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
    // Export decodes at source resolution, so it passes no -s at all rather than a no-op scale.
    if (plan.width, plan.height) != (0, 0) {
        args.push("-s".into());
        args.push(format!("{}x{}", plan.width, plan.height));
    }
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
        let frame_bytes = (plan.width as usize) * (plan.height as usize) * 4;
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
    ///
    /// `None` when the rasterizer handed back a buffer that disagrees with its own dimensions.
    /// The caller drops that one layer and still draws the frame — a bad raster must not take
    /// the editor down with it.
    fn ensure_text_texture(
        &mut self,
        content: &str,
        font_px: f32,
        color: &str,
        tw: u32,
        th: u32,
        style: &bay_text::TextStyle<'_>,
    ) -> Option<String> {
        let key = format!(
            "text:{color}:{font}:{tw}x{th}:{style_key}:{content}",
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
        aspect: f32,
    ) -> Option<String> {
        use bay_project::ShapeKind;
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
            return Some(key);
        }
        let rgba = rasterize_shape(shape, color, raster_w, raster_h);
        let texture = self
            .ctx
            .upload_rgba_texture(&rgba, raster_w, raster_h, "preview-shape")?;
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
        on_frame: &mut dyn FnMut(u64, u64) -> bool,
    ) -> Result<(), String> {
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
            let seconds = index as f64 / fps;
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
                        let style = bay_text::TextStyle {
                            family: text.font_family.as_deref(),
                            weight: text.font_weight,
                            align: match text.align {
                                bay_project::TextAlign::Left => bay_text::TextAlign::Left,
                                bay_project::TextAlign::Center => bay_text::TextAlign::Center,
                                bay_project::TextAlign::Right => bay_text::TextAlign::Right,
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
                            Some((texture_id, natural)) => (Some(texture_id), Some(natural)),
                            None => (self.upload_solid_placeholder(element), None),
                        }
                    }
                    Element::Video(video) => {
                        let media_id = video.media_id.clone();
                        let path = media
                            .iter()
                            .find(|m| m.id == media_id)
                            .map(|m| m.path.clone());
                        // How far into the SOURCE this timeline moment is.
                        let source_seconds = video.trim_start.to_seconds_f64()
                            + (playhead.as_ticks() - video.start.as_ticks()).max(0) as f64
                                / 120_000.0;

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
                                (Some(element.id().to_string()), Some((w, h)))
                            }
                            None => (self.upload_solid_placeholder(element), None),
                        }
                    }
                    _ => (self.upload_solid_placeholder(element), None),
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
/// The pid keeps two concurrent exports of the same destination off each other's staging file.
pub(crate) fn staging_path(out_path: &str) -> String {
    let pid = std::process::id();
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
