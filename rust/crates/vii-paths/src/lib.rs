//! Where vii keeps per-user data.
//!
//! This exists because the answer was written five times — in the agent registry, the project
//! library, the speech sidecar and the UI's export paths — and four of them resolved `$HOME`,
//! which **Windows does not set**. The visible symptom was the editor opening with "could not
//! locate a home directory for the project library" and no way to save anything; the invisible
//! one was the registry writing itself into whatever directory vii was launched from.
//!
//! The per-platform rules are pure functions of an environment lookup, so the Windows answer is
//! tested on the Mac that ships it. Resolution written behind `#[cfg]` can only be checked by
//! building for the other platform and looking — which is how the original bug survived.

use std::path::PathBuf;

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

/// The directory for data vii owns on this user's behalf — projects, the agent registry, the
/// unpacked speech sidecar.
pub fn data_dir() -> Option<PathBuf> {
    resolve_data_dir(env_path, Platform::CURRENT)
}

/// Somewhere the user will actually find a file vii wrote for them.
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
    if let Some(explicit) = get("VII_DATA_DIR") {
        return Some(explicit);
    }
    let home = || resolve_home(&get, platform);
    match platform {
        Platform::MacOs => home().map(|h| h.join("Library/Application Support/vii")),
        Platform::Windows => get("LOCALAPPDATA")
            .or_else(|| home().map(|h| h.join("AppData/Local")))
            .map(|base| base.join("vii")),
        Platform::Unix => get("XDG_DATA_HOME")
            .or_else(|| home().map(|h| h.join(".local/share")))
            .map(|base| base.join("vii")),
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
                    .join("vii")
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
            Some(PathBuf::from(r"C:\Users\ada\AppData\Local").join("vii"))
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
            Some(PathBuf::from("/Users/ada/Library/Application Support/vii")),
            "this path is where existing projects already live — it must not move"
        );
    }

    #[test]
    fn unix_follows_xdg() {
        assert_eq!(
            resolve_data_dir(env(&[("HOME", "/home/ada")]), Platform::Unix),
            Some(PathBuf::from("/home/ada/.local/share/vii"))
        );
        assert_eq!(
            resolve_data_dir(
                env(&[("HOME", "/home/ada"), ("XDG_DATA_HOME", "/srv/data")]),
                Platform::Unix
            ),
            Some(PathBuf::from("/srv/data/vii")),
            "XDG_DATA_HOME wins where it is set"
        );
    }

    #[test]
    fn an_explicit_override_wins_on_every_platform() {
        let with_override = env(&[("HOME", "/Users/ada"), ("VII_DATA_DIR", "/scratch/vii")]);
        for platform in [Platform::MacOs, Platform::Windows, Platform::Unix] {
            assert_eq!(
                resolve_data_dir(&with_override, platform),
                Some(PathBuf::from("/scratch/vii")),
                "VII_DATA_DIR is how tests and packagers redirect vii ({platform:?})"
            );
        }
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
        assert!(
            data.ends_with("vii"),
            "{data:?} should be vii's own directory, not a shared one"
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
            "exports must not land inside vii's private data directory ({data:?})"
        );
    }
}
