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
STRICT=1 ./test.sh    # turn GPU/ffmpeg skips into hard failures (what CI's mac job does)

cd rust && cargo test --workspace     # cargo runs from rust/, never the repo root
```

ffmpeg is required for decode, probing, waveforms, and MP4 export. bay installs its own when
asked (`bay-provision`) and otherwise uses whatever is on the machine; without either, text and
images still work and the rest must degrade with a message — never fail silently.

Before claiming anything passes, run `./test.sh`. Clippy is `-D warnings`; a warning is a failure.

## Architecture

```
rust/
├── desktop/          the binary — thin; calls bay_ui::run()
├── crates/
│   ├── bay-ui        GPUI application shell (the editor UI)
│   ├── bay-core      editor model + orchestration
│   ├── bay-project   project format, serialization, web↔native interop
│   ├── bay-preview   preview rendering, decode planning, caching
│   ├── compositor, gpu, effects, masks    the wgpu render path
│   ├── bay-audio, bay-text, bay-speech
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
  can't reach it, it's in the wrong crate.
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

