//! Capability gating for the workspace's integration tests (T-002).
//!
//! Two rules, one switch:
//!
//! * By default a missing capability **skips** — `eprintln!("skipping: …")` and the test
//!   returns early. A laptop without ffmpeg, or a CI box without a GPU, still gets a green
//!   suite instead of noise it cannot act on.
//! * With `VII_REQUIRE_GPU` / `VII_REQUIRE_FFMPEG` set, that same absence **panics**. This is
//!   what CI sets on a runner it deliberately provisioned, so the runner can never quietly
//!   stop exercising the GPU and keep reporting success.
//!
//! Every gate funnels through [`gate`], which takes `required` as an argument rather than
//! reading the environment itself. That is what makes the panic path unit-testable: mutating
//! process env is `unsafe` in edition 2024 and races the test harness's threads, so the tests
//! inject the flag instead of setting it.

use std::process::Command;

/// A capability an integration test can depend on. Each maps to one `VII_REQUIRE_*` var.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Capability {
    Gpu,
    Ffmpeg,
}

impl Capability {
    /// The environment variable that promotes a skip of this capability into a failure.
    pub const fn env_var(self) -> &'static str {
        match self {
            Capability::Gpu => "VII_REQUIRE_GPU",
            Capability::Ffmpeg => "VII_REQUIRE_FFMPEG",
        }
    }

    /// Short human name used in panic messages.
    pub const fn label(self) -> &'static str {
        match self {
            Capability::Gpu => "GPU",
            Capability::Ffmpeg => "ffmpeg",
        }
    }

    /// Has the environment declared this capability mandatory?
    pub fn is_required(self) -> bool {
        env_flag(self.env_var())
    }
}

fn env_flag(name: &str) -> bool {
    flag_value(std::env::var(name).ok().as_deref())
}

/// `VII_REQUIRE_*` is a flag, not a value: any non-empty setting turns it on, except the
/// usual "explicitly off" spellings so `VII_REQUIRE_GPU=0` in a shell profile means off.
/// Split out from [`env_flag`] so the parse is testable without mutating process env.
pub fn flag_value(raw: Option<&str>) -> bool {
    match raw {
        Some(raw) => {
            let value = raw.trim();
            !value.is_empty() && value != "0" && !value.eq_ignore_ascii_case("false")
        }
        None => false,
    }
}

/// The single decision point. `probe` carries the capability's outcome (and, on the happy
/// path, whatever the test needs — a `GpuContext`, or `()`); `required` is injected so this
/// is testable without touching process-global env.
///
/// Returns `Some(value)` when the capability is present, `None` after printing a skip line,
/// and panics when the capability is absent but the environment demanded it.
pub fn gate<T>(cap: Capability, probe: Result<T, String>, required: bool) -> Option<T> {
    match probe {
        Ok(value) => Some(value),
        Err(reason) => {
            if required {
                panic!(
                    "{} is required ({} is set) but unavailable: {reason}",
                    cap.label(),
                    cap.env_var()
                );
            }
            eprintln!("skipping: {reason}");
            None
        }
    }
}

/// [`gate`] against the real environment. Prefer the `require_*` helpers below; reach for
/// this directly only when a test probes a capability in some way they do not cover.
pub fn require<T>(cap: Capability, probe: Result<T, String>) -> Option<T> {
    gate(cap, probe, cap.is_required())
}

// ---------------------------------------------------------------------------------------
// GPU
// ---------------------------------------------------------------------------------------

/// A real GPU device, or `None` after skipping. `Option` (not `Result`) so call sites read
/// `let Some(ctx) = require_gpu() else { return };`.
#[cfg(feature = "gpu")]
pub fn require_gpu() -> Option<gpu::GpuContext> {
    require(Capability::Gpu, probe_gpu())
}

/// Is a GPU adapter reachable? Probes without gating — for reporting, not for skipping.
#[cfg(feature = "gpu")]
pub fn gpu_available() -> bool {
    probe_gpu().is_ok()
}

#[cfg(feature = "gpu")]
fn probe_gpu() -> Result<gpu::GpuContext, String> {
    pollster::block_on(gpu::GpuContext::new())
        .map_err(|err| format!("no GPU adapter available ({err})"))
}

/// Gate a GPU-backed constructor that already returns `Option` (e.g. `PreviewRenderer::new`,
/// which swallows the adapter error). `what` names the thing being built so the skip line and
/// the panic both say which construction failed. Needs no wgpu dependency — the caller owns
/// the device — so it works from crates built without this crate's `gpu` feature.
pub fn require_gpu_backed<T>(what: &str, build: impl FnOnce() -> Option<T>) -> Option<T> {
    require(
        Capability::Gpu,
        build().ok_or_else(|| format!("no GPU adapter: could not create {what}")),
    )
}

// ---------------------------------------------------------------------------------------
// ffmpeg
// ---------------------------------------------------------------------------------------

/// Is the ffmpeg CLI on `PATH`, and does it run? Probes without gating.
pub fn ffmpeg_available() -> bool {
    ffmpeg_version_line().is_some()
}

/// The first line of `ffmpeg -version` (the build banner), or `None` when ffmpeg is missing
/// or unusable. Also the ffmpeg half of [`capability_report`].
pub fn ffmpeg_version_line() -> Option<String> {
    let output = Command::new("ffmpeg").arg("-version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().next().map(|line| line.trim().to_string())
}

/// `true` when ffmpeg is usable; otherwise skips (or panics under `VII_REQUIRE_FFMPEG`).
/// Call sites read `if !require_ffmpeg() { return; }`.
pub fn require_ffmpeg() -> bool {
    require(
        Capability::Ffmpeg,
        ffmpeg_version_line()
            .map(|_| ())
            .ok_or_else(|| "ffmpeg is not on PATH (or `ffmpeg -version` failed)".to_string()),
    )
    .is_some()
}

/// Gate a step ffmpeg was supposed to complete — generating a fixture, running an encode.
/// Separate from [`require_ffmpeg`] because "ffmpeg exists but this build cannot encode
/// h264" is a different fact from "ffmpeg is missing", and both should be able to fail loudly
/// under `VII_REQUIRE_FFMPEG`. `what` completes the sentence "ffmpeg could not …".
pub fn require_ffmpeg_step(ok: bool, what: &str) -> bool {
    let probe = if ok {
        Ok(())
    } else if ffmpeg_available() {
        // ffmpeg is there and still failed — a build/codec problem, not a missing binary.
        Err(format!("ffmpeg could not {what}"))
    } else {
        Err(format!("ffmpeg is not on PATH, so it could not {what}"))
    };
    require(Capability::Ffmpeg, probe).is_some()
}

// ---------------------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------------------

/// What this machine can actually do, as a printable block. Each capability-gated crate has a
/// `capability_report` test that prints this, so a confusing run can be explained by
/// re-running with `--nocapture` instead of guessing which adapter (or which ffmpeg) was used.
pub fn capability_report() -> String {
    let mut out = String::from("vii capability report\n");

    #[cfg(feature = "gpu")]
    match probe_gpu() {
        Ok(ctx) => {
            let info = ctx.adapter().get_info();
            // Metal leaves both driver fields empty; only name the driver when there is one.
            let driver = format!("{} {}", info.driver, info.driver_info);
            let driver = match driver.trim() {
                "" => String::new(),
                named => format!(", driver {named}"),
            };
            out.push_str(&format!(
                "  gpu:    {} — backend {:?}, type {:?}{driver}\n",
                info.name, info.backend, info.device_type
            ));
        }
        Err(reason) => out.push_str(&format!("  gpu:    unavailable — {reason}\n")),
    }
    #[cfg(not(feature = "gpu"))]
    out.push_str("  gpu:    not probed (test-support built without the `gpu` feature)\n");

    match ffmpeg_version_line() {
        Some(line) => out.push_str(&format!("  ffmpeg: {line}\n")),
        None => out.push_str("  ffmpeg: unavailable — not on PATH\n"),
    }

    out.push_str(&format!(
        "  required: {}={} {}={}\n",
        Capability::Gpu.env_var(),
        Capability::Gpu.is_required(),
        Capability::Ffmpeg.env_var(),
        Capability::Ffmpeg.is_required(),
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn present_capability_hands_the_value_through() {
        // Whether the capability is "required" is irrelevant when it is present.
        assert_eq!(gate(Capability::Gpu, Ok::<_, String>(7), false), Some(7));
        assert_eq!(gate(Capability::Gpu, Ok::<_, String>(7), true), Some(7));
    }

    #[test]
    fn missing_capability_skips_when_not_required() {
        let skipped = gate(
            Capability::Ffmpeg,
            Err::<u8, _>("no ffmpeg".to_string()),
            false,
        );
        assert_eq!(
            skipped, None,
            "an unrequired capability must skip, not fail"
        );
    }

    #[test]
    #[should_panic(expected = "VII_REQUIRE_GPU")]
    fn missing_gpu_panics_when_required() {
        gate(
            Capability::Gpu,
            Err::<u8, _>("no adapter".to_string()),
            true,
        );
    }

    #[test]
    #[should_panic(expected = "ffmpeg could not encode")]
    fn missing_ffmpeg_panics_with_the_underlying_reason() {
        // The reason must survive into the panic message — "required but unavailable" alone
        // does not tell you whether ffmpeg was absent or merely could not do the job.
        gate(
            Capability::Ffmpeg,
            Err::<u8, _>("ffmpeg could not encode h264".to_string()),
            true,
        );
    }

    #[test]
    fn env_flag_reads_as_a_flag_not_a_value() {
        for on in ["1", "true", "yes", "  1  "] {
            assert!(flag_value(Some(on)), "{on:?} should enable");
        }
        for off in ["", "0", "false", "FALSE", "  "] {
            assert!(!flag_value(Some(off)), "{off:?} should not enable");
        }
        assert!(!flag_value(None), "unset should not enable");
    }

    #[test]
    fn env_var_names_are_the_documented_ones() {
        assert_eq!(Capability::Gpu.env_var(), "VII_REQUIRE_GPU");
        assert_eq!(Capability::Ffmpeg.env_var(), "VII_REQUIRE_FFMPEG");
    }

    #[test]
    fn require_gpu_backed_passes_a_built_value_through() {
        assert_eq!(require_gpu_backed("a widget", || Some(3)), Some(3));
    }

    #[test]
    fn require_ffmpeg_step_agrees_with_the_probe() {
        // A successful step is always accepted, regardless of VII_REQUIRE_FFMPEG.
        assert!(require_ffmpeg_step(true, "generate a tone"));
    }

    #[test]
    fn report_names_both_capabilities() {
        let report = capability_report();
        assert!(report.contains("gpu:"), "{report}");
        assert!(report.contains("ffmpeg:"), "{report}");
    }
}
