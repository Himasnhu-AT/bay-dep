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
│   └── agent/    the in-app agent — the `claude` CLI (or the Agent SDK), sandboxed to bay's tools
├── preload/      the contextBridge surface, and nothing else
└── renderer/
    ├── store/    zustand — one edit() that snapshots for undo
    ├── engine/   playback clock, compositor, audio, transitions, exporter — framework-free
    ├── mcp/      the tool executor: every tool goes through a store action, never around it
    ├── home/     the projects screen bay opens on
    ├── editor/   the panels: timeline, preview, inspector, media pool, effects, the agent panel
    ├── settings/ the Settings dialog (⌘,)
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

bay exposes its project model over [Model Context Protocol](https://modelcontextprotocol.io) — 33
tools covering opening a project, reading it, importing media, placing and editing items,
splitting, trimming, transitions, captions, removing a range, transcribing speech, rendering a
single frame to look at, and exporting. Each tool is a file in `src/shared/tools/`, and the count
is whatever that folder holds.

The transport is stdio in, unix socket out. A short-lived proxy process is what your MCP client
spawns, because a client wants a command and bay is a GUI that may not be running:

```jsonc
{
  "command": "/Applications/bay.app/Contents/MacOS/bay",
  "args": ["<resources>/app.asar/out/main/mcp/index.js"],
  "env": { "ELECTRON_RUN_AS_NODE": "1" }
}
```

or, in a checkout, `node out/main/mcp/index.js`. The app binary doubles as the Node runtime, so nothing
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

**Gateway mode**, for clients that put every tool schema into every context and do no tool
search: add `"BAY_MCP_MODE": "gateway"` to the proxy's `env` and `tools/list` publishes three
tools instead of the catalog — `get_active_project` (name, canvas, fps, track and item counts,
and whether bay is reachable), `get_guidelines` (every operation with its purpose and argument
schema, as compact text, plus the guides to read first) and `execute` (`{ tool, args }`). `execute`
takes the same path a direct call does, so validation, errors, `@./file` arguments and image
results behave identically. Unset, the full catalog is published.

## The agent in the editor

The same tools drive an agent panel inside the app. It runs the `claude` CLI already on the
machine — signed in, so there is no API key to ask for — sandboxed to bay's tools, its guides and
its own skills: no shell, no files, no web.

It **edits directly**. Every turn that changes the project ends with a Changes card listing what
changed, and a Revert button that puts the project back; each edit is also on the ordinary
undo stack. For approval first, turn on **Ask before editing** (Settings, or the shield in the
composer): every write is then refused until you approve a plan the agent proposes, and it may
run exactly what you approved.

`/` in the composer offers bay's skills — talking-head tightening, captions, a lower third, a
rough cut, a review and more — and a message may name several anywhere in it. `@` pins a clip, an
asset, a time range or a frame to the conversation; pins reach the agent with every message as
ids and frames. Debug mode (Settings, or ⌥⌘D) adds an export of the agent's full transcript, for
reporting a problem.

## Settings and transcription

Settings (⌘,) holds the agent switch above, the theme, debug mode, and transcription.

Captions and transcript-driven cuts are transcribed **on this Mac** with
[whisper.cpp](https://github.com/ggerganov/whisper.cpp); the audio never leaves it. Settings can
install the engine through Homebrew (`brew install whisper-cpp`) and download, verify and delete
speech models. **This is the one place bay reaches the network**: models come from Hugging Face
(and Homebrew fetches the engine, when you ask it to). "Download models when needed" is on by
default, so the first transcription on a Mac with no model fetches one (~148 MB for the default)
before it starts; turn it off and a transcription with no model stops and says to download one in
Settings.

## Gates

```bash
pnpm typecheck    # two projects: main+preload+shared, and renderer+shared
pnpm test         # every *.test.ts under src/, on node:test — no test framework in the tree
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

## Releasing

```bash
pnpm release:signed      # build → sign → notarize → staple → DMG + update zip, verified
pnpm release             # unsigned DMG, for local testing only
```

`script/release-signed` reads [`.bay-release`](.bay-release): the signing identity and the
`notarytool` keychain profile name. It uses the same variable names as `~/bin/xcnotarize`'s
`.xcnotarize`, and it holds no secrets. The credentials live in the login keychain. Set them up
once with `xcrun notarytool store-credentials xcnotarize --apple-id … --team-id 38QXSRV6AP`.
The script:

- signs the app with electron-builder: hardened runtime, and only `allow-jit` as an entitlement
  (measured; see `build/entitlements.mac.plist`). Then it checks **every** Mach-O in the
  bundle, including `Resources/ffmpeg/` and `app.asar.unpacked`, for the Developer ID, the
  hardened runtime, a secure timestamp and the arm64 slice. A new or swapped binary needs no
  change.
- notarizes the app, staples it, and zips it for the updater. Then it builds the DMG (the app
  beside an Applications link, like xcnotarize's), signs it, notarizes it and staples it. It
  fails if Apple's log (`release/notary/<id>.json`) lists any issue.
- checks Gatekeeper with `spctl` on the DMG, on the app, on a quarantined copy and on the app
  inside the update zip. Each must say `source=Notarized Developer ID`.
- writes `release/bay-<version>-arm64.dmg`, `…-mac.zip`, their `.sha256` files and
  `latest-mac.yml`.

`--version 0.1.1` stamps another version without touching `package.json`. `--notes file.txt`
puts release notes in `latest-mac.yml`. `--out dir` writes somewhere other than `release/`.
Builds are arm64 only, because pnpm installs only this Mac's `claude` package. ffmpeg must be
built first (`script/build-ffmpeg.sh`), and packaging refuses without it.

**Updates.** bay updates itself from a *generic feed*: an https folder that holds
`latest-mac.yml` and the zip it names. No feed is configured yet, so a packaged bay checks
nothing and Settings › About reads "Updates: releasing soon". To switch updates on, set one line
in `src/shared/update-feed.ts`:

```ts
export const UPDATE_FEED: string | null = 'https://downloads.example.com/bay/mac/'
```

Then, for each release, upload `bay-<version>-arm64-mac.zip`, `bay-<version>-arm64.dmg` and
`latest-mac.yml` to that folder. The feed must serve the files itself. bay contacts only the
feed's origin and refuses redirects to another host. A shared-drive link that redirects to a
download server will not work as a feed, though it is fine for the website's DMG link. To try
an update without publishing anything, serve a release folder locally and start bay with
`BAY_UPDATE_FEED=http://127.0.0.1:<port>/`. Only loopback addresses are accepted.

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
