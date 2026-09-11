//! Sampling a video and detecting in each frame.
//!
//! Frames come out through ffmpeg, the way every other decode in bay does, so a machine without
//! it gets the same message here as everywhere else rather than a second explanation of the same
//! missing tool.

use std::path::{Path, PathBuf};

use crate::{DetectError, Frame, Want};

/// Width the extracted stills are scaled to before Vision sees them.
///
/// Vision downsamples internally anyway, and a face that survives 640 px survives 4K. Extracting
/// at source resolution on an hour of 4K rushes is minutes of ffmpeg for boxes that do not move.
const SAMPLE_WIDTH: u32 = 640;

/// Detect in a video at each of `times` (seconds into the media).
///
/// Frames where nothing is found come back present and empty rather than missing, so a caller can
/// see *where* detection failed — a gap in the middle of a shot is a subject turning away, and a
/// gap covering the whole range is a detector that is not working.
pub fn detect_frames(media: &str, times: &[f64], want: Want) -> Result<Vec<Frame>, DetectError> {
    detect_frames_reporting(media, times, want, &mut |_, _| {})
}

/// [`detect_frames`], reporting `(done, total)` as it goes.
///
/// A scan is one ffmpeg invocation per sample, so a long range is minutes of work. A job that
/// shows nothing for two minutes is indistinguishable from a job that has hung, which is why the
/// callback exists rather than being something a caller could add later.
pub fn detect_frames_reporting(
    media: &str,
    times: &[f64],
    want: Want,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<Vec<Frame>, DetectError> {
    if !crate::available() {
        return Err(DetectError::Unavailable(
            crate::unavailable_reason().unwrap_or_default(),
        ));
    }
    if times.is_empty() {
        return Ok(Vec::new());
    }
    let temp = FrameTemp::new()?;
    let mut frames = Vec::with_capacity(times.len());
    for (index, time) in times.iter().enumerate() {
        let still = temp.path.join(format!("detect-{index:05}.png"));
        extract_frame(media, *time, &still, SAMPLE_WIDTH)?;
        let detections = crate::detect_image(&still, want)?;
        // The still is deleted as we go. A whole episode sampled every half second is seven
        // thousand PNGs, and holding them all until the scan finishes is gigabytes of scratch
        // for pictures nothing reads twice.
        let _ = std::fs::remove_file(&still);
        frames.push(Frame {
            time_seconds: *time,
            detections,
        });
        progress(index + 1, times.len());
    }
    Ok(frames)
}

/// Evenly spaced sample times across a range, inclusive of the end.
///
/// Shared so that a caller does not have to reproduce the off-by-one at the tail: a range that
/// does not divide evenly still gets its final moment looked at.
pub fn sample_times(start_seconds: f64, end_seconds: f64, every: f64) -> Vec<f64> {
    let interval = every.clamp(0.05, 10.0);
    let start = start_seconds.max(0.0);
    let end = end_seconds.max(start);
    let mut times = Vec::new();
    let mut time = start;
    while time < end {
        times.push(time);
        time += interval;
    }
    if times.last().is_none_or(|last| end - last > 0.05) {
        times.push(end);
    }
    times
}

fn extract_frame(
    media_path: &str,
    seconds: f64,
    output_path: &Path,
    width: u32,
) -> Result<(), DetectError> {
    let output = bay_paths::tools::command(bay_paths::tools::Tool::Ffmpeg)
        .map_err(|missing| DetectError::Extract(missing.detail()))?
        .args([
            "-nostdin",
            "-v",
            "error",
            "-ss",
            &format!("{:.6}", seconds.max(0.0)),
            "-i",
            media_path,
            "-frames:v",
            "1",
            "-vf",
            &format!("scale={width}:-2"),
            "-y",
        ])
        .arg(output_path)
        .output()
        .map_err(|error| DetectError::Extract(error.to_string()))?;
    if !output.status.success() || !output_path.is_file() {
        return Err(DetectError::Extract(format!(
            "could not extract a frame at {seconds:.3}s from {media_path}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(())
}

/// A scratch directory unique to this process *and* this scan, removed on drop.
///
/// Both halves of the key are load-bearing, and the second was learned the hard way. The pid
/// separates processes; the counter separates concurrent scans **inside** one. Keyed by pid and a
/// nanosecond clock alone, two scans on two threads read the same nanosecond, landed in the same
/// directory, and the first to finish deleted the frames the second was still reading — ffmpeg
/// reporting `Could not open file: .../detect-00003.png` in the middle of a scan that had been
/// working. Same shape as the registry scratch directory keyed by test name with no pid, and it
/// is why this is a counter and not a finer clock: a clock is a guess about granularity, and a
/// counter is not a guess.
struct FrameTemp {
    path: PathBuf,
}

impl FrameTemp {
    fn new() -> Result<Self, DetectError> {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let ticket = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("bay-detect-{}-{ticket}", std::process::id()));
        std::fs::create_dir_all(&path).map_err(|error| DetectError::Extract(error.to_string()))?;
        Ok(Self { path })
    }
}

impl Drop for FrameTemp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The tail must be looked at even when the interval does not divide the range, or the last
    /// second of every clip is untracked.
    #[test]
    fn the_end_of_a_range_is_always_sampled() {
        let times = sample_times(0.0, 2.2, 0.5);
        assert_eq!(times.first().copied(), Some(0.0));
        assert!((times.last().copied().unwrap() - 2.2).abs() < 1e-9);
    }

    /// An interval that divides evenly must not sample the end twice — a duplicate time is a
    /// duplicate keyframe at the same instant, which `AnimationChannel::upsert` would collapse
    /// silently but is still a wasted decode.
    #[test]
    fn an_even_range_does_not_sample_the_end_twice() {
        let times = sample_times(0.0, 2.0, 0.5);
        assert_eq!(times, vec![0.0, 0.5, 1.0, 1.5, 2.0]);
    }

    /// A zero-length range is one sample, not zero and not an infinite loop.
    #[test]
    fn a_zero_length_range_yields_one_sample() {
        assert_eq!(sample_times(4.0, 4.0, 0.5), vec![4.0]);
    }

    /// Two scratch directories in the same process must not collide, **including when they are
    /// created at the same instant on different threads** — which is the case that actually
    /// happened. The sequential version of this test passed against the bug: two calls a
    /// microsecond apart get different nanosecond stamps, and two calls on two threads did not.
    #[test]
    fn concurrent_scratch_directories_do_not_collide() {
        const THREADS: usize = 16;
        let barrier = std::sync::Barrier::new(THREADS);
        let paths: Vec<PathBuf> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..THREADS)
                .map(|_| {
                    let barrier = &barrier;
                    scope.spawn(move || {
                        // Start together, so the clock is as close to identical as it can be.
                        barrier.wait();
                        FrameTemp::new().expect("temp dir").path.clone()
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.join().expect("thread"))
                .collect()
        });
        let unique: std::collections::BTreeSet<_> = paths.iter().collect();
        assert_eq!(
            unique.len(),
            THREADS,
            "two concurrent scans shared a scratch directory, so one would delete the other's \
             frames mid-scan: {paths:?}"
        );
    }
}
