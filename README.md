# bay

A video editor, and the same project model exposed to agents so one can build and render video
without a GUI.

```bash
pnpm install      # once
pnpm dev          # the editor, with HMR
pnpm build        # typecheck + build into out/
```

---

## What it is

An Electron app: React 19, Vite 7, Tailwind 4, TypeScript. The main process owns the filesystem,
ffmpeg and persistence; the renderer owns the interface and the compositing engine; `src/shared/`
holds the contracts both are checked against, and is written before either side implements them.

```
src/
├── shared/       the contracts both processes are checked against
│   ├── project.ts    the model — frame-native timeline time, microsecond source offsets
│   ├── ipc.ts        every call the renderer may make into main
│   ├── mcp.ts        the agent tool catalog
│   └── ripple.ts     removing a span of time and closing it, across every unlocked track
├── main/         filesystem, ffmpeg, persistence, export, the bay:// protocol, the MCP socket
├── preload/      the contextBridge surface, and nothing else
└── renderer/
    ├── store/    zustand — one edit() that snapshots for undo
    ├── engine/   playback clock, compositor, audio, transitions, exporter — framework-free
    ├── mcp/      the tool executor: every tool goes through a store action, never around it
    ├── editor/   the panels: timeline, preview, inspector, media pool, effects
    └── components/  the primitives they are built from
```

Two ideas carry most of the design. **Timeline time is frames** at the timeline's own rate, and
source offsets into media are microseconds, because a source has a frame rate we do not control —
the conversions live in `project.ts` and that is the only place the two units meet. And **assets
are the "what", items the "where and when"**: one asset backs many items, so moving a clip never
touches the media behind it.

## Editing

Seven transition kinds — cross-dissolve, dip to black, dip to white, wipe, push, slide, iris — and
a transition belongs to the **junction** rather than to either clip. It needs footage either side
of the cut to play, so asking for a longer one than the handles allow gets you the longest that
fits, plus a sentence saying which side ran out. That sentence is shown on the marker, in the
dialog before you commit, and in the dialog afterwards.

Eight image adjustments and fifteen blend modes, text with a real fit report, per-item speed,
volume and fades.

Delete lifts and leaves the gap. **Shift+Delete ripples** — it removes a span of timeline and
closes it across every unlocked track at once, splitting whatever straddles the bounds. That is
the difference that matters for cutting a recording: it can take the middle out of a single long
take, and it cannot desynchronise a separate audio track, because every track moves by the same
number. A locked track cannot be moved, so it tells you which ones it left behind and by how many
frames.

## Agents

bay exposes its project model over [Model Context Protocol](https://modelcontextprotocol.io) — 17
tools covering reading the project, importing media, placing and editing items, splitting,
transitions, removing a range, rendering a single frame to look at, and exporting.

The transport is stdio in, unix socket out. A short-lived proxy process is what your MCP client
spawns, because a client wants a command and bay is a GUI that may not be running:

```jsonc
{
  "command": "/Applications/bay.app/Contents/MacOS/bay",
  "args": ["<resources>/app.asar/out/mcp/index.js"],
  "env": { "ELECTRON_RUN_AS_NODE": "1" }
}
```

or, in a checkout, `node out/mcp/index.js`. The app binary doubles as the Node runtime, so nothing
extra is installed and there is no package to publish.

Three decisions in there are worth knowing. It runs as **plain Node, never inside Electron's main
process**: JSON-RPC over stdio needs a byte-exact stream and Chromium writes to stdout on its own
schedule, so one stray log line corrupts a session with an error nobody can attribute. `tools/list`
is **answered locally** from the compiled-in catalog, because a client asks for the manifest during
startup and launching a video editor to answer it would mean a stall and a window appearing
unbidden. And `tools/call` **launches bay if it is not running** and waits for the socket — which is
the whole reason a proxy exists rather than the app simply listening.

Every tool routes through a store action, so anything an agent does is undoable and the interface
sees it. Errors are written as recovery instructions: a refusal names the candidate ids, the
conflicting item, or the occupied range, because a message that merely says "not found" ends the
agent's run.

Edits confined to the project document take `validateOnly: true`: the real handler runs against
the real project, its answer comes back as `{ validateOnly: true, wouldReturn }`, and the project,
undo history, dirty flag and selection are put back exactly as they were. A dry run needs no
approval in the in-app panel and spends none. Tools whose effects leave the project — writing a
composition or template file, importing media, exporting — refuse the flag and say why.

## Gates

```bash
pnpm typecheck    # two projects: main+preload+shared, and renderer+shared
pnpm test         # 340 tests on node:test — no test framework in the dependency tree
pnpm build        # must pass before any probe result means anything
node test/app/mcp.mjs          # CDP probes against the built app
```

They are three different claims and none substitutes for another. `pnpm test` runs under plain Node
and cannot load a module that imports `electron`, so for the main process proper `pnpm typecheck` is
the only gate. And `electron .` compiles nothing — a probe measures the last `pnpm build`, not your
working tree, so build first or you are testing the past.

[`test/app/README.md`](test/app/README.md) collects the measurement traps a probe has to avoid;
read it before writing one. [`CLAUDE.md`](CLAUDE.md) is the working agreement — the conventions, and
a register of mistakes made here with what each one cost.

## History

bay began as a fork of [OpenCut](https://github.com/bay-app/opencut), a browser-first editor. It
was then rewritten as a native Rust workspace — a GPUI desktop shell over a wgpu compositor — which
lived under `dep/rust/` alongside this tree for a while and has now been removed, because a tree
nobody builds rots while still reading as current.

It is reachable by name rather than by digging:

```bash
git checkout rust-engine-final -- dep/    # restore the engine
git show rust-engine-final:fixes.md       # read one file without restoring anything
```

Nothing was rewritten out of history. The tag also holds everything that documented it —
`docs/native/`, the `todo.*` roadmap, `fixes.md`, `PROJECT.md` — and its measured results still
stand for what they measured; they are just no longer about anything in this tree.

## Licence

MIT — see [`LICENSE`](LICENSE).
