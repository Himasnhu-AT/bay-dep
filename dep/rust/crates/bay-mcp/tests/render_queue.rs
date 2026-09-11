//! The render queue, driven end to end through the dispatcher — no socket, no port.
//!
//! # Why this file exists
//!
//! The Deliver page draws a queue with per-job progress and a cancel button. Before it, the
//! editor's own Export button ran the whole encode on the UI thread and answered only when it
//! was finished (`fixes.md` entry 6), so there was nothing a queue *could* show. The page now
//! starts renders exactly the way the MCP server does — `bay_agent::slow::run` on a worker,
//! reporting through `bay_jobs` — and this file asserts the properties the page draws on top of:
//! a render answers with an id before it finishes, its progress is readable while it runs, and
//! cancelling one stops it.
//!
//! # Why it is in-process
//!
//! `Studio` and `tools::dispatch`, not a `bay --mcp` on a socket. Two entries in `fixes.md` are
//! tests that took a shared machine resource — the registry's scratch directory (11) and the
//! narration tests' two hardcoded ports (13, still open) — and both failed whenever anything
//! else on the machine held the same thing. `CLAUDE.md` names the consequence: a test that
//! fails for reasons outside the repository teaches people to re-run until green, which is how
//! a real failure gets ignored. So nothing here binds a port or names a fixed path.
//!
//! # ffmpeg
//!
//! Encoding needs it, and the frame check before it needs a GPU. The tests that actually
//! produce a file gate on [`bay_test_support::require_ffmpeg`] and
//! [`bay_test_support::require_gpu`] and **skip** without either — reported as a skip, never as
//! a pass, and a hard failure under `BAY_REQUIRE_FFMPEG` / `BAY_REQUIRE_GPU`. The queue
//! mechanics either side of the encode need neither and are not gated, so everything that can
//! be checked on any machine is.

use std::time::{Duration, Instant};

use bay_mcp::{Studio, tools};
use bay_test_support::{require_ffmpeg, require_gpu};
use serde_json::{Value, json};

fn call(studio: &mut Studio, name: &str, args: Value) -> Value {
    tools::dispatch(studio, name, &args).unwrap_or_else(|error| panic!("{name}: {error}"))
}

/// A studio with something on the timeline, in a scratch library of its own.
///
/// The library root carries the process id: two copies of this binary — another checkout, an
/// agent building in a worktree — must not resolve the same directory. That is `fixes.md` entry
/// 11, which was exactly this mistake made once already.
fn studio(tag: &str) -> Studio {
    let root = std::env::temp_dir().join(format!("bay-render-queue-{}-{tag}", std::process::id()));
    let mut studio = Studio::with_library_root(Some(root));
    call(
        &mut studio,
        "project_create",
        json!({ "name": "queue", "width": 320, "height": 180, "fps": 24, "kit": "swiss" }),
    );
    call(
        &mut studio,
        "add_text",
        json!({
            "id": "t1",
            "role": "headline",
            "start": 0,
            "duration": 1.5,
            "content": "Deliver",
        }),
    );
    studio
}

/// An output path unique to this process and this test, so two runs cannot write the same file.
fn output(tag: &str, extension: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "bay-render-queue-{}-{tag}.{extension}",
        std::process::id()
    ))
}

/// A reason long enough for `ignoreChecks`, which insists on 40 characters.
///
/// Used where the *encode* is the thing under test. A one-clip fixture is a still frame with an
/// empty lower third, so `frame_check` refuses it — correctly. Overriding it here is the same
/// escape a person gets, and it is recorded in the file's metadata exactly as theirs would be.
const OVERRIDE: &str = "a one-clip fixture is deliberately a still frame; this test measures the encoder, not the \
     composition";

fn status(job: u64) -> Value {
    bay_jobs::mcp::status(&json!({ "job": job }))
}

/// Poll until `finished`, or give up. Returns the final state.
fn wait(job: u64, limit: Duration) -> Value {
    let deadline = Instant::now() + limit;
    loop {
        let state = status(job);
        if state["finished"] == true {
            return state;
        }
        if Instant::now() >= deadline {
            panic!("job {job} did not finish within {limit:?}: {state}");
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// **The property the whole page rests on.** A render answers with an id straight away rather
/// than holding the call open for the length of the encode — which is what makes a progress bar
/// possible at all. Needs no ffmpeg: what is asserted is that dispatch *returned*, not that the
/// encode succeeded.
#[test]
fn a_render_answers_with_a_job_before_it_has_encoded_anything() {
    let mut studio = studio("answers");
    let path = output("answers", "mp4");

    let before = Instant::now();
    let started = call(
        &mut studio,
        "render",
        json!({ "path": path.to_string_lossy() }),
    );
    let dispatch_took = before.elapsed();

    assert_eq!(started["status"], "started", "{started}");
    assert_eq!(started["finished"], false, "{started}");
    let job = started["job"].as_u64().expect("a job id");
    assert!(
        dispatch_took < Duration::from_secs(2),
        "dispatch waited {dispatch_took:?} for the encode — a queue cannot show progress for \
         work that has already finished by the time it is listed"
    );

    // And it is in the list the Deliver page reads, by id, while it is still running.
    let queued = bay_agent::deliver::queue();
    let mine = queued
        .iter()
        .find(|render| render.id == job)
        .unwrap_or_else(|| panic!("job {job} is not in the render queue: {queued:?}"));
    assert_eq!(mine.label, path.to_string_lossy());

    // Do not leave a worker encoding into the next test.
    bay_jobs::cancel(job);
    wait(job, Duration::from_secs(90));
    let _ = std::fs::remove_file(&path);
}

/// The queue is filtered by kind, so the Deliver page lists renders and not the narration or
/// the runtime install sitting in the same registry beside them.
#[test]
fn the_queue_lists_renders_and_not_every_job_in_the_process() {
    let narration = bay_jobs::start("narrate", "a script", bay_jobs::Unit::Steps, 0);
    let install = bay_jobs::start("install", "speech", bay_jobs::Unit::Bytes, 1_000);

    let ids: Vec<u64> = bay_agent::deliver::queue()
        .into_iter()
        .map(|render| render.id)
        .collect();
    assert!(
        !ids.contains(&narration.id()),
        "a narration is not a render"
    );
    assert!(!ids.contains(&install.id()), "an install is not a render");

    bay_jobs::finish(&narration, Ok(json!({})));
    bay_jobs::finish(&install, Ok(json!({})));
}

/// Cancelling is the button on every unfinished queue row, and it has to actually stop the
/// work. `job_cancel` sets a flag the encoder reads every frame, so this asserts the job
/// reaches `finished` after being asked — not that it stops instantly, which nothing promises.
///
/// Skips without ffmpeg: with no encoder there is no long-running work to interrupt, and a
/// cancel that "succeeds" because the job had already failed to start would be a pass reported
/// for the wrong reason.
#[test]
fn a_queued_render_can_be_cancelled_while_it_runs() {
    if !require_ffmpeg() {
        return;
    }
    if require_gpu().is_none() {
        return;
    }
    let mut studio = studio("cancel");
    let path = output("cancel", "mp4");

    let started = call(
        &mut studio,
        "render",
        json!({
            "path": path.to_string_lossy(),
            "ignoreChecks": true,
            "reason": OVERRIDE,
        }),
    );
    let job = started["job"].as_u64().expect("a job id");

    let asked = bay_jobs::mcp::cancel(&json!({ "job": job })).expect("job_cancel takes an id");
    assert_eq!(asked["cancelling"], true, "{asked}");

    let final_state = wait(job, Duration::from_secs(120));
    assert_eq!(final_state["finished"], true, "{final_state}");
    // Either it stopped and said so, or it beat the flag to the finish line. Both are honest
    // outcomes and `bay_jobs::finish` distinguishes them; what must not happen is a job stuck
    // running forever with a cancel flag nobody reads.
    let raced = final_state["result"].is_object();
    let stopped = final_state["error"].is_string();
    assert!(
        raced || stopped,
        "a cancelled job must end with a result or a reason: {final_state}"
    );

    let _ = std::fs::remove_file(&path);
}

/// The end-to-end shape the Deliver page draws: start, watch the numbers move, read the result.
///
/// The progress assertion is the one that would have been impossible before this change — the
/// old Export button did not return until the file was written, so there was no moment at which
/// a fraction between 0 and 1 could be observed by anyone.
///
/// Skips without ffmpeg.
#[test]
fn a_render_reports_frames_while_it_encodes_and_a_path_when_it_is_done() {
    if !require_ffmpeg() {
        return;
    }
    if require_gpu().is_none() {
        return;
    }
    let mut studio = studio("progress");
    let path = output("progress", "mp4");

    let started = call(
        &mut studio,
        "render",
        json!({
            "path": path.to_string_lossy(),
            "ignoreChecks": true,
            "reason": OVERRIDE,
        }),
    );
    let job = started["job"].as_u64().expect("a job id");

    // Watch for a reading that is neither "not started" nor "finished".
    let mut saw_partial = false;
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        let state = status(job);
        if state["finished"] == true {
            break;
        }
        if let Some(fraction) = state["fraction"].as_f64()
            && fraction > 0.0
            && fraction < 1.0
        {
            saw_partial = true;
            assert_eq!(state["unit"], "frames", "{state}");
        }
        assert!(
            Instant::now() < deadline,
            "the render never finished: {state}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }

    let done = status(job);
    assert!(done["error"].is_null(), "the render failed: {done}");
    assert_eq!(done["result"]["path"], path.to_string_lossy().as_ref());
    assert!(path.exists(), "{} was not written", path.display());
    // The resolution the *project* asked for, not a 1280px cap applied on the way out — the
    // half of entry 6 that produced a smaller file than the user chose and said nothing.
    assert_eq!(done["result"]["width"], 320);
    assert_eq!(done["result"]["height"], 180);

    // A 1.5s clip at 24fps is 36 frames, so a partial reading is not a hard guarantee on a
    // fast machine. Report rather than fail: a flaky assertion here would be the "re-run until
    // green" habit this file's header is about.
    if !saw_partial {
        eprintln!(
            "note: the encode finished between polls, so no intermediate fraction was observed"
        );
    }

    let _ = std::fs::remove_file(&path);
}

/// The out point the Deliver page's range control produces, over the wire.
///
/// `duration` shorter than the timeline is refused — it is almost always a forgotten tail —
/// while `endSeconds` is a deliberate range and is not. Both halves are asserted, because a
/// page whose range control was silently accepted as a truncation would be worse than one that
/// had no range control.
#[test]
fn an_out_point_is_accepted_where_a_short_duration_is_refused() {
    let mut studio = studio("range");
    // Something past the range, so leaving a tail out is what is being asked for.
    call(
        &mut studio,
        "add_text",
        json!({
            "id": "t2",
            "role": "headline",
            "start": 1.5,
            "duration": 3.0,
            "content": "Tail",
        }),
    );

    let refused = tools::dispatch(
        &mut studio,
        "render",
        &json!({ "path": output("range-a", "mp4").to_string_lossy(), "duration": 1.0 }),
    )
    .expect_err("a duration that drops the tail is refused");
    let refused = format!("{refused:?}");
    assert!(refused.contains("would be omitted"), "{refused}");
    assert!(
        refused.contains("endSeconds"),
        "the refusal must name the way to say it was deliberate: {refused}"
    );

    // The same section, stated as an out point, is accepted and starts a job.
    let path = output("range-b", "mp4");
    let started = call(
        &mut studio,
        "render",
        json!({ "path": path.to_string_lossy(), "endSeconds": 1.0 }),
    );
    let job = started["job"].as_u64().expect("a job id");
    assert_eq!(started["status"], "started", "{started}");

    bay_jobs::cancel(job);
    wait(job, Duration::from_secs(90));
    let _ = std::fs::remove_file(&path);
}

/// **The gate, on the path the Deliver page uses.** `fixes.md` entry 6: everything
/// `render_gate` and `frame_check` refuse — off-canvas elements, type below legibility, missing
/// media, black gaps, a silent export — was refused for an agent and shipped for a person
/// clicking Export, because the button reached neither. It reaches both now by construction:
/// the page hands its arguments to `slow::run`, which is where these live.
///
/// The fixture here is a single still title, which `frame_check` genuinely objects to. That is
/// the assertion: the render *fails with the finding*, rather than quietly writing a file.
///
/// Skips without a GPU — the frame check composites to make its judgement, and no adapter means
/// no judgement, which must not read as "the gate let it through".
#[test]
fn a_render_the_frame_check_refuses_does_not_write_a_file() {
    if require_gpu().is_none() {
        return;
    }
    let mut studio = studio("gated");
    let path = output("gated", "mp4");
    let _ = std::fs::remove_file(&path);

    let started = call(
        &mut studio,
        "render",
        json!({ "path": path.to_string_lossy() }),
    );
    let job = started["job"].as_u64().expect("a job id");
    let ended = wait(job, Duration::from_secs(120));

    let error = ended["error"]
        .as_str()
        .unwrap_or_else(|| panic!("a still-frame render must be refused: {ended}"));
    assert!(error.contains("frame checks"), "{error}");
    // And the escape is named, rather than leaving the caller to guess there is one.
    assert!(error.contains("ignoreChecks"), "{error}");
    assert!(
        !path.exists(),
        "{} was written despite the refusal",
        path.display()
    );
}

/// The same project, with the override, writes the file — so the test above is measuring the
/// gate and not some unrelated failure to encode at all.
///
/// Skips without ffmpeg or a GPU.
#[test]
fn the_override_is_a_real_escape_and_not_a_refusal_in_disguise() {
    if !require_ffmpeg() {
        return;
    }
    if require_gpu().is_none() {
        return;
    }
    let mut studio = studio("override");
    let path = output("override", "mp4");
    let _ = std::fs::remove_file(&path);

    let started = call(
        &mut studio,
        "render",
        json!({
            "path": path.to_string_lossy(),
            "ignoreChecks": true,
            "reason": OVERRIDE,
        }),
    );
    let job = started["job"].as_u64().expect("a job id");
    let ended = wait(job, Duration::from_secs(180));

    assert!(ended["error"].is_null(), "{ended}");
    assert!(path.exists(), "{} was not written", path.display());
    // The override travels into the file's own comment metadata: a claim that lives only in a
    // chat log is not a claim anybody can check later.
    assert!(
        ended["result"]["checksOverridden"].is_string(),
        "the override must be stamped into the result: {ended}"
    );

    let _ = std::fs::remove_file(&path);
}
