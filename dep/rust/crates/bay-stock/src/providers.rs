//! The archives bay knows how to ask.
//!
//! Two need no key and are the default. Two are wired and stay dormant until the user exports a
//! key — dormant rather than absent, so `stock_status` can say "this exists and here is what it
//! wants" instead of the capability simply not being there.

use crate::http::{HttpError, Transport, is_allowed};
use crate::{Query, StockAsset, StockError};

mod openverse;
mod pexels;
mod unsplash;
mod wikimedia;

/// One archive.
pub trait Provider: Send + Sync {
    fn id(&self) -> &'static str;

    /// A one-line account of what this archive is *good at*, so a caller picks on substance
    /// rather than alphabetically.
    fn about(&self) -> &'static str;

    /// The environment variable holding its key, if it needs one.
    fn key_variable(&self) -> Option<&'static str> {
        None
    }

    /// Hosts this provider may serve downloads from.
    fn hosts(&self) -> &'static [&'static str];

    /// Build the search URL.
    fn search_url(&self, query: &Query, key: Option<&str>) -> String;

    /// Turn a response body into assets, dropping anything bay may not cut.
    fn parse(&self, body: &str, query: &Query) -> Result<Vec<StockAsset>, StockError>;

    /// Whether this provider can be used right now.
    fn configured(&self) -> bool {
        match self.key_variable() {
            None => true,
            Some(variable) => std::env::var(variable).is_ok_and(|v| !v.trim().is_empty()),
        }
    }
}

/// Every provider, keyless ones first.
pub fn providers() -> Vec<Box<dyn Provider>> {
    vec![
        Box::new(wikimedia::Wikimedia),
        Box::new(openverse::Openverse),
        Box::new(pexels::Pexels),
        Box::new(unsplash::Unsplash),
    ]
}

pub fn all_providers() -> Vec<&'static str> {
    vec!["wikimedia", "openverse", "pexels", "unsplash"]
}

pub fn provider_named(id: &str) -> Result<Box<dyn Provider>, StockError> {
    providers()
        .into_iter()
        .find(|p| p.id() == id)
        .ok_or_else(|| StockError::UnknownProvider {
            name: id.to_string(),
        })
}

/// Search one provider.
///
/// The download URL of every returned asset is checked against the provider's host allowlist
/// here, at the boundary, rather than at fetch time — so a compromised or redirecting API cannot
/// even put an off-host URL in front of the caller.
pub fn search(
    provider: &dyn Provider,
    transport: &dyn Transport,
    query: &Query,
) -> Result<Vec<StockAsset>, StockError> {
    let key = match provider.key_variable() {
        None => None,
        Some(variable) => match std::env::var(variable) {
            Ok(value) if !value.trim().is_empty() => Some(value),
            _ => {
                return Err(StockError::NeedsKey {
                    provider: provider.id(),
                    variable,
                });
            }
        },
    };

    let url = provider.search_url(query, key.as_deref());
    let mut response = transport.get(&url).map_err(|error| match error {
        HttpError::Transport(detail) => StockError::Network {
            provider: provider.id(),
            detail,
        },
        HttpError::Status { status, .. } => StockError::Network {
            provider: provider.id(),
            detail: format!("HTTP {status}"),
        },
    })?;

    let mut body = String::new();
    {
        use std::io::Read;
        // A search response is JSON and small. The cap stops a provider that answers a search
        // with a video from being read into memory forever.
        let mut limited = (&mut response.body).take(8 * 1024 * 1024);
        limited
            .read_to_string(&mut body)
            .map_err(|e| StockError::Network {
                provider: provider.id(),
                detail: e.to_string(),
            })?;
    }

    let assets = provider.parse(&body, query)?;
    Ok(assets
        .into_iter()
        .filter(|asset| {
            is_allowed(&asset.url, provider.hosts())
                && is_allowed(&asset.preview_url, provider.hosts())
        })
        .take(query.limit)
        .collect())
}

/// Shared by the adapters: a `serde_json::Value` field as a trimmed, non-empty string.
fn text(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn number(value: &serde_json::Value, key: &str) -> Option<u32> {
    value.get(key).and_then(|v| v.as_u64()).map(|n| n as u32)
}

/// The handle `stock_fetch` takes: `provider:id`.
///
/// Adapters build `StockAsset` with named fields directly rather than through a constructor —
/// a ten-positional-argument helper is easier to pass wrong than the struct it wraps.
fn stock_id(provider: &str, id: &str) -> String {
    format!("{provider}:{id}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::Response;

    /// Serves a fixed body, and records what was asked for.
    pub(crate) struct Canned {
        pub body: String,
        pub content_type: &'static str,
        pub asked: std::sync::Mutex<Vec<String>>,
    }

    impl Canned {
        pub fn json(body: &str) -> Self {
            Self {
                body: body.to_string(),
                content_type: "application/json",
                asked: std::sync::Mutex::new(Vec::new()),
            }
        }
    }

    impl Transport for Canned {
        fn get(&self, url: &str) -> Result<Response, HttpError> {
            self.asked.lock().unwrap().push(url.to_string());
            Ok(Response {
                status: 200,
                content_type: self.content_type.to_string(),
                body: Box::new(std::io::Cursor::new(self.body.clone().into_bytes())),
            })
        }
    }

    #[test]
    fn every_provider_has_a_distinct_id_and_a_host_allowlist() {
        let mut seen = std::collections::HashSet::new();
        for provider in providers() {
            assert!(
                seen.insert(provider.id()),
                "duplicate provider id {}",
                provider.id()
            );
            assert!(
                !provider.hosts().is_empty(),
                "{} must declare the hosts it may serve from — an empty allowlist \
                 would let a compromised API redirect anywhere",
                provider.id()
            );
            assert!(
                provider.about().len() > 20,
                "{} should say what it is good at",
                provider.id()
            );
        }
        assert_eq!(seen.len(), all_providers().len());
    }

    /// The keyless pair must stay keyless: they are what makes the capability work out of the box.
    #[test]
    fn the_default_providers_need_no_key() {
        assert!(
            provider_named("wikimedia")
                .unwrap()
                .key_variable()
                .is_none()
        );
        assert!(
            provider_named("openverse")
                .unwrap()
                .key_variable()
                .is_none()
        );
    }

    #[test]
    fn a_keyed_provider_says_what_it_wants_instead_of_failing_obscurely() {
        let pexels = provider_named("pexels").unwrap();
        assert_eq!(pexels.key_variable(), Some("PEXELS_API_KEY"));
        // With no key set, searching must name the variable rather than making a request.
        if std::env::var("PEXELS_API_KEY").is_err() {
            let transport = Canned::json("{}");
            let error = search(pexels.as_ref(), &transport, &Query::new("x")).unwrap_err();
            assert!(matches!(error, StockError::NeedsKey { .. }), "{error}");
            assert!(
                transport.asked.lock().unwrap().is_empty(),
                "nothing should have been requested without a key"
            );
        }
    }

    #[test]
    fn an_unknown_provider_names_the_ones_that_exist() {
        let message = match provider_named("shutterstock") {
            Err(error) => error.to_string(),
            Ok(_) => panic!("shutterstock is not a provider"),
        };
        assert!(message.contains("wikimedia"), "{message}");
    }

    /// The boundary check: a result whose download URL is off-host never reaches the caller,
    /// even though the provider returned it.
    #[test]
    fn an_off_host_result_is_dropped_at_the_boundary() {
        let body = r#"{"query":{"pages":{"1":{"title":"File:Good.jpg","imageinfo":[{
            "url":"https://upload.wikimedia.org/good.jpg",
            "thumburl":"https://upload.wikimedia.org/thumb/good.jpg",
            "descriptionurl":"https://commons.wikimedia.org/wiki/File:Good.jpg",
            "width":800,"height":600,
            "extmetadata":{"LicenseShortName":{"value":"Public domain"}}}]},
          "2":{"title":"File:Bad.jpg","imageinfo":[{
            "url":"https://evil.test/bad.jpg",
            "thumburl":"https://evil.test/thumb.jpg",
            "descriptionurl":"https://commons.wikimedia.org/wiki/File:Bad.jpg",
            "width":800,"height":600,
            "extmetadata":{"LicenseShortName":{"value":"Public domain"}}}]}}}}"#;
        let provider = provider_named("wikimedia").unwrap();
        let found = search(provider.as_ref(), &Canned::json(body), &Query::new("x")).unwrap();
        assert_eq!(found.len(), 1, "the off-host result must be dropped");
        assert!(found[0].url.contains("upload.wikimedia.org"));
    }

    /// Searching reads, it does not write. Nothing lands on disk until `stock_fetch`.
    #[test]
    fn searching_makes_exactly_one_request() {
        let transport = Canned::json(r#"{"query":{"pages":{}}}"#);
        let provider = provider_named("wikimedia").unwrap();
        search(provider.as_ref(), &transport, &Query::new("bank")).unwrap();
        assert_eq!(transport.asked.lock().unwrap().len(), 1);
    }

    #[test]
    fn the_limit_is_honoured() {
        let mut pages = Vec::new();
        for i in 0..30 {
            pages.push(format!(
                r#""{i}":{{"title":"File:P{i}.jpg","imageinfo":[{{
                "url":"https://upload.wikimedia.org/p{i}.jpg",
                "thumburl":"https://upload.wikimedia.org/t{i}.jpg",
                "descriptionurl":"https://commons.wikimedia.org/wiki/File:P{i}.jpg",
                "width":800,"height":600,
                "extmetadata":{{"LicenseShortName":{{"value":"CC0"}}}}}}]}}"#
            ));
        }
        let body = format!(r#"{{"query":{{"pages":{{{}}}}}}}"#, pages.join(","));
        let mut query = Query::new("x");
        query.limit = 5;
        let provider = provider_named("wikimedia").unwrap();
        let found = search(provider.as_ref(), &Canned::json(&body), &query).unwrap();
        assert_eq!(found.len(), 5);
    }

    /// Malformed JSON must be a typed parse error naming the provider, not a panic.
    #[test]
    fn a_malformed_response_is_an_error_not_a_panic() {
        let provider = provider_named("wikimedia").unwrap();
        let error = search(
            provider.as_ref(),
            &Canned::json("{not json at all"),
            &Query::new("x"),
        )
        .unwrap_err();
        assert!(matches!(error, StockError::Parse { .. }), "{error}");
    }

    /// An empty archive is an empty answer, not an error — the same distinction the sound
    /// library draws. "Nothing matched" is information; an error is a dead end.
    #[test]
    fn no_results_is_an_empty_list_not_an_error() {
        let provider = provider_named("wikimedia").unwrap();
        let found = search(
            provider.as_ref(),
            &Canned::json(r#"{"batchcomplete":""}"#),
            &Query::new("x"),
        )
        .unwrap();
        assert!(found.is_empty());
    }
}
