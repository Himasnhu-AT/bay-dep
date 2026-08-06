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

use serde_json::Value;
use vii_core::{Command, ElementRef, TrackLane};
use vii_project::{
    AnimationChannel, Easing, Effect, Element, MediaTime, Project, ShapeElement, ShapeKind,
    TextAlign, TextElement, Transform,
};

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
        "timeline",
        "add_text",
        "add_shape",
        "animate",
        "element_delete",
    ]
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
    Transform {
        x: number(args, "x", 0.5) as f32,
        y: number(args, "y", 0.5) as f32,
        scale: number(args, "scale", 1.0) as f32,
        rotation: number(args, "rotation", 0.0) as f32,
        opacity: number(args, "opacity", 1.0) as f32,
        scale_x: number(args, "scaleX", 1.0) as f32,
        scale_y: number(args, "scaleY", 1.0) as f32,
        anchor_x: number(args, "anchorX", 0.5) as f32,
        anchor_y: number(args, "anchorY", 0.5) as f32,
    }
}

/// A fresh element id that does not collide with anything already in the project.
///
/// Minting here, from the real project, is what stops the editor and an agent from both
/// handing out `text-3`: `Track::element_mut` resolves the first match, so a duplicate id
/// silently makes every later edit address the wrong element.
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

fn describe_element(element: &Element) -> Value {
    let mut out = serde_json::json!({
        "id": element.id(),
        "kind": element.kind().label(),
        "startSeconds": element.start().to_seconds_f64(),
        "durationSeconds": element.duration().to_seconds_f64(),
    });
    if let Some(t) = element.transform() {
        out["transform"] = serde_json::json!({
            "x": t.x, "y": t.y, "scale": t.scale,
            "scaleX": t.scale_x, "scaleY": t.scale_y,
            "anchorX": t.anchor_x, "anchorY": t.anchor_y,
            "rotation": t.rotation, "opacity": t.opacity,
        });
    }
    if let Some(animations) = element.animations()
        && !animations.is_empty()
    {
        out["animated"] = serde_json::json!(animations.keys().collect::<Vec<_>>());
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

fn parse_easing(name: Option<&str>) -> Result<Easing, String> {
    Ok(match name.unwrap_or("linear") {
        "linear" => Easing::Linear,
        "ease-in" => Easing::EaseIn,
        "ease-out" => Easing::EaseOut,
        "ease-in-out" => Easing::EaseInOut,
        "power-out" => Easing::PowerOut,
        "expo-out" => Easing::ExpoOut,
        "back-out" => Easing::BackOut,
        "hold" => Easing::Hold,
        other => {
            return Err(format!(
                "unknown easing {other:?} — use one of linear, ease-in, ease-out, ease-in-out, \
                 power-out, expo-out, back-out, hold"
            ));
        }
    })
}

/// Plan one tool call against `project`.
pub fn plan(name: &str, args: &Value, project: &Project) -> Result<Planned, String> {
    let scene_id = project.active_scene().id.clone();

    match name {
        // ------------------------------------------------------------------ reads
        "project_info" => {
            let scene = project.active_scene();
            let visual: usize = scene
                .tracks
                .iter()
                .filter(|t| !matches!(t.kind, vii_project::TrackKind::Audio))
                .map(|t| t.elements.len())
                .sum();
            let audio: usize = scene.tracks.audio.iter().map(|t| t.elements.len()).sum();
            let duration = scene
                .tracks
                .iter()
                .flat_map(|t| t.elements.iter())
                .map(|e| e.end().to_seconds_f64())
                .fold(0.0_f64, f64::max);
            Ok(Planned::Read(serde_json::json!({
                "name": project.metadata.name,
                "id": project.metadata.id,
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
            let id = text(args, "id").unwrap_or_else(|| mint_id(project, "text"));
            if find_ref(project, &id).is_some() {
                return Err(format!("an element with id {id:?} already exists"));
            }

            let element = Element::Text(TextElement {
                name: content.chars().take(24).collect(),
                id: id.clone(),
                start: secs(start)?,
                duration: secs(duration)?,
                content,
                font_size: number(args, "fontSize", 64.0) as f32,
                color: text(args, "color").unwrap_or_else(|| "#ffffff".into()),
                transform: transform_from(args),
                effects: Vec::new(),
                animations: BTreeMap::new(),
                blend_mode: Default::default(),
                font_family: text(args, "fontFamily"),
                font_weight: number(args, "fontWeight", 400.0) as u16,
                align: match args.get("align").and_then(|v| v.as_str()).unwrap_or("left") {
                    "center" => TextAlign::Center,
                    "right" => TextAlign::Right,
                    _ => TextAlign::Left,
                },
                letter_spacing: number(args, "letterSpacing", 0.0) as f32,
                line_height: number(args, "lineHeight", 1.2) as f32,
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
            let id = text(args, "id").unwrap_or_else(|| mint_id(project, "shape"));
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
                    shape,
                    color: text(args, "color").unwrap_or_else(|| "#ffffff".into()),
                    transform: transform_from(args),
                    effects: Vec::new(),
                    animations: BTreeMap::new(),
                    blend_mode: Default::default(),
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

        "animate" => {
            let element_id = text(args, "elementId")
                .ok_or_else(|| "missing required string field \"elementId\"".to_string())?;
            let property = text(args, "property")
                .ok_or_else(|| "missing required string field \"property\"".to_string())?;
            if !Element::ANIMATABLE.contains(&property.as_str()) {
                return Err(format!(
                    "{property:?} is not animatable — pick one of {:?}",
                    Element::ANIMATABLE
                ));
            }
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
                channel.upsert(secs(t)?, value as f32);
            }

            let reference = find_ref(project, &element_id)
                .ok_or_else(|| format!("no element {element_id:?} on the timeline"))?;
            let element = project
                .active_scene()
                .element(&reference)
                .ok_or_else(|| format!("no element {element_id:?} on the timeline"))?;
            let mut animations = element
                .animations()
                .cloned()
                .ok_or_else(|| format!("{element_id:?} is an audio clip and has no transform"))?;
            let effects: Vec<Effect> = element.effects().to_vec();
            animations.insert(property.clone(), channel);

            Ok(Planned::Tx {
                label: "animate".into(),
                commands: vec![Command::ApplyMotionPreset {
                    reference,
                    effects,
                    animations,
                }],
                scene_id,
                new_ids: Vec::new(),
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

        other => Err(format!(
            "{other:?} cannot run against the open editor yet — it needs the GPU or a sidecar. \
             Close the app to use it headlessly, or use one of {:?}",
            planned_tools()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vii_project::{CanvasSize, Fps, ProjectSettings, Scene, Track, TrackKind, Tracks};

    fn project() -> Project {
        Project {
            metadata: vii_project::ProjectMetadata {
                id: "p".into(),
                name: "Test".into(),
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

    #[test]
    fn adding_text_on_the_main_layer_is_one_command() {
        let planned = plan(
            "add_text",
            &serde_json::json!({ "start": 0, "duration": 2, "content": "Hook" }),
            &project(),
        )
        .expect("should plan");
        let (label, commands, ids) = tx(planned);
        assert_eq!(label, "add_text");
        assert_eq!(commands.len(), 1);
        assert_eq!(ids, vec!["text-1"]);
    }

    /// A layer above the last overlay must carry the AddTrack commands with it, in the same
    /// transaction — otherwise the element lands on a track that does not exist.
    #[test]
    fn a_high_layer_creates_the_lanes_it_needs_in_one_transaction() {
        let planned = plan(
            "add_shape",
            &serde_json::json!({ "start": 0, "duration": 1, "layer": 3 }),
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
            &serde_json::json!({ "start": 0, "duration": 1, "content": "a" }),
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
            &serde_json::json!({ "start": 1, "duration": 1, "content": "b" }),
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
            &serde_json::json!({ "id": "hero", "start": 0, "duration": 1, "content": "a" }),
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
            &serde_json::json!({ "id": "hero", "start": 1, "duration": 1, "content": "b" }),
            &project,
        )
        .expect_err("a duplicate id must be refused");
        assert!(error.contains("already exists"), "{error}");
    }

    #[test]
    fn an_agent_add_never_steals_the_selection() {
        let planned = plan(
            "add_text",
            &serde_json::json!({ "start": 0, "duration": 1, "content": "x" }),
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

    #[test]
    fn reads_do_not_produce_commands() {
        match plan("timeline", &serde_json::json!({}), &project()).unwrap() {
            Planned::Read(value) => assert!(value["layers"].is_array()),
            Planned::Tx { .. } => panic!("timeline is a read"),
        }
    }

    #[test]
    fn a_tool_that_needs_the_gpu_says_so_instead_of_failing_obscurely() {
        let error = plan(
            "render",
            &serde_json::json!({ "path": "/tmp/x.mp4" }),
            &project(),
        )
        .expect_err("render cannot run against the attached editor yet");
        assert!(error.contains("headlessly"), "{error}");
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
