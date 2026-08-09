//! Running an install without freezing whatever asked for it.
//!
//! Provisioning takes minutes: ~55 MB of ffmpeg on a good connection, and a Kokoro venv that
//! resolves about a gigabyte of wheels. Neither an MCP tool call nor a GPUI frame can wait that
//! long, so [`start`] hands the work to a thread and returns immediately with an id. Callers
//! poll [`state`].
//!
//! Progress is reported as one overall pair of numbers rather than per-artifact ones. A user
//! watching a download does not want to know that this is archive two of three; they want to
//! know how much is left.
//!
//! **The registry itself now lives in `bay-jobs`**, shared with renders and narration, which is
//! what lets one `job_status` tool report every kind of long-running work. This module is the
//! provisioning-shaped view of it: it keeps the byte-oriented [`JobState`] and its wire format
//! unchanged, because `runtime_status`'s JSON is a published contract and the install progress
//! bar reads those exact fields.

use std::collections::HashMap;

use crate::{Http, Progress, ProvisionError, manifest};

pub use bay_jobs::JobId;

/// The kind recorded in the shared registry, so `job_status` can tell an install from a render.
pub const KIND: &str = "install";

/// What an install is doing, as of the last poll.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobState {
    pub id: JobId,
    pub component: String,
    /// One line for a human: "downloading FFmpeg 9.0", "installing Kokoro — about 1 GB".
    pub message: String,
    pub done_bytes: u64,
    pub total_bytes: u64,
    pub finished: bool,
    /// Set only on failure. `finished` is true either way.
    pub error: Option<String>,
}

impl JobState {
    /// 0.0 to 1.0, or `None` while the size is not yet known.
    ///
    /// The venv step downloads through uv, whose byte count bay does not see, so progress
    /// deliberately stops moving there rather than inventing a number.
    pub fn fraction(&self) -> Option<f32> {
        (self.total_bytes > 0)
            .then(|| (self.done_bytes as f32 / self.total_bytes as f32).clamp(0.0, 1.0))
    }

    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "job": self.id,
            "component": self.component,
            "message": self.message,
            "doneBytes": self.done_bytes,
            "totalBytes": self.total_bytes,
            "done": crate::human_bytes(self.done_bytes),
            "total": crate::human_bytes(self.total_bytes),
            "fraction": self.fraction(),
            "finished": self.finished,
            "error": self.error,
        })
    }

    /// The provisioning view of a shared-registry job.
    fn from_shared(shared: &bay_jobs::JobState) -> Self {
        Self {
            id: shared.id,
            component: shared.label.clone(),
            message: shared.message.clone(),
            done_bytes: shared.done,
            total_bytes: shared.total,
            finished: shared.finished,
            error: shared.error.clone(),
        }
    }
}

/// Begin installing `component_id` on a background thread.
///
/// If an install of the same component is already running, its id is returned rather than a
/// second one started — two threads unpacking the same archive into the same directory would
/// race over the staging paths, and the user pressing a button twice is not an error.
pub fn start(component_id: &str) -> Result<JobId, ProvisionError> {
    let manifest = crate::Manifest::embedded();
    let root = crate::root()?;
    let plan = manifest::plan(
        manifest,
        component_id,
        crate::Target::CURRENT,
        &root,
        &|path| path.exists(),
    )
    .ok_or_else(|| ProvisionError::UnknownComponent(component_id.to_string()))?;

    if plan.unsupported {
        return Err(ProvisionError::Unsupported {
            component: plan.title.clone(),
        });
    }

    if let Some(running) = running_for(component_id) {
        return Ok(running);
    }

    let handle = bay_jobs::start(
        KIND,
        component_id,
        bay_jobs::Unit::Bytes,
        plan.download_bytes,
    );
    handle.say(if plan.satisfied {
        "already installed".to_string()
    } else {
        format!("starting — {}", crate::human_bytes(plan.download_bytes))
    });
    let id = handle.id();

    let component = component_id.to_string();
    let names: HashMap<String, String> = plan
        .needs
        .iter()
        .map(|need| (need.artifact.clone(), need.name.clone()))
        .collect();
    let total = plan.download_bytes;

    std::thread::Builder::new()
        .name(format!("bay-provision-{component}"))
        .spawn(move || {
            // Per-artifact tallies, summed for the overall figure. Keeping the last value seen
            // for each artifact — rather than adding up deltas — means a re-used cached archive,
            // which reports its whole size in one call, lands on exactly the same total as one
            // downloaded in chunks.
            let mut done_by_artifact: HashMap<String, u64> = HashMap::new();
            let fetch = Http::new();
            let outcome = crate::install_blocking(&component, &fetch, &mut |progress| {
                match progress {
                    Progress::Downloading { artifact, done, .. } => {
                        done_by_artifact.insert(artifact.clone(), done);
                        let label = names.get(&artifact).cloned().unwrap_or(artifact);
                        handle.progress(
                            done_by_artifact.values().sum(),
                            total,
                            format!("downloading {label}"),
                        );
                    }
                    Progress::Unpacking { artifact } => {
                        let label = names.get(&artifact).cloned().unwrap_or(artifact);
                        handle.say(format!("unpacking {label}"));
                    }
                    Progress::Step { detail, .. } => {
                        // The venv step has no byte count bay can see, so the bar is parked at
                        // full and the message carries the news.
                        handle.progress(total, total, detail);
                    }
                }
            });

            match outcome {
                Ok(()) => {
                    handle.progress(total, total, "installed");
                    bay_jobs::finish(&handle, Ok(serde_json::json!({ "installed": true })));
                }
                Err(error) => {
                    handle.say("failed");
                    bay_jobs::finish(&handle, Err(error.to_string()));
                }
            }
        })
        .map_err(|error| ProvisionError::Step {
            step: "install".into(),
            detail: format!("could not start the install thread: {error}"),
        })?;

    Ok(id)
}

/// The current state of an install job, or `None` if there was never one with that id.
///
/// A job of another kind is not an install, so this reports `None` for it rather than
/// describing a render in byte terms it does not have.
pub fn state(id: JobId) -> Option<JobState> {
    let shared = bay_jobs::state(id)?;
    (shared.kind == KIND).then(|| JobState::from_shared(&shared))
}

/// Every install this process has run, newest last.
pub fn all() -> Vec<JobState> {
    bay_jobs::all()
        .iter()
        .filter(|state| state.kind == KIND)
        .map(JobState::from_shared)
        .collect()
}

/// The id of a running install of `component_id`, if there is one.
pub fn running_for(component_id: &str) -> Option<JobId> {
    bay_jobs::running(KIND, component_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unknown_component_never_starts_a_thread() {
        let before = all().len();
        assert!(start("not-a-component").is_err());
        assert_eq!(all().len(), before, "no job should have been registered");
    }

    #[test]
    fn polling_an_id_that_was_never_issued_is_none() {
        assert!(state(u64::MAX).is_none());
    }

    #[test]
    fn a_render_is_not_reported_as_an_install() {
        // One registry now holds both, so the provisioning view has to filter. Without this,
        // runtime_status would describe a render's frame counts as downloaded bytes.
        let handle = bay_jobs::start(
            "render",
            "/tmp/not-an-install.mp4",
            bay_jobs::Unit::Frames,
            9,
        );
        assert!(
            state(handle.id()).is_none(),
            "a render must not be readable as an install job"
        );
        assert!(
            !all().iter().any(|job| job.id == handle.id()),
            "a render must not appear in the install list"
        );
        bay_jobs::finish(&handle, Ok(serde_json::json!({})));
    }

    #[test]
    fn a_fraction_is_withheld_until_the_size_is_known() {
        let mut state = JobState {
            id: 1,
            component: "video".into(),
            message: String::new(),
            done_bytes: 0,
            total_bytes: 0,
            finished: false,
            error: None,
        };
        assert_eq!(state.fraction(), None);
        state.total_bytes = 100;
        state.done_bytes = 25;
        assert_eq!(state.fraction(), Some(0.25));
        // A step that parks the bar at full must not report more than 100%.
        state.done_bytes = 400;
        assert_eq!(state.fraction(), Some(1.0));
    }

    #[test]
    fn a_job_serialises_for_a_caller_that_does_not_know_these_types() {
        let json = JobState {
            id: 7,
            component: "speech".into(),
            message: "downloading CPython 3.12.13".into(),
            done_bytes: 1_000_000,
            total_bytes: 4_000_000,
            finished: false,
            error: None,
        }
        .to_json();
        assert_eq!(json["job"], 7);
        assert_eq!(json["fraction"], 0.25);
        assert_eq!(json["total"], "4.0 MB");
        assert!(json["error"].is_null());
    }
}
