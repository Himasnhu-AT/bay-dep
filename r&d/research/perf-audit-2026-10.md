# bay performance and memory audit — 2026-10-07

Tree read: `.claude/worktrees/wave2` (`feat/parity-wave2`, `14010ba9`). Read-only. No app was
launched. Every claim is labelled **measured (Node)**, **measured earlier (in app)** — a number
already in the repo — **read from code**, or **inferred**.

## Verdict

With plain video on the timeline, the frame path is cheap and already well shaped; fps is lost in
four specific places, and memory in three. **fps:** (1) a shape mask whose drawn size changes
every frame is rasterised in script every frame — measured at 17 ms (hard ellipse) to 111 ms
(three feathered masks) per 1080p frame, 46–390 ms at 4K, which alone caps a keyframed zoom with a
mask at 9–50 fps in preview and dominates its export; (2) every HTML composition on screen costs
about 62 % of a core, measured in the app on 2026-09-23, and none of that plan has landed; (3) a
title is laid out from scratch every frame — 36 `measureText` calls for a paragraph, 769 for a
title that auto-shrinks; (4) the WebGL grade and effect passes re-create render targets whenever
the drawn size changes and call the synchronous `gl.getError()` on every draw. **Interaction:**
every store edit deep-clones and twice stringifies the whole project — 10.8 ms measured on a
project with a 65-point LUT and a 2 MB data table — and live sliders and on-canvas drags do that
per pointer move. **Memory:** the undo stack is 100 deep copies of the project (717 MB measured
for that same project); opening another project from inside the editor releases nothing; and
several pools are bounded by count or not at all (`.brf` surfaces, audio elements, composition
windows, the grade context after one 4K render). Confidence: high on the Node-measured items
(1, 3, edit cost, undo size) and on what was measured in the app earlier (2); medium on the GL
items (the mechanism is certain, the milliseconds are not — no shader here has been timed);
low on absolute memory figures for GPU-side resources, which only the app can give.

## Measurements taken for this audit

Script: `/private/tmp/claude-501/bay-perf-audit-oct07-k3q/bench.mjs`, run from the worktree root as
`node --expose-gc --import ./src/test-hooks.mjs <script>`. It imports the repo's pure modules and
changes nothing. Node v26.5.0, Apple M5 Pro (15 cores as Node reports them), **load average
5.5 / 6.5 / 5.2 at the start and 5.3 at the end — other agents were running**, so treat every
figure as ±30 %. Medians of 5–20,000 runs.

Synthetic projects: "500 items" is 3 video + 2 audio tracks of 100 abutting clips, 100 dissolves,
40 assets, V1/A1 linked pairs (0.16 MB of JSON). "Heavy" adds a 65-point and a 33-point LUT, five
12 KB `.brf` modules, a 20,000-row data table, four beat grids and two matte records (4.19 MB).

| What | 20 items | 500 items | 500 items, heavy |
|---|---|---|---|
| `structuredClone(project)` | 0.05 ms | 0.54 ms | **5.34 ms** |
| `normaliseLinks` | 1.5 µs | 0.017 ms | 0.017 ms |
| `JSON.stringify(before) === JSON.stringify(next)` | 0.026 ms | 0.24 ms | **5.41 ms** |
| **one `edit()` before the mutator or any subscriber** | 0.08 ms | 0.79 ms | **10.8 ms** |
| `JSON.stringify(project)` (IPC payload) | 0.017 ms | 0.16 ms | 3.4 ms |
| `JSON.stringify(project, null, 2)` (what main writes) | 0.023 ms | 0.29 ms | 5.8 ms |
| `describeChanges` | 0.019 ms | 0.37 ms | 0.37 ms |
| heap held by 100 undo snapshots (after forced GC) | — | **21.7 MB** | **717 MB** |

Per played frame, pure project walking (no canvas, no elements):

| | 20 items / 3 transitions | 500 / 100 | 2,000 / 400 |
|---|---|---|---|
| `itemsToDraw` | | 0.061 ms | |
| `prerollTargets` | | 0.066 ms (p95 0.26) | |
| `audioRoutingAt` | | 0.262 ms | |
| **all three** | 2 µs | **0.39 ms** | **3.0 ms** |

`itemsAtFrame` alone is 0.3 µs at 500 items; the cost is `transitionAtFrame` resolving every
transition (0.062 ms), which each of the three callers does again, some per item.

`rasterMasks` (frame 1920×1080; one raster per call), plus 2.3–2.8 ms at 1080p for the
coverage → RGBA `ImageData` loop that follows it:

| masks | 960×540 | 1920×1080 | 3840×2160 |
|---|---|---|---|
| path, 16 points, feather 20 | 0.55 ms | 2.2 ms | 8.4 ms |
| rect, feather 40, rotated | 1.6 ms | 5.1 ms | 18 ms |
| ellipse, hard edge | 7.6 ms | **17.4 ms** | 46 ms |
| ellipse, feather 120 | 23.7 ms | **83 ms** | 317 ms |
| ellipse + rect (subtract) + path (intersect), feathered | 35 ms | **111 ms** | 389 ms |

Text, counted with a stand-in measure (the arithmetic itself is 5–30 µs; the cost in the app is
the canvas calls): one fitting line 5 `measureText` calls per frame; a 24-word paragraph 36 (79
with a by-word animation); a title that shrinks from 96 px to 48 px to fit **769** (791 by word).
In `layoutText` every one of those is preceded by a `ctx.font` assignment.

Small things, for scale: `animatedItemAt` 0.04 µs without keys, 0.3 µs with four keyed
properties; `adjustmentFilter` 0.12 µs; `resolveEffects` 2 µs; `resolveGrade` with curves
0.18 ms; `sourceKey` of a 12 KB `.brf` source 0.05 ms; comparing two equal-but-distinct 2.2 MB
LUT strings 0.05 ms; `decodeLutData` (65-point) 28 ms.

## Ranked findings

Effort: S under a day, M a few days, L a week or more. "Rule" is the CLAUDE.md rule the change
must not break.

### 1. Shape masks are rasterised in script on every frame whose drawn size changes

- **Where:** `engine/shapeMask.ts:74-106` (`ShapeMaskCache.get`: key includes the device width,
  height and step), `shared/shape-mask.ts:476-526` (`rasterMasks`), called from
  `engine/compositor.ts:558` and `:916`.
- **Mechanism:** the cache key is (masks, frame, exact view). A keyframed `layout.scale`, a
  keyed layout size, or a preview panel being resized changes `deviceWidth`/`deviceHeight`
  (`compositor.ts:474-475`) every frame, so every frame is a miss: `rasterMasks` in script, a
  fresh `ImageData` of 4 bytes per pixel, a per-pixel copy loop, `putImageData`. The ellipse's
  distance is iterative, so ellipses cost 10× a path.
- **Evidence:** measured (Node), table above. CLAUDE.md already states the every-frame raster;
  nobody had the number.
- **Gain:** a keyframed zoom on a feathered-ellipse-masked clip goes from ~83 ms/frame of script
  (≤12 fps) at a 1080p preview to the cost of a cached draw (<1 ms). Export of such a clip at 4K
  saves 0.3–0.4 s per frame.
- **Design (M):** the coverage function is defined on the clip's own frame, and a zoom about the
  centre does not change which part of the frame the picture shows — only how many device pixels
  it lands on. So key the grid on (masks, frame, origin and extent of the view in frame pixels)
  and a *quantised* size, rasterise at the largest size seen for that key (rounded up to a
  multiple of 64 px), and let `drawImage` scale it (`shapedPicture` already scales:
  `shapeMask.ts:160`). Second step if still needed: tighten `rasterMasks` itself — it already
  skips settled 2-D blocks; the remaining cost is the per-pixel ellipse iteration inside the
  ramp, which can be bounded by evaluating exactly only within `ramp/2` of the edge and
  interpolating the smoothstep between exact samples for wide feathers.
- **Risk / rule:** "the unit tests' numbers are the numbers on screen" and "no shader twin". A
  scaled grid is the same function sampled on a coarser or finer lattice, then bilinearly
  resampled: an unfeathered edge's one-pixel ramp becomes up to `scale` pixels wide. Keep export
  and `preview_frame` on the exact grid unless a pixel comparison shows the difference is under
  1/255 for feathered masks; apply the quantised grid in `mode: 'playback'` first.
- **Prove in app:** extend `test/app/shape-mask.mjs` (written, unrun). Specimen: one clip, one
  ellipse mask with feather 120, `layout.scale` keyed 1 → 1.4 over 90 frames. Count
  `ShapeMaskCache.rasterised` (already a public counter) over 90 played frames — before: 90;
  after: ≤ 8. Pictures/s from the harness below. Positive control: the same clip without the
  scale key must read 1 raster before and after. Correctness: `renderFrame` at frames 0, 45, 89
  compared with the exact-grid render, max channel difference reported.

### 2. Every HTML composition on screen costs ~62 % of a core; the measured plan is unbuilt

- **Where:** `main/html/compositions.ts:479-503` (`capturePage` at backing-store size, `resize`,
  `toBitmap`, `equals`), `engine/compositionPool.ts:355-377`, `lib/useEngine.ts:179`
  (`compositions.onReady(() => this.redraw())`).
- **Mechanism:** every frame of a playing composition is captured at Retina size (33 MB for a
  1080×1920 window), shrunk on the CPU, cloned over IPC, turned into an `ImageBitmap`; 78–91 %
  of those captures are the same picture as the one before; each arrival also schedules a full
  composite (178 animation frames/s against 121).
- **Evidence:** measured earlier (in app), `optimizations.md` (2026-09-23): video only 20 % of a
  core; +62 % per composition (31 main, 23 ui, 11 gpu); 8.2 ms of main per capture today against
  2.6 ms at draw size. Read from code today: none of its six steps is implemented — no signature,
  no `setZoomFactor`, no idle close.
- **Gain:** its own estimate — the "video + subtitles" case from 87 % to 30–35 % of a core;
  −190 MB while playing; ~120 MB per idle composition window (up to eight).
- **Effort:** steps 3 and 4 are S; 1, 2 and 5 are M. **Do them in that document's order; it has
  the traps** (per-origin zoom persisting across windows; the signature being valid only with no
  running animations, canvas, video or iframe).
- **Rule:** export and `preview_frame` stay exact-or-wait; a held frame may only ever stand in on
  the live pool. Subtitles are compositions, so this is the path most short-form projects are on.
- **Prove:** that document's own table (configurations × 5 s of `app.metrics()`), re-run.

### 3. The undo stack is 100 deep copies of the project

- **Where:** `store/kit.ts:19` (`HISTORY_LIMIT = 100`), `:142` (`clone(before)`), `:176-177`;
  `store/factory.ts:73` (`structuredClone`); agent checkpoints `store/agent-turns.ts:28` (20
  more) and `slices/agent.ts:97` (`agentReverts`, uncapped).
- **Mechanism:** no structural sharing: each entry is a full copy including every asset's
  `lut.data` (2.2 MB of base64 for a 65-point LUT), `data` table (≤2 MB), `brfCode`, `beats`.
- **Evidence:** measured (Node): 100 snapshots hold 21.7 MB for a plain 500-item project and
  **717 MB** for the heavy one (7.2 MB per step for 4.2 MB of JSON).
- **Gain:** 0.2–1 GB of renderer heap on a project with a LUT or a data table; nothing on a
  plain one.
- **Design:** see finding 4 — the same change fixes both. Stop-gap (S): cap history by bytes as
  well as count (estimate a snapshot as its JSON length, which `edit()` already computes).
- **Rule:** undo and Revert are pointer swaps today (`followReverts` compares identity,
  `kit.ts:236`); keep entries immutable.
- **Prove:** CDP `HeapProfiler.collectGarbage` then `Runtime.getHeapUsage` on the editor target,
  heavy specimen project, after 0 and after 100 one-field edits; positive control: the same on a
  project with no heavy assets must move ~20 MB.

### 4. Every edit clones and twice stringifies the whole project, and live controls do it per pointer move

- **Where:** `store/kit.ts:139-178`; `editor/liveGesture.ts:5-18`; flushes per animation frame
  in `viewer/TransformOverlay.tsx:340` and `viewer/MaskOverlay.tsx:239`; silent edits too
  (`slices/items.ts:131-134`, one per poster or waveform arrival).
- **Mechanism:** `structuredClone` + `normaliseLinks` + `JSON.stringify(before) ===
  JSON.stringify(next)`. The comment at `kit.ts:157-158` says edits are at human scale because
  "a drag commits on drop"; `LIVE` gestures commit every move. And because the clone replaces
  every object, everything keyed on identity is invalidated by every edit: `memo(Clip)`
  (`Clip.tsx:619`) never holds, so the whole timeline re-renders (`Timeline.tsx:179`, `:1180`,
  with a linear `findAsset` per clip at `:1199`); `resolvedGradeOf` rebuilds every grade's curve
  table (0.18 ms each, then a curve texture re-upload, `grade.ts:487-492`); `shapeMasksOf`,
  `resolvedEffectsOf`, `playableTimeline`, `brfDataFor` and the `.brf` document cache
  (`brf.ts:417`) all miss; the LUT check at `grade.ts:354` becomes a 2.2 MB string compare per
  graded draw.
- **Evidence:** measured (Node): 0.79 ms per edit at 500 items, **10.8 ms** heavy — before the
  mutator, before React. Read from code: the per-move call sites. Inferred: the React cost on
  top (likely larger than the clone on a 500-clip timeline).
- **Gain:** a slider drag on a heavy project from >11 ms + a full timeline re-render per move to
  well under 1 ms; importing N assets stops being N whole-project clones.
- **Design (L, the highest-leverage structural change here):** make `edit()` copy on write.
  Either adopt Immer (`produce` gives structural sharing, returns the same object when nothing
  changed — which replaces the double stringify — and mutators stay written as mutations), or,
  smaller, clone only the active timeline and share `assets` by reference unless a mutator
  touches them (a `Proxy`-free version: `edit()` takes `{ assets?: true }` from the few callers
  that change assets). `normaliseLinks` then has to return a new item only when it changes one
  (it already reports `changed`). With sharing, undo entries cost only what changed (finding 3),
  `memo(Clip)` starts working, and the WeakMap caches survive edits.
- **Risk / rule:** "every project mutation goes through `edit()`"; "a mutator that declined must
  leave no trace" (`kit.ts:149-160`) — Immer's no-change identity must be shown to cover the
  thirty refusing mutators, and the NaN-through-the-store case in CLAUDE.md is the kind of input
  to include. Frozen state will surface any code that mutates the project outside `edit()` —
  that is a feature, but budget for it.
- **Stop-gap (S):** skip the stringify comparison when the mutator's return says it acted, and
  compare `timelines` separately from `assets` so an unchanged 4 MB of assets is compared by
  reference.
- **Prove:** new `test/app/edit-cost.mjs`: heavy specimen, dispatch 120 `PointerEvent` moves on an
  inspector slider wrapped in `LIVE`; record long tasks (`PerformanceObserver`, `longtask`) and
  the time inside `edit` (wrap `store.setState` from the debug handle). Count React commits with
  a `Profiler` counter on `Timeline`. Positive control: the same drag on a 20-item project.
  Under Node first: the bench above, re-run against the new `edit()`.

### 5. A title is laid out and measured from scratch every frame

- **Where:** `engine/compositor.ts:1028-1052` (`#drawText`), `engine/text.ts:143-184`
  (`layoutText`, the shrink loop `:176-179`), `:235-245` (`fontIsAvailable`),
  `engine/textPaint.ts:100-180` (`planText`).
- **Mechanism:** no cache at any level. Each frame: wrap (one `ctx.font` set + `measureText`
  per word), re-measure each line, two font probes, then the plan's measures; when the text does
  not fit at its size the whole wrap repeats one pixel smaller until it does.
- **Evidence:** measured (Node) as call counts: 5 / 36 / **769** per frame (table above).
  Inferred cost: Chromium's `measureText` with a font change is typically 5–30 µs, so ~0.2–1 ms
  per paragraph per frame and **4–20 ms per frame for a shrinking title** — to be timed in app.
- **Gain:** 0.2–20 ms per text item per frame, on every project with titles.
- **Design (S):** a small LRU keyed by (text, font family, weight, italic, size, line height,
  letter spacing, box width, box height, units-by, font epoch) holding `laid`, `fontAvailable`
  and the plan; bump the epoch from `importedFonts.onReady` and `document.fonts`'
  `loadingdone`. The shrink search can also bisect instead of stepping one pixel (S, separate).
- **Rule:** the `TextFit` report must still be produced every frame from the cached layout
  (`check_text` reads it); a font arriving must invalidate, or a title stays laid out for the
  fallback face — the fault "with no visual cue at all".
- **Second step (M):** a static title (no keys, no units, no animation) can keep its painted
  result — shadows and all — on an `OffscreenCanvas` keyed by (item identity, device scale) and
  be one `drawImage`. Canvas `shadowBlur` per run is the expensive part of paint. Worth it only
  after finding 4, because today item identity changes on every edit.
- **Prove:** extend `test/app/text-layers.mjs`: wrap `CanvasRenderingContext2D.prototype
  .measureText` with a counter for 60 played frames over the shrinking-title specimen — before
  ≈ 769 × 60, after ≈ 769 once. Positive control: changing the box width by 1 px must recount.

### 6. The grade and effect passes re-create targets on any size change, and query the GPU synchronously every draw

- **Where:** `engine/grade.ts:322-348` (`target`: delete + create when the size differs),
  `:549`, `:563-564` (halation's three targets), `engine/effects.ts:288-296` (`fxA`/`fxB`,
  per-step scratch); `grade.ts:598` and `effects.ts:338` (`gl.getError()`); `grade.ts:468` and
  `effects.ts:255` (`texImage2D` from the element every draw); `grade.ts:452-455` (drawing
  buffer only grows); `grade.ts:288` (`preserveDrawingBuffer: true`).
- **Mechanism, four parts:**
  1. Targets are keyed by role, not size. A keyframed zoom re-creates up to six full-size
     RGBA8 textures and framebuffers per frame; two effected or halated clips of *different*
     sizes in one frame (a picture-in-picture, or both sides of a transition) do the same twice
     per frame, forever. Chromium zero-fills each new texture.
  2. `gl.getError()` is a synchronous round trip to the GPU process: it flushes the command
     buffer and waits. One per graded draw, plus one per effect stack.
  3. `texImage2D(…, source)` with a sized-by-source upload redefines the texture each call;
     allocating once with `texStorage2D` and uploading with `texSubImage2D` while the source
     size is unchanged avoids the reallocation.
  4. After one 4K `preview_frame` or export, the shared drawing buffer stays 4K, and each
     `drawImage(gl canvas → 2D canvas)` in the preview reads from that larger buffer
     (`preserveDrawingBuffer` also forbids the cheap swap path).
- **Evidence:** read from code. **Not measured: no shader in this tree has been timed** — the
  effects probe is unrun. Milliseconds below are inferred from how Chromium's command buffer
  behaves.
- **Gain (inferred):** part 1, 1–5 ms per affected frame; part 2, 0.3–2 ms per graded item per
  frame and removal of a GPU-pipeline stall; part 3, 0.2–1 ms per 4K upload; part 4, ~100–250 MB
  of GPU memory returned (see finding 9) and a smaller copy per draw.
- **Design:** (S) targets grow-only per key with the viewport and sampling rect carrying the
  used size — or bucket sizes up to a multiple of 64 and keep a 2-entry LRU per key; (S) in
  `mode: 'playback'` check `getError` on the first draw of each (program, size) and then every
  Nth, always in scrub/export; (S) `texStorage2D`/`texSubImage2D`; (M) shrink the drawing
  buffer and targets back after an export finishes (`FrameExporter`'s `finally`).
- **Rule:** "a wrong frame is reported" — the exporter and `preview_frame` must keep checking
  every draw; a preview frame drawn with a failed pass and no report is acceptable only because
  the next sampled check reports it. Units 3 and 4 and the feedback-loop unbind (`grade.ts:341-
  344`) are load-bearing.
- **Prove:** extend `test/app/grade.mjs`/`effects.mjs`: count `createTexture` calls on the
  shared context (wrap it through `bayEngine`) over 90 played frames of (a) one graded clip
  with halation and a keyed zoom, (b) two effected clips of different sizes — before: hundreds;
  after: single digits. Time `Compositor.drawFrame` (exposed for exactly this, `useEngine.ts:71`)
  with and without `getError`. Positive control: a deliberately broken shader must still produce
  a `gradeIssues` line within N frames in playback and on the first frame in `renderFrame`.

### 7. Opening another project from inside the editor releases nothing; four singletons are never torn down

- **Where:** `store/slices/project.ts:53-90` (`setProject`), `lib/useEngine.ts:280-282` (only
  `#hold.clear()`), `:212-231` (`detach`, which runs only when the editor unmounts).
  `brfRuntime.dispose()`, `subjectMattes.reset()`, `MediaPool.release()` and main's
  `releaseAll` (`main/html/compositions.ts:682`) have no caller in the app (read from code;
  grep confirms).
- **Mechanism:** media elements, composition bitmaps, `.brf` surfaces and workers, matte frames,
  LUT textures and GL targets of project A stay while project B plays. `brfRuntime`,
  `subjectMattes`, the grade context and `variationFaces` outlive even `detach`.
- **Gain (inferred):** the whole working set of the previous project — hundreds of MB after a
  session of switching.
- **Design (S–M):** one `Engine.releaseProject()` run from `#onStoreChange` when `project.id`
  changes: `compositor.reset()`, `pool.dispose()` and re-create, `compositions.release` for
  every asset, `brfRuntime.dispose()`, `subjectMattes.reset()`, delete LUT textures not in the
  new project, tell main to close composition windows. Also call it from `detach`.
- **Rule:** the probes share `brfRuntime`/`subjectMattes` across preview, `renderFrame` and
  export — releasing during an export in flight must be refused.
- **Prove:** `Performance.getMetrics` + per-process RSS (`app.metrics()`) after: open heavy
  project A, play 10 s, open empty project B, force GC. Before: B's footprint ≈ A's. After:
  within ~50 MB of a cold open of B (that cold open is the control).

### 8. `.brf` surfaces: one full-frame canvas per item, cleared only past 64

- **Where:** `engine/brf.ts:500-506`.
- **Mechanism:** a surface per item id at the drawn size; nothing removes one when its item
  leaves the frame; the only bound is "more than 64 → clear all" *on an allocation*.
- **Evidence:** read from code. Arithmetic: 64 × 8.3 MB = 530 MB at a 1080p preview; 64 × 33 MB
  = 2.1 GB during a 4K export (the exporter's compositor has its own `BrfSurfaces`).
- **Gain:** up to those figures on a film built from many `.brf` cards; typically tens of MB.
- **Design (S):** surfaces are scratch — the picture is repainted every frame anyway — so pool
  them by size instead of by item (as many as one frame draws at once), or drop any surface not
  drawn in the last N generations.
- **Prove:** specimen with 40 consecutive 2 s `.brf` cards, play through; GPU-process RSS before
  and after; control: a single looping card.

### 9. Pools bounded by count, or not at all

Read from code; MB inferred.

| Resource | Where | Bound today | Worst case |
|---|---|---|---|
| `<audio>`/`<img>` elements | `engine/mediaPool.ts:10-12` (video only is capped at 12, `:26`) | none | grows with assets touched |
| stand-in element keys (`~fx~`, `~detached~`, `~sound~`) | `engine/audio.ts:153`, `:397`, `:428` | never evicted | one element per item ever sounded |
| pools alive at once | preview 12 + exporter 8 (`exporter.ts:114`) + `renderFrame` 8 (`render.ts:240`) + frame grid 8 | per pool | 36 video decoders |
| composition bitmap cache | `engine/compositionPool.ts:37` | 256 MB **per pool** | 512 MB+ with an export running |
| composition windows | `main/html/compositions.ts:85`, `:310-320` | 8, LRU, no idle timeout | ~120 MB each (measured earlier) |
| grade/effects context | `engine/grade.ts:276-277`, `:452-455` | grows, never shrinks | ~35 MB buffer + ~165 MB targets + source textures after one 4K render; LUT 3-D textures never deleted |
| 3-D renderer | `engine/scene3d.ts:260-296` | stays at largest size | 130–250 MB (MSAA at 4K) |
| `.brf` workers | `engine/brfCode.ts:58-59`, `:337-340` | 8, no idle timeout | 8 isolates each parsing a 660 KB bundle |
| `.brf` scene cache | `engine/brfCode.ts:153`, `:457-465` | 6,000 scenes by count, FIFO | 50–350 MB for data charts |
| matte frames | `engine/subjectMatte.ts:44-45` | 160 frames | 126 MB (the comment says ~64) |
| main's `byPath` | `main/media/import.ts:43`, `:119` | none | whole `Asset` objects incl. LUT/data, across projects |
| renderer MCP records | `mcp/transcribe.ts:26`, `exports.ts:56`, `cuts.ts:20`, `narration.ts:81`, `dub.ts:156` | none | small, but unbounded |
| disk | `<userData>/generated`, `downloads`, in-session audio bakes | none / 4 GB for bakes | user disk |

- **Design (S each):** cap audio/image elements by LRU like video (a paused `<audio>` is cheap
  but holds a decoder and a `MediaElementSource`, which cannot be re-created — evict the node
  with it, as `#releaseEvictListener` already does for video); give the composition cache one
  shared budget; idle-close composition windows and `.brf` workers after 30–60 s; make the
  scene cache LRU and bound it by serialised size; `MAX_FRAMES` 160 → 64 or by bytes.
- **Prove:** the harness's memory table before and after each cap, with a soak that scrubs
  across every clip of a 100-asset project (the control: RSS must plateau, not climb).

### 10. A playhead tick runs every selector in the app, several of them O(items)

- **Where:** `lib/useEngine.ts:272` → `store/slices/view.ts:73-77` (`setPlayhead` walks every
  item for `timelineDuration`, 1.7 µs at 500 items — fine by itself) → every subscribed
  selector (296 `useEditor(` sites). O(items) ones that re-run per tick: `selectDuration`
  (`store/editor.ts:157-160`; Preview:32, Transport:99, StatusBar:29, TimecodeField:14,
  Timeline:178), `useSelectedItems` ×6 (`store/editor.ts:165`, O(items × selection) — select
  all is quadratic), `TransformOverlay.tsx:132-143`, `TrackHeader.tsx:71-72`,
  `AgentPanel.tsx:968-969` (`revertImpact` twice per card). Real re-renders per tick:
  `Inspector.tsx:129` (the whole 836-line inspector when one keyframed clip is selected),
  `audio/AudioPanel.tsx:31`, `TimecodeField.tsx:13`, `workspace/ViewerRegion.tsx:12`,
  `KeyframeGraph.tsx:38`, `TranscriptPanel.tsx:120` (every word span on each word change,
  unvirtualised).
- **Evidence:** read from code. `optimizations.md` item 6 already lists "React re-rendering on
  every `setPlayhead`" as unattributed renderer time (~23 % of a core per composition was
  unexplained). **Unmeasured.**
- **Gain (inferred):** 0.5–3 ms per tick on a 500-item project with a keyframed clip selected;
  little on a small one.
- **Design (S):** memoise `selectDuration` and selected-items on `project` identity (the
  pattern is already in `TimelineToolbar.tsx:220-221`); move the keyed-playhead subscription
  down into `KeyDiamond`/`KeyNavigation`; virtualise or `memo` the transcript words. (M) keep
  the playing playhead out of the store altogether — a `playhead` external store with its own
  listeners, written to zustand only on pause/seek — so a tick notifies five listeners, not 296.
- **Rule:** "the clock is the only thing that says which frame to draw"; a store snapshot read
  before an action is the old value — commands that read `state.playhead` (marks, splits) must
  read the live value.
- **Prove:** CDP `Profiler.start/stop` over 5 s of playback on the 10-track specimen with a
  keyed clip selected, self-time grouped by function; plus a React commit counter. Control:
  nothing selected.

### 11. The transition list is resolved several times per frame, per caller and per item

- **Where:** `shared/project.ts:1482-1499` (`transitionAtFrame` resolves *every* transition,
  each via two `findItem` scans), called from `itemsToDraw` (`compositor.ts:1287`), again from
  `audioRoutingAt` (`audio.ts:195`), again per audible item (`transitionOfItemAt`,
  `audio.ts:~293`), and `prerollTargets` resolves all of them once more plus an `itemsToDraw`
  per candidate (`compositor.ts:1325-1344`).
- **Evidence:** measured (Node): 0.39 ms per frame at 500 items/100 transitions, 3.0 ms at
  2,000/400; 2 µs on a small project.
- **Gain:** up to 3 ms per frame on long timelines; nothing on short ones.
- **Design (S):** a `WeakMap<Timeline, …>` of resolved transitions sorted by `firstFrame` and
  an id → item index, built once per timeline identity (`playableTimeline` shows the pattern).
  Needs finding 4 to stop identity changing on unrelated edits, but is correct without it.
- **Rule:** `resolveTransition` stays the one authority on the window; the cache stores its
  results, never re-derives them.
- **Prove:** under Node — the bench above; in app, `engine.stats().compositeP50Ms` on a
  2,000-item specimen.

### 12. Export: six full-frame copies per frame, the file written four times, audio after video

- **Where:** `engine/exporter.ts:214-221`, `preload/index.ts:256-257`, `main/export/encode.ts
  :341`, `frame-pipe.ts:42`; `codec-args.ts:120-123` applied at `encode.ts:184` **and** `:695`;
  `encode.ts:596-712`.
- **Mechanism:** `getImageData` → context bridge → structured clone → main → pipe → ffmpeg →
  swscale to yuv420p: ~50 MB of memory traffic per 1080p frame, ~200 MB per 4K frame (inferred
  ~5 / ~20 ms). `+faststart` is applied to the video-only scratch encode as well as the final
  mux, and each is a full rewrite of the file. The audio mix, independent of frames, starts only
  after the last frame. Separately, `awaitSources` seeks every element for every frame
  (`exporter.ts:186`) — frame-exact, and probably the largest single export cost; not measured
  here.
- **Evidence:** read from code. Already measured and settled, do not reopen:
  `willReadFrequently` loses 2.2–4.5× (`exporter.ts:385-412`); `invoke` cannot transfer.
- **Gain:** dropping `+faststart` from the scratch pass saves one full file rewrite per export
  (S, free). Rendering the audio WAV concurrently with the frames saves its whole duration from
  the tail (M). A `MessagePort` with a transfer list (`ipcRenderer.postMessage(channel, msg,
  [port])`, which *does* transfer `ArrayBuffer`s) removes two of the copies (M; the comment at
  `exporter.ts:212` is about `invoke` only).
- **Rule:** export stays frame-exact; backpressure stays one frame in flight
  (`frame-pipe.ts:36-46`); a failed job must stay distinguishable from a cancelled one.
- **Prove:** `test/app/export-readback-cost.mjs` reports per-stage times already; add wall time
  per 300-frame export at 1080p and 4K and the tail time after the last `pushFrame`. Control: a
  byte-identical output (`ffmpeg -f framemd5`) before and after.

### 13. The renderer bundle is not minified and is one chunk

- **Where:** `electron.vite.config.ts` (no `minify`, `manualChunks`); electron-vite's renderer
  default is `minify: false`. One dynamic import in the renderer (`engine/scene3dRuntime.ts:28`).
- **Evidence:** measured (file sizes): main chunk 4.48 MB (1.06 MB gzip), 103,276 pretty-printed
  lines, 0.52 MB of leading indentation; `scene3d` 1.79 MB; worker 0.66 MB (85 % sucrase),
  parsed once **per `.brf` module**; main process 1.74 MB statically loaded.
  Composition of the main chunk: React ~0.65 MB, `shared/` ~0.9 MB (of which tool descriptions
  ~0.36 MB), store/lib/engine/MCP executor ~1.0 MB, react-markdown stack ~0.37 MB, UI ~1.4 MB.
  three.js, opentype and sucrase are already out of it; there is no code editor, zod or motion
  library.
- **Gain (inferred):** minify → roughly half the bytes parsed at launch and per worker; lazy
  `Markdown`, `SettingsDialog`, `ExportDialog`, cmdk/FontPicker and a home/editor split → a
  first-paint chunk of ~1.2–1.5 MB unminified. Launch-time effect: unmeasured; `app_open`
  already records `launchMs` (`main/index.ts:139`).
- **Risk:** crash reports send renderer stacks and no sourcemap is emitted — minified stacks
  need a sourcemap kept beside the release; check for reliance on `Function.name`.
- **Effort:** S (minify), M (splits). **Prove:** `test/app/coldstart.mjs` — time to first paint
  and to `bayMcp` ready, 5 cold launches each way.

### 14. Main-thread blocks

Read from code; durations inferred unless noted.

| What | Where | Blocks main for |
|---|---|---|
| Beat analysis: whole file decoded to f32 and concatenated, JS FFTs | `main/media/beats.ts:55-79`, `beat-analysis.ts:31-33`, `:134-173` | 0.4–1.2 s for a 4-minute song; ~950 MB peak per hour of audio |
| `score_sfx` synthesis | `main/sfx/write.ts:46-48` | ~250 ms for 30 s/60 events (measured earlier, CLAUDE.md) — music already uses a worker |
| `.cube` import: `readFile` + sync parse | `shared/cube.ts:33` | 50–150 ms for 65³ |
| Save/autosave: structured clone in, `JSON.stringify(…, null, 2)` | `main/project/persistence.ts:144`, `:171` | 5.8 ms measured (Node) for the heavy project, plus the clone |
| Every save rebuilds the native menu from 40 recents **with posters** | `main/project/store.ts:325`, `:358`, `:301`; `project/db.ts:114` | 2–20 ms; the menu needs ten names |
| Waveform peaks: whole file buffered | `main/media/waveform.ts:19`, `:64-92` | 30–60 ms and ~58 MB per hour |
| Generation result buffered whole (512 MB cap) then concatenated | `main/generate/http.ts:132-155` | ~1 GB peak |
| Agent stop: `spawnSync(ps)` | `main/agent/cli.ts:61` | 10–30 ms, 5 s worst case |

- **Design:** move beats and sfx onto the music worker's pattern (`music/off-thread.ts:35`) (M);
  stream the beat decode in chunks instead of `Buffer.concat` (S); select names only for the
  menu (S); write autosave without the indent (S — the sidecar is not for reading); skip the
  autosave re-arm on silent edits that changed nothing a save would write (`lib/autosave.ts:122`).
- **Prove:** main-process event-loop lag sampled with `perf_hooks.monitorEventLoopDelay` exposed
  through `app.metrics()`; p99 during `detect_beats` on a 4-minute song before and after.

### 15. Smaller per-frame costs in the playback path

Read from code; each is small, listed so nobody rediscovers them.

- **A full-canvas copy per played picture** for the hold (`lib/useEngine.ts:392-417`): one
  `drawImage` of the whole backing store plus a second full-size canvas. Needed only when the
  next frame may be incomplete; could be limited to the second before a same-asset jump cut
  (`prerollTargets` knows) or taken lazily. ~0.3–1 ms and 8–33 MB. S, low risk.
- **Mask scratch thrash with two masked clips of different sizes**
  (`engine/subjectMask.ts:86-93`, one `pic` and one `matte` canvas by role): each is resized
  twice per frame. Keep one per size, up to a few. S.
- **Composition requests carry the font list every frame** (`compositionPool.ts:365`), and the
  reply's 8 MB buffer is copied again (`:371`) before `createImageBitmap`. Folded into finding 2.
- **`sourceKey` hashes the whole `.brf` source per item per frame** (`brfCode.ts:73`, measured
  0.05 ms for 12 KB). A one-entry memo by string identity. S.
- **CSS `ctx.filter` for adjustments** (`compositor.ts:1431-1437`): the filtered draw path is
  documented at ~2× at 4K. When a clip already takes the WebGL pass (it has a grade or
  effects), the colour adjustments could ride that pass — but that is a second mapping of
  `Adjustments`, which CLAUDE.md forbids. Leave unless measured as a real cost.
- **`AudioMeter`: one animation-frame loop per meter at display rate with a layout read per
  frame** (`viewer/AudioMeter.tsx:172-191`, `:102`). Whether it runs while paused needs the app.
- **Timeline:** no clip virtualisation; filmstrip up to 48 divs per clip (`Clip.tsx:163-186`);
  waveform an SVG polygon rebuilt by string concatenation per render (`:224`, `:249`); pointer
  moves re-render the 1,455-line component (`Timeline.tsx:194-219`). M, after finding 4.
- **Agent log streaming is O(log length) per token delta** (`slices/agent.ts:186-187`,
  `:220-226`) and the log is unbounded.

## Measurement harness to build first

`test/app/perf-baseline.mjs`, run with `agent-browser --session bay` against an isolated instance
(`BAY_ACCESS=dev`, its own profile and CDP port — see the memory note on the app lock). It reports
and never asserts; a second mode compares two saved reports.

**Specimens** — built by MCP calls on a scratch project, undone at the end, never saved. Each at
30 fps, 10 s, played from frame 0 after a 1.2 s warm-up, three runs, median reported:

1. plain 1080p H.264 clip
2. 4K clip in a 1080p timeline, and in a 4K timeline
3. clip + grade (curves, LUT, halation) + 3 effects (glow, chromatic-aberration, sharpen) + a
   soft ellipse mask
4. finding 1's case: ellipse mask, feather 120, `layout.scale` keyed 1 → 1.4
5. a title with a paint stack (two strokes, shadow, plate) and a by-word In; and the
   auto-shrinking title
6. a `.brf` chart from the kit with a 5,000-row table
7. an HTML composition (Spotlight subtitles) over the clip
8. an adjustment layer with a grade over two video tracks
9. ten tracks: 4 video (one picture-in-picture with effects), 6 audio with EQ bands

**Counting pictures, not ticks.** `engine.stats().pictures` counts clock dispatches — a draw
that repainted the same decoded frame is a "picture" there. Count what reached the canvas:

- In the page, on every `requestAnimationFrame`, read a 32×18 `drawImage` of the viewer canvas
  into a `willReadFrequently` scratch canvas and hash it (FNV over the bytes). A **picture** is a
  hash different from the previous one. Record the timestamp of each change.
- pictures/s = changes ÷ seconds; frame time = gaps between changes (p50/p95/p99); a **dropped
  picture** is a gap > 1.5 × (1000 / fps); a **black picture** is a hash equal to the
  background-only hash taken before placing the clip.
- The specimen footage must change every frame, or a correct 30 fps reads as less: use a clip
  with a burnt-in frame counter (generate with bay's ffmpeg: `testsrc2` — its counter and moving
  bars change every frame).
- **Positive control, run first:** throttle the engine to draw every third clock frame (through
  the debug handle) and confirm the probe reads ~10 pictures/s; and play footage that is a still
  image and confirm it reads 0 — which is why still specimens are excluded. A sampler that reads
  30 in both cases is counting ticks.
- The 32×18 readback is itself a GPU read per display frame: measure its cost with the sampler
  on and off (`compositeP50Ms`) and report it beside the results.

**Also recorded per specimen:**

- `engine.stats()`: `compositeP50Ms`, `compositeP99Ms`, `skippedFrames` (script time of the draw
  only — the GPU's share is not in it, which is why pictures are the headline).
- Long tasks: `new PerformanceObserver(…).observe({ type: 'longtask', buffered: true })`, count
  and total ms.
- CPU by process: `window.bay.app.metrics()` once to reset, read after 5 s (the method in
  `optimizations.md`'s appendix; multiply by core count as it does).
- JS heap after forced GC: CDP `HeapProfiler.collectGarbage`, then `Runtime.getHeapUsage`.
- `Performance.getMetrics`: `JSHeapUsedSize`, `Nodes`, `JSEventListeners`, `LayoutCount`,
  `RecalcStyleCount` — deltas over the run (layout and style counts during playback should be
  near zero).
- RSS of every process from `app.getAppMetrics()` (`memory.workingSetSize`), split editor
  renderer / GPU / main / each composition window; `process.memoryUsage()` in main.
- GPU memory: `SystemInfo.getProcessInfo` and the GPU process's RSS are obtainable; per-context
  texture memory is not — say so in the report rather than estimating it.
- Counters exposed through `bayEngine` for the findings above: `ShapeMaskCache.rasterised`,
  `createTexture`/`getError` call counts on the shared context, `measureText` calls, React
  commit count on `Timeline` and `Inspector`, `edit()` count and total ms.

**Protocol.** Record `uptime`'s load average and whether another bay instance is running in the
report header; refuse to compare two reports whose load averages differ by more than 2. Build
before probing and print `out/main/index.js`'s mtime (a probe after a failed build measures the
previous binary). One change per comparison. A change whose number does not move has not done
what it claims.

**Memory soak mode.** Open the heavy project, play it end to end twice, scrub across every clip,
run one 4K `preview_frame`, open an empty project; sample the RSS table every 5 s. The curve
should plateau and fall back on the project switch (findings 7–9).

## Quick wins, in order (S, low risk)

1. Drop `+faststart` from the scratch video encode (`encode.ts:184`). One fewer full rewrite per
   export.
2. Cache text layout and font availability per (text, style, box, font epoch) (finding 5).
3. Resolve transitions once per timeline identity (finding 11).
4. Grow-only or size-bucketed GL targets; `texStorage2D` + `texSubImage2D`; sample `getError` in
   playback only (finding 6, parts 1–3).
5. `optimizations.md` steps 3 and 4: no redraw for look-ahead composition frames; evict live
   composition frames by time.
6. Pool `.brf` surfaces by size instead of by item (finding 8).
7. Release the previous project's engine resources on a project change (finding 7).
8. Cap undo by bytes as well as count; skip the assets half of the no-change comparison by
   reference (stop-gaps for 3 and 4).
9. Memoise `selectDuration` and selected-items on `project`; move the keyed-playhead
   subscription into the key controls (finding 10).
10. Menu rebuild selects names only; autosave sidecar written without indent; no autosave re-arm
    on silent edits (finding 14).
11. Minify the renderer and worker bundles, with a sourcemap kept for crash stacks (finding 13).
12. LRU caps for audio/image elements, `.brf` workers idle-closed, scene cache LRU, matte frames
    to 64 (finding 9).

## Structural items

- **Copy-on-write `edit()`** (L; findings 3, 4, and it unlocks 10, 11 and the timeline). Sketch:
  Immer `produce` inside `edit()`; `normaliseLinks` returns new items only when it changes one;
  the "declined mutator leaves no trace" rule becomes `next === before`; undo entries share
  everything unchanged. Migration test: run every store action against both implementations over
  the existing store tests and a generated action sequence, asserting equal projects — and that
  the refusing mutators yield identical state objects.
- **Shape-mask grids independent of drawn size** (M; finding 1), playback first, then decide
  about export from a pixel comparison.
- **Composition capture on change and at draw size, idle windows closed** (M;
  `optimizations.md` 1, 2, 5).
- **Playing playhead outside the store** (M; finding 10).
- **Export transport over a transferred `MessagePort`, audio rendered alongside the frames**
  (M; finding 12).
- **Beats and sfx off the main thread** (M; finding 14).
- **Home/editor and dialog code splits** (M; finding 13).
- **Timeline virtualisation and a canvas waveform** (M; after copy-on-write).

## Looks slow, not worth touching

- **Keyframe sampling.** `animatedItemAt` is 0.04 µs without keys and 0.3 µs with four keyed
  properties. A sampling table would save nothing.
- **`itemsAtFrame`, `playableTimeline`, `timelineDuration`.** 0.3–1.7 µs at 500 items.
- **`adjustmentFilter` string building** (0.12 µs) and `JSON.stringify(masks)` for the mask
  cache key (0.1–0.7 µs).
- **`normaliseLinks` on every edit** (17 µs at 500 items) — the clone beside it is the cost.
- **`describeChanges`** (0.37 ms, once per agent turn).
- **`resolveEffects`** (2 µs) and `resolveGrade` (0.18 ms) — their cost is being re-run after
  every edit, which finding 4 removes; do not hand-optimise them.
- **`willReadFrequently` on the export canvas** — measured 2.2–4.5× slower, settled.
- **`check_export`'s decode** — measured 1–1.9 s per minute at 1080p, software decode
  deliberately (hardware was 3× slower), and it runs once per export.
- **Video decode itself** — the 20 % floor in `optimizations.md`; that machine's VideoToolbox
  was saturated by other processes. Re-measure on a quiet machine before touching it.
- **`bay://` serving** — async stat, ranged streams, no whole-file reads.
- **Startup in main** — nothing spawns at launch; ffmpeg, the agent SDK and onnxruntime are
  lazy; the only sync work is the SQLite open and a small queue read.
- **Idle animation-frame loops in the engine** — there are none: the clock requests frames only
  while running, and a paused redraw is coalesced and event-driven.
- **`decodeLutData` (28 ms)** — once per LUT per session (after finding 4; today once per edit
  only if the string *content* changed, which it does not).
- **Halation's separable blur and the glass backdrop** — already downsampled / grow-only.

## What could not be determined without the app

1. Any GPU-side millisecond: the grade and effect passes, `texImage2D` from a video element,
   the GL-canvas → 2D-canvas copy, canvas `filter` and `shadowBlur`. Finding 6's gains are
   inferred from mechanism.
2. The real cost of `measureText` and `ctx.font` in this Chromium (finding 5's milliseconds).
3. How much of a playback tick React and the 296 selectors take (finding 10) — the 23 % "ui"
   share per composition in `optimizations.md` is still unattributed.
4. All absolute GPU memory: target and drawing-buffer sizes after a 4K render, the 3-D
   renderer, `.brf` surfaces, and whether Chromium keeps canvases resized to 1×1 alive.
5. Whether `AudioMeter`'s loops, or anything else, keep the compositor awake while paused —
   needs a CPU reading of an idle editor per page (Edit, Color, Audio).
6. Export's per-stage split — especially `awaitSources`' per-frame seek against the copy chain.
7. Launch time by phase, and what minification and splitting change in it.
8. Whether the reversed-clip stepped preview reaches the project's frame rate (CLAUDE.md lists
   it as unmeasured; specimen 9 can carry one reversed clip).
9. Heap retained by 100 undo steps *in Chromium* — V8 is the same engine as Node's, so 717 MB
   should hold, but confirm it with the heap snapshot before sizing the fix.
