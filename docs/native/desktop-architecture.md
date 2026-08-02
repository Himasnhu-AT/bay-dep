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
- **Scene bar** — tabs per scene (active highlighted) + **＋ Scene**; click to switch.
- **Toolbar** — Save/Load (JSON), + Text, Delete, **Split**, Copy, Paste, Undo, Redo (disabled when N/A).
- **Media panel** — click a clip to add it to the timeline **at the playhead**.
- **Preview** — canvas size + live background color (placeholder until the compositor is wired).
- **Inspector** — selected clip's Name/Kind/Text with **−/+ steppers for Start and Duration**.
- **Timeline** — three lanes with element blocks: **click to select**, **drag to move**, a **playhead
  line**, and **transport** (Play/Pause + |◀ ◀1s 1s▶ ▶|) with a `playhead / duration` readout.
- **Playback** — Play animates the playhead in real time (stops at the end).
- **Keyboard** — Cmd+Z/Cmd+Shift+Z, Backspace/Delete, **s** (split), Space (play/pause), ←/→ (seek),
  Cmd+C/Cmd+V.
- **Save/Load** — `~/vii-project.json` (same serde wire format as the web app).
- Every edit flows through the engine's **command/undo** system.

## Roadmap toward feature parity with the web app
Done: shell, selection, undo/redo, playhead+transport+playback, drag-to-move, inspector editing,
media→timeline, split, multi-scene, save/load, keyboard shortcuts.

Done (this session): **compositor preview** — `opencut-preview` renders the scene through the real
wgpu `Compositor` and reads it back to a BGRA buffer that GPUI displays as a `RenderImage`. This is
the **`P0-GPU-04` GO decision via a CPU-readback path** — real compositing (background, transform,
opacity, blend) shows in the window today; clip textures are solid-color placeholders until media
decode lands, and the readback can later be replaced by zero-copy blade↔wgpu without changing callers.

Remaining (larger / partly gated):
1. **Decoded frames in the preview** — feed real video/text textures (needs media decode + text
   raster); and optionally the zero-copy interop to drop the per-frame readback.
2. **Media decode** — native ffmpeg/gstreamer (`P0-MED-01`) so clips carry real frames/audio.
3. **Direct manipulation, part 2** — drag clip **edges to trim**, timeline zoom/scroll, snapping.
4. **Effects / masks / animation / motion-preset UI** — extend the element model + inspector.
5. **Text editing** — inline text input (GPUI text field) for the Name/Text fields.
6. **Export** — drive the compositor over the timeline to an encoded file.
7. **Audio** — waveform display + mixed playback.

## Tests
- `opencut-project`: model invariants + JSON round-trip (`tests/model.rs`).
- `opencut-core`: every command, reversible undo/redo, paste, selectionOverride, one-event-per-command
  (`tests/editor.rs`).
- `opencut-ui`: `view_model` mapping (selection → inspector, tracks → rows, undo availability).
- The binary is smoke-launched to confirm the window boots without panicking.
