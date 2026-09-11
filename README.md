# bay

A video editor, and the same project model exposed to agents so one can build and render video
without a GUI.

```bash
pnpm install      # once
pnpm dev          # the editor, with HMR
pnpm build        # typecheck + build into out/
```

---

## Two trees

**`/` — the product that ships.** An Electron app: React 19, Vite 7, Tailwind 4, TypeScript.

```
src/
├── shared/       the contracts both processes are checked against
│   ├── project.ts    the model — frame-native timeline time, microsecond source offsets
│   └── ipc.ts        every call the renderer may make into main
├── main/         filesystem, ffmpeg, persistence, export, the bay:// protocol
├── preload/      the contextBridge surface, and nothing else
└── renderer/
    ├── store/    zustand — one edit() that snapshots for undo
    ├── engine/   playback clock, compositor, audio, exporter — framework-free
    ├── editor/   the panels: timeline, preview, inspector, media pool
    └── components/  the primitives they are built from
```

**`dep/rust/` — the native engine, still live.** Not retired, not frozen: a GPUI desktop shell
over a wgpu compositor, effects, masks, audio, text, the project model and tick math, plus
`bay-mcp`, which exposes that engine as [Model Context Protocol](https://modelcontextprotocol.io)
tools. Work continues there in parallel, and its measured numbers still stand — the compositor
runs a 1080p decode-and-composite in 0.46 ms p50.

```bash
dep/run.sh        # launch the Rust editor
dep/test.sh       # fmt + clippy + tests
```

The rest of this file documents that tree.

## What the Rust engine is

A Rust workspace under `dep/rust/`: a GPUI desktop shell over a platform-agnostic engine — a wgpu
compositor, effects, masks, audio, text, the project model and tick math — plus `bay-mcp`,
which exposes that engine as Model Context Protocol tools.

The governing split: **`rust/` owns all non-UI logic; a UI shell owns rendering, interaction
and platform concerns but never owns logic.** That is why one engine drives the desktop app,
the wasm build and the MCP server without the logic being written three times.

```
rust/
├── desktop/          the binary — thin; calls bay_ui::run()
├── crates/
│   ├── bay-ui        GPUI application shell
│   ├── bay-core      editor model + orchestration (Command → reversible ProjectPatch)
│   ├── bay-project   project format, serialization, web↔native interop
│   ├── bay-preview   preview rendering, decode planning, caching
│   ├── bay-text      text rasterization (cosmic-text)
│   ├── bay-audio     PCM, peaks, mixing
│   ├── bay-speech    Kokoro text-to-speech + subtitle cues
│   ├── bay-mcp       the engine as an MCP server (`bay --mcp`)
│   ├── compositor, gpu, effects, masks    the wgpu render path
│   └── time          MediaTime tick math
└── wasm/             bindings consumed by the legacy web app
```

## Driving it from an agent

**With the app open** — edits land in the window you are looking at, and undo works on them:

```bash
./rust/target/release/bay          # opens the editor and its agent endpoint
bay --agents                       # is a window open, and how to reach it
export BAY_MCP_TOKEN="$(<"$HOME/Library/Application Support/bay/mcp-token")"
claude mcp add --transport http bay http://127.0.0.1:7333/mcp \
  --header "Authorization: Bearer $BAY_MCP_TOKEN"
```

bay is **single-window for now**: a second launch raises the window that is already open
rather than starting a rival with its own timeline, so "which document is the agent editing?"
never needs asking. The bound port is the lock — if a window is killed, the next launch takes
over cleanly.

**7333 does not move.** It is the URL registered in your MCP client, so exactly one process
serves it and a conflict is reported rather than routed around: `bay --agents` always says what
is serving — an editor window and its project, a headless server and its pid, or something that
is not bay — and every refusal names the owner and what to do about it. bay will not relocate to
a port your client is not configured for.

**With the app closed** — headless, for rendering:

```bash
./rust/target/release/bay --mcp
export BAY_MCP_TOKEN="$(<"$HOME/Library/Application Support/bay/mcp-token")"
claude mcp add --transport http bay http://127.0.0.1:7333/mcp \
  --header "Authorization: Bearer $BAY_MCP_TOKEN"
```

The bearer token is required by default. It protects the file-capable editor tools from other
local processes and origin-less requests; bay prints its credential file location, never the
secret itself.

There is a skill at [`.claude/skills/bay/`](.claude/skills/bay) that teaches an agent to use
it well — including the things that are not obvious from the schemas.

An installed app bundles that skill and the CLI installer:

```bash
/Applications/bay.app/Contents/Resources/install-agent-tools
```

It links the app's binary as `~/.local/bin/bay` and installs the skill for Claude Code, Cursor,
and OpenClaw. See [`docs/native/distribution.md`](docs/native/distribution.md).

- [`docs/native/mcp.md`](docs/native/mcp.md) — the tool surface
- [`docs/native/speech.md`](docs/native/speech.md) — narration and subtitles
- [`docs/native/reel-recipe.md`](docs/native/reel-recipe.md) — a worked build, and what it broke

## Building something distributable

**macOS — locally**, in about a minute:

```bash
./script/make-icon                 # assets/bay.icns + bay.ico (placeholder, or pass your own PNG)
./script/bundle-mac --dmg          # universal bay.app and a .dmg
```

**Windows — on a runner, downloaded back to you:**

```bash
./script/build-windows             # trigger the build, wait, unpack into dist/windows
./script/build-windows --latest    # just fetch the last successful build
```

Windows is the only target that needs CI, and it genuinely cannot be done here: Windows
containers require a Windows kernel, and cross-compiling with `cargo-xwin` dies inside gpui,
whose `build.rs` gates HLSL shader compilation on the *host* being Windows. See
[`docs/native/platforms.md`](docs/native/platforms.md) for the separately exercised MCP/engine
subset and the exact limits of that claim.

Both bundles are unsigned by default and still work; the OS warns once on first run. To sign:

| | |
|---|---|
| macOS | `MACOS_SIGN_IDENTITY="Developer ID Application: …"`, and `APPLE_NOTARIZE_PROFILE` to notarize |
| Windows | `-SignThumbprint <sha1>` passed to `script/bundle-windows.ps1` |

Tagging `v*` also builds Windows and opens a **draft** release — draft because the macOS `.dmg`
is built locally and attached by hand, and a release that announces half its downloads is
worse than one that waits.

## Requirements

**To run bay, you install nothing but bay.** It fetches what it needs itself — ffmpeg for
decode and export (~57 MB), and a Python runtime plus Kokoro for narration (~1.2 GB) — from
builds pinned by version and SHA-256 inside the binary, into `~/Library/Application
Support/bay/runtime`. Nothing downloads unless you ask: bay detects what is missing, says what
it is and how big it is, and waits.

If you already have a current ffmpeg, bay uses it and offers nothing. If yours is older than the
version bay is tested against, bay says so and offers its own rather than run a decoder it has
never tested — that is the one way a release still breaks after pinning, and it is not left to
chance. Either way `runtime_status` names the exact build in use, so a bug report never starts
with "which ffmpeg do you have?".

| | |
|---|---|
| A GPU adapter | the compositor (Metal on macOS) — the one thing bay cannot install |
| `ffmpeg` | bay installs it, or uses yours if it is new enough |
| Python + Kokoro | bay installs them, for narration only |
| Rust (stable) | to build from source; not needed to run a release |

Missing GPU or ffmpeg degrades with a message rather than failing silently, and the test
suite skips those cases rather than reporting a false pass.

## Repository layout

- **`rust/`** — the product.
- **`docs/native/`** — design notes, parity status and guides.
- **`todo.md`** — the roadmap index; splits into `todo.completed.md` (shipped, with evidence),
  `todo.pending.md` (not built) and `todo.testing.md` (built but never run).

The JS/web stack bay was forked from used to live in `dep/` as a parity reference. It is gone;
the behaviour worth keeping was ported into `rust/`, and what was not is recorded in
[`docs/native/parity-status.md`](docs/native/parity-status.md).

## Licence

MIT. See [`LICENSE`](LICENSE) — bay is a fork, and the upstream copyright notice is retained
there as the licence requires.
