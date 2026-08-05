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
const SERVER_NAME: &str = "vii";

/// Handle one JSON-RPC message. Returns `None` for notifications, which take no response.
fn handle(studio: &mut Studio, request: &Value) -> Option<Value> {
    let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = request.get("params").cloned().unwrap_or(json!({}));

    // Notifications carry no id and must not be answered.
    let id = request.get("id").cloned()?;

    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": {
                "name": SERVER_NAME,
                "version": env!("CARGO_PKG_VERSION"),
            },
            "instructions": INSTRUCTIONS,
        })),
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

const INSTRUCTIONS: &str = "\
vii is a native video editor. Build a timeline with these tools, then render it to MP4.

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

/// Serve MCP over HTTP on `127.0.0.1:port`. Pass port 0 to let the OS pick one; the chosen
/// port is printed and returned.
///
/// Single-threaded on purpose: the studio owns one GPU device and one project, so concurrent
/// tool calls would need a lock around everything anyway. Requests are handled in order.
pub fn serve_http(port: u16) -> std::io::Result<()> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port))?;
    let bound = listener.local_addr()?;
    println!("vii MCP server listening on http://{bound}/mcp");
    println!("  claude mcp add --transport http vii http://{bound}/mcp");
    std::io::stdout().flush()?;

    let mut studio = Studio::new();
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                if let Err(e) = serve_connection(&mut studio, stream) {
                    eprintln!("vii-mcp: connection error: {e}");
                }
            }
            Err(e) => eprintln!("vii-mcp: accept failed: {e}"),
        }
    }
    Ok(())
}

fn serve_connection(studio: &mut Studio, mut stream: TcpStream) -> std::io::Result<()> {
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
            let replies: Vec<Value> = items
                .iter()
                .filter_map(|item| handle(studio, item))
                .collect();
            if replies.is_empty() {
                None
            } else {
                Some(Value::Array(replies))
            }
        }
        other => handle(studio, other),
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
mod tests {
    use super::*;

    fn call(studio: &mut Studio, name: &str, args: Value) -> Value {
        let request = json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": { "name": name, "arguments": args }
        });
        handle(studio, &request).expect("a request always gets a response")
    }

    /// The text of a tool result, and whether it reported an error.
    fn unwrap_call(response: &Value) -> (bool, String) {
        let result = &response["result"];
        (
            result["isError"].as_bool().unwrap_or(false),
            result["content"][0]["text"].as_str().unwrap_or("").into(),
        )
    }

    #[test]
    fn initialize_advertises_tools() {
        let mut studio = Studio::new();
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
        let mut studio = Studio::new();
        let response = handle(
            &mut studio,
            &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
        );
        assert!(response.is_none(), "a notification must not be answered");
    }

    #[test]
    fn every_advertised_tool_has_a_schema_and_dispatches() {
        let mut studio = Studio::new();
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
        let mut studio = Studio::new();
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
        let mut studio = Studio::new();
        let response = handle(
            &mut studio,
            &json!({ "jsonrpc": "2.0", "id": 7, "method": "nope" }),
        )
        .expect("a request gets a response");
        assert_eq!(response["error"]["code"], -32601);
    }

    #[test]
    fn building_a_timeline_reports_what_was_built() {
        let mut studio = Studio::new();
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
        let mut studio = Studio::new();
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
        let mut studio = Studio::new();
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
        let mut studio = Studio::new();
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
        let mut studio = Studio::new();
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
        let mut studio = Studio::new();
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
