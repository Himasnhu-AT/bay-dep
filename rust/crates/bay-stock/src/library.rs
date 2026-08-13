//! Keeping what you found, and moving it next to the project that uses it.
//!
//! The download cache is content-addressed by stock id and lives under the user's data
//! directory. That is right for a cache and wrong for a library: it is keyed by a provider's
//! numbering, it has no idea what a piece is *about*, and a project that references it depends
//! on a directory the user has every reason to believe is disposable.
//!
//! So there are two places, and the distinction is the point:
//!
//! * **The cache** — `data_dir()/stock/<provider>/`. Whatever was fetched, keyed by stock id.
//!   Delete it and nothing is lost but time.
//! * **The library** — `data_dir()/library/<collection>/`. Things you decided to keep, under
//!   names you chose. Saving to it is an act, not a side effect of searching.
//!
//! And one move: [`collect`] copies a library collection **beside a project file**, so the
//! finished piece is a folder you can move to another machine. `bay-paths` warns that projects
//! reference media by absolute path and roaming them produces a project whose every clip is
//! missing; this is the answer to that for the media a project actually uses.

use std::fs;
use std::path::{Path, PathBuf};

use crate::{Receipt, StockError};

/// Where kept media lives.
pub fn library_dir() -> Option<PathBuf> {
    bay_paths::data_dir().map(|data| data.join("library"))
}

/// One item in the library.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub collection: String,
    /// The name it was saved under, without an extension.
    pub name: String,
    pub path: PathBuf,
    pub bytes: u64,
    /// Where it came from, when it came from a search. Hand-added files have none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receipt: Option<Receipt>,
}

impl Item {
    /// The credit line this item obliges, if any.
    pub fn credit_line(&self) -> Option<String> {
        self.receipt.as_ref().and_then(Receipt::credit_line)
    }
}

/// A filename component that cannot climb out of the directory it names.
fn safe(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('-').to_string();
    let capped: String = trimmed.chars().take(80).collect();
    if capped.is_empty() {
        "untitled".into()
    } else {
        capped
    }
}

/// Copy a file into a library collection under `name`, and keep its receipt beside it.
///
/// Copies rather than moves: the cache may still be serving another project, and a save that
/// empties the place it saved from is a save that can lose work.
pub fn save(
    source: &Path,
    collection: &str,
    name: &str,
    receipt: Option<&Receipt>,
) -> Result<Item, StockError> {
    let root = library_dir().ok_or(StockError::NoCacheDir)?;
    let collection = safe(collection);
    let name = safe(name);
    let dir = root.join(&collection);
    fs::create_dir_all(&dir).map_err(|e| StockError::Io {
        path: dir.clone(),
        detail: e.to_string(),
    })?;

    let extension = source
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| e.len() <= 5 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or("bin");
    let destination = dir.join(format!("{name}.{extension}"));
    fs::copy(source, &destination).map_err(|e| StockError::Io {
        path: destination.clone(),
        detail: e.to_string(),
    })?;

    if let Some(receipt) = receipt {
        let json = serde_json::to_string_pretty(receipt).map_err(|e| StockError::Io {
            path: destination.clone(),
            detail: e.to_string(),
        })?;
        let _ = fs::write(dir.join(format!("{name}.json")), json);
    }

    let bytes = fs::metadata(&destination).map(|m| m.len()).unwrap_or(0);
    Ok(Item {
        collection,
        name,
        path: destination,
        bytes,
        receipt: receipt.cloned(),
    })
}

/// Everything kept, optionally narrowed to one collection.
pub fn list(collection: Option<&str>) -> Vec<Item> {
    let Some(root) = library_dir() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let Ok(collections) = fs::read_dir(&root) else {
        return out;
    };
    for entry in collections.filter_map(Result::ok) {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if collection.is_some_and(|wanted| safe(wanted) != name) {
            continue;
        }
        let Ok(files) = fs::read_dir(&dir) else {
            continue;
        };
        for file in files.filter_map(Result::ok) {
            let path = file.path();
            if path.extension().is_some_and(|e| e == "json") || !path.is_file() {
                continue;
            }
            let stem = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let receipt = fs::read_to_string(dir.join(format!("{stem}.json")))
                .ok()
                .and_then(|raw| serde_json::from_str::<Receipt>(&raw).ok());
            out.push(Item {
                collection: name.clone(),
                name: stem,
                path,
                bytes: file.metadata().map(|m| m.len()).unwrap_or(0),
                receipt,
            });
        }
    }
    out.sort_by(|a, b| {
        (a.collection.clone(), a.name.clone()).cmp(&(b.collection.clone(), b.name.clone()))
    });
    out
}

/// Copy a collection next to a project, so the whole piece travels as one folder.
///
/// Returns the new paths in the same order as [`list`]. Existing files are overwritten: the
/// point is to make the folder match the library, and a half-updated media folder is worse than
/// a replaced one.
pub fn collect(collection: &str, into: &Path) -> Result<Vec<PathBuf>, StockError> {
    fs::create_dir_all(into).map_err(|e| StockError::Io {
        path: into.to_path_buf(),
        detail: e.to_string(),
    })?;
    let mut copied = Vec::new();
    for item in list(Some(collection)) {
        let Some(file_name) = item.path.file_name() else {
            continue;
        };
        let destination = into.join(file_name);
        fs::copy(&item.path, &destination).map_err(|e| StockError::Io {
            path: destination.clone(),
            detail: e.to_string(),
        })?;
        copied.push(destination);
    }
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_cannot_climb_out_of_its_collection() {
        assert_eq!(safe("../../etc/passwd"), "etc-passwd");
        assert_eq!(safe("weimar 1923"), "weimar-1923");
        assert_eq!(safe(""), "untitled");
        assert_eq!(safe("///"), "untitled");
        assert!(!safe("a/b\\c").contains('/'));
        assert_eq!(safe(&"x".repeat(200)).len(), 80);
    }
}
