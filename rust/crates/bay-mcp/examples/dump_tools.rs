//! Print the exact MCP tool definitions advertised by bay.
//!
//! Documentation generation invokes this example instead of parsing Rust source, so nested
//! schema merges and future helper functions cannot disappear from the generated tool index.

fn main() -> Result<(), Box<dyn std::error::Error>> {
    serde_json::to_writer_pretty(std::io::stdout(), &bay_mcp::tools::definitions())?;
    println!();
    Ok(())
}
