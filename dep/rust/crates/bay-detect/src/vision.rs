//! The Vision.framework side. Everything unsafe in this crate is in this file.

use std::path::Path;

use objc2::rc::{Retained, autoreleasepool};
use objc2::runtime::AnyClass;
use objc2::{AnyThread, msg_send};
use objc2_core_foundation::CGRect;
use objc2_foundation::{NSArray, NSDictionary, NSString, NSURL};
use objc2_vision::{
    VNDetectFaceRectanglesRequest, VNDetectHumanRectanglesRequest, VNImageRequestHandler,
    VNObservation, VNRequest,
};

use crate::{DetectError, Detection, Kind, Rect, Want};

/// Ask the Objective-C runtime whether the classes exist, rather than assuming the framework is
/// present because the target is macOS. A build linked against an SDK that predates one of these
/// would otherwise crash at the first call instead of degrading.
pub(crate) fn available() -> bool {
    AnyClass::get(c"VNImageRequestHandler").is_some()
        && AnyClass::get(c"VNDetectFaceRectanglesRequest").is_some()
        && AnyClass::get(c"VNDetectHumanRectanglesRequest").is_some()
}

pub(crate) fn detect_image(path: &Path, want: Want) -> Result<Vec<Detection>, DetectError> {
    if !available() {
        return Err(DetectError::Unavailable(
            crate::unavailable_reason().unwrap_or_default(),
        ));
    }
    if !path.is_file() {
        return Err(DetectError::Vision {
            path: path.display().to_string(),
            detail: "no such file".to_string(),
        });
    }
    if !(want.faces || want.torsos) {
        return Ok(Vec::new());
    }

    // One pool per image. `performRequests` allocates observations, an NSURL and a handler every
    // call, and a few thousand frames of that with no pool is a scan whose memory grows without
    // bound — the same shape as the decode window that held 1.5 GB in six seconds.
    autoreleasepool(|_| unsafe {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.display().to_string()));
        let options = NSDictionary::new();
        let handler = VNImageRequestHandler::initWithURL_options(
            VNImageRequestHandler::alloc(),
            &url,
            &options,
        );

        let mut requests: Vec<(Kind, Retained<VNRequest>)> = Vec::with_capacity(2);
        if want.faces {
            let request = VNDetectFaceRectanglesRequest::new();
            requests.push((
                Kind::Face,
                Retained::into_super(Retained::into_super(request)),
            ));
        }
        if want.torsos {
            let request = VNDetectHumanRectanglesRequest::new();
            requests.push((
                Kind::Torso,
                Retained::into_super(Retained::into_super(request)),
            ));
        }

        let batch = NSArray::from_retained_slice(
            &requests
                .iter()
                .map(|(_, request)| request.clone())
                .collect::<Vec<_>>(),
        );
        handler
            .performRequests_error(&batch)
            .map_err(|error| DetectError::Vision {
                path: path.display().to_string(),
                detail: error.localizedDescription().to_string(),
            })?;

        let mut found = Vec::new();
        for (kind, request) in &requests {
            let Some(results) = request.results() else {
                continue;
            };
            for observation in results.iter() {
                found.push(Detection {
                    bounds: to_rect(bounding_box(&observation)),
                    confidence: observation.confidence(),
                    kind: *kind,
                });
            }
        }
        Ok(found)
    })
}

/// # Safety
/// The observation must be a `VNDetectedObjectObservation` or a subclass, which every result of
/// a face- or human-rectangles request is.
unsafe fn bounding_box(observation: &VNObservation) -> CGRect {
    unsafe { msg_send![observation, boundingBox] }
}

/// Vision reports normalized coordinates with **the origin at the image's lower-left corner**;
/// bay's crop insets and element transforms are top-left, like the rest of the project format.
///
/// Getting this wrong does not fail — it mirrors the camera path vertically, which looks entirely
/// plausible on a subject sitting mid-frame and is silently wrong on everyone else. It is checked
/// by `tests::a_face_low_in_the_frame_reads_as_low`, which is the only reason to trust it.
fn to_rect(rect: CGRect) -> Rect {
    let height = rect.size.height as f32;
    Rect {
        x: rect.origin.x as f32,
        y: 1.0 - rect.origin.y as f32 - height,
        width: rect.size.width as f32,
        height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2_core_foundation::{CGPoint, CGSize};

    fn cg(x: f64, y: f64, width: f64, height: f64) -> CGRect {
        CGRect {
            origin: CGPoint { x, y },
            size: CGSize { width, height },
        }
    }

    /// The flip, asserted on the case that catches it. A box occupying the *bottom* tenth of the
    /// picture in Vision's coordinates must come out near y = 0.9 in bay's.
    #[test]
    fn a_face_low_in_the_frame_reads_as_low() {
        let converted = to_rect(cg(0.4, 0.0, 0.2, 0.1));
        assert_eq!(converted.x, 0.4);
        assert_eq!(converted.width, 0.2);
        assert!(
            (converted.y - 0.9).abs() < 1e-6,
            "a box at the bottom of the picture came out at y={}",
            converted.y
        );
    }

    /// And the symmetric case, because a centred box is invariant under the bug and would pass
    /// a test that only checked one.
    #[test]
    fn a_face_high_in_the_frame_reads_as_high() {
        let converted = to_rect(cg(0.4, 0.9, 0.2, 0.1));
        assert!(
            converted.y.abs() < 1e-6,
            "a box at the top of the picture came out at y={}",
            converted.y
        );
    }

    /// A full-frame box is its own mirror, so it must survive the conversion unchanged — this is
    /// the fixed point that proves the transform is a flip and not an offset.
    #[test]
    fn a_full_frame_box_is_unchanged() {
        let converted = to_rect(cg(0.0, 0.0, 1.0, 1.0));
        assert_eq!(converted.x, 0.0);
        assert_eq!(converted.y, 0.0);
        assert_eq!(converted.width, 1.0);
        assert_eq!(converted.height, 1.0);
    }
}
