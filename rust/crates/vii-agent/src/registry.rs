//! Which vii windows are open, and how to reach each one.
//!
//! One editor window is one agent endpoint, because an agent edits *a* document and the whole
//! point is watching it happen in the window in front of you. A single fixed port cannot serve
//! two windows, so instead each window claims the first free port in a small range and writes
//! a note saying which project it is showing.
//!
//! **Liveness is decided by the port, not by the pid.** A pid can be recycled, and a process
//! can be alive without still listening; but a port that accepts a fresh bind is definitively
//! nobody's. So [`live`] reaps by trying to bind, which is cheap and cannot be fooled.

use std::net::{Ipv4Addr, TcpListener};
use std::path::PathBuf;

/// Ports a vii window may claim. The first is the documented default so a single window — the
/// common case — is always reachable at the address in the README.
pub const PORT_RANGE: std::ops::RangeInclusive<u16> = 7333..=7342;

/// A vii window that is accepting agent calls.
#[derive(Debug, Clone, PartialEq)]
pub struct Instance {
    pub port: u16,
    pub pid: u32,
    /// The project this window has open, if any — what a human would use to tell them apart.
    pub project: Option<String>,
}

impl Instance {
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/mcp", self.port)
    }

    /// The exact command that points an MCP client at this window.
    pub fn mcp_add_command(&self) -> String {
        let name = if self.port == *PORT_RANGE.start() {
            "vii".to_string()
        } else {
            format!("vii-{}", self.port)
        };
        format!("claude mcp add --transport http {name} {}", self.url())
    }
}

fn registry_dir() -> PathBuf {
    if let Ok(explicit) = std::env::var("VII_AGENT_DIR") {
        return PathBuf::from(explicit);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    #[cfg(target_os = "macos")]
    let base = PathBuf::from(home).join("Library/Application Support/vii");
    #[cfg(not(target_os = "macos"))]
    let base = PathBuf::from(home).join(".local/share/vii");
    base.join("agents")
}

fn note_path(port: u16) -> PathBuf {
    registry_dir().join(format!("{port}.json"))
}

/// Whether anything is listening on `port`.
///
/// Implemented as "can we bind it?" rather than "can we connect?": a connect succeeds against
/// a socket in a half-dead state, whereas a successful bind proves the port is genuinely free.
fn port_free(port: u16) -> bool {
    TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok()
}

/// Claim a port for this window, returning its bound listener.
///
/// Takes the listener rather than just the number so there is no window between checking and
/// binding for a second instance to slip through.
pub fn claim() -> Option<(TcpListener, u16)> {
    for port in PORT_RANGE {
        if let Ok(listener) = TcpListener::bind((Ipv4Addr::LOCALHOST, port)) {
            return Some((listener, port));
        }
    }
    None
}

/// Record that this window is serving on `port`.
pub fn register(port: u16, project: Option<&str>) -> std::io::Result<()> {
    let dir = registry_dir();
    std::fs::create_dir_all(&dir)?;
    let note = serde_json::json!({
        "port": port,
        "pid": std::process::id(),
        "project": project,
    });
    std::fs::write(note_path(port), note.to_string())
}

/// Forget this window. Safe to call when nothing was registered.
pub fn deregister(port: u16) {
    let _ = std::fs::remove_file(note_path(port));
}

/// Every vii window currently accepting agent calls, lowest port first.
///
/// Stale notes — a window that crashed without cleaning up — are removed as they are found, so
/// the list never grows lies over time.
pub fn live() -> Vec<Instance> {
    let dir = registry_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut instances: Vec<Instance> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(note) = serde_json::from_str::<serde_json::Value>(&text) else {
            let _ = std::fs::remove_file(&path);
            continue;
        };
        let Some(port) = note.get("port").and_then(|p| p.as_u64()) else {
            let _ = std::fs::remove_file(&path);
            continue;
        };
        let port = port as u16;
        if port_free(port) {
            // Nobody is listening: the window is gone.
            let _ = std::fs::remove_file(&path);
            continue;
        }
        instances.push(Instance {
            port,
            pid: note.get("pid").and_then(|p| p.as_u64()).unwrap_or(0) as u32,
            project: note
                .get("project")
                .and_then(|p| p.as_str())
                .map(str::to_string),
        });
    }
    instances.sort_by_key(|instance| instance.port);
    instances
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The registry is addressed by a process-global env var, so tests that redirect it must
    /// not run at the same time — otherwise one test's scratch dir becomes another's.
    static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// Point the registry at a scratch directory so a test never touches the real one.
    struct Scratch(
        PathBuf,
        #[allow(dead_code)] std::sync::MutexGuard<'static, ()>,
    );

    impl Scratch {
        fn new(name: &str) -> Self {
            let guard = SERIAL.lock().unwrap_or_else(|error| error.into_inner());
            let dir = std::env::temp_dir().join(format!("vii-registry-{name}"));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("scratch dir");
            unsafe { std::env::set_var("VII_AGENT_DIR", &dir) };
            Scratch(dir, guard)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
            unsafe { std::env::remove_var("VII_AGENT_DIR") };
        }
    }

    #[test]
    fn a_claimed_port_is_reported_and_a_released_one_is_reaped() {
        let _scratch = Scratch::new("claim");
        let (listener, port) = claim().expect("a port should be free");
        register(port, Some("Demo")).expect("register");

        let listed = live();
        assert_eq!(listed.len(), 1, "the claimed window should be listed");
        assert_eq!(listed[0].port, port);
        assert_eq!(listed[0].project.as_deref(), Some("Demo"));

        // Dropping the listener frees the port; the note is now a lie and must be reaped.
        drop(listener);
        assert!(
            live().is_empty(),
            "a window that stopped listening must not stay in the list"
        );
        assert!(
            !note_path(port).exists(),
            "the stale note should have been removed"
        );
    }

    #[test]
    fn two_windows_get_different_ports() {
        let _scratch = Scratch::new("two");
        let (first_listener, first) = claim().expect("first port");
        let (second_listener, second) = claim().expect("second port");
        assert_ne!(first, second, "each window needs its own endpoint");
        register(first, Some("A")).unwrap();
        register(second, Some("B")).unwrap();

        let listed = live();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].port, first);
        assert_eq!(listed[1].port, second);
        drop(first_listener);
        drop(second_listener);
    }

    /// The first window must land on the documented default, or the README's `claude mcp add`
    /// line is wrong for the overwhelmingly common single-window case.
    #[test]
    fn the_first_window_takes_the_documented_port() {
        let _scratch = Scratch::new("default");
        let Some((listener, port)) = claim() else {
            eprintln!("skipping: no port in range is free on this machine");
            return;
        };
        if port != *PORT_RANGE.start() {
            eprintln!(
                "skipping: {} is already in use by something else",
                PORT_RANGE.start()
            );
            return;
        }
        let instance = Instance {
            port,
            pid: 0,
            project: None,
        };
        assert_eq!(
            instance.mcp_add_command(),
            "claude mcp add --transport http vii http://127.0.0.1:7333/mcp"
        );
        drop(listener);
    }

    #[test]
    fn a_second_window_is_named_so_both_can_be_registered() {
        let instance = Instance {
            port: 7334,
            pid: 0,
            project: None,
        };
        assert!(
            instance.mcp_add_command().contains("vii-7334"),
            "a second window needs a distinct MCP server name: {}",
            instance.mcp_add_command()
        );
    }

    #[test]
    fn a_corrupt_note_is_removed_rather_than_crashing_the_listing() {
        let _scratch = Scratch::new("corrupt");
        std::fs::create_dir_all(registry_dir()).unwrap();
        std::fs::write(registry_dir().join("9999.json"), "not json at all").unwrap();
        assert!(live().is_empty());
        assert!(!registry_dir().join("9999.json").exists());
    }
}
