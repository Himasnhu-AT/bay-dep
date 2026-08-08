# Contributing to bay

bay is a native macOS video editor written in Rust, plus the same engine exposed as an MCP
server. There is no web app and no JavaScript.

## Getting set up

```bash
./build.sh        # desktop app + MCP server, and provisions the speech sidecar
./run.sh          # launch the editor (RELEASE=1 for smooth playback)
./test.sh         # fmt --check, clippy -D warnings, and the test suite
```

You need Rust (stable) and `ffmpeg` on `PATH`. A GPU is needed for the compositor; without one
bay still runs and says so. `uv` is optional and only used to provision the Kokoro speech
sidecar.

**Run `./test.sh` before opening a PR.** Clippy runs with `-D warnings`, so a warning is a
failure.

## The one architectural rule

**`rust/` owns all non-UI logic; a UI shell owns rendering, interaction and platform concerns
but never owns logic.**

If the MCP server or a test cannot reach a piece of behaviour, it is in the wrong crate. That
rule is why one engine drives the desktop app and the agent surface without the logic being
written twice.

Read [`CLAUDE.md`](../CLAUDE.md) for the conventions that follow from it — decode never runs on
the render path, cache budgets are global rather than per clip, the render path cannot panic on
bad input, and missing GPU or ffmpeg degrades with a message rather than failing silently.

## Where things live

| | |
|---|---|
| `rust/crates/bay-core` | editor model — `Command` → reversible `ProjectPatch` |
| `rust/crates/bay-project` | the project format |
| `rust/crates/bay-preview` | preview rendering, decode planning, caching |
| `rust/crates/bay-compositor`, `bay-gpu`, `bay-effects`, `bay-masks` | the wgpu render path |
| `rust/crates/bay-ui` | the GPUI shell |
| `rust/crates/bay-mcp`, `bay-agent` | the agent surface |
| `docs/native/` | design notes and guides |
| `todo.md` | roadmap index → `todo.completed.md`, `todo.pending.md`, `todo.testing.md` |

## Tests

Tests that need a GPU or ffmpeg **skip** when the capability is absent, so a laptop without one
still reports green honestly. `BAY_REQUIRE_GPU=1` and `BAY_REQUIRE_FFMPEG=1` turn a skip into a
failure — use them when you want to be sure a test actually ran.

A test that asserts nothing because its capability was missing is worse than no test, so if you
add one, check it fails when the behaviour it covers is broken.

## Builds

macOS is built locally; Windows is the only target that needs a runner, because gpui's build
script compiles its HLSL shaders only when the *host* is Windows.

```bash
./script/bundle-mac --dmg    # universal .app and a .dmg
./script/build-windows       # trigger the runner, wait, unpack into dist/windows
```

## Pull requests

Say what changed and why. If you fixed something, say what would have gone wrong without the
fix — a commit that explains the failure is worth more than one that explains the diff.
