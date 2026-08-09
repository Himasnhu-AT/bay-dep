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

use serde_json::{Value, json};

use crate::studio::Studio;
use crate::tools;

const PROTOCOL_VERSION: &str = "2025-06-18";
const SERVER_NAME: &str = "bay";

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
  7. render

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
    let bound = listener.local_addr()?;
    let mode = if bridge.is_some() {
        "attached to the open editor"
    } else {
        "headless"
    };
    println!("bay MCP server listening on http://{bound}/mcp ({mode})");
    if bridge.is_none() {
        println!("  claude mcp add --transport http bay http://{bound}/mcp");
    }
    std::io::stdout().flush()?;

    match bridge {
        Some(bridge) => {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        let bridge = bridge.clone();
                        // Thread per connection: the handler blocks waiting for the editor to
                        // answer, and blocking the accept loop would stall every other client.
                        std::thread::spawn(move || {
                            if let Err(e) = serve_attached_connection(&bridge, stream) {
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
                        if let Err(e) = serve_connection(&mut studio, stream) {
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

/// How long a tool call waits for the editor before giving up.
///
/// Generous, because the one main-thread stall we cannot engineer away is a native file dialog
/// — and short enough that an agent gets a message it can act on rather than hanging forever.
const ATTACHED_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// Handle one connection in attached mode: `initialize` and `tools/list` are answered here,
/// and everything else is forwarded to the editor.
fn serve_attached_connection(
    bridge: &bay_agent::AgentBridge,
    stream: TcpStream,
) -> std::io::Result<()> {
    serve_with(stream, |request| handle_attached(bridge, request))
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
            let (text, is_error) = match bridge.call(call, ATTACHED_TIMEOUT) {
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

fn serve_connection(studio: &mut Studio, stream: TcpStream) -> std::io::Result<()> {
    serve_with(stream, |request| handle(studio, request))
}

/// The HTTP half of the transport, shared by both modes.
///
/// `dispatch` turns one JSON-RPC message into an optional reply; everything about reading the
/// request and writing the response lives here so the two modes cannot drift apart.
fn serve_with(
    mut stream: TcpStream,
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

    // Headers — we only need the body length.
    let mut content_length = 0usize;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 {
            break;
        }
        let header = header.trim_end();
        if header.is_empty() {
            break;
        }
        if let Some(value) = header
            .strip_prefix("Content-Length:")
            .or_else(|| header.strip_prefix("content-length:"))
        {
            content_length = value.trim().parse().unwrap_or(0);
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use tests_support::{call, new_studio, unwrap_call};

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

    #[test]
    fn tool_errors_come_back_as_results_not_protocol_errors() {
        let mut studio = new_studio();
        let response = call(&mut studio, "add_text", json!({ "start": 0 }));
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
            json!({ "start": 0, "duration": 2, "id": "bar", "color": "#ff5b5b",
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
            json!({ "start": 0, "duration": 1, "id": "s" }),
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
            json!({ "start": 0, "duration": 1, "id": "s" }),
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

    #[test]
    fn an_uninstalled_font_family_is_refused_rather_than_silently_substituted() {
        let mut studio = new_studio();
        let (is_error, message) = unwrap_call(&call(
            &mut studio,
            "add_text",
            json!({ "start": 0, "duration": 1, "content": "x",
                    "fontFamily": "Definitely Not An Installed Face" }),
        ));
        assert!(is_error, "a missing family must not fall back silently");
        assert!(message.contains("fonts_check"), "{message}");
    }

    #[test]
    fn layers_stack_upward_and_are_created_on_demand() {
        let mut studio = new_studio();
        for layer in [0, 3] {
            call(
                &mut studio,
                "add_shape",
                json!({ "start": 0, "duration": 1, "layer": layer,
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

    #[test]
    fn narrating_reuses_one_hot_sidecar_across_calls() {
        // A port of its own, never the product's 7334. Sharing it meant this test failed
        // whenever anything else on the machine held that port — another test binary spawning a
        // sidecar, or a `bay --mcp` someone left running — and a test that fails for reasons
        // outside the repository is one people learn to re-run rather than read.
        let mut studio = Studio::for_test(test_library_root(), 7451);
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
        let body: Value = serde_json::from_str(&body).unwrap();

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
}

#[cfg(test)]
mod undo_tests {
    use super::tests_support::{call, unwrap_call};
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
        let mut studio = Studio::new();
        call(&mut studio, "project_create", json!({}));

        // layer > 0 forces overlay-track creation, which used to clear history.
        let (is_error, body) = unwrap_call(&call(
            &mut studio,
            "add_shape",
            json!({ "id": "bar", "start": 0, "duration": 2, "layer": 3, "color": "#ff0000" }),
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
        let mut studio = Studio::new();
        call(&mut studio, "project_create", json!({}));
        call(
            &mut studio,
            "add_text",
            json!({ "id": "t", "start": 0, "duration": 2, "content": "before" }),
        );
        assert!(studio.editor_for_test().can_undo());

        // An overlay lane high enough to force creation.
        call(
            &mut studio,
            "add_shape",
            json!({ "id": "s", "start": 0, "duration": 1, "layer": 5 }),
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
