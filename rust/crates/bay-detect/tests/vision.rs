//! Vision.framework, against real pictures.
//!
//! Everything in `src/` is arithmetic over detections someone else supplied, and arithmetic
//! passing its unit tests is not a detector that works — that error has been made in this
//! repository before, in an audio engine whose tests all passed and which nothing called. These
//! tests call the framework.
//!
//! The fixture is a frame of *The Green Interview* (CC BY 3.0), already in the tree as the render
//! proof for the vertical Goodall cut. Using it rather than shipping a new face means no new
//! media, no new licence question, and a picture representative of the work: one person, seated,
//! mid-shot, in a real room.

use std::path::{Path, PathBuf};

use bay_detect::{Kind, Want};
use bay_test_support::{Capability, require};

const INTERVIEW: &str = "research/phase4-seeing/goodall-vertical-render-proof.png";

fn fixture(name: &str) -> Option<PathBuf> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join(name);
    path.is_file().then_some(path)
}

/// `Some(())` when Vision can be used, `None` after skipping — and a panic under
/// `BAY_REQUIRE_DETECT`, so a runner provisioned for it cannot quietly stop exercising it and
/// keep reporting success.
fn detector() -> Option<()> {
    require(
        Capability::Detect,
        bay_detect::unavailable_reason().map_or(Ok(()), Err),
    )
}

#[test]
fn a_real_frame_of_a_real_interview_yields_a_face() {
    let Some(()) = detector() else { return };
    let Some(path) = fixture(INTERVIEW) else {
        eprintln!("skipping: the interview fixture is not in this checkout");
        return;
    };
    let found = bay_detect::detect_image(&path, Want::FACES).expect("Vision read the frame");
    let faces: Vec<_> = found.iter().filter(|d| d.kind == Kind::Face).collect();
    assert_eq!(faces.len(), 1, "one person is on screen, found {found:?}");
    let face = faces[0];
    assert!(
        face.confidence > 0.5,
        "a clearly framed face should not be a marginal call: {}",
        face.confidence
    );
    assert!(
        face.bounds.width > 0.02 && face.bounds.width < 0.6,
        "a mid-shot face should be a modest fraction of the frame, got {:?}",
        face.bounds
    );
}

/// **The orientation proof, from data rather than from a constant.**
///
/// Vision reports normalized rectangles with the origin at the *lower* left; bay's are top-left.
/// A wrong flip mirrors every camera path vertically, which looks entirely plausible on a subject
/// sitting mid-frame — so a test pinning one hardcoded number on one picture would be checking
/// that the number had not changed, not that the orientation was right.
///
/// This asserts a fact about human beings instead: **a face sits in the upper part of the torso
/// that contains it.** Under the mirror bug the same picture puts the face in the lower part, and
/// the assertion fails on a frame of anybody.
#[test]
fn a_face_sits_in_the_upper_half_of_the_body_it_belongs_to() {
    let Some(()) = detector() else { return };
    let Some(path) = fixture(INTERVIEW) else {
        eprintln!("skipping: the interview fixture is not in this checkout");
        return;
    };
    let found = bay_detect::detect_image(&path, Want::EVERYONE).expect("Vision read the frame");
    let face = found
        .iter()
        .find(|d| d.kind == Kind::Face)
        .expect("a face is on screen");
    let Some(torso) = found.iter().find(|d| d.kind == Kind::Torso) else {
        eprintln!("skipping the orientation check: no torso was detected in this frame");
        return;
    };
    let face_centre = face.bounds.center().1;
    let torso_middle = torso.bounds.y + torso.bounds.height * 0.5;
    assert!(
        face_centre < torso_middle,
        "the face centre ({face_centre:.3}) must be above the middle of the body \
         ({torso_middle:.3}) — if it is below, the bottom-left to top-left flip is inverted"
    );
}

/// Nothing there is an empty answer, not a guess at the middle. This decides whether a caller may
/// trust a result at all: a detector that invents a centre box on a blank frame produces a
/// reframe that looks deliberate and is not.
#[test]
fn a_picture_with_nobody_in_it_finds_nobody() {
    let Some(()) = detector() else { return };
    if !bay_test_support::require_ffmpeg() {
        return;
    }
    let scratch = std::env::temp_dir().join(format!("bay-detect-blank-{}", std::process::id()));
    std::fs::create_dir_all(&scratch).expect("scratch dir");
    let blank = scratch.join("blank.png");
    let made = bay_paths::tools::command(bay_paths::tools::Tool::Ffmpeg)
        .expect("ffmpeg was just verified present")
        .args([
            "-nostdin",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=gray:s=640x360",
            "-frames:v",
            "1",
            "-y",
        ])
        .arg(&blank)
        .status()
        .expect("ffmpeg ran");
    assert!(made.success(), "could not synthesise a blank frame");

    let found = bay_detect::detect_image(&blank, Want::EVERYONE).expect("Vision read the frame");
    let _ = std::fs::remove_dir_all(&scratch);
    assert!(
        found.is_empty(),
        "a flat grey frame contains nobody, but the detector reported {found:?}"
    );
}

/// A missing file is an error, never a panic and never an empty answer — "nobody is here" and
/// "that path is wrong" must not look the same to a caller deciding whether to try the next
/// detector.
#[test]
fn a_missing_file_is_an_error_not_an_empty_answer() {
    let Some(()) = detector() else { return };
    let error = bay_detect::detect_image(Path::new("/nonexistent/frame.png"), Want::FACES)
        .expect_err("a path that is not there cannot succeed");
    assert!(
        matches!(error, bay_detect::DetectError::Vision { .. }),
        "{error}"
    );
}
