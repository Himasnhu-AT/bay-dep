//! Provider API keys, kept out of the settings document.
//!
//! `settings.json` describes preferences and is unremarkable to read. A key is different: it
//! spends the user's money and, on some providers, reads their account. So keys go in their own
//! file, written `0600` on Unix, and nothing else in bay reads it — callers ask for one key by
//! provider id at the moment they need it.
//!
//! This is not a keychain. It is the honest floor: the file is owner-only, it is never included
//! in the settings the rest of the app passes around, and [`crate::providers::KeyHint`] is what
//! travels instead. A platform keychain would be better and would slot in behind the same three
//! functions.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::SettingsError;

/// Where keys live, beside the settings document.
pub fn default_path() -> Option<PathBuf> {
    bay_paths::data_dir().map(|dir| dir.join("provider-keys.json"))
}

/// The on-disk map, loaded from `path`. A missing file is an empty map, not an error — that is
/// the state of every install where nobody has entered a key.
pub fn load(path: &Path) -> Result<BTreeMap<String, String>, SettingsError> {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|error| SettingsError::Io(format!("{}: {error}", path.display()))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(error) => Err(SettingsError::Io(format!("{}: {error}", path.display()))),
    }
}

/// Store one key, creating the file `0600` if it is not there.
pub fn put(path: &Path, provider_id: &str, key: &str) -> Result<(), SettingsError> {
    let key = key.trim();
    if key.is_empty() {
        return Err(SettingsError::Invalid("that key is empty".into()));
    }
    let mut all = load(path)?;
    all.insert(provider_id.to_string(), key.to_string());
    write(path, &all)
}

pub fn get(path: &Path, provider_id: &str) -> Result<Option<String>, SettingsError> {
    Ok(load(path)?.get(provider_id).cloned())
}

pub fn forget(path: &Path, provider_id: &str) -> Result<bool, SettingsError> {
    let mut all = load(path)?;
    let had = all.remove(provider_id).is_some();
    if had {
        write(path, &all)?;
    }
    Ok(had)
}

fn write(path: &Path, all: &BTreeMap<String, String>) -> Result<(), SettingsError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| SettingsError::Io(format!("{}: {error}", parent.display())))?;
    }
    let text =
        serde_json::to_string_pretty(all).map_err(|error| SettingsError::Io(error.to_string()))?;
    std::fs::write(path, text)
        .map_err(|error| SettingsError::Io(format!("{}: {error}", path.display())))?;
    restrict(path)
}

/// Owner read/write only. A key file the rest of the machine can read is a key file that leaked.
#[cfg(unix)]
fn restrict(path: &Path) -> Result<(), SettingsError> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|error| SettingsError::Io(format!("{}: {error}", path.display())))
}

#[cfg(not(unix))]
fn restrict(_path: &Path) -> Result<(), SettingsError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("a temp dir")
    }

    /// A machine where nobody has typed a key is the common case, and it must not be an error.
    #[test]
    fn a_missing_file_reads_as_no_keys() {
        let dir = dir();
        let path = dir.path().join("provider-keys.json");
        assert!(load(&path).unwrap().is_empty());
        assert_eq!(get(&path, "anthropic").unwrap(), None);
        assert!(!forget(&path, "anthropic").unwrap());
    }

    #[test]
    fn a_stored_key_comes_back_and_can_be_forgotten() {
        let dir = dir();
        let path = dir.path().join("nested").join("provider-keys.json");
        put(&path, "anthropic", "sk-ant-real-key").unwrap();
        assert_eq!(
            get(&path, "anthropic").unwrap().as_deref(),
            Some("sk-ant-real-key")
        );
        assert!(forget(&path, "anthropic").unwrap());
        assert_eq!(get(&path, "anthropic").unwrap(), None);
    }

    /// The reason this file exists at all.
    #[cfg(unix)]
    #[test]
    fn the_key_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = dir();
        let path = dir.path().join("provider-keys.json");
        put(&path, "openai", "sk-proj-abc").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "keys must not be group or world readable");
    }

    /// Rewriting must not widen the permissions the first write set.
    #[cfg(unix)]
    #[test]
    fn a_second_write_keeps_the_file_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = dir();
        let path = dir.path().join("provider-keys.json");
        put(&path, "openai", "sk-one").unwrap();
        put(&path, "google", "sk-two").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        assert_eq!(load(&path).unwrap().len(), 2);
    }

    #[test]
    fn an_empty_key_is_refused_rather_than_stored() {
        let dir = dir();
        let path = dir.path().join("provider-keys.json");
        assert!(put(&path, "openai", "   ").is_err());
        assert!(!path.exists(), "a refused key must not create the file");
    }

    /// Keys are trimmed: a pasted key usually arrives with a trailing newline, and a key with
    /// whitespace on it fails at the provider with an error nobody can diagnose.
    #[test]
    fn a_pasted_key_is_trimmed() {
        let dir = dir();
        let path = dir.path().join("provider-keys.json");
        put(&path, "openai", "  sk-proj-abc\n").unwrap();
        assert_eq!(
            get(&path, "openai").unwrap().as_deref(),
            Some("sk-proj-abc")
        );
    }

    #[test]
    fn a_corrupt_key_file_is_reported_not_ignored() {
        let dir = dir();
        let path = dir.path().join("provider-keys.json");
        std::fs::write(&path, "{ not json").unwrap();
        assert!(matches!(load(&path), Err(SettingsError::Io(_))));
    }
}
