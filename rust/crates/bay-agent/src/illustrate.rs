//! Joining the archive to the encoder.
//!
//! `bay-stock` can ask an archive and bring a preview down. `bay-vision` can say what is in a
//! JPEG. Neither depends on the other, and the join has to live somewhere both the editor path
//! and the headless path can reach — which is here, because `bay-ui` routes through this crate
//! and `bay-mcp` depends on it.
//!
//! One implementation, two callers. The alternative — a copy in `bay-mcp` for the headless
//! server and another in the editor — is exactly the divergence this workspace keeps finding in
//! `add_image`, where the same verb behaves differently depending on whether a window is open.

use serde_json::Value;

/// `stock_search`, with the results ordered by what is in the pictures rather than by what is in
/// their filenames.
///
/// The re-rank is best-effort by design. No vision component, no network for the previews, a
/// corrupt thumbnail — each falls back to the archive's own ordering, and the result says which
/// order it is in. A search that returns something imperfect is worth far more than one that
/// fails, and the caller is told plainly which they got.
pub fn stock_search(args: &Value) -> Result<Value, String> {
    let transport = bay_stock::mcp::transport();

    let score = |query: &str, assets: &[bay_stock::StockAsset]| -> Option<Vec<f32>> {
        // Ask cheaply first: with nothing installed this costs a stat, not 780 MB off disk.
        if !bay_vision::status().available {
            return None;
        }
        let first = assets.first()?;
        let provider = bay_stock::provider_named(&first.provider).ok()?;
        let previews = bay_stock::fetch_previews(assets, &transport, provider.hosts());

        let usable: Vec<std::path::PathBuf> = previews.iter().flatten().cloned().collect();
        let scored = bay_vision::mcp::score_against(query, &usable)?;

        // Scores come back only for the previews that downloaded. Walk the original list and
        // give a candidate whose thumbnail failed a zero rather than dropping it: ranking a
        // picture last is a smaller mistake than making it invisible.
        let mut next = scored.into_iter();
        Some(
            previews
                .iter()
                .map(|preview| match preview {
                    Some(_) => next.next().unwrap_or(0.0),
                    None => 0.0,
                })
                .collect(),
        )
    };

    bay_stock::mcp::stock_search(args, &transport, bay_stock::mcp::Rerank::With(&score))
}

/// `stock_fetch`, unchanged from the crate's own — here so both transports route identically.
pub fn stock_fetch(args: &Value) -> Result<Value, String> {
    bay_stock::mcp::stock_fetch(args, &bay_stock::mcp::transport())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The argument check must come back before any network call, so a malformed request is
    /// cheap and does not send a half-formed query to somebody else's server.
    #[test]
    fn a_search_without_a_query_is_refused_locally() {
        let error = stock_search(&json!({})).unwrap_err();
        assert!(error.contains("query"), "{error}");
    }

    #[test]
    fn an_unknown_provider_is_refused_locally() {
        let error = stock_search(&json!({"query": "x", "provider": "getty"})).unwrap_err();
        assert!(error.contains("wikimedia"), "{error}");
    }

    #[test]
    fn a_fetch_without_an_asset_is_refused_locally() {
        let error = stock_fetch(&json!({})).unwrap_err();
        assert!(error.contains("stock_search"), "{error}");
    }
}
