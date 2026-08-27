# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**bay** — a native macOS video editor. A Rust workspace under `rust/`: a GPUI desktop shell
(`bay-ui`, reached by a 5-line `rust/desktop/src/main.rs`) over a platform-agnostic engine (wgpu
compositor, effects, masks, audio, text, project model, tick math), plus `bay-mcp`, which exposes
the same engine as an MCP server.

**`rust/` is the product.** The JS/web stack this was forked from used to live in `dep/` as a
parity reference; it has been deleted.

See [`README.md`](./README.md), [`todo.md`](./todo.md) — which indexes
[`todo.completed.md`](./todo.completed.md), [`todo.pending.md`](./todo.pending.md) and
[`todo.testing.md`](./todo.testing.md) — and `docs/native/`.

## Commands

```bash
./run.sh              # debug build + launch — fastest loop
RELEASE=1 ./run.sh    # release build — much smoother playback
./build.sh            # release build of the desktop app
./test.sh             # fmt --check + clippy --workspace --all-targets -D warnings + cargo test
SLOW=1 ./test.sh      # also run the 40 tests that drive the Kokoro sidecar or load SigLIP
STRICT=1 ./test.sh    # turn GPU/ffmpeg skips into hard failures for capability verification
BAY_ONLINE=1 ./test.sh   # let cargo reach the network — only needed after changing a dependency

cd rust && env -u CARGO_TARGET_DIR cargo test --workspace
```

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

## Architecture

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

