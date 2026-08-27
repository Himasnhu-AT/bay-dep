//! `bay-bench` — the wall-clock harness for bay's pipeline.
//!
//! The three criterion suites (`bay-audio`, `bay-core`, `bay-project`) are deliberately pure CPU:
//! no GPU, no ffmpeg, no file IO, no clock. That is the right shape for mixing, commands and
//! serde, and the wrong shape for the question a user actually asks, which is *why does playback
//! judder*. This measures the pipeline instead, on a real device, against a real clock.
//!
//! # What it reports, and why percentiles
//!
//! Mean frame time is close to useless for judder. A loop that averages 8 ms but stalls to 60 ms
//! twice a second looks perfect in a mean and stutters visibly on screen. Every case here reports
//! **p50, p95, p99 and max**, and the verdict is taken from p99 — the frame you actually notice —
//! not from the average.
//!
//! # Honesty rules this follows
//!
//! - Without a GPU it **skips and says so**, and exits non-zero under `BAY_REQUIRE_GPU=1`. A skip
//!   is never printed as a pass.
//! - It refuses to report numbers from a debug build. Debug is roughly 30x slower here, which
//!   makes a debug timing worse than no timing: it looks like data and is not.
//! - Every number is labelled with the fixture and the frame size it was taken at. A preview
//!   figure at 640x360 says nothing about 4K, and the two have been confused before.

use std::time::{Duration, Instant};

use bay_preview::{CollectedFrame, PreviewRenderer};
use bay_project::{Element, MediaAsset, MediaTime, Project, Transform, VideoElement};

/// Frames measured per case, after the warmup.
const RUNS: usize = 120;
/// Frames discarded before measuring — first-frame cost is cache population, not steady state.
const WARMUP: usize = 10;
/// The preview size the editor actually composites at (`bay-ui`'s `PREVIEW_RENDER_W/H`).
const PREVIEW_W: u32 = 640;
const PREVIEW_H: u32 = 360;

fn main() {
    let strict = std::env::var("BAY_REQUIRE_GPU").as_deref() == Ok("1");

    if cfg!(debug_assertions) {
        eprintln!("bay-bench: refusing to measure a debug build — it is ~30x slower here, and a");
        eprintln!("           number from it looks like data without being any.");
        eprintln!("           cargo run --release -p bay-bench");
        std::process::exit(2);
    }

    println!("bay-bench — wall clock, release build");
    println!("fixture: Project::starter()   preview: {PREVIEW_W}x{PREVIEW_H}   runs: {RUNS}\n");

    let Some(mut renderer) = PreviewRenderer::new() else {
        eprintln!("SKIP: no GPU adapter, so there is no preview pipeline to measure.");
        eprintln!("      This is a skip, not a pass. BAY_REQUIRE_GPU=1 makes it an error.");
        std::process::exit(if strict { 1 } else { 0 });
    };

    let project = Project::starter();
    let mut results = Vec::new();

    results.push(bench_blocking(&mut renderer, &project));
    results.push(bench_pipelined(&mut renderer, &project));
    if let Some(case) = bench_real_clip(&mut renderer) {
        results.push(case);
    }

    println!(
        "{:<34} {:>9} {:>9} {:>9} {:>9}",
        "case", "p50", "p95", "p99", "max"
    );
    println!("{}", "-".repeat(74));
    for case in &results {
        println!(
            "{:<34} {:>9} {:>9} {:>9} {:>9}",
            case.name,
            ms(case.p50),
            ms(case.p95),
            ms(case.p99),
            ms(case.max)
        );
        if let Some((non_empty, total)) = case.with_content {
            let note = if non_empty == total {
                "every frame had picture on it"
            } else if non_empty == 0 {
                "!! EVERY FRAME WAS BLANK — this timing measures nothing being drawn"
            } else {
                "!! some frames were blank — the timing below is partly of empty frames"
            };
            println!(
                "{:<34} {} of {} frames painted — {}",
                "", non_empty, total, note
            );
        }
    }

    verdicts(&results);
}

/// One measured case.
struct Case {
    name: &'static str,
    p50: Duration,
    p95: Duration,
    p99: Duration,
    max: Duration,
    /// How many measured frames came back with more than one colour in them.
    ///
    /// Without this the harness measures how fast bay produces *nothing*. A decode that has not
    /// landed yet composites to a flat frame, which costs almost no time and looks like a great
    /// number. `bay-preview/tests/render.rs` carries the same warning about a test that once
    /// asserted only buffer length and passed with a missing file.
    with_content: Option<(usize, usize)>,
}

impl Case {
    fn from(name: &'static str, mut samples: Vec<Duration>) -> Self {
        samples.sort_unstable();
        Self {
            name,
            p50: percentile(&samples, 0.50),
            p95: percentile(&samples, 0.95),
            p99: percentile(&samples, 0.99),
            max: *samples.last().expect("at least one sample"),
            with_content: None,
        }
    }

    fn with_content(mut self, non_empty: usize, total: usize) -> Self {
        self.with_content = Some((non_empty, total));
        self
    }
}

/// Whether a composited frame has more than one colour in it.
///
/// A frame that is entirely one texel is a frame with nothing on it — the black the user sees
/// when a decode has not landed. Cheap: it stops at the first differing texel.
fn has_content(bgra: &[u8]) -> bool {
    let Some(first) = bgra.get(0..4) else {
        return false;
    };
    bgra.chunks_exact(4).any(|texel| texel != first)
}

/// A distinct playhead per iteration, so each frame is genuinely composited.
///
/// `from_seconds_f64` is fallible — it refuses a NaN or an out-of-range time. These values are
/// small positives, so the fallback is unreachable; it is written rather than unwrapped so a
/// benchmark can never be the thing that panics.
fn playhead_at(index: usize) -> MediaTime {
    MediaTime::from_seconds_f64(index as f64 * 0.033).unwrap_or(MediaTime::ZERO)
}

/// Nearest-rank percentile over an already-sorted slice.
fn percentile(sorted: &[Duration], fraction: f64) -> Duration {
    if sorted.is_empty() {
        return Duration::ZERO;
    }
    let rank = (fraction * sorted.len() as f64).ceil() as usize;
    sorted[rank.saturating_sub(1).min(sorted.len() - 1)]
}

fn ms(duration: Duration) -> String {
    format!("{:.2} ms", duration.as_secs_f64() * 1000.0)
}

/// `render()` — composite and read back on the calling thread, which is what the editor does
/// today when it needs a frame right now.
fn bench_blocking(renderer: &mut PreviewRenderer, project: &Project) -> Case {
    let mut samples = Vec::with_capacity(RUNS);
    for index in 0..(WARMUP + RUNS) {
        // Move the playhead so each frame is genuinely composited rather than served from the
        // signature cache — a benchmark of a cache hit is a benchmark of a comparison.
        let playhead = playhead_at(index);
        let started = Instant::now();
        let frame = renderer.render(
            project.active_scene(),
            playhead,
            PREVIEW_W,
            PREVIEW_H,
            &project.settings.background,
            &project.media,
        );
        let elapsed = started.elapsed();
        if index >= WARMUP && frame.is_some() {
            samples.push(elapsed);
        }
    }
    Case::from("preview render() blocking", samples)
}

/// `submit_composite` / `collect_composite` — the pipelined path, where the readback is polled
/// rather than waited on. This is the one playback should be using.
fn bench_pipelined(renderer: &mut PreviewRenderer, project: &Project) -> Case {
    let mut samples = Vec::with_capacity(RUNS);
    for index in 0..(WARMUP + RUNS) {
        let playhead = playhead_at(index);
        let started = Instant::now();
        renderer.submit_composite(
            project.active_scene(),
            playhead,
            PREVIEW_W,
            PREVIEW_H,
            &project.settings.background,
            &project.media,
        );
        // Spin until the frame lands. That wait is part of the frame's cost — pretending
        // otherwise would measure submission and call it frame time.
        while matches!(renderer.collect_composite(), CollectedFrame::Pending) {}
        let elapsed = started.elapsed();
        if index >= WARMUP {
            samples.push(elapsed);
        }
    }
    Case::from("preview pipelined submit+collect", samples)
}

/// A real file, with decode in the loop. The case that matters.
///
/// The two cases above composite `Project::starter()`, which is a title card: no decode, no
/// upload of a 1920x1080 frame, nothing that touches ffmpeg. They measure the compositor, and
/// the compositor was never the thing anyone complained about. This one steps a real clip at
/// 30 fps and pays for every frame the way playback does — `await_decodes` included, because a
/// frame that has not decoded yet is a frame the user sees as black.
///
/// Opt-in by path, because the harness must not depend on a file that is on one machine:
/// `BAY_BENCH_MEDIA=/path/to/clip.mp4 cargo run --release -p bay-bench`
fn bench_real_clip(renderer: &mut PreviewRenderer) -> Option<Case> {
    let Ok(path) = std::env::var("BAY_BENCH_MEDIA") else {
        println!("(skipping the real-clip case — set BAY_BENCH_MEDIA to a video file)\n");
        return None;
    };
    if !std::path::Path::new(&path).is_file() {
        eprintln!("SKIP: BAY_BENCH_MEDIA is not a file: {path}");
        return None;
    }

    let mut project = Project::starter();
    project
        .media
        .push(MediaAsset::new("bench-clip", "Bench", path.clone()));
    {
        let scene = project.active_scene_mut();
        // Only the clip on screen. The starter title would otherwise keep compositing whether
        // the decoder produced anything or not, and the number would flatter a broken decode.
        scene.tracks.overlay.clear();
        scene.tracks.main.elements.clear();
        scene
            .tracks
            .main
            .elements
            .push(Element::Video(VideoElement {
                id: "bench-vid".into(),
                name: "Bench".into(),
                start: MediaTime::ZERO,
                duration: MediaTime::from_ticks(600_000),
                fade_in: MediaTime::ZERO,
                fade_out: MediaTime::ZERO,
                media_id: "bench-clip".into(),
                trim_start: MediaTime::ZERO,
                trim_end: MediaTime::from_ticks(600_000),
                speed: 1.0,
                freeze: None,
                transform: Transform::default(),
                effects: Vec::new(),
                animations: Default::default(),
                blend_mode: Default::default(),
                mask: None,
                source: Default::default(),
                role: Default::default(),
            }));
    }

    println!("real clip: {path}\n");
    let mut samples = Vec::with_capacity(RUNS);
    let mut non_empty = 0usize;
    for index in 0..(WARMUP + RUNS) {
        // 30 fps of timeline, so the cache is asked for a genuinely different frame each time —
        // which is what scrubbing and playing both do, and what a per-clip cache must survive.
        let playhead = MediaTime::from_seconds_f64(index as f64 / 30.0).unwrap_or(MediaTime::ZERO);
        let started = Instant::now();
        renderer.await_decodes(project.active_scene(), &project.media);
        let mut painted = false;
        renderer.submit_composite(
            project.active_scene(),
            playhead,
            PREVIEW_W,
            PREVIEW_H,
            &project.settings.background,
            &project.media,
        );
        loop {
            match renderer.collect_composite() {
                CollectedFrame::Pending => continue,
                CollectedFrame::Ready(frame) => {
                    painted = has_content(&frame.bgra);
                    break;
                }
                _ => break,
            }
        }
        let elapsed = started.elapsed();
        if index >= WARMUP {
            samples.push(elapsed);
            if painted {
                non_empty += 1;
            }
        }
    }
    Some(Case::from("real clip: decode+composite @30fps", samples).with_content(non_empty, RUNS))
}

/// Turn the numbers into a statement about playback, which is the only reason to measure this.
///
/// 24 fps is the floor bay should hold for a preview; 60 fps is the target on a machine like
/// this one. The verdict reads p99, not the mean, because a dropped frame is what judder is.
fn verdicts(results: &[Case]) {
    const BUDGET_60: Duration = Duration::from_micros(16_667);
    const BUDGET_24: Duration = Duration::from_micros(41_667);

    println!("\nplayback budget (p99, the frame you notice — not the mean)");
    for case in results {
        let verdict = if case.p99 <= BUDGET_60 {
            "holds 60 fps"
        } else if case.p99 <= BUDGET_24 {
            "holds 24 fps, misses 60"
        } else {
            "MISSES 24 fps — this is visible judder"
        };
        println!("  {:<34} {}", case.name, verdict);
    }
    println!(
        "\nnote: this is the compositor alone on `Project::starter()`. It does not include video\n\
         decode, the GPU->CPU->GPU upload into the UI, or a real clip's frames. A green verdict\n\
         here with judder on screen means the cost is in one of those, not in the composite."
    );
}
