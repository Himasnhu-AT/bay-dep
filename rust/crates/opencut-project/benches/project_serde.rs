//! Project JSON serialize / deserialize round-trip at N elements.
//!
//! This is the cost of every open, every save, and every autosave, so it is the number that
//! decides whether autosave can run on the UI thread. Measured on a deterministic synthetic
//! project (see `synthetic_project`) with no file IO — `serde_json` to and from a `String`.

use std::time::Duration;

use criterion::{BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};
use opencut_project::{AnimationChannel, Element, MediaTime, Project};

/// Element counts to sweep: a typical edit and a heavy one (the plan's 500-clip project sits
/// between them).
const ELEMENT_COUNTS: [usize; 3] = [100, 500, 1000];

const TICKS_PER_SECOND: i64 = 120_000;

fn secs(seconds: f64) -> MediaTime {
    MediaTime::from_ticks((seconds * TICKS_PER_SECOND as f64) as i64)
}

/// A deterministic project with `n` elements spread across the main, overlay, and audio lanes.
///
/// Elements are *cloned from the starter project's* text/image/audio elements and then mutated
/// through the public setters rather than built from struct literals. That keeps the benchmark
/// compiling — and, more importantly, keeps it measuring the *current* element shape — when a
/// field is added to `Element` (as `blend_mode` recently was), instead of going stale behind a
/// literal that has to be hand-updated.
///
/// Every third visual element carries an animation channel so the fixture is not a trivially
/// compressible run of identical records.
pub fn synthetic_project(n: usize) -> Project {
    let mut project = Project::starter();
    let (text_template, image_template, audio_template) = {
        let scene = project.active_scene();
        (
            scene.tracks.main.elements[0].clone(),
            scene.tracks.main.elements[1].clone(),
            scene.tracks.audio[0].elements[0].clone(),
        )
    };

    let scene = project.active_scene_mut();
    scene.tracks.main.elements.clear();
    scene.tracks.overlay[0].elements.clear();
    scene.tracks.audio[0].elements.clear();

    // Per-lane cursors keep every lane's elements butt-joined and non-overlapping, which is what
    // `assert_timeline_valid` demands of real projects.
    let mut cursor = [0.0f64; 3];
    for i in 0..n {
        let (lane, mut element) = match i % 4 {
            0 => (0usize, text_template.clone()),
            1 => (0usize, image_template.clone()),
            2 => (1usize, text_template.clone()),
            _ => (2usize, audio_template.clone()),
        };

        // Durations cycle through four values so starts are not a single arithmetic run.
        let duration = 1.0 + (i % 4) as f64 * 0.5;
        element.set_id(format!("el-{i:06}"));
        element.set_name(format!("Element {i}"));
        element.set_start(secs(cursor[lane]));
        element.set_duration(secs(duration));
        cursor[lane] += duration;

        if i % 3 == 0 {
            if let Some(animations) = element.animations_mut() {
                let mut opacity = AnimationChannel::default();
                opacity.upsert(MediaTime::ZERO, 0.0);
                opacity.upsert(secs(duration * 0.5), 1.0);
                opacity.upsert(secs(duration), 0.0);
                animations.insert("opacity".to_string(), opacity);
            }
        }

        let track = match lane {
            0 => &mut scene.tracks.main,
            1 => &mut scene.tracks.overlay[0],
            _ => &mut scene.tracks.audio[0],
        };
        track.elements.push(element);
    }

    project
}

fn element_count(project: &Project) -> usize {
    project
        .active_scene()
        .tracks
        .iter()
        .map(|track| track.elements.len())
        .sum()
}

fn bench_project_serde(c: &mut Criterion) {
    assert_roundtrip_is_lossless();

    let mut group = c.benchmark_group("project_serde");
    group.warm_up_time(Duration::from_millis(500));
    group.measurement_time(Duration::from_secs(3));

    for n in ELEMENT_COUNTS {
        let project = synthetic_project(n);
        assert_eq!(element_count(&project), n, "fixture lost elements");
        let json = serde_json::to_string(&project).expect("project serializes");

        // Bytes throughput makes the two directions directly comparable and independent of how
        // fat an individual element happens to be.
        group.throughput(Throughput::Bytes(json.len() as u64));

        group.bench_with_input(BenchmarkId::new("serialize", n), &project, |b, project| {
            b.iter(|| serde_json::to_string(project).expect("serialize"))
        });

        group.bench_with_input(BenchmarkId::new("deserialize", n), &json, |b, json| {
            b.iter(|| serde_json::from_str::<Project>(json).expect("deserialize"))
        });

        group.bench_with_input(BenchmarkId::new("roundtrip", n), &project, |b, project| {
            b.iter(|| {
                let text = serde_json::to_string(project).expect("serialize");
                serde_json::from_str::<Project>(&text).expect("deserialize")
            })
        });
    }

    group.finish();
}

/// The round-trip must be lossless, or the benchmark is timing a shortcut rather than a save.
fn assert_roundtrip_is_lossless() {
    let project = synthetic_project(64);
    let json = serde_json::to_string(&project).expect("serialize");
    let decoded: Project = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(project, decoded, "project JSON round-trip is lossy");
    assert!(
        matches!(decoded.active_scene().tracks.main.elements.first(), Some(e) if e.animations().is_some_and(|a| a.contains_key("opacity"))),
        "fixture lost its animation channels"
    );
    assert!(
        decoded
            .active_scene()
            .tracks
            .iter()
            .any(|t| t.elements.iter().any(|e| matches!(e, Element::Audio(_)))),
        "fixture lost its audio elements"
    );
}

criterion_group!(benches, bench_project_serde);
criterion_main!(benches);
