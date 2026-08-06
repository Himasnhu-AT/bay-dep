//! The native vii desktop editor.
//!
//! Thin by design, but this is where the two halves are wired together, because neither half
//! may depend on the other: `vii-ui` must not reach into `vii-mcp` (that would put the GPU view
//! layer under the server), and `vii-mcp` must not reach into `vii-ui` (GPUI views are `!Send`
//! and cannot cross to a server thread). They meet here, through `vii-agent`'s channel.

fn main() {
    if std::env::args().any(|arg| arg == "--agents") {
        return print_agents();
    }

    // One window, one agent endpoint. A fixed port could only ever serve one window, so each
    // claims the first free port in a small range and advertises itself — open a second window
    // and it simply lands on the next port instead of losing its agent entirely.
    let claimed = vii_agent::registry::claim();

    let mut agent_port = None;
    let pump = match claimed {
        Some((listener, port)) => {
            let (bridge, pump) = vii_agent::bridge();
            let _ = vii_agent::registry::register(port, None);
            // Best effort: a crash skips this, which is why `live()` reaps by testing the port
            // rather than trusting the notes.
            let cleanup_port = port;
            std::thread::spawn(move || {
                if let Err(error) = vii_mcp::server::serve_listener(listener, Some(bridge)) {
                    eprintln!("vii: the agent server stopped: {error}");
                }
                vii_agent::registry::deregister(cleanup_port);
            });

            let instance = vii_agent::Instance {
                port,
                pid: std::process::id(),
                project: None,
            };
            println!("vii: this window accepts agent edits at {}", instance.url());
            println!("     {}", instance.mcp_add_command());
            if port != *vii_agent::registry::PORT_RANGE.start() {
                println!(
                    "     (another vii window already has {}, so this one took {port})",
                    vii_agent::registry::PORT_RANGE.start()
                );
            }
            agent_port = Some(port);
            Some(pump)
        }
        None => {
            eprintln!(
                "vii: every agent port {}–{} is taken, so this window cannot be driven by an \
                 agent. Run `vii --agents` to see which windows are using them.",
                vii_agent::registry::PORT_RANGE.start(),
                vii_agent::registry::PORT_RANGE.end()
            );
            None
        }
    };

    vii_ui::run_with_agent(pump, agent_port);
}

/// `vii --agents` — which windows are open and how to reach each one.
///
/// Exists because the failure this replaces was "port 7333 is busy" with no way to find out
/// what was holding it.
fn print_agents() {
    let live = vii_agent::registry::live();
    if live.is_empty() {
        println!("No vii window is currently accepting agent edits.");
        println!("Start one with: vii");
        return;
    }
    println!("{} vii window(s) accepting agent edits:\n", live.len());
    for instance in &live {
        let project = instance.project.as_deref().unwrap_or("(no project open)");
        println!("  port {}  pid {}  {project}", instance.port, instance.pid);
        println!("    {}", instance.mcp_add_command());
    }
}
