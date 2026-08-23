//! Bringing a file down, and writing down where it came from.
//!
//! The receipt is the part that is easy to skip and expensive to add later. A CC BY image in a
//! finished film needs a credit, and by the time the film is finished nobody remembers which of
//! forty pictures came from where. So the attribution is recorded at the moment of download,
//! beside the bytes, and `stock_credits` reads it back.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::http::{HttpError, Transport, is_allowed};
use crate::{Credit, Kind, Licence, StockAsset, StockError};

/// Read at most this much per call regardless of what the caller asked for.
///
/// A ceiling on the ceiling: `max_bytes` is a caller's argument and a caller can be wrong, but
/// nothing bay downloads for a timeline is legitimately larger than this.
const HARD_CEILING: u64 = 512 * 1024 * 1024;

const CHUNK: usize = 256 * 1024;

/// What is written beside every downloaded file.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub stock_id: String,
    pub provider: String,
    pub title: String,
    pub url: String,
    pub licence: Licence,
    pub credit: Credit,
    /// The digest of what actually arrived.
    ///
    /// Nobody pinned this in advance — that is the difference between this crate and
    /// `bay-provision`. It makes the download verifiable *after* the fact: a re-fetch that
    /// produces different bytes is visible, and a file that changed on disk is visible.
    pub sha256: String,
    pub bytes: u64,
}

impl Receipt {
    /// The credit line for this asset, or `None` when the licence asks for none.
    pub fn credit_line(&self) -> Option<String> {
        if !self.licence.needs_credit() {
            return None;
        }
        let who = self.credit.creator.as_deref().unwrap_or("unknown");
        Some(format!(
            "{} — {} ({}), {}",
            self.title,
            who,
            self.licence.label(),
            self.credit.page_url
        ))
    }
}

/// A completed download.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fetched {
    pub path: PathBuf,
    pub receipt: Receipt,
    /// True when the file was already there and did not have to be fetched again.
    pub cached: bool,
}

/// Where downloaded media lives.
///
/// Under `data_dir`, not `runtime_dir`. The runtime directory is documented as the one thing a
/// user can delete to reclaim everything bay downloaded — and deleting it must not break a saved
/// project. A project references these files by path, so they are not disposable in the same way.
pub fn cache_dir() -> Option<PathBuf> {
    bay_paths::data_dir().map(|data| data.join("stock"))
}

/// Download `asset`, or return the copy already on disk.
pub fn fetch(
    asset: &StockAsset,
    transport: &dyn Transport,
    hosts: &[&str],
    max_bytes: u64,
) -> Result<Fetched, StockError> {
    if !is_allowed(&asset.url, hosts) {
        return Err(StockError::UntrustedUrl {
            provider: asset.provider.clone(),
            url: asset.url.clone(),
        });
    }

    let root = cache_dir().ok_or(StockError::NoCacheDir)?;
    let dir = root.join(&asset.provider);
    fs::create_dir_all(&dir).map_err(|e| StockError::Io {
        path: dir.clone(),
        detail: e.to_string(),
    })?;

    let stem = safe_stem(&asset.stock_id);
    let receipt_path = dir.join(format!("{stem}.json"));

    // A cached file is only trusted when its receipt still matches its bytes. A half-written
    // file from a killed process has a name and no digest, and would otherwise be handed to the
    // decoder as a valid image.
    if let Ok(existing) = read_receipt(&receipt_path) {
        let path = dir.join(&existing.0);
        if path.is_file() && digest_of(&path).is_ok_and(|d| d == existing.1.sha256) {
            return Ok(Fetched {
                path,
                receipt: existing.1,
                cached: true,
            });
        }
    }

    let limit = max_bytes.min(HARD_CEILING);
    let mut response = transport.get(&asset.url).map_err(|error| match error {
        HttpError::Transport(detail) => StockError::Network {
            provider: "stock",
            detail,
        },
        HttpError::Status { status, .. } => StockError::Network {
            provider: "stock",
            detail: format!("HTTP {status}"),
        },
    })?;

    // An HTML error page saved under a .jpg name is the classic failure: it fails much later,
    // inside a decoder, with a message about the file being corrupt.
    let want = asset.kind.content_prefix();
    if !response.content_type.starts_with(want) {
        return Err(StockError::WrongKind {
            url: asset.url.clone(),
            got: response.content_type.clone(),
            want: asset.kind.as_str(),
        });
    }

    let extension = extension_for(&response.content_type, asset.kind);
    let name = format!("{stem}.{extension}");
    let final_path = dir.join(&name);
    let staging = dir.join(format!("{stem}.{}.part", std::process::id()));

    let outcome = (|| -> Result<(String, u64), StockError> {
        let mut file = File::create(&staging).map_err(|e| StockError::Io {
            path: staging.clone(),
            detail: e.to_string(),
        })?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; CHUNK];
        let mut total = 0u64;
        loop {
            let read = response
                .body
                .read(&mut buffer)
                .map_err(|e| StockError::Io {
                    path: staging.clone(),
                    detail: e.to_string(),
                })?;
            if read == 0 {
                break;
            }
            total += read as u64;
            if total > limit {
                return Err(StockError::TooLarge {
                    url: asset.url.clone(),
                    limit,
                });
            }
            hasher.update(&buffer[..read]);
            file.write_all(&buffer[..read])
                .map_err(|e| StockError::Io {
                    path: staging.clone(),
                    detail: e.to_string(),
                })?;
        }
        file.sync_all().map_err(|e| StockError::Io {
            path: staging.clone(),
            detail: e.to_string(),
        })?;
        Ok((hex(&hasher.finalize()), total))
    })();

    let (sha256, bytes) = match outcome {
        Ok(value) => value,
        Err(error) => {
            // A refused download leaves nothing. A partial file with a plausible name is worse
            // than no file, because the next run treats it as a cache hit.
            let _ = fs::remove_file(&staging);
            return Err(error);
        }
    };

    fs::rename(&staging, &final_path).map_err(|e| StockError::Io {
        path: final_path.clone(),
        detail: e.to_string(),
    })?;

    let receipt = Receipt {
        stock_id: asset.stock_id.clone(),
        provider: asset.provider.clone(),
        title: asset.title.clone(),
        url: asset.url.clone(),
        licence: asset.licence.clone(),
        credit: asset.credit.clone(),
        sha256,
        bytes,
    };
    write_receipt(&receipt_path, &name, &receipt)?;

    Ok(Fetched {
        path: final_path,
        receipt,
        cached: false,
    })
}

/// Pull each candidate's preview down so something can look at it.
///
/// Previews, not originals: re-ranking forty candidates by downloading forty full-resolution
/// archive scans would move a gigabyte to choose one picture. They land in a `previews`
/// subdirectory, are content-addressed by stock id, and are reused across searches — the same
/// image comes back for many different queries.
///
/// A preview that will not download is skipped, not fatal. Its slot comes back `None` and the
/// caller scores it zero; one dead thumbnail must not cost the other thirty-nine.
pub fn fetch_previews(
    assets: &[StockAsset],
    transport: &dyn Transport,
    hosts: &[&str],
) -> Vec<Option<PathBuf>> {
    /// Previews are small by definition; anything larger is not a preview and is not worth the
    /// bytes when the only thing that will happen to it is a resize to 224×224.
    const PREVIEW_CEILING: u64 = 16 * 1024 * 1024;

    let Some(root) = cache_dir() else {
        return vec![None; assets.len()];
    };
    let dir = root.join("previews");
    if fs::create_dir_all(&dir).is_err() {
        return vec![None; assets.len()];
    }

    assets
        .iter()
        .map(|asset| {
            if !is_allowed(&asset.preview_url, hosts) {
                return None;
            }
            let stem = safe_stem(&asset.stock_id);
            // Any already-downloaded preview for this id, whatever extension it landed under.
            if let Ok(entries) = fs::read_dir(&dir) {
                for entry in entries.filter_map(Result::ok) {
                    let path = entry.path();
                    if path.file_stem().is_some_and(|s| s == stem.as_str())
                        && path.metadata().is_ok_and(|m| m.len() > 0)
                    {
                        return Some(path);
                    }
                }
            }

            let mut response = transport.get(&asset.preview_url).ok()?;
            if !response.content_type.starts_with("image/") {
                return None;
            }
            let extension = extension_for(&response.content_type, Kind::Image);
            let staging = dir.join(format!("{stem}.{}.part", std::process::id()));
            let final_path = dir.join(format!("{stem}.{extension}"));

            let write = (|| -> std::io::Result<()> {
                let mut file = File::create(&staging)?;
                let mut buffer = vec![0u8; CHUNK];
                let mut total = 0u64;
                loop {
                    let read = response.body.read(&mut buffer)?;
                    if read == 0 {
                        break;
                    }
                    total += read as u64;
                    if total > PREVIEW_CEILING {
                        return Err(std::io::Error::other("preview larger than its ceiling"));
                    }
                    file.write_all(&buffer[..read])?;
                }
                file.sync_all()
            })();

            if write.is_err() {
                let _ = fs::remove_file(&staging);
                return None;
            }
            fs::rename(&staging, &final_path).ok()?;
            Some(final_path)
        })
        .collect()
}

/// Every receipt in the cache, for `stock_credits`.
pub fn receipts() -> Vec<Receipt> {
    let Some(root) = cache_dir() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let Ok(providers) = fs::read_dir(&root) else {
        return out;
    };
    for provider in providers.filter_map(Result::ok) {
        let Ok(entries) = fs::read_dir(provider.path()) else {
            continue;
        };
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json")
                && let Ok((_, receipt)) = read_receipt(&path)
            {
                out.push(receipt);
            }
        }
    }
    out.sort_by(|a, b| a.stock_id.cmp(&b.stock_id));
    out
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Stored {
    file: String,
    #[serde(flatten)]
    receipt: Receipt,
}

fn write_receipt(path: &Path, file: &str, receipt: &Receipt) -> Result<(), StockError> {
    let stored = Stored {
        file: file.to_string(),
        receipt: receipt.clone(),
    };
    let json = serde_json::to_string_pretty(&stored).map_err(|e| StockError::Io {
        path: path.to_path_buf(),
        detail: e.to_string(),
    })?;
    fs::write(path, json).map_err(|e| StockError::Io {
        path: path.to_path_buf(),
        detail: e.to_string(),
    })
}

fn read_receipt(path: &Path) -> Result<(String, Receipt), ()> {
    let raw = fs::read_to_string(path).map_err(|_| ())?;
    let stored: Stored = serde_json::from_str(&raw).map_err(|_| ())?;
    Ok((stored.file, stored.receipt))
}

/// A stock id is `provider:id` and an id can be anything the provider likes. Everything outside
/// a conservative set becomes `_`, so no result can name a path.
fn safe_stem(stock_id: &str) -> String {
    let stem: String = stock_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    // Long ids exist and some filesystems stop at 255 bytes.
    stem.chars().take(120).collect()
}

fn extension_for(content_type: &str, kind: Kind) -> &'static str {
    let base = content_type.split(';').next().unwrap_or("").trim();
    match base {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/tiff" => "tiff",
        "image/bmp" => "bmp",
        "video/mp4" => "mp4",
        "video/quicktime" => "mov",
        "video/webm" => "webm",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/ogg" | "audio/vorbis" => "ogg",
        "audio/mp4" | "audio/m4a" | "audio/x-m4a" => "m4a",
        _ => match kind {
            Kind::Image => "jpg",
            Kind::Video => "mp4",
            Kind::Audio => "mp3",
        },
    }
}

fn digest_of(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; CHUNK];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The traversal case, spelled out rather than asserted loosely: `:`, every `.` and every
    /// `/` becomes `_`, so the result cannot climb out of the cache directory or name a dotfile.
    #[test]
    fn a_stock_id_cannot_name_a_path() {
        assert_eq!(
            safe_stem("wikimedia:../../etc/passwd"),
            "wikimedia_______etc_passwd"
        );
        assert_eq!(safe_stem("openverse:abc-123"), "openverse_abc-123");
        for hostile in ["a/b\\c", "../x", "..", "C:\\Windows\\x"] {
            let stem = safe_stem(hostile);
            assert!(!stem.contains('/'), "{hostile} -> {stem}");
            assert!(!stem.contains('\\'), "{hostile} -> {stem}");
            assert!(!stem.contains('.'), "{hostile} -> {stem}");
        }
    }

    /// A pathological id must not produce a filename the filesystem refuses.
    #[test]
    fn a_very_long_id_is_truncated() {
        assert_eq!(safe_stem(&"x".repeat(400)).len(), 120);
    }

    #[test]
    fn the_extension_follows_the_content_type_not_the_url() {
        assert_eq!(extension_for("image/png", Kind::Image), "png");
        assert_eq!(
            extension_for("image/jpeg; charset=binary", Kind::Image),
            "jpg"
        );
        assert_eq!(extension_for("video/mp4", Kind::Video), "mp4");
        assert_eq!(
            extension_for("application/octet-stream", Kind::Image),
            "jpg",
            "an unhelpful content type still gets a sane extension"
        );
    }

    #[test]
    fn a_cc_by_receipt_produces_a_credit_line_and_a_cc0_one_does_not() {
        let base = Receipt {
            stock_id: "openverse:a".into(),
            provider: "openverse".into(),
            title: "Trading floor".into(),
            url: "https://x.test/a.jpg".into(),
            licence: Licence::CcBy {
                version: "2.0".into(),
            },
            credit: Credit {
                creator: Some("Ada".into()),
                source: "flickr".into(),
                page_url: "https://flickr.test/1".into(),
            },
            sha256: "abc".into(),
            bytes: 10,
        };
        let line = base.credit_line().expect("CC BY needs a credit");
        assert!(line.contains("Ada"), "{line}");
        assert!(line.contains("CC BY 2.0"), "{line}");
        assert!(line.contains("https://flickr.test/1"), "{line}");

        let cc0 = Receipt {
            licence: Licence::Cc0,
            ..base
        };
        assert!(cc0.credit_line().is_none());
    }

    /// A credit line must still be produced when the archive does not know who made it — an
    /// unknown author is not a reason to drop the attribution obligation.
    #[test]
    fn an_unknown_creator_still_produces_a_credit_line() {
        let receipt = Receipt {
            stock_id: "wikimedia:1".into(),
            provider: "wikimedia".into(),
            title: "A photograph".into(),
            url: "https://x.test/a.jpg".into(),
            licence: Licence::CcBy {
                version: "4.0".into(),
            },
            credit: Credit {
                creator: None,
                source: "Wikimedia Commons".into(),
                page_url: "https://commons.test/1".into(),
            },
            sha256: "abc".into(),
            bytes: 10,
        };
        assert!(receipt.credit_line().unwrap().contains("unknown"));
    }

    #[test]
    fn a_receipt_round_trips_through_json() {
        let receipt = Receipt {
            stock_id: "wikimedia:1".into(),
            provider: "wikimedia".into(),
            title: "T".into(),
            url: "https://x.test/a.jpg".into(),
            licence: Licence::PublicDomain,
            credit: Credit {
                creator: Some("B".into()),
                source: "S".into(),
                page_url: "https://p.test".into(),
            },
            sha256: "d".into(),
            bytes: 1,
        };
        let json = serde_json::to_string(&Stored {
            file: "a.jpg".into(),
            receipt: receipt.clone(),
        })
        .unwrap();
        // The licence is kebab-case on the wire, matching the project format's rule.
        assert!(json.contains("\"public-domain\""), "{json}");
        let back: Stored = serde_json::from_str(&json).unwrap();
        assert_eq!(back.file, "a.jpg");
        assert_eq!(back.receipt.stock_id, receipt.stock_id);
    }
}
