use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
};

use base64::Engine;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::{
    CostEstimate, GenError, GenProvider, GenerationKind, GenerationRequest, OutboundDisclosure,
    ProviderOutput, generation::ProviderPreview,
};

const MAX_GENERATED_BYTES: u64 = 512 * 1024 * 1024;

pub struct FalProvider {
    key: Option<String>,
    agent: ureq::Agent,
}

impl Default for FalProvider {
    fn default() -> Self {
        Self {
            key: std::env::var("FAL_KEY").ok().filter(|key| !key.is_empty()),
            agent: http_agent(),
        }
    }
}

impl GenProvider for FalProvider {
    fn id(&self) -> &'static str {
        "fal"
    }

    fn is_cloud(&self) -> bool {
        true
    }

    fn configured(&self) -> bool {
        self.key.is_some()
    }

    fn preview(&self, request: &GenerationRequest) -> Result<ProviderPreview, GenError> {
        let payload = common_payload(request);
        let local_files = request.image_ref.iter().cloned().collect();
        let units = match request.kind {
            GenerationKind::Image => {
                f64::from(request.width.unwrap_or(1024)) * f64::from(request.height.unwrap_or(1024))
                    / 1_000_000.0
            }
            GenerationKind::Video | GenerationKind::Music => request.seconds.unwrap_or(4.0),
        };
        let (rate, unit) = match request.kind {
            GenerationKind::Image => (0.04, "estimated USD per megapixel"),
            GenerationKind::Video => (0.10, "estimated USD per generated second"),
            GenerationKind::Music => (0.05, "estimated USD per generated second"),
        };
        Ok(ProviderPreview {
            cost: CostEstimate {
                currency: "USD".into(),
                amount: round_cost(units * rate),
                estimated_seconds: match request.kind {
                    GenerationKind::Image => 20,
                    GenerationKind::Video => 90,
                    GenerationKind::Music => 60,
                },
                basis: format!(
                    "{unit} for model {}; provider pricing can change and bay does not meter credits",
                    request.model
                ),
            },
            outbound: Some(OutboundDisclosure {
                destination: format!("https://fal.run/{}", request.model),
                payload,
                local_files,
            }),
        })
    }

    fn generate(
        &self,
        request: &GenerationRequest,
        preview: &ProviderPreview,
    ) -> Result<ProviderOutput, GenError> {
        let key = self.key.as_deref().ok_or_else(|| GenError::Unconfigured {
            provider: self.id().into(),
        })?;
        let outbound = preview
            .outbound
            .as_ref()
            .ok_or_else(|| provider_error(self.id(), "missing outbound request preview"))?;
        let response = self
            .agent
            .post(&outbound.destination)
            .header("Authorization", &format!("Key {key}"))
            .send_json(&outbound.payload)
            .map_err(|error| provider_error(self.id(), &error.to_string()))?;
        let value: Value =
            serde_json::from_reader(response.into_body().into_reader()).map_err(|error| {
                provider_error(self.id(), &format!("invalid JSON response: {error}"))
            })?;
        let url = find_media_url(&value).ok_or_else(|| {
            provider_error(
                self.id(),
                "the model did not return a direct media URL; queued-only fal models are not \
                 accepted because bay cannot verify an absent artifact",
            )
        })?;
        if !allowed_download_url(url, &["fal.media"]) {
            return Err(provider_error(
                self.id(),
                "the provider returned media from a host bay does not trust",
            ));
        }
        let bytes = download_limited(&self.agent, url)?;
        write_generated(request, &bytes)
    }
}

pub struct GeminiProvider {
    key: Option<String>,
    agent: ureq::Agent,
}

impl Default for GeminiProvider {
    fn default() -> Self {
        Self {
            key: std::env::var("GEMINI_API_KEY")
                .ok()
                .filter(|key| !key.is_empty()),
            agent: http_agent(),
        }
    }
}

impl GenProvider for GeminiProvider {
    fn id(&self) -> &'static str {
        "gemini"
    }

    fn is_cloud(&self) -> bool {
        true
    }

    fn configured(&self) -> bool {
        self.key.is_some()
    }

    fn preview(&self, request: &GenerationRequest) -> Result<ProviderPreview, GenError> {
        if request.kind == GenerationKind::Music {
            return Err(provider_error(
                self.id(),
                "Gemini has no music-generation adapter; choose fal or local",
            ));
        }
        let destination = match request.kind {
            GenerationKind::Image => format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
                request.model
            ),
            GenerationKind::Video => format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:predictLongRunning",
                request.model
            ),
            GenerationKind::Music => unreachable!(),
        };
        let payload = match request.kind {
            GenerationKind::Image => json!({
                "contents": [{"parts": [{"text": request.prompt}]}],
                "generationConfig": {
                    "responseModalities": ["IMAGE"],
                    "imageConfig": {
                        "aspectRatio": aspect_ratio(request.width, request.height)
                    }
                }
            }),
            GenerationKind::Video => common_payload(request),
            GenerationKind::Music => unreachable!(),
        };
        let (amount, seconds) = match request.kind {
            GenerationKind::Image => (0.04, 30),
            GenerationKind::Video => (0.15 * request.seconds.unwrap_or(4.0), 120),
            GenerationKind::Music => unreachable!(),
        };
        Ok(ProviderPreview {
            cost: CostEstimate {
                currency: "USD".into(),
                amount: round_cost(amount),
                estimated_seconds: seconds,
                basis: format!(
                    "provider estimate for {}; bay surfaces this estimate and does not sell credits",
                    request.model
                ),
            },
            outbound: Some(OutboundDisclosure {
                destination,
                payload,
                local_files: request.image_ref.iter().cloned().collect(),
            }),
        })
    }

    fn generate(
        &self,
        request: &GenerationRequest,
        preview: &ProviderPreview,
    ) -> Result<ProviderOutput, GenError> {
        if request.kind == GenerationKind::Video {
            return Err(provider_error(
                self.id(),
                "Veo returns a long-running operation; polling and authenticated artifact download \
                 are not wired in this build",
            ));
        }
        let key = self.key.as_deref().ok_or_else(|| GenError::Unconfigured {
            provider: self.id().into(),
        })?;
        let outbound = preview
            .outbound
            .as_ref()
            .ok_or_else(|| provider_error(self.id(), "missing outbound request preview"))?;
        let response = self
            .agent
            .post(&outbound.destination)
            .header("x-goog-api-key", key)
            .send_json(&outbound.payload)
            .map_err(|error| provider_error(self.id(), &error.to_string()))?;
        let value: Value =
            serde_json::from_reader(response.into_body().into_reader()).map_err(|error| {
                provider_error(self.id(), &format!("invalid JSON response: {error}"))
            })?;
        let encoded = find_inline_data(&value).ok_or_else(|| {
            provider_error(
                self.id(),
                "the response contained no inline generated image to verify",
            )
        })?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|error| {
                provider_error(self.id(), &format!("invalid image payload: {error}"))
            })?;
        write_generated(request, &bytes)
    }
}

/// Local open-weights adapter.
///
/// The runner is resolved from bay's managed runtime first (`runtime/bin/bay-gen-local`) and can
/// be overridden with `BAY_GEN_LOCAL_COMMAND` for development. JSON is written to stdin so
/// prompts never appear in process listings or logs. The runner must write the requested output
/// path and exit successfully.
pub struct LocalProvider {
    executable: Option<PathBuf>,
}

impl Default for LocalProvider {
    fn default() -> Self {
        let explicit = std::env::var_os("BAY_GEN_LOCAL_COMMAND")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        let managed = bay_paths::managed_bin_dir()
            .map(|directory| directory.join(local_runner_name()))
            .filter(|path| path.is_file());
        Self {
            executable: explicit.or(managed),
        }
    }
}

impl GenProvider for LocalProvider {
    fn id(&self) -> &'static str {
        "local"
    }

    fn is_cloud(&self) -> bool {
        false
    }

    fn configured(&self) -> bool {
        self.executable.as_ref().is_some_and(|path| path.is_file())
    }

    fn preview(&self, request: &GenerationRequest) -> Result<ProviderPreview, GenError> {
        Ok(ProviderPreview {
            cost: CostEstimate {
                currency: "USD".into(),
                amount: 0.0,
                estimated_seconds: match request.kind {
                    GenerationKind::Image => 60,
                    GenerationKind::Video => 300,
                    GenerationKind::Music => 120,
                },
                basis: "local compute; no provider charge and no bay credits".into(),
            },
            outbound: None,
        })
    }

    fn generate(
        &self,
        request: &GenerationRequest,
        _preview: &ProviderPreview,
    ) -> Result<ProviderOutput, GenError> {
        let executable = self
            .executable
            .as_ref()
            .ok_or_else(|| GenError::Unconfigured {
                provider: self.id().into(),
            })?;
        let output = output_path(request)?;
        let mut child = Command::new(executable)
            .arg("--output")
            .arg(&output)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| provider_error(self.id(), &error.to_string()))?;
        if let Some(mut stdin) = child.stdin.take() {
            serde_json::to_writer(&mut stdin, request)
                .map_err(|error| provider_error(self.id(), &error.to_string()))?;
            stdin
                .flush()
                .map_err(|error| provider_error(self.id(), &error.to_string()))?;
        }
        let status = child
            .wait()
            .map_err(|error| provider_error(self.id(), &error.to_string()))?;
        if !status.success() || !output.is_file() {
            return Err(provider_error(
                self.id(),
                "the local runner failed or produced no artifact",
            ));
        }
        Ok(ProviderOutput { path: output })
    }
}

fn http_agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(std::time::Duration::from_secs(20)))
        .timeout_recv_body(Some(std::time::Duration::from_secs(600)))
        .user_agent(concat!("bay/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

fn common_payload(request: &GenerationRequest) -> Value {
    json!({
        "prompt": request.prompt,
        "model": request.model,
        "seed": request.seed,
        "width": request.width,
        "height": request.height,
        "duration": request.seconds,
        "bpm": request.bpm,
        "imageRef": request.image_ref,
    })
}

fn aspect_ratio(width: Option<u32>, height: Option<u32>) -> String {
    let (width, height) = (width.unwrap_or(1024), height.unwrap_or(1024));
    if width > height {
        "16:9"
    } else if height > width {
        "9:16"
    } else {
        "1:1"
    }
    .into()
}

fn find_media_url(value: &Value) -> Option<&str> {
    match value {
        Value::String(text) if text.starts_with("https://") => Some(text),
        Value::Array(values) => values.iter().find_map(find_media_url),
        Value::Object(values) => ["url", "video", "image", "audio", "data"]
            .iter()
            .filter_map(|key| values.get(*key))
            .find_map(find_media_url)
            .or_else(|| values.values().find_map(find_media_url)),
        _ => None,
    }
}

fn find_inline_data(value: &Value) -> Option<&str> {
    match value {
        Value::Object(values) => {
            if let Some(data) = values
                .get("inlineData")
                .or_else(|| values.get("inline_data"))
                .and_then(|inline| inline.get("data"))
                .and_then(Value::as_str)
            {
                return Some(data);
            }
            values.values().find_map(find_inline_data)
        }
        Value::Array(values) => values.iter().find_map(find_inline_data),
        _ => None,
    }
}

fn download_limited(agent: &ureq::Agent, url: &str) -> Result<Vec<u8>, GenError> {
    let response = agent
        .get(url)
        .call()
        .map_err(|error| provider_error("fal", &error.to_string()))?;
    let mut bytes = Vec::new();
    response
        .into_body()
        .into_reader()
        .take(MAX_GENERATED_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| provider_error("fal", &error.to_string()))?;
    if bytes.len() as u64 > MAX_GENERATED_BYTES {
        return Err(provider_error(
            "fal",
            "the generated artifact exceeded bay's 512 MB download ceiling",
        ));
    }
    Ok(bytes)
}

fn allowed_download_url(url: &str, hosts: &[&str]) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest
        .split('/')
        .next()
        .unwrap_or("")
        .split('@')
        .next_back()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    hosts
        .iter()
        .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
}

fn write_generated(request: &GenerationRequest, bytes: &[u8]) -> Result<ProviderOutput, GenError> {
    let path = output_path(request)?;
    fs::write(&path, bytes)
        .map_err(|error| provider_error("output", &format!("could not write artifact: {error}")))?;
    Ok(ProviderOutput { path })
}

fn output_path(request: &GenerationRequest) -> Result<PathBuf, GenError> {
    let directory = bay_paths::data_dir()
        .map(|path| path.join("generation").join("assets"))
        .ok_or_else(|| GenError::Receipt("bay could not resolve its data directory".into()))?;
    fs::create_dir_all(&directory).map_err(|error| {
        GenError::Receipt(format!("could not create output directory: {error}"))
    })?;
    let extension = match request.kind {
        GenerationKind::Image => "png",
        GenerationKind::Video => "mp4",
        GenerationKind::Music => "wav",
    };
    let fingerprint =
        serde_json::to_vec(request).map_err(|error| GenError::Receipt(error.to_string()))?;
    let digest = format!("{:x}", Sha256::digest(fingerprint));
    Ok(directory.join(format!("{}.{}", &digest[..24], extension)))
}

fn provider_error(provider: &str, detail: &str) -> GenError {
    GenError::Provider {
        provider: provider.into(),
        detail: detail.into(),
    }
}

fn round_cost(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

fn local_runner_name() -> &'static str {
    if cfg!(windows) {
        "bay-gen-local.exe"
    } else {
        "bay-gen-local"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fal_preview_discloses_prompt_destination_files_and_cost_without_a_key() {
        let provider = FalProvider {
            key: None,
            agent: http_agent(),
        };
        let request = GenerationRequest {
            kind: GenerationKind::Video,
            prompt: "macro shot of rain on a red bicycle".into(),
            model: "fal-ai/veo".into(),
            seed: 8,
            width: None,
            height: None,
            seconds: Some(4.0),
            bpm: None,
            image_ref: Some(PathBuf::from("/private/reference.png")),
        };

        let preview = provider.preview(&request).unwrap();

        assert!(preview.cost.amount > 0.0);
        let outbound = preview.outbound.unwrap();
        assert_eq!(
            outbound.payload["prompt"],
            "macro shot of rain on a red bicycle"
        );
        assert_eq!(
            outbound.local_files,
            vec![PathBuf::from("/private/reference.png")]
        );
        assert!(!provider.configured());
    }

    #[test]
    fn provider_download_urls_are_allowlisted_not_substring_matched() {
        assert!(allowed_download_url(
            "https://cdn.fal.media/output.png",
            &["fal.media"]
        ));
        assert!(!allowed_download_url(
            "https://fal.media.attacker.test/output.png",
            &["fal.media"]
        ));
    }
}
