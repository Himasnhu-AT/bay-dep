//! The end-to-end claim, against the real network: a machine with nothing installed can be made
//! able to render, by bay, with no user action beyond asking for it.
//!
//! Skipped by default — it downloads tens of megabytes and takes minutes, which has no place in
//! `cargo test`. `BAY_PROVISION_LIVE=1` turns it on, matching how `BAY_REQUIRE_GPU` and
//! `BAY_REQUIRE_FFMPEG` work elsewhere in this workspace. A skip here is a skip, and must never
//! be reported as a pass.
//!
//! It provisions into a throwaway `BAY_DATA_DIR`, so running it cannot disturb the real
//! installation on the machine running it.

use std::path::PathBuf;

use bay_provision::{Http, Progress};

fn scratch_root(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("bay-live-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("scratch directory");
    // SAFETY: set before any thread that reads it exists — this test is single-threaded and
    // owns the process, and the provisioner reads the variable on each call rather than caching.
    unsafe { std::env::set_var("BAY_DATA_DIR", &dir) };
    dir
}

fn enabled() -> bool {
    std::env::var("BAY_PROVISION_LIVE").is_ok_and(|value| value == "1")
}

#[test]
fn video_provisions_from_nothing_and_the_result_actually_runs() {
    if !enabled() {
        eprintln!("skipping: set BAY_PROVISION_LIVE=1 to run the real download");
        return;
    }
    let scratch = scratch_root("video");

    // Deliberately the *runtime directory* question, not `report()`'s. On a developer's Mac
    // report() answers "can this machine render", which is true via Homebrew before anything is
    // provisioned — a correct answer to a different question. What is under test here is
    // provisioning from an empty root.
    let root = scratch.join("runtime");
    let before = bay_provision::manifest::plan(
        bay_provision::Manifest::embedded(),
        "video",
        bay_provision::Target::CURRENT,
        &root,
        &|path| path.exists(),
    )
    .expect("video component");
    assert!(
        !before.satisfied && !before.unsupported,
        "the scratch root should start empty: {before:?}"
    );
    assert!(before.download_bytes > 0);

    let mut last = String::new();
    bay_provision::install_blocking("video", &Http::new(), &mut |progress| {
        if let Progress::Unpacking { artifact } | Progress::Downloading { artifact, .. } = &progress
            && *artifact != last
        {
            last = artifact.clone();
            eprintln!("  {artifact}");
        }
    })
    .expect("provisioning video must succeed");

    assert!(
        bay_provision::report().can_render(),
        "video must report installed afterwards"
    );

    // The claim is not "files landed" — it is that bay can now decode and export. So resolve
    // the tool the way the editor does, and run it.
    for tool in bay_paths::tools::Tool::all() {
        let found = bay_paths::tools::status(tool)
            .unwrap_or_else(|error| panic!("{tool} must resolve after provisioning: {error}"));
        assert_eq!(
            found.via,
            bay_paths::tools::Via::Managed,
            "{tool} should resolve to the copy bay installed, not a system one"
        );
        assert!(
            found.path.starts_with(&scratch),
            "{tool} resolved outside the scratch root: {:?}",
            found.path
        );
        let output = std::process::Command::new(&found.path)
            .arg("-version")
            .output()
            .unwrap_or_else(|error| panic!("running the provisioned {tool} failed: {error}"));
        assert!(output.status.success(), "{tool} -version exited non-zero");
        let banner = String::from_utf8_lossy(&output.stdout);
        assert!(
            banner.contains(tool.binary()),
            "{tool} printed something unexpected: {banner}"
        );
    }

    // Re-running must be a no-op rather than a second download.
    bay_provision::install_blocking("video", &Http::new(), &mut |_| {})
        .expect("a second install is a no-op");

    let _ = std::fs::remove_dir_all(&scratch);
}

/// The 1.2 GB half. Separate because it is slow enough that someone may reasonably want the
/// video test alone: `BAY_PROVISION_LIVE=1 cargo test -p bay-provision video_provisions`.
#[test]
fn speech_provisions_a_python_that_can_import_kokoro() {
    if !enabled() || std::env::var("BAY_PROVISION_LIVE_SPEECH").is_err() {
        eprintln!("skipping: set BAY_PROVISION_LIVE=1 and BAY_PROVISION_LIVE_SPEECH=1 (~1.2 GB)");
        return;
    }
    let scratch = scratch_root("speech");

    bay_provision::install_blocking("speech", &Http::new(), &mut |progress| {
        if let Progress::Step { detail, .. } = &progress {
            eprintln!("  {detail}");
        }
    })
    .expect("provisioning speech must succeed");

    let manifest = bay_provision::Manifest::embedded();
    assert!(
        bay_provision::speech::venv_is_ready(&scratch.join("runtime"), &manifest.kokoro_venv),
        "the venv must import kokoro, not merely exist"
    );

    // The weights, which used to be the hidden second phase: the progress bar finished and then
    // the first narrate silently pulled ~339 MB inside one blocking call. Asserting the venv
    // imports kokoro says nothing about whether they arrived, which is why this test could pass
    // for months while that download was completely unreported.
    let models = scratch.join("runtime").join("models").join("kokoro");
    assert!(
        models.join("kokoro-v1_0.pth").is_file(),
        "the model itself must be on disk after installing speech, not fetched at speak time"
    );
    assert!(
        models.join("config.json").is_file(),
        "the model config must be on disk"
    );
    let voices = std::fs::read_dir(models.join("voices"))
        .map(|entries| entries.flatten().count())
        .unwrap_or(0);
    assert_eq!(
        voices, 54,
        "every voice the sidecar advertises must be installed, found {voices}"
    );

    let after = bay_provision::report();
    assert!(
        after.component("speech").is_some_and(|plan| plan.satisfied),
        "speech must report installed afterwards"
    );

    let _ = std::fs::remove_dir_all(&scratch);
}
