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

/// The port a vii window serves agent calls on.
///
/// One port, because vii is deliberately single-window for now: a second launch focuses the
/// window that is already open rather than starting a rival. That keeps "which document is the
/// agent editing?" answerable without the user having to think about it.
pub const DEFAULT_PORT: u16 = 7333;

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
        format!(
            "claude mcp add --transport http vii http://127.0.0.1:{}/mcp",
            self.port
        )
    }
}

fn registry_dir() -> PathBuf {
    if let Ok(explicit) = std::env::var("VII_AGENT_DIR") {
        return PathBuf::from(explicit);
    }
    vii_paths::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("agents")
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

/// Claim the agent port for this window, returning its bound listener.
///
/// Returns the bound listener rather than just the number so there is no gap between "this
/// port was free" and "we are listening on it" for a second launch to slip through — the OS
/// bind is the lock.
pub fn claim() -> Option<TcpListener> {
    TcpListener::bind((Ipv4Addr::LOCALHOST, DEFAULT_PORT)).ok()
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
    fn a_claimed_window_is_reported_and_a_closed_one_is_reaped() {
        let _scratch = Scratch::new("claim");
        let Some(listener) = claim() else {
            eprintln!("skipping: port {DEFAULT_PORT} is in use on this machine");
            return;
        };
        register(DEFAULT_PORT, Some("Demo")).expect("register");

        let listed = live();
        assert_eq!(listed.len(), 1, "the open window should be listed");
        assert_eq!(listed[0].port, DEFAULT_PORT);
        assert_eq!(listed[0].project.as_deref(), Some("Demo"));

        // Dropping the listener frees the port; the note is now a lie and must be reaped.
        drop(listener);
        assert!(
            live().is_empty(),
            "a window that stopped listening must not stay in the list"
        );
        assert!(
            !note_path(DEFAULT_PORT).exists(),
            "the stale note should have been removed"
        );
    }

    /// Only one window may hold the port. That IS the single-instance lock — a second launch
    /// finding it taken is how it knows to focus the existing window instead of opening a
    /// rival with its own separate document.
    #[test]
    fn a_second_claim_is_refused_while_the_first_holds_the_port() {
        let _scratch = Scratch::new("single");
        let Some(first) = claim() else {
            eprintln!("skipping: port {DEFAULT_PORT} is in use on this machine");
            return;
        };
        assert!(
            claim().is_none(),
            "a second window must not be able to claim the port"
        );
        drop(first);
        // Once the first releases it, a new window can take over.
        assert!(
            claim().is_some(),
            "the port must be reusable after the window closes"
        );
    }

    #[test]
    fn the_add_command_names_the_documented_port() {
        let instance = Instance {
            port: DEFAULT_PORT,
            pid: 0,
            project: None,
        };
        assert_eq!(
            instance.mcp_add_command(),
            "claude mcp add --transport http vii http://127.0.0.1:7333/mcp"
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
