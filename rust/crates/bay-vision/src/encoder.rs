//! Loading SigLIP once and running both towers.

use std::path::{Path, PathBuf};

use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::siglip;

use crate::{DIMENSIONS, TEXT_TOKENS, VisionError, preprocess, provisioned_model_dir};

/// A unit-length point in the shared image/text space.
///
/// Normalised at construction, so [`crate::cosine`] is a dot product and nothing downstream has
/// to remember to normalise. An un-normalised embedding compared against a normalised one
/// produces plausible-looking scores that rank wrongly, which is not a mistake you catch by
/// reading the output.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Embedding(Vec<f32>);

impl Embedding {
    /// L2-normalise and keep. A zero vector stays zero rather than becoming NaN — it scores 0
    /// against everything, which is the honest answer for an image that encoded to nothing.
    pub fn new(values: Vec<f32>) -> Self {
        let norm = values.iter().map(|v| v * v).sum::<f32>().sqrt();
        if norm <= f32::EPSILON {
            return Self(values);
        }
        Self(values.into_iter().map(|v| v / norm).collect())
    }

    pub fn as_slice(&self) -> &[f32] {
        &self.0
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// Which device an encode would use. Reported by `vision_status` before anything is loaded.
///
/// Always the CPU today. See the note in `Cargo.toml`: candle 0.9's Metal backend is missing
/// `layer-norm` and `softmax-last-dim`, so a SigLIP forward pass cannot complete on it. This
/// reports the honest answer rather than the one we would like, because a status that claims
/// "metal" and then runs on the CPU is how a performance question gets debugged in the wrong
/// place.
pub fn preferred_device_name() -> &'static str {
    "cpu"
}

fn preferred_device() -> Device {
    Device::Cpu
}

/// SigLIP, loaded.
///
/// Construction is the expensive part — 780 MB off disk and onto the device, a second or two on
/// an SSD. Hold one and reuse it; every entry point that takes `&self` is cheap by comparison.
pub struct Encoder {
    model: siglip::Model,
    tokenizer: tokenizers::Tokenizer,
    device: Device,
    pad_token: u32,
}

impl Encoder {
    /// Load from the provisioned location, or say it is not installed.
    pub fn load() -> Result<Self, VisionError> {
        let dir = provisioned_model_dir().ok_or(VisionError::NotInstalled)?;
        Self::load_from(&dir)
    }

    /// Load from an explicit directory holding `model.safetensors` and `tokenizer.json`.
    pub fn load_from(dir: &Path) -> Result<Self, VisionError> {
        let weights = dir.join("model.safetensors");
        let tokenizer_path = dir.join("tokenizer.json");
        if !weights.is_file() || !tokenizer_path.is_file() {
            return Err(VisionError::NotInstalled);
        }

        let tokenizer =
            tokenizers::Tokenizer::from_file(&tokenizer_path).map_err(|e| VisionError::Load {
                path: tokenizer_path.clone(),
                detail: e.to_string(),
            })?;

        let device = preferred_device();
        let config = siglip::Config::base_patch16_224();
        let pad_token = config.text_config.pad_token_id;

        // Safety: `mmaped_safetensors` maps the file. A file mutated underneath a live mapping is
        // undefined behaviour — which here means the runtime directory, written only by the
        // provisioner, and only when nothing is loaded.
        let builder = unsafe {
            VarBuilder::from_mmaped_safetensors(std::slice::from_ref(&weights), DType::F32, &device)
        }
        .map_err(|e| VisionError::Load {
            path: weights.clone(),
            detail: e.to_string(),
        })?;

        let model = siglip::Model::new(&config, builder).map_err(|e| VisionError::Load {
            path: weights,
            detail: e.to_string(),
        })?;

        Ok(Self {
            model,
            tokenizer,
            device,
            pad_token,
        })
    }

    pub fn device_name(&self) -> &'static str {
        match self.device {
            Device::Cpu => "cpu",
            Device::Metal(_) => "metal",
            Device::Cuda(_) => "cuda",
        }
    }

    /// Embed phrases. One forward pass for the batch.
    pub fn embed_text(&self, texts: &[String]) -> Result<Vec<Embedding>, VisionError> {
        if texts.is_empty() {
            return Err(VisionError::Empty);
        }
        let mut ids = Vec::with_capacity(texts.len() * TEXT_TOKENS);
        for text in texts {
            ids.extend(self.tokens_for(text)?);
        }
        let input = Tensor::from_vec(ids, (texts.len(), TEXT_TOKENS), &self.device)
            .map_err(|e| VisionError::Encode(e.to_string()))?;
        let features = self
            .model
            .get_text_features(&input)
            .map_err(|e| VisionError::Encode(e.to_string()))?;
        rows(&features, texts.len())
    }

    /// Embed images from disk.
    ///
    /// Batched in groups rather than all at once: a hundred candidates at `[100, 3, 224, 224]` is
    /// 60 MB of activations per layer, which is how a search for a lot of images becomes an
    /// out-of-memory rather than a slow answer.
    pub fn embed_images(&self, paths: &[PathBuf]) -> Result<Vec<Embedding>, VisionError> {
        if paths.is_empty() {
            return Err(VisionError::Empty);
        }
        const BATCH: usize = 16;
        let mut out = Vec::with_capacity(paths.len());
        for chunk in paths.chunks(BATCH) {
            let mut tensors = Vec::with_capacity(chunk.len());
            for path in chunk {
                tensors.push(preprocess::image_to_tensor(path, &self.device)?);
            }
            let batch =
                Tensor::stack(&tensors, 0).map_err(|e| VisionError::Encode(e.to_string()))?;
            let features = self
                .model
                .get_image_features(&batch)
                .map_err(|e| VisionError::Encode(e.to_string()))?;
            out.extend(rows(&features, chunk.len())?);
        }
        Ok(out)
    }

    /// Canonicalise, tokenize, and pad to exactly [`TEXT_TOKENS`].
    ///
    /// Truncation is not optional: the text tower has 64 position embeddings and a longer
    /// sequence is an index out of range, not a slower encode.
    fn tokens_for(&self, text: &str) -> Result<Vec<u32>, VisionError> {
        let canonical = preprocess::canonicalize(text);
        let encoded = self
            .tokenizer
            .encode(canonical, true)
            .map_err(|e| VisionError::Encode(e.to_string()))?;
        let mut ids = encoded.get_ids().to_vec();
        ids.truncate(TEXT_TOKENS);
        ids.resize(TEXT_TOKENS, self.pad_token);
        Ok(ids)
    }
}

/// Split a `[n, DIMENSIONS]` tensor into normalised rows.
fn rows(features: &Tensor, expected: usize) -> Result<Vec<Embedding>, VisionError> {
    let values = features
        .to_dtype(DType::F32)
        .and_then(|t| t.flatten_all())
        .and_then(|t| t.to_vec1::<f32>())
        .map_err(|e| VisionError::Encode(e.to_string()))?;
    if values.len() != expected * DIMENSIONS {
        return Err(VisionError::Encode(format!(
            "expected {expected}×{DIMENSIONS} features, got {}",
            values.len()
        )));
    }
    Ok(values
        .chunks(DIMENSIONS)
        .map(|row| Embedding::new(row.to_vec()))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_embedding_is_unit_length() {
        let embedding = Embedding::new(vec![3.0, 4.0]);
        assert!((embedding.as_slice()[0] - 0.6).abs() < 1e-6);
        assert!((embedding.as_slice()[1] - 0.8).abs() < 1e-6);
    }

    /// An image that encodes to nothing must score zero, not NaN. A NaN propagates into every
    /// comparison and sorts unpredictably, which turns one bad candidate into a scrambled ranking.
    #[test]
    fn a_zero_embedding_stays_zero_rather_than_becoming_nan() {
        let embedding = Embedding::new(vec![0.0; 8]);
        assert!(embedding.as_slice().iter().all(|v| *v == 0.0));
        assert_eq!(crate::cosine(&embedding, &embedding), 0.0);
    }

    #[test]
    fn the_device_name_is_answerable_before_anything_loads() {
        assert!(matches!(preferred_device_name(), "metal" | "cpu"));
    }
}
