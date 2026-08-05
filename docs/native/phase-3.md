# Phase 3 — GPUI UI shell (timeline / preview / inspector / asset browser)

[← Phase 2](phase-2.md) · [Plan](plan.md) · [Tasks](task.md) · [Phase 4 →](phase-4.md)

**Estimated duration:** 6-9 months · **Tasks:** 27

## Goal
Wrap the headless core in a native GPUI application: embed the native wgpu preview surface (or the Tauri fallback if the Phase 0 gate said NO-GO), rewrite the *.tsx/controllers/hooks as thin GPUI adapters over the already-native pure kernels, and deliver feature parity for the core editing loop — live preview with transform/mask handles, timeline drag/resize/seek/zoom, data-driven inspector + graph editor, asset browser + stickers/sounds/subtitles libraries, actions/keybindings, guides, a11y (AccessKit), and IME. Real-time cpal audio playback + A/V sync is validated here.

## ✅ Exit gate (must all pass to advance)
- [ ] GPUI HEALTH GATE: the shell renders live preview via the native wgpu surface at interactive rates, timeline editing (drag/resize/seek/zoom) drives the core with correct undo, inspector edits params, asset browser imports media, a11y tree present, IME works — OR the Tauri fallback delivers the same on the same core
- [ ] Real-time playback is A/V-synced with no underruns; graph editor, effects/masks panels, stickers/sounds/subtitles libraries, and actions/keybindings all functional
- [ ] Feature parity with the web editor for the core editing loop, validated against the golden-tested kernels the UI drives

## Test strategy for this phase
The heavy decision math already has kernel goldens from Phase 1, so UI work is validated by integration tests that simulate GPUI pointer/keyboard sequences and assert the resulting model equals the kernel output for the same coordinates — the UI is proven against known-good decisions, not reimplemented blindly. Manual QA covers feel-sensitive behaviors (zoom anchor, edge auto-scroll, playback sync, IME). a11y is checked via AccessKit tree assertions.

## Deliverables
- GPUI application shell with an embedded native wgpu preview surface (or the Tauri fallback on the same core)
- Live preview with transform/mask handles, WYSIWYG text overlay, snap guides, and grid/safe-area overlays
- Timeline UI with interaction controllers rewritten as thin adapters over the pure kernels, waveforms, and bookmarks
- Data-driven inspector, bezier graph editor, effects/masks browse panels
- Asset browser + stickers/sounds/subtitles libraries; actions/keybindings + shortcuts help
- Real-time cpal playback with validated A/V sync; a11y (AccessKit) + IME; per-OS dev bundles

## Workstreams & tasks

### Workstream: Shell foundation

#### `P3-SHELL-01` — GPUI app skeleton + Models wired to EventBus
GPUI window/app, entities/Models subscribing to the coalesced EventBus per domain (the shallow-equality memoization moves here from the TS selector layer); all state reads go through the CoreHandle.

> **Test gate:** Manual+unit: a domain mutation re-renders only dependent Models; app boots against a fixture project.

#### `P3-SHELL-02` — Native wgpu preview surface embed
Implement the P0-GPU-04 result: composite the Compositor's wgpu texture into a GPUI element sharing the Device (zero readback). If the gate was NO-GO, this task is skipped in favor of P3-SHELL-05.

> **Test gate:** Manual: live composited preview renders inside a GPUI element at interactive rate; screenshot matches an offscreen render.

#### `P3-SHELL-03` — a11y (AccessKit) integration
Expose the editor's semantic tree (tracks, elements, controls) via AccessKit for screen readers and automation.

> **Test gate:** Integration: AccessKit tree present with correct roles/labels for timeline + inspector controls on at least one platform.

#### `P3-SHELL-04` — IME / text input
Wire platform IME into GPUI text inputs (inspector fields + the WYSIWYG text overlay) with composition/candidate support.

> **Test gate:** Manual: CJK/emoji composition works in inspector fields and the text-edit overlay.

#### `P3-SHELL-05` — Tauri disjoint-surface fallback shell
If the GPUI health gate fails: a Tauri shell on the SAME opencut-core, rendering the compositor output as a disjoint surface; parity target is the core editing loop, not pixel-embedded preview.

> **Test gate:** Manual: Tauri shell drives core edits + shows composited frames; feature-parity checklist for the editing loop met.

### Workstream: Preview UI

#### `P3-PRV-01` — Preview viewport
RAF loop skipping unchanged (frame,tree), wheel pan/zoom (exp curve, capped), fullscreen, RenderTreeController rebuild on deep changes -> push to renderer.

> **Test gate:** Unit: identical (frame,tree) invokes renderer zero times, a change invokes once; manual: pan/zoom feel.

#### `P3-PRV-02` — Transform-handle controller + rendering
Port TransformHandleController (corner/edge/rotation sessions) as a Rust struct over P1-RND-02 geometry + P1-TL-13 preview overlay; draw handles as GPUI elements; live previewElements/commit/discard = one undo entry.

> **Test gate:** Unit: corner-scale ratio + clears scale-animation when keyframed; edge-scale single-axis; rotation ±180 wrap + 90° snap; discard on cancel; commit = one snapshot.

#### `P3-PRV-03` — Mask-handle controller + rendering
GPUI layer over P1-MASK-02 math consuming handle/overlay descriptors and emitting drag deltas into computeParamUpdate + snap.

> **Test gate:** Unit: box/split handle sessions produce expected param updates; manual: handles align with rendered mask edges.

#### `P3-PRV-04` — Text-edit overlay (WYSIWYG)
A custom GPUI text input mirroring the P1-TXT-02 raster layout exactly (font/stroke/alignment) using P3-SHELL-04 IME.

> **Test gate:** Manual: edited text matches the composited render; caret/selection correct with IME.

#### `P3-PRV-05` — Snap guides, overlays, toolbar, context menu
Snap guide lines, overlay planes, toolbar, and context menu positioned via P1-RND-02 geometry.

> **Test gate:** Manual: guides appear at snap points; toolbar/context-menu actions dispatch correct commands.

#### `P3-PRV-06` — Guides & grid overlays
Completeness-critic addition: composition grid + platform safe-area layouts (TikTok etc.) + custom guides as preview overlays (dep/apps/web/src/guides).

> **Test gate:** Unit: guide definitions produce correct overlay geometry; manual: platform safe-areas render at expected positions.

### Workstream: Timeline UI

#### `P3-TL-01` — Timeline view (tracks/ruler/elements)
Render tracks/ruler/elements using P1-TL-11 ruler config + scale math; virtualized for large timelines.

> **Test gate:** Manual: ruler labels/ticks match web; large timeline scrolls smoothly.

#### `P3-TL-02` — Interaction controllers (drag/resize/seek/zoom/playhead/keyframe)
REWRITE as thin GPUI event->kernel->dispatch adapters over the pure kernels (pixelToTime, isClickGesture, resolveTimelineSnap, buildMoveGroup/resolveGroupMove, computeGroupResize, computeDropTarget); sessions as Rust enums in the view Model; commit boundaries map onto the command stack.

> **Test gate:** Unit: isClickGesture(5px/500ms)+pixelToTime pure; integration: simulated pointer sequence yields a model matching resolveGroupMove/computeGroupResize for the same coords; seek click-vs-drag frame-snaps.

#### `P3-TL-03` — Edge auto-scroll, scroll sync, box-select
Edge auto-scroll during drag, ruler/tracks scroll sync, and box-selection hit-testing on the GPUI input loop.

> **Test gate:** Manual: edge auto-scroll rate + scroll sync feel; box-select picks expected elements.

#### `P3-TL-04` — Waveform rendering + bookmarks UI
Render P1-MED-07 waveforms on audio elements and bookmark markers/drag from P1-TL-09.

> **Test gate:** Manual: waveform matches audio; bookmark add/move/toggle round-trip through commands.

### Workstream: Inspector & panels

#### `P3-INS-01` — Inspector (data-driven param panels)
Render param editors from the P1-FND-02 ParamDefinition registry, dispatching updates through P1-TL-13 (pushHistory-aware).

> **Test gate:** Manual: editing a param updates the preview and produces the right undo granularity.

#### `P3-INS-02` — Graph editor UI (bezier curve editor)
GPUI rewrite of the bezier graph: evaluate/draw the curve, hit-test handles, drag -> P1-ANIM-02 curve-bridge/updateScalarKeyframeCurve, easing presets persisted to a config JSON; extract tangent-mode constraint math into the animation crate.

> **Test gate:** Unit: preset persist/reload; tangent modes (aligned collinear / flat zero-slope / broken); golden: applying a built-in preset == web easing values; manual: drag batches one undo.

#### `P3-INS-03` — Effects/masks browse + apply panels
Keyword-searchable browse lists from the P1-FX-01/P1-MASK-01 registries with apply/reorder/toggle dispatching commands.

> **Test gate:** Manual: browse+apply an effect/mask; params appear in the inspector; undo works.

### Workstream: Asset browser & libraries

#### `P3-AST-01` — Media asset browser + import UX
Asset grid over MediaManager with the P1-MED-09 import pipeline (drag/drop/paste), progress + diagnostics rendering.

> **Test gate:** Integration: import a file -> asset appears with thumbnail; HEVC shows the cannot-preview diagnostic.

#### `P3-AST-02` — Stickers library browser
Completeness-critic addition: category/search UI over the P1-STK-01 resolver + vendored providers (flags/logos/shapes).

> **Test gate:** Manual: search/browse inserts a sticker element with correct intrinsic size.

#### `P3-AST-03` — Sounds library (Freesound) + saved-sounds
Completeness-critic addition: a direct Freesound API client replacing the server proxy (key/licensing decision), preview/download, saved-sounds management over the SQLite saved_sounds table; library-audio elements resolve via P1-MED-02.

> **Test gate:** Integration: search Freesound, preview, add a library-audio element that decodes and plays; saved-sounds persist.

#### `P3-AST-04` — Subtitles / transcription UI
Transcribe trigger (P1-ASR-01) with model/progress, caption insertion (P1-TXT-03), and SRT/ASS import/export.

> **Test gate:** Integration: transcribe a clip -> captions inserted as a text track; import an SRT and export ASS round-trip.

### Workstream: Actions & keybindings

#### `P3-ACT-01` — Action registry + definitions + dispatch
Completeness-critic addition: port the ~50 action definitions + registry and route action->Command dispatch through the CoreHandle.

> **Test gate:** Unit: each action dispatches its expected Command; integration: invoking an action mutates state + undo.

#### `P3-ACT-02` — Keybinding matching + customizable bindings
Keybinding matcher + customizable bindings persisted via the P1-PER-06 store/migration chain.

> **Test gate:** Unit: chord/keybinding matching; integration: a rebind persists and survives a migration load.

#### `P3-ACT-03` — Shortcuts-help UI
Render the shortcuts-help overlay from the action/keybinding registry.

> **Test gate:** Manual: help overlay lists current bindings and reflects customizations.

### Workstream: Playback & packaging (initial)

#### `P3-PB-01` — Wire cpal playback + A/V sync to preview clock
Validate the P1-MED-10 engine live: audio device clock (or frame clock) drives PlaybackManager; scrub/seek feel + A/V sync tuned against the GPUI frame cadence.

> **Test gate:** Manual: play/scrub/seek stays A/V-synced with no clicks; automated: no underruns over a 5-min play session.

#### `P3-PKG-01` — Dev app bundle scaffolding per-OS
Per-OS dev bundles (unsigned) so the shell runs as a real app on macOS/Windows/Linux; feeds Phase 4 signing.

> **Test gate:** CI: dev bundles build and launch on all three OSes.

---
[← Phase 2](phase-2.md) · [Plan](plan.md) · [Tasks](task.md) · [Phase 4 →](phase-4.md)
