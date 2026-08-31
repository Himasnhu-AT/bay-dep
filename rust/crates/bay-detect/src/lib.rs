//! Where the people are.
//!
//! Face and torso rectangles from Apple's Vision framework — on the device, on the Neural Engine,
//! with no model to download and no licence to clear. This is the measurement bay was missing:
//! `auto_reframe` tracked "the most face-like subject" with a skin-colour heuristic, and
//! `assets/podcast-cut/README.md` closes by saying the thing it could not do — *"cut to whoever is
//! speaking here means choosing whole shots, not panning a crop around a wide master. That wants
//! face detection."*
//!
//! Two rules the rest of bay already lives by, restated because they bite here:
//!
//! - **Absent is not broken.** [`available`] answers whether Vision can be used at all, and every
//!   caller branches on it rather than treating it as an error. Off macOS the crate compiles and
//!   reports unavailable.
//! - **Nothing found is an answer, not a guess.** A frame with no people returns an empty vector.
//!   A whole range with no people returns [`DetectError::NothingFound`], so a caller falls to the
//!   next detector instead of receiving a centre crop labelled as face-tracked.

use std::path::Path;

pub use bay_project::reframe::{SubjectPoint, path_jitter, smooth_path};

mod frames;
#[cfg(target_os = "macos")]
mod vision;

pub use frames::{detect_frames, sample_times};

/// A rectangle in the picture, as fractions of the frame, **top-left origin**.
///
/// Vision reports bottom-left, like Core Graphics; bay's crop insets are top-left, like everything
/// else in the project format. The flip happens once, in [`vision`], and
/// [`tests::a_face_low_in_the_frame_reads_as_low`] is what keeps it there — a mirrored track looks
/// entirely plausible on a centred subject and is silently wrong on everything else.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl Rect {
    pub fn center(&self) -> (f32, f32) {
        (self.x + self.width * 0.5, self.y + self.height * 0.5)
    }

    pub fn area(&self) -> f32 {
        (self.width * self.height).max(0.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    Face,
    /// Vision's "human rectangle" is an upper body, not a whole person — which is the right
    /// primitive for a podcast, where everybody is seated behind a desk.
    Torso,
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub bounds: Rect,
    pub confidence: f32,
    pub kind: Kind,
}

/// Everything found at one moment.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub time_seconds: f64,
    pub detections: Vec<Detection>,
}

impl Frame {
    pub fn faces(&self) -> impl Iterator<Item = &Detection> {
        self.detections.iter().filter(|d| d.kind == Kind::Face)
    }

    /// The rectangle enclosing everything found, or `None` if nothing was.
    ///
    /// This is what a two-shot needs: `auto_reframe` used to reduce a frame to one point, so a
    /// wide with two people in it framed on neither. A union keeps both in the aperture.
    pub fn union(&self) -> Option<Rect> {
        let mut bounds: Option<Rect> = None;
        for detection in &self.detections {
            let d = detection.bounds;
            bounds = Some(match bounds {
                None => d,
                Some(b) => {
                    let left = b.x.min(d.x);
                    let top = b.y.min(d.y);
                    let right = (b.x + b.width).max(d.x + d.width);
                    let bottom = (b.y + b.height).max(d.y + d.height);
                    Rect {
                        x: left,
                        y: top,
                        width: right - left,
                        height: bottom - top,
                    }
                }
            });
        }
        bounds
    }

    /// The single most prominent subject: the largest face, or failing that the largest torso.
    ///
    /// A face beats a bigger torso deliberately. On a two-shot the torsos merge into one wide
    /// blob whose centre is the gap between the speakers, which is the emptiest part of the frame.
    pub fn principal(&self) -> Option<Detection> {
        let best = |kind: Kind| {
            self.detections
                .iter()
                .filter(|d| d.kind == kind)
                .max_by(|a, b| {
                    (a.bounds.area() * a.confidence).total_cmp(&(b.bounds.area() * b.confidence))
                })
                .copied()
        };
        best(Kind::Face).or_else(|| best(Kind::Torso))
    }
}

/// What to ask Vision for. Each request costs a pass, so asking for less is faster.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Want {
    pub faces: bool,
    pub torsos: bool,
}

impl Default for Want {
    fn default() -> Self {
        Self {
            faces: true,
            torsos: false,
        }
    }
}

impl Want {
    pub const FACES: Self = Self {
        faces: true,
        torsos: false,
    };
    pub const EVERYONE: Self = Self {
        faces: true,
        torsos: true,
    };
}

/// How a frame's detections become one point for the camera to follow.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Focus {
    /// Keep everybody in the aperture. The right answer for a wide two-shot, and the reason
    /// tracking a single point put the frame between two speakers.
    #[default]
    Everybody,
    /// Follow the most prominent subject. The right answer for a close-up.
    Principal,
}

#[derive(Debug, thiserror::Error)]
pub enum DetectError {
    /// Vision.framework cannot be used here. Not a fault — a fact to branch on.
    #[error("{0}")]
    Unavailable(String),
    #[error("Vision could not read {path}: {detail}")]
    Vision { path: String, detail: String },
    #[error("{0}")]
    Extract(String),
    /// Every sampled frame came back empty. Distinct from an empty *frame*, because a caller
    /// that gets this should try another detector rather than crop to the middle and claim a
    /// face was there.
    #[error("nothing was detected in any sampled frame")]
    NothingFound,
}

/// Is Vision.framework usable on this machine?
pub fn available() -> bool {
    #[cfg(target_os = "macos")]
    {
        vision::available()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Why detection is unavailable, in a sentence fit to show someone.
pub fn unavailable_reason() -> Option<String> {
    if available() {
        return None;
    }
    Some(if cfg!(target_os = "macos") {
        "this build cannot reach Vision.framework".to_string()
    } else {
        "face detection uses Apple's Vision framework and is macOS only".to_string()
    })
}

/// Detect in one image file already on disk.
pub fn detect_image(path: &Path, want: Want) -> Result<Vec<Detection>, DetectError> {
    #[cfg(target_os = "macos")]
    {
        vision::detect_image(path, want)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (path, want);
        Err(DetectError::Unavailable(
            unavailable_reason().unwrap_or_default(),
        ))
    }
}

/// Turn detections over time into the damped camera path `plan_reframe` consumes.
///
/// Returns the same `SubjectPoint` sequence `bay-vision`'s trackers return, which is the whole
/// point: `auto_reframe`'s arithmetic below the tracker does not change, so swapping detectors is
/// a choice rather than a second code path.
pub fn subject_path(
    frames: &[Frame],
    focus: Focus,
    smoothing_seconds: f64,
    shot_boundaries: &[f64],
) -> Result<Vec<SubjectPoint>, DetectError> {
    if frames.iter().all(|frame| frame.detections.is_empty()) {
        return Err(DetectError::NothingFound);
    }
    // A frame where nobody was found does not get a point invented for it. `smooth_path` carries
    // the last position forward, which is what a person does when someone briefly turns away.
    let raw: Vec<(f64, (f32, f32, f32))> = frames
        .iter()
        .filter_map(|frame| {
            let (center, confidence) = match focus {
                Focus::Everybody => {
                    let union = frame.union()?;
                    let confidence = frame
                        .detections
                        .iter()
                        .map(|d| d.confidence)
                        .fold(0.0f32, f32::max);
                    (union.center(), confidence)
                }
                Focus::Principal => {
                    let principal = frame.principal()?;
                    (principal.bounds.center(), principal.confidence)
                }
            };
            Some((frame.time_seconds, (center.0, center.1, confidence)))
        })
        .collect();
    if raw.is_empty() {
        return Err(DetectError::NothingFound);
    }
    Ok(smooth_path(raw, smoothing_seconds, shot_boundaries))
}

/// A track that is obviously not a track.
///
/// Two ways a detector fails without erroring, both seen in the wild: it returns the whole frame
/// every time (so the "subject" is the picture), or it returns a constant (so the path is a line
/// and jitter is exactly zero across what should be a cut). Either produces a reframe that looks
/// deliberate and is not, which is the failure mode that ships bad video. The adapter checks this
/// rather than the detector, because a provider cannot be trusted to grade itself.
pub fn implausible(frames: &[Frame], path: &[SubjectPoint]) -> Option<String> {
    const FILLS_THE_FRAME: f32 = 0.9;
    /// Horizontal travel below which a path is not following anything. Deliberately a real
    /// distance rather than `f32::EPSILON`: a detector emitting the same box every frame is the
    /// failure, and one wobbling by a millionth of a frame width is the same failure.
    const MOTIONLESS: f32 = 1e-6;
    let sampled = frames.iter().filter(|f| !f.detections.is_empty()).count();
    if sampled > 2 {
        let engulfing = frames
            .iter()
            .filter(|frame| {
                frame
                    .union()
                    .is_some_and(|union| union.area() >= FILLS_THE_FRAME)
            })
            .count();
        if engulfing == sampled {
            return Some(format!(
                "every one of the {sampled} detected frames covers {:.0}% or more of the picture, \
                 which is a detector returning the whole frame rather than a subject",
                FILLS_THE_FRAME * 100.0
            ));
        }
    }
    if path.len() > 4 {
        let xs: Vec<f32> = path.iter().map(|point| point.raw_x).collect();
        let (min, max) = xs
            .iter()
            .fold((f32::MAX, f32::MIN), |(lo, hi), x| (lo.min(*x), hi.max(*x)));
        if max - min < MOTIONLESS {
            return Some(format!(
                "all {} tracked points share one horizontal position, which is a detector \
                 returning a constant rather than following anything",
                path.len()
            ));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn face(x: f32, y: f32, size: f32) -> Detection {
        Detection {
            bounds: Rect {
                x,
                y,
                width: size,
                height: size,
            },
            confidence: 0.9,
            kind: Kind::Face,
        }
    }

    /// The bug this crate exists to fix: a wide two-shot reduced to one point framed on neither
    /// person. The union sits between them; that is the correct aperture centre for a panel.
    #[test]
    fn two_faces_give_a_centre_between_them_not_on_one_of_them() {
        // The right-hand face is deliberately larger, so `principal` is decided by size rather
        // than by which way `max_by` happens to break a tie.
        let frame = Frame {
            time_seconds: 0.0,
            detections: vec![face(0.10, 0.30, 0.12), face(0.70, 0.30, 0.16)],
        };
        let (x, _) = frame.union().expect("two faces is a union").center();
        assert!(
            (x - 0.48).abs() < 0.02,
            "the union should sit between the two faces, got {x}"
        );
        let principal = frame.principal().expect("a face is principal");
        assert!(
            (principal.bounds.center().0 - x).abs() > 0.2,
            "principal and union must differ on a two-shot, or Focus means nothing"
        );
    }

    /// A face beats a larger torso, because on a two-shot the torsos merge into one blob whose
    /// centre is the gap between the speakers.
    #[test]
    fn a_small_face_outranks_a_large_torso() {
        let frame = Frame {
            time_seconds: 0.0,
            detections: vec![
                face(0.44, 0.20, 0.08),
                Detection {
                    bounds: Rect {
                        x: 0.05,
                        y: 0.30,
                        width: 0.90,
                        height: 0.60,
                    },
                    confidence: 0.95,
                    kind: Kind::Torso,
                },
            ],
        };
        assert_eq!(frame.principal().map(|d| d.kind), Some(Kind::Face));
    }

    /// Nothing found is `NothingFound`, never a centre crop that claims to have tracked a face.
    #[test]
    fn an_empty_range_refuses_rather_than_centring() {
        let frames: Vec<Frame> = (0..5)
            .map(|i| Frame {
                time_seconds: i as f64 * 0.5,
                detections: Vec::new(),
            })
            .collect();
        let error = subject_path(&frames, Focus::Everybody, 0.9, &[]).unwrap_err();
        assert!(matches!(error, DetectError::NothingFound), "{error}");
    }

    /// A frame where nobody was found is skipped, not invented — the damping carries the last
    /// position, which is what a camera operator does when a subject turns away for a beat.
    #[test]
    fn a_gap_in_detection_does_not_become_a_point_at_the_origin() {
        let frames = vec![
            Frame {
                time_seconds: 0.0,
                detections: vec![face(0.60, 0.30, 0.10)],
            },
            Frame {
                time_seconds: 0.5,
                detections: Vec::new(),
            },
            Frame {
                time_seconds: 1.0,
                detections: vec![face(0.62, 0.30, 0.10)],
            },
        ];
        let path = subject_path(&frames, Focus::Principal, 0.9, &[]).expect("two frames found one");
        assert_eq!(
            path.len(),
            2,
            "the empty frame should not contribute a point"
        );
        assert!(path.iter().all(|point| point.raw_x > 0.5));
    }

    /// A detector returning the whole frame every time is a detector that has failed, and must be
    /// caught here rather than becoming a reframe that looks deliberate.
    #[test]
    fn a_detector_that_returns_the_whole_frame_is_called_implausible() {
        let frames: Vec<Frame> = (0..6)
            .map(|i| Frame {
                time_seconds: i as f64 * 0.5,
                detections: vec![face(0.0, 0.0, 1.0)],
            })
            .collect();
        let path = subject_path(&frames, Focus::Everybody, 0.9, &[]).expect("found something");
        assert!(implausible(&frames, &path).is_some());
    }

    /// And one returning a constant is too, even though every individual box is reasonable.
    #[test]
    fn a_detector_that_never_moves_is_called_implausible() {
        let frames: Vec<Frame> = (0..8)
            .map(|i| Frame {
                time_seconds: i as f64 * 0.5,
                detections: vec![face(0.44, 0.30, 0.12)],
            })
            .collect();
        let path = subject_path(&frames, Focus::Principal, 0.9, &[]).expect("found something");
        assert!(implausible(&frames, &path).is_some());
    }

    /// A real, moving track must not be called implausible — a check that fires on good input is
    /// worse than no check, because it teaches people to ignore it.
    #[test]
    fn an_ordinary_moving_track_is_plausible() {
        let frames: Vec<Frame> = (0..10)
            .map(|i| Frame {
                time_seconds: i as f64 * 0.5,
                detections: vec![face(0.30 + i as f32 * 0.02, 0.30, 0.12)],
            })
            .collect();
        let path = subject_path(&frames, Focus::Principal, 0.9, &[]).expect("found something");
        assert_eq!(implausible(&frames, &path), None);
    }

    /// Off macOS this crate still compiles and answers honestly. On macOS the framework is there.
    #[test]
    fn availability_and_its_reason_agree() {
        assert_eq!(available(), unavailable_reason().is_none());
    }
}
