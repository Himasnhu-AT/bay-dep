//! Which detector finds the subject, and what to call the one that did.
//!
//! There are three ways bay can answer "where is the person in this frame", and until now
//! `auto_reframe` used exactly one of them — the weakest — while reporting a fixed string that
//! said so whether or not it was true.
//!
//! The ladder lives here rather than in `bay-vision` because putting it there would couple candle
//! and Vision.framework inside one crate, and here rather than in either caller because
//! `bay_mcp::studio::auto_reframe` and [`crate::slow`]'s copy are the attached and headless paths
//! of the same tool. A detector change must land in one place or it lands in one of two.

use bay_project::reframe::{ReframeTrackingConfig, SubjectPoint};

/// A tracked path and the honest name of what produced it.
pub struct Tracked {
    pub path: Vec<SubjectPoint>,
    /// Goes into the tool's result as `detector`. It used to be the constant
    /// `"SigLIP-ranked subject crops with local appearance prior"`, which is a claim rather than
    /// a report — and with more than one detector available it is also the measurement surface:
    /// `rawJitter` and `smoothedJitter` beside a detector name is how "did face detection beat
    /// SigLIP on this footage" gets answered from two tool results.
    pub detector: &'static str,
    /// Set when the chosen detector produced something that does not look like a track. The
    /// caller still gets the path — refusing outright would be worse than a reframe someone can
    /// look at — but the warning travels with the result so it is visible rather than inferred.
    pub warning: Option<String>,
}

/// The three rungs, so a test can assert they are distinguishable and a caller can list them.
pub const DETECTORS: [&str; 3] = [
    "Vision.framework face and body rectangles",
    "SigLIP-ranked subject crops with local appearance prior",
    "skin-colour and spatial-coherence heuristic",
];

/// Follow the subject, best available detector first.
///
/// | | detector | when |
/// |---|---|---|
/// | 1 | Vision.framework face and torso boxes | the framework is reachable and finds people |
/// | 2 | SigLIP-ranked candidate crops | an encoder loads |
/// | 3 | skin-colour and spatial-coherence heuristic | last resort, always available |
///
/// Falling *down* the ladder is normal and silent: a machine without the vision component, or a
/// clip with nobody in it, is not an error. What must never happen is falling down it while still
/// reporting the detector above — which is why [`Tracked::detector`] is returned rather than
/// assumed by the caller.
pub fn track(
    media_path: &str,
    source_start: f64,
    source_end: f64,
    config: ReframeTrackingConfig<'_>,
) -> Result<Tracked, String> {
    let mut carried = None;
    if bay_detect::available() {
        match track_with_vision(media_path, source_start, source_end, config) {
            Ok(tracked) => return Ok(tracked),
            // An empty answer from a working detector is the interesting case: a wide of an empty
            // room genuinely has no subject, and the right response is to let SigLIP rank the
            // composition rather than to fail the tool.
            Err(reason) => carried = Some(reason),
        }
    }
    if let Some(mut tracked) = track_with_siglip(media_path, source_start, source_end, config) {
        tracked.warning = carried;
        return Ok(tracked);
    }
    heuristic(media_path, source_start, source_end, config, carried)
}

fn track_with_vision(
    media_path: &str,
    source_start: f64,
    source_end: f64,
    config: ReframeTrackingConfig<'_>,
) -> Result<Tracked, String> {
    let times = bay_detect::sample_times(source_start, source_end, config.tracking.sample_seconds);
    let frames = bay_detect::detect_frames(media_path, &times, bay_detect::Want::EVERYONE)
        .map_err(|error| error.to_string())?;
    // A reframe on a conversation must keep everybody, not choose between them. Following one
    // point is exactly why a wide two-shot ended up framed on neither speaker.
    let path = bay_detect::subject_path(
        &frames,
        bay_detect::Focus::Everybody,
        config.tracking.smoothing_seconds,
        config.shot_boundaries,
    )
    .map_err(|error| error.to_string())?;
    let warning = bay_detect::implausible(&frames, &path);
    Ok(Tracked {
        path,
        detector: DETECTORS[0],
        warning,
    })
}

fn track_with_siglip(
    media_path: &str,
    source_start: f64,
    source_end: f64,
    config: ReframeTrackingConfig<'_>,
) -> Option<Tracked> {
    let encoder = bay_vision::Encoder::load().ok()?;
    let path =
        bay_vision::track_subject_siglip(&encoder, media_path, source_start, source_end, config)
            .ok()?;
    Some(Tracked {
        path,
        detector: DETECTORS[1],
        warning: None,
    })
}

fn heuristic(
    media_path: &str,
    source_start: f64,
    source_end: f64,
    config: ReframeTrackingConfig<'_>,
    carried: Option<String>,
) -> Result<Tracked, String> {
    let path = bay_vision::track_subject(media_path, source_start, source_end, config.tracking)
        .map_err(|error| error.to_string())?;
    Ok(Tracked {
        path,
        detector: DETECTORS[2],
        warning: carried,
    })
}

/// `want` as the `faces_detect` schema spells it.
///
/// Faces alone by default: a torso pass costs a second Vision request per frame, and a rule that
/// only needs "who is on screen" never reads a torso. Shared by both arms so the default cannot
/// differ between the attached and headless paths — which would make the same call return
/// different data depending on whether a window was open.
pub fn want_from(args: &serde_json::Value) -> bay_detect::Want {
    match args.get("want").and_then(|value| value.as_str()) {
        Some("everyone") => bay_detect::Want::EVERYONE,
        _ => bay_detect::Want::FACES,
    }
}

/// The most samples one `faces_detect` call will take.
///
/// Refusing is deliberate, and it is the alternative to two worse designs. Silently truncating
/// the answer reads as "these are all the people in the clip" when it is not; silently accepting
/// is an hour of ffmpeg the caller did not ask for — 7,200 extractions on a fifty-minute take at
/// the default half-second sample. The caller knows its range and can widen the interval, so the
/// refusal says exactly which number to change.
pub const MAX_SAMPLES: usize = 3_000;

/// Where the people are in a clip, as a tool result.
///
/// Shared by the attached and headless arms for the same reason [`track`] is: two copies of a
/// measurement diverge, and the one nobody is looking at is the one that goes wrong.
pub fn detect_people(
    media_path: &str,
    start_seconds: f64,
    end_seconds: f64,
    sample_seconds: f64,
    want: bay_detect::Want,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<serde_json::Value, String> {
    if let Some(reason) = bay_detect::unavailable_reason() {
        return Err(reason);
    }
    let times = bay_detect::sample_times(start_seconds, end_seconds, sample_seconds);
    if times.len() > MAX_SAMPLES {
        let needed = (end_seconds - start_seconds).max(0.0) / MAX_SAMPLES as f64;
        return Err(format!(
            "{} samples is more than faces_detect will take in one call ({MAX_SAMPLES}). Either \
             narrow the range, or raise sampleSeconds to at least {needed:.2}.",
            times.len()
        ));
    }
    let frames = bay_detect::detect_frames_reporting(media_path, &times, want, progress)
        .map_err(|error| error.to_string())?;

    let with_people = frames.iter().filter(|f| !f.detections.is_empty()).count();
    let most_faces = frames
        .iter()
        .map(|frame| frame.faces().count())
        .max()
        .unwrap_or(0);
    Ok(serde_json::json!({
        "path": media_path,
        "detector": DETECTORS[0],
        "sampleSeconds": sample_seconds,
        "frames": frames,
        "summary": {
            "sampled": frames.len(),
            "framesWithPeople": with_people,
            // The number a shot-selection rule actually asks for: two faces at once is a wide,
            // one is a single, none is a cutaway or an empty room.
            "mostFacesAtOnce": most_faces,
        },
        "hint": "mostFacesAtOnce is what tells a two-shot from a single. Bounds are fractions \
                 of the frame with the origin at the TOP left, so y grows downward.",
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every rung names itself differently. Two rungs sharing a label is how a fallback becomes
    /// invisible, and this tool's `detector` field is the only evidence a caller has about which
    /// one ran.
    #[test]
    fn every_detector_has_its_own_name() {
        for (index, name) in DETECTORS.iter().enumerate() {
            assert!(!name.is_empty());
            assert!(
                !DETECTORS[..index].contains(name),
                "two rungs of the ladder report the same detector: {name}"
            );
        }
    }

    /// A clip that does not exist must fall all the way through and report a failure, rather than
    /// returning an empty path a caller would read as "nobody is in this shot".
    #[test]
    fn an_unreadable_clip_fails_rather_than_reporting_an_empty_track() {
        let config = ReframeTrackingConfig {
            source_aspect: 16.0 / 9.0,
            target_aspect: 9.0 / 16.0,
            shot_boundaries: &[],
            tracking: Default::default(),
        };
        let result = track("/nonexistent/clip.mp4", 0.0, 1.0, config);
        assert!(
            result.is_err(),
            "a missing file produced a track: {:?}",
            result.map(|tracked| tracked.detector)
        );
    }
}
