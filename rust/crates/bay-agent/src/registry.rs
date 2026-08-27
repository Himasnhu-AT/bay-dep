//! Who is serving agent calls, and how to reach them.
//!
//! **The endpoint is a contract, not an implementation detail.**
//! `claude mcp add --transport http bay http://127.0.0.1:7333/mcp` writes that URL into the
//! user's MCP client configuration, where it stays. So the port is fixed, exactly one process
//! may own it, and a conflict is resolved by *identifying the owner* — never by moving to
//! another port, which produces a server nothing is configured to talk to.
//!
//! That rule is what shapes the rest:
//!
//! - **Everything that serves registers**, editor window or `bay --mcp` alike, with its kind and
//!   pid. Headless servers used not to, so `bay --agents` reported "no bay window is open" while
//!   a headless one was serving the very endpoint being asked about, and the suggested fix
//!   (`bay --mcp --port 0`) produced an OS-assigned port no client could reach.
//! - **[`conflict_advice`] names what holds the port**, so "address already in use" becomes "a
//!   bay window is already serving there, showing Reel v2".
//! - **Losing the race is never silent.** A headless server refuses to start and says why; an
//!   editor still opens, because it is useful without agents, but carries the reason into the
//!   window rather than only to a terminal nobody is looking at.
//!
//! **Liveness is decided by the port, not by the pid.** A pid can be recycled, and a process
//! can be alive without still listening; but a port that accepts a fresh bind is definitively
//! nobody's. So [`live`] reaps by trying to bind, which is cheap and cannot be fooled.

use std::net::{Ipv4Addr, TcpListener};
use std::path::PathBuf;

/// The port a bay window serves agent calls on.
///
/// One port, because bay is deliberately single-window for now: a second launch focuses the
/// window that is already open rather than starting a rival. That keeps "which document is the
/// agent editing?" answerable without the user having to think about it.
pub const DEFAULT_PORT: u16 = 7333;

/// The port this process serves on.
///
/// A constant until it needed to not be. The tests below claim a real port, and a real port is
/// shared with the whole machine — so a `bay --mcp` running in another terminal, or an editor
/// window the developer left open, would make them fail on a tree with nothing wrong with it.
/// A test that fails for reasons outside the repository teaches people to re-run it until it
/// passes, which is how a genuine failure gets ignored.
///
/// So the port is resolved, not hardcoded, and the tests give themselves a private one. The
/// override is not test-only scaffolding: running two checkouts side by side wants it too, and
/// it is the seam the per-window ports in the roadmap will use.
pub fn agent_port() -> u16 {
    std::env::var("BAY_AGENT_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

/// What kind of process is serving the endpoint.
///
/// Recorded because every message about a conflict is useless without it. "Port 7333 is in use"
/// sends someone hunting for a rogue process; "a bay window is already serving there, showing
/// Reel v2" tells them the answer is on their screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// An editor window. Agent edits land in the timeline the user is looking at.
    Editor,
    /// `bay --mcp`. Same tools, its own document, no window.
    Headless,
}

impl Kind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Kind::Editor => "editor",
            Kind::Headless => "headless",
        }
    }

    fn parse(text: Option<&str>) -> Kind {
        match text {
            Some("headless") => Kind::Headless,
            // Notes written before this field existed were always editor windows, because
            // headless servers did not register at all.
            _ => Kind::Editor,
        }
    }
}

/// A bay process that is accepting agent calls.
#[derive(Debug, Clone, PartialEq)]
pub struct Instance {
    pub port: u16,
    pub pid: u32,
    pub kind: Kind,
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
            "claude mcp add --transport http bay http://127.0.0.1:{}/mcp \
             --header \"Authorization: Bearer $BAY_MCP_TOKEN\"",
            self.port
        )
    }
}

fn registry_dir() -> PathBuf {
    if let Ok(explicit) = std::env::var("BAY_AGENT_DIR") {
        return PathBuf::from(explicit);
    }
    bay_paths::data_dir()
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
///
/// **A `false` here is not proof a window is alive.** macOS returns `EADDRINUSE` for a few
/// milliseconds after a listening socket is closed — measured while chasing a flaky test: the
/// rebind immediately after `drop` fails, the one 5 ms later succeeds. So a window that has just
/// closed can briefly still look open.
///
/// That is the harmless direction and the reason this is left as it is. Erring towards "alive"
/// means [`live`] keeps a note it could have reaped, and the next call reaps it; erring the
/// other way would delete a running window's registration and make it unreachable. Any caller
/// that needs certainty should re-ask rather than treat one answer as final.
fn port_free(port: u16) -> bool {
    TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok()
}

/// Claim the agent port for this window, returning its bound listener.
///
/// Returns the bound listener rather than just the number so there is no gap between "this
/// port was free" and "we are listening on it" for a second launch to slip through — the OS
/// bind is the lock.
pub fn claim() -> Option<TcpListener> {
    TcpListener::bind((Ipv4Addr::LOCALHOST, agent_port())).ok()
}

/// Record that this process is serving on `port`.
pub fn register(port: u16, kind: Kind, project: Option<&str>) -> std::io::Result<()> {
    let dir = registry_dir();
    std::fs::create_dir_all(&dir)?;
    let note = serde_json::json!({
        "port": port,
        "pid": std::process::id(),
        "kind": kind.as_str(),
        "project": project,
    });
    std::fs::write(note_path(port), note.to_string())
}

/// Who holds `port`.
#[derive(Debug, Clone, PartialEq)]
pub enum Owner {
    /// Nothing is listening.
    Free,
    /// A bay process, which said so in the registry.
    Bay(Instance),
    /// Something is listening, but no bay registered it.
    Foreign,
}

/// Work out who holds `port`, without reaping anything.
///
/// Deliberately not [`live`]: that prunes notes as a side effect, which is the wrong thing to do
/// while composing an error message about a port somebody else holds.
pub fn owner(port: u16) -> Owner {
    if port_free(port) {
        return Owner::Free;
    }
    match read_note(port) {
        Some(instance) => Owner::Bay(instance),
        None => Owner::Foreign,
    }
}

fn read_note(port: u16) -> Option<Instance> {
    let text = std::fs::read_to_string(note_path(port)).ok()?;
    let note: serde_json::Value = serde_json::from_str(&text).ok()?;
    Some(Instance {
        port: note.get("port").and_then(|p| p.as_u64())? as u16,
        pid: note.get("pid").and_then(|p| p.as_u64()).unwrap_or(0) as u32,
        kind: Kind::parse(note.get("kind").and_then(|k| k.as_str())),
        project: note
            .get("project")
            .and_then(|p| p.as_str())
            .map(str::to_string),
    })
}

/// What the process that could not get the port was trying to be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wanted {
    Editor,
    Headless,
}

/// What to tell someone whose start was refused, and whether it is fatal.
///
/// **This never suggests a different port, and that is the whole point.** The endpoint is not an
/// implementation detail — `claude mcp add --transport http bay http://127.0.0.1:7333/mcp`
/// writes it into the user's MCP client configuration, so a bay that moves to another port is a
/// bay no configured client can reach. The old advice here was `bay --mcp --port 0`, which asks
/// the OS for an arbitrary free port: the server starts, prints nothing anyone can use, and the
/// agent that prompted all this still cannot connect. Relocating looks like a fix and is not one.
///
/// So a conflict is resolved by *naming the owner*. Every branch below answers "what is holding
/// it, and what do I do about it", and `--port` stays for the case it is actually for — a second
/// checkout, or CI — where the caller knows to reconfigure their client.
///
/// Pure, so every combination is tested without binding a port or starting a process.
pub fn conflict_advice(port: u16, wanted: Wanted, owner: &Owner) -> String {
    match (wanted, owner) {
        (_, Owner::Free) => format!("127.0.0.1:{port} is free"),

        // The case the user hits most: a window is open, and they asked for a second server.
        // Nothing is wrong — the endpoint they want is already answering.
        (Wanted::Headless, Owner::Bay(instance)) if instance.kind == Kind::Editor => format!(
            "a bay window is already serving agents on 127.0.0.1:{port}.\n\
             \x20    That is the same endpoint your MCP client is configured for, so a second\n\
             \x20    server is not needed — the window answers every tool, and its edits are\n\
             \x20    visible and undoable.\n\
             \x20      window: pid {}, {}\n\
             \x20    Quit that window first if you want a headless server instead.",
            instance.pid,
            instance
                .project
                .as_deref()
                .map(|p| format!("showing {p}"))
                .unwrap_or_else(|| "no project open".into()),
        ),

        (Wanted::Headless, Owner::Bay(instance)) => format!(
            "bay is already serving MCP headlessly on 127.0.0.1:{port} (pid {}).\n\
             \x20    Your MCP client is already pointed at it, so there is nothing to start.\n\
             \x20    Stop it with:  kill {}",
            instance.pid, instance.pid
        ),

        (Wanted::Editor, Owner::Bay(instance)) => format!(
            "agent edits are unavailable in this window: a headless bay (pid {}) holds\n\
             \x20    127.0.0.1:{port}, and one endpoint can only have one owner.\n\
             \x20    The editor still works — rendering, export, everything but agent calls.\n\
             \x20    To let agents edit this window instead:  kill {}",
            instance.pid, instance.pid
        ),

        // Something that is not bay. This is the only branch where the port itself is the
        // problem, so it is the only one that talks about finding what holds it.
        (wanted, Owner::Foreign) => {
            let consequence = match wanted {
                Wanted::Editor => {
                    "This window will open, but agents cannot reach it until the port is free."
                }
                Wanted::Headless => "bay cannot serve MCP until the port is free.",
            };
            format!(
                "127.0.0.1:{port} is held by something that is not bay.\n\
                 \x20    {consequence}\n\
                 \x20    Find what has it:  lsof -nP -iTCP:{port} -sTCP:LISTEN\n\
                 \x20    bay does not move to another port on its own: {port} is the address\n\
                 \x20    registered with `claude mcp add`, and changing it silently breaks every\n\
                 \x20    client already configured for it."
            )
        }
    }
}

/// Forget this window. Safe to call when nothing was registered.
pub fn deregister(port: u16) {
    let _ = std::fs::remove_file(note_path(port));
}

/// Every bay window currently accepting agent calls, lowest port first.
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
            kind: Kind::parse(note.get("kind").and_then(|k| k.as_str())),
            project: note
                .get("project")
                .and_then(|p| p.as_str())
                .map(str::to_string),
        });
    }
    instances.sort_by_key(|instance| instance.port);
    instances
}

/// The window a second launch should raise instead of opening a rival.
///
/// **Not "the first live instance".** [`live`] lists every bay that serves agents, and most of
/// them are not this launch's twin:
///
/// - A headless `bay --mcp` has no window to raise. It answers `window_focus` with
///   `unknown tool "window_focus"`, which is not the JSON the launcher expects, so it read the
///   reply as "running, but wedged" and refused to open the editor at all. One forgotten
///   `bay --mcp --port 7335` from days earlier was enough to make the editor unlaunchable —
///   and the port it was on had nothing to do with the editor's.
/// - An editor from another checkout, on its own `BAY_AGENT_PORT`, is a different
///   configuration's window. Raising it and stopping is the opposite of what was asked for;
///   running two checkouts side by side is exactly what that override is for.
///
/// So the only thing worth focusing is an editor holding *this* process's port — which is the
/// same lock this launch is about to lose to it.
pub fn window_to_focus() -> Option<Instance> {
    let port = agent_port();
    live()
        .into_iter()
        .find(|instance| instance.port == port && instance.kind == Kind::Editor)
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

    /// A port nobody else on the machine will be using.
    ///
    /// Derived from the pid, so two test binaries — or two checkouts building at once — cannot
    /// pick the same one, and far from the 7333 a real editor window claims. Using the real port
    /// made these tests fail whenever a `bay --mcp` happened to be running, which is a property
    /// of the developer's machine and not of the code.
    ///
    /// **Deliberately below 49152**, which is where macOS starts handing out ephemeral ports
    /// (`net.inet.ip.portrange.first`). A first attempt at this used 40000–60000 and still failed
    /// about one run in six: `live()` decides a window is gone by re-binding its port, so an
    /// unrelated outbound connection borrowing that number for a moment made a closed window
    /// look open. Picking from a range the OS never assigns removes the race rather than
    /// shortening the window in which it can happen.
    fn private_port() -> u16 {
        20_000 + (std::process::id() % 10_000) as u16
    }

    impl Scratch {
        fn new(name: &str) -> Self {
            let guard = SERIAL.lock().unwrap_or_else(|error| error.into_inner());
            // Per-process, for the same reason `private_port` is: two test binaries — a second
            // checkout, or a worktree building alongside this one — otherwise share this
            // directory by name, and `remove_dir_all` below wipes the other run's registry
            // mid-test. That surfaced as `live()` returning 0 notes it had just written, which
            // reads as a real failure and is a property of the machine.
            let dir =
                std::env::temp_dir().join(format!("bay-registry-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("scratch dir");
            unsafe {
                std::env::set_var("BAY_AGENT_DIR", &dir);
                std::env::set_var("BAY_AGENT_PORT", private_port().to_string());
            }
            Scratch(dir, guard)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
            unsafe {
                std::env::remove_var("BAY_AGENT_DIR");
                std::env::remove_var("BAY_AGENT_PORT");
            }
        }
    }

    #[test]
    fn a_claimed_window_is_reported_and_a_closed_one_is_reaped() {
        let _scratch = Scratch::new("claim");
        let Some(listener) = claim() else {
            eprintln!("skipping: port {} is in use on this machine", agent_port());
            return;
        };
        register(agent_port(), Kind::Editor, Some("Demo")).expect("register");

        let listed = live();
        assert_eq!(listed.len(), 1, "the open window should be listed");
        assert_eq!(listed[0].port, agent_port());
        assert_eq!(listed[0].project.as_deref(), Some("Demo"));

        // Dropping the listener frees the port; the note is now a lie and must be reaped.
        drop(listener);
        // Bounded retry, not a bare assertion. macOS reports EADDRINUSE for a few milliseconds
        // after a listening socket closes — measured here: the first rebind fails, the one 5ms
        // later succeeds. Since `live()` decides a window is gone by rebinding its port, a
        // closed window can briefly still look open. Asserting on the first call tests the
        // kernel's timing rather than the reaping, and failed about one run in four.
        let reaped = (0..40).any(|_| {
            if live().is_empty() {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
            false
        });
        assert!(
            reaped,
            "a window that stopped listening must not stay in the list"
        );
        assert!(
            !note_path(agent_port()).exists(),
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
            eprintln!("skipping: port {} is in use on this machine", agent_port());
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
            kind: Kind::Editor,
            project: None,
        };
        assert_eq!(
            instance.mcp_add_command(),
            "claude mcp add --transport http bay http://127.0.0.1:7333/mcp \
             --header \"Authorization: Bearer $BAY_MCP_TOKEN\""
        );
    }

    fn instance(kind: Kind, project: Option<&str>) -> Instance {
        Instance {
            port: DEFAULT_PORT,
            pid: 4242,
            kind,
            project: project.map(str::to_string),
        }
    }

    /// The rule the whole design turns on. `claude mcp add` writes
    /// `http://127.0.0.1:7333/mcp` into the user's client config, so a bay that relocates is a
    /// bay nothing can reach. The advice this replaced was `bay --mcp --port 0` — an
    /// OS-assigned port that no configured client could ever connect to.
    #[test]
    fn no_advice_ever_tells_the_user_to_change_the_port() {
        for wanted in [Wanted::Editor, Wanted::Headless] {
            for owner in [
                Owner::Foreign,
                Owner::Bay(instance(Kind::Editor, Some("Reel v2"))),
                Owner::Bay(instance(Kind::Headless, None)),
            ] {
                let advice = conflict_advice(DEFAULT_PORT, wanted, &owner);
                assert!(
                    !advice.contains("--port"),
                    "moving the endpoint is never the fix: {advice}"
                );
            }
        }
    }

    /// Every conflict has to name what holds the port. "Address already in use" sends someone
    /// hunting for a rogue process when the answer is the window on their screen.
    #[test]
    fn every_conflict_names_the_owner_and_a_next_step() {
        let editor = conflict_advice(
            DEFAULT_PORT,
            Wanted::Headless,
            &Owner::Bay(instance(Kind::Editor, Some("Reel v2"))),
        );
        assert!(editor.contains("window"), "{editor}");
        assert!(editor.contains("Reel v2"), "{editor}");
        assert!(editor.contains("4242"), "{editor}");

        let headless = conflict_advice(
            DEFAULT_PORT,
            Wanted::Headless,
            &Owner::Bay(instance(Kind::Headless, None)),
        );
        assert!(headless.contains("headlessly"), "{headless}");
        assert!(headless.contains("kill 4242"), "{headless}");

        let foreign = conflict_advice(DEFAULT_PORT, Wanted::Headless, &Owner::Foreign);
        assert!(foreign.contains("not bay"), "{foreign}");
        assert!(foreign.contains("lsof"), "{foreign}");
    }

    /// An editor losing the race still opens — it is useful without agents — but the user has to
    /// be told what they have lost and how to get it back.
    #[test]
    fn an_editor_that_cannot_take_the_port_is_told_what_still_works() {
        let advice = conflict_advice(
            DEFAULT_PORT,
            Wanted::Editor,
            &Owner::Bay(instance(Kind::Headless, None)),
        );
        assert!(advice.contains("still works"), "{advice}");
        assert!(advice.contains("kill 4242"), "{advice}");
    }

    /// A headless server has to be discoverable, or `--agents` says nothing is running while
    /// something serves the very endpoint being asked about — which is what it used to do.
    #[test]
    fn a_headless_server_registers_and_is_listed_like_a_window() {
        let _scratch = Scratch::new("headless");
        let Some(listener) = claim() else {
            eprintln!("skipping: port {} is in use", agent_port());
            return;
        };
        register(agent_port(), Kind::Headless, None).expect("register");

        let listed = live();
        assert_eq!(listed.len(), 1, "a headless server must be listed");
        assert_eq!(listed[0].kind, Kind::Headless);
        assert!(
            listed[0]
                .mcp_add_command()
                .contains(&agent_port().to_string()),
            "it must say how to reach it"
        );
        drop(listener);
    }

    #[test]
    fn owner_distinguishes_a_bay_from_something_else_and_from_free() {
        let _scratch = Scratch::new("owner");
        assert_eq!(owner(agent_port()), Owner::Free, "nothing bound yet");

        let Some(listener) = claim() else { return };
        // Bound, but nothing registered: as far as bay knows, someone else has it.
        assert_eq!(owner(agent_port()), Owner::Foreign);

        register(agent_port(), Kind::Headless, Some("Demo")).expect("register");
        match owner(agent_port()) {
            Owner::Bay(instance) => {
                assert_eq!(instance.kind, Kind::Headless);
                assert_eq!(instance.project.as_deref(), Some("Demo"));
            }
            other => panic!("expected a registered bay, got {other:?}"),
        }
        drop(listener);
    }

    /// Notes written before `kind` existed came only from editor windows, because headless
    /// servers did not register at all. Reading one as headless would tell a user to `kill` the
    /// window they are working in.
    #[test]
    fn a_note_from_an_older_build_reads_as_an_editor_window() {
        let _scratch = Scratch::new("legacy-note");
        std::fs::create_dir_all(registry_dir()).unwrap();
        std::fs::write(
            note_path(agent_port()),
            format!(r#"{{"port":{},"pid":7,"project":"Old"}}"#, agent_port()),
        )
        .unwrap();
        let Some(listener) = claim() else { return };
        match owner(agent_port()) {
            Owner::Bay(instance) => assert_eq!(instance.kind, Kind::Editor),
            other => panic!("expected a bay, got {other:?}"),
        }
        drop(listener);
    }

    /// The failure that prompted this: a `bay --mcp --port 7335`, left running for a day,
    /// stopped the editor from opening at all. It is listed — it *is* serving agents — but it
    /// has no window, so a launch that treats it as one sends `window_focus`, gets
    /// `unknown tool` back, and concludes the editor is wedged.
    #[test]
    fn a_headless_server_is_never_the_window_to_focus() {
        let _scratch = Scratch::new("focus-headless");
        // An OS-assigned port, held for the whole test: this stands in for the unrelated
        // `--port N` server, and holding the listener is what keeps `live` from reaping it.
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("a scratch port");
        let other = listener.local_addr().expect("bound address").port();
        register(other, Kind::Headless, None).expect("register");

        assert_eq!(live().len(), 1, "the headless server is still serving");
        assert_eq!(
            window_to_focus(),
            None,
            "a headless server has no window to raise"
        );
        drop(listener);
    }

    /// `BAY_AGENT_PORT` exists so two checkouts can run side by side. Focusing the other one's
    /// window and exiting would make the second checkout impossible to open.
    #[test]
    fn another_checkouts_window_is_left_alone() {
        let _scratch = Scratch::new("focus-other-port");
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("a scratch port");
        let other = listener.local_addr().expect("bound address").port();
        register(other, Kind::Editor, Some("Their Reel")).expect("register");

        assert_ne!(other, agent_port(), "the scratch port must not be ours");
        assert_eq!(window_to_focus(), None, "that window is not this launch's");
        drop(listener);
    }

    /// And the case it is all for: our own window, open, is the one to raise.
    #[test]
    fn our_own_open_window_is_the_one_to_focus() {
        let _scratch = Scratch::new("focus-ours");
        let Some(listener) = claim() else {
            eprintln!("skipping: port {} is in use", agent_port());
            return;
        };
        register(agent_port(), Kind::Editor, Some("Reel v2")).expect("register");

        let focus = window_to_focus().expect("our window must be raised, not duplicated");
        assert_eq!(focus.port, agent_port());
        assert_eq!(focus.project.as_deref(), Some("Reel v2"));
        drop(listener);
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
