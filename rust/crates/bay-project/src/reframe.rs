//! Where a subject is over time, and the crop that keeps it in frame.
//!
//! Two things live here that used to live apart, and both moves were forced by the same problem:
//! **there was more than one copy of the answer.**
//!
//! The point types and the damping were in `bay-vision`, which links candle and needs an 813 MB
//! provisioned encoder. Anything else that learns where a face is — Vision.framework, an external
//! provider — would have had to depend on a transformer to say so, or declare its own
//! `SubjectPoint` and let two trackers quietly disagree about what `confidence` means.
//!
//! The crop arithmetic was written out twice, character for character, in
//! `bay-agent::slow::auto_reframe` and `bay-mcp::studio::auto_reframe` — the attached and headless
//! paths. Two copies of a geometric rule is two places for a detector change to land, and one of
//! them will be missed.
//!
//! So: the geometry is pure and lives once. Who *finds* the subject is the caller's business.

use std::collections::BTreeMap;

use crate::element::{AnimationChannel, Transform};
use bay_time::MediaTime;

/// One sample of where the subject is, before and after damping.
///
/// `raw_*` is what the detector said; `x`/`y` is what the camera does about it. Both are kept
/// because the difference between them is the only evidence that smoothing helped — see
/// [`path_jitter`], which the `auto_reframe` tool reports for each.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectPoint {
    pub time_seconds: f64,
    pub raw_x: f32,
    pub raw_y: f32,
    pub x: f32,
    pub y: f32,
    pub confidence: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TrackingConfig {
    pub sample_seconds: f64,
    pub smoothing_seconds: f64,
}

impl Default for TrackingConfig {
    fn default() -> Self {
        Self {
            sample_seconds: 0.5,
            smoothing_seconds: 0.9,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ReframeTrackingConfig<'a> {
    pub source_aspect: f32,
    pub target_aspect: f32,
    pub shot_boundaries: &'a [f64],
    pub tracking: TrackingConfig,
}

/// Exponentially damp a raw detection sequence into a camera path.
///
/// `raw` is `(time_seconds, (x, y, confidence))`. A shot boundary snaps rather than interpolates:
/// a cut is not camera motion, and damping across one sweeps the frame over an edit.
pub fn smooth_path(
    raw: Vec<(f64, (f32, f32, f32))>,
    smoothing_seconds: f64,
    shot_boundaries: &[f64],
) -> Vec<SubjectPoint> {
    let tau = smoothing_seconds.clamp(0.05, 10.0);
    let mut points = Vec::with_capacity(raw.len());
    let mut smooth = raw
        .first()
        .map(|(_, found)| (found.0, found.1))
        .unwrap_or((0.5, 0.5));
    let mut previous_time = raw.first().map(|(time, _)| *time).unwrap_or(0.0);
    for (time, (x, y, confidence)) in raw {
        let dt = (time - previous_time).max(0.0) as f32;
        let alpha = 1.0 - (-dt / tau as f32).exp();
        let crossed_cut = shot_boundaries
            .iter()
            .any(|boundary| *boundary > previous_time && *boundary <= time);
        // A cut is not camera motion. Snap to the incoming composition, then damp motion within
        // that shot so no interpolation sweeps across an edit.
        if crossed_cut {
            smooth = (x, y);
        } else {
            smooth.0 += alpha * (x - smooth.0);
            smooth.1 += alpha * (y - smooth.1);
        }
        smooth.0 = smooth.0.clamp(0.0, 1.0);
        smooth.1 = smooth.1.clamp(0.0, 1.0);
        points.push(SubjectPoint {
            time_seconds: time,
            raw_x: x,
            raw_y: y,
            x: smooth.0,
            y: smooth.1,
            confidence,
        });
        previous_time = time;
    }
    points
}

/// Total absolute second derivative, a compact numeric measure of camera-path jitter.
pub fn path_jitter(values: &[f32]) -> f32 {
    values
        .windows(3)
        .map(|window| (window[2] - 2.0 * window[1] + window[0]).abs())
        .sum()
}

/// Crop insets (left, top, right, bottom) that centre `point` in a fixed aperture of
/// `target_aspect` cut from a source of `source_aspect`.
///
/// The aperture is a constant size and only its position moves, which is what makes the four
/// resulting channels a *camera path* rather than four unrelated animations — and what
/// [`crate::moves::coordinated_camera_crop`] recognises structurally.
pub fn crop_for(point_x: f32, point_y: f32, source_aspect: f32, target_aspect: f32) -> Crop {
    if target_aspect < source_aspect {
        let kept = (target_aspect / source_aspect).clamp(0.01, 1.0);
        let left = (point_x - kept * 0.5).clamp(0.0, 1.0 - kept);
        Crop {
            left,
            top: 0.0,
            right: 1.0 - kept - left,
            bottom: 0.0,
        }
    } else {
        let kept = (source_aspect / target_aspect).clamp(0.01, 1.0);
        let top = (point_y - kept * 0.5).clamp(0.0, 1.0 - kept);
        Crop {
            left: 0.0,
            top,
            right: 0.0,
            bottom: 1.0 - kept - top,
        }
    }
}

/// Source-fraction insets, in the order `Transform` names them.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Crop {
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

impl Crop {
    /// Write these insets onto a transform, leaving everything else alone.
    pub fn apply_to(&self, transform: &mut Transform) {
        transform.crop_left = self.left;
        transform.crop_top = self.top;
        transform.crop_right = self.right;
        transform.crop_bottom = self.bottom;
    }
}

/// The four crop channels and the opening transform for a tracked reframe.
pub struct ReframePlan {
    pub first: Crop,
    pub channels: BTreeMap<String, AnimationChannel>,
}

/// Turn a tracked path into the four keyframed crop channels an element carries.
///
/// `source_start` is where the clip's source range begins, because keyframe times are local to
/// the element and the path is in media time.
///
/// Fails only when a sampled time cannot be represented as a [`MediaTime`], which is a real
/// failure rather than something to clamp: a keyframe silently landing at zero would put the
/// aperture somewhere nobody asked for.
pub fn plan_reframe(
    path: &[SubjectPoint],
    source_start: f64,
    source_aspect: f32,
    target_aspect: f32,
) -> Result<ReframePlan, String> {
    let mut channels = BTreeMap::new();
    for name in CROP_CHANNELS {
        channels.insert(name.to_string(), AnimationChannel::default());
    }
    for point in path {
        let local = MediaTime::from_seconds_f64((point.time_seconds - source_start).max(0.0))
            .ok_or("tracked time is outside the representable range")?;
        let crop = crop_for(point.x, point.y, source_aspect, target_aspect);
        for (name, value) in [
            ("cropLeft", crop.left),
            ("cropTop", crop.top),
            ("cropRight", crop.right),
            ("cropBottom", crop.bottom),
        ] {
            channels
                .get_mut(name)
                .expect("channel exists")
                .upsert(local, value);
        }
    }
    let first = path
        .first()
        .map(|point| crop_for(point.x, point.y, source_aspect, target_aspect))
        .unwrap_or(Crop {
            left: 0.0,
            top: 0.0,
            right: 0.0,
            bottom: 0.0,
        });
    Ok(ReframePlan { first, channels })
}

/// The four channels a tracked reframe writes, in the order `plan_reframe` fills them.
pub const CROP_CHANNELS: [&str; 4] = ["cropLeft", "cropTop", "cropRight", "cropBottom"];

/// What a reframe does to source pixels, and what the alternative would have done.
///
/// bay fits *contain* with `scale: 1.0` by default, so a 16:9 clip placed on a 9:16 canvas
/// already renders as a full-width band with black above and below — 1920×1080 into 1080×1920 is
/// a **0.56× downscale**. Cropping to the target aspect instead keeps a 608-wide column of a
/// 1080-tall source and stretches it to fill: a **1.78× upscale** of the same footage.
///
/// Neither is wrong. A close-up you want tighter than the source frames is worth the upscale; a
/// wide two-shot almost never is, and the platforms cover roughly the top 15% and bottom 20% of a
/// 9:16 frame with their own chrome, which is where the band's black goes. What was wrong was
/// that `auto_reframe` did the second one silently, so nobody could see the trade it made.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sharpness {
    /// What the tracked crop does to source pixels. Above 1.0 is an upscale.
    pub tracked_scale: f32,
    /// What placing the whole frame as a band would do instead.
    pub panel_scale: f32,
}

impl Sharpness {
    /// Below this, an upscale is not worth a sentence. 4% is inside what a resample hides.
    const WORTH_SAYING: f32 = 1.04;

    pub fn measure(source: (u32, u32), target: (u32, u32)) -> Self {
        let (sw, sh) = (source.0.max(1) as f32, source.1.max(1) as f32);
        let (tw, th) = (target.0.max(1) as f32, target.1.max(1) as f32);
        let source_aspect = sw / sh;
        let target_aspect = tw / th;
        // A fixed aperture of the target's shape, cut from the source and blown up to fill.
        let tracked_scale = if target_aspect < source_aspect {
            th / sh
        } else {
            tw / sw
        };
        // The whole frame, contained: limited by whichever axis runs out first.
        let panel_scale = (tw / sw).min(th / sh);
        Self {
            tracked_scale,
            panel_scale,
        }
    }

    /// The sentence to put in front of someone, or `None` when the crop costs nothing worth
    /// mentioning. Deliberately not an error: a tracked reframe of a close-up is often the right
    /// call, and refusing it would be substituting a taste for a measurement.
    pub fn note(&self) -> Option<String> {
        (self.tracked_scale > Self::WORTH_SAYING
            && self.tracked_scale > self.panel_scale * Self::WORTH_SAYING)
            .then(|| {
                format!(
                    "this crop upscales the source {:.2}x. Placing the whole frame as a band \
                     instead is {:.2}x — sharper, it cannot lose anyone at the edge of a \
                     two-shot, and the black lands where the platform puts its own chrome. \
                     A band is what `add_video` already does with no crop at all.",
                    self.tracked_scale, self.panel_scale
                )
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The aperture is one size for the whole path; only where it sits changes.
    ///
    /// This is the property `moves::coordinated_camera_crop` proves structurally in order to
    /// exempt `auto_reframe`'s output from off-vocabulary motion, so it is worth asserting at
    /// the source as well as at the audit.
    #[test]
    fn the_aperture_is_the_same_size_wherever_the_subject_is() {
        let (source, target) = (16.0 / 9.0, 9.0 / 16.0);
        let widths: Vec<f32> = [0.0, 0.25, 0.5, 0.75, 1.0]
            .iter()
            .map(|x| {
                let crop = crop_for(*x, 0.5, source, target);
                1.0 - crop.left - crop.right
            })
            .collect();
        for width in &widths {
            assert!(
                (width - widths[0]).abs() < 1e-6,
                "aperture changed size across the path: {widths:?}"
            );
        }
    }

    /// A subject at the very edge does not push the aperture off the source.
    #[test]
    fn the_aperture_stays_inside_the_frame_at_either_edge() {
        let (source, target) = (16.0 / 9.0, 9.0 / 16.0);
        for x in [-1.0, 0.0, 1.0, 2.0] {
            let crop = crop_for(x, 0.5, source, target);
            assert!(crop.left >= 0.0, "left inset went negative at x={x}");
            assert!(crop.right >= 0.0, "right inset went negative at x={x}");
            assert!(
                crop.left + crop.right <= 1.0,
                "insets ate more than the frame at x={x}"
            );
        }
    }

    /// Portrait source into a landscape target crops top and bottom, not the sides.
    #[test]
    fn a_taller_target_crops_the_other_axis() {
        let crop = crop_for(0.5, 0.5, 9.0 / 16.0, 16.0 / 9.0);
        assert_eq!(crop.left, 0.0);
        assert_eq!(crop.right, 0.0);
        assert!(crop.top > 0.0 && crop.bottom > 0.0);
    }

    /// Damping must not carry the frame across an edit — the incoming shot is a new composition,
    /// not somewhere the camera travelled to.
    #[test]
    fn a_shot_boundary_snaps_instead_of_sweeping() {
        let raw = vec![
            (0.0, (0.2, 0.5, 1.0)),
            (0.5, (0.2, 0.5, 1.0)),
            (1.0, (0.9, 0.5, 1.0)),
        ];
        let swept = smooth_path(raw.clone(), 0.9, &[]);
        let snapped = smooth_path(raw, 0.9, &[0.75]);
        assert!(
            swept[2].x < 0.5,
            "without a boundary the path should still be damped, got {}",
            swept[2].x
        );
        assert_eq!(
            snapped[2].x, 0.9,
            "a cut should land on the incoming composition, not interpolate toward it"
        );
    }

    /// The measure that justifies smoothing at all: a jittery path must score materially higher
    /// than the damped one, or `auto_reframe`'s two reported numbers mean nothing.
    ///
    /// Moved here with `smooth_path` itself. The halving is the bar it has always held to; a
    /// weaker "merely lower" assertion would pass on a filter that did almost nothing.
    #[test]
    fn smoothing_reduces_camera_path_jitter() {
        let raw = [0.50, 0.64, 0.48, 0.66, 0.49, 0.63, 0.51];
        let detections = raw
            .iter()
            .enumerate()
            .map(|(index, value)| (index as f64 * 0.5, (*value, 0.5, 0.1)))
            .collect();
        let smooth = smooth_path(detections, 1.0, &[])
            .iter()
            .map(|point| point.x)
            .collect::<Vec<_>>();
        assert!(path_jitter(&smooth) < path_jitter(&raw) * 0.5);
    }

    /// An empty path is a legitimate answer (nothing was found) and must not produce keyframes
    /// or an error — the caller decides whether to fall down the detector ladder.
    #[test]
    fn an_empty_path_plans_no_keyframes_and_no_crop() {
        let plan =
            plan_reframe(&[], 0.0, 16.0 / 9.0, 9.0 / 16.0).expect("empty path is not a failure");
        assert_eq!(
            plan.first,
            Crop {
                left: 0.0,
                top: 0.0,
                right: 0.0,
                bottom: 0.0
            }
        );
        for name in CROP_CHANNELS {
            assert!(
                plan.channels[name].keys.is_empty(),
                "{name} gained a key from nothing"
            );
        }
    }

    /// Keyframe times are local to the element, so a clip that starts 10 s into its source opens
    /// its channels at zero rather than at ten.
    #[test]
    fn keyframe_times_are_local_to_the_element() {
        let path = vec![
            SubjectPoint {
                time_seconds: 10.0,
                raw_x: 0.5,
                raw_y: 0.5,
                x: 0.5,
                y: 0.5,
                confidence: 1.0,
            },
            SubjectPoint {
                time_seconds: 11.0,
                raw_x: 0.6,
                raw_y: 0.5,
                x: 0.6,
                y: 0.5,
                confidence: 1.0,
            },
        ];
        let plan = plan_reframe(&path, 10.0, 16.0 / 9.0, 9.0 / 16.0).expect("representable");
        let left = &plan.channels["cropLeft"];
        assert_eq!(left.keys.len(), 2);
        assert_eq!(left.keys[0].time, MediaTime::ZERO);
    }

    /// The measurement behind the framing decision: 1920x1080 into 1080x1920 upscales 1.78x if
    /// you crop and downscales to 0.56x if you band it. Those two numbers are why the podcast
    /// reels were soft.
    #[test]
    fn cropping_a_landscape_source_to_portrait_upscales_and_banding_does_not() {
        let sharpness = Sharpness::measure((1920, 1080), (1080, 1920));
        assert!(
            (sharpness.tracked_scale - 1.7778).abs() < 0.001,
            "{sharpness:?}"
        );
        assert!(
            (sharpness.panel_scale - 0.5625).abs() < 0.001,
            "{sharpness:?}"
        );
        assert!(sharpness.note().is_some(), "1.78x deserves a sentence");
    }

    /// Same shape in and out is no trade at all, and must not produce a note — a warning that
    /// fires when nothing is wrong is a warning people learn to skip.
    #[test]
    fn reframing_to_the_shape_it_already_is_says_nothing() {
        let sharpness = Sharpness::measure((1920, 1080), (1920, 1080));
        assert_eq!(sharpness.tracked_scale, 1.0);
        assert_eq!(sharpness.panel_scale, 1.0);
        assert_eq!(sharpness.note(), None);
    }

    /// A 4K source cropped to a 1080-wide vertical is a *downscale*, so there is nothing to warn
    /// about — the crop is free and tracking is the better answer. This is the case that stops
    /// the note from being "always say banding is sharper".
    #[test]
    fn cropping_an_oversized_source_costs_nothing_and_says_nothing() {
        let sharpness = Sharpness::measure((3840, 2160), (1080, 1920));
        assert!(sharpness.tracked_scale < 1.0, "{sharpness:?}");
        assert_eq!(sharpness.note(), None);
    }

    /// A degenerate size must not divide by zero or produce a NaN that serialises as null.
    #[test]
    fn a_zero_dimension_still_measures_a_finite_number() {
        let sharpness = Sharpness::measure((0, 0), (1080, 1920));
        assert!(sharpness.tracked_scale.is_finite(), "{sharpness:?}");
        assert!(sharpness.panel_scale.is_finite(), "{sharpness:?}");
    }
}
