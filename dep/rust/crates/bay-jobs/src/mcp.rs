//! The `job_status` and `job_cancel` tools.
//!
//! `runtime_install` already worked this way — return an id, poll for the outcome — because an
//! install takes minutes and an MCP call that blocked that long would leave the agent unable to
//! tell a slow download from a hung one. Renders and narration have exactly the same problem and
//! did not, so they got a 20-second ceiling and a message saying the editor had not answered
//! while the render was still going.
//!
//! These two tools are that shape, generalised. One registry backs both, so an install and a
//! render are followed the same way and an agent has one thing to learn.

use serde_json::Value;

/// `job_status` — one job, or all of them.
pub fn status(args: &Value) -> Value {
    match args.get("job").and_then(|v| v.as_u64()) {
        Some(id) => match crate::state(id) {
            Some(state) => state.to_json(),
            // Say which id, and why it might be gone. A bare "not found" sends an agent looking
            // for a bug in its own bookkeeping.
            None => serde_json::json!({
                "error": format!(
                    "no job with id {id}. Either it was never started by this bay, or it \
                     finished long enough ago to have been forgotten."
                )
            }),
        },
        None => {
            let jobs = crate::all();
            let running = jobs.iter().filter(|job| !job.finished).count();
            serde_json::json!({
                "jobs": jobs.iter().map(|job| job.to_json()).collect::<Vec<_>>(),
                "running": running,
            })
        }
    }
}

/// `job_cancel` — ask a job to stop.
///
/// Deliberately reports whether the request actually took. Cancelling something already finished
/// is not an error the agent caused, but telling it "cancelled" would be a lie: the render it
/// wanted to stop has already written its file.
pub fn cancel(args: &Value) -> Result<Value, String> {
    let Some(id) = args.get("job").and_then(|v| v.as_u64()) else {
        return Err("job_cancel needs a job id — the number a slow tool returned".to_string());
    };

    if crate::cancel(id) {
        Ok(serde_json::json!({
            "job": id,
            "cancelling": true,
            "message": "asked the job to stop; poll job_status until finished is true",
        }))
    } else {
        let finished = crate::state(id).map(|state| state.finished);
        Ok(serde_json::json!({
            "job": id,
            "cancelling": false,
            "message": match finished {
                Some(true) => "that job had already finished — nothing was cancelled",
                Some(false) => "that job could not be cancelled",
                None => "there is no job with that id",
            },
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_unknown_job_explains_itself_rather_than_just_failing() {
        let reported = status(&json!({ "job": u64::MAX }));
        let error = reported["error"].as_str().unwrap_or_default();
        assert!(error.contains(&u64::MAX.to_string()), "{error}");
        assert!(
            error.contains("finished long enough ago"),
            "should name the likely cause: {error}"
        );
    }

    #[test]
    fn a_finished_job_hands_back_what_the_tool_would_have_returned() {
        // The whole point of the job shape: the answer is not lost by being deferred.
        let handle = crate::start("render", "/tmp/j.mp4", crate::Unit::Frames, 3);
        crate::finish(&handle, Ok(json!({ "path": "/tmp/j.mp4", "bytes": 1234 })));

        let reported = status(&json!({ "job": handle.id() }));
        assert_eq!(reported["finished"], true);
        assert_eq!(reported["result"]["path"], "/tmp/j.mp4");
        assert_eq!(reported["result"]["bytes"], 1234);
    }

    #[test]
    fn a_running_job_reports_progress_and_no_result_yet() {
        let handle = crate::start("render", "/tmp/k.mp4", crate::Unit::Frames, 100);
        handle.progress(40, 100, "encoding frame 40 of 100");

        let reported = status(&json!({ "job": handle.id() }));
        assert_eq!(reported["finished"], false);
        // f32 widened to f64: 0.4 is not exact in binary, so compare with tolerance rather
        // than pinning the representation.
        let fraction = reported["fraction"]
            .as_f64()
            .expect("a fraction once total is known");
        assert!((fraction - 0.4).abs() < 1e-6, "got {fraction}");
        assert_eq!(reported["unit"], "frames");
        assert!(
            reported["result"].is_null(),
            "an unfinished job must not pretend to have an answer"
        );
        crate::finish(&handle, Ok(json!({})));
    }

    #[test]
    fn cancelling_needs_an_id() {
        let error = cancel(&json!({})).expect_err("no id is a usage error");
        assert!(error.contains("job id"), "{error}");
    }

    #[test]
    fn cancelling_something_already_finished_says_so_rather_than_claiming_success() {
        let handle = crate::start("render", "/tmp/l.mp4", crate::Unit::Frames, 1);
        crate::finish(&handle, Ok(json!({})));

        let reported = cancel(&json!({ "job": handle.id() })).expect("a known id is not an error");
        assert_eq!(reported["cancelling"], false);
        assert!(
            reported["message"]
                .as_str()
                .unwrap_or_default()
                .contains("already finished"),
            "{reported}"
        );
    }

    #[test]
    fn cancelling_a_running_job_takes() {
        let handle = crate::start("render", "/tmp/m.mp4", crate::Unit::Frames, 100);
        let reported = cancel(&json!({ "job": handle.id() })).expect("a known id is not an error");
        assert_eq!(reported["cancelling"], true);
        assert!(
            handle.cancelled(),
            "the worker has to be able to see the request"
        );
        crate::finish(&handle, Err("cancelled".into()));
    }

    #[test]
    fn listing_reports_how_many_are_running() {
        let handle = crate::start("render", "/tmp/n.mp4", crate::Unit::Frames, 10);
        let listed = status(&json!({}));
        assert!(listed["jobs"].is_array());
        assert!(
            listed["running"].as_u64().unwrap_or(0) >= 1,
            "the running count should include a job that has not finished: {listed}"
        );
        crate::finish(&handle, Ok(json!({})));
    }
}
