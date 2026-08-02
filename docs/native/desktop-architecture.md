# Native desktop editor — architecture

[Plan](plan.md) · [Phase 0 progress](phase-0-progress.md)

The native GPUI editor (`apps/desktop`, binary `opencut`) is built from small crates, each with a
single responsibility, so the domain model, the editing engine, and the UI evolve independently
and stay testable.

## Crate graph

```
apps/desktop (opencut-desktop)      thin binary — just `opencut_ui::run()`
        │
        ▼
opencut-ui        GPUI views: toolbar, media panel, preview, inspector, timeline.
        │         Renders state, turns interaction into Commands. Pure presentation
        │         mapping (view_model) is unit-tested without a window.
        ▼
opencut-core      the headless engine: owned Editor over EditorState (Project +
        │         selection + clipboard), serde-tagged Command enum, reversible
        │         ProjectPatch undo/redo, coalesced EventBus, Query API. No GPU/UI.
        ▼
opencut-project   pure data model: Project → Scene → Tracks → Element (+ settings,
        │         refs). serde only, no behavior.
        ▼
time              MediaTime (i64 ticks, 120 000/s) — shared with the compositor + wasm.
```

Rendering (Phase-0 crates, not yet wired into the GPUI window): `compositor` → `effects` /
`masks` → `gpu` (wgpu). Bridging the compositor's wgpu output into the GPUI (blade) window is the
open `P0-GPU-04` interop gate — see [phase-0-progress.md](phase-0-progress.md). Until then the
editor's preview pane is a placeholder.

## Responsibilities & rules

| Crate | Owns | Must not |
|-------|------|----------|
| `opencut-project` | data types + serde | no editing logic, no IO, no GPU |
| `opencut-core` | commands, undo/redo, events, queries | no GPU, no UI, no `Arc<RwLock>`/`RefCell` |
| `opencut-ui` | GPUI views + interaction → Command | no business rules (delegate to core) |
| `opencut-desktop` | window/app entry | nothing else |

- The UI **never mutates the project directly** — it dispatches a `Command` (undoable) or a
  direct `select` (non-undoable), then `cx.notify()` re-renders from fresh state.
- All presentation logic that doesn't need GPUI lives in `opencut-ui::view_model` (a pure
  `EditorViewModel::build(&Editor)`), so it is unit-tested without opening a window.

## What works today
- Native GPUI window with toolbar (**+ Text, Delete, Copy, Paste, Undo, Redo**), media panel,
  preview placeholder (canvas size + background color), inspector (selected clip properties), and a
  timeline rendering the three lanes (overlay/main/audio) with clickable element blocks.
- Click a block → selects it (inspector updates, block highlights). Toolbar edits go through the
  engine's command/undo system.
- Starter project loads content so the editor opens non-empty.

## Roadmap toward feature parity with the web app
1. **Live preview** — resolve `P0-GPU-04` (blade↔wgpu) and render the compositor into the preview
   pane; add a playhead + transport (play/pause/seek) driven by `MediaTime`.
2. **Direct manipulation** — drag to move/trim elements on the timeline; zoom/scroll; snapping.
3. **Media import** — native decode (ffmpeg/gstreamer, per `P0-MED-01`) feeding real clips.
4. **Inspector editing** — edit text/transform/opacity/effects; wire the effect + motion-preset
   systems from the web app.
5. **Persistence** — load/save the project JSON (already migration-compatible via `opencut-project`).
6. **Audio** — waveform display + playback (`P0-*` audio path).

## Tests
- `opencut-project`: model invariants + JSON round-trip (`tests/model.rs`).
- `opencut-core`: every command, reversible undo/redo, paste, selectionOverride, one-event-per-command
  (`tests/editor.rs`).
- `opencut-ui`: `view_model` mapping (selection → inspector, tracks → rows, undo availability).
- The binary is smoke-launched to confirm the window boots without panicking.
