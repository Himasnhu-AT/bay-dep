use std::{
    fs,
    path::{Path, PathBuf},
};

use bay_vision::{Embedding, Encoder, cosine};
use image::RgbImage;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{BeatGrid, GenError, GenerationKind, GenerationRequest};

const MIN_PROMPT_SEPARATION: f32 = 0.05;
const CONTROL_DESCRIPTIONS: [&str; 4] = [
    "an unrelated generic image",
    "a blank or empty frame",
    "a screenshot dominated by text",
    "distorted incoherent artificial imagery",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityFinding {
    pub code: String,
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityReport {
    pub accepted: bool,
    pub artifact_path: PathBuf,
    pub artifact_sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_score: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_separation: Option<f32>,
    #[serde(default)]
    pub findings: Vec<QualityFinding>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub beat_grid: Option<BeatGrid>,
    /// Physics/permanence remains a critic judgment. This flag routes the asset through the
    /// existing project critic after placement instead of inventing a second critic state.
    #[serde(default)]
    pub critic_required: bool,
}

pub trait ArtifactGate: Send + Sync {
    fn preflight(&self, kind: GenerationKind) -> Result<(), GenError>;
    fn evaluate(&self, request: &GenerationRequest, path: &Path)
    -> Result<QualityReport, GenError>;
}

trait ImageTextEmbedder: Send + Sync {
    fn image(&self, path: &Path) -> Result<Embedding, GenError>;
    fn texts(&self, texts: &[String]) -> Result<Vec<Embedding>, GenError>;
}

struct VisionEmbedder {
    encoder: Encoder,
}

impl ImageTextEmbedder for VisionEmbedder {
    fn image(&self, path: &Path) -> Result<Embedding, GenError> {
        self.encoder
            .embed_images(&[path.to_path_buf()])
            .map_err(|error| GenError::QualityUnavailable(error.to_string()))?
            .into_iter()
            .next()
            .ok_or_else(|| {
                GenError::QualityUnavailable("SigLIP returned no image embedding".into())
            })
    }

    fn texts(&self, texts: &[String]) -> Result<Vec<Embedding>, GenError> {
        self.encoder
            .embed_text(texts)
            .map_err(|error| GenError::QualityUnavailable(error.to_string()))
    }
}

/// SigLIP prompt-adherence plus artifact-measured generated-media checks.
///
/// Absolute SigLIP scores are not calibrated, so the gate follows `bay-vision`'s separation
/// discipline: the requested description must beat a small control set by a useful margin.
pub struct SigLipGate {
    embedder: Box<dyn ImageTextEmbedder>,
}

impl SigLipGate {
    pub fn load() -> Result<Self, GenError> {
        let encoder =
            Encoder::load().map_err(|error| GenError::QualityUnavailable(error.to_string()))?;
        Ok(Self {
            embedder: Box::new(VisionEmbedder { encoder }),
        })
    }

    pub fn load_for(kind: GenerationKind) -> Result<Self, GenError> {
        if kind == GenerationKind::Music {
            return Ok(Self {
                embedder: Box::new(UnusedMusicEmbedder),
            });
        }
        Self::load()
    }

    fn score_images(&self, prompt: &str, paths: &[PathBuf]) -> Result<(f32, f32), GenError> {
        let mut descriptions = Vec::with_capacity(CONTROL_DESCRIPTIONS.len() + 1);
        descriptions.push(prompt.to_string());
        descriptions.extend(CONTROL_DESCRIPTIONS.iter().map(|text| (*text).to_string()));
        let text_embeddings = self.embedder.texts(&descriptions)?;
        if text_embeddings.len() != descriptions.len() {
            return Err(GenError::QualityUnavailable(
                "SigLIP returned an incomplete text embedding batch".into(),
            ));
        }

        let mut prompt_scores = Vec::with_capacity(paths.len());
        let mut separations = Vec::with_capacity(paths.len());
        for path in paths {
            let image = self.embedder.image(path)?;
            let prompt_score = cosine(&image, &text_embeddings[0]);
            let strongest_control = text_embeddings[1..]
                .iter()
                .map(|control| cosine(&image, control))
                .fold(f32::NEG_INFINITY, f32::max);
            prompt_scores.push(prompt_score);
            separations.push(prompt_score - strongest_control);
        }
        let score = prompt_scores.iter().sum::<f32>() / prompt_scores.len().max(1) as f32;
        let separation = separations.iter().copied().fold(f32::INFINITY, f32::min);
        Ok((score, separation))
    }
}

struct UnusedMusicEmbedder;

impl ImageTextEmbedder for UnusedMusicEmbedder {
    fn image(&self, _path: &Path) -> Result<Embedding, GenError> {
        Err(GenError::QualityUnavailable(
            "music verification does not use image embeddings".into(),
        ))
    }

    fn texts(&self, _texts: &[String]) -> Result<Vec<Embedding>, GenError> {
        Err(GenError::QualityUnavailable(
            "music verification does not use text embeddings".into(),
        ))
    }
}

impl ArtifactGate for SigLipGate {
    fn preflight(&self, kind: GenerationKind) -> Result<(), GenError> {
        if matches!(kind, GenerationKind::Video | GenerationKind::Music) {
            bay_paths::tools::ffmpeg().map_err(|_| {
                GenError::QualityUnavailable(
                    "video and music verification needs ffmpeg; runtime_install with component \
                     \"video\" installs bay's pinned build"
                        .into(),
                )
            })?;
        }
        Ok(())
    }

    fn evaluate(
        &self,
        request: &GenerationRequest,
        path: &Path,
    ) -> Result<QualityReport, GenError> {
        let artifact_sha256 = hash_artifact(path)?;
        let mut report = QualityReport {
            accepted: true,
            artifact_path: path.to_path_buf(),
            artifact_sha256,
            prompt_score: None,
            prompt_separation: None,
            findings: Vec::new(),
            beat_grid: None,
            critic_required: matches!(request.kind, GenerationKind::Image | GenerationKind::Video),
        };

        match request.kind {
            GenerationKind::Image => {
                let (score, separation) =
                    self.score_images(&request.prompt, &[path.to_path_buf()])?;
                report.prompt_score = Some(score);
                report.prompt_separation = Some(separation);
                reject_prompt_mismatch(&mut report, separation);
            }
            GenerationKind::Video => {
                let frames = extract_video_frames(path, request.seconds.unwrap_or(4.0))?;
                let paths = frames
                    .iter()
                    .map(|frame| frame.path.clone())
                    .collect::<Vec<_>>();
                let (score, separation) = self.score_images(&request.prompt, &paths)?;
                report.prompt_score = Some(score);
                report.prompt_separation = Some(separation);
                reject_prompt_mismatch(&mut report, separation);
                if peripheral_instability(&frames)? {
                    report.findings.push(QualityFinding {
                        code: "peripheral-instability".into(),
                        severity: "error".into(),
                        message: "edge motion changes far more than the subject region across \
                                  measured frames; reject this clip or generate another seed"
                            .into(),
                    });
                }
            }
            GenerationKind::Music => {
                let beats =
                    bay_audio::beats::detect_file(&path.to_string_lossy()).ok_or_else(|| {
                        GenError::QualityUnavailable(format!(
                            "could not decode generated music at {}",
                            path.display()
                        ))
                    })?;
                let usable = beats.is_usable();
                report.beat_grid = Some(BeatGrid {
                    bpm: beats.bpm,
                    confidence: beats.confidence as f32,
                    beats_seconds: beats.beat_times,
                });
                if !usable {
                    report.findings.push(QualityFinding {
                        code: "unusable-beat-grid".into(),
                        severity: "error".into(),
                        message: format!(
                            "the generated file's measured pulse confidence is {:.3}, below 0.200",
                            beats.confidence
                        ),
                    });
                }
                if let Some(requested) = request.bpm
                    && (beats.bpm - requested).abs() > requested * 0.05
                {
                    report.findings.push(QualityFinding {
                        code: "bpm-mismatch".into(),
                        severity: "error".into(),
                        message: format!(
                            "the file measures {:.2} BPM, outside 5% of the requested {:.2} BPM",
                            beats.bpm, requested
                        ),
                    });
                }
            }
        }
        report.accepted = !report
            .findings
            .iter()
            .any(|finding| finding.severity == "error");
        Ok(report)
    }
}

fn reject_prompt_mismatch(report: &mut QualityReport, separation: f32) {
    if separation < MIN_PROMPT_SEPARATION {
        report.findings.push(QualityFinding {
            code: "prompt-mismatch".into(),
            severity: "error".into(),
            message: format!(
                "SigLIP measured prompt separation {separation:.4}, below the required \
                 {MIN_PROMPT_SEPARATION:.4}; reject this artifact or generate another seed"
            ),
        });
    }
}

struct SampledFrame {
    path: PathBuf,
    _directory: tempfile::TempDir,
}

fn extract_video_frames(path: &Path, seconds: f64) -> Result<Vec<SampledFrame>, GenError> {
    let samples = [
        0.1_f64.min(seconds / 4.0),
        seconds / 2.0,
        (seconds - 0.1).max(0.0),
    ];
    let ffmpeg = bay_paths::tools::ffmpeg().map_err(|error| {
        GenError::QualityUnavailable(format!("could not resolve ffmpeg: {error}"))
    })?;
    let mut frames = Vec::with_capacity(samples.len());
    for (index, at) in samples.into_iter().enumerate() {
        let directory = tempfile::tempdir().map_err(|error| {
            GenError::QualityUnavailable(format!("could not make frame-check directory: {error}"))
        })?;
        let frame = directory.path().join(format!("frame-{index}.png"));
        let output = std::process::Command::new(&ffmpeg)
            .args(["-v", "error", "-ss", &format!("{at:.3}"), "-i"])
            .arg(path)
            .args(["-frames:v", "1", "-vf", "scale=384:-2"])
            .arg(&frame)
            .output()
            .map_err(|error| {
                GenError::QualityUnavailable(format!(
                    "could not sample generated video at {at:.3}s: {error}"
                ))
            })?;
        if !output.status.success() || !frame.is_file() {
            return Err(GenError::QualityUnavailable(format!(
                "ffmpeg could not sample generated video at {at:.3}s"
            )));
        }
        frames.push(SampledFrame {
            path: frame,
            _directory: directory,
        });
    }
    Ok(frames)
}

fn peripheral_instability(frames: &[SampledFrame]) -> Result<bool, GenError> {
    let decoded = frames
        .iter()
        .map(|frame| {
            image::open(&frame.path)
                .map(|image| image.to_rgb8())
                .map_err(|error| {
                    GenError::QualityUnavailable(format!(
                        "could not inspect sampled frame {}: {error}",
                        frame.path.display()
                    ))
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(decoded.windows(2).any(|pair| {
        edge_and_center_difference(&pair[0], &pair[1])
            .is_some_and(|(edge, center)| edge > 0.08 && edge > center * 2.5)
    }))
}

fn edge_and_center_difference(left: &RgbImage, right: &RgbImage) -> Option<(f32, f32)> {
    if left.dimensions() != right.dimensions() {
        return None;
    }
    let (width, height) = left.dimensions();
    let mut edge = (0.0_f64, 0_u64);
    let mut center = (0.0_f64, 0_u64);
    for y in 0..height {
        for x in 0..width {
            let a = left.get_pixel(x, y).0;
            let b = right.get_pixel(x, y).0;
            let difference = a
                .iter()
                .zip(b)
                .map(|(a, b)| (f64::from(*a) - f64::from(b)).abs() / 255.0)
                .sum::<f64>()
                / 3.0;
            let central =
                x >= width / 4 && x < width * 3 / 4 && y >= height / 4 && y < height * 3 / 4;
            let target = if central { &mut center } else { &mut edge };
            target.0 += difference;
            target.1 += 1;
        }
    }
    Some((
        (edge.0 / edge.1.max(1) as f64) as f32,
        (center.0 / center.1.max(1) as f64) as f32,
    ))
}

fn hash_artifact(path: &Path) -> Result<String, GenError> {
    let bytes = fs::read(path).map_err(|error| {
        GenError::QualityUnavailable(format!(
            "could not read generated artifact {}: {error}",
            path.display()
        ))
    })?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct ArtifactMeasuredEmbedder;

    impl ImageTextEmbedder for ArtifactMeasuredEmbedder {
        fn image(&self, path: &Path) -> Result<Embedding, GenError> {
            let bytes = fs::read(path).map_err(|error| {
                GenError::QualityUnavailable(format!("test artifact unreadable: {error}"))
            })?;
            Ok(if bytes == b"bicycle pixels" {
                Embedding::new(vec![1.0, 0.0])
            } else {
                Embedding::new(vec![0.0, 1.0])
            })
        }

        fn texts(&self, texts: &[String]) -> Result<Vec<Embedding>, GenError> {
            Ok(texts
                .iter()
                .enumerate()
                .map(|(index, _)| {
                    if index == 0 {
                        Embedding::new(vec![1.0, 0.0])
                    } else {
                        Embedding::new(vec![0.0, 1.0])
                    }
                })
                .collect())
        }
    }

    fn request() -> GenerationRequest {
        GenerationRequest {
            kind: GenerationKind::Image,
            prompt: "a red bicycle in a snowy field".into(),
            model: "test".into(),
            seed: 1,
            width: None,
            height: None,
            seconds: None,
            bpm: None,
            image_ref: None,
        }
    }

    #[test]
    fn siglip_gate_rejects_an_artifact_that_does_not_match_its_prompt() {
        let directory = tempfile::tempdir().unwrap();
        let artifact = directory.path().join("generated.png");
        fs::write(&artifact, b"aircraft pixels").unwrap();
        let gate = SigLipGate {
            embedder: Box::new(ArtifactMeasuredEmbedder),
        };

        let report = gate.evaluate(&request(), &artifact).unwrap();

        assert!(!report.accepted);
        assert!(
            report.critic_required,
            "visual generations must enter bay's existing project critic after placement"
        );
        assert_eq!(report.prompt_score, Some(0.0));
        assert!(report.prompt_separation.unwrap() < 0.0);
        assert!(
            report
                .findings
                .iter()
                .any(|finding| finding.code == "prompt-mismatch")
        );
        assert_eq!(
            report.artifact_sha256,
            format!("{:x}", Sha256::digest(b"aircraft pixels")),
            "the gate receipt must hash the bytes it inspected"
        );
    }

    #[test]
    fn siglip_gate_accepts_the_same_prompt_when_measured_pixels_match() {
        let directory = tempfile::tempdir().unwrap();
        let artifact = directory.path().join("generated.png");
        fs::write(&artifact, b"bicycle pixels").unwrap();
        let gate = SigLipGate {
            embedder: Box::new(ArtifactMeasuredEmbedder),
        };

        let report = gate.evaluate(&request(), &artifact).unwrap();

        assert!(report.accepted);
        assert!(report.prompt_separation.unwrap() > 0.9);
    }
}
