//! The tools that expose the encoder to an agent.
//!
//! Plain JSON, so `bay-mcp` needs none of this crate's types.
//!
//! The encoder is loaded per call rather than held in a static. 780 MB resident for the whole
//! life of the editor, on the chance somebody searches, is the wrong default for an app whose
//! pitch is that it stays out of your way — and the load is a second, against a search that
//! already spends longer than that fetching previews.

use std::path::PathBuf;

use serde_json::{Value, json};

use crate::{Encoder, VisionError, cosine};

/// `vision_status`: whether describing a picture will work, answered without loading anything.
pub fn vision_status() -> Value {
    serde_json::to_value(crate::status()).unwrap_or(Value::Null)
}

/// `image_rank`: score images already on disk against a phrase.
pub fn image_rank(args: &Value) -> Result<Value, String> {
    let query = args
        .get("query")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or("image_rank needs a query — plain words describing what you are looking for")?;

    let paths: Vec<PathBuf> = args
        .get("paths")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(PathBuf::from)
                .collect()
        })
        .unwrap_or_default();

    if paths.is_empty() {
        return Err("image_rank needs a paths array of images to score".into());
    }

    let encoder = Encoder::load().map_err(|e| e.to_string())?;
    let text = encoder
        .embed_text(&[query.to_string()])
        .map_err(|e| e.to_string())?;

    // An unreadable file is skipped and named rather than failing the whole call. One corrupt
    // download in forty should not cost the other thirty-nine.
    let mut usable = Vec::new();
    let mut skipped = Vec::new();
    for path in paths {
        match encoder.embed_images(std::slice::from_ref(&path)) {
            Ok(mut embeddings) if !embeddings.is_empty() => {
                usable.push((path, embeddings.remove(0)));
            }
            Ok(_) => skipped.push(json!({ "path": path, "reason": "encoded to nothing" })),
            Err(VisionError::Image { detail, .. }) => {
                skipped.push(json!({ "path": path, "reason": detail }))
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    let mut scored: Vec<(f32, PathBuf)> = usable
        .into_iter()
        .map(|(path, embedding)| (cosine(&text[0], &embedding), path))
        .collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let separation = if scored.is_empty() {
        0.0
    } else {
        scored[0].0 - scored[scored.len() / 2].0
    };

    Ok(json!({
        "query": query,
        "matches": scored.iter().map(|(score, path)| json!({
            "path": path,
            "score": score,
        })).collect::<Vec<_>>(),
        "skipped": skipped,
        "separation": separation,
        "hint": "scores are not calibrated — 0.05 can be a good match. What matters is the \
                 separation between the best and the middle.",
    }))
}

/// Score a batch of local files against a phrase, for `stock_search`'s re-rank.
///
/// Returns `None` rather than an error when the model is not installed, because the caller's
/// right response is to fall back to the archive's own order, not to fail the search.
pub fn score_against(query: &str, paths: &[PathBuf]) -> Option<Vec<f32>> {
    if paths.is_empty() {
        return None;
    }
    let encoder = Encoder::load().ok()?;
    let text = encoder.embed_text(&[query.to_string()]).ok()?;

    // Per-file, so one unreadable preview scores 0 instead of losing the batch it was in.
    Some(
        paths
            .iter()
            .map(|path| {
                encoder
                    .embed_images(std::slice::from_ref(path))
                    .ok()
                    .and_then(|mut e| (!e.is_empty()).then(|| e.remove(0)))
                    .map(|embedding| cosine(&text[0], &embedding))
                    .unwrap_or(0.0)
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_is_answerable_and_serialises() {
        let status = vision_status();
        assert!(status.get("available").is_some());
        assert_eq!(status["dimensions"], 768);
    }

    #[test]
    fn ranking_without_a_query_says_what_is_missing() {
        let error = image_rank(&json!({"paths": ["/tmp/a.png"]})).unwrap_err();
        assert!(error.contains("query"), "{error}");
    }

    #[test]
    fn ranking_without_paths_says_what_is_missing() {
        let error = image_rank(&json!({"query": "a bank"})).unwrap_err();
        assert!(error.contains("paths"), "{error}");
    }

    /// With no model installed the scorer declines rather than failing, so a search still works.
    #[test]
    fn the_scorer_declines_on_an_empty_batch() {
        assert!(score_against("x", &[]).is_none());
    }

    /// Whatever the model's state, asking for nothing must not panic.
    #[test]
    fn ranking_is_never_a_panic() {
        let _ = image_rank(&json!({"query": "x", "paths": []}));
        let _ = image_rank(&json!({}));
    }
}
