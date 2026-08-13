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
    &[
        "render",
        "narrate",
        "media_import",
        // Measuring a file's loudness decodes all of it. Cheap for a bed, minutes for a long
        // take, and never on the thread drawing the window.
        "audio_probe",
        "subtitles_to_video",
        // Scanning for cuts decodes the whole file. On a long take that is minutes of work,
        // and it must never run on the thread drawing the window.
        "shots_detect",
        // A search is one HTTP round trip to an archive, plus — when the vision component is
        // installed — a preview download and a SigLIP forward pass per candidate. Seconds, on
        // somebody else's server, and never on the thread drawing the window.
        "stock_search",
        // Downloading an archive original: a few megabytes usually, tens occasionally.
        "stock_fetch",
        // Loading 780 MB of weights and running a forward pass per image.
        "image_rank",
        // Decoding a whole track to find its pulse.
        "audio_beats",
        // Decoding a whole take to find the dead air in it.
        "silence_detect",
        // Decoding a whole take to find the dead air in it.
        "silence_detect",
    ]
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
    &["render", "narrate", "subtitles_to_video", "shots_detect"]
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
        /// The script it was spoken from — captions break on its full stops, which the word
        /// timings alone cannot see.
        script: String,
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

impl SlowResult {
    /// A result that answers and changes nothing — a search, a score, a download to disk.
    pub fn value(value: Value) -> Self {
        Self {
            value,
            follow_up: FollowUp::None,
        }
    }
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

/// The tempo of a file on disk. The editor-attached twin of `bay-mcp`'s arm, which resolves a
/// `mediaId` first; here the caller has already been given a path.
fn audio_beats(args: &Value) -> Result<Value, String> {
    let path = require_str(args, "path")?;
    let beats = bay_audio::beats::detect_file(&path)
        .ok_or_else(|| format!("could not read audio from {path} — decoding needs ffmpeg"))?;
    let mut value = serde_json::to_value(&beats).map_err(|e| e.to_string())?;
    if let Some(n) = args.get("everyNthBeat").and_then(Value::as_u64) {
        value["cutTimes"] = serde_json::json!(beats.every(n as usize));
    }
    value["usable"] = serde_json::json!(beats.is_usable());
    Ok(value)
}

/// The dead air in a file on disk — the editor-attached twin of 's arm.
fn silence_detect(args: &Value) -> Result<Value, String> {
    let path = require_str(args, "path")?;
    let options = bay_audio::silence::Options {
        threshold_db: args.get("thresholdDb").and_then(Value::as_f64),
        minimum_seconds: args
            .get("minimumSeconds")
            .and_then(Value::as_f64)
            .unwrap_or(0.5),
        pad_seconds: args
            .get("padSeconds")
            .and_then(Value::as_f64)
            .unwrap_or(0.08),
    };
    let pcm = bay_audio::decode_pcm(&path, 16000)
        .ok_or_else(|| format!("could not read audio from {path} — decoding needs ffmpeg"))?;
    let scan = bay_audio::silence::detect(&pcm, options)
        .ok_or_else(|| format!("{path} has no audio to measure"))?;
    let mut value = serde_json::to_value(&scan).map_err(|e| e.to_string())?;
    value["keepRanges"] = serde_json::json!(scan.keep_ranges());
    Ok(value)
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
        "audio_probe" => audio_probe(args, context),
        "shots_detect" => shots_detect(args, context),
        "narrate" => narrate(args, context, job),
        "subtitles_to_video" => subtitles_to_video(args, job),
        // These three touch the network or the encoder and never the document, so they answer
        // with a bare value and leave the project alone.
        "stock_search" => crate::illustrate::stock_search(args).map(SlowResult::value),
        "stock_fetch" => crate::illustrate::stock_fetch(args).map(SlowResult::value),
        "image_rank" => bay_vision::mcp::image_rank(args).map(SlowResult::value),
        "audio_beats" => audio_beats(args).map(SlowResult::value),
        "silence_detect" => silence_detect(args).map(SlowResult::value),
        other => Err(format!("{other} is not a background tool")),
    }
}

fn render(
    args: &Value,
    context: &SlowContext,
    job: Option<&bay_jobs::Handle>,
) -> Result<SlowResult, String> {
    let path = require_str(args, "path")?;
    let mut settings = export_settings(args)?;
    // A range shortens what is left to render, so the default duration is measured from where
    // the export actually starts rather than from zero.
    let remaining = (context.timeline_duration - settings.start_seconds).max(0.0);
    let duration = args
        .get("duration")
        .and_then(|v| v.as_f64())
        .unwrap_or(remaining)
        .min(remaining.max(f64::MIN_POSITIVE));
    if duration <= 0.0 {
        return Err(
            "there is nothing on the timeline to render — add an element first, or pass an \
             explicit duration"
                .into(),
        );
    }

    // Before anything is encoded, and after the cheaper "there is nothing here" answer: an
    // error-severity finding stops the render outright, and the one escape is stamped into the
    // file below and into the result.
    let stamp = render_stamp(&context.project, args)?;
    settings.metadata_comment = stamp.clone();

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
            &settings,
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
            "checksOverridden": stamp,
        }),
        follow_up: FollowUp::None,
    })
}

/// The pre-render gate, read off a `render` call's own arguments.
///
/// `Ok(None)` — nothing gating. `Ok(Some(stamp))` — gated and overridden, and `stamp` belongs in
/// the job result **and** in the file's metadata. `Err` — refused, with what to fix.
///
/// One function so both transports gate identically: the headless server and the editor window
/// call it with the same project and the same arguments. A gate one path enforces and the other
/// does not is not a gate, it is a preference.
pub fn render_stamp(project: &Project, args: &Value) -> Result<Option<String>, String> {
    bay_core::check::render_gate(
        project,
        args.get("ignoreChecks")
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
        args.get("reason").and_then(|value| value.as_str()),
    )
}

/// Read the encode settings out of a `render` call: a named preset first, then any explicit
/// field on top of it. A preset is a starting point, never a lock.
pub fn export_settings(args: &Value) -> Result<bay_preview::ExportSettings, String> {
    let mut settings = match args.get("preset").and_then(|v| v.as_str()) {
        Some(name) => bay_preview::ExportPreset::from_wire(name)
            .ok_or_else(|| {
                format!(
                    "unknown preset {name:?} — use \"social\" (Reels/TikTok/Shorts), \
                     \"youtube\", or \"master\" (ProRes, no loudness processing)"
                )
            })?
            .settings(),
        None => bay_preview::ExportSettings::default(),
    };
    if let Some(name) = args.get("codec").and_then(|v| v.as_str()) {
        settings.codec = bay_preview::VideoCodec::from_wire(name)
            .ok_or_else(|| format!("unknown codec {name:?} — h264, hevc or prores"))?;
    }
    if let Some(quality) = args.get("quality").and_then(|v| v.as_f64()) {
        if !(0.0..=51.0).contains(&quality) {
            return Err("quality is a CRF: 0-51, lower is better and larger".into());
        }
        settings.quality = quality as u32;
    }
    if let Some(start) = args.get("startSeconds").and_then(|v| v.as_f64()) {
        if !start.is_finite() || start < 0.0 {
            return Err("startSeconds must be a finite, non-negative number".into());
        }
        settings.start_seconds = start;
    }
    match args.get("loudness") {
        Some(Value::Bool(false)) => settings.loudness_lufs = None,
        Some(Value::Bool(true)) => settings.loudness_lufs = Some(-14.0),
        Some(Value::Number(target)) => {
            let target = target.as_f64().unwrap_or(-14.0);
            if !(-40.0..=0.0).contains(&target) {
                return Err("a loudness target is negative LUFS, roughly -40 to 0".into());
            }
            settings.loudness_lufs = Some(target);
        }
        Some(_) => return Err("loudness is a boolean or a LUFS number".into()),
        None => {}
    }
    if let Some(kbps) = args.get("audioBitrateKbps").and_then(|v| v.as_u64()) {
        settings.audio_bitrate_kbps = kbps as u32;
    }
    Ok(settings)
}

/// Find the cuts in an imported clip.
///
/// A read, not an edit: it answers "what is in this file", and what to do about the answer is
/// the caller's decision. Placing the shots automatically would guess at an edit nobody asked
/// for, and the guess would be wrong most of the time.
fn shots_detect(args: &Value, context: &SlowContext) -> Result<SlowResult, String> {
    let media_id = require_str(args, "mediaId")?;
    let asset = context
        .project
        .media
        .iter()
        .find(|asset| asset.id == media_id)
        .ok_or_else(|| format!("no media {media_id:?} — call media_import first"))?;

    let threshold = args
        .get("threshold")
        .and_then(|v| v.as_f64())
        .unwrap_or(bay_preview::probe::DEFAULT_SHOT_THRESHOLD);
    let min_seconds = args
        .get("minSeconds")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.4);

    let shots = bay_preview::probe::detect_shots(&asset.path, threshold, min_seconds)
        .map_err(|e| format!("could not scan {:?} for cuts: {e}", asset.name))?;

    Ok(SlowResult {
        value: serde_json::json!({
            "mediaId": media_id,
            "name": asset.name,
            "threshold": threshold,
            "shots": shots
                .iter()
                .enumerate()
                .map(|(index, shot)| serde_json::json!({
                    "index": index,
                    "startSeconds": shot.start_seconds,
                    "endSeconds": shot.end_seconds,
                    "durationSeconds": shot.duration_seconds(),
                }))
                .collect::<Vec<_>>(),
        }),
        follow_up: FollowUp::None,
    })
}

/// Measure an asset already in the project, and remember what it measured.
///
/// Shares [`loudness_of`] with the import, because a level is only comparable to another level
/// when both were measured the same way — and because two implementations of one verb is the
/// bug class this whole module's routing exists to avoid.
fn audio_probe(args: &Value, context: &SlowContext) -> Result<SlowResult, String> {
    let media_id = require_str(args, "mediaId")?;
    let asset = context
        .project
        .media
        .iter()
        .find(|asset| asset.id == media_id)
        .ok_or_else(|| format!("no media {media_id:?} in this project — media_import it first"))?;

    let mut updated = asset.clone();
    let mut value = serde_json::json!({ "mediaId": media_id, "name": asset.name });
    match bay_preview::probe::probe_loudness(&asset.path) {
        Ok(loudness) => {
            merge_loudness(&mut value, &loudness);
            updated.loudness = Some(loudness);
        }
        Err(error) => {
            return Err(format!(
                "could not measure {:?}: {error}. Loudness needs ffmpeg; without it the mix \
                 checks report that they could not evaluate rather than passing.",
                asset.name
            ));
        }
    }
    Ok(SlowResult {
        value,
        follow_up: FollowUp::ImportMedia(Box::new(updated)),
    })
}

/// A measurement, as an agent reads it. One tenth of a dB, which is what ffmpeg reports and
/// about what the ear resolves for a level difference.
fn merge_loudness(value: &mut Value, loudness: &bay_project::AssetLoudness) {
    let tenth = |v: f32| (f64::from(v) * 10.0).round() / 10.0;
    value["lufs"] = serde_json::json!(tenth(loudness.lufs));
    value["peakDb"] = serde_json::json!(tenth(loudness.peak_db));
    value["rmsDb"] = serde_json::json!(tenth(loudness.rms_db));
    value["accentSeconds"] = serde_json::json!(loudness.accent_seconds);
    value["audible"] = serde_json::json!(loudness.is_audible());
}

fn media_import(args: &Value, context: &SlowContext) -> Result<SlowResult, String> {
    // `mediaId` instead of `path` re-measures something already imported. Reachable under this
    // name as well as under `audio_probe`, because a live MCP session caches the tool list when
    // it connects and cannot call a name that did not exist then.
    if args.get("mediaId").is_some() {
        return audio_probe(args, context);
    }
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

    let mut asset = MediaAsset::new(media_id.clone(), name.clone(), absolute.clone());

    // A probe failure is reported but not fatal — an asset can still be placed with an explicit
    // duration. Silently defaulting is how a 3-minute clip becomes a 4-second one.
    let mut value = serde_json::json!({ "mediaId": media_id, "name": name, "path": absolute });
    match bay_preview::probe::probe_media(&absolute) {
        Ok(meta) => {
            // Kept on the asset, not only in this reply: it is what lets a trim stop at the end
            // of the file instead of running off it, and what `check` compares a clip against.
            asset.duration_seconds = Some(meta.duration.to_seconds_f64());
            asset.width = Some(meta.width);
            asset.height = Some(meta.height);
            value["durationSeconds"] = serde_json::json!(meta.duration.to_seconds_f64());
            value["width"] = serde_json::json!(meta.width);
            value["height"] = serde_json::json!(meta.height);
            value["hasAudio"] = serde_json::json!(meta.has_audio);
            value["hasVideo"] = serde_json::json!(meta.has_video);
        }
        Err(error) => value["probeError"] = serde_json::json!(error.to_string()),
    }

    // Loudness, for anything with a sound in it. Measured at import because a level is only a
    // decision once the file's own loudness is known: a bed at `2.0` against a file that
    // integrates to -35 LUFS is still 9 LU too quiet, and no reasoning about the multiplier can
    // discover that. Not fatal — the file is still placeable, and the mix checks say they could
    // not evaluate rather than passing.
    if value["hasAudio"].as_bool().unwrap_or(false) {
        match bay_preview::probe::probe_loudness(&absolute) {
            Ok(loudness) => {
                let mut measured = serde_json::json!({});
                merge_loudness(&mut measured, &loudness);
                value["loudness"] = measured;
                asset.loudness = Some(loudness);
            }
            Err(error) => value["loudnessError"] = serde_json::json!(error.to_string()),
        }
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
    // The rate is stated in words a second and the multiplier derived from it. `speed: 1.0` is
    // 2.99 words a second — a 179 wpm gabble — and the whole project this comes from was planned
    // against a documented 2.5 that nothing ever delivered.
    let target_rate = args
        .get("targetWordsPerSecond")
        .and_then(|v| v.as_f64())
        .unwrap_or(bay_speech::TARGET_WORDS_PER_SECOND);
    let speed = args
        .get("speed")
        .and_then(|v| v.as_f64())
        .map(|value| value as f32)
        .unwrap_or_else(|| bay_speech::speed_for_rate(target_rate));
    let start = args.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let volume = args.get("volume").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;

    // Refused before the synthesis is paid for. A 10.30 s, 29-word run-on landed on the turn of
    // the video this rule comes from, and nothing downstream repairs a sentence that long.
    let words = bay_speech::word_count(&text);
    let estimate =
        bay_speech::estimated_seconds(&text, bay_speech::BASE_WORDS_PER_SECOND * f64::from(speed));
    if estimate > bay_speech::MAX_NARRATION_SECONDS {
        return Err(bay_speech::over_length_message(
            &text,
            words,
            estimate,
            "would take",
        ));
    }
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

    // …and again on what actually came out, before anything is placed.
    if utterance.duration_seconds > bay_speech::MAX_NARRATION_SECONDS {
        return Err(bay_speech::over_length_message(
            &text,
            utterance.words.len().max(words),
            utterance.duration_seconds,
            "came out at",
        ));
    }

    let mut asset = MediaAsset::new(
        format!("media-{}", context.next_id),
        std::path::Path::new(&utterance.path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "narration.wav".into()),
        utterance.path.clone(),
    );
    // Synthesis already knows how long the line came out; nothing needs to probe it back.
    asset.duration_seconds = Some(utterance.duration_seconds);

    // Against the open project's kit — the same kit `add_text` draws from, so captions are not
    // the one block of type in the video that ignores the look it was committed to.
    let style =
        crate::plan::caption_style_from(args, context.project.settings.kit.as_ref(), "narrate")?;
    let captions = if args
        .get("captions")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
    {
        Some(style.clone())
    } else {
        None
    };
    let cue_style = style.cue_style();

    let measured = utterance.words_per_second();
    Ok(SlowResult {
        value: serde_json::json!({
            "audioPath": utterance.path,
            "durationSeconds": utterance.duration_seconds,
            "voice": utterance.voice,
            "words": utterance.words.len(),
            "startSeconds": start,
            "endSeconds": start + utterance.duration_seconds,
            "speed": speed,
            "targetWordsPerSecond": target_rate,
            "wordsPerSecond": measured.map(|rate| (rate * 100.0).round() / 100.0),
            "wordsPerMinute": measured.map(|rate| (rate * 60.0).round()),
            "captionStyle": style.preset.as_str(),
        }),
        follow_up: FollowUp::PlaceNarration {
            asset: Box::new(asset),
            utterance: Box::new(utterance),
            script: text,
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
            script,
            start,
            volume,
            cue_style,
            captions,
        } => {
            let planned = crate::plan::place_narration(
                project,
                (*asset).clone(),
                &utterance,
                &script,
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
    let style = crate::plan::caption_style_from(
        args,
        editor.project().settings.kit.as_ref(),
        "subtitles_to_video",
    )?;
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
        let target_rate = args
            .get("targetWordsPerSecond")
            .and_then(|v| v.as_f64())
            .unwrap_or(bay_speech::TARGET_WORDS_PER_SECOND);
        let speed = args
            .get("speed")
            .and_then(|v| v.as_f64())
            .map(|value| value as f32)
            .unwrap_or_else(|| bay_speech::speed_for_rate(target_rate));
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
            let mut asset = MediaAsset::new(
                format!("narration-{index}"),
                format!("cue-{index}.wav"),
                utterance.path.clone(),
            );
            asset.duration_seconds = Some(utterance.duration_seconds);
            editor.add_media(asset.clone());
            // Captions are already on the timeline from the file; narrating them again would
            // stack a second set on top.
            let planned = crate::plan::place_narration(
                editor.project(),
                asset,
                &utterance,
                &line,
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
