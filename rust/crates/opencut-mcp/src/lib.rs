//! `opencut-mcp` — the vii editor as a Model Context Protocol server.
//!
//! Exposes the engine (`opencut-core` for the project, `opencut-preview` for the GPU
//! compositor and the ffmpeg encoder) as a set of MCP tools, so an agent can build a timeline
//! and render it without a GUI.
//!
//! ```text
//!   MCP client ──JSON-RPC──▶ server.rs ──▶ tools.rs ──▶ studio.rs ──▶ Editor + PreviewRenderer
//!                            transport      schemas       engine
//! ```
//!
//! Two transports, same tool surface: [`server::serve_stdio`] for clients that spawn a
//! subprocess, and [`server::serve_http`] for clients that connect to a URL.

pub mod server;
pub mod studio;
pub mod tools;

pub use studio::{Studio, ToolError};
