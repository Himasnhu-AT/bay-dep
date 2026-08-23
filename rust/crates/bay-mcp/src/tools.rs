//! The MCP tool surface: JSON Schema declarations and argument decoding.
//!
//! Every tool's schema is written out longhand rather than derived, because the descriptions
//! are the entire user interface an agent gets. A field whose description says what units it
//! is in and what a good value looks like removes a whole round-trip of trial and error.

use bay_agent::plan::EASINGS;
use bay_project::{
    AudioRole, ElementRole, ElementSource, Framing, ShapeKind, StyleKit, TextDecorations,
    TextPlate, TextShadow, TextStroke, Tone, Transform,
};
use serde_json::{Value, json};

use crate::studio::{
    KitChoice, Studio, TextArgs, ToolError, ToolResult, VisualArgs, err, parse_align,
    parse_audio_role, parse_blend, parse_role, parse_tone,
};

/// Every move in the registry, for the `move` enum on the three tools that take one.
///
/// Read off the registry rather than written out, so the schema an agent reads and the table it
/// is validated against cannot drift — a move offered in an enum and rejected by the parser is a
/// tool call that fails for no reason the caller can see, which is exactly what the deleted
/// headless `parse_easing` did to six curves.
static MOVE_IDS: std::sync::LazyLock<Vec<&'static str>> =
    std::sync::LazyLock::new(bay_project::moves::ids);

/// The vocabulary in one line: what each move is and what channel carries it. The full entry —
/// including when each one is the wrong choice — comes from `apply_move` with no arguments,
/// which keeps the schema readable and the reasons available.
static MOVE_HELP: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    let listing = bay_project::moves::MOVES
        .iter()
        .map(|m| format!("{} ({}, {})", m.id, m.kind.as_str(), m.lead))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "A named move, which carries its own duration, curve and amplitude: {listing}. Call \
         apply_move with no arguments for what each one is for and when it is the wrong choice."
    )
});

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

fn text_decorations(value: &Value) -> Option<TextDecorations> {
    let stroke = value.get("stroke").and_then(|entry| {
        Some(TextStroke {
            width: entry.get("width")?.as_f64()? as f32,
            color: entry
                .get("color")
                .and_then(Value::as_str)
                .unwrap_or("#000000")
                .to_string(),
        })
    });
    let shadow = value.get("shadow").and_then(|entry| {
        Some(TextShadow {
            offset_x: entry.get("offsetX")?.as_f64()? as f32,
            offset_y: entry.get("offsetY")?.as_f64()? as f32,
            blur: entry.get("blur")?.as_f64()? as f32,
            color: entry
                .get("color")
                .and_then(Value::as_str)
                .unwrap_or("#00000099")
                .to_string(),
        })
    });
    let plate = value.get("plate").map(|entry| TextPlate {
        color: entry
            .get("color")
            .and_then(Value::as_str)
            .unwrap_or("#000000B3")
            .to_string(),
        padding_x: entry
            .get("paddingX")
            .and_then(Value::as_f64)
            .unwrap_or(16.0) as f32,
        padding_y: entry
            .get("paddingY")
            .and_then(Value::as_f64)
            .unwrap_or(10.0) as f32,
        radius: entry.get("radius").and_then(Value::as_f64).unwrap_or(12.0) as f32,
    });
    (stroke.is_some() || shadow.is_some() || plate.is_some()).then_some(TextDecorations {
        stroke,
        shadow,
        plate,
    })
}

/// The transform/blend block every visual tool accepts.
///
/// A named `framing` from the kit supplies the defaults when one is given, so "put it in the
/// lower third" is a word rather than four floats an agent copied out of a document. Anything
/// stated explicitly still wins — the framing is a starting point, not a cage.
fn visual(args: &Value, framing: Option<&Framing>) -> Result<VisualArgs, ToolError> {
    let (x, y, anchor_x, anchor_y, scale) = match framing {
        Some(f) => (f.x, f.y, f.anchor_x, f.anchor_y, f.scale),
        None => (0.5, 0.5, 0.5, 0.5, 1.0),
    };
    let transform = Transform {
        x: number(args, "x", f64::from(x)) as f32,
        y: number(args, "y", f64::from(y)) as f32,
        scale: number(args, "scale", f64::from(scale)) as f32,
        rotation: number(args, "rotation", 0.0) as f32,
        opacity: number(args, "opacity", 1.0) as f32,
        scale_x: number(args, "scaleX", 1.0) as f32,
        scale_y: number(args, "scaleY", 1.0) as f32,
        anchor_x: number(args, "anchorX", f64::from(anchor_x)) as f32,
        anchor_y: number(args, "anchorY", f64::from(anchor_y)) as f32,
        ..Transform::default()
    };
    Ok(VisualArgs {
        transform,
        blend_mode: parse_blend(args.get("blendMode").and_then(|v| v.as_str()))?,
    })
}

/// The style values that used to be arguments and are not any more.
///
/// Refusing them rather than ignoring them: an argument that is silently dropped teaches an
/// agent that it worked. The message names the role whose ramp entry decides the value instead,
/// with the number the committed kit actually gives it — so the correction is one call away and
/// the caller can see what it is getting.
fn reject_raw_style(
    args: &Value,
    tool: &str,
    kit: &StyleKit,
    role: ElementRole,
) -> Result<(), ToolError> {
    const DELETED: [(&str, &str); 4] = [
        ("fontSize", "size"),
        ("fontFamily", "typeface"),
        ("fontWeight", "weight"),
        ("color", "colour"),
    ];
    let style = kit.resolve(role, Tone::default_for(role));
    for (key, what) in DELETED {
        if args.get(key).is_some_and(|v| !v.is_null()) {
            return Err(err(format!(
                "{tool} does not take {key:?} any more — the {what} comes from the project's \
                 style kit ({}) through \"role\". role {:?} is set in {} {} at fontSize {:.0} in \
                 {}. Say what the element is FOR with \"role\", and how loud it is with \"tone\" \
                 (one of {:?}); call style_pick to change the kit, not the element.",
                kit.id,
                role.as_str(),
                style.family,
                style.weight,
                style.size,
                style.color,
                Tone::NAMES,
            )));
        }
    }
    Ok(())
}

/// The named framing a call asked for, if any. An unknown name is refused with the list rather
/// than silently falling back to the centre of the frame.
fn named_framing(args: &Value, kit: &StyleKit) -> Result<Option<Framing>, ToolError> {
    let Some(name) = text(args, "framing") else {
        return Ok(None);
    };
    kit.framing(&name).cloned().map(Some).ok_or_else(|| {
        err(format!(
            "the {:?} kit has no framing {name:?} — it declares {:?}",
            kit.id,
            kit.framing_names()
        ))
    })
}

/// The kit choice a tool was given, if it named one. `customKit` outranks `kit`, and a bare
/// brief is the normal path.
fn kit_choice(args: &Value) -> Result<Option<KitChoice>, ToolError> {
    if let Some(raw) = args.get("customKit").filter(|v| !v.is_null()) {
        let kit: StyleKit = serde_json::from_value(raw.clone()).map_err(|e| {
            err(format!(
                "customKit is not a style kit: {e}. It needs id, name, note, faces \
                 {{display, body, mono}} each with family+weight, ramp (a step per role), \
                 palette {{bg, surface, ink, dim, accent, accent2}} and at least 4 framings \
                 including one at y >= 0.60. Call style_pick with no arguments to see three \
                 worked examples of the shape."
            ))
        })?;
        return Ok(Some(KitChoice::Custom(Box::new(kit))));
    }
    if let Some(id) = text(args, "kit") {
        return Ok(Some(KitChoice::Named(id)));
    }
    Ok(None)
}

fn layer(args: &Value) -> usize {
    args.get("layer").and_then(|v| v.as_u64()).unwrap_or(0) as usize
}

/// The role on a tool that accepts one without insisting. Footage and stills carry a role so a
/// distribution can partition on it, but demanding one from `add_video` would be asking the
/// question twice for no new answer.
fn optional_role(args: &Value) -> Result<ElementRole, ToolError> {
    match args.get("role").and_then(|v| v.as_str()) {
        Some(name) => parse_role(Some(name), "this tool"),
        None => Ok(ElementRole::default()),
    }
}

/// Schema fragment for the shared placement fields, spliced into every visual tool.
fn visual_properties() -> Value {
    json!({
        "cover": { "type": "object",
            "description": "Fill a rectangle of the canvas instead of letterboxing inside it. \
                            Give it {width, height} as fractions of the canvas — the panel you \
                            want the picture to occupy — and bay crops the source to that shape \
                            and scales it to fit exactly. Without this a 16:9 photo on a 9:16 \
                            canvas fills about a third of the frame. It replaces cropping every \
                            image with ffmpeg before you import it." },
        "framing": { "type": "string",
            "description": "One of the committed kit's named framings — project_info and \
                 style_pick list them. It sets x, y, anchorX, anchorY and scale in one word; \
                 anything you also pass explicitly still wins. Every kit declares at least one \
                 bottom-weighted framing, which is the half of the frame the project this rule \
                 comes from never used at all." },
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

/// Schema fragment for naming a style kit, shared by `project_create` and `style_pick` so the
/// two cannot drift about what a kit is.
fn kit_properties() -> Value {
    json!({
        "brief": { "type": "string",
            "description": "What the video is about, in a sentence. Seeds which three kits are \
                 offered; the same brief on a different day draws a different set." },
        "kit": { "type": "string",
            "description": format!(
                "Commit to a named built-in kit: {:?}. Call style_pick with only a brief first \
                 to see what each one is for.",
                bay_project::builtin_kit_ids()
            ) },
        "customKit": { "type": "object",
            "description": "A whole style kit of your own, validated before it is accepted: \
                 three distinct families that resolve at the weights you name, a hero/body cap \
                 ratio of at least 4.0, an accent genuinely far from the ink, and at least four \
                 named framings including one at y >= 0.60. Deliberately more work than \
                 accepting an offer." }
    })
}

/// Schema fragment for the tone every drawn element carries.
///
/// This is the entire colour surface. `#rrggbb` is not reachable from a tool argument any more:
/// the project that prompted this used five colours across 188 elements, one of them lifted out
/// of a document that labels it as failing contrast, and the accent three times — never on the
/// thing that was the point.
fn tone_property() -> Value {
    json!({
        "tone": { "type": "string", "enum": Tone::NAMES,
            "description": "How loud this element is, against the project's committed style kit. \
                 ink = the loudest value, for the line that carries the beat. dim = secondary \
                 type: kickers, axis labels, units, source notes. accent = the point — scarce, \
                 one element per beat, and it must be on the thing that IS the argument. \
                 accent2 = the opposition: a second series, the down bar, the contrast case. \
                 surface = a plate or panel behind something else. Omit it and the role picks \
                 the right one." }
    })
}

/// Schema fragment for the role every visual element declares.
///
/// One fragment so the vocabulary cannot drift between the tools that require it and the ones
/// that merely accept it. `required` is where the difference lives, not here.
fn role_property(required: bool) -> Value {
    let tail = if required {
        "Required — say what the element is for, not what it looks like."
    } else {
        "Defaults to \"label\"."
    };
    json!({
        "role": { "type": "string", "enum": ElementRole::NAMES,
            "description": format!(
                "What this element is FOR. hook = the opening claim that earns the next two \
                 seconds. headline = the line a beat is built around. kicker = the small line \
                 framing a headline. label = names a thing (axis, value, source). caption = \
                 spoken words on screen (narrate sets this; you should not). lockup = the end \
                 card or sign-off. data = a bar, line or mark whose size or position IS the \
                 number. ground = background fills and plates. chrome = rules, borders, frame \
                 furniture. ground and chrome together are capped at a small share of a \
                 project, so do not label content as background to duck a rule. {tail}"
            ) }
    })
}

/// Schema fragment for caption styling, shared by every tool that puts captions on screen.
///
/// **Four fields where there were eleven.** The size, the colour, the family, the weight, the
/// layer, the fade and the three cue-timing floors were all arguments, and the project this comes
/// from set every one of them — producing 76 three-frame fades, 8 cues too short to read and 38
/// elements sharing one x. What a caption looks like is the kit's answer to `captionStyle`; how
/// long it stays up is a fact about reading. What is left is where it sits, which is the only
/// part that was never settable.
fn caption_properties() -> Value {
    json!({
        "captionStyle": { "type": "string", "enum": crate::narration::CaptionPreset::NAMES,
            "default": "plain",
            "description": "How loud the spoken word is on screen, against the project's style \
                 kit. quiet = a small supporting line, in the kit's label step and its quiet \
                 tone. plain = spoken words at the kit's caption step, in its ink — the default. \
                 loud = kinetic type, two words at a time at headline size, for when the words \
                 ARE the picture. There is no captionFontSize, captionColor, captionFontFamily \
                 or captionFontWeight: this is where they come from." },
        "captionX": { "type": "number",
            "description": "Horizontal position of the caption box, as a fraction of canvas \
                 width. Defaults to the kit's lower-third framing — which differs per kit, \
                 which is the point: every video bay had made until now put its captions at \
                 x = 0.08." },
        "captionY": { "type": "number",
            "description": "Top of the caption box as a fraction of canvas height. Defaults to \
                 the kit's lower-third framing, which clears the platform caption band." },
        "captionAlign": { "type": "string", "enum": ["left", "center", "right"],
            "description": "Defaults to whatever the kit's lower-third framing hangs off — left \
                 on a grid kit, centred on a centred one." }
    })
}

// The eleven caption arguments that used to exist are refused — not ignored — by
// `bay_agent::plan::reject_raw_caption_style`, which both transports go through.

/// The duck's own arguments, shared by `duck` and by `audio_set`'s `duckUnder`.
///
/// Three of these are a mix decision and the rest are the shape of a duck, with bounds rather
/// than freedom: outside them the automation is audible as automation. The tool refuses a value
/// past a bound and says which bound, because "the release must be slower than the attack" is
/// something an author can act on and a slightly-wrong number is not something they can hear
/// until the file is posted.
fn duck_properties() -> Value {
    json!({
        "depthDb": { "type": "number", "default": 8.0, "minimum": 3.0, "maximum": 24.0,
            "description": "How far the bed drops under a line, in dB. 8 dB is the house value: it takes a bed from about -22 to -30 LUFS-S, which is the difference between the two states that gives a narrated mix its contour. Under 3 dB nobody hears it; over about 14 dB the music disappears rather than making room." },
        "attackMs": { "type": "number", "default": 150.0, "minimum": 60.0, "maximum": 400.0,
            "description": "How long the drop takes. Under 60 ms it pumps audibly; over 400 ms it masks the first syllable." },
        "releaseMs": { "type": "number", "default": 500.0, "minimum": 200.0,
            "description": "How long the recovery takes. Must be longer than the attack — the asymmetry (150 ms down, 500 ms up) is the whole mechanism that makes a duck inaudible, and a release faster than the attack is a pump." },
        "preRollMs": { "type": "number", "default": 250.0,
            "description": "How far before the first word the drop starts. A duck that begins ON the word is heard as a level jump." },
        "holdMs": { "type": "number", "default": 150.0,
            "description": "How long the bed stays down past the end of a line. Releasing on the final consonant clips the tail of the sentence." },
        "joinGapMs": { "type": "number", "default": 1500.0,
            "description": "Two lines closer together than this are ducked as one. A bed that recovers and re-ducks inside a second and a half breathes." }
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

/// Run a job tool on the headless transport and answer with a job id.
///
/// The **contract** is the same as the attached path: the caller gets `{job, ...}` and polls
/// `job_status`. The **timing** is not, and deliberately so.
///
/// The headless server owns its `Studio` and stays single-threaded on purpose — one GPU device
/// and one project mean concurrent calls would need a lock around everything anyway
/// (`server.rs`). `narrate` and `subtitles_to_video` mutate that document, so running them on a
/// worker would either race the next request or need the result posted back and applied between
/// requests. Doing the work here and handing back an already-finished job keeps one contract for
/// agents without unpicking that invariant.
///
/// It also costs nothing that matters: the 20-second ceiling this whole change is about only
/// ever existed on the attached transport. A headless call has always been free to take minutes.
fn headless_job(kind: &str, label: &str, work: impl FnOnce() -> ToolResult) -> ToolResult {
    let handle = bay_jobs::start(kind, label, bay_jobs::Unit::Steps, 0);
    let outcome = work();
    let id = handle.id();
    match &outcome {
        Ok(value) => bay_jobs::finish(&handle, Ok(value.clone())),
        Err(error) => bay_jobs::finish(&handle, Err(error.to_string())),
    }
    // The result is inlined as well as stored. A caller that polls gets the same thing; a caller
    // that does not has still been told what happened, rather than being made to ask for an
    // answer that is already sitting there.
    match outcome {
        Ok(value) => Ok(json!({
            "job": id,
            "status": "finished",
            "finished": true,
            "result": value,
            "message": format!(
                "{kind} finished. Poll job_status with job {id} for the same result, or read \
                 the result field here."
            ),
        })),
        Err(error) => Err(error),
    }
}

/// Start a headless render on an owned project snapshot and return before encoding begins.
///
/// Unlike narration, render has no document follow-up: its only output is a file. That makes it
/// safe to run concurrently with the single-writer headless studio, and means the advertised job
/// contract can be real rather than a finished job id handed back after a two-minute encode.
fn background_job(
    kind: &str,
    label: &str,
    unit: bay_jobs::Unit,
    total: u64,
    work: impl FnOnce(bay_jobs::Handle) -> Result<Value, String> + Send + 'static,
) -> ToolResult {
    let handle = bay_jobs::start(kind, label, unit, total);
    let id = handle.id();
    let worker_handle = handle.clone();
    let spawn = std::thread::Builder::new()
        .name(format!("bay-{kind}-{id}"))
        .spawn(move || {
            let outcome = work(worker_handle.clone());
            bay_jobs::finish(&worker_handle, outcome);
        });
    if let Err(error) = spawn {
        let message = format!("could not start the {kind} worker: {error}");
        bay_jobs::finish(&handle, Err(message.clone()));
        return Err(err(message));
    }
    Ok(json!({
        "job": id,
        "status": "started",
        "finished": false,
        "message": format!(
            "{kind} is running in the background — poll job_status with job {id} until \
             finished is true"
        ),
    }))
}

fn headless_render_job(studio: &Studio, args: &Value) -> ToolResult {
    // Preserve the attached transport's useful failure mode: model-gate refusals and malformed
    // ranges come back immediately, before a caller starts polling a doomed job.
    bay_agent::slow::render_stamp(studio.project(), args).map_err(err)?;
    let label = required_text(args, "path")?;
    let context = studio.slow_context();
    let arguments = args.clone();
    background_job("render", &label, bay_jobs::Unit::Frames, 0, move |handle| {
        bay_agent::slow::run("render", &arguments, &context, Some(&handle)).and_then(|result| {
            if !matches!(result.follow_up, bay_agent::slow::FollowUp::None) {
                return Err("a render unexpectedly requested a document follow-up".into());
            }
            Ok(result.value)
        })
    })
}

/// The components `runtime_install` will accept, read from the manifest rather than listed here.
///
/// This was a hardcoded `["video", "speech"]`, and by the time `sfx` shipped the list had
/// already drifted: the component existed, the installer handled it, and no agent could ask for
/// it because the schema said it was not a legal value. Deriving it means adding a component to
/// the manifest is the whole change.
fn installable_components() -> Vec<&'static str> {
    bay_provision::Manifest::embedded()
        .components
        .iter()
        .map(|component| component.id.as_str())
        .collect()
}

/// What each component is and roughly what it costs, from the manifest's own words.
fn installable_detail() -> String {
    bay_provision::Manifest::embedded()
        .components
        .iter()
        .map(|component| {
            format!(
                "{} (~{} MB) = {}",
                component.id,
                component.disk_bytes / 1_000_000,
                component.detail
            )
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Fold a `cover` request into the transform: crop the source to the panel, scale to fill it.
///
/// Silently does nothing without a `cover` argument, and does nothing when the asset was never
/// probed — a source of unknown size cannot be cropped to a shape, and guessing one would put a
/// wrong crop on the element permanently.
fn apply_cover(
    studio: &Studio,
    media_id: &str,
    args: &Value,
    visual: &mut crate::studio::VisualArgs,
) {
    let Some(cover) = args.get("cover").filter(|v| v.is_object()) else {
        return;
    };
    let panel_w = cover.get("width").and_then(Value::as_f64).unwrap_or(1.0) as f32;
    let panel_h = cover.get("height").and_then(Value::as_f64).unwrap_or(1.0) as f32;
    let (canvas_w, canvas_h) = studio.canvas();
    let (left, top, right, bottom, scale) = bay_preview::cover_fit(
        studio.media_size(media_id),
        panel_w,
        panel_h,
        canvas_w,
        canvas_h,
    );
    visual.transform.crop_left = left;
    visual.transform.crop_top = top;
    visual.transform.crop_right = right;
    visual.transform.crop_bottom = bottom;
    // An explicit `scale` still wins: the caller asked for a number and should get it.
    if args.get("scale").is_none() {
        visual.transform.scale = scale;
    }
}

/// `silence_detect` — the dead air in a recording, and the shape of the edit that removes it.
fn silence_detect(studio: &Studio, args: &Value) -> Result<Value, ToolError> {
    let path = source_path(studio, args)?;
    let options = bay_audio::silence::Options {
        threshold_db: args.get("thresholdDb").and_then(Value::as_f64),
        minimum_seconds: number(args, "minimumSeconds", 0.5),
        pad_seconds: number(args, "padSeconds", 0.08),
    };
    let pcm = bay_audio::decode_pcm(&path, 16000).ok_or_else(|| {
        crate::studio::err(format!(
            "could not read audio from {path}. Decoding needs ffmpeg — runtime_install with \
             component \"video\" installs it."
        ))
    })?;
    let scan = bay_audio::silence::detect(&pcm, options)
        .ok_or_else(|| crate::studio::err(format!("{path} has no audio to measure")))?;

    let keeps: Vec<Value> = scan
        .keep_ranges()
        .into_iter()
        .map(|(start, end)| {
            json!({ "startSeconds": start, "endSeconds": end,
                                    "durationSeconds": (end - start * 1.0).max(0.0) })
        })
        .collect();
    let mut value = serde_json::to_value(&scan).unwrap_or(Value::Null);
    value["keepRanges"] = json!(keeps);
    value["tightenedSeconds"] = json!(scan.tightened_seconds());
    value["hint"] = json!(
        "keepRanges is the edit: one trimmed clip per range, butted together. Look at \
         removableShare first — much over a third and the threshold is eating speech."
    );
    Ok(value)
}

/// An imported `mediaId` or a bare `path`, for the tools that only read a file.
fn source_path(studio: &Studio, args: &Value) -> Result<String, ToolError> {
    match text(args, "mediaId") {
        Some(id) => studio.media_path(&id).ok_or_else(|| {
            crate::studio::err(format!(
                "no media with id {id:?} — media_import returns the id, or pass `path` instead"
            ))
        }),
        None => required_text(args, "path"),
    }
}

/// `audio_beats` — the tempo of a file, so a cut can land on it.
///
/// Takes an imported `mediaId` or a bare `path`; the first is what an author already has, the
/// second is for a track that is not on the timeline yet.
fn audio_beats(studio: &Studio, args: &Value) -> Result<Value, ToolError> {
    let path = source_path(studio, args)?;
    let beats = bay_audio::beats::detect_file(&path).ok_or_else(|| {
        crate::studio::err(format!(
            "could not read audio from {path}. Decoding needs ffmpeg — runtime_status says \
             whether it is installed, and runtime_install with component \"video\" installs it."
        ))
    })?;
    let mut value = serde_json::to_value(&beats).unwrap_or(Value::Null);
    if let Some(n) = args.get("everyNthBeat").and_then(Value::as_u64) {
        value["everyNthBeat"] = json!(n);
        value["cutTimes"] = json!(beats.every(n as usize));
    }
    value["usable"] = json!(beats.is_usable());
    value["hint"] = json!(if beats.is_usable() {
        "cut on these. `candidates` shows the other readings — if the last cut is meant to land \
         on the last beat, check the total against the track length before committing."
    } else {
        "there is no usable pulse here — this grid is arithmetic rather than music. Place the \
         cuts by hand."
    });
    Ok(value)
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
            "Start a new, empty project. Call this first. Clears anything already on the \
             timeline. A vertical social reel is 1080x1920 at 30fps.\n\nIt also commits the \
             project to a STYLE KIT — the typefaces, type ramp, palette and framings every \
             element afterwards is drawn with. Pass `brief` (what the video is about) and bay \
             picks one, seeded by the brief and today's date and stepping over the last five \
             kits this machine used, so the same subject a week later does not come out looking \
             the same. Pass `kit` to name one outright, or `customKit` to declare your own \
             (validated, and strictly more work than taking an offer). The response names the \
             two alternatives it did not pick.",
            merge(
                json!({
                    "name": { "type": "string", "default": "Untitled" },
                    "width": { "type": "integer", "default": 1080 },
                    "height": { "type": "integer", "default": 1920 },
                    "fps": { "type": "integer", "default": 30 },
                    "background": { "type": "string",
                        "description": "Canvas fill as #rrggbb. Defaults to the chosen kit's \
                             ground, which is what you want — a background picked apart from the \
                             palette is reported as an off-token value." }
                }),
                kit_properties(),
            ),
            &[],
        ),
        tool(
            "style_pick",
            "Choose the project's STYLE KIT: three typefaces (display, body, mono), a type ramp \
             that maps each element role to a size, a six-colour palette, and at least four \
             named framings.\n\nCall it with a `brief` and nothing else to be offered three kits \
             that suit it — seeded by the brief and today's date, and excluding the last five \
             this machine committed. Call it again with `kit` to commit one. `add_text` and \
             `add_shape` have no fontFamily, fontSize, fontWeight or color: this is where those \
             values come from.",
            merge(
                json!({
                    "brief": { "type": "string",
                        "description": "What the video is about, in a sentence. It seeds the \
                             offer, so a different subject draws different kits." }
                }),
                kit_properties(),
            ),
            &[],
        ),
        tool(
            "project_info",
            "Canvas size, fps, timeline duration and element counts for the current project. \
             `motionSignatures` groups elements by the DISTINCT SET of named moves they use; it \
             is not an occurrence count, so thirty non-overlapping nudges on one element still \
             read as the single signature `nudge`.",
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
             dimensions. Returns a mediaId to pass to add_image / add_video / add_audio.\n\nAn \
             audio file is also measured: `loudness` comes back with `lufs`, `peakDb`, `rmsDb` \
             and `accentSeconds`. Read it before choosing a level — `volume` is a multiplier and \
             says nothing about how loud a clip will be, and two files that both sound fine on \
             their own can differ by 15 dB. Pass `mediaId` instead of `path` to re-measure \
             something already imported.\n\nFor accepted gen_image/gen_video/gen_music output, \
             pass its generationReceipt. Bay re-hashes the file against its local receipt before \
             stamping generated provenance; caller-written provenance is never trusted.",
            json!({
                "path": { "type": "string", "description": "Path to the file on disk." },
                "id": { "type": "string", "description": "Optional explicit media id." },
                "generationReceipt": { "type": "string",
                    "description": "requestHash from an accepted generation. Verified against the file bytes before provenance is stored." },
                "mediaId": { "type": "string",
                    "description": "Measure an asset that is already in the project instead of importing a new one. Same answer as audio_probe." }
            }),
            &[],
        ),
        tool(
            "audio_probe",
            "Measure an imported sound: `lufs` (EBU R128 integrated loudness — the unit a mix is \
             specified in), `peakDb`, `rmsDb`, and `accentSeconds` (where its transients are, \
             for landing a cut on the music). Cached on the asset at import, so this is only \
             needed for a file that was imported before the measurement existed.\n\nWhy it \
             matters: a bed at `volume: 2.0` against a file that integrates to -35 LUFS is \
             still 9 LU too quiet, and no gain number can tell you that. Speech wants to sit \
             about 9-14 LU above the bed while it is talking.",
            json!({
                "mediaId": { "type": "string", "description": "An id from media_import." }
            }),
            &["mediaId"],
        ),
        tool(
            "add_text",
            "Place a text element on the timeline.\n\nThere is no fontFamily, fontSize, \
             fontWeight or color here, on purpose: say what the line is FOR with `role` and how \
             loud it is with `tone`, and the project's committed style kit answers the rest. A \
             hook and a headline come out at hero and headline size in the kit's display face; a \
             kicker comes out small, tracked out, in its mono voice. Read project_info to see \
             the ramp you are drawing against. The response includes measured `textLayout` \
             glyph-ink bounds. Read its height after every placement: for text, `scale` is the \
             wrap box, not the font size, so narrowing it can add lines.",
            merge(
                json!({
                    "start": { "type": "number", "description": "Timeline start, in seconds." },
                    "duration": { "type": "number", "description": "How long it stays on screen, in seconds." },
                    "content": { "type": "string", "description": "The text. Use \\n for line breaks." },
                    "align": { "type": "string", "enum": ["left", "center", "right"], "default": "left" },
                    "letterSpacing": { "type": "number",
                        "description": "Tracking in em, overriding the kit's ramp for this role. Rarely needed — the ramp already opens up an uppercase kicker and tightens display type." },
                    "lineHeight": { "type": "number", "description": "Multiple of the font size, overriding the kit's ramp for this role." },
                    "stroke": { "type": "object", "properties": {
                        "width": { "type": "number", "minimum": 0 },
                        "color": { "type": "string", "default": "#000000" }
                    }, "required": ["width"] },
                    "shadow": { "type": "object", "properties": {
                        "offsetX": { "type": "number" }, "offsetY": { "type": "number" },
                        "blur": { "type": "number", "minimum": 0 },
                        "color": { "type": "string", "default": "#00000099" }
                    }, "required": ["offsetX", "offsetY", "blur"] },
                    "plate": { "type": "object", "properties": {
                        "color": { "type": "string", "default": "#000000B3" },
                        "paddingX": { "type": "number", "default": 16 },
                        "paddingY": { "type": "number", "default": 10 },
                        "radius": { "type": "number", "default": 12 }
                    } },
                    "id": { "type": "string", "description": "Optional explicit element id, for animating it later. Ids of the form caption-<number> are reserved for narrate and the subtitle tools." }
                }),
                merge(
                    merge(visual_properties(), role_property(true)),
                    tone_property(),
                ),
            ),
            &["start", "duration", "content", "role"],
        ),
        tool(
            "add_shape",
            "Place a solid rectangle or ellipse: bars, rules, dots, panels, underlines. To make \
             a bar chart, set anchorX to 0 and animate scaleX from 0 to its final value.\n\nThe \
             fill comes from `tone` against the project's style kit — a data mark takes the \
             accent, a plate takes the surface colour, which is the one that sits far enough \
             above the ground to actually be seen.",
            merge(
                json!({
                    "start": { "type": "number" },
                    "duration": { "type": "number" },
                    "shape": { "type": "string", "enum": ["rect", "ellipse"], "default": "rect" },
                    "radius": { "type": "number", "default": 0.0,
                        "description": "Corner radius for a rect, as a fraction of its shorter side. 0 is square, 0.5 is a fully rounded pill." },
                    "id": { "type": "string" }
                }),
                merge(
                    merge(visual_properties(), role_property(true)),
                    tone_property(),
                ),
            ),
            &["start", "duration", "role"],
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
                merge(visual_properties(), role_property(false)),
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
                    "speed": { "type": "number", "default": 1.0, "exclusiveMinimum": 0,
                        "description": "Constant playback speed. 2.0 is twice as fast; 0.5 is half speed." },
                    "id": { "type": "string" }
                }),
                merge(visual_properties(), role_property(false)),
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
                "trimStart": { "type": "number", "default": 0.0,
                    "description": "Seconds to skip from the head of the file — start a music bed at the drop rather than at bar one." },
                "speed": { "type": "number", "default": 1.0, "exclusiveMinimum": 0,
                    "description": "Constant playback speed with pitch-preserving time stretch." },
                "role": { "type": "string", "enum": AudioRole::NAMES, "default": "bed",
                    "description": "What this sound is doing: \"speech\" is narration or dialogue (narrate sets this itself), \"bed\" is music under the picture, \"sfx\" is a one-off effect. The bed is what a duck is measured against, so a voice-over placed by hand should say so." },
                "id": { "type": "string" }
            }),
            &["mediaId", "start", "duration"],
        ),
        tool(
            "group_create",
            "Parent several visual elements to one transform. Child scale and opacity multiply \
             with the group; rotation adds; position is transformed around the group's anchor. \
             Animate the returned group id with animate; group keyframe times are absolute scene \
             time rather than relative to any child.",
            merge(
                json!({
                    "id": { "type": "string", "description": "Optional group id." },
                    "elementIds": { "type": "array", "minItems": 1,
                        "items": { "type": "string" },
                        "description": "Visual element ids. An element may belong to one group." }
                }),
                visual_properties(),
            ),
            &["elementIds"],
        ),
        tool(
            "element_retime",
            "Change a video or audio clip's constant playback speed. Video can also hold one \
             source frame for a timeline duration; the hold does not consume source time. \
             Reverse playback is deliberately not offered because streamed decode cannot do it \
             without an expensive seek/cache strategy.",
            json!({
                "elementId": { "type": "string" },
                "speed": { "type": "number", "default": 1.0, "exclusiveMinimum": 0 },
                "freezeAt": { "type": "number", "minimum": 0,
                    "description": "Video only: seconds after the element starts where the frame hold begins." },
                "freezeDuration": { "type": "number", "exclusiveMinimum": 0,
                    "description": "Video only: timeline seconds to hold that frame." }
            }),
            &["elementId"],
        ),
        tool(
            "apply_move",
            "Put a NAMED MOVE from bay's vocabulary on an element. Call it with no arguments to \
             see the whole registry — each move says what it is for and when it is the wrong \
             choice. A move carries its own duration, curve and amplitude, all of them chosen \
             together: the same nominal duration on two different curves gives the eye wildly \
             different amounts of visible motion, and that arithmetic has already happened here. \
             Prefer this to hand-written keys. A move appends only when its `at` starts after the \
             existing channel ends; overlapping calls replace that channel. The response says \
             `added`, `appended`, or `replaced-overlap` for every channel.",
            json!({
                "elementId": { "type": "string" },
                "move": { "type": "string", "enum": MOVE_IDS.as_slice(), "description": MOVE_HELP.as_str() },
                "at": { "type": "number", "default": 0.0, "description": "Seconds after the ELEMENT's start that the move begins. An exit goes at (duration - the move's own length); an entrance goes at 0." },
                "direction": { "type": "string", "enum": bay_project::Direction::NAMES,
                    "description": "The way the element TRAVELS — not where it came from. Only the directions a move declares are legal; anything else is refused by name." },
                "distance": { "type": "number", "default": 1.0, "minimum": 0.25, "maximum": 4.0,
                    "description": "A multiplier on the move's own amplitude, NOT a number of pixels. 1.0 is the tabled travel, which is right for most elements; scale it up for something physically large." }
            }),
            &[],
        ),
        tool(
            "animate",
            "Give an element motion. Two ways in: pass `move` to use a named move from bay's \
             vocabulary (call apply_move with no arguments to list them) — which is what you \
             should normally do, because a move carries a duration and a curve that were chosen \
             together — or pass `property` and `keys` to write keyframes by hand. Hand-written \
             keys are legal and are reported per channel as \"off-vocabulary-motion\", so use \
             them for something the vocabulary does not have rather than as a default. Keyframe \
             times are relative to the ELEMENT's start, not the timeline's. Named moves append \
             only after the existing channel ends; repeating the same move at the same `at` \
             replaces its overlapping keys, and the response reports that merge decision.",
            json!({
                "elementId": { "type": "string" },
                "move": { "type": "string", "enum": MOVE_IDS.as_slice(), "description": MOVE_HELP.as_str() },
                "direction": { "type": "string", "enum": bay_project::Direction::NAMES,
                    "description": "With `move`: the way the element TRAVELS. Only the directions that move declares are legal." },
                "distance": { "type": "number", "default": 1.0, "minimum": 0.25, "maximum": 4.0,
                    "description": "With `move`: a multiplier on the move's own amplitude, not a number of pixels." },
                "property": { "type": "string",
                    "description": "Hand-keyed only. Transform channels are opacity/scale/x/y/rotation/scaleX/scaleY; audio takes volume; masks take mask.x/mask.y/mask.width/mask.height/mask.feather; effect params take effect.<effectId>.<param>. When elementId names a group, transform-channel key times are ABSOLUTE scene time." },
                "keys": {
                    "type": "array",
                    "description": "Hand-keyed only: at least two keyframes, e.g. [{\"t\":0,\"value\":0},{\"t\":0.5,\"value\":1}]. A value-changing segment shorter than about 7 frames is over before the eye can arrive — it is received as a cut, not as motion.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "t": { "type": "number", "description": "Seconds after the element starts." },
                            "value": { "type": "number" },
                            "easing": { "type": "string", "enum": EASINGS,
                                "description": "The curve for the segment LEAVING this key, overriding the channel's. This is how one property arrives fast, holds, then leaves slowly — which a single channel-wide easing cannot express." }
                        },
                        "required": ["t", "value"]
                    }
                },
                "at": { "type": "number", "default": 0.0, "description": "With `move`: seconds after the element's start that it begins." },
                "easing": { "type": "string",
                    "enum": EASINGS,
                    "default": "linear",
                    "description": "Hand-keyed only — the channel default. spring-out is a damped settle with no overshoot. power-out and expo-out are the other entrances; power-in/power4-in are exits; back-out overshoots and is a rare deliberate choice, not a default; hold is a hard cut, and putting one on a segment where nothing changes states no intent and buys no variety." }
            }),
            &["elementId"],
        ),
        tool(
            "animate_many",
            "Run ONE move across MANY elements, staggered — the verb for kinetic type, list \
             reveals, and any group arrival. Three ways in: `move` names a group move from the \
             vocabulary and brings its own stagger; `by` moves every element a DELTA from \
             wherever it already rests, appending to the animation it already has; `from`/`to` \
             are absolute and shared. Reach for `by` when what is already on screen has to \
             respond to something arriving — with absolute values that means rewriting every \
             incumbent's whole key list, which is the cost that makes a crossfade win instead.",
            json!({
                "elementIds": { "type": "array", "items": { "type": "string" },
                    "description": "In the order they should arrive — which is reading order for a headline, and order of IMPORTANCE for a group, since whatever moves first reads as most important." },
                "move": { "type": "string", "enum": MOVE_IDS.as_slice(),
                    "description": "A named move across the whole group. cascade, wave and counter-cascade bring their own stagger and decay; counter-cascade alternates sides between neighbours, which satisfies entrance-direction diversity by construction." },
                "direction": { "type": "string", "enum": bay_project::Direction::NAMES },
                "distance": { "type": "number", "default": 1.0, "minimum": 0.25, "maximum": 4.0 },
                "property": { "type": "string",
                    "enum": ["opacity", "scale", "x", "y", "rotation", "scaleX", "scaleY", "volume"] },
                "by": { "type": "number",
                    "description": "A DELTA from where each element currently rests, in the channel's own units. Appends to the element's existing animation rather than replacing it, so an incumbent keeps the entrance it came in on. This is how a stack opens a slot for an arrival." },
                "from": { "type": "number", "description": "Absolute: the value every element holds until its cue." },
                "to": { "type": "number", "description": "Absolute: where every element ends up." },
                "duration": { "type": "number", "default": 0.5, "description": "Seconds each element takes to travel. Entrances want longer than exits." },
                "at": { "type": "number", "default": 0.0, "description": "Seconds after the element's start that the FIRST one begins. Landing a reveal on a beat means starting it at (beat - duration), not at the beat." },
                "stagger": { "type": "number", "default": 0.06,
                    "description": "Seconds between successive cues. For a group arrival that should read as ONE beat, keep items x stagger under ~0.5s. A reveal deliberately paced to narration is the other case, and may run much longer. With `move`, the move's own stagger is the default." },
                "decay": { "type": "number", "default": 1.0,
                    "description": "Multiplier on each successive gap. 0.84 makes a cascade accelerate across a line; 1.0 keeps it even. Shrinking gaps are what make a word cascade read as a wave rather than a conveyor belt." },
                "easing": { "type": "string", "enum": EASINGS, "default": "linear" }
            }),
            &["elementIds"],
        ),
        tool(
            "element_delete",
            "Remove an element from the timeline by id.",
            json!({ "elementId": { "type": "string" } }),
            &["elementId"],
        ),
        tool(
            "element_move",
            "Slide a clip along the timeline. This changes WHEN it plays and nothing about \
             WHAT it plays — use element_trim to change its edges, element_source to change \
             which part of the footage it shows.",
            json!({
                "elementId": { "type": "string" },
                "start": { "type": "number", "description": "New timeline start, in seconds." }
            }),
            &["elementId", "start"],
        ),
        tool(
            "element_trim",
            "Trim a clip's edges. For video and audio this is a real trim: moving the head \
             forward eats the same amount of footage, so the frame under the new edge is the \
             frame that was already there. Both edges stop at the ends of the file — a trim \
             that would run off is shortened to fit. Give either edge on its own.",
            json!({
                "elementId": { "type": "string" },
                "start": { "type": "number", "description": "New timeline start in seconds. Omit to leave the head where it is." },
                "duration": { "type": "number", "description": "New length in seconds. Omit to leave the tail where it is." }
            }),
            &["elementId"],
        ),
        tool(
            "element_split",
            "Cut a clip in two at a timeline position. The second half picks up in the footage \
             exactly where the first stops, so this is a cut rather than a copy. Returns the \
             new element's id.",
            json!({
                "elementId": { "type": "string" },
                "at": { "type": "number", "description": "Timeline position of the cut, in seconds. Must fall inside the clip." },
                "newId": { "type": "string", "description": "Id for the second half. Minted if omitted." }
            }),
            &["elementId", "at"],
        ),
        tool(
            "element_source",
            "Slip: change WHICH part of a video or audio file a clip plays, keeping it exactly \
             where it is on the timeline and exactly as long. This is how you start a music bed \
             at the drop, or move past a bad first second of a take. Clamped so the clip stays \
             inside the file.",
            json!({
                "elementId": { "type": "string" },
                "trimStart": { "type": "number", "description": "Seconds into the source file where the clip should begin." }
            }),
            &["elementId", "trimStart"],
        ),
        tool(
            "element_duplicate",
            "Copy a clip, effects and animation included, placed right after it.",
            json!({
                "elementId": { "type": "string" },
                "newId": { "type": "string" }
            }),
            &["elementId"],
        ),
        tool(
            "element_rename",
            "Rename an element. Labels show on the timeline; the id is what tools address.",
            json!({
                "elementId": { "type": "string" },
                "name": { "type": "string" }
            }),
            &["elementId", "name"],
        ),
        tool(
            "transform_set",
            "Reposition, scale, rotate or fade an element already on the timeline. Give only \
             the fields you want to change — the rest keep their current values, so nudging y \
             does not reset a scale you set earlier. This is what to reach for after a snapshot \
             shows something in the wrong place. When the element is text, the response includes \
             the same measured `textLayout` as add_text; changing `scale` changes its wrap box.",
            json!({
                "elementId": { "type": "string" },
                "x": { "type": "number", "description": "Anchor position across the canvas, 0..1." },
                "y": { "type": "number", "description": "Anchor position down the canvas, 0..1." },
                "scale": { "type": "number", "description": "Fraction of the canvas the element spans." },
                "scaleX": { "type": "number" },
                "scaleY": { "type": "number" },
                "rotation": { "type": "number", "description": "Degrees." },
                "opacity": { "type": "number", "description": "0 is invisible, 1 is solid." },
                "anchorX": { "type": "number", "description": "Which point of the layer sits at (x,y). 0.5 is its centre." },
                "anchorY": { "type": "number" }
            }),
            &["elementId"],
        ),
        tool(
            "text_update",
            "Change a title's words, or what it is for, in place — keeping its id, position and \
             animation. Give only what changes.\n\nChanging `role` or `tone` re-resolves the \
             line against the project's style kit, which is how a label is promoted to a \
             headline. There is no fontFamily, fontSize, fontWeight or color: those come from \
             the kit. The response includes the same measured `textLayout` as add_text, so the \
             resulting wraps and glyph-ink bounds are visible without rendering a frame.",
            merge(
                json!({
                    "elementId": { "type": "string" },
                    "content": { "type": "string" },
                    "align": { "type": "string", "enum": ["left", "center", "right"] },
                    "letterSpacing": { "type": "number", "description": "Tracking in em, overriding the kit's. Negative tightens." },
                    "lineHeight": { "type": "number", "description": "Multiple of the font size, overriding the kit's." }
                }),
                merge(role_property(false), tone_property()),
            ),
            &["elementId"],
        ),
        tool(
            "effect_add",
            "Add a picture effect to a clip. Returns the effect id, which effect_set and \
             effect_remove take. `amount` is the usual parameter: 1.0 is unchanged for the \
             colour adjustments, sigma in pixels for blur, and how much of the grade to apply \
             for a lut.",
            json!({
                "elementId": { "type": "string" },
                "type": { "type": "string", "enum": ["brightness", "contrast", "saturation", "blur", "lut"] },
                "look": { "type": "string",
                    "description": "A built-in grade by id — call looks_list first. Generated on the machine, so there is nothing to download and nothing to go missing." },
                "lut": { "type": "string",
                    "description": "Path to a .cube file, required when type is \"lut\". A LUT is a whole grade in one pass — the same look lands identically on every clip you attach it to, which is how a set of shots comes to look like one film. Checked when attached, so a bad path is an error here rather than a clip that quietly looks untouched." },
                "params": {
                    "type": "object",
                    "description": "Scalar parameters, e.g. {\"amount\": 0.4}. Effect-specific.",
                },
                "effectId": { "type": "string", "description": "Minted if omitted." }
            }),
            &["elementId", "type"],
        ),
        tool(
            "effect_set",
            "Retune an effect that is already on a clip, or switch it off without removing it.",
            json!({
                "elementId": { "type": "string" },
                "effectId": { "type": "string" },
                "params": { "type": "object", "description": "Parameters to change; others keep their values." },
                "enabled": { "type": "boolean" }
            }),
            &["elementId", "effectId"],
        ),
        tool(
            "effect_remove",
            "Take an effect off a clip.",
            json!({
                "elementId": { "type": "string" },
                "effectId": { "type": "string" }
            }),
            &["elementId", "effectId"],
        ),
        tool(
            "blend_set",
            "Change how a clip composites over what is under it.",
            json!({
                "elementId": { "type": "string" },
                "mode": { "type": "string",
                    "description": "normal, multiply, screen, overlay, softLight, difference, luminosity, … — 17 in all, named as in the project format." }
            }),
            &["elementId", "mode"],
        ),
        tool(
            "audio_set",
            "Change an audio clip's level, mute it, or move its in-point — and duck it under \
             the lines it plays behind. Pass `duckUnder` (the same thing the `duck` tool does, \
             on the clip named by elementId) and bay writes the volume keyframes itself. Never \
             cut a bed into pieces with stepped gains to fake a duck: that is a cliff at every \
             seam, it cannot be adjusted afterwards, and it is what this replaces.",
            merge(
                json!({
                    "elementId": { "type": "string" },
                    "volume": { "type": "number", "description": "Linear gain, 0–4. 1.0 is unity. It is a multiplier, not a level: call audio_probe to see how loud the file itself is." },
                    "muted": { "type": "boolean" },
                    "trimStart": { "type": "number", "description": "Seconds into the file where the clip should start." },
                    "duckUnder": { "type": "array", "items": { "type": "string" },
                        "description": "Element ids this clip should get out of the way of. An empty array means every speech clip on the timeline, which is usually what you want. Volume set in the same call is applied first, so the duck comes back up to the new level." }
                }),
                duck_properties(),
            ),
            &["elementId"],
        ),
        tool(
            "duck",
            "Duck a music bed under narration: four volume keyframes per line, on ONE clip.\n\n\
             You give the three numbers that are a mix decision — depth, attack, release. Where \
             the lines ARE is something bay already knows, so it derives the times; lines closer \
             together than `joinGapMs` are ducked as one rather than letting the bed surge back \
             between them. Returns the keys it wrote, so you can read the curve and change it \
             with one argument instead of re-cutting anything.\n\nA bed 8 dB down under speech \
             and back up between lines is what gives a narrated video its contour. The failure \
             this replaces was one music file cut into 13 clips with stepped gains, which ran \
             the duck backwards for 61 seconds without anything noticing.",
            merge(
                json!({
                    "bedId": { "type": "string", "description": "The clip to duck — the music, not the voice." },
                    "underIds": { "type": "array", "items": { "type": "string" },
                        "description": "The clips it must get out of the way of. Omit for every speech clip on the timeline (narrate marks its own output as speech)." }
                }),
                duck_properties(),
            ),
            &["bedId"],
        ),
        tool(
            "fade_set",
            "Fade a clip up at its head and down at its tail. On picture this fades opacity, \
             on audio it fades level — the same field, so a shot and its sound fade together. \
             Use this for the fade-from-black that opens a film and the fade-to-black that \
             ends it, and for easing a music bed in and out. 0 removes a fade.",
            json!({
                "elementId": { "type": "string" },
                "fadeIn": { "type": "number", "description": "Seconds to fade up at the start." },
                "fadeOut": { "type": "number", "description": "Seconds to fade down at the end." }
            }),
            &["elementId"],
        ),
        tool(
            "transition_add",
            "Cross-dissolve between two clips on the same lane. They must already overlap by \
             at least the transition's length — the overlap IS the dissolve, so overlap them \
             first (element_move, or trim the outgoing clip long). Only the incoming clip \
             fades, over the outgoing one playing at full underneath, so the middle of the \
             dissolve does not dip through the background.",
            json!({
                "fromId": { "type": "string", "description": "The outgoing clip." },
                "toId": { "type": "string", "description": "The incoming clip, which must start before the outgoing one ends." },
                "duration": { "type": "number", "default": 0.5, "description": "Length of the dissolve in seconds." }
            }),
            &["fromId", "toId"],
        ),
        tool(
            "element_ripple_delete",
            "Remove a clip and close the hole it leaves: every later clip on the same lane \
             moves back by its length. This is usually the delete you want — element_delete \
             leaves a gap, which reads as a stall in the finished video. Only the clip's own \
             lane moves.",
            json!({ "elementId": { "type": "string" } }),
            &["elementId"],
        ),
        tool(
            "marker_add",
            "Mark a moment on the timeline — a beat in the music, where a line lands, where \
             the next cut goes. Markers show on the ruler and clips snap to them when dragged.",
            json!({
                "at": { "type": "number", "description": "Timeline position, in seconds." },
                "label": { "type": "string" },
                "id": { "type": "string" }
            }),
            &["at"],
        ),
        tool(
            "crop_set",
            "Reframe a clip: cut away part of the source so what is left fills the frame. This \
             is how 16:9 footage becomes a 9:16 reel without letterboxing or squashing — \
             scaleX/scaleY distort, this chooses. Insets are fractions of the source, so \
             {\"left\": 0.25, \"right\": 0.25} keeps the middle half.",
            json!({
                "elementId": { "type": "string" },
                "left": { "type": "number", "description": "Fraction of the source cut from the left, 0-1." },
                "top": { "type": "number" },
                "right": { "type": "number" },
                "bottom": { "type": "number" }
            }),
            &["elementId"],
        ),
        tool(
            "mask_set",
            "Limit where a clip shows to a shape — a vignette, a spotlight on one part of the \
             frame, half the screen for a split. Feather softens the edge. Pass shape \"none\" \
             to remove one.",
            json!({
                "elementId": { "type": "string" },
                "shape": { "type": "string", "enum": ["ellipse", "rect", "none"] },
                "x": { "type": "number", "description": "Centre across the canvas, 0-1. Defaults to the middle." },
                "y": { "type": "number" },
                "width": { "type": "number", "description": "Size as a fraction of the canvas." },
                "height": { "type": "number" },
                "feather": { "type": "number", "description": "Edge softness in pixels. 0 is a hard edge." },
                "inverted": { "type": "boolean", "description": "Show everything OUTSIDE the shape instead." }
            }),
            &["elementId"],
        ),
        tool(
            "templates_list",
            "The element bundles bay can place in one call: lower thirds, kickers, end cards, \
             and anything the user saved. Each lists its text slots, which are the words you \
             pass to template_place, in order. Prefer a template to building the same \
             arrangement out of add_text and add_shape — the placement and timing are the part \
             that is tedious to get right.",
            json!({}),
            &[],
        ),
        tool(
            "template_place",
            "Place a template on the timeline at a time, filling its text slots. Returns the \
             ids it created, which every editing tool then takes.",
            json!({
                "templateId": { "type": "string", "description": "An id from templates_list." },
                "start": { "type": "number", "default": 0, "description": "Timeline position, in seconds." },
                "text": { "type": "array", "items": { "type": "string" },
                    "description": "Words for the template's text slots, in the order templates_list gives them. Slots you leave out keep their placeholder." },
                "layer": { "type": "integer", "default": 0 }
            }),
            &["templateId"],
        ),
        tool(
            "sfx_search",
            "Find a sound. Searches BOTH halves of the library at once: the effects bay \
             synthesises (whoosh, riser, impact, click — no download, rendered at whatever \
             length you ask for) and any recorded packs installed (clicks, switches, \
             confirmations, errors). Place a synthesised one with sfx_add and a recorded one \
             with sound_add. If nothing recorded is installed it says so, and how to install it.",
            json!({
                "query": { "type": "string", "description": "Words to match — \"click\", \"whoosh\", \"error\". Empty lists everything." }
            }),
            &[],
        ),
        tool(
            "sound_add",
            "Place a recorded sound from an installed pack on the audio lane. Its length is \
             the file's own — use sfx_add instead when the sound has to match the length of \
             something.",
            json!({
                "sound": { "type": "string", "description": "An id from sfx_search, e.g. \"kenney-interface/click_001\"." },
                "start": { "type": "number", "description": "Timeline position, in seconds." },
                "volume": { "type": "number", "default": 1.0 }
            }),
            &["sound", "start"],
        ),
        tool(
            "sfx_list",
            "The sound effects bay synthesises: whooshes, risers, clicks, impacts. These go \
             UNDER an edit rather than in the world of the picture, and they are generated \
             rather than downloaded — which means a whoosh comes out exactly as long as the \
             move it covers, instead of being cut off or trailing. Nothing to install and \
             nothing to go missing.",
            json!({}),
            &[],
        ),
        tool(
            "sfx_add",
            "Synthesise a sound effect and place it on the audio lane in one call. Match its \
             length to what it accompanies: a whoosh over a 0.4s transition should be 0.4s. \
             Put a riser BEFORE the moment it builds to and end it there; put a reverse whoosh \
             so it ENDS on the cut.",
            json!({
                "sfx": { "type": "string", "description": "An id from sfx_list — whoosh, riser, impact, click…" },
                "start": { "type": "number", "description": "Timeline position, in seconds." },
                "duration": { "type": "number", "description": "How long to make it. Defaults to what suits that sound." },
                "tone": { "type": "number", "default": 0.5,
                    "description": "Brightness 0-1. Low is dull and distant, high is close and sharp." },
                "level": { "type": "number", "default": 0.7,
                    "description": "Peak of the synthesised sound, 0-1. Effects sit under narration, so leave headroom." },
                "volume": { "type": "number", "default": 1.0, "description": "Clip gain on the timeline, on top of level." }
            }),
            &["sfx", "start"],
        ),
        tool(
            "looks_list",
            "The grades bay ships with: id, name, and what each one is for. Pass an id to \
             effect_add as \"look\" to apply it, and use `amount` to dial it back. These are \
             generated rather than downloaded, so they are on every machine and cannot go \
             missing; your own .cube files still work through \"lut\".",
            json!({}),
            &[],
        ),
        tool(
            "shots_detect",
            "Find the cuts in an imported clip and return the stretches between them. This is \
             how you work with footage you have not watched: scan an hour of rushes, then place \
             the shots you want with add_video and element_source. Frame-difference detection, \
             so it finds cuts, not meaning — it will miss a dissolve, and it cannot tell you \
             which shot is good. Decodes the whole file, so it returns a job id: poll \
             job_status.",
            json!({
                "mediaId": { "type": "string", "description": "An id from media_import." },
                "threshold": { "type": "number", "default": 0.3,
                    "description": "How different two frames must be to count as a cut, 0-1. Lower finds more (and calls fast pans cuts); higher finds fewer." },
                "minSeconds": { "type": "number", "default": 0.4,
                    "description": "Shots shorter than this are folded into the one before, so a strobe is not reported as forty cuts." }
            }),
            &["mediaId"],
        ),
        tool(
            "media_index",
            "Build and persist a semantic index for imported footage. Detects cuts, samples one \
             midpoint frame per shot, and embeds those frames with bay's existing local SigLIP \
             model. Returns a job id; poll job_status.",
            json!({
                "mediaId": { "type": "string", "description": "An id from media_import." }
            }),
            &["mediaId"],
        ),
        tool(
            "media_search",
            "Find footage by meaning rather than filename. Searches persisted shot-level SigLIP \
             embeddings and returns source ranges ready to place. Scores are uncalibrated; use \
             rank and best-vs-median separation.",
            json!({
                "query": { "type": "string", "description": "Plain-language visual description." },
                "mediaId": { "type": "string", "description": "Optional asset to restrict search to." },
                "limit": { "type": "integer", "default": 10, "minimum": 1, "maximum": 100 }
            }),
            &["query"],
        ),
        tool(
            "auto_reframe",
            "Track the subject in a video clip and animate crop insets for a new aspect ratio. \
             The tracked path is exponentially damped before keyframes are written, avoiding \
             jittery per-frame camera jumps. Returns a job id; poll job_status.",
            json!({
                "elementId": { "type": "string", "description": "A video element on the timeline." },
                "targetWidth": { "type": "integer", "default": 1080 },
                "targetHeight": { "type": "integer", "default": 1920 },
                "sampleSeconds": { "type": "number", "default": 0.5 },
                "smoothingSeconds": { "type": "number", "default": 0.9 }
            }),
            &["elementId"],
        ),
        tool(
            "check",
            "Inspect the timeline for the mistakes that make a finished video look wrong: a \
             large fill too close in colour to what it sits on to be seen, a card with nothing \
             legible in it, an easing that overshoots a bar past its own number, an opening \
             frame emptier than the rest of the video, two consecutive beats that carry nothing \
             between them, elements off the canvas, type too small to read at thumbnail size, \
             clips pointing at media nobody imported, black gaps in the picture.\n\nReturns \
             \"status\": clean, findings, or unevaluated — and read \"skipped\" before treating \
             anything as a pass, because a check that could not run says so there rather than \
             staying quiet. \"findings\" is capped at 12, drawn one per code so a noisy code \
             cannot hide a rare one; \"rollup\" has the full counts. \"stats.beats\" is how the \
             video was cut into beats — from narration starts and markers where there are any, \
             from what is on screen otherwise, from an 8s clock as a last resort — and every \
             finding that names a beat is numbered in it, so marker_add is how you change what \
             the per-beat checks are addressed against. render refuses while any error stands, \
             so run this first: it costs milliseconds and needs no GPU.",
            json!({
                "duration": { "type": "number",
                    "description": "Inspect only the first this many seconds — use the same value you intend to render." }
            }),
            &[],
        ),
        tool(
            "check_frames",
            "Render low-resolution, caption-suppressed samples and inspect the picture itself. \
             Reports frozen arrangements, an undersized visual anchor, and a dead lower frame. \
             Unlike check this needs a GPU; without one it returns status unevaluated and names \
             every skipped code.",
            json!({
                "duration": { "type": "number",
                    "description": "Inspect only the first this many seconds. Defaults to the populated timeline." }
            }),
            &[],
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
            "contact_sheet",
            "Render review frames into one labelled PNG. With no times, bay chooses two seeded, \
             jittered moments per beat so repeated reviews are reproducible without letting an \
             author pick only flattering frames.",
            json!({
                "path": { "type": "string", "description": "Where to write the PNG." },
                "times": { "type": "array", "items": { "type": "number" },
                    "description": "Optional explicit timeline seconds. Omit for two engine-chosen samples per beat." },
                "columns": { "type": "integer", "default": 3 }
            }),
            &["path"],
        ),
        tool(
            "render",
            "Encode the timeline, picture and sound. Requires ffmpeg. Returns immediately with a \
             job id while encoding continues on a project snapshot — poll job_status until \
             finished is true. Defaults are the ones a vertical reel wants: H.264, CRF 20, and \
             the mix normalised to -14 LUFS so it does not arrive quiet and get turned up along \
             with its noise floor. Pass a preset rather than tuning by hand unless you have a \
             reason.",
            json!({
                "path": { "type": "string", "description": "Output path. .mp4 for h264/hevc, .mov for prores." },
                "duration": { "type": "number",
                    "description": "How many seconds to encode. Defaults to the rest of the timeline from startSeconds." },
                "startSeconds": { "type": "number", "default": 0,
                    "description": "Where in the timeline the file begins — for exporting one section rather than the whole thing. The sound moves with it." },
                "preset": { "type": "string", "enum": ["social", "youtube", "master"],
                    "description": "social = Reels/TikTok/Shorts (H.264, CRF 20, -14 LUFS). youtube = a little more bitrate. master = ProRes with no loudness processing, for handing to another editor." },
                "codec": { "type": "string", "enum": ["h264", "hevc", "prores"],
                    "description": "h264 plays everywhere. hevc is half the size and not every player takes it. prores is an editing codec: huge, lossless-ish." },
                "quality": { "type": "number",
                    "description": "CRF 0-51: lower is better and larger. 18 is visually lossless, 23 is ffmpeg's default, past 28 gradients band. Ignored by prores." },
                "loudness": {
                    "description": "true for -14 LUFS, false to leave the mix alone, or a negative LUFS number for a specific target." },
                "audioBitrateKbps": { "type": "integer", "description": "AAC bitrate. 192 by default." },
                "ignoreChecks": { "type": "boolean", "default": false,
                    "description": "Render anyway while check reports an error. Needs `reason`. There is no per-code version of this on purpose." },
                "reason": { "type": "string",
                    "description": "Why the errors are right anyway, in at least 40 characters. Written into the MP4's own comment metadata, where it outlives this session." }
            }),
            &["path"],
        ),
        tool(
            "job_status",
            "Follow work that runs in the background. render, narrate and subtitles_to_video \
             return a job id immediately rather than holding the call open for minutes; poll \
             this with that id until \"finished\" is true, then read \"result\" for what the \
             tool would have returned. Call with no id to list everything running. Installs \
             appear here too.",
            json!({
                "job": { "type": "integer",
                    "description": "A job id. Omit to list every job this bay knows about." }
            }),
            &[],
        ),
        tool(
            "job_cancel",
            "Ask a running job to stop. Best-effort and cooperative, and the granularity \
             differs: a render stops at its next frame and leaves no partial file; \
             subtitles_to_video stops at the next cue; a single narrate is one uninterruptible \
             call into the speech model, so cancelling only takes effect if it has not started. \
             Poll job_status to see what actually happened — a job that finished before the \
             cancel landed reports finished with its result, not cancelled.",
            json!({
                "job": { "type": "integer", "description": "The job id to cancel." }
            }),
            &["job"],
        ),
        tool(
            "runtime_status",
            "What bay needs to work, and whether it is installed on this machine — ffmpeg for \
             decode and export, Kokoro for narration. Call this first if a render or a narrate \
             failed for want of a tool: bay can install either itself, so a missing one is not \
             a dead end. Pass a job id to follow an install that is already running.",
            json!({
                "job": { "type": "integer",
                    "description": "A job id from runtime_install. Reports that install's progress instead of the overall status." }
            }),
            &[],
        ),
        tool(
            "runtime_install",
            "Install what bay is missing, from builds pinned and hash-verified in bay itself. \
             The user needs nothing installed beforehand. Returns immediately with a job id — \
             this takes minutes — so poll runtime_status with that id until finished is true.",
            json!({
                "component": { "type": "string", "enum": installable_components(),
                    "description": installable_detail() }
            }),
            &["component"],
        ),
        tool(
            "speech_status",
            "Whether Kokoro text-to-speech is available on this machine, and which voices it \
             can speak. Call this before narrate.",
            json!({}),
            &[],
        ),
        tool(
            "vision_status",
            "Whether bay can find a picture from a description — the SigLIP encoder that scores \
             an image against a phrase. Without it stock_search still works, but the results \
             come back in the archive's keyword order, which is about filenames rather than \
             about what is in the photograph.",
            json!({}),
            &[],
        ),
        tool(
            "stock_status",
            "Which image archives bay can reach, which need a key, and how much has already \
             been downloaded. Worth reading once before your first stock_search: searching is \
             the one part of bay that sends anything off this machine.",
            json!({}),
            &[],
        ),
        tool(
            "stock_search",
            "Search an open image archive and get results ordered by what is actually in the \
             picture.\n\nThis sends your query to a third party — it is the only tool in bay \
             that does. Nothing is downloaded to your disk until you call stock_fetch.\n\nEvery \
             result is licensed for use in a video: NonCommercial, NoDerivatives and ShareAlike \
             are filtered out before you see them, because an edit is a derivative work. \
             Results carry a `licence`, a `credit`, a `score`, and `was` — where the archive \
             itself had ranked it, so you can see what the re-rank changed.\n\nRead `separation` \
             before you trust the order: if it is near zero every candidate scored alike and the \
             archive has nothing matching your query. Search for something else rather than \
             taking the top hit.",
            json!({
                "query": { "type": "string",
                    "description": "KEYWORDS for the archive to match, not a sentence. The \
                                    archive searches filenames and article text, so \
                                    \"hyperinflation 1923\" finds things and \"children playing \
                                    with worthless banknotes in 1923 Germany\" finds nothing at \
                                    all. Keep it to two or three words." },
                "describe": { "type": "string",
                    "description": "What the picture should SHOW, as a sentence — this is what \
                                    the results are re-ranked against, and it wants the opposite \
                                    of `query`. \"children stacking bundles of banknotes like \
                                    toy bricks\" scores far better than \"money\". Defaults to \
                                    `query`, which works but ranks worse." },
                "kind": { "type": "string", "enum": ["image", "video", "audio"],
                    "description": "Defaults to image. \"audio\" searches CC-licensed music and \
                                    sound through Openverse, keyless — that is where a bed comes \
                                    from when you have none. Results carry durationSeconds." },
                "provider": { "type": "string", "enum": ["wikimedia", "openverse", "pexels", "unsplash"],
                    "description": "wikimedia (default) is the archive for things that actually \
                                    happened — historical photographs, documents, banknotes. \
                                    openverse is a CC aggregator, better for generic b-roll. \
                                    pexels and unsplash are modern stock and need a free API key." },
                "limit": { "type": "integer",
                    "description": "How many results to return, 1-50. Defaults to 12. More \
                                    candidates are always fetched and scored than are returned." },
                "minWidth": { "type": "integer",
                    "description": "Drop anything narrower than this. 1200 keeps thumbnails out \
                                    of a piece that will be delivered at 1080 wide." },
                "licence": { "type": "string", "enum": ["allow-sharealike"],
                    "description": "Omit this. By default ShareAlike results are filtered out, \
                                    because using one obliges you to release your finished video \
                                    under CC BY-SA too — a decision about your own work.\n\n\
                                    Set it to \"allow-sharealike\" when you have decided that is \
                                    acceptable. It matters for historical subjects: the German \
                                    federal archive released its Weimar photographs as CC BY-SA, \
                                    so the default policy returns none of them. The result \
                                    carries a `licenceWarning` saying what you have taken on." }
            }),
            &["query"],
        ),
        tool(
            "stock_fetch",
            "Download one stock_search result to this machine, with its licence and attribution \
             recorded beside it. Pass the whole result object from stock_search as `asset`.\n\n\
             It does not put the file on the timeline — call media_import with the path it \
             returns. Returns `creditLine` when the licence obliges you to credit somebody; \
             stock_credits collects all of them at the end.",
            json!({
                "asset": { "type": "object",
                    "description": "One entire object from stock_search's results array." },
                "maxBytes": { "type": "integer",
                    "description": "Refuse anything larger rather than filling the disk. \
                                    Defaults to 64 MB." }
            }),
            &["asset"],
        ),
        tool(
            "audio_beats",
            "Find the pulse of an audio file: tempo, where the grid starts, and every beat in \
             seconds. This is what lets a cut land ON the music instead of near it.\n\n\
             Read `confidence` before you trust `bpm`. Near 1 the track has an unmistakable \
             pulse; below about 0.2 it has none and the grid is arithmetic, not music — place \
             cuts by hand instead. `candidates` lists the other readings that nearly won, \
             because on real music the top two are often a couple of BPM apart and that is half \
             a second of drift across a minute.\n\n\
             `everyNthBeat` thins the grid to a cut rate: 3 at 138 BPM is a picture every 1.3s.",
            json!({
                "mediaId": { "type": "string",
                    "description": "An imported audio asset. Either this or `path`." },
                "path": { "type": "string",
                    "description": "An absolute path to an audio or video file, if it is not imported." },
                "everyNthBeat": { "type": "integer",
                    "description": "Also return the grid thinned to every Nth beat — the rate you \
                                    intend to cut at, rather than the pulse." }
            }),
            &[],
        ),
        tool(
            "silence_detect",
            "Find the dead air in a recording: the pause before an answer, the gap while someone \
             thinks, the run-up at the head and the tail after the last word. On a raw interview \
             this is routinely a fifth of the runtime, and removing it is most of what makes a \
             take feel edited.\n\n\
             The threshold is measured off the material, not typed — a fixed dBFS number is the \
             noise floor in one room and the speech in another. `noiseFloorDb` and `speechDb` \
             tell you what it found and `thresholdDb` what it used.\n\n\
             It reports, it does not cut. `silences` are the ranges with nothing in them and \
             `keepRanges` is their complement — the shape of the edit. Raise `minimumSeconds` to \
             keep the beats: removing every 0.4 s pause is what makes an over-edited podcast \
             exhausting to listen to.",
            json!({
                "mediaId": { "type": "string", "description": "An imported asset. Either this or `path`." },
                "path": { "type": "string", "description": "An absolute path, if it is not imported." },
                "minimumSeconds": { "type": "number",
                    "description": "Ignore anything shorter. Defaults to 0.5 — below that it is \
                                    the rhythm of speech rather than a gap in it." },
                "thresholdDb": { "type": "number",
                    "description": "Override the measured threshold. Omit it; the derived one is \
                                    almost always right and travels to the next file." },
                "padSeconds": { "type": "number",
                    "description": "How much silence to leave at each end of a cut so it does not \
                                    clip the breath before a word. Defaults to 0.08." }
            }),
            &[],
        ),
        tool(
            "library_save",
            "Keep a file in your media library, under a name you choose, in a collection. \
             Searching does not keep anything and the download cache is keyed by the provider's \
             numbering; this is where you put the ones you decided on.\n\n\
             Pass `stockId` when the file came from stock_fetch and the licence and attribution \
             travel with it — otherwise a CC-BY image ends up in a finished film with nobody \
             able to say whose it was.",
            json!({
                "path": { "type": "string", "description": "The file to keep. stock_fetch returns one." },
                "collection": { "type": "string",
                    "description": "A folder name — usually the piece you are making. Defaults to \"default\"." },
                "name": { "type": "string", "description": "What to call it. Defaults to the filename." },
                "stockId": { "type": "string",
                    "description": "From stock_search, so the licence and credit are kept beside the file." }
            }),
            &["path"],
        ),
        tool(
            "library_list",
            "What is in the media library, with the credit lines anything CC-BY obliges you to \
             show.",
            json!({
                "collection": { "type": "string", "description": "Narrow to one collection." }
            }),
            &[],
        ),
        tool(
            "library_collect",
            "Copy a whole collection into a folder — usually one beside the project file. A \
             project references media by absolute path, so a project plus this folder is the \
             entire piece and can move to another machine.",
            json!({
                "collection": { "type": "string", "description": "Which collection to copy." },
                "into": { "type": "string",
                    "description": "Absolute path to the folder to copy into. Created if missing." }
            }),
            &["collection", "into"],
        ),
        tool(
            "stock_credits",
            "The attribution for everything downloaded, as text you can paste. Credits belong in \
             the post description, or on screen at the moment the sourced image is shown — not \
             on an end card nobody reads.",
            json!({}),
            &[],
        ),
        tool(
            "image_rank",
            "Score images already on disk against a phrase, best first. The same encoder \
             stock_search re-ranks with, pointed at your own files — for choosing among frames \
             you exported, or among pictures you already downloaded.\n\nScores are not \
             calibrated: 0.05 can be an excellent match. Read `separation`, not the absolute \
             number.",
            json!({
                "query": { "type": "string",
                    "description": "Describe what you are looking for, in plain words." },
                "paths": { "type": "array", "items": { "type": "string" },
                    "description": "Absolute paths to the images to score. Unreadable files are \
                                    listed in `skipped` rather than failing the call." }
            }),
            &["query", "paths"],
        ),
        tool(
            "narrate",
            "Speak text with Kokoro, put the audio on the timeline, and place word-synced \
             captions for it. Audio and captions come from the same synthesis, so they cannot \
             drift apart. Returns the cues it produced, the narration's end time, and the rate \
             it actually came out at.\n\nOne line, one clip: a script longer than 8 seconds is \
             refused with its own sentences listed, because a sentence that outlives the picture \
             it was written for cannot be rescued downstream. Say the read's speed as a rate — \
             `targetWordsPerSecond`, 2.5 being the 150 wpm a reel is read at — rather than as a \
             multiplier; Kokoro's `speed: 1.0` is 2.99 words a second, which is a 179 wpm gabble.",
            merge(
                json!({
                    "text": { "type": "string", "description": "What to say. Punctuation drives the phrasing, and a full stop is where a caption breaks." },
                    "start": { "type": "number", "default": 0.0, "description": "Where the narration begins on the timeline, in seconds." },
                    "voice": { "type": "string", "default": "af_heart",
                        "description": "A Kokoro voice, e.g. af_heart, af_bella, am_michael, bf_emma. See speech_status." },
                    "targetWordsPerSecond": { "type": "number", "default": 2.5,
                        "description": "How fast to read, in words a second: 2.5 is 150 wpm, the middle of the broadcast band. bay picks the Kokoro speed that lands there and reports what it actually got as wordsPerSecond." },
                    "speed": { "type": "number",
                        "description": "The raw Kokoro multiplier, 0.1 to 5.0, if you would rather set it yourself. Overrides targetWordsPerSecond." },
                    "langCode": { "type": "string", "default": "a",
                        "description": "a = American English, b = British, e Spanish, f French, h Hindi, i Italian, j Japanese, p Portuguese, z Mandarin." },
                    "volume": { "type": "number", "default": 1.0,
                        "description": "Mix gain for the narration clip. With peakDb normalization, 1.0 is already a full-strength voice." },
                    "peakDb": { "type": "number", "default": -2.0,
                        "description": "Normalize each utterance to this peak in dBFS. Kokoro's raw level swings ~5 dB line to line; leaving this on keeps delivery even. Pass null for Kokoro's untouched output." },
                    "pitchSemitones": { "type": "number", "default": 0.0,
                        "description": "Provider-neutral pitch control. Kokoro reports this unsupported unless zero; another TTS adapter may implement it." },
                    "energy": { "type": "number", "default": 1.0, "exclusiveMinimum": 0,
                        "description": "Provider-neutral vocal energy. When supplied it replaces peakDb normalization." },
                    "audioPath": { "type": "string", "description": "Where to write the WAV. Defaults to a temp file." },
                    "captions": { "type": "boolean", "default": true, "description": "Place captions as well as audio." }
                }),
                caption_properties(),
            ),
            &["text"],
        ),
        tool(
            "subtitles_add",
            "Read an SRT or WebVTT file and place every cue on the timeline as a caption.",
            merge(
                json!({
                    "path": { "type": "string", "description": "Path to a .srt or .vtt file." },
                    "offset": { "type": "number", "default": 0.0, "description": "Shift every cue later by this many seconds." }
                }),
                caption_properties(),
            ),
            &["path"],
        ),
        tool(
            "subtitles_export",
            "Write the timeline's captions out as an SRT or WebVTT file.",
            json!({
                "path": { "type": "string" },
                "format": { "type": "string", "enum": ["srt", "vtt"], "default": "srt" }
            }),
            &["path"],
        ),
        tool(
            "subtitles_to_video",
            "Turn a subtitle file straight into a video: create a project, place every cue as \
             a caption, optionally narrate each cue with Kokoro, and render an MP4. The one \
             call that takes an .srt and gives back a playable file.",
            merge(
                json!({
                    "path": { "type": "string", "description": "Path to a .srt or .vtt file." },
                    "output": { "type": "string", "description": "Output .mp4 path." },
                    "width": { "type": "integer", "default": 1080 },
                    "height": { "type": "integer", "default": 1920 },
                    "fps": { "type": "integer", "default": 30 },
                    "background": { "type": "string", "default": "#0E0E12" },
                    "narrate": { "type": "boolean", "default": false,
                        "description": "Speak each cue with Kokoro, starting at that cue's own time." },
                    "voice": { "type": "string", "default": "af_heart" },
                    "targetWordsPerSecond": { "type": "number", "default": 2.5,
                        "description": "How fast each cue is read, in words a second. 2.5 is 150 wpm." },
                    "speed": { "type": "number", "description": "The raw Kokoro multiplier, if you would rather set it yourself." },
                    "langCode": { "type": "string", "default": "a" }
                }),
                merge(caption_properties(), kit_properties()),
            ),
            &["path", "output"],
        ),
        tool(
            "project_save",
            "Save the project. With no path it goes into the user's bay project library, so it \
             shows up in the desktop app's project list — that is what you normally want. Pass \
             a path only to write a copy somewhere specific.",
            json!({ "path": { "type": "string",
                "description": "Optional explicit file to write instead of the library slot." } }),
            &[],
        ),
        tool(
            "project_list",
            "List the projects in the user's bay library — the same list the desktop app opens \
             on. Returns each project's id, name, canvas, duration and file path.",
            json!({}),
            &[],
        ),
        tool(
            "project_load",
            "Replace the current project with one from the library (by id) or from a JSON file \
             (by path). Give exactly one of them.",
            json!({
                "id": { "type": "string", "description": "Project id from project_list." },
                "path": { "type": "string", "description": "Path to a project JSON file." }
            }),
            &[],
        ),
        tool(
            "transcribe",
            "Hear an imported video or audio file locally with whisper.cpp and attach the \
             word-timed transcript to the media asset. Returns a job id; poll job_status. The \
             model is installed by runtime_install component \"listen\" and no media leaves the Mac.",
            json!({
                "mediaId": { "type": "string", "description": "An imported video or audio id." }
            }),
            &["mediaId"],
        ),
        tool(
            "diarize",
            "Separate speakers in an existing transcript by clustering local acoustic features \
             for each utterance. Speaker labels are written back onto the persisted utterances \
             and words used by transcript editing. Returns a job id; poll job_status.",
            json!({
                "mediaId": { "type": "string" },
                "speakers": { "type": "integer", "default": 2, "minimum": 1, "maximum": 8 }
            }),
            &["mediaId"],
        ),
        tool(
            "transcript_get",
            "Read the persisted transcript for an imported asset: language, utterances, speakers \
             where Whisper supplied turns, and every word's start/end/confidence.",
            json!({
                "mediaId": { "type": "string" }
            }),
            &["mediaId"],
        ),
        tool(
            "transcript_search",
            "Find an exact word sequence in a transcript. Matching ignores case and edge \
             punctuation; results carry source-media timing ready for cut_by_transcript.",
            json!({
                "mediaId": { "type": "string" },
                "query": { "type": "string", "description": "One or more words to find." }
            }),
            &["mediaId", "query"],
        ),
        tool(
            "cut_by_transcript",
            "Build a dialogue edit by placing selected transcript ranges consecutively as paired \
             video and speech clips. Give wordRanges for exact word-index cuts or ranges for \
             source-second intervals. Video and audio are both placed; add_video alone is silent.",
            json!({
                "mediaId": { "type": "string" },
                "wordRanges": {
                    "type": "array",
                    "items": { "type": "object", "properties": {
                        "startWord": { "type": "integer", "minimum": 0 },
                        "endWord": { "type": "integer", "minimum": 1,
                            "description": "Exclusive word index." }
                    }, "required": ["startWord", "endWord"] }
                },
                "ranges": {
                    "type": "array",
                    "items": { "type": "object", "properties": {
                        "startSeconds": { "type": "number", "minimum": 0 },
                        "endSeconds": { "type": "number", "minimum": 0 },
                        "text": { "type": "string" }
                    }, "required": ["startSeconds", "endSeconds"] }
                },
                "timelineStart": { "type": "number", "default": 0.0 },
                "layer": { "type": "integer", "default": 0 }
            }),
            &["mediaId"],
        ),
        tool(
            "remove_silence_and_fillers",
            "Create a tightened transcript edit: remove configurable filler words, compress dead \
             air, keep short conversational pauses untouched, and retain a bounded meaningful \
             beat from long pauses. Defaults favour natural speech rhythm rather than maximum speed.",
            json!({
                "mediaId": { "type": "string" },
                "timelineStart": { "type": "number", "default": 0.0 },
                "layer": { "type": "integer", "default": 0 },
                "sourceStart": { "type": "number", "default": 0.0,
                    "description": "Only clean transcript words at or after this source time." },
                "sourceEnd": { "type": "number",
                    "description": "Only clean transcript words ending at or before this source time." },
                "fillerWords": { "type": "array", "items": { "type": "string" },
                    "default": ["um", "uh", "erm", "er", "ah", "like", "you know"] },
                "deadAirThresholdSeconds": { "type": "number", "default": 0.72,
                    "description": "Shorter gaps remain untouched." },
                "retainedPauseSeconds": { "type": "number", "default": 0.18 },
                "keepMeaningfulPauses": { "type": "boolean", "default": true },
                "meaningfulPauseThresholdSeconds": { "type": "number", "default": 1.35 },
                "meaningfulPauseSeconds": { "type": "number", "default": 0.65,
                    "description": "How much of a long intentional beat to retain." }
            }),
            &["mediaId"],
        ),
        tool(
            "plan_create",
            "Create the inspectable editorial promise before building: named genre format, target \
             runtime, beat intents, and asset slots. Defaults to a draft so a human can reject it \
             cheaply; approve=true commits it and places the beat markers used by checks and the \
             critic. The format playbook supplies pacing, caption, sound, and failure-mode rules.",
            json!({
                "brief": { "type": "string" },
                "format": { "type": "string", "enum": bay_agent::trust::format_registry().iter().map(|format| format.id).collect::<Vec<_>>() },
                "targetRuntimeSeconds": { "type": "number", "exclusiveMinimum": 0 },
                "approve": { "type": "boolean", "default": false },
                "beats": { "type": "array", "minItems": 1, "items": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" },
                        "role": { "type": "string" },
                        "at": { "type": "number", "minimum": 0 },
                        "intent": { "type": "string" },
                        "assetSlots": { "type": "array", "items": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "purpose": { "type": "string" },
                                "required": { "type": "boolean", "default": false }
                            },
                            "required": ["id", "purpose"]
                        }}
                    },
                    "required": ["id", "role", "at", "intent"]
                }}
            }),
            &["brief", "format", "targetRuntimeSeconds", "beats"],
        ),
        tool(
            "plan_get",
            "Read the project's plan artifact, critic obligations, tournament state, and the \
             built-in format registry. This is the approval surface: inspect it before any build.",
            json!({}),
            &[],
        ),
        tool(
            "variant_create",
            "Clone the active project into the project library as one deliberate alternative. \
             Variants stay ordinary library projects, so load the returned projectId, change \
             hook/pacing/music, and render with the existing render tool.",
            json!({
                "label": { "type": "string", "description": "What this alternative changes, e.g. faster-hook." }
            }),
            &["label"],
        ),
        tool(
            "variant_register_render",
            "Attach a real rendered file to a variant. Bay loads the saved project and recomputes \
             both model and pixel gates; a caller cannot self-report validity, and an invalid \
             render receives zero reward in the tournament.",
            json!({
                "projectId": { "type": "string" },
                "path": { "type": "string", "description": "Existing non-empty output from render." }
            }),
            &["projectId", "path"],
        ),
        tool(
            "tournament_compare",
            "Record one forced pairwise preference between two engine-verified renders. Never asks \
             for an absolute score. Forced Optimization requires the current incumbent in every \
             comparison, and a revision becomes incumbent only when it actually wins.",
            json!({
                "leftProjectId": { "type": "string" },
                "rightProjectId": { "type": "string" },
                "winnerProjectId": { "type": "string" },
                "reason": { "type": "string" }
            }),
            &[
                "leftProjectId",
                "rightProjectId",
                "winnerProjectId",
                "reason",
            ],
        ),
        tool(
            "critic_prepare",
            "Render an engine-seeded contact sheet and return only brief, sheet, and computed \
             check/check_frames evidence for a fresh critic. The model gets no plan or transcript \
             to defend. Follow with critic_submit. The loop is bounded at two rounds.",
            json!({
                "path": { "type": "string", "description": "Where to write the labelled critic contact sheet." }
            }),
            &["path"],
        ),
        tool(
            "critic_submit",
            "Submit a fresh critic's three forced choices and nine binary taste judgments. Every \
             forced choice creates a persisted render-blocking obligation keyed by beat, exact \
             engine sample time, and rendered content hash. Caller-supplied measurements are not accepted.",
            json!({
                "weakestPanel": { "type": "integer", "minimum": 1 },
                "mostAlikePair": { "type": "array", "minItems": 2, "maxItems": 2, "items": { "type": "integer", "minimum": 1 } },
                "thumbnailPanel": { "type": "integer", "minimum": 1 },
                "binaries": { "type": "array", "minItems": 9, "maxItems": 9, "items": { "type": "boolean" } },
                "rationale": { "type": "string" }
            }),
            &[
                "weakestPanel",
                "mostAlikePair",
                "thumbnailPanel",
                "binaries",
                "rationale",
            ],
        ),
        tool(
            "critic_refresh",
            "Re-render every open critic obligation at its original timestamp. An obligation closes \
             only when both rendered content and ICGS composition changed; hue swaps, global drift, \
             and self-reported edits cannot clear it.",
            json!({}),
            &[],
        ),
        tool(
            "gen_image",
            "Generate a still through a local, fal, or Gemini adapter, then verify the actual pixels \
             against the prompt with bay's provisioned SigLIP encoder. This is deliberately \
             two-step: the first call only returns cost and the exact outbound payload. Cloud \
             generation requires a second identical call with execute:true, consent:true, and the \
             returned previewId. No consent means no cloud call. Accepted results carry model, \
             prompt, seed, timestamp, content hash, and generated-media provenance; rejected \
             results are not offered for media_import.",
            json!({
                "prompt": { "type": "string", "description": "What the pixels must show. SigLIP measures the resulting file against this." },
                "provider": { "type": "string", "enum": ["local", "fal", "gemini"], "default": "local" },
                "model": { "type": "string", "description": "Provider model id. Omit for bay's current default." },
                "width": { "type": "integer", "minimum": 1, "default": 1024 },
                "height": { "type": "integer", "minimum": 1, "default": 1024 },
                "seed": { "type": "integer", "minimum": 0, "default": 0 },
                "execute": { "type": "boolean", "default": false, "description": "False previews only. Repeat with true after reviewing cost and outbound data." },
                "consent": { "type": "boolean", "default": false, "description": "Required for cloud providers and valid only with the matching previewId." },
                "previewId": { "type": "string", "description": "Binds cloud consent to the exact payload and cost shown by the preview." }
            }),
            &["prompt"],
        ),
        tool(
            "gen_video",
            "Generate a short source clip through a local, fal, or Gemini adapter. Clips are capped \
             at four seconds because coherence degrades on longer generations. Bay samples real \
             decoded frames, SigLIP-checks prompt adherence, rejects peripheral flicker, and routes \
             accepted placement through the existing critic obligations for physics/permanence. \
             First call previews only; a cloud call requires execute:true, consent:true, and the \
             matching previewId from an identical request.",
            json!({
                "prompt": { "type": "string", "description": "What every sampled frame must depict." },
                "imageRef": { "type": "string", "description": "Optional local reference image. The preview lists it under outbound.localFiles before any upload." },
                "seconds": { "type": "number", "exclusiveMinimum": 0, "maximum": 4, "default": 4 },
                "provider": { "type": "string", "enum": ["local", "fal", "gemini"], "default": "local" },
                "model": { "type": "string", "description": "Provider model id. Omit for bay's current default." },
                "width": { "type": "integer", "minimum": 1 },
                "height": { "type": "integer", "minimum": 1 },
                "seed": { "type": "integer", "minimum": 0, "default": 0 },
                "execute": { "type": "boolean", "default": false },
                "consent": { "type": "boolean", "default": false },
                "previewId": { "type": "string", "description": "Binds cloud consent to the exact payload and cost shown by the preview." }
            }),
            &["prompt"],
        ),
        tool(
            "gen_music",
            "Generate a music bed through a local or fal adapter. Bay decodes the returned audio \
             and measures its beat grid; a provider-reported BPM cannot satisfy the gate. A weak \
             pulse or BPM outside five percent of the brief is rejected. The first call only \
             previews cost and outbound data. Cloud generation requires a second identical call \
             with execute:true, consent:true, and its matching previewId. There is no bay credit \
             meter: cost is the provider's estimated charge.",
            json!({
                "brief": { "type": "string", "description": "Mood, instrumentation, energy arc, and intended edit use." },
                "bpm": { "type": "number", "minimum": 30, "maximum": 300, "description": "Requested tempo, verified from the generated audio." },
                "seconds": { "type": "number", "exclusiveMinimum": 0, "default": 30 },
                "provider": { "type": "string", "enum": ["local", "fal"], "default": "local" },
                "model": { "type": "string", "description": "Provider model id. Omit for bay's current default." },
                "seed": { "type": "integer", "minimum": 0, "default": 0 },
                "execute": { "type": "boolean", "default": false },
                "consent": { "type": "boolean", "default": false },
                "previewId": { "type": "string", "description": "Binds cloud consent to the exact payload and cost shown by the preview." }
            }),
            &["brief"],
        ),
        tool(
            "runtime_remove",
            "Remove one runtime component that bay installed and report the disk space actually \
             freed. This only deletes manifest-owned paths inside bay's managed runtime \
             directory: a system ffmpeg, Python, or other user-installed tool is never touched. \
             Refuses while an install of the same component is running.",
            json!({
                "component": { "type": "string", "enum": installable_components(),
                    "description": installable_detail() }
            }),
            &["component"],
        ),
    ]
}

fn transcript_ranges(
    studio: &Studio,
    media_id: &str,
    args: &Value,
) -> Result<Vec<bay_listen::SourceRange>, ToolError> {
    let transcript = studio
        .project()
        .media
        .iter()
        .find(|asset| asset.id == media_id)
        .ok_or_else(|| err(format!("no media {media_id:?} — call media_import first")))?
        .transcript
        .as_ref()
        .ok_or_else(|| {
            err(format!(
                "media {media_id:?} has no transcript — call transcribe first"
            ))
        })?;
    let mut ranges = Vec::new();
    if let Some(entries) = args.get("wordRanges").and_then(Value::as_array) {
        for entry in entries {
            let start = entry
                .get("startWord")
                .and_then(Value::as_u64)
                .ok_or_else(|| err("every wordRanges entry needs integer startWord"))?
                as usize;
            let end = entry
                .get("endWord")
                .and_then(Value::as_u64)
                .ok_or_else(|| err("every wordRanges entry needs integer endWord"))?
                as usize;
            if start >= end || end > transcript.words.len() {
                return Err(err(format!(
                    "word range {start}..{end} is outside transcript length {}",
                    transcript.words.len()
                )));
            }
            ranges.push(bay_listen::range_for_words(transcript, start, end));
        }
    }
    if let Some(entries) = args.get("ranges").and_then(Value::as_array) {
        for entry in entries {
            ranges.push(bay_listen::SourceRange {
                start_seconds: required_number(entry, "startSeconds")?,
                end_seconds: required_number(entry, "endSeconds")?,
                text: text(entry, "text").unwrap_or_default(),
            });
        }
    }
    Ok(ranges)
}

/// Route one tool call to the studio.
pub fn dispatch(studio: &mut Studio, name: &str, args: &Value) -> ToolResult {
    match name {
        "project_create" => {
            let name = text(args, "name").unwrap_or_else(|| "Untitled".into());
            // One implementation, two doors: `style_pick` and `project_create` resolve a kit the
            // same way, so a session whose tool list predates `style_pick` can still reach every
            // part of it through parameters on the tool it already knows about.
            let choice = kit_choice(args)?
                .unwrap_or_else(|| KitChoice::Brief(text(args, "brief").unwrap_or(name.clone())));
            studio.project_create(
                &name,
                number(args, "width", 1080.0) as u32,
                number(args, "height", 1920.0) as u32,
                number(args, "fps", 30.0) as u32,
                text(args, "background").as_deref(),
                choice,
            )
        }
        "style_pick" => {
            studio.style_pick(&text(args, "brief").unwrap_or_default(), kit_choice(args)?)
        }
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
        // One implementation under two names: `audio_probe` is the verb, and `mediaId` on
        // `media_import` is the same call reachable from a session whose tool list was cached
        // before `audio_probe` existed.
        "audio_probe" => studio.audio_probe(&required_text(args, "mediaId")?),
        "media_import" => match text(args, "mediaId") {
            Some(media_id) => studio.audio_probe(&media_id),
            None => {
                let path = required_text(args, "path")?;
                let generated = text(args, "generationReceipt")
                    .map(|receipt| {
                        bay_gen::verify_provenance(&receipt, std::path::Path::new(&path))
                            .map_err(|error| err(error.to_string()))
                    })
                    .transpose()?;
                studio.media_import(&path, text(args, "id"), generated)
            }
        },
        "transcribe" => {
            let media_id = required_text(args, "mediaId")?;
            let label = media_id.clone();
            headless_job("transcribe", &label, || studio.transcribe(&media_id))
        }
        "diarize" => {
            let media_id = required_text(args, "mediaId")?;
            let label = media_id.clone();
            headless_job("diarize", &label, || {
                studio.diarize(
                    &media_id,
                    args.get("speakers").and_then(Value::as_u64).unwrap_or(2) as usize,
                )
            })
        }
        "transcript_get" => studio.transcript_get(&required_text(args, "mediaId")?),
        "transcript_search" => studio.transcript_search(
            &required_text(args, "mediaId")?,
            &required_text(args, "query")?,
        ),
        "cut_by_transcript" => {
            let media_id = required_text(args, "mediaId")?;
            let ranges = transcript_ranges(studio, &media_id, args)?;
            studio.cut_by_transcript(
                &media_id,
                &ranges,
                number(args, "timelineStart", 0.0),
                layer(args),
            )
        }
        "remove_silence_and_fillers" => {
            let media_id = required_text(args, "mediaId")?;
            let transcript = studio
                .project()
                .media
                .iter()
                .find(|asset| asset.id == media_id)
                .ok_or_else(|| err(format!("no media {media_id:?} — call media_import first")))?
                .transcript
                .as_ref()
                .ok_or_else(|| {
                    err(format!(
                        "media {media_id:?} has no transcript — call transcribe first"
                    ))
                })?;
            let defaults = bay_listen::CleanupConfig::default();
            let filler_words = args
                .get("fillerWords")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or(defaults.filler_words);
            let config = bay_listen::CleanupConfig {
                filler_words,
                dead_air_threshold_seconds: number(
                    args,
                    "deadAirThresholdSeconds",
                    defaults.dead_air_threshold_seconds,
                ),
                retained_pause_seconds: number(
                    args,
                    "retainedPauseSeconds",
                    defaults.retained_pause_seconds,
                ),
                meaningful_pause_threshold_seconds: number(
                    args,
                    "meaningfulPauseThresholdSeconds",
                    defaults.meaningful_pause_threshold_seconds,
                ),
                meaningful_pause_seconds: number(
                    args,
                    "meaningfulPauseSeconds",
                    defaults.meaningful_pause_seconds,
                ),
                keep_meaningful_pauses: args
                    .get("keepMeaningfulPauses")
                    .and_then(Value::as_bool)
                    .unwrap_or(defaults.keep_meaningful_pauses),
            };
            let source_start = number(args, "sourceStart", 0.0);
            let source_end = args
                .get("sourceEnd")
                .and_then(Value::as_f64)
                .unwrap_or(transcript.duration_seconds);
            if source_start < 0.0 || source_end <= source_start {
                return Err(err(format!(
                    "source range must be increasing and non-negative, got {source_start}..{source_end}"
                )));
            }
            let selected = bay_project::Transcript {
                words: transcript
                    .words
                    .iter()
                    .filter(|word| {
                        word.start_seconds >= source_start && word.end_seconds <= source_end
                    })
                    .cloned()
                    .collect(),
                utterances: Vec::new(),
                ..transcript.clone()
            };
            let ranges = bay_listen::cleanup_ranges(&selected, &config);
            studio.cut_by_transcript(
                &media_id,
                &ranges,
                number(args, "timelineStart", 0.0),
                layer(args),
            )
        }
        "sfx_list" => Ok(json!({
            "sfx": bay_audio::sfx::EFFECTS
                .iter()
                .map(|effect| json!({
                    "id": effect.id,
                    "name": effect.name,
                    "description": effect.description,
                    "defaultSeconds": effect.default_seconds,
                }))
                .collect::<Vec<_>>(),
        })),
        "sfx_search" => studio.sfx_search(&text(args, "query").unwrap_or_default()),
        "sound_add" => studio.sound_add(
            &required_text(args, "sound")?,
            required_number(args, "start")?,
            number(args, "volume", 1.0) as f32,
        ),
        "sfx_add" => studio.sfx_add(
            &required_text(args, "sfx")?,
            required_number(args, "start")?,
            args.get("duration").and_then(|v| v.as_f64()),
            number(args, "tone", 0.5) as f32,
            number(args, "level", 0.7) as f32,
            number(args, "volume", 1.0) as f32,
        ),
        "shots_detect" => {
            let media_id = required_text(args, "mediaId")?;
            let asset = studio
                .project()
                .media
                .iter()
                .find(|asset| asset.id == media_id)
                .cloned()
                .ok_or_else(|| err(format!("no media {media_id:?} — call media_import first")))?;
            let threshold = number(
                args,
                "threshold",
                bay_preview::probe::DEFAULT_SHOT_THRESHOLD,
            );
            let min_seconds = number(args, "minSeconds", 0.4);
            headless_job("shots_detect", &asset.name, || {
                let shots = bay_preview::probe::detect_shots(&asset.path, threshold, min_seconds)
                    .map_err(|e| {
                    err(format!("could not scan {:?} for cuts: {e}", asset.name))
                })?;
                Ok(json!({
                    "mediaId": media_id,
                    "name": asset.name,
                    "threshold": threshold,
                    "shots": shots
                        .iter()
                        .enumerate()
                        .map(|(index, shot)| json!({
                            "index": index,
                            "startSeconds": shot.start_seconds,
                            "endSeconds": shot.end_seconds,
                            "durationSeconds": shot.duration_seconds(),
                        }))
                        .collect::<Vec<_>>(),
                }))
            })
        }
        "media_index" => {
            let media_id = required_text(args, "mediaId")?;
            let label = media_id.clone();
            headless_job("media_index", &label, || studio.media_index(&media_id))
        }
        "media_search" => studio.media_search(
            &required_text(args, "query")?,
            args.get("mediaId").and_then(Value::as_str),
            args.get("limit").and_then(Value::as_u64).unwrap_or(10) as usize,
        ),
        "auto_reframe" => {
            let element_id = required_text(args, "elementId")?;
            let label = element_id.clone();
            headless_job("auto_reframe", &label, || {
                studio.auto_reframe(
                    &element_id,
                    args.get("targetWidth")
                        .and_then(Value::as_u64)
                        .unwrap_or(1080) as u32,
                    args.get("targetHeight")
                        .and_then(Value::as_u64)
                        .unwrap_or(1920) as u32,
                    number(args, "sampleSeconds", 0.5),
                    number(args, "smoothingSeconds", 0.9),
                )
            })
        }
        "add_text" => {
            let role = parse_role(args.get("role").and_then(|v| v.as_str()), "add_text")?;
            let kit = studio.committed_kit()?;
            reject_raw_style(args, "add_text", &kit, role)?;
            let framing = named_framing(args, &kit)?;
            studio.add_text(
                layer(args),
                text(args, "id"),
                required_number(args, "start")?,
                required_number(args, "duration")?,
                TextArgs {
                    content: required_text(args, "content")?,
                    role,
                    tone: parse_tone(args.get("tone").and_then(|v| v.as_str()), role)?,
                    align: parse_align(args.get("align").and_then(|v| v.as_str()))?,
                    letter_spacing: args
                        .get("letterSpacing")
                        .and_then(|v| v.as_f64())
                        .map(|v| v as f32),
                    line_height: args
                        .get("lineHeight")
                        .and_then(|v| v.as_f64())
                        .map(|v| v as f32),
                    decorations: text_decorations(args),
                },
                visual(args, framing.as_ref())?,
            )
        }
        "add_shape" => {
            let shape = match args.get("shape").and_then(|v| v.as_str()).unwrap_or("rect") {
                "rect" => ShapeKind::Rect {
                    radius: number(args, "radius", 0.0) as f32,
                },
                "ellipse" => ShapeKind::Ellipse,
                other => return Err(err(format!("unknown shape {other:?} — rect or ellipse"))),
            };
            let role = parse_role(args.get("role").and_then(|v| v.as_str()), "add_shape")?;
            let kit = studio.committed_kit()?;
            reject_raw_style(args, "add_shape", &kit, role)?;
            let framing = named_framing(args, &kit)?;
            studio.add_shape(
                layer(args),
                text(args, "id"),
                required_number(args, "start")?,
                required_number(args, "duration")?,
                shape,
                role,
                parse_tone(args.get("tone").and_then(|v| v.as_str()), role)?,
                visual(args, framing.as_ref())?,
            )
        }
        "add_image" => {
            let framing = named_framing(args, &studio.committed_kit()?)?;
            let media_id = required_text(args, "mediaId")?;
            let mut visual = visual(args, framing.as_ref())?;
            apply_cover(studio, &media_id, args, &mut visual);
            studio.add_image(
                layer(args),
                text(args, "id"),
                media_id,
                required_number(args, "start")?,
                required_number(args, "duration")?,
                optional_role(args)?,
                visual,
            )
        }
        "add_video" => {
            let framing = named_framing(args, &studio.committed_kit()?)?;
            let media_id = required_text(args, "mediaId")?;
            let mut visual = visual(args, framing.as_ref())?;
            apply_cover(studio, &media_id, args, &mut visual);
            studio.add_video(
                layer(args),
                text(args, "id"),
                media_id,
                required_number(args, "start")?,
                required_number(args, "duration")?,
                number(args, "trimStart", 0.0),
                optional_role(args)?,
                visual,
            )
        }
        "add_audio" => studio.add_audio(
            text(args, "id"),
            required_text(args, "mediaId")?,
            required_number(args, "start")?,
            required_number(args, "duration")?,
            number(args, "volume", 1.0) as f32,
            number(args, "trimStart", 0.0),
            // An author placing a clip by hand is the author's clip, whatever it contains.
            // Only bay's own generators claim Tool.
            ElementSource::Author,
            parse_audio_role(args.get("role").and_then(|v| v.as_str()))?,
        ),
        // `animate` has no arm here on purpose. It used to have one, into a second headless
        // implementation that knew 8 of the 14 easings and refused `volume` outright; it now
        // falls through to `apply_planned` like every other revising tool, so the wire and the
        // editor window plan it identically.
        "element_delete" => studio.element_delete(&required_text(args, "elementId")?),
        "timeline" => studio.timeline(),
        "check_frames" => {
            studio.check_frames(args.get("duration").and_then(|value| value.as_f64()))
        }
        "snapshot" => studio.snapshot(
            required_number(args, "at")?,
            &required_text(args, "path")?,
            number(args, "scale", 0.5) as f32,
        ),
        "contact_sheet" => {
            let times = args
                .get("times")
                .and_then(Value::as_array)
                .map(|values| values.iter().filter_map(Value::as_f64).collect::<Vec<_>>())
                .unwrap_or_default();
            studio.contact_sheet(
                &required_text(args, "path")?,
                &times,
                args.get("columns").and_then(Value::as_u64).unwrap_or(3) as usize,
            )
        }
        // Render owns a project snapshot and is genuinely asynchronous on both transports.
        // Polling job_status is the single contract whether or not a window is open.
        "render" => headless_render_job(studio, args),
        "job_status" => Ok(bay_jobs::mcp::status(args)),
        "job_cancel" => bay_jobs::mcp::cancel(args).map_err(crate::studio::err),
        "runtime_status" => Ok(bay_provision::mcp::runtime_status(args)),
        "runtime_install" => bay_provision::mcp::runtime_install(args).map_err(crate::studio::err),
        "runtime_remove" => bay_provision::mcp::runtime_remove(args).map_err(crate::studio::err),
        "speech_status" => studio.speech_status(),
        "vision_status" => Ok(bay_vision::mcp::vision_status()),
        "image_rank" => bay_vision::mcp::image_rank(args).map_err(crate::studio::err),
        "stock_status" => Ok(bay_stock::mcp::stock_status()),
        "stock_search" => bay_agent::illustrate::stock_search(args).map_err(crate::studio::err),
        "stock_fetch" => bay_agent::illustrate::stock_fetch(args).map_err(crate::studio::err),
        "stock_credits" => Ok(bay_stock::mcp::stock_credits()),
        "library_save" => bay_stock::mcp::library_save(args).map_err(crate::studio::err),
        "library_list" => Ok(bay_stock::mcp::library_list(args)),
        "library_collect" => bay_stock::mcp::library_collect(args).map_err(crate::studio::err),
        "audio_beats" => audio_beats(studio, args),
        "silence_detect" => silence_detect(studio, args),
        "narrate" => {
            let label = required_text(args, "text")?
                .chars()
                .take(60)
                .collect::<String>();
            // Resolved before the closure borrows the studio mutably.
            let captions = caption_style_for(studio, args, "narrate")?;
            let wanted = args
                .get("captions")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let narrate = narrate_args(
                args,
                required_text(args, "text")?,
                wanted.then_some(captions),
            );
            headless_job("narrate", &label, || studio.narrate(narrate))
        }
        "subtitles_add" => {
            let style = caption_style_for(studio, args, "subtitles_add")?;
            studio.subtitles_add(
                &required_text(args, "path")?,
                number(args, "offset", 0.0),
                &style,
            )
        }
        "subtitles_export" => studio.subtitles_export(
            &required_text(args, "path")?,
            &text(args, "format").unwrap_or_else(|| "srt".into()),
        ),
        "subtitles_to_video" => {
            let label = required_text(args, "srt").unwrap_or_else(|_| "subtitles".into());
            headless_job("subtitles_to_video", &label, || {
                subtitles_to_video(studio, args)
            })
        }
        "project_save" => studio.project_save(text(args, "path").as_deref()),
        "project_list" => studio.project_list(),
        "project_load" => {
            studio.project_load(text(args, "id").as_deref(), text(args, "path").as_deref())
        }
        "variant_create" => studio.variant_create(&required_text(args, "label")?),
        "variant_register_render" => studio.variant_register_render(
            &required_text(args, "projectId")?,
            &required_text(args, "path")?,
        ),
        "tournament_compare" => studio.tournament_compare(
            &required_text(args, "leftProjectId")?,
            &required_text(args, "rightProjectId")?,
            &required_text(args, "winnerProjectId")?,
            &required_text(args, "reason")?,
        ),
        "critic_prepare" => studio.critic_prepare(&required_text(args, "path")?),
        "critic_submit" => {
            let pair = args
                .get("mostAlikePair")
                .and_then(Value::as_array)
                .ok_or_else(|| err("mostAlikePair must contain exactly two panel numbers"))?;
            if pair.len() != 2 {
                return Err(err("mostAlikePair must contain exactly two panel numbers"));
            }
            let values = args
                .get("binaries")
                .and_then(Value::as_array)
                .ok_or_else(|| err("binaries must contain exactly nine booleans"))?
                .iter()
                .map(|value| {
                    value
                        .as_bool()
                        .ok_or_else(|| err("every binary judgment must be true or false"))
                })
                .collect::<Result<Vec<_>, _>>()?;
            let binaries: [bool; 9] = values
                .try_into()
                .map_err(|_| err("binaries must contain exactly nine booleans"))?;
            studio.critic_submit(
                args.get("weakestPanel")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| err("weakestPanel must be a panel number"))?
                    as usize,
                (
                    pair[0]
                        .as_u64()
                        .ok_or_else(|| err("mostAlikePair entries must be panel numbers"))?
                        as usize,
                    pair[1]
                        .as_u64()
                        .ok_or_else(|| err("mostAlikePair entries must be panel numbers"))?
                        as usize,
                ),
                args.get("thumbnailPanel")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| err("thumbnailPanel must be a panel number"))?
                    as usize,
                binaries,
                &required_text(args, "rationale")?,
            )
        }
        "critic_refresh" => studio.critic_refresh(),
        "gen_image" => bay_gen::mcp::generate(bay_gen::GenerationKind::Image, args).map_err(err),
        "gen_video" => bay_gen::mcp::generate(bay_gen::GenerationKind::Video, args).map_err(err),
        "gen_music" => bay_gen::mcp::generate(bay_gen::GenerationKind::Music, args).map_err(err),
        // A duck answers with the curve it wrote. 25 keyframes an agent cannot read back is the
        // black box the 13-clip hack was reaching around, so the report is derived before the
        // commands are applied and merged into the ordinary transaction result.
        other @ ("duck" | "audio_set") => {
            let report = bay_agent::plan::duck_report(studio.project(), other, args);
            let mut out = studio.apply_planned(other, args)?;
            if let (Some(report), Some(object)) = (report, out.as_object_mut()) {
                object.insert("duck".into(), report);
            }
            Ok(out)
        }
        // Everything that revises what is already on the timeline is planned by
        // `bay_agent::plan` and executed here. One implementation, two front ends: the live
        // editor plans the same call the same way, so a trim cannot come to mean one thing in
        // the window and another over the wire.
        other if bay_agent::planned_tools().contains(&other) => studio.apply_planned(other, args),
        other => Err(err(format!("unknown tool {other:?}"))),
    }
}

/// Everything `narrate` needs, decoded. `speed` is only read when a caller insists on setting
/// the multiplier itself; otherwise the rate decides it.
fn narrate_args(
    args: &Value,
    say: String,
    captions: Option<crate::narration::CaptionStyle>,
) -> crate::narration::NarrateArgs {
    crate::narration::NarrateArgs {
        text: say,
        voice: text(args, "voice").unwrap_or_else(|| "af_heart".into()),
        speed: args
            .get("speed")
            .and_then(|v| v.as_f64())
            .map(|speed| speed as f32),
        target_words_per_second: number(
            args,
            "targetWordsPerSecond",
            bay_speech::TARGET_WORDS_PER_SECOND,
        ),
        lang_code: text(args, "langCode").unwrap_or_else(|| "a".into()),
        start: number(args, "start", 0.0),
        volume: number(args, "volume", 1.0) as f32,
        out_path: text(args, "audioPath"),
        peak_db: if args.get("energy").is_some() {
            None
        } else {
            match args.get("peakDb") {
                Some(Value::Null) => None,
                Some(value) => value.as_f64().map(|v| v as f32).or(Some(-2.0)),
                None => Some(-2.0),
            }
        },
        pitch_semitones: number(args, "pitchSemitones", 0.0) as f32,
        energy: number(args, "energy", 1.0) as f32,
        captions,
    }
}

/// Caption appearance: the preset and the placement the caller asked for, resolved against the
/// committed kit. The eleven arguments this replaces are refused here rather than ignored.
fn caption_style_for(
    studio: &mut Studio,
    args: &Value,
    tool: &str,
) -> Result<crate::narration::CaptionStyle, ToolError> {
    // One decoder, both transports — the same function the editor window's planner calls.
    let kit = studio.committed_kit()?;
    bay_agent::plan::caption_style_from(args, Some(&kit), tool).map_err(err)
}

/// `subtitles_to_video`: an .srt in, a playable .mp4 out.
///
/// Deliberately a single tool rather than a documented four-call recipe — "turn these
/// subtitles into a video" is one intent, and splitting it would make the caller responsible
/// for choosing a canvas, sizing the timeline to the last cue, and remembering to render.
fn subtitles_to_video(studio: &mut Studio, args: &Value) -> ToolResult {
    let path = required_text(args, "path")?;
    let output = required_text(args, "output")?;
    let source =
        std::fs::read_to_string(&path).map_err(|e| err(format!("could not read {path}: {e}")))?;
    let cues = bay_speech::parse(&source).map_err(err)?;

    // The kit answers the ground, so the hardcoded `#0E0E12` this used to pass is gone: it was
    // one of the values every project on this machine had in common.
    let choice = kit_choice(args)?.unwrap_or_else(|| {
        KitChoice::Brief(text(args, "brief").unwrap_or_else(|| format!("subtitles from {path}")))
    });
    studio.project_create(
        "Subtitles",
        number(args, "width", 1080.0) as u32,
        number(args, "height", 1920.0) as u32,
        number(args, "fps", 30.0) as u32,
        text(args, "background").as_deref(),
        choice,
    )?;

    let style = caption_style_for(studio, args, "subtitles_to_video")?;
    let placed = studio.place_cues(&cues, &style)?;

    // Narrating each cue at its own start keeps the voice aligned to the caption it belongs
    // to; a single pass over the joined text would drift from the file's timings immediately.
    let mut spoken = 0usize;
    let mut overruns = Vec::new();
    if args
        .get("narrate")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        for (index, cue) in cues.iter().enumerate() {
            let spoken_line = cue.text.replace('\n', " ");
            if spoken_line.trim().is_empty() {
                continue;
            }
            // Captions are already on the timeline from the file; narrating them again would
            // stack a second set on top — so this call speaks only.
            let mut call = narrate_args(args, spoken_line, None);
            call.start = cue.start;
            let result = studio.narrate(call)?;
            spoken += 1;
            // Speech does not have to fit the cue window the subtitle author chose. Report
            // the overlaps rather than silently truncating or letting lines talk over
            // each other unannounced.
            if let Some(end) = result.get("endSeconds").and_then(|v| v.as_f64())
                && let Some(next) = cues.get(index + 1)
                && end > next.start + 0.05
            {
                overruns.push(serde_json::json!({
                    "cue": index + 1,
                    "text": cue.text,
                    "spokenEnd": (end * 1000.0).round() / 1000.0,
                    "nextCueStart": next.start,
                }));
            }
        }
    }

    let last = cues.last().map(|cue| cue.end).unwrap_or(0.0);
    let duration = last.max(
        studio
            .project_info()?
            .get("durationSeconds")
            .and_then(|d| d.as_f64())
            .unwrap_or(last),
    );
    // Not gated, and deliberately: the project this encodes is one bay built itself from the
    // caller's SRT, so an error in it would be bay's own bug and refusing would leave the
    // caller with nothing to fix. `render` is where an authored timeline meets the gate.
    let render = studio.render_video(
        &output,
        Some(duration),
        bay_preview::ExportSettings::default(),
        None,
    )?;

    Ok(serde_json::json!({
        "source": path,
        "output": render.get("path").cloned().unwrap_or(Value::String(output)),
        "cues": placed,
        "narrated": spoken,
        "durationSeconds": duration,
        "bytes": render.get("bytes").cloned().unwrap_or(Value::Null),
        "encodeSeconds": render.get("encodeSeconds").cloned().unwrap_or(Value::Null),
        "overruns": overruns,
    }))
}

#[cfg(test)]
mod tests {
    use super::background_job;
    use serde_json::json;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    #[test]
    fn background_job_returns_before_work_finishes() {
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let before = Instant::now();
        let started = background_job(
            "test-background",
            "timing",
            bay_jobs::Unit::Steps,
            1,
            move |_| {
                entered_tx.send(()).expect("test is listening");
                release_rx
                    .recv_timeout(Duration::from_secs(1))
                    .map_err(|error| error.to_string())?;
                Ok(json!({ "worked": true }))
            },
        )
        .expect("worker starts");

        assert_eq!(started["status"], "started");
        assert_eq!(started["finished"], false);
        assert!(
            before.elapsed() < Duration::from_millis(500),
            "dispatch waited for background work"
        );
        entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("worker entered");
        release_tx.send(()).expect("worker is waiting");

        let id = started["job"].as_u64().expect("job id");
        for _ in 0..100 {
            let status = bay_jobs::mcp::status(&json!({ "job": id }));
            if status["finished"] == true {
                assert_eq!(status["result"]["worked"], true, "{status}");
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("background job did not finish");
    }
}
