//! The MCP tool surface: JSON Schema declarations and argument decoding.
//!
//! Every tool's schema is written out longhand rather than derived, because the descriptions
//! are the entire user interface an agent gets. A field whose description says what units it
//! is in and what a good value looks like removes a whole round-trip of trial and error.

use opencut_project::{ShapeKind, Transform};
use serde_json::{Value, json};

use crate::studio::{
    Studio, ToolError, ToolResult, VisualArgs, err, parse_align, parse_blend, parse_easing,
    parse_keys,
};

fn number(value: &Value, key: &str, fallback: f64) -> f64 {
    value.get(key).and_then(|v| v.as_f64()).unwrap_or(fallback)
}

fn required_number(value: &Value, key: &str) -> Result<f64, ToolError> {
    value
        .get(key)
        .and_then(|v| v.as_f64())
        .ok_or_else(|| err(format!("missing required number field {key:?}")))
}

fn text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn required_text(value: &Value, key: &str) -> Result<String, ToolError> {
    text(value, key).ok_or_else(|| err(format!("missing required string field {key:?}")))
}

/// The transform/blend block every visual tool accepts.
fn visual(args: &Value) -> Result<VisualArgs, ToolError> {
    let transform = Transform {
        x: number(args, "x", 0.5) as f32,
        y: number(args, "y", 0.5) as f32,
        scale: number(args, "scale", 1.0) as f32,
        rotation: number(args, "rotation", 0.0) as f32,
        opacity: number(args, "opacity", 1.0) as f32,
        scale_x: number(args, "scaleX", 1.0) as f32,
        scale_y: number(args, "scaleY", 1.0) as f32,
        anchor_x: number(args, "anchorX", 0.5) as f32,
        anchor_y: number(args, "anchorY", 0.5) as f32,
    };
    Ok(VisualArgs {
        transform,
        blend_mode: parse_blend(args.get("blendMode").and_then(|v| v.as_str()))?,
    })
}

fn layer(args: &Value) -> usize {
    args.get("layer").and_then(|v| v.as_u64()).unwrap_or(0) as usize
}

/// Schema fragment for the shared placement fields, spliced into every visual tool.
fn visual_properties() -> Value {
    json!({
        "layer": { "type": "integer", "minimum": 0, "default": 0,
            "description": "Stacking order. 0 is the bottom (main) layer; higher numbers draw on top. Missing layers are created automatically." },
        "x": { "type": "number", "default": 0.5,
            "description": "Horizontal position of the element's anchor, as a fraction of canvas width (0 = left edge, 1 = right edge)." },
        "y": { "type": "number", "default": 0.5,
            "description": "Vertical position of the element's anchor, as a fraction of canvas height (0 = top, 1 = bottom)." },
        "scale": { "type": "number", "default": 1.0,
            "description": "Size as a fraction of the canvas. 1.0 spans the full frame. For text this is the box the type is laid out in." },
        "scaleX": { "type": "number", "default": 1.0,
            "description": "Extra horizontal-only multiplier on top of `scale`. Animate this to grow a bar sideways." },
        "scaleY": { "type": "number", "default": 1.0,
            "description": "Extra vertical-only multiplier on top of `scale`. Animate this to grow a column upward." },
        "anchorX": { "type": "number", "default": 0.5,
            "description": "Which horizontal point of the element sits at `x`: 0 = its left edge, 0.5 = centre, 1 = right edge. Set 0 so a bar grows rightward from a fixed origin instead of from its middle." },
        "anchorY": { "type": "number", "default": 0.5,
            "description": "Which vertical point of the element sits at `y`: 0 = top, 0.5 = centre, 1 = bottom. Set 1 so a column grows upward from a baseline." },
        "rotation": { "type": "number", "default": 0.0, "description": "Degrees clockwise, about the element's centre." },
        "opacity": { "type": "number", "default": 1.0, "description": "0 is invisible, 1 is opaque." },
        "blendMode": { "type": "string", "default": "normal",
            "description": "How this layer composites over what is beneath: normal, darken, multiply, color-burn, lighten, screen, plus-lighter, color-dodge, overlay, soft-light, hard-light, difference, exclusion, hue, saturation, color, luminosity." }
    })
}

fn merge(base: Value, extra: Value) -> Value {
    let mut out = base;
    if let (Some(target), Some(source)) = (out.as_object_mut(), extra.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
    out
}

fn tool(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": required,
        }
    })
}

/// Every tool the server advertises, in the order an author would use them.
pub fn definitions() -> Vec<Value> {
    vec![
        tool(
            "project_create",
            "Start a new, empty project. Call this first. Clears anything already on the timeline. \
             A vertical social reel is 1080x1920 at 30fps.",
            json!({
                "name": { "type": "string", "default": "Untitled" },
                "width": { "type": "integer", "default": 1080 },
                "height": { "type": "integer", "default": 1920 },
                "fps": { "type": "integer", "default": 30 },
                "background": { "type": "string", "default": "#000000",
                    "description": "Canvas fill as #rrggbb. Every frame sits on this." }
            }),
            &[],
        ),
        tool(
            "project_info",
            "Canvas size, fps, timeline duration and element counts for the current project.",
            json!({}),
            &[],
        ),
        tool(
            "fonts_check",
            "Report which of the given font families are actually installed. Call this BEFORE \
             using a family in add_text: an unavailable family would otherwise be silently \
             substituted with a fallback face that looks almost right.",
            json!({
                "families": { "type": "array", "items": { "type": "string" },
                    "description": "Family names to test, e.g. [\"Helvetica Neue\", \"Menlo\"]." }
            }),
            &["families"],
        ),
        tool(
            "media_import",
            "Register a media file (image, video or audio) and probe its real duration and \
             dimensions. Returns a mediaId to pass to add_image / add_video / add_audio.",
            json!({
                "path": { "type": "string", "description": "Path to the file on disk." },
                "id": { "type": "string", "description": "Optional explicit media id." }
            }),
            &["path"],
        ),
        tool(
            "add_text",
            "Place a text element on the timeline. Numbers should be set in a mono family and \
             sized large — a hero figure on a 1080x1920 reel wants fontSize around 200-320.",
            merge(
                json!({
                    "start": { "type": "number", "description": "Timeline start, in seconds." },
                    "duration": { "type": "number", "description": "How long it stays on screen, in seconds." },
                    "content": { "type": "string", "description": "The text. Use \\n for line breaks." },
                    "fontSize": { "type": "number", "default": 64,
                        "description": "Point size, expressed against a 1080-tall canvas and scaled automatically for other heights." },
                    "color": { "type": "string", "default": "#ffffff" },
                    "fontFamily": { "type": "string", "description": "Installed family name. Check with fonts_check first." },
                    "fontWeight": { "type": "integer", "default": 400, "description": "400 regular, 600 semibold, 700 bold." },
                    "align": { "type": "string", "enum": ["left", "center", "right"], "default": "left" },
                    "letterSpacing": { "type": "number", "default": 0.0,
                        "description": "Tracking in em. 0.18 suits an uppercase mono kicker; slightly negative tightens large display type." },
                    "lineHeight": { "type": "number", "default": 1.2, "description": "Multiple of the font size." },
                    "id": { "type": "string", "description": "Optional explicit element id, for animating it later." }
                }),
                visual_properties(),
            ),
            &["start", "duration", "content"],
        ),
        tool(
            "add_shape",
            "Place a solid rectangle or ellipse: bars, rules, dots, panels, underlines. To make \
             a bar chart, set anchorX to 0 and animate scaleX from 0 to its final value.",
            merge(
                json!({
                    "start": { "type": "number" },
                    "duration": { "type": "number" },
                    "shape": { "type": "string", "enum": ["rect", "ellipse"], "default": "rect" },
                    "radius": { "type": "number", "default": 0.0,
                        "description": "Corner radius for a rect, as a fraction of its shorter side. 0 is square, 0.5 is a fully rounded pill." },
                    "color": { "type": "string", "default": "#ffffff" },
                    "id": { "type": "string" }
                }),
                visual_properties(),
            ),
            &["start", "duration"],
        ),
        tool(
            "add_image",
            "Place an imported image. It is fitted inside its scale box without distortion.",
            merge(
                json!({
                    "mediaId": { "type": "string" },
                    "start": { "type": "number" },
                    "duration": { "type": "number" },
                    "id": { "type": "string" }
                }),
                visual_properties(),
            ),
            &["mediaId", "start", "duration"],
        ),
        tool(
            "add_video",
            "Place an imported video clip. It is fitted inside its scale box without distortion.",
            merge(
                json!({
                    "mediaId": { "type": "string" },
                    "start": { "type": "number" },
                    "duration": { "type": "number" },
                    "trimStart": { "type": "number", "default": 0.0,
                        "description": "Seconds to skip from the head of the source." },
                    "id": { "type": "string" }
                }),
                visual_properties(),
            ),
            &["mediaId", "start", "duration"],
        ),
        tool(
            "add_audio",
            "Place an audio clip (music bed, sound effect) on the audio lane. Audio is mixed \
             into the exported MP4.",
            json!({
                "mediaId": { "type": "string" },
                "start": { "type": "number", "description": "Timeline start, in seconds." },
                "duration": { "type": "number", "description": "How much of it plays, in seconds." },
                "volume": { "type": "number", "default": 1.0, "description": "Linear gain; 1.0 is unity." },
                "id": { "type": "string" }
            }),
            &["mediaId", "start", "duration"],
        ),
        tool(
            "animate",
            "Attach a keyframe animation to one property of one element. Replaces any existing \
             animation on that property. Keyframe times are relative to the ELEMENT's start, \
             not the timeline's.",
            json!({
                "elementId": { "type": "string" },
                "property": { "type": "string",
                    "enum": ["opacity", "scale", "x", "y", "rotation", "scaleX", "scaleY"] },
                "keys": {
                    "type": "array",
                    "description": "At least two keyframes, e.g. [{\"t\":0,\"value\":0},{\"t\":0.5,\"value\":1}].",
                    "items": {
                        "type": "object",
                        "properties": {
                            "t": { "type": "number", "description": "Seconds after the element starts." },
                            "value": { "type": "number" }
                        },
                        "required": ["t", "value"]
                    }
                },
                "easing": { "type": "string",
                    "enum": ["linear", "ease-in", "ease-out", "ease-in-out", "power-out", "expo-out", "back-out", "hold"],
                    "default": "linear",
                    "description": "power-out is the workhorse for entrances; ease-in-out for anything transforming in place; hold for a hard cut." }
            }),
            &["elementId", "property", "keys"],
        ),
        tool(
            "element_delete",
            "Remove an element from the timeline by id.",
            json!({ "elementId": { "type": "string" } }),
            &["elementId"],
        ),
        tool(
            "timeline",
            "Dump the whole timeline: every layer, its elements, their timings, transforms and \
             which properties are animated. Use this to re-read your own work between edits.",
            json!({}),
            &[],
        ),
        tool(
            "snapshot",
            "Render ONE frame to a PNG so you can look at it. This is the only way to catch the \
             failures that matter — a blank frame, type that collides, a hero number too small \
             to read at thumb size. Look at snapshots before you render the video.",
            json!({
                "at": { "type": "number", "description": "Timeline position to render, in seconds." },
                "path": { "type": "string", "description": "Where to write the PNG." },
                "scale": { "type": "number", "default": 0.5,
                    "description": "Fraction of full canvas resolution. 0.5 is fast and still legible for review." }
            }),
            &["at", "path"],
        ),
        tool(
            "render",
            "Encode the whole timeline to an MP4, picture and sound. Requires ffmpeg on PATH.",
            json!({
                "path": { "type": "string", "description": "Output .mp4 path." },
                "duration": { "type": "number",
                    "description": "Override the render length in seconds. Defaults to the timeline's own duration." }
            }),
            &["path"],
        ),
        tool(
            "project_save",
            "Write the project to a JSON file (the same format the vii desktop app opens).",
            json!({ "path": { "type": "string" } }),
            &["path"],
        ),
        tool(
            "project_load",
            "Replace the current project with one read from a JSON file.",
            json!({ "path": { "type": "string" } }),
            &["path"],
        ),
    ]
}

/// Route one tool call to the studio.
pub fn dispatch(studio: &mut Studio, name: &str, args: &Value) -> ToolResult {
    match name {
        "project_create" => studio.project_create(
            &text(args, "name").unwrap_or_else(|| "Untitled".into()),
            number(args, "width", 1080.0) as u32,
            number(args, "height", 1920.0) as u32,
            number(args, "fps", 30.0) as u32,
            &text(args, "background").unwrap_or_else(|| "#000000".into()),
        ),
        "project_info" => studio.project_info(),
        "fonts_check" => {
            let families: Vec<String> = args
                .get("families")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            if families.is_empty() {
                return Err(err("families must be a non-empty array of family names"));
            }
            studio.fonts_check(&families)
        }
        "media_import" => studio.media_import(&required_text(args, "path")?, text(args, "id")),
        "add_text" => studio.add_text(
            layer(args),
            text(args, "id"),
            required_number(args, "start")?,
            required_number(args, "duration")?,
            required_text(args, "content")?,
            number(args, "fontSize", 64.0) as f32,
            text(args, "color").unwrap_or_else(|| "#ffffff".into()),
            text(args, "fontFamily"),
            number(args, "fontWeight", 400.0) as u16,
            parse_align(args.get("align").and_then(|v| v.as_str()))?,
            number(args, "letterSpacing", 0.0) as f32,
            number(args, "lineHeight", 1.2) as f32,
            visual(args)?,
        ),
        "add_shape" => {
            let shape = match args.get("shape").and_then(|v| v.as_str()).unwrap_or("rect") {
                "rect" => ShapeKind::Rect {
                    radius: number(args, "radius", 0.0) as f32,
                },
                "ellipse" => ShapeKind::Ellipse,
                other => return Err(err(format!("unknown shape {other:?} — rect or ellipse"))),
            };
            studio.add_shape(
                layer(args),
                text(args, "id"),
                required_number(args, "start")?,
                required_number(args, "duration")?,
                shape,
                text(args, "color").unwrap_or_else(|| "#ffffff".into()),
                visual(args)?,
            )
        }
        "add_image" => studio.add_image(
            layer(args),
            text(args, "id"),
            required_text(args, "mediaId")?,
            required_number(args, "start")?,
            required_number(args, "duration")?,
            visual(args)?,
        ),
        "add_video" => studio.add_video(
            layer(args),
            text(args, "id"),
            required_text(args, "mediaId")?,
            required_number(args, "start")?,
            required_number(args, "duration")?,
            number(args, "trimStart", 0.0),
            visual(args)?,
        ),
        "add_audio" => studio.add_audio(
            text(args, "id"),
            required_text(args, "mediaId")?,
            required_number(args, "start")?,
            required_number(args, "duration")?,
            number(args, "volume", 1.0) as f32,
        ),
        "animate" => studio.animate(
            &required_text(args, "elementId")?,
            &required_text(args, "property")?,
            parse_keys(args.get("keys").unwrap_or(&Value::Null))?,
            parse_easing(args.get("easing").and_then(|v| v.as_str()))?,
        ),
        "element_delete" => studio.element_delete(&required_text(args, "elementId")?),
        "timeline" => studio.timeline(),
        "snapshot" => studio.snapshot(
            required_number(args, "at")?,
            &required_text(args, "path")?,
            number(args, "scale", 0.5) as f32,
        ),
        "render" => studio.render_video(
            &required_text(args, "path")?,
            args.get("duration").and_then(|v| v.as_f64()),
        ),
        "project_save" => studio.project_save(&required_text(args, "path")?),
        "project_load" => studio.project_load(&required_text(args, "path")?),
        other => Err(err(format!("unknown tool {other:?}"))),
    }
}
