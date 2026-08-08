//! Installing the runtimes bay needs, so the user does not have to.
//!
//! bay ships as one binary. The things it *shells out to* — ffmpeg, a Python interpreter, the
//! Kokoro package and its weights — cannot live inside that binary: ffmpeg is GPL-3.0 and a
//! torch runtime is 858 MB, an order of magnitude larger than the editor. So the goal is not
//! "one file on disk"; it is **the user installs nothing by hand**. bay fetches what it needs,
//! verifies it against a digest pinned in [`manifest`], and puts it somewhere only bay uses.
//!
//! Three rules shape everything here.
//!
//! **Provisioning is user-initiated.** A first-run auto-download is bay making a network call
//! on its own behalf, which is exactly what the manifesto rules out. The flow is: detect what
//! is missing, say what it is and how big it is, and let the user decide. Nothing in this crate
//! starts on its own — [`report`] only reads the filesystem, and [`install_blocking`] is only
//! reached from an explicit request.
//!
//! **The digest is the trust anchor.** Not the URL, not TLS, not the publisher. Bytes that do
//! not match the manifest are deleted, and the failure names both digests.
//!
//! **A half-install is never mistaken for a whole one.** Every write is staged and renamed, and
//! [`manifest::plan`] re-derives what is missing from what is actually on disk rather than from
//! a receipt file that can go stale.
//!
//! What this deliberately does not do is freeze Python into the binary. PyInstaller with torch
//! lands ~2.6 GB and TorchScript needs `.py` source a frozen app does not have; Nuitka disables
//! `torch.jit` in standalone mode; PyOxidizer is dead. All three also require signing dozens of
//! nested dylibs under the hardened runtime. Shipping a real interpreter is smaller *and*
//! simpler.

use std::path::{Path, PathBuf};

pub mod archive;
pub mod fetch;
pub mod jobs;
pub mod manifest;
pub mod mcp;
pub mod receipt;
pub mod speech;
pub mod toolcheck;

pub use fetch::{Fetch, Http};
pub use manifest::{Manifest, Plan, Target};

/// Why provisioning could not finish.
#[derive(Debug, thiserror::Error)]
pub enum ProvisionError {
    #[error("could not reach {url}: {detail}")]
    Network { url: String, detail: String },

    #[error(
        "{artifact} did not match the digest bay pinned for it, so it was discarded.\n  \
         from:     {url}\n  expected: {expected}\n  received: {actual}\n\
         Either the download was corrupted, or the publisher replaced the file. bay will not \
         run bytes it cannot verify."
    )]
    DigestMismatch {
        artifact: String,
        url: String,
        expected: String,
        actual: String,
    },

    #[error("the archive could not be read: {0}")]
    Archive(String),

    #[error(
        "{archive} does not contain {member}. The publisher has changed the archive layout, \
         so the pin in bay's manifest needs updating."
    )]
    MissingMember { member: String, archive: String },

    #[error("refused to unpack {member}: it would write outside bay's runtime directory")]
    UnsafePath { member: String },

    #[error("{path}: {detail}")]
    Io { path: String, detail: String },

    #[error("bay could not work out where to keep its data, so it has nowhere to install to")]
    NoRuntimeDir,

    #[error("no such component: {0}")]
    UnknownComponent(String),

    #[error(
        "bay has no pinned {component} build for this platform. It ships for macOS and \
         Windows; on anything else these have to be installed the usual way."
    )]
    Unsupported { component: String },

    #[error("{step} failed: {detail}")]
    Step { step: String, detail: String },
}

impl ProvisionError {
    /// An IO failure that names the path it happened to. `std::io::Error` alone says
    /// "permission denied" and leaves the reader guessing which of a hundred files it meant.
    pub fn at(path: &Path, error: std::io::Error) -> Self {
        ProvisionError::Io {
            path: path.display().to_string(),
            detail: error.to_string(),
        }
    }
}

/// Where provisioned runtimes live.
pub fn root() -> Result<PathBuf, ProvisionError> {
    bay_paths::runtime_dir().ok_or(ProvisionError::NoRuntimeDir)
}

/// Where verified archives are kept between the download and the unpack.
///
/// Inside the runtime directory rather than the system temp directory: a 170 MB archive that
/// vanishes on reboot means an interrupted install starts from zero, and bay's disk usage
/// should be measurable in one place.
fn cache_dir(root: &Path) -> PathBuf {
    root.join("downloads")
}

/// What is installed, what is missing, and what installing it would cost.
///
/// Reads the filesystem and nothing else — no network, no subprocess. Safe to call for a status
/// readout.
pub fn report() -> Report {
    let manifest = Manifest::embedded();
    let root = bay_paths::runtime_dir();
    let target = Target::CURRENT;
    let exists = |path: &Path| path.exists();

    let components: Vec<Plan> = match &root {
        Some(root) => manifest
            .components
            .iter()
            .filter_map(|component| manifest::plan(manifest, &component.id, target, root, &exists))
            .map(already_usable)
            .collect(),
        None => Vec::new(),
    };

    Report {
        root,
        target,
        components,
    }
}

/// Mark a component satisfied when the machine can already do the job, however it got that way.
///
/// [`manifest::plan`] answers a narrow question — is this in bay's runtime directory — and that
/// is the right question for *installing*. It is the wrong question for *reporting*: a user with
/// Homebrew's ffmpeg would be told video was missing and offered a 57 MB download they do not
/// need, and an agent reading that would install one. What matters is whether bay can decode and
/// speak, not which copy it ended up using.
///
/// The needs list is cleared along with the flag. Leaving it populated would let a caller show
/// "installed" and "2 files missing" at the same time.
fn already_usable(mut plan: Plan) -> Plan {
    if plan.satisfied || plan.unsupported {
        return plan;
    }
    let usable = match plan.component.as_str() {
        "video" => system_ffmpeg_verdict(&plan).and_then(|(judgement, text)| {
            plan.advisory = Some(text.clone());
            judgement.is_usable().then_some(text)
        }),
        // Presence of an interpreter, not proof that it imports kokoro — that costs an
        // interpreter start, and this is called for a status readout. `narrate` does the
        // expensive check and reports properly when it fails.
        "speech" => speech::existing_interpreter()
            .map(|path| format!("already available at {}", path.display())),
        _ => None,
    };

    if let Some(how) = usable {
        plan.satisfied = true;
        plan.satisfied_via = Some(how);
        plan.needs.clear();
        plan.steps.clear();
        plan.download_bytes = 0;
    }
    plan
}

/// Whether the ffmpeg already on this machine is one bay can stand behind.
///
/// This is the check that closes the gap pinning alone leaves open. A provisioned user runs the
/// exact bytes the developer tested; a user who already had ffmpeg runs whatever their package
/// manager gave them, and "it exists" is not evidence it behaves the same. So a copy bay did not
/// install has to clear the floor in the manifest, and if it cannot say what version it is, it
/// does not clear it.
///
/// Returns `None` only when no ffmpeg can be found at all — the plain "not installed" case,
/// which the plan already describes.
fn system_ffmpeg_verdict(plan: &Plan) -> Option<(toolcheck::Judgement, String)> {
    let component = Manifest::embedded().component(&plan.component)?;
    let minimum = component
        .minimum_version
        .as_deref()
        .and_then(toolcheck::Version::parse)
        .unwrap_or(toolcheck::Version(0, 0, 0));
    let verified = component.verified_version.as_deref().unwrap_or("its own");

    // Both tools must resolve; half an ffmpeg install is not a working one.
    let mut resolved = Vec::new();
    for tool in bay_paths::tools::Tool::all() {
        resolved.push(bay_paths::tools::status(tool).ok()?);
    }
    let ffmpeg = resolved.first()?;

    // bay's own copy needs no interrogation — it was verified against a pinned digest before it
    // was written, which is a stronger statement than any version string.
    let judgement = if ffmpeg.via == bay_paths::tools::Via::Managed {
        toolcheck::Judgement::Tested
    } else {
        toolcheck::judge(cached_version(&ffmpeg.path), minimum)
    };
    let text = toolcheck::describe(&judgement, verified, minimum);
    Some((judgement, text))
}

/// `ffmpeg -version` costs a process start, and a status readout can be drawn often. Cached for
/// the life of the process, keyed by path so an override or a fresh install is not stale.
fn cached_version(path: &Path) -> Option<toolcheck::Version> {
    use std::sync::{Mutex, OnceLock};
    type Cache = Mutex<Vec<(PathBuf, Option<toolcheck::Version>)>>;
    static CACHE: OnceLock<Cache> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(Vec::new()));

    if let Ok(entries) = cache.lock()
        && let Some((_, version)) = entries.iter().find(|(known, _)| known == path)
    {
        return *version;
    }
    let version = toolcheck::probe_version(path);
    if let Ok(mut entries) = cache.lock() {
        entries.push((path.to_path_buf(), version));
    }
    version
}

#[derive(Debug, Clone)]
pub struct Report {
    pub root: Option<PathBuf>,
    pub target: Option<Target>,
    pub components: Vec<Plan>,
}

impl Report {
    pub fn component(&self, id: &str) -> Option<&Plan> {
        self.components.iter().find(|plan| plan.component == id)
    }

    /// Whether everything needed to decode and export video is present.
    pub fn can_render(&self) -> bool {
        self.component("video").is_some_and(|plan| plan.satisfied)
    }

    /// A readout an agent or a UI can render without knowing this crate's types.
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "root": self.root.as_ref().map(|p| p.display().to_string()),
            "platform": self.target.map(|t| t.as_str()),
            "components": self.components.iter().map(plan_json).collect::<Vec<_>>(),
            "tools": bay_paths::tools::Tool::all().iter().map(|tool| {
                match bay_paths::tools::status(*tool) {
                    Ok(found) => serde_json::json!({
                        "tool": tool.binary(),
                        "available": true,
                        "path": found.path.display().to_string(),
                        "via": found.via.describe(),
                    }),
                    Err(missing) => serde_json::json!({
                        "tool": tool.binary(),
                        "available": false,
                        "why": missing.short(),
                    }),
                }
            }).collect::<Vec<_>>(),
        })
    }
}

fn plan_json(plan: &Plan) -> serde_json::Value {
    serde_json::json!({
        "id": plan.component,
        "title": plan.title,
        "detail": plan.detail,
        "installed": plan.satisfied,
        "satisfiedVia": plan.satisfied_via,
        "advisory": plan.advisory,
        "supported": !plan.unsupported,
        "downloadBytes": plan.download_bytes,
        "diskBytes": plan.disk_bytes,
        "downloadSize": human_bytes(plan.download_bytes),
        "diskSize": human_bytes(plan.disk_bytes),
        "missing": plan.needs.iter().map(|need| serde_json::json!({
            "artifact": need.artifact,
            "name": need.name,
            "bytes": need.bytes,
            "size": human_bytes(need.bytes),
            "license": need.license,
            "source": need.source,
        })).collect::<Vec<_>>(),
        "steps": plan.steps,
    })
}

/// A size a person can read. Deliberately coarse — the difference between 1.19 GB and 1.2 GB
/// does not change anyone's decision, and the extra digits make the number harder to take in.
pub fn human_bytes(bytes: u64) -> String {
    const UNIT: f64 = 1000.0;
    let bytes = bytes as f64;
    if bytes < UNIT {
        return format!("{bytes:.0} B");
    }
    let units = ["kB", "MB", "GB", "TB"];
    let mut value = bytes / UNIT;
    let mut unit = 0;
    while value >= UNIT && unit + 1 < units.len() {
        value /= UNIT;
        unit += 1;
    }
    if value < 10.0 {
        format!("{value:.1} {}", units[unit])
    } else {
        format!("{value:.0} {}", units[unit])
    }
}

/// What an install is doing right now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Progress {
    /// Beginning an artifact. `total` is the manifest's size, so a UI can draw a bar before a
    /// single byte arrives.
    Downloading {
        artifact: String,
        done: u64,
        total: u64,
    },
    Unpacking {
        artifact: String,
    },
    /// A step that is not a download — building the Kokoro venv.
    Step {
        step: String,
        detail: String,
    },
}

/// Install `component_id`, blocking until it is done.
///
/// Long — minutes, on a slow connection, and the Kokoro venv resolves ~1 GB of wheels. Callers
/// that must stay responsive should use [`jobs::start`], which runs this on its own thread.
///
/// Idempotent: it plans against what is actually on disk, so re-running after a failure resumes
/// rather than restarting, and running it when nothing is missing does nothing at all.
pub fn install_blocking(
    component_id: &str,
    fetch: &dyn Fetch,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<(), ProvisionError> {
    let manifest = Manifest::embedded();
    let root = root()?;
    let exists = |path: &Path| path.exists();

    let plan = manifest::plan(manifest, component_id, Target::CURRENT, &root, &exists)
        .ok_or_else(|| ProvisionError::UnknownComponent(component_id.to_string()))?;

    if plan.unsupported {
        return Err(ProvisionError::Unsupported {
            component: plan.title.clone(),
        });
    }

    let cache = cache_dir(&root);
    for need in &plan.needs {
        let artifact = manifest
            .artifact(&need.artifact)
            .ok_or_else(|| ProvisionError::UnknownComponent(need.artifact.clone()))?;
        let build = Target::CURRENT
            .and_then(|target| artifact.build(target))
            .ok_or_else(|| ProvisionError::Unsupported {
                component: artifact.name.clone(),
            })?;

        let total = need.bytes;
        let name = need.artifact.clone();
        on_progress(Progress::Downloading {
            artifact: name.clone(),
            done: 0,
            total,
        });
        let downloaded = fetch::download_verified(fetch, need, &cache, &mut |done| {
            on_progress(Progress::Downloading {
                artifact: name.clone(),
                done,
                total,
            })
        })?;

        on_progress(Progress::Unpacking {
            artifact: need.artifact.clone(),
        });
        let format = artifact.format.resolve(&need.url);
        let placed = match artifact.install {
            manifest::InstallKind::Files => {
                archive::extract_files(&downloaded, format, &build.files, &root)?
            }
            manifest::InstallKind::Tree => {
                let tree = artifact.tree.as_ref().ok_or_else(|| {
                    ProvisionError::Archive(format!("{} has no tree rule", artifact.id))
                })?;
                vec![archive::extract_tree(&downloaded, format, tree, &root)?]
            }
        };

        // Recorded only now — after the digest matched and the files are on disk. A receipt
        // written any earlier would claim an install that had not happened. A failure to write
        // it is not a failure to install: the files are there and work, and the filesystem, not
        // this record, is what `plan` believes.
        if let Err(error) = receipt::record(
            &root,
            &artifact.id,
            &artifact.name,
            &need.sha256,
            &need.url,
            &placed,
        ) {
            eprintln!(
                "bay: installed {} but could not record it: {error}",
                artifact.id
            );
        }
    }

    for step in &plan.steps {
        match step.as_str() {
            "kokoro-venv" => speech::provision_venv(&root, &manifest.kokoro_venv, &mut |detail| {
                on_progress(Progress::Step {
                    step: "kokoro-venv".into(),
                    detail,
                })
            })?,
            other => {
                return Err(ProvisionError::Step {
                    step: other.to_string(),
                    detail: "bay does not know how to run this step".into(),
                });
            }
        }
    }

    // The tool resolver caches its answer for the life of the process. Without this, ffmpeg
    // stays "not installed" until the user restarts bay — having just watched it install.
    bay_paths::tools::forget_cached();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_read_the_way_a_person_would_say_them() {
        assert_eq!(human_bytes(0), "0 B");
        assert_eq!(human_bytes(999), "999 B");
        assert_eq!(human_bytes(1_500), "1.5 kB");
        assert_eq!(human_bytes(28_440_078), "28 MB");
        assert_eq!(human_bytes(167_990_084), "168 MB");
        assert_eq!(human_bytes(1_200_000_000), "1.2 GB");
    }

    /// A status readout must answer on any machine, provisioned or not, without touching the
    /// network — it is drawn while the user is looking at the editor.
    #[test]
    fn a_report_can_always_be_produced() {
        let report = report();
        let json = report.to_json();
        assert!(json.get("components").is_some());
        if Target::CURRENT.is_some() {
            assert!(
                report.component("video").is_some(),
                "a supported platform must report on video: {json}"
            );
        }
    }

    #[test]
    fn the_report_serialises_every_component_with_a_readable_size() {
        let json = report().to_json();
        for component in json["components"].as_array().unwrap() {
            assert!(component["id"].is_string());
            assert!(component["downloadSize"].as_str().is_some());
            assert!(component["diskSize"].as_str().is_some());
        }
    }

    /// A machine that already has ffmpeg — from Homebrew, or anywhere else bay looks — must not
    /// be offered a download it does not need. Stated as an invariant rather than a fixed
    /// expectation so it holds on a bare CI runner and on a developer's Mac alike.
    #[test]
    fn a_machine_that_can_already_render_is_not_asked_to_install_ffmpeg() {
        let usable = bay_paths::tools::Tool::all()
            .iter()
            .all(|tool| bay_paths::tools::status(*tool).is_ok());
        let report = report();
        let Some(plan) = report.component("video") else {
            return; // no artifacts for this platform
        };
        if usable {
            assert!(
                plan.satisfied,
                "ffmpeg and ffprobe both resolve, so video must not be reported as missing: {plan:?}"
            );
            assert_eq!(
                plan.download_bytes, 0,
                "nothing should be offered for download"
            );
        } else {
            assert!(
                !plan.satisfied || plan.unsupported,
                "video cannot be satisfied when the tools do not resolve: {plan:?}"
            );
        }
    }

    /// "Installed" must not imply "bay downloaded it" — a component satisfied by a system copy
    /// says which one, so a disk-usage figure bay is not responsible for is not attributed to it.
    #[test]
    fn a_component_satisfied_from_outside_says_where_it_came_from() {
        for plan in &report().components {
            if let Some(via) = &plan.satisfied_via {
                assert!(plan.satisfied, "{plan:?}");
                assert!(!via.is_empty());
                assert!(plan.needs.is_empty(), "{plan:?}");
            }
        }
    }

    /// The release failure this guards against: ship, and a user's older ffmpeg breaks a feature
    /// that worked everywhere in testing. A copy bay did not install is only accepted when it
    /// clears the manifest's floor, so "it exists" can never stand in for "it is good enough".
    #[test]
    fn video_is_only_satisfied_by_a_copy_that_clears_the_floor() {
        let video = Manifest::embedded()
            .component("video")
            .expect("the video component");
        let minimum = video
            .minimum_version
            .as_deref()
            .and_then(toolcheck::Version::parse)
            .expect("video must declare a floor, or an untested ffmpeg is accepted silently");

        let Ok(found) = bay_paths::tools::status(bay_paths::tools::Tool::Ffmpeg) else {
            return; // no ffmpeg here at all; the plain not-installed case
        };
        let plan = report().component("video").cloned().expect("a video plan");
        if found.via == bay_paths::tools::Via::Managed {
            assert!(plan.satisfied, "bay's own build must always be trusted");
            return;
        }
        match cached_version(&found.path) {
            Some(version) if version >= minimum => assert!(
                plan.satisfied,
                "ffmpeg {version} clears the {minimum} floor and should be accepted: {plan:?}"
            ),
            other => assert!(
                !plan.satisfied,
                "ffmpeg {other:?} does not clear the {minimum} floor and must not be used: {plan:?}"
            ),
        }
    }

    /// Whatever the verdict, the user has to be told which build they are on — that is the first
    /// question when a render misbehaves, and it should not require running anything.
    #[test]
    fn the_report_says_which_ffmpeg_is_in_use() {
        if bay_paths::tools::status(bay_paths::tools::Tool::Ffmpeg).is_err() {
            return;
        }
        let plan = report().component("video").cloned().expect("a video plan");
        let advisory = plan
            .advisory
            .expect("a resolvable ffmpeg must be described, accepted or not");
        let verified = Manifest::embedded()
            .component("video")
            .and_then(|c| c.verified_version.clone())
            .expect("video must record the version bay is tested against");
        assert!(
            advisory.contains(&verified),
            "the message must name the tested build so a bug report can quote it: {advisory}"
        );
    }

    /// The floor must be no newer than what bay ships, or every provisioned machine would be
    /// judged inadequate the moment it finished installing.
    #[test]
    fn the_floor_is_not_above_the_build_bay_ships() {
        for component in &Manifest::embedded().components {
            let (Some(verified), Some(minimum)) = (
                component
                    .verified_version
                    .as_deref()
                    .and_then(toolcheck::Version::parse),
                component
                    .minimum_version
                    .as_deref()
                    .and_then(toolcheck::Version::parse),
            ) else {
                continue;
            };
            assert!(
                minimum <= verified,
                "{}: the floor {minimum} is above the {verified} bay installs",
                component.id
            );
        }
    }

    #[test]
    fn an_unknown_component_is_named_in_the_error() {
        let error = install_blocking("nonsense", &Http::new(), &mut |_| {})
            .expect_err("there is no such component");
        assert!(error.to_string().contains("nonsense"), "{error}");
    }
}
