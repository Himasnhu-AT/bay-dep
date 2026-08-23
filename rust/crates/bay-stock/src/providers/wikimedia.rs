//! Wikimedia Commons — the archive for things that actually happened.
//!
//! Keyless, and the only one of the four with real depth in historical photographs, documents
//! and banknotes. Its weakness is the reason `bay-vision` exists: the search is over *filenames
//! and wikitext*, so "Barings Bank" returns a Barclays branch on Baring Road. The results are
//! honest about their licences, which is the part that matters here; the ranking is somebody
//! else's problem.

use crate::providers::{Provider, number, stock_id, text};
use crate::{Credit, Licence, Query, StockAsset, StockError};

pub struct Wikimedia;

impl Provider for Wikimedia {
    fn id(&self) -> &'static str {
        "wikimedia"
    }

    fn about(&self) -> &'static str {
        "Wikimedia Commons — historical photographs, documents, banknotes, portraits. \
         Keyless. Deep on real events, shallow on generic b-roll."
    }

    fn hosts(&self) -> &'static [&'static str] {
        &["wikimedia.org"]
    }

    fn search_url(&self, query: &Query, _key: Option<&str>) -> String {
        // `filetype:bitmap` keeps SVG diagrams and PDFs out of an image search, and
        // `filetype:video` is the same switch for footage — Commons has a lot of recorded talks,
        // interviews and archive film. Without this the adapter answered a request for video
        // with stills and said nothing, which is the failure mode this whole crate is supposed
        // not to have. `gsrnamespace=6` is the File: namespace; `iiurlwidth` asks the
        // thumbnailer for a preview the ranker can use without pulling the original.
        //
        // The limit is deliberately larger than the caller's: the whole point of re-ranking is
        // to choose from more candidates than you intend to use, and Commons' own order is the
        // thing being corrected.
        let fetch = (query.limit * 4).clamp(10, 50);
        format!(
            "https://commons.wikimedia.org/w/api.php?action=query&format=json\
             &generator=search&gsrsearch={}&gsrnamespace=6&gsrlimit={fetch}\
             &prop=imageinfo&iiprop=url%7Cextmetadata%7Csize%7Cmediatype&iiurlwidth=800",
            urlencode(&format!("filetype:{} {}", query.file_type(), query.text))
        )
    }

    fn parse(&self, body: &str, query: &Query) -> Result<Vec<StockAsset>, StockError> {
        let root: serde_json::Value =
            serde_json::from_str(body).map_err(|e| StockError::Parse {
                provider: self.id(),
                detail: e.to_string(),
            })?;

        let Some(pages) = root
            .get("query")
            .and_then(|q| q.get("pages"))
            .and_then(|p| p.as_object())
        else {
            // No `pages` key is how the API says "nothing matched". Not an error.
            return Ok(Vec::new());
        };

        let mut out = Vec::new();
        for (key, page) in pages {
            let Some(info) = page
                .get("imageinfo")
                .and_then(|i| i.as_array())
                .and_then(|a| a.first())
            else {
                continue;
            };

            let metadata = info.get("extmetadata");
            let raw_licence = metadata
                .and_then(|m| m.get("LicenseShortName"))
                .and_then(|l| l.get("value"))
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            // The whole result is dropped when the licence is one bay may not cut. Surfacing it
            // as "restricted" would only offer the user a file they cannot legally trim.
            let Some(licence) = Licence::parse_allowed(raw_licence, None, query.allowed) else {
                continue;
            };

            let (Some(url), Some(page_url)) = (text(info, "url"), text(info, "descriptionurl"))
            else {
                continue;
            };
            // `thumburl` is absent for a file the thumbnailer cannot render; the original still
            // works for both, just more expensively.
            let preview_url = text(info, "thumburl").unwrap_or_else(|| url.clone());

            let width = number(info, "width");
            if let (Some(w), Some(min)) = (width, query.min_width)
                && w < min
            {
                continue;
            }

            let title = text(page, "title")
                .unwrap_or_else(|| key.clone())
                .trim_start_matches("File:")
                .to_string();

            let creator = metadata
                .and_then(|m| m.get("Artist"))
                .and_then(|a| a.get("value"))
                .and_then(|v| v.as_str())
                .map(strip_html)
                .filter(|s| !s.is_empty());

            out.push(StockAsset {
                stock_id: stock_id("wikimedia", &key.clone()),
                title,
                kind: query.kind,
                duration_seconds: info
                    .get("duration")
                    .and_then(|v| v.as_f64())
                    .map(|s| (s * 100.0).round() / 100.0),
                licence,
                credit: Credit {
                    creator,
                    source: "Wikimedia Commons".into(),
                    page_url,
                },
                url,
                preview_url,
                width,
                height: number(info, "height"),
                provider: "wikimedia".to_string(),
            });
        }

        // The API hands back an object keyed by page id, whose iteration order is arbitrary.
        // Sorting by key makes a search reproducible, which matters because the ranker's input
        // order shows up in `was` and because a test that depends on hash order is a flaky test.
        out.sort_by(|a, b| a.stock_id.cmp(&b.stock_id));
        Ok(out)
    }
}

/// Commons puts markup around the artist. Strip the tags and repair what stripping them breaks.
///
/// Two things, and the second is only visible in the finished credit line. Commons writes an
/// unknown author as a tooltip span wrapping the word plus the same word again outside it, so
/// dropping the tags concatenates the text nodes into `UnknownUnknown` — which is what got
/// pasted into a credits list before anyone noticed. A repeated adjacent word is always this
/// bug and never a name.
fn strip_html(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut inside = false;
    for ch in raw.chars() {
        match ch {
            '<' => {
                inside = true;
                // The tag was a boundary between two text nodes; keep it as one.
                out.push(' ');
            }
            '>' => inside = false,
            _ if !inside => out.push(ch),
            _ => {}
        }
    }
    // Collapse the whitespace the tags left behind, then drop an adjacent repeat.
    let words: Vec<&str> = out.split_whitespace().collect();
    let mut kept: Vec<&str> = Vec::with_capacity(words.len());
    for word in words {
        if kept
            .last()
            .is_some_and(|prev| prev.eq_ignore_ascii_case(word))
        {
            continue;
        }
        kept.push(word);
    }
    kept.join(" ")
}

fn urlencode(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 2);
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Kind;

    const BODY: &str = r#"{"query":{"pages":{
      "10":{"title":"File:Kids with money.jpg","imageinfo":[{
        "url":"https://upload.wikimedia.org/kids.jpg",
        "thumburl":"https://upload.wikimedia.org/thumb/kids.jpg",
        "descriptionurl":"https://commons.wikimedia.org/wiki/File:Kids.jpg",
        "width":2000,"height":1500,
        "extmetadata":{"LicenseShortName":{"value":"Public domain"},
                       "Artist":{"value":"<a href=\"/wiki/x\">Bundesarchiv</a>"}}}]},
      "20":{"title":"File:Sharealike.jpg","imageinfo":[{
        "url":"https://upload.wikimedia.org/sa.jpg",
        "thumburl":"https://upload.wikimedia.org/thumb/sa.jpg",
        "descriptionurl":"https://commons.wikimedia.org/wiki/File:Sa.jpg",
        "width":900,"height":700,
        "extmetadata":{"LicenseShortName":{"value":"CC BY-SA 3.0"}}}]},
      "30":{"title":"File:Small.jpg","imageinfo":[{
        "url":"https://upload.wikimedia.org/small.jpg",
        "thumburl":"https://upload.wikimedia.org/thumb/small.jpg",
        "descriptionurl":"https://commons.wikimedia.org/wiki/File:Small.jpg",
        "width":120,"height":90,
        "extmetadata":{"LicenseShortName":{"value":"CC0"}}}]}}}}"#;

    #[test]
    fn a_usable_result_carries_its_licence_and_attribution() {
        let found = Wikimedia.parse(BODY, &Query::new("x")).unwrap();
        let kids = found.iter().find(|a| a.title.starts_with("Kids")).unwrap();
        assert_eq!(kids.licence, Licence::PublicDomain);
        assert_eq!(kids.credit.creator.as_deref(), Some("Bundesarchiv"));
        assert_eq!(kids.stock_id, "wikimedia:10");
        assert_eq!(kids.width, Some(2000));
    }

    /// The licence filter runs at parse time, so a ShareAlike file never becomes a candidate the
    /// ranker might put first.
    #[test]
    fn a_sharealike_result_never_reaches_the_caller() {
        let found = Wikimedia.parse(BODY, &Query::new("x")).unwrap();
        assert!(
            !found.iter().any(|a| a.title.contains("Sharealike")),
            "CC BY-SA must be filtered out at parse time"
        );
    }

    #[test]
    fn min_width_drops_a_thumbnail_sized_original() {
        let mut query = Query::new("x");
        query.min_width = Some(800);
        let found = Wikimedia.parse(BODY, &query).unwrap();
        assert!(!found.iter().any(|a| a.title.contains("Small")));
    }

    #[test]
    fn the_file_prefix_is_not_part_of_the_title() {
        let found = Wikimedia.parse(BODY, &Query::new("x")).unwrap();
        assert!(found.iter().all(|a| !a.title.starts_with("File:")));
    }

    /// Arbitrary map order in, stable order out.
    #[test]
    fn results_come_back_in_a_stable_order() {
        let first = Wikimedia.parse(BODY, &Query::new("x")).unwrap();
        let second = Wikimedia.parse(BODY, &Query::new("x")).unwrap();
        let ids = |v: &[StockAsset]| v.iter().map(|a| a.stock_id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(&first), ids(&second));
    }

    /// The defect this pins: asking for video used to return stills and say nothing, because
    /// both the filter and the kind were hardcoded to images.
    #[test]
    fn asking_for_video_searches_for_video_and_labels_it_video() {
        let mut query = Query::new("ocean waves");
        query.kind = Kind::Video;
        let url = Wikimedia.search_url(&query, None);
        assert!(url.contains("filetype%3Avideo"), "{url}");
        assert!(!url.contains("filetype%3Abitmap"), "{url}");

        let body = r#"{"query":{"pages":{"1":{"title":"File:A talk.webm","imageinfo":[{
            "url":"https://upload.wikimedia.org/a.webm",
            "thumburl":"https://upload.wikimedia.org/t.jpg",
            "descriptionurl":"https://commons.wikimedia.org/wiki/File:A.webm",
            "width":1280,"height":720,"duration":373.57,
            "extmetadata":{"LicenseShortName":{"value":"CC BY 3.0"}}}]}}}}"#;
        let found = Wikimedia.parse(body, &query).unwrap();
        assert_eq!(found[0].kind, Kind::Video);
        assert_eq!(found[0].duration_seconds, Some(373.57));
    }

    #[test]
    fn an_image_search_still_asks_for_bitmaps() {
        let url = Wikimedia.search_url(&Query::new("bank"), None);
        assert!(url.contains("filetype%3Abitmap"), "{url}");
        let found = Wikimedia.parse(BODY, &Query::new("x")).unwrap();
        assert!(found.iter().all(|a| a.kind == Kind::Image));
    }

    #[test]
    fn the_search_url_is_https_and_carries_the_query() {
        let url = Wikimedia.search_url(&Query::new("bank of england"), None);
        assert!(url.starts_with("https://commons.wikimedia.org/w/api.php"));
        assert!(url.contains("bank%20of%20england"));
        assert!(url.contains("filetype%3Abitmap"));
    }

    /// More candidates are requested than the caller asked for: re-ranking a list of exactly
    /// `limit` items cannot improve on it.
    #[test]
    fn more_candidates_are_fetched_than_will_be_returned() {
        let mut query = Query::new("x");
        query.limit = 6;
        let url = Wikimedia.search_url(&query, None);
        assert!(url.contains("gsrlimit=24"), "{url}");
    }

    #[test]
    fn html_in_the_artist_field_is_stripped() {
        assert_eq!(
            strip_html("<a href=\"/x\">Ada  Lovelace</a>"),
            "Ada Lovelace"
        );
        assert_eq!(strip_html("plain"), "plain");
    }

    #[test]
    fn a_file_with_no_thumbnail_falls_back_to_the_original() {
        let body = r#"{"query":{"pages":{"1":{"title":"File:No thumb.jpg","imageinfo":[{
            "url":"https://upload.wikimedia.org/o.jpg",
            "descriptionurl":"https://commons.wikimedia.org/wiki/File:O.jpg",
            "width":900,"height":900,
            "extmetadata":{"LicenseShortName":{"value":"CC0"}}}]}}}}"#;
        let found = Wikimedia.parse(body, &Query::new("x")).unwrap();
        assert_eq!(found[0].preview_url, found[0].url);
    }
}
