//! Where bay keeps per-user data.
//!
//! This exists because the answer was written five times — in the agent registry, the project
//! library, the speech sidecar and the UI's export paths — and four of them resolved `$HOME`,
//! which **Windows does not set**. The visible symptom was the editor opening with "could not
//! locate a home directory for the project library" and no way to save anything; the invisible
//! one was the registry writing itself into whatever directory bay was launched from.
//!
//! The per-platform rules are pure functions of an environment lookup, so the Windows answer is
//! tested on the Mac that ships it. Resolution written behind `#[cfg]` can only be checked by
//! building for the other platform and looking — which is how the original bug survived.

use std::path::PathBuf;

pub mod tools;

/// Which set of conventions to follow.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    MacOs,
    Windows,
    Unix,
}

impl Platform {
    /// The platform this binary was compiled for.
    pub const CURRENT: Platform = if cfg!(target_os = "macos") {
        Platform::MacOs
    } else if cfg!(windows) {
        Platform::Windows
    } else {
        Platform::Unix
    };
}

/// The user's home directory.
pub fn home() -> Option<PathBuf> {
    resolve_home(env_path, Platform::CURRENT)
}

/// The directory for data bay owns on this user's behalf — projects, the agent registry, the
/// unpacked speech sidecar.
pub fn data_dir() -> Option<PathBuf> {
    if let Some(explicit) = env_path("BAY_DATA_DIR") {
        return Some(explicit);
    }
    resolve_data_dir(env_path, Platform::CURRENT).map(migrate_legacy_dir)
}

/// Rewrite an absolute path stored while the application directory was still named `vii`.
///
/// Project JSON keeps media paths, including generated SFX inside the data directory. Moving the
/// library without rewriting those references would preserve the project file while making its
/// media look missing. A failed directory rename returns the legacy data directory and therefore
/// deliberately leaves every stored path alone.
pub fn remap_legacy_data_path(path: &std::path::Path) -> Option<PathBuf> {
    remap_legacy_data_path_from(path, &data_dir()?)
}

/// As [`remap_legacy_data_path`], when the caller already knows the current data directory.
pub fn remap_legacy_data_path_from(
    path: &std::path::Path,
    current: &std::path::Path,
) -> Option<PathBuf> {
    if current.file_name().is_none_or(|name| name != NAME) {
        return None;
    }
    let legacy = current.with_file_name(LEGACY_NAME);
    let relative = path.strip_prefix(legacy).ok()?;
    Some(current.join(relative))
}

/// Where bay installs the runtimes it provisions for the user — ffmpeg, a Python, the Kokoro
/// venv.
///
/// Separate from the rest of [`data_dir`] so that "everything bay downloaded" is one directory
/// the user can measure, and delete, without taking their projects with it. A gigabyte of torch
/// mixed in among project files is a gigabyte nobody can safely remove.
pub fn runtime_dir() -> Option<PathBuf> {
    data_dir().map(|data| data.join("runtime"))
}

/// The directory provisioned executables are installed into.
///
/// Defined here rather than in the provisioner because [`tools`] has to search it and must not
/// depend on the crate that writes it — one definition, consulted from both sides, so a change
/// to the layout cannot leave the resolver looking in the old place.
pub fn managed_bin_dir() -> Option<PathBuf> {
    runtime_dir().map(|runtime| runtime.join("bin"))
}

/// Somewhere the user will actually find a file bay wrote for them.
///
/// Not the same question as [`data_dir`]: an exported MP4 is the user's, and burying it in
/// Application Support means they cannot find it.
pub fn output_dir() -> Option<PathBuf> {
    let home = home()?;
    for candidate in ["Desktop", "Movies", "Videos"] {
        let path = home.join(candidate);
        if path.is_dir() {
            return Some(path);
        }
    }
    Some(home)
}

/// `HOME` first on every platform: it is what a shell sets, and honouring it lets tests and
/// containers redirect. Windows only sets `USERPROFILE`.
fn resolve_home(get: impl Fn(&str) -> Option<PathBuf>, platform: Platform) -> Option<PathBuf> {
    get("HOME").or_else(|| match platform {
        Platform::Windows => get("USERPROFILE"),
        _ => None,
    })
}

/// `%LOCALAPPDATA%` rather than `%APPDATA%` on Windows: projects reference media by absolute
/// path, so roaming them to another machine produces a project whose every clip is missing.
/// That is worse than not roaming at all.
fn resolve_data_dir(get: impl Fn(&str) -> Option<PathBuf>, platform: Platform) -> Option<PathBuf> {
    resolve_data_dir_with(get, platform)
}

/// The former name's directory, for a machine that used the app before it was renamed.
const LEGACY_NAME: &str = "vii";
const NAME: &str = "bay";

/// As [`resolve_data_dir`], kept separate so platform resolution stays pure.
///
/// The rename from vii to bay moves this path, and the user's projects, the agent registry and
/// a possibly multi-gigabyte runtime directory are all inside it. Changing the answer without
/// looking would present an existing user with an empty project library and no clue where their
/// work went — the app would be working exactly as designed and would look broken.
///
/// Resolution always names the bay directory. [`data_dir`] performs the one-time same-volume
/// rename from the legacy directory before returning it; keeping the choice and the mutation
/// separate makes every platform's path deterministic in tests.
fn resolve_data_dir_with(
    get: impl Fn(&str) -> Option<PathBuf>,
    platform: Platform,
) -> Option<PathBuf> {
    if let Some(explicit) = get("BAY_DATA_DIR") {
        return Some(explicit);
    }
    let home = || resolve_home(&get, platform);
    let base = match platform {
        Platform::MacOs => home().map(|h| h.join("Library/Application Support")),
        Platform::Windows => {
            get("LOCALAPPDATA").or_else(|| home().map(|h| h.join("AppData/Local")))
        }
        Platform::Unix => get("XDG_DATA_HOME").or_else(|| home().map(|h| h.join(".local/share"))),
    }?;

    Some(base.join(NAME))
}

/// Move the old application directory into the current name on first use.
///
/// Both paths share a parent, so `rename` is atomic on the filesystems bay supports. If it fails
/// (permissions, a read-only home, or another process winning the race), keep using the legacy
/// directory for this run rather than presenting an empty library or risking a partial copy.
fn migrate_legacy_dir(current: PathBuf) -> PathBuf {
    if current.exists() || current.file_name().is_none_or(|name| name != NAME) {
        return current;
    }
    let legacy = current.with_file_name(LEGACY_NAME);
    if !legacy.is_dir() {
        return current;
    }
    match std::fs::rename(&legacy, &current) {
        Ok(()) => current,
        Err(_) => legacy,
    }
}

/// An environment variable as a path, treating empty as unset — an exported-but-empty variable
/// is a misconfiguration, and `PathBuf::from("")` silently means "the current directory".
fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var_os(key)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// A stand-in environment, so every platform's rules can be checked from one machine.
    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<PathBuf> + use<> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect();
        move |key| map.get(key).filter(|v| !v.is_empty()).map(PathBuf::from)
    }

    /// The bug this crate exists to fix: Windows sets USERPROFILE, never HOME.
    #[test]
    fn windows_finds_a_home_without_the_home_variable() {
        let windows = env(&[("USERPROFILE", r"C:\Users\ada")]);
        assert_eq!(
            resolve_home(&windows, Platform::Windows),
            Some(PathBuf::from(r"C:\Users\ada")),
            "Windows must fall back to USERPROFILE"
        );
        assert_eq!(
            resolve_data_dir(&windows, Platform::Windows),
            Some(
                PathBuf::from(r"C:\Users\ada")
                    .join("AppData/Local")
                    .join("bay")
            ),
            "with no LOCALAPPDATA, derive it from the profile rather than giving up"
        );
    }

    #[test]
    fn windows_prefers_localappdata_when_it_is_set() {
        let windows = env(&[
            ("USERPROFILE", r"C:\Users\ada"),
            ("LOCALAPPDATA", r"C:\Users\ada\AppData\Local"),
        ]);
        assert_eq!(
            resolve_data_dir(&windows, Platform::Windows),
            Some(PathBuf::from(r"C:\Users\ada\AppData\Local").join("bay"))
        );
    }

    /// The failure in the screenshot: no home found, so the library refused to open.
    #[test]
    fn a_windows_machine_with_neither_variable_still_reports_nothing_rather_than_a_wrong_path() {
        let bare = env(&[]);
        assert_eq!(
            resolve_data_dir(bare, Platform::Windows),
            None,
            "better to say we cannot find it than to write into the launch directory"
        );
    }

    #[test]
    fn macos_uses_application_support() {
        let mac = env(&[("HOME", "/Users/ada")]);
        assert_eq!(
            resolve_data_dir(&mac, Platform::MacOs),
            Some(PathBuf::from("/Users/ada/Library/Application Support/bay")),
            "this path is where existing projects already live — it must not move"
        );
    }

    #[test]
    fn unix_follows_xdg() {
        assert_eq!(
            resolve_data_dir(env(&[("HOME", "/home/ada")]), Platform::Unix),
            Some(PathBuf::from("/home/ada/.local/share/bay"))
        );
        assert_eq!(
            resolve_data_dir(
                env(&[("HOME", "/home/ada"), ("XDG_DATA_HOME", "/srv/data")]),
                Platform::Unix
            ),
            Some(PathBuf::from("/srv/data/bay")),
            "XDG_DATA_HOME wins where it is set"
        );
    }

    #[test]
    fn an_explicit_override_wins_on_every_platform() {
        let with_override = env(&[("HOME", "/Users/ada"), ("BAY_DATA_DIR", "/scratch/bay")]);
        for platform in [Platform::MacOs, Platform::Windows, Platform::Unix] {
            assert_eq!(
                resolve_data_dir(&with_override, platform),
                Some(PathBuf::from("/scratch/bay")),
                "BAY_DATA_DIR is how tests and packagers redirect bay ({platform:?})"
            );
        }
    }

    /// Someone who used the app when it was called vii has their projects, their agent registry
    /// and possibly a gigabyte of runtime in the old directory. The rename must not present them
    /// with an empty library.
    #[test]
    fn the_old_directory_is_atomically_migrated_to_bay() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("bay-path-migration-{stamp}"));
        let legacy = root.join(LEGACY_NAME);
        let current = root.join(NAME);
        std::fs::create_dir_all(legacy.join("projects")).unwrap();
        std::fs::write(legacy.join("projects").join("kept.json"), "{}").unwrap();

        assert_eq!(migrate_legacy_dir(current.clone()), current);
        assert!(!legacy.exists(), "the old brand path should be gone");
        assert!(
            current.join("projects").join("kept.json").exists(),
            "migration must preserve the user's projects"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    /// A fresh machine gets the new name, with no legacy directory anywhere.
    #[test]
    fn a_new_machine_uses_the_new_name() {
        let mac = env(&[("HOME", "/Users/ada")]);
        assert_eq!(
            resolve_data_dir_with(&mac, Platform::MacOs),
            Some(PathBuf::from("/Users/ada/Library/Application Support/bay"))
        );
    }

    /// The resolved path uses the current name on every platform; migration is a filesystem
    /// operation after resolution, not a permanent choice to keep writing the old brand.
    #[test]
    fn every_platform_resolves_the_bay_directory() {
        for (platform, vars, current) in [
            (
                Platform::Unix,
                vec![("HOME", "/home/ada")],
                "/home/ada/.local/share/bay",
            ),
            (
                Platform::Windows,
                vec![("LOCALAPPDATA", r"C:\Users\ada\AppData\Local")],
                r"C:\Users\ada\AppData\Local/bay",
            ),
        ] {
            assert_eq!(
                resolve_data_dir_with(env(&vars), platform),
                Some(PathBuf::from(current)),
                "{platform:?} must use the current application name"
            );
        }
    }

    /// An explicit override outranks the migration, so a packager or a test that redirects the
    /// directory never silently gets a legacy path instead.
    #[test]
    fn an_override_still_beats_the_legacy_directory() {
        let with_override = env(&[("HOME", "/Users/ada"), ("BAY_DATA_DIR", "/scratch/bay")]);
        assert_eq!(
            resolve_data_dir_with(&with_override, Platform::MacOs),
            Some(PathBuf::from("/scratch/bay"))
        );
    }

    #[test]
    fn stored_media_paths_follow_the_migrated_directory() {
        let current = PathBuf::from("/Users/ada/Library/Application Support/bay");
        let old = PathBuf::from("/Users/ada/Library/Application Support/vii/sfx/hit.wav");
        assert_eq!(
            remap_legacy_data_path_from(&old, &current),
            Some(current.join("sfx/hit.wav"))
        );
        assert_eq!(
            remap_legacy_data_path_from(PathBuf::from("/Movies/source.mov").as_path(), &current),
            None,
            "user-owned media outside the data directory must not move"
        );
    }

    #[test]
    fn an_empty_variable_is_not_a_path() {
        let empty = env(&[("HOME", "")]);
        assert_eq!(
            resolve_home(empty, Platform::Unix),
            None,
            "an empty value must not become the current directory"
        );
    }

    #[test]
    fn the_real_environment_gives_a_directory_under_the_real_home() {
        let (Some(home), Some(data)) = (home(), resolve_data_dir(env_path, Platform::CURRENT))
        else {
            eprintln!("skipping: no home directory in this environment");
            return;
        };
        assert!(
            data.starts_with(&home),
            "{data:?} should sit under {home:?}"
        );
        assert!(
            data.ends_with(NAME),
            "{data:?} should be this app's own directory, not a shared one"
        );
    }

    #[test]
    fn output_goes_somewhere_the_user_will_look() {
        let (Some(out), Some(data)) = (output_dir(), resolve_data_dir(env_path, Platform::CURRENT))
        else {
            eprintln!("skipping: no home directory in this environment");
            return;
        };
        assert!(
            !out.starts_with(&data),
            "exports must not land inside bay's private data directory ({data:?})"
        );
    }
}
