//! Frame timing for the live window, because `bay-bench` cannot see in here.
//!
//! `bay-bench` measures the engine on a real clock and found it clear: a 1080p clip composites,
//! decode included, in 0.46 ms p50. That leaves the GPU→CPU→GPU hop into GPUI — the readback,
//! the per-frame atlas tile, the upload — as the only place a lag can be hiding, and none of it
//! is reachable from a headless harness. This is the probe that reaches it.
//!
//! ```text
//! BAY_UI_FRAMETIME=1 ./run.sh          # RELEASE=1 for a number worth reading
//! ```
//!
//! Off unless the variable is set, so nothing is timed and nothing is printed in a normal run.
//!
//! # Why percentiles, again
//!
//! Same reason `bay-bench` reports them: judder is a tail. A render loop averaging 8 ms that
//! stalls to 60 ms twice a second is flawless in a mean and visibly broken on screen. Every
//! report here is p50/p95/p99/max over the last window of frames.

use std::cell::RefCell;
use std::time::{Duration, Instant};

/// How many frames go into one report.
const WINDOW: usize = 120;
/// Report anyway after this long, if anything at all was recorded.
///
/// Without this the probe is useless on an idle editor: GPUI only renders when something
/// changes, so a window sitting still never reaches `WINDOW` frames and never prints. The first
/// run of this tool produced no output at all for exactly that reason.
const REPORT_AFTER: Duration = Duration::from_secs(3);

/// Whether frame timing is switched on for this run.
pub fn enabled() -> bool {
    std::env::var("BAY_UI_FRAMETIME").is_ok_and(|value| value != "0" && !value.is_empty())
}

thread_local! {
    static SPANS: RefCell<Spans> = const { RefCell::new(Spans::new()) };
}

/// The two spans worth separating: the preview hop, and everything the editor's `render` does.
///
/// Kept apart because they suggest different fixes. If `preview` dominates, the cost is the
/// readback and the atlas, and the answer is `Window::paint_surface` with an IOSurface-backed
/// `CVPixelBuffer` — no atlas, no upload. If `render` dominates with `preview` small, the cost
/// is the element tree and the answer is somewhere else entirely.
struct Spans {
    preview: Vec<Duration>,
    render: Vec<Duration>,
    last_report: Option<Instant>,
}

impl Spans {
    const fn new() -> Self {
        Self {
            preview: Vec::new(),
            render: Vec::new(),
            last_report: None,
        }
    }
}

/// Record one `update_preview` — the collect, the `RenderImage`, the atlas hand-off.
pub fn record_preview(elapsed: Duration) {
    if !enabled() {
        return;
    }
    SPANS.with(|spans| spans.borrow_mut().preview.push(elapsed));
}

/// Record one whole `EditorView::render`, and report when the window fills.
pub fn record_render(elapsed: Duration) {
    if !enabled() {
        return;
    }
    SPANS.with(|spans| {
        let mut spans = spans.borrow_mut();
        spans.render.push(elapsed);
        let now = Instant::now();
        let due = spans
            .last_report
            .is_none_or(|last| now.duration_since(last) >= REPORT_AFTER);
        if spans.render.len() >= WINDOW || due {
            spans.last_report = Some(now);
            report(&mut spans);
        }
    });
}

fn report(spans: &mut Spans) {
    let render = summarise(&mut spans.render);
    let preview = summarise(&mut spans.preview);
    let frames = spans.render.len();
    eprintln!(
        "frametime over {} frames — render p50 {} p95 {} p99 {} max {}",
        frames,
        ms(render.0),
        ms(render.1),
        ms(render.2),
        ms(render.3)
    );
    if !spans.preview.is_empty() || preview.3 > Duration::ZERO {
        eprintln!(
            "                       preview hop p50 {} p95 {} p99 {} max {}",
            ms(preview.0),
            ms(preview.1),
            ms(preview.2),
            ms(preview.3)
        );
    }
    // 16.7 ms is one frame at 60 Hz. Said out loud so the number does not need interpreting.
    if render.2 > Duration::from_micros(16_667) {
        eprintln!("                       p99 misses the 60 fps budget (16.67 ms)");
    }
    spans.render.clear();
    spans.preview.clear();
}

/// (p50, p95, p99, max) over `samples`, which this sorts in place.
fn summarise(samples: &mut [Duration]) -> (Duration, Duration, Duration, Duration) {
    if samples.is_empty() {
        return (
            Duration::ZERO,
            Duration::ZERO,
            Duration::ZERO,
            Duration::ZERO,
        );
    }
    samples.sort_unstable();
    (
        percentile(samples, 0.50),
        percentile(samples, 0.95),
        percentile(samples, 0.99),
        *samples.last().expect("non-empty"),
    )
}

fn percentile(sorted: &[Duration], fraction: f64) -> Duration {
    let rank = (fraction * sorted.len() as f64).ceil() as usize;
    sorted[rank.saturating_sub(1).min(sorted.len() - 1)]
}

fn ms(duration: Duration) -> String {
    format!("{:.2}ms", duration.as_secs_f64() * 1000.0)
}

/// Time `body`, hand the elapsed span to `record`, and return whatever `body` returned.
///
/// The closure runs whether timing is on or not; only the `Instant` calls are skipped, so a
/// normal run pays nothing for this existing.
pub fn timed<T>(record: fn(Duration), body: impl FnOnce() -> T) -> T {
    if !enabled() {
        return body();
    }
    let started = Instant::now();
    let value = body();
    record(started.elapsed());
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentiles_are_nearest_rank_and_never_index_out_of_bounds() {
        let mut one = [Duration::from_millis(5)];
        assert_eq!(summarise(&mut one).0, Duration::from_millis(5));
        assert_eq!(summarise(&mut one).3, Duration::from_millis(5));

        let mut ten: Vec<Duration> = (1..=10).map(Duration::from_millis).collect();
        let (p50, p95, p99, max) = summarise(&mut ten);
        assert_eq!(p50, Duration::from_millis(5));
        assert_eq!(p95, Duration::from_millis(10));
        assert_eq!(p99, Duration::from_millis(10));
        assert_eq!(max, Duration::from_millis(10));
    }

    /// An empty window must report zeroes rather than panic. `preview` is empty on any frame
    /// where no composite was collected, which is most of them when nothing is playing.
    #[test]
    fn an_empty_window_is_zero_rather_than_a_panic() {
        let mut none: [Duration; 0] = [];
        assert_eq!(
            summarise(&mut none),
            (
                Duration::ZERO,
                Duration::ZERO,
                Duration::ZERO,
                Duration::ZERO
            )
        );
    }

    /// The tail is what this exists to show — but know *which* tail.
    ///
    /// Nearest-rank p99 over N samples is the ⌈0.99N⌉-th value, so over a 100-frame window a
    /// **single** stall is the 100th value and shows up in `max`, not in p99. This test asserted
    /// otherwise and failed, which is the useful kind of failure: it means anyone reading a
    /// report has to know that one stall per window hides behind `max`, and that p99 only starts
    /// speaking when stalls are upwards of 1% of frames. Both cases are pinned below.
    #[test]
    fn a_lone_stall_lands_in_max_and_leaves_p50_alone() {
        let mut samples: Vec<Duration> = std::iter::repeat_n(Duration::from_millis(4), 99)
            .chain(std::iter::once(Duration::from_millis(60)))
            .collect();
        let (p50, _, p99, max) = summarise(&mut samples);
        assert_eq!(
            p50,
            Duration::from_millis(4),
            "the average frame is still fast"
        );
        assert_eq!(
            p99,
            Duration::from_millis(4),
            "one stall in a hundred is the 100th value, so p99 does not see it"
        );
        assert_eq!(
            max,
            Duration::from_millis(60),
            "but max does, which is why max is printed"
        );
    }

    /// Two stalls in a hundred *are* 2% of frames, so p99 must report one.
    ///
    /// This is the case that matters in practice: judder you can see is not one frame in a
    /// window, it is a steady fraction of them.
    #[test]
    fn a_repeating_stall_shows_up_in_p99() {
        let mut samples: Vec<Duration> = std::iter::repeat_n(Duration::from_millis(4), 98)
            .chain(std::iter::repeat_n(Duration::from_millis(60), 2))
            .collect();
        let (p50, _, p99, _) = summarise(&mut samples);
        assert_eq!(p50, Duration::from_millis(4));
        assert_eq!(
            p99,
            Duration::from_millis(60),
            "2% of frames stalling is exactly what p99 exists to surface"
        );
    }
}
