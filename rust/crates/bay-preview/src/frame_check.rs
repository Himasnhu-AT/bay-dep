//! Caption-suppressed, pixel-level validation shared by both render transports.
//!
//! The model check stays in `bay-core`; these checks need the real compositor and therefore live
//! beside [`crate::PreviewRenderer`]. A report can be `unevaluated`, but it can never silently
//! claim that an adapter or failed readback produced a clean frame.

use std::collections::VecDeque;

use bay_project::{
    BlendMode, Element, ElementRole, ElementSource, Mask, MaskShape, MediaTime, Project, Scene,
    ShapeKind, TextElement,
};

use crate::PreviewRenderer;

const SAMPLE_FPS: f64 = 4.0;
const SAMPLE_HEIGHT: u32 = 240;
const INK_CONTRAST: f32 = 4.5;
const LEGIBLE_OPACITY: f32 = 0.6;
const TEXT_COLLISION_SHARE: f64 = 0.08;
/// A graphic has to be effectively solid before it can hide type. Scrims and washes are
/// deliberately translucent; treating them as occluders would reject the thing they exist for.
const OCCLUDING_OPACITY: f32 = 0.90;
/// Ignore dust-sized disconnected marks when applying the collision share per glyph component.
/// A period remains large enough to count; antialiasing specks do not become their own gate.
const MIN_COMPONENT_INK_SHARE: f64 = 0.01;
/// A lower graphic covering essentially the whole run is its ground (a plate), not an
/// interruption. Partial opaque marks crossing individual glyphs still need evaluation.
const TEXT_GROUND_SHARE: f64 = 0.90;

#[derive(Clone)]
struct InkFrame {
    at: f64,
    mask: Vec<bool>,
    clusters: Vec<InkCluster>,
    bottom_alive: bool,
}

#[derive(Clone, Copy)]
struct InkCluster {
    area: usize,
    x: f32,
    y: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FrameSignature {
    pub at: f64,
    pub content_hash: String,
    pub icgs: Vec<u16>,
}

#[derive(Debug, Clone, Copy)]
struct Rect {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
}

impl Rect {
    fn area(self) -> f64 {
        self.width.max(0.0) * self.height.max(0.0)
    }

    fn intersection_area(self, other: Self) -> f64 {
        let across =
            (self.left + self.width).min(other.left + other.width) - self.left.max(other.left);
        let down = (self.top + self.height).min(other.top + other.height) - self.top.max(other.top);
        across.max(0.0) * down.max(0.0)
    }

    fn rotated_bounds(self, centre_x: f64, centre_y: f64, degrees: f64) -> Self {
        if degrees.abs() <= f64::EPSILON {
            return self;
        }
        let (sin, cos) = degrees.to_radians().sin_cos();
        let corners = [
            (self.left, self.top),
            (self.left + self.width, self.top),
            (self.left, self.top + self.height),
            (self.left + self.width, self.top + self.height),
        ];
        let mut left = f64::INFINITY;
        let mut top = f64::INFINITY;
        let mut right = f64::NEG_INFINITY;
        let mut bottom = f64::NEG_INFINITY;
        for (x, y) in corners {
            let (dx, dy) = (x - centre_x, y - centre_y);
            let x = centre_x + dx * cos - dy * sin;
            let y = centre_y + dx * sin + dy * cos;
            left = left.min(x);
            top = top.min(y);
            right = right.max(x);
            bottom = bottom.max(y);
        }
        Self {
            left,
            top,
            width: (right - left).max(0.0),
            height: (bottom - top).max(0.0),
        }
    }
}

#[derive(Clone)]
struct MeasuredText<'a> {
    track_id: &'a str,
    element: &'a Element,
    stack: usize,
    image_width: f64,
    image_height: f64,
    margin_x: f64,
    margin_y: f64,
    ink: Rect,
    glyph_alpha: Vec<u8>,
    glyph_components: Vec<usize>,
    component_ink: Vec<f64>,
}

#[derive(Clone, Copy)]
struct MeasuredShape<'a> {
    track_id: &'a str,
    element: &'a Element,
    stack: usize,
}

/// Text overprint, measured from cosmic-text's shaped glyph ink.
///
/// Decorations are included while mapping the expanded raster texture but excluded from the
/// collision rectangle itself. A lower-third is expected to overlap footage and a plate; a
/// shadow may touch another block without hiding it. Two glyph runs occupying the same space, or
/// an effectively opaque graphic crossing actual glyph pixels, are the mechanical legibility
/// failures this gate owns.
fn text_collision_findings(project: &Project) -> Vec<serde_json::Value> {
    let scene = project.active_scene();
    let canvas = project.settings.canvas;
    let (width, height) = (canvas.width.max(1), canvas.height.max(1));
    let mut raster = bay_text::TextRaster::new();
    let mut measured = Vec::new();
    let mut shapes = Vec::new();
    let mut stack = 0usize;

    for track in std::iter::once(&scene.tracks.main).chain(scene.tracks.overlay.iter()) {
        if track.hidden {
            continue;
        }
        for element in &track.elements {
            match element {
                Element::Text(text)
                    if !text.content.trim().is_empty() && element.duration() > MediaTime::ZERO =>
                {
                    let base_scale = text.transform.scale.max(0.01);
                    let raster_width =
                        (base_scale * width as f32).min(width as f32).max(1.0) as u32;
                    let raster_height =
                        (base_scale * height as f32).min(height as f32).max(1.0) as u32;
                    let font_px = (text.font_size * height as f32 / 1080.0).max(8.0);
                    let style = raster_style(text);
                    let image = raster.render_styled(
                        &text.content,
                        font_px,
                        &text.color,
                        raster_width,
                        raster_height,
                        &style,
                    );
                    if let Some(ink) = image.ink_bounds {
                        let (glyph_components, component_ink) =
                            glyph_components(&image.glyph_alpha, image.width, image.height);
                        measured.push(MeasuredText {
                            track_id: &track.id,
                            element,
                            stack,
                            image_width: f64::from(image.width),
                            image_height: f64::from(image.height),
                            margin_x: f64::from(image.margin_x),
                            margin_y: f64::from(image.margin_y),
                            ink: Rect {
                                left: f64::from(ink.left),
                                top: f64::from(ink.top),
                                width: f64::from(ink.right - ink.left),
                                height: f64::from(ink.bottom - ink.top),
                            },
                            glyph_alpha: image.glyph_alpha,
                            glyph_components,
                            component_ink,
                        });
                    }
                }
                Element::Shape(_) if element.duration() > MediaTime::ZERO => {
                    shapes.push(MeasuredShape {
                        track_id: &track.id,
                        element,
                        stack,
                    });
                }
                _ => {}
            }
            stack += 1;
        }
    }

    let mut findings = Vec::new();
    for (index, first) in measured.iter().enumerate() {
        for second in measured.iter().skip(index + 1) {
            let overlap_start = first.element.start().max(second.element.start());
            let overlap_end = first.element.end().min(second.element.end());
            if overlap_end <= overlap_start {
                continue;
            }
            let span = overlap_end - overlap_start;
            let collision = [0_i64, 1, 2, 3, 4].into_iter().find_map(|step| {
                let offset = if step == 4 {
                    span.as_ticks().saturating_sub(1)
                } else {
                    span.as_ticks() * step / 4
                };
                let at = overlap_start + MediaTime::from_ticks(offset);
                let first_box = text_ink_at(scene, first, at, width, height)?;
                let second_box = text_ink_at(scene, second, at, width, height)?;
                let covered = first_box.intersection_area(second_box)
                    / first_box.area().min(second_box.area()).max(f64::EPSILON);
                (covered >= TEXT_COLLISION_SHARE).then_some((at, covered))
            });
            if let Some((at, covered)) = collision {
                findings.push(serde_json::json!({
                    "code": "text-collision",
                    "severity": bay_core::check::severity_of("text-collision").label(),
                    "message": format!(
                        "{:?} and {:?} overprint {:.0}% of the smaller shaped ink box at {:.2}s; \
                         move the later block by the measured wrapped height",
                        first.element.id(),
                        second.element.id(),
                        covered * 100.0,
                        at.to_seconds_f64(),
                    ),
                    "elementId": second.element.id(),
                    "trackId": second.track_id,
                    "atSeconds": at.to_seconds_f64(),
                }));
            }
        }
    }
    for text in &measured {
        for shape in &shapes {
            let overlap_start = text.element.start().max(shape.element.start());
            let overlap_end = text.element.end().min(shape.element.end());
            if overlap_end <= overlap_start {
                continue;
            }
            let span = overlap_end - overlap_start;
            let collision = [0_i64, 1, 2, 3, 4].into_iter().find_map(|step| {
                let offset = if step == 4 {
                    span.as_ticks().saturating_sub(1)
                } else {
                    span.as_ticks() * step / 4
                };
                let at = overlap_start + MediaTime::from_ticks(offset);
                let covered = glyph_occlusion_share(scene, text, shape, at, width, height)?;
                let is_ground = shape.stack < text.stack && covered >= TEXT_GROUND_SHARE;
                (covered >= TEXT_COLLISION_SHARE && !is_ground).then_some((at, covered))
            });
            if let Some((at, covered)) = collision {
                findings.push(serde_json::json!({
                    "code": "text-collision",
                    "severity": bay_core::check::severity_of("text-collision").label(),
                    "message": format!(
                        "{:?} crosses {:.0}% of {:?}'s shaped glyph ink at {:.2}s; move the \
                         graphic clear of the measured ink bounds or put a full text plate \
                         behind the block",
                        shape.element.id(),
                        covered * 100.0,
                        text.element.id(),
                        at.to_seconds_f64(),
                    ),
                    "elementId": text.element.id(),
                    "trackId": text.track_id,
                    "occluderId": shape.element.id(),
                    "occluderTrackId": shape.track_id,
                    "atSeconds": at.to_seconds_f64(),
                }));
            }
        }
    }
    findings
}

fn raster_style(text: &TextElement) -> bay_text::TextStyle<'_> {
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
            decorations
                .stroke
                .as_ref()
                .map(|stroke| bay_text::StrokeStyle {
                    width: stroke.width,
                    color: stroke.color.as_str(),
                })
        }),
        shadow: text.decorations.as_ref().and_then(|decorations| {
            decorations
                .shadow
                .as_ref()
                .map(|shadow| bay_text::ShadowStyle {
                    offset_x: shadow.offset_x,
                    offset_y: shadow.offset_y,
                    blur: shadow.blur,
                    color: shadow.color.as_str(),
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
        highlight: None,
    }
}

fn text_ink_at(
    scene: &Scene,
    measured: &MeasuredText<'_>,
    at: MediaTime,
    canvas_width: u32,
    canvas_height: u32,
) -> Option<Rect> {
    let placement = text_placement_at(scene, measured, at, canvas_width, canvas_height)?;
    let ink = Rect {
        left: placement.left + measured.ink.left / measured.image_width * placement.width,
        top: placement.top + measured.ink.top / measured.image_height * placement.height,
        width: measured.ink.width / measured.image_width * placement.width,
        height: measured.ink.height / measured.image_height * placement.height,
    };
    Some(ink.rotated_bounds(
        placement.left + placement.width / 2.0,
        placement.top + placement.height / 2.0,
        placement.rotation,
    ))
}

#[derive(Clone, Copy)]
struct TextPlacement {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
    rotation: f64,
}

fn text_placement_at(
    scene: &Scene,
    measured: &MeasuredText<'_>,
    at: MediaTime,
    canvas_width: u32,
    canvas_height: u32,
) -> Option<TextPlacement> {
    let local = at - measured.element.start();
    let transform = scene.sampled_transform(measured.element, local, at)?;
    let opacity = transform.opacity * measured.element.fade_gain(local);
    if opacity < LEGIBLE_OPACITY {
        return None;
    }
    let box_width = f64::from(transform.scale * canvas_width as f32) + measured.margin_x * 2.0;
    let box_height = f64::from(transform.scale * canvas_height as f32) + measured.margin_y * 2.0;
    let fit = (box_width / measured.image_width)
        .min(box_height / measured.image_height)
        .max(0.0);
    let layer_width = measured.image_width * fit * f64::from(transform.scale_x);
    let layer_height = measured.image_height * fit * f64::from(transform.scale_y);
    if layer_width <= 0.0 || layer_height <= 0.0 {
        return None;
    }
    let left =
        f64::from(transform.x * canvas_width as f32) - f64::from(transform.anchor_x) * layer_width;
    let top = f64::from(transform.y * canvas_height as f32)
        - f64::from(transform.anchor_y) * layer_height;
    Some(TextPlacement {
        left,
        top,
        width: layer_width,
        height: layer_height,
        rotation: f64::from(transform.rotation),
    })
}

#[derive(Clone, Copy)]
struct ShapePlacement<'a> {
    kind: &'a ShapeKind,
    center_x: f64,
    center_y: f64,
    width: f64,
    height: f64,
    rotation: f64,
    mask: Option<Mask>,
}

fn shape_placement_at<'a>(
    scene: &Scene,
    measured: &'a MeasuredShape<'_>,
    at: MediaTime,
    canvas_width: u32,
    canvas_height: u32,
) -> Option<ShapePlacement<'a>> {
    let Element::Shape(shape) = measured.element else {
        return None;
    };
    if measured.element.blend_mode() != Some(BlendMode::Normal) {
        return None;
    }
    let local = at - measured.element.start();
    let transform = scene.sampled_transform(measured.element, local, at)?;
    let opacity = transform.opacity * measured.element.fade_gain(local) * color_alpha(&shape.color);
    if opacity < OCCLUDING_OPACITY {
        return None;
    }
    let width = f64::from(transform.scale * canvas_width as f32 * transform.scale_x);
    let height = f64::from(transform.scale * canvas_height as f32 * transform.scale_y);
    if width <= 0.0 || height <= 0.0 {
        return None;
    }
    Some(ShapePlacement {
        kind: &shape.shape,
        center_x: f64::from(transform.x * canvas_width as f32)
            + (0.5 - f64::from(transform.anchor_x)) * width,
        center_y: f64::from(transform.y * canvas_height as f32)
            + (0.5 - f64::from(transform.anchor_y)) * height,
        width,
        height,
        rotation: f64::from(transform.rotation),
        mask: measured.element.sampled_mask(local),
    })
}

/// Label connected runs of shaped glyph ink once, when the text is measured.
///
/// A collision with one letter in an eight-letter title must not be divided by the ink in the
/// other seven. Eight-neighbour connectivity follows antialiased diagonals; the component-size
/// floor in [`glyph_occlusion_share`] keeps isolated raster dust out of the decision.
fn glyph_components(alpha: &[u8], width: u32, height: u32) -> (Vec<usize>, Vec<f64>) {
    let mut labels = vec![usize::MAX; alpha.len()];
    let mut totals = Vec::new();
    for start in 0..alpha.len() {
        if alpha[start] == 0 || labels[start] != usize::MAX {
            continue;
        }
        let label = totals.len();
        let mut total = 0.0;
        let mut pending = std::collections::VecDeque::from([start]);
        labels[start] = label;
        while let Some(index) = pending.pop_front() {
            total += f64::from(alpha[index]) / 255.0;
            let x = (index as u32) % width;
            let y = (index as u32) / width;
            for dy in -1_i32..=1 {
                for dx in -1_i32..=1 {
                    if dx == 0 && dy == 0 {
                        continue;
                    }
                    let next_x = x as i32 + dx;
                    let next_y = y as i32 + dy;
                    if next_x < 0 || next_y < 0 || next_x >= width as i32 || next_y >= height as i32
                    {
                        continue;
                    }
                    let next = (next_y as u32 * width + next_x as u32) as usize;
                    if alpha[next] > 0 && labels[next] == usize::MAX {
                        labels[next] = label;
                        pending.push_back(next);
                    }
                }
            }
        }
        totals.push(total);
    }
    (labels, totals)
}

/// Share of the actual shaped glyph coverage hidden by one effectively opaque graphic.
///
/// This deliberately works on `glyph_alpha`, not merely the rectangular `ink_bounds`: a round
/// mark touching the empty corner beside an `L` is proximity, while the same mark crossing the
/// stem is occlusion. The bounds still provide the measured search region and placement basis.
/// The returned share is the larger of whole-run coverage and per-connected-glyph coverage, so
/// hiding one letter in a long title is not diluted by all of its unaffected siblings.
fn glyph_occlusion_share(
    scene: &Scene,
    text: &MeasuredText<'_>,
    shape: &MeasuredShape<'_>,
    at: MediaTime,
    canvas_width: u32,
    canvas_height: u32,
) -> Option<f64> {
    let text_placement = text_placement_at(scene, text, at, canvas_width, canvas_height)?;
    let shape_placement = shape_placement_at(scene, shape, at, canvas_width, canvas_height)?;
    let image_width = text.image_width as u32;
    let image_height = text.image_height as u32;
    let left = text.ink.left.max(0.0).floor() as u32;
    let top = text.ink.top.max(0.0).floor() as u32;
    let right = (text.ink.left + text.ink.width)
        .ceil()
        .min(text.image_width) as u32;
    let bottom = (text.ink.top + text.ink.height)
        .ceil()
        .min(text.image_height) as u32;
    let center_x = text_placement.left + text_placement.width / 2.0;
    let center_y = text_placement.top + text_placement.height / 2.0;
    let (sin, cos) = text_placement.rotation.to_radians().sin_cos();
    let mut total = 0.0;
    let mut covered = 0.0;
    let mut component_covered = vec![0.0; text.component_ink.len()];
    for py in top..bottom.min(image_height) {
        for px in left..right.min(image_width) {
            let index = (py * image_width + px) as usize;
            let alpha = f64::from(text.glyph_alpha[index]) / 255.0;
            if alpha <= 0.0 {
                continue;
            }
            total += alpha;
            let unrotated_x = text_placement.left
                + (f64::from(px) + 0.5) / text.image_width * text_placement.width;
            let unrotated_y = text_placement.top
                + (f64::from(py) + 0.5) / text.image_height * text_placement.height;
            let dx = unrotated_x - center_x;
            let dy = unrotated_y - center_y;
            let canvas_x = center_x + dx * cos - dy * sin;
            let canvas_y = center_y + dx * sin + dy * cos;
            if shape_covers(
                shape_placement,
                canvas_x,
                canvas_y,
                canvas_width,
                canvas_height,
            ) {
                covered += alpha;
                let component = text.glyph_components[index];
                if component != usize::MAX {
                    component_covered[component] += alpha;
                }
            }
        }
    }
    if total <= f64::EPSILON {
        return None;
    }
    let component_floor = total * MIN_COMPONENT_INK_SHARE;
    let component_share = component_covered
        .iter()
        .zip(&text.component_ink)
        .filter(|(_, ink)| **ink >= component_floor)
        .map(|(covered, ink)| covered / ink)
        .fold(0.0, f64::max);
    Some((covered / total).max(component_share))
}

fn shape_covers(
    placement: ShapePlacement<'_>,
    x: f64,
    y: f64,
    canvas_width: u32,
    canvas_height: u32,
) -> bool {
    let dx = x - placement.center_x;
    let dy = y - placement.center_y;
    let (sin, cos) = placement.rotation.to_radians().sin_cos();
    let local_x = dx * cos + dy * sin;
    let local_y = -dx * sin + dy * cos;
    let half_width = placement.width / 2.0;
    let half_height = placement.height / 2.0;
    let inside = match placement.kind {
        ShapeKind::Ellipse => {
            (local_x / half_width).powi(2) + (local_y / half_height).powi(2) <= 1.0
        }
        ShapeKind::Rect { radius } => {
            let radius = f64::from(radius.clamp(0.0, 0.5)) * placement.width.min(placement.height);
            let qx = local_x.abs() - (half_width - radius);
            let qy = local_y.abs() - (half_height - radius);
            (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt() + qx.max(qy).min(0.0) - radius <= 0.0
        }
    };
    inside
        && placement.mask.is_none_or(|mask| {
            mask_covers(
                mask,
                x,
                y,
                f64::from(canvas_width),
                f64::from(canvas_height),
            )
        })
}

fn mask_covers(mask: Mask, x: f64, y: f64, canvas_width: f64, canvas_height: f64) -> bool {
    let half_width = f64::from(mask.width.max(0.0)) * canvas_width / 2.0;
    let half_height = f64::from(mask.height.max(0.0)) * canvas_height / 2.0;
    if half_width <= 0.0 || half_height <= 0.0 {
        return mask.inverted;
    }
    let dx = x - f64::from(mask.x) * canvas_width;
    let dy = y - f64::from(mask.y) * canvas_height;
    let inside = match mask.shape {
        MaskShape::Ellipse => (dx / half_width).powi(2) + (dy / half_height).powi(2) <= 1.0,
        MaskShape::Rect => dx.abs() <= half_width && dy.abs() <= half_height,
    };
    inside != mask.inverted
}

fn color_alpha(color: &str) -> f32 {
    let Some(hex) = color.strip_prefix('#') else {
        return 1.0;
    };
    match hex.len() {
        4 => u8::from_str_radix(&hex[3..4].repeat(2), 16)
            .map(|alpha| f32::from(alpha) / 255.0)
            .unwrap_or(1.0),
        8 => u8::from_str_radix(&hex[6..8], 16)
            .map(|alpha| f32::from(alpha) / 255.0)
            .unwrap_or(1.0),
        _ => 1.0,
    }
}

/// Measure the exact panels a critic saw, through the same caption-suppressed compositor path.
pub fn sample_signatures(
    project: &Project,
    renderer: &mut PreviewRenderer,
    times: &[f64],
) -> Result<Vec<FrameSignature>, String> {
    let mut project = project.clone();
    suppress_tool_captions(&mut project);
    let canvas = project.settings.canvas;
    let height = SAMPLE_HEIGHT;
    let width = ((height as f64 * canvas.width as f64 / canvas.height.max(1) as f64).round()
        as u32)
        .max(16);
    times
        .iter()
        .copied()
        .map(|at| {
            let playhead = MediaTime::from_seconds_f64(at)
                .ok_or_else(|| format!("critic sample time {at} is not representable"))?;
            let frame = renderer
                .render(
                    project.active_scene(),
                    playhead,
                    width,
                    height,
                    &project.settings.background,
                    &project.media,
                )
                .ok_or_else(|| format!("the GPU could not render critic sample at {at:.3}s"))?;
            let ink = ink_frame(at, width, height, &frame.bgra);
            Ok(FrameSignature {
                at,
                content_hash: stable_hash(&frame.bgra),
                icgs: icgs(&ink.clusters),
            })
        })
        .collect()
}

/// Run the compositor-backed checks over a project.
pub fn check_frames(
    project: &Project,
    renderer: &mut PreviewRenderer,
    requested_duration: Option<f64>,
) -> serde_json::Value {
    let mut project = project.clone();
    suppress_tool_captions(&mut project);
    if let Err(reason) = renderer.await_decodes_checked(project.active_scene(), &project.media) {
        return unevaluated(&reason);
    }
    let timeline = project
        .active_scene()
        .tracks
        .iter()
        .flat_map(|track| track.elements.iter())
        .map(|element| element.end().to_seconds_f64())
        .fold(0.0_f64, f64::max);
    let duration = requested_duration.unwrap_or(timeline).min(timeline);
    if !duration.is_finite() || duration <= 0.0 {
        return unevaluated("the timeline has no positive duration to sample");
    }

    let canvas = project.settings.canvas;
    let height = SAMPLE_HEIGHT;
    let width = ((height as f64 * canvas.width as f64 / canvas.height.max(1) as f64).round()
        as u32)
        .max(16);
    let samples = (duration * SAMPLE_FPS).ceil().max(1.0) as usize;
    let frame_step = 1.0 / project.settings.fps.as_f64().max(1.0);
    let mut frames = Vec::with_capacity(samples);
    for index in 0..samples {
        let at = (index as f64 / SAMPLE_FPS).min((duration - frame_step).max(0.0));
        let Some(playhead) = MediaTime::from_seconds_f64(at) else {
            continue;
        };
        let Some(frame) = renderer.render(
            project.active_scene(),
            playhead,
            width,
            height,
            &project.settings.background,
            &project.media,
        ) else {
            return unevaluated("the GPU stopped producing frames while the suite was sampling");
        };
        frames.push(ink_frame(at, width, height, &frame.bgra));
    }
    if frames.is_empty() {
        return unevaluated("the GPU produced no sampleable frames");
    }

    let pixels = (width as usize * height as usize).max(1);
    let peak_anchor = frames
        .iter()
        .flat_map(|frame| frame.clusters.first())
        .map(|cluster| (cluster.area as f64 / pixels as f64).sqrt())
        .fold(0.0_f64, f64::max);
    let bottom_share =
        frames.iter().filter(|frame| frame.bottom_alive).count() as f64 / frames.len() as f64;
    let window = (1.2 * SAMPLE_FPS).round() as usize;
    let frozen: Vec<f64> = frames
        .iter()
        .zip(frames.iter().skip(window))
        .filter_map(|(before, after)| {
            frozen_pair(before, after, width, height).then_some(before.at)
        })
        .collect();

    let mut findings = text_collision_findings(&project);
    let text_collisions = findings.len();
    if !frozen.is_empty() {
        findings.push(serde_json::json!({
            "code": "frozen",
            "message": format!(
                "{} sampled 1.2s window(s) keep the same ink arrangement; first at {:.2}s",
                frozen.len(),
                frozen[0]
            ),
            "atSeconds": frozen[0],
        }));
    }
    if peak_anchor < 0.26 {
        findings.push(serde_json::json!({
            "code": "anchor-scale",
            "message": format!(
                "the largest high-contrast anchor reaches {:.3} sqrt-area; it must reach 0.260",
                peak_anchor
            ),
        }));
    }
    if bottom_share < 0.50 {
        findings.push(serde_json::json!({
            "code": "bottom-dead",
            "message": format!(
                "substantial non-caption ink reaches the bottom in {:.0}% of sampled frames; it must in at least 50%",
                bottom_share * 100.0
            ),
        }));
    }
    let status = if findings.is_empty() {
        "clean"
    } else {
        "findings"
    };
    serde_json::json!({
        "status": status,
        "gate": status,
        "findings": findings,
        "rollup": {
            "text-collision": text_collisions,
            "frozen": frozen.len(),
            "anchor-scale": usize::from(peak_anchor < 0.26),
            "bottom-dead": usize::from(bottom_share < 0.50),
        },
        "skipped": [],
        "stats": {
            "durationSeconds": duration,
            "sampleFps": SAMPLE_FPS,
            "samples": frames.len(),
            "width": width,
            "height": height,
            "peakAnchorSqrtArea": peak_anchor,
            "bottomAliveShare": bottom_share,
        }
    })
}

/// Convert a non-clean report into the refusal rendered by both transports.
pub fn require_clean(report: &serde_json::Value) -> Result<(), String> {
    match report.get("status").and_then(serde_json::Value::as_str) {
        Some("clean") => Ok(()),
        Some("findings") => {
            let codes = report
                .get("findings")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|finding| finding.get("code").and_then(serde_json::Value::as_str))
                .collect::<Vec<_>>()
                .join(", ");
            Err(format!(
                "render refused by frame checks ({codes}) — run check_frames, fix the findings, \
                 or use ignoreChecks with a reason of at least 40 characters"
            ))
        }
        _ => Err(
            "render refused because frame checks were unevaluated — run check_frames to see why, \
             or use ignoreChecks with a reason of at least 40 characters"
                .into(),
        ),
    }
}

fn unevaluated(reason: &str) -> serde_json::Value {
    serde_json::json!({
        "status": "unevaluated",
        "gate": "unevaluated",
        "findings": [],
        "rollup": {},
        "skipped": [
            {"code": "frozen", "reason": reason},
            {"code": "anchor-scale", "reason": reason},
            {"code": "bottom-dead", "reason": reason},
        ],
        "stats": {},
    })
}

fn suppress_tool_captions(project: &mut Project) {
    for track in project.active_scene_mut().tracks.iter_mut() {
        track.elements.retain(|element| {
            !(element.source() == ElementSource::Tool
                && element.role() == Some(ElementRole::Caption))
        });
    }
}

fn ink_frame(at: f64, width: u32, height: u32, bgra: &[u8]) -> InkFrame {
    let mut histogram = vec![0usize; 32 * 32 * 32];
    for pixel in bgra.chunks_exact(4) {
        let key = ((pixel[2] as usize >> 3) << 10)
            | ((pixel[1] as usize >> 3) << 5)
            | (pixel[0] as usize >> 3);
        histogram[key] += 1;
    }
    let mode = histogram
        .iter()
        .enumerate()
        .max_by_key(|(_, count)| *count)
        .map(|(index, _)| index)
        .unwrap_or(0);
    let background = [
        ((((mode >> 10) & 31) << 3) | 4) as u8,
        ((((mode >> 5) & 31) << 3) | 4) as u8,
        (((mode & 31) << 3) | 4) as u8,
    ];
    let base = relative_luminance(background);
    let mask = bgra
        .chunks_exact(4)
        .map(|pixel| {
            let luminance = relative_luminance([pixel[2], pixel[1], pixel[0]]);
            (luminance.max(base) + 0.05) / (luminance.min(base) + 0.05) >= INK_CONTRAST
        })
        .collect::<Vec<_>>();
    let clusters = ink_clusters(&mask, width, height);
    let total = mask.iter().filter(|ink| **ink).count();
    let bottom = mask
        .iter()
        .enumerate()
        .filter(|(index, ink)| **ink && *index / width as usize >= (height as f32 * 0.72) as usize)
        .count();
    let substantial_low_cluster = clusters.iter().any(|cluster| {
        cluster.area as f64 / (width as f64 * height as f64) >= 0.015 && cluster.y >= 0.72
    });
    InkFrame {
        at,
        mask,
        clusters,
        bottom_alive: substantial_low_cluster && total > 0 && bottom as f64 / total as f64 >= 0.05,
    }
}

fn relative_luminance(rgb: [u8; 3]) -> f32 {
    let channel = |value: u8| {
        let value = f32::from(value) / 255.0;
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}

fn ink_clusters(mask: &[bool], width: u32, height: u32) -> Vec<InkCluster> {
    let mut seen = vec![false; mask.len()];
    let mut clusters = Vec::new();
    for seed in 0..mask.len() {
        if !mask[seed] || seen[seed] {
            continue;
        }
        seen[seed] = true;
        let mut queue = VecDeque::from([seed]);
        let (mut area, mut sum_x, mut sum_y) = (0usize, 0usize, 0usize);
        while let Some(index) = queue.pop_front() {
            let x = index % width as usize;
            let y = index / width as usize;
            area += 1;
            sum_x += x;
            sum_y += y;
            for neighbour in [
                x.checked_sub(1).map(|nx| y * width as usize + nx),
                (x + 1 < width as usize).then_some(y * width as usize + x + 1),
                y.checked_sub(1).map(|ny| ny * width as usize + x),
                (y + 1 < height as usize).then_some((y + 1) * width as usize + x),
            ]
            .into_iter()
            .flatten()
            {
                if mask[neighbour] && !seen[neighbour] {
                    seen[neighbour] = true;
                    queue.push_back(neighbour);
                }
            }
        }
        if area >= 2 {
            clusters.push(InkCluster {
                area,
                x: sum_x as f32 / area as f32 / width.max(1) as f32,
                y: sum_y as f32 / area as f32 / height.max(1) as f32,
            });
        }
    }
    clusters.sort_by_key(|cluster| std::cmp::Reverse(cluster.area));
    clusters.truncate(5);
    clusters
}

fn icgs(clusters: &[InkCluster]) -> Vec<u16> {
    let mut signature = vec![clusters.len() as u16];
    for left in 0..clusters.len() {
        for right in left + 1..clusters.len() {
            let dx = clusters[left].x - clusters[right].x;
            let dy = clusters[left].y - clusters[right].y;
            signature.push(((dx * dx + dy * dy).sqrt() * 1024.0).round() as u16);
        }
    }
    signature
}

fn stable_hash(bytes: &[u8]) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

/// How far a cluster has to travel, as a fraction of frame height, for the frame not to count
/// as holding the same arrangement.
///
/// **Taken from the move registry, not chosen here.** This was 0.03 while `make-room` — the
/// registry's only positional response, the move whose whole job is to answer an arrival —
/// travels 0.0278. So a shot held with a real response in it still read as frozen, and the only
/// way to clear the check was for elements to keep *arriving*. That is a check quietly insisting
/// on a slideshow: constant entrances pass, sustained motion does not.
///
/// It is the third time these two definitions have been found disagreeing (`no-response` at
/// 0.0198 against 0.02, and the same move again for `broken-continuity`), so it is now read from
/// the registry rather than restated, and `the_frozen_threshold_is_what_a_response_travels`
/// fails if they drift apart again.
fn moved_enough() -> f32 {
    bay_project::moves::find("make-room")
        .map(|response| {
            response
                .lead_channel()
                .keys
                .iter()
                .filter_map(|key| match key.value {
                    bay_project::moves::KeyValue::Offset(offset) => Some(offset.abs()),
                    _ => None,
                })
                .fold(0.0_f32, f32::max)
        })
        // A registry with no `make-room` in it is a broken build, not a project to judge; the
        // old literal is the least surprising thing to fall back to.
        .filter(|travel| *travel > 0.0)
        .unwrap_or(0.03)
}

fn frozen_pair(before: &InkFrame, after: &InkFrame, width: u32, height: u32) -> bool {
    let intersection = before
        .mask
        .iter()
        .zip(&after.mask)
        .filter(|(a, b)| **a && **b)
        .count();
    let union = before
        .mask
        .iter()
        .zip(&after.mask)
        .filter(|(a, b)| **a || **b)
        .count();
    if union == 0 || intersection as f64 / union as f64 <= 0.97 {
        return false;
    }
    // A cluster counts as changed if it TRAVELLED or if it CHANGED SIZE.
    //
    // Position alone was the whole test, and it made half the move registry invisible here:
    // `push-in`, `swell`, `press`, `fill` and an audio-reactive pulse all grow an element in
    // place, so its centroid does not move and a shot built on them read as frozen. The check's
    // own message is "the same ink arrangement", and an arrangement is where things are *and*
    // how big they are.
    let moved = before
        .clusters
        .iter()
        .filter(|cluster| {
            let nearest = after.clusters.iter().min_by(|left, right| {
                let distance = |other: &InkCluster| {
                    let dx = (cluster.x - other.x) * width as f32;
                    let dy = (cluster.y - other.y) * height as f32;
                    dx * dx + dy * dy
                };
                distance(left).total_cmp(&distance(right))
            });
            let Some(nearest) = nearest else {
                return true;
            };
            let dx = (cluster.x - nearest.x) * width as f32;
            let dy = (cluster.y - nearest.y) * height as f32;
            let travelled = (dx * dx + dy * dy).sqrt() / height.max(1) as f32;
            if travelled >= moved_enough() {
                return true;
            }
            // Sizes compared as linear extents — the square root of the area — because that is
            // the unit `scale` is in, and the floor is the registry's own: the smallest scale
            // change a named move is allowed to make.
            let extent = |area: usize| (area as f32).sqrt();
            let (from, to) = (extent(cluster.area), extent(nearest.area));
            let larger = from.max(to);
            larger > 0.0 && (from - to).abs() / larger >= grew_enough()
        })
        .count();
    moved < 2
}

/// The smallest change in an element's linear extent that the move registry calls a move.
///
/// Read from the registry for the same reason [`moved_enough`] is: a check demanding motion and
/// a vocabulary defining it must not each hold their own number.
fn grew_enough() -> f32 {
    let floor = bay_project::moves::amplitude_floor(bay_project::moves::MoveKind::Ambient, "scale");
    if floor > 0.0 { floor } else { 0.025 }
}

#[cfg(test)]
mod tests {
    use super::{frozen_pair, ink_frame, text_collision_findings};
    use bay_project::{
        BlendMode, Element, ElementRole, ElementSource, MediaTime, Project, ShapeElement,
        ShapeKind, TextDecorations, TextElement, TextPlate, Transform,
    };

    fn lower_quarter_frame() -> Vec<u8> {
        let mut bgra = vec![0; 8 * 8 * 4];
        for y in 6..8 {
            for x in 0..8 {
                let offset = (y * 8 + x) * 4;
                bgra[offset..offset + 4].copy_from_slice(&[255, 255, 255, 255]);
            }
        }
        bgra
    }

    fn seconds(value: f64) -> MediaTime {
        MediaTime::from_seconds_f64(value).expect("representable")
    }

    fn title(id: &str, content: &str, font_size: f32, y: f32) -> Element {
        Element::Text(TextElement {
            id: id.into(),
            name: id.into(),
            start: MediaTime::ZERO,
            duration: seconds(3.0),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            content: content.into(),
            font_size,
            color: "#ffffff".into(),
            transform: Transform {
                x: 0.08,
                y,
                scale: 0.84,
                anchor_x: 0.0,
                anchor_y: 0.0,
                ..Transform::default()
            },
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: BlendMode::Normal,
            mask: None,
            font_family: None,
            font_weight: 400,
            align: Default::default(),
            letter_spacing: 0.0,
            line_height: 1.2,
            decorations: None,
            karaoke: None,
            type_on: None,
            source: ElementSource::Author,
            role: ElementRole::Label,
        })
    }

    fn shape(id: &str, transform: Transform) -> Element {
        Element::Shape(ShapeElement {
            id: id.into(),
            name: id.into(),
            start: MediaTime::ZERO,
            duration: seconds(3.0),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            shape: ShapeKind::Rect { radius: 0.0 },
            color: "#ff4f4f".into(),
            gradient: None,
            stroke: None,
            transform,
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: BlendMode::Normal,
            mask: None,
            source: ElementSource::Author,
            role: ElementRole::Data,
        })
    }

    #[test]
    fn overlapping_shaped_text_fires_the_collision_gate() {
        let mut project = Project::starter();
        project.active_scene_mut().tracks.main.elements = vec![
            title("kicker", "THE GREEN INTERVIEW · CC BY 3.0", 46.0, 0.10),
            title("headline", "JANE GOODALL ON HOPE", 70.0, 0.10),
        ];

        let findings = text_collision_findings(&project);

        assert_eq!(findings.len(), 1, "{findings:#?}");
        assert_eq!(findings[0]["code"], "text-collision");
        assert_eq!(findings[0]["severity"], "error");
    }

    #[test]
    fn opaque_shape_crossing_glyph_ink_fires_the_collision_gate() {
        let mut project = Project::starter();
        project.active_scene_mut().tracks.main.elements = vec![
            title("headline", "HIDDEN TYPE", 96.0, 0.10),
            shape(
                "occluder",
                Transform {
                    x: 0.08,
                    y: 0.10,
                    scale: 0.84,
                    scale_y: 0.16,
                    anchor_x: 0.0,
                    anchor_y: 0.0,
                    ..Transform::default()
                },
            ),
        ];

        let findings = text_collision_findings(&project);

        assert_eq!(findings.len(), 1, "{findings:#?}");
        assert_eq!(findings[0]["code"], "text-collision");
        assert_eq!(findings[0]["elementId"], "headline");
        assert_eq!(findings[0]["occluderId"], "occluder");
    }

    #[test]
    fn one_hidden_glyph_in_a_long_title_is_not_diluted_by_its_siblings() {
        let mut project = Project::starter();
        project.active_scene_mut().tracks.main.elements = vec![
            title("headline", "ABCDEFGH", 96.0, 0.10),
            shape(
                "one-letter-occluder",
                Transform {
                    x: 0.08,
                    y: 0.10,
                    scale: 0.07,
                    scale_y: 1.5,
                    anchor_x: 0.0,
                    anchor_y: 0.0,
                    ..Transform::default()
                },
            ),
        ];

        let findings = text_collision_findings(&project);

        assert_eq!(findings.len(), 1, "{findings:#?}");
        assert_eq!(findings[0]["occluderId"], "one-letter-occluder");
    }

    #[test]
    fn translucent_scrim_behind_text_is_not_a_collision() {
        let mut project = Project::starter();
        let mut scrim = shape(
            "scrim",
            Transform {
                x: 0.0,
                y: 0.0,
                scale: 1.0,
                anchor_x: 0.0,
                anchor_y: 0.0,
                opacity: 0.55,
                ..Transform::default()
            },
        );
        let Element::Shape(scrim_shape) = &mut scrim else {
            unreachable!()
        };
        scrim_shape.role = ElementRole::Chrome;
        project.active_scene_mut().tracks.main.elements =
            vec![scrim, title("caption", "READABLE", 64.0, 0.68)];

        let findings = text_collision_findings(&project);

        assert!(
            findings.is_empty(),
            "a translucent ground behind type must remain legal: {findings:#?}"
        );
    }

    #[test]
    fn translucent_wash_above_text_is_not_an_occluder() {
        let mut project = Project::starter();
        let wash = shape(
            "wash",
            Transform {
                x: 0.08,
                y: 0.10,
                scale: 0.84,
                scale_y: 0.16,
                anchor_x: 0.0,
                anchor_y: 0.0,
                opacity: 0.55,
                ..Transform::default()
            },
        );
        project.active_scene_mut().tracks.main.elements =
            vec![title("headline", "VISIBLE TYPE", 96.0, 0.10), wash];

        let findings = text_collision_findings(&project);

        assert!(
            findings.is_empty(),
            "a translucent wash does not hide enough glyph ink to be an occluder: {findings:#?}"
        );
    }

    #[test]
    fn lower_third_plate_and_decorated_text_do_not_false_positive() {
        let mut project = Project::starter();
        let mut name = title("name", "JANE GOODALL", 64.0, 0.68);
        let Element::Text(name_text) = &mut name else {
            unreachable!()
        };
        name_text.decorations = Some(TextDecorations {
            plate: Some(TextPlate {
                color: "#000000cc".into(),
                padding_x: 48.0,
                padding_y: 48.0,
                radius: 10.0,
            }),
            ..TextDecorations::default()
        });
        let plate = Element::Shape(ShapeElement {
            id: "lower-third".into(),
            name: "lower-third".into(),
            start: MediaTime::ZERO,
            duration: seconds(3.0),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            shape: ShapeKind::Rect { radius: 12.0 },
            color: "#101010".into(),
            gradient: None,
            stroke: None,
            transform: Transform {
                x: 0.05,
                y: 0.64,
                scale: 0.88,
                scale_y: 0.20,
                anchor_x: 0.0,
                anchor_y: 0.0,
                ..Transform::default()
            },
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: BlendMode::Normal,
            mask: None,
            source: ElementSource::Author,
            role: ElementRole::Chrome,
        });
        project.active_scene_mut().tracks.main.elements =
            vec![plate, name, title("role", "CONSERVATIONIST", 38.0, 0.84)];

        let findings = text_collision_findings(&project);

        assert!(
            findings.is_empty(),
            "shape/plate layering and decoration margins are legitimate: {findings:#?}"
        );
    }

    #[test]
    fn frame_metrics_detect_substantial_lower_frame_ink() {
        let frame = ink_frame(1.0, 8, 8, &lower_quarter_frame());

        assert_eq!(frame.at, 1.0);
        assert!(frame.bottom_alive);
        assert_eq!(frame.clusters.len(), 1);
        assert_eq!(frame.clusters[0].area, 16);
    }

    /// The registry's positional response and the check that judges whether anything moved have
    /// to be the same question. They were not: `make-room` travelled 0.0278 against a literal
    /// 0.03 here, so a held shot with a real response in it was still reported frozen and the
    /// only way to pass was to keep introducing elements.
    #[test]
    fn the_frozen_threshold_is_what_a_response_travels() {
        let response = bay_project::moves::find("make-room").expect("make-room is in the registry");
        let travel = response
            .lead_channel()
            .keys
            .iter()
            .filter_map(|key| match key.value {
                bay_project::moves::KeyValue::Offset(offset) => Some(offset.abs()),
                _ => None,
            })
            .fold(0.0_f32, f32::max);
        assert!(
            travel >= super::moved_enough(),
            "make-room travels {travel} but a frame needs {} of movement to count as alive, so              the registry's own response cannot clear the check that demands one",
            super::moved_enough()
        );
    }

    /// A shot whose only motion is a scale is not a frozen shot. Half the registry moves an
    /// element without moving its centre — `push-in`, `swell`, `press`, `fill`, and the
    /// audio-reactive pulse — and while this compared positions only, every one of them read as
    /// nothing happening. The check then had exactly one way to be satisfied: elements
    /// arriving. A check that can only be cleared by constant entrances is a check asking for a
    /// slideshow.
    #[test]
    fn a_shot_that_only_grows_is_not_frozen() {
        let (width, height) = (64_u32, 64_u32);
        let block = |from: u32, to: u32| {
            let mut bgra = vec![0u8; (width * height * 4) as usize];
            for y in from..to {
                for x in from..to {
                    let index = ((y * width + x) * 4) as usize;
                    bgra[index..index + 4].copy_from_slice(&[255, 255, 255, 255]);
                }
            }
            bgra
        };
        // The same block, grown well past the registry's smallest named scale change, about
        // the same centre — so it has travelled nothing at all.
        let still = block(20, 30);
        let grown = block(18, 32);
        let before = ink_frame(0.0, width, height, &still);
        let after = ink_frame(1.2, width, height, &grown);
        assert!(
            !frozen_pair(&before, &after, width, height),
            "a block that grew by 40% in place is not the same arrangement"
        );
        // And the identical frame still is frozen, so this did not simply disable the check.
        let same = ink_frame(1.2, width, height, &still);
        assert!(
            frozen_pair(&before, &same, width, height),
            "two identical frames must still read as frozen"
        );
    }

    #[test]
    fn frozen_pairs_require_nearly_identical_ink() {
        let first = ink_frame(0.0, 8, 8, &lower_quarter_frame());
        let same = ink_frame(0.5, 8, 8, &lower_quarter_frame());
        let changed = ink_frame(0.5, 8, 8, &vec![0; 8 * 8 * 4]);

        assert!(frozen_pair(&first, &same, 8, 8));
        assert!(!frozen_pair(&first, &changed, 8, 8));
    }
}
