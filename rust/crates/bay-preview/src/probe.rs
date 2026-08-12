//! Media probing via the `ffprobe` sidecar.
//!
//! Parsing is a pure function over ffprobe's JSON so it is testable without ffmpeg installed;
//! only [`probe_media`] actually spawns the process. Before this existed, import hardcoded a
//! 4-second duration for every file regardless of its real length.

use bay_project::{AssetLoudness, Fps, MediaTime};

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
/// One shot: a stretch of footage between two cuts.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Shot {
    pub start_seconds: f64,
    pub end_seconds: f64,
}

impl Shot {
    pub fn duration_seconds(&self) -> f64 {
        (self.end_seconds - self.start_seconds).max(0.0)
    }
}

/// How different two consecutive frames must be to count as a cut, on ffmpeg's 0..1 scale.
///
/// 0.3 is the value that survives contact with real footage: below it a fast pan or a camera
/// flash reads as a cut, above it a cut between two similarly-lit shots of the same room is
/// missed. It is a default rather than a constant because the right number genuinely depends
/// on the material.
pub const DEFAULT_SHOT_THRESHOLD: f64 = 0.3;

/// Find the cuts in a video file, and return the stretches between them.
///
/// Frame-difference detection, which is honest about what it is: it finds *cuts*, not
/// meaning. It will not tell you which shot is good, and it will miss a dissolve, because a
/// dissolve is by construction a sequence of frames that each resemble the last. What it does
/// do is turn an hour of footage into a list an agent can reason about without watching it,
/// which is the thing that was impossible before.
///
/// Shots shorter than `min_seconds` are folded into their predecessor: a strobe, a flash cut
/// or a one-frame glitch otherwise produces dozens of "shots" nobody wanted.
pub fn detect_shots(path: &str, threshold: f64, min_seconds: f64) -> Result<Vec<Shot>, ProbeError> {
    let threshold = if threshold.is_finite() {
        threshold.clamp(0.0, 1.0)
    } else {
        DEFAULT_SHOT_THRESHOLD
    };
    let duration = probe_media(path)?.duration.to_seconds_f64();

    // `-an` and `-f null` because nothing is being encoded: the filter graph runs for its
    // metadata alone, and decoding the audio would double the work for nothing.
    let output = bay_paths::tools::command(bay_paths::tools::Tool::Ffmpeg)
        .map_err(|missing| ProbeError::Unavailable(missing.detail()))?
        .args([
            "-nostdin",
            "-v",
            "error",
            "-i",
            path,
            "-filter:v",
            &format!("select='gt(scene,{threshold})',metadata=print:file=-"),
            "-an",
            "-f",
            "null",
            "-",
        ])
        .output()
        .map_err(|e| ProbeError::Unavailable(e.to_string()))?;

    // ffmpeg prints the metadata to stdout and diagnostics to stderr; a failure here is worth
    // reporting rather than silently returning "one shot".
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(ProbeError::Malformed(format!(
            "ffmpeg could not scan {path} for cuts: {}",
            detail.trim()
        )));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(shots_from_metadata(&text, duration, min_seconds))
}

/// Turn ffmpeg's `metadata=print` output into shots. Split out so the parsing is testable
/// without a video file or an ffmpeg on the machine.
pub fn shots_from_metadata(text: &str, duration_seconds: f64, min_seconds: f64) -> Vec<Shot> {
    let min_seconds = if min_seconds.is_finite() {
        min_seconds.max(0.0)
    } else {
        0.0
    };
    let mut cuts: Vec<f64> = text
        .lines()
        .filter_map(|line| {
            // Lines look like: `frame:42   pts:12345   pts_time:1.4`
            let rest = line.split("pts_time:").nth(1)?;
            rest.split_whitespace().next()?.parse::<f64>().ok()
        })
        .filter(|time| time.is_finite() && *time > 0.0)
        .collect();
    cuts.sort_by(f64::total_cmp);
    cuts.dedup();

    let duration = if duration_seconds.is_finite() && duration_seconds > 0.0 {
        duration_seconds
    } else {
        cuts.last().copied().unwrap_or(0.0)
    };

    let mut shots = Vec::new();
    let mut start = 0.0;
    for cut in cuts {
        if cut >= duration {
            break;
        }
        // Too short to be a shot: fold it into the one before rather than reporting a strobe
        // as a dozen cuts.
        if cut - start < min_seconds {
            continue;
        }
        shots.push(Shot {
            start_seconds: start,
            end_seconds: cut,
        });
        start = cut;
    }
    if duration > start {
        shots.push(Shot {
            start_seconds: start,
            end_seconds: duration,
        });
    }
    shots
}

pub fn probe_media(path: &str) -> Result<MediaMetadata, ProbeError> {
    let output = bay_paths::tools::command(bay_paths::tools::Tool::Ffprobe)
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

/// How long one `ebur128` reporting frame is, in seconds. The filter prints a line per frame
/// and stamps it with the frame's **end**, so an onset seen in a frame happened up to this long
/// before the timestamp on the line that reports it.
const EBUR128_FRAME_SECONDS: f64 = 0.1;

/// How far a frame's true peak has to rise above the recent floor to be an accent, in dB.
///
/// 6 dB is a doubling of amplitude inside 100 ms. Below about 4 dB a sustained pad's own
/// breathing starts registering as onsets; above about 9 dB only drum hits survive and a piano
/// chord is missed.
const ACCENT_RISE_DB: f32 = 6.0;

/// How many frames of history the rise is measured against (500 ms), and the shortest gap
/// between two accents (250 ms — faster than that is one transient reported twice).
const ACCENT_HISTORY: usize = 5;
const ACCENT_MIN_GAP_SECONDS: f64 = 0.25;

/// Below this, a frame's peak is room noise rather than an event.
const ACCENT_FLOOR_DB: f32 = -45.0;

/// Measure a file's loudness with `ebur128` and `volumedetect` in one pass.
///
/// **Why this exists:** `volume: 2.0` is a dimensionless multiplier. It says nothing about how
/// loud a clip will be, so every check written against it is measuring the author's arithmetic
/// rather than the mix. Measured once here, the level of a bed under a voice becomes a
/// difference between two numbers in the same unit.
///
/// Both filters run in one graph — `ebur128` passes its audio through — so this costs one
/// decode rather than two.
pub fn probe_loudness(path: &str) -> Result<AssetLoudness, ProbeError> {
    let output = bay_paths::tools::command(bay_paths::tools::Tool::Ffmpeg)
        .map_err(|missing| ProbeError::Unavailable(missing.detail()))?
        .args([
            "-nostdin",
            "-hide_banner",
            "-i",
            path,
            "-af",
            "ebur128=peak=true,volumedetect",
            "-f",
            "null",
            "-",
        ])
        .output()
        .map_err(|error| ProbeError::Unavailable(format!("could not run ffmpeg: {error}")))?;
    if !output.status.success() {
        return Err(ProbeError::Malformed(format!(
            "ffmpeg could not measure the loudness of {path}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    // Both filters report on stderr, which is where ffmpeg puts everything that is not the
    // encoded stream.
    parse_loudness(&String::from_utf8_lossy(&output.stderr))
}

/// Turn one `ebur128,volumedetect` run into [`AssetLoudness`].
///
/// Split out so the parsing — including the accent detection, which is the only part with any
/// judgement in it — is testable on a machine with no ffmpeg, against output captured from a
/// real run.
pub fn parse_loudness(text: &str) -> Result<AssetLoudness, ProbeError> {
    let mut integrated: Option<f32> = None;
    let mut true_peak: Option<f32> = None;
    let mut mean_volume: Option<f32> = None;
    let mut max_volume: Option<f32> = None;
    // The summary prints `I:` under "Integrated loudness" and `Peak:` under "True peak"; the
    // per-frame lines carry their own `I:`, so only the last one read wins either way.
    let mut section = "";
    let mut frames: Vec<(f64, f32)> = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Integrated loudness") {
            section = "integrated";
        } else if trimmed.starts_with("Loudness range") {
            section = "range";
        } else if trimmed.starts_with("True peak") {
            section = "peak";
        }

        if let Some(t) = field(trimmed, "t:")
            && let Some(peak) = field(trimmed, "FTPK:")
        {
            frames.push((t as f64, peak));
        }
        if let Some(value) = field(trimmed, "mean_volume:") {
            mean_volume = Some(value);
        }
        if let Some(value) = field(trimmed, "max_volume:") {
            max_volume = Some(value);
        }
        // A summary field is a line of its own: `I:  -35.3 LUFS`. The per-frame lines start
        // with `t:`, so requiring the line to *begin* with the key keeps them out.
        if trimmed.starts_with("I:")
            && section == "integrated"
            && let Some(value) = field(trimmed, "I:")
        {
            integrated = Some(value);
        }
        if trimmed.starts_with("Peak:")
            && section == "peak"
            && let Some(value) = field(trimmed, "Peak:")
        {
            true_peak = Some(value);
        }
    }

    let Some(lufs) = integrated else {
        return Err(ProbeError::Malformed(
            "ffmpeg reported no integrated loudness — the file has no audio stream".into(),
        ));
    };
    // Sample peak when volumedetect ran, true peak otherwise: the two differ by under a dB on
    // anything that is not already clipping, and one of them is always present.
    let peak_db = max_volume.or(true_peak).unwrap_or(0.0);
    // `volumedetect` is the only mean there is; without it, fall back to the integrated
    // loudness, which is a mean of a different weighting rather than a fabrication.
    let rms_db = mean_volume.unwrap_or(lufs);

    Ok(AssetLoudness {
        peak_db,
        rms_db,
        lufs,
        accent_seconds: accents(&frames),
    })
}

/// A number labelled `key` on an ffmpeg report line, e.g. `FTPK: -30.7 -30.7 dBFS`.
///
/// Takes the first value after the key, which for the two-channel peak fields is the left
/// channel — the channels of a peak field differ only on a hard-panned transient, and a
/// per-channel accent list would report the same event twice.
fn field(line: &str, key: &str) -> Option<f32> {
    let rest = line.split(key).nth(1)?.trim_start();
    let token: String = rest
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '-' || *c == '+' || *c == '.')
        .collect();
    token.parse::<f32>().ok().filter(|v| v.is_finite())
}

/// Where the transients are, from `ebur128`'s per-frame true-peak series.
///
/// Deliberately **not** momentary loudness: `M` is a trailing 400 ms window, so a rise in it
/// lags the event that caused it by up to 400 ms and lands a cut visibly late. The per-frame
/// peak has no window at all, and validating this against a synthetic pulse train recovers the
/// grid to the frame.
///
/// The first [`ACCENT_HISTORY`] frames carry no history and cannot produce an accent — a file
/// that opens on its loudest hit reports its first accent later than it happened, which is why
/// this is offered as a hint rather than as a grid.
fn accents(frames: &[(f64, f32)]) -> Vec<f64> {
    let mut out: Vec<f64> = Vec::new();
    for index in ACCENT_HISTORY..frames.len() {
        let (at, peak) = frames[index];
        if peak < ACCENT_FLOOR_DB {
            continue;
        }
        let mut history: Vec<f32> = frames[index - ACCENT_HISTORY..index]
            .iter()
            .map(|(_, p)| *p)
            .collect();
        history.sort_by(f32::total_cmp);
        let floor = history[history.len() / 2];
        if peak - floor < ACCENT_RISE_DB {
            continue;
        }
        // The line is stamped with the frame's end; the transient is inside the frame.
        let onset = (at - EBUR128_FRAME_SECONDS).max(0.0);
        if out
            .last()
            .is_some_and(|last| onset - last < ACCENT_MIN_GAP_SECONDS)
        {
            continue;
        }
        out.push((onset * 1000.0).round() / 1000.0);
    }
    out
}

#[cfg(test)]
mod shot_tests {
    use super::*;

    /// Real `metadata=print` output, in the shape ffmpeg actually emits it.
    const OUTPUT: &str = "\
frame:0    pts:0        pts_time:0
lavfi.scene_score=0.512000
frame:74   pts:74074    pts_time:2.46914
lavfi.scene_score=0.401000
frame:181  pts:181181   pts_time:6.03937
lavfi.scene_score=0.388000
";

    #[test]
    fn cuts_become_the_stretches_between_them() {
        let shots = shots_from_metadata(OUTPUT, 10.0, 0.0);
        assert_eq!(
            shots,
            vec![
                Shot {
                    start_seconds: 0.0,
                    end_seconds: 2.46914
                },
                Shot {
                    start_seconds: 2.46914,
                    end_seconds: 6.03937
                },
                Shot {
                    start_seconds: 6.03937,
                    end_seconds: 10.0
                },
            ]
        );
    }

    /// A file with no cuts in it is one shot, not zero. Returning nothing would read as "this
    /// file has no footage".
    #[test]
    fn a_file_with_no_cuts_is_one_shot() {
        let shots = shots_from_metadata("", 8.0, 0.0);
        assert_eq!(
            shots,
            vec![Shot {
                start_seconds: 0.0,
                end_seconds: 8.0
            }]
        );
    }

    /// A strobe or a flash cut fires the detector every few frames. Folding the short ones in
    /// is the difference between a usable list and forty entries nobody asked for.
    #[test]
    fn shots_shorter_than_the_floor_are_folded_in() {
        let strobe = "\
pts_time:1.0
pts_time:1.05
pts_time:1.1
pts_time:5.0
";
        let shots = shots_from_metadata(strobe, 8.0, 0.5);
        assert_eq!(
            shots,
            vec![
                Shot {
                    start_seconds: 0.0,
                    end_seconds: 1.0
                },
                Shot {
                    start_seconds: 1.0,
                    end_seconds: 5.0
                },
                Shot {
                    start_seconds: 5.0,
                    end_seconds: 8.0
                },
            ],
            "the three-frame strobe is one boundary, not three"
        );
    }

    /// A cut reported at or past the end of the file would produce a zero-length trailing
    /// shot, which is not a shot.
    #[test]
    fn a_cut_past_the_end_is_ignored() {
        let shots = shots_from_metadata("pts_time:2.0\npts_time:99.0\n", 5.0, 0.0);
        assert_eq!(shots.len(), 2);
        assert_eq!(shots.last().unwrap().end_seconds, 5.0);
    }

    /// An unknown duration (a stream ffprobe could not measure) still yields the shots between
    /// the cuts it did find, rather than nothing at all.
    #[test]
    fn an_unknown_duration_still_produces_shots() {
        let shots = shots_from_metadata(OUTPUT, 0.0, 0.0);
        assert_eq!(shots.len(), 2);
        assert_eq!(shots.last().unwrap().end_seconds, 6.03937);
    }

    #[test]
    fn garbage_in_the_output_is_skipped_not_parsed() {
        let shots = shots_from_metadata("pts_time:not-a-number\npts_time:3.0\n", 6.0, 0.0);
        assert_eq!(shots.len(), 2);
        assert_eq!(shots[0].end_seconds, 3.0);
    }
}

#[cfg(test)]
mod loudness_tests {
    use super::*;

    /// Real output, captured from `ffmpeg -af ebur128=peak=true,volumedetect` over a 1.7 s
    /// 220 Hz tone pulsed every 500 ms. Kept verbatim — including the interleaved encoder
    /// metadata ffmpeg prints in the middle of the frame lines — because every field this
    /// parser reads is one ffmpeg chose the spelling of.
    const OUTPUT: &str = r#"[Parsed_ebur128_0 @ 0x8f9048900] t: 0.0999773  TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU  FTPK: -18.1 dBFS  TPK: -18.1 dBFS
    Metadata:
      encoder         : Lavc62.28.102 pcm_s16le
[Parsed_ebur128_0 @ 0x8f9048900] t: 0.199977   TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU  FTPK: -45.2 dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 0x8f9048900] t: 0.299977   TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU  FTPK: -51.8 dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 0x8f9048900] t: 0.399977   TARGET:-23 LUFS    M: -33.6 S:-120.7     I: -33.6 LUFS       LRA:   0.0 LU  FTPK: -52.0 dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 0x8f9048900] t: 0.499977   TARGET:-23 LUFS    M: -54.9 S:-120.7     I: -33.6 LUFS       LRA:   0.0 LU  FTPK: -52.0 dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 0x8f9048900] t: 0.599977   TARGET:-23 LUFS    M: -37.2 S:-120.7     I: -35.0 LUFS       LRA:   0.0 LU  FTPK: -21.7 dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 0x8f9048900] t: 0.699977   TARGET:-23 LUFS    M: -37.2 S:-120.7     I: -35.6 LUFS       LRA:   0.0 LU  FTPK: -42.6 dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 0x8f9048900] t: 0.799977   TARGET:-23 LUFS    M: -37.2 S:-120.7     I: -36.0 LUFS       LRA:   0.0 LU  FTPK: -51.9 dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 0x8f9048900] t: 0.899977   TARGET:-23 LUFS    M: -37.2 S:-120.7     I: -36.2 LUFS       LRA:   0.0 LU  FTPK: -52.0 dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 0x8f9048900] t: 0.999977   TARGET:-23 LUFS    M: -54.9 S:-120.7     I: -36.2 LUFS       LRA:   0.0 LU  FTPK: -52.0 dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 0x8f9048900] t: 1.099977   TARGET:-23 LUFS    M: -40.6 S:-120.7     I: -36.7 LUFS       LRA:   0.0 LU  FTPK: -24.4 dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 0x8f9048900] t: 1.199977   TARGET:-23 LUFS    M: -40.6 S:-120.7     I: -37.1 LUFS       LRA:   0.0 LU  FTPK: -44.9 dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 0x8f9048900] t: 1.299977   TARGET:-23 LUFS    M: -40.6 S:-120.7     I: -37.4 LUFS       LRA:   0.0 LU  FTPK: -51.8 dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 0x8f9048900] t: 1.399977   TARGET:-23 LUFS    M: -40.6 S:-120.7     I: -37.6 LUFS       LRA:   0.0 LU  FTPK: -52.0 dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 0x8f9048900] t: 1.499977   TARGET:-23 LUFS    M: -54.9 S:-120.7     I: -37.6 LUFS       LRA:   0.0 LU  FTPK: -52.0 dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 0x8f9048900] t: 1.599977   TARGET:-23 LUFS    M: -36.7 S:-120.7     I: -37.5 LUFS       LRA:   0.0 LU  FTPK: -21.2 dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 0x8f9048900] t: 1.699977   TARGET:-23 LUFS    M: -36.6 S:-120.7     I: -37.4 LUFS       LRA:   0.0 LU  FTPK: -42.3 dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 0x8f9048900] Summary:

  Integrated loudness:
    I:         -37.4 LUFS
    Threshold: -48.5 LUFS

  Loudness range:
    LRA:         0.0 LU
    Threshold:   0.0 LUFS
    LRA low:     0.0 LUFS
    LRA high:    0.0 LUFS

  True peak:
    Peak:      -18.1 dBFS
[Parsed_volumedetect_1 @ 0x8f90489c0] mean_volume: -35.7 dB
[Parsed_volumedetect_1 @ 0x8f90489c0] max_volume: -18.1 dB
"#;

    #[test]
    fn the_summary_fields_come_back_in_their_own_units() {
        let measured = parse_loudness(OUTPUT).expect("a file with audio");
        assert_eq!(measured.lufs, -37.4);
        assert_eq!(measured.peak_db, -18.1, "sample peak, from volumedetect");
        assert_eq!(measured.rms_db, -35.7);
        assert!(measured.is_audible());
    }

    /// The per-frame lines carry their own running `I:`, and reading one of those as the
    /// summary would report a file's loudness as whatever it happened to be one tenth of a
    /// second in — `-70.0` here, 32.6 LU off.
    #[test]
    fn a_running_frame_value_is_not_mistaken_for_the_summary() {
        assert_eq!(parse_loudness(OUTPUT).expect("parsed").lufs, -37.4);
    }

    /// The pulses are at 0.5, 1.0 and 1.5 s and that is what comes back — the detector runs on
    /// the per-frame peak, which has no window to lag behind.
    #[test]
    fn the_accents_land_on_the_pulses() {
        let measured = parse_loudness(OUTPUT).expect("parsed");
        assert_eq!(measured.accent_seconds, vec![0.5, 1.0, 1.5]);
    }

    /// The decay after a hit is a rise off a very low floor and would otherwise report a
    /// second accent 100 ms after the first.
    #[test]
    fn one_transient_is_one_accent() {
        let measured = parse_loudness(OUTPUT).expect("parsed");
        for pair in measured.accent_seconds.windows(2) {
            assert!(
                pair[1] - pair[0] >= ACCENT_MIN_GAP_SECONDS,
                "{:?} reports the same hit twice",
                measured.accent_seconds
            );
        }
    }

    /// A sustained level with no transients has no accents. A detector that finds a grid in a
    /// pad is worse than one that finds nothing, because the agent will cut to it.
    #[test]
    fn a_flat_pad_has_no_accents() {
        let mut text = String::new();
        for frame in 1..40 {
            text.push_str(&format!(
                "[Parsed_ebur128_0 @ 0x1] t: {:.6}  TARGET:-23 LUFS    M: -20.0 S: -20.0     I: -20.0 LUFS       LRA:   0.0 LU  FTPK: -12.{} dBFS  TPK: -12.0 dBFS\n",
                frame as f64 / 10.0,
                frame % 5,
            ));
        }
        text.push_str("  Integrated loudness:\n    I:         -20.0 LUFS\n");
        let measured = parse_loudness(&text).expect("parsed");
        assert!(
            measured.accent_seconds.is_empty(),
            "{:?}",
            measured.accent_seconds
        );
    }

    /// A file with no audio stream produces no `I:` at all. That is a refusal, not a silent
    /// zero — a zero would place a bed 35 dB louder than it is.
    #[test]
    fn a_file_with_no_audio_is_an_error_not_a_zero() {
        assert!(matches!(
            parse_loudness("Stream #0:0: Video: h264\n"),
            Err(ProbeError::Malformed(_))
        ));
    }

    /// `volumedetect` is optional: without it the mean falls back to the integrated loudness
    /// and the peak to the true peak, rather than to a fabricated 0 dBFS.
    #[test]
    fn a_run_without_volumedetect_still_measures() {
        let text = "  Integrated loudness:\n    I:         -14.0 LUFS\n\n  True peak:\n    Peak:       -1.2 dBFS\n";
        let measured = parse_loudness(text).expect("parsed");
        assert_eq!(measured.lufs, -14.0);
        assert_eq!(measured.peak_db, -1.2);
        assert_eq!(measured.rms_db, -14.0);
    }

    /// Digital silence measures `-70.0`, which is ffmpeg's floor rather than a level. Every
    /// check that compares two stems has to know the difference.
    #[test]
    fn the_floor_is_not_a_measurement() {
        let text = "  Integrated loudness:\n    I:         -70.0 LUFS\n";
        assert!(!parse_loudness(text).expect("parsed").is_audible());
    }
}
