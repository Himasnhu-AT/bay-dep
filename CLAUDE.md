# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**bay** — a video editor. There are **two trees**, and which one you are in decides everything:

- **`/` (repo root) — the product that ships.** An Electron app: React 19 + Vite 7 + Tailwind 4 +
  TypeScript. Main process owns the filesystem, ffmpeg and persistence; the renderer owns the
  interface and the compositing engine; `src/shared/` holds the contracts both are checked against.
- **`dep/rust/` — the native engine, still live.** The Rust workspace (GPUI shell over a wgpu
  compositor, effects, masks, audio, text, project model, tick math, plus `bay-mcp`). It was moved
  here, not retired: work on it continues in parallel and it is expected to come back.

**Read the section that matches the tree you are editing.** The Electron conventions are directly
below; everything from "Architecture" onward describes `dep/rust/` and its paths are relative to
that directory unless stated otherwise.

See [`README.md`](./README.md), [`todo.md`](./todo.md) — which indexes
[`todo.completed.md`](./todo.completed.md), [`todo.pending.md`](./todo.pending.md) and
[`todo.testing.md`](./todo.testing.md) — and `docs/native/`.

## Commands — the Electron product (repo root)

```bash
pnpm install          # pnpm, not npm — the workspace standard for TS projects
pnpm dev              # electron-vite dev server + app, with HMR in the renderer
pnpm build            # typecheck, then build main/preload/renderer into out/
pnpm typecheck        # tsc over both projects; the renderer and node halves are separate
pnpm test             # the whole suite, on node:test — no test framework in the tree
pnpm pack             # unpacked app bundle, for checking real app identity
pnpm dist             # signed/packaged artifact via electron-builder
```

`pnpm test` uses Node's built-in runner against Node 26's native type stripping, so no test
framework enters the dependency tree. The `--import ./src/test-hooks.mjs` is a small resolver
hook: Node's resolver wants `./serve.ts`, while the project is on `moduleResolution: bundler`
where extensionless imports are correct and every other module is written that way. The hook
keeps that oddity in one place rather than setting `allowImportingTsExtensions` across the whole
build to suit a handful of files. It sits at `src/` because both halves test through it — main
and the renderer's engine — and a shared tool filed under one consumer reads as that consumer's
private detail.

**The glob is `src/**` and must stay that way.** It was `src/main/**` for one commit, during which
the renderer's frame-pacing tests existed, passed, and were never run — `pnpm test` reported 18/18
and would have stayed green no matter what happened in the other 13, because from Node's point of
view those files did not exist. Nothing reports a skip for a file a glob never matched. If you add
tests somewhere new, check the count moves.

**A test must be proven to fail against the bug it guards.** The `bay://` suite was mutation-tested
before it was trusted — six deliberate regressions, five caught. The sixth passed: the traversal
test built its specimen with `path.join(dir, '..', 'secret.txt')`, and `join` normalises its own
result, so the test handed the code an already-clean path and asserted on it. Deleting the path
normalisation it existed to protect changed nothing. A green test over the exact bug it guards is
worse than no test, because it is also a claim that the bug cannot happen. The rewrite builds the
path by concatenation and asserts up front that the specimen defeats a naive prefix check, so it
cannot quietly stop testing anything again. Write that assertion into any test guarding a check.

`pnpm typecheck` runs **two** projects — `tsconfig.node.json` (main + preload + shared) and
`tsconfig.web.json` (renderer + shared). A change to `src/shared/` is checked by both, which is the
point: it is the only code that crosses the process boundary.

`out/` is gitignored, as is `node_modules/`. `strict` and `noUncheckedIndexedAccess` are on in both
projects — indexing an array yields `T | undefined` and you must handle it.

## Conventions — the Electron product

- **`src/shared/` is the contract, and it is written before the implementation.** `project.ts` is
  the model, `ipc.ts` is every call the renderer may make into main. If the preload bridge, a main
  handler and a React component disagree, it is because someone added a channel without adding it
  here. Don't.
- **Timeline time is frames at the timeline's fps, never seconds.** Source offsets into media are
  microseconds, because the source has a frame rate we do not control. The conversions live in
  `project.ts` and are the only place the two are allowed to meet.
- **Assets are the "what", items the "where and when".** One asset backs many items. Moving a clip
  must never touch the asset.
- **Every project mutation goes through the store's `edit()`**, which snapshots for undo and stamps
  `updatedAt`. Poster and waveform arrivals pass `{ silent: true }` — they are not edits and must
  not land on the undo stack.
- **The renderer never touches the filesystem.** Media reaches it over the `bay://` protocol, which
  serves only allowlisted paths and must honour HTTP Range requests — `<video>` seeking is broken
  without them, and that is the most common way this goes wrong.
- **Nothing reaches the network.** No telemetry, no analytics, no remote fonts or images. The CSP in
  `src/renderer/index.html` permits no remote origin; loosening it is a product decision, not a fix.
- **Subscribe narrowly to the store** (`useEditor((s) => s.playhead)`), never wholesale, or every
  component re-renders at the frame rate during playback.
- **Playback is driven by wall-clock elapsed time, not by counting rAF callbacks**, and composites at
  the *project's* fps rather than the display's. Counting callbacks makes playback correct at 60Hz
  and double speed at 120Hz; compositing per refresh makes a 120Hz screen pay four times over to show
  30fps of footage. A frame-rate probe must therefore count **pictures**, not ticks — a tick that
  redraws the same image is indistinguishable from a new frame, so "p99 2ms" is entirely compatible
  with a picture updating four times a second.

## Commands — the Rust engine (`dep/`)

```bash
dep/run.sh            # debug build + launch — fastest loop
BAY_UI_FRAMETIME=1 RELEASE=1 dep/run.sh   # frame pacing: ticks/s, pictures/s, playback counters
RELEASE=1 dep/run.sh  # release build — much smoother playback
dep/build.sh          # release build of the desktop app
dep/test.sh           # fmt --check + clippy --workspace --all-targets -D warnings + cargo test
SLOW=1 dep/test.sh    # also run the 40 tests that drive the Kokoro sidecar or load SigLIP
STRICT=1 dep/test.sh  # turn GPU/ffmpeg skips into hard failures for capability verification
BAY_ONLINE=1 dep/test.sh   # let cargo reach the network — only needed after changing a dependency

cd dep/rust && env -u CARGO_TARGET_DIR cargo test --workspace
```

These scripts resolve `$ROOT/rust` relative to themselves, so they kept working after the move;
`$REPO` was introduced for the few paths that point at the repo root (`script/`, `dist/`).

**Forty tests are `#[ignore]`d and run only under `SLOW=1`** — `bay-speech/tests/{kokoro,lifecycle}.rs`,
`bay-mcp/tests/captions.rs`, `bay-vision/tests/encode.rs`, and `bay-mcp`'s `narration_tests`. They
drive the Kokoro TTS sidecar or load the SigLIP model. The reason is **flakiness, not speed**:
`fixes.md` entry 13 records that the narration tests hardcode ports 7451/7452 and fail whenever a
`bay --mcp` is already running, and a test that fails for reasons outside the repository teaches
people to re-run until green. `cargo test` prints them in its own `ignored` count, so this never
reads as a pass. **Run `SLOW=1 ./test.sh` before anything ships, and after touching `bay-speech`,
`bay-vision` or the MCP server.**

The saving is smaller than it looks and the numbers are worth knowing before optimising further:
the whole suite spends only **111 s executing** (94 binaries; the two heaviest are
`bay-speech/tests/kokoro.rs` at 30 s and `bay-preview/tests/render.rs` at 21 s). A gate run is
dominated by **compilation**, not by tests, so deferring the sidecar set is worth about 7% of wall
clock. `render.rs` deliberately stays in every run — 70 tests at 0.3 s each, and it is what
verifies the render path.

**`cargo nextest` is not a speedup here — it is 3.5× slower.** Measured on `bay-ui`:
`cargo test` 34.9 s wall / 3.3 s sys, `cargo nextest run` 122.6 s wall / 330.8 s sys. It forks a
process per test, so each of bay-ui's 311 GPUI tests pays a full app startup that `cargo test`
amortises across the binary. The 100× system time is that cost. Do not reach for it again without
re-measuring.

`test.sh` runs **`--offline`** and **`CARGO_INCREMENTAL=0`** by default, and both defaults exist
for a reason. Cargo's `.package-cache` lock lives in `$CARGO_HOME` and is shared by *every*
workspace this user builds, so two checkouts compiling at once take turns rather than running in
parallel and each stalls whenever the other holds it — but that lock is only taken for registry
access, so `--offline` sidesteps it entirely. `Cargo.lock` is committed and the registry is warm,
so nothing needs fetching. Incremental compilation buys nothing for a one-shot gate run and its
cache reached 20 GB here, which is how a disk filled up mid-session.

Always remove `CARGO_TARGET_DIR` from direct Cargo invocations. The agent shell points it at a
sandbox cache, bypassing the 89 GB warm `rust/target`; rebuilding `whisper-rs-sys` there fails
because the cached `whisper.cpp` source is incomplete. Use
`env -u CARGO_TARGET_DIR cargo ...`, never a second custom target directory. The repository
scripts already do this.

ffmpeg is required for decode, probing, waveforms, and MP4 export. bay installs its own when
asked (`bay-provision`) and otherwise uses whatever is on the machine; without either, text and
images still work and the rest must degrade with a message — never fail silently.

Before claiming anything passes, run `./test.sh`. Clippy is `-D warnings`; a warning is a failure.
Read its **real** exit code — piping it to `tail` and reading the pipe's status hides failures,
and a `./test.sh` run from the wrong directory exits 127 while looking like it did nothing wrong.

When several agents share this tree, scope commands to the crates you own (`cargo clippy -p …`)
and **never** run `cargo fmt --all` — it rewrites other people's in-flight files. The full gate is
the lead's job, on a quiet tree.

## Architecture — the Rust engine

Everything from here to the end of the file describes `dep/rust/`. Paths are written relative to
`dep/`, so `rust/crates/bay-ui` on disk is `dep/rust/crates/bay-ui`. None of it applies to the
Electron product at the repo root.

```
rust/
├── desktop/          the binary — thin; calls bay_ui::run()
├── crates/
│   ├── bay-ui        GPUI application shell — mid-migration to six pages, see below
│   │                  page.rs — the six pages and the bar's responsive ladder, GPUI-free
│   │                  draw.rs — the only place bay draws something that is not a box
│   │                  controls.rs, drag.rs — slider/drag-number/popover, one drag abstraction
│   │                  editor/ — the editor carved into regions; one file per page
│   ├── bay-core      editor model + orchestration
│   ├── bay-project   project format, serialization, web↔native interop
│   ├── bay-settings  account/session, providers, model routing, MCP access, compute — the
│   │                  settings screen's state, headless because the MCP server enforces it
│   ├── bay-preview   preview rendering, decode planning, caching
│   │                  scopes.rs — waveform/parade/vectorscope/histogram, CPU over the readback
│   │                  waveform.rs — peak extraction off the interactive render path
│   ├── compositor, gpu, effects, masks    the wgpu render path
│   ├── bay-audio     mixing, loudness, beats, silence — and stream.rs, the callback
│   │                  block mixer a fader and a meter need to be real
│   ├── bay-text, bay-speech
│   ├── bay-vision   SigLIP image↔text embeddings (Candle, in-process, CPU)
│   ├── bay-stock    searching the open image archives; the one crate that talks to a
│   │                  third party, and only when a tool call asks it to
│   ├── bay-provision installs bay's own runtimes (ffmpeg, Python, Kokoro) from a
│   │                  pinned, SHA-256-verified manifest — the user installs nothing
│   ├── time              MediaTime tick math
│   ├── bay-mcp       the engine as an MCP server (`bay --mcp`; JSON-RPC over std::net)
│   └── native-preview, bridge, test-support
└── wasm/             bindings consumed by the legacy web app
```

The governing split (from `AGENTS.md`): **`rust/` owns all non-UI logic; a UI shell owns rendering,
interaction, and platform concerns but never owns logic.** The UI framework for any given front end
is a replaceable detail — which is why the same engine drives the GPUI app, the wasm/web build, and
the MCP server. Logic is never duplicated between front ends.

## Conventions and judgment calls

- **Never put logic in the UI crate that a headless client would need.** If the MCP server or a test
  can't reach it, it's in the wrong crate. The settings screen is the standing temptation: "which
  MCP tools may an agent call" looks like a checkbox but is enforced by `bay --mcp` with no window
  open, so it lives in `bay-settings` and the view only draws it.
- **A control must do what it says.** The panel palettes come from `bay-core::blocks`, which only
  names effects the compositor compiles — a tile adding an effect nothing renders is a dead
  control discovered after an export comes back unchanged. Same rule for accounts and cloud
  compute: neither exists in this build, so both refuse with the reason rather than appearing to
  work. `bay-mcp`'s `tool_vocabulary` test enforces the settings pane and the server agreeing on
  what a tool is called, in both directions.
- **Decode never runs on the *interactive* render path.** A long clip must not freeze `render()`;
  preview decodes are planned on a worker and awaited explicitly. **Export is the exception, by
  design:** it streams each clip at source resolution through `ClipStream` and decodes inside its
  own frame loop. It does *not* call `await_decodes` — that would start preview-intent decodes of
  clips the export will never read. Export is not interactive, and a 4K clip cannot be
  pre-decoded into a memory budget at all.
- **Preview and export plan decode differently, on purpose** (`DecodeIntent`). Preview is a
  ≤480px, budget-bounded cache so scrubbing is instant; export is source resolution at the
  delivered frame rate, streamed. Collapsing them is how a 4K export came to be a 480px cache
  upscaled 8×.
- **Cache budgets are global, not per clip.** An LRU byte budget across all clips — regressing this
  means N clips get N budgets. The budget applies to the *preview* cache; export holds one frame
  per on-screen clip and nothing more.
- **The render path cannot panic on bad input.** NaN/±inf transforms and tiny canvases (1×1, 8×4) are
  tested; keep them tested.
- **Project wire format is kebab-case** and pinned by serde round-trip tests — it is the web↔native
  interop contract. Don't change a field name without updating both sides.
- **Missing GPU or ffmpeg skips gracefully by default** (`BAY_REQUIRE_GPU` / `BAY_REQUIRE_FFMPEG`
  turn skips into failures). Don't remove the graceful path, and don't let a skip masquerade as a pass
  when reporting results. Provisioning follows the same rule under `BAY_PROVISION_LIVE`.
- **Nothing downloads unless the user asks.** `bay-provision` detects and offers; it never fetches
  on its own initiative, and every artifact is verified against a pinned SHA-256 before install.
  A new artifact needs an immutable URL and a redistributable licence — both are enforced by tests.
- **Never run a toolchain build that was not tested.** A copy of ffmpeg bay did not install must
  clear the manifest's `minimumVersion`, and one that will not report a version does not clear it.
  Raising that floor makes bay download onto machines that were working — do it for a real
  incompatibility, and say which one in the manifest.
- **A test must never depend on a shared machine resource.** The registry tests took the real
  agent port and failed whenever a `bay --mcp` was running; a test that fails for reasons outside
  the repository teaches people to re-run until green, which is how a real failure gets ignored.
- Every substantive fix in the parity effort is recorded with what it was and what verifies it —
  follow that pattern in [`docs/native/parity-status.md`](docs/native/parity-status.md).
- **The UI is mid-migration to six pages behind one bar** — Media · Cut · Motion · Color · Audio ·
  Deliver. **It is under development and no page has had a visual check.** The contract, and a
  table of what is actually built versus what is not, is [`docs/native/pages.md`](docs/native/pages.md);
  the work queue is [`todo.pages.md`](todo.pages.md). Do not describe a page as working on the
  strength of its unit tests — that error has already been made here once, in an audio engine whose
  tests all passed and which nothing called. The rules bind regardless: a page is a *method* on
  `EditorView`, never its own GPUI view (the moment it is, the `PreviewRenderer` and its atlas
  bookkeeping, audio, waveforms and undo history all have to be hoisted); the global playhead
  survives a page switch; and a control the engine cannot back is drawn **disabled**, not hidden —
  the disabled controls are the map of the remaining engine work.
- **Never ask for a frame with `cx.notify()` from inside `render`.** GPUI's
  `WindowInvalidator::invalidate_view` sets the dirty flag *only* when
  `draw_phase == DrawPhase::None`, and `render` is the draw phase — so a `notify` issued there
  records the view in `dirty_views` and never marks the window dirty, while the display-link
  callback draws only `if invalidator.is_dirty()`. The frame is silently not requested. This is
  not theoretical: it made the transport a slideshow while dragging the playhead over the same
  clip stayed perfectly smooth, and the frame-time probe reported a healthy p99 the whole time
  because it counted *ticks*, not pictures. Use `EditorView::request_frame`, which is
  `window.request_animation_frame()` without the `current_view()` unwrap that panics under
  `VisualTestContext::draw`.
- **The preview draws at the project's frame rate, not the display's refresh rate.** The composite
  signature hashes `preview_playhead()` — the playhead quantised by
  `geometry::quantize_to_frame` — and `submit_composite` is handed the same value. Hashing raw
  `MediaTime` ticks (120,000 a second) makes every display refresh a new signature, so a 120 Hz
  screen paid for a full composite, readback, `RenderImage` and atlas tile 120 times a second to
  show 30 fps of footage: measured at `pictures 120.0/s` against `30.0 new frames/s`, three
  composites in four identical to the one before. Two playhead positions inside one frame *are*
  one picture. Worse when the playhead is past the last clip — nothing bounds a project's duration
  to its video, so one long audio clip had playback compositing an empty frame 120 times a second
  for 51 minutes.
- **A frame-rate probe must count pictures, not ticks.** A render tick that redraws the same
  image is indistinguishable from one that shows a new frame, so "p99 2.05 ms over 120 frames" is
  entirely compatible with a picture updating four times a second. `BAY_UI_FRAMETIME=1` now
  reports `pictures/s` beside `ticks/s`, and `bay-bench`'s wall-clock playback case exists for
  the same reason — the fixed-step case answers "how expensive is one frame" and cannot see how
  many reach the screen.
- **The playback window is bounded ahead as well as behind, and ahead is the memory bound.**
  Draining a `sync_channel` until empty does not inherit its backpressure — emptying it frees the
  worker to refill it, so the real limit becomes ffmpeg's speed. The decoder runs ~500 fps against
  a playhead at 24, which grew the window by ~475 frames/s at half a megabyte each: 1.5 GB in six
  seconds, measured. `Worker::drain` stops at the window edge and leaves the rest in the channel.
- **Vector geometry is a path; a density plot is a raster; nothing else uses an image.** Decided
  and measured in [`docs/native/drawing.md`](docs/native/drawing.md) — 80 µs for a 1,000-point
  polyline. Five surfaces depend on it (curve editor, scopes, wheels, tall waveforms, EQ). Do not
  re-open it, and if you take the image route anywhere, you inherit the `retired_images` /
  `window.drop_image` obligation.
- **8-bit intermediates stay**, deferred with a named trigger in
  [`docs/native/intermediate-format.md`](docs/native/intermediate-format.md). Every source uploads
  as RGBA8, so a wider buffer has nothing extra to carry, and the unorm target's hardware clamp is
  currently load-bearing — `brightness.wgsl` returns unclamped and relies on it. Collapsing
  consecutive scalar passes bought more precision than widening would have: 64 → 256 distinct
  levels through a squeeze-and-stretch.
- **Adding a field to a widely-constructed type stops the whole workspace.** Rust struct literals
  are exhaustive, so one new field on `Keyframe` broke every literal in four crates at once. Give
  such types a constructor (`Keyframe::new`), run `cargo check --workspace` after *each* field, and
  make sure the default samples identically to its absence — a default that quietly alters
  interpolation changes the motion of every project ever saved.
- **A test must not depend on a shared machine resource**, and the resource is rarely the obvious
  one. The registry tests' scratch *directory* was keyed by test name with no pid, so two test
  binaries wiped each other's state (11 of 12 concurrent runs failed; 0 of 16 after). The port
  beside it already had the fix and the directory never got it.
- **Read the errno, not the message.** Two narration tests fail with
  `Resource temporarily unavailable`, which reads like a disk problem and is not: ENOSPC is 28,
  EAGAIN is 35, and this is a 300 s `SO_RCVTIMEO` read timeout waiting on the Kokoro sidecar.
  Recorded in `fixes.md`; it blocks nothing.
- **Never leave a detached script running.** One agent backgrounded a build script that outlived
  it, held the cargo lock for hours and respawned `cargo` after the session that owned it had died.
- [`fixes.md`](fixes.md) is the register of controls that do not do what they say — a tile naming
  an effect nothing renders, a validator accepting a channel nothing reads, a schema hiding an
  effect the engine has. Add to it rather than fixing quietly, and record what would verify each.

