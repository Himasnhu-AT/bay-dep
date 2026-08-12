//! Run `check` over a directory of real projects and print what it found.
//!
//! Round 1's five perceptual checks shipped without ever being computed against the video they
//! were written to catch, and all five passed it. This is the tool that makes that impossible
//! to repeat: point it at a folder of `.json` projects and it prints, for each one, the status,
//! the rollup of every code that fired, and the stats — which is what a claim like "fires once
//! on the failed project, silent on both predecessors" has to be measured with.
//!
//! ```sh
//! BAY_CHECK_CORPUS="$HOME/Library/Application Support/vii/projects" \
//!   cargo test -p bay-core --test corpus -- --nocapture
//! ```
//!
//! **Off by default and env-gated**, deliberately: a test that reads a folder on one machine is
//! a test that fails for reasons outside the repository, and those teach people to re-run until
//! green. With the variable unset this says what it did not do and stops.
//!
//! **This is the exploratory half, and it is not the measurement.** Five gating codes shipped on
//! the strength of a run of this test on one laptop, which continuous integration never
//! reproduced, because with the variable unset it prints "skipped" and passes. The measurement
//! lives in `fixtures.rs`, which asserts the exact rollup of every code against five projects
//! checked in under `tests/fixtures/` — including the two references — and always runs. Point
//! this at your library to find something new; pin what you find over there.

use std::path::PathBuf;

#[test]
fn check_runs_over_every_project_in_the_corpus() {
    let Some(dir) = std::env::var_os("BAY_CHECK_CORPUS").map(PathBuf::from) else {
        println!(
            "skipped: set BAY_CHECK_CORPUS to a directory of project .json files to measure \
             check against real work"
        );
        return;
    };

    let mut paths: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("BAY_CHECK_CORPUS {}: {e}", dir.display()))
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    paths.sort();
    assert!(!paths.is_empty(), "no .json projects in {}", dir.display());

    for path in paths {
        let project = match bay_project::library::read_project(&path) {
            Ok(project) => project,
            // A project this build cannot deserialize is the loudest possible finding, and the
            // wire format is pinned by round-trip tests elsewhere; say so and keep going so one
            // bad file does not hide the rest of the corpus.
            Err(error) => {
                println!("{}: DID NOT LOAD — {error}", path.display());
                continue;
            }
        };
        let started = std::time::Instant::now();
        let report = bay_core::check(&project);
        let elapsed = started.elapsed();
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        println!(
            "\n=== {name}  ({:?}, {} findings of {}, {} errors, {:?})",
            report.status,
            report.findings.len(),
            report.total,
            report.errors,
            elapsed,
        );
        println!(
            "    elements {} authored / {} tool, opacity share {:.2}, ink hook {:.4} median \
             {:.4}, ground {:?}, {:.1}s",
            report.stats.authored_elements,
            report.stats.tool_elements,
            report.stats.authored_opacity_share,
            report.stats.hook_ink,
            report.stats.median_frame_ink,
            report.stats.ground,
            report.stats.duration_seconds,
        );
        // The addressing scheme every per-beat finding is stated in. Printed because a beat index
        // in a message is unreadable without it, and because the derivation that fires is the
        // first thing to argue with when a per-beat check says something surprising.
        println!(
            "    beats {} ({}): {:?}",
            report.stats.beats.starts.len(),
            report.stats.beats.derivation,
            report
                .stats
                .beats
                .starts
                .iter()
                .map(|at| format!("{at:.1}"))
                .collect::<Vec<_>>(),
        );
        // The mix, in the unit a mix is specified in. Printed unconditionally because the two
        // numbers that decide whether a narrated video has a contour are absent from every
        // finding when it passes, and "what did it measure" is the first question about a
        // threshold either way.
        let mix = &report.stats.mix;
        println!(
            "    mix: lines {:?} gaps {:?} bed-in-gaps {:?} separation {:?} LU (authored {:?}), \
             peak at {:?}s payoff {:?} together {:?}{}",
            mix.narration_lufs,
            mix.gap_lufs,
            mix.gap_bed_lufs,
            mix.separation_lu,
            mix.authored_lufs,
            mix.peak_at_seconds,
            mix.payoff_at_seconds,
            mix.peak_at_payoff,
            if mix.unmeasured.is_empty() {
                String::new()
            } else {
                format!(" — unmeasured: {}", mix.unmeasured.join(", "))
            },
        );
        for (code, count) in &report.rollup {
            println!("    {count:>4}  {code}");
        }
        for skip in &report.skipped {
            println!("    SKIPPED {} — {}", skip.code, skip.reason);
        }
        for found in report
            .findings
            .iter()
            .filter(|f| f.severity == bay_core::Severity::Error)
        {
            println!("    ERROR {}: {}", found.code, found.message);
        }
    }
}
