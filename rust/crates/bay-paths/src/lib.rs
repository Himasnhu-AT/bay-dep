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

use std::path::{Path, PathBuf};

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
    resolve_data_dir(env_path, Platform::CURRENT)
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
    resolve_data_dir_with(get, platform, |path| path.is_dir())
}

/// The former name's directory, for a machine that used the app before it was renamed.
const LEGACY_NAME: &str = "vii";
const NAME: &str = "bay";

/// As [`resolve_data_dir`], with the "does this directory exist" test injected.
///
/// The rename from vii to bay moves this path, and the user's projects, the agent registry and
/// a possibly multi-gigabyte runtime directory are all inside it. Changing the answer without
/// looking would present an existing user with an empty project library and no clue where their
/// work went — the app would be working exactly as designed and would look broken.
///
/// So: the new location wins, unless it does not exist yet and the old one does, in which case
/// the old one keeps being used. Nothing is moved. A rename here is one `fs::rename` away from
/// being fast and one interrupted copy away from being a data-loss bug, and there is no version
/// of that trade worth taking for a directory that works perfectly where it is.
///
/// `exists` is injected so the migration is tested on a machine that has neither directory —
/// otherwise this branch is only ever exercised on the developer's own laptop, once.
fn resolve_data_dir_with(
    get: impl Fn(&str) -> Option<PathBuf>,
    platform: Platform,
    exists: impl Fn(&Path) -> bool,
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

    let current = base.join(NAME);
    let legacy = base.join(LEGACY_NAME);
    if !exists(&current) && exists(&legacy) {
        return Some(legacy);
    }
    Some(current)
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

    /// A directory test where only the listed paths exist.
    fn only(paths: &[&str]) -> impl Fn(&Path) -> bool + use<> {
        let set: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
        move |candidate| set.iter().any(|known| known == candidate)
    }

    /// Someone who used the app when it was called vii has their projects, their agent registry
    /// and possibly a gigabyte of runtime in the old directory. The rename must not present them
    /// with an empty library.
    #[test]
    fn a_machine_that_used_the_old_name_keeps_its_data() {
        let mac = env(&[("HOME", "/Users/ada")]);
        assert_eq!(
            resolve_data_dir_with(
                &mac,
                Platform::MacOs,
                only(&["/Users/ada/Library/Application Support/vii"])
            ),
            Some(PathBuf::from("/Users/ada/Library/Application Support/vii")),
            "the old directory is still where the work is"
        );
    }

    /// A fresh machine gets the new name, with no legacy directory anywhere.
    #[test]
    fn a_new_machine_uses_the_new_name() {
        let mac = env(&[("HOME", "/Users/ada")]);
        assert_eq!(
            resolve_data_dir_with(&mac, Platform::MacOs, only(&[])),
            Some(PathBuf::from("/Users/ada/Library/Application Support/bay"))
        );
    }

    /// Once the new directory exists it wins outright, even beside a leftover old one — or a
    /// user who had both would silently keep writing to the one they had stopped using.
    #[test]
    fn the_new_directory_wins_once_it_exists() {
        let mac = env(&[("HOME", "/Users/ada")]);
        assert_eq!(
            resolve_data_dir_with(
                &mac,
                Platform::MacOs,
                only(&[
                    "/Users/ada/Library/Application Support/bay",
                    "/Users/ada/Library/Application Support/vii",
                ])
            ),
            Some(PathBuf::from("/Users/ada/Library/Application Support/bay"))
        );
    }

    /// The fallback is not macOS-only: a Linux or Windows user is in exactly the same position.
    #[test]
    fn every_platform_finds_the_old_directory() {
        for (platform, vars, legacy, current) in [
            (
                Platform::Unix,
                vec![("HOME", "/home/ada")],
                "/home/ada/.local/share/vii",
                "/home/ada/.local/share/bay",
            ),
            (
                Platform::Windows,
                vec![("LOCALAPPDATA", r"C:\Users\ada\AppData\Local")],
                r"C:\Users\ada\AppData\Local/vii",
                r"C:\Users\ada\AppData\Local/bay",
            ),
        ] {
            assert_eq!(
                resolve_data_dir_with(env(&vars), platform, only(&[legacy])),
                Some(PathBuf::from(legacy)),
                "{platform:?} must keep using the old directory"
            );
            assert_eq!(
                resolve_data_dir_with(env(&vars), platform, only(&[])),
                Some(PathBuf::from(current)),
                "{platform:?} with nothing present takes the new name"
            );
        }
    }

    /// An explicit override outranks the migration, so a packager or a test that redirects the
    /// directory never silently gets a legacy path instead.
    #[test]
    fn an_override_still_beats_the_legacy_directory() {
        let with_override = env(&[("HOME", "/Users/ada"), ("BAY_DATA_DIR", "/scratch/bay")]);
        assert_eq!(
            resolve_data_dir_with(
                &with_override,
                Platform::MacOs,
                only(&["/Users/ada/Library/Application Support/vii"])
            ),
            Some(PathBuf::from("/scratch/bay"))
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
        let (Some(home), Some(data)) = (home(), data_dir()) else {
            eprintln!("skipping: no home directory in this environment");
            return;
        };
        assert!(
            data.starts_with(&home),
            "{data:?} should sit under {home:?}"
        );
        // Either name is correct: a machine that predates the rename keeps using the old
        // directory, which is the whole point of the migration above. What must never happen is
        // resolving to a directory shared with anything else.
        assert!(
            data.ends_with(NAME) || data.ends_with(LEGACY_NAME),
            "{data:?} should be this app's own directory, not a shared one"
        );
    }

    #[test]
    fn output_goes_somewhere_the_user_will_look() {
        let (Some(out), Some(data)) = (output_dir(), data_dir()) else {
            eprintln!("skipping: no home directory in this environment");
            return;
        };
        assert!(
            !out.starts_with(&data),
            "exports must not land inside bay's private data directory ({data:?})"
        );
    }
}
