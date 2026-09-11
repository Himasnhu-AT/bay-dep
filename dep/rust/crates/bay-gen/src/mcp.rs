use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::{
    ArtifactGate, CloudConsent, FalProvider, GeminiProvider, GenError, GenProvider, GenerationKind,
    GenerationRequest, Generator, LocalProvider, quality::QualityReport,
};

pub fn generate(kind: GenerationKind, args: &Value) -> Result<Value, String> {
    let provider_name = args
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("local");
    let provider: Box<dyn GenProvider> = match provider_name {
        "local" => Box::<LocalProvider>::default(),
        "fal" => Box::<FalProvider>::default(),
        "gemini" => Box::<GeminiProvider>::default(),
        other => {
            return Err(format!(
                "unknown generation provider {other:?}; choose local, fal, or gemini"
            ));
        }
    };
    let prompt_key = if kind == GenerationKind::Music {
        "brief"
    } else {
        "prompt"
    };
    let prompt = args
        .get(prompt_key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{prompt_key} must not be empty"))?
        .to_string();
    let request = GenerationRequest {
        kind,
        prompt,
        model: args
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or_else(|| default_model(provider_name, kind))
            .to_string(),
        seed: args.get("seed").and_then(Value::as_u64).unwrap_or(0),
        width: args
            .get("width")
            .and_then(Value::as_u64)
            .and_then(|value| u32::try_from(value).ok()),
        height: args
            .get("height")
            .and_then(Value::as_u64)
            .and_then(|value| u32::try_from(value).ok()),
        seconds: args.get("seconds").and_then(Value::as_f64),
        bpm: args.get("bpm").and_then(Value::as_f64),
        image_ref: args
            .get("imageRef")
            .and_then(Value::as_str)
            .map(PathBuf::from),
    };

    if !args
        .get("execute")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        let gate = PreviewGate;
        let preview = Generator::new(provider.as_ref(), &gate)
            .preview(&request)
            .map_err(|error| error.to_string())?;
        return Ok(json!({
            "status": "preview",
            "willGenerate": false,
            "preview": preview,
            "next": if preview.cloud {
                "Review preview.outbound and preview.cost. To proceed, repeat the exact request \
                 with execute:true, consent:true, and previewId set to preview.previewId."
            } else {
                "This stays on the machine. To proceed, repeat the exact request with execute:true."
            }
        }));
    }

    let gate = crate::quality::SigLipGate::load_for(kind).map_err(|error| error.to_string())?;
    let generator = Generator::new(provider.as_ref(), &gate);
    let consent = CloudConsent {
        approved: args
            .get("consent")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        preview_id: args
            .get("previewId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
    };
    match generator.generate(&request, &consent) {
        Ok(asset) => {
            let import_path = asset.path.clone();
            let generation_receipt = asset.provenance.request_hash.clone();
            let critic_required = asset.quality.critic_required;
            Ok(json!({
                "status": "accepted",
                "asset": asset,
                "import": {
                    "tool": "media_import",
                    "path": import_path,
                    "generationReceipt": generation_receipt,
                },
                "critic": {
                    "required": critic_required,
                    "integration": if critic_required {
                        "After media_import and placement, use the existing critic_prepare → \
                         critic_submit → critic_refresh loop. Physics/permanence judgments become \
                         the same ICGS-keyed obligations that block render for every other asset."
                    } else {
                        "No visual critic pass is needed for this artifact kind."
                    }
                }
            }))
        }
        Err(GenError::QualityRejected { path, report }) => Ok(json!({
            "status": "rejected",
            "path": path,
            "quality": report,
            "import": Value::Null,
            "next": "Do not place this artifact. Revise the prompt or seed and generate another candidate."
        })),
        Err(error) => Err(error.to_string()),
    }
}

struct PreviewGate;

impl ArtifactGate for PreviewGate {
    fn preflight(&self, _kind: GenerationKind) -> Result<(), GenError> {
        Ok(())
    }

    fn evaluate(
        &self,
        _request: &GenerationRequest,
        _path: &Path,
    ) -> Result<QualityReport, GenError> {
        Err(GenError::QualityUnavailable(
            "preview mode never evaluates an artifact".into(),
        ))
    }
}

fn default_model(provider: &str, kind: GenerationKind) -> &'static str {
    match (provider, kind) {
        ("fal", GenerationKind::Image) => "fal-ai/flux/dev",
        ("fal", GenerationKind::Video) => "fal-ai/ltx-video",
        ("fal", GenerationKind::Music) => "fal-ai/stable-audio",
        ("gemini", GenerationKind::Image) => "gemini-2.5-flash-image",
        ("gemini", GenerationKind::Video) => "veo-3.1-generate-preview",
        ("gemini", GenerationKind::Music) => "unsupported",
        ("local", GenerationKind::Image) => "sdxl",
        ("local", GenerationKind::Video) => "ltx-video",
        ("local", GenerationKind::Music) => "musicgen-small",
        _ => "default",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloud_tool_first_call_only_discloses_cost_and_egress() {
        let value = generate(
            GenerationKind::Image,
            &json!({
                "provider": "fal",
                "model": "test/preview-only-model",
                "prompt": "a cobalt bicycle under studio light",
                "seed": 938_441_u64,
            }),
        )
        .expect("preview needs no API key or vision model");

        assert_eq!(value["status"], "preview");
        assert_eq!(value["willGenerate"], false);
        assert_eq!(
            value["preview"]["outbound"]["payload"]["prompt"],
            "a cobalt bicycle under studio light"
        );
        assert!(value["preview"]["cost"]["amount"].as_f64().unwrap() > 0.0);
        assert!(value["preview"]["previewId"].as_str().is_some());
    }
}
