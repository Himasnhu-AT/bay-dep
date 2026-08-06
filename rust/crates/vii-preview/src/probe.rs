//! Media probing via the `ffprobe` sidecar.
//!
//! Parsing is a pure function over ffprobe's JSON so it is testable without ffmpeg installed;
//! only [`probe_media`] actually spawns the process. Before this existed, import hardcoded a
//! 4-second duration for every file regardless of its real length.

use vii_project::{Fps, MediaTime};

/// What we need to know about a media file to place it on a timeline correctly.
#[derive(Debug, Clone, PartialEq)]
pub struct MediaMetadata {
    pub duration: MediaTime,
    /// Natural pixel size of the video/image stream, if any.
    pub width: u32,
    pub height: u32,
    pub fps: Fps,
    pub has_audio: bool,
    pub has_video: bool,
    /// Display rotation in degrees (0/90/180/270) from a display matrix side-data, if present.
    /// Recorded now so phone footage can be oriented correctly later.
    pub rotation: i32,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ProbeError {
    /// The payload was not valid JSON, or was not an object.
    Malformed(String),
    /// Valid JSON, but it described no usable audio or video stream.
    NoStreams,
    /// `ffprobe` could not be run. Carries the reason, because "not available" alone sends
    /// someone to reinstall an ffmpeg that was already installed — the usual cause is that a
    /// Finder-launched app cannot see it, not that it is missing.
    Unavailable(String),
}

impl std::fmt::Display for ProbeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProbeError::Malformed(why) => write!(f, "malformed ffprobe output: {why}"),
            ProbeError::NoStreams => write!(f, "file contains no audio or video stream"),
            ProbeError::Unavailable(why) => write!(f, "{why}"),
        }
    }
}

/// Parse `ffprobe -print_format json -show_format -show_streams` output.
///
/// Every optional field is handled explicitly rather than via serde defaults, so a missing
/// `duration` or absent `r_frame_rate` is a known case with its own behaviour and test.
pub fn parse_ffprobe_json(json: &str) -> Result<MediaMetadata, ProbeError> {
    let root: serde_json::Value =
        serde_json::from_str(json).map_err(|e| ProbeError::Malformed(e.to_string()))?;
    let streams = root
        .get("streams")
        .and_then(|s| s.as_array())
        .ok_or(ProbeError::NoStreams)?;

    let video = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(|c| c.as_str()) == Some("video"));
    let audio = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(|c| c.as_str()) == Some("audio"));
    if video.is_none() && audio.is_none() {
        return Err(ProbeError::NoStreams);
    }

    // Duration: prefer the container's, fall back to the chosen stream's. Images have neither,
    // which is correct — the caller picks a default still duration.
    let seconds = root
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(parse_f64)
        .or_else(|| {
            video
                .or(audio)
                .and_then(|s| s.get("duration"))
                .and_then(parse_f64)
        })
        .unwrap_or(0.0);
    let duration = MediaTime::from_seconds_f64(seconds.max(0.0)).unwrap_or(MediaTime::ZERO);

    let width = video
        .and_then(|s| s.get("width"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;
    let height = video
        .and_then(|s| s.get("height"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;

    // `r_frame_rate` is a rational string like "30000/1001"; keep it rational to avoid drift.
    let fps = video
        .and_then(|s| s.get("r_frame_rate"))
        .and_then(|v| v.as_str())
        .and_then(parse_rational_fps)
        .unwrap_or_default();

    let rotation = video.map(display_rotation).unwrap_or(0);

    Ok(MediaMetadata {
        duration,
        width,
        height,
        fps,
        has_audio: audio.is_some(),
        has_video: video.is_some(),
        rotation,
    })
}

/// ffprobe emits numbers as JSON strings in some builds and as numbers in others.
fn parse_f64(value: &serde_json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.parse::<f64>().ok()))
        .filter(|v| v.is_finite())
}

/// Parse "num/den" (e.g. "30000/1001"). A zero denominator or numerator means "unknown", which
/// maps to `None` so the caller keeps its default rather than dividing by zero.
fn parse_rational_fps(raw: &str) -> Option<Fps> {
    let (num, den) = raw.split_once('/')?;
    let numerator: u32 = num.trim().parse().ok()?;
    let denominator: u32 = den.trim().parse().ok()?;
    if numerator == 0 || denominator == 0 {
        return None;
    }
    Some(Fps {
        numerator,
        denominator,
    })
}

/// Read display rotation from either the modern `side_data_list` display-matrix entry or the
/// legacy `tags.rotate`. Normalised to 0/90/180/270.
fn display_rotation(stream: &serde_json::Value) -> i32 {
    let from_side_data = stream
        .get("side_data_list")
        .and_then(|l| l.as_array())
        .and_then(|list| {
            list.iter()
                .find_map(|entry| entry.get("rotation").and_then(parse_f64))
        });
    let from_tags = stream
        .get("tags")
        .and_then(|t| t.get("rotate"))
        .and_then(parse_f64);

    let degrees = from_side_data.or(from_tags).unwrap_or(0.0);
    // ffmpeg reports counter-clockwise negatives (e.g. -90 for a 90° clockwise display).
    let normalised = ((degrees.round() as i32) % 360 + 360) % 360;
    match normalised {
        90 | 180 | 270 => normalised,
        _ => 0,
    }
}

/// Run `ffprobe` on `path` and parse the result. Returns [`ProbeError::Unavailable`] when the
/// binary is missing, so callers can degrade instead of failing the import.
pub fn probe_media(path: &str) -> Result<MediaMetadata, ProbeError> {
    let output = vii_paths::tools::command(vii_paths::tools::Tool::Ffprobe)
        .map_err(|missing| ProbeError::Unavailable(missing.detail()))?
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            path,
        ])
        .output()
        .map_err(|error| ProbeError::Unavailable(format!("could not run ffprobe: {error}")))?;
    if !output.status.success() {
        return Err(ProbeError::Malformed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    parse_ffprobe_json(&String::from_utf8_lossy(&output.stdout))
}
