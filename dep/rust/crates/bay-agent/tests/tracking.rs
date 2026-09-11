//! The detector ladder, against a real interview clip.
//!
//! `tracking.rs`'s unit tests are about naming and fallback order. These run the thing: ffmpeg
//! pulls frames out of a real video, Vision looks at them, and the result is the shape a script
//! would read. Without this, "face detection is wired into auto_reframe" would be a claim
//! resting on the code compiling.

use std::path::{Path, PathBuf};

use bay_test_support::{Capability, require};

/// The Jane Goodall interview already in the tree for `assets/podcast-cut` — *The Green
/// Interview*, CC BY 3.0. 640×360, one person on camera for most of it.
const CLIP: &str = "assets/podcast-cut/pod/goodall.webm";

fn fixture(name: &str) -> Option<PathBuf> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join(name);
    path.is_file().then_some(path)
}

fn ready() -> Option<PathBuf> {
    require(
        Capability::Detect,
        bay_detect::unavailable_reason().map_or(Ok(()), Err),
    )?;
    if !bay_test_support::require_ffmpeg() {
        return None;
    }
    let path = fixture(CLIP);
    if path.is_none() {
        eprintln!("skipping: {CLIP} is not in this checkout");
    }
    path
}

#[test]
fn a_real_interview_clip_yields_faces_through_the_tool_path() {
    let Some(clip) = ready() else { return };
    // Shot 18 of this recording, 86.2–120.9 s, is the guest talking to camera — the labelling in
    // `assets/podcast-cut/shots_labelled.json` is where that comes from.
    let value = bay_agent::tracking::detect_people(
        &clip.display().to_string(),
        90.0,
        94.0,
        1.0,
        bay_detect::Want::FACES,
        &mut |_, _| {},
    )
    .expect("the detector ran");

    let summary = &value["summary"];
    assert_eq!(summary["sampled"].as_u64(), Some(5), "{value}");
    assert!(
        summary["framesWithPeople"].as_u64().unwrap_or(0) >= 3,
        "a guest talking to camera should be found in most frames: {summary}"
    );
    assert!(
        summary["mostFacesAtOnce"].as_u64().unwrap_or(0) >= 1,
        "no face was found in a shot of somebody talking: {summary}"
    );
    assert_eq!(
        value["detector"].as_str(),
        Some("Vision.framework face and body rectangles")
    );
}

/// The refusal, rather than an hour of ffmpeg nobody asked for. A caller that would have taken
/// more than the ceiling is told the number to change, not quietly given a truncated answer that
/// reads like the whole clip.
#[test]
fn a_range_that_would_take_too_many_samples_is_refused_with_the_fix() {
    let Some(clip) = ready() else { return };
    let error = bay_agent::tracking::detect_people(
        &clip.display().to_string(),
        0.0,
        360.0,
        0.01,
        bay_detect::Want::FACES,
        &mut |_, _| {},
    )
    .expect_err("36,000 samples must not be attempted");
    assert!(
        error.contains("sampleSeconds"),
        "the refusal must name the argument to change: {error}"
    );
}

/// Progress is reported, monotonically, ending at the total. A job that shows nothing for two
/// minutes is indistinguishable from one that has hung.
#[test]
fn progress_climbs_to_the_total() {
    let Some(clip) = ready() else { return };
    let mut seen: Vec<(usize, usize)> = Vec::new();
    bay_agent::tracking::detect_people(
        &clip.display().to_string(),
        90.0,
        92.0,
        1.0,
        bay_detect::Want::FACES,
        &mut |done, total| seen.push((done, total)),
    )
    .expect("the detector ran");
    assert!(!seen.is_empty(), "no progress was reported at all");
    assert!(
        seen.windows(2).all(|w| w[0].0 < w[1].0),
        "progress went backwards or stalled: {seen:?}"
    );
    let (done, total) = *seen.last().expect("at least one report");
    assert_eq!(done, total, "the last report should be complete: {seen:?}");
}
