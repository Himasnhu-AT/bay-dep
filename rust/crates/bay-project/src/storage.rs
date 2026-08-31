//! Browsing the disk for media, which is a question about the machine rather than the project.
//!
//! # Why this is not in the view
//!
//! It is logic: which entries exist, which of them bay can open, what order they come back in,
//! and what the roots are on this platform. A headless client asking "what media is in this
//! folder" gets the same answer through the same code, and every rule below is testable without
//! a window. The view draws the rows and owns which ones are expanded.
//!
//! # What it is for
//!
//! Resolve's Media Storage is a filesystem browser: you navigate to a folder and drag from it
//! into the pool. bay's panel derived its folders from the paths of files *already imported*,
//! which makes it a view of the pool wearing a browser's clothes — there is nothing to navigate
//! to and nothing to discover.

use std::path::{Path, PathBuf};

use crate::MediaKind;

/// One row in the browser: a directory, or a media file bay can open.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageEntry {
    pub path: PathBuf,
    /// The file or folder name alone, for display.
    pub name: String,
    pub is_dir: bool,
}

impl StorageEntry {
    /// The kind bay would import this as. Meaningless for a directory.
    pub fn kind(&self) -> MediaKind {
        MediaKind::of_path(&self.path.to_string_lossy())
    }
}

/// Entries bay can offer in `dir`: sub-directories, and files it knows how to open.
///
/// Sorted directories first, then files, each case-insensitively by name — the order every file
/// browser uses, and stable so the list does not reshuffle between reads of the same folder.
///
/// Hidden entries are omitted. A dotfile is not something anyone is browsing for, and on macOS a
/// home directory is largely dotfiles; showing them makes the useful rows unfindable.
///
/// Never recurses. One directory per call is what a tree that expands on demand needs, and it is
/// also what keeps this cheap enough to call from a draw: a folder of 50,000 files is one
/// `read_dir`, not a walk of everything beneath it. An unreadable directory yields nothing rather
/// than an error — a permission-denied folder in a listing is a normal thing to meet, not a
/// failure of the browse.
pub fn read_dir(dir: &Path) -> Vec<StorageEntry> {
    const MAX_ENTRIES: usize = 5_000;

    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut rows: Vec<StorageEntry> = Vec::new();
    for entry in entries.flatten() {
        if rows.len() >= MAX_ENTRIES {
            break;
        }
        let path = entry.path();
        let Some(name) = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        // `file_type` does not follow symlinks, which is deliberate: a link into a parent is a
        // cycle, and following one turns an expandable tree into an infinite one.
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let is_dir = file_type.is_dir();
        if !is_dir && !is_media(&path) {
            continue;
        }
        rows.push(StorageEntry { path, name, is_dir });
    }
    rows.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    rows
}

/// Whether bay would import this file.
///
/// Reads the extension list rather than `MediaKind::of_path`, which classifies *anything*
/// unrecognised as an image — right for an already-imported asset, wrong as a browse filter,
/// where it would list every `.txt` and `.zip` on the disk as importable media.
pub fn is_media(path: &Path) -> bool {
    const EXTENSIONS: &[&str] = &[
        "mp4", "mov", "mkv", "webm", "avi", "m4v", // video
        "mp3", "wav", "m4a", "aac", "flac", "ogg", // audio
        "png", "jpg", "jpeg", "gif", "bmp", "webp", "heic", "tiff", // stills
    ];
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Where the browser starts: the places a person keeps footage.
///
/// Home before volumes because that is where the work is; `/Volumes` is where the card reader
/// and the external drive appear, which is the other half of how footage reaches a Mac. Only
/// paths that exist are returned, so a machine with no external drives shows no empty branch.
pub fn roots() -> Vec<StorageEntry> {
    let mut roots = Vec::new();
    let mut push = |path: PathBuf, name: &str| {
        if path.is_dir() {
            roots.push(StorageEntry {
                path,
                name: name.to_string(),
                is_dir: true,
            });
        }
    };

    if let Some(home) = home_dir() {
        for folder in ["Desktop", "Movies", "Downloads", "Pictures", "Documents"] {
            push(home.join(folder), folder);
        }
        push(home.clone(), "Home");
    }
    push(PathBuf::from("/Volumes"), "Volumes");
    roots
}

/// The user's home directory.
///
/// `$HOME` rather than a dependency: this is one environment variable on every platform bay
/// targets, and the crate is otherwise free of platform code.
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|home| !home.as_os_str().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A scratch directory keyed by test name **and pid**.
    ///
    /// Both halves are load-bearing. `CLAUDE.md` records that the registry tests keyed a scratch
    /// directory by test name alone, so two test binaries running at once wiped each other's
    /// state — 11 of 12 concurrent runs failed. The port beside it already had the pid and the
    /// directory never got it.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bay-storage-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch directory");
        dir
    }

    fn touch(dir: &Path, name: &str) {
        std::fs::write(dir.join(name), b"x").expect("write fixture");
    }

    #[test]
    fn directories_come_before_files_and_both_sort_by_name() {
        let dir = scratch("order");
        std::fs::create_dir(dir.join("zulu")).unwrap();
        std::fs::create_dir(dir.join("alpha")).unwrap();
        touch(&dir, "b.mp4");
        touch(&dir, "A.mov");

        let names: Vec<String> = read_dir(&dir).into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["alpha", "zulu", "A.mov", "b.mp4"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The browse filter is not `MediaKind::of_path`, which calls anything unrecognised an image.
    /// Through that, a home directory lists every `.txt` and `.zip` on the disk as importable.
    #[test]
    fn only_media_files_are_listed() {
        let dir = scratch("filter");
        touch(&dir, "clip.mp4");
        touch(&dir, "notes.txt");
        touch(&dir, "archive.zip");
        touch(&dir, "photo.JPG"); // extension case must not matter

        let names: Vec<String> = read_dir(&dir).into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["clip.mp4", "photo.JPG"]);
        assert_eq!(
            MediaKind::of_path("notes.txt"),
            MediaKind::Image,
            "of_path still classifies unknown extensions as images, which is why is_media exists"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A dotfile is not what anyone is browsing for, and a Mac home directory is mostly dotfiles.
    #[test]
    fn hidden_entries_are_not_listed() {
        let dir = scratch("hidden");
        touch(&dir, ".hidden.mp4");
        std::fs::create_dir(dir.join(".git")).unwrap();
        touch(&dir, "visible.mp4");

        let names: Vec<String> = read_dir(&dir).into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["visible.mp4"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A directory that cannot be read is an empty listing, not a panic and not an error. A
    /// permission-denied folder is a normal thing to meet while browsing.
    #[test]
    fn an_unreadable_directory_yields_nothing() {
        assert!(read_dir(Path::new("/definitely/not/a/real/path")).is_empty());
        // A *file* is not a directory; `read_dir` on one must degrade the same way.
        let dir = scratch("notadir");
        touch(&dir, "clip.mp4");
        assert!(read_dir(&dir.join("clip.mp4")).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Every root offered must exist, or the tree shows branches that expand to nothing.
    #[test]
    fn every_root_is_a_real_directory() {
        for root in roots() {
            assert!(
                root.is_dir,
                "{} is offered as a root but is not a directory",
                root.name
            );
            assert!(root.path.is_dir(), "{} does not exist", root.path.display());
        }
    }
}
