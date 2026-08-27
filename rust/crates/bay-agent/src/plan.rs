//! Turning a tool call into editor `Command`s, against a read-only project.
//!
//! Pure on purpose. Planning needs to know what is already on the timeline (which track a
//! layer maps to, whether an element id exists, what animations it already has), but it must
//! not *mutate* anything — the single writer on the main thread does that, from the
//! [`Command`]s this returns.
//!
//! That split buys three things: the logic is unit-testable with no GPU and no editor; a plan
//! made against a stale project can be rejected instead of silently applied; and everything an
//! agent does lands in the same reversible history as everything a human does, so `⌘Z` works
//! on both.

use std::collections::BTreeMap;

use bay_core::{Command, ElementRef, TrackLane};
use bay_project::moves::{self, Direction, Move, MoveParams};
use bay_project::{
    AnimationChannel, Easing, Effect, Element, ElementRole, ElementSource, MediaTime, Project,
    ShapeElement, ShapeKind, TextAlign, TextElement, Transform, is_caption_id,
};
use serde_json::Value;

/// What a tool call turned into.
#[derive(Debug)]
pub enum Planned {
    /// A read — answer it straight from the project, no mutation.
    Read(Value),
    /// A transaction: apply these commands as one undo entry.
    Tx {
        /// Short label for the "AI is editing" indicator, e.g. `add_text`.
        label: String,
        commands: Vec<Command>,
        /// The scene the plan was made against. The applier refuses on a mismatch, because
        /// `ElementRef` carries no scene and `ProjectPatch` applies to the *active* one — so a
        /// plan made for scene A must never land in scene B.
        scene_id: String,
        /// Ids this transaction introduces, echoed back so the agent can address them.
        new_ids: Vec<String>,
    },
}

/// Tools this planner can serve while the editor is attached. Anything else is routed
/// elsewhere or refused — deliberately explicit, so a newly added tool fails loudly here
/// rather than silently bypassing the live editor.
pub fn planned_tools() -> &'static [&'static str] {
    &[
        "project_info",
        "plan_create",
        "plan_get",
        "timeline",
        "check",
        "add_text",
        "add_shape",
        "add_image",
        "add_video",
        "add_audio",
        "group_create",
        "element_retime",
        "animate",
        "animate_many",
        "apply_move",
        "element_delete",
        // Revising what is already there. Creating was never the hard part.
        "element_move",
        "element_trim",
        "element_split",
        "element_source",
        "element_duplicate",
        "element_rename",
        "transform_set",
        "text_update",
        "effect_add",
        "effect_set",
        "effect_remove",
        "blend_set",
        "audio_set",
        "duck",
        "fade_set",
        "transition_add",
        "element_ripple_delete",
        "marker_add",
        "crop_set",
        "mask_set",
        "looks_list",
        "templates_list",
        "template_place",
        "subtitles_add",
        "subtitles_export",
    ]
}

/// Tools the editor answers itself because they produce a file rather than a command —
/// listed here only so [`available_tools`] can name them.
pub fn editor_tools() -> &'static [&'static str] {
    &["snapshot", "project_save"]
}

/// Tools that are about the machine rather than the document, and so must work even with no
/// project open.
pub fn machine_tools() -> &'static [&'static str] {
    &[
        "speech_status",
        "fonts_check",
        "runtime_status",
        "runtime_install",
        // Reporting what the machine can do needs no document, and must answer before a project
        // exists — choosing images is something an author does while deciding what to build.
        "vision_status",
        "stock_status",
        "stock_credits",
        // Generation is a machine capability: previewing cost/egress and producing a file do not
        // require an open project. The result is imported explicitly after its gates accept it.
        "gen_image",
        "gen_video",
        "gen_music",
        // The library is the user's, not a document's — it must be readable with nothing open.
        "library_list",
        "library_save",
        "library_collect",
        // Following and stopping background work needs no document — and must keep working
        // after one is closed, or a render started against a project the user then closed
        // becomes unfollowable.
        "job_status",
        "job_cancel",
    ]
}

/// Tools the *window* answers rather than a document: they create, list or open the thing the
/// other tools then edit.
///
/// These have to work with nothing open, or an agent that finds an empty bay is stuck — it
/// cannot create a project because no project is open, which is a deadlock with a polite error
/// message. Kept separate from [`machine_tools`] because these need the app's project library,
/// which this crate cannot see.
pub fn window_tools() -> &'static [&'static str] {
    &["project_create", "project_list", "project_load"]
}

/// Tools the headless MCP server answers that never reach an open window.
///
/// They exist because `bay-mcp`'s `Studio` owns capabilities the attached editor does not route
/// — sound-effect libraries, transcript editing, variant tournaments, critic passes. Listed
/// here, in the crate both the server and the UI can see, for one reason: the MCP settings pane
/// draws a switch per tool and cannot depend on `bay-mcp`. A tool absent from this list would be
/// served with no way to switch it off, which is a permission control with a hole in it.
///
/// `bay-mcp`'s `tool_vocabulary` test asserts this list and its own definitions agree in both
/// directions, so adding a tool there without adding it here fails the suite rather than
/// quietly shipping an unswitchable tool.
pub fn server_only_tools() -> &'static [&'static str] {
    &[
        "audio_react",
        "audio_smooth",
        "check_frames",
        "contact_sheet",
        "fonts_list",
        "formats_list",
        "critic_prepare",
        "critic_refresh",
        "critic_submit",
        "cut_by_transcript",
        "remove_silence_and_fillers",
        "room_tone",
        "runtime_remove",
        "sfx_add",
        "sfx_list",
        "sfx_search",
        "sound_add",
        "style_pick",
        "tournament_compare",
        "transcript_get",
        "transcript_search",
        "variant_create",
        "variant_register_render",
    ]
}

/// Every tool bay implements anywhere, sorted.
///
/// [`available_tools`] answers "what can an agent call right now?"; this answers "what exists?".
/// The settings pane needs the second: a pane built from the first would have no switch for a
/// tool that only the headless server serves.
pub fn all_tool_names() -> Vec<&'static str> {
    let mut all = available_tools();
    all.extend_from_slice(server_only_tools());
    all.sort_unstable();
    all.dedup();
    all
}

/// Every tool that works while the editor is open, for an error message that tells an agent
/// what to do instead of only what it cannot.
pub fn available_tools() -> Vec<&'static str> {
    let mut all: Vec<&'static str> = planned_tools()
        .iter()
        .chain(machine_tools())
        .chain(window_tools())
        .chain(editor_tools())
        .chain(crate::slow::slow_tools())
        .copied()
        .collect();
    all.sort_unstable();
    all
}

/// Answer a tool that needs no document. `None` if this is not one.
///
/// Separate from [`plan`] because [`plan`] takes a `&Project` it would have nothing to do
/// with: "is narration installed on this machine?" has an answer before any project exists,
/// and refusing it until one is open would be an odd thing to explain.
pub fn plan_without_document(name: &str, args: &Value) -> Option<Result<Value, String>> {
    match name {
        // Which fonts this machine has is not a property of any document, and it is the call
        // an agent makes *first* — the skill says to check families before using them. Gating
        // it behind an open project made the recommended first step the one that failed.
        "fonts_check" => {
            let families: Vec<String> = args
                .get("families")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            if families.is_empty() {
                return Some(Err(
                    "families must be a non-empty array of family names".into()
                ));
            }
            let mut raster = bay_text::TextRaster::new();
            let (available, missing): (Vec<_>, Vec<_>) = families
                .into_iter()
                .partition(|family| raster.has_family(family));
            Some(Ok(serde_json::json!({
                "available": available,
                "missing": missing,
            })))
        }
        "speech_status" => {
            let engine = bay_speech::SpeechEngine::new(bay_speech::SpeechConfig::default());
            let installed = engine.is_installed();
            let config = engine.config();
            // The catalogue is a constant, so it is answered from a table rather than by
            // starting the sidecar. Asking the sidecar would load a multi-gigabyte torch
            // runtime to read a hardcoded dictionary — which is why this used to refuse and
            // tell agents to close the app, a strange thing to ask of someone picking a voice.
            Some(Ok(serde_json::json!({
                "available": installed,
                "python": config.python,
                "script": config.script,
                "sampleRate": 24000,
                "voices": bay_speech::voices::catalogue(),
                // bay installs this itself now. The old hint sent agents to a dev shell script
                // that a downloaded app does not have and that needed uv already on the machine
                // — advice that could not work for the person receiving it.
                "hint": if installed {
                    Value::Null
                } else {
                    serde_json::json!(
                        "narration is not installed. Call runtime_install with component \
                         \"speech\" and bay will fetch it (~1.2 GB), or set BAY_KOKORO_PYTHON \
                         to an interpreter that already has kokoro."
                    )
                },
            })))
        }
        // Machine questions by definition: what is installed, and please install it. Both must
        // work with nothing open — an agent that finds a bare bay needs to be able to fix it
        // before it can do anything else.
        "runtime_status" => Some(Ok(bay_provision::mcp::runtime_status(args))),
        "runtime_install" => Some(bay_provision::mcp::runtime_install(args)),
        // Following and stopping background work is a machine question too: the job outlives
        // the document it was started against, so closing a project must not orphan a render.
        "job_status" => Some(Ok(bay_jobs::mcp::status(args))),
        "job_cancel" => Some(bay_jobs::mcp::cancel(args)),
        _ => None,
    }
}

fn number(args: &Value, key: &str, fallback: f64) -> f64 {
    args.get(key).and_then(|v| v.as_f64()).unwrap_or(fallback)
}

fn required_number(args: &Value, key: &str) -> Result<f64, String> {
    args.get(key)
        .and_then(|v| v.as_f64())
        .ok_or_else(|| format!("missing required number field {key:?}"))
}

fn text(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(|v| v.as_str()).map(str::to_string)
}

fn secs(seconds: f64) -> Result<MediaTime, String> {
    if !seconds.is_finite() || seconds < 0.0 {
        return Err(format!(
            "time must be a finite, non-negative number of seconds (got {seconds})"
        ));
    }
    MediaTime::from_seconds_f64(seconds)
        .ok_or_else(|| format!("{seconds}s is outside the representable time range"))
}

fn transform_from(args: &Value) -> Transform {
    transform_framed(args, None)
}

/// As [`transform_from`], with a named framing from the kit supplying the defaults.
fn transform_framed(args: &Value, framing: Option<&bay_project::Framing>) -> Transform {
    let (x, y, anchor_x, anchor_y, scale) = match framing {
        Some(f) => (f.x, f.y, f.anchor_x, f.anchor_y, f.scale),
        None => (0.5, 0.5, 0.5, 0.5, 1.0),
    };
    Transform {
        x: number(args, "x", f64::from(x)) as f32,
        y: number(args, "y", f64::from(y)) as f32,
        scale: number(args, "scale", f64::from(scale)) as f32,
        rotation: number(args, "rotation", 0.0) as f32,
        opacity: number(args, "opacity", 1.0) as f32,
        scale_x: number(args, "scaleX", 1.0) as f32,
        scale_y: number(args, "scaleY", 1.0) as f32,
        anchor_x: number(args, "anchorX", f64::from(anchor_x)) as f32,
        anchor_y: number(args, "anchorY", f64::from(anchor_y)) as f32,
        tilt_x: number(args, "tiltX", 0.0) as f32,
        tilt_y: number(args, "tiltY", 0.0) as f32,
        ..Transform::default()
    }
}

/// The kit this project draws with, and — when it does not have one yet — the command that
/// commits it, to go in the same transaction as whatever is being placed.
///
/// The editor window plans `add_text` here rather than through `bay-mcp`'s studio, so this is
/// where the same narrowing has to hold: a project made in the app, or opened from before kits
/// existed, takes one the first time type lands on it instead of refusing to draw. One undo
/// step covers both, so undoing the first title also undoes the choice it forced.
fn kit_for(project: &Project) -> (bay_project::StyleKit, Vec<Command>) {
    if let Some(kit) = &project.settings.kit {
        return (kit.clone(), Vec::new());
    }
    let recent = bay_project::StyleHistory::open_default()
        .map(|history| history.recent(bay_project::kit::HISTORY_EXCLUDED))
        .unwrap_or_default();
    let brief = format!("{} {}", project.metadata.name, project.metadata.id);
    let offered = bay_project::kit::offer(&brief, &bay_project::kit::today(), &recent);
    let kit = offered
        .first()
        .copied()
        .cloned()
        .unwrap_or_else(|| bay_project::builtin_kits()[0].clone());
    // Read the history, never write it. Planning is supposed to be a pure function of the
    // project and the arguments, and a planner that left a mark on the user's data directory
    // would make every test that plans an `add_text` change which kits they are offered next.
    // Recording belongs to whoever *commits* a choice — `style_pick` and `project_create`.
    let command = Command::SetStyleKit {
        kit: Box::new(kit.clone()),
    };
    (kit, vec![command])
}

/// A named framing from the kit, or `None` when the caller did not ask for one.
fn framing_for<'a>(
    args: &Value,
    kit: &'a bay_project::StyleKit,
) -> Result<Option<&'a bay_project::Framing>, String> {
    let Some(name) = text(args, "framing") else {
        return Ok(None);
    };
    kit.framing(&name).map(Some).ok_or_else(|| {
        format!(
            "the {:?} kit has no framing {name:?} — it declares {:?}",
            kit.id,
            kit.framing_names()
        )
    })
}

/// A fresh element id that does not collide with anything already in the project.
///
/// Minting here, from the real project, is what stops the editor and an agent from both
/// handing out `text-3`: `Track::element_mut` resolves the first match, so a duplicate id
/// silently makes every later edit address the wrong element.
/// The role a text or shape must declare. Same wording as the headless surface, because the
/// two front ends are the same tool and an agent must not learn two different vocabularies.
fn required_role(args: &Value, tool: &str) -> Result<ElementRole, String> {
    let Some(name) = args.get("role").and_then(|v| v.as_str()) else {
        return Err(format!(
            "{tool} requires \"role\": what this element is FOR. One of {:?}.",
            ElementRole::NAMES
        ));
    };
    ElementRole::from_wire(name).ok_or_else(|| {
        format!(
            "unknown role {name:?} — use one of {:?}",
            ElementRole::NAMES
        )
    })
}

/// The role on a tool that accepts one without insisting.
fn optional_role(args: &Value) -> Result<ElementRole, String> {
    match args.get("role").and_then(|v| v.as_str()) {
        Some(name) => ElementRole::from_wire(name).ok_or_else(|| {
            format!(
                "unknown role {name:?} — use one of {:?}",
                ElementRole::NAMES
            )
        }),
        None => Ok(ElementRole::default()),
    }
}

/// Refuse an id bay reserves for its own output — see `bay_project::is_caption_id`. Provenance
/// a caller can set is provenance a caller can launder.
fn reject_reserved_id(id: &str) -> Result<(), String> {
    if is_caption_id(id) {
        return Err(format!(
            "{id:?} is reserved: ids of the form caption-<number> belong to narrate and the \
             subtitle tools, which is how captions are told apart from what you wrote. Pick \
             another id."
        ));
    }
    Ok(())
}

fn mint_id(project: &Project, prefix: &str) -> String {
    let taken: Vec<&str> = project
        .scenes
        .iter()
        .flat_map(|scene| scene.tracks.iter())
        .flat_map(|track| track.elements.iter())
        .map(|element| element.id())
        .collect();
    (1..)
        .map(|n| format!("{prefix}-{n}"))
        .find(|candidate| !taken.iter().any(|id| *id == candidate))
        .expect("an unused id always exists")
}

/// The track a `layer` maps to, plus any `AddTrack` commands needed to make it exist.
///
/// Layer 0 is the main lane; layer n is `overlay[n-1]`, created on demand.
fn track_for_layer(project: &Project, layer: usize) -> (String, Vec<Command>) {
    let scene = project.active_scene();
    if layer == 0 {
        return (scene.tracks.main.id.clone(), Vec::new());
    }
    let mut commands = Vec::new();
    let existing = scene.tracks.overlay.len();
    for index in existing..layer {
        commands.push(Command::AddTrack {
            lane: TrackLane::Overlay,
            id: format!("track-overlay-{}", index + 1),
            name: format!("Overlay {}", index + 1),
        });
    }
    (format!("track-overlay-{layer}"), commands)
}

/// Find an element by id, as a track-qualified reference.
fn find_ref(project: &Project, element_id: &str) -> Option<ElementRef> {
    project.active_scene().tracks.iter().find_map(|track| {
        track
            .elements
            .iter()
            .any(|element| element.id() == element_id)
            .then(|| ElementRef::new(track.id.clone(), element_id.to_string()))
    })
}

/// Whether this call is asking for a duck.
///
/// `duck` always is. `audio_set` is only when it names what to duck under — otherwise it is
/// still the level-and-mute tool it has always been, and silently keyframing a clip somebody
/// only wanted to turn down would be a worse surprise than any error message.
fn wants_a_duck(name: &str, args: &Value) -> bool {
    name == "duck" || args.get("duckUnder").is_some()
}

/// Read the duck parameters and derive the curve.
///
/// The three numbers that are a mix decision — depth, attack, release — come from the caller.
/// **Where the lines are does not**: the agent must never hand-compute 24 keyframe times from
/// six line starts, because avoiding exactly that arithmetic is why the bed got chopped into 13
/// clips instead. Naming no clips at all means "every line on this timeline", which is the
/// common case and the one worth making free.
fn derive_duck(
    project: &Project,
    bed: &Element,
    args: &Value,
) -> Result<bay_project::Duck, String> {
    let params = bay_project::DuckParams {
        depth_db: number(args, "depthDb", 8.0) as f32,
        attack_ms: number(args, "attackMs", 150.0),
        release_ms: number(args, "releaseMs", 500.0),
        pre_roll_ms: number(args, "preRollMs", 250.0),
        hold_ms: number(args, "holdMs", 150.0),
        join_gap_ms: number(args, "joinGapMs", 1500.0),
    };

    let named: Vec<String> = ["underIds", "duckUnder"]
        .iter()
        .filter_map(|key| args.get(*key))
        .filter_map(|value| value.as_array())
        .flatten()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect();

    let scene = project.active_scene();
    let under: Vec<&Element> = if named.is_empty() {
        // Every speech clip, which is what `narrate` stamps its own output as. A project whose
        // narration predates the role field gets it inferred on load from the file name.
        scene
            .tracks
            .audio
            .iter()
            .flat_map(|track| track.elements.iter())
            .filter(|element| {
                element.audio_role() == Some(bay_project::AudioRole::Speech)
                    && element.id() != bed.id()
            })
            .collect()
    } else {
        let mut found = Vec::new();
        for id in &named {
            let element = scene
                .tracks
                .iter()
                .flat_map(|track| track.elements.iter())
                .find(|element| element.id() == id)
                .ok_or_else(|| format!("no element {id:?} on the timeline"))?;
            found.push(element);
        }
        found
    };
    if under.is_empty() {
        return Err(format!(
            "nothing to duck {:?} under — name the clips in underIds, or place the narration \
             with narrate (which marks it as speech) and call this again",
            bed.id()
        ));
    }

    bay_project::duck::duck(bed, &under, &params)
}

/// The curve a duck would write, as JSON, without applying anything.
///
/// The tool answers with what it wrote — 25 keyframes an agent cannot see is exactly the black
/// box the 13-clip hack was reaching for a way around. `None` when the call is not a duck or
/// could not be planned; the apply path reports the same failure with the same message.
pub fn duck_report(project: &Project, name: &str, args: &Value) -> Option<Value> {
    if !wants_a_duck(name, args) {
        return None;
    }
    let bed_id = text(args, "bedId").or_else(|| text(args, "elementId"))?;
    let reference = find_ref(project, &bed_id)?;
    let element = project.active_scene().element(&reference)?;
    let Element::Audio(audio) = element else {
        return None;
    };
    // Against the level this call is setting, not the one the clip has — the curve reported has
    // to be the curve applied.
    let mut updated = audio.clone();
    if let Some(volume) = args.get("volume").and_then(|v| v.as_f64()) {
        updated.volume = volume as f32;
    }
    let derived = derive_duck(project, &Element::Audio(updated), args).ok()?;
    Some(serde_json::json!({
        "bedId": bed_id,
        "baseGain": round4(derived.base_gain as f64),
        "duckedGain": round4(derived.ducked_gain as f64),
        "depthDb": round4(
            20.0 * f64::from(derived.base_gain / derived.ducked_gain).log10(),
        ),
        "lines": derived
            .spans
            .iter()
            .map(|(from, to)| serde_json::json!({
                "startSeconds": round4(*from),
                "endSeconds": round4(*to),
            }))
            .collect::<Vec<_>>(),
        "keys": derived
            .keys
            .iter()
            .map(|key| serde_json::json!({
                "t": round4(key.time.to_seconds_f64()),
                "value": round4(f64::from(key.value)),
                "easing": easing_name(key.easing),
            }))
            .collect::<Vec<_>>(),
    }))
}

fn round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

/// The wire spelling of an easing, from the same table the parser reads — so a curve reported
/// back can be passed straight into `animate` without a translation step.
fn easing_name(easing: Easing) -> &'static str {
    EASINGS
        .iter()
        .find(|name| parse_easing(Some(name)).ok() == Some(easing))
        .copied()
        .unwrap_or("linear")
}

/// The effects the compositor actually renders. Naming one it does not know would attach a
/// no-op the agent then cannot see the absence of — worse than refusing it.
const SUPPORTED_EFFECTS: &[&str] = &[
    "brightness",
    "contrast",
    "saturation",
    "blur",
    "lut",
    "drop-shadow",
];

/// Resolve the `elementId` argument every revising tool takes.
fn require_element<'a>(
    project: &'a Project,
    args: &Value,
) -> Result<(ElementRef, &'a Element), String> {
    let element_id = text(args, "elementId")
        .ok_or_else(|| "missing required string field \"elementId\"".to_string())?;
    let reference = find_ref(project, &element_id)
        .ok_or_else(|| format!("no element {element_id:?} on the timeline"))?;
    let element = project
        .active_scene()
        .element(&reference)
        .ok_or_else(|| format!("no element {element_id:?} on the timeline"))?;
    Ok((reference, element))
}

/// An effect id nothing else on the timeline is using.
fn mint_effect_id(project: &Project) -> String {
    let taken: Vec<&str> = project
        .active_scene()
        .tracks
        .iter()
        .flat_map(|track| track.elements.iter())
        .flat_map(|element| element.effects().iter())
        .map(|effect| effect.id.as_str())
        .collect();
    (1..)
        .map(|n| format!("fx-{n}"))
        .find(|candidate| !taken.iter().any(|id| *id == candidate))
        .expect("an unused id exists")
}

/// The `params` object an effect tool carries, validated. Every value is a finite scalar —
/// a NaN reaching a shader uniform is a frame of garbage, not an error message.
fn effect_params(args: &Value) -> Result<BTreeMap<String, f32>, String> {
    let mut params = BTreeMap::new();
    let Some(object) = args.get("params").and_then(|v| v.as_object()) else {
        return Ok(params);
    };
    for (key, value) in object {
        let number = value
            .as_f64()
            .ok_or_else(|| format!("effect param {key:?} must be a number"))?;
        if !number.is_finite() {
            return Err(format!("effect param {key:?} must be finite"));
        }
        params.insert(key.clone(), number as f32);
    }
    Ok(params)
}

/// Blend modes are named by their wire spelling, so the enum's own serde is the parser —
/// hand-writing a second mapping is how a name comes to work in one front end and not the other.
fn parse_blend_mode(name: &str) -> Result<bay_project::BlendMode, String> {
    serde_json::from_value(Value::String(name.to_string())).map_err(|_| {
        let known: Vec<Value> = bay_project::BlendMode::ALL
            .iter()
            .filter_map(|mode| serde_json::to_value(mode).ok())
            .collect();
        format!("unknown blend mode {name:?} — use one of {known:?}")
    })
}

fn parse_align(name: Option<&str>) -> Result<TextAlign, String> {
    Ok(match name.unwrap_or("left") {
        "left" => TextAlign::Left,
        "center" => TextAlign::Center,
        "right" => TextAlign::Right,
        other => return Err(format!("unknown align {other:?} — left, center or right")),
    })
}

fn parse_role(name: &str) -> Result<bay_project::ElementRole, String> {
    bay_project::ElementRole::from_wire(name).ok_or_else(|| {
        format!(
            "unknown role {name:?} — use one of {:?}",
            bay_project::ElementRole::NAMES
        )
    })
}

fn parse_tone(name: &str) -> Result<bay_project::Tone, String> {
    bay_project::Tone::from_wire(name).ok_or_else(|| {
        format!(
            "unknown tone {name:?} — use one of {:?}",
            bay_project::Tone::NAMES
        )
    })
}

/// The typography values that stopped being arguments when style kits shipped.
///
/// One function, consulted by every planned tool that used to take them, so the two front ends
/// cannot come to disagree about whether `fontSize` still works.
fn reject_raw_style(args: &Value, tool: &str) -> Result<(), String> {
    for key in ["fontSize", "fontFamily", "fontWeight", "color"] {
        if args.get(key).is_some_and(|value| !value.is_null()) {
            return Err(format!(
                "{tool} does not take {key:?} any more — type size, face, weight and colour come \
                 from the project's style kit, through the element's \"role\" and \"tone\". Set \
                 those instead, or call style_pick to change the kit."
            ));
        }
    }
    Ok(())
}

fn text_decorations(args: &Value) -> Option<bay_project::TextDecorations> {
    let stroke = args.get("stroke").and_then(|value| {
        Some(bay_project::TextStroke {
            width: value.get("width")?.as_f64()? as f32,
            color: value
                .get("color")
                .and_then(Value::as_str)
                .unwrap_or("#000000")
                .to_string(),
        })
    });
    let shadow = args.get("shadow").and_then(|value| {
        Some(bay_project::TextShadow {
            offset_x: value.get("offsetX")?.as_f64()? as f32,
            offset_y: value.get("offsetY")?.as_f64()? as f32,
            blur: value.get("blur")?.as_f64()? as f32,
            color: value
                .get("color")
                .and_then(Value::as_str)
                .unwrap_or("#00000099")
                .to_string(),
        })
    });
    let plate = args.get("plate").map(|value| bay_project::TextPlate {
        color: value
            .get("color")
            .and_then(Value::as_str)
            .unwrap_or("#000000B3")
            .to_string(),
        padding_x: value
            .get("paddingX")
            .and_then(Value::as_f64)
            .unwrap_or(16.0) as f32,
        padding_y: value
            .get("paddingY")
            .and_then(Value::as_f64)
            .unwrap_or(10.0) as f32,
        radius: value.get("radius").and_then(Value::as_f64).unwrap_or(12.0) as f32,
    });
    (stroke.is_some() || shadow.is_some() || plate.is_some()).then_some(
        bay_project::TextDecorations {
            stroke,
            shadow,
            plate,
        },
    )
}

fn describe_element(element: &Element) -> Value {
    let mut out = serde_json::json!({
        "id": element.id(),
        "kind": element.kind().label(),
        "startSeconds": element.start().to_seconds_f64(),
        "durationSeconds": element.duration().to_seconds_f64(),
        // Read back what an element is and who put it there — the same two fields the headless
        // timeline reports, so an agent sees one timeline whichever front end answers it.
        "source": element.source().as_str(),
        "role": element
            .role()
            .map(|role| role.as_str())
            .or_else(|| element.audio_role().map(|role| role.as_str())),
    });
    if let Some(t) = element.transform() {
        out["transform"] = serde_json::json!({
            "x": t.x, "y": t.y, "scale": t.scale,
            "scaleX": t.scale_x, "scaleY": t.scale_y,
            "anchorX": t.anchor_x, "anchorY": t.anchor_y,
            "rotation": t.rotation, "opacity": t.opacity,
        });
    }
    // Which part of the file is playing. Without it an agent can read a clip's position and
    // length but not what is actually inside it, which makes a trim a guess.
    if let Some(trim_start) = element.source_start() {
        out["trimStartSeconds"] = serde_json::json!(trim_start.to_seconds_f64());
    }
    if let Some(media_id) = element.media_id() {
        out["mediaId"] = serde_json::json!(media_id);
    }
    if let Some(animations) = element.animations()
        && !animations.is_empty()
    {
        out["animated"] = serde_json::json!(animations.keys().collect::<Vec<_>>());
    }
    if !element.effects().is_empty() {
        out["effects"] = serde_json::json!(
            element
                .effects()
                .iter()
                .map(|effect| serde_json::json!({
                    "id": effect.id,
                    "type": effect.effect_type,
                    "enabled": effect.enabled,
                    "params": effect.params,
                }))
                .collect::<Vec<_>>()
        );
    }
    if let Element::Text(text) = element {
        out["content"] = serde_json::json!(text.content);
        out["fontSize"] = serde_json::json!(text.font_size);
        out["color"] = serde_json::json!(text.color);
    }
    if let Element::Shape(shape) = element {
        out["color"] = serde_json::json!(shape.color);
    }
    out
}

/// Every easing an author can name, in the order a picker should show them: the entrances
/// first, then their mirrors, then the two specials.
///
/// One list, so the schema an agent reads and the parser it is validated against cannot drift
/// — a curve offered in the enum and rejected by the parser is a tool call that fails for no
/// reason the caller can see.
pub const EASINGS: &[&str] = &[
    "linear",
    "ease-in",
    "ease-out",
    "ease-in-out",
    "power-out",
    "power-in",
    "expo-out",
    "expo-in",
    "power4-out",
    "power4-in",
    "spring-out",
    "sine-in-out",
    "back-out",
    "hold",
];

/// The registry move a call names, with the direction and distance it asked for.
///
/// `None` means the call is hand-keyed — legal, and reported as `off-vocabulary-motion` per
/// channel once it is on the timeline. Everything about *how far* and *how long* is either the
/// move's own or a bounded multiplier on it: duration and curve are not arguments, because a
/// duration that is an argument becomes 76 moves of 0.098 s.
fn named_move(args: &Value) -> Result<Option<(&'static Move, MoveParams)>, String> {
    let Some(id) = text(args, "move") else {
        return Ok(None);
    };
    let chosen = moves::find(&id).ok_or_else(|| {
        format!(
            "no move {id:?} — bay's vocabulary is {}. Call apply_move with no arguments to see \
             what each one is for.",
            moves::ids().join(", ")
        )
    })?;
    let direction = match text(args, "direction") {
        Some(name) => Some(Direction::from_wire(&name).ok_or_else(|| {
            format!("unknown direction {name:?} — one of {:?}", Direction::NAMES)
        })?),
        None => None,
    };
    Ok(Some((
        chosen,
        MoveParams {
            at: number(args, "at", 0.0),
            direction,
            distance: number(args, "distance", 1.0) as f32,
        },
    )))
}

/// The whole registry, as an agent reads it. Every entry says what it is for and — more usefully
/// — when it is the wrong choice.
fn move_catalogue() -> Value {
    serde_json::json!({
        "moves": moves::MOVES.iter().map(|m| m.describe()).collect::<Vec<_>>(),
        "note": "Each move carries its own duration, curve and amplitude. \"direction\" is the \
                 way it TRAVELS; \"distance\" is a multiplier on its own amplitude, not a number \
                 of pixels. Reach them from animate/animate_many with \"move\" as well.",
    })
}

fn parse_easing(name: Option<&str>) -> Result<Easing, String> {
    Ok(match name.unwrap_or("linear") {
        "linear" => Easing::Linear,
        "ease-in" => Easing::EaseIn,
        "ease-out" => Easing::EaseOut,
        "ease-in-out" => Easing::EaseInOut,
        "power-out" => Easing::PowerOut,
        "power-in" => Easing::PowerIn,
        "expo-out" => Easing::ExpoOut,
        "expo-in" => Easing::ExpoIn,
        "power4-out" => Easing::Power4Out,
        "power4-in" => Easing::Power4In,
        "spring-out" => Easing::SpringOut,
        "sine-in-out" => Easing::SineInOut,
        "back-out" => Easing::BackOut,
        "hold" => Easing::Hold,
        other => {
            return Err(format!(
                "unknown easing {other:?} — use one of {}",
                EASINGS.join(", ")
            ));
        }
    })
}

fn plan_draft(args: &Value) -> Result<crate::trust::PlanDraft, String> {
    let beats = args
        .get("beats")
        .and_then(Value::as_array)
        .ok_or_else(|| "missing required array field \"beats\"".to_string())?
        .iter()
        .map(|beat| {
            let slots = beat
                .get("assetSlots")
                .and_then(Value::as_array)
                .map(|slots| {
                    slots
                        .iter()
                        .map(|slot| {
                            Ok(bay_project::AssetSlot {
                                id: slot
                                    .get("id")
                                    .and_then(Value::as_str)
                                    .ok_or_else(|| "asset slot needs string id".to_string())?
                                    .to_string(),
                                purpose: slot
                                    .get("purpose")
                                    .and_then(Value::as_str)
                                    .ok_or_else(|| "asset slot needs string purpose".to_string())?
                                    .to_string(),
                                required: slot
                                    .get("required")
                                    .and_then(Value::as_bool)
                                    .unwrap_or(false),
                            })
                        })
                        .collect::<Result<Vec<_>, String>>()
                })
                .transpose()?
                .unwrap_or_default();
            Ok(bay_project::BeatPlan {
                id: beat
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "beat needs string id".to_string())?
                    .to_string(),
                role: beat
                    .get("role")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "beat needs string role".to_string())?
                    .to_string(),
                marker_seconds: beat
                    .get("at")
                    .and_then(Value::as_f64)
                    .ok_or_else(|| "beat needs numeric at".to_string())?,
                intent: beat
                    .get("intent")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "beat needs string intent".to_string())?
                    .to_string(),
                asset_slots: slots,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(crate::trust::PlanDraft {
        brief: args
            .get("brief")
            .and_then(Value::as_str)
            .ok_or_else(|| "missing required string field \"brief\"".to_string())?
            .to_string(),
        format: args
            .get("format")
            .and_then(Value::as_str)
            .ok_or_else(|| "missing required string field \"format\"".to_string())?
            .to_string(),
        target_runtime_seconds: args
            .get("targetRuntimeSeconds")
            .and_then(Value::as_f64)
            .ok_or_else(|| "missing required number field \"targetRuntimeSeconds\"".to_string())?,
        beats,
    })
}

/// Plan one tool call against `project`.
pub fn plan(name: &str, args: &Value, project: &Project) -> Result<Planned, String> {
    let scene_id = project.active_scene().id.clone();

    match name {
        // ------------------------------------------------------------------ reads
        "plan_get" => Ok(Planned::Read(serde_json::json!({
            "plan": project.settings.plan,
            "formats": crate::trust::format_registry(),
        }))),
        "plan_create" => {
            let mut artifact = crate::trust::create_plan(plan_draft(args)?)?;
            let approve = args
                .get("approve")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if approve {
                artifact = crate::trust::commit_plan(artifact);
            }
            let mut commands = vec![Command::SetPlan {
                plan: Box::new(artifact.clone()),
            }];
            if approve {
                commands.extend(crate::trust::marker_commands(&artifact)?);
            }
            Ok(Planned::Tx {
                label: "plan_create".into(),
                commands,
                scene_id,
                new_ids: artifact
                    .beats
                    .iter()
                    .map(|beat| format!("plan-{}", beat.id))
                    .collect(),
            })
        }
        "project_info" => {
            let scene = project.active_scene();
            let visual: usize = scene
                .tracks
                .iter()
                .filter(|t| !matches!(t.kind, bay_project::TrackKind::Audio))
                .map(|t| t.elements.len())
                .sum();
            let audio: usize = scene.tracks.audio.iter().map(|t| t.elements.len()).sum();
            let duration = scene
                .tracks
                .iter()
                .flat_map(|t| t.elements.iter())
                .map(|e| e.end().to_seconds_f64())
                .fold(0.0_f64, f64::max);
            // Same two listings the headless `project_info` returns, so an agent working
            // against an open window can read back what its own motion looks like.
            let fps = project.settings.fps.as_f64() as f32;
            let off_vocabulary: Vec<String> = moves::off_vocabulary(scene, fps)
                .iter()
                .map(|finding| finding.message())
                .collect();
            Ok(Planned::Read(serde_json::json!({
                "name": project.metadata.name,
                "id": project.metadata.id,
                "background": project.settings.background,
                "offVocabularyMotion": off_vocabulary,
                "moveHistogram": moves::histogram(scene),
                "motionSignatures": moves::signatures(scene),
                "canvas": {
                    "width": project.settings.canvas.width,
                    "height": project.settings.canvas.height,
                },
                "fps": project.settings.fps.as_f64(),
                "durationSeconds": duration,
                "visualElements": visual,
                "audioElements": audio,
                "mediaAssets": project.media.len(),
                "layers": 1 + scene.tracks.overlay.len(),
                "attached": true,
            })))
        }
        "templates_list" => {
            let library = bay_project::TemplateLibrary::open_default();
            let templates = match &library {
                Some(library) => library.all(),
                // No data directory (a locked-down environment) still gets the built-ins:
                // they are code, and code does not need a disk.
                None => bay_project::builtin_templates(),
            };
            Ok(Planned::Read(serde_json::json!({
                "templates": templates
                    .iter()
                    .map(|template| serde_json::json!({
                        "id": template.id,
                        "name": template.name,
                        "description": template.description,
                        "durationSeconds": template.duration().to_seconds_f64(),
                        "textSlots": template.text_slots,
                        "elements": template.elements.len(),
                    }))
                    .collect::<Vec<_>>(),
            })))
        }

        "template_place" => {
            let id = text(args, "templateId")
                .ok_or_else(|| "missing required string field \"templateId\"".to_string())?;
            let library = bay_project::TemplateLibrary::open_default();
            let template = library
                .as_ref()
                .and_then(|library| library.get(&id))
                .or_else(|| {
                    bay_project::builtin_templates()
                        .into_iter()
                        .find(|template| template.id == id)
                })
                .ok_or_else(|| {
                    format!("no template {id:?} — call templates_list to see what there is")
                })?;

            let start = secs(number(args, "start", 0.0))?;
            let words: Vec<String> = args
                .get("text")
                .and_then(|v| v.as_array())
                .map(|entries| {
                    entries
                        .iter()
                        .map(|entry| entry.as_str().unwrap_or_default().to_string())
                        .collect()
                })
                .unwrap_or_default();

            let layer = args.get("layer").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            let (track_id, mut commands) = track_for_layer(project, layer);
            // One prefix per placement, so the same template placed twice does not collide
            // with itself.
            let prefix = mint_id(project, &id);
            let mut placed = template.instantiate(start, &prefix, &words);
            // A template knows what each of its slots is *for*; the kit knows what that looks
            // like in this project. Restyling here is what stops a placed template arriving in
            // the typography and colour it happened to be authored in — which would be a second
            // look inside a project that has committed to one.
            if let Some(kit) = &project.settings.kit {
                for element in &mut placed {
                    kit.apply_to(element, None);
                }
            }
            let new_ids: Vec<String> = placed.iter().map(|e| e.id().to_string()).collect();
            for element in placed {
                commands.push(Command::AddElement {
                    track_id: track_id.clone(),
                    element,
                    select: false,
                });
            }
            Ok(Planned::Tx {
                label: "template_place".into(),
                commands,
                scene_id,
                new_ids,
            })
        }

        "looks_list" => Ok(Planned::Read(serde_json::json!({
            "looks": bay_effects::LOOKS
                .iter()
                .map(|look| serde_json::json!({
                    "id": look.id,
                    "name": look.name,
                    "description": look.description,
                }))
                .collect::<Vec<_>>(),
            // The move registry rides along here as well as on `apply_move`, because a live MCP
            // session's tool list is cached when it connects: a new tool *name* is unreachable
            // in one, and a new key on an existing tool's response is not.
            "moves": moves::MOVES.iter().map(|m| m.describe()).collect::<Vec<_>>(),
        }))),

        // The whole report, envelope and all. `ok: true` used to be the first thing an agent
        // read and it meant "no errors" on a suite where 25 of 27 codes could not fire — so
        // there is no boolean here any more. `status` is three-state and `skipped` says what
        // could not be evaluated, which is the difference between a pass and a silence.
        "check" => {
            let report = match args.get("duration") {
                Some(value) => {
                    let seconds = value
                        .as_f64()
                        .filter(|seconds| seconds.is_finite() && *seconds > 0.0)
                        .ok_or_else(|| {
                            "duration must be a finite number greater than zero".to_string()
                        })?;
                    bay_core::check::check_duration(project, secs(seconds)?)
                }
                None => bay_core::check(project),
            };
            Ok(Planned::Read(
                serde_json::to_value(report).map_err(|e| e.to_string())?,
            ))
        }

        "timeline" => {
            let scene = project.active_scene();
            let layers: Vec<Value> = std::iter::once(&scene.tracks.main)
                .chain(scene.tracks.overlay.iter())
                .enumerate()
                .map(|(index, track)| {
                    serde_json::json!({
                        "layer": index,
                        "trackId": track.id,
                        "elements": track.elements.iter().map(describe_element).collect::<Vec<_>>(),
                    })
                })
                .collect();
            let audio: Vec<Value> = scene
                .tracks
                .audio
                .iter()
                .flat_map(|t| t.elements.iter())
                .map(describe_element)
                .collect();
            let duration = scene
                .tracks
                .iter()
                .flat_map(|t| t.elements.iter())
                .map(|e| e.end().to_seconds_f64())
                .fold(0.0_f64, f64::max);
            Ok(Planned::Read(serde_json::json!({
                "durationSeconds": duration,
                "layers": layers,
                "audio": audio,
            })))
        }

        // ----------------------------------------------------------- transactions
        "add_text" => {
            let start = required_number(args, "start")?;
            let duration = required_number(args, "duration")?;
            if duration <= 0.0 {
                return Err("duration must be greater than zero".into());
            }
            let content = text(args, "content")
                .ok_or_else(|| "missing required string field \"content\"".to_string())?;
            let layer = number(args, "layer", 0.0).max(0.0) as usize;
            let (track_id, mut commands) = track_for_layer(project, layer);
            let role = required_role(args, "add_text")?;
            reject_raw_style(args, "add_text")?;
            let (kit, commit) = kit_for(project);
            commands.extend(commit);
            let tone = match args.get("tone").and_then(|v| v.as_str()) {
                Some(name) => parse_tone(name)?,
                None => bay_project::Tone::default_for(role),
            };
            let style = kit.resolve(role, tone);
            let framing = framing_for(args, &kit)?;
            let id = text(args, "id").unwrap_or_else(|| mint_id(project, "text"));
            reject_reserved_id(&id)?;
            if find_ref(project, &id).is_some() {
                return Err(format!("an element with id {id:?} already exists"));
            }

            let element = Element::Text(TextElement {
                name: content.chars().take(24).collect(),
                id: id.clone(),
                start: secs(start)?,
                duration: secs(duration)?,
                fade_in: MediaTime::ZERO,
                fade_out: MediaTime::ZERO,
                content,
                font_size: style.size,
                color: style.color.clone(),
                transform: transform_framed(args, framing),
                effects: Vec::new(),
                animations: BTreeMap::new(),
                blend_mode: Default::default(),
                mask: None,
                font_family: Some(style.family.clone()),
                font_weight: style.weight,
                align: match args.get("align").and_then(|v| v.as_str()).unwrap_or("left") {
                    "center" => TextAlign::Center,
                    "right" => TextAlign::Right,
                    _ => TextAlign::Left,
                },
                letter_spacing: number(args, "letterSpacing", f64::from(style.tracking)) as f32,
                line_height: number(args, "lineHeight", f64::from(style.line_height)) as f32,
                decorations: text_decorations(args),
                karaoke: None,
                type_on: None,
                source: ElementSource::Author,
                role,
            });
            commands.push(Command::AddElement {
                track_id,
                element,
                // Never steal the user's selection: an agent working in the background must not
                // change what the human has highlighted.
                select: false,
            });
            Ok(Planned::Tx {
                label: "add_text".into(),
                commands,
                scene_id,
                new_ids: vec![id],
            })
        }

        "add_shape" => {
            let start = required_number(args, "start")?;
            let duration = required_number(args, "duration")?;
            if duration <= 0.0 {
                return Err("duration must be greater than zero".into());
            }
            let shape = match args.get("shape").and_then(|v| v.as_str()).unwrap_or("rect") {
                "rect" => ShapeKind::Rect {
                    radius: number(args, "radius", 0.0) as f32,
                },
                "ellipse" => ShapeKind::Ellipse,
                other => return Err(format!("unknown shape {other:?} — rect or ellipse")),
            };
            let layer = number(args, "layer", 0.0).max(0.0) as usize;
            let (track_id, mut commands) = track_for_layer(project, layer);
            let role = required_role(args, "add_shape")?;
            reject_raw_style(args, "add_shape")?;
            let (kit, commit) = kit_for(project);
            commands.extend(commit);
            let tone = match args.get("tone").and_then(|v| v.as_str()) {
                Some(name) => parse_tone(name)?,
                None => bay_project::Tone::default_for(role),
            };
            let color = kit.color(tone).to_string();
            // A gradient names two TONES, not two colours: the kit stays the only place a
            // value comes from, exactly as `tone` already works for the solid fill.
            let gradient = match (
                args.get("gradientFrom").and_then(|v| v.as_str()),
                args.get("gradientTo").and_then(|v| v.as_str()),
            ) {
                (Some(from), Some(to)) => Some(bay_project::Gradient {
                    from: kit.color(parse_tone(from)?).to_string(),
                    to: kit.color(parse_tone(to)?).to_string(),
                    angle: args
                        .get("gradientAngle")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0) as f32,
                }),
                (None, None) => None,
                _ => {
                    return Err(
                        "a gradient needs both gradientFrom and gradientTo — one stop is a \
                         solid fill, which is what `tone` already gives you"
                            .into(),
                    );
                }
            };
            // An outline instead of a fill, again from a tone. `strokeWidth` alone is enough:
            // the colour falls back to the shape's own tone, which is what an outlined version
            // of the same mark should be.
            let stroke = match args.get("strokeWidth").and_then(|v| v.as_f64()) {
                Some(width) if width > 0.0 => Some(bay_project::Stroke {
                    color: match args.get("strokeTone").and_then(|v| v.as_str()) {
                        Some(name) => kit.color(parse_tone(name)?).to_string(),
                        None => color.clone(),
                    },
                    width: width as f32,
                    dash: args
                        .get("dash")
                        .and_then(|v| v.as_f64())
                        .map(|dash| dash as f32),
                    gap: args
                        .get("gap")
                        .and_then(|v| v.as_f64())
                        .map(|gap| gap as f32),
                }),
                _ => None,
            };
            let framing = framing_for(args, &kit)?;
            let id = text(args, "id").unwrap_or_else(|| mint_id(project, "shape"));
            reject_reserved_id(&id)?;
            if find_ref(project, &id).is_some() {
                return Err(format!("an element with id {id:?} already exists"));
            }

            commands.push(Command::AddElement {
                track_id,
                element: Element::Shape(ShapeElement {
                    name: id.clone(),
                    id: id.clone(),
                    start: secs(start)?,
                    duration: secs(duration)?,
                    fade_in: MediaTime::ZERO,
                    fade_out: MediaTime::ZERO,
                    shape,
                    color,
                    gradient,
                    stroke,
                    transform: transform_framed(args, framing),
                    effects: Vec::new(),
                    animations: BTreeMap::new(),
                    blend_mode: Default::default(),
                    mask: None,
                    source: ElementSource::Author,
                    role,
                }),
                select: false,
            });
            Ok(Planned::Tx {
                label: "add_shape".into(),
                commands,
                scene_id,
                new_ids: vec![id],
            })
        }

        // One verb, two ways in. `apply_move` names a move out of the registry; `animate` takes
        // the same `move` parameter, because a live MCP session's tool list is cached at
        // connection and a new tool *name* is unreachable there while a new parameter is not.
        // Hand-written keys still work and are still refused nothing — they are simply named, as
        // `off-vocabulary-motion`, once they are on the timeline.
        "animate" | "apply_move" => {
            if name == "apply_move" && args.get("move").is_none() {
                return Ok(Planned::Read(move_catalogue()));
            }
            let element_id = text(args, "elementId")
                .ok_or_else(|| "missing required string field \"elementId\"".to_string())?;

            if let Some((chosen, params)) = named_move(args)? {
                let reference = find_ref(project, &element_id)
                    .ok_or_else(|| format!("no element {element_id:?} on the timeline"))?;
                let element = project
                    .active_scene()
                    .element(&reference)
                    .ok_or_else(|| format!("no element {element_id:?} on the timeline"))?;
                let animations = moves::apply(element, chosen, &params)?;
                return Ok(Planned::Tx {
                    label: format!("apply_move {}", chosen.id),
                    commands: vec![Command::ApplyMotionPreset {
                        reference,
                        effects: Vec::new(),
                        animations,
                    }],
                    scene_id,
                    new_ids: Vec::new(),
                });
            }

            let property = text(args, "property").ok_or_else(|| {
                "animate needs either \"move\" (a named move, which brings its own duration and \
                 curve — call apply_move with no arguments to see them) or \"property\" and \
                 \"keys\""
                    .to_string()
            })?;

            let raw = args
                .get("keys")
                .and_then(|v| v.as_array())
                .ok_or_else(|| "keys must be an array of {t, value} objects".to_string())?;
            if raw.len() < 2 {
                return Err(
                    "an animation needs at least two keyframes (a start and an end)".into(),
                );
            }
            let mut channel = AnimationChannel {
                keys: Vec::new(),
                easing: parse_easing(args.get("easing").and_then(|v| v.as_str()))?,
            };
            for (index, entry) in raw.iter().enumerate() {
                let t = entry
                    .get("t")
                    .and_then(|v| v.as_f64())
                    .ok_or_else(|| format!("keys[{index}] is missing a numeric \"t\""))?;
                let value = entry
                    .get("value")
                    .and_then(|v| v.as_f64())
                    .ok_or_else(|| format!("keys[{index}] is missing a numeric \"value\""))?;
                if !value.is_finite() {
                    return Err(format!("keyframe value at t={t} is not finite"));
                }
                // A key may carry the curve for the segment leaving it, which is how one
                // channel arrives fast, holds, and leaves slowly. Absent, it travels on the
                // channel's own easing.
                match entry.get("easing").and_then(|v| v.as_str()) {
                    Some(name) => {
                        channel.upsert_eased(secs(t)?, value as f32, parse_easing(Some(name))?)
                    }
                    None => channel.upsert(secs(t)?, value as f32),
                }
            }

            if let Some(group) = project.active_scene().groups.get(&element_id) {
                if !Element::ANIMATABLE.contains(&property.as_str()) {
                    return Err(format!(
                        "{property:?} cannot be animated on a group — pick one of {:?}",
                        Element::ANIMATABLE
                    ));
                }
                let mut group = group.clone();
                group.animations.insert(property, channel);
                return Ok(Planned::Tx {
                    label: "animate group".into(),
                    commands: vec![Command::SetGroup { group }],
                    scene_id,
                    new_ids: Vec::new(),
                });
            }

            let reference = find_ref(project, &element_id)
                .ok_or_else(|| format!("no element or group {element_id:?} on the timeline"))?;
            let element = project
                .active_scene()
                .element(&reference)
                .ok_or_else(|| format!("no element {element_id:?} on the timeline"))?;
            // Checked against the kind, not one global list: audio has `volume` and no
            // position, everything visual has a position and no level. Accepting `x` on a
            // music bed and then quietly doing nothing with the keys is worse than refusing.
            let nested_mask = matches!(
                property.as_str(),
                "mask.x" | "mask.y" | "mask.width" | "mask.height" | "mask.feather"
            ) && element.mask().is_some();
            let nested_effect = property
                .strip_prefix("effect.")
                .and_then(|rest| rest.split_once('.'))
                .is_some_and(|(id, param)| {
                    element
                        .effects()
                        .iter()
                        .any(|effect| effect.id == id && effect.params.contains_key(param))
                });
            if !element.animatable().contains(&property.as_str()) && !nested_mask && !nested_effect
            {
                return Err(format!(
                    "{property:?} cannot be animated on a {} — pick a transform channel, an \
                     existing mask field, or effect.<id>.<param>; transform channels are {:?}",
                    element.kind().label().to_lowercase(),
                    element.animatable()
                ));
            }
            let mut animations = element
                .animations()
                .cloned()
                .ok_or_else(|| format!("{element_id:?} has nothing to animate"))?;
            animations.insert(property.clone(), channel);

            Ok(Planned::Tx {
                label: "animate".into(),
                commands: vec![Command::ApplyMotionPreset {
                    reference,
                    // No effects. `ApplyMotionPreset` *appends* what it is given, and this
                    // used to hand it the element's current effects — so every `animate` call
                    // added a second copy of each one, sharing its id with the original.
                    effects: Vec::new(),
                    animations,
                }],
                scene_id,
                new_ids: Vec::new(),
            })
        }

        // One move across many elements, staggered. Without it a six-word kinetic headline is
        // twelve `animate` calls with hand-computed offsets, and what an agent actually does
        // instead is give up and set the whole line as one text element — which is why every
        // reveal in every video came out identical.
        "animate_many" => {
            let ids = args
                .get("elementIds")
                .and_then(|v| v.as_array())
                .ok_or_else(|| "elementIds must be an array of element ids".to_string())?;
            if ids.is_empty() {
                return Err("animate_many needs at least one element".into());
            }

            // A named move across the group. The stagger and the decay come from the move
            // itself unless the caller overrides them, so a cascade is one word rather than
            // four numbers copied out of a document.
            if let Some((chosen, params)) = named_move(args)? {
                let timing = chosen.group;
                let default_stagger = timing.map_or(0.1, |g| f64::from(g.stagger / 30.0));
                let stagger = number(args, "stagger", default_stagger);
                if stagger < 0.0 {
                    return Err("stagger cannot be negative".into());
                }
                let decay = number(args, "decay", timing.map_or(1.0, |g| f64::from(g.decay)));
                if !(0.1..=2.0).contains(&decay) {
                    return Err(
                        "decay is a multiplier on each successive gap, roughly 0.5 to 1.5 \
                         (0.84 accelerates a cascade, 1.0 keeps it even)"
                            .into(),
                    );
                }
                let alternate = timing.is_some_and(|g| g.alternate);
                let mut commands = Vec::new();
                let mut offset = params.at.max(0.0);
                let mut gap = stagger;
                for (index, entry) in ids.iter().enumerate() {
                    let id = entry
                        .as_str()
                        .ok_or_else(|| format!("elementIds[{index}] is not a string"))?;
                    let reference = find_ref(project, id)
                        .ok_or_else(|| format!("no element {id:?} on the timeline"))?;
                    let element = project
                        .active_scene()
                        .element(&reference)
                        .ok_or_else(|| format!("no element {id:?} on the timeline"))?;
                    let mut member = params;
                    member.at = offset;
                    if alternate && index % 2 == 1 {
                        member.direction = chosen.opposite(params.direction);
                    }
                    commands.push(Command::ApplyMotionPreset {
                        reference,
                        effects: Vec::new(),
                        animations: moves::apply(element, chosen, &member)?,
                    });
                    offset += gap;
                    gap *= decay;
                }
                return Ok(Planned::Tx {
                    label: format!("animate_many {}", chosen.id),
                    commands,
                    scene_id,
                    new_ids: Vec::new(),
                });
            }

            let property = text(args, "property")
                .ok_or_else(|| "missing required string field \"property\"".to_string())?;
            // `by` is a delta from wherever each element already rests; `from`/`to` are absolute
            // and shared. The delta is what makes a *response* affordable: "everyone already
            // here shifts up 38 px to open a slot" is one call, where the absolute form means
            // rewriting every incumbent's whole key list with values the caller has to track
            // itself. That cost is why a crossfade won at all five seams in the project this
            // exists to prevent.
            let by = match args.get("by").and_then(|v| v.as_f64()) {
                Some(by) if by.is_finite() => Some(by as f32),
                Some(_) => return Err("by must be finite".into()),
                None => None,
            };
            let (from, to) = match by {
                Some(_) => (0.0_f32, 0.0_f32),
                None => {
                    let from = required_number(args, "from").map_err(|_| {
                        "animate_many needs either \"by\" (a delta from where each element \
                         already rests) or \"from\" and \"to\" (absolute, shared)"
                            .to_string()
                    })? as f32;
                    let to = required_number(args, "to")? as f32;
                    if !from.is_finite() || !to.is_finite() {
                        return Err("from and to must be finite".into());
                    }
                    (from, to)
                }
            };
            let duration = number(args, "duration", 0.5);
            if duration <= 0.0 {
                return Err("duration must be greater than zero".into());
            }
            let at = number(args, "at", 0.0).max(0.0);
            let stagger = number(args, "stagger", 0.06);
            if stagger < 0.0 {
                return Err("stagger cannot be negative".into());
            }
            // Shrinking gaps make a cascade accelerate across a line instead of running at a
            // flat per-item delay — the difference between a wave and a conveyor belt.
            let decay = number(args, "decay", 1.0);
            if !(0.1..=2.0).contains(&decay) {
                return Err(
                    "decay is a multiplier on each successive gap, roughly 0.5 to 1.5 \
                            (0.84 accelerates a cascade, 1.0 keeps it even)"
                        .into(),
                );
            }
            let easing = parse_easing(args.get("easing").and_then(|v| v.as_str()))?;

            let mut commands = Vec::new();
            let mut offset = at;
            let mut gap = stagger;
            for (index, entry) in ids.iter().enumerate() {
                let id = entry
                    .as_str()
                    .ok_or_else(|| format!("elementIds[{index}] is not a string"))?;
                let reference = find_ref(project, id)
                    .ok_or_else(|| format!("no element {id:?} on the timeline"))?;
                let element = project
                    .active_scene()
                    .element(&reference)
                    .ok_or_else(|| format!("no element {id:?} on the timeline"))?;
                if !element.animatable().contains(&property.as_str()) {
                    return Err(format!(
                        "{property:?} cannot be animated on {id:?} (a {}) — pick one of {:?}",
                        element.kind().label().to_lowercase(),
                        element.animatable()
                    ));
                }

                let mut animations = element
                    .animations()
                    .cloned()
                    .ok_or_else(|| format!("{id:?} has nothing to animate"))?;
                let mut channel = AnimationChannel {
                    keys: Vec::new(),
                    easing,
                };
                match by {
                    // A delta: two keys, measured from where this element actually is, appended
                    // to whatever channel it already has rather than replacing it — so an
                    // incumbent that responds to an arrival keeps the entrance it came in on.
                    Some(by) => {
                        let start = secs(offset)?;
                        let rest = moves::rest_value(element, &property, &animations, start)
                            .ok_or_else(|| {
                                format!("{id:?} has no {property:?} to move relative to")
                            })?;
                        channel.upsert(start, rest);
                        channel.upsert(secs(offset + duration)?, rest + by);
                        moves::merge_channel(&mut animations, &property, channel);
                    }
                    None => {
                        // The leading key holds the element at its from-value until its own cue.
                        // Without it every element is already moving at t=0 and the stagger does
                        // nothing visible.
                        channel.upsert(secs(0.0)?, from);
                        if offset > 0.0 {
                            channel.upsert(secs(offset)?, from);
                        }
                        channel.upsert(secs(offset + duration)?, to);
                        animations.insert(property.clone(), channel);
                    }
                }
                commands.push(Command::ApplyMotionPreset {
                    reference,
                    effects: Vec::new(),
                    animations,
                });

                offset += gap;
                gap *= decay;
            }

            Ok(Planned::Tx {
                label: "animate_many".into(),
                commands,
                scene_id,
                new_ids: Vec::new(),
            })
        }

        // ------------------------------------------------------------------ revising
        //
        // The tools above make things; these change things already made. Without them an
        // agent that looks at a snapshot and sees the title an inch too low has one move
        // available — delete it and build it again, losing every animation on it — which is
        // why "snapshot, look, fix" was only ever half a loop.
        "element_move" => {
            let (reference, _) = require_element(project, args)?;
            let start = secs(required_number(args, "start")?)?;
            Ok(Planned::Tx {
                label: "element_move".into(),
                commands: vec![Command::MoveElement { reference, start }],
                scene_id,
                new_ids: Vec::new(),
            })
        }

        "element_trim" => {
            let (reference, element) = require_element(project, args)?;
            // Either edge alone, so "make it a second shorter" does not require restating
            // where it starts.
            let start = match args.get("start") {
                Some(_) => secs(required_number(args, "start")?)?,
                None => element.start(),
            };
            let duration = match args.get("duration") {
                Some(_) => secs(required_number(args, "duration")?)?,
                None => element.duration(),
            };
            if duration <= MediaTime::ZERO {
                return Err("duration must be greater than zero".into());
            }
            Ok(Planned::Tx {
                label: "element_trim".into(),
                commands: vec![Command::TrimElement {
                    reference,
                    start,
                    duration,
                }],
                scene_id,
                new_ids: Vec::new(),
            })
        }

        "element_split" => {
            let (reference, element) = require_element(project, args)?;
            let at = secs(required_number(args, "at")?)?;
            if at <= element.start() || at >= element.end() {
                return Err(format!(
                    "the split point must fall inside the clip ({:.3}s–{:.3}s), and {:.3}s does not",
                    element.start().to_seconds_f64(),
                    element.end().to_seconds_f64(),
                    at.to_seconds_f64(),
                ));
            }
            let new_id = text(args, "newId").unwrap_or_else(|| mint_id(project, "clip"));
            reject_reserved_id(&new_id)?;
            if find_ref(project, &new_id).is_some() {
                return Err(format!("an element with id {new_id:?} already exists"));
            }
            Ok(Planned::Tx {
                label: "element_split".into(),
                commands: vec![Command::SplitElement {
                    reference,
                    at,
                    new_id: new_id.clone(),
                }],
                scene_id,
                new_ids: vec![new_id],
            })
        }

        "element_source" => {
            let (reference, element) = require_element(project, args)?;
            if element.source_start().is_none() {
                return Err(format!(
                    "{:?} is a {} — it has no timeline inside it to slip",
                    element.id(),
                    element.kind().label().to_lowercase()
                ));
            }
            let trim_start = secs(required_number(args, "trimStart")?)?;
            Ok(Planned::Tx {
                label: "element_source".into(),
                commands: vec![Command::SetSourceStart {
                    reference,
                    trim_start,
                }],
                scene_id,
                new_ids: Vec::new(),
            })
        }

        "element_duplicate" => {
            let (reference, _) = require_element(project, args)?;
            let new_id = text(args, "newId").unwrap_or_else(|| mint_id(project, "copy"));
            reject_reserved_id(&new_id)?;
            if find_ref(project, &new_id).is_some() {
                return Err(format!("an element with id {new_id:?} already exists"));
            }
            Ok(Planned::Tx {
                label: "element_duplicate".into(),
                commands: vec![Command::DuplicateElement {
                    reference,
                    new_id: new_id.clone(),
                }],
                scene_id,
                new_ids: vec![new_id],
            })
        }

        "element_rename" => {
            let (reference, _) = require_element(project, args)?;
            let name = text(args, "name")
                .ok_or_else(|| "missing required string field \"name\"".to_string())?;
            Ok(Planned::Tx {
                label: "element_rename".into(),
                commands: vec![Command::RenameElement { reference, name }],
                scene_id,
                new_ids: Vec::new(),
            })
        }

        "transform_set" => {
            let (reference, element) = require_element(project, args)?;
            // Read-modify-write against what is there, so nudging x does not silently reset
            // the scale an earlier call set.
            let mut transform = element.transform().ok_or_else(|| {
                format!(
                    "{:?} is an audio clip — it has nothing on the canvas to place",
                    element.id()
                )
            })?;
            let mut touched = false;
            // Scoped so the closure's borrow of `touched` ends before it is read.
            {
                let mut take = |key: &str, field: &mut f32| -> Result<(), String> {
                    let Some(value) = args.get(key).and_then(|v| v.as_f64()) else {
                        return Ok(());
                    };
                    if !value.is_finite() {
                        return Err(format!("{key} must be a finite number"));
                    }
                    *field = value as f32;
                    touched = true;
                    Ok(())
                };
                take("x", &mut transform.x)?;
                take("y", &mut transform.y)?;
                take("scale", &mut transform.scale)?;
                take("scaleX", &mut transform.scale_x)?;
                take("scaleY", &mut transform.scale_y)?;
                take("rotation", &mut transform.rotation)?;
                take("opacity", &mut transform.opacity)?;
                take("anchorX", &mut transform.anchor_x)?;
                take("anchorY", &mut transform.anchor_y)?;
                take("tiltX", &mut transform.tilt_x)?;
                take("tiltY", &mut transform.tilt_y)?;
            }
            if !touched {
                return Err(
                    "give at least one of x, y, scale, scaleX, scaleY, rotation, tiltX, tiltY, \
                     opacity, anchorX, anchorY"
                        .into(),
                );
            }
            Ok(Planned::Tx {
                label: "transform_set".into(),
                commands: vec![Command::SetTransform {
                    reference,
                    transform,
                }],
                scene_id,
                new_ids: Vec::new(),
            })
        }

        "crop_set" => {
            let (reference, element) = require_element(project, args)?;
            let mut transform = element.transform().ok_or_else(|| {
                format!(
                    "{:?} is an audio clip — there is nothing to reframe",
                    element.id()
                )
            })?;
            let mut touched = false;
            for (key, slot) in [("left", 0usize), ("top", 1), ("right", 2), ("bottom", 3)] {
                let Some(value) = args.get(key).and_then(|v| v.as_f64()) else {
                    continue;
                };
                if !(0.0..=1.0).contains(&value) {
                    return Err(format!("{key} is a fraction of the source, 0 to 1"));
                }
                match slot {
                    0 => transform.crop_left = value as f32,
                    1 => transform.crop_top = value as f32,
                    2 => transform.crop_right = value as f32,
                    _ => transform.crop_bottom = value as f32,
                }
                touched = true;
            }
            if !touched {
                return Err("give at least one of left, top, right, bottom".into());
            }
            if transform.crop_left + transform.crop_right >= 1.0
                || transform.crop_top + transform.crop_bottom >= 1.0
            {
                return Err(
                    "those insets meet: cropping that much leaves no picture at all".into(),
                );
            }
            Ok(Planned::Tx {
                label: "crop_set".into(),
                commands: vec![Command::SetTransform {
                    reference,
                    transform,
                }],
                scene_id,
                new_ids: Vec::new(),
            })
        }

        "mask_set" => {
            let (reference, element) = require_element(project, args)?;
            if element.transform().is_none() {
                return Err(format!(
                    "{:?} is an audio clip — a mask limits where a picture shows",
                    element.id()
                ));
            }
            // `"shape": "none"` removes the mask, which is otherwise unreachable without a
            // separate tool nobody would find.
            if args.get("shape").and_then(|v| v.as_str()) == Some("none") {
                if element.mask().is_none() {
                    return Err(format!("{:?} has no mask to remove", element.id()));
                }
                let mut updated = element.clone();
                updated.set_mask(None);
                return Ok(Planned::Tx {
                    label: "mask_set".into(),
                    commands: vec![Command::ReplaceElement {
                        reference,
                        element: updated,
                    }],
                    scene_id,
                    new_ids: Vec::new(),
                });
            }

            let mut mask = element.mask().unwrap_or_default();
            if let Some(shape) = args.get("shape").and_then(|v| v.as_str()) {
                mask.shape = match shape {
                    "ellipse" => bay_project::MaskShape::Ellipse,
                    "rect" => bay_project::MaskShape::Rect,
                    other => {
                        return Err(format!(
                            "unknown mask shape {other:?} — ellipse, rect, or none to remove it"
                        ));
                    }
                };
            }
            for (key, field) in [
                ("x", 0usize),
                ("y", 1),
                ("width", 2),
                ("height", 3),
                ("feather", 4),
            ] {
                let Some(value) = args.get(key).and_then(|v| v.as_f64()) else {
                    continue;
                };
                if !value.is_finite() {
                    return Err(format!("{key} must be a finite number"));
                }
                match field {
                    0 => mask.x = value as f32,
                    1 => mask.y = value as f32,
                    2 => mask.width = value as f32,
                    3 => mask.height = value as f32,
                    _ => mask.feather = value.max(0.0) as f32,
                }
            }
            if let Some(inverted) = args.get("inverted").and_then(|v| v.as_bool()) {
                mask.inverted = inverted;
            }
            if mask.width <= 0.0 || mask.height <= 0.0 {
                return Err("a mask with no width or height would hide the clip entirely".into());
            }
            let mut updated = element.clone();
            updated.set_mask(Some(mask));
            Ok(Planned::Tx {
                label: "mask_set".into(),
                commands: vec![Command::ReplaceElement {
                    reference,
                    element: updated,
                }],
                scene_id,
                new_ids: Vec::new(),
            })
        }

        "text_update" => {
            let (reference, element) = require_element(project, args)?;
            let Element::Text(current) = element else {
                return Err(format!(
                    "{:?} is a {}, not a title",
                    element.id(),
                    element.kind().label().to_lowercase()
                ));
            };
            let mut updated = current.clone();
            let mut commands = Vec::new();
            if let Some(content) = text(args, "content") {
                updated.content = content.clone();
                // Content has its own command so a pure retype stays a one-patch edit.
                commands.push(Command::SetTextContent {
                    reference: reference.clone(),
                    content,
                });
            }
            let mut restyled = false;
            // The four values that used to be settable here come from the project's style kit
            // now. Refused rather than ignored: an argument that is silently dropped teaches
            // the caller that it worked.
            reject_raw_style(args, "text_update")?;
            // A new role or tone re-resolves the line against the kit — which is how a label is
            // promoted to a headline without deleting and re-adding it (and losing its id and
            // its animation).
            let role = match args.get("role").and_then(|v| v.as_str()) {
                Some(name) => Some(parse_role(name)?),
                None => None,
            };
            let tone = match args.get("tone").and_then(|v| v.as_str()) {
                Some(name) => Some(parse_tone(name)?),
                None => None,
            };
            if role.is_some() || tone.is_some() {
                let kit = project.settings.kit.as_ref().ok_or_else(|| {
                    "this project has not committed to a style kit yet — call style_pick"
                        .to_string()
                })?;
                let role = role.unwrap_or(updated.role);
                let style = kit.resolve(role, tone.unwrap_or(bay_project::Tone::default_for(role)));
                updated.role = role;
                updated.font_family = Some(style.family);
                updated.font_weight = style.weight;
                updated.font_size = style.size;
                updated.letter_spacing = style.tracking;
                updated.line_height = style.line_height;
                updated.color = style.color;
                restyled = true;
            }
            if let Some(align) = args.get("align").and_then(|v| v.as_str()) {
                updated.align = parse_align(Some(align))?;
                restyled = true;
            }
            if let Some(spacing) = args.get("letterSpacing").and_then(|v| v.as_f64()) {
                updated.letter_spacing = spacing as f32;
                restyled = true;
            }
            if let Some(height) = args.get("lineHeight").and_then(|v| v.as_f64()) {
                updated.line_height = height as f32;
                restyled = true;
            }
            if restyled {
                // Typography has no per-field command, so the styled clip replaces the old one
                // in place — same id, same position in the lane, one undo step.
                commands.push(Command::ReplaceElement {
                    reference: reference.clone(),
                    element: Element::Text(updated),
                });
            }
            if commands.is_empty() {
                return Err(
                    "give at least one of content, role, tone, align, letterSpacing, lineHeight"
                        .into(),
                );
            }
            Ok(Planned::Tx {
                label: "text_update".into(),
                commands,
                scene_id,
                new_ids: Vec::new(),
            })
        }

        "effect_add" => {
            let (reference, element) = require_element(project, args)?;
            if matches!(element.kind(), bay_project::ElementKind::Audio) {
                return Err(format!(
                    "{:?} is an audio clip — picture effects do not apply to it",
                    element.id()
                ));
            }
            let effect_type = text(args, "type")
                .ok_or_else(|| "missing required string field \"type\"".to_string())?;
            if !SUPPORTED_EFFECTS.contains(&effect_type.as_str()) {
                return Err(format!(
                    "unknown effect {effect_type:?} — bay renders {SUPPORTED_EFFECTS:?}"
                ));
            }
            let id = text(args, "effectId").unwrap_or_else(|| mint_effect_id(project));
            if element.effects().iter().any(|e| e.id == id) {
                return Err(format!(
                    "{:?} already has an effect with id {id:?}",
                    element.id()
                ));
            }
            // A grade needs its table, and it has to be one that parses. Checked here rather
            // than at render time, where the only symptom would be a clip that looks
            // untouched and no way to tell that from a subtle look.
            // A grade names either a built-in look or a `.cube` on disk. Both are checked
            // here rather than at render time, where the only symptom of a bad one would be a
            // clip that looks untouched — indistinguishable from a subtle grade.
            let asset = match text(args, "look") {
                Some(id) => {
                    bay_effects::Look::by_id(&id).ok_or_else(|| {
                        format!(
                            "unknown look {id:?} — bay has {:?}, or pass \"lut\" with a path to \
                             a .cube file",
                            bay_effects::LOOKS.iter().map(|l| l.id).collect::<Vec<_>>()
                        )
                    })?;
                    Some(format!("{}{id}", bay_preview::LOOK_PREFIX))
                }
                None => text(args, "lut"),
            };
            if effect_type == "lut" {
                let named = asset.as_deref().ok_or(
                    "a lut effect needs a grade: \"look\" for a built-in, or \"lut\" with the \
                     path to a .cube file",
                )?;
                if !named.starts_with(bay_preview::LOOK_PREFIX) {
                    let contents = std::fs::read_to_string(named)
                        .map_err(|e| format!("could not read the LUT at {named:?}: {e}"))?;
                    bay_effects::Lut3d::parse_cube(&contents)
                        .map_err(|e| format!("{named:?} is not a usable .cube: {e}"))?;
                }
            }
            Ok(Planned::Tx {
                label: "effect_add".into(),
                commands: vec![Command::AddEffect {
                    reference,
                    effect: Effect {
                        id: id.clone(),
                        effect_type,
                        enabled: true,
                        params: effect_params(args)?,
                        asset,
                    },
                }],
                scene_id,
                new_ids: vec![id],
            })
        }

        "effect_set" => {
            let (reference, element) = require_element(project, args)?;
            let effect_id = text(args, "effectId")
                .ok_or_else(|| "missing required string field \"effectId\"".to_string())?;
            let existing = element
                .effects()
                .iter()
                .find(|e| e.id == effect_id)
                .ok_or_else(|| format!("{:?} has no effect {effect_id:?}", element.id()))?;

            let mut commands = Vec::new();
            for (key, value) in effect_params(args)? {
                commands.push(Command::SetEffectParam {
                    reference: reference.clone(),
                    effect_id: effect_id.clone(),
                    key,
                    value,
                });
            }
            if let Some(enabled) = args.get("enabled").and_then(|v| v.as_bool())
                && enabled != existing.enabled
            {
                commands.push(Command::ToggleEffect {
                    reference: reference.clone(),
                    effect_id: effect_id.clone(),
                });
            }
            if commands.is_empty() {
                return Err("give params to change, or an \"enabled\" flag".into());
            }
            Ok(Planned::Tx {
                label: "effect_set".into(),
                commands,
                scene_id,
                new_ids: Vec::new(),
            })
        }

        "effect_remove" => {
            let (reference, element) = require_element(project, args)?;
            let effect_id = text(args, "effectId")
                .ok_or_else(|| "missing required string field \"effectId\"".to_string())?;
            element
                .effects()
                .iter()
                .find(|e| e.id == effect_id)
                .ok_or_else(|| format!("{:?} has no effect {effect_id:?}", element.id()))?;
            Ok(Planned::Tx {
                label: "effect_remove".into(),
                commands: vec![Command::RemoveEffect {
                    reference,
                    effect_id,
                }],
                scene_id,
                new_ids: Vec::new(),
            })
        }

        "blend_set" => {
            let (reference, element) = require_element(project, args)?;
            if element.blend_mode().is_none() {
                return Err(format!(
                    "{:?} is an audio clip — it does not composite",
                    element.id()
                ));
            }
            let name = text(args, "mode")
                .ok_or_else(|| "missing required string field \"mode\"".to_string())?;
            let blend_mode = parse_blend_mode(&name)?;
            Ok(Planned::Tx {
                label: "blend_set".into(),
                commands: vec![Command::SetBlendMode {
                    reference,
                    blend_mode,
                }],
                scene_id,
                new_ids: Vec::new(),
            })
        }

        // `duck` and `audio_set` are one implementation with two names. A live MCP session
        // caches the tool list at connect time, so a capability that exists only under a new
        // name is unreachable to every session already open — which is why the arguments are on
        // `audio_set` as well, and why they must not be able to mean two different things.
        "duck" | "audio_set" => {
            let bed_id = match name {
                "duck" => text(args, "bedId")
                    .or_else(|| text(args, "elementId"))
                    .ok_or_else(|| "missing required string field \"bedId\"".to_string())?,
                _ => text(args, "elementId")
                    .ok_or_else(|| "missing required string field \"elementId\"".to_string())?,
            };
            let reference = find_ref(project, &bed_id)
                .ok_or_else(|| format!("no element {bed_id:?} on the timeline"))?;
            let element = project
                .active_scene()
                .element(&reference)
                .ok_or_else(|| format!("no element {bed_id:?} on the timeline"))?;
            let Element::Audio(current) = element else {
                return Err(format!(
                    "{:?} is a {}, not an audio clip",
                    element.id(),
                    element.kind().label().to_lowercase()
                ));
            };
            let mut updated = current.clone();
            let mut commands = Vec::new();
            let mut touched = false;
            if let Some(volume) = args.get("volume").and_then(|v| v.as_f64()) {
                if !(0.0..=4.0).contains(&volume) {
                    return Err("volume must be between 0 and 4 (1.0 is unity)".into());
                }
                updated.volume = volume as f32;
                touched = true;
            }
            if let Some(muted) = args.get("muted").and_then(|v| v.as_bool()) {
                updated.muted = muted;
                touched = true;
            }

            // The duck is derived from the level the clip will have *after* this call, so
            // "set the bed to 0.85 and duck it 8 dB" is one call rather than two with an
            // ordering the caller has to get right. It goes into `updated` rather than into its
            // own command, because a `ReplaceElement` carrying the old animations would land
            // after the preset and quietly undo it.
            if wants_a_duck(name, args) {
                let bed = Element::Audio(updated.clone());
                let derived = derive_duck(project, &bed, args)?;
                updated.animations.insert("volume".into(), derived.channel);
                touched = true;
            }

            if touched {
                commands.push(Command::ReplaceElement {
                    reference: reference.clone(),
                    element: Element::Audio(updated),
                });
            }
            // The in-point goes through its own command so it gets the clamp against the file
            // length that every other trim gets.
            if let Some(trim_start) = args.get("trimStart").and_then(|v| v.as_f64()) {
                commands.push(Command::SetSourceStart {
                    reference,
                    trim_start: secs(trim_start)?,
                });
            }
            if commands.is_empty() {
                return Err(
                    "give at least one of volume, muted, trimStart, or duckUnder (the clips \
                     this one should get out of the way of)"
                        .into(),
                );
            }
            Ok(Planned::Tx {
                label: name.to_string(),
                commands,
                scene_id,
                new_ids: Vec::new(),
            })
        }

        "fade_set" => {
            let (reference, element) = require_element(project, args)?;
            let fade_in = match args.get("fadeIn") {
                Some(_) => secs(required_number(args, "fadeIn")?)?,
                None => element.fade_in(),
            };
            let fade_out = match args.get("fadeOut") {
                Some(_) => secs(required_number(args, "fadeOut")?)?,
                None => element.fade_out(),
            };
            if args.get("fadeIn").is_none() && args.get("fadeOut").is_none() {
                return Err("give fadeIn, fadeOut, or both (in seconds; 0 removes a fade)".into());
            }
            Ok(Planned::Tx {
                label: "fade_set".into(),
                commands: vec![Command::SetFades {
                    reference,
                    fade_in,
                    fade_out,
                }],
                scene_id,
                new_ids: Vec::new(),
            })
        }

        "transition_add" => {
            let seconds = number(args, "duration", 0.5);
            if seconds <= 0.0 {
                return Err("a transition needs a duration greater than zero".into());
            }
            let duration = secs(seconds)?;

            let from_id = text(args, "fromId")
                .ok_or_else(|| "missing required string field \"fromId\"".to_string())?;
            let to_id = text(args, "toId")
                .ok_or_else(|| "missing required string field \"toId\"".to_string())?;
            let from_ref = find_ref(project, &from_id)
                .ok_or_else(|| format!("no element {from_id:?} on the timeline"))?;
            let to_ref = find_ref(project, &to_id)
                .ok_or_else(|| format!("no element {to_id:?} on the timeline"))?;
            if from_ref.track_id != to_ref.track_id {
                return Err(format!(
                    "{from_id:?} and {to_id:?} are on different lanes — a dissolve needs the \
                     outgoing clip underneath the incoming one, so put them on the same lane \
                     or fade them individually with fade_set"
                ));
            }
            let scene = project.active_scene();
            let from = scene.element(&from_ref).expect("resolved above");
            let to = scene.element(&to_ref).expect("resolved above");
            if from.end() <= to.start() {
                return Err(format!(
                    "{from_id:?} ends at {:.2}s and {to_id:?} starts at {:.2}s — they do not \
                     overlap, and a dissolve is the overlap. Move {to_id:?} back by the \
                     transition's length first (element_move), or use fade_set for a fade to \
                     background",
                    from.end().to_seconds_f64(),
                    to.start().to_seconds_f64(),
                ));
            }
            let overlap = MediaTime::from_ticks(from.end().as_ticks() - to.start().as_ticks());
            if overlap < duration {
                return Err(format!(
                    "the clips overlap by {:.2}s, which is less than the {:.2}s transition asked \
                     for — a dissolve can only last as long as both clips are on screen",
                    overlap.to_seconds_f64(),
                    duration.to_seconds_f64(),
                ));
            }
            // Only the incoming clip fades. The outgoing one plays on at full underneath it,
            // which is what keeps the middle of the dissolve from dipping through the
            // background — the artifact you get from fading both at once.
            Ok(Planned::Tx {
                label: "transition_add".into(),
                commands: vec![Command::SetFades {
                    reference: to_ref,
                    fade_in: duration,
                    fade_out: to.fade_out(),
                }],
                scene_id,
                new_ids: Vec::new(),
            })
        }

        "element_ripple_delete" => {
            let (reference, _) = require_element(project, args)?;
            Ok(Planned::Tx {
                label: "element_ripple_delete".into(),
                commands: vec![Command::RippleDelete { reference }],
                scene_id,
                new_ids: Vec::new(),
            })
        }

        "marker_add" => {
            let time = secs(required_number(args, "at")?)?;
            let id = text(args, "id").unwrap_or_else(|| {
                (1..)
                    .map(|n| format!("marker-{n}"))
                    .find(|candidate| {
                        !project
                            .active_scene()
                            .markers
                            .iter()
                            .any(|marker| marker.id == *candidate)
                    })
                    .expect("an unused id exists")
            });
            Ok(Planned::Tx {
                label: "marker_add".into(),
                commands: vec![Command::AddMarker {
                    id: id.clone(),
                    time,
                    label: text(args, "label").unwrap_or_default(),
                }],
                scene_id,
                new_ids: vec![id],
            })
        }

        "element_delete" => {
            let element_id = text(args, "elementId")
                .ok_or_else(|| "missing required string field \"elementId\"".to_string())?;
            let reference = find_ref(project, &element_id)
                .ok_or_else(|| format!("no element {element_id:?} on the timeline"))?;
            Ok(Planned::Tx {
                label: "element_delete".into(),
                commands: vec![Command::RemoveElement { reference }],
                scene_id,
                new_ids: Vec::new(),
            })
        }

        "add_image" | "add_video" => {
            let start = required_number(args, "start")?;
            let duration = required_number(args, "duration")?;
            if duration <= 0.0 {
                return Err("duration must be greater than zero".into());
            }
            let media_id = text(args, "mediaId")
                .ok_or_else(|| "missing required string field \"mediaId\"".to_string())?;
            let asset = project
                .media
                .iter()
                .find(|m| m.id == media_id)
                .ok_or_else(|| format!("no media {media_id:?} — call media_import first"))?;

            let layer = number(args, "layer", 0.0).max(0.0) as usize;
            let (track_id, mut commands) = track_for_layer(project, layer);
            let prefix = if name == "add_image" {
                "image"
            } else {
                "video"
            };
            let role = optional_role(args)?;
            let id = text(args, "id").unwrap_or_else(|| mint_id(project, prefix));
            reject_reserved_id(&id)?;
            if find_ref(project, &id).is_some() {
                return Err(format!("an element with id {id:?} already exists"));
            }

            let element = if name == "add_image" {
                Element::Image(bay_project::ImageElement {
                    id: id.clone(),
                    name: asset.name.clone(),
                    start: secs(start)?,
                    duration: secs(duration)?,
                    fade_in: MediaTime::ZERO,
                    fade_out: MediaTime::ZERO,
                    media_id,
                    transform: transform_from(args),
                    effects: Vec::new(),
                    animations: BTreeMap::new(),
                    blend_mode: Default::default(),
                    mask: None,
                    source: ElementSource::Author,
                    role,
                })
            } else {
                let trim_start = number(args, "trimStart", 0.0);
                Element::Video(bay_project::VideoElement {
                    id: id.clone(),
                    name: asset.name.clone(),
                    start: secs(start)?,
                    duration: secs(duration)?,
                    fade_in: MediaTime::ZERO,
                    fade_out: MediaTime::ZERO,
                    media_id,
                    trim_start: secs(trim_start)?,
                    trim_end: secs(trim_start + duration)?,
                    speed: number(args, "speed", 1.0) as f32,
                    freeze: None,
                    transform: transform_from(args),
                    effects: Vec::new(),
                    animations: BTreeMap::new(),
                    blend_mode: Default::default(),
                    mask: None,
                    source: ElementSource::Author,
                    role,
                })
            };
            commands.push(Command::AddElement {
                track_id,
                element,
                select: false,
            });
            Ok(Planned::Tx {
                label: name.to_string(),
                commands,
                scene_id,
                new_ids: vec![id],
            })
        }

        "add_audio" => {
            let start = required_number(args, "start")?;
            let duration = required_number(args, "duration")?;
            if duration <= 0.0 {
                return Err("duration must be greater than zero".into());
            }
            let media_id = text(args, "mediaId")
                .ok_or_else(|| "missing required string field \"mediaId\"".to_string())?;
            let asset = project
                .media
                .iter()
                .find(|m| m.id == media_id)
                .ok_or_else(|| format!("no media {media_id:?} — call media_import first"))?;

            let (track_id, mut commands) = audio_track(project);
            let role = match args.get("role").and_then(|v| v.as_str()) {
                Some(name) => bay_project::AudioRole::from_wire(name).ok_or_else(|| {
                    format!(
                        "unknown audio role {name:?} — use one of {:?}",
                        bay_project::AudioRole::NAMES
                    )
                })?,
                None => bay_project::AudioRole::default(),
            };
            let id = text(args, "id").unwrap_or_else(|| mint_id(project, "audio"));
            reject_reserved_id(&id)?;
            if find_ref(project, &id).is_some() {
                return Err(format!("an element with id {id:?} already exists"));
            }
            commands.push(Command::AddElement {
                track_id,
                element: Element::Audio(bay_project::AudioElement {
                    id: id.clone(),
                    name: asset.name.clone(),
                    start: secs(start)?,
                    duration: secs(duration)?,
                    fade_in: MediaTime::ZERO,
                    fade_out: MediaTime::ZERO,
                    media_id,
                    muted: false,
                    volume: number(args, "volume", 1.0) as f32,
                    pan: 0.0,
                    speed: number(args, "speed", 1.0) as f32,
                    prosody: None,
                    dialogue_chain: (role == bay_project::AudioRole::Speech)
                        .then(bay_project::DialogueAudioChain::default),
                    animations: Default::default(),
                    // Where in the file to start. This is how a bed lands on the drop rather
                    // than always at bar one.
                    trim_start: secs(number(args, "trimStart", 0.0))?,
                    source: ElementSource::Author,
                    role,
                }),
                select: false,
            });
            Ok(Planned::Tx {
                label: "add_audio".into(),
                commands,
                scene_id,
                new_ids: vec![id],
            })
        }

        "group_create" => {
            let id = text(args, "id").unwrap_or_else(|| mint_id(project, "group"));
            if project.active_scene().groups.contains_key(&id) || find_ref(project, &id).is_some() {
                return Err(format!("an element or group with id {id:?} already exists"));
            }
            let children: Vec<String> = args
                .get("elementIds")
                .and_then(|value| value.as_array())
                .ok_or_else(|| "elementIds must be a non-empty array".to_string())?
                .iter()
                .map(|value| {
                    value
                        .as_str()
                        .map(str::to_string)
                        .ok_or_else(|| "every elementIds entry must be a string".to_string())
                })
                .collect::<Result<_, _>>()?;
            if children.is_empty() {
                return Err("elementIds must be a non-empty array".into());
            }
            for child in &children {
                let reference = find_ref(project, child)
                    .ok_or_else(|| format!("no element {child:?} on the timeline"))?;
                let element = project
                    .active_scene()
                    .element(&reference)
                    .expect("reference exists");
                if element.transform().is_none() {
                    return Err(format!(
                        "audio element {child:?} cannot be placed in a visual group"
                    ));
                }
                if project
                    .active_scene()
                    .groups
                    .values()
                    .any(|group| group.children.contains(child))
                {
                    return Err(format!("element {child:?} already belongs to a group"));
                }
            }
            let group = bay_project::ElementGroup {
                id: id.clone(),
                children,
                transform: transform_from(args),
                animations: BTreeMap::new(),
            };
            Ok(Planned::Tx {
                label: "group_create".into(),
                commands: vec![Command::SetGroup { group }],
                scene_id,
                new_ids: vec![id],
            })
        }

        "element_retime" => {
            let id = text(args, "elementId")
                .ok_or_else(|| "missing required string field \"elementId\"".to_string())?;
            let reference = find_ref(project, &id)
                .ok_or_else(|| format!("no element {id:?} on the timeline"))?;
            let mut element = project
                .active_scene()
                .element(&reference)
                .cloned()
                .ok_or_else(|| format!("no element {id:?} on the timeline"))?;
            let speed = number(args, "speed", 1.0) as f32;
            if !speed.is_finite() || speed <= 0.0 {
                return Err("speed must be finite and greater than zero".into());
            }
            match &mut element {
                Element::Video(video) => {
                    video.speed = speed;
                    video.freeze = match (
                        args.get("freezeAt").and_then(|value| value.as_f64()),
                        args.get("freezeDuration").and_then(|value| value.as_f64()),
                    ) {
                        (Some(at), Some(duration)) if duration > 0.0 => {
                            Some(bay_project::FreezeFrame {
                                at: secs(at)?,
                                duration: secs(duration)?,
                            })
                        }
                        (None, None) => None,
                        _ => {
                            return Err(
                                "freezeAt and freezeDuration must be provided together, with a \
                                 positive duration"
                                    .into(),
                            );
                        }
                    };
                    let duration = video.duration;
                    element.set_duration(duration);
                }
                Element::Audio(audio) => audio.speed = speed,
                _ => return Err("only video and audio elements can be retimed".into()),
            }
            Ok(Planned::Tx {
                label: "element_retime".into(),
                commands: vec![Command::ReplaceElement { reference, element }],
                scene_id,
                new_ids: Vec::new(),
            })
        }

        "subtitles_add" => {
            let path = text(args, "path")
                .ok_or_else(|| "missing required string field \"path\"".to_string())?;
            let source = std::fs::read_to_string(&path)
                .map_err(|error| format!("could not read {path}: {error}"))?;
            let cues = bay_speech::parse(&source)?;
            let offset = number(args, "offset", 0.0);
            let cues = if offset != 0.0 {
                bay_speech::shift(&cues, offset)
            } else {
                cues
            };
            let mut commands = Vec::new();
            let mut new_ids = Vec::new();
            let style = caption_style_from(args, project.settings.kit.as_ref(), "subtitles_add")?;
            caption_commands(project, &cues, &style, &mut commands, &mut new_ids)?;
            Ok(Planned::Tx {
                label: "subtitles_add".into(),
                commands,
                scene_id,
                new_ids,
            })
        }

        "subtitles_export" => {
            let path = text(args, "path")
                .ok_or_else(|| "missing required string field \"path\"".to_string())?;
            let cues = caption_cues(project);
            if cues.is_empty() {
                return Err(
                    "there are no captions on the timeline to export — add some with narrate \
                     or subtitles_add first"
                        .into(),
                );
            }
            let format = text(args, "format").unwrap_or_else(|| {
                if path.to_lowercase().ends_with(".vtt") {
                    "vtt".into()
                } else {
                    "srt".into()
                }
            });
            let body = match format.as_str() {
                "vtt" => bay_speech::to_vtt(&cues),
                "srt" => bay_speech::to_srt(&cues),
                other => return Err(format!("unknown subtitle format {other:?} (srt or vtt)")),
            };
            std::fs::write(&path, body)
                .map_err(|error| format!("could not write {path}: {error}"))?;
            Ok(Planned::Read(serde_json::json!({
                "path": path,
                "format": format,
                "cues": cues.len(),
            })))
        }

        other => Err(format!(
            "{other:?} is not a tool bay knows. Available: {:?}",
            available_tools()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bay_project::{CanvasSize, Fps, ProjectSettings, Scene, Track, TrackKind, Tracks};

    fn project() -> Project {
        Project {
            metadata: bay_project::ProjectMetadata {
                id: "p".into(),
                name: "Test".into(),
                shelf: Default::default(),
            },
            settings: ProjectSettings {
                fps: Fps {
                    numerator: 30,
                    denominator: 1,
                },
                canvas: CanvasSize {
                    width: 1080,
                    height: 1920,
                },
                background: Default::default(),
                // A named kit rather than the picker's choice: these tests assert on the size
                // and colour a role resolves to, and the picker is seeded by the date.
                kit: bay_project::builtin_kit("swiss").cloned(),
                plan: None,
                format: None,
            },
            scenes: vec![Scene {
                id: "scene-main".into(),
                name: "Main".into(),
                is_main: true,
                tracks: Tracks {
                    overlay: Vec::new(),
                    main: Track::new("track-main", "Main", TrackKind::Video),
                    audio: Vec::new(),
                },
                markers: Vec::new(),
                groups: Default::default(),
            }],
            current_scene_id: "scene-main".into(),
            media: Vec::new(),
        }
    }

    fn tx(planned: Planned) -> (String, Vec<Command>, Vec<String>) {
        match planned {
            Planned::Tx {
                label,
                commands,
                new_ids,
                ..
            } => (label, commands, new_ids),
            Planned::Read(_) => panic!("expected a transaction, got a read"),
        }
    }

    /// A project holding one video clip over a 60s source, which is what every revising test
    /// needs before it can revise anything.
    fn project_with_clip() -> Project {
        let mut project = project();
        let mut asset = bay_project::MediaAsset::new("m1", "take.mp4", "/tmp/take.mp4");
        asset.duration_seconds = Some(60.0);
        project.media.push(asset);
        project.active_scene_mut().tracks.main.elements =
            vec![Element::Video(bay_project::VideoElement {
                id: "v1".into(),
                name: "take".into(),
                start: MediaTime::ZERO,
                duration: secs(10.0).unwrap(),
                fade_in: MediaTime::ZERO,
                fade_out: MediaTime::ZERO,
                media_id: "m1".into(),
                trim_start: secs(2.0).unwrap(),
                trim_end: secs(12.0).unwrap(),
                speed: 1.0,
                freeze: None,
                transform: Transform::default(),
                effects: Vec::new(),
                animations: Default::default(),
                blend_mode: Default::default(),
                mask: None,
                source: Default::default(),
                role: Default::default(),
            })];
        project
    }

    fn title_project() -> Project {
        let mut project = project();
        project.active_scene_mut().tracks.main.elements = vec![Element::Text(TextElement {
            id: "t1".into(),
            name: "Title".into(),
            start: MediaTime::ZERO,
            duration: secs(3.0).unwrap(),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            content: "Hook".into(),
            font_size: 64.0,
            color: "#ffffff".into(),
            transform: Transform::default(),
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: Default::default(),
            mask: None,
            font_family: None,
            font_weight: 400,
            align: Default::default(),
            letter_spacing: 0.0,
            line_height: 1.2,
            decorations: None,
            karaoke: None,
            type_on: None,
            source: Default::default(),
            role: Default::default(),
        })];
        project
    }

    /// The loop this whole tool set exists for: an agent looks at a snapshot, sees the title
    /// sitting too low, and moves it. Before these tools its only move was to delete the
    /// element and build it again, losing everything attached to it.
    #[test]
    fn a_misplaced_title_can_be_nudged_without_rebuilding_it() {
        let planned = plan(
            "transform_set",
            &serde_json::json!({ "elementId": "t1", "y": 0.35 }),
            &title_project(),
        )
        .expect("should plan");
        let (label, commands, _) = tx(planned);
        assert_eq!(label, "transform_set");
        match &commands[..] {
            [Command::SetTransform { transform, .. }] => {
                assert_eq!(transform.y, 0.35);
                assert_eq!(transform.x, 0.5, "the axis nobody mentioned is left alone");
                assert_eq!(transform.scale, 1.0);
            }
            other => panic!("expected one SetTransform, got {other:?}"),
        }
    }

    #[test]
    fn a_transform_call_that_changes_nothing_says_so() {
        let error = plan(
            "transform_set",
            &serde_json::json!({ "elementId": "t1" }),
            &title_project(),
        )
        .expect_err("nothing to do");
        assert!(error.contains("at least one"), "{error}");
    }

    #[test]
    fn a_transform_on_audio_explains_why_not() {
        let mut project = project();
        let mut track = Track::new("track-audio", "Audio", TrackKind::Audio);
        track.elements = vec![Element::Audio(bay_project::AudioElement {
            id: "a1".into(),
            name: "bed".into(),
            start: MediaTime::ZERO,
            duration: secs(5.0).unwrap(),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: "m1".into(),
            muted: false,
            volume: 1.0,
            pan: 0.0,
            speed: 1.0,
            prosody: None,
            dialogue_chain: None,
            animations: Default::default(),
            trim_start: MediaTime::ZERO,
            source: Default::default(),
            role: Default::default(),
        })];
        project.active_scene_mut().tracks.audio = vec![track];
        let error = plan(
            "transform_set",
            &serde_json::json!({ "elementId": "a1", "x": 0.2 }),
            &project,
        )
        .expect_err("audio has no canvas");
        assert!(error.contains("audio clip"), "{error}");
    }

    #[test]
    fn retyping_a_title_keeps_its_styling_and_the_other_way_round() {
        let (_, commands, _) = tx(plan(
            "text_update",
            &serde_json::json!({ "elementId": "t1", "content": "New hook" }),
            &title_project(),
        )
        .expect("should plan"));
        assert!(matches!(commands[..], [Command::SetTextContent { .. }]));

        // A restyle is now a change of *role*: what the line is for. The kit answers the size,
        // the face, the weight and the colour, so promoting a label to a headline is one word
        // rather than four numbers.
        let project = title_project();
        let kit = project
            .settings
            .kit
            .clone()
            .expect("the fixture commits one");
        let (_, commands, _) = tx(plan(
            "text_update",
            &serde_json::json!({ "elementId": "t1", "role": "headline", "tone": "accent" }),
            &project,
        )
        .expect("should plan"));
        match &commands[..] {
            [Command::ReplaceElement { element, .. }] => {
                let Element::Text(text) = element else {
                    panic!("still a title")
                };
                let expected = kit.resolve(
                    bay_project::ElementRole::Headline,
                    bay_project::Tone::Accent,
                );
                assert_eq!(text.role, bay_project::ElementRole::Headline);
                assert_eq!(text.font_size, expected.size);
                assert_eq!(text.font_family.as_deref(), Some(expected.family.as_str()));
                assert_eq!(text.font_weight, expected.weight);
                assert_eq!(text.color, expected.color);
                assert_eq!(text.content, "Hook", "the words were not touched");
                assert_eq!(
                    text.id, "t1",
                    "a restyle must keep the id everything addresses"
                );
            }
            other => panic!("expected one ReplaceElement, got {other:?}"),
        }
    }

    /// The editor window plans `add_text` here rather than through the headless studio, so the
    /// same narrowing has to hold on this side — otherwise the argument is only deleted from one
    /// of the two front ends, and the one an author actually watches keeps it.
    #[test]
    fn the_editor_path_resolves_type_against_the_kit_too() {
        let project = project();
        let kit = project.settings.kit.clone().unwrap();
        let (_, commands, _) = tx(plan(
            "add_text",
            &serde_json::json!({ "role": "hook", "start": 0, "duration": 2, "content": "Hook" }),
            &project,
        )
        .expect("should plan"));
        let Some(Command::AddElement {
            element: Element::Text(text),
            ..
        }) = commands.last()
        else {
            panic!("expected an AddElement, got {commands:?}")
        };
        let expected = kit.resolve(bay_project::ElementRole::Hook, bay_project::Tone::Ink);
        assert_eq!(text.font_family.as_deref(), Some(expected.family.as_str()));
        assert_eq!(text.font_weight, expected.weight);
        assert_eq!(text.font_size, expected.size);
        assert_eq!(text.color, expected.color);

        for (tool, key, value) in [
            ("add_text", "fontSize", serde_json::json!(34)),
            ("add_text", "color", serde_json::json!("#4A4A58")),
            ("add_shape", "color", serde_json::json!("#191922")),
        ] {
            let mut args = serde_json::json!({ "role": "data", "start": 0, "duration": 2,
                                               "content": "x" });
            args[key] = value;
            let error = plan(tool, &args, &project).expect_err("the kit owns this now");
            assert!(error.contains(key), "{error}");
            assert!(error.contains("style kit"), "{error}");
        }
    }

    #[test]
    fn templates_resolve_their_literals_through_the_project_kit() {
        let project = project();
        let kit = project.settings.kit.clone().unwrap();
        let (_, commands, _) = tx(plan(
            "template_place",
            &serde_json::json!({
                "templateId": "lower-third",
                "start": 0,
                "text": ["Ada", "Engineer"],
            }),
            &project,
        )
        .expect("should plan"));

        let mut checked = 0;
        for command in commands {
            let Command::AddElement { element, .. } = command else {
                continue;
            };
            let Some(role) = element.role() else {
                continue;
            };
            let expected = kit.resolve(role, bay_project::Tone::default_for(role));
            match element {
                Element::Text(text) => {
                    assert_eq!(text.font_family.as_deref(), Some(expected.family.as_str()));
                    assert_eq!(text.font_size, expected.size);
                    assert_eq!(text.color, expected.color);
                    checked += 1;
                }
                Element::Shape(shape) => {
                    assert_eq!(shape.color, expected.color);
                    checked += 1;
                }
                _ => {}
            }
        }
        assert_eq!(
            checked, 3,
            "every styled element in the template was checked"
        );
    }

    /// A project made in the app — or opened from before kits existed — takes one the first time
    /// type lands on it, in the same undo step, rather than refusing to draw.
    #[test]
    fn a_kitless_project_commits_one_when_the_first_title_lands() {
        let mut project = project();
        project.settings.kit = None;
        let (_, commands, _) = tx(plan(
            "add_text",
            &serde_json::json!({ "role": "headline", "start": 0, "duration": 2, "content": "x" }),
            &project,
        )
        .expect("should plan"));
        assert!(
            commands
                .iter()
                .any(|c| matches!(c, Command::SetStyleKit { .. })),
            "the placement carries the commitment: {commands:?}"
        );
    }

    /// The half of the frame the failing project never used, reachable as one word.
    #[test]
    fn a_named_framing_places_an_element_on_the_editor_path() {
        let project = project();
        let kit = project.settings.kit.clone().unwrap();
        let low = kit
            .framings
            .iter()
            .find(|f| f.is_bottom_weighted())
            .expect("every kit declares one");
        let (_, commands, _) = tx(plan(
            "add_text",
            &serde_json::json!({ "role": "label", "start": 0, "duration": 2, "content": "x",
                                 "framing": low.name }),
            &project,
        )
        .expect("should plan"));
        let Some(Command::AddElement { element, .. }) = commands.last() else {
            panic!("expected an AddElement")
        };
        let transform = element.transform().unwrap();
        assert!((transform.y - low.y).abs() < 1e-6, "{transform:?}");
        assert!(transform.y >= bay_project::kit::BOTTOM_WEIGHTED_Y);

        let error = plan(
            "add_text",
            &serde_json::json!({ "role": "label", "start": 0, "duration": 2, "content": "x",
                                 "framing": "nowhere" }),
            &project,
        )
        .expect_err("an unknown framing must not fall back to the middle of the frame");
        assert!(error.contains("nowhere"), "{error}");
    }

    /// The four values that stopped being arguments. Refused rather than ignored: an argument
    /// that is silently dropped teaches the caller that it worked, and the whole reason the kit
    /// exists is that a caller's explicit choice lost to the default 72 times out of 73.
    #[test]
    fn text_update_refuses_a_raw_size_face_weight_or_colour() {
        for (key, value) in [
            ("fontSize", serde_json::json!(34)),
            ("fontFamily", serde_json::json!("Menlo")),
            ("fontWeight", serde_json::json!(400)),
            ("color", serde_json::json!("#4A4A58")),
        ] {
            let error = plan(
                "text_update",
                &serde_json::json!({ "elementId": "t1", key: value }),
                &title_project(),
            )
            .expect_err("the kit owns typography now");
            assert!(error.contains(key), "{error}");
            assert!(error.contains("style kit"), "{error}");
            assert!(
                error.contains("role"),
                "the message must name the way in: {error}"
            );
        }
    }

    #[test]
    fn trimming_takes_either_edge_on_its_own() {
        let (_, commands, _) = tx(plan(
            "element_trim",
            &serde_json::json!({ "elementId": "v1", "duration": 4.0 }),
            &project_with_clip(),
        )
        .expect("should plan"));
        match &commands[..] {
            [
                Command::TrimElement {
                    start, duration, ..
                },
            ] => {
                assert_eq!(*start, MediaTime::ZERO, "the head stayed where it was");
                assert_eq!(*duration, secs(4.0).unwrap());
            }
            other => panic!("expected one TrimElement, got {other:?}"),
        }
    }

    #[test]
    fn slipping_a_title_is_refused_with_the_reason() {
        let error = plan(
            "element_source",
            &serde_json::json!({ "elementId": "t1", "trimStart": 1.0 }),
            &title_project(),
        )
        .expect_err("a title has no footage inside it");
        assert!(error.contains("no timeline inside it"), "{error}");
    }

    #[test]
    fn a_split_point_outside_the_clip_names_the_range_it_missed() {
        let error = plan(
            "element_split",
            &serde_json::json!({ "elementId": "v1", "at": 30.0 }),
            &project_with_clip(),
        )
        .expect_err("30s is past a 10s clip");
        assert!(error.contains("0.000s–10.000s"), "{error}");
    }

    #[test]
    fn an_effect_bay_cannot_render_is_refused_rather_than_attached() {
        let error = plan(
            "effect_add",
            &serde_json::json!({ "elementId": "v1", "type": "chromatic-aberration" }),
            &project_with_clip(),
        )
        .expect_err("bay does not render that");
        assert!(error.contains("brightness"), "{error}");
    }

    #[test]
    fn an_effect_is_added_with_its_params_and_a_minted_id() {
        let (_, commands, ids) = tx(plan(
            "effect_add",
            &serde_json::json!({
                "elementId": "v1",
                "type": "brightness",
                "params": { "amount": 0.35 }
            }),
            &project_with_clip(),
        )
        .expect("should plan"));
        assert_eq!(ids, vec!["fx-1"]);
        match &commands[..] {
            [Command::AddEffect { effect, .. }] => {
                assert_eq!(effect.effect_type, "brightness");
                assert_eq!(effect.params.get("amount"), Some(&0.35));
                assert!(effect.enabled);
            }
            other => panic!("expected one AddEffect, got {other:?}"),
        }
    }

    #[test]
    fn a_nan_effect_param_never_reaches_a_shader() {
        let error = plan(
            "effect_add",
            &serde_json::json!({
                "elementId": "v1",
                "type": "blur",
                "params": { "amount": f64::NAN }
            }),
            &project_with_clip(),
        )
        .expect_err("NaN is not a parameter");
        assert!(
            error.contains("finite") || error.contains("must be a number"),
            "{error}"
        );
    }

    #[test]
    fn ducking_a_bed_is_one_call() {
        let mut project = project_with_clip();
        let mut track = Track::new("track-audio", "Audio", TrackKind::Audio);
        track.elements = vec![Element::Audio(bay_project::AudioElement {
            id: "bed".into(),
            name: "bed".into(),
            start: MediaTime::ZERO,
            duration: secs(10.0).unwrap(),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: "m1".into(),
            muted: false,
            volume: 1.0,
            pan: 0.0,
            speed: 1.0,
            prosody: None,
            dialogue_chain: None,
            animations: Default::default(),
            trim_start: MediaTime::ZERO,
            source: Default::default(),
            role: Default::default(),
        })];
        project.active_scene_mut().tracks.audio = vec![track];

        let (_, commands, _) = tx(plan(
            "audio_set",
            &serde_json::json!({ "elementId": "bed", "volume": 0.2, "trimStart": 30.0 }),
            &project,
        )
        .expect("should plan"));
        assert_eq!(commands.len(), 2, "the gain and the in-point: {commands:?}");
        assert!(commands.iter().any(|c| matches!(
            c,
            Command::SetSourceStart { trim_start, .. } if *trim_start == secs(30.0).unwrap()
        )));
    }

    #[test]
    fn an_unreasonable_gain_is_refused_before_it_clips() {
        let error = plan(
            "audio_set",
            &serde_json::json!({ "elementId": "v1", "volume": 40.0 }),
            &project_with_clip(),
        )
        .expect_err("v1 is a video anyway");
        assert!(!error.is_empty());
    }

    /// `check` is a read: it must never come back as a transaction that mutates anything.
    #[test]
    fn check_is_a_read_and_reports_what_it_found() {
        let mut project = project_with_clip();
        // Anchor the clip off the frame so there is something to find.
        if let Element::Video(clip) = &mut project.active_scene_mut().tracks.main.elements[0] {
            clip.transform.y = 2.5;
        }
        let Planned::Read(value) = plan("check", &serde_json::json!({}), &project).unwrap() else {
            panic!("check must not mutate");
        };
        // The whole envelope, not a boolean: `ok: true` on a suite that could not run is the
        // reading this replaced.
        assert_eq!(value["status"], serde_json::json!("findings"));
        assert!(value["errors"].as_u64().unwrap() >= 1);
        assert!(value["rollup"]["off-canvas"].as_u64().unwrap() >= 1);
        assert!(value["skipped"].is_array());
        assert!(value["stats"]["authoredElements"].as_u64().unwrap() >= 1);
        // The addressing scheme rides along, because a finding that says "beat 4" is unreadable
        // without the table that says where beat 4 is.
        assert!(value["stats"]["beats"]["derivation"].is_string());
        assert!(value["stats"]["beats"]["starts"].is_array());
        assert!(
            value["findings"]
                .as_array()
                .unwrap()
                .iter()
                .any(|f| f["code"] == "off-canvas")
        );
        assert!(value.get("ok").is_none(), "the boolean is gone on purpose");

        let Planned::Read(short) =
            plan("check", &serde_json::json!({"duration": 0.5}), &project).unwrap()
        else {
            panic!("a duration-scoped check must still be a read");
        };
        assert!(
            short["stats"]["beats"]["endSeconds"].as_f64().unwrap() <= 0.5,
            "the report must describe only the requested delivery interval: {short}"
        );
    }

    /// Every revising tool addresses an element by id. A typo has to come back as an error the
    /// agent can act on, not as a silently-empty transaction.
    #[test]
    fn every_revising_tool_refuses_an_unknown_element() {
        let project = project_with_clip();
        for (name, extra) in [
            ("element_move", serde_json::json!({ "start": 1.0 })),
            ("element_trim", serde_json::json!({ "duration": 1.0 })),
            ("element_split", serde_json::json!({ "at": 1.0 })),
            ("element_source", serde_json::json!({ "trimStart": 1.0 })),
            ("element_duplicate", serde_json::json!({})),
            ("element_rename", serde_json::json!({ "name": "x" })),
            ("transform_set", serde_json::json!({ "x": 0.5 })),
            ("text_update", serde_json::json!({ "content": "x" })),
            ("effect_add", serde_json::json!({ "type": "blur" })),
            (
                "effect_set",
                serde_json::json!({ "effectId": "fx-1", "enabled": false }),
            ),
            ("effect_remove", serde_json::json!({ "effectId": "fx-1" })),
            ("blend_set", serde_json::json!({ "mode": "screen" })),
            ("audio_set", serde_json::json!({ "volume": 0.5 })),
        ] {
            let mut args = serde_json::json!({ "elementId": "nope" });
            for (key, value) in extra.as_object().unwrap() {
                args[key] = value.clone();
            }
            let error = plan(name, &args, &project)
                .expect_err(&format!("{name} must refuse an unknown element"));
            assert!(
                error.contains("nope"),
                "{name} should name the element it could not find: {error}"
            );
        }
    }

    /// Two clips on one lane, overlapping. The dissolve is the overlap.
    fn dissolve_project() -> Project {
        let mut project = project();
        let clip = |id: &str, start: f64, duration: f64| {
            Element::Shape(ShapeElement {
                id: id.into(),
                name: id.into(),
                start: secs(start).unwrap(),
                duration: secs(duration).unwrap(),
                fade_in: MediaTime::ZERO,
                fade_out: MediaTime::ZERO,
                shape: ShapeKind::Ellipse,
                color: "#ffffff".into(),
                gradient: None,
                stroke: None,
                transform: Transform::default(),
                effects: Vec::new(),
                animations: Default::default(),
                blend_mode: Default::default(),
                mask: None,
                source: Default::default(),
                role: Default::default(),
            })
        };
        project.active_scene_mut().tracks.main.elements =
            vec![clip("a", 0.0, 3.0), clip("b", 2.5, 3.0)];
        project
    }

    /// Only the incoming clip fades. The outgoing one stays at full underneath, which is what
    /// keeps the middle of the dissolve from dipping through the background.
    #[test]
    fn a_dissolve_fades_only_the_incoming_clip() {
        let (label, commands, _) = tx(plan(
            "transition_add",
            &serde_json::json!({ "fromId": "a", "toId": "b", "duration": 0.5 }),
            &dissolve_project(),
        )
        .expect("should plan"));
        assert_eq!(label, "transition_add");
        match &commands[..] {
            [
                Command::SetFades {
                    reference,
                    fade_in,
                    fade_out,
                },
            ] => {
                assert_eq!(
                    reference.element_id, "b",
                    "the incoming clip is the one that fades"
                );
                assert_eq!(*fade_in, secs(0.5).unwrap());
                assert_eq!(*fade_out, MediaTime::ZERO);
            }
            other => panic!("expected one SetFades, got {other:?}"),
        }
    }

    /// Clips that do not overlap have nothing to dissolve through, and the error has to say
    /// what to do about it rather than only that it cannot.
    #[test]
    fn a_dissolve_between_clips_that_do_not_touch_explains_the_fix() {
        let mut project = dissolve_project();
        // Push "b" clear of "a".
        project.active_scene_mut().tracks.main.elements[1].set_start(secs(9.0).unwrap());
        let error = plan(
            "transition_add",
            &serde_json::json!({ "fromId": "a", "toId": "b" }),
            &project,
        )
        .expect_err("nothing to dissolve through");
        assert!(error.contains("do not overlap"), "{error}");
        assert!(error.contains("element_move"), "{error}");
    }

    #[test]
    fn a_dissolve_longer_than_the_overlap_names_both_numbers() {
        let error = plan(
            "transition_add",
            &serde_json::json!({ "fromId": "a", "toId": "b", "duration": 2.0 }),
            &dissolve_project(),
        )
        .expect_err("the overlap is only 0.5s");
        assert!(error.contains("0.50s"), "{error}");
        assert!(error.contains("2.00s"), "{error}");
    }

    #[test]
    fn a_dissolve_across_lanes_is_refused() {
        let mut project = dissolve_project();
        let moved = project.active_scene_mut().tracks.main.elements.remove(1);
        let mut overlay = Track::new("track-overlay", "Overlay", TrackKind::Overlay);
        overlay.elements = vec![moved];
        project.active_scene_mut().tracks.overlay = vec![overlay];

        let error = plan(
            "transition_add",
            &serde_json::json!({ "fromId": "a", "toId": "b" }),
            &project,
        )
        .expect_err("a dissolve needs one lane");
        assert!(error.contains("different lanes"), "{error}");
    }

    #[test]
    fn fade_set_takes_either_end_on_its_own() {
        let (_, commands, _) = tx(plan(
            "fade_set",
            &serde_json::json!({ "elementId": "a", "fadeOut": 1.0 }),
            &dissolve_project(),
        )
        .expect("should plan"));
        match &commands[..] {
            [
                Command::SetFades {
                    fade_in, fade_out, ..
                },
            ] => {
                assert_eq!(*fade_in, MediaTime::ZERO, "the head was not mentioned");
                assert_eq!(*fade_out, secs(1.0).unwrap());
            }
            other => panic!("expected one SetFades, got {other:?}"),
        }
    }

    /// Ducking a bed is keyframes on its level — and `volume` must be offered on audio and
    /// refused on anything else, rather than accepted and quietly ignored.
    #[test]
    fn volume_is_animatable_only_on_audio() {
        let mut project = dissolve_project();
        let mut track = Track::new("track-audio", "Audio", TrackKind::Audio);
        track.elements = vec![Element::Audio(bay_project::AudioElement {
            id: "bed".into(),
            name: "bed".into(),
            start: MediaTime::ZERO,
            duration: secs(10.0).unwrap(),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: "m1".into(),
            muted: false,
            volume: 1.0,
            pan: 0.0,
            speed: 1.0,
            prosody: None,
            dialogue_chain: None,
            trim_start: MediaTime::ZERO,
            animations: Default::default(),
            source: Default::default(),
            role: Default::default(),
        })];
        project.active_scene_mut().tracks.audio = vec![track];

        let keys = serde_json::json!([
            { "t": 2.0, "value": 1.0 },
            { "t": 3.0, "value": 0.2 },
            { "t": 7.0, "value": 0.2 },
            { "t": 8.0, "value": 1.0 },
        ]);
        let planned = plan(
            "animate",
            &serde_json::json!({ "elementId": "bed", "property": "volume", "keys": keys }),
            &project,
        )
        .expect("a bed can be ducked");
        let (_, commands, _) = tx(planned);
        assert!(matches!(commands[..], [Command::ApplyMotionPreset { .. }]));

        let error = plan(
            "animate",
            &serde_json::json!({ "elementId": "bed", "property": "x", "keys": keys }),
            &project,
        )
        .expect_err("a bed has no position");
        assert!(error.contains("volume"), "{error}");

        let error = plan(
            "animate",
            &serde_json::json!({ "elementId": "a", "property": "volume", "keys": keys }),
            &project,
        )
        .expect_err("a shape has no level");
        assert!(error.contains("cannot be animated"), "{error}");
    }

    /// `animate` used to hand `ApplyMotionPreset` the element's own effects, and that command
    /// *appends* — so every call added a second copy of each effect, sharing its id.
    #[test]
    fn animating_twice_does_not_duplicate_the_effects() {
        let planned = plan(
            "animate",
            &serde_json::json!({
                "elementId": "a",
                "property": "opacity",
                "keys": [{ "t": 0, "value": 0 }, { "t": 1, "value": 1 }]
            }),
            &dissolve_project(),
        )
        .expect("should plan");
        let (_, commands, _) = tx(planned);
        match &commands[..] {
            [Command::ApplyMotionPreset { effects, .. }] => {
                assert!(
                    effects.is_empty(),
                    "animate must not re-add effects: {effects:?}"
                );
            }
            other => panic!("expected one ApplyMotionPreset, got {other:?}"),
        }
    }

    #[test]
    fn adding_text_on_the_main_layer_is_one_command() {
        let planned = plan(
            "add_text",
            &serde_json::json!({ "role": "headline", "start": 0, "duration": 2, "content": "Hook" }),
            &project(),
        )
        .expect("should plan");
        let (label, commands, ids) = tx(planned);
        assert_eq!(label, "add_text");
        assert_eq!(commands.len(), 1);
        assert_eq!(ids, vec!["text-1"]);
    }

    #[test]
    fn text_decorations_survive_the_attached_editor_plan() {
        let (_, commands, _) = tx(plan(
            "add_text",
            &serde_json::json!({
                "role": "headline", "start": 0, "duration": 2, "content": "Hook",
                "stroke": { "width": 3, "color": "#111111" },
                "shadow": { "offsetX": 4, "offsetY": 5, "blur": 6 },
                "plate": { "paddingX": 18 }
            }),
            &project(),
        )
        .expect("should plan"));
        let [
            Command::AddElement {
                element: Element::Text(text),
                ..
            },
        ] = &commands[..]
        else {
            panic!("expected one text element: {commands:?}");
        };
        let decorations = text.decorations.as_ref().expect("decorations");
        assert_eq!(decorations.stroke.as_ref().unwrap().width, 3.0);
        assert_eq!(decorations.shadow.as_ref().unwrap().blur, 6.0);
        assert_eq!(decorations.plate.as_ref().unwrap().padding_x, 18.0);
    }

    #[test]
    fn retime_and_group_are_planned_as_first_class_edits() {
        let project = project_with_clip();
        let (_, commands, _) = tx(plan(
            "element_retime",
            &serde_json::json!({
                "elementId": "v1", "speed": 1.5,
                "freezeAt": 2.0, "freezeDuration": 0.75
            }),
            &project,
        )
        .expect("retime should plan"));
        let [
            Command::ReplaceElement {
                element: Element::Video(video),
                ..
            },
        ] = &commands[..]
        else {
            panic!("expected one video replacement: {commands:?}");
        };
        assert_eq!(video.speed, 1.5);
        assert_eq!(video.freeze.as_ref().unwrap().at, secs(2.0).unwrap());

        let (_, commands, _) = tx(plan(
            "group_create",
            &serde_json::json!({ "id": "hero", "elementIds": ["v1"] }),
            &project,
        )
        .expect("group should plan"));
        assert!(matches!(
            &commands[..],
            [Command::SetGroup { group }] if group.id == "hero" && group.children == ["v1"]
        ));
    }

    /// A layer above the last overlay must carry the AddTrack commands with it, in the same
    /// transaction — otherwise the element lands on a track that does not exist.
    #[test]
    fn a_high_layer_creates_the_lanes_it_needs_in_one_transaction() {
        let planned = plan(
            "add_shape",
            &serde_json::json!({ "role": "data", "start": 0, "duration": 1, "layer": 3 }),
            &project(),
        )
        .expect("should plan");
        let (_, commands, _) = tx(planned);
        let adds = commands
            .iter()
            .filter(|c| matches!(c, Command::AddTrack { .. }))
            .count();
        assert_eq!(adds, 3, "three overlay lanes must be created");
        assert!(matches!(commands.last(), Some(Command::AddElement { .. })));
    }

    /// The editor and an agent must never mint the same id: `Track::element_mut` resolves the
    /// first match, so a duplicate silently makes later edits address the wrong element.
    #[test]
    fn minted_ids_avoid_everything_already_in_the_project() {
        let mut project = project();
        let planned = plan(
            "add_text",
            &serde_json::json!({ "role": "headline", "start": 0, "duration": 1, "content": "a" }),
            &project,
        )
        .unwrap();
        let (_, commands, _) = tx(planned);
        // Apply it by hand so the project now contains text-1.
        if let Some(Command::AddElement { element, .. }) = commands.into_iter().next() {
            project
                .active_scene_mut()
                .tracks
                .main
                .elements
                .push(element);
        }
        let planned = plan(
            "add_text",
            &serde_json::json!({ "role": "headline", "start": 1, "duration": 1, "content": "b" }),
            &project,
        )
        .unwrap();
        let (_, _, ids) = tx(planned);
        assert_eq!(ids, vec!["text-2"], "must not reuse text-1");
    }

    #[test]
    fn an_explicit_duplicate_id_is_refused() {
        let mut project = project();
        let hero = match plan(
            "add_text",
            &serde_json::json!({ "role": "headline", "id": "hero", "start": 0, "duration": 1, "content": "a" }),
            &project,
        )
        .unwrap()
        {
            Planned::Tx { commands, .. } => match commands.into_iter().next().unwrap() {
                Command::AddElement { element, .. } => element,
                other => panic!("expected AddElement, got {other:?}"),
            },
            other => panic!("expected a transaction, got {other:?}"),
        };
        project.active_scene_mut().tracks.main.elements.push(hero);
        let error = plan(
            "add_text",
            &serde_json::json!({ "role": "headline", "id": "hero", "start": 1, "duration": 1, "content": "b" }),
            &project,
        )
        .expect_err("a duplicate id must be refused");
        assert!(error.contains("already exists"), "{error}");
    }

    #[test]
    fn an_agent_add_never_steals_the_selection() {
        let planned = plan(
            "add_text",
            &serde_json::json!({ "role": "headline", "start": 0, "duration": 1, "content": "x" }),
            &project(),
        )
        .unwrap();
        let (_, commands, _) = tx(planned);
        match commands.last() {
            Some(Command::AddElement { select, .. }) => {
                assert!(
                    !select,
                    "an agent must not change what the human has selected"
                )
            }
            other => panic!("expected AddElement, got {other:?}"),
        }
    }

    #[test]
    fn animating_a_missing_element_is_refused_before_it_reaches_the_editor() {
        let error = plan(
            "animate",
            &serde_json::json!({ "elementId": "nope", "property": "opacity",
                                 "keys": [{"t":0,"value":0},{"t":1,"value":1}] }),
            &project(),
        )
        .expect_err("should refuse");
        assert!(error.contains("no element"), "{error}");
    }

    /// Three words, one move, staggered — the call that used to be six calls with
    /// hand-computed offsets, which is why nobody made one.
    #[test]
    fn animate_many_staggers_one_move_across_the_group() {
        let mut project = project();
        for (index, id) in ["w1", "w2", "w3"].iter().enumerate() {
            project
                .active_scene_mut()
                .tracks
                .main
                .elements
                .push(Element::Text(bay_project::TextElement {
                    id: (*id).into(),
                    name: format!("word {index}"),
                    start: MediaTime::ZERO,
                    duration: secs(3.0).unwrap(),
                    fade_in: MediaTime::ZERO,
                    fade_out: MediaTime::ZERO,
                    content: (*id).into(),
                    font_size: 96.0,
                    color: "#EDECE6".into(),
                    transform: Default::default(),
                    effects: Vec::new(),
                    animations: Default::default(),
                    blend_mode: Default::default(),
                    mask: None,
                    font_family: None,
                    font_weight: 700,
                    align: Default::default(),
                    letter_spacing: 0.0,
                    line_height: 1.2,
                    decorations: None,
                    karaoke: None,
                    type_on: None,
                    source: Default::default(),
                    role: Default::default(),
                }));
        }

        let (label, commands, _) = tx(plan(
            "animate_many",
            &serde_json::json!({
                "elementIds": ["w1", "w2", "w3"],
                "property": "opacity",
                "from": 0.0, "to": 1.0,
                "duration": 0.4, "at": 0.2, "stagger": 0.1,
                "easing": "spring-out"
            }),
            &project,
        )
        .expect("plans"));
        assert_eq!(label, "animate_many");
        assert_eq!(commands.len(), 3, "one command per element");

        let cue_of = |command: &Command| -> f64 {
            let Command::ApplyMotionPreset { animations, .. } = command else {
                panic!("expected ApplyMotionPreset");
            };
            let channel = animations.get("opacity").expect("opacity channel");
            assert_eq!(channel.easing, Easing::SpringOut);
            // The last key is where it arrives; the one before it is the cue it waited for.
            channel.keys[channel.keys.len() - 2].time.to_seconds_f64()
        };

        let cues: Vec<f64> = commands.iter().map(cue_of).collect();
        assert!((cues[0] - 0.2).abs() < 1e-6, "first cue is `at`: {cues:?}");
        assert!(
            cues[1] > cues[0] && cues[2] > cues[1],
            "each element must wait longer than the last: {cues:?}"
        );
        assert!(
            (cues[2] - cues[1] - (cues[1] - cues[0])).abs() < 1e-6,
            "an even stagger means even gaps: {cues:?}"
        );
    }

    /// A cascade that accelerates reads as a wave; a flat one reads as a conveyor belt.
    #[test]
    fn a_decay_below_one_makes_the_cascade_accelerate() {
        let mut project = project();
        for id in ["w1", "w2", "w3"] {
            project
                .active_scene_mut()
                .tracks
                .main
                .elements
                .push(Element::Shape(bay_project::ShapeElement {
                    id: id.into(),
                    name: id.into(),
                    start: MediaTime::ZERO,
                    duration: secs(3.0).unwrap(),
                    fade_in: MediaTime::ZERO,
                    fade_out: MediaTime::ZERO,
                    shape: Default::default(),
                    color: "#FF5B5B".into(),
                    gradient: None,
                    stroke: None,
                    transform: Default::default(),
                    effects: Vec::new(),
                    animations: Default::default(),
                    blend_mode: Default::default(),
                    mask: None,
                    source: Default::default(),
                    role: Default::default(),
                }));
        }

        let (_, commands, _) = tx(plan(
            "animate_many",
            &serde_json::json!({
                "elementIds": ["w1", "w2", "w3"],
                "property": "y", "from": 0.6, "to": 0.5,
                "duration": 0.3, "stagger": 0.1, "decay": 0.5
            }),
            &project,
        )
        .expect("plans"));
        let cues: Vec<f64> = commands
            .iter()
            .map(|command| {
                let Command::ApplyMotionPreset { animations, .. } = command else {
                    panic!("expected ApplyMotionPreset");
                };
                let channel = animations.get("y").expect("y channel");
                channel.keys[channel.keys.len() - 2].time.to_seconds_f64()
            })
            .collect();
        let (first_gap, second_gap) = (cues[1] - cues[0], cues[2] - cues[1]);
        assert!(
            second_gap < first_gap,
            "gaps must shrink with decay < 1: {first_gap} then {second_gap}"
        );
    }

    /// The same guard `animate` has: offering a property an element cannot carry and then
    /// silently doing nothing with it is worse than refusing.
    #[test]
    fn animate_many_refuses_a_property_the_kind_does_not_have() {
        let project = project_with_clip();
        let error = plan(
            "animate_many",
            &serde_json::json!({
                "elementIds": ["v1"], "property": "volume", "from": 0.0, "to": 1.0
            }),
            &project,
        )
        .expect_err("a video has no level");
        assert!(error.contains("cannot be animated"), "{error}");
    }

    /// Every curve the schema offers must parse, or an agent picks one from the enum and gets
    /// an error it cannot act on.
    #[test]
    fn every_advertised_easing_parses() {
        for name in EASINGS {
            parse_easing(Some(name)).unwrap_or_else(|e| panic!("{name} is advertised but {e}"));
        }
    }

    #[test]
    fn reads_do_not_produce_commands() {
        match plan("timeline", &serde_json::json!({}), &project()).unwrap() {
            Planned::Read(value) => assert!(value["layers"].is_array()),
            Planned::Tx { .. } => panic!("timeline is a read"),
        }
    }

    /// No answer may tell the user to close the editor. Rendering and narration run on a
    /// worker now; suggesting someone quit the app to use their video editor gives up the
    /// feature the editor exists for, and this test exists so that answer cannot come back.
    #[test]
    fn nothing_is_ever_refused_by_telling_the_user_to_work_headlessly() {
        let project = project();
        for name in available_tools() {
            let Err(message) = plan(name, &serde_json::json!({}), &project) else {
                continue;
            };
            for forbidden in ["headless", "close the app", "quit"] {
                assert!(
                    !message.to_lowercase().contains(forbidden),
                    "{name} answers with {forbidden:?}: {message}"
                );
            }
        }
    }

    /// The slow tools are dispatched to a worker rather than planned here, so `plan` must not
    /// claim they are unknown — an agent reading "not a tool bay knows" would stop.
    #[test]
    fn the_slow_tools_are_advertised_as_available() {
        let available = available_tools();
        for name in crate::slow::slow_tools() {
            assert!(
                available.contains(name),
                "{name} runs on the worker but is not advertised as available"
            );
        }
    }

    #[test]
    fn every_planned_tool_actually_plans() {
        let project = project();
        for name in planned_tools() {
            let result = plan(name, &serde_json::json!({}), &project);
            // Empty args should give a FIELD error, never "cannot run against the open editor".
            if let Err(message) = result {
                assert!(
                    !message.contains("cannot run against"),
                    "{name} is advertised as planned but falls through to the catch-all"
                );
            }
        }
    }
}

// ------------------------------------------------------------- captions and narration

/// Fade in and out on every caption, in seconds.
///
/// **0.28, not the 0.12 it was.** At 30 fps a 0.12 s fade is three and a half frames — a pop,
/// not a fade — and the project this comes from carried 76 of them, every one of them from this
/// constant. It is not a tool argument: there is no video in which a caption should flicker, and
/// making it settable is how it came to be set wrong 76 times in one file.
pub const CAPTION_FADE_SECONDS: f64 = 0.28;

/// Which layer captions draw on. High, so they sit over the artwork.
pub const CAPTION_LAYER: usize = 9;

/// How loud the spoken word is on screen.
///
/// **This is the whole caption-style surface.** It replaces eleven arguments — size, colour,
/// family, weight, layer, fade, words per line and three cue-timing floors — every one of which
/// the project this comes from set, and set wrong. A preset names what the captions are *doing*;
/// the committed style kit answers what that looks like, exactly as `role` does for `add_text`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CaptionPreset {
    /// Support: the small line under a picture that is carrying the beat. The kit's label step,
    /// in its quiet tone.
    Quiet,
    /// The default. Spoken words, at the kit's caption step, in its ink.
    #[default]
    Plain,
    /// Kinetic type: two words at a time at headline size, where the words *are* the picture.
    Loud,
}

impl CaptionPreset {
    pub const NAMES: [&'static str; 3] = ["quiet", "plain", "loud"];

    pub fn parse(name: &str) -> Result<Self, String> {
        match name {
            "quiet" => Ok(Self::Quiet),
            "plain" => Ok(Self::Plain),
            "loud" => Ok(Self::Loud),
            other => Err(format!(
                "unknown captionStyle {other:?} — one of {:?}",
                Self::NAMES
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Quiet => "quiet",
            Self::Plain => "plain",
            Self::Loud => "loud",
        }
    }

    /// Which rung of the kit's type ramp this preset is set on.
    fn role(self) -> ElementRole {
        match self {
            Self::Quiet => ElementRole::Label,
            Self::Plain => ElementRole::Caption,
            Self::Loud => ElementRole::Headline,
        }
    }

    fn tone(self) -> bay_project::Tone {
        match self {
            Self::Quiet => bay_project::Tone::Dim,
            Self::Plain | Self::Loud => bay_project::Tone::Ink,
        }
    }

    /// Words to a line. Kinetic type carries fewer, because each one is enormous.
    fn max_words(self) -> usize {
        match self {
            Self::Quiet | Self::Plain => 4,
            Self::Loud => 2,
        }
    }

    /// How this preset's cues are grouped. Everything else about grouping — the floors under a
    /// caption's time on screen, the sentence rule — is a fact about reading and is not settable.
    pub fn cue_style(self) -> bay_speech::CueStyle {
        bay_speech::CueStyle {
            max_words: self.max_words(),
            ..bay_speech::CueStyle::default()
        }
    }
}

/// Where a caption sits, for the three things about it that are genuinely a decision.
///
/// `x` and `align` are here because they were *not* settable before, which is why 38 caption
/// elements in one project shared x = 0.08 — a constant, copied into every video bay has made.
#[derive(Debug, Clone, Copy, Default)]
pub struct CaptionPlacement {
    pub x: Option<f32>,
    pub y: Option<f32>,
    pub align: Option<TextAlign>,
}

/// How captions are typed and placed.
///
/// **One definition, both front ends.** `bay-mcp` re-exports this rather than mirroring it: the
/// two copies that used to exist are exactly how a caption came to mean one thing in the window
/// and another over the wire.
#[derive(Debug, Clone)]
pub struct CaptionStyle {
    pub preset: CaptionPreset,
    pub font_size: f32,
    pub color: String,
    /// Active-word colour for karaoke captions.
    pub highlight_color: String,
    pub font_family: Option<String>,
    pub font_weight: u16,
    /// Horizontal position of the caption box, as a fraction of the canvas.
    pub x: f32,
    /// Top of the caption box, as a fraction of the canvas.
    pub y: f32,
    pub align: TextAlign,
    /// Width of the caption box, as a fraction of the canvas.
    pub scale: f32,
    pub letter_spacing: f32,
    pub line_height: f32,
    pub layer: usize,
    /// Fade in/out seconds. A hard cut on every caption reads as a flicker.
    pub fade: f64,
    /// Display name per speaker id, for a clip where more than one person talks.
    ///
    /// Without one, a two-hander reads as a single person contradicting themselves — the
    /// captions say the words and lose who said them, which on a social cut is most of the
    /// point of the exchange. The name is written **only on the first caption after the floor
    /// changes**, because prefixing every line eats the frame and stops being read after the
    /// second one.
    pub speaker_labels: std::collections::BTreeMap<String, String>,
    /// Caption colour per speaker id.
    ///
    /// Carries who is talking without spending any of the frame, which is why it does the work
    /// on the lines that are not labelled. Two speakers want two colours that survive a
    /// thumbnail; more than three, and the labels are doing the work and the colour is noise.
    pub speaker_colors: std::collections::BTreeMap<String, String>,
}

impl Default for CaptionStyle {
    fn default() -> Self {
        Self {
            preset: CaptionPreset::Plain,
            font_size: 46.0,
            color: "#EDECE6".to_string(),
            highlight_color: "#FFD84D".to_string(),
            font_family: None,
            font_weight: 600,
            x: 0.08,
            y: 0.70,
            align: TextAlign::Left,
            scale: 0.84,
            letter_spacing: 0.0,
            line_height: 1.2,
            layer: CAPTION_LAYER,
            fade: CAPTION_FADE_SECONDS,
            speaker_labels: std::collections::BTreeMap::new(),
            speaker_colors: std::collections::BTreeMap::new(),
        }
    }
}

impl CaptionStyle {
    /// The kit's own answer to a preset, placed where the caller asked — or, failing that, where
    /// the kit puts a lower third.
    ///
    /// Captions are bay's output rather than the author's, so they do not go through `add_text`
    /// — but they are the largest single block of type in most of these videos, and leaving them
    /// on a hardcoded size, a hardcoded off-white and a hardcoded x is how every project on this
    /// machine came to share the same three values.
    pub fn from_kit(
        kit: &bay_project::StyleKit,
        preset: CaptionPreset,
        placement: CaptionPlacement,
    ) -> CaptionStyle {
        let style = kit.resolve(preset.role(), preset.tone());
        let framing = kit
            .framing("lower-third")
            .or_else(|| kit.framings.iter().find(|f| f.is_bottom_weighted()));
        let default = CaptionStyle::default();
        let (base_x, base_y, base_anchor, base_scale) = match framing {
            Some(f) => (f.x, f.y, f.anchor_x, f.scale),
            None => (default.x, default.y, 0.0, default.scale),
        };
        let align = placement.align.unwrap_or(match base_anchor {
            a if a >= 0.75 => TextAlign::Right,
            a if a >= 0.25 => TextAlign::Center,
            _ => TextAlign::Left,
        });
        CaptionStyle {
            preset,
            font_size: style.size,
            color: style.color,
            highlight_color: kit.palette.accent.clone(),
            font_family: Some(style.family),
            font_weight: style.weight,
            x: placement.x.unwrap_or(base_x),
            y: placement.y.unwrap_or(base_y),
            align,
            scale: base_scale,
            letter_spacing: style.tracking,
            line_height: style.line_height,
            layer: CAPTION_LAYER,
            fade: CAPTION_FADE_SECONDS,
            speaker_labels: std::collections::BTreeMap::new(),
            speaker_colors: std::collections::BTreeMap::new(),
        }
    }

    /// Which point of the caption box sits at `x`. Derived from the alignment, so a centred
    /// caption at x = 0.5 is actually centred rather than starting at the middle.
    pub fn anchor_x(&self) -> f32 {
        match self.align {
            TextAlign::Left => 0.0,
            TextAlign::Center => 0.5,
            TextAlign::Right => 1.0,
        }
    }

    pub fn cue_style(&self) -> bay_speech::CueStyle {
        self.preset.cue_style()
    }
}

/// The caption arguments that used to exist and do not any more.
///
/// Refused rather than ignored, for the same reason `fontSize` is: an argument that is silently
/// dropped teaches the caller it worked. Each message names what now decides that value.
pub fn reject_raw_caption_style(args: &Value, tool: &str) -> Result<(), String> {
    const DELETED: [(&str, &str); 11] = [
        ("captionFontSize", "captionStyle picks the kit's step"),
        ("captionColor", "captionStyle picks the kit's tone"),
        ("captionFontFamily", "captionStyle picks the kit's face"),
        ("captionFontWeight", "captionStyle picks the kit's weight"),
        ("captionLayer", "captions always draw above the artwork"),
        (
            "captionFade",
            "the fade is fixed at 0.28s — a shorter one is a pop, and 76 of them shipped",
        ),
        (
            "maxWords",
            "captionStyle decides how many words a line holds",
        ),
        (
            "minCaptionSeconds",
            "a caption is held for at least 0.833s and 0.30s a word, which is not negotiable",
        ),
        (
            "maxCaptionSeconds",
            "cues break on sentences, not on a clock",
        ),
        (
            "gapSeconds",
            "a real pause breaks a caption; the threshold is not a dial",
        ),
        (
            "captionAnchor",
            "captionAlign decides which edge the box hangs off",
        ),
    ];
    for (key, why) in DELETED {
        if args.get(key).is_some_and(|v| !v.is_null()) {
            return Err(format!(
                "{tool} does not take {key:?} any more — {why}. Say how loud the captions are \
                 with \"captionStyle\" (one of {:?}) and where they sit with \"captionX\", \
                 \"captionY\" and \"captionAlign\"; the committed style kit answers the rest.",
                CaptionPreset::NAMES,
            ));
        }
    }
    Ok(())
}

/// The caption style a call asked for, resolved against the project's committed kit.
///
/// A project with no kit — one written before kits existed — falls back to the built-in defaults
/// rather than refusing to place a caption on it.
pub fn caption_style_from(
    args: &Value,
    kit: Option<&bay_project::StyleKit>,
    tool: &str,
) -> Result<CaptionStyle, String> {
    reject_raw_caption_style(args, tool)?;
    let preset = match args.get("captionStyle").and_then(|v| v.as_str()) {
        Some(name) => CaptionPreset::parse(name)?,
        None => CaptionPreset::default(),
    };
    let placement = CaptionPlacement {
        x: args
            .get("captionX")
            .and_then(|v| v.as_f64())
            .map(|v| v as f32),
        y: args
            .get("captionY")
            .and_then(|v| v.as_f64())
            .map(|v| v as f32),
        align: match args.get("captionAlign").and_then(|v| v.as_str()) {
            Some(name) => Some(parse_text_align(name)?),
            None => None,
        },
    };
    // Who is talking, if the caller said. Both maps are keyed by the speaker id `diarize`
    // writes into the transcript, which is also what `transcript_get` reports.
    let map_of_strings = |key: &str| -> std::collections::BTreeMap<String, String> {
        args.get(key)
            .and_then(|value| value.as_object())
            .map(|object| {
                object
                    .iter()
                    .filter_map(|(speaker, value)| {
                        value
                            .as_str()
                            .map(|text| (speaker.clone(), text.to_string()))
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let speaker_labels = map_of_strings("speakerLabels");
    let speaker_colors = map_of_strings("speakerColors");

    Ok(match kit {
        Some(kit) => CaptionStyle {
            speaker_labels,
            speaker_colors,
            ..CaptionStyle::from_kit(kit, preset, placement)
        },
        None => CaptionStyle {
            preset,
            x: placement.x.unwrap_or(CaptionStyle::default().x),
            y: placement.y.unwrap_or(CaptionStyle::default().y),
            align: placement.align.unwrap_or(TextAlign::Left),
            speaker_labels,
            speaker_colors,
            ..CaptionStyle::default()
        },
    })
}

fn parse_text_align(name: &str) -> Result<TextAlign, String> {
    match name {
        "left" => Ok(TextAlign::Left),
        "center" | "centre" => Ok(TextAlign::Center),
        "right" => Ok(TextAlign::Right),
        other => Err(format!(
            "unknown captionAlign {other:?} — left, center or right"
        )),
    }
}

/// The opacity channel that fades a caption in and out inside its own window.
///
/// Clamped to a third of the duration so a very short cue does not get a fade longer than the
/// caption itself — which would leave it never reaching full opacity.
fn caption_fade(fade: f64, duration: f64) -> Option<AnimationChannel> {
    let fade = fade.min(duration / 3.0).max(0.0);
    if fade <= 0.0 || duration <= 0.0 {
        return None;
    }
    let mut keys = Vec::new();
    for (t, value) in [
        (0.0, 0.0f32),
        (fade, 1.0),
        (duration - fade, 1.0),
        (duration, 0.0),
    ] {
        if let Ok(time) = secs(t) {
            keys.push(bay_project::Keyframe::new(time, value));
        }
    }
    Some(AnimationChannel {
        keys,
        easing: Easing::EaseOut,
    })
}

fn karaoke_for_cue(
    project: &Project,
    cue: &bay_speech::Cue,
    highlight_color: &str,
) -> bay_project::KaraokeSpec {
    let mut has_word_timing = false;
    let mut projected = Vec::new();
    for element in project.active_scene().elements() {
        let Element::Audio(audio) = element else {
            continue;
        };
        if audio.role != bay_project::AudioRole::Speech || audio.speed <= 0.0 {
            continue;
        }
        let Some(transcript) = project
            .media
            .iter()
            .find(|asset| asset.id == audio.media_id)
            .and_then(|asset| asset.transcript.as_ref())
        else {
            continue;
        };
        has_word_timing |= !transcript.words.is_empty();
        let speed = f64::from(audio.speed);
        let source_start = audio.trim_start.to_seconds_f64();
        let source_end = source_start + audio.duration.to_seconds_f64() * speed;
        let timeline_start = audio.start.to_seconds_f64();
        projected.extend(transcript.words.iter().filter_map(|word| {
            if word.start_seconds < source_start || word.end_seconds > source_end {
                return None;
            }
            let start = timeline_start + (word.start_seconds - source_start) / speed;
            let end = timeline_start + (word.end_seconds - source_start) / speed;
            (start >= cue.start && start < cue.end).then(|| bay_project::KaraokeWord {
                text: word.text.clone(),
                start: secs((start - cue.start).max(0.0)).unwrap_or(MediaTime::ZERO),
                end: secs((end - cue.start).min(cue.duration()).max(0.0))
                    .unwrap_or(MediaTime::ZERO),
            })
        }));
    }
    if has_word_timing {
        projected.sort_by_key(|word| word.start);
        return bay_project::KaraokeSpec {
            words: projected,
            highlight_color: highlight_color.to_string(),
        };
    }

    let tokens: Vec<&str> = cue.text.split_whitespace().collect();
    let slice = cue.duration().max(0.05) / tokens.len().max(1) as f64;
    bay_project::KaraokeSpec {
        words: tokens
            .iter()
            .enumerate()
            .map(|(index, token)| bay_project::KaraokeWord {
                text: (*token).to_string(),
                start: secs(index as f64 * slice).unwrap_or(MediaTime::ZERO),
                end: secs((index + 1) as f64 * slice).unwrap_or(MediaTime::ZERO),
            })
            .collect(),
        highlight_color: highlight_color.to_string(),
    }
}

/// Commands that put `cues` on the timeline as captions.
fn caption_commands(
    project: &Project,
    cues: &[bay_speech::Cue],
    style: &CaptionStyle,
    commands: &mut Vec<Command>,
    new_ids: &mut Vec<String>,
) -> Result<(), String> {
    // The same resolution gate `add_text` applies: shape a glyph, and refuse if the face that
    // carried it is not the one that was asked for. cosmic-text drops the family rather than
    // snapping to the nearest weight, so a caption block is otherwise the one way past it.
    if let Some(family) = &style.font_family {
        let mut raster = bay_text::TextRaster::new();
        let resolved = raster.resolve_face(family, style.font_weight);
        match resolved {
            Some(face) if face.is(family) && face.weight == style.font_weight => {}
            Some(face) => {
                return Err(format!(
                    "the captions ask for {family:?} at weight {}, and this machine would render \
                     them in {:?} at weight {} instead. {family:?} is installed at weight(s) {:?}; \
                     call style_pick for a kit whose typefaces are installed here.",
                    style.font_weight,
                    face.family,
                    face.weight,
                    raster.resolvable_weights(family),
                ));
            }
            None => return Err("no fonts at all are installed on this machine".to_string()),
        }
    }

    let (track_id, mut track_commands) = track_for_layer(project, style.layer);
    commands.append(&mut track_commands);

    let mut counter = 0usize;
    for cue in cues {
        let id = loop {
            counter += 1;
            let candidate = format!("caption-{counter}");
            if find_ref(project, &candidate).is_none() && !new_ids.contains(&candidate) {
                break candidate;
            }
        };
        let duration = cue.duration().max(0.05);
        let mut animations = BTreeMap::new();
        if let Some(channel) = caption_fade(style.fade, duration) {
            animations.insert("opacity".to_string(), channel);
        }
        commands.push(Command::AddElement {
            track_id: track_id.clone(),
            element: Element::Text(TextElement {
                id: id.clone(),
                name: cue.text.chars().take(24).collect(),
                start: secs(cue.start)?,
                duration: secs(duration)?,
                fade_in: MediaTime::ZERO,
                fade_out: MediaTime::ZERO,
                content: cue.text.clone(),
                font_size: style.font_size,
                color: style.color.clone(),
                transform: Transform {
                    x: style.x,
                    y: style.y,
                    scale: style.scale,
                    anchor_x: style.anchor_x(),
                    anchor_y: 0.0,
                    ..Transform::default()
                },
                effects: Vec::new(),
                animations,
                blend_mode: Default::default(),
                mask: None,
                font_family: style.font_family.clone(),
                font_weight: style.font_weight,
                align: style.align,
                letter_spacing: style.letter_spacing,
                line_height: style.line_height,
                decorations: None,
                karaoke: Some(karaoke_for_cue(project, cue, &style.highlight_color)),
                type_on: None,
                // bay wrote this, not the author — the same stamp the headless path applies,
                // so a caption means the same thing whichever front end placed it.
                source: ElementSource::Tool,
                role: ElementRole::Caption,
            }),
            select: false,
        });
        new_ids.push(id);
    }
    Ok(())
}

/// The audio lane, creating it if this project has none yet.
///
/// Returns any command needed to bring it into existence, so a caller assembling one
/// transaction does not have to mutate first and plan second.
fn audio_track(project: &Project) -> (String, Vec<Command>) {
    if let Some(track) = project.active_scene().tracks.audio.first() {
        return (track.id.clone(), Vec::new());
    }
    let id = "track-audio".to_string();
    (
        id.clone(),
        vec![Command::AddTrack {
            lane: TrackLane::Audio,
            id,
            name: "Audio".to_string(),
        }],
    )
}

/// Cues placed as captions, as one transaction.
pub fn plan_captions(
    project: &Project,
    cues: &[bay_speech::Cue],
    style: &CaptionStyle,
) -> Result<Planned, String> {
    let mut commands = Vec::new();
    let mut new_ids = Vec::new();
    caption_commands(project, cues, style, &mut commands, &mut new_ids)?;
    Ok(Planned::Tx {
        label: "captions".into(),
        commands,
        scene_id: project.active_scene().id.clone(),
        new_ids,
    })
}

/// A finished narration: its audio on the audio lane, and its captions above.
///
/// Media registration is NOT a command — `Editor::add_media` is a registry, not undo history —
/// so the asset comes back separately for the applier to register before the transaction runs.
#[allow(clippy::too_many_arguments)]
pub fn place_narration(
    project: &Project,
    asset: bay_project::MediaAsset,
    utterance: &bay_speech::Utterance,
    // `script` is what was spoken. Captions are split against it, because the sidecar drops
    // punctuation tokens and a full stop is only visible here.
    script: &str,
    start: f64,
    volume: f32,
    cue_style: &bay_speech::CueStyle,
    captions: Option<CaptionStyle>,
) -> Result<Planned, String> {
    let media_id = asset.id.clone();
    let (audio_track_id, mut commands) = audio_track(project);
    let mut new_ids = Vec::new();

    let audio_id = mint_id(project, "audio");
    commands.push(Command::AddElement {
        track_id: audio_track_id,
        element: Element::Audio(bay_project::AudioElement {
            id: audio_id.clone(),
            name: "narration".into(),
            start: secs(start)?,
            duration: secs(utterance.duration_seconds)?,
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id,
            muted: false,
            trim_start: MediaTime::ZERO,
            volume,
            pan: 0.0,
            speed: 1.0,
            prosody: Some(bay_project::SpeechProsody::default()),
            dialogue_chain: Some(bay_project::DialogueAudioChain::default()),
            animations: Default::default(),
            source: ElementSource::Tool,
            role: bay_project::AudioRole::Speech,
        }),
        select: false,
    });
    new_ids.push(audio_id);

    if let Some(style) = captions {
        // Shifted to where the audio actually starts: word timings come back relative to the
        // utterance, so captions that ignore `start` drift by exactly that much.
        let cues = bay_speech::shift(&utterance.cues_for(script, cue_style), start);
        caption_commands(project, &cues, &style, &mut commands, &mut new_ids)?;
    }

    Ok(Planned::Tx {
        label: "narrate".into(),
        commands,
        scene_id: project.active_scene().id.clone(),
        new_ids,
    })
}

/// Every caption currently on the timeline, earliest first.
///
/// Identified by the `caption-` id prefix, the same convention the headless path uses — so a
/// subtitle file exported from the editor matches one exported headlessly.
fn caption_cues(project: &Project) -> Vec<bay_speech::Cue> {
    let mut cues: Vec<bay_speech::Cue> = project
        .active_scene()
        .tracks
        .iter()
        .flat_map(|track| track.elements.iter())
        .filter_map(|element| match element {
            Element::Text(text) if text.id.starts_with("caption-") => Some(bay_speech::Cue {
                start: text.start.to_seconds_f64(),
                end: (text.start + text.duration).to_seconds_f64(),
                text: text.content.clone(),
            }),
            _ => None,
        })
        .collect();
    cues.sort_by(|a, b| a.start.total_cmp(&b.start));
    cues
}
