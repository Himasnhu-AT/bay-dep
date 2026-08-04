//! `mix_stereo` throughput — the pure sample-summing loop behind preview and export audio.
//!
//! Reported as output frames per second; `docs/native/benchmarks.md` converts that to the number
//! the audio path actually cares about: seconds-of-audio mixed per second of CPU. Sources are
//! synthesised from an integer recurrence so the buffers are byte-identical on every machine —
//! no ffmpeg, no file IO, no RNG inside or around the measurement.

use std::time::Duration;

use criterion::{BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};
use opencut_audio::{AudioPcm, MixClip, mix_stereo};

const SAMPLE_RATE: u32 = 48_000;

/// Clip counts to sweep. 1 = a single clip (the memcpy-ish floor), 16 = a dense audio bed.
const CLIP_COUNTS: [usize; 3] = [1, 4, 16];
/// Output lengths to sweep, in seconds: a scrub-sized buffer and a realistic bounce.
const DURATIONS_SECS: [f64; 2] = [1.0, 10.0];

/// How many distinct sources the clips are drawn from. Fewer than `CLIP_COUNTS.max()` on purpose:
/// re-using one asset across several clips is the common timeline shape, and it keeps the fixture
/// small enough that the mix loop, not cache misses on setup data, is what we measure.
const SOURCE_COUNT: usize = 4;

/// A deterministic stereo source. The sample values come from a 32-bit LCG folded into [-1, 1),
/// which is reproducible across machines and compilers (integer maths only — no `sin`, whose last
/// bits are libm-dependent).
fn source(seconds: f64, seed: u32) -> AudioPcm {
    let frames = (seconds * f64::from(SAMPLE_RATE)).ceil() as usize;
    let mut state = seed.wrapping_mul(2_654_435_761).wrapping_add(1);
    let mut samples = Vec::with_capacity(frames * 2);
    for _ in 0..frames * 2 {
        state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        // Top 16 bits give a stable value; scaled to leave headroom so the mix rarely clamps.
        let unit = f32::from((state >> 16) as u16) / 65_536.0;
        samples.push((unit * 2.0 - 1.0) * 0.25);
    }
    AudioPcm {
        sample_rate: SAMPLE_RATE,
        channels: 2,
        samples,
    }
}

fn bench_mix_stereo(c: &mut Criterion) {
    let mut group = c.benchmark_group("mix_stereo");
    // The 16-clip / 10 s case is tens of milliseconds an iteration; criterion's default 100
    // samples would make a routine bench run take minutes for no extra signal.
    group.sample_size(20);
    group.warm_up_time(Duration::from_millis(500));
    group.measurement_time(Duration::from_secs(3));

    for total_secs in DURATIONS_SECS {
        // Sources outlive the longest clip so no clip runs off the end mid-measurement (an early
        // `break` in the mix loop would silently shorten the work being timed).
        let sources: Vec<AudioPcm> = (0..SOURCE_COUNT)
            .map(|i| source(total_secs + 2.0, i as u32 + 1))
            .collect();
        let out_frames = (total_secs * f64::from(SAMPLE_RATE)).ceil() as u64;

        for clips in CLIP_COUNTS {
            // Every clip spans the whole output — full overlap is the worst case and the one
            // that makes the per-clip cost visible.
            let mix: Vec<MixClip> = (0..clips)
                .map(|i| MixClip {
                    pcm: &sources[i % SOURCE_COUNT],
                    src_start_secs: (i % 8) as f64 * 0.125,
                    dst_start_secs: 0.0,
                    play_secs: total_secs,
                    volume: 1.0 / clips as f32,
                })
                .collect();

            group.throughput(Throughput::Elements(out_frames));
            group.bench_with_input(
                BenchmarkId::from_parameter(format!("{clips}clips/{total_secs}s")),
                &mix,
                |b, mix| b.iter(|| mix_stereo(mix, SAMPLE_RATE, total_secs)),
            );
        }
    }

    group.finish();
}

criterion_group!(benches, bench_mix_stereo);
criterion_main!(benches);
