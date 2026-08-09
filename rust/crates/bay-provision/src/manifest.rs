//! The pinned catalog of everything bay can install on the user's behalf, and the pure
//! reasoning over it.
//!
//! Everything in this module is a function of the manifest, a target triple and a "does this
//! path exist" probe. Nothing here touches the network or the real filesystem, so what bay
//! *would* do on a Windows machine with a half-installed Python is decided by a unit test on
//! the Mac that ships it — the same discipline [`bay_paths::tools`] uses, and for the same
//! reason: a provisioning bug that only appears on a user's machine after a 1 GB download is
//! not a bug anyone gets to debug twice.

use std::path::{Path, PathBuf};

use serde::Deserialize;

/// The catalog, compiled into the binary.
///
/// Embedded rather than read from disk because bay ships as one executable: a loose
/// `manifest.json` beside it is one more file to lose in a copy, and a version skew between
/// the two would silently install the wrong thing.
const MANIFEST_JSON: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/manifest.json"));

/// A platform bay publishes artifacts for.
///
/// A newtype over the manifest's own spelling rather than an enum of every OS and
/// architecture: the manifest is the authority on which combinations exist, and an enum would
/// invite writing a match arm for a target that has no pinned artifacts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Target(pub &'static str);

impl Target {
    pub const MACOS_ARM: Target = Target("macos-aarch64");
    pub const MACOS_INTEL: Target = Target("macos-x86_64");
    pub const WINDOWS: Target = Target("windows-x86_64");

    /// The target this binary was compiled for, or `None` where bay pins nothing.
    ///
    /// `None` is a real answer, not a bug: bay ships for macOS and Windows, and a Linux
    /// developer running the test suite must be told "no artifacts for this platform" rather
    /// than shown an offer bay cannot honour.
    pub const CURRENT: Option<Target> = if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some(Target::MACOS_ARM)
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some(Target::MACOS_INTEL)
    } else if cfg!(all(windows, target_arch = "x86_64")) {
        Some(Target::WINDOWS)
    } else {
        None
    };

    pub const fn as_str(self) -> &'static str {
        self.0
    }
}

impl std::fmt::Display for Target {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub components: Vec<Component>,
    pub artifacts: Vec<Artifact>,
    pub kokoro_venv: KokoroVenv,
}

/// Something a user chooses to install, as one decision.
///
/// The split is deliberately the one the sizes imply: ffmpeg blocks the core product at ~90 MB,
/// speech is opt-in at ~1.2 GB. Offering them together would make a user who only wants to cut
/// video download a torch runtime.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Component {
    pub id: String,
    pub title: String,
    /// What it is for, in the user's terms — shown next to the download size.
    pub detail: String,
    pub artifacts: Vec<String>,
    /// Work that is not a download. Today only `kokoro-venv`.
    #[serde(default)]
    pub steps: Vec<String>,
    /// Roughly what it costs installed. Reported alongside the download size because they are
    /// wildly different numbers here — 25 MB of CPython unpacks to 73 MB, and the venv is an
    /// order of magnitude larger than anything fetched.
    pub disk_bytes: u64,
    /// The version bay is actually tested against — the one the pinned builds provide.
    #[serde(default)]
    pub verified_version: Option<String>,
    /// The oldest version bay will accept from a copy it did not install itself.
    ///
    /// Absent means "any" — correct for a component with no external equivalent, like the
    /// Kokoro venv, where there is nothing on a user's machine that could stand in for it.
    #[serde(default)]
    pub minimum_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub id: String,
    pub name: String,
    pub source: String,
    pub license: String,
    pub format: Format,
    pub install: InstallKind,
    #[serde(default)]
    pub tree: Option<Tree>,
    pub builds: Vec<Build>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Zip,
    #[serde(rename = "tar.gz")]
    TarGz,
    /// Decide from the URL. uv ships `.tar.gz` for Unix and `.zip` for Windows under one id.
    Auto,
    /// Not an archive: the download **is** the file. Model weights are published as loose files
    /// rather than a bundle, and inventing an archive for them would mean hosting a repackaged
    /// copy — which is exactly the kind of thing that goes stale and unverifiable.
    Raw,
}

impl Format {
    /// The concrete format for a URL, resolving [`Format::Auto`].
    pub fn resolve(self, url: &str) -> Format {
        match self {
            Format::Auto if url.ends_with(".zip") => Format::Zip,
            Format::Auto => Format::TarGz,
            Format::Raw => Format::Raw,
            other => other,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallKind {
    /// Pull named members out of the archive and place them at fixed paths.
    Files,
    /// Unpack the whole archive into one directory.
    Tree,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tree {
    /// Leading path components to drop. python-build-standalone wraps everything in `python/`.
    pub strip: usize,
    pub into: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Build {
    pub target: String,
    pub url: String,
    pub sha256: String,
    pub bytes: u64,
    #[serde(default)]
    pub files: Vec<FileInstall>,
    /// For a tree install, the paths that prove it landed. A `files` build derives this from
    /// `files` instead, so the two can never disagree.
    #[serde(default)]
    pub provides: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInstall {
    /// Path inside the archive.
    pub member: String,
    /// Where it goes, relative to the runtime root.
    pub install: String,
    #[serde(default)]
    pub executable: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KokoroVenv {
    pub python: String,
    pub venv: String,
    pub packages: Vec<String>,
    pub spacy_model: String,
    /// Modules that must import for the venv to count as provisioned.
    pub provides: Vec<String>,
}

impl Manifest {
    /// The embedded catalog.
    ///
    /// Panics only if the manifest compiled into this binary is malformed, which a test in this
    /// module makes impossible to ship.
    pub fn embedded() -> &'static Manifest {
        use std::sync::OnceLock;
        static PARSED: OnceLock<Manifest> = OnceLock::new();
        PARSED.get_or_init(|| {
            serde_json::from_str(MANIFEST_JSON).expect("the embedded manifest must parse")
        })
    }

    pub fn component(&self, id: &str) -> Option<&Component> {
        self.components.iter().find(|c| c.id == id)
    }

    pub fn artifact(&self, id: &str) -> Option<&Artifact> {
        self.artifacts.iter().find(|a| a.id == id)
    }
}

impl Artifact {
    /// This artifact's build for `target`, if it has one.
    ///
    /// Absence is normal, not an error: `ffmpeg` has no Windows build because
    /// `ffmpeg-windows` covers that platform with a single archive containing both binaries.
    pub fn build(&self, target: Target) -> Option<&Build> {
        self.builds.iter().find(|b| b.target == target.as_str())
    }
}

impl Build {
    /// Paths, relative to the runtime root, that must exist for this build to be installed.
    pub fn provided_paths(&self, artifact: &Artifact) -> Vec<PathBuf> {
        match artifact.install {
            InstallKind::Files => self
                .files
                .iter()
                .map(|f| PathBuf::from(&f.install))
                .collect(),
            InstallKind::Tree => self.provides.iter().map(PathBuf::from).collect(),
        }
    }
}

/// One artifact that has to be fetched before a component works.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Need {
    pub artifact: String,
    pub name: String,
    pub url: String,
    pub sha256: String,
    pub bytes: u64,
    pub license: String,
    pub source: String,
}

/// What installing a component on this machine would involve.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    pub component: String,
    pub title: String,
    pub detail: String,
    /// Nothing left to do.
    pub satisfied: bool,
    /// Set when the machine could already do this job without bay installing anything — a
    /// Homebrew ffmpeg, or a venv an earlier build script made. Reported so "installed" does
    /// not imply "bay downloaded it", which would be a confusing thing to read next to a disk
    /// usage figure bay is not responsible for.
    pub satisfied_via: Option<String>,
    /// Something true and worth saying that is not a blocker — "you are on ffmpeg 8.1.2; bay is
    /// tested against 9.0". Set even when the component is satisfied, because the useful moment
    /// to read it is while a render is misbehaving.
    pub advisory: Option<String>,
    /// Artifacts still to fetch, in manifest order.
    pub needs: Vec<Need>,
    /// Steps still to run — today only the Kokoro venv.
    pub steps: Vec<String>,
    pub download_bytes: u64,
    pub disk_bytes: u64,
    /// Set when bay pins nothing for this platform. Distinct from "nothing to do".
    pub unsupported: bool,
}

/// Whether `component` is installed under `root`, and what is missing if not.
///
/// `exists` is injected so every branch — a clean machine, a half-installed one, a platform
/// with no artifacts — is exercised without touching a disk.
pub fn plan(
    manifest: &Manifest,
    component_id: &str,
    target: Option<Target>,
    root: &Path,
    exists: &dyn Fn(&Path) -> bool,
) -> Option<Plan> {
    let component = manifest.component(component_id)?;
    let mut plan = Plan {
        component: component.id.clone(),
        title: component.title.clone(),
        detail: component.detail.clone(),
        satisfied: false,
        satisfied_via: None,
        advisory: None,
        needs: Vec::new(),
        steps: Vec::new(),
        download_bytes: 0,
        disk_bytes: component.disk_bytes,
        unsupported: false,
    };

    let Some(target) = target else {
        plan.unsupported = true;
        return Some(plan);
    };

    // An artifact with no build for this target is not missing — it does not apply here. A
    // component with *no* applicable artifacts at all is a different thing, and is reported as
    // unsupported rather than as "already installed", which is the failure mode that would send
    // a Linux user to a render that cannot work.
    let mut applicable = 0usize;
    for artifact_id in &component.artifacts {
        let Some(artifact) = manifest.artifact(artifact_id) else {
            continue;
        };
        let Some(build) = artifact.build(target) else {
            continue;
        };
        applicable += 1;
        let installed = build
            .provided_paths(artifact)
            .iter()
            .all(|relative| exists(&root.join(relative)));
        if !installed {
            plan.download_bytes += build.bytes;
            plan.needs.push(Need {
                artifact: artifact.id.clone(),
                name: artifact.name.clone(),
                url: build.url.clone(),
                sha256: build.sha256.clone(),
                bytes: build.bytes,
                license: artifact.license.clone(),
                source: artifact.source.clone(),
            });
        }
    }

    if applicable == 0 {
        plan.unsupported = true;
        return Some(plan);
    }

    for step in &component.steps {
        if step == "kokoro-venv" && !exists(&root.join(venv_marker(&manifest.kokoro_venv))) {
            plan.steps.push(step.clone());
        }
    }

    plan.satisfied = plan.needs.is_empty() && plan.steps.is_empty();
    Some(plan)
}

/// The file whose presence means the Kokoro venv exists.
///
/// Presence is not proof the venv *imports* kokoro — that costs an interpreter start, which is
/// too slow for a status readout drawn every frame. The expensive check lives in
/// [`crate::speech`] and runs when narration is actually attempted.
pub fn venv_marker(venv: &KokoroVenv) -> PathBuf {
    let base = PathBuf::from(&venv.venv);
    if cfg!(windows) {
        base.join("Scripts").join("python.exe")
    } else {
        base.join("bin").join("python")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nothing_exists(_: &Path) -> bool {
        false
    }

    fn everything_exists(_: &Path) -> bool {
        true
    }

    fn present(paths: &[&str]) -> impl Fn(&Path) -> bool + use<> {
        let set: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
        move |candidate| set.iter().any(|known| candidate.ends_with(known))
    }

    #[test]
    fn the_embedded_manifest_parses() {
        let manifest = Manifest::embedded();
        assert!(!manifest.components.is_empty());
        assert!(manifest.component("video").is_some());
        assert!(manifest.component("speech").is_some());
    }

    /// A component naming an artifact that does not exist would silently install less than it
    /// promised — the user would click "install ffmpeg" and get a working button and a broken
    /// render.
    #[test]
    fn every_component_references_artifacts_that_exist() {
        let manifest = Manifest::embedded();
        for component in &manifest.components {
            for id in &component.artifacts {
                assert!(
                    manifest.artifact(id).is_some(),
                    "component {} names unknown artifact {id}",
                    component.id
                );
            }
            for step in &component.steps {
                assert_eq!(step, "kokoro-venv", "unknown step in {}", component.id);
            }
        }
    }

    /// A digest that is not 64 hex characters cannot match anything, so the artifact would be
    /// downloaded and rejected forever. Cheaper to catch here than on a user's connection.
    #[test]
    fn every_pinned_digest_is_a_sha256() {
        for artifact in &Manifest::embedded().artifacts {
            for build in &artifact.builds {
                assert_eq!(
                    build.sha256.len(),
                    64,
                    "{} / {}: digest is not 64 characters",
                    artifact.id,
                    build.target
                );
                assert!(
                    build.sha256.chars().all(|c| c.is_ascii_hexdigit()),
                    "{} / {}: digest is not hex",
                    artifact.id,
                    build.target
                );
                assert!(
                    build.sha256.chars().all(|c| !c.is_ascii_uppercase()),
                    "{} / {}: digests are compared lowercase",
                    artifact.id,
                    build.target
                );
                assert!(build.bytes > 0, "{}: a size of zero is a typo", artifact.id);
            }
        }
    }

    /// A mutable URL breaks the pin the first time the publisher rebuilds. BtbN's `latest` tag
    /// is rebuilt daily in place; `master-latest` likewise. Naming them here is what stops a
    /// future re-pin from quietly reintroducing one.
    #[test]
    fn no_pinned_url_is_a_mutable_tag() {
        for artifact in &Manifest::embedded().artifacts {
            for build in &artifact.builds {
                for forbidden in ["/latest/", "master-latest", "releases/latest"] {
                    assert!(
                        !build.url.contains(forbidden),
                        "{} / {}: {forbidden} is rebuilt in place and cannot be pinned — \
                         use a dated or build-id URL",
                        artifact.id,
                        build.target
                    );
                }
                assert!(
                    build.url.starts_with("https://"),
                    "{}: artifacts are fetched over TLS",
                    artifact.id
                );
            }
        }
    }

    /// A nonfree ffmpeg cannot legally be redistributed by anyone. bay does not redistribute
    /// these today, but bundling one into bay.app later would be a licence breach, and the
    /// mistake is invisible without a check like this.
    #[test]
    fn no_artifact_is_a_nonredistributable_build() {
        for artifact in &Manifest::embedded().artifacts {
            assert!(
                !artifact.license.to_lowercase().contains("nonfree"),
                "{}: a nonfree build may not be redistributed",
                artifact.id
            );
            assert!(!artifact.license.is_empty(), "{}: no licence", artifact.id);
        }
    }

    /// Every target bay ships for must be able to render. A missing ffmpeg build would show up
    /// as "already installed" on that platform and fail at the first decode.
    #[test]
    fn every_shipped_target_can_render_and_speak() {
        let manifest = Manifest::embedded();
        for target in [Target::MACOS_ARM, Target::MACOS_INTEL, Target::WINDOWS] {
            for component in ["video", "speech"] {
                let plan = plan(
                    manifest,
                    component,
                    Some(target),
                    Path::new("/runtime"),
                    &nothing_exists,
                )
                .expect("component exists");
                assert!(
                    !plan.unsupported,
                    "{component} has no artifacts for {target}"
                );
                assert!(
                    plan.download_bytes > 0,
                    "{component} on {target} downloads nothing"
                );
            }
        }
    }

    /// The reported download must be what a user is about to spend. ffmpeg and ffprobe are two
    /// separate ~28 MB archives on macOS, and reporting one of them would understate it by half.
    #[test]
    fn the_download_size_is_the_sum_of_what_is_missing() {
        let manifest = Manifest::embedded();
        let plan = plan(
            manifest,
            "video",
            Some(Target::MACOS_ARM),
            Path::new("/runtime"),
            &nothing_exists,
        )
        .unwrap();
        let expected: u64 = plan.needs.iter().map(|n| n.bytes).sum();
        assert_eq!(plan.download_bytes, expected);
        assert_eq!(plan.needs.len(), 2, "ffmpeg and ffprobe: {:?}", plan.needs);
    }

    /// Windows gets both binaries from one archive, so it must plan one download, not two.
    #[test]
    fn windows_fetches_one_archive_for_both_binaries() {
        let manifest = Manifest::embedded();
        let plan = plan(
            manifest,
            "video",
            Some(Target::WINDOWS),
            Path::new("/runtime"),
            &nothing_exists,
        )
        .unwrap();
        assert_eq!(plan.needs.len(), 1, "{:?}", plan.needs);
        assert_eq!(plan.needs[0].artifact, "ffmpeg-windows");
    }

    #[test]
    fn nothing_is_planned_when_everything_is_already_there() {
        let manifest = Manifest::embedded();
        for component in ["video", "speech"] {
            let plan = plan(
                manifest,
                component,
                Some(Target::MACOS_ARM),
                Path::new("/runtime"),
                &everything_exists,
            )
            .unwrap();
            assert!(plan.satisfied, "{component}: {plan:?}");
            assert_eq!(plan.download_bytes, 0);
        }
    }

    /// The half-installed case: ffmpeg landed, ffprobe did not. Re-running must fetch only the
    /// missing one rather than starting again from nothing.
    #[test]
    fn a_partial_install_only_fetches_what_is_missing() {
        let manifest = Manifest::embedded();
        let plan = plan(
            manifest,
            "video",
            Some(Target::MACOS_ARM),
            Path::new("/runtime"),
            &present(&["bin/ffmpeg"]),
        )
        .unwrap();
        assert_eq!(plan.needs.len(), 1);
        assert_eq!(plan.needs[0].artifact, "ffprobe");
        assert!(!plan.satisfied);
    }

    /// Downloading Python but never building the venv leaves narration broken. The step has to
    /// survive in the plan, or a user whose install was interrupted after the last download
    /// would be told everything is fine.
    #[test]
    fn speech_still_needs_its_venv_after_every_download_lands() {
        let manifest = Manifest::embedded();
        // Every download, which now includes the pinned Kokoro weights. Listing them by walking
        // the manifest rather than writing paths out again means adding a voice cannot silently
        // make this test assert something weaker than it says.
        let mut landed: Vec<String> = vec![
            "bin/uv".to_string(),
            "python/3.12.13/bin/python3.12".to_string(),
        ];
        for artifact in &manifest.artifacts {
            if !artifact.id.starts_with("kokoro-") {
                continue;
            }
            if let Some(build) = artifact.build(Target::MACOS_ARM) {
                landed.extend(build.files.iter().map(|file| file.install.clone()));
            }
        }
        let landed: Vec<&str> = landed.iter().map(|s| s.as_str()).collect();

        let plan = plan(
            manifest,
            "speech",
            Some(Target::MACOS_ARM),
            Path::new("/runtime"),
            &present(&landed),
        )
        .unwrap();
        assert!(plan.needs.is_empty(), "{:?}", plan.needs);
        assert_eq!(plan.steps, vec!["kokoro-venv".to_string()]);
        assert!(!plan.satisfied, "the venv has not been built yet");
    }

    /// The weights have to be part of the speech component on every shipped target.
    ///
    /// `plan` skips an artifact with no build for the target *silently* — which is right, since
    /// that is how a platform-specific artifact opts out. But it means an artifact whose builds
    /// name no shipped target is invisible: it downloads nothing, breaks no test, and the first
    /// symptom is a user's narration quietly reaching out to HuggingFace at speak time. That is
    /// exactly what a `"target": "any"` wildcard did in the first draft of this.
    #[test]
    fn every_shipped_target_downloads_the_kokoro_weights() {
        let manifest = Manifest::embedded();
        for target in [Target::MACOS_ARM, Target::MACOS_INTEL, Target::WINDOWS] {
            let plan = plan(
                manifest,
                "speech",
                Some(target),
                Path::new("/runtime"),
                &nothing_exists,
            )
            .expect("speech exists");

            let weights: Vec<&str> = plan
                .needs
                .iter()
                .filter(|need| need.artifact.starts_with("kokoro-"))
                .map(|need| need.artifact.as_str())
                .collect();
            assert!(
                weights.contains(&"kokoro-model"),
                "{target} must download the model itself"
            );
            assert!(
                weights.contains(&"kokoro-config"),
                "{target} must download the model config"
            );
            let voices = weights
                .iter()
                .filter(|id| id.starts_with("kokoro-voice-"))
                .count();
            assert_eq!(
                voices, 54,
                "{target} must download every voice the sidecar advertises, got {voices}"
            );
        }
    }

    /// The reported download has to cover the weights too.
    ///
    /// The whole defect this closes is that `runtime_install speech` showed a bar for ~1.2 GB
    /// and then silently fetched another ~339 MB inside the first narrate. A total that
    /// excluded them would be the same lie in a new place.
    #[test]
    fn the_speech_download_total_includes_the_weights() {
        let manifest = Manifest::embedded();
        let plan = plan(
            manifest,
            "speech",
            Some(Target::MACOS_ARM),
            Path::new("/runtime"),
            &nothing_exists,
        )
        .expect("speech exists");

        let weights: u64 = plan
            .needs
            .iter()
            .filter(|need| need.artifact.starts_with("kokoro-"))
            .map(|need| need.bytes)
            .sum();
        assert!(
            weights > 300 * 1024 * 1024,
            "the weights should be ~339 MB, got {weights} bytes"
        );
        assert!(
            plan.download_bytes >= weights,
            "the reported download must include the weights"
        );
    }

    /// A platform bay pins nothing for must say so. Reporting "satisfied" would offer a render
    /// that cannot work, which is worse than an honest refusal.
    #[test]
    fn a_platform_with_no_artifacts_is_unsupported_not_satisfied() {
        let manifest = Manifest::embedded();
        let plan = plan(
            manifest,
            "video",
            None,
            Path::new("/runtime"),
            &nothing_exists,
        )
        .unwrap();
        assert!(plan.unsupported);
        assert!(!plan.satisfied);
        assert!(plan.needs.is_empty());
    }

    #[test]
    fn an_unknown_component_is_none_rather_than_an_empty_plan() {
        let manifest = Manifest::embedded();
        assert!(
            plan(
                manifest,
                "nope",
                Some(Target::MACOS_ARM),
                Path::new("/r"),
                &nothing_exists
            )
            .is_none()
        );
    }

    #[test]
    fn auto_format_follows_the_url_extension() {
        assert_eq!(Format::Auto.resolve("https://x/uv.zip"), Format::Zip);
        assert_eq!(Format::Auto.resolve("https://x/uv.tar.gz"), Format::TarGz);
        assert_eq!(
            Format::Zip.resolve("https://x/whatever.tar.gz"),
            Format::Zip
        );
    }

    /// Every `files` build must name where each member goes, or the artifact downloads and
    /// installs nothing.
    #[test]
    fn file_installs_declare_their_destinations() {
        for artifact in &Manifest::embedded().artifacts {
            for build in &artifact.builds {
                match artifact.install {
                    InstallKind::Files => assert!(
                        !build.files.is_empty(),
                        "{} / {}: a files install with no files",
                        artifact.id,
                        build.target
                    ),
                    InstallKind::Tree => {
                        assert!(
                            artifact.tree.is_some(),
                            "{}: a tree install with no tree rule",
                            artifact.id
                        );
                        assert!(
                            !build.provides.is_empty(),
                            "{} / {}: a tree install must say what proves it landed",
                            artifact.id,
                            build.target
                        );
                    }
                }
            }
        }
    }

    /// Installed paths must stay inside the runtime root. A `..` here would let the manifest
    /// write anywhere the user can — and the manifest is the thing a supply-chain attack on
    /// this repo would edit.
    #[test]
    fn no_install_path_escapes_the_runtime_root() {
        for artifact in &Manifest::embedded().artifacts {
            let mut destinations: Vec<String> = Vec::new();
            if let Some(tree) = &artifact.tree {
                destinations.push(tree.into.clone());
            }
            for build in &artifact.builds {
                destinations.extend(build.files.iter().map(|f| f.install.clone()));
                destinations.extend(build.provides.iter().cloned());
            }
            for destination in destinations {
                let path = Path::new(&destination);
                assert!(
                    path.is_relative(),
                    "{}: {destination} is absolute",
                    artifact.id
                );
                assert!(
                    !path
                        .components()
                        .any(|c| c == std::path::Component::ParentDir),
                    "{}: {destination} climbs out of the runtime root",
                    artifact.id
                );
            }
        }
    }
}
