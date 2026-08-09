//! One registry for work that takes longer than a request.
//!
//! Provisioning already worked this way: an install takes minutes, so `runtime_install` returns
//! a job id immediately and the caller polls `runtime_status`. Renders and narration take just
//! as long and did not, which is how a `render` over 20 seconds came to return "the editor did
//! not answer in time" while the render carried on and its result was applied to the document
//! anyway. The caller was told it failed; it had not.
//!
//! So the shape provisioning proved is generalised here rather than duplicated.
//!
//! ```text
//!   start(kind, label)                       poll(id)
//!         │                                     │
//!         ▼                                     ▼
//!   ┌───────────┐   progress()   ┌──────────────────────┐
//!   │  worker   │ ─────────────► │  JobState            │
//!   │  thread   │                │   done / total / unit│
//!   │           │ ◄───────────── │   cancelled: bool    │
//!   └───────────┘   cancelled()  │   result: Value      │
//!         │                      └──────────────────────┘
//!         └── finish(Ok(value) | Err(reason)) ──┘
//! ```
//!
//! Two things provisioning's registry did not have, and every non-install job needs:
//!
//! - **A result.** An install either worked or did not, so success/error was enough. A `render`
//!   has to hand back `{path, bytes, encodeSeconds}`, so [`JobState`] carries a `result`.
//! - **Cancellation.** There was none anywhere in the repo. A four-minute render the user no
//!   longer wants should stop, and stop without leaving a half-written file behind.
//!
//! Cancellation is **cooperative and best-effort**: [`Handle::cancelled`] is a flag the worker
//! reads at whatever boundary it can. A render checks it every frame; a narration cannot
//! interrupt an HTTP request already in flight and checks between cues. Nothing here promises
//! to stop work that is mid-syscall, and `job_cancel`'s description says so.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

pub type JobId = u64;

/// What `done` and `total` are counting. A download has bytes; a render has frames; a venv build
/// has neither, and says so rather than inventing a number.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    Bytes,
    Frames,
    /// No countable quantity — the message carries the news.
    Steps,
}

impl Unit {
    pub fn as_str(&self) -> &'static str {
        match self {
            Unit::Bytes => "bytes",
            Unit::Frames => "frames",
            Unit::Steps => "steps",
        }
    }
}

/// A job, as of the last poll.
#[derive(Debug, Clone, PartialEq)]
pub struct JobState {
    pub id: JobId,
    /// What kind of work this is: `"install"`, `"render"`, `"narrate"`.
    pub kind: String,
    /// What it is working on — a component id, an output path, the first words of a script.
    pub label: String,
    /// One line for a human.
    pub message: String,
    pub done: u64,
    pub total: u64,
    pub unit: Unit,
    pub finished: bool,
    /// The tool's own return value, once it has one. This is what makes a job usable as the
    /// answer to a tool call rather than only as a progress bar.
    pub result: Option<serde_json::Value>,
    /// Set only on failure. `finished` is true either way.
    pub error: Option<String>,
    /// Cancellation was requested. The worker stops at its next checkpoint.
    pub cancelled: bool,
}

impl JobState {
    /// 0.0 to 1.0, or `None` while the size is not yet known.
    ///
    /// A step-shaped job never knows, so it never reports a fraction rather than pretending.
    pub fn fraction(&self) -> Option<f32> {
        (self.total > 0).then(|| (self.done as f32 / self.total as f32).clamp(0.0, 1.0))
    }

    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "job": self.id,
            "kind": self.kind,
            "label": self.label,
            "message": self.message,
            "done": self.done,
            "total": self.total,
            "unit": self.unit.as_str(),
            "fraction": self.fraction(),
            "finished": self.finished,
            "cancelled": self.cancelled,
            "result": self.result,
            "error": self.error,
        })
    }
}

/// The worker's end of a job: report progress, ask whether to stop.
///
/// Cloneable so a worker can hand it to a nested step without threading a borrow through.
#[derive(Clone)]
pub struct Handle {
    id: JobId,
    state: Arc<Mutex<JobState>>,
    cancel: Arc<AtomicBool>,
    finished_at: Arc<Mutex<Option<std::time::Instant>>>,
}

impl Handle {
    pub fn id(&self) -> JobId {
        self.id
    }

    /// Has someone asked this job to stop? Check it wherever stopping is safe.
    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    /// Update the counters and the human-readable line.
    pub fn progress(&self, done: u64, total: u64, message: impl Into<String>) {
        if let Ok(mut state) = self.state.lock() {
            state.done = done;
            state.total = total;
            state.message = message.into();
        }
    }

    /// Update just the line, for a step with nothing to count.
    pub fn say(&self, message: impl Into<String>) {
        if let Ok(mut state) = self.state.lock() {
            state.message = message.into();
        }
    }
}

struct Entry {
    state: Arc<Mutex<JobState>>,
    cancel: Arc<AtomicBool>,
    /// When this job finished, for [`evictable`]. Registry bookkeeping, so it lives here rather
    /// than on the state callers see.
    finished_at: Arc<Mutex<Option<std::time::Instant>>>,
}

type Registry = Mutex<HashMap<JobId, Entry>>;

fn registry() -> &'static Registry {
    static JOBS: OnceLock<Registry> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn next_id() -> JobId {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::SeqCst)
}

/// How long a finished job's result stays readable.
///
/// This is the number that matters. A job's whole purpose is to hold a result until its caller
/// polls for it, so evicting on *count* alone is wrong: thirty-two quick renders finishing while
/// an agent is still polling an earlier one would drop the answer it is waiting for, and it
/// would get "no such job" instead. Evicting on age cannot do that — a caller that has not read
/// its result within half an hour has stopped asking.
const RESULT_RETENTION: std::time::Duration = std::time::Duration::from_secs(30 * 60);

/// Backstop cap on finished jobs, for the pathological case of thousands inside the retention
/// window. Far above any real session, so in practice age is what evicts.
const FINISHED_CAP: usize = 256;

/// Which finished jobs to drop. Pure, so the policy is testable without a global registry —
/// and so testing it cannot evict another test's job, which is how the first version of this
/// made the suite flaky.
///
/// `finished` is `(id, when it finished)`. Running jobs are never passed in and never evicted:
/// losing one would lose the only handle to its result.
fn evictable(
    finished: &[(JobId, std::time::Instant)],
    now: std::time::Instant,
    retention: std::time::Duration,
    cap: usize,
) -> Vec<JobId> {
    let mut aged: Vec<JobId> = finished
        .iter()
        .filter(|(_, at)| now.duration_since(*at) >= retention)
        .map(|(id, _)| *id)
        .collect();

    // Still too many inside the window: drop oldest-finished first.
    let remaining = finished.len().saturating_sub(aged.len());
    if remaining > cap {
        let mut fresh: Vec<&(JobId, std::time::Instant)> = finished
            .iter()
            .filter(|(id, _)| !aged.contains(id))
            .collect();
        fresh.sort_by_key(|(_, at)| *at);
        aged.extend(fresh.iter().take(remaining - cap).map(|(id, _)| *id));
    }
    aged
}

/// Register a job and get the worker's handle to it.
///
/// This does **not** spawn anything — the caller owns its own threading, because a render needs
/// its own GPU device and an install needs none, and pretending one spawn policy fits both is
/// how the abstraction would start lying.
pub fn start(kind: &str, label: &str, unit: Unit, total: u64) -> Handle {
    let id = next_id();
    let state = Arc::new(Mutex::new(JobState {
        id,
        kind: kind.to_string(),
        label: label.to_string(),
        message: "starting".into(),
        done: 0,
        total,
        unit,
        finished: false,
        result: None,
        error: None,
        cancelled: false,
    }));
    let cancel = Arc::new(AtomicBool::new(false));
    let finished_at = Arc::new(Mutex::new(None));

    if let Ok(mut jobs) = registry().lock() {
        jobs.insert(
            id,
            Entry {
                state: Arc::clone(&state),
                cancel: Arc::clone(&cancel),
                finished_at: Arc::clone(&finished_at),
            },
        );
        sweep(&mut jobs, std::time::Instant::now());
    }

    Handle {
        id,
        state,
        cancel,
        finished_at,
    }
}

/// Record how a job ended. Idempotent, so a worker that finishes and then unwinds cannot
/// overwrite its own result with a spurious one.
pub fn finish(handle: &Handle, outcome: Result<serde_json::Value, String>) {
    if let Ok(mut state) = handle.state.lock() {
        if state.finished {
            return;
        }
        state.finished = true;
        if let Ok(mut at) = handle.finished_at.lock() {
            *at = Some(std::time::Instant::now());
        }
        match outcome {
            Ok(value) => {
                if state.total > 0 {
                    state.done = state.total;
                }
                state.message = if state.cancelled {
                    "cancelled".into()
                } else {
                    "done".into()
                };
                state.result = Some(value);
            }
            Err(reason) => {
                state.message = if state.cancelled {
                    "cancelled".into()
                } else {
                    "failed".into()
                };
                state.error = Some(reason);
            }
        }
    }
}

/// Ask a job to stop. Returns false if there is no such job, or it had already finished.
///
/// Best-effort by construction: this sets a flag, and the worker acts on it when it next looks.
pub fn cancel(id: JobId) -> bool {
    let Ok(jobs) = registry().lock() else {
        return false;
    };
    let Some(entry) = jobs.get(&id) else {
        return false;
    };
    let Ok(mut state) = entry.state.lock() else {
        return false;
    };
    if state.finished {
        return false;
    }
    state.cancelled = true;
    state.message = "cancelling".into();
    entry.cancel.store(true, Ordering::Relaxed);
    true
}

/// The current state of a job, or `None` if there was never one with that id (or it has been
/// evicted).
pub fn state(id: JobId) -> Option<JobState> {
    let jobs = registry().lock().ok()?;
    let entry = jobs.get(&id)?;
    let state = entry.state.lock().ok()?;
    Some(state.clone())
}

/// Every job still known to this process, newest last.
pub fn all() -> Vec<JobState> {
    let Ok(jobs) = registry().lock() else {
        return Vec::new();
    };
    let mut states: Vec<JobState> = jobs
        .values()
        .filter_map(|entry| entry.state.lock().ok().map(|s| s.clone()))
        .collect();
    states.sort_by_key(|state| state.id);
    states
}

/// The id of a running job of `kind` whose label matches, if there is one. Lets a caller refuse
/// to start a second identical job — pressing a button twice is not a request for two installs.
pub fn running(kind: &str, label: &str) -> Option<JobId> {
    all()
        .into_iter()
        .find(|state| !state.finished && state.kind == kind && state.label == label)
        .map(|state| state.id)
}

/// Apply [`evictable`] to the registry.
fn sweep(jobs: &mut HashMap<JobId, Entry>, now: std::time::Instant) {
    let finished: Vec<(JobId, std::time::Instant)> = jobs
        .iter()
        .filter_map(|(id, entry)| {
            let at = entry.finished_at.lock().ok()?;
            (*at).map(|at| (*id, at))
        })
        .collect();
    for id in evictable(&finished, now, RESULT_RETENTION, FINISHED_CAP) {
        jobs.remove(&id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_job_carries_its_tools_return_value() {
        // The gap that mattered: an install only had to say whether it worked, but a render has
        // to hand back where it wrote the file.
        let handle = start("render", "/tmp/out.mp4", Unit::Frames, 120);
        finish(&handle, Ok(serde_json::json!({"path": "/tmp/out.mp4"})));

        let state = state(handle.id()).expect("the job should still be registered");
        assert!(state.finished);
        assert_eq!(state.result.as_ref().unwrap()["path"], "/tmp/out.mp4");
        assert!(state.error.is_none());
    }

    #[test]
    fn progress_is_visible_while_the_job_runs() {
        let handle = start("render", "/tmp/a.mp4", Unit::Frames, 100);
        handle.progress(25, 100, "frame 25 of 100");

        let state = state(handle.id()).unwrap();
        assert_eq!(state.fraction(), Some(0.25));
        assert_eq!(state.message, "frame 25 of 100");
        assert!(!state.finished);
        assert_eq!(state.unit, Unit::Frames);
    }

    #[test]
    fn a_cancelled_job_tells_its_worker_to_stop() {
        let handle = start("render", "/tmp/b.mp4", Unit::Frames, 100);
        assert!(!handle.cancelled());

        assert!(cancel(handle.id()), "cancelling a running job should take");
        assert!(handle.cancelled(), "the worker must be able to see it");

        finish(&handle, Err("cancelled".into()));
        let state = state(handle.id()).unwrap();
        assert!(state.cancelled);
        assert_eq!(state.message, "cancelled");
    }

    #[test]
    fn cancelling_a_finished_job_is_refused_rather_than_pretended() {
        let handle = start("render", "/tmp/c.mp4", Unit::Frames, 1);
        finish(&handle, Ok(serde_json::json!({})));
        assert!(
            !cancel(handle.id()),
            "there is nothing left to cancel, and saying otherwise would be a lie"
        );
    }

    #[test]
    fn cancelling_an_unknown_id_is_refused() {
        assert!(!cancel(u64::MAX));
    }

    #[test]
    fn polling_an_id_that_was_never_issued_is_none() {
        assert!(state(u64::MAX).is_none());
    }

    #[test]
    fn a_finished_job_cannot_have_its_outcome_rewritten() {
        let handle = start("render", "/tmp/d.mp4", Unit::Frames, 1);
        finish(&handle, Ok(serde_json::json!({"bytes": 10})));
        finish(&handle, Err("a late unwind".into()));

        let state = state(handle.id()).unwrap();
        assert!(state.error.is_none(), "the first outcome is the outcome");
        assert_eq!(state.result.as_ref().unwrap()["bytes"], 10);
    }

    #[test]
    fn a_fraction_is_withheld_until_the_size_is_known() {
        let handle = start("install", "speech", Unit::Bytes, 0);
        assert_eq!(state(handle.id()).unwrap().fraction(), None);
        handle.progress(25, 100, "downloading");
        assert_eq!(state(handle.id()).unwrap().fraction(), Some(0.25));
        // A step that parks the bar at full must not report more than 100%.
        handle.progress(400, 100, "installing");
        assert_eq!(state(handle.id()).unwrap().fraction(), Some(1.0));
    }

    #[test]
    fn a_second_identical_job_can_be_recognised() {
        let handle = start("install", "video-dedupe-probe", Unit::Bytes, 10);
        assert_eq!(
            running("install", "video-dedupe-probe"),
            Some(handle.id()),
            "a running job must be findable so a double press does not start two"
        );
        finish(&handle, Ok(serde_json::json!({})));
        assert_eq!(
            running("install", "video-dedupe-probe"),
            None,
            "a finished job is not a running one"
        );
    }

    // Eviction policy. Tested as a pure function against a synthetic clock rather than by
    // flooding the process-global registry: the first version of this test created 64 finished
    // jobs, which evicted OTHER tests' jobs and made the suite fail intermittently. A test that
    // fails for reasons outside the code it covers teaches people to re-run until green.

    fn at(base: std::time::Instant, secs: u64) -> std::time::Instant {
        base + std::time::Duration::from_secs(secs)
    }

    #[test]
    fn a_recent_result_is_never_evicted() {
        // The bug this policy exists to prevent: an agent polling for its render's result gets
        // "no such job" because other renders finished in the meantime.
        let base = std::time::Instant::now();
        let finished: Vec<(JobId, std::time::Instant)> =
            (1..=50).map(|id| (id, at(base, id))).collect();

        let dropped = evictable(
            &finished,
            at(base, 60),
            std::time::Duration::from_secs(600),
            256,
        );
        assert!(
            dropped.is_empty(),
            "nothing inside the retention window may be evicted, dropped {dropped:?}"
        );
    }

    #[test]
    fn a_result_nobody_collected_is_evicted_once_it_is_old() {
        let base = std::time::Instant::now();
        let finished = [(1, at(base, 0)), (2, at(base, 100)), (3, at(base, 700))];

        let dropped = evictable(
            &finished,
            at(base, 800),
            std::time::Duration::from_secs(600),
            256,
        );
        assert!(dropped.contains(&1), "700s old, must go");
        assert!(dropped.contains(&2), "700s old, must go");
        assert!(!dropped.contains(&3), "100s old, still collectable");
    }

    #[test]
    fn the_cap_drops_the_oldest_first_when_everything_is_recent() {
        // The pathological case: more finished jobs inside the window than the cap allows. The
        // ones most likely to still be wanted are the newest, so the oldest go.
        let base = std::time::Instant::now();
        let finished: Vec<(JobId, std::time::Instant)> =
            (1..=10).map(|id| (id, at(base, id))).collect();

        let dropped = evictable(
            &finished,
            at(base, 11),
            std::time::Duration::from_secs(600),
            4,
        );
        assert_eq!(dropped.len(), 6, "10 finished, cap 4 → 6 dropped");
        assert!(dropped.contains(&1) && dropped.contains(&6), "{dropped:?}");
        assert!(
            !dropped.contains(&7) && !dropped.contains(&10),
            "the newest four survive: {dropped:?}"
        );
    }

    #[test]
    fn a_running_job_is_never_offered_for_eviction() {
        // Structural: `sweep` only collects entries with a finish timestamp, so a running job
        // cannot reach `evictable` at all. Losing one would lose the only handle to its result.
        let handle = start("render", "never-evicted-probe", Unit::Frames, 10);
        let jobs = registry().lock().unwrap();
        let running_has_no_timestamp = jobs
            .get(&handle.id())
            .map(|entry| entry.finished_at.lock().unwrap().is_none())
            .unwrap_or(false);
        assert!(
            running_has_no_timestamp,
            "a running job must have no finish time, so eviction cannot see it"
        );
        drop(jobs);
        finish(&handle, Ok(serde_json::json!({})));
    }

    #[test]
    fn a_job_serialises_for_a_caller_that_does_not_know_these_types() {
        let handle = start("render", "/tmp/e.mp4", Unit::Frames, 120);
        handle.progress(30, 120, "frame 30 of 120");
        let json = state(handle.id()).unwrap().to_json();

        assert_eq!(json["kind"], "render");
        assert_eq!(json["label"], "/tmp/e.mp4");
        assert_eq!(json["unit"], "frames");
        assert_eq!(json["fraction"], 0.25);
        assert_eq!(json["finished"], false);
        assert!(json["result"].is_null());
    }
}
