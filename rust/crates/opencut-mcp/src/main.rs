//! `vii-mcp` — run the vii editor as an MCP server.
//!
//! ```text
//! vii-mcp                 # HTTP on 127.0.0.1:7333 (default)
//! vii-mcp --port 8080     # HTTP on a specific port; 0 lets the OS choose
//! vii-mcp --stdio         # newline-delimited JSON-RPC on stdin/stdout
//! ```

use opencut_mcp::server;

const DEFAULT_PORT: u16 = 7333;

fn main() -> std::io::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();

    if args.iter().any(|a| a == "--help" || a == "-h") {
        println!("{}", include_str!("usage.txt"));
        return Ok(());
    }
    if args.iter().any(|a| a == "--stdio") {
        return server::serve_stdio();
    }

    let mut port = DEFAULT_PORT;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == "--port" {
            let Some(value) = iter.next() else {
                eprintln!("--port needs a number");
                std::process::exit(2);
            };
            match value.parse() {
                Ok(parsed) => port = parsed,
                Err(_) => {
                    eprintln!("--port takes a number, got {value:?}");
                    std::process::exit(2);
                }
            }
        }
    }
    server::serve_http(port)
}
