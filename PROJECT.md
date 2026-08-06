# vii — project overview

> **Note on the README:** the top-level `README.md` is inherited from upstream OpenCut and is stale —
> it still describes the archived web codebase as the product. **The Rust workspace under `rust/` is
> the product.** Treat this file, `ARCHITECTURE.md`, and `docs/native/` as current.

## What it is

vii is a **native macOS video editor** built as a Rust workspace: a GPUI desktop shell over a
platform-agnostic engine (wgpu compositor, effects, masks, audio, text, project model, tick-math).
It began as a fork of [OpenCut](https://github.com/vii-app/opencut) — a browser-first,
privacy-focused editor. The legacy JS/web stack it was forked from has been deleted; what was
parity target.

Two things distinguish it:

- **Everything is local.** Projects and media stay on the machine; there is no server that holds
  project data.
- **The engine is agent-addressable.** `vii --mcp` serves the editor as a Model Context Protocol
  server, so an agent can build a timeline and render it to MP4 with no GUI at all.

## Why (inherited from OpenCut, still true)

- **Privacy** — your videos stay on your device.
- **Free features** — most basic CapCut features are now paywalled.
- **Simple** — people want editors that are easy to use; CapCut proved that.

## Repository layout

```
vii/
├── rust/              the Rust workspace — this is the product
│   ├── Cargo.toml     workspace root (run cargo from here, or use the scripts)
│   ├── desktop/       the GPUI desktop binary — a 5-line shell over vii-ui
│   ├── crates/        the engine (see below)
│   └── wasm/          wasm bindings consumed by the legacy web app
├── docs/              architecture, subsystem, and parity documentation
├── script/            Rust toolchain setup helpers
├── build.sh           release build of the desktop app
├── run.sh             launch the desktop app
└── test.sh            fmt + clippy -D warnings + tests
```

### The crates

| Crate | Responsibility |
|---|---|
| `vii-ui` | the GPUI application shell — the editor UI |
| `vii-core` | editor model and orchestration |
| `vii-project` | project format, serialization, interop with the web app |
| `vii-preview` | preview rendering and decode planning |
| `compositor` · `gpu` · `effects` · `masks` | the wgpu render path, 17 blend modes, JFA SDF mask feathering |
| `vii-audio` · `vii-text` · `vii-speech` | audio, text/glyph rendering, speech |
| `time` | `MediaTime` tick math |
| `vii-mcp` | the editor engine as an MCP server (`vii --mcp`) |
| `native-preview` · `bridge` · `test-support` | platform glue and test harness |

## Quick start

```bash
./run.sh              # debug build, fastest to start
RELEASE=1 ./run.sh    # release build — much smoother playback
./build.sh            # release build of the app
./test.sh             # fmt + clippy -D warnings + the full Rust suite
STRICT=1 ./test.sh    # fail on missing GPU/ffmpeg instead of skipping (what CI's mac job does)
```

Cargo commands run from `rust/`, not the repo root:

```bash
cd rust && cargo test --workspace
```

`ffmpeg` on `PATH` is required for video/audio decode, probing, waveforms, and MP4 export
(`brew install ffmpeg`). Without it, text and images still work and the rest degrades with a message
rather than failing silently.

A hands-on walkthrough is in [`docs/native/try-it.md`](docs/native/try-it.md).

## MCP server

`vii-mcp` (crate `rust/crates/vii-mcp`) speaks JSON-RPC over ~200 lines of `std::net` — no async
runtime, no MCP SDK:

```
MCP client ──JSON-RPC──▶ server.rs ──▶ tools.rs ──▶ studio.rs ──▶ Editor + PreviewRenderer
                         transport      schemas       engine
```

See [`docs/native/mcp.md`](docs/native/mcp.md).

## Status

Tracked honestly in [`docs/native/parity-status.md`](docs/native/parity-status.md) — what has landed,
what is still broken, and what was deliberately deferred, against the palmier-pro parity effort. The
supporting documents:

- [`docs/native/palmier-gap-audit.md`](docs/native/palmier-gap-audit.md) — the capability audit
- [`docs/native/palmier-parity-plan.md`](docs/native/palmier-parity-plan.md) — strategy and milestones
- [`docs/native/palmier-parity-todo.md`](docs/native/palmier-parity-todo.md) — the execution list
- [`docs/native/desktop-architecture.md`](docs/native/desktop-architecture.md) — crate graph
- [`docs/native/benchmarks.md`](docs/native/benchmarks.md) — benchmark suite and measured baselines

## License

MIT — see [`LICENSE`](LICENSE).
