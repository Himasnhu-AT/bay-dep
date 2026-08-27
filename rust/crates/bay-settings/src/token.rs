//! The credential agents present to bay's MCP server.
//!
//! It used to live inside `bay-mcp`, which was fine while the server was the only thing that
//! cared. The MCP settings pane has to *show* it and *rotate* it, and the UI crate cannot
//! depend on `bay-mcp` — that is the dependency cycle the workspace forbids. So the file, its
//! format and its permissions are defined once here, and `bay-mcp` reads the same definition.
//!
//! 64 hexadecimal characters from the OS CSPRNG, in a `0600` file. Loopback is a network
//! boundary, not an authorization one: any process running as the user can connect to the
//! port, and this is what stops an unrelated one from driving the editor.

use std::io::Write;
use std::path::{Path, PathBuf};

/// 32 random bytes, hex encoded.
pub const TOKEN_BYTES: usize = 32;
pub const TOKEN_HEX_LEN: usize = TOKEN_BYTES * 2;

/// Where the token lives, in bay's per-user data directory.
pub fn default_path() -> Option<PathBuf> {
    bay_paths::data_dir().map(|dir| dir.join("mcp-token"))
}

/// Whether `value` is the shape a bay token has.
pub fn is_valid(value: &str) -> bool {
    value.len() == TOKEN_HEX_LEN && value.bytes().all(|b| b.is_ascii_hexdigit())
}

/// A fresh token. Never returned without being written — a token nothing persisted is one no
/// client could ever present.
fn generate() -> std::io::Result<String> {
    let mut random = [0u8; TOKEN_BYTES];
    getrandom::fill(&mut random)
        .map_err(|error| std::io::Error::other(format!("could not generate a token: {error}")))?;
    Ok(hex(&random))
}

/// Read the token at `path`, creating one if there is none.
///
/// Concurrency matters here: two bay processes starting together must end up agreeing. The
/// create is exclusive, and losing the race means reading the winner's value rather than
/// overwriting it with one no already-configured client knows.
pub fn read_or_create(path: &Path) -> std::io::Result<String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    match read(path) {
        Ok(value) => return Ok(value),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

    let fresh = generate()?;
    match create_new(path, fresh.as_bytes()) {
        Ok(()) => Ok(fresh),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => read(path),
        Err(error) => Err(error),
    }
}

/// Read an existing token, rejecting a file that is not one.
pub fn read(path: &Path) -> std::io::Result<String> {
    let text = std::fs::read_to_string(path)?;
    let value = text.trim().to_string();
    if !is_valid(&value) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "{} is not a valid bay MCP token; remove it to generate a fresh one",
                path.display()
            ),
        ));
    }
    restrict(path)?;
    Ok(value)
}

/// Replace the token with a new one, and return it.
///
/// This is what the "Rotate token" button does, and it is a real revocation: every client
/// configured with the old value stops being able to reach bay until it is reconfigured. The
/// pane says so, because a rotate that silently breaks Claude Code is worse than no button.
pub fn rotate(path: &Path) -> std::io::Result<String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let fresh = generate()?;
    // Written to a sibling and renamed so a crash mid-write cannot leave a truncated token —
    // which reads as "not a valid bay MCP token" and locks every client out at once.
    let staging = path.with_extension("rotating");
    let _ = std::fs::remove_file(&staging);
    create_new(&staging, fresh.as_bytes())?;
    std::fs::rename(&staging, path)?;
    restrict(path)?;
    Ok(fresh)
}

/// A short form for a status line: the first eight characters. Never the whole token — a full
/// credential in a screenshot is a credential shared.
pub fn short(value: &str) -> String {
    let head: String = value.chars().take(8).collect();
    format!("{head}…")
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(char::from(DIGITS[usize::from(byte >> 4)]));
        encoded.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    encoded
}

#[cfg(unix)]
fn create_new(path: &Path, value: &[u8]) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(value)
}

#[cfg(not(unix))]
fn create_new(path: &Path, value: &[u8]) -> std::io::Result<()> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(value)
}

#[cfg(unix)]
fn restrict(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn restrict(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("a temp dir")
    }

    #[test]
    fn a_created_token_is_the_right_shape_and_stable_across_reads() {
        let dir = dir();
        let path = dir.path().join("nested").join("mcp-token");
        let first = read_or_create(&path).unwrap();
        assert!(is_valid(&first), "not a 64-char hex token: {first}");
        assert_eq!(
            read_or_create(&path).unwrap(),
            first,
            "a second start must not invalidate every configured client"
        );
    }

    /// The whole point of the credential.
    #[cfg(unix)]
    #[test]
    fn the_token_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = dir();
        let path = dir.path().join("mcp-token");
        read_or_create(&path).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    /// Rotation must actually change the value and re-secure the file, not just rewrite it.
    #[test]
    fn rotating_produces_a_different_token() {
        let dir = dir();
        let path = dir.path().join("mcp-token");
        let before = read_or_create(&path).unwrap();
        let after = rotate(&path).unwrap();
        assert_ne!(before, after, "rotate must revoke the old credential");
        assert!(is_valid(&after));
        assert_eq!(read(&path).unwrap(), after, "and persist it");
        assert!(
            !path.with_extension("rotating").exists(),
            "the staging file must not be left behind"
        );
    }

    /// Rotating twice in a row must work — the staging path is reused, and a leftover file from
    /// the first rotation would make the second fail with AlreadyExists.
    #[test]
    fn rotating_twice_works() {
        let dir = dir();
        let path = dir.path().join("mcp-token");
        let one = rotate(&path).unwrap();
        let two = rotate(&path).unwrap();
        assert_ne!(one, two);
    }

    #[cfg(unix)]
    #[test]
    fn a_rotated_token_is_still_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = dir();
        let path = dir.path().join("mcp-token");
        read_or_create(&path).unwrap();
        rotate(&path).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    /// A truncated or hand-edited file must be reported, not accepted. Accepting a short token
    /// would silently weaken the credential.
    #[test]
    fn a_malformed_token_file_is_rejected() {
        let dir = dir();
        let path = dir.path().join("mcp-token");
        std::fs::write(&path, "not-a-token").unwrap();
        let error = read(&path).expect_err("a malformed token must not be accepted");
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
        assert!(
            read_or_create(&path).is_err(),
            "and must not be replaced silently"
        );
    }

    #[test]
    fn validation_rejects_the_near_misses() {
        assert!(is_valid(&"a".repeat(64)));
        assert!(!is_valid(&"a".repeat(63)));
        assert!(!is_valid(&"a".repeat(65)));
        assert!(!is_valid(&"g".repeat(64)), "g is not a hex digit");
        assert!(!is_valid(""));
    }

    /// A whitespace-padded file is what an editor leaves behind; it is still the same token.
    #[test]
    fn surrounding_whitespace_is_tolerated() {
        let dir = dir();
        let path = dir.path().join("mcp-token");
        let value = "b".repeat(64);
        std::fs::write(&path, format!("  {value}\n")).unwrap();
        assert_eq!(read(&path).unwrap(), value);
    }

    #[test]
    fn the_short_form_hides_most_of_the_token() {
        let value = "0123456789abcdef".repeat(4);
        assert_eq!(short(&value), "01234567…");
        assert!(short(&value).len() < value.len() / 4);
    }
}
