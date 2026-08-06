# vii

A native macOS video editor, and the same engine as an MCP server so an agent can build and
render video without a GUI.

```bash
./build.sh        # desktop app + MCP server + speech sidecar
./run.sh          # launch the editor
./test.sh         # fmt + clippy + tests
```

---

## What it is

A Rust workspace under `rust/`: a GPUI desktop shell over a platform-agnostic engine — a wgpu
compositor, effects, masks, audio, text, the project model and tick math — plus `vii-mcp`,
which exposes that engine as [Model Context Protocol](https://modelcontextprotocol.io) tools.

The governing split: **`rust/` owns all non-UI logic; a UI shell owns rendering, interaction
and platform concerns but never owns logic.** That is why one engine drives the desktop app,
the wasm build and the MCP server without the logic being written three times.

```
rust/
├── desktop/          the binary — thin; calls vii_ui::run()
├── crates/
│   ├── vii-ui        GPUI application shell
│   ├── vii-core      editor model + orchestration (Command → reversible ProjectPatch)
│   ├── vii-project   project format, serialization, web↔native interop
│   ├── vii-preview   preview rendering, decode planning, caching
│   ├── vii-text      text rasterization (cosmic-text)
│   ├── vii-audio     PCM, peaks, mixing
│   ├── vii-speech    Kokoro text-to-speech + subtitle cues
│   ├── vii-mcp       the engine as an MCP server (`vii --mcp`)
│   ├── compositor, gpu, effects, masks    the wgpu render path
│   └── time          MediaTime tick math
└── wasm/             bindings consumed by the legacy web app
```

## Driving it from an agent

**With the app open** — edits land in the window you are looking at, and undo works on them:

```bash
./rust/target/release/vii          # opens the editor and its agent endpoint
vii --agents                       # is a window open, and how to reach it
claude mcp add --transport http vii http://127.0.0.1:7333/mcp
```

vii is **single-window for now**: a second launch raises the window that is already open
rather than starting a rival with its own timeline, so "which document is the agent editing?"
never needs asking. The bound port is the lock — if a window is killed, the next launch takes
over cleanly.

**With the app closed** — headless, for rendering:

```bash
./rust/target/release/vii --mcp --port 7333
claude mcp add --transport http vii http://127.0.0.1:7333/mcp
```

21 tools: create a project, import media, place text/shapes/images/video/audio, animate with
easing, speak a script with word-synced captions, snapshot a frame to look at it, and render
an MP4.

There is a skill at [`.claude/skills/vii/`](.claude/skills/vii) that teaches an agent to use
it well — including the things that are not obvious from the schemas.

- [`docs/native/mcp.md`](docs/native/mcp.md) — the tool surface
- [`docs/native/speech.md`](docs/native/speech.md) — narration and subtitles
- [`docs/native/reel-recipe.md`](docs/native/reel-recipe.md) — a worked build, and what it broke

## Building something distributable

**macOS — locally**, in about a minute:

```bash
./script/make-icon                 # assets/vii.icns + vii.ico (placeholder, or pass your own PNG)
./script/bundle-mac --dmg          # universal vii.app and a .dmg
```

**Windows — on a runner, downloaded back to you:**

```bash
./script/build-windows             # trigger the build, wait, unpack into dist/windows
./script/build-windows --latest    # just fetch the last successful build
```

Windows is the only target that needs CI, and it genuinely cannot be done here: Windows
containers require a Windows kernel, and cross-compiling with `cargo-xwin` dies inside gpui,
whose `build.rs` gates HLSL shader compilation on the *host* being Windows. See
[`todo.md`](todo.md).

Both bundles are unsigned by default and still work; the OS warns once on first run. To sign:

| | |
|---|---|
| macOS | `MACOS_SIGN_IDENTITY="Developer ID Application: …"`, and `APPLE_NOTARIZE_PROFILE` to notarize |
| Windows | `-SignThumbprint <sha1>` passed to `script/bundle-windows.ps1` |

Tagging `v*` also builds Windows and opens a **draft** release — draft because the macOS `.dmg`
is built locally and attached by hand, and a release that announces half its downloads is
worse than one that waits.

## Requirements

| | |
|---|---|
| Rust (stable) | builds the workspace |
| `ffmpeg` on `PATH` | decode, probing, waveforms, MP4 export |
| A GPU adapter | the compositor (Metal on macOS) |
| `uv` *(optional)* | provisions the Kokoro speech sidecar |

Missing GPU or ffmpeg degrades with a message rather than failing silently, and the test
suite skips those cases rather than reporting a false pass.

## Repository layout

- **`rust/`** — the product.
- **`docs/native/`** — design notes, parity status and guides.
- **`todo.md`** — what is planned, sized, and why.

The JS/web stack vii was forked from used to live in `dep/` as a parity reference. It is gone;
the behaviour worth keeping was ported into `rust/`, and what was not is recorded in
[`docs/native/parity-status.md`](docs/native/parity-status.md).

## Licence

MIT. See [`LICENSE`](LICENSE) — vii is a fork, and the upstream copyright notice is retained
there as the licence requires.
