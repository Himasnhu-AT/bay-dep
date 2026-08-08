//! The native bay desktop editor.
//!
//! Thin by design, but this is where the two halves are wired together, because neither half
//! may depend on the other: `bay-ui` must not reach into `bay-mcp` (that would put the GPU view
//! layer under the server), and `bay-mcp` must not reach into `bay-ui` (GPUI views are `!Send`
//! and cannot cross to a server thread). They meet here, through `bay-agent`'s channel.
//!
//! **bay is single-window on purpose.** An agent edits *a* document, and the value of watching
//! it happen depends on there being no ambiguity about which one. A second launch therefore
//! raises the window that is already open instead of starting a rival with its own timeline.

// Windows decides whether to hand a process a console from the PE subsystem field, not from
// what the program does. Left as `console`, double-clicking bay.exe opened a black terminal
// behind the editor — an app the user cannot close without also killing the editor. GUI
// subsystem means no console is created; [`attach_console`] borrows the parent's when bay is
// invoked from one, so `--help` and `--mcp` still print where they were typed.
#![cfg_attr(windows, windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

/// What was asked for on the command line.
enum Mode {
    /// Open the editor. The default.
    Editor,
    /// Serve MCP with no window, for rendering on a machine with no display or for an agent
    /// working without a human watching.
    Headless {
        port: u16,
        stdio: bool,
    },
    /// Report whether a window is open and how to reach it.
    Agents,
    Help,
}

fn parse_mode() -> Result<Mode, String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--help" || a == "-h") {
        return Ok(Mode::Help);
    }
    if args.iter().any(|a| a == "--agents") {
        return Ok(Mode::Agents);
    }
    if !args.iter().any(|a| a == "--mcp" || a == "--stdio") {
        return Ok(Mode::Editor);
    }

    let mut port = bay_agent::registry::DEFAULT_PORT;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == "--port" {
            let value = iter.next().ok_or("--port needs a number")?;
            port = value
                .parse()
                .map_err(|_| format!("--port takes a number, got {value:?}"))?;
        }
    }
    Ok(Mode::Headless {
        port,
        stdio: args.iter().any(|a| a == "--stdio"),
    })
}

const USAGE: &str = "\
bay — a native video editor, and the same engine as an MCP server

USAGE
  bay                    open the editor
  bay --mcp              serve MCP with no window, on 127.0.0.1:7333
  bay --stdio            serve MCP over stdin/stdout instead
  bay --agents           what is serving agents right now, and how to reach it
  bay --mcp --port N     serve on another port — see the warning below

With the editor open, an agent's edits land in the window you are looking at and undo with
the same keystroke as your own. With it closed, --mcp gives the same tools headlessly, which
is what you want for rendering.

  claude mcp add --transport http bay http://127.0.0.1:7333/mcp

Only one process can serve that endpoint at a time. If it is taken, bay tells you what has it
rather than moving elsewhere — `bay --agents` answers the same question at any time.

--port is for running a second, separately configured bay (another checkout, or CI). It is not
the way to resolve a conflict: the URL above is registered in your MCP client, so a bay on a
different port is one that client cannot reach.

Needs ffmpeg on PATH for decode and export, and a GPU for the compositor. Narration needs the
Kokoro sidecar; bay reports what is missing rather than failing silently.";

/// Borrow the console bay was launched from, if there is one.
///
/// A GUI-subsystem binary gets no console of its own, which is the point — but it means
/// `bay --help` run from PowerShell would print into nothing. Attaching to the parent gets the
/// output back without ever creating a window. No-op when there is no parent console (a
/// double-click), which is exactly when we want no console at all.
#[cfg(windows)]
fn attach_console() {
    const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
    unsafe extern "system" {
        fn AttachConsole(process_id: u32) -> i32;
    }
    unsafe { AttachConsole(ATTACH_PARENT_PROCESS) };
}

#[cfg(not(windows))]
fn attach_console() {}

fn main() {
    let mode = match parse_mode() {
        Ok(mode) => mode,
        Err(message) => {
            attach_console();
            eprintln!("bay: {message}");
            std::process::exit(2);
        }
    };

    // Every mode but the editor talks to a terminal.
    if !matches!(mode, Mode::Editor) {
        attach_console();
    }

    match mode {
        Mode::Help => return println!("{USAGE}"),
        Mode::Agents => return print_agents(),
        Mode::Headless { port, stdio } => {
            // No window, so nothing to attach to: the server owns the document itself.
            if stdio {
                // Nothing to register: stdio has no port, so it cannot collide with anything
                // and nobody can discover it by address either. It is reached by being spawned.
                if let Err(error) = bay_mcp::server::serve_stdio() {
                    eprintln!("bay: {error}");
                    std::process::exit(1);
                }
                return;
            }

            // Bound here rather than inside the server so this process can register *before* it
            // starts serving. Registering is not bookkeeping: it is what makes `bay --agents`
            // able to say a headless server is running, and what lets the next process print
            // "bay is already serving headlessly (pid N)" instead of guessing that some unknown
            // program holds the port. Without it a headless bay is invisible to bay itself.
            let listener = match std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
            {
                Ok(listener) => listener,
                Err(error) => {
                    if error.kind() == std::io::ErrorKind::AddrInUse {
                        eprintln!(
                            "bay: {}",
                            bay_agent::registry::conflict_advice(
                                port,
                                bay_agent::registry::Wanted::Headless,
                                &bay_agent::registry::owner(port),
                            )
                        );
                    } else {
                        eprintln!("bay: {error}");
                    }
                    std::process::exit(1);
                }
            };
            // `--port 0` asks the OS to choose, so the number to print is the one it gave us,
            // not the zero that was asked for.
            let bound = listener.local_addr().map(|a| a.port()).unwrap_or(port);
            let _ = bay_agent::registry::register(bound, bay_agent::registry::Kind::Headless, None);
            println!("bay: serving MCP on http://127.0.0.1:{bound}/mcp");
            if bound != bay_agent::registry::DEFAULT_PORT {
                println!(
                    "     This is not the default port, so a client registered with\n\
                     \x20    `claude mcp add` for {} will not reach it.",
                    bay_agent::registry::DEFAULT_PORT
                );
            }
            let result = bay_mcp::server::serve_listener(listener, None);
            bay_agent::registry::deregister(bound);
            // The port conflict was decided at bind time above, so anything reaching here is the
            // server itself stopping — a genuine fault, with nothing to advise about ports.
            if let Err(error) = result {
                eprintln!("bay: the agent server stopped: {error}");
                std::process::exit(1);
            }
            return;
        }
        Mode::Editor => {}
    }

    // A window already open? Raise it and stop. The bound port is the single-instance lock —
    // no pid files, no races: whoever holds the socket is the app.
    if let Some(existing) = bay_agent::registry::live().into_iter().next() {
        match focus_existing(&existing) {
            Ok(()) => {
                println!("bay is already running — brought that window to the front.");
                println!("Close it first if you want to start fresh.");
            }
            Err(error) => {
                eprintln!(
                    "bay seems to be running on port {} but did not respond ({error}).\n\
                     If it is wedged, quit it and try again.",
                    existing.port
                );
            }
        }
        return;
    }

    let (pump, agent_port, agent_note) = match bay_agent::registry::claim() {
        Some(listener) => {
            let port = bay_agent::registry::agent_port();
            let (bridge, pump) = bay_agent::bridge();
            let _ = bay_agent::registry::register(port, bay_agent::registry::Kind::Editor, None);
            std::thread::spawn(move || {
                if let Err(error) = bay_mcp::server::serve_listener(listener, Some(bridge)) {
                    eprintln!("bay: the agent server stopped: {error}");
                }
                // Best effort — a crash skips this, which is why `live()` reaps by testing the
                // port rather than trusting the notes it finds.
                bay_agent::registry::deregister(port);
            });
            println!("bay: this window accepts agent edits at http://127.0.0.1:{port}/mcp");
            println!("     claude mcp add --transport http bay http://127.0.0.1:{port}/mcp");
            (Some(pump), Some(port), None)
        }
        None => {
            // Something else holds the endpoint — in practice a headless `bay --mcp` left
            // running. The editor is still worth opening, so it opens; what must not happen is
            // it opening *silently* degraded. This went to stderr alone, which a user who
            // double-clicked the app never sees: they get a window where agent edits quietly do
            // nothing and no way to find out why. The reason now goes to the window as well.
            let port = bay_agent::registry::agent_port();
            let advice = bay_agent::registry::conflict_advice(
                port,
                bay_agent::registry::Wanted::Editor,
                &bay_agent::registry::owner(port),
            );
            eprintln!("bay: {advice}");
            (None, None, Some(advice))
        }
    };

    bay_ui::run_with_agent(pump, agent_port, agent_note);
}

/// Ask the running window to come to the front.
///
/// Deliberately speaks the same MCP endpoint rather than inventing a second IPC channel: the
/// window already serves it, and `window_focus` is a tool an agent may usefully call too.
fn focus_existing(instance: &bay_agent::Instance) -> std::io::Result<()> {
    let body = serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": { "name": "window_focus", "arguments": {} }
    })
    .to_string();
    let request = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );

    let address = std::net::SocketAddr::from(([127, 0, 0, 1], instance.port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.write_all(request.as_bytes())?;
    let mut reply = String::new();
    stream.read_to_string(&mut reply)?;

    // MCP wraps a tool result as {"result":{"content":[{"text":"<escaped json>"}]}}, so the
    // payload is a JSON *string* — searching the raw reply for `"focused":true` would never
    // match, because what is actually on the wire is `\"focused\":true`.
    let body = reply
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or(&reply);
    let envelope: serde_json::Value = serde_json::from_str(body)
        .map_err(|error| std::io::Error::other(format!("unreadable reply: {error}")))?;
    let text = envelope["result"]["content"][0]["text"]
        .as_str()
        .ok_or_else(|| std::io::Error::other("the reply carried no tool result"))?;
    let result: serde_json::Value = serde_json::from_str(text)
        .map_err(|error| std::io::Error::other(format!("unreadable tool result: {error}")))?;
    if result["focused"] == serde_json::Value::Bool(true) {
        Ok(())
    } else {
        Err(std::io::Error::other(format!(
            "the window did not confirm focus: {text}"
        )))
    }
}

/// `bay --agents` — is a window open, and how does an agent reach it?
///
/// Exists because the failure it replaces was "port 7333 is busy" with no way to find out what
/// was holding it.
fn print_agents() {
    let live = bay_agent::registry::live();
    let Some(instance) = live.first() else {
        // "Nothing is running" has to be the truth, not "no *window* is running". This said
        // "No bay window is open. Start one with: bay" while a headless `bay --mcp` was serving
        // the very endpoint the user was asking about — and following that advice landed them
        // in the port conflict instead.
        let port = bay_agent::registry::agent_port();
        if let bay_agent::registry::Owner::Foreign = bay_agent::registry::owner(port) {
            println!("No bay is serving agents, but 127.0.0.1:{port} is held by something else.");
            println!("  Find it with: lsof -nP -iTCP:{port} -sTCP:LISTEN");
            return;
        }
        println!("No bay is serving agents.");
        println!("  bay          open the editor; agent edits land in the window");
        println!("  bay --mcp    serve the same tools with no window");
        return;
    };

    match instance.kind {
        bay_agent::registry::Kind::Editor => {
            let project = instance.project.as_deref().unwrap_or("(no project open)");
            println!(
                "bay is running as an editor window — pid {}, showing {project}",
                instance.pid
            );
            println!("  Agent edits appear in that window and undo with Cmd+Z.");
        }
        bay_agent::registry::Kind::Headless => {
            println!(
                "bay is serving MCP headlessly — pid {}, no window.",
                instance.pid
            );
            println!("  Agent edits apply to its own document; there is nothing to watch.");
            println!("  Stop it with: kill {}", instance.pid);
        }
    }
    println!("  {}", instance.mcp_add_command());
}
