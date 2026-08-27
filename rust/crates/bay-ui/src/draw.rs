//! Drawing: shapes painted straight into the scene, and the one rule for uploading a raster.
//!
//! Until this module, every visual in bay was a `div` with a background colour. That is fine for
//! chrome and impossible for a curve. `gpui::canvas()`, `Window::paint_path` and `PathBuilder`
//! were all present in GPUI 0.2.2 and used zero times in this tree; this is where they get used.
//!
//! **The decision, and the reasoning behind it, is in `docs/native/drawing.md`.** Read it before
//! adding a second way to draw something — it exists so the five milestones that build on this
//! do not each re-litigate the question.
//!
//! The short version:
//!
//! - **Vector geometry is a path.** Curves, waveform outlines, wheel rings, grids, EQ responses,
//!   fader tracks. [`Shape`] + [`paint`] cover all of them.
//! - **A density plot is a raster.** A vectorscope is ~130,000 samples; there is no path that
//!   draws it. The CPU reduction that turns a frame into a raster belongs in `bay-preview`
//!   (M7), not here — this module only owns the upload, and the upload has an obligation
//!   attached to it. See [`RetiredImages`].
//!
//! Everything here is in the element's own coordinates: `(0, 0)` is the top-left of the element
//! the canvas occupies, not of the window. [`paint`] translates by the element's origin, so a
//! caller plotting a curve never has to know where its panel landed.

use std::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;

use gpui::{
    canvas, point, px, Bounds, Canvas, Path, PathBuilder, Pixels, Point, RenderImage, Rgba, Window,
};

/// Convert a `0xRRGGBB` theme token into something `paint_path` accepts.
///
/// `gpui::rgb` returns the same thing; this exists so a call site reads `fill(theme::ACCENT)`
/// next to the shape it fills rather than importing a colour constructor into every module.
fn fill(color: u32) -> Rgba {
    gpui::rgb(color)
}

/// One drawing, in element-local coordinates.
///
/// A `Vec<Shape>` is the whole vocabulary of a panel: a scope, a curve editor and a colour wheel
/// are each a list of these. Deliberately small — a shape that four panels do not want is a
/// shape the fifth panel should build out of a polyline.
#[derive(Debug, Clone, PartialEq)]
pub enum Shape {
    /// An open stroked line through every point in order. The workhorse: a curve, a waveform
    /// spine, an EQ response, a grid line.
    Polyline {
        points: Vec<Point<Pixels>>,
        width: Pixels,
        color: u32,
        /// On/off run lengths, as `stroke-dasharray`. `None` is a solid line.
        dash: Option<Vec<Pixels>>,
    },
    /// A filled, closed outline. This is how a waveform is drawn — one path around the whole
    /// envelope, not one rectangle per bucket.
    Polygon {
        points: Vec<Point<Pixels>>,
        color: u32,
    },
    /// A filled disc: a keyframe dot, a wheel's centre puck, a scope point.
    Circle {
        center: Point<Pixels>,
        radius: Pixels,
        color: u32,
    },
    /// A stroked circle: a colour wheel's rim, a graticule ring, a selected handle.
    Ring {
        center: Point<Pixels>,
        radius: Pixels,
        width: Pixels,
        color: u32,
    },
}

impl Shape {
    /// A solid stroked line.
    pub fn line(points: Vec<Point<Pixels>>, width: f32, color: u32) -> Self {
        Shape::Polyline {
            points,
            width: px(width),
            color,
            dash: None,
        }
    }

    /// A dashed stroked line — a graticule, a zero line, an out-of-range guide.
    pub fn dashed(points: Vec<Point<Pixels>>, width: f32, color: u32, dash: [f32; 2]) -> Self {
        Shape::Polyline {
            points,
            width: px(width),
            color,
            dash: Some(vec![px(dash[0]), px(dash[1])]),
        }
    }

    /// A filled disc.
    pub fn disc(center: Point<Pixels>, radius: f32, color: u32) -> Self {
        Shape::Circle {
            center,
            radius: px(radius),
            color,
        }
    }

    /// A stroked circle.
    pub fn ring(center: Point<Pixels>, radius: f32, width: f32, color: u32) -> Self {
        Shape::Ring {
            center,
            radius: px(radius),
            width: px(width),
            color,
        }
    }

    /// A filled closed outline.
    pub fn area(points: Vec<Point<Pixels>>, color: u32) -> Self {
        Shape::Polygon { points, color }
    }

    /// The colour this shape paints in.
    pub fn color(&self) -> u32 {
        match self {
            Shape::Polyline { color, .. }
            | Shape::Polygon { color, .. }
            | Shape::Circle { color, .. }
            | Shape::Ring { color, .. } => *color,
        }
    }

    /// How many points the tessellator will be handed. The cost of a frame is roughly linear in
    /// the sum of this over every shape, which is why a caller decimates to the viewport width
    /// before building shapes rather than after.
    pub fn point_count(&self) -> usize {
        match self {
            Shape::Polyline { points, .. } | Shape::Polygon { points, .. } => points.len(),
            // Four cubic segments, as `circle_path` builds them.
            Shape::Circle { .. } | Shape::Ring { .. } => CIRCLE_SEGMENTS,
        }
    }

    /// Tessellate into a GPUI path, translated so element-local `(0, 0)` lands at `origin`.
    ///
    /// `None` when the shape has nothing to draw (fewer than two points, a zero radius) or when
    /// lyon refuses it. A shape that cannot be tessellated is skipped, never panicked on: these
    /// coordinates come from user-dragged values and a NaN must not take the window down.
    fn build(&self, origin: Point<Pixels>) -> Option<Path<Pixels>> {
        match self {
            Shape::Polyline {
                points,
                width,
                dash,
                ..
            } => {
                let points = translated(points, origin)?;
                if points.len() < 2 || f32::from(*width) <= 0.0 {
                    return None;
                }
                let mut builder = PathBuilder::stroke(*width);
                if let Some(dash) = dash {
                    builder = builder.dash_array(dash);
                }
                builder.add_polygon(&points, false);
                builder.build().ok()
            }
            Shape::Polygon { points, .. } => {
                let points = translated(points, origin)?;
                if points.len() < 3 {
                    return None;
                }
                let mut builder = PathBuilder::fill();
                builder.add_polygon(&points, true);
                builder.build().ok()
            }
            Shape::Circle { center, radius, .. } => {
                if !finite(*center) || !f32::from(*radius).is_finite() || f32::from(*radius) <= 0.0
                {
                    return None;
                }
                let mut builder = PathBuilder::fill();
                circle_path(&mut builder, translate(*center, origin), *radius);
                builder.build().ok()
            }
            Shape::Ring {
                center,
                radius,
                width,
                ..
            } => {
                if !finite(*center)
                    || !f32::from(*radius).is_finite()
                    || f32::from(*radius) <= 0.0
                    || f32::from(*width) <= 0.0
                {
                    return None;
                }
                let mut builder = PathBuilder::stroke(*width);
                circle_path(&mut builder, translate(*center, origin), *radius);
                builder.build().ok()
            }
        }
    }
}

/// A circle is four cubic segments. Exact enough at any radius a panel will use, and it avoids
/// `arc_to`'s degenerate case where the start and end point coincide.
const CIRCLE_SEGMENTS: usize = 4;

/// Kappa: the control-point offset that makes a cubic quarter-arc match a circle.
const KAPPA: f32 = 0.552_284_8;

fn circle_path(builder: &mut PathBuilder, center: Point<Pixels>, radius: Pixels) {
    let (cx, cy, r) = (f32::from(center.x), f32::from(center.y), f32::from(radius));
    let k = r * KAPPA;
    let at = |x: f32, y: f32| point(px(x), px(y));
    builder.move_to(at(cx + r, cy));
    builder.cubic_bezier_to(at(cx, cy + r), at(cx + r, cy + k), at(cx + k, cy + r));
    builder.cubic_bezier_to(at(cx - r, cy), at(cx - k, cy + r), at(cx - r, cy + k));
    builder.cubic_bezier_to(at(cx, cy - r), at(cx - r, cy - k), at(cx - k, cy - r));
    builder.cubic_bezier_to(at(cx + r, cy), at(cx + k, cy - r), at(cx + r, cy - k));
    builder.close();
}

fn finite(p: Point<Pixels>) -> bool {
    f32::from(p.x).is_finite() && f32::from(p.y).is_finite()
}

fn translate(p: Point<Pixels>, origin: Point<Pixels>) -> Point<Pixels> {
    point(origin.x + p.x, origin.y + p.y)
}

/// Translate a whole run, refusing the lot if any point is not a number.
///
/// All-or-nothing on purpose: dropping the one bad point of a curve silently joins its
/// neighbours and draws a line that is not the data. Drawing nothing is the honest failure.
fn translated(points: &[Point<Pixels>], origin: Point<Pixels>) -> Option<Vec<Point<Pixels>>> {
    if points.iter().any(|p| !finite(*p)) {
        return None;
    }
    Some(points.iter().map(|p| translate(*p, origin)).collect())
}

/// A canvas element that paints `shapes` in element-local coordinates.
///
/// Size it like any other element (`.size_full()`, `.h(px(120.0))`); the shapes are clipped to
/// the bounds by GPUI's content mask, so a curve that runs off the panel is cut rather than
/// drawn over its neighbour.
///
/// Note what this does **not** give you: hit-testing. A path is geometry, not an element, so a
/// canvas has no `on_click`. Interaction is a sibling or parent `div` with an id, and the
/// pointer-to-datum mapping is the caller's — see `controls.rs`, where the widgets do exactly
/// that. That is true of the image route as well, so it did not decide anything.
pub fn paint(shapes: Vec<Shape>) -> Canvas<()> {
    canvas(
        |_, _, _| (),
        move |bounds: Bounds<Pixels>, _, window: &mut Window, _| {
            for shape in &shapes {
                if let Some(path) = shape.build(bounds.origin) {
                    window.paint_path(path, fill(shape.color()));
                }
            }
        },
    )
}

/// A canvas that draws nothing and reports where it landed.
///
/// A path is geometry, not an element, so nothing on the drawing route hit-tests itself; and a
/// mouse event carries a window-space position, while a widget reasons in its own track's
/// coordinates. This is the join between the two: park it in a `relative()` container as an
/// absolute, full-size child, and the mouse handlers built in the same render pass read the
/// bounds back out of the cell. Prepaint runs before any event for that frame is dispatched, so
/// the value is always this frame's.
pub fn measure(into: Rc<Cell<Bounds<Pixels>>>) -> Canvas<()> {
    canvas(move |bounds, _, _| into.set(bounds), |_, _, _, _| {})
}

/// Min and max of each bucket of `samples`, as `(min, max)` pairs.
///
/// The pure half of drawing a waveform. Peak-per-bucket (what the timeline's 48 bars show) loses
/// the sign, so a tall waveform drawn from it is a mirror of a rectified signal rather than a
/// waveform. `buckets` is the viewport width in pixels: decimating to the pixels that exist is
/// what keeps a ten-minute file the same cost to draw as a ten-second one.
///
/// An empty input, or zero buckets, gives an empty result — not a flat line at zero, which would
/// claim silence where there is no data.
pub fn envelope(samples: &[f32], buckets: usize) -> Vec<(f32, f32)> {
    if samples.is_empty() || buckets == 0 {
        return Vec::new();
    }
    (0..buckets)
        .map(|bucket| {
            let start = bucket * samples.len() / buckets;
            let end = (((bucket + 1) * samples.len()) / buckets).max(start + 1);
            let slice = &samples[start..end.min(samples.len())];
            // Seeded from the infinities, not from zero: a bucket of entirely positive samples
            // whose minimum is reported as 0 draws a waveform that touches a midline the signal
            // never crosses. A bucket with nothing finite in it is flat, which is the truth.
            let (low, high) = slice
                .iter()
                .filter(|value| value.is_finite())
                .fold((f32::INFINITY, f32::NEG_INFINITY), |(low, high), value| {
                    (low.min(*value), high.max(*value))
                });
            if low > high {
                (0.0, 0.0)
            } else {
                (low, high)
            }
        })
        .collect()
}

/// Turn an [`envelope`] into one closed outline, `width` × `height`, centred on its own midline.
///
/// One [`Shape::Polygon`] rather than one rectangle per bucket. The timeline draws 48 divs for a
/// clip's waveform today; at 900px of mixer width that would be 900 elements per track, and the
/// element tree is rebuilt every frame.
///
/// Runs left-to-right along the maxima and right-to-left along the minima, so the path closes on
/// itself without a seam.
pub fn envelope_outline(envelope: &[(f32, f32)], width: f32, height: f32) -> Vec<Point<Pixels>> {
    if envelope.len() < 2 || !(width.is_finite() && height.is_finite()) {
        return Vec::new();
    }
    let mid = height / 2.0;
    let step = width / (envelope.len() - 1).max(1) as f32;
    let y_of = |value: f32| px(mid - value.clamp(-1.0, 1.0) * mid);
    let mut points: Vec<Point<Pixels>> = envelope
        .iter()
        .enumerate()
        .map(|(index, (_, high))| point(px(index as f32 * step), y_of(*high)))
        .collect();
    points.extend(
        envelope
            .iter()
            .enumerate()
            .rev()
            .map(|(index, (low, _))| point(px(index as f32 * step), y_of(*low))),
    );
    points
}

/// The atlas obligation, in one place.
///
/// GPUI keys its sprite atlas on `RenderImage::id`, a fresh monotonic counter value per image,
/// and it **never evicts on drop** — `Window::drop_image` is the only thing that calls
/// `PlatformAtlas::remove`. So a panel that builds a new `RenderImage` per frame (a scope, a
/// histogram, anything rastered on the CPU) misses the cache every time, allocates another tile,
/// and pushes a new 1024×1024 atlas texture every couple of frames, none of which is ever freed.
/// This repository has already shipped that leak once, in the preview.
///
/// The rule, and it is not negotiable for any raster-drawing panel:
///
/// 1. When an image leaves the screen, [`retire`](Self::retire) it. Do **not** drop the `Arc` —
///    dropping frees the memory and orphans the atlas tile, which is the leak.
/// 2. Once per frame, at the *top* of `render` and before the element tree is rebuilt, call
///    [`release`](Self::release). Only then is it certain that every queued image was last
///    painted into a frame that has already been submitted.
///
/// The queue is what lets a windowless caller retire a frame at all: there is no `Window` in
/// scope when a project closes, so the `Arc` parks here and the next render drains it.
#[derive(Default)]
pub struct RetiredImages {
    queue: Vec<Arc<RenderImage>>,
}

impl RetiredImages {
    pub fn new() -> Self {
        Self::default()
    }

    /// Hand over an image that has left the screen. It keeps its atlas tile until [`release`].
    ///
    /// [`release`]: Self::release
    pub fn retire(&mut self, image: Arc<RenderImage>) {
        self.queue.push(image);
    }

    /// Convenience for the common shape: replace whatever `slot` holds, retiring the old one.
    ///
    /// Assigning over an `Option<Arc<RenderImage>>` directly is the mistake this exists to make
    /// harder to write.
    pub fn replace(&mut self, slot: &mut Option<Arc<RenderImage>>, next: Option<Arc<RenderImage>>) {
        if let Some(previous) = slot.take() {
            self.retire(previous);
        }
        *slot = next;
    }

    /// Give every queued image's atlas tile back. Call at the top of `render`.
    pub fn release(&mut self, window: &mut Window) {
        for image in self.queue.drain(..) {
            let _ = window.drop_image(image);
        }
    }

    /// How many tiles are waiting to be freed. For tests: a panel that never calls
    /// [`release`](Self::release) shows up here as a number that only goes up.
    pub fn pending(&self) -> usize {
        self.queue.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(x: f32, y: f32) -> Point<Pixels> {
        point(px(x), px(y))
    }

    fn sine(count: usize) -> Vec<Point<Pixels>> {
        (0..count)
            .map(|index| {
                let t = index as f32 / count as f32;
                at(
                    t * 900.0,
                    60.0 + (t * std::f32::consts::TAU * 6.0).sin() * 50.0,
                )
            })
            .collect()
    }

    /// The spike, as a test: the two shapes the decision was made on actually tessellate.
    #[test]
    fn a_polyline_and_a_circle_both_build() {
        let origin = at(40.0, 12.0);
        assert!(Shape::line(sine(1000), 1.5, 0x5b8cff)
            .build(origin)
            .is_some());
        assert!(Shape::disc(at(50.0, 50.0), 9.0, 0xe7e7ee)
            .build(origin)
            .is_some());
        assert!(Shape::ring(at(50.0, 50.0), 40.0, 2.0, 0x2a2a36)
            .build(origin)
            .is_some());
        assert!(Shape::area(sine(64), 0x2d3a66).build(origin).is_some());
    }

    /// Stroke width and dashes are both available on the path route. This is one of the four
    /// things `drawing.md` says the decision turned on, so it is checked rather than asserted.
    #[test]
    fn stroke_width_and_dashes_are_available() {
        let solid = Shape::line(sine(200), 1.0, 0x5b8cff).build(at(0.0, 0.0));
        let thick = Shape::line(sine(200), 6.0, 0x5b8cff).build(at(0.0, 0.0));
        let dashed = Shape::dashed(sine(200), 1.0, 0x5b8cff, [4.0, 3.0]).build(at(0.0, 0.0));
        assert!(solid.is_some() && thick.is_some() && dashed.is_some());
    }

    /// A curve editor's points come from user drags, and a drag can produce anything. The render
    /// path may not panic on it, and it may not draw a line the data does not contain.
    #[test]
    fn nonsense_coordinates_draw_nothing_rather_than_a_lie() {
        let mut points = sine(50);
        points[20] = at(f32::NAN, 3.0);
        assert!(Shape::line(points, 1.0, 0xffffff)
            .build(at(0.0, 0.0))
            .is_none());

        assert!(Shape::disc(at(f32::INFINITY, 0.0), 4.0, 0xffffff)
            .build(at(0.0, 0.0))
            .is_none());
        assert!(Shape::disc(at(1.0, 1.0), f32::NAN, 0xffffff)
            .build(at(0.0, 0.0))
            .is_none());
        assert!(Shape::disc(at(1.0, 1.0), 0.0, 0xffffff)
            .build(at(0.0, 0.0))
            .is_none());
        assert!(Shape::line(vec![at(0.0, 0.0)], 1.0, 0xffffff)
            .build(at(0.0, 0.0))
            .is_none());
        assert!(Shape::area(vec![at(0.0, 0.0), at(1.0, 1.0)], 0xffffff)
            .build(at(0.0, 0.0))
            .is_none());
    }

    /// The measurement `drawing.md` quotes. A generous ceiling, not a benchmark: the point is
    /// that a 1,000-point curve tessellates in well under a frame, and that if that ever stops
    /// being true somebody finds out here rather than by watching a curve editor stutter.
    #[test]
    fn a_thousand_point_polyline_tessellates_inside_a_frame() {
        let points = sine(1000);
        let started = std::time::Instant::now();
        const RUNS: u32 = 20;
        for _ in 0..RUNS {
            assert!(Shape::line(points.clone(), 1.5, 0x5b8cff)
                .build(at(0.0, 0.0))
                .is_some());
        }
        let each = started.elapsed() / RUNS;
        println!("1,000-point stroked polyline: {each:?} per tessellation");
        assert!(
            each < std::time::Duration::from_millis(8),
            "a 1,000-point polyline took {each:?}, which is most of a 16.6ms frame"
        );
    }

    #[test]
    fn point_count_is_what_the_tessellator_will_see() {
        assert_eq!(Shape::line(sine(1000), 1.0, 0).point_count(), 1000);
        assert_eq!(
            Shape::disc(at(0.0, 0.0), 5.0, 0).point_count(),
            CIRCLE_SEGMENTS
        );
    }

    /// Peak-per-bucket loses the sign; a mixer's waveform is not a rectified one.
    /// A bucket of entirely positive samples has a positive minimum. Reporting 0 there is what
    /// a fold seeded from zero does, and it draws a signal that touches its own midline.
    #[test]
    fn a_one_sided_bucket_reports_its_real_minimum() {
        assert_eq!(envelope(&[0.4, 0.9, 0.6], 1), vec![(0.4, 0.9)]);
        assert_eq!(envelope(&[-0.9, -0.4], 1), vec![(-0.9, -0.4)]);
        assert_eq!(
            envelope(&[f32::NAN, f32::NAN], 1),
            vec![(0.0, 0.0)],
            "a bucket with nothing in it is flat"
        );
    }

    #[test]
    fn an_envelope_keeps_both_signs() {
        let samples: Vec<f32> = (0..1000)
            .map(|i| (i as f32 / 1000.0 * std::f32::consts::TAU * 4.0).sin())
            .collect();
        let envelope = envelope(&samples, 100);
        assert_eq!(envelope.len(), 100);
        assert!(envelope.iter().any(|(low, _)| *low < -0.5), "no troughs");
        assert!(envelope.iter().any(|(_, high)| *high > 0.5), "no peaks");
        for (low, high) in &envelope {
            assert!(low <= high);
        }
    }

    /// No data is not the same as silence, and must not be drawn as a flat line.
    #[test]
    fn an_empty_signal_produces_no_outline() {
        assert!(envelope(&[], 64).is_empty());
        assert!(envelope(&[0.1, 0.2], 0).is_empty());
        assert!(envelope_outline(&[], 100.0, 40.0).is_empty());
        assert!(envelope_outline(&[(0.0, 1.0)], 100.0, 40.0).is_empty());
    }

    /// Every bucket is visited even when there are fewer samples than buckets, and the outline
    /// closes on itself: one point per bucket out, one per bucket back.
    #[test]
    fn the_outline_is_one_closed_path_spanning_the_width() {
        let samples = [
            1.0, -1.0, 0.5, -0.5, 0.25, -0.25, 0.25, -0.25, 0.5, -0.5, 1.0, -1.0,
        ];
        let envelope = envelope(&samples, 6);
        let outline = envelope_outline(&envelope, 120.0, 40.0);
        assert_eq!(outline.len(), 12);
        assert_eq!(outline[0].x, px(0.0));
        assert_eq!(outline[5].x, px(120.0));
        assert_eq!(outline[6].x, px(120.0));
        assert_eq!(outline[11].x, px(0.0));
        // The left bucket is full scale both ways: its top is the top edge, its bottom the
        // bottom edge.
        assert!(outline[0].y < px(2.0));
        assert!(outline[11].y > px(38.0));
    }

    /// A sample outside [-1, 1] is clamped rather than drawn outside the panel, and a NaN
    /// sample does not poison its bucket.
    #[test]
    fn a_hot_or_broken_sample_stays_inside_the_panel() {
        let envelope = envelope(&[9.0, -9.0, f32::NAN, 0.2], 2);
        let outline = envelope_outline(&envelope, 100.0, 40.0);
        for point in &outline {
            assert!(
                point.y >= px(0.0) && point.y <= px(40.0),
                "{point:?} escaped"
            );
        }
    }

    /// The obligation, as a test: retiring parks the tile, and nothing is freed until a frame
    /// releases it. `release` needs a `Window`, so this checks the queue side of the contract —
    /// which is the side that gets forgotten.
    #[test]
    fn a_retired_image_waits_for_a_frame_to_release_it() {
        let mut retired = RetiredImages::new();
        let mut slot: Option<Arc<RenderImage>> = None;
        assert_eq!(retired.pending(), 0);

        let frame = |value: u8| {
            let buffer =
                image::RgbaImage::from_pixel(2, 2, image::Rgba([value, value, value, 255]));
            Some(Arc::new(RenderImage::new(vec![image::Frame::new(buffer)])))
        };

        retired.replace(&mut slot, frame(1));
        assert_eq!(retired.pending(), 0, "the first frame replaced nothing");
        retired.replace(&mut slot, frame(2));
        assert_eq!(
            retired.pending(),
            1,
            "the frame it replaced must be queued, not dropped"
        );
        retired.replace(&mut slot, None);
        assert_eq!(retired.pending(), 2);
        assert!(slot.is_none());
    }
}
