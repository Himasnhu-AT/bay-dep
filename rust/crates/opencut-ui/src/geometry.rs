//! Pure timeline and viewer geometry — the one owner of pixel ↔ tick ↔ frame conversions.
//!
//! Nothing else in the UI multiplies by `pixels_per_second` or divides by [`TICKS_PER_SECOND`].
//! Scattering those two constants is how a ruler, a clip block and a playhead end up
//! disagreeing about where a second is, and how a drag commits a start time that falls
//! between two frames.
//!
//! Two rules the rest of the crate depends on:
//!
//! 1. **Scroll is never implicit.** A [`TimelineGeometry`] carries the scroll offset, so
//!    `ticks_to_px`/`px_to_ticks` are always window-space. There is no zero-scroll variant to
//!    reach for by accident. Differences (a drag delta) go through [`TimelineGeometry::delta_px_to_ticks`],
//!    where the offset cancels by construction rather than by being forgotten.
//! 2. **Frame math is integer math.** Frame rates are rationals (30000/1001), so every
//!    tick ↔ frame conversion is exact `i128` arithmetic, never `ticks * fps.as_f64()`. Ten
//!    minutes of 29.97 frames accumulates exactly zero drift.
//!
//! GPUI-free on purpose: every function here is unit-testable without a window.

use std::ops::Range;

use opencut_core::{Fps, MediaTime};

/// Ticks per second in [`MediaTime`]. Mirrors `time::TICKS_PER_SECOND`, which is not re-exported
/// through `opencut-project`; `ticks_per_second_matches_media_time` keeps the two honest.
pub const TICKS_PER_SECOND: i64 = 120_000;

/// Minimum spacing between two *labelled* ruler ticks. Timecode labels are ~9 characters, so
/// anything tighter overlaps.
pub const MIN_LABEL_SPACING_PX: f32 = 80.0;

/// Minimum spacing between two unlabelled ruler ticks, below which the subdivision is dropped.
const MIN_MINOR_SPACING_PX: f32 = 6.0;

/// A zoom level of zero would make every `px → time` mapping infinite, so the constructor floors
/// it here rather than letting a NaN reach a layout.
const PIXELS_PER_SECOND_FLOOR: f32 = 0.001;

/// The px ↔ ticks mapping for one timeline, at one zoom level and one scroll offset.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TimelineGeometry {
    pixels_per_second: f32,
    scroll_x: f32,
    fps: Fps,
}

impl TimelineGeometry {
    pub fn new(pixels_per_second: f32, scroll_x: f32, fps: Fps) -> Self {
        Self {
            pixels_per_second: sane(pixels_per_second, PIXELS_PER_SECOND_FLOOR)
                .max(PIXELS_PER_SECOND_FLOOR),
            scroll_x: sane(scroll_x, 0.0),
            fps,
        }
    }

    pub fn pixels_per_second(&self) -> f32 {
        self.pixels_per_second
    }

    pub fn scroll_x(&self) -> f32 {
        self.scroll_x
    }

    pub fn fps(&self) -> Fps {
        self.fps
    }

    pub fn with_scroll_x(&self, scroll_x: f32) -> Self {
        Self::new(self.pixels_per_second, scroll_x, self.fps)
    }

    pub fn with_pixels_per_second(&self, pixels_per_second: f32) -> Self {
        Self::new(pixels_per_second, self.scroll_x, self.fps)
    }

    // ---- seconds ↔ px -------------------------------------------------------------------

    /// Window-space x of a point in time, in seconds.
    pub fn seconds_to_px(&self, seconds: f64) -> f32 {
        (seconds * f64::from(self.pixels_per_second) - f64::from(self.scroll_x)) as f32
    }

    /// Time in seconds at a window-space x. Negative before the start of the timeline.
    pub fn px_to_seconds(&self, x: f32) -> f64 {
        f64::from(x + self.scroll_x) / f64::from(self.pixels_per_second)
    }

    // ---- ticks ↔ px ---------------------------------------------------------------------

    /// Window-space x of a media time.
    pub fn ticks_to_px(&self, time: MediaTime) -> f32 {
        self.seconds_to_px(time.as_ticks() as f64 / TICKS_PER_SECOND as f64)
    }

    /// Media time at a window-space x, to the nearest tick (not snapped to a frame — use
    /// [`Self::px_to_frame_time`] for anything a user drops).
    pub fn px_to_ticks(&self, x: f32) -> MediaTime {
        MediaTime::from_ticks(round_f64(self.px_to_seconds(x) * TICKS_PER_SECOND as f64))
    }

    /// Media time at a window-space x, snapped to the nearest frame boundary. This is what a
    /// drag, a scrub or a click on the ruler commits.
    pub fn px_to_frame_time(&self, x: f32) -> MediaTime {
        self.quantize_to_frame(self.px_to_ticks(x))
    }

    /// A *difference* in pixels as a difference in ticks. The scroll offset cancels in a
    /// subtraction, so this deliberately does not consult it — but only differences may use it.
    pub fn delta_px_to_ticks(&self, delta_px: f32) -> MediaTime {
        MediaTime::from_ticks(round_f64(
            f64::from(delta_px) / f64::from(self.pixels_per_second) * TICKS_PER_SECOND as f64,
        ))
    }

    /// A duration as an on-screen width. Independent of scroll, like [`Self::delta_px_to_ticks`].
    pub fn delta_ticks_to_px(&self, delta: MediaTime) -> f32 {
        (delta.as_ticks() as f64 / TICKS_PER_SECOND as f64 * f64::from(self.pixels_per_second))
            as f32
    }

    // ---- frames -------------------------------------------------------------------------

    /// Ticks in one frame, when the rate divides the tick grid exactly (all broadcast rates do:
    /// 4004 at 30000/1001, 5005 at 24000/1001). `None` for rates like 7/3 that do not.
    pub fn ticks_per_frame(&self) -> Option<i64> {
        ticks_per_frame(self.fps)
    }

    /// Nearest frame index, ties toward `+∞` (matching `time::MediaTime::to_frame_round`).
    pub fn frame_of(&self, time: MediaTime) -> i64 {
        frame_of(time, self.fps)
    }

    /// Frame index containing `time`.
    pub fn frame_floor_of(&self, time: MediaTime) -> i64 {
        frame_floor_of(time, self.fps)
    }

    /// Start time of a frame index.
    pub fn time_of_frame(&self, frame: i64) -> MediaTime {
        time_of_frame(frame, self.fps)
    }

    /// Snap a time to the nearest frame boundary. Idempotent.
    pub fn quantize_to_frame(&self, time: MediaTime) -> MediaTime {
        quantize_to_frame(time, self.fps)
    }

    /// `HH:MM:SS:FF`, semicolon-separated and renumbered when the rate is drop-frame.
    pub fn format_timecode(&self, time: MediaTime) -> String {
        format_timecode(time, self.fps)
    }

    // ---- viewport -----------------------------------------------------------------------

    /// The time range visible in a viewport `viewport_width_px` wide, clamped at zero because
    /// there is no content before the start of the timeline. Cull to this before building lane
    /// elements: a 10-minute timeline at 400 px/s is otherwise tens of thousands of divs.
    pub fn visible_window(&self, viewport_width_px: f32) -> Range<MediaTime> {
        let start = self.px_to_ticks(0.0).max(MediaTime::ZERO);
        let end = self.px_to_ticks(viewport_width_px.max(0.0)).max(start);
        start..end
    }

    /// Scrollable content width for a timeline of `duration`, plus empty space past the end so
    /// the last clip is not glued to the right edge.
    pub fn content_width_px(&self, duration: MediaTime, tail_padding_px: f32) -> f32 {
        self.delta_ticks_to_px(duration.max(MediaTime::ZERO)) + tail_padding_px.max(0.0)
    }

    /// The same geometry with its scroll offset clamped to the scrollable range.
    pub fn clamped_scroll(&self, content_width_px: f32, viewport_width_px: f32) -> Self {
        self.with_scroll_x(clamp_scroll(
            self.scroll_x,
            content_width_px,
            viewport_width_px,
        ))
    }

    /// Zoom by `factor` about `cursor_x`, keeping the time under the cursor pinned.
    pub fn zoom_at(&self, cursor_x: f32, factor: f32, min_pps: f32, max_pps: f32) -> Self {
        let (scroll_x, pixels_per_second) = zoom_at(
            self.scroll_x,
            self.pixels_per_second,
            cursor_x,
            factor,
            min_pps,
            max_pps,
        );
        Self::new(pixels_per_second, scroll_x, self.fps)
    }

    // ---- ruler --------------------------------------------------------------------------

    /// The coarsest-to-finest tick interval pair for the current zoom: labelled ticks at least
    /// [`MIN_LABEL_SPACING_PX`] apart, unlabelled ones at least `MIN_MINOR_SPACING_PX` apart.
    pub fn tick_ladder(&self) -> TickLadder {
        let candidates = ladder_candidates(self.fps);
        let major = candidates
            .iter()
            .copied()
            .find(|&ticks| self.delta_ticks_to_px(MediaTime::from_ticks(ticks)) >= MIN_LABEL_SPACING_PX)
            .unwrap_or_else(|| *candidates.last().expect("ladder is never empty"));

        // Densest subdivision that still divides the major interval exactly and stays readable.
        let minor = [10_i64, 5, 4, 2]
            .into_iter()
            .find(|&subdivisions| {
                major % subdivisions == 0
                    && self.delta_ticks_to_px(MediaTime::from_ticks(major / subdivisions))
                        >= MIN_MINOR_SPACING_PX
            })
            .map_or(major, |subdivisions| major / subdivisions);

        TickLadder {
            major: MediaTime::from_ticks(major),
            minor: MediaTime::from_ticks(minor),
        }
    }

    /// Every ruler mark inside the visible window, labelled on the major interval. Bounded by
    /// `viewport_width_px / MIN_MINOR_SPACING_PX + 2` by construction.
    pub fn ruler_ticks(&self, viewport_width_px: f32) -> Vec<RulerTick> {
        let ladder = self.tick_ladder();
        let window = self.visible_window(viewport_width_px);
        let minor = ladder.minor.as_ticks().max(1);
        let major = ladder.major.as_ticks().max(1);

        let mut marks = Vec::new();
        let mut ticks = window.start.as_ticks().div_euclid(minor) * minor;
        while ticks <= window.end.as_ticks() {
            let time = MediaTime::from_ticks(ticks);
            let is_major = ticks.rem_euclid(major) == 0;
            marks.push(RulerTick {
                x: self.ticks_to_px(time),
                time,
                major: is_major,
                label: if is_major {
                    Some(format_timecode(time, self.fps))
                } else {
                    None
                },
            });
            ticks += minor;
        }
        marks
    }
}

/// Major/minor ruler intervals for one zoom level.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TickLadder {
    /// Interval between labelled ticks.
    pub major: MediaTime,
    /// Interval between unlabelled ticks. Always divides `major` exactly.
    pub minor: MediaTime,
}

/// One mark on the ruler, already in window space.
#[derive(Debug, Clone, PartialEq)]
pub struct RulerTick {
    pub x: f32,
    pub time: MediaTime,
    pub major: bool,
    /// `Some` only on major ticks.
    pub label: Option<String>,
}

/// An axis-aligned rectangle in logical pixels. Deliberately not `gpui::Bounds`: this module
/// stays GPUI-free so it can be tested without a window.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl Rect {
    pub fn right(&self) -> f32 {
        self.x + self.width
    }

    pub fn bottom(&self) -> f32 {
        self.y + self.height
    }
}

// ---- free functions (no scroll / no zoom involved) ---------------------------------------

/// Ticks in one frame, or `None` when the rate does not divide the tick grid exactly.
pub fn ticks_per_frame(fps: Fps) -> Option<i64> {
    let numerator = i64::from(fps.numerator);
    let denominator = i64::from(fps.denominator);
    if numerator <= 0 || denominator <= 0 {
        return None;
    }
    let ticks = TICKS_PER_SECOND.checked_mul(denominator)?;
    (ticks % numerator == 0).then_some(ticks / numerator)
}

/// Nearest frame index to `time`, ties toward `+∞`.
///
/// Exact rational arithmetic: `frame = time * numerator / (denominator * TICKS_PER_SECOND)`.
/// Never `time * fps.as_f64()`, which drifts on 30000/1001.
pub fn frame_of(time: MediaTime, fps: Fps) -> i64 {
    let (numerator, denominator) = rational(fps);
    div_round_half_up(
        i128::from(time.as_ticks()) * numerator,
        denominator * i128::from(TICKS_PER_SECOND),
    ) as i64
}

/// Index of the frame containing `time`.
pub fn frame_floor_of(time: MediaTime, fps: Fps) -> i64 {
    let (numerator, denominator) = rational(fps);
    (i128::from(time.as_ticks()) * numerator)
        .div_euclid(denominator * i128::from(TICKS_PER_SECOND)) as i64
}

/// Start time of frame `frame`. Exact for every rate whose frame is a whole number of ticks.
pub fn time_of_frame(frame: i64, fps: Fps) -> MediaTime {
    let (numerator, denominator) = rational(fps);
    MediaTime::from_ticks(div_round_half_up(
        i128::from(frame) * denominator * i128::from(TICKS_PER_SECOND),
        numerator,
    ) as i64)
}

/// Snap a time to the nearest frame boundary.
///
/// Idempotent, and a no-op on a time that already sits on a boundary — which is why drags may
/// call it unconditionally.
pub fn quantize_to_frame(time: MediaTime, fps: Fps) -> MediaTime {
    time_of_frame(frame_of(time, fps), fps)
}

/// `HH:MM:SS:FF`. Drop-frame rates (30000/1001, 60000/1001) are renumbered by the SMPTE rule —
/// skip the first 2 (or 4) frame *numbers* of every minute except every tenth — and are printed
/// with the conventional `;` before the frame field so the two are never confused.
pub fn format_timecode(time: MediaTime, fps: Fps) -> String {
    let sign = if time.as_ticks() < 0 { "-" } else { "" };
    let magnitude = MediaTime::from_ticks(time.as_ticks().saturating_abs());

    let nominal = nominal_fps(fps);
    let dropped = dropped_frames_per_minute(fps);
    let counted = renumber_drop_frame(frame_floor_of(magnitude, fps), nominal, dropped);

    let frames = counted % nominal;
    let total_seconds = counted / nominal;
    let seconds = total_seconds % 60;
    let minutes = (total_seconds / 60) % 60;
    let hours = total_seconds / 3_600;
    let separator = if dropped > 0 { ';' } else { ':' };
    format!("{sign}{hours:02}:{minutes:02}:{seconds:02}{separator}{frames:02}")
}

/// Zoom about a cursor: the time under `cursor_x` is the same before and after.
///
/// The result is *not* clamped to the scrollable range — clamping here would silently break the
/// pinning invariant near time zero. Feed the result through [`clamp_scroll`] when the content
/// width is known.
pub fn zoom_at(
    scroll_x: f32,
    pixels_per_second: f32,
    cursor_x: f32,
    factor: f32,
    min_pps: f32,
    max_pps: f32,
) -> (f32, f32) {
    let pixels_per_second = sane(pixels_per_second, PIXELS_PER_SECOND_FLOOR).max(PIXELS_PER_SECOND_FLOOR);
    let low = sane(min_pps, PIXELS_PER_SECOND_FLOOR).max(PIXELS_PER_SECOND_FLOOR);
    let high = sane(max_pps, low).max(low);
    let seconds_under_cursor = f64::from(scroll_x + cursor_x) / f64::from(pixels_per_second);
    let zoomed = (pixels_per_second * sane(factor, 1.0)).clamp(low, high);
    let scroll_x = (seconds_under_cursor * f64::from(zoomed) - f64::from(cursor_x)) as f32;
    (scroll_x, zoomed)
}

/// Clamp a scroll offset to `0..=(content - viewport)`. Content narrower than the viewport pins
/// the offset at zero.
pub fn clamp_scroll(scroll_x: f32, content_width_px: f32, viewport_width_px: f32) -> f32 {
    let max = (content_width_px - viewport_width_px).max(0.0);
    sane(scroll_x, 0.0).clamp(0.0, sane(max, 0.0))
}

/// Fit a canvas of aspect `canvas_aspect` (w/h) inside `viewport`, then scale by `zoom` about the
/// centre and offset by `pan`. Bars land on the sides for a canvas taller than the viewport and
/// on the top/bottom for a wider one.
pub fn fit_rect(viewport: (f32, f32), canvas_aspect: f32, zoom: f32, pan: (f32, f32)) -> Rect {
    let (viewport_width, viewport_height) = (viewport.0.max(0.0), viewport.1.max(0.0));
    let aspect = if canvas_aspect.is_finite() && canvas_aspect > 0.0 {
        canvas_aspect
    } else {
        1.0
    };
    let zoom = sane(zoom, 1.0).max(0.0);

    let viewport_aspect = if viewport_height > 0.0 {
        viewport_width / viewport_height
    } else {
        aspect
    };
    let (width, height) = if viewport_aspect > aspect {
        (viewport_height * aspect, viewport_height)
    } else {
        (viewport_width, viewport_width / aspect)
    };

    let (width, height) = (width * zoom, height * zoom);
    Rect {
        x: (viewport_width - width) / 2.0 + sane(pan.0, 0.0),
        y: (viewport_height - height) / 2.0 + sane(pan.1, 0.0),
        width,
        height,
    }
}

/// Prefix sum of lane heights: `offsets[i]` is the top of row `i`, and the last entry is the
/// total height.
pub fn track_y_offsets(heights: &[f32]) -> Vec<f32> {
    let mut offsets = Vec::with_capacity(heights.len() + 1);
    let mut y = 0.0;
    offsets.push(y);
    for height in heights {
        y += height.max(0.0);
        offsets.push(y);
    }
    offsets
}

/// Row index at a content-space y, or `None` above the first row or past the last.
pub fn track_at_y(heights: &[f32], y: f32) -> Option<usize> {
    if y.is_nan() || y < 0.0 {
        return None;
    }
    let mut top = 0.0;
    for (index, height) in heights.iter().enumerate() {
        let bottom = top + height.max(0.0);
        if y < bottom {
            return Some(index);
        }
        top = bottom;
    }
    None
}

// ---- internals ---------------------------------------------------------------------------

/// Replace a NaN/∞ with a fallback so a bad input cannot poison a layout.
fn sane(value: f32, fallback: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        fallback
    }
}

fn round_f64(value: f64) -> i64 {
    if value.is_finite() {
        value.round() as i64
    } else {
        0
    }
}

/// `(numerator, denominator)` as positive i128s; a degenerate rate falls back to 1/1 so no
/// conversion can divide by zero.
fn rational(fps: Fps) -> (i128, i128) {
    if fps.numerator == 0 || fps.denominator == 0 {
        (1, 1)
    } else {
        (i128::from(fps.numerator), i128::from(fps.denominator))
    }
}

/// `floor(numerator / denominator)` with halves going toward `+∞`, matching
/// `time::MediaTime::to_frame_round` so the UI and the engine agree on every tie.
fn div_round_half_up(numerator: i128, denominator: i128) -> i128 {
    debug_assert!(denominator > 0);
    (2 * numerator + denominator).div_euclid(2 * denominator)
}

/// Frames per second rounded to a whole number — the count a timecode's frame field runs to
/// (30 for 29.97, 24 for 23.976).
fn nominal_fps(fps: Fps) -> i64 {
    let (numerator, denominator) = rational(fps);
    (div_round_half_up(numerator, denominator) as i64).max(1)
}

/// Frame numbers skipped at the top of a drop-frame minute: 2 at 29.97, 4 at 59.94, 0 otherwise.
/// 23.976 is *not* drop-frame.
fn dropped_frames_per_minute(fps: Fps) -> i64 {
    let drop_frame =
        fps.denominator == 1_001 && (fps.numerator == 30_000 || fps.numerator == 60_000);
    if drop_frame {
        nominal_fps(fps) / 15
    } else {
        0
    }
}

/// Convert a frame index into the drop-frame *counting* sequence (SMPTE 12M). Identity for
/// non-drop rates.
fn renumber_drop_frame(frame: i64, nominal: i64, dropped: i64) -> i64 {
    if dropped <= 0 || frame <= 0 {
        return frame.max(0);
    }
    let per_ten_minutes = nominal * 600 - dropped * 9;
    let per_minute = nominal * 60 - dropped;
    let ten_minute_blocks = frame / per_ten_minutes;
    let remainder = frame % per_ten_minutes;

    let mut counted = frame + dropped * 9 * ten_minute_blocks;
    if remainder > dropped {
        counted += dropped * ((remainder - dropped) / per_minute);
    }
    counted
}

/// Candidate ruler intervals in ticks, ascending: frame multiples first (they matter when zoomed
/// in), then the usual second/minute steps.
fn ladder_candidates(fps: Fps) -> Vec<i64> {
    let mut candidates = Vec::with_capacity(24);
    if let Some(ticks_per_frame) = ticks_per_frame(fps) {
        for multiple in [1_i64, 2, 5, 10, 15, 30] {
            candidates.push(ticks_per_frame * multiple);
        }
    }
    for seconds in [
        1_i64, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1_800, 3_600,
    ] {
        candidates.push(seconds * TICKS_PER_SECOND);
    }
    candidates.sort_unstable();
    candidates.dedup();
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;

    const FPS_30: Fps = Fps {
        numerator: 30,
        denominator: 1,
    };
    const FPS_2997: Fps = Fps {
        numerator: 30_000,
        denominator: 1_001,
    };
    const FPS_2398: Fps = Fps {
        numerator: 24_000,
        denominator: 1_001,
    };
    const FPS_25: Fps = Fps {
        numerator: 25,
        denominator: 1,
    };
    const FPS_5994: Fps = Fps {
        numerator: 60_000,
        denominator: 1_001,
    };

    fn geometry(pps: f32, scroll: f32, fps: Fps) -> TimelineGeometry {
        TimelineGeometry::new(pps, scroll, fps)
    }

    #[test]
    fn ticks_per_second_matches_media_time() {
        assert_eq!(
            MediaTime::from_seconds_f64(1.0).unwrap().as_ticks(),
            TICKS_PER_SECOND
        );
    }

    #[test]
    fn ticks_per_frame_is_exact_for_broadcast_rates() {
        assert_eq!(ticks_per_frame(FPS_2398), Some(5_005));
        assert_eq!(ticks_per_frame(FPS_25), Some(4_800));
        assert_eq!(ticks_per_frame(FPS_2997), Some(4_004));
        assert_eq!(ticks_per_frame(FPS_30), Some(4_000));
        assert_eq!(ticks_per_frame(FPS_5994), Some(2_002));
        // Not representable on the 120 000/s grid, and not pretended to be.
        assert_eq!(ticks_per_frame(Fps { numerator: 7, denominator: 3 }), None);
    }

    // ---- px ↔ ticks ----------------------------------------------------------------------

    #[test]
    fn px_to_ticks_round_trips_within_a_pixel() {
        for &pps in &[8.0_f32, 48.0, 137.5, 400.0] {
            for &scroll in &[0.0_f32, 1.0, 640.0, 12_345.75] {
                let g = geometry(pps, scroll, FPS_30);
                for &x in &[-30.0_f32, 0.0, 0.5, 17.0, 640.0, 1_920.0] {
                    let back = g.ticks_to_px(g.px_to_ticks(x));
                    assert!(
                        (back - x).abs() < 1.0,
                        "pps={pps} scroll={scroll} x={x} came back as {back}"
                    );
                }
            }
        }
    }

    #[test]
    fn ticks_to_px_round_trips_through_px() {
        let g = geometry(60.0, 300.0, FPS_30);
        for frame in 0..600 {
            let time = g.time_of_frame(frame);
            assert_eq!(g.px_to_ticks(g.ticks_to_px(time)), time);
        }
    }

    #[test]
    fn scroll_shifts_x_but_not_durations() {
        let unscrolled = geometry(50.0, 0.0, FPS_30);
        let scrolled = unscrolled.with_scroll_x(125.0);
        let two_seconds = MediaTime::from_ticks(2 * TICKS_PER_SECOND);

        assert_eq!(unscrolled.ticks_to_px(two_seconds), 100.0);
        assert_eq!(scrolled.ticks_to_px(two_seconds), -25.0);
        // A width is scroll-invariant; only the origin moves.
        assert_eq!(
            unscrolled.delta_ticks_to_px(two_seconds),
            scrolled.delta_ticks_to_px(two_seconds)
        );
        assert_eq!(
            scrolled.delta_px_to_ticks(100.0),
            MediaTime::from_ticks(2 * TICKS_PER_SECOND)
        );
    }

    #[test]
    fn negative_x_maps_before_zero_and_is_not_clamped() {
        let g = geometry(48.0, 0.0, FPS_30);
        assert_eq!(
            g.px_to_ticks(-48.0),
            MediaTime::from_ticks(-TICKS_PER_SECOND)
        );
        assert!(g.px_to_seconds(-1.0) < 0.0);
        // Callers that must not go negative say so explicitly.
        assert_eq!(g.px_to_ticks(-48.0).max(MediaTime::ZERO), MediaTime::ZERO);
    }

    #[test]
    fn degenerate_inputs_cannot_produce_nan() {
        let g = geometry(0.0, f32::NAN, FPS_30);
        assert!(g.pixels_per_second() > 0.0);
        assert_eq!(g.scroll_x(), 0.0);
        assert!(g.ticks_to_px(MediaTime::from_ticks(1_000)).is_finite());
        assert!(g.px_to_seconds(10.0).is_finite());

        let bad_rate = geometry(48.0, 0.0, Fps { numerator: 0, denominator: 0 });
        assert_eq!(bad_rate.quantize_to_frame(MediaTime::from_ticks(7)), MediaTime::ZERO);
    }

    // ---- frames --------------------------------------------------------------------------

    #[test]
    fn quantize_snaps_to_the_nearest_frame() {
        let g = geometry(48.0, 0.0, FPS_30);
        // 4000 ticks per frame: 1999 rounds down, 2000 (the tie) rounds up.
        assert_eq!(g.quantize_to_frame(MediaTime::from_ticks(1_999)), MediaTime::ZERO);
        assert_eq!(
            g.quantize_to_frame(MediaTime::from_ticks(2_000)),
            MediaTime::from_ticks(4_000)
        );
        assert_eq!(
            g.quantize_to_frame(MediaTime::from_ticks(5_900)),
            MediaTime::from_ticks(4_000)
        );
        assert_eq!(
            g.quantize_to_frame(MediaTime::from_ticks(6_100)),
            MediaTime::from_ticks(8_000)
        );
    }

    #[test]
    fn quantize_leaves_a_frame_boundary_untouched_and_is_idempotent() {
        for fps in [FPS_2398, FPS_25, FPS_2997, FPS_30, FPS_5994, Fps { numerator: 7, denominator: 3 }] {
            for frame in [0_i64, 1, 7, 1_000, 17_982] {
                let on_boundary = time_of_frame(frame, fps);
                assert_eq!(quantize_to_frame(on_boundary, fps), on_boundary);
            }
            for ticks in [-9_001_i64, -1, 0, 1, 37, 4_003, 999_983] {
                let once = quantize_to_frame(MediaTime::from_ticks(ticks), fps);
                assert_eq!(quantize_to_frame(once, fps), once, "fps={fps:?} ticks={ticks}");
            }
        }
    }

    #[test]
    fn quantize_handles_negative_times_symmetrically() {
        let g = geometry(48.0, 0.0, FPS_30);
        assert_eq!(
            g.quantize_to_frame(MediaTime::from_ticks(-5_900)),
            MediaTime::from_ticks(-4_000)
        );
        assert_eq!(
            g.quantize_to_frame(MediaTime::from_ticks(-6_100)),
            MediaTime::from_ticks(-8_000)
        );
        // A tie below zero rounds toward +∞, exactly like `MediaTime::to_frame_round`.
        assert_eq!(
            g.quantize_to_frame(MediaTime::from_ticks(-2_000)),
            MediaTime::ZERO
        );
        assert_eq!(g.frame_of(MediaTime::from_ticks(-4_000)), -1);
        assert_eq!(g.frame_floor_of(MediaTime::from_ticks(-1)), -1);
    }

    #[test]
    fn frame_round_trips_at_every_supported_rate() {
        for fps in [FPS_2398, FPS_25, FPS_2997, FPS_30, FPS_5994] {
            let ticks_per_frame = ticks_per_frame(fps).expect("broadcast rate");
            for frame in [0_i64, 1, 2, 99, 100_000] {
                let time = time_of_frame(frame, fps);
                assert_eq!(time.as_ticks(), frame * ticks_per_frame);
                assert_eq!(frame_of(time, fps), frame);
                assert_eq!(frame_floor_of(time, fps), frame);
            }
        }
    }

    #[test]
    fn no_drift_over_ten_minutes_of_29_97_frames() {
        // 600s × 30000/1001 ≈ 17982.0 frames. Exact integer math means frame 17982 is exactly
        // 17982 × 4004 ticks — a float `ticks * 29.97` walks off by whole ticks long before this.
        const FRAMES_IN_TEN_MINUTES: i64 = 17_982;
        let g = geometry(120.0, 0.0, FPS_2997);
        for frame in 0..=FRAMES_IN_TEN_MINUTES {
            let time = g.time_of_frame(frame);
            assert_eq!(time.as_ticks(), frame * 4_004);
            assert_eq!(g.frame_of(time), frame);
            assert_eq!(g.quantize_to_frame(time), time);
            // Half a frame past the boundary still resolves to the boundary's neighbours only.
            let jittered = MediaTime::from_ticks(time.as_ticks() + 1_500);
            assert_eq!(g.quantize_to_frame(jittered), time);
        }
        assert_eq!(
            g.time_of_frame(FRAMES_IN_TEN_MINUTES).as_ticks(),
            71_999_928
        );
    }

    #[test]
    fn px_to_frame_time_never_lands_between_frames() {
        let g = geometry(137.0, 421.5, FPS_2997);
        for x in 0..500 {
            let snapped = g.px_to_frame_time(x as f32);
            assert_eq!(snapped.as_ticks() % 4_004, 0, "x={x} produced {snapped:?}");
        }
    }

    // ---- timecode ------------------------------------------------------------------------

    #[test]
    fn formats_non_drop_frame_timecodes() {
        assert_eq!(
            format_timecode(MediaTime::from_ticks(180_000), FPS_30),
            "00:00:01:15"
        );
        assert_eq!(format_timecode(MediaTime::ZERO, FPS_25), "00:00:00:00");
        assert_eq!(
            format_timecode(time_of_frame(90_000, FPS_25), FPS_25),
            "01:00:00:00"
        );
        // 23.976 is a fractional rate but *not* drop-frame: colon separator, 24-frame field.
        assert_eq!(
            format_timecode(time_of_frame(23, FPS_2398), FPS_2398),
            "00:00:00:23"
        );
        assert_eq!(
            format_timecode(time_of_frame(24, FPS_2398), FPS_2398),
            "00:00:01:00"
        );
    }

    #[test]
    fn formats_the_standard_ntsc_drop_frame_vectors() {
        let vectors = [
            (0_i64, "00:00:00;00"),
            (1_799, "00:00:59;29"),
            // Frame numbers ;00 and ;01 of minute 1 are skipped.
            (1_800, "00:01:00;02"),
            (17_981, "00:09:59;29"),
            // ...but never at a ten-minute boundary.
            (17_982, "00:10:00;00"),
            (107_892, "01:00:00;00"),
        ];
        for (frame, expected) in vectors {
            assert_eq!(
                format_timecode(time_of_frame(frame, FPS_2997), FPS_2997),
                expected,
                "frame {frame}"
            );
        }
    }

    #[test]
    fn formats_59_94_drop_frame() {
        assert_eq!(
            format_timecode(time_of_frame(0, FPS_5994), FPS_5994),
            "00:00:00;00"
        );
        assert_eq!(
            format_timecode(time_of_frame(3_600, FPS_5994), FPS_5994),
            "00:01:00;04"
        );
        assert_eq!(
            format_timecode(time_of_frame(35_964, FPS_5994), FPS_5994),
            "00:10:00;00"
        );
    }

    #[test]
    fn negative_timecodes_are_signed_not_wrapped() {
        assert_eq!(
            format_timecode(MediaTime::from_ticks(-180_000), FPS_30),
            "-00:00:01:15"
        );
    }

    // ---- ruler ---------------------------------------------------------------------------

    #[test]
    fn labelled_ticks_stay_at_least_80px_apart_across_the_zoom_range() {
        for fps in [FPS_25, FPS_2997, FPS_30] {
            for step in 8..=400 {
                let g = geometry(step as f32, 0.0, fps);
                let ladder = g.tick_ladder();
                let spacing = g.delta_ticks_to_px(ladder.major);
                assert!(
                    spacing >= MIN_LABEL_SPACING_PX,
                    "pps={step} fps={fps:?} spacing={spacing}"
                );
                assert!(ladder.minor.as_ticks() > 0);
                assert_eq!(ladder.major.as_ticks() % ladder.minor.as_ticks(), 0);
                assert!(g.delta_ticks_to_px(ladder.minor) >= MIN_MINOR_SPACING_PX);
                // The chosen interval is the *smallest* that fits, not an arbitrarily coarse one.
                assert!(spacing < MIN_LABEL_SPACING_PX * 10.0, "pps={step} spacing={spacing}");
            }
        }
    }

    #[test]
    fn ruler_ticks_are_culled_to_the_visible_window() {
        let g = geometry(400.0, 25_000.0, FPS_30);
        let width = 1_200.0;
        let marks = g.ruler_ticks(width);
        let bound = (width / MIN_MINOR_SPACING_PX) as usize + 2;
        assert!(marks.len() <= bound, "{} marks exceeds {bound}", marks.len());
        assert!(marks.iter().all(|mark| mark.x >= -20.0 && mark.x <= width + 20.0));
        assert!(marks.iter().any(|mark| mark.major && mark.label.is_some()));
        assert!(marks.iter().all(|mark| mark.major == mark.label.is_some()));
    }

    #[test]
    fn visible_window_clamps_at_zero_and_tracks_scroll() {
        let g = geometry(50.0, -100.0, FPS_30);
        let window = g.visible_window(400.0);
        assert_eq!(window.start, MediaTime::ZERO);
        assert_eq!(window.end, MediaTime::from_ticks(6 * TICKS_PER_SECOND));

        let scrolled = g.with_scroll_x(500.0);
        let window = scrolled.visible_window(400.0);
        assert_eq!(window.start, MediaTime::from_ticks(10 * TICKS_PER_SECOND));
        assert_eq!(window.end, MediaTime::from_ticks(18 * TICKS_PER_SECOND));
    }

    // ---- zoom / scroll -------------------------------------------------------------------

    #[test]
    fn zoom_at_keeps_the_time_under_the_cursor_fixed() {
        let cases = [
            (0.0_f32, 48.0_f32, 0.0_f32, 1.5_f32),
            (0.0, 48.0, 640.0, 1.5),
            (0.0, 48.0, 640.0, 1.0 / 1.5),
            (320.0, 48.0, 0.0, 2.0),
            (1_200.0, 96.0, 250.0, 1.5),
            (1_200.0, 96.0, 250.0, 0.25),
            // Clamping the zoom must not break the invariant.
            (900.0, 380.0, 700.0, 4.0),
            (900.0, 10.0, 700.0, 0.05),
        ];
        for (scroll, pps, cursor_x, factor) in cases {
            let before = geometry(pps, scroll, FPS_30);
            let after = before.zoom_at(cursor_x, factor, 8.0, 400.0);
            let (was, now) = (before.px_to_seconds(cursor_x), after.px_to_seconds(cursor_x));
            assert!(
                (was - now).abs() < 1e-3,
                "scroll={scroll} pps={pps} cursor={cursor_x} factor={factor}: {was} -> {now}"
            );
            assert!(after.pixels_per_second() >= 8.0 && after.pixels_per_second() <= 400.0);
        }
    }

    #[test]
    fn clamp_scroll_holds_both_bounds() {
        assert_eq!(clamp_scroll(-50.0, 2_000.0, 800.0), 0.0);
        assert_eq!(clamp_scroll(5_000.0, 2_000.0, 800.0), 1_200.0);
        assert_eq!(clamp_scroll(600.0, 2_000.0, 800.0), 600.0);
        // Content narrower than the viewport has nowhere to scroll.
        assert_eq!(clamp_scroll(400.0, 500.0, 800.0), 0.0);
        assert_eq!(clamp_scroll(f32::NAN, 2_000.0, 800.0), 0.0);
    }

    #[test]
    fn content_width_covers_the_duration_plus_padding() {
        let g = geometry(50.0, 0.0, FPS_30);
        let ten_seconds = MediaTime::from_ticks(10 * TICKS_PER_SECOND);
        assert_eq!(g.content_width_px(ten_seconds, 240.0), 740.0);
        assert_eq!(g.content_width_px(MediaTime::from_ticks(-5), 240.0), 240.0);
        assert_eq!(g.clamped_scroll(740.0, 800.0).scroll_x(), 0.0);
        assert_eq!(
            g.with_scroll_x(1_000.0).clamped_scroll(740.0, 400.0).scroll_x(),
            340.0
        );
    }

    // ---- viewer --------------------------------------------------------------------------

    #[test]
    fn fit_rect_puts_bars_on_the_sides_for_a_tall_canvas_in_a_wide_viewport() {
        let rect = fit_rect((1_600.0, 900.0), 9.0 / 16.0, 1.0, (0.0, 0.0));
        assert_eq!(rect.height, 900.0);
        assert!((rect.width - 506.25).abs() < 0.01);
        assert_eq!(rect.y, 0.0);
        assert!((rect.x - (1_600.0 - 506.25) / 2.0).abs() < 0.01);
    }

    #[test]
    fn fit_rect_puts_bars_above_and_below_for_a_wide_canvas_in_a_tall_viewport() {
        let rect = fit_rect((900.0, 1_600.0), 16.0 / 9.0, 1.0, (0.0, 0.0));
        assert_eq!(rect.width, 900.0);
        assert!((rect.height - 506.25).abs() < 0.01);
        assert_eq!(rect.x, 0.0);
        assert!((rect.y - (1_600.0 - 506.25) / 2.0).abs() < 0.01);
    }

    #[test]
    fn fit_rect_fills_exactly_on_a_matching_aspect() {
        let rect = fit_rect((1_920.0, 1_080.0), 16.0 / 9.0, 1.0, (0.0, 0.0));
        assert!((rect.width - 1_920.0).abs() < 0.01);
        assert!((rect.height - 1_080.0).abs() < 0.01);
        assert!(rect.x.abs() < 0.01 && rect.y.abs() < 0.01);
    }

    #[test]
    fn fit_rect_zooms_about_the_centre_and_pans() {
        let base = fit_rect((1_600.0, 900.0), 16.0 / 9.0, 1.0, (0.0, 0.0));
        let zoomed = fit_rect((1_600.0, 900.0), 16.0 / 9.0, 2.0, (0.0, 0.0));
        let base_centre = (base.x + base.width / 2.0, base.y + base.height / 2.0);
        let zoomed_centre = (zoomed.x + zoomed.width / 2.0, zoomed.y + zoomed.height / 2.0);
        assert!((base_centre.0 - zoomed_centre.0).abs() < 0.01);
        assert!((base_centre.1 - zoomed_centre.1).abs() < 0.01);
        assert!((zoomed.width - base.width * 2.0).abs() < 0.01);

        let panned = fit_rect((1_600.0, 900.0), 16.0 / 9.0, 2.0, (-40.0, 25.0));
        assert!((panned.x - (zoomed.x - 40.0)).abs() < 0.01);
        assert!((panned.bottom() - (zoomed.bottom() + 25.0)).abs() < 0.01);
    }

    #[test]
    fn fit_rect_survives_a_zero_sized_viewport_and_a_bogus_aspect() {
        let rect = fit_rect((0.0, 0.0), f32::NAN, 1.0, (0.0, 0.0));
        assert!(rect.width.is_finite() && rect.height.is_finite());
        assert_eq!(rect.width, 0.0);
        let rect = fit_rect((100.0, 100.0), 0.0, 1.0, (0.0, 0.0));
        assert_eq!((rect.width, rect.height), (100.0, 100.0));
    }

    // ---- tracks --------------------------------------------------------------------------

    #[test]
    fn track_offsets_are_a_prefix_sum_and_hit_test_back() {
        let heights = [40.0_f32, 64.0, 40.0];
        assert_eq!(track_y_offsets(&heights), vec![0.0, 40.0, 104.0, 144.0]);
        assert_eq!(track_y_offsets(&[]), vec![0.0]);

        assert_eq!(track_at_y(&heights, 0.0), Some(0));
        assert_eq!(track_at_y(&heights, 39.9), Some(0));
        assert_eq!(track_at_y(&heights, 40.0), Some(1));
        assert_eq!(track_at_y(&heights, 103.9), Some(1));
        assert_eq!(track_at_y(&heights, 104.0), Some(2));
        assert_eq!(track_at_y(&heights, 144.0), None);
        assert_eq!(track_at_y(&heights, -1.0), None);
        assert_eq!(track_at_y(&heights, f32::NAN), None);
    }
}
