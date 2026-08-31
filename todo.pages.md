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
| P1 | **Carve `editor_view.rs`** into `editor/{mod,toolbar,panels,inspector,timeline,viewer,transport}.rs`. Behaviour-free. `EditorView` moves into `editor/mod.rs` with the regions as **child** modules — siblings cannot see its ~50 private fields. **This unblocks every page body.** | `bay-ui` | carve-agent | **done** — `editor/{mod,toolbar,panels,inspector,timeline,viewer,transport}.rs`, 231 `bay-ui` tests unchanged |
| P2 | **M7's frame budget.** Never measured, and it is the one number M7 owed. A real figure, the machine, and 4K behaviour. If it does not fit an interactive budget, say the sampling stride out loud rather than sampling quietly. | `bay-preview` | p2-scopes | **done** — [`benchmarks.md`](docs/native/benchmarks.md#scopes--the-color-pages-four-reductions). Four live scopes fit a preview frame (0.98 ms of 16.6); they do not fit at 4K (35 ms), where a caller must pass `stride`. At the 640×360 the preview actually composites it is 0.98 ms. `ScopeSet` lets a page pay only for the scopes it shows, but that is a weak lever — the pass is bound by the buffer walk all four share, so dropping the dearest saves 24% where stride 4 saves 94%. Dropping the vectorscope's per-pixel `hypot` took 27% off every reading bay takes. |
| P3 | **Lift/gamma/gain shader.** Needs a new WGSL pass *and* a widened uniform struct — `EffectUniformBuffer` is 2+2+4+4 floats and the identical struct is declared in every shader. Engine only; the Color page wires it later. | `bay-effects` | p3-grade | **done** — `lift_gamma_gain.wgsl`, all six places wired (shader, pipeline, packer, `effect_groups`, `SUPPORTED_EFFECTS`, the `fx.balance` tile). The struct was *not* widened: a third buffer type fronts the same bind group layout, the way `color_stack.wgsl` already does. Convention is stated in the shader header — lift holds white, gamma holds both ends, gain holds black, `.w` is each wheel's master. Verified on GPU: neutral is byte-exact identity, each wheel moves only the end it claims, and gain alone is byte-identical to `brightness`, which pins the clamp where it already was. |

## Where it stands — 2026-08-27, team paused

Everything below **compiles and has unit tests. None of it has been looked at on screen.** That
distinction is the whole reason this repo splits its roadmap by state, and it is the one thing to
carry forward.

| | State |
|---|---|
| P1 carve `editor_view.rs` | **done** — six regions, `mod.rs` 5,332 → 1,530, proven behaviour-free |
| P2 scope frame budget | **done** — 0.98 ms for four scopes at 640×360, `benchmarks.md` |
| P3 lift/gamma/gain | **done** — all six enforced places, gain proven byte-identical to `brightness` |
| P4 Media page | **code landed, unseen** — shows only what `MediaAsset` can fill; fps/codec drawn disabled |
| P6 Motion page | **code landed, unseen** — a row per animatable path, keyed or not |
| P7 Audio page | **code landed, unseen** — faders on the six real commands; meters dark on purpose |
| P8 Deliver page | **code landed, unseen** — export off the UI thread via `slow::run`, so it passes `render_gate`; toolbar's two exports deleted |
| P5 Cut page | **not started** |
| P9 Color page | **not started** — still a placeholder |

## What has to happen next, in order

1. **A full gate on a quiet tree.** The last green one was `d60f379`. Everything since is
   per-crate or unverified. Four files were mid-edit when the team stopped.
2. **A visual check of every page**, 1440×900 and small. Never done, and it is the only
   verification a layout migration actually needs.
3. **Wire the streaming audio engine to playback** — `fixes.md` entry 15. Until then the Audio
   page's faders change the next play, not the current one.
4. **P5 Cut**, then **P9 Color** — the last two pages.

## What the parallel run cost, and what it bought

Worth recording because the answer is not one-sided.

**It worked while the work was in different crates.** M5, M7, M9 and the pass-collapse ran
genuinely concurrently and landed clean, because a keyframe engine, a scope reduction and an audio
mixer do not touch each other's files.

**It stopped working when everything moved into `bay-ui`.** One working tree, one `editor/mod.rs`,
one cargo build lock, and one `bay` single-instance port. Agents queued on the lock, blocked on
each other's half-written files, and — the sharp one — an agent launching `bay` could silently
focus *another agent's window* and report on a page it had never rendered.

The lesson is not "don't parallelise". It is that **the unit of parallelism is the crate, not the
task**, and that shared mutable resources — a file, a lock, a port, a window — are what decide it.
