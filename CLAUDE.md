# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**vii** — a native macOS video editor. A Rust workspace under `rust/`: a GPUI desktop shell
(`vii-ui`, reached by a 5-line `rust/desktop/src/main.rs`) over a platform-agnostic engine (wgpu
compositor, effects, masks, audio, text, project model, tick math), plus `vii-mcp`, which exposes
the same engine as an MCP server.

**`rust/` is the product.** The JS/web stack this was forked from used to live in `dep/` as a
parity reference; it has been deleted.

See [`README.md`](./README.md), [`todo.md`](./todo.md) and `docs/native/`.

## Commands

```bash
./run.sh              # debug build + launch — fastest loop
RELEASE=1 ./run.sh    # release build — much smoother playback
./build.sh            # release build of the desktop app
./test.sh             # fmt --check + clippy --workspace --all-targets -D warnings + cargo test
STRICT=1 ./test.sh    # turn GPU/ffmpeg skips into hard failures (what CI's mac job does)

cd rust && cargo test --workspace     # cargo runs from rust/, never the repo root
```

`ffmpeg` on `PATH` is required for decode, probing, waveforms, and MP4 export. Without it, text and
images still work and the rest must degrade with a message — never fail silently.

Before claiming anything passes, run `./test.sh`. Clippy is `-D warnings`; a warning is a failure.

## Architecture

```
rust/
├── desktop/          the binary — thin; calls vii_ui::run()
├── crates/
│   ├── vii-ui        GPUI application shell (the editor UI)
│   ├── vii-core      editor model + orchestration
│   ├── vii-project   project format, serialization, web↔native interop
│   ├── vii-preview   preview rendering, decode planning, caching
│   ├── compositor, gpu, effects, masks    the wgpu render path
│   ├── vii-audio, vii-text, vii-speech
│   ├── time              MediaTime tick math
│   ├── vii-mcp       the engine as an MCP server (`vii --mcp`; JSON-RPC over std::net)
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
- **Decode never runs on the render path.** A long clip must not freeze `render()`; decodes are
  planned and awaited explicitly (export calls `await_decodes()` before encoding).
- **Cache budgets are global, not per clip.** An LRU byte budget across all clips — regressing this
  means N clips get N budgets.
- **The render path cannot panic on bad input.** NaN/±inf transforms and tiny canvases (1×1, 8×4) are
  tested; keep them tested.
- **Project wire format is kebab-case** and pinned by serde round-trip tests — it is the web↔native
  interop contract. Don't change a field name without updating both sides.
- **Missing GPU or ffmpeg skips gracefully by default** (`VII_REQUIRE_GPU` / `VII_REQUIRE_FFMPEG`
  turn skips into failures). Don't remove the graceful path, and don't let a skip masquerade as a pass
  when reporting results.
- Every substantive fix in the parity effort is recorded with what it was and what verifies it —
  follow that pattern in [`docs/native/parity-status.md`](docs/native/parity-status.md).

