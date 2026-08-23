//! What bay actually installed, recorded so it can be checked later.
//!
//! The manifest says what *should* be there. This says what *is*, and it is written only after
//! an artifact has been downloaded, verified against its pinned digest and unpacked. Two things
//! need it:
//!
//! - **Reporting.** "ffmpeg 9.0, installed by bay on 2026-08-08" is a different and more useful
//!   statement than "an ffmpeg exists". When a user reports a bug, the first question is which
//!   build they were running, and this answers it without asking them to run anything.
//! - **Detecting drift.** A file under bay's runtime directory can still be replaced — by a
//!   half-finished upgrade, a disk error, or a well-meaning cleanup script. Re-checking it
//!   against the digest recorded here catches that.
//!
//! **The receipt is never the source of truth for "is it installed".** That stays
//! [`crate::manifest::plan`], which looks at the filesystem. A receipt claiming a file that is
//! not there must lose to the filesystem, or deleting the runtime directory would leave bay
//! insisting everything was fine.
//!
//! Verification is size-and-mtime first, digest only when those changed. Re-hashing 130 MB of
//! ffmpeg on every launch would cost about a second for a check that almost always passes.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::ProvisionError;

/// One installed file, as it was when bay wrote it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    /// Path relative to the runtime root.
    pub path: String,
    pub bytes: u64,
    /// Seconds since the epoch. Cheap to compare, and combined with the size it catches every
    /// realistic accidental replacement.
    pub modified: u64,
    /// The digest of the *archive* this came from — the value pinned in the manifest, which is
    /// what ties an installed file back to a reviewed line in this repository.
    pub archive_sha256: String,
}

/// Everything bay has installed under one runtime root.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    /// artifact id → what it put on disk.
    pub artifacts: BTreeMap<String, Entry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// The human version, e.g. "FFmpeg 9.0" — what a bug report should quote.
    pub name: String,
    pub sha256: String,
    pub url: String,
    /// Seconds since the epoch, so a receipt is readable without a date library.
    pub installed_at: u64,
    pub files: Vec<Installed>,
}

pub fn receipt_path(root: &Path) -> PathBuf {
    root.join("installed.json")
}

/// Read the receipt, or an empty one.
///
/// A corrupt or unreadable receipt is an empty receipt, never an error. It is a record *about*
/// the install, not part of it — refusing to start because a JSON file got truncated would turn
/// a cosmetic problem into a broken editor.
pub fn read(root: &Path) -> Receipt {
    std::fs::read_to_string(receipt_path(root))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn file_facts(path: &Path) -> Option<(u64, u64)> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    Some((meta.len(), modified))
}

/// Record that `artifact` was installed, having placed `files`.
///
/// Written whole each time rather than appended to: a receipt is small, and rewriting it means
/// there is no partial-append state to reason about. Staged and renamed like everything else
/// here, so a crash mid-write cannot leave an unparseable file.
pub fn record(
    root: &Path,
    artifact: &str,
    name: &str,
    sha256: &str,
    url: &str,
    files: &[PathBuf],
) -> Result<(), ProvisionError> {
    let mut receipt = read(root);
    let recorded = files
        .iter()
        .filter_map(|path| {
            let relative = path.strip_prefix(root).unwrap_or(path);
            let (bytes, modified) = file_facts(path)?;
            Some(Installed {
                path: relative.to_string_lossy().replace('\\', "/"),
                bytes,
                modified,
                archive_sha256: sha256.to_string(),
            })
        })
        .collect();

    receipt.artifacts.insert(
        artifact.to_string(),
        Entry {
            name: name.to_string(),
            sha256: sha256.to_string(),
            url: url.to_string(),
            installed_at: now_seconds(),
            files: recorded,
        },
    );

    let path = receipt_path(root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ProvisionError::at(parent, e))?;
    }
    let staging = path.with_extension(format!("{}.part", std::process::id()));
    let text = serde_json::to_string_pretty(&receipt)
        .map_err(|e| ProvisionError::Archive(format!("could not write the receipt: {e}")))?;
    std::fs::write(&staging, text).map_err(|e| ProvisionError::at(&staging, e))?;
    std::fs::rename(&staging, &path).map_err(|e| ProvisionError::at(&path, e))?;
    Ok(())
}

/// Forget receipt entries for artifacts that have been deliberately removed.
///
/// Filesystem probes remain the source of truth, but retaining an install receipt after
/// `runtime_remove` would make later diagnostics report drift for an action bay performed on
/// purpose.
pub fn forget<'a>(
    root: &Path,
    artifacts: impl IntoIterator<Item = &'a str>,
) -> Result<(), ProvisionError> {
    let path = receipt_path(root);
    if !path.exists() {
        return Ok(());
    }
    let mut receipt = read(root);
    for artifact in artifacts {
        receipt.artifacts.remove(artifact);
    }
    if receipt.artifacts.is_empty() {
        return std::fs::remove_file(&path).map_err(|error| ProvisionError::at(&path, error));
    }

    let staging = path.with_extension(format!("{}.part", std::process::id()));
    let text = serde_json::to_string_pretty(&receipt).map_err(|error| {
        ProvisionError::Archive(format!("could not write the receipt: {error}"))
    })?;
    std::fs::write(&staging, text).map_err(|error| ProvisionError::at(&staging, error))?;
    std::fs::rename(&staging, &path).map_err(|error| ProvisionError::at(&path, error))
}

/// Why an installed artifact is no longer what bay put there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Drift {
    Missing { path: String },
    Changed { path: String },
}

impl std::fmt::Display for Drift {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Drift::Missing { path } => write!(f, "{path} is gone"),
            Drift::Changed { path } => write!(f, "{path} is not the file bay installed"),
        }
    }
}

/// Check every recorded file for `artifact` still matches what was written.
///
/// Size and mtime only. That is not a security boundary — anyone who can rewrite a file under
/// the user's own home directory can rewrite the receipt beside it — and it is not meant to be.
/// It catches the realistic cases: an interrupted upgrade, a truncated file from a full disk, a
/// cleanup script that emptied a directory. The digest that *is* a security boundary is checked
/// before the bytes are ever written, in [`crate::fetch::download_verified`].
pub fn drift(root: &Path, artifact: &str) -> Vec<Drift> {
    let receipt = read(root);
    let Some(entry) = receipt.artifacts.get(artifact) else {
        return Vec::new();
    };
    entry
        .files
        .iter()
        .filter_map(|installed| {
            let path = root.join(&installed.path);
            match file_facts(&path) {
                None => Some(Drift::Missing {
                    path: installed.path.clone(),
                }),
                Some((bytes, modified)) => (bytes != installed.bytes
                    || modified != installed.modified)
                    .then(|| Drift::Changed {
                        path: installed.path.clone(),
                    }),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bay-receipt-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("bin")).unwrap();
        dir
    }

    fn install_a_file(root: &Path, name: &str, contents: &[u8]) -> PathBuf {
        let path = root.join("bin").join(name);
        std::fs::write(&path, contents).unwrap();
        path
    }

    #[test]
    fn a_recorded_install_reads_back_with_what_it_placed() {
        let root = scratch("roundtrip");
        let file = install_a_file(&root, "ffmpeg", b"binary");
        record(
            &root,
            "ffmpeg",
            "FFmpeg 9.0",
            "abc123",
            "https://x",
            &[file],
        )
        .unwrap();

        let receipt = read(&root);
        let entry = receipt.artifacts.get("ffmpeg").expect("recorded");
        assert_eq!(entry.name, "FFmpeg 9.0");
        assert_eq!(entry.sha256, "abc123");
        assert_eq!(entry.files.len(), 1);
        assert_eq!(entry.files[0].path, "bin/ffmpeg");
        assert_eq!(entry.files[0].bytes, 6);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The point of the receipt: a bug report can name the exact build, without asking the user
    /// to run anything.
    #[test]
    fn the_receipt_names_the_build_and_where_it_came_from() {
        let root = scratch("provenance");
        let file = install_a_file(&root, "ffmpeg", b"x");
        record(
            &root,
            "ffmpeg",
            "FFmpeg 9.0",
            "5267ef14",
            "https://ffmpeg.martin-riedl.de/download/…/ffmpeg.zip",
            &[file],
        )
        .unwrap();
        let entry = read(&root).artifacts.remove("ffmpeg").unwrap();
        assert!(entry.url.contains("martin-riedl"));
        assert_eq!(entry.sha256, "5267ef14");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_untouched_install_shows_no_drift() {
        let root = scratch("stable");
        let file = install_a_file(&root, "ffmpeg", b"binary");
        record(&root, "ffmpeg", "FFmpeg 9.0", "abc", "https://x", &[file]).unwrap();
        assert!(drift(&root, "ffmpeg").is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A cleanup script, a failed upgrade, a full disk: the file is gone or is a different
    /// length. Either way bay must not keep claiming it installed something usable.
    #[test]
    fn a_deleted_or_rewritten_file_is_reported_as_drift() {
        let root = scratch("drift");
        let file = install_a_file(&root, "ffmpeg", b"the installed binary");
        record(
            &root,
            "ffmpeg",
            "FFmpeg 9.0",
            "abc",
            "https://x",
            std::slice::from_ref(&file),
        )
        .unwrap();

        std::fs::write(&file, b"something else entirely").unwrap();
        assert_eq!(
            drift(&root, "ffmpeg"),
            vec![Drift::Changed {
                path: "bin/ffmpeg".into()
            }]
        );

        std::fs::remove_file(&file).unwrap();
        assert_eq!(
            drift(&root, "ffmpeg"),
            vec![Drift::Missing {
                path: "bin/ffmpeg".into()
            }]
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The receipt must never outrank the filesystem, or wiping the runtime directory would
    /// leave bay insisting everything is installed.
    #[test]
    fn a_receipt_for_a_wiped_directory_reports_everything_missing() {
        let root = scratch("wiped");
        let file = install_a_file(&root, "ffmpeg", b"x");
        record(&root, "ffmpeg", "FFmpeg 9.0", "abc", "https://x", &[file]).unwrap();
        std::fs::remove_dir_all(root.join("bin")).unwrap();
        assert!(matches!(
            drift(&root, "ffmpeg")[..],
            [Drift::Missing { .. }]
        ));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A corrupt receipt is a cosmetic problem. Turning it into a hard failure would break an
    /// editor over a truncated JSON file.
    #[test]
    fn a_corrupt_receipt_reads_as_empty_rather_than_failing() {
        let root = scratch("corrupt");
        std::fs::write(receipt_path(&root), b"{not json").unwrap();
        assert_eq!(read(&root), Receipt::default());
        assert!(drift(&root, "ffmpeg").is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn recording_a_second_artifact_keeps_the_first() {
        let root = scratch("two");
        let one = install_a_file(&root, "ffmpeg", b"a");
        let two = install_a_file(&root, "ffprobe", b"b");
        record(&root, "ffmpeg", "FFmpeg 9.0", "a", "https://x", &[one]).unwrap();
        record(&root, "ffprobe", "FFprobe 9.0", "b", "https://y", &[two]).unwrap();
        let receipt = read(&root);
        assert_eq!(receipt.artifacts.len(), 2);
        let _ = std::fs::remove_dir_all(&root);
    }
}
