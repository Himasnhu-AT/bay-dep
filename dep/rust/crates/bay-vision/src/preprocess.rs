//! Turning a file on disk into the tensor SigLIP was trained on.
//!
//! Every number here comes from the checkpoint's own `preprocessor_config.json` and none of them
//! is a choice: `224×224`, bicubic, rescale by `1/255`, then normalise with mean `0.5` and
//! standard deviation `0.5`. Getting any of them wrong does not fail — it returns embeddings that
//! are subtly, unfalsifiably worse, which is the expensive kind of bug.
//!
//! Note the aspect ratio is **not** preserved, because the reference processor does not preserve
//! it: it resizes straight to a square. Centre-cropping instead would score better on some images
//! and worse on others, and would no longer be the function the weights were fitted against.

use std::path::Path;

use candle_core::{Device, Tensor};

use crate::{IMAGE_SIZE, VisionError};

/// `(v / 255 − 0.5) / 0.5`, folded into one multiply and one subtract.
const SCALE: f32 = 2.0 / 255.0;
const SHIFT: f32 = -1.0;

/// Decode `path` and produce a `[3, 224, 224]` CHW tensor.
pub fn image_to_tensor(path: &Path, device: &Device) -> Result<Tensor, VisionError> {
    let image = image::ImageReader::open(path)
        .map_err(|e| VisionError::Image {
            path: path.to_path_buf(),
            detail: e.to_string(),
        })?
        // A JPEG served with a .png name is common enough in an archive that trusting the
        // extension would reject real files; sniff the content instead.
        .with_guessed_format()
        .map_err(|e| VisionError::Image {
            path: path.to_path_buf(),
            detail: e.to_string(),
        })?
        .decode()
        .map_err(|e| VisionError::Image {
            path: path.to_path_buf(),
            detail: e.to_string(),
        })?;

    to_tensor(&image, device).map_err(|e| VisionError::Image {
        path: path.to_path_buf(),
        detail: e.to_string(),
    })
}

/// As [`image_to_tensor`], from an already-decoded image.
pub fn to_tensor(image: &image::DynamicImage, device: &Device) -> candle_core::Result<Tensor> {
    let resized = image.resize_exact(
        IMAGE_SIZE as u32,
        IMAGE_SIZE as u32,
        image::imageops::FilterType::CatmullRom,
    );
    let rgb = resized.to_rgb8();

    // HWC bytes -> CHW floats. Done by hand rather than via a permute so there is exactly one
    // pass over the pixels and no intermediate 150k-element tensor.
    let mut planes = vec![0f32; 3 * IMAGE_SIZE * IMAGE_SIZE];
    let plane = IMAGE_SIZE * IMAGE_SIZE;
    for (i, pixel) in rgb.pixels().enumerate() {
        planes[i] = pixel[0] as f32 * SCALE + SHIFT;
        planes[plane + i] = pixel[1] as f32 * SCALE + SHIFT;
        planes[2 * plane + i] = pixel[2] as f32 * SCALE + SHIFT;
    }
    Tensor::from_vec(planes, (3, IMAGE_SIZE, IMAGE_SIZE), device)
}

/// What SigLIP's tokenizer does to a string before it sees a token.
///
/// The reference `SiglipTokenizer` lowercases, strips punctuation and collapses whitespace. It
/// matters more than it looks: leaving punctuation in spends tokens out of a 64-token budget on
/// commas, and the checkpoint never saw a capital letter during training.
pub fn canonicalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut pending_space = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            pending_space = !out.is_empty();
        } else if ch.is_alphanumeric() {
            if pending_space {
                out.push(' ');
                pending_space = false;
            }
            out.extend(ch.to_lowercase());
        }
        // Punctuation is dropped without becoming a space, so "state-owned" stays one word —
        // which is what the reference implementation does.
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonicalize_matches_the_reference_rules() {
        assert_eq!(canonicalize("The Bank of England!"), "the bank of england");
        assert_eq!(canonicalize("  spaced   out  "), "spaced out");
        assert_eq!(canonicalize("state-owned"), "stateowned");
        assert_eq!(canonicalize("200,000,000,000"), "200000000000");
        assert_eq!(canonicalize(""), "");
        assert_eq!(canonicalize("!!!"), "");
    }

    #[test]
    fn a_pixel_maps_into_minus_one_to_one() {
        let device = Device::Cpu;
        let black = image::DynamicImage::new_rgb8(4, 4);
        let tensor = to_tensor(&black, &device).unwrap();
        assert_eq!(tensor.dims(), &[3, IMAGE_SIZE, IMAGE_SIZE]);
        let values = tensor.flatten_all().unwrap().to_vec1::<f32>().unwrap();
        assert!(
            values.iter().all(|v| (*v - -1.0).abs() < 1e-6),
            "black must land on the bottom of the range"
        );

        let mut white = image::RgbImage::new(4, 4);
        for pixel in white.pixels_mut() {
            *pixel = image::Rgb([255, 255, 255]);
        }
        let tensor = to_tensor(&image::DynamicImage::ImageRgb8(white), &device).unwrap();
        let values = tensor.flatten_all().unwrap().to_vec1::<f32>().unwrap();
        assert!(
            values.iter().all(|v| (*v - 1.0).abs() < 1e-6),
            "white must land on the top of the range"
        );
    }

    /// A non-square source must still come out square — the reference processor squashes rather
    /// than crops, and an embedding computed from a crop is not comparable with one that was not.
    #[test]
    fn a_wide_image_is_squashed_not_cropped() {
        let device = Device::Cpu;
        let wide = image::DynamicImage::new_rgb8(640, 100);
        let tensor = to_tensor(&wide, &device).unwrap();
        assert_eq!(tensor.dims(), &[3, IMAGE_SIZE, IMAGE_SIZE]);
    }
}
