//! Pexels — modern, high-production-value stock. Needs a free key.
//!
//! Wired and dormant. With no `PEXELS_API_KEY` in the environment nothing here makes a request;
//! `stock_status` reports it as a provider that exists and says what it wants, which is more
//! useful than the capability silently not being there.
//!
//! The Pexels licence is its own — free to use and to modify, commercially, with attribution
//! "appreciated" rather than required, and one hard prohibition: you may not redistribute the
//! photos *as* stock. That is compatible with cutting them into a film and incompatible with
//! bay's cache ever becoming a shareable pack, which is why the cache lives under the user's own
//! data directory and is never assembled into anything.

use crate::providers::{Provider, number, stock_id, text};
use crate::{Credit, Kind, Licence, Query, StockAsset, StockError};

pub struct Pexels;

impl Provider for Pexels {
    fn id(&self) -> &'static str {
        "pexels"
    }

    fn about(&self) -> &'static str {
        "Pexels — modern, high production value stock photography. Needs a free API key. \
         Strong on contemporary b-roll, useless for historical subjects."
    }

    fn key_variable(&self) -> Option<&'static str> {
        Some("PEXELS_API_KEY")
    }

    fn hosts(&self) -> &'static [&'static str] {
        &["pexels.com"]
    }

    fn search_url(&self, query: &Query, _key: Option<&str>) -> String {
        // The key travels in the Authorization header, not the URL — a key in a URL ends up in
        // logs, in `asked` lists and in error messages.
        let fetch = (query.limit * 3).clamp(10, 80);
        format!(
            "https://api.pexels.com/v1/search?query={}&per_page={fetch}",
            urlencode(&query.text)
        )
    }

    fn parse(&self, body: &str, query: &Query) -> Result<Vec<StockAsset>, StockError> {
        let root: serde_json::Value =
            serde_json::from_str(body).map_err(|e| StockError::Parse {
                provider: self.id(),
                detail: e.to_string(),
            })?;
        let Some(photos) = root.get("photos").and_then(|p| p.as_array()) else {
            return Ok(Vec::new());
        };

        let mut out = Vec::new();
        for photo in photos {
            let Some(id) = photo.get("id").and_then(|v| v.as_u64()) else {
                continue;
            };
            let sources = photo.get("src");
            let (Some(url), Some(preview_url)) = (
                sources.and_then(|s| text(s, "original")),
                sources.and_then(|s| text(s, "medium")),
            ) else {
                continue;
            };

            let width = number(photo, "width");
            if let (Some(w), Some(min)) = (width, query.min_width)
                && w < min
            {
                continue;
            }

            out.push(StockAsset {
                stock_id: stock_id("pexels", &id.to_string()),
                title: text(photo, "alt").unwrap_or_else(|| "untitled".into()),
                kind: Kind::Image,
                duration_seconds: None,
                licence: Licence::Permissive {
                    name: "Pexels licence".into(),
                },
                credit: Credit {
                    creator: text(photo, "photographer"),
                    source: "Pexels".into(),
                    page_url: text(photo, "url").unwrap_or_default(),
                },
                url,
                preview_url,
                width,
                height: number(photo, "height"),
                provider: "pexels".to_string(),
            });
        }
        Ok(out)
    }
}

fn urlencode(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            b' ' => "+".to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_photo_becomes_an_asset_with_the_pexels_licence() {
        let body = r#"{"photos":[{"id":123,"width":4000,"height":3000,
          "url":"https://www.pexels.com/photo/123/","photographer":"Ada",
          "alt":"a desk","src":{"original":"https://images.pexels.com/p/123.jpg",
          "medium":"https://images.pexels.com/p/123-m.jpg"}}]}"#;
        let found = Pexels.parse(body, &Query::new("desk")).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].stock_id, "pexels:123");
        assert_eq!(
            found[0].licence,
            Licence::Permissive {
                name: "Pexels licence".into()
            }
        );
        assert_eq!(found[0].credit.creator.as_deref(), Some("Ada"));
    }

    /// The key must never appear in a URL — URLs are logged and echoed back in errors.
    #[test]
    fn the_key_is_not_in_the_search_url() {
        let url = Pexels.search_url(&Query::new("x"), Some("secret-key-value"));
        assert!(!url.contains("secret-key-value"), "{url}");
    }

    #[test]
    fn an_error_body_is_empty_rather_than_a_panic() {
        assert!(
            Pexels
                .parse(r#"{"error":"unauthorised"}"#, &Query::new("x"))
                .unwrap()
                .is_empty()
        );
    }
}
