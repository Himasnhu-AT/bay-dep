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

Done: **compositor preview with real decoded media + export**.
- `opencut-preview` renders the scene through the real wgpu `Compositor` and reads it back to BGRA,
  displayed by GPUI as a `RenderImage` (the **`P0-GPU-04` GO decision, CPU-readback path**).
- **Real textures:** text via `opencut-text` (cosmic-text), images via the `image` crate, video
  frames via the **ffmpeg CLI sidecar** (`-ss T -frames:v 1 -f rawvideo`). Effects (brightness) run
  on the layers. Media import (`rfd` file dialog) adds image/video clips.
- **Export:** still frame → PNG, and the whole timeline → MP4 (render each frame → pipe raw RGBA to
  ffmpeg encode). All ffmpeg-free to build (sidecar, not linked).

Also done: **keyframe animation** (transform/opacity over time, interpolated, live in the preview),
**motion presets** (save/apply effects+animations), **audio waveforms** + **audio playback** (rodio,
`opencut-audio` decodes via ffmpeg), **fast video playback** (whole-clip decode cached, indexed by
time), and **inline text editing** (a "TextEdit" key-context suppresses shortcuts while typing).

The native editor now covers the website's feature surface: import (image/video/audio), timeline
edit (move/trim/split/duplicate/zoom), transform/effects/keyframes/presets, inline text, scenes,
real decoded compositor preview, audio waveform + playback, and export (still PNG + timeline MP4).

### Optimizations done since feature parity
- **Effect library** — `contrast`, `saturation`, and separable-gaussian `blur` join `brightness`
  (one shader + one pack arm each in `effects`); the inspector adds any of the four.
- **Hardware decode** — the video sidecar runs `-hwaccel auto` (VideoToolbox on macOS, automatic
  software fallback).
- **Preview hot path** — text textures are cached by content/style (bounded LRU) so static captions
  aren't re-shaped through cosmic-text every frame; the readback now reads the compositor's
  **native BGRA** order directly (`read_texture_bgra`), dropping two cancelling full-buffer channel
  swizzles per frame on Metal.
- **Multi-clip audio mixing** — `opencut_audio::mix_stereo` (pure, unit-tested) sums every non-muted
  audio clip sounding at/after the playhead into one buffer; playback was previously first-clip-only.

### The one remaining item: true zero-copy preview (`P0-GPU-04`)
The preview still does a CPU readback (now native-order, no swizzle) before GPUI displays it as a
`RenderImage`. Fully zero-copy would render the compositor into an **IOSurface-backed** texture and
hand GPUI the `CVPixelBuffer` via its `surface()` element. That path is **blocked by wgpu 29**: its
Metal hal exposes `Texture::raw_handle()` (export the `MTLTexture`) but **no `texture_from_raw`** to
*import* an external IOSurface-backed one, so the compositor cannot render straight into a
GPUI-shared surface. The only workaround is a raw-Metal blit (compositor texture → IOSurface texture
via `MTLBlitCommandEncoder` on wgpu's device, then wrap as a `CVPixelBuffer`) — a sizeable,
macOS-only unsafe interop across `wgpu-hal`/`objc2-metal`/`io-surface`/`core-video` with a
cross-device (wgpu vs. GPUI/blade) synchronization hazard. It is a deliberate, self-contained spike
whose payoff is latency only, so it is deferred rather than half-built.

## Tests
- `opencut-project`: model invariants + JSON round-trip (`tests/model.rs`).
- `opencut-core`: every command, reversible undo/redo, paste, selectionOverride, one-event-per-command
  (`tests/editor.rs`).
- `opencut-ui`: `view_model` mapping (selection → inspector, tracks → rows, undo availability).
- The binary is smoke-launched to confirm the window boots without panicking.
