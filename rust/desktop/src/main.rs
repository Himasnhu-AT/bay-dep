//! The native vii desktop editor.
//!
//! Thin by design, but this is where the two halves are wired together, because neither half
//! may depend on the other: `vii-ui` must not reach into `vii-mcp` (that would put the GPU view
//! layer under the server), and `vii-mcp` must not reach into `vii-ui` (GPUI views are `!Send`
//! and cannot cross to a server thread). They meet here, through `vii-agent`'s channel.

use std::net::{Ipv4Addr, TcpListener};

/// Loopback port the in-app MCP server listens on, matching the standalone `vii-mcp` default so
/// one `claude mcp add` works whether or not the app happens to be running.
const AGENT_PORT: u16 = 7333;

fn main() {
    // Whether the port is free decides whether an agent can drive this window. Bind-testing up
    // front means a second vii instance degrades to "no agent" instead of the two fighting over
    // the port and neither working.
    let port_free = TcpListener::bind((Ipv4Addr::LOCALHOST, AGENT_PORT)).is_ok();

    let pump = if port_free {
        let (bridge, pump) = vii_agent::bridge();
        std::thread::spawn(move || {
            // Blocks forever serving connections. A failure here must not take the editor down
            // — losing agent control is survivable, losing the user's session is not.
            if let Err(error) = vii_mcp::server::serve_http(AGENT_PORT, Some(bridge)) {
                eprintln!("vii: the agent server stopped: {error}");
            }
        });
        println!("vii: agent server on http://127.0.0.1:{AGENT_PORT}/mcp");
        println!("     claude mcp add --transport http vii http://127.0.0.1:{AGENT_PORT}/mcp");
        Some(pump)
    } else {
        eprintln!(
            "vii: port {AGENT_PORT} is busy, so this window cannot be driven by an agent \
             (another vii or a standalone vii-mcp is probably already running)"
        );
        None
    };

    vii_ui::run_with_agent(pump);
}
