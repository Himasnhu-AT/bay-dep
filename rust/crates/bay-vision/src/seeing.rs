//! Shot-level semantic indexing and local subject tracking.
//!
//! A shot is the useful semantic unit: one midpoint frame avoids near-duplicate embeddings while
//! retaining source ranges an editor can cut directly. Tracking samples more frequently because
//! camera motion is a temporal signal, then smooths detections before they become crop keyframes.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use image::{DynamicImage, GenericImageView, Pixel};

use crate::{Embedding, Encoder, VisionError, cosine};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ShotRange {
    pub start_seconds: f64,
    pub end_seconds: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct IndexedShot {
    pub range: ShotRange,
    pub sample_seconds: f64,
    pub embedding: Embedding,
}

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

/// Embed one representative frame per detected shot.
pub fn index_shots(
    encoder: &Encoder,
    media_path: &str,
    shots: &[ShotRange],
) -> Result<Vec<IndexedShot>, VisionError> {
    if shots.is_empty() {
        return Err(VisionError::Empty);
    }
    let temp = FrameTemp::new()?;
    let mut paths = Vec::with_capacity(shots.len());
    let mut samples = Vec::with_capacity(shots.len());
    for (index, shot) in shots.iter().enumerate() {
        let sample = (shot.start_seconds + shot.end_seconds) * 0.5;
        let path = temp.path.join(format!("shot-{index:05}.png"));
        extract_frame(media_path, sample, &path, 512)?;
        paths.push(path);
        samples.push(sample);
    }
    let embeddings = encoder.embed_images(&paths)?;
    Ok(shots
        .iter()
        .copied()
        .zip(samples)
        .zip(embeddings)
        .map(|((range, sample_seconds), embedding)| IndexedShot {
            range,
            sample_seconds,
            embedding,
        })
        .collect())
}

/// Rank persisted shot embeddings for a text query.
pub fn search_shots(
    encoder: &Encoder,
    query: &str,
    shots: &[IndexedShot],
) -> Result<Vec<(f32, IndexedShot)>, VisionError> {
    let query_embedding = encoder.embed_text(&[query.to_string()])?;
    let mut matches = shots
        .iter()
        .cloned()
        .map(|shot| (cosine(&query_embedding[0], &shot.embedding), shot))
        .collect::<Vec<_>>();
    matches.sort_by(|a, b| b.0.total_cmp(&a.0));
    Ok(matches)
}

/// Track the most face-like subject in locally extracted frames, then exponentially dampen the
/// path. Detection deliberately uses a skin-colour + spatial-coherence heuristic rather than a
/// second ML model: SigLIP remains bay's only vision model and the fallback works without a new
/// provisioned artifact.
pub fn track_subject(
    media_path: &str,
    start_seconds: f64,
    end_seconds: f64,
    config: TrackingConfig,
) -> Result<Vec<SubjectPoint>, VisionError> {
    let interval = config.sample_seconds.clamp(0.1, 5.0);
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
    if times.is_empty() {
        times.push(start);
    }

    let temp = FrameTemp::new()?;
    let mut raw = Vec::with_capacity(times.len());
    for (index, time) in times.iter().copied().enumerate() {
        let path = temp.path.join(format!("track-{index:05}.png"));
        extract_frame(media_path, time, &path, 320)?;
        let image = image::open(&path).map_err(|error| VisionError::Image {
            path,
            detail: error.to_string(),
        })?;
        raw.push((time, detect_subject(&image)));
    }

    Ok(smooth_path(raw, config.smoothing_seconds, &[]))
}

/// Localise the subject by ranking overlapping crop candidates with the same SigLIP model used
/// for semantic search, using a lightweight appearance centroid only as a spatial prior. This
/// avoids adding a second model while preventing a crop that merely clips a recognised person
/// from beating one that actually centers them.
pub fn track_subject_siglip(
    encoder: &Encoder,
    media_path: &str,
    start_seconds: f64,
    end_seconds: f64,
    config: ReframeTrackingConfig<'_>,
) -> Result<Vec<SubjectPoint>, VisionError> {
    if config.target_aspect >= config.source_aspect {
        return track_subject(media_path, start_seconds, end_seconds, config.tracking);
    }
    let interval = config.tracking.sample_seconds.clamp(0.1, 5.0);
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

    const CANDIDATES: usize = 7;
    let kept = (config.target_aspect / config.source_aspect).clamp(0.05, 1.0);
    let min_center = kept * 0.5;
    let max_center = 1.0 - min_center;
    let temp = FrameTemp::new()?;
    let mut candidate_paths = Vec::with_capacity(times.len() * CANDIDATES);
    let mut appearance_scores = Vec::with_capacity(times.len() * CANDIDATES);
    let mut centers = Vec::with_capacity(CANDIDATES);
    for candidate in 0..CANDIDATES {
        centers.push(
            min_center + (max_center - min_center) * candidate as f32 / (CANDIDATES - 1) as f32,
        );
    }
    for (frame_index, time) in times.iter().copied().enumerate() {
        let full_path = temp.path.join(format!("full-{frame_index:05}.png"));
        extract_frame(media_path, time, &full_path, 512)?;
        let image = image::open(&full_path).map_err(|error| VisionError::Image {
            path: full_path,
            detail: error.to_string(),
        })?;
        let (width, height) = image.dimensions();
        let (appearance_x, _, appearance_confidence) = detect_subject(&image);
        let crop_width = ((width as f32 * kept).round() as u32).clamp(1, width);
        for (candidate, center) in centers.iter().copied().enumerate() {
            let left = ((center * width as f32 - crop_width as f32 * 0.5).round() as i64)
                .clamp(0, i64::from(width - crop_width)) as u32;
            let crop = image.crop_imm(left, 0, crop_width, height);
            let path = temp
                .path
                .join(format!("candidate-{frame_index:05}-{candidate}.png"));
            crop.save(&path).map_err(|error| VisionError::Image {
                path: path.clone(),
                detail: error.to_string(),
            })?;
            candidate_paths.push(path);
            let centeredness =
                (1.0 - (center - appearance_x).abs() / (kept * 0.5).max(0.01)).clamp(-1.0, 1.0);
            appearance_scores.push(appearance_confidence * centeredness);
        }
    }
    let images = encoder.embed_images(&candidate_paths)?;
    let text = encoder.embed_text(&[
        "a centered portrait showing a person's entire face and shoulders".to_string(),
        "an empty room with no people and no face".to_string(),
        "a wall and furniture with nobody visible".to_string(),
    ])?;
    let scores = (0..times.len())
        .map(|frame_index| {
            images[frame_index * CANDIDATES..(frame_index + 1) * CANDIDATES]
                .iter()
                // A relative face-vs-empty-room score, not an absolute SigLIP threshold. The
                // subtraction prevents a warm wall or chair from winning simply because every
                // narrow crop scores weakly against the positive phrase.
                .enumerate()
                .map(|(candidate, image)| {
                    cosine(&text[0], image)
                        - (cosine(&text[1], image) + cosine(&text[2], image)) * 0.5
                        + appearance_scores[frame_index * CANDIDATES + candidate] * 0.35
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    let mut choices = vec![0usize; times.len()];
    let mut segment_start = 0usize;
    while segment_start < times.len() {
        let segment_end = config
            .shot_boundaries
            .iter()
            .filter(|boundary| **boundary > times[segment_start] + 0.01)
            .filter_map(|boundary| times.iter().position(|time| *time >= *boundary))
            .min()
            .unwrap_or(times.len());
        viterbi_choices(
            &scores[segment_start..segment_end],
            &mut choices[segment_start..segment_end],
        );
        segment_start = segment_end.max(segment_start + 1);
    }
    let raw = times
        .into_iter()
        .enumerate()
        .map(|(frame_index, time)| {
            let mut ranked = scores[frame_index].clone();
            ranked.sort_by(f32::total_cmp);
            let chosen = choices[frame_index];
            let separation = scores[frame_index][chosen] - ranked[ranked.len() / 2];
            (time, (centers[chosen], 0.5, separation.max(0.0)))
        })
        .collect();
    Ok(smooth_path(
        raw,
        config.tracking.smoothing_seconds,
        config.shot_boundaries,
    ))
}

fn smooth_path(
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

/// Pick a temporally coherent candidate sequence. A one-column change must improve the SigLIP
/// score enough to pay for the move; shot boundaries split the optimisation and allow hard cuts.
fn viterbi_choices(scores: &[Vec<f32>], choices: &mut [usize]) {
    if scores.is_empty() {
        return;
    }
    let candidates = scores[0].len();
    let mut costs = scores[0].clone();
    let mut back = vec![vec![0usize; candidates]; scores.len()];
    for frame in 1..scores.len() {
        let mut next = vec![f32::NEG_INFINITY; candidates];
        for candidate in 0..candidates {
            for (previous, previous_cost) in costs.iter().copied().enumerate() {
                let movement = candidate.abs_diff(previous) as f32;
                let value = previous_cost + scores[frame][candidate] - 0.018 * movement;
                if value > next[candidate] {
                    next[candidate] = value;
                    back[frame][candidate] = previous;
                }
            }
        }
        costs = next;
    }
    let mut candidate = costs
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .map(|(index, _)| index)
        .unwrap_or(candidates / 2);
    for frame in (0..scores.len()).rev() {
        choices[frame] = candidate;
        candidate = back[frame][candidate];
    }
}

/// Total absolute second derivative, a compact numeric measure of camera-path jitter.
pub fn path_jitter(values: &[f32]) -> f32 {
    values
        .windows(3)
        .map(|window| (window[2] - 2.0 * window[1] + window[0]).abs())
        .sum()
}

fn detect_subject(image: &DynamicImage) -> (f32, f32, f32) {
    const COLS: usize = 32;
    const ROWS: usize = 24;
    let (width, height) = image.dimensions();
    let mut bins = [[0u32; COLS]; ROWS];
    let mut total = 0u32;
    for y in (0..height.saturating_mul(9) / 10).step_by(2) {
        for x in (0..width).step_by(2) {
            let rgb = image.get_pixel(x, y).to_rgb();
            let [r, g, b] = rgb.0;
            let max = r.max(g).max(b);
            let min = r.min(g).min(b);
            let skin = r > 55
                && g > 35
                && b > 20
                && max.saturating_sub(min) > 15
                && r > g
                && r > b
                && r.abs_diff(g) > 5;
            if skin {
                let col = ((x as usize * COLS) / width.max(1) as usize).min(COLS - 1);
                let row = ((y as usize * ROWS) / height.max(1) as usize).min(ROWS - 1);
                bins[row][col] += 1;
                total += 1;
            }
        }
    }
    if total < 20 {
        return (0.5, 0.42, 0.0);
    }

    let mut best = (0usize, 0usize, 0u32);
    for row in 0..ROWS {
        for col in 0..COLS {
            let mut score = 0u32;
            for nearby_row in bins
                .iter()
                .take((row + 2).min(ROWS - 1) + 1)
                .skip(row.saturating_sub(2))
            {
                score += nearby_row
                    .iter()
                    .take((col + 2).min(COLS - 1) + 1)
                    .skip(col.saturating_sub(2))
                    .sum::<u32>();
            }
            if score > best.2 {
                best = (col, row, score);
            }
        }
    }
    (
        (best.0 as f32 + 0.5) / COLS as f32,
        (best.1 as f32 + 0.5) / ROWS as f32,
        (best.2 as f32 / total as f32).clamp(0.0, 1.0),
    )
}

fn extract_frame(
    media_path: &str,
    seconds: f64,
    output_path: &Path,
    width: u32,
) -> Result<(), VisionError> {
    let output = bay_paths::tools::command(bay_paths::tools::Tool::Ffmpeg)
        .map_err(|missing| VisionError::Encode(missing.detail()))?
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
        .map_err(|error| VisionError::Encode(error.to_string()))?;
    if !output.status.success() || !output_path.is_file() {
        return Err(VisionError::Encode(format!(
            "could not extract a frame at {seconds:.3}s from {media_path}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(())
}

struct FrameTemp {
    path: PathBuf,
}

impl FrameTemp {
    fn new() -> Result<Self, VisionError> {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("bay-seeing-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&path).map_err(|error| VisionError::Encode(error.to_string()))?;
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

    #[test]
    fn temporal_ranking_refuses_a_one_frame_candidate_jump() {
        let scores = vec![
            vec![0.20, 0.10, 0.05],
            vec![0.19, 0.10, 0.21],
            vec![0.20, 0.10, 0.05],
        ];
        let mut choices = vec![usize::MAX; scores.len()];
        viterbi_choices(&scores, &mut choices);
        assert_eq!(choices, vec![0, 0, 0]);
    }

    #[test]
    fn uniform_frame_falls_back_to_safe_composition() {
        let image = DynamicImage::new_rgb8(320, 180);
        assert_eq!(detect_subject(&image), (0.5, 0.42, 0.0));
    }
}
