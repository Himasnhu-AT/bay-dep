//! Tool calls that take too long to run on the UI thread.
//!
//! Everything in [`plan`](crate::plan) is microseconds of pure computation, so it runs on the
//! GPUI main thread where the single writer lives. Three tools are not like that: `render`
//! encodes an MP4 (seconds to minutes), `narrate` synthesises speech (1–5s, longer the first
//! time when Kokoro fetches its weights), and `media_import` shells out to ffprobe.
//!
//! They used to be refused while the editor was open, with a message suggesting the user quit
//! the app and work headlessly. That was the wrong trade: the entire point of the editor
//! hosting an agent is watching the edit land, and an answer that begins "close the window"
//! throws the feature away to protect a frame budget.
//!
//! So they run on a background thread instead, and the split is deliberate:
//!
//! - the **slow half** here takes an owned snapshot and touches nothing shared — it encodes,
//!   synthesises, probes;
//! - the **mutation** it implies comes back as a [`FollowUp`] and is turned into `Command`s on
//!   the main thread by [`plan_follow_up`].
//!
//! That keeps the single-writer invariant. A worker thread that mutated the project directly
//! would race the human dragging a clip, and its edits would not be in the undo history.

use bay_project::{MediaAsset, Project};
use bay_speech::{CueStyle, Utterance};
use serde_json::Value;

use crate::plan::Planned;

/// Tools that must not run on the UI thread.
pub fn slow_tools() -> &'static [&'static str] {
    &["render", "narrate", "media_import", "subtitles_to_video"]
}

/// Tools that answer with a **job id** instead of a result, for the caller to poll.
///
/// A narrower list than [`slow_tools`], because the two answer different questions.
/// `slow_tools` means "must not run on the UI thread"; this means "takes long enough that
/// holding a request open for it is the wrong shape". `media_import` is in the first and not
/// the second: it is a `probe_media` shell-out measured in hundreds of milliseconds, and it is
/// step 3 of the eight-step authoring loop. Making an agent poll for it would be a round trip
/// bought for nothing.
///
/// The distinction is load-bearing for the timeout too — `media_import` still needs a budget
/// larger than the 20s meant for a file dialog, because it is the one slow tool that still
/// answers in-band.
pub fn job_tools() -> &'static [&'static str] {
    &["render", "narrate", "subtitles_to_video"]
}

/// What the main thread should do with a finished job.
pub enum FollowUp {
    /// Nothing — the work produced a file and changed no document state.
    None,
    /// Register probed media.
    ImportMedia(Box<MediaAsset>),
    /// Swap in a project the worker built from scratch.
    ///
    /// Only for tools whose whole job is producing a new document — `subtitles_to_video` picks
    /// the canvas, sizes the timeline to the last cue and renders. Replacing rather than
    /// patching is what it does headlessly too.
    ReplaceProject(Box<Project>),
    /// Place a finished narration: the audio on its lane, and its captions.
    PlaceNarration {
        asset: Box<MediaAsset>,
        utterance: Box<Utterance>,
        start: f64,
        volume: f32,
        cue_style: CueStyle,
        captions: Option<crate::plan::CaptionStyle>,
    },
}

/// A finished background job.
pub struct SlowResult {
    /// What to answer the agent with.
    pub value: Value,
    /// What the main thread must apply, if anything.
    pub follow_up: FollowUp,
}

/// Everything a slow job needs, copied out of the editor on the main thread.
///
/// Owned rather than borrowed on purpose: the worker must not hold a reference into a project
/// the user is still editing.
pub struct SlowContext {
    pub project: Project,
    pub timeline_duration: f64,
    /// Seeds ids so a worker cannot mint one the editor is about to use.
    pub next_id: usize,
}

/// Has this job been asked to stop? `false` when it is not a job at all.
fn cancelled(job: Option<&bay_jobs::Handle>) -> bool {
    job.is_some_and(|handle| handle.cancelled())
}

/// Run a slow tool. **Never call this on the main thread.**
///
/// `job` is the registry handle when the caller has registered one — present for everything in
/// [`job_tools`], absent for `media_import`, which answers in-band. Where it is present the work
/// reports progress through it and stops when it is cancelled.
pub fn run(
    name: &str,
    args: &Value,
    context: &SlowContext,
    job: Option<&bay_jobs::Handle>,
) -> Result<SlowResult, String> {
    match name {
        "render" => render(args, context, job),
        "media_import" => media_import(args, context),
        "narrate" => narrate(args, context, job),
        "subtitles_to_video" => subtitles_to_video(args, job),
        other => Err(format!("{other} is not a background tool")),
    }
}

fn render(
    args: &Value,
    context: &SlowContext,
    job: Option<&bay_jobs::Handle>,
) -> Result<SlowResult, String> {
    let path = require_str(args, "path")?;
    let duration = args
        .get("duration")
        .and_then(|v| v.as_f64())
        .unwrap_or(context.timeline_duration);
    if duration <= 0.0 {
        return Err(
            "there is nothing on the timeline to render — add an element first, or pass an \
             explicit duration"
                .into(),
        );
    }

    let project = &context.project;
    let canvas = project.settings.canvas;
    let fps = project.settings.fps.as_f64().max(1.0);
    // Even dimensions: yuv420p cannot encode an odd width or height.
    let width = (canvas.width / 2) * 2;
    let height = (canvas.height / 2) * 2;

    // The worker gets its own GPU device. It cannot borrow the editor's — that one belongs to
    // the main thread, and a second adapter is what makes rendering concurrent with editing
    // rather than instead of it.
    let mut renderer = bay_preview::PreviewRenderer::new().ok_or(
        "no GPU adapter is available, so bay cannot render — text and images still work, but \
         encoding needs a compositor",
    )?;

    renderer
        .export_video_observed(
            project.active_scene(),
            duration,
            fps,
            width.max(2),
            height.max(2),
            &project.settings.background,
            &project.media,
            &path,
            &mut |done, total| match job {
                // A render is the one long job with a real denominator, so this is where the
                // "no progress for a four-minute render" complaint actually gets answered.
                Some(handle) => {
                    handle.progress(done, total, format!("encoding frame {done} of {total}"));
                    !handle.cancelled()
                }
                None => true,
            },
        )
        .map_err(|reason| {
            if job.is_some_and(|handle| handle.cancelled()) {
                format!("the render of {path} was cancelled")
            } else {
                format!("the render failed writing {path}: {reason}")
            }
        })?;

    Ok(SlowResult {
        value: serde_json::json!({
            "path": path,
            "durationSeconds": duration,
            "width": width,
            "height": height,
            "fps": fps,
        }),
        follow_up: FollowUp::None,
    })
}

fn media_import(args: &Value, context: &SlowContext) -> Result<SlowResult, String> {
    let path = require_str(args, "path")?;
    let absolute = std::fs::canonicalize(&path)
        .map_err(|e| format!("could not resolve media path {path}: {e}"))?
        .to_string_lossy()
        .to_string();
    let name = std::path::Path::new(&absolute)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "media".to_string());
    let media_id = args
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| format!("media-{}", context.next_id));

    let asset = MediaAsset {
        id: media_id.clone(),
        name: name.clone(),
        path: absolute.clone(),
    };

    // A probe failure is reported but not fatal — an asset can still be placed with an explicit
    // duration. Silently defaulting is how a 3-minute clip becomes a 4-second one.
    let mut value = serde_json::json!({ "mediaId": media_id, "name": name, "path": absolute });
    match bay_preview::probe::probe_media(&absolute) {
        Ok(meta) => {
            value["durationSeconds"] = serde_json::json!(meta.duration.to_seconds_f64());
            value["width"] = serde_json::json!(meta.width);
            value["height"] = serde_json::json!(meta.height);
            value["hasAudio"] = serde_json::json!(meta.has_audio);
            value["hasVideo"] = serde_json::json!(meta.has_video);
        }
        Err(error) => value["probeError"] = serde_json::json!(error.to_string()),
    }

    Ok(SlowResult {
        value,
        follow_up: FollowUp::ImportMedia(Box::new(asset)),
    })
}

fn narrate(
    args: &Value,
    context: &SlowContext,
    job: Option<&bay_jobs::Handle>,
) -> Result<SlowResult, String> {
    // One synthesis is a single call into the sidecar with no boundary inside it, so the only
    // honest checkpoint is before it starts. `job_cancel`'s description says exactly that
    // rather than implying a line can be cut off part-way through.
    if cancelled(job) {
        return Err("narration was cancelled before it started".into());
    }
    let text = require_str(args, "text")?;
    let voice = args
        .get("voice")
        .and_then(|v| v.as_str())
        .unwrap_or("af_heart")
        .to_string();
    // Derived from the voice unless overridden: the code is always the voice's first letter,
    // and a mismatched one mispronounces rather than erroring, which is hard to notice.
    let lang_code = args
        .get("langCode")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .or_else(|| bay_speech::voices::lang_code_for(&voice).map(str::to_string))
        .unwrap_or_else(|| "a".into());
    let speed = args.get("speed").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
    let start = args.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let volume = args.get("volume").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
    let peak_db = args
        .get("peakDb")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32);
    if !start.is_finite() || start < 0.0 {
        return Err(format!(
            "start must be a non-negative number of seconds, got {start}"
        ));
    }

    let out_path = args
        .get("audioPath")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| {
            std::env::temp_dir()
                .join(format!("bay-narration-{}.wav", context.next_id))
                .to_string_lossy()
                .to_string()
        });

    let mut engine = bay_speech::SpeechEngine::new(bay_speech::SpeechConfig::default());
    let utterance = engine
        .speak_normalized(&text, &voice, speed, &lang_code, &out_path, peak_db)
        .map_err(|error| error.to_string())?;

    let asset = MediaAsset {
        id: format!("media-{}", context.next_id),
        name: std::path::Path::new(&utterance.path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "narration.wav".into()),
        path: utterance.path.clone(),
    };

    let cue_style = crate::plan::cue_style_from(args);
    let captions = if args
        .get("captions")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
    {
        Some(crate::plan::caption_style_from(args))
    } else {
        None
    };

    Ok(SlowResult {
        value: serde_json::json!({
            "audioPath": utterance.path,
            "durationSeconds": utterance.duration_seconds,
            "voice": utterance.voice,
            "words": utterance.words.len(),
            "startSeconds": start,
            "endSeconds": start + utterance.duration_seconds,
        }),
        follow_up: FollowUp::PlaceNarration {
            asset: Box::new(asset),
            utterance: Box::new(utterance),
            start,
            volume,
            cue_style,
            captions,
        },
    })
}

/// What the applier must do on the main thread, in order.
pub struct Applied {
    /// Register these first — media is a registry, not undo history, so it is not a command.
    pub media: Vec<MediaAsset>,
    /// Then apply this, if there is anything to apply.
    pub planned: Option<Planned>,
    /// Or replace the whole document, for a tool whose job was to build one.
    pub replacement: Option<Box<Project>>,
}

/// Turn a finished job's [`FollowUp`] into commands, against the project as it is *now*.
///
/// Planned on the main thread rather than the worker because the project may have moved while
/// the job ran — a two-minute render is plenty of time for someone to add a clip — and the ids
/// this mints must not collide with ones the editor handed out in the meantime.
pub fn plan_follow_up(follow_up: FollowUp, project: &Project) -> Result<Applied, String> {
    match follow_up {
        FollowUp::None => Ok(Applied {
            media: Vec::new(),
            planned: None,
            replacement: None,
        }),
        FollowUp::ImportMedia(asset) => Ok(Applied {
            media: vec![*asset],
            planned: None,
            replacement: None,
        }),
        FollowUp::ReplaceProject(project) => Ok(Applied {
            media: Vec::new(),
            planned: None,
            replacement: Some(project),
        }),
        FollowUp::PlaceNarration {
            asset,
            utterance,
            start,
            volume,
            cue_style,
            captions,
        } => {
            let planned = crate::plan::place_narration(
                project,
                (*asset).clone(),
                &utterance,
                start,
                volume,
                &cue_style,
                captions,
            )?;
            Ok(Applied {
                media: vec![*asset],
                planned: Some(planned),
                replacement: None,
            })
        }
    }
}

/// An .srt in, a playable .mp4 out — and the project it was built from left open in the editor.
///
/// One tool rather than a documented four-call recipe, because "turn these subtitles into a
/// video" is one intent: splitting it would make the caller choose a canvas, size the timeline
/// to the last cue, and remember to render.
fn subtitles_to_video(args: &Value, job: Option<&bay_jobs::Handle>) -> Result<SlowResult, String> {
    let path = require_str(args, "path")?;
    let output = require_str(args, "output")?;
    let source = std::fs::read_to_string(&path)
        .map_err(|error| format!("could not read {path}: {error}"))?;
    let cues = bay_speech::parse(&source)?;
    if cues.is_empty() {
        return Err(format!("{path} has no cues to turn into a video"));
    }

    let width = args.get("width").and_then(|v| v.as_u64()).unwrap_or(1080) as u32;
    let height = args.get("height").and_then(|v| v.as_u64()).unwrap_or(1920) as u32;
    let fps = args.get("fps").and_then(|v| v.as_u64()).unwrap_or(30) as u32;
    let background = args
        .get("background")
        .and_then(|v| v.as_str())
        .unwrap_or("#0E0E12");

    let mut editor = bay_core::Editor::new(bay_project::Project::empty(
        &format!("subtitles-{}", cues.len()),
        "Subtitles",
        bay_project::CanvasSize { width, height },
        bay_project::Fps {
            numerator: fps,
            denominator: 1,
        },
        background,
    ));

    // Captions come from the file's own timings, so they are placed before anything is spoken.
    let style = crate::plan::caption_style_from(args);
    let planned = crate::plan::plan_captions(editor.project(), &cues, &style)?;
    if let Planned::Tx { commands, .. } = planned {
        for command in commands {
            editor.execute(command);
        }
    }

    // Narrating each cue at its own start keeps the voice aligned to the caption it belongs to;
    // one pass over the joined text would drift from the file's timings immediately.
    let mut spoken = 0usize;
    if args
        .get("narrate")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        let voice = args
            .get("voice")
            .and_then(|v| v.as_str())
            .unwrap_or("af_heart")
            .to_string();
        let lang_code = args
            .get("langCode")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .or_else(|| bay_speech::voices::lang_code_for(&voice).map(str::to_string))
            .unwrap_or_else(|| "a".into());
        let speed = args.get("speed").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
        let volume = args.get("volume").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
        let mut engine = bay_speech::SpeechEngine::new(bay_speech::SpeechConfig::default());

        let total = cues.len() as u64;
        for (index, cue) in cues.iter().enumerate() {
            // A cue boundary is the real checkpoint here: a script of forty lines should stop
            // near where it was asked to, not forty synthesis calls later.
            if cancelled(job) {
                return Err(format!("cancelled after narrating {index} of {total} cues"));
            }
            if let Some(handle) = job {
                handle.progress(
                    index as u64,
                    total,
                    format!("narrating cue {} of {total}", index + 1),
                );
            }
            let line = cue.text.replace('\n', " ");
            if line.trim().is_empty() {
                continue;
            }
            let out = std::env::temp_dir()
                .join(format!("bay-s2v-{}-{index}.wav", std::process::id()))
                .to_string_lossy()
                .to_string();
            let utterance = engine
                .speak_normalized(&line, &voice, speed, &lang_code, &out, Some(-2.0))
                .map_err(|error| error.to_string())?;
            let asset = MediaAsset {
                id: format!("narration-{index}"),
                name: format!("cue-{index}.wav"),
                path: utterance.path.clone(),
            };
            editor.add_media(asset.clone());
            // Captions are already on the timeline from the file; narrating them again would
            // stack a second set on top.
            let planned = crate::plan::place_narration(
                editor.project(),
                asset,
                &utterance,
                cue.start,
                volume,
                &CueStyle::default(),
                None,
            )?;
            if let Planned::Tx { commands, .. } = planned {
                for command in commands {
                    editor.execute(command);
                }
            }
            spoken += 1;
        }
    }

    let duration = editor
        .duration()
        .to_seconds_f64()
        .max(cues.last().map(|cue| cue.end).unwrap_or(0.0));
    let project = editor.project().clone();
    let rendered = render(
        &serde_json::json!({ "path": output, "duration": duration }),
        &SlowContext {
            project: project.clone(),
            timeline_duration: duration,
            next_id: 1,
        },
        // No handle: subtitles_to_video narrates every cue before it encodes, so a frame
        // counter here would jump from nothing to a bar that is already most of the way
        // through. Its own progress is reported per cue by the caller.
        None,
    )?;

    Ok(SlowResult {
        value: serde_json::json!({
            "path": output,
            "cues": cues.len(),
            "narrated": spoken,
            "durationSeconds": duration,
            "width": width,
            "height": height,
            "render": rendered.value,
        }),
        follow_up: FollowUp::ReplaceProject(Box::new(project)),
    })
}

fn require_str(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("missing required string field {key:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> SlowContext {
        SlowContext {
            project: Project::starter(),
            timeline_duration: 5.0,
            next_id: 1,
        }
    }

    #[test]
    fn every_slow_tool_is_dispatchable() {
        for name in slow_tools() {
            let error = run(name, &serde_json::json!({}), &context(), None)
                .err()
                .unwrap_or_default();
            assert!(
                !error.contains("is not a background tool"),
                "{name} is listed as slow but run() does not handle it"
            );
        }
    }

    /// A missing path must be a message, not a panic — and it must come back before any
    /// expensive work starts.
    #[test]
    fn render_without_a_path_is_refused() {
        let error = run("render", &serde_json::json!({}), &context(), None)
            .err()
            .expect("render needs a path");
        assert!(error.contains("path"), "{error}");
    }

    #[test]
    fn rendering_an_empty_timeline_says_so_rather_than_writing_a_zero_length_file() {
        let mut context = context();
        context.timeline_duration = 0.0;
        let error = run(
            "render",
            &serde_json::json!({"path": "/tmp/bay-never-written.mp4"}),
            &context,
            None,
        )
        .err()
        .expect("an empty timeline cannot be rendered");
        assert!(error.contains("nothing on the timeline"), "{error}");
        assert!(
            !std::path::Path::new("/tmp/bay-never-written.mp4").exists(),
            "it must not have written a file"
        );
    }

    #[test]
    fn importing_a_file_that_is_not_there_names_it() {
        let error = run(
            "media_import",
            &serde_json::json!({"path": "/definitely/not/here.mp4"}),
            &context(),
            None,
        )
        .err()
        .expect("a missing file is an error");
        assert!(error.contains("/definitely/not/here.mp4"), "{error}");
    }

    /// The worker must not decide where things land; that is planned against the live project.
    #[test]
    fn an_import_comes_back_as_a_command_rather_than_a_mutation() {
        let dir = std::env::temp_dir().join(format!("bay-slow-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("scratch");
        let file = dir.join("clip.wav");
        std::fs::write(&file, b"not really a wav").expect("write");

        let result = run(
            "media_import",
            &serde_json::json!({"path": file.to_string_lossy()}),
            &context(),
            None,
        )
        .expect("import should succeed even if the probe fails");

        let project = Project::starter();
        let applied = plan_follow_up(result.follow_up, &project).expect("plan");
        assert_eq!(
            applied.media.len(),
            1,
            "the asset must come back to register"
        );
        assert!(
            applied.planned.is_none(),
            "importing places nothing on the timeline by itself"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
