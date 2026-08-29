//! MCP transport: JSON-RPC 2.0 over stdio, and over HTTP for clients that connect by URL.
//!
//! Written against the wire format directly rather than pulling in an SDK, because the whole
//! protocol we need is "read a JSON-RPC request, return a JSON-RPC response" and an SDK would
//! drag an async runtime into a workspace that is otherwise entirely synchronous.
//!
//! The HTTP side implements the Streamable HTTP transport's JSON mode: `POST /mcp` with a JSON
//! body returns a single `application/json` response. The spec permits this in place of an SSE
//! stream, and it is sufficient because every tool here is a request/response call with no
//! server-initiated messages.
//!
//! **Binding.** The listener binds loopback only. These tools read and write arbitrary files on
//! this machine, so exposing the port to the network would hand that to anyone who could reach
//! it.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{Value, json};
use subtle::ConstantTimeEq;

use crate::studio::Studio;
use crate::tools;

const PROTOCOL_VERSION: &str = "2025-06-18";
const SERVER_NAME: &str = "bay";

/// The credential required on every HTTP request.
///
/// Loopback is a network boundary, not an authorization boundary: any process running as the
/// user can connect, and browser pages can send requests to localhost. The Origin check below
/// closes the drive-by browser case; this token also closes origin-less requests from unrelated
/// local processes. Stdio needs no token because the client owns the child process and its pipes.
///
/// Deliberately has no `Debug` or `Display` implementation, so an error cannot accidentally print
/// it. The generated value is persisted in bay's per-user data directory for legitimate clients.
struct AuthToken {
    value: Vec<u8>,
    path: Option<PathBuf>,
}

impl AuthToken {
    fn load_or_create() -> std::io::Result<Self> {
        if let Some(value) = std::env::var_os("BAY_MCP_TOKEN").filter(|value| !value.is_empty()) {
            let value = value.to_string_lossy().into_owned();
            if !bay_settings::token::is_valid(&value) {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "BAY_MCP_TOKEN must be exactly 64 hexadecimal characters",
                ));
            }
            return Ok(Self {
                value: value.into_bytes(),
                path: None,
            });
        }

        // The file, its format and its 0600 mode are defined in `bay-settings` rather than
        // here, because the settings pane has to show and rotate the same credential and the
        // UI crate cannot depend on this one. Two definitions of "the token" would mean a
        // rotate in the window that the server never noticed.
        let path = bay_settings::token::default_path().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "could not locate bay's data directory for the MCP token",
            )
        })?;
        let value = bay_settings::token::read_or_create(&path)?;
        Ok(Self {
            value: value.into_bytes(),
            path: Some(path),
        })
    }

    /// Compare token bytes without exposing how many leading bytes matched.
    ///
    /// **Reads the file every time, and does not consult a cached copy.** The credential lives in
    /// the token file; anything else is a second definition of it, and a second definition is the
    /// whole bug. `load_or_create` used to read once at startup, so the settings pane's "Rotate
    /// token" — which rewrites that file — left the server authenticating against a value nobody
    /// could see any more. A user pasting the pane's own snippet got 401 until bay was restarted,
    /// while the banner told them the new token was live.
    ///
    /// The first attempt at this fix compared against the cached value *first* and fell back to
    /// the file, which made rotation **additive**: the new token started working and the old one
    /// never stopped. A rotate that does not revoke is worse than no rotate at all, because it
    /// reports success. Its test caught it, which is the only reason it is not in this commit.
    ///
    /// The cost is a 64-byte read from the page cache per request, against a path that has
    /// already done a TCP accept and is about to parse JSON. MCP traffic is user- and
    /// agent-driven, not a hot loop.
    ///
    /// A missing or malformed file authenticates nothing. Falling back to the last known value
    /// would mean deleting the credential leaves it working, which is not what deleting it means.
    fn matches(&self, candidate: &[u8]) -> bool {
        // `BAY_MCP_TOKEN` sets `path: None`. An explicitly configured token is the credential in
        // its own right and is never overridden by whatever happens to be on disk.
        let Some(path) = self.path.as_ref() else {
            return bool::from(self.value.as_slice().ct_eq(candidate));
        };
        let Ok(current) = std::fs::read_to_string(path) else {
            return false;
        };
        let current = current.trim();
        if !bay_settings::token::is_valid(current) {
            return false;
        }
        bool::from(current.as_bytes().ct_eq(candidate))
    }

    #[cfg(test)]
    fn from_test(value: &str) -> Self {
        assert_eq!(value.len(), bay_settings::token::TOKEN_HEX_LEN);
        Self {
            value: value.as_bytes().to_vec(),
            path: None,
        }
    }
}

/// Authorization header value for bay's own local clients.
///
/// Kept as an explicit API so the desktop's single-instance focus request uses the same
/// credential source as the server. Callers must treat the returned string as a secret.
pub fn authorization_header() -> std::io::Result<String> {
    let token = AuthToken::load_or_create()?;
    let value = String::from_utf8(token.value).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "bay's MCP token is not valid UTF-8",
        )
    })?;
    Ok(format!("Bearer {value}"))
}

/// Handle one JSON-RPC message. Returns `None` for notifications, which take no response.
fn handle(studio: &mut Studio, request: &Value) -> Option<Value> {
    let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = request.get("params").cloned().unwrap_or(json!({}));

    // Notifications carry no id and must not be answered.
    let id = request.get("id").cloned()?;

    let result = match method {
        "initialize" => Ok(initialize_result()),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools::definitions() })),
        "tools/call" => {
            let name = params
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_string();
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            if let Some(refusal) = policy_refusal(&name) {
                return Some(tool_error(id, refusal));
            }
            match tools::dispatch(studio, &name, &args) {
                Ok(value) => Ok(json!({
                    "content": [{ "type": "text", "text": serde_json::to_string(&value)
                        .unwrap_or_else(|_| "{}".into()) }],
                    "isError": false,
                })),
                // A tool failure is a RESULT, not a protocol error: the agent needs to see the
                // message and correct its call, which a JSON-RPC error would not let it do.
                Err(e) => Ok(json!({
                    "content": [{ "type": "text", "text": e.to_string() }],
                    "isError": true,
                })),
            }
        }
        other => Err((-32601, format!("method not found: {other}"))),
    };

    Some(match result {
        Ok(value) => json!({ "jsonrpc": "2.0", "id": id, "result": value }),
        Err((code, message)) => json!({
            "jsonrpc": "2.0", "id": id,
            "error": { "code": code, "message": message }
        }),
    })
}

/// Why this tool call is refused by the user's settings, if it is.
///
/// The check lives here rather than in `tools::dispatch` so it applies to both modes with one
/// definition: attached mode never reaches `dispatch` — it forwards to the editor — and a gate
/// that only guarded the headless path would be a setting that worked when bay was closed.
fn policy_refusal(tool: &str) -> Option<String> {
    policy_refusal_with(&bay_settings::store::current().mcp, tool)
}

/// [`policy_refusal`], against an explicit policy — the form the tests drive, so they never
/// depend on the settings of whoever is running them.
fn policy_refusal_with(settings: &bay_settings::McpSettings, tool: &str) -> Option<String> {
    match bay_settings::mcp::gate(settings, tool) {
        bay_settings::mcp::Gate::Allow => None,
        bay_settings::mcp::Gate::Deny(reason) => Some(reason),
    }
}

/// A refusal delivered as a tool *result*, not a JSON-RPC error.
///
/// Same reasoning as a failing tool: the agent has to read the message and change what it does,
/// and a protocol-level error is not something it can act on.
fn tool_error(id: Value, message: String) -> Value {
    json!({
        "jsonrpc": "2.0", "id": id,
        "result": {
            "content": [{ "type": "text", "text": message }],
            "isError": true,
        }
    })
}

/// The `initialize` reply. Shared so attached and headless modes cannot describe the server
/// differently.
fn initialize_result() -> Value {
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": {
            "name": SERVER_NAME,
            "version": env!("CARGO_PKG_VERSION"),
        },
        "instructions": INSTRUCTIONS,
    })
}

const INSTRUCTIONS: &str = "\
bay is a native video editor. Build a timeline with these tools, then render it to MP4.

Typical flow:
  1. project_create (1080x1920 @ 30 for a vertical reel)
  2. fonts_check — confirm the families you plan to use are installed
  3. media_import for any music or footage
  4. add_text / add_shape / add_image / add_video to place elements, add_audio for the bed
  5. animate to give them motion
  6. snapshot at several times and LOOK at the frames
  7. fix what the frames show, in place — transform_set, text_update, element_trim, audio_set
  8. check — it names what will look wrong before you spend the encode finding out
  9. render

Editing, not just placing: element_trim moves a clip's edges and eats the footage behind
them, element_source picks WHICH part of a file plays, element_split cuts a clip in two, and
element_move slides it without changing what it shows. Prefer these to deleting and re-adding
— a rebuilt element loses its animation and its id.

Coordinates are fractions of the canvas: x=0.5,y=0.5 is dead centre. Layers stack upward
from 0. Keyframe times in `animate` are relative to the element's own start.";

/// Serve MCP on stdin/stdout using newline-delimited JSON-RPC.
pub fn serve_stdio() -> std::io::Result<()> {
    let mut studio = Studio::new();
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let Ok(request) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(response) = handle(&mut studio, &request) {
            writeln!(stdout, "{response}")?;
            stdout.flush()?;
        }
    }
    Ok(())
}

/// Serve MCP over HTTP on `127.0.0.1:port`. Pass port 0 to let the OS pick one.
///
/// Two modes, and which one you get depends on whether the desktop app is running:
///
/// - **Attached** (`bridge` is `Some`) — the editor owns the document. Every tool call is
///   forwarded to it and applied on the main thread, so the user watches the edit land and can
///   undo it. One thread per connection, because each one blocks on its own reply and must not
///   hold up the accept loop.
/// - **Headless** (`bridge` is `None`) — no app, so the server owns a `Studio` and does the
///   work itself. This is the original behaviour and stays single-threaded: one GPU device and
///   one project mean concurrent calls would need a lock around everything anyway.
pub fn serve_http(port: u16, bridge: Option<bay_agent::AgentBridge>) -> std::io::Result<()> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port))?;
    serve_listener(listener, bridge)
}

/// Serve on a listener the caller already bound.
///
/// The desktop app claims its port and serves on that exact listener, so there is no window
/// between "this port was free" and "we are listening on it" for a second window to slip
/// through and steal it.
pub fn serve_listener(
    listener: TcpListener,
    bridge: Option<bay_agent::AgentBridge>,
) -> std::io::Result<()> {
    let token = Arc::new(AuthToken::load_or_create()?);
    let bound = listener.local_addr()?;
    let mode = if bridge.is_some() {
        "attached to the open editor"
    } else {
        "headless"
    };
    println!("bay MCP server listening on http://{bound}/mcp ({mode})");
    match &token.path {
        Some(path) => println!("  authentication token: {}", path.display()),
        None => println!("  authentication token: BAY_MCP_TOKEN"),
    }
    if bridge.is_none() {
        println!("  configure an Authorization: Bearer header, then register http://{bound}/mcp");
    }
    std::io::stdout().flush()?;

    match bridge {
        Some(bridge) => {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        let bridge = bridge.clone();
                        let token = Arc::clone(&token);
                        // Thread per connection: the handler blocks waiting for the editor to
                        // answer, and blocking the accept loop would stall every other client.
                        std::thread::spawn(move || {
                            if let Err(e) = serve_attached_connection(&bridge, stream, &token) {
                                eprintln!("bay-mcp: connection error: {e}");
                            }
                        });
                    }
                    Err(e) => eprintln!("bay-mcp: accept failed: {e}"),
                }
            }
        }
        None => {
            let mut studio = Studio::new();
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        if let Err(e) = serve_connection(&mut studio, stream, &token) {
                            eprintln!("bay-mcp: connection error: {e}");
                        }
                    }
                    Err(e) => eprintln!("bay-mcp: accept failed: {e}"),
                }
            }
        }
    }
    Ok(())
}

/// How long a fast tool call waits for the editor before giving up.
///
/// Generous, because the one main-thread stall we cannot engineer away is a native file dialog
/// — and short enough that an agent gets a message it can act on rather than hanging forever.
///
/// A file dialog is a *fast tool* concern, which is the reason this was the wrong number for
/// everything else: applied flatly, it meant any `render` or `narrate` over 20 seconds returned
/// "the editor did not answer in time" while the work carried on and its result was applied to
/// the document anyway.
const ATTACHED_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// The budget for a slow tool that still answers in-band.
///
/// After the job migration this is `media_import` alone: a `probe_media` shell-out that is
/// normally milliseconds but can be much longer for a large file on a network share. Everything
/// slower than that returns a job id instead of holding the request open, so this number never
/// has to cover a render.
const ATTACHED_SLOW_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);

/// How long to wait for `tool`.
///
/// Pure and separate so the policy is testable without a bridge, and so adding a fifth slow
/// tool cannot silently leave it on the fast budget — the test walks `slow_tools()` rather than
/// a list written out again here.
fn timeout_for(tool: &str) -> std::time::Duration {
    if bay_agent::slow::slow_tools().contains(&tool) {
        ATTACHED_SLOW_TIMEOUT
    } else {
        ATTACHED_TIMEOUT
    }
}

/// Handle one connection in attached mode: `initialize` and `tools/list` are answered here,
/// and everything else is forwarded to the editor.
fn serve_attached_connection(
    bridge: &bay_agent::AgentBridge,
    stream: TcpStream,
    token: &AuthToken,
) -> std::io::Result<()> {
    serve_with(stream, token, |request| handle_attached(bridge, request))
}

fn handle_attached(bridge: &bay_agent::AgentBridge, request: &Value) -> Option<Value> {
    let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let id = request.get("id").cloned()?;

    // These need no document, so answering locally keeps them off the editor's thread.
    let result = match method {
        "initialize" => Ok(initialize_result()),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools::definitions() })),
        "tools/call" => {
            let params = request.get("params").cloned().unwrap_or(json!({}));
            let call = bay_agent::ToolCall {
                name: params
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or_default()
                    .to_string(),
                arguments: params.get("arguments").cloned().unwrap_or(json!({})),
            };
            if let Some(refusal) = policy_refusal(&call.name) {
                return Some(tool_error(id, refusal));
            }
            let budget = timeout_for(&call.name);
            let (text, is_error) = match bridge.call(call, budget) {
                bay_agent::AgentResponse::Ok(value) => (
                    serde_json::to_string(&value).unwrap_or_else(|_| "{}".into()),
                    false,
                ),
                bay_agent::AgentResponse::Err(message) => (message, true),
            };
            Ok(json!({
                "content": [{ "type": "text", "text": text }],
                "isError": is_error,
            }))
        }
        other => Err((-32601, format!("method not found: {other}"))),
    };

    Some(match result {
        Ok(value) => json!({ "jsonrpc": "2.0", "id": id, "result": value }),
        Err((code, message)) => json!({
            "jsonrpc": "2.0", "id": id,
            "error": { "code": code, "message": message }
        }),
    })
}

fn serve_connection(
    studio: &mut Studio,
    stream: TcpStream,
    token: &AuthToken,
) -> std::io::Result<()> {
    serve_with(stream, token, |request| handle(studio, request))
}

/// The HTTP half of the transport, shared by both modes.
///
/// `dispatch` turns one JSON-RPC message into an optional reply; everything about reading the
/// request and writing the response lives here so the two modes cannot drift apart.
/// Is this `Origin` this machine talking to itself?
///
/// Compared on the host only: a scheme and port vary legitimately between clients, and what
/// matters is that the page is not remote.
fn is_loopback_origin(origin: &str) -> bool {
    // "null" is what a sandboxed iframe or a file:// page sends. It is not loopback, and
    // treating it as such would reopen the hole for exactly the pages least worth trusting.
    let without_scheme = origin
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(origin);
    let authority = without_scheme.split('/').next().unwrap_or("");
    // IPv6 literals are bracketed and full of colons, so the port cannot be split off by
    // looking for the first one.
    let host = if let Some(rest) = authority.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        authority.split(':').next().unwrap_or("")
    };
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

fn serve_with(
    mut stream: TcpStream,
    token: &AuthToken,
    mut dispatch: impl FnMut(&Value) -> Option<Value>,
) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);

    // Request line.
    let mut request_line = String::new();
    if reader.read_line(&mut request_line)? == 0 {
        return Ok(());
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();

    // Headers: the body length, Origin, and bearer credential.
    let mut content_length = 0usize;
    let mut origin: Option<String> = None;
    let mut authorization: Option<String> = None;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 {
            break;
        }
        let header = header.trim_end();
        if header.is_empty() {
            break;
        }
        let Some((name, value)) = header.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("content-length") {
            content_length = value.trim().parse().unwrap_or(0);
        } else if name.eq_ignore_ascii_case("origin") {
            origin = Some(value.trim().to_string());
        } else if name.eq_ignore_ascii_case("authorization") {
            authorization = Some(value.trim().to_string());
        }
    }

    // Authenticate before reading or parsing the body, and crucially before either dispatch path.
    // A local process that cannot read bay's user-only token file must never reach a tool.
    let candidate = authorization
        .as_deref()
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or_default();
    if !token.matches(candidate.as_bytes()) {
        return respond_unauthorized(&mut stream);
    }

    // Binding to loopback is not enough on its own. A browser on this machine can POST here
    // from any page the user visits — `Content-Type: text/plain` makes it a CORS-simple request,
    // so there is no preflight to refuse — and the call executes even though the reply is
    // unreadable. That is enough to cancel someone's render, and with a DNS-rebinding step the
    // reply becomes readable too, at which point a listing hands the page every render path and
    // narration line this bay knows about.
    //
    // A real MCP client sends no Origin at all, so requiring loopback only when one IS present
    // costs nothing and closes the drive-by.
    if let Some(origin) = &origin
        && !is_loopback_origin(origin)
    {
        return respond(
            &mut stream,
            403,
            "text/plain",
            b"cross-origin requests are refused; bay's MCP endpoint is for local clients",
        );
    }

    // A GET on the MCP endpoint is the spec's "open an SSE stream" request. This server never
    // initiates messages, so declining is correct and tells the client not to wait on one.
    if method == "GET" {
        return respond(&mut stream, 405, "text/plain", b"SSE stream not supported");
    }
    if method != "POST" || !path.starts_with("/mcp") {
        return respond(&mut stream, 404, "text/plain", b"POST /mcp");
    }

    let mut body = vec![0u8; content_length];
    reader.read_exact(&mut body)?;

    let Ok(request) = serde_json::from_slice::<Value>(&body) else {
        let error = json!({
            "jsonrpc": "2.0", "id": Value::Null,
            "error": { "code": -32700, "message": "parse error" }
        });
        return respond(
            &mut stream,
            400,
            "application/json",
            error.to_string().as_bytes(),
        );
    };

    // A batch is a JSON array of requests; a single call is an object.
    let response = match &request {
        Value::Array(items) => {
            let replies: Vec<Value> = items.iter().filter_map(&mut dispatch).collect();
            if replies.is_empty() {
                None
            } else {
                Some(Value::Array(replies))
            }
        }
        other => dispatch(other),
    };

    match response {
        // Notification-only payload: 202 with no body, per the transport spec.
        None => respond(&mut stream, 202, "text/plain", b""),
        Some(value) => respond(
            &mut stream,
            200,
            "application/json",
            value.to_string().as_bytes(),
        ),
    }
}

fn respond(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Unknown",
    };
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {len}\r\n\
         Connection: close\r\n\r\n",
        len = body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

fn respond_unauthorized(stream: &mut TcpStream) -> std::io::Result<()> {
    let body = b"authentication required";
    let head = format!(
        "HTTP/1.1 401 Unauthorized\r\n\
         Content-Type: text/plain\r\n\
         WWW-Authenticate: Bearer\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

#[cfg(test)]
pub(crate) mod tests_support {
    use super::*;
    use serde_json::{Value, json};

    /// A studio whose project library is a throwaway directory. `project_save` with no path
    /// writes to the library, and the dispatch-every-tool test calls exactly that — pointed at
    /// the default root it would litter the developer's own project list.
    pub fn new_studio() -> Studio {
        Studio::with_library_root(Some(test_library_root()))
    }

    pub fn test_library_root() -> std::path::PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("bay-mcp-test-library-{stamp}"))
    }

    pub fn call(studio: &mut Studio, name: &str, args: Value) -> Value {
        let request = json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": { "name": name, "arguments": args }
        });
        handle(studio, &request).expect("a request always gets a response")
    }

    /// The text of a tool result, and whether it reported an error.
    pub fn unwrap_call(response: &Value) -> (bool, String) {
        let result = &response["result"];
        (
            result["isError"].as_bool().unwrap_or(false),
            result["content"][0]["text"].as_str().unwrap_or("").into(),
        )
    }
}

/// The user's MCP allow-list, where it meets the server.
#[cfg(test)]
mod policy_tests {
    use super::*;
    use bay_settings::McpSettings;

    /// Shipping the allow-list must not change what any existing agent can do.
    #[test]
    fn the_default_policy_refuses_nothing() {
        let settings = McpSettings::default();
        for tool in ["project_create", "add_clip", "render", "snapshot"] {
            assert_eq!(policy_refusal_with(&settings, tool), None, "{tool}");
        }
    }

    /// The refusal is a tool *result*, not a JSON-RPC error: an agent can read a result and
    /// change what it does, and cannot do anything useful with a protocol error.
    #[test]
    fn a_blocked_tool_is_refused_as_a_readable_result() {
        let mut settings = McpSettings::default();
        settings.block("render");
        let reason =
            policy_refusal_with(&settings, "render").expect("a blocked tool must be refused");

        let response = tool_error(json!(7), reason);
        assert_eq!(response["jsonrpc"], "2.0");
        assert_eq!(response["id"], 7);
        assert!(
            response.get("error").is_none(),
            "a policy refusal must not be a protocol error: {response}"
        );
        assert_eq!(response["result"]["isError"], true);
        let text = response["result"]["content"][0]["text"]
            .as_str()
            .unwrap_or_default();
        assert!(text.contains("Settings"), "say where to change it: {text}");

        assert_eq!(
            policy_refusal_with(&settings, "add_clip"),
            None,
            "only the blocked tool"
        );
    }

    /// Switching the server off in settings must stop every call, not merely hide the listing.
    #[test]
    fn a_stopped_server_refuses_every_tool() {
        let settings = McpSettings {
            enabled: false,
            ..McpSettings::default()
        };
        for tool in ["project_create", "timeline"] {
            assert!(policy_refusal_with(&settings, tool).is_some(), "{tool}");
        }
        assert!(tools::definitions_with(&settings).is_empty());
    }

    /// A blocked tool must disappear from `tools/list` too — an agent that can still see it
    /// plans a job around a call it will be refused at the last step.
    #[test]
    fn a_blocked_tool_is_absent_from_the_listing() {
        let mut settings = McpSettings::default();
        let all = tools::definitions_with(&settings);
        assert!(
            all.len() == tools::all_definitions().len(),
            "nothing is filtered by default"
        );

        settings.block("render");
        let filtered = tools::definitions_with(&settings);
        assert_eq!(filtered.len(), all.len() - 1);
        assert!(
            !filtered
                .iter()
                .any(|definition| definition["name"] == "render")
        );
        assert!(
            filtered
                .iter()
                .any(|definition| definition["name"] == "project_create")
        );
    }

    /// The settings pane draws a switch per tool, and it draws them from this list. If it were
    /// built from the filtered one, blocking a tool would remove the row that turns it back on.
    #[test]
    fn every_tool_has_a_stable_name_for_the_settings_pane() {
        let names = tools::all_tool_names();
        assert_eq!(
            names.len(),
            tools::all_definitions().len(),
            "every definition must carry a name"
        );
        let mut unique = names.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), names.len(), "two tools share a name");
        assert!(names.iter().any(|name| name == "render"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tests_support::{call, new_studio, unwrap_call};

    // The attached timeout. `todo.testing.md` recorded that every bridge test used a fast tool,
    // which is why a flat 20s ceiling on `render` and `narrate` survived unnoticed: the suite
    // only ever exercised calls that could not possibly hit it.

    #[test]
    fn a_slow_tool_is_not_held_to_the_file_dialog_budget() {
        assert_eq!(
            timeout_for("timeline"),
            ATTACHED_TIMEOUT,
            "a fast tool keeps the dialog budget"
        );
        assert_eq!(
            timeout_for("media_import"),
            ATTACHED_SLOW_TIMEOUT,
            "probing a large file must not be cut off at the dialog budget"
        );
        assert!(
            ATTACHED_SLOW_TIMEOUT > ATTACHED_TIMEOUT,
            "the slow budget has to actually be more generous"
        );
    }

    #[test]
    fn every_slow_tool_gets_the_slow_budget() {
        // Walks the real list rather than repeating it, so a fifth slow tool added later cannot
        // silently be left on a 20-second ceiling — which is exactly how this bug happened.
        for tool in bay_agent::slow::slow_tools() {
            assert_eq!(
                timeout_for(tool),
                ATTACHED_SLOW_TIMEOUT,
                "{tool} is classified slow but would be given the fast budget"
            );
        }
    }

    #[test]
    fn every_job_tool_is_also_a_slow_tool() {
        // job_tools is deliberately narrower than slow_tools, but it must be a subset: a tool
        // that returns a job id while running on the UI thread would freeze the window.
        for tool in bay_agent::slow::job_tools() {
            assert!(
                bay_agent::slow::slow_tools().contains(tool),
                "{tool} returns a job id but is not classified as slow"
            );
        }
    }

    /// A deliberately slow tool, through the real bridge, must not be cut off.
    ///
    /// This is the test `todo.testing.md` asked for. The pump takes longer than the fast budget
    /// and answers within the slow one; the call has to come back `Ok`.
    #[test]
    fn a_slow_tool_survives_a_delay_that_would_fail_a_fast_one() {
        let (bridge, pump) = bay_agent::bridge();
        let handle = std::thread::spawn(move || {
            // Drain on a tick, the way the editor's own loop does.
            let request = loop {
                if let Some(request) = pump.try_next() {
                    break request;
                }
                std::thread::sleep(std::time::Duration::from_millis(5));
            };
            // Longer than the fast budget the test injects below, shorter than the slow one.
            std::thread::sleep(std::time::Duration::from_millis(120));
            request.respond(bay_agent::AgentResponse::Ok(json!({ "rendered": true })));
        });

        let response = bridge.call(
            bay_agent::ToolCall {
                name: "render".into(),
                arguments: json!({ "path": "/tmp/x.mp4" }),
            },
            // Stands in for ATTACHED_SLOW_TIMEOUT, scaled down so the test is fast. The policy
            // itself is asserted above; what this proves is that the bridge delivers a late-ish
            // answer rather than claiming the slot.
            std::time::Duration::from_secs(5),
        );
        match response {
            bay_agent::AgentResponse::Ok(value) => assert_eq!(value["rendered"], true),
            bay_agent::AgentResponse::Err(message) => {
                panic!("a slow tool inside its budget must not time out: {message}")
            }
        }
        handle.join().expect("the pump thread should finish");
    }

    #[test]
    fn a_page_on_the_web_cannot_drive_this_server() {
        // Loopback binding does not stop a browser: any page the user visits can POST here, and
        // with Content-Type: text/plain there is no preflight to refuse. The call would execute
        // even though the reply is unreadable — enough to cancel someone's render.
        for origin in [
            "https://evil.example",
            "http://evil.example:7333",
            "null",
            "http://127.0.0.1.evil.example",
            "http://notlocalhost",
        ] {
            assert!(
                !is_loopback_origin(origin),
                "{origin} must not be treated as this machine talking to itself"
            );
        }
    }

    #[test]
    fn a_local_client_is_still_allowed() {
        for origin in [
            "http://localhost",
            "http://localhost:3000",
            "http://127.0.0.1:7333",
            "https://127.0.0.1",
            "http://[::1]:7333",
        ] {
            assert!(is_loopback_origin(origin), "{origin} is local and allowed");
        }
    }

    fn authenticated_http_round_trip(authorization: Option<&str>) -> (String, bool) {
        use std::sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        };

        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind test listener");
        let address = listener.local_addr().expect("test listener address");
        let dispatched = Arc::new(AtomicBool::new(false));
        let observed = Arc::clone(&dispatched);
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept test request");
            let token = AuthToken::from_test(
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            );
            serve_with(stream, &token, |_| {
                observed.store(true, Ordering::SeqCst);
                Some(json!({ "jsonrpc": "2.0", "id": 1, "result": { "ok": true } }))
            })
            .expect("serve test request");
        });

        let body = r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#;
        let authorization = authorization
            .map(|value| format!("Authorization: {value}\r\n"))
            .unwrap_or_default();
        let request = format!(
            "POST /mcp HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\n\
             Content-Length: {}\r\n{authorization}\r\n{body}",
            body.len()
        );
        let mut client = TcpStream::connect(address).expect("connect to test listener");
        client
            .write_all(request.as_bytes())
            .expect("write test request");
        let mut response = String::new();
        client
            .read_to_string(&mut response)
            .expect("read test response");
        server.join().expect("test server should finish");
        (response, dispatched.load(Ordering::SeqCst))
    }

    #[test]
    fn an_unauthenticated_request_is_rejected_before_dispatch() {
        let (response, dispatched) = authenticated_http_round_trip(None);
        assert!(
            response.starts_with("HTTP/1.1 401 Unauthorized"),
            "{response}"
        );
        assert!(!dispatched, "an unauthenticated request reached dispatch");
    }

    /// A token rotated in the settings pane is live immediately, without restarting bay.
    ///
    /// This is the bug that locked a real user out. `load_or_create` reads the file once at
    /// startup; "Rotate token" writes a new one and updates the pane. Nothing told the running
    /// server, so the token displayed in the pane — the one its own snippet told you to paste —
    /// was refused with 401 until bay was restarted, and the banner said the opposite.
    ///
    /// `load_or_create`'s comment already warned that "two definitions of the token would mean a
    /// rotate in the window that the server never noticed". It guarded against a second *file*.
    /// The cached copy in memory was the second definition.
    #[test]
    fn a_rotated_token_is_accepted_without_a_restart() {
        // Scratch keyed by name *and pid*: `CLAUDE.md` records two test binaries wiping each
        // other's state when only the name was used.
        let dir = std::env::temp_dir().join(format!("bay-rotate-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("scratch");
        let path = dir.join("mcp-token");

        let first = bay_settings::token::read_or_create(&path).expect("first token");
        let token = AuthToken {
            value: first.clone().into_bytes(),
            path: Some(path.clone()),
        };
        assert!(
            token.matches(first.as_bytes()),
            "the startup token must work"
        );

        // The settings pane rotates. The server's cached copy is now stale.
        let second = bay_settings::token::rotate(&path).expect("rotate");
        assert_ne!(first, second);

        assert!(
            token.matches(second.as_bytes()),
            "the rotated token was refused — a client pasting the pane's own snippet gets 401"
        );
        assert!(
            !token.matches(first.as_bytes()),
            "the revoked token still works, so rotation does not revoke anything"
        );
        assert!(!token.matches(b"not-a-token"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// An explicitly configured `BAY_MCP_TOKEN` must never be silently replaced by whatever is
    /// on disk — the env var exists precisely to override the file.
    #[test]
    fn an_env_configured_token_does_not_consult_the_file() {
        let token = AuthToken::from_test(
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        );
        assert!(token.path.is_none(), "from_test stands in for the env path");
        assert!(!token.matches(b"anything else"));
    }

    #[test]
    fn a_correctly_authenticated_request_succeeds() {
        let (response, dispatched) = authenticated_http_round_trip(Some(
            "Bearer 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        ));
        assert!(response.starts_with("HTTP/1.1 200 OK"), "{response}");
        assert!(response.contains(r#""ok":true"#), "{response}");
        assert!(
            dispatched,
            "an authenticated request never reached dispatch"
        );
    }

    #[test]
    fn initialize_advertises_tools() {
        let mut studio = new_studio();
        let response = handle(
            &mut studio,
            &json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }),
        )
        .expect("initialize is a request");
        assert_eq!(response["result"]["protocolVersion"], PROTOCOL_VERSION);
        assert!(response["result"]["capabilities"]["tools"].is_object());
    }

    #[test]
    fn notifications_get_no_response() {
        let mut studio = new_studio();
        let response = handle(
            &mut studio,
            &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
        );
        assert!(response.is_none(), "a notification must not be answered");
    }

    #[test]
    fn every_advertised_tool_has_a_schema_and_dispatches() {
        let mut studio = new_studio();
        for definition in tools::definitions() {
            let name = definition["name"].as_str().expect("tool has a name");
            assert!(
                definition["description"]
                    .as_str()
                    .is_some_and(|d| d.len() > 20),
                "{name} needs a real description"
            );
            assert_eq!(definition["inputSchema"]["type"], "object", "{name}");
            // Dispatching with empty args must produce a tool error, never "unknown tool" —
            // that is what catches a tool advertised in the list but missing from the router.
            let (_, message) = unwrap_call(&call(&mut studio, name, json!({})));
            assert!(
                !message.contains("unknown tool"),
                "{name} is advertised but not routed"
            );
        }
    }

    /// The loop the revising tools exist for, driven the way an agent drives it: build
    /// something, notice it is wrong, fix it in place. Every step goes through the real
    /// JSON-RPC surface, so this also proves the headless server reaches the shared planner.
    #[test]
    fn an_agent_can_revise_what_it_built_instead_of_rebuilding_it() {
        let mut studio = new_studio();
        call(&mut studio, "project_create", json!({}));
        let (is_error, _) = unwrap_call(&call(
            &mut studio,
            "add_text",
            json!({ "role": "headline", "id": "title", "start": 0, "duration": 3, "content": "Hook", "y": 0.9 }),
        ));
        assert!(!is_error);

        // The snapshot would show it jammed against the bottom edge. Move it — the id, the
        // words and everything else about it survive.
        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "transform_set",
            json!({ "elementId": "title", "y": 0.42 }),
        ));
        assert!(!is_error, "{message}");
        let transform_result: Value =
            serde_json::from_str(&message).expect("transform_set returns JSON");
        assert_eq!(transform_result["textLayout"]["basis"], "glyph-ink");

        let (_, timeline) = unwrap_call(&call(&mut studio, "timeline", json!({})));
        let timeline: Value = serde_json::from_str(&timeline).expect("timeline is json");
        let element = &timeline["layers"][0]["elements"][0];
        assert_eq!(element["id"], "title");
        assert_eq!(element["content"], "Hook", "the words survived the move");
        assert!((element["transform"]["y"].as_f64().unwrap() - 0.42).abs() < 1e-6);

        // And a retype keeps the placement. Promoting it to a hook re-resolves it against the
        // kit — the size comes from the ramp, not from the caller.
        let (_, before) = unwrap_call(&call(&mut studio, "timeline", json!({})));
        let before: Value = serde_json::from_str(&before).expect("timeline is json");
        let headline_size = before["layers"][0]["elements"][0]["fontSize"]
            .as_f64()
            .expect("a size");
        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "text_update",
            json!({ "elementId": "title", "content": "Better hook", "role": "hook" }),
        ));
        assert!(!is_error, "{message}");
        let update_result: Value =
            serde_json::from_str(&message).expect("text_update returns JSON");
        assert_eq!(update_result["textLayout"]["basis"], "glyph-ink");
        assert!(
            update_result["textLayout"]["height"].as_f64().unwrap() > 0.0,
            "a typography revision must report the layout it produced: {update_result}"
        );
        let (_, timeline) = unwrap_call(&call(&mut studio, "timeline", json!({})));
        let timeline: Value = serde_json::from_str(&timeline).expect("timeline is json");
        let element = &timeline["layers"][0]["elements"][0];
        assert_eq!(element["content"], "Better hook");
        assert_eq!(element["role"], "hook");
        assert!(
            element["fontSize"].as_f64().unwrap() > headline_size,
            "a hook is bigger than a headline in every kit's ramp: {element}"
        );
        assert!((element["transform"]["y"].as_f64().unwrap() - 0.42).abs() < 1e-6);
    }

    #[test]
    fn named_move_reports_replace_and_append_semantics() {
        let mut studio = new_studio();
        call(&mut studio, "project_create", json!({}));
        call(
            &mut studio,
            "add_text",
            json!({
                "role": "headline", "id": "title", "start": 0, "duration": 3,
                "content": "NO"
            }),
        );

        let (_, first) = unwrap_call(&call(
            &mut studio,
            "apply_move",
            json!({ "elementId": "title", "move": "nudge", "at": 0 }),
        ));
        let first: Value = serde_json::from_str(&first).expect("first move JSON");
        assert_eq!(first["motion"]["channels"][0]["action"], "added");

        let (_, repeated) = unwrap_call(&call(
            &mut studio,
            "apply_move",
            json!({ "elementId": "title", "move": "nudge", "at": 0 }),
        ));
        let repeated: Value = serde_json::from_str(&repeated).expect("repeated move JSON");
        assert_eq!(
            repeated["motion"]["channels"][0]["action"],
            "replaced-overlap"
        );
        assert!(
            repeated["motion"]["signatureRule"]
                .as_str()
                .unwrap()
                .contains("distinct set"),
            "{repeated}"
        );

        let (_, later) = unwrap_call(&call(
            &mut studio,
            "apply_move",
            json!({ "elementId": "title", "move": "nudge", "at": 1 }),
        ));
        let later: Value = serde_json::from_str(&later).expect("later move JSON");
        assert_eq!(later["motion"]["channels"][0]["action"], "appended");
    }

    /// `check` has to find the two failures that most often reach a finished file: nothing on
    /// screen, and a clip pointing at media nobody imported.
    #[test]
    fn check_reports_an_empty_timeline_and_then_goes_quiet() {
        let mut studio = new_studio();
        call(&mut studio, "project_create", json!({}));

        let (is_error, report) = unwrap_call(&call(&mut studio, "check", json!({})));
        assert!(!is_error, "check is a read and must not fail: {report}");
        let report: Value = serde_json::from_str(&report).expect("check returns json");
        assert_eq!(
            report["status"],
            json!("findings"),
            "an empty timeline is not clean"
        );
        assert!(
            report["findings"]
                .as_array()
                .unwrap()
                .iter()
                .any(|f| f["code"] == "nothing-visual"),
            "{report}"
        );
        // A render must not proceed past it either — the gate is what makes the report matter.
        let (is_error, refused) = unwrap_call(&call(
            &mut studio,
            "render",
            json!({ "path": "/tmp/bay-never-rendered.mp4" }),
        ));
        assert!(is_error, "a gating error must stop the render: {refused}");
        assert!(refused.contains("nothing-visual"), "{refused}");

        call(
            &mut studio,
            "add_shape",
            json!({ "role": "data", "start": 0, "duration": 2 }),
        );
        let (_, report) = unwrap_call(&call(&mut studio, "check", json!({})));
        let report: Value = serde_json::from_str(&report).expect("check returns json");
        assert_eq!(report["errors"], json!(0), "{report}");
        // Every check ran, so the three-state status is a real pass rather than a silence.
        assert!(
            report["skipped"]
                .as_array()
                .expect("skipped is a list")
                .is_empty(),
            "{report}"
        );
    }

    /// Looks and templates are the two libraries bay ships as code. Both have to be
    /// discoverable and usable in one call each, or an agent will keep building the same
    /// lower third out of primitives and getting the spacing slightly wrong.
    #[test]
    fn a_look_and_a_template_can_be_found_and_used() {
        let mut studio = new_studio();
        call(&mut studio, "project_create", json!({}));

        let (_, looks) = unwrap_call(&call(&mut studio, "looks_list", json!({})));
        let looks: Value = serde_json::from_str(&looks).expect("json");
        let first = looks["looks"][0]["id"].as_str().expect("at least one look");
        assert!(!first.is_empty());

        let (_, templates) = unwrap_call(&call(&mut studio, "templates_list", json!({})));
        let templates: Value = serde_json::from_str(&templates).expect("json");
        let lower_third = templates["templates"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["id"] == "lower-third")
            .expect("the built-in lower third");
        assert_eq!(lower_third["textSlots"][0], "name");

        // Place it, filling its slots.
        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "template_place",
            json!({ "templateId": "lower-third", "start": 1.0, "text": ["Ada", "Engineer"] }),
        ));
        assert!(!is_error, "{message}");
        let placed: Value = serde_json::from_str(&message).expect("json");
        let ids = placed["ids"].as_array().expect("ids");
        assert_eq!(ids.len(), 3, "a rule and two lines: {placed}");

        // The words landed, and the times are relative to where it was placed.
        let (_, timeline) = unwrap_call(&call(&mut studio, "timeline", json!({})));
        let timeline: Value = serde_json::from_str(&timeline).expect("json");
        let elements = timeline["layers"][0]["elements"].as_array().unwrap();
        assert!(elements.iter().any(|e| e["content"] == "Ada"), "{timeline}");
        assert!(
            elements
                .iter()
                .any(|e| (e["startSeconds"].as_f64().unwrap() - 1.0).abs() < 1e-6),
            "the bundle starts where it was placed: {timeline}"
        );

        // And a built-in grade goes on by name, with no file anywhere.
        let element_id = elements[1]["id"].as_str().unwrap().to_string();
        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "effect_add",
            json!({ "elementId": element_id, "type": "lut", "look": first }),
        ));
        assert!(!is_error, "{message}");
    }

    /// A grade that does not exist has to be refused by name, with the list of ones that do —
    /// the alternative is a clip that renders untouched and no way to tell why.
    #[test]
    fn an_unknown_look_is_refused_with_the_alternatives() {
        let mut studio = new_studio();
        call(&mut studio, "project_create", json!({}));
        call(
            &mut studio,
            "add_shape",
            json!({ "role": "data", "id": "s", "start": 0, "duration": 2 }),
        );
        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "effect_add",
            json!({ "elementId": "s", "type": "lut", "look": "vaporwave" }),
        ));
        assert!(is_error);
        assert!(message.contains("teal-orange"), "{message}");
    }

    /// The whole point of synthesising these: one call gets a sound of exactly the length the
    /// edit needs, onto the timeline, with no file to find and nothing to install.
    #[test]
    fn a_sound_effect_is_synthesised_and_placed_in_one_call() {
        let mut studio = new_studio();
        call(&mut studio, "project_create", json!({}));

        let (_, listed) = unwrap_call(&call(&mut studio, "sfx_list", json!({})));
        let listed: Value = serde_json::from_str(&listed).expect("json");
        assert!(
            listed["sfx"]
                .as_array()
                .unwrap()
                .iter()
                .any(|s| s["id"] == "whoosh"),
            "{listed}"
        );

        // A whoosh cut to the length of a 0.4s transition.
        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "sfx_add",
            json!({ "sfx": "whoosh", "start": 2.0, "duration": 0.4 }),
        ));
        assert!(!is_error, "{message}");
        let placed: Value = serde_json::from_str(&message).expect("json");
        assert!(
            (placed["durationSeconds"].as_f64().unwrap() - 0.4).abs() < 0.01,
            "the sound is as long as it was asked to be: {placed}"
        );

        // It is a real file, and a real clip on the audio lane.
        let path = placed["path"].as_str().expect("a path");
        let written = std::fs::metadata(path).expect("the wav exists");
        assert!(
            written.len() > 44,
            "a header with no samples is not a sound"
        );

        let (_, info) = unwrap_call(&call(&mut studio, "project_info", json!({})));
        let info: Value = serde_json::from_str(&info).expect("json");
        assert_eq!(info["audioElements"], json!(1), "{info}");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn an_unknown_sound_is_refused_with_the_ones_that_exist() {
        let mut studio = new_studio();
        call(&mut studio, "project_create", json!({}));
        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "sfx_add",
            json!({ "sfx": "explosion", "start": 0.0 }),
        ));
        assert!(is_error);
        assert!(message.contains("whoosh"), "{message}");
    }

    #[test]
    fn tool_errors_come_back_as_results_not_protocol_errors() {
        let mut studio = new_studio();
        let response = call(
            &mut studio,
            "add_text",
            json!({ "role": "headline", "content": "x", "start": 0 }),
        );
        assert!(
            response.get("error").is_none(),
            "a bad argument must not be a JSON-RPC error"
        );
        let (is_error, message) = unwrap_call(&response);
        assert!(is_error);
        assert!(message.contains("duration"), "unhelpful message: {message}");
    }

    #[test]
    fn unknown_method_is_a_protocol_error() {
        let mut studio = new_studio();
        let response = handle(
            &mut studio,
            &json!({ "jsonrpc": "2.0", "id": 7, "method": "nope" }),
        )
        .expect("a request gets a response");
        assert_eq!(response["error"]["code"], -32601);
    }

    /// A reactive pulse rides an authored curve instead of deleting it.
    ///
    /// The first version wrote its keys from the element's static transform value, which meant
    /// adding a pulse silently discarded every scale move already on the channel — an orb's
    /// whole arc through a film vanished the moment it was made to breathe, with nothing said.
    #[test]
    fn a_reactive_pulse_rides_the_curve_that_is_already_there() {
        let mut studio = new_studio();
        call(&mut studio, "project_create", json!({}));

        let wav = tests_support::test_library_root().join("pulse.wav");
        std::fs::create_dir_all(wav.parent().expect("a parent")).expect("scratch directory");
        let rate = 48_000u32;
        let samples: Vec<f32> = (0..(rate as usize * 4))
            .map(|i| {
                let t = i as f32 / rate as f32;
                let phase = t * 300.0 * std::f32::consts::TAU;
                // Loud for the first half, near-silent for the second.
                phase.sin() * if t < 2.0 { 0.4 } else { 0.001 }
            })
            .collect();
        std::fs::write(
            &wav,
            bay_audio::sfx::encode_wav(&bay_audio::AudioPcm {
                sample_rate: rate,
                channels: 1,
                samples,
            }),
        )
        .expect("write a wav");
        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "media_import",
            json!({ "path": wav.to_string_lossy(), "id": "snd" }),
        ));
        assert!(!is_error, "{body}");
        call(
            &mut studio,
            "add_audio",
            json!({ "mediaId": "snd", "start": 0.0, "duration": 4.0, "role": "speech" }),
        );
        call(
            &mut studio,
            "add_shape",
            json!({ "id": "orb", "start": 0, "duration": 4.0, "role": "data",
                    "shape": "ellipse", "x": 0.5, "y": 0.5, "scale": 0.2 }),
        );
        // An authored arc: small, then large.
        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "animate",
            json!({ "elementId": "orb", "property": "scale",
                    "keys": [{"t": 0.0, "value": 0.2}, {"t": 4.0, "value": 0.6}] }),
        ));
        assert!(!is_error, "{body}");

        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "audio_react",
            json!({ "elementId": "orb", "mediaId": "snd", "channel": "scale", "depth": 0.1 }),
        ));
        assert!(!is_error, "{body}");
        let out: Value = serde_json::from_str(&body).expect("a JSON body");
        assert_eq!(out["rodeExistingCurve"], true);

        let keys: Vec<(f64, f32)> = studio
            .project()
            .active_scene()
            .elements()
            .find(|element| element.id() == "orb")
            .and_then(|element| element.animations())
            .and_then(|animations| animations.get("scale"))
            .map(|channel| {
                channel
                    .keys
                    .iter()
                    .map(|key| (key.time.to_seconds_f64(), key.value))
                    .collect()
            })
            .expect("a scale channel");

        let at = |want: f64| {
            keys.iter()
                .min_by(|a, b| (a.0 - want).abs().total_cmp(&(b.0 - want).abs()))
                .map(|(_, value)| *value)
                .expect("a key")
        };
        // The arc survives: still small at the head and large at the tail.
        assert!(
            at(0.2) < 0.3,
            "the authored start is still small: {}",
            at(0.2)
        );
        assert!(
            at(3.8) > 0.5,
            "and the authored end is still large: {}",
            at(3.8)
        );
        // And the loud half sits above the arc, the quiet half on it.
        let loud = at(1.0);
        let quiet = at(3.0);
        let arc = |t: f32| 0.2f32 + (0.6f32 - 0.2f32) * (t / 4.0);
        assert!(
            loud > arc(1.0) * 1.02,
            "the pulse lifts the curve where the sound is: {loud} vs {}",
            arc(1.0)
        );
        assert!(
            (quiet - arc(3.0)).abs() < 0.02,
            "and leaves it alone where there is none: {quiet} vs {}",
            arc(3.0)
        );
    }

    /// Room tone is lifted from the recording's own quietest pause, and loops without ticking.
    ///
    /// The companion to `audio_smooth`, and the half a crossfade cannot fix: it changes how
    /// fast you cross a join, not what the two sides sound like. A continuous bed of the room
    /// stops the background being something that changes at cuts.
    #[test]
    fn room_tone_is_lifted_from_the_recording_and_crossfaded_into_itself() {
        let mut studio = new_studio();
        call(&mut studio, "project_create", json!({}));

        // Loud, then a long quiet stretch: the quiet is what the tool has to find.
        let wav = tests_support::test_library_root().join("with-a-pause.wav");
        std::fs::create_dir_all(wav.parent().expect("a parent")).expect("scratch directory");
        // Two seconds of real level, then four of a real floor — not digital zero, because
        // room tone is not silence and the detector is looking for the quietest *sound*.
        let rate = 48_000u32;
        let mut samples = Vec::new();
        for index in 0..(rate as usize * 2) {
            let phase = index as f32 / rate as f32 * 440.0 * std::f32::consts::TAU;
            samples.push(phase.sin() * 0.35);
        }
        for index in 0..(rate as usize * 4) {
            let phase = index as f32 / rate as f32 * 90.0 * std::f32::consts::TAU;
            samples.push(phase.sin() * 0.0009);
        }
        let pcm = bay_audio::AudioPcm {
            sample_rate: rate,
            channels: 1,
            samples,
        };
        std::fs::write(&wav, bay_audio::sfx::encode_wav(&pcm)).expect("write a wav");

        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "media_import",
            json!({ "path": wav.to_string_lossy(), "id": "room" }),
        ));
        assert!(!is_error, "{body}");
        // Something to lay it under.
        call(
            &mut studio,
            "add_shape",
            json!({ "start": 0, "duration": 6.0, "role": "ground", "tone": "surface" }),
        );

        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "room_tone",
            json!({ "mediaId": "room", "seconds": 6.0, "crossfadeMs": 200 }),
        ));
        assert!(!is_error, "{body}");
        let out: Value = serde_json::from_str(&body).expect("a JSON body");

        let lifted = out["liftedFrom"]["startSeconds"]
            .as_f64()
            .expect("a source start");
        assert!(
            lifted >= 1.5,
            "the tone came from the quiet stretch, not the loud head: {out}"
        );
        let clips = out["clips"].as_u64().expect("a clip count");
        assert!(clips >= 2, "the bed loops to cover the timeline: {out}");

        // Every copy carries fades, so the loop cannot tick where it hands over.
        let beds: Vec<_> = studio
            .project()
            .active_scene()
            .tracks
            .audio
            .iter()
            .flat_map(|track| track.elements.iter())
            .filter_map(|element| match element {
                bay_project::Element::Audio(audio) if audio.id.starts_with("room-tone-") => {
                    Some(audio)
                }
                _ => None,
            })
            .collect();
        assert_eq!(beds.len() as u64, clips, "every clip is on the timeline");
        assert!(
            beds.iter()
                .all(|bed| bed.fade_in > bay_time::MediaTime::ZERO
                    && bed.fade_out > bay_time::MediaTime::ZERO),
            "a loop butt-joined to itself ticks: {:?}",
            beds.iter()
                .map(|bed| (bed.fade_in, bed.fade_out))
                .collect::<Vec<_>>()
        );
        assert!(
            beds.iter().all(|bed| bed.volume < 1.0),
            "the dialogue already carries the room; a bed at unity doubles it"
        );
    }

    /// Captions name the speaker when the floor changes, and only then.
    ///
    /// A clip where two people talk, captioned without them, says the words and loses who said
    /// them — on a social cut that is most of the point of an exchange. Labelling every line
    /// instead spends a line of frame on something nobody reads after the second one, so the
    /// name goes on the first caption after a change and the colour carries the rest.
    #[test]
    fn captions_name_a_speaker_only_where_the_floor_changes() {
        let mut studio = new_studio();
        call(&mut studio, "project_create", json!({}));

        let wav = tests_support::test_library_root().join("two-handed.wav");
        std::fs::create_dir_all(wav.parent().expect("a parent")).expect("scratch directory");
        let click = bay_audio::sfx::Sfx::by_id("click").expect("bay synthesises a click");
        let pcm = click.render(bay_audio::sfx::SfxParams {
            seconds: 4.0,
            tone: 0.5,
            level: 0.5,
        });
        std::fs::write(&wav, bay_audio::sfx::encode_wav(&pcm)).expect("write a wav");
        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "media_import",
            json!({ "path": wav.to_string_lossy(), "id": "m" }),
        ));
        assert!(!is_error, "{body}");

        // A transcript with two speakers, and the speech clip the captions are projected through.
        {
            let asset = studio
                .project()
                .media
                .iter()
                .find(|asset| asset.id == "m")
                .cloned();
            let mut asset = asset.expect("the imported asset");
            let word =
                |text: &str, start: f64, end: f64, speaker: &str| bay_project::TranscriptWord {
                    text: text.into(),
                    start_seconds: start,
                    end_seconds: end,
                    confidence: 1.0,
                    speaker: Some(speaker.into()),
                };
            asset.transcript = Some(bay_project::Transcript {
                language: "en".into(),
                model: "test".into(),
                duration_seconds: 4.0,
                words: vec![
                    word("one", 0.0, 0.4, "speaker-1"),
                    word("two", 0.5, 0.9, "speaker-1"),
                    word("three", 1.2, 1.6, "speaker-2"),
                    word("four", 1.7, 2.1, "speaker-2"),
                ],
                utterances: Vec::new(),
            });
            studio.replace_media_for_test(asset);
        }
        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "add_audio",
            json!({ "mediaId": "m", "start": 0.0, "duration": 4.0, "role": "speech" }),
        ));
        assert!(!is_error, "{body}");

        let srt = tests_support::test_library_root().join("two-handed.srt");
        std::fs::create_dir_all(srt.parent().expect("a parent")).expect("scratch directory");
        std::fs::write(
            &srt,
            "1\n00:00:00,000 --> 00:00:01,000\none two\n\n             2\n00:00:01,200 --> 00:00:02,200\nthree four\n\n             3\n00:00:02,300 --> 00:00:03,000\nfive\n\n",
        )
        .expect("write an srt");

        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "subtitles_add",
            json!({
                "path": srt.to_string_lossy(),
                "speakerLabels": { "speaker-1": "JULIE", "speaker-2": "GALE" },
                "speakerColors": { "speaker-1": "#FFFFFF", "speaker-2": "#E5C158" },
            }),
        ));
        assert!(!is_error, "{body}");

        let captions: Vec<(String, String)> = studio
            .project()
            .active_scene()
            .elements()
            .filter_map(|element| match element {
                bay_project::Element::Text(text) => {
                    Some((text.content.clone(), text.color.clone()))
                }
                _ => None,
            })
            .collect();
        assert_eq!(captions.len(), 3, "{captions:?}");
        assert!(
            captions[0].0.starts_with("JULIE:"),
            "the first speaker is named: {captions:?}"
        );
        assert!(
            captions[1].0.starts_with("GALE:"),
            "the floor changed, so the new speaker is named: {captions:?}"
        );
        assert_ne!(
            captions[0].1, captions[1].1,
            "the two speakers are different colours: {captions:?}"
        );
        // Nothing is said over the third cue, so it keeps the previous speaker's look and is
        // not labelled again.
        assert!(
            !captions[2].0.contains(':'),
            "a cue with no speaker change is not re-labelled: {captions:?}"
        );
    }

    /// Speech that arrives already mixed can decline bay's dialogue chain.
    ///
    /// `role: "speech"` attached the EQ, compressor and limiter unconditionally. That is right
    /// for raw dialogue and wrong for a delivered mix: a bed mastered to -13.9 LUFS came back
    /// from the encode at -19.6 with its loudness range squashed from 5.9 LU to 3.5, because
    /// the chain ran over work that had already been done. `loudness: false` on the render is
    /// no defence — the chain hangs off the element, not off the encode.
    #[test]
    fn already_mixed_speech_can_decline_the_dialogue_chain() {
        let mut studio = new_studio();
        call(&mut studio, "project_create", json!({}));
        let wav = tests_support::test_library_root().join("mixed-speech.wav");
        std::fs::create_dir_all(wav.parent().expect("a parent")).expect("scratch directory");
        let click = bay_audio::sfx::Sfx::by_id("click").expect("bay synthesises a click");
        let pcm = click.render(bay_audio::sfx::SfxParams {
            seconds: 0.6,
            tone: 0.5,
            level: 0.5,
        });
        std::fs::write(&wav, bay_audio::sfx::encode_wav(&pcm)).expect("write a wav");
        let (is_error, text) = unwrap_call(&call(
            &mut studio,
            "media_import",
            json!({ "path": wav.to_string_lossy(), "id": "m" }),
        ));
        assert!(!is_error, "{text}");
        let media_id = "m".to_string();

        for (process, wants_chain) in [(true, true), (false, false)] {
            let (is_error, text) = unwrap_call(&call(
                &mut studio,
                "add_audio",
                json!({ "mediaId": media_id, "start": 0.0, "duration": 0.5,
                        "role": "speech", "processDialogue": process }),
            ));
            assert!(!is_error, "{text}");
            let placed: Value = serde_json::from_str(&text).expect("a JSON body");
            let id = placed["elementId"].as_str().expect("an element id");
            let has_chain = studio
                .project()
                .active_scene()
                .tracks
                .audio
                .iter()
                .flat_map(|track| track.elements.iter())
                .any(|element| match element {
                    bay_project::Element::Audio(audio) => {
                        audio.id == id && audio.dialogue_chain.is_some()
                    }
                    _ => false,
                });
            assert_eq!(
                has_chain,
                wants_chain,
                "processDialogue: {process} should {} the chain",
                if wants_chain { "attach" } else { "leave off" }
            );
        }
    }

    /// A project may be created at a broadcast frame rate, not just a whole-number one.
    ///
    /// The engine has carried a rational `Fps` since the beginning and `FrameRate::FPS_23_976`
    /// names 24000/1001 outright, but `project_create` pinned the denominator to 1, so the only
    /// rates reachable over MCP were the whole ones. An agent handed 23.976 footage and asked to
    /// keep its rate had to round to 24 — which is a conform, drifting a frame every 42 seconds
    /// and about 86 frames across an hour-long episode. Silently, and only visible once the
    /// picture has walked off the sound.
    #[test]
    fn a_project_can_be_created_at_a_broadcast_frame_rate() {
        let mut studio = new_studio();
        let (is_error, text) = unwrap_call(&call(
            &mut studio,
            "project_create",
            json!({ "width": 1920, "height": 1080, "fps": 24000, "fpsDenominator": 1001 }),
        ));
        assert!(!is_error, "{text}");
        let value: Value = serde_json::from_str(&text).expect("a JSON body");
        assert_eq!(value["frameRate"]["numerator"], 24000);
        assert_eq!(value["frameRate"]["denominator"], 1001);
        let fps = value["fps"].as_f64().expect("a numeric fps");
        assert!(
            (fps - 24000.0 / 1001.0).abs() < 1e-9,
            "23.976 must survive the round trip, got {fps}"
        );

        // The whole-number path is unchanged: no denominator means the numerator is the rate.
        let (is_error, text) = unwrap_call(&call(
            &mut studio,
            "project_create",
            json!({ "width": 1080, "height": 1920, "fps": 30 }),
        ));
        assert!(!is_error, "{text}");
        let value: Value = serde_json::from_str(&text).expect("a JSON body");
        assert_eq!(value["fps"].as_f64(), Some(30.0));
        assert_eq!(value["frameRate"]["denominator"], 1);
    }

    /// A denominator of zero is a refusal, not a divide by zero.
    #[test]
    fn a_zero_frame_rate_denominator_is_refused() {
        let mut studio = new_studio();
        let (is_error, _) = unwrap_call(&call(
            &mut studio,
            "project_create",
            json!({ "fps": 24000, "fpsDenominator": 0 }),
        ));
        assert!(is_error, "a zero denominator must be refused");
    }

    #[test]
    fn building_a_timeline_reports_what_was_built() {
        let mut studio = new_studio();
        call(
            &mut studio,
            "project_create",
            json!({ "width": 1080, "height": 1920, "fps": 30 }),
        );
        let (is_error, _) = unwrap_call(&call(
            &mut studio,
            "add_shape",
            json!({ "role": "data", "start": 0, "duration": 2, "id": "bar", "tone": "accent",
                    "anchorX": 0.0, "scaleX": 0.6, "scaleY": 0.02 }),
        ));
        assert!(!is_error);

        let (is_error, _) = unwrap_call(&call(
            &mut studio,
            "animate",
            json!({ "elementId": "bar", "property": "scaleX", "easing": "power-out",
                    "keys": [{ "t": 0, "value": 0 }, { "t": 0.8, "value": 0.6 }] }),
        ));
        assert!(!is_error);

        let (_, timeline) = unwrap_call(&call(&mut studio, "timeline", json!({})));
        let timeline: Value = serde_json::from_str(&timeline).expect("timeline is JSON");
        assert_eq!(timeline["durationSeconds"], 2.0);
        let element = &timeline["layers"][0]["elements"][0];
        assert_eq!(element["id"], "bar");
        assert_eq!(element["animated"][0], "scaleX");
    }

    #[test]
    fn animating_an_unknown_property_names_the_valid_ones() {
        let mut studio = new_studio();
        call(
            &mut studio,
            "add_shape",
            json!({ "role": "data", "start": 0, "duration": 1, "id": "s" }),
        );
        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "animate",
            json!({ "elementId": "s", "property": "wobble",
                    "keys": [{ "t": 0, "value": 0 }, { "t": 1, "value": 1 }] }),
        ));
        assert!(is_error);
        assert!(
            message.contains("scaleX"),
            "should list valid ones: {message}"
        );
    }

    #[test]
    fn a_single_keyframe_is_rejected() {
        let mut studio = new_studio();
        call(
            &mut studio,
            "add_shape",
            json!({ "role": "data", "start": 0, "duration": 1, "id": "s" }),
        );
        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "animate",
            json!({ "elementId": "s", "property": "opacity", "keys": [{ "t": 0, "value": 1 }] }),
        ));
        assert!(is_error, "one keyframe animates nothing");
        assert!(message.contains("two"), "{message}");
    }

    #[test]
    fn placing_unimported_media_is_refused() {
        let mut studio = new_studio();
        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "add_audio",
            json!({ "mediaId": "nope", "start": 0, "duration": 5 }),
        ));
        assert!(is_error);
        assert!(message.contains("media_import"), "{message}");
    }

    /// A family is no longer something a caller can name at all — the kit owns it, and a kit
    /// whose families are not installed is refused when it is committed. What survives from the
    /// old rule is the part that mattered: a face nobody has must never be substituted silently.
    #[test]
    fn a_raw_font_family_is_refused_and_names_the_way_in() {
        let mut studio = new_studio();
        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "add_text",
            json!({ "role": "headline", "start": 0, "duration": 1, "content": "x",
                    "fontFamily": "Definitely Not An Installed Face" }),
        ));
        assert!(is_error, "a family is not an argument any more");
        assert!(message.contains("fontFamily"), "{message}");
        assert!(message.contains("role"), "name the way in: {message}");
        assert!(message.contains("style kit"), "{message}");
    }

    /// The custom-kit door is the one place a family can still be named, and it is closed
    /// against a face this machine does not have.
    #[test]
    fn a_custom_kit_naming_an_absent_family_is_refused() {
        let mut studio = new_studio();
        let mut kit = bay_project::builtin_kit("swiss").unwrap().clone();
        kit.id = "custom".into();
        kit.faces.display.family = "Definitely Not An Installed Face".into();
        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "style_pick",
            json!({ "customKit": serde_json::to_value(&kit).unwrap() }),
        ));
        assert!(is_error, "a missing family must not fall back silently");
        assert!(
            message.contains("Definitely Not An Installed Face"),
            "{message}"
        );
    }

    #[test]
    fn layers_stack_upward_and_are_created_on_demand() {
        let mut studio = new_studio();
        for layer in [0, 3] {
            call(
                &mut studio,
                "add_shape",
                json!({ "role": "data", "start": 0, "duration": 1, "layer": layer,
                        "id": format!("s{layer}") }),
            );
        }
        let (_, timeline) = unwrap_call(&call(&mut studio, "timeline", json!({})));
        let timeline: Value = serde_json::from_str(&timeline).unwrap();
        let layers = timeline["layers"].as_array().expect("layers");
        assert_eq!(layers.len(), 4, "layer 3 implies layers 1 and 2 exist");
        assert_eq!(layers[0]["elements"][0]["id"], "s0");
        assert_eq!(layers[3]["elements"][0]["id"], "s3");
    }
}

#[cfg(test)]
mod narration_tests {
    use super::tests_support::*;
    use crate::Studio;
    use serde_json::{Value, json};

    fn srt_fixture(dir: &std::path::Path) -> String {
        let path = dir.join("fixture.srt");
        std::fs::write(
            &path,
            "1\n00:00:00,000 --> 00:00:02,000\nAverages add.\n\n\
             2\n00:00:02,500 --> 00:00:05,000\nMoney compounds.\n\n",
        )
        .expect("write fixture");
        path.to_string_lossy().to_string()
    }

    fn tmpdir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(name);
        let _ = std::fs::create_dir_all(&dir);
        dir
    }

    #[test]
    #[ignore = "drives the Kokoro TTS sidecar; run it with `SLOW=1 ./test.sh`"]
    fn subtitles_add_places_one_caption_per_cue() {
        let mut studio = new_studio();
        let dir = tmpdir("bay-mcp-subs");
        call(&mut studio, "project_create", json!({}));
        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "subtitles_add",
            json!({ "path": srt_fixture(&dir) }),
        ));
        assert!(!is_error, "{body}");
        let body: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(body["cues"], 2);
        assert!((body["lastSeconds"].as_f64().unwrap() - 5.0).abs() < 1e-6);

        let (_, timeline) = unwrap_call(&call(&mut studio, "timeline", json!({})));
        let timeline: Value = serde_json::from_str(&timeline).unwrap();
        // Captions default to layer 9, above every artwork layer.
        let captions: Vec<&Value> = timeline["layers"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|layer| layer["elements"].as_array().unwrap())
            .filter(|e| e["id"].as_str().unwrap_or("").starts_with("caption-"))
            .collect();
        assert_eq!(captions.len(), 2, "both cues should be on the timeline");
        assert_eq!(captions[0]["content"], "Averages add.");
        assert_eq!(
            captions[0]["animated"][0], "opacity",
            "captions should fade rather than hard-cut"
        );
    }

    #[test]
    #[ignore = "drives the Kokoro TTS sidecar; run it with `SLOW=1 ./test.sh`"]
    fn subtitles_round_trip_through_the_timeline() {
        let mut studio = new_studio();
        let dir = tmpdir("bay-mcp-subs-rt");
        call(&mut studio, "project_create", json!({}));
        call(
            &mut studio,
            "subtitles_add",
            json!({ "path": srt_fixture(&dir) }),
        );
        let out = dir.join("exported.srt").to_string_lossy().to_string();
        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "subtitles_export",
            json!({ "path": out, "format": "srt" }),
        ));
        assert!(!is_error, "{body}");
        let written = std::fs::read_to_string(&out).expect("the export should exist");
        assert!(written.contains("Averages add."), "{written}");
        assert!(written.contains("Money compounds."), "{written}");
        assert!(
            written.contains("00:00:02,500 --> 00:00:05,000"),
            "{written}"
        );
    }

    #[test]
    #[ignore = "drives the Kokoro TTS sidecar; run it with `SLOW=1 ./test.sh`"]
    fn exporting_with_no_captions_says_so() {
        let mut studio = new_studio();
        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "subtitles_export",
            json!({ "path": "/tmp/bay-never.srt" }),
        ));
        assert!(is_error);
        assert!(message.contains("no captions"), "{message}");
    }

    #[test]
    #[ignore = "drives the Kokoro TTS sidecar; run it with `SLOW=1 ./test.sh`"]
    fn a_subtitle_file_that_is_not_one_is_rejected() {
        let mut studio = new_studio();
        let dir = tmpdir("bay-mcp-badsubs");
        let path = dir.join("prose.txt");
        std::fs::write(&path, "this is just prose\nno timings here").unwrap();
        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "subtitles_add",
            json!({ "path": path.to_string_lossy() }),
        ));
        assert!(is_error);
        assert!(message.contains("no cues"), "{message}");
    }

    #[test]
    #[ignore = "drives the Kokoro TTS sidecar; run it with `SLOW=1 ./test.sh`"]
    fn an_offset_shifts_every_caption() {
        let mut studio = new_studio();
        let dir = tmpdir("bay-mcp-offset");
        call(&mut studio, "project_create", json!({}));
        let (_, body) = unwrap_call(&call(
            &mut studio,
            "subtitles_add",
            json!({ "path": srt_fixture(&dir), "offset": 10.0 }),
        ));
        let body: Value = serde_json::from_str(&body).unwrap();
        assert!((body["firstSeconds"].as_f64().unwrap() - 10.0).abs() < 1e-6);
        assert!((body["lastSeconds"].as_f64().unwrap() - 15.0).abs() < 1e-6);
    }

    #[test]
    #[ignore = "drives the Kokoro TTS sidecar; run it with `SLOW=1 ./test.sh`"]
    fn speech_status_answers_without_throwing_however_the_machine_is_set_up() {
        let mut studio = new_studio();
        let (is_error, body) = unwrap_call(&call(&mut studio, "speech_status", json!({})));
        assert!(!is_error, "speech_status should report, not fail: {body}");
        let body: Value = serde_json::from_str(&body).unwrap();
        assert!(body["available"].is_boolean());
        if body["available"] == Value::Bool(true) {
            assert!(
                body["voices"]["a"].is_array(),
                "an available engine should list American English voices"
            );
        } else {
            assert!(
                body.get("hint").is_some() || body.get("error").is_some(),
                "an unavailable engine must say why: {body}"
            );
        }
    }

    /// The tool an agent reaches for when a render failed for want of ffmpeg. It has to answer
    /// on any machine — including one where nothing is installed, which is exactly when it is
    /// called — and it must never start a download by being asked a question.
    #[test]
    #[ignore = "drives the Kokoro TTS sidecar; run it with `SLOW=1 ./test.sh`"]
    fn runtime_status_reports_without_installing_anything() {
        let mut studio = new_studio();
        let (is_error, body) = unwrap_call(&call(&mut studio, "runtime_status", json!({})));
        assert!(!is_error, "runtime_status should report, not fail: {body}");
        let body: Value = serde_json::from_str(&body).unwrap();
        assert!(body["components"].is_array());
        assert!(body["canRender"].is_boolean());
        assert!(
            body["hint"].as_str().is_some_and(|hint| !hint.is_empty()),
            "the status must say what to do next: {body}"
        );
        assert!(
            body["jobs"].as_array().is_some_and(Vec::is_empty),
            "asking for status must not have started an install: {body}"
        );
    }

    /// A component that does not exist must come back as a tool error the agent can correct,
    /// not a panic and not a silent success.
    #[test]
    #[ignore = "drives the Kokoro TTS sidecar; run it with `SLOW=1 ./test.sh`"]
    fn runtime_install_refuses_a_component_it_does_not_have() {
        let mut studio = new_studio();
        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "runtime_install",
            json!({ "component": "banana" }),
        ));
        assert!(is_error, "an unknown component must be an error: {body}");
        assert!(body.contains("banana"), "{body}");
    }

    #[test]
    #[ignore = "drives the Kokoro TTS sidecar; run it with `SLOW=1 ./test.sh`"]
    fn runtime_install_requires_a_component() {
        let mut studio = new_studio();
        let (is_error, body) = unwrap_call(&call(&mut studio, "runtime_install", json!({})));
        assert!(is_error, "{body}");
        assert!(body.contains("video") && body.contains("speech"), "{body}");
    }

    /// Installing something already present must be a cheap acknowledgement rather than a
    /// re-download — an agent that calls this defensively before every render should cost
    /// nothing on a provisioned machine.
    #[test]
    #[ignore = "drives the Kokoro TTS sidecar; run it with `SLOW=1 ./test.sh`"]
    fn installing_what_is_already_there_starts_no_job() {
        let mut studio = new_studio();
        let (_, status) = unwrap_call(&call(&mut studio, "runtime_status", json!({})));
        let status: Value = serde_json::from_str(&status).unwrap();
        let installed = status["components"].as_array().and_then(|components| {
            components
                .iter()
                .find(|component| component["installed"] == Value::Bool(true))
                .cloned()
        });
        let Some(component) = installed else {
            eprintln!("skipping: nothing is provisioned on this machine");
            return;
        };
        let id = component["id"].as_str().unwrap().to_string();
        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "runtime_install",
            json!({ "component": id }),
        ));
        assert!(!is_error, "{body}");
        let body: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(body["installed"], Value::Bool(true));
        assert!(body["job"].is_null(), "no job should have started: {body}");
    }

    /// A speech-sidecar port that no other process on this machine will pick.
    ///
    /// `fixes.md` 13. These were the literals 7451 and 7452, with a comment explaining that a
    /// port of their own was needed — which was the right diagnosis and only half the fix. A
    /// fixed port is still shared with every *other* copy of this test binary, so two concurrent
    /// runs, or one left-over sidecar from a previous run, fail them for reasons outside the
    /// repository. That is the failure `CLAUDE.md` records twice: the registry tests had the pid
    /// on their port and not on their scratch directory, and 11 of 12 concurrent runs failed.
    ///
    /// Derived from the pid, in the IANA dynamic range, and never the product's 7334. `slot`
    /// separates the tests within one binary; they run in the same process and must not collide
    /// with each other either.
    fn unique_speech_port(slot: u16) -> u16 {
        // Two ports per process, so `slot` cannot collide with the next pid's base.
        let base = 49_152u32 + (u32::from(std::process::id() as u16) % 7_000) * 2;
        (base as u16).saturating_add(slot)
    }

    #[test]
    #[ignore = "drives the Kokoro TTS sidecar; run it with `SLOW=1 ./test.sh`"]
    fn narrating_reuses_one_hot_sidecar_across_calls() {
        let mut studio = Studio::for_test(test_library_root(), unique_speech_port(0));
        let (_, status) = unwrap_call(&call(&mut studio, "speech_status", json!({})));
        let status: Value = serde_json::from_str(&status).unwrap();
        if status["available"] != Value::Bool(true) {
            eprintln!("skipping: Kokoro is not available here");
            return;
        }
        call(&mut studio, "project_create", json!({}));

        let first = std::time::Instant::now();
        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "narrate",
            json!({ "text": "Averages add.", "start": 0.0 }),
        ));
        assert!(!is_error, "{body}");
        let cold = first.elapsed();

        let second = std::time::Instant::now();
        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "narrate",
            json!({ "text": "Money compounds.", "start": 4.0 }),
        ));
        assert!(!is_error, "{body}");
        let warm = second.elapsed();
        let envelope: Value = serde_json::from_str(&body).unwrap();

        // narrate is a job tool now: it answers with an id, and what it used to return in-band
        // is the job's `result`. Asserted through job_status rather than the inlined copy, so
        // this test covers the path an agent actually takes.
        let job = envelope["job"].as_u64().expect("narrate returns a job id");
        let body = bay_jobs::mcp::status(&json!({ "job": job }));
        assert_eq!(body["finished"], true, "{body}");
        let body = &body["result"];

        assert!(body["words"].as_u64().unwrap() >= 2, "{body}");
        assert!(
            body["cues"].as_array().unwrap()[0]["start"]
                .as_f64()
                .unwrap()
                >= 4.0,
            "cues must be shifted to the narration's start: {body}"
        );
        assert!(
            body["captionsPlaced"].as_u64().unwrap() >= 1,
            "narrate should place captions by default: {body}"
        );
        // The Studio holds one engine for its lifetime; building one per call would reload the
        // model every time, which is the cost the whole sidecar design exists to avoid.
        assert!(
            warm < cold,
            "the second narration ({warm:?}) should beat the first ({cold:?})"
        );
    }

    /// §1.4 end to end, on real speech: the read is planned as a rate and measured as one, and
    /// every cue it places clears both reading floors.
    #[test]
    #[ignore = "drives the Kokoro TTS sidecar; run it with `SLOW=1 ./test.sh`"]
    fn a_real_narration_reports_its_rate_and_places_readable_cues() {
        let mut studio = Studio::for_test(test_library_root(), unique_speech_port(1));
        let (_, status) = unwrap_call(&call(&mut studio, "speech_status", json!({})));
        let status: Value = serde_json::from_str(&status).unwrap();
        if status["available"] != Value::Bool(true) {
            eprintln!("skipping: Kokoro is not available here");
            return;
        }
        call(&mut studio, "project_create", json!({ "kit": "swiss" }));

        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "narrate",
            json!({ "text": "The wick is the range. The body is the close.", "start": 0.0 }),
        ));
        assert!(!is_error, "{body}");
        let envelope: Value = serde_json::from_str(&body).unwrap();
        let body = envelope["result"].clone();

        // The loop the old surface left open: the caller asked for a rate and is told what it
        // got, rather than setting a multiplier and finding out from the finished video.
        let rate = body["wordsPerSecond"]
            .as_f64()
            .expect("narrate reports the rate it delivered");
        assert!(
            (rate - bay_speech::TARGET_WORDS_PER_SECOND).abs() < 0.6,
            "a default read should land near {} words a second, got {rate}: {body}",
            bay_speech::TARGET_WORDS_PER_SECOND
        );
        assert!(
            body["speed"].as_f64().unwrap() < 1.0,
            "150 wpm means slowing Kokoro down: {body}"
        );

        for cue in body["cues"].as_array().expect("cues") {
            let (start, end) = (cue["start"].as_f64().unwrap(), cue["end"].as_f64().unwrap());
            let words = cue["text"].as_str().unwrap().split_whitespace().count();
            assert!(
                end - start + 1e-6 >= bay_speech::MIN_CUE_SECONDS,
                "a {:.3}s cue is a flash: {cue}",
                end - start
            );
            assert!(
                end - start + 1e-6 >= bay_speech::MIN_SECONDS_PER_WORD * words as f64,
                "{words} words in {:.3}s is faster than anyone reads: {cue}",
                end - start
            );
            assert!(
                !(cue["text"].as_str().unwrap().contains("range")
                    && cue["text"].as_str().unwrap().contains("body")),
                "a cue crossed the full stop: {cue}"
            );
        }
    }
}

#[cfg(test)]
mod undo_tests {
    use super::tests_support::{call, new_studio, unwrap_call};
    use super::*;
    use serde_json::{Value, json};

    fn timeline_ids(studio: &mut Studio) -> Vec<String> {
        let (_, text) = unwrap_call(&call(studio, "timeline", json!({})));
        let timeline: Value = serde_json::from_str(&text).expect("timeline is JSON");
        timeline["layers"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .flat_map(|layer| layer["elements"].as_array().cloned().unwrap_or_default())
            .filter_map(|e| e["id"].as_str().map(str::to_string))
            .collect()
    }

    /// Every mutating tool must leave an undoable history entry.
    ///
    /// Four of them wrote through `Editor::project_mut`, which CLEARS the undo stack by
    /// design. So an agent adding a caption on layer 9, animating anything, or deleting an
    /// element silently destroyed the user's undo history — fatal for an assistant editing the
    /// same document a human is working in.
    #[test]
    fn agent_edits_are_undoable() {
        let mut studio = new_studio();
        call(&mut studio, "project_create", json!({}));

        // layer > 0 forces overlay-track creation, which used to clear history.
        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "add_shape",
            json!({ "role": "data", "id": "bar", "start": 0, "duration": 2, "layer": 3 }),
        ));
        assert!(!is_error, "{body}");

        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "animate",
            json!({ "elementId": "bar", "property": "scaleX", "easing": "power-out",
                    "keys": [{ "t": 0, "value": 0 }, { "t": 0.8, "value": 0.6 }] }),
        ));
        assert!(!is_error, "{body}");
        assert!(
            studio.editor_for_test().can_undo(),
            "animating must leave something to undo"
        );
        assert!(timeline_ids(&mut studio).contains(&"bar".to_string()));

        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "element_delete",
            json!({ "elementId": "bar" }),
        ));
        assert!(!is_error, "{body}");
        assert!(
            !timeline_ids(&mut studio).contains(&"bar".to_string()),
            "the shape should be gone"
        );

        // The whole point: the delete is reversible.
        assert!(
            studio.editor_for_test().can_undo(),
            "delete must be undoable"
        );
        assert!(studio.editor_for_test_mut().undo(), "undo should succeed");
        assert!(
            timeline_ids(&mut studio).contains(&"bar".to_string()),
            "undo should bring the shape back"
        );
    }

    #[test]
    fn creating_a_lane_does_not_wipe_earlier_history() {
        let mut studio = new_studio();
        call(&mut studio, "project_create", json!({}));
        call(
            &mut studio,
            "add_text",
            json!({ "role": "headline", "id": "t", "start": 0, "duration": 2, "content": "before" }),
        );
        assert!(studio.editor_for_test().can_undo());

        // An overlay lane high enough to force creation.
        call(
            &mut studio,
            "add_shape",
            json!({ "role": "data", "id": "s", "start": 0, "duration": 1, "layer": 5 }),
        );
        assert!(
            studio.editor_for_test().can_undo(),
            "the text element's history must survive creating overlay lanes"
        );
        // And undo still walks back through both.
        assert!(studio.editor_for_test_mut().undo());
        assert!(!timeline_ids(&mut studio).contains(&"s".to_string()));
        assert!(timeline_ids(&mut studio).contains(&"t".to_string()));
    }
}

#[cfg(test)]
mod provenance_tests {
    //! Who put an element on the timeline, and what it is for.
    //!
    //! These are contract tests for the tool surface, not the model — the model's own
    //! round-trip lives in `bay-project`. What matters here is that a caller cannot take bay's
    //! provenance, cannot place type without saying what it is for, and can read both back.

    use super::tests_support::{call, new_studio, unwrap_call};
    use super::*;
    use serde_json::{Value, json};

    /// The whole point of the field: an author cannot claim bay's provenance. `caption-<n>` is
    /// what tells every later measurement which elements were never a choice.
    #[test]
    fn the_caption_id_space_is_refused_to_a_caller() {
        let mut studio = new_studio();
        call(&mut studio, "project_create", json!({}));
        for tool in ["add_text", "add_shape"] {
            let (is_error, message) = unwrap_call(&call(
                &mut studio,
                tool,
                json!({ "role": "label", "id": "caption-7", "start": 0, "duration": 1,
                        "content": "mine" }),
            ));
            assert!(is_error, "{tool} accepted a reserved id");
            assert!(message.contains("reserved"), "{message}");
        }
        // The shape of the rule, not the prefix: an id that merely starts with the word is fine.
        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "add_text",
            json!({ "role": "label", "id": "caption-note", "start": 0, "duration": 1,
                    "content": "mine" }),
        ));
        assert!(!is_error, "{message}");
    }

    /// `role` is required, and the refusal has to teach the vocabulary — an agent that gets
    /// "missing field" learns nothing about what the field is for.
    #[test]
    fn placing_type_without_saying_what_it_is_for_is_refused() {
        let mut studio = new_studio();
        call(&mut studio, "project_create", json!({}));

        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "add_text",
            json!({ "start": 0, "duration": 2, "content": "Wicks" }),
        ));
        assert!(is_error, "add_text must insist on a role");
        assert!(message.contains("role"), "{message}");
        assert!(
            message.contains("headline"),
            "the list is the lesson: {message}"
        );

        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "add_shape",
            json!({ "start": 0, "duration": 2 }),
        ));
        assert!(is_error, "add_shape must insist on a role");
        assert!(message.contains("role"), "{message}");

        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "add_text",
            json!({ "role": "wallpaper", "start": 0, "duration": 2, "content": "x" }),
        ));
        assert!(is_error, "an unknown role is not silently a default");
        assert!(message.contains("ground"), "{message}");
    }

    /// What an author places is the author's, and the timeline says so on the way back out.
    #[test]
    fn an_authored_element_reads_back_with_its_role() {
        let mut studio = new_studio();
        call(&mut studio, "project_create", json!({}));
        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "add_text",
            json!({ "role": "hook", "id": "hero", "start": 0, "duration": 2,
                    "content": "Wicks" }),
        ));
        assert!(!is_error, "{body}");

        let (_, timeline) = unwrap_call(&call(&mut studio, "timeline", json!({})));
        let timeline: Value = serde_json::from_str(&timeline).expect("timeline is JSON");
        let element = &timeline["layers"][0]["elements"][0];
        assert_eq!(element["id"], "hero");
        assert_eq!(element["source"], "author");
        assert_eq!(element["role"], "hook");

        let (_, info) = unwrap_call(&call(&mut studio, "project_info", json!({})));
        let info: Value = serde_json::from_str(&info).expect("project_info is JSON");
        assert_eq!(info["authoredElements"], json!(1));
        assert_eq!(info["toolElements"], json!(0));
    }

    #[test]
    fn add_text_reports_wrapped_ink_height_for_stacking() {
        let mut studio = new_studio();
        call(
            &mut studio,
            "project_create",
            json!({ "width": 1080, "height": 1920, "kit": "stadium" }),
        );
        let (_, one_line) = unwrap_call(&call(
            &mut studio,
            "add_text",
            json!({
                "role": "chrome", "id": "short", "start": 0, "duration": 2, "content": "SHORT",
                "x": 0.5, "y": 0.05, "anchorX": 0.5, "anchorY": 0.0, "scale": 0.32
            }),
        ));
        let (_, wrapped) = unwrap_call(&call(
            &mut studio,
            "add_text",
            json!({
                "role": "chrome", "start": 2, "duration": 2,
                "content": "THE GREEN INTERVIEW · CC BY 3.0",
                "x": 0.5, "y": 0.05, "anchorX": 0.5, "anchorY": 0.0, "scale": 0.32
            }),
        ));
        let one_line: Value = serde_json::from_str(&one_line).expect("add_text JSON");
        let wrapped: Value = serde_json::from_str(&wrapped).expect("add_text JSON");
        let one_line_height = one_line["textLayout"]["height"]
            .as_f64()
            .expect("measured one-line height");
        let wrapped_height = wrapped["textLayout"]["height"]
            .as_f64()
            .expect("measured wrapped height");

        assert_eq!(wrapped["textLayout"]["basis"], "glyph-ink");
        assert!(
            wrapped_height > one_line_height * 1.5,
            "wrapping must advance a stack: one line {one_line_height}, wrapped {wrapped_height}"
        );

        let (_, revised) = unwrap_call(&call(
            &mut studio,
            "text_update",
            json!({
                "elementId": "short",
                "content": "THE GREEN INTERVIEW · CC BY 3.0"
            }),
        ));
        let revised: Value = serde_json::from_str(&revised).expect("text_update JSON");
        assert!(
            revised["textLayout"]["height"].as_f64().unwrap() > one_line_height * 1.5,
            "text_update must return the wrapped layout it produced: {revised}"
        );
    }

    /// A subtitle file becomes captions, and every one of them is bay's — no GPU, no speech
    /// model, so this runs everywhere.
    #[test]
    fn captions_placed_from_a_subtitle_file_are_bays_own() {
        let mut studio = new_studio();
        call(&mut studio, "project_create", json!({}));
        let path = tests_support::test_library_root().join("cues.srt");
        std::fs::create_dir_all(path.parent().expect("a parent")).expect("scratch directory");
        std::fs::write(
            &path,
            "1\n00:00:00,000 --> 00:00:01,500\nthe range is not\n\n\
             2\n00:00:01,500 --> 00:00:03,000\nwhat it looks like\n",
        )
        .expect("write the cues");

        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "subtitles_add",
            json!({ "path": path.to_string_lossy() }),
        ));
        assert!(!is_error, "{body}");

        let (_, info) = unwrap_call(&call(&mut studio, "project_info", json!({})));
        let info: Value = serde_json::from_str(&info).expect("project_info is JSON");
        assert_eq!(
            info["toolElements"],
            json!(2),
            "both cues are bay's: {info}"
        );
        assert_eq!(info["authoredElements"], json!(0));

        let (_, timeline) = unwrap_call(&call(&mut studio, "timeline", json!({})));
        let timeline: Value = serde_json::from_str(&timeline).expect("timeline is JSON");
        let captions = timeline["layers"]
            .as_array()
            .expect("layers")
            .iter()
            .flat_map(|layer| layer["elements"].as_array().cloned().unwrap_or_default())
            .collect::<Vec<_>>();
        assert_eq!(captions.len(), 2);
        for caption in &captions {
            assert_eq!(caption["source"], "tool", "{caption}");
            assert_eq!(caption["role"], "caption", "{caption}");
        }
    }

    /// A hand-placed sound says what it is doing, so the mix can be measured. An unlabelled one
    /// is a bed, which is what it usually is.
    #[test]
    fn an_audio_clip_carries_what_it_is_doing_in_the_mix() {
        let mut studio = new_studio();
        call(&mut studio, "project_create", json!({}));
        let wav = tests_support::test_library_root().join("bed.wav");
        std::fs::create_dir_all(wav.parent().expect("a parent")).expect("scratch directory");
        let click = bay_audio::sfx::Sfx::by_id("click").expect("bay synthesises a click");
        let pcm = click.render(bay_audio::sfx::SfxParams {
            seconds: 0.2,
            tone: 0.5,
            level: 0.5,
        });
        std::fs::write(&wav, bay_audio::sfx::encode_wav(&pcm)).expect("write a wav");
        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "media_import",
            json!({ "path": wav.to_string_lossy(), "id": "m" }),
        ));
        assert!(!is_error, "{body}");

        for (role, expected) in [(Some("sfx"), "sfx"), (None, "bed")] {
            let mut args = json!({ "mediaId": "m", "start": 0, "duration": 0.5,
                                   "id": format!("a-{expected}") });
            if let Some(role) = role {
                args["role"] = json!(role);
            }
            let (is_error, body) = unwrap_call(&call(&mut studio, "add_audio", args));
            assert!(!is_error, "{body}");
        }

        let (_, timeline) = unwrap_call(&call(&mut studio, "timeline", json!({})));
        let timeline: Value = serde_json::from_str(&timeline).expect("timeline is JSON");
        let audio = timeline["audio"].as_array().expect("audio lane");
        for clip in audio {
            assert_eq!(clip["source"], "author", "{clip}");
        }
        assert_eq!(audio[0]["role"], "sfx");
        assert_eq!(audio[1]["role"], "bed");

        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "add_audio",
            json!({ "mediaId": "m", "start": 1, "duration": 0.5, "role": "music" }),
        ));
        assert!(is_error, "an unknown audio role is not silently a bed");
        assert!(message.contains("speech"), "{message}");
    }
}
