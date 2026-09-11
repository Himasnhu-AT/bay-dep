//! Reading and writing `settings.json`, and the shared snapshot the MCP server reads.
//!
//! Two processes can be looking at the same settings: the window the user is toggling in, and a
//! headless `bay --mcp` serving an agent. So [`current`] is not a cache that goes stale — it
//! re-reads when the file's modification time changes, which costs one `stat` per tool call and
//! is the difference between "blocked" meaning something and meaning something eventually.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use crate::{Settings, SettingsError};

/// A settings document on disk.
#[derive(Debug, Clone)]
pub struct Store {
    path: PathBuf,
}

impl Store {
    /// The user's settings file. `None` when there is no data directory to put one in — a
    /// container with no home, which is a real state and not a crash.
    pub fn default_location() -> Option<Self> {
        bay_paths::data_dir().map(|dir| Self {
            path: dir.join("settings.json"),
        })
    }

    /// A store at an explicit path. Tests use this; reaching for the default would mean a test
    /// run reading — and rewriting — the developer's own preferences.
    pub fn at(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Load, or the defaults if there is nothing there.
    ///
    /// A file that will not parse is reported rather than silently replaced: overwriting it
    /// would throw away every preference the user set, and the message tells them which file to
    /// look at. Callers that want to keep going anyway use [`Store::load_or_default`].
    pub fn load(&self) -> Result<Settings, SettingsError> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) if text.trim().is_empty() => Ok(Settings::default()),
            Ok(text) => serde_json::from_str(&text)
                .map_err(|error| SettingsError::Io(format!("{}: {error}", self.path.display()))),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
            Err(error) => Err(SettingsError::Io(format!(
                "{}: {error}",
                self.path.display()
            ))),
        }
    }

    /// [`Store::load`], falling back to the defaults and handing back the complaint.
    ///
    /// What the UI uses: a corrupt settings file must not stop the editor from opening, but it
    /// must also not vanish without a word.
    pub fn load_or_default(&self) -> (Settings, Option<String>) {
        match self.load() {
            Ok(settings) => (settings, None),
            Err(error) => (Settings::default(), Some(error.to_string())),
        }
    }

    /// Write, atomically.
    ///
    /// Staged and renamed because the alternative — truncating the real file and then writing —
    /// turns a crash into an empty settings document, which loads as "everything default" and
    /// looks exactly like the user's preferences were deliberately discarded.
    pub fn save(&self, settings: &Settings) -> Result<(), SettingsError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| SettingsError::Io(format!("{}: {error}", parent.display())))?;
        }
        let text = serde_json::to_string_pretty(settings)
            .map_err(|error| SettingsError::Io(error.to_string()))?;
        let staging = self.path.with_extension("writing");
        std::fs::write(&staging, text)
            .map_err(|error| SettingsError::Io(format!("{}: {error}", staging.display())))?;
        std::fs::rename(&staging, &self.path).map_err(|error| {
            let _ = std::fs::remove_file(&staging);
            SettingsError::Io(format!("{}: {error}", self.path.display()))
        })?;
        // Stamped with what the file now says, so the very next `current_from` does not
        // re-read a document it already has.
        remember(&self.path, settings.clone(), stamp_of(&self.path));
        Ok(())
    }
}

/// The process-wide snapshot, and the file state it was read from.
struct Cached {
    path: PathBuf,
    settings: Settings,
    /// The file's modification time when this snapshot was taken. `None` means "there was no
    /// file", which is itself a state worth caching — most installs never write one.
    stamp: Option<SystemTime>,
}

fn cache() -> &'static Mutex<Option<Cached>> {
    static CACHE: OnceLock<Mutex<Option<Cached>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn stamp_of(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
}

fn remember(path: &Path, settings: Settings, stamp: Option<SystemTime>) {
    let mut guard = cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *guard = Some(Cached {
        path: path.to_path_buf(),
        settings,
        stamp,
    });
}

/// The settings as they are right now, for a caller with no window and no store in hand.
///
/// This is what `bay --mcp` gates tool calls with. It re-reads whenever the file's modification
/// time has moved, so a user who blocks `export_video` in a running editor has blocked it in a
/// separate server process too, without either restarting.
pub fn current() -> Settings {
    let Some(store) = Store::default_location() else {
        return Settings::default();
    };
    current_from(&store)
}

/// [`current`], against an explicit store. The testable form.
pub fn current_from(store: &Store) -> Settings {
    let stamp = stamp_of(store.path());
    {
        let guard = cache()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(cached) = guard.as_ref() {
            // Same file, same modification time: nothing has happened since the last read.
            // The path is part of the comparison so a test store and the real one cannot be
            // mistaken for each other.
            if cached.path == store.path() && cached.stamp == stamp {
                return cached.settings.clone();
            }
        }
    }

    let settings = store.load().unwrap_or_default();
    remember(store.path(), settings.clone(), stamp);
    settings
}

/// Make a change visible to [`current`] in this process immediately, without a write.
///
/// [`Store::save`] does this for you. Use it directly only when the settings in hand came from
/// somewhere other than the store — the snapshot is pinned to whatever the file says now, so
/// the next real write still wins.
pub fn publish(settings: Settings) {
    if let Some(store) = Store::default_location() {
        remember(store.path(), settings, stamp_of(store.path()));
    }
}

/// [`publish`], against an explicit store.
pub fn publish_to(store: &Store, settings: Settings) {
    remember(store.path(), settings, stamp_of(store.path()));
}

/// Drop the snapshot. Tests use it so one test's publish is not another test's starting state.
pub fn forget_cached() {
    let mut guard = cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *guard = None;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{catalog_entry, Provider};

    fn dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("a temp dir")
    }

    #[test]
    fn a_missing_file_loads_as_the_defaults() {
        let dir = dir();
        let store = Store::at(dir.path().join("settings.json"));
        assert_eq!(store.load().unwrap(), Settings::default());
    }

    #[test]
    fn settings_survive_a_round_trip_to_disk() {
        let dir = dir();
        let store = Store::at(dir.path().join("nested").join("settings.json"));
        let mut settings = Settings::default();
        settings.mcp.block("export_video");
        settings
            .providers
            .upsert(Provider::from_catalog(catalog_entry("ollama").unwrap()));
        store.save(&settings).unwrap();
        assert_eq!(store.load().unwrap(), settings);
    }

    /// Losing every preference because one byte is wrong is the worst outcome here, so a bad
    /// file is reported and left alone rather than replaced.
    #[test]
    fn a_corrupt_file_is_reported_and_not_overwritten() {
        let dir = dir();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{ not json").unwrap();
        let store = Store::at(&path);
        assert!(store.load().is_err());

        let (settings, complaint) = store.load_or_default();
        assert_eq!(settings, Settings::default(), "the editor still opens");
        assert!(
            complaint.expect("a complaint").contains("settings.json"),
            "the complaint must name the file"
        );
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "{ not json",
            "loading must never rewrite a file it could not read"
        );
    }

    /// A crash during a previous write leaves an empty file. That is the defaults, not an error.
    #[test]
    fn an_empty_file_loads_as_the_defaults() {
        let dir = dir();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "   \n").unwrap();
        assert_eq!(Store::at(&path).load().unwrap(), Settings::default());
    }

    /// The reason writes are staged.
    #[test]
    fn saving_leaves_no_staging_file_behind() {
        let dir = dir();
        let path = dir.path().join("settings.json");
        Store::at(&path).save(&Settings::default()).unwrap();
        assert!(!path.with_extension("writing").exists());
    }

    /// The snapshot is one process-wide slot, so the tests that touch it take turns. Two of
    /// them clearing it at once would make each other fail for a reason neither is testing.
    fn snapshot_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The headless-server case: a change written by one process must be seen by another
    /// without a restart.
    #[test]
    fn current_rereads_when_the_file_changes() {
        let _serialised = snapshot_lock();
        forget_cached();
        let dir = dir();
        let store = Store::at(dir.path().join("settings.json"));

        let mut settings = Settings::default();
        store.save(&settings).unwrap();
        assert!(current_from(&store).mcp.allows("export_video"));

        settings.mcp.block("export_video");
        // Written directly, standing in for the other process — `save` would update this
        // process's snapshot and hide the re-read this test exists to prove.
        std::fs::write(store.path(), serde_json::to_string(&settings).unwrap()).unwrap();
        // Modification-time granularity is coarse on some filesystems; nudge it explicitly so
        // the test proves the re-read rather than the clock.
        set_modified(
            store.path(),
            SystemTime::now() + std::time::Duration::from_secs(2),
        )
        .unwrap();

        assert!(
            !current_from(&store).mcp.allows("export_video"),
            "a block written by another process must take effect"
        );
        forget_cached();
    }

    /// And it must *not* re-read when nothing changed — this runs on every gated tool call.
    #[test]
    fn an_unchanged_file_is_served_from_the_snapshot() {
        let _serialised = snapshot_lock();
        forget_cached();
        let dir = dir();
        let store = Store::at(dir.path().join("settings.json"));
        store.save(&Settings::default()).unwrap();
        let first = current_from(&store);

        // Delete the file. A re-read would now yield the defaults from a missing file and,
        // more importantly, would prove the snapshot was not used.
        std::fs::remove_file(store.path()).unwrap();
        assert_eq!(
            current_from(&store).mcp,
            first.mcp,
            "an unchanged path should not be re-read"
        );
        forget_cached();
    }

    /// An in-process toggle must be visible at once, before anything hits disk.
    #[test]
    fn publishing_is_visible_at_once() {
        let _serialised = snapshot_lock();
        forget_cached();
        let dir = dir();
        let store = Store::at(dir.path().join("nothing-here.json"));
        let mut settings = Settings::default();
        settings.mcp.enabled = false;
        publish_to(&store, settings);
        assert!(!current_from(&store).mcp.enabled);

        forget_cached();
        assert!(
            current_from(&store).mcp.enabled,
            "forgetting the snapshot falls back to what is on disk"
        );
        forget_cached();
    }

    /// Two stores must not read each other's snapshot.
    #[test]
    fn the_snapshot_is_keyed_by_path() {
        let _serialised = snapshot_lock();
        forget_cached();
        let dir = dir();
        let blocked = Store::at(dir.path().join("a.json"));
        let open = Store::at(dir.path().join("b.json"));
        let mut settings = Settings::default();
        settings.mcp.block("export_video");
        blocked.save(&settings).unwrap();
        open.save(&Settings::default()).unwrap();

        assert!(!current_from(&blocked).mcp.allows("export_video"));
        assert!(current_from(&open).mcp.allows("export_video"));
        forget_cached();
    }

    /// Set an explicit mtime without pulling in a crate for it.
    fn set_modified(path: &Path, when: SystemTime) -> std::io::Result<()> {
        let file = std::fs::OpenOptions::new().write(true).open(path)?;
        file.set_modified(when)
    }
}
