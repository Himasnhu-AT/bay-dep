//! One drag, one undo entry.
//!
//! A slider calls `on_change` on every pointer sample — `controls.rs` says so explicitly — so a
//! control wired straight to `editor.execute` pushes one history entry per sample. At 120 Hz that
//! is a hundred-odd entries for one movement of one fader, and backing it out takes a hundred
//! presses of Cmd+Z. The memory is the smaller half of the problem; undo being useless exactly
//! where a continuous control needs it is the larger one.
//!
//! This lived inside `motion.rs`, which is why the Motion page coalesced and the Audio page did
//! not. It is not a Motion idea — it belongs to any continuous control — so it lives here and
//! both pages use it.
//!
//! The callback that owns a `Gesture` is captured once, when the drag begins (`controls.rs`
//! stores it in the `ValueDrag` and clones it for every later sample), so the same `Gesture`
//! sees the whole drag even though the element tree is rebuilt around it every frame. That is
//! load-bearing: a `Gesture` created per render would count zero steps forever and coalesce
//! nothing.

use super::EditorView;
use std::cell::Cell;
use std::hash::{Hash, Hasher};

/// Collapses a drag's stream of commands into a single undo entry.
///
/// Every widget on this page reports a value on **every** pointer move, because a curve that
/// only updates when you let go is a curve you cannot aim. Each of those is a `Command`, and
/// `bay-core` pushes one history entry per command with no coalescing anywhere — so a two
/// hundred pixel drag would take two hundred presses of ⌘Z to reverse, which is the same as
/// having no undo.
///
/// So before writing its next state, a gesture undoes the one it wrote last. The drag ends
/// having left exactly one entry, holding the difference between where the key started and where
/// it was dropped.
///
/// **The guard is the part that matters.** An agent edit can land between two mouse-move events,
/// and an unguarded undo would take *that* entry rather than this gesture's. So the gesture
/// fingerprints what it wrote and refuses to undo anything that no longer matches; the cost of
/// refusing is one extra undo entry, which is the harmless direction to fail in.
pub(super) struct Gesture {
    /// How many commands this gesture's last step committed. Zero before its first.
    steps: Cell<u8>,
    /// A fingerprint of the edited thing as this gesture left it.
    fingerprint: Cell<u64>,
}

impl Gesture {
    pub(super) fn new() -> Self {
        Self {
            steps: Cell::new(0),
            fingerprint: Cell::new(0),
        }
    }

    /// Roll back this gesture's previous step (if it is still the top of history) and run the
    /// next one. `run` returns how many commands it actually committed.
    pub(super) fn commit(
        &self,
        view: &mut EditorView,
        probe: impl Fn(&EditorView) -> u64,
        run: impl FnOnce(&mut EditorView) -> u8,
    ) {
        let steps = self.steps.get();
        if steps > 0 {
            if probe(view) == self.fingerprint.get() {
                for _ in 0..steps {
                    view.editor.undo();
                }
            }
            self.steps.set(0);
        }
        let steps = run(view);
        self.steps.set(steps);
        self.fingerprint.set(probe(view));
    }
}

/// A cheap content fingerprint.
///
/// The wire format rather than `Hash`, because the model is full of `f32` and does not implement
/// it — and that format is pinned by round-trip tests, so this number changes exactly when the
/// document does. `None` is a fingerprint that matches nothing, which is the safe direction: the
/// gesture then starts a fresh undo entry rather than undoing somebody else's.
pub(super) fn fingerprint(json: Result<String, serde_json::Error>) -> u64 {
    let Ok(json) = json else {
        return 0;
    };
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    json.hash(&mut hasher);
    // Zero is reserved for "nothing to compare", so a real document never reports it.
    hasher.finish() | 1
}
