//! Command dispatch and undo/redo cost on a synthetic project with N elements.
//!
//! `Command::lower` resolves a reference by scanning the track, and `ProjectPatch::apply` scans
//! it again, so each of these is O(elements-in-track). Sweeping N is the point: a timeline drag
//! dispatches one `MoveElement` per mouse-move, so the slope of this curve is what decides
//! whether a 1000-clip project still drags at 60 fps.
//!
//! Each iteration runs a fixed batch of `BATCH` operations against a freshly built `Editor`,
//! constructed in criterion's untimed setup. Batching earns its keep twice: it amortises the
//! project clone that setup needs, and it holds the undo/redo stacks at a fixed depth instead of
//! letting them grow without bound across a measurement run.

use std::time::Duration;

use criterion::{BatchSize, BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};
use opencut_core::{Command, Editor, Element, ElementRef, MediaTime, Project};

/// Element counts to sweep.
const ELEMENT_COUNTS: [usize; 2] = [100, 1000];
/// Operations per timed iteration.
const BATCH: usize = 64;

const TICKS_PER_SECOND: i64 = 120_000;

fn secs(seconds: f64) -> MediaTime {
    MediaTime::from_ticks((seconds * TICKS_PER_SECOND as f64) as i64)
}

/// A deterministic project with `n` elements spread across the main, overlay, and audio lanes,
/// plus the refs addressing them.
///
/// Elements are cloned from the starter project and mutated through the public setters rather
/// than built from struct literals, so a new field on `Element` cannot leave this fixture
/// silently describing an older element shape.
fn synthetic_project(n: usize) -> (Project, Vec<ElementRef>) {
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

    let track_ids = ["track-main", "track-overlay", "track-audio"];
    let mut references = Vec::with_capacity(n);
    // Per-lane cursors keep every lane butt-joined and non-overlapping, the shape a real
    // timeline has.
    let mut cursor = [0.0f64; 3];

    for i in 0..n {
        let (lane, mut element) = match i % 4 {
            0 => (0usize, text_template.clone()),
            1 => (0usize, image_template.clone()),
            2 => (1usize, text_template.clone()),
            _ => (2usize, audio_template.clone()),
        };

        let id = format!("el-{i:06}");
        let duration = 1.0 + (i % 4) as f64 * 0.5;
        element.set_id(id.clone());
        element.set_name(format!("Element {i}"));
        element.set_start(secs(cursor[lane]));
        element.set_duration(secs(duration));
        cursor[lane] += duration;

        let track = match lane {
            0 => &mut scene.tracks.main,
            1 => &mut scene.tracks.overlay[0],
            _ => &mut scene.tracks.audio[0],
        };
        track.elements.push(element);
        references.push(ElementRef::new(track_ids[lane], id));
    }

    (project, references)
}

#[derive(Clone, Copy)]
enum Op {
    Move,
    Add,
}

impl Op {
    fn label(self) -> &'static str {
        match self {
            Op::Move => "move_element",
            Op::Add => "add_element",
        }
    }
}

/// A fresh element to append, cloned from an existing one so it tracks the real element shape.
fn new_element(project: &Project, index: usize) -> Element {
    let mut element = project.active_scene().tracks.main.elements[0].clone();
    element.set_id(format!("el-new-{index:06}"));
    element.set_name(format!("Added {index}"));
    // Past the end of every lane, so appended elements never overlap the fixture.
    element.set_start(secs(10_000.0 + index as f64));
    element.set_duration(secs(1.0));
    element
}

/// The `BATCH` commands one iteration executes. Built in setup and consumed by value in the
/// timed routine, so `Command`'s own clone cost stays out of the measurement.
fn batch_commands(project: &Project, references: &[ElementRef], op: Op) -> Vec<Command> {
    (0..BATCH)
        .map(|k| match op {
            // Stride the targets across the track so we measure the average scan rather than a
            // permanently cache-hot first element.
            Op::Move => Command::MoveElement {
                reference: references[(k * 7) % references.len()].clone(),
                start: secs(1000.0 + k as f64),
            },
            Op::Add => Command::AddElement {
                track_id: "track-main".to_string(),
                element: new_element(project, k),
                select: false,
            },
        })
        .collect()
}

fn bench_commands(c: &mut Criterion) {
    let mut group = c.benchmark_group("commands");
    group.warm_up_time(Duration::from_millis(500));
    group.measurement_time(Duration::from_secs(3));
    // One "element" = one command / undo / redo, so criterion reports operations per second.
    group.throughput(Throughput::Elements(BATCH as u64));

    for n in ELEMENT_COUNTS {
        let (project, references) = synthetic_project(n);

        for op in [Op::Move, Op::Add] {
            group.bench_function(BenchmarkId::new(op.label(), n), |b| {
                b.iter_batched(
                    || {
                        (
                            Editor::new(project.clone()),
                            batch_commands(&project, &references, op),
                        )
                    },
                    |(mut editor, commands)| {
                        for command in commands {
                            assert!(editor.execute(command), "command lowered to a no-op");
                        }
                    },
                    // Each input is a whole project; PerIteration avoids materialising a batch of
                    // them at once.
                    BatchSize::PerIteration,
                )
            });

            group.bench_function(BenchmarkId::new(format!("undo_{}", op.label()), n), |b| {
                b.iter_batched_ref(
                    || {
                        let mut editor = Editor::new(project.clone());
                        for command in batch_commands(&project, &references, op) {
                            editor.execute(command);
                        }
                        editor
                    },
                    |editor| {
                        for _ in 0..BATCH {
                            assert!(editor.undo(), "nothing left to undo");
                        }
                    },
                    BatchSize::PerIteration,
                )
            });

            group.bench_function(BenchmarkId::new(format!("redo_{}", op.label()), n), |b| {
                b.iter_batched_ref(
                    || {
                        let mut editor = Editor::new(project.clone());
                        for command in batch_commands(&project, &references, op) {
                            editor.execute(command);
                        }
                        for _ in 0..BATCH {
                            editor.undo();
                        }
                        editor
                    },
                    |editor| {
                        for _ in 0..BATCH {
                            assert!(editor.redo(), "nothing left to redo");
                        }
                    },
                    BatchSize::PerIteration,
                )
            });
        }
    }

    group.finish();
}

criterion_group!(benches, bench_commands);
criterion_main!(benches);
