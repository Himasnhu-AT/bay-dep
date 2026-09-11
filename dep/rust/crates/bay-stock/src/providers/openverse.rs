//! Openverse — the aggregator, for b-roll rather than for events.
//!
//! Keyless, and it federates Flickr, museums and a long tail of galleries. Its licence field is
//! the short CC code (`by`, `by-nc-sa`, `cc0`, `pdm`) which maps cleanly onto what bay will and
//! will not cut.

use crate::providers::{Provider, number, stock_id, text};
use crate::{Credit, Kind, Licence, Query, StockAsset, StockError};

pub struct Openverse;

impl Provider for Openverse {
    fn id(&self) -> &'static str {
        "openverse"
    }

    fn about(&self) -> &'static str {
        "Openverse — a CC aggregator over Flickr, museums and galleries. Keyless. \
         Good for generic b-roll, weaker on specific historical events."
    }

    fn hosts(&self) -> &'static [&'static str] {
        // Openverse serves *metadata*; the files themselves live on the source's own CDN, so the
        // allowlist has to name those. Anything from a source not listed here is dropped rather
        // than fetched — a smaller archive is a fair price for not following an arbitrary host.
        &[
            "openverse.org",
            "staticflickr.com",
            "flickr.com",
            "wikimedia.org",
            "smithsonianmag.com",
            "si.edu",
            "nasa.gov",
            "rawpixel.com",
            "metmuseum.org",
            "clevelandart.org",
            "statliga.se",
            "nypl.org",
            // Audio comes from the source's own CDN too — Freesound serves nearly all of the
            // CC-BY music the audio endpoint returns.
            "freesound.org",
            "jamendo.com",
            "archive.org",
            "ccmixter.org",
        ]
    }

    fn search_url(&self, query: &Query, _key: Option<&str>) -> String {
        let fetch = (query.limit * 4).clamp(10, 50);
        if query.kind == Kind::Audio {
            // The audio endpoint takes the same filters and answers the same licence codes, so
            // everything below about what bay will and will not cut applies unchanged to music.
            return format!(
                "https://api.openverse.org/v1/audio/?q={}&page_size={fetch}\
                 &license_type=commercial,modification",
                urlencode(&query.text)
            );
        }
        // `license_type=commercial,modification` asks the API for exactly the two freedoms an
        // editor needs. It is belt and braces — `Licence::parse` refuses the rest anyway — but
        // filtering server-side means the candidate list is not mostly discards.
        format!(
            "https://api.openverse.org/v1/images/?q={}&page_size={fetch}\
             &license_type=commercial,modification",
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
        if query.kind == Kind::Audio {
            return Ok(self.parse_audio(results, query));
        }

        let mut out = Vec::new();
        for item in results {
            let raw_licence = text(item, "license").unwrap_or_default();
            let version = text(item, "license_version");
            let Some(licence) =
                Licence::parse_allowed(&raw_licence, version.as_deref(), query.allowed)
            else {
                continue;
            };

            let (Some(id), Some(url)) = (text(item, "id"), text(item, "url")) else {
                continue;
            };

            let width = number(item, "width");
            if let (Some(w), Some(min)) = (width, query.min_width)
                && w < min
            {
                continue;
            }

            let preview_url = text(item, "thumbnail").unwrap_or_else(|| url.clone());
            let page_url = text(item, "foreign_landing_url").unwrap_or_else(|| url.clone());

            out.push(StockAsset {
                stock_id: stock_id("openverse", &id),
                title: text(item, "title").unwrap_or_else(|| "untitled".into()),
                kind: Kind::Image,
                duration_seconds: None,
                licence,
                credit: Credit {
                    creator: text(item, "creator"),
                    source: text(item, "source").unwrap_or_else(|| "Openverse".into()),
                    page_url,
                },
                url,
                preview_url,
                width,
                height: number(item, "height"),
                provider: "openverse".to_string(),
            });
        }
        Ok(out)
    }
}

impl Openverse {
    /// The audio shape. Openverse reports length in milliseconds and has no thumbnail worth
    /// ranking, so the preview is the audio itself — nothing looks at it, and `bay-vision`
    /// scores pictures rather than sound.
    fn parse_audio(&self, results: &[serde_json::Value], query: &Query) -> Vec<StockAsset> {
        let mut out = Vec::new();
        for item in results {
            let raw_licence = text(item, "license").unwrap_or_default();
            let version = text(item, "license_version");
            let Some(licence) =
                Licence::parse_allowed(&raw_licence, version.as_deref(), query.allowed)
            else {
                continue;
            };
            let (Some(id), Some(url)) = (text(item, "id"), text(item, "url")) else {
                continue;
            };
            let seconds = item
                .get("duration")
                .and_then(|v| v.as_f64())
                .map(|ms| (ms / 1000.0 * 100.0).round() / 100.0);
            out.push(StockAsset {
                stock_id: stock_id("openverse", &id),
                title: text(item, "title").unwrap_or_else(|| "untitled".into()),
                kind: Kind::Audio,
                duration_seconds: seconds,
                licence,
                credit: Credit {
                    creator: text(item, "creator"),
                    source: text(item, "source").unwrap_or_else(|| "Openverse".into()),
                    page_url: text(item, "foreign_landing_url").unwrap_or_else(|| url.clone()),
                },
                preview_url: url.clone(),
                url,
                width: None,
                height: None,
                provider: "openverse".to_string(),
            });
        }
        out
    }
}

fn urlencode(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 2);
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const BODY: &str = r#"{"result_count":3,"results":[
      {"id":"aaa","title":"Trading floor","url":"https://live.staticflickr.com/a.jpg",
       "thumbnail":"https://api.openverse.org/t/aaa","foreign_landing_url":"https://www.flickr.com/p/1",
       "creator":"David C. Foster","license":"by","license_version":"2.0",
       "source":"flickr","width":1024,"height":768},
      {"id":"bbb","title":"No derivatives","url":"https://live.staticflickr.com/b.jpg",
       "thumbnail":"https://api.openverse.org/t/bbb","foreign_landing_url":"https://www.flickr.com/p/2",
       "creator":"x","license":"by-nd","license_version":"2.0",
       "source":"flickr","width":1024,"height":768},
      {"id":"ccc","title":"Public domain mark","url":"https://live.staticflickr.com/c.jpg",
       "thumbnail":"https://api.openverse.org/t/ccc","foreign_landing_url":"https://www.flickr.com/p/3",
       "license":"pdm","source":"flickr","width":1024,"height":768}]}"#;

    #[test]
    fn a_cc_by_result_keeps_its_version_and_creator() {
        let found = Openverse.parse(BODY, &Query::new("x")).unwrap();
        let first = found
            .iter()
            .find(|a| a.stock_id == "openverse:aaa")
            .unwrap();
        assert_eq!(
            first.licence,
            Licence::CcBy {
                version: "2.0".into()
            }
        );
        assert_eq!(first.credit.creator.as_deref(), Some("David C. Foster"));
        assert!(first.licence.needs_credit());
    }

    /// ND is the one people get wrong: it looks permissive and forbids the only thing an editor
    /// does.
    #[test]
    fn a_no_derivatives_result_never_reaches_the_caller() {
        let found = Openverse.parse(BODY, &Query::new("x")).unwrap();
        assert!(!found.iter().any(|a| a.stock_id == "openverse:bbb"));
    }

    #[test]
    fn the_public_domain_mark_needs_no_credit() {
        let found = Openverse.parse(BODY, &Query::new("x")).unwrap();
        let pd = found
            .iter()
            .find(|a| a.stock_id == "openverse:ccc")
            .unwrap();
        assert_eq!(pd.licence, Licence::PublicDomain);
        assert!(!pd.licence.needs_credit());
    }

    #[test]
    fn the_search_url_asks_for_commercial_and_modifiable_only() {
        let url = Openverse.search_url(&Query::new("trading floor"), None);
        assert!(url.starts_with("https://api.openverse.org/v1/images/"));
        assert!(
            url.contains("license_type=commercial%2Cmodification")
                || url.contains("license_type=commercial,modification")
        );
        assert!(url.contains("trading+floor"));
    }

    const AUDIO: &str = r#"{"result_count":2,"results":[
      {"id":"m1","title":"Cinematic Tension","url":"https://cdn.freesound.org/previews/456/a.mp3",
       "foreign_landing_url":"https://freesound.org/s/456104/","creator":"klankbeeld",
       "license":"by","license_version":"4.0","source":"freesound","duration":9750},
      {"id":"m2","title":"Sharealike loop","url":"https://cdn.freesound.org/previews/263/b.mp3",
       "foreign_landing_url":"https://freesound.org/s/263998/","creator":"x",
       "license":"by-sa","license_version":"4.0","source":"freesound","duration":30750}]}"#;

    fn audio_query() -> Query {
        let mut q = Query::new("cinematic tension");
        q.kind = Kind::Audio;
        q
    }

    #[test]
    fn a_music_result_carries_its_length_in_seconds() {
        let found = Openverse.parse(AUDIO, &audio_query()).unwrap();
        let first = found.iter().find(|a| a.stock_id == "openverse:m1").unwrap();
        assert_eq!(first.kind, Kind::Audio);
        assert_eq!(
            first.duration_seconds,
            Some(9.75),
            "milliseconds must become seconds"
        );
        assert_eq!(first.credit.creator.as_deref(), Some("klankbeeld"));
        assert!(first.licence.needs_credit());
    }

    /// The licence policy is one policy. Music is not a special case that gets to be copyleft
    /// because it is harder to find.
    #[test]
    fn sharealike_music_is_filtered_out_like_everything_else() {
        let found = Openverse.parse(AUDIO, &audio_query()).unwrap();
        assert!(!found.iter().any(|a| a.stock_id == "openverse:m2"));
        let mut opted = audio_query();
        opted.allowed = crate::Allowed::with_share_alike();
        let found = Openverse.parse(AUDIO, &opted).unwrap();
        assert!(found.iter().any(|a| a.stock_id == "openverse:m2"));
    }

    #[test]
    fn searching_for_music_asks_the_audio_endpoint() {
        let url = Openverse.search_url(&audio_query(), None);
        assert!(url.contains("/v1/audio/"), "{url}");
        assert!(!url.contains("/v1/images/"), "{url}");
        let image = Openverse.search_url(&Query::new("x"), None);
        assert!(image.contains("/v1/images/"), "{image}");
    }

    #[test]
    fn an_empty_result_set_is_empty_not_an_error() {
        let found = Openverse
            .parse(r#"{"result_count":0,"results":[]}"#, &Query::new("x"))
            .unwrap();
        assert!(found.is_empty());
    }

    #[test]
    fn a_response_without_a_results_key_is_empty_not_an_error() {
        let found = Openverse.parse(r#"{"detail":"throttled"}"#, &Query::new("x"));
        assert!(found.unwrap().is_empty());
    }
}
