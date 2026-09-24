# optimizations.md

What playback costs, where that cost goes, and the changes that would cut it. The changes are
listed in order of payoff. Every number here was measured on 2026-09-23 on this Mac (M2 Pro,
15 cores, 121 Hz display, Electron 41.10.7), unless it is marked as an estimate. No code has
changed yet; this is the plan.

## The report

The debug HUD, while playing a vertical short:

```
PLAYER 30.0 / 30 fps   DRAW p50 0.2 · p99 0.5 ms
CPU    87.3% (ui 35 · gpu 20 · main 32)
MEM    1321 MB
GPU    26% whole Mac
```

## Where it goes

The scratch project was built to match: a 540×960 clip on V1, Spotlight subtitles, and an
animated `topband.html` band, both full-frame 1080×1920 compositions. The canvas was 1080×1920.
Each row is a 5 s average, taken 1.2 s after playback started, with debug mode off so the HUD
does not measure itself. CPU is percent of one core, as in Activity Monitor.

| configuration        | fps  | CPU total | ui | gpu | main | memory  |
|----------------------|------|-----------|----|-----|------|---------|
| paused               | —    | 2%        | 2  | 0   | 0    | 1058 MB |
| video only           | 29.8 | 20%       | 11 | 8   | 0    | 1033 MB |
| video + subtitles    | 30.0 | 87%       | 34 | 20  | 32   | 1152 MB |
| video + band         | 29.7 | 82%       | 33 | 18  | 31   | 1126 MB |
| video + subs + band  | 29.8 | 130%      | 50 | 30  | 50   | 1226 MB |

**Each composition on screen costs about 62% of a core: ~31 main, ~23 ui, ~11 gpu. The video
costs 20%.** The report's 87% is the "video + subtitles" row. Almost all of the cost is
compositions, so almost all of this plan is about compositions.

### What one composition frame costs

The live pool captures **every frame**. With both compositions visible, a counter inside each
composition page read 153 seeks in 5 s, 30.6 per second each. Lookahead does not multiply that
figure: a looked-ahead frame is a cache hit when its moment arrives.

Most of those captures are the same picture as the one before. A second counter compared
`document.body.innerHTML` after each seek, over 10 s:

| composition         | seeks | distinct pictures | wasted captures |
|---------------------|-------|-------------------|-----------------|
| subtitles-spotlight | 303   | 67                | 78%             |
| topband             | 303   | 28                | 91%             |

A standalone Electron bench runs the same steps as `compositionFrameAt` (35 frames after a
5-frame warm-up, each figure the p50). The script is described in the appendix.

| capture surface                        | captured at  | main CPU / frame | GPU CPU / frame | wall / frame |
|----------------------------------------|--------------|------------------|-----------------|--------------|
| **today**: 1080×1920 window, dpr 2     | 2160 × 3840  | 8.2 ms           | 2.9 ms          | 16.0 ms      |
| zoom 0.5, 540×960 window               | 1080 × 1920  | 4.2 ms           | 1.2 ms          | 8.3 ms       |
| zoom 0.25, 270×480 window              | 540 × 960    | 2.6 ms           | 0.8 ms          | 8.2 ms       |

Today's wall time breaks down as `capturePage` 11 ms (of which 8 are waiting), resize to preview
3.9 ms, `toBitmap` 0.2, `equals` 0.1, copy plus BGRA→RGBA swizzle 0.5, and seek 0.2. The page
seek is essentially free. The cost is `capturePage` at Retina backing-store size: 33 MB per
frame, read back and then shrunk 16× on the CPU to 540×960.

8.2 ms × 60 captures/s = 49% of main, which matches the measured 50%. So the table and the live
numbers describe the same thing.

On the renderer side, `createImageBitmap` for a 540×960 frame costs 0.40 ms p50 on the page's
main thread. The rest of the ~23% "ui" per composition is **not attributed** (see item 6).

### Extra draws

With the display at 121 Hz, the page requested animation frames at these rates during playback:

- video only: 120.6/s. This is the clock's tick; it composites 30 of them.
- video + 2 compositions: **178/s**.

The extra ~58/s are `compositions.onReady(() => this.redraw())` firing for every capture that
lands. Most of those are lookahead frames for moments not yet on screen, so each one composites
the frame already showing again, unchanged.

### Memory

- Paused, 1058 MB. By process:
  - editor renderer: 447 MB RSS, of which the JS heap is only 13 MB; the rest is decoded video,
    bitmaps and canvases;
  - main: 205 MB;
  - GPU process: 108 MB;
  - each composition window: ~120 MB. It is a whole renderer process painting a 2160×3840
    backing store.
- Playing both compositions adds ~190 MB: ui +45, gpu +74, main +75. The live composition cache
  has a 256 MB budget, and 2 compositions × 30 fps × 2 MB fills it in about two seconds. Of the
  frames it holds, 78–91% are copies of the picture beside them.

## The plan

### 1. Capture only when the picture changed (largest win)

**Change.** The seek script returns a signature of the page after seeking. A cheap choice is a
hash of `document.documentElement.outerHTML` plus the scroll position. The signature is only
valid when nothing can paint outside the DOM:

- `document.getAnimations().length === 0` (no CSS animations or transitions running on their own
  clock);
- no `<canvas>`, `<video>` or `<iframe>`.

A page that fails that check is captured on every frame, exactly as today. Then:

- **Main.** When the signature matches `entry.lastSignature`, skip `capturePage` and answer
  `{ held: true }` with no pixels.
- **Renderer.** Point the new cache key at the previous bitmap. The bitmap is shared and
  reference-counted, so `#store`'s `close()` needs a count.

This also makes the `held` flag mean something. Today main computes it with a Buffer `equals`
over every frame, and nothing in the renderer reads it.

**Expected** (an estimate from the counts above): captures fall from 61/s to about 9/s on this
project. Main's composition cost falls in proportion, from ~50% to ~7%, and so do the renderer's
IPC and bitmap work and the GPU process's readback. The cache would hold one bitmap per distinct
picture rather than one per frame.

**Export gets the same win.** `render.ts` goes through the same `frameAt`, so a caption track on
a 60 s export stops paying for about 1,400 identical captures.

**Contract.** `CompositionFrame.data` becomes optional when `held`, in `src/shared/ipc.ts` first.

**Proof it works** (from CLAUDE.md, a test must fail against the bug it guards):

- A page whose only change is a `<canvas>` draw must still be captured on every frame. Mutating
  the guard away must fail that test.
- A page with a CSS `@keyframes` animation must too.
- Positive control: the Spotlight page must report the same signature for two seeks inside one
  word, and a different one across a word boundary.

### 2. Capture at the size that will be drawn

**Change.** Set the composition window to the requested pixel size divided by
`devicePixelRatio`. Then `setZoomFactor(requested / (authored × dpr))`, so the CSS layout
viewport stays at the authored 1080×1920 while the backing store is exactly the requested size.
The resize step then disappears.

**Measured:** main 8.2 → 2.6 ms and GPU process 2.9 → 0.8 ms per frame at preview size. Export,
which wants authored pixels, would use `zoom = 1/dpr` and capture 1080×1920 directly instead of
capturing 2160×3840 and shrinking it (4.2 ms instead of 8.2).

**Trap, measured.** Chromium keeps the zoom level **per origin, across windows in the same
session**. In the bench, a window opened after a zoom-0.25 run laid the page out at **4320×7680**
CSS px, even though the new window never set a zoom. Every capture must set the zoom it needs,
and the viewport check must confirm `innerWidth` equals the authored width before capturing.
Otherwise a composition lays out at the wrong size and nothing errors.

Another thing to check: text rasterised at 0.25 zoom is hinted for that size. That is fine for
the preview. Export must stay at 1:1 pixels.

### 3. Don't redraw for frames not yet on screen

**Change.** While playing, the clock already composites 30 times a second. A composition
arriving should call `redraw()` only if the playback is paused, or if its key is the one the last
draw missed for the frame actually on screen. A lookahead frame for a later moment needs no draw.

**Expected:** 178 → about 121 animation-frame requests/s, which removes about 58 full composites
per second. `DRAW p50 0.2 ms` is main-thread time only. The canvas work lands in the GPU process,
so this is mostly a gpu-group saving.

**Proof:** compare animation-frame requests per second during playback with and without the
change (the `raf.js` probe in the appendix). Paused, a composition arriving must still draw. The
existing "stayed black while the playhead did not move" bug, described in the comment at
`engine/index.ts:174`, is the positive control.

### 4. Budget the live cache by time, not bytes

Live mode reads frames within `HOLD_US` (1 s) of the playhead and three ahead, so everything
older is dead weight. That dead weight currently sits in the cache until the 256 MB budget
evicts it. Evict live entries more than `HOLD_US` behind the playhead, or give live mode a
budget of about 2 × fps × (frames held). With item 1's sharing, the resident set becomes a
handful of distinct bitmaps.

**Expected:** most of the +190 MB seen while playing. Verify with the pool's own `stats.bytes`,
which is not reachable from the debug handle today; expose it through `bayEngine` first.

### 5. Close composition windows that are not near the playhead

Each window is a renderer process of about 120 MB, and `MAX_WINDOWS` is 8. That is up to ~1 GB
for a project with many compositions, even when none is on screen.

**Change.** Release windows not used for 30 s whose items are more than a few seconds from the
playhead. Reopening one costs a load, about the 40–80 ms the pool already hides behind held
frames. Paired with item 2, a window that stays open is also a quarter of the size, because its
backing store is.

### 6. Attribute the renderer's share before changing it

Each composition adds ~23% to the "ui" group, and 0.4 ms of that per frame is
`createImageBitmap`. The rest is not measured. The candidates are:

- deserialising the 2 MB structured clone in IPC;
- uploading bitmaps on the page's raster threads;
- React re-rendering on every `setPlayhead` (30/s): timeline, ruler, time display, and anything
  that subscribes too widely.

Profile with CDP `Profiler.start/stop` on the editor target over 5 s of playback, in the "video
only" and "video + subs" configurations, and compare. Item 1 cuts the IPC and bitmap parts by
the same ~85% without further work, so do this after 1–3 and profile what is left rather than
guessing now.

### 7. Video: leave it for now

The video-only row (20%) is the floor, and it is dominated by decode.

On this Mac the shared VideoToolbox decoder is saturated by other processes: mediaanalysisd,
MetaTrader/Wine and Spotlight. A hardware seek measured 6076 ms, against 87 ms in software. That
is environmental, and it is recorded in `test/app/README.md`. Re-measure on a quiet machine
before optimising decode.

## Order and expected result

| step | touches | main | gpu | ui | memory |
|------|---------|------|-----|----|--------|
| 1 capture on change | `html/compositions.ts`, `html/scripts.ts`, `ipc.ts`, `compositionPool.ts` | −85% of comp cost | −85% readback | −IPC/bitmap share | cache mostly shared |
| 2 capture at draw size | `html/compositions.ts` | −68% per capture | −72% per capture | — | −~90 MB per window |
| 3 redraw only for on-screen | `engine/index.ts`, `compositionPool.ts` | — | −~58 composites/s | small | — |
| 4 time-based live cache | `compositionPool.ts` | — | — | — | most of +190 MB |
| 5 close idle windows | `html/compositions.ts` | — | — | — | ~120 MB per window |
| 6 profile ui | — | — | — | decides next | — |

This is an estimate, not a measurement. Items 1 and 2 together put main's composition cost at
about 9 captures/s × 2.6 ms ≈ 2.5% of a core, down from 50%. The report's 87% configuration
would land at about 30–35% total, most of it video decode.

Re-measure with the same table (configurations × 5 s averages) after each step. A step whose
number does not move has not done what this document says it would.

## Appendix: how these were measured

- **Per-configuration table.** Played from frame 300, hiding tracks with `patchTrack`:
  `window.bay.app.metrics()` was called once after 1.2 s to reset Electron's CPU window, then
  read 5 s later. That is the same source as the HUD, multiplied by 15 cores.
- **Seeks per second and distinct pictures.** Wrapped `window.__timelines[id].time` inside each
  composition page (agent-browser tabs t2 and t3). The wrap counts calls, and counts changes in
  `document.body.innerHTML`. Neither page uses CSS animations, canvas or video, so an unchanged
  DOM means an unchanged picture for these two. That is exactly the condition item 1 checks.
- **Capture bench.** A standalone Electron script that runs `compositionFrameAt`'s steps on each
  composition file: seek, `capturePage`, `resize('better')`, `toBitmap`, `equals`, copy and
  swizzle. It collects per-step p50s and CPU per frame per process type from `cumulativeCPUUsage`
  (`getAppMetrics`). Two "today" runs agreed within 1 ms, which is the repeatability control.
  Nothing in `src/` was changed to take these numbers.
- **Animation-frame count.** Wrapped `window.requestAnimationFrame` for 5 s of playback, with the
  composition tracks hidden, then shown. The display rate was measured by a bare 1 s rAF chain
  (121 Hz).
