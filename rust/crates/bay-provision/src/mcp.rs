//! The two tools that expose provisioning to an agent, and to the in-app bridge.
//!
//! They live here rather than in `bay-mcp` or `bay-agent` because both of those need them and
//! the workspace rule is that logic a headless client can reach never lives in a front end.
//! Each returns plain JSON, so neither caller has to know this crate's types.
//!
//! **`runtime_install` returns immediately.** Provisioning takes minutes; an MCP call that
//! blocked that long would time out and leave the agent unable to tell a slow download from a
//! hung one. It starts a job and hands back an id to poll with `runtime_status`.
//!
//! Provisioning stays user-initiated. An agent calling this is the user's agent acting on a
//! request they made — what the manifesto rules out is bay downloading on its own initiative,
//! and nothing here runs unless something asks for it.

use serde_json::{Value, json};

use crate::{Manifest, jobs};

/// `runtime_status`: what is installed, what is missing, and how any running install is going.
pub fn runtime_status(args: &Value) -> Value {
    // Polling one job is the common call during an install, so it answers narrowly rather than
    // re-walking the filesystem for a report the caller already has.
    if let Some(id) = args.get("job").and_then(Value::as_u64) {
        return match jobs::state(id) {
            Some(state) => state.to_json(),
            None => json!({ "error": format!("no install job with id {id}") }),
        };
    }

    let report = crate::report();
    let mut status = report.to_json();
    let active: Vec<Value> = jobs::all().iter().map(jobs::JobState::to_json).collect();
    status["jobs"] = Value::Array(active);
    status["canRender"] = Value::Bool(report.can_render());
    status["hint"] = Value::String(hint(&report));
    // What each component is and what it costs on disk. This used to be the `component`
    // parameter's *description* on both `runtime_install` and `runtime_remove` — 1,265 bytes
    // each, the most expensive property per tool in the whole surface, carried by every client
    // on every request whether or not it ever installed anything.
    //
    // It is an answer to "what can I install?", which is this call's question. You cannot
    // install a component without knowing it exists, and finding out is one call.
    status["installable"] = Value::Array(
        crate::Manifest::embedded()
            .components
            .iter()
            .map(|component| {
                json!({
                    "id": component.id,
                    "diskMb": component.disk_bytes / 1_000_000,
                    "detail": component.detail,
                })
            })
            .collect(),
    );
    status
}

fn hint(report: &crate::Report) -> String {
    let missing: Vec<&str> = report
        .components
        .iter()
        .filter(|plan| !plan.satisfied && !plan.unsupported)
        .map(|plan| plan.component.as_str())
        .collect();
    if missing.is_empty() {
        // Everything works — but if any of it is a copy bay did not install, say so. It is the
        // first thing worth knowing when a render behaves differently here than in testing.
        let notes: Vec<&str> = report
            .components
            .iter()
            .filter(|plan| plan.satisfied && plan.satisfied_via.is_some())
            .filter_map(|plan| plan.advisory.as_deref())
            .collect();
        if notes.is_empty() {
            return "everything bay needs is installed".into();
        }
        return format!("everything bay needs is available. {}", notes.join(" "));
    }
    format!(
        "bay can install these itself — call runtime_install with component set to {}. \
         Nothing else needs installing first, and nothing downloads unless you ask.",
        missing
            .iter()
            .map(|id| format!("\"{id}\""))
            .collect::<Vec<_>>()
            .join(" or ")
    )
}

/// `runtime_install`: begin installing a component. Returns a job id to poll.
pub fn runtime_install(args: &Value) -> Result<Value, String> {
    let component = args
        .get("component")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            format!(
                "component is required — one of {}",
                component_names().join(", ")
            )
        })?;

    let manifest = Manifest::embedded();
    if manifest.component(component).is_none() {
        return Err(format!(
            "no such component {component:?} — expected one of {}",
            component_names().join(", ")
        ));
    }

    let plan = crate::report()
        .component(component)
        .cloned()
        .ok_or_else(|| format!("could not work out what {component} needs"))?;

    if plan.satisfied {
        return Ok(json!({
            "component": component,
            "installed": true,
            "message": format!("{} is already installed", plan.title),
        }));
    }

    let id = jobs::start(component).map_err(|error| error.to_string())?;
    Ok(json!({
        "job": id,
        "component": component,
        "installed": false,
        "downloadBytes": plan.download_bytes,
        "download": crate::human_bytes(plan.download_bytes),
        "diskSize": crate::human_bytes(plan.disk_bytes),
        // Named so an agent can attribute what it is about to put on someone's machine.
        "sources": plan.needs.iter().map(|need| json!({
            "name": need.name,
            "source": need.source,
            "license": need.license,
        })).collect::<Vec<_>>(),
        "message": format!(
            "started — poll runtime_status with job {id} until finished is true"
        ),
    }))
}

/// `runtime_remove`: tear down one component that bay installed.
///
/// Only manifest-owned paths under bay's runtime root are eligible. A system ffmpeg or Python
/// that happens to satisfy a component is reported by `runtime_status`, but is never removed.
pub fn runtime_remove(args: &Value) -> Result<Value, String> {
    let component = required_component(args)?;
    if let Some(job) = jobs::running_for(component) {
        return Err(format!(
            "cannot remove {component:?} while install job {job} is running; cancel it first"
        ));
    }
    let target = crate::Target::CURRENT
        .ok_or_else(|| format!("bay has no managed {component} runtime on this platform"))?;
    let root = crate::root().map_err(|error| error.to_string())?;
    runtime_remove_at(component, target, &root)
}

fn runtime_remove_at(
    component: &str,
    target: crate::Target,
    root: &std::path::Path,
) -> Result<Value, String> {
    let removal = crate::remove_at(component, target, root).map_err(|error| error.to_string())?;
    let removed = !removal.paths.is_empty();
    Ok(json!({
        "component": component,
        "removed": removed,
        "freedBytes": removal.bytes,
        "freed": crate::human_bytes(removal.bytes),
        "paths": removal.paths.iter()
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .collect::<Vec<_>>(),
        "message": if removed {
            format!("removed bay's managed {component} runtime")
        } else {
            format!("bay had no managed {component} runtime to remove; system tools were untouched")
        },
    }))
}

fn required_component(args: &Value) -> Result<&str, String> {
    let component = args
        .get("component")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            format!(
                "component is required — one of {}",
                component_names().join(", ")
            )
        })?;
    if Manifest::embedded().component(component).is_none() {
        return Err(format!(
            "no such component {component:?} — expected one of {}",
            component_names().join(", ")
        ));
    }
    Ok(component)
}

fn component_names() -> Vec<String> {
    Manifest::embedded()
        .components
        .iter()
        .map(|component| format!("{:?}", component.id))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_answers_on_any_machine_without_touching_the_network() {
        let status = runtime_status(&json!({}));
        assert!(status["components"].is_array());
        assert!(status["jobs"].is_array());
        assert!(status["canRender"].is_boolean());
        assert!(status["hint"].as_str().is_some_and(|h| !h.is_empty()));
    }

    /// The hint is what an agent reads to decide what to do next, so it must name the tool and
    /// the component rather than telling someone to go and run a shell script.
    #[test]
    fn the_hint_points_at_the_tool_that_fixes_it() {
        let report = crate::report();
        let hint = hint(&report);
        if report
            .components
            .iter()
            .any(|plan| !plan.satisfied && !plan.unsupported)
        {
            assert!(hint.contains("runtime_install"), "{hint}");
        } else {
            // Either "everything is installed", or "everything is available" followed by which
            // copy is being used — never silence about running an untested build.
            assert!(
                hint.contains("installed") || hint.contains("available"),
                "{hint}"
            );
        }
        assert!(
            !hint.contains("setup-speech.sh") && !hint.contains("brew"),
            "the app installs this itself now: {hint}"
        );
    }

    #[test]
    fn installing_without_naming_a_component_lists_the_choices() {
        let error = runtime_install(&json!({})).expect_err("component is required");
        assert!(error.contains("video"), "{error}");
        assert!(error.contains("speech"), "{error}");
    }

    #[test]
    fn an_unknown_component_is_refused_by_name() {
        let error =
            runtime_install(&json!({ "component": "banana" })).expect_err("no such component");
        assert!(error.contains("banana"), "{error}");
    }

    #[test]
    fn polling_a_job_that_does_not_exist_says_so_rather_than_pretending() {
        let status = runtime_status(&json!({ "job": 999_999 }));
        assert!(
            status["error"]
                .as_str()
                .is_some_and(|e| e.contains("999999")),
            "{status}"
        );
    }

    #[test]
    fn runtime_remove_actually_tears_down_the_requested_runtime() {
        let Some(target) = crate::Target::CURRENT else {
            eprintln!("skipping: this platform has no pinned runtime target");
            return;
        };
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("bay-mcp-runtime-remove-{stamp}"));
        let model = root.join("models/whisper/ggml-small.en-q5_1.bin");
        std::fs::create_dir_all(model.parent().unwrap()).unwrap();
        std::fs::write(&model, b"managed model").unwrap();

        let result =
            runtime_remove_at("listen", target, &root).expect("runtime_remove should succeed");

        assert_eq!(result["removed"], true, "{result}");
        assert!(!model.exists(), "runtime_remove left the model on disk");
        assert!(result["freedBytes"].as_u64().unwrap() > 0, "{result}");
        let _ = std::fs::remove_dir_all(root);
    }
}
