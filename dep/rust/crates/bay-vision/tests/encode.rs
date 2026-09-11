//! End-to-end encoding, against the real weights.
//!
//! Skips loudly when the model is not provisioned, and fails instead of skipping under
//! `BAY_REQUIRE_VISION=1` — the rule the rest of the workspace follows for GPU and ffmpeg. A skip
//! here is a skip, and must never be reported as a pass.

use std::path::PathBuf;

use bay_vision::{Encoder, cosine};

/// Load the encoder, or explain why the test did not run.
fn encoder() -> Option<Encoder> {
    let required = std::env::var("BAY_REQUIRE_VISION").as_deref() == Ok("1");
    match Encoder::load() {
        Ok(encoder) => Some(encoder),
        Err(error) => {
            assert!(
                !required,
                "BAY_REQUIRE_VISION=1 but the encoder would not load: {error}"
            );
            eprintln!("skipping: {error}");
            None
        }
    }
}

/// A solid-colour image written to a temp file, so the test needs no fixtures on disk.
fn swatch(name: &str, rgb: [u8; 3]) -> PathBuf {
    let path = std::env::temp_dir().join(format!("bay-vision-{name}-{}.png", std::process::id()));
    let mut image = image::RgbImage::new(64, 64);
    for pixel in image.pixels_mut() {
        *pixel = image::Rgb(rgb);
    }
    image.save(&path).expect("write the swatch");
    path
}

#[test]
#[ignore = "loads the SigLIP model; run it with `SLOW=1 ./test.sh`"]
fn text_embeddings_are_unit_length_and_the_right_width() {
    let Some(encoder) = encoder() else { return };
    let embeddings = encoder
        .embed_text(&["a photograph of a bank".to_string()])
        .expect("embed");
    assert_eq!(embeddings.len(), 1);
    assert_eq!(embeddings[0].len(), bay_vision::DIMENSIONS);
    let norm: f32 = embeddings[0].as_slice().iter().map(|v| v * v).sum();
    assert!((norm - 1.0).abs() < 1e-4, "not unit length: {norm}");
}

/// Two phrasings of the same idea must land closer together than two unrelated ones. This is the
/// weakest claim that still proves the text tower is loaded correctly rather than emitting noise.
#[test]
#[ignore = "loads the SigLIP model; run it with `SLOW=1 ./test.sh`"]
fn related_phrases_embed_closer_than_unrelated_ones() {
    let Some(encoder) = encoder() else { return };
    let texts = [
        "a photograph of money".to_string(),
        "a picture of banknotes and cash".to_string(),
        "a mountain landscape with snow".to_string(),
    ];
    let e = encoder.embed_text(&texts).expect("embed");
    let related = cosine(&e[0], &e[1]);
    let unrelated = cosine(&e[0], &e[2]);
    assert!(
        related > unrelated,
        "money/banknotes ({related}) should beat money/mountain ({unrelated})"
    );
}

/// The cross-modal claim — the one the whole crate rests on. A description of a colour must
/// score its own swatch above the others. Colour is used rather than subject matter because it
/// needs no fixture and cannot be satisfied by a caption the model memorised.
#[test]
#[ignore = "loads the SigLIP model; run it with `SLOW=1 ./test.sh`"]
fn an_image_scores_highest_against_its_own_description() {
    let Some(encoder) = encoder() else { return };

    let red = swatch("red", [220, 20, 20]);
    let green = swatch("green", [20, 200, 20]);
    let blue = swatch("blue", [20, 20, 220]);
    let paths = vec![red.clone(), green.clone(), blue.clone()];

    let images = encoder.embed_images(&paths).expect("embed images");
    assert_eq!(images.len(), 3);

    let queries = [
        "a solid red image".to_string(),
        "a solid green image".to_string(),
        "a solid blue image".to_string(),
    ];
    let texts = encoder.embed_text(&queries).expect("embed text");

    for (i, query) in queries.iter().enumerate() {
        let scores: Vec<f32> = images.iter().map(|img| cosine(&texts[i], img)).collect();
        let best = scores
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .map(|(idx, _)| idx)
            .unwrap();
        assert_eq!(
            best, i,
            "{query:?} should match image {i}, not {best} — scores {scores:?}"
        );
    }

    for path in [red, green, blue] {
        std::fs::remove_file(path).ok();
    }
}

/// Encoding nothing is a caller bug and must say so rather than returning an empty answer that
/// silently ranks nothing.
#[test]
#[ignore = "loads the SigLIP model; run it with `SLOW=1 ./test.sh`"]
fn embedding_an_empty_batch_is_an_error() {
    let Some(encoder) = encoder() else { return };
    assert!(encoder.embed_text(&[]).is_err());
    assert!(encoder.embed_images(&[]).is_err());
}

/// A text longer than the 64-token window must truncate, not panic. Beat narration routinely
/// runs longer than the window and this is the path every search takes.
#[test]
#[ignore = "loads the SigLIP model; run it with `SLOW=1 ./test.sh`"]
fn a_text_longer_than_the_window_truncates_instead_of_panicking() {
    let Some(encoder) = encoder() else { return };
    let long = "a very long description of a photograph ".repeat(40);
    let embeddings = encoder.embed_text(&[long]).expect("truncate and embed");
    assert_eq!(embeddings[0].len(), bay_vision::DIMENSIONS);
}
