use std::{
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::quality::{ArtifactGate, QualityReport};
pub use bay_project::GeneratedMediaProvenance as Provenance;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GenerationKind {
    Image,
    Video,
    Music,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationRequest {
    pub kind: GenerationKind,
    pub prompt: String,
    pub model: String,
    #[serde(default)]
    pub seed: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seconds: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bpm: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_ref: Option<PathBuf>,
}

impl GenerationRequest {
    pub fn validate(&self) -> Result<(), GenError> {
        if self.prompt.trim().is_empty() {
            return Err(GenError::Invalid("prompt must not be empty".into()));
        }
        if self.model.trim().is_empty() {
            return Err(GenError::Invalid("model must not be empty".into()));
        }
        if self.width.is_some_and(|value| value == 0) || self.height.is_some_and(|value| value == 0)
        {
            return Err(GenError::Invalid(
                "width and height must be positive when supplied".into(),
            ));
        }
        if self
            .seconds
            .is_some_and(|value| !value.is_finite() || value <= 0.0)
        {
            return Err(GenError::Invalid(
                "seconds must be finite and greater than zero".into(),
            ));
        }
        if self.kind == GenerationKind::Video && self.seconds.unwrap_or(4.0) > 4.0 {
            return Err(GenError::Invalid(
                "generated source clips are capped at 4 seconds; model coherence degrades on \
                 longer clips, so generate another shot instead"
                    .into(),
            ));
        }
        if self
            .bpm
            .is_some_and(|value| !value.is_finite() || !(30.0..=300.0).contains(&value))
        {
            return Err(GenError::Invalid(
                "bpm must be a finite value from 30 through 300".into(),
            ));
        }
        if self.kind != GenerationKind::Music && self.bpm.is_some() {
            return Err(GenError::Invalid("bpm is only valid for music".into()));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostEstimate {
    pub currency: String,
    pub amount: f64,
    pub estimated_seconds: u64,
    pub basis: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboundDisclosure {
    pub destination: String,
    /// The exact JSON body, before authentication is attached.
    pub payload: Value,
    /// Files whose bytes will be uploaded. Paths are shown; bytes are not copied into the receipt.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub local_files: Vec<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationPreview {
    pub preview_id: String,
    pub provider: String,
    pub cloud: bool,
    pub configured: bool,
    #[serde(default)]
    pub cached: bool,
    pub cost: CostEstimate,
    pub outbound: Option<OutboundDisclosure>,
    pub request: GenerationRequest,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudConsent {
    #[serde(default)]
    pub approved: bool,
    #[serde(default)]
    pub preview_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProviderOutput {
    pub path: PathBuf,
}

pub trait GenProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn is_cloud(&self) -> bool;
    fn configured(&self) -> bool;
    fn preview(&self, request: &GenerationRequest) -> Result<ProviderPreview, GenError>;
    fn generate(
        &self,
        request: &GenerationRequest,
        preview: &ProviderPreview,
    ) -> Result<ProviderOutput, GenError>;
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProviderPreview {
    pub cost: CostEstimate,
    pub outbound: Option<OutboundDisclosure>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeatGrid {
    pub bpm: f64,
    pub confidence: f32,
    pub beats_seconds: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedAsset {
    pub path: PathBuf,
    pub provenance: Provenance,
    pub quality: QualityReport,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub beat_grid: Option<BeatGrid>,
}

pub struct Generator<'a> {
    provider: &'a dyn GenProvider,
    gate: &'a dyn ArtifactGate,
}

impl<'a> Generator<'a> {
    pub fn new(provider: &'a dyn GenProvider, gate: &'a dyn ArtifactGate) -> Self {
        Self { provider, gate }
    }

    pub fn preview(&self, request: &GenerationRequest) -> Result<GenerationPreview, GenError> {
        request.validate()?;
        let request_hash = request_hash(self.provider.id(), request)?;
        let cached = crate::cache::load(&request_hash)?.is_some_and(|asset| asset.path.is_file());
        let provider = if cached {
            ProviderPreview {
                cost: CostEstimate {
                    currency: "USD".into(),
                    amount: 0.0,
                    estimated_seconds: 0,
                    basis: "content-addressed cache hit; no provider call".into(),
                },
                outbound: None,
            }
        } else {
            self.provider.preview(request)?
        };
        let preview_id = preview_id(self.provider.id(), request, &provider)?;
        Ok(GenerationPreview {
            preview_id,
            provider: self.provider.id().into(),
            cloud: self.provider.is_cloud(),
            configured: cached || self.provider.configured(),
            cached,
            cost: provider.cost,
            outbound: provider.outbound,
            request: request.clone(),
        })
    }

    pub fn generate(
        &self,
        request: &GenerationRequest,
        consent: &CloudConsent,
    ) -> Result<GeneratedAsset, GenError> {
        let shown = self.preview(request)?;
        if shown.cached {
            let request_hash = request_hash(self.provider.id(), request)?;
            if let Some(mut asset) = crate::cache::load(&request_hash)? {
                self.gate.preflight(request.kind)?;
                let quality = self.gate.evaluate(request, &asset.path)?;
                if !quality.accepted {
                    return Err(GenError::QualityRejected {
                        path: asset.path,
                        report: Box::new(quality),
                    });
                }
                asset.beat_grid = quality.beat_grid.clone();
                asset.quality = quality;
                return Ok(asset);
            }
        }
        if !self.provider.configured() {
            return Err(GenError::Unconfigured {
                provider: self.provider.id().into(),
            });
        }
        if self.provider.is_cloud() && (!consent.approved || consent.preview_id != shown.preview_id)
        {
            return Err(GenError::ConsentRequired {
                preview_id: shown.preview_id,
            });
        }

        // Refuse before a billable call if this machine cannot inspect what comes back.
        self.gate.preflight(request.kind)?;
        let provider_preview = self.provider.preview(request)?;
        let output = self.provider.generate(request, &provider_preview)?;
        let quality = self.gate.evaluate(request, &output.path)?;
        let rejected = !quality.accepted;
        let rejected_path = output.path.clone();
        let rejected_report = quality.clone();
        let request_hash = request_hash(self.provider.id(), request)?;
        let artifact_sha256 = quality.artifact_sha256.clone();
        let asset = GeneratedAsset {
            path: output.path,
            beat_grid: quality.beat_grid.clone(),
            quality,
            provenance: Provenance {
                provider: self.provider.id().into(),
                model: request.model.clone(),
                prompt: request.prompt.clone(),
                seed: request.seed,
                generated_at_unix_ms: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis(),
                request_hash,
                artifact_sha256,
            },
        };
        // Cache accepted and rejected provider output alike. Repeating the exact prompt/model/seed
        // must never spend provider money merely to rediscover the same quality verdict.
        crate::cache::save(&asset)?;
        if rejected {
            return Err(GenError::QualityRejected {
                path: rejected_path,
                report: Box::new(rejected_report),
            });
        }
        Ok(asset)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum GenError {
    #[error("{0}")]
    Invalid(String),
    #[error("provider {provider:?} is not configured")]
    Unconfigured { provider: String },
    #[error(
        "cloud generation needs explicit consent to the displayed payload and cost; approve \
         preview {preview_id:?}, then repeat the same request"
    )]
    ConsentRequired { preview_id: String },
    #[error("provider {provider:?} failed: {detail}")]
    Provider { provider: String, detail: String },
    #[error("generation quality checks could not run: {0}")]
    QualityUnavailable(String),
    #[error("generated artifact {path:?} was rejected by quality gates")]
    QualityRejected {
        path: PathBuf,
        report: Box<QualityReport>,
    },
    #[error("could not create a stable generation receipt: {0}")]
    Receipt(String),
}

fn preview_id(
    provider_id: &str,
    request: &GenerationRequest,
    preview: &ProviderPreview,
) -> Result<String, GenError> {
    let value = serde_json::json!({
        "provider": provider_id,
        "request": request,
        "cost": preview.cost,
        "outbound": preview.outbound,
    });
    digest_json(&value)
}

fn request_hash(provider_id: &str, request: &GenerationRequest) -> Result<String, GenError> {
    digest_json(&serde_json::json!({
        "provider": provider_id,
        "request": request,
    }))
}

fn digest_json(value: &Value) -> Result<String, GenError> {
    let bytes = serde_json::to_vec(value).map_err(|error| GenError::Receipt(error.to_string()))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use crate::quality::{ArtifactGate, QualityFinding};

    struct CloudSpy {
        calls: AtomicUsize,
    }

    impl GenProvider for CloudSpy {
        fn id(&self) -> &'static str {
            "cloud-spy"
        }

        fn is_cloud(&self) -> bool {
            true
        }

        fn configured(&self) -> bool {
            true
        }

        fn preview(&self, request: &GenerationRequest) -> Result<ProviderPreview, GenError> {
            Ok(ProviderPreview {
                cost: CostEstimate {
                    currency: "USD".into(),
                    amount: 0.25,
                    estimated_seconds: 30,
                    basis: "test estimate".into(),
                },
                outbound: Some(OutboundDisclosure {
                    destination: "https://example.invalid/generate".into(),
                    payload: serde_json::json!({"prompt": request.prompt}),
                    local_files: Vec::new(),
                }),
            })
        }

        fn generate(
            &self,
            _request: &GenerationRequest,
            _preview: &ProviderPreview,
        ) -> Result<ProviderOutput, GenError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(ProviderOutput {
                path: PathBuf::from("/tmp/should-not-exist.png"),
            })
        }
    }

    struct PassGate;

    impl ArtifactGate for PassGate {
        fn preflight(&self, _kind: GenerationKind) -> Result<(), GenError> {
            Ok(())
        }

        fn evaluate(
            &self,
            _request: &GenerationRequest,
            path: &std::path::Path,
        ) -> Result<QualityReport, GenError> {
            Ok(QualityReport {
                accepted: true,
                artifact_sha256: String::new(),
                prompt_score: Some(1.0),
                prompt_separation: Some(1.0),
                findings: Vec::<QualityFinding>::new(),
                beat_grid: None,
                critic_required: false,
                artifact_path: path.to_path_buf(),
            })
        }
    }

    fn request(prompt: &str) -> GenerationRequest {
        GenerationRequest {
            kind: GenerationKind::Image,
            prompt: prompt.into(),
            model: "test-model".into(),
            seed: 7,
            width: Some(1024),
            height: Some(1024),
            seconds: None,
            bpm: None,
            image_ref: None,
        }
    }

    #[test]
    fn cloud_provider_is_never_called_without_matching_explicit_consent() {
        let provider = CloudSpy {
            calls: AtomicUsize::new(0),
        };
        let generator = Generator::new(&provider, &PassGate);
        let wanted = request("a red bicycle in a snowy field");

        let error = generator
            .generate(&wanted, &CloudConsent::default())
            .expect_err("an unconsented cloud request must be refused");

        assert!(matches!(error, GenError::ConsentRequired { .. }));
        assert_eq!(
            provider.calls.load(Ordering::SeqCst),
            0,
            "previewing may calculate cost locally but must never call the cloud"
        );
    }

    #[test]
    fn consent_for_one_payload_cannot_authorize_a_changed_prompt() {
        let provider = CloudSpy {
            calls: AtomicUsize::new(0),
        };
        let generator = Generator::new(&provider, &PassGate);
        let first = request("a red bicycle");
        let consent = CloudConsent {
            approved: true,
            preview_id: generator.preview(&first).unwrap().preview_id,
        };

        let error = generator
            .generate(&request("a blue aircraft"), &consent)
            .expect_err("consent is bound to the payload the user saw");

        assert!(matches!(error, GenError::ConsentRequired { .. }));
        assert_eq!(provider.calls.load(Ordering::SeqCst), 0);
    }
}
