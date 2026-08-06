//! The native vii desktop editor.
//!
//! Thin by design, but this is where the two halves are wired together, because neither half
//! may depend on the other: `vii-ui` must not reach into `vii-mcp` (that would put the GPU view
//! layer under the server), and `vii-mcp` must not reach into `vii-ui` (GPUI views are `!Send`
//! and cannot cross to a server thread). They meet here, through `vii-agent`'s channel.
//!
//! **vii is single-window on purpose.** An agent edits *a* document, and the value of watching
//! it happen depends on there being no ambiguity about which one. A second launch therefore
//! raises the window that is already open instead of starting a rival with its own timeline.

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

    let mut port = vii_agent::registry::DEFAULT_PORT;
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
vii — a native video editor, and the same engine as an MCP server

USAGE
  vii                    open the editor
  vii --mcp              serve MCP with no window, on 127.0.0.1:7333
  vii --mcp --port N     …on another port (0 lets the OS choose)
  vii --stdio            serve MCP over stdin/stdout instead
  vii --agents           is a window open, and how does an agent reach it?

With the editor open, an agent's edits land in the window you are looking at and undo with
the same keystroke as your own. With it closed, --mcp gives the same tools headlessly, which
is what you want for rendering.

  claude mcp add --transport http vii http://127.0.0.1:7333/mcp

Needs ffmpeg on PATH for decode and export, and a GPU for the compositor. Narration needs the
Kokoro sidecar; vii reports what is missing rather than failing silently.";

fn main() {
    let mode = match parse_mode() {
        Ok(mode) => mode,
        Err(message) => {
            eprintln!("vii: {message}");
            std::process::exit(2);
        }
    };

    match mode {
        Mode::Help => return println!("{USAGE}"),
        Mode::Agents => return print_agents(),
        Mode::Headless { port, stdio } => {
            // No window, so nothing to attach to: the server owns the document itself.
            let result = if stdio {
                vii_mcp::server::serve_stdio()
            } else {
                vii_mcp::server::serve_http(port, None)
            };
            if let Err(error) = result {
                // Now that the editor and the server are one binary, the overwhelmingly likely
                // cause is that the editor is already open holding this port — and a bare
                // "Address already in use (os error 48)" sends you hunting for a rogue process
                // instead of the window on your screen.
                if error.kind() == std::io::ErrorKind::AddrInUse {
                    eprintln!("vii: port {port} is already in use.");
                    match vii_agent::registry::live().first() {
                        Some(existing) => eprintln!(
                            "     A vii window is open and already serving agents there:\n\
                             \x20      http://127.0.0.1:{}/mcp\n\
                             \x20    Use that, or start this one on another port:\n\
                             \x20      vii --mcp --port 0",
                            existing.port
                        ),
                        None => eprintln!(
                            "     Nothing registered as a vii window, so something else holds it.\n\
                             \x20    Start on another port:\n\
                             \x20      vii --mcp --port 0"
                        ),
                    }
                } else {
                    eprintln!("vii: {error}");
                }
                std::process::exit(1);
            }
            return;
        }
        Mode::Editor => {}
    }

    // A window already open? Raise it and stop. The bound port is the single-instance lock —
    // no pid files, no races: whoever holds the socket is the app.
    if let Some(existing) = vii_agent::registry::live().into_iter().next() {
        match focus_existing(&existing) {
            Ok(()) => {
                println!("vii is already running — brought that window to the front.");
                println!("Close it first if you want to start fresh.");
            }
            Err(error) => {
                eprintln!(
                    "vii seems to be running on port {} but did not respond ({error}).\n\
                     If it is wedged, quit it and try again.",
                    existing.port
                );
            }
        }
        return;
    }

    let (pump, agent_port) = match vii_agent::registry::claim() {
        Some(listener) => {
            let port = vii_agent::registry::DEFAULT_PORT;
            let (bridge, pump) = vii_agent::bridge();
            let _ = vii_agent::registry::register(port, None);
            std::thread::spawn(move || {
                if let Err(error) = vii_mcp::server::serve_listener(listener, Some(bridge)) {
                    eprintln!("vii: the agent server stopped: {error}");
                }
                // Best effort — a crash skips this, which is why `live()` reaps by testing the
                // port rather than trusting the notes it finds.
                vii_agent::registry::deregister(port);
            });
            println!("vii: this window accepts agent edits at http://127.0.0.1:{port}/mcp");
            println!("     claude mcp add --transport http vii http://127.0.0.1:{port}/mcp");
            (Some(pump), Some(port))
        }
        None => {
            // The port is taken but nothing registered as a window: a standalone `vii-mcp` is
            // running headlessly. Start anyway — the editor is still useful — but say plainly
            // that an agent cannot reach this window.
            eprintln!(
                "vii: port {} is held by something that is not a vii window (a standalone \
                 vii-mcp?), so this window cannot accept agent edits. Stop it and restart vii \
                 to enable them.",
                vii_agent::registry::DEFAULT_PORT
            );
            (None, None)
        }
    };

    vii_ui::run_with_agent(pump, agent_port);
}

/// Ask the running window to come to the front.
///
/// Deliberately speaks the same MCP endpoint rather than inventing a second IPC channel: the
/// window already serves it, and `window_focus` is a tool an agent may usefully call too.
fn focus_existing(instance: &vii_agent::Instance) -> std::io::Result<()> {
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

/// `vii --agents` — is a window open, and how does an agent reach it?
///
/// Exists because the failure it replaces was "port 7333 is busy" with no way to find out what
/// was holding it.
fn print_agents() {
    let live = vii_agent::registry::live();
    let Some(instance) = live.first() else {
        println!("No vii window is open.");
        println!("Start one with: vii");
        return;
    };
    let project = instance.project.as_deref().unwrap_or("(no project open)");
    println!("vii is running — pid {}, showing {project}", instance.pid);
    println!("  {}", instance.mcp_add_command());
}
