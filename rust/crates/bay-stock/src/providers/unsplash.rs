//! Unsplash — modern editorial photography. Needs a free key.
//!
//! Wired and dormant, like [`super::pexels`]. The Unsplash licence permits commercial use and
//! modification and does not require attribution, though the API terms ask that you credit the
//! photographer; bay records the credit either way, so the user has it whether or not they
//! choose to show it.

use crate::providers::{Provider, number, stock_id, text};
use crate::{Credit, Kind, Licence, Query, StockAsset, StockError};

pub struct Unsplash;

impl Provider for Unsplash {
    fn id(&self) -> &'static str {
        "unsplash"
    }

    fn about(&self) -> &'static str {
        "Unsplash — modern editorial photography, strong on mood and texture. \
         Needs a free API key. No historical archive."
    }

    fn key_variable(&self) -> Option<&'static str> {
        Some("UNSPLASH_ACCESS_KEY")
    }

    fn hosts(&self) -> &'static [&'static str] {
        &["unsplash.com"]
    }

    fn search_url(&self, query: &Query, _key: Option<&str>) -> String {
        let fetch = (query.limit * 3).clamp(10, 30);
        format!(
            "https://api.unsplash.com/search/photos?query={}&per_page={fetch}",
            urlencode(&query.text)
        )
    }

    fn parse(&self, body: &str, query: &Query) -> Result<Vec<StockAsset>, StockError> {
        let root: serde_json::Value =
            serde_json::from_str(body).map_err(|e| StockError::Parse {
                provider: self.id(),
                detail: e.to_string(),
            })?;
        let Some(results) = root.get("results").and_then(|r| r.as_array()) else {
            return Ok(Vec::new());
        };

        let mut out = Vec::new();
        for item in results {
            let Some(id) = text(item, "id") else { continue };
            let urls = item.get("urls");
            let (Some(url), Some(preview_url)) = (
                urls.and_then(|u| text(u, "full")),
                urls.and_then(|u| text(u, "small")),
            ) else {
                continue;
            };

            let width = number(item, "width");
            if let (Some(w), Some(min)) = (width, query.min_width)
                && w < min
            {
                continue;
            }

            let page_url = item
                .get("links")
                .and_then(|l| text(l, "html"))
                .unwrap_or_default();

            out.push(StockAsset {
                stock_id: stock_id("unsplash", &id),
                title: text(item, "description")
                    .or_else(|| text(item, "alt_description"))
                    .unwrap_or_else(|| "untitled".into()),
                kind: Kind::Image,
                licence: Licence::Permissive {
                    name: "Unsplash licence".into(),
                },
                credit: Credit {
                    creator: item.get("user").and_then(|u| text(u, "name")),
                    source: "Unsplash".into(),
                    page_url,
                },
                url,
                preview_url,
                width,
                height: number(item, "height"),
                provider: "unsplash".to_string(),
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
    fn a_result_becomes_an_asset_with_its_photographer() {
        let body = r#"{"results":[{"id":"xyz","width":5000,"height":3000,
          "description":"a foggy street","urls":{"full":"https://images.unsplash.com/f.jpg",
          "small":"https://images.unsplash.com/s.jpg"},
          "links":{"html":"https://unsplash.com/photos/xyz"},
          "user":{"name":"Grace Hopper"}}]}"#;
        let found = Unsplash.parse(body, &Query::new("fog")).unwrap();
        assert_eq!(found[0].stock_id, "unsplash:xyz");
        assert_eq!(found[0].credit.creator.as_deref(), Some("Grace Hopper"));
        assert_eq!(found[0].title, "a foggy street");
    }

    /// Unsplash leaves `description` null far more often than not; the alt text is the fallback
    /// that keeps a result describable.
    #[test]
    fn a_missing_description_falls_back_to_the_alt_text() {
        let body = r#"{"results":[{"id":"a","description":null,
          "alt_description":"snow on a roof","width":100,"height":100,
          "urls":{"full":"https://images.unsplash.com/f.jpg","small":"https://images.unsplash.com/s.jpg"},
          "links":{"html":"https://unsplash.com/photos/a"},"user":{"name":"x"}}]}"#;
        let found = Unsplash.parse(body, &Query::new("snow")).unwrap();
        assert_eq!(found[0].title, "snow on a roof");
    }

    #[test]
    fn the_key_is_not_in_the_search_url() {
        let url = Unsplash.search_url(&Query::new("x"), Some("secret"));
        assert!(!url.contains("secret"), "{url}");
    }
}
