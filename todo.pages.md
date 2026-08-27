# bay — the six-page editor

Tracking file for the Resolve-style page migration. **Agents: claim an item by putting your name
in Owner, update this file as you go, and commit it with your work.** A commit that changes code
and not this file leaves the next person guessing.

Contract: [`docs/native/pages.md`](docs/native/pages.md). Plan and standing rules:
`~/.claude/plans/drifting-floating-fern.md`. Defect register: [`fixes.md`](fixes.md).

## Done — verified by a green `./test.sh` at `d60f379` (1577 passed, 0 failed, no skips)

| | What it bought |
|---|---|
| M0 | The defects six pages would have multiplied — waveform decode off `render()`, the group-animate lying control, the missing LUT tile, the `drop-shadow` schema drift |
| M1 | The widget and drawing layer. `docs/native/drawing.md`: paths for vector geometry, raster only for density plots, 80 µs per 1,000-point polyline |
| M2 | **The page bar.** `page.rs` is GPUI-free; the whole responsive ladder is `BarLayout::for_width` |
| M5 | Keyframe engine — bezier handles, `animatable_paths`, the descriptor table, `Keyframe::new` |
| M7 | Scopes — waveform, parade, vectorscope, histogram, as a CPU reduction over the existing readback |
| M9 | Streaming audio — callback block mixer, ring buffer, pan, track gain/solo, metering |
| — | Scalar effect passes fused: 64 → 256 distinct levels through a squeeze-and-stretch |
| — | ProRes master at profile 4 / `yuv444p10le`: 1px coloured strokes lost 61 code values at 422 HQ, 0 at 4444 |

## Now — wave 1, running in parallel because the crates do not overlap

| # | Item | Crate | Owner | State |
|---|---|---|---|---|
| P1 | **Carve `editor_view.rs`** into `editor/{mod,toolbar,panels,inspector,timeline,viewer,transport}.rs`. Behaviour-free. `EditorView` moves into `editor/mod.rs` with the regions as **child** modules — siblings cannot see its ~50 private fields. **This unblocks every page body.** | `bay-ui` | carve-agent | in progress |
| P2 | **M7's frame budget.** Never measured, and it is the one number M7 owed. A real figure, the machine, and 4K behaviour. If it does not fit an interactive budget, say the sampling stride out loud rather than sampling quietly. | `bay-preview` | — | pending |
| P3 | **Lift/gamma/gain shader.** Needs a new WGSL pass *and* a widened uniform struct — `EffectUniformBuffer` is 2+2+4+4 floats and the identical struct is declared in every shader. Engine only; the Color page wires it later. | `bay-effects` | — | pending |

## Next — wave 2, page bodies, parallel once P1 lands

Each owns `editor/<page>.rs` and touches `editor/mod.rs` only to register itself.

| # | Item | Also needs | State |
|---|---|---|---|
| P4 | **M3 Media** — storage tree, pool with bins, thumbnail + list, dual viewers, metadata | `MediaAsset` has no fps and no codec: add them serde-default with `probe.rs` parsing, or show duration and resolution only. Do not draw rows the model cannot fill. | pending |
| P5 | **M4 Cut** — source tape, whole-program ribbon over zoomed detail sharing a playhead but not a zoom, the smart-edit set | First page to inset a lane, so `lane_origin_x()` gets threaded — with a test that scrubs and razors at a nonzero origin | pending |
| P6 | **M6 Motion** — curve + keyframe editor, layer composition, masks and shapes | A row per animatable path **animated or not**, with a rest line, or the page is empty for every un-animated clip | pending |
| P7 | **M10 Audio** — Fairlight mixer on M9's engine, tall tracks, automation lanes | `LANE_HEIGHT` is a compile-time constant hit-testing reads; resizable tracks make it state | pending |
| P8 | **M11 Deliver** — settings, range, queue | **Precondition:** export runs synchronously on the UI thread, so a progress bar cannot move. Delete `export_video`/`export_frame` from the toolbar in the same milestone — two output paths, one bypassing `render_gate`, is the defect this closes | pending |
| P9 | **M8 Color** — clip strip, gallery, node list, scopes, palettes | XL. Free win: `SceneEffect` is fully implemented in the compositor and constructed nowhere — that is the adjustment layer at zero shader cost | pending |

## Outstanding regardless

- **The visual check.** Nothing in the Done table above has been looked at. `./run.sh`, at 1440×900
  **and** at a small window, per page. For a layout migration this is the verification no test
  substitutes for.
- Four open defects in [`fixes.md`](fixes.md), none blocking.
