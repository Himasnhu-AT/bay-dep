//! The tools that expose searching and fetching to an agent.
//!
//! Plain JSON in, plain JSON out, so `bay-mcp` needs to know none of this crate's types — the
//! same shape `bay_provision::mcp` uses, and for the same reason.
//!
//! Ranking lives here rather than in `bay-vision` because it is the *composition* that is worth
//! having: a keyword archive returns candidates in an order that has nothing to do with what is
//! in the pictures, and SigLIP puts them in one that does. Either half alone is much less
//! useful than the two joined.

use serde_json::{Value, json};

use crate::{Allowed, Http, Kind, Query, StockAsset, Transport, cache, library, providers};

/// `stock_status`: which archives can be reached, and whether re-ranking is available.
pub fn stock_status() -> Value {
    let providers: Vec<Value> = providers::providers()
        .iter()
        .map(|p| {
            json!({
                "id": p.id(),
                "about": p.about(),
                "configured": p.configured(),
                "needsKey": p.key_variable(),
            })
        })
        .collect();

    let cache_dir = cache::cache_dir();
    let (files, bytes) = cache_dir.as_deref().map(measure).unwrap_or((0, 0));

    json!({
        "providers": providers,
        "cacheDir": cache_dir,
        "cachedFiles": files,
        "cachedBytes": bytes,
        "hint": "stock_search sends your query to a third party — it is the one part of bay \
                 that talks to anyone. Nothing is downloaded until you call stock_fetch.",
    })
}

fn measure(dir: &std::path::Path) -> (u64, u64) {
    let mut files = 0;
    let mut bytes = 0;
    let Ok(providers) = std::fs::read_dir(dir) else {
        return (0, 0);
    };
    for provider in providers.filter_map(Result::ok) {
        let Ok(entries) = std::fs::read_dir(provider.path()) else {
            continue;
        };
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json") {
                continue;
            }
            if let Ok(meta) = entry.metadata() {
                files += 1;
                bytes += meta.len();
            }
        }
    }
    (files, bytes)
}

/// Scores a query against a batch of candidates: one score per candidate, same order.
///
/// `None` means "could not score" — no model installed, no previews downloaded — and the caller
/// falls back to the archive's own order rather than failing the search.
pub type Scorer<'a> = &'a dyn Fn(&str, &[StockAsset]) -> Option<Vec<f32>>;

/// How the candidates should be ordered.
pub enum Rerank<'a> {
    /// Leave the provider's own keyword order alone.
    None,
    /// Score every candidate's preview against the query with SigLIP.
    With(Scorer<'a>),
}

/// `stock_search`: ask an archive, then put the answers in a useful order.
///
/// # The two halves want different sentences
///
/// This is the thing that is easy to get wrong and produces zero results rather than bad ones.
/// A keyword archive matches your words against filenames and wikitext, so it wants
/// `"hyperinflation 1923"` and returns nothing at all for a sentence. SigLIP matches against
/// what is *in* the frame, and gets much better as the description gets longer and more
/// concrete — `"children stacking bundles of banknotes like toy bricks"` beats `"money"` by a
/// wide margin.
///
/// Measured on Wikimedia Commons: `"hyperinflation 1923"` returns 6 results and the same
/// intent written as a sentence returns 0. So `query` goes to the archive and `describe` goes
/// to the encoder, and `describe` defaults to `query` when only one is given.
pub fn stock_search(
    args: &Value,
    transport: &dyn Transport,
    rerank: Rerank,
) -> Result<Value, String> {
    let text = args
        .get("query")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(
            "stock_search needs a query — the keywords the archive should match, \
             like \"hyperinflation 1923\"",
        )?;

    // What the picture should show, for the re-rank. Falls back to the keywords, which still
    // works — it is just a weaker description than a sentence would be.
    let describe = args
        .get("describe")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(text);

    let mut query = Query::new(text);
    query.kind = match args.get("kind").and_then(Value::as_str) {
        Some("video") => Kind::Video,
        Some("audio") | Some("music") => Kind::Audio,
        _ => Kind::Image,
    };

    // The default provider follows the kind. Wikimedia has no audio endpoint at all, so asking
    // it for music returns an empty list and no explanation — which is what happened the first
    // time this was called.
    let provider_id = args
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or(match query.kind {
            Kind::Audio => "openverse",
            _ => "wikimedia",
        });
    let provider = providers::provider_named(provider_id).map_err(|e| e.to_string())?;
    if query.kind == Kind::Audio && provider_id != "openverse" {
        return Err(format!(
            "{provider_id} has no audio. Music comes from openverse — omit `provider` and it is \
             chosen for you."
        ));
    }

    query.limit = args
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(12)
        .clamp(1, 50) as usize;
    query.min_width = args
        .get("minWidth")
        .and_then(Value::as_u64)
        .map(|n| n as u32);
    // Default-deny. Only the exact opt-in string turns ShareAlike on, so a typo refuses rather
    // than silently making somebody's film copyleft.
    if args.get("licence").and_then(Value::as_str) == Some("allow-sharealike")
        || args.get("license").and_then(Value::as_str) == Some("allow-sharealike")
    {
        query.allowed = Allowed::with_share_alike();
    }

    let found =
        providers::search(provider.as_ref(), transport, &query).map_err(|e| e.to_string())?;

    // A scorer that is absent, or present and unable to run, both mean the same thing to the
    // caller: these are in the archive's order and that order is about filenames.
    let scores = match rerank {
        Rerank::None => None,
        Rerank::With(score) => score(describe, &found),
    };

    let Some(scores) = scores else {
        let warning = copyleft_warning(&found);
        return Ok(json!({
            "results": found,
            "provider": provider_id,
            "rankedBy": "the archive's own keyword order",
            "separation": Value::Null,
            "licenceWarning": warning,
            "hint": "these are in the archive's keyword order, which is often wrong about what \
                     is in the picture — install the vision component and they will be re-ranked.",
        }));
    };

    let mut ranked: Vec<(f32, usize, StockAsset)> = found
        .into_iter()
        .enumerate()
        .zip(scores)
        .map(|((was, asset), score)| (score, was, asset))
        .collect();
    // NaN sorts last rather than scrambling the order — a `partial_cmp` that returns `None`
    // makes `sort_by` misbehave, and one bad embedding would corrupt the whole ranking.
    ranked.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let separation = if ranked.is_empty() {
        0.0
    } else {
        ranked[0].0 - ranked[ranked.len() / 2].0
    };

    Ok(json!({
        "results": ranked.iter().map(|(score, was, asset)| {
            let mut value = serde_json::to_value(asset).unwrap_or(Value::Null);
            value["score"] = json!(score);
            // Where the archive had put it, so the caller can see what the re-rank changed.
            value["was"] = json!(was);
            value
        }).collect::<Vec<_>>(),
        "provider": provider_id,
        "describedAs": describe,
        "rankedBy": "SigLIP, against what is in the picture",
        "separation": separation,
        "licenceWarning": copyleft_warning(
            &ranked.iter().map(|(_, _, a)| a.clone()).collect::<Vec<_>>(),
        ),
        "hint": separation_hint(separation),
    }))
}

/// Say plainly what a ShareAlike result costs, if any came back.
///
/// The obligation is on the caller's own film, not on bay, so it cannot be left implicit in a
/// `licence` field somebody may not read. `null` when nothing copyleft is in the results.
fn copyleft_warning(assets: &[StockAsset]) -> Value {
    let count = assets.iter().filter(|a| a.licence.is_copyleft()).count();
    if count == 0 {
        return Value::Null;
    }
    json!(format!(
        "{count} of these {} results are ShareAlike. Using one obliges you to release the \
         finished video under the same licence, and to credit the photographer. That is a \
         decision about your own work — if you did not intend it, drop the licence argument \
         and search again.",
        assets.len()
    ))
}

/// What a separation actually licenses the caller to conclude.
///
/// SigLIP's absolute scores are not calibrated, so "0.09" means nothing on its own. The gap
/// between the winner and the median does mean something: if every candidate scores alike, the
/// archive has nothing matching the query and the honest move is to ask a different question
/// rather than to place the top hit and hope.
fn separation_hint(separation: f32) -> &'static str {
    if separation < 0.01 {
        "every candidate scored alike — the archive has nothing that matches this query. \
         Search for something else rather than taking the top hit."
    } else if separation < 0.04 {
        "a weak spread — the top hit is only slightly better than the rest. Look at it before \
         you place it."
    } else {
        "a clear winner — the top hits are markedly better matches than the rest."
    }
}

/// `stock_fetch`: bring one result down to disk, with its licence recorded beside it.
///
/// It does not register the file with the project. `media_import` owns that, and routing the
/// download through it would give every placement tool a path to the network.
pub fn stock_fetch(args: &Value, transport: &dyn Transport) -> Result<Value, String> {
    let asset: StockAsset = args
        .get("asset")
        .ok_or("stock_fetch needs the whole asset object from stock_search's results")
        .and_then(|value| {
            serde_json::from_value(value.clone())
                .map_err(|_| "that does not look like a stock_search result")
        })?;

    let provider = providers::provider_named(&asset.provider).map_err(|e| e.to_string())?;
    let max_bytes = args
        .get("maxBytes")
        .and_then(Value::as_u64)
        .unwrap_or(64 * 1024 * 1024);

    let fetched =
        cache::fetch(&asset, transport, provider.hosts(), max_bytes).map_err(|e| e.to_string())?;

    Ok(json!({
        "path": fetched.path,
        "cached": fetched.cached,
        "bytes": fetched.receipt.bytes,
        "sha256": fetched.receipt.sha256,
        "licence": fetched.receipt.licence.label(),
        "needsCredit": fetched.receipt.licence.needs_credit(),
        "creditLine": fetched.receipt.credit_line(),
        "hint": "call media_import with this path to put it on the timeline",
    }))
}

/// `stock_credits`: the attribution for everything downloaded, as text to paste.
pub fn stock_credits() -> Value {
    let receipts = cache::receipts();
    let lines: Vec<String> = receipts.iter().filter_map(|r| r.credit_line()).collect();
    json!({
        "credits": receipts.iter().map(|r| json!({
            "stockId": r.stock_id,
            "title": r.title,
            "licence": r.licence.label(),
            "creator": r.credit.creator,
            "pageUrl": r.credit.page_url,
            "needsCredit": r.licence.needs_credit(),
        })).collect::<Vec<_>>(),
        "text": lines.join("\n"),
        "hint": if lines.is_empty() {
            "nothing downloaded needs a credit"
        } else {
            "these go in the post description, or on screen at the moment the sourced image is \
             shown — not on an end card nobody reads"
        },
    })
}

/// `library_save`: keep a file, under a name you chose, in a collection.
pub fn library_save(args: &Value) -> Result<Value, String> {
    let path = args
        .get("path")
        .and_then(Value::as_str)
        .ok_or("library_save needs a path — stock_fetch returns one, and so does media_import")?;
    let collection = args
        .get("collection")
        .and_then(Value::as_str)
        .unwrap_or("default");
    let name = args
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            std::path::Path::new(path)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "untitled".into())
        });

    // Carry the receipt across when the file came from a search, so the credit survives the move
    // out of the cache. Losing it here is how a CC-BY image ends up in a finished film with
    // nobody able to say whose it was.
    let receipt = cache::receipts()
        .into_iter()
        .find(|r| args.get("stockId").and_then(Value::as_str) == Some(r.stock_id.as_str()));

    let item = library::save(
        std::path::Path::new(path),
        collection,
        &name,
        receipt.as_ref(),
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({
        "saved": item,
        "creditLine": item.credit_line(),
        "hint": "library_collect copies the whole collection beside a project, so the piece \
                 travels as one folder",
    }))
}

/// `library_list`: what is kept.
pub fn library_list(args: &Value) -> Value {
    let collection = args.get("collection").and_then(Value::as_str);
    let items = library::list(collection);
    let credits: Vec<String> = items
        .iter()
        .filter_map(library::Item::credit_line)
        .collect();
    let bytes: u64 = items.iter().map(|i| i.bytes).sum();
    let mut collections: Vec<String> = items.iter().map(|i| i.collection.clone()).collect();
    collections.sort();
    collections.dedup();
    json!({
        "items": items,
        "collections": collections,
        "bytes": bytes,
        "libraryDir": library::library_dir(),
        "credits": credits,
    })
}

/// `library_collect`: copy a collection into a project's own media folder.
pub fn library_collect(args: &Value) -> Result<Value, String> {
    let collection = args
        .get("collection")
        .and_then(Value::as_str)
        .ok_or("library_collect needs a collection — library_list names them")?;
    let into = args.get("into").and_then(Value::as_str).ok_or(
        "library_collect needs `into`: the folder to copy into, usually beside the project",
    )?;
    let copied =
        library::collect(collection, std::path::Path::new(into)).map_err(|e| e.to_string())?;
    Ok(json!({
        "copied": copied,
        "count": copied.len(),
        "into": into,
        "hint": "media_import each of these to put them on the timeline. A project references \
                 media by absolute path, so a project plus this folder is the whole piece.",
    }))
}

/// The real transport, for callers with nothing to inject.
pub fn transport() -> Http {
    Http::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Credit, Licence};

    struct Canned(String);

    impl Transport for Canned {
        fn get(&self, _url: &str) -> Result<crate::http::Response, crate::HttpError> {
            Ok(crate::http::Response {
                status: 200,
                content_type: "application/json".into(),
                body: Box::new(std::io::Cursor::new(self.0.clone().into_bytes())),
            })
        }
    }

    fn body(n: usize) -> String {
        let pages: Vec<String> = (0..n)
            .map(|i| {
                format!(
                    r#""{i}":{{"title":"File:P{i}.jpg","imageinfo":[{{
                    "url":"https://upload.wikimedia.org/p{i}.jpg",
                    "thumburl":"https://upload.wikimedia.org/t{i}.jpg",
                    "descriptionurl":"https://commons.wikimedia.org/wiki/File:P{i}.jpg",
                    "width":900,"height":600,
                    "extmetadata":{{"LicenseShortName":{{"value":"Public domain"}}}}}}]}}"#
                )
            })
            .collect();
        format!(r#"{{"query":{{"pages":{{{}}}}}}}"#, pages.join(","))
    }

    /// The keyword/description split, pinned. The archive must receive the short keywords and
    /// the scorer must receive the sentence — swapping them returns zero results from Wikimedia,
    /// which is the failure that motivated the second argument.
    #[test]
    fn the_archive_gets_the_keywords_and_the_scorer_gets_the_description() {
        let seen = std::cell::RefCell::new(String::new());
        let score = |described: &str, assets: &[StockAsset]| {
            *seen.borrow_mut() = described.to_string();
            Some(vec![0.1; assets.len()])
        };
        let transport = Canned(body(2));
        let out = stock_search(
            &json!({
                "query": "hyperinflation 1923",
                "describe": "children stacking bundles of banknotes like toy bricks",
            }),
            &transport,
            Rerank::With(&score),
        )
        .unwrap();
        assert_eq!(
            seen.into_inner(),
            "children stacking bundles of banknotes like toy bricks",
            "the scorer must be given the description, not the keywords"
        );
        assert_eq!(
            out["describedAs"],
            "children stacking bundles of banknotes like toy bricks"
        );
    }

    /// With only one string given, both halves use it. Worse ranking, still a working search.
    #[test]
    fn a_description_defaults_to_the_keywords() {
        let seen = std::cell::RefCell::new(String::new());
        let score = |described: &str, assets: &[StockAsset]| {
            *seen.borrow_mut() = described.to_string();
            Some(vec![0.1; assets.len()])
        };
        stock_search(
            &json!({"query": "hyperinflation 1923"}),
            &Canned(body(2)),
            Rerank::With(&score),
        )
        .unwrap();
        assert_eq!(seen.into_inner(), "hyperinflation 1923");
    }

    #[test]
    fn a_search_without_a_query_says_what_is_missing() {
        let error = stock_search(&json!({}), &Canned(body(1)), Rerank::None).unwrap_err();
        assert!(error.contains("query"), "{error}");
    }

    /// Without the vision component the search still works and says the order is the archive's.
    #[test]
    fn without_reranking_the_order_is_the_archives_and_it_says_so() {
        let out = stock_search(&json!({"query": "bank"}), &Canned(body(3)), Rerank::None).unwrap();
        assert_eq!(out["results"].as_array().unwrap().len(), 3);
        assert_eq!(out["rankedBy"], "the archive's own keyword order");
        assert!(out["hint"].as_str().unwrap().contains("vision"));
    }

    /// The composition: a scorer that prefers the last candidate must reorder the results, and
    /// every result must carry where it had been.
    #[test]
    fn reranking_reorders_and_records_the_original_position() {
        let score = |_: &str, assets: &[StockAsset]| {
            Some(
                assets
                    .iter()
                    .enumerate()
                    .map(|(i, _)| i as f32 / 10.0)
                    .collect(),
            )
        };
        let out = stock_search(
            &json!({"query": "bank"}),
            &Canned(body(3)),
            Rerank::With(&score),
        )
        .unwrap();
        let results = out["results"].as_array().unwrap();
        assert_eq!(results[0]["was"], 2, "the highest-scoring one must lead");
        assert_eq!(results[2]["was"], 0);
        assert!(out["rankedBy"].as_str().unwrap().contains("SigLIP"));
    }

    /// A scorer that cannot run (no model) must degrade to the keyword order, not fail.
    #[test]
    fn a_scorer_that_cannot_run_falls_back_instead_of_failing() {
        let score = |_: &str, _: &[StockAsset]| None;
        let out = stock_search(
            &json!({"query": "bank"}),
            &Canned(body(2)),
            Rerank::With(&score),
        )
        .unwrap();
        assert_eq!(out["rankedBy"], "the archive's own keyword order");
        assert_eq!(out["results"].as_array().unwrap().len(), 2);
    }

    /// The number that says whether to believe the ranking.
    #[test]
    fn a_flat_score_set_is_reported_as_nothing_matching() {
        let score = |_: &str, assets: &[StockAsset]| Some(vec![0.05; assets.len()]);
        let out = stock_search(
            &json!({"query": "bank"}),
            &Canned(body(5)),
            Rerank::With(&score),
        )
        .unwrap();
        assert!(out["separation"].as_f64().unwrap().abs() < 1e-6);
        assert!(
            out["hint"]
                .as_str()
                .unwrap()
                .contains("nothing that matches"),
            "{}",
            out["hint"]
        );
    }

    #[test]
    fn a_clear_winner_is_reported_as_one() {
        let score = |_: &str, assets: &[StockAsset]| {
            let mut scores = vec![0.01; assets.len()];
            scores[0] = 0.5;
            Some(scores)
        };
        let out = stock_search(
            &json!({"query": "bank"}),
            &Canned(body(5)),
            Rerank::With(&score),
        )
        .unwrap();
        assert!(out["hint"].as_str().unwrap().contains("clear winner"));
    }

    /// Music defaults to the one provider that has any, and says so rather than answering with
    /// an empty list when asked for the impossible.
    #[test]
    fn asking_wikimedia_for_music_is_refused_with_the_reason() {
        let error = stock_search(
            &json!({"query": "tension", "kind": "audio", "provider": "wikimedia"}),
            &Canned(body(1)),
            Rerank::None,
        )
        .unwrap_err();
        assert!(error.contains("openverse"), "{error}");
    }

    #[test]
    fn an_unknown_provider_is_refused_before_any_request() {
        let error = stock_search(
            &json!({"query": "x", "provider": "shutterstock"}),
            &Canned(body(1)),
            Rerank::None,
        )
        .unwrap_err();
        assert!(error.contains("wikimedia"), "{error}");
    }

    #[test]
    fn the_limit_is_clamped_rather_than_trusted() {
        let out = stock_search(
            &json!({"query": "x", "limit": 9999}),
            &Canned(body(60)),
            Rerank::None,
        )
        .unwrap();
        assert!(out["results"].as_array().unwrap().len() <= 50);
    }

    #[test]
    fn fetching_without_an_asset_says_what_it_wants() {
        let error = stock_fetch(&json!({}), &Canned(String::new())).unwrap_err();
        assert!(error.contains("stock_search"), "{error}");
    }

    #[test]
    fn status_names_every_provider_and_whether_it_is_usable() {
        let status = stock_status();
        let providers = status["providers"].as_array().unwrap();
        assert_eq!(providers.len(), 4);
        let wikimedia = providers.iter().find(|p| p["id"] == "wikimedia").unwrap();
        assert_eq!(wikimedia["configured"], true);
        assert_eq!(wikimedia["needsKey"], Value::Null);
    }

    /// The privacy fact is stated in the tool's own output, not only in the documentation.
    #[test]
    fn status_says_out_loud_that_searching_leaves_the_machine() {
        let status = stock_status();
        let hint = status["hint"].as_str().unwrap();
        assert!(hint.contains("third party"), "{hint}");
    }

    #[test]
    fn credits_are_empty_and_calm_when_nothing_needs_one() {
        let receipt = crate::Receipt {
            stock_id: "wikimedia:1".into(),
            provider: "wikimedia".into(),
            title: "T".into(),
            url: "https://x.test/a.jpg".into(),
            licence: Licence::PublicDomain,
            credit: Credit {
                creator: None,
                source: "S".into(),
                page_url: "https://p.test".into(),
            },
            sha256: "d".into(),
            bytes: 1,
        };
        assert!(receipt.credit_line().is_none());
    }
}
