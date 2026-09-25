# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**bay** — a video editor, and the same project model exposed to agents so one can build and render
video without a GUI. An Electron app: React 19 + Vite 7 + Tailwind 4 + TypeScript. The main process
owns the filesystem, ffmpeg and persistence; the renderer owns the interface and the compositing
engine; `src/shared/` holds the contracts both are checked against.

**There used to be a second tree.** `dep/rust/` held a Rust workspace — a GPUI desktop shell over a
wgpu compositor, with effects, masks, audio, text, the project model, tick math and `bay-mcp` — kept
alongside this one on the understanding that work would continue on both. It did not, and a tree
nobody builds rots while still claiming to be current: its `CLAUDE.md` half, its roadmap and its
defect register all read as live instruction to anyone who opened them.

It is deleted, not archived in place, and it is recoverable by name rather than by digging:

```bash
git checkout rust-engine-final -- dep/    # restore the whole engine
git show rust-engine-final:fixes.md       # read one file without restoring anything
git show rust-engine-final --stat         # what the tag holds
```

The tag `rust-engine-final` also carries everything that documented it — `docs/native/`, the
`todo.*` roadmap, `fixes.md`, `PROJECT.md`, `AGENTS.md`, `optimizations.md`, `MARKETING.md` — plus
the Rust CI workflows, `install.sh`, the `setup-rust`/`bundle-mac`/Kokoro scripts and the `bay`
agent skill whose tool reference was generated from `bay-mcp`. Nothing was rewritten out of
history; `git log` still reaches all of it. **Do not re-add any of it to the working tree** without
deciding first that the Rust engine is coming back — a half-restored second tree is how this
started.

Everything below describes the one tree that exists. See [`README.md`](./README.md).

## Never `git add -A` in this tree

Several agents work here at once, and their edits land between your `git status` and your commit.
Doing this swept another author's work into four unrelated commits in a single day — a compositor
fix under a commit about a documentation rule, a guard deletion under one about the media cache, a
payload dedupe under one about export failures. Nothing was lost, but a bisect lands on a message
that does not mention the change, which is the expensive kind of wrong.

Stage explicit paths. `git add src/main/foo.ts src/main/foo.test.ts`, never `-A` and never `.`.
If a commit does end up carrying someone else's work, name it in the message rather than leaving it
to be discovered.

**And an explicit path list has the opposite failure, so neither rule is enough on its own:** it
cannot name a file you did not know had been created. `3031fb4` committed `compositor.ts`, which
imports `./looks`, and left `looks.ts` untracked — that commit typechecks, passes all 310 tests,
and does not build from a fresh checkout. Both gates read the *working tree*, where the file is
present, so neither could see it.

`src/shared/committed-imports.test.ts` is the gate: it walks every relative import in `HEAD` and
checks the target is also in `HEAD`. It is proven against `3031fb4` itself rather than a synthetic
mutant — one fault at that commit, zero at its repair — and it skips loudly if that commit is ever
unreachable, because a proof that cannot run must not read as a pass.

## Commands

```bash
pnpm install          # pnpm, not npm — the workspace standard for TS projects
pnpm dev              # electron-vite dev server + app, with HMR in the renderer
pnpm build            # typecheck, then build main/preload/renderer into out/
pnpm typecheck        # tsc over both projects; the renderer and node halves are separate
pnpm test             # the whole suite, on node:test — no test framework in the tree
pnpm bundle           # unpacked app bundle, for checking real app identity
pnpm release          # packaged artifact via electron-builder (unsigned; see below)
pnpm release:signed   # sign + notarize + staple → DMG, update zip, latest-mac.yml (.bay-release; README "Releasing")
./run.sh              # build, then run exactly ONE instance with CDP on 9222 (--no-build, --stop)
```

Environment switches worth knowing: `BAY_AGENT_RUNTIME=sdk` hosts the in-app agent on the Agent
SDK instead of the `claude` CLI (default), and `=codex` on OpenAI's `codex` CLI — either overrides
the Settings › Agent › Model choice; `BAY_MCP_MODE=gateway` makes the proxy list three tools
(`get_active_project`, `get_guidelines`, `execute`) instead of the whole catalog. `BAY_ACCESS=dev` skips the
invite-only access check — **unpackaged builds only** — and `./run.sh` sets it (`--gate` does not).

## Running and testing the app

**Probes of main-process code need a restart, not just a build.** `electron .` runs whatever is
in `out/`, and a running instance keeps the main bundle it started with — `pnpm build` alone
changes nothing in a process that is already up. `./run.sh` rebuilds *and* replaces the one
instance; use it, and read its first line, because a failed typecheck ends it before anything
launches and a probe run against no app reports `CANNOT MEASURE`, which is not a result.

**To test the running app, use `agent-browser` — and read [`docs/testing.md`](docs/testing.md)
first.** It is the testing guide: the four gates and what each one proves, how to connect, drive,
read state and clean up, the traps, and recipes. The rules that have already cost the most:

- **Always `agent-browser --session bay …`.** The default session is shared by every process on
  the machine; another agent's `open <url>` once navigated bay's editor to a different website
  through it, and every tool call then timed out. Check `agent-browser --session bay tab` shows
  bay's `index.html` before trusting anything.
- **It follows new targets.** Placing an HTML composition opens a hidden render window and
  agent-browser switches to it — a blank 3840×2160 screenshot. `tab t1` goes back.
- **It cannot hold a modifier through a drag** (Alt-drag trims): dispatch `PointerEvent`s with
  `altKey: true` from `eval`, and say that is what you tested.
- **`record` does not work on Electron.** Sample transient things in the page, with a positive
  control proving the sampler can see a change.

**A probe that reloads the page makes the window flash, and that was the "flicker".** The report
was "the screen flickers every time the agent count goes up". It was not the count (a text node
updated by a 10-second poll) and not tool calls: a marker set in the page survived a socket tool
call and an agent-browser connect, and did not survive `test/app/cdp.mjs`'s `attach()`, which
reloaded the editor on every probe run to set the debug flag. The probes also connect, so the
count moved with them. `attach()` now reloads only when the debug handle is missing. When a
symptom correlates with a counter, find what else moves the counter.

A value read through a store snapshot taken *before* an action is the old value:
`const s = getState(); s.undo(); s.project` reports the state before the undo. Re-read.

**Undo what a probe did, and do not save.** `test/app/mcp.mjs` calls every tool and leaves
~28 edits in the open project; unwinding `past` restores it. The fixture on disk only changes if
something saves, and nothing a probe does should.

**The in-app agent's sandbox is `--tools`, not a deny list.** Measured, each one:
- `--setting-sources ''` does not stop MCP servers loading; only `--mcp-config` plus
  `--strict-mcp-config` isolates the agent to bay's tools.
- An allow-list governs what needs approval, not what exists: with one alone, `Bash` ran `id`.
- `--tools ListMcpResourcesTool,ReadMcpResourceTool,Skill` makes every other built-in *absent* —
  the session's tool list is bay's catalog (33 tools as of this writing) plus those three, and a request to run `id` had nothing to
  run it with. MCP tools are not built-ins, so bay's are unaffected. `--allowedTools` narrows
  `Skill` to `Skill(<slug>)` for bay's own skills, never the bare name, which would permit every
  bundled skill (`cli.test.ts` pins both).
- `--setting-sources project` does not stop Claude Code reading every CLAUDE.md in the folders
  *above* the working directory: a marker in the workspace's parent reached the model. Only
  `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` (set by `childEnv` in `agent/cli.ts`, for both runtimes)
  kept it out, and a project skill still loaded with it set.
- `--restricted` also switches off project skills (the skill was simply missing from the
  session), which is why it went. The deny list it was paired with had gone stale: it named
  `Task` after the tool became `Agent`, and never named `Monitor`, which runs commands. A list
  of what is *allowed* cannot miss a tool the CLI adds later; a list of what is denied can.

**The Codex provider has no allow-list, so its sandbox is Codex's own, and it is weaker in one
named way** (`src/main/agent/codex.ts`, Settings › Agent › Model; `BAY_AGENT_RUNTIME=codex`
overrides). One `codex exec --json` per turn, `exec resume <thread>` after the first, under
bay's own `CODEX_HOME` (`<userData>/agent-codex`: a generated `config.toml` plus a *link* to
the user's `auth.json`, nothing else of `~/.codex`) and a `HOME` inside it. Measured on
codex-cli 0.149.1:
- `codex mcp list`: the user's own home lists `chatcut_desktop`, `computer-use`, `cua_repl`,
  `node_repl`; bay's lists `bay` only. An isolated home with default features still fetched the
  account's ChatGPT connector catalog (136 tools: Gmail, Drive, Calendar…) and plugin cache; with
  `apps`/`plugins` off neither cache is created.
- `HOME` must move too: under an isolated `CODEX_HOME` the user's `~/.agents/skills` were still
  listed to the model. `codex debug prompt-input` (no model call) is the probe, and
  `codex.test.ts` runs it with a positive control per exclusion.
- The model's own tool list, sandbox config in place: `exec` (code mode — the route to MCP tools;
  `code_mode_host=false` made bay unreachable), `wait`, `request_user_input`, the
  `collaboration.*` sub-agent tools (feature flags did not remove them; sub-agents inherit this
  config), `apply_patch`, the three MCP resource readers, `update_plan`, and 37 `bay` tools.
- Told to try, it could not escape: `id` — no shell tool, and `process is not defined` in `exec`;
  `apply_patch` to the workspace and to `/tmp` — *"patch rejected: writing is blocked by read-only
  sandbox"*, and neither file existed afterwards; reading `/etc/hosts` and any fs module —
  *"unsupported import in exec"*; `fetch` — not defined. **Untested:** whether `read-only` would
  let a shell *read* files, because with `shell_tool` and `unified_exec` off there is no shell to
  try it with; a Codex update that re-adds a shell path would change that, which is why the probe
  is a fixture (`fixtures/codex/sandbox-probe.jsonl`) and worth re-running on upgrade.
- `developer_instructions` reaches the model verbatim as the first developer message;
  `project_doc_max_bytes = 0` keeps a workspace `AGENTS.md` out. Skills cannot be loaded by
  Codex here (it lists a `SKILL.md` but has nothing to open it with), so main inlines each named
  skill into the message (`withSkills`) and writes none for it. `--strict-config` turns an
  unrecognised key into a failed start rather than an isolation setting silently ignored.

**bay's skills are real Claude Code skills.** `src/shared/skills.ts` defines them; main writes
each as `.claude/skills/<slug>/SKILL.md` in the agent's working directory on every start, and the
CLI loads them with `--setting-sources project` from that directory (nothing else is there, so
the user's own skills stay out; their CLAUDE.md files stay out by the switch above). The CLI
itself expands only a `/skill` at the very start of a message, so the agent has the `Skill` tool:
a `/name` anywhere in the message, several at once, is loaded by the model, and the system prompt
(`src/main/agent/prompt.ts`) tells it to load only bay's skills the user named. Skills are still
user-invoked.

**The in-app agent reaches files only through `src/main/mcp/policy.ts`.** It has no filesystem
tools, so a path argument is its only way to a file, and text it reads (a transcript, an asset
name) can carry a prompt injection. It connects on its own socket, `bay-agent.sock`, so main knows
the caller by the connection rather than by anything a call claims; from there, no `@file`
references, no hidden files or folders, only paths under home or temp, and a composition may only
overwrite a composition. Terminal clients keep `@file` — they already have the filesystem — and
nobody's export may overwrite a file that is not media.

**Compositions are confined to their own folder** (`src/main/html/sandbox.ts`). The composition
partition cancels every request but `data:`, `blob:`, `about:` and `file:` inside the composition's
folder, resolved through symlinks; the window is sandboxed (hence CommonJS `.cjs` preloads), cannot
navigate or open windows, and gets no permissions. Before this, a shared project's composition
could read `~/.ssh` and post it anywhere. The contract already told authors remote resources were
blocked; now they are.

**bay ships its own ffmpeg, built from pinned source as LGPL-2.1** (`script/build-ffmpeg.sh` →
`vendor/ffmpeg/<platform>-<arch>/`, found by `src/main/ffmpeg/vendor.ts`; `vendor/ffmpeg/README.md`
has the why). The npm build it replaced was `--enable-gpl --enable-nonfree` — not redistributable —
and 2.5 years stale. So: **no libx264** (H.264 is `h264_videotoolbox`, quality mapped by measurement
in `codec-args.ts`), **no vid.stab** (use `deshake`), no font stack (`drawtext`/`subtitles` are not
there; bay draws its own text). The binaries are gitignored — run the script once per machine
(~5 min); tests that need them skip loudly without them, and `pnpm release` refuses to package
without the binaries BUILDINFO records. `src/main/ffmpeg/capabilities.test.ts` asks the binary for
every encoder and filter the code's own argument builders write, so adding a filter the build lacks
fails `pnpm test` by name. Add it to the script's configure line (and its `REQUIRED_*`), not a
fallback.

**bay passes ffmpeg no `-protocol_whitelist`, on purpose.** With the old npm build it changed
nothing any specimen could observe; bay's own build is `--disable-network` with only `file` and
`pipe`, so there is no network code to whitelist. `src/main/media/local-only.test.ts` pins both the
protocol list and that no URL or local playlist makes a request (Node reaching the same server is
the positive control); pointed at the old 6.1.1 build, both fail.

**Subtitles are compositions, one per clip, in a chosen design** (`src/shared/subtitles.ts`,
`add_subtitles`). A text item can show a line; it cannot light the word being spoken, which is what
short-form subtitles are. whisper runs with `-ojf` so every token has a time, tokens are merged
into words, the words the clip plays are mapped onto it (`segmentsToWords`, the same mapping as the
cues), and the words are baked into a composition whose `time(t)` draws the group on screen with the
spoken word marked. Main writes it content-addressed under `<userData>/generated`; the store places
it over the clip on a "Subtitles" track and replaces subtitles already there, so choosing another
design swaps rather than stacks. The documents are checked by bay's own composition reader and their
script is run against a DOM stand-in in the tests — which word is lit at a given second is the
behaviour, not the markup.

**Motion graphics are `.brf` modules: JSX the agent writes like React/Remotion, drawn natively**
(`src/shared/brf-code.ts`, `write_brf`). A module's default export returns
`<scene duration>` of `<rect>/<ellipse>/<path>/<text>/<group>`; it may import from `'bay'` or
`'remotion'` (`interpolate`, `spring`, `useCurrentFrame`, `<Sequence>`, `Easing`) and nothing
else. Each frame resolves to a JSON scene (`src/shared/brf.ts`) that `engine/brf.ts` paints
straight onto the compositor's canvas — no window, no capture, the same path in preview,
`preview_frame` and export. HTML compositions stay for what needs a web page. Why not
Remotion/HyperFrames-style HTML: everything DOM renders by screenshotting Chrome, the cost this
removes. Why code rather than JSON: models write React-shaped code fluently, and raw animation
JSON is what they fail at (~13% for GPT-5 writing Lottie, OmniLottie, CVPR 2026).

**The code runs in a worker, and a worker does not inherit the page's CSP — measured.** Inside a
same-origin worker `new Function` ran and `fetch` to a remote origin *reached the network*. So:
one worker per module (no bridge to main, killable after 3s), `lockdown` before any user code
(network/storage/`importScripts` removed on the global *and its prototype chain*, every function
constructor and `eval` blocked, the message channel sealed), `import()` refused at load, and
**main cancels every remote request from the editor's session** (`src/main/offline.ts`) so the
lockdown is not the only wall. The lockdown's stand-in for `Function` must be made in the
target realm — made in the lockdown's own, `blocked.constructor` was a live `Function` from
another realm, which `brf-lockdown.test.ts` caught. The JSX factory is `__brf_h`, not `h`:
`const h = height / 2` is ordinary code and shadowed it.

**Blocking `Function` does not block code generation: the platform compiles strings too.**
The adversarial pass (test.md §2.7, `test/app/brf-sandbox.mjs`) found string `setTimeout`/
`setInterval` running in the locked worker, a `dispatchEvent`ed `MessageEvent` reaching the host
listener (a module swapped itself for an unprobed one after `write_brf` accepted it), and
`FontFace` fetching a URL. Timers now refuse non-functions (wrapper made in the target realm,
`Reflect.apply` captured before user code), the listener answers only `isTrusted` events, and
`FontFace`/`fonts` are gone. A fetch from the editor *document* tests its CSP, not main's filter;
the probe uses CDP's CSP bypass in an iframe to reach main.

**`.brf` text takes variable-font axes through registered faces** (`engine/brfFonts.ts`):
canvas has no `font-variation-settings`, and `ctx.fontStretch` is keywords only, but a
`FontFace` with a `variationSettings` descriptor draws with any axis — measured, Archivo wdth 62
vs 125 is 27.5% vs 51.4% of the frame. Each (family, settings) is a face cloned from the family's
`@font-face` rules or `local()` (full/PostScript names only). A loading face makes the item
*pending*, so export and `preview_frame` wait on `variationFaces.settle` like any other source.

**Fonts are assets, not machine state** (`kind: 'font'`, `@shared/fonts`, `media/font-file.ts`,
`engine/importedFonts.ts`). Main reads the file's own tables (name ID 16 before ID 1: a variable
font's ID 1 is its default instance, "Archivo SemiBold") and copies it, content-addressed, into
`<userData>/fonts`, admitted to `bay://` like any asset path. The compositor registers each as a
`FontFace` with the axis ranges as descriptors (a single weight would clamp every other one), a
loading face makes text *pending*, `brfFonts` clones variation faces from the imported source, and
composition windows get the same bytes as a `data:` `@font-face` — only files from that folder,
with descriptors checked, since a `.bay` may be someone else's.

**Detached audio is a linked item, and the picture's element is shared where it can be**
(`@shared/links`, `detach_audio`). The picture gets `audioDetached`, the sound an audio-track item
with the same asset/in/span; items sharing a `linkId` and overlapping in time move, trim, slip,
split and delete together. Links are re-derived from overlap after every `edit()`
(`normaliseLinks`), so a split or `remove_range` of a pair yields two pairs without either knowing
links exist. Preview: an aligned sound plays through the picture's own element (one decode);
anything else gets an `<audio>` stand-in with the picture element claimed silently. Export skips
the detached picture as an input. Gain lookups ask for the item's *own* transition
(`transitionOfItemAt`), because a picture dissolve and its copied audio cross-fade share frames.

A module's source lives on its asset (`asset.brfCode`), so writing one is an ordinary `edit()` —
undoable, in the turn's diff — and `write_brf` runs it across its whole duration before changing
anything, so an error on frame 45 is a refusal with its line, not a placeholder later. Main
imports a `.brf` file as text and never runs it; `lib/brfImport.ts` probes it in the worker.
Every example in `bay://guide/brf` and the worked-edits guide is compiled and run on every frame
by `brf-code.test.ts`.

**Beats are analysed in main, kept on the asset in source time, and mapped once**
(`media/beat-analysis.ts`, `@shared/beats`, `detect_beats`). Spectral flux → autocorrelation picks
a period family → the octave is chosen by what sits halfway between beats (broadband *and* kick
band, because after log compression a quiet hat rises in as many bins as a kick) → Ellis's DP →
bar phase from the kick band only when one position clearly wins → drop-outs as missing beats on
the continued grid. `beatFramesForItem` is the one mapping onto the timeline; the tool's frames and
the timeline's snapping (`lib/snap.ts`, which also snaps to markers now) both read it. Measured on
a real score its eighths are *harder* than its weaker beats, so by onsets alone it is a 220 pulse;
it reads 110 only because 220 is past the 215 search ceiling, and a pulse over 180 needs the kick
band to agree. The octave is the fragile part; the tests pair every octave case with its opposite.

**The preview's composition pool answers with the latest decoded frame, not nothing**
(`CompositionPool({ live: true })`). A composition frame is a 40-80ms capture in main, and every frame
of a playing composition is a new moment, so an exact-or-nothing pool drew compositions only while
paused — they vanished during playback. Live, a miss shows the latest decoded frame of that clip
within a second, the newest queued capture is served first, stale ones are dropped, and three frames
ahead are fetched while playing. Export and `preview_frame` build their own pools, which still
answer exactly or wait: a stand-in frame there would put the wrong picture in a file.

**A media load that failed is retried under a new URL, with CORS** (`mediaRetry.ts`). Chromium
remembers a failed load per URL and CORS mode. A `bay://` path refused before it was allowlisted
kept failing after the allowlist, even on a fresh element. Meanwhile `fetch` of that URL answered
200. So the same-URL retry could never work, and dropping CORS "worked" only by changing the key,
into a load that plays silence. `test/app/audio-soak.mjs` reproduces the race: before the fix,
every forced iteration was silent; after it, none were.

**A GUI probe must never send a global keystroke or trust Accessibility for window presence**
(`test/app/menu.mjs`, `test/app/README.md`). Accessibility lists only the active Space. With
another app full screen, bay has "0 windows". `key code 53` lands in whatever app is in front,
and it once landed in the user's chat app while they were typing. Use the window server's list
(`CGWindowListCopyWindowInfo`), and send a key only after re-checking `frontmost` in the same
script.

**A cut during playback is prepared before the playhead reaches it** (`Compositor.preroll`,
`engine/pictureHold.ts`, `test/app/cut-playback.mjs`). Every cut played one black picture, cold
and warm, graded or not: the incoming clip's element was first told where to be by the draw *at*
the cut, and a seeking element has nothing to draw. Now the engine, after both consumers have
acquired their elements, seeks the next second's clips paused to their first frame (never an
element anything used this frame — a hidden track's sound is invisible to the compositor). A
same-asset jump cut cannot be prerolled (one element, two times), so live playback puts the last
complete picture back over an incomplete one for at most a second; export, `preview_frame` and a
paused preview never hold. And a playback seek in flight is left to land: `currentTime` reads a
seek's *target* the moment it is set, so judged by drift a slow seek looked landed, lost its
bookkeeping and was restarted every two frames — measured as a jump cut black for half a second.

**A colour grade is a source transform inside the compositor, not a second renderer**
(`item.grade`, `@shared/grade`, `engine/grade.ts`). `#drawSource` hands the element it was about to
draw to one shared WebGL2 context, gets back a graded canvas of the same framing at the size it
will be drawn, and draws that with the same alpha/blend/filter/rotation — so preview,
`preview_frame` and export grade through one path, and grain/halation are native at output size.
An identity grade resolves to `null` and skips the pass (the `'none'` rule). `.cube` LUTs are
`kind: 'lut'` assets parsed by main (`@shared/cube`); the table lives on the asset. Halation is
screened in RGB: in YUV it casts violet. A render target created while its texture unit was bound
for reading is a WebGL feedback loop — the first halation draw of every new size failed until
`target()` unbound it; `test/app/grade.mjs` caught it as an export/preview mismatch.

**An export that wrote a wrong frame says so; it never finishes as a plain `done`.** The exporter
waits for pending items for a bounded time and then writes the frame anyway. That frame is a wrong
picture: a `.brf` or composition still missing, or a clip whose grade failed and was drawn
ungraded. Each such frame is recorded from the draw that was written (`DrawStats.pendingNames`,
`gradeIssues`). `describeIncomplete` turns the record into `IncompleteFrames` (`@shared/ipc`),
which lists the frames and ranges, each item and grade issue, and one sentence with the
better-hidden fault first. `track_export` reads it live from the exporter, not from main, which
cannot know. It returns `complete: false`, `incompleteFrames` and a `warning`, and a clean `done`
returns `complete: true`. The export form shows the same sentence. The frame count used to be a
counter that nothing read. Every pending site goes through `notePending`: a branch that bumped
`pending` and forgot the name arrived in parallel with the field. A **placeholder** frame is wrong
too — a `.brf` that threw, media missing or undecodable, drawn as a grey card — and was once left
out: six "Box" cards exported as a clean "Done 100%". Every placeholder site goes through
`#placeholder` (`DrawStats.placeholderNames`), and `IncompleteFrames.placeholders` names each.

**Tool calls stream into the panel as the model writes them.** `content_block_start` for a
`tool_use` shows the card at once, and each `input_json_delta` (keyed by block index, so the stream
mapping keeps per-run state) appends to it; the card shows what is being written and the end of it —
a composition's HTML as it arrives. Before this a large `write_composition` was minutes of
"Working…" with nothing on screen.

**A navigation can start and never commit.** bay's `will-navigate` guard cancels every
renderer-initiated navigation, so `did-start-navigation` fires for a `location.reload()` that
never happens. State keyed on navigation *start* (executor readiness was) is then wrong for good;
key it on `did-navigate`, the commit. `test/app/mcp-during-reload.mjs` holds both cases.

**A probe of the preview is not a probe of the export, however alike the names.** Export's clip
audio applied no transition gain for as long as it existed — every dissolve a hard cut in the
file — while `test/app/transition-audio.mjs` passed, because it meters the preview's analysers and
the preview was right. CLAUDE.md even said export sampled the shared curve. It took unrelated
work reading `audio-graph.ts` to see it. `src/main/export/audio-render.test.ts` now renders a
dissolve through the real ffmpeg and measures it. When a check covers one of two paths, say which.

**A race you cannot reproduce is not a race you have disproved.** The executor-readiness wait
changed no outcome in a whole session of trying — cold launch and a 0–160ms reload sweep both
answered with it removed. Then the final regression run lost a call at the 0ms offset: sent to a
page that *was* listening, torn down by the reload before it answered, 30s of silence for the
agent. That is a different fault from the one the wait guards, which is the second lesson — a
guard that is correct can still be guarding the wrong gap. Stranded calls are now resent if they
are reads and failed at once if they are writes (`strandedCall`); the decision is unit-tested,
the rescue itself has not yet been caught firing, and the commit says so.

**Worktree agents start from `main`, not from your branch.** Every one spawned this way came up
on an old commit without the files its task named. Tell it to `git merge --ff-only <branch>`
first. Tools no longer share a hand-edited list: a tool is a file in `src/shared/tools/` and an
entry in its executor module's `handlers`, and the two indexes are generated (`pnpm gen:tools`).
Two branches that each add a tool conflict only in those generated files, and regenerating
after the merge resolves it.

**There is no Prettier config, so do not run Prettier.** `npx prettier --write` falls back to
its defaults — double quotes and semicolons — and rewrote a whole file into a style nothing else
here uses, which then conflicted with every branch that touched it.

**The in-app agent edits directly; review is a diff, not a gate.** Every turn that changes the
project ends with a Changes card (`describeChanges` in `src/shared/diff.ts`, compared by id) and a
Revert that restores the state before that turn as one undoable step. A turn's checkpoint also
holds the compositions it rewrote, so Revert writes those back. Cards expire when the project id
changes — a checkpoint of project A must never be restored into B's window, where ⌘S would write
it over B — and after 20 turns. Edits the user makes during a turn are marked on the card
(`asAgent` wraps tool calls; anything outside one is the user's), because a whole-project revert
takes them too. "Ask before editing" in
Settings turns the old gate back on: every write is refused until the user approves a
`propose_edit` plan, the approval is delivered as the model's next turn naming each call byte for
byte, and each approved call runs once. Outside a session (a terminal client on the socket)
nothing is gated. `validateOnly: true` on a dry-runnable tool passes the gate, because it changes
nothing — and on a `selfValidating` one (the generate tools, whose handler receives the flag,
checks and prices the call, and starts no paid job), for the same reason.

**bay is invite-only, and main is the lock** (`src/main/auth/`, `src/shared/access.ts`). A Mac
is `entitled` when a sign-in (system browser → the site's `/desktop/sign-in` → a one-shot POST to a
127.0.0.1 loopback server that checks Origin and `state`) was verified against `access/{email}` in
Firestore. Until then `ipc.ts` refuses every channel outside `OPEN_WHILE_LOCKED` and both sockets
answer tool calls with the unlock instructions (`auth/gate.ts`); the access screen is only UI.
Offline it keeps working for 14 days from the last successful check; a 404 on the access doc, an
unverified email, or a refresh token Google refuses locks at once; ages run from the latest time
bay has seen, so winding the clock back buys nothing. The refresh token is stored only through
`safeStorage` — without a keychain it stays in memory until quit, never in plaintext.

**Releases are signed by `script/release-signed`, and every Mach-O is checked by content, not by
name** (`pnpm release:signed`, `.bay-release`). electron-builder signs. The script then walks
the whole bundle, including `Contents/Resources` (ffmpeg and ffprobe in `Resources/ffmpeg/`, and
`claude` in `app.asar.unpacked`), which `codesign --deep` skips. It refuses any binary without
the Developer ID, the hardened runtime, a secure timestamp or the arm64 slice, so moving or
swapping a binary needs no signing change. It notarizes the app, then the DMG, and fails on any
issue in Apple's log. The only entitlement is `allow-jit`, measured in a signed build. The four
that were there before had comments no one had tested. `disable-library-validation` claimed
ffmpeg needed it, but library validation governs dylibs loaded into a process, not executables
it spawns. Builds are arm64 only, because pnpm installs only this Mac's `claude-agent-sdk-darwin-*`.

**An update restarts bay with no arguments.** Squirrel relaunches the bundle as Finder would:
no `--user-data-dir`, and no environment. A test update from an isolated profile therefore
relaunches onto the default profile, which is the real user's. Test updates only with builds
made with `--app-name bay-reltest`, which keep their data under that name (`main/app-name.ts`).
That did not work at first. Main's `setName('bay')` overrode the stamped name, and the first
test build opened the real profile. It was checked in a bare Electron app, never in bay. Now
check a test build's socket log line before anything else, and run its first launch with
`CFFIXED_USER_HOME` pointed at a scratch folder, so a wrong name lands there. The renderer decides
when a restart is safe (`restartPlan`/`runRestart` in `@shared/update`): it saves first, or
writes the autosave sidecar while locked, and installs only if that succeeded. The update
channels are open while locked (`OPEN_WHILE_LOCKED`), because an update is how a build that
cannot sign in gets fixed.

**A grant comes from the owner or a referral.** The owner approves a waitlist entry or grants an
email directly on the website's `/admin`; an entitled user refers one from inside bay
(`accessRefer`, five each). The `no-access` screen therefore shows the email with a Copy button
(the referrer must type it exactly), *Join the waitlist* (`accessRequestAccess` opens the site's
`/waitlist`), *Use a different account* and *Check again*. There is no public download yet; the
site says "Releasing soon" and points at the waitlist.

## graft — read the graph before you grep

This repo is indexed by [graft](https://github.com/graft-dev/graft): a prebuilt graph of every
symbol, its `file:line` span, and who calls what. One query usually replaces several file reads.

```bash
graft build           # rebuild the graph — ~3s, free, no API key
graft check           # exits non-zero when the graph is stale relative to the code (CI-shaped)
graft skeleton <file> # a file's whole API surface for ~5% of the tokens of reading it
graft ask "<query>"   # ranked nodes with exact file:line
graft viz             # interactive view of the graph
```

The MCP server (`graft mcp`) exposes the same thing as tools — `graft_find_code`,
`graft_find_all`, `graft_trace_calls`, `graft_file_api`, `graft_repo_map`. Prefer those when they
are available; the CLI is the fallback and answers identically.

**Rebuild it after any structural change**, and certainly after a deletion — the graph indexed
both trees while they both existed, so a stale one still answers questions about `dep/rust/` and
hands you `file:line` for files that are gone. `graft check` catches that; `graft build` takes
about three seconds.

**Two ignore files, doing opposite jobs.** `/graft/` is in `.gitignore` because the graph is a
derived cache — committing it puts a merge conflict in every branch that touches code. `.ignore`
contains `!graft/`, because ripgrep reads `.ignore` *before* `.gitignore` and would otherwise
refuse to search the cards. Both are committed; a clone without them gets a graph git wants to
commit and rg will not read.

**`graft ask` tokenises, and a two-word English phrase is not a query.** Asking for "ripple
delete" matched `delete` and returned project-library functions from the Rust tree. Use a
distinctive symbol name, or `graft skeleton` on the file you suspect.

**The deep layer is not built.** `graft build --deep` adds an LLM concept map and per-symbol
summaries, and costs an API key and real tokens. `check` names the wiring graph as the source of
truth and `ask`/`skeleton` route through it, so the free build is sufficient. `check` reporting
"meaning tier 0% complete" is that choice, not a fault.

**The bundle script is not called `pack`, and must not be.** `pnpm pack` is a pnpm **built-in** —
the npm-style tarball command — and it shadows any script of that name without a word. Running it
tarballed the entire repo, `website/` and `workspace/` included, and dropped a `.tgz` in the root.
`pnpm run pack` would have reached the script, but a name that does the wrong thing when typed the
obvious way is a trap, so the script is `bundle`. Same reasoning retired `dist`, which every
JS toolchain treats as a build-output directory — the script would read as "write to dist/".

**"Tests green" and "tree green" are different claims here, and the difference is structural.**
`pnpm test` runs under plain Node, so it cannot load any module that imports `electron` — `store.ts`,
`ipc.ts`, `index.ts` and the rest of the main process proper are unreachable from the suite at all.
For those files `pnpm typecheck` is the *only* gate. This is not a coverage gap a test could close;
it is why the suite once sat at 86/86 green over a type error that made the app unbuildable. Read a
passing test count as evidence about the pure modules — `serve.ts`, `frame-pipe.ts`, `probe.ts`'s
`shapeProbe`, `db.ts`, `persistence.ts`, the engine — and about nothing else. The habit that follows:
when a module matters, find the seam that lets its logic live outside Electron, the way `serve.ts`
was split from `protocol.ts`. Every such split so far has been a better shape independently of the
test that motivated it.

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

**And the proof must itself be proven to have done something.** A mutation run scored a guard as
NOT CAUGHT and sent someone to rewrite a test that was working perfectly: the mutation string had
six spaces of indentation where the source had four, so `str.replace` silently did nothing and the
suite ran against unmodified code. A mutation that did not apply and a test that does not test
produce identical output. Assert the replacement landed — `assert old in source` — before running
anything. It is the same one-line shape as the specimen assertion above, displaced by one level.

**A surviving mutant is not automatically a missing test.** It is one of three things, and they
want three different responses:

1. **A missing test** — write it.
2. **Dead code** — delete it. Tell this from the first differentially, by running both versions
   over a large input set, not by reading the code and forming an opinion. `parseRational`'s
   finite-number guards survived mutation; original against simplified over 33 handwritten inputs
   and 20,000 generated pairs were identical on every one, so the guards went. They read as
   defensive and were unfalsifiable: nothing could tell their presence from their absence, so
   nobody could safely change them later and nobody could tell if they had rotted.
3. **An optimisation with no observable behaviour** — label it, or delete it. Deleting the
   `if (bytesBefore <= budgetBytes) return` early exit from the cache sweep changed no test,
   because the loop below breaks on its first check and produces an identical result. That is not
   dead code and not a test gap: it is a fast path, correct by construction, and *no test can
   ever cover it* because it has no effect a test can see. Delete it unless someone has measured
   a reason to keep it, and if it stays, say at the code that it is an optimisation — otherwise
   the next person to run mutations rediscovers it as a mystery.

Treating every survivor as a test gap is exactly how unfalsifiable code accumulates a suite
around it.

**But a differential verdict is itself a measurement in a state, and this is the dangerous
direction.** The other errors in this file send someone to read working code; this one deletes a
live guard. `NumberField.commit`'s `if (!Number.isFinite(rounded)) return` looked transitively
unreachable — every typed route in is already gated by a `Number.isFinite` at its call site — and
a differential over seven adversarial strings (`abc`, `1e999`, `-`, `Infinity`, `NaN`, empty,
arrow-on-garbage) gave **identical results with and without it**. On that evidence the guard
should have gone. The uncovered input class was a non-finite value arriving *from the store*:
seed `layout.left = NaN`, drag the label, and NaN survives the arithmetic into `commit`.

So before accepting "no input distinguishes them", ask **which inputs you did not try**, and
specifically whether every *source* of the value is represented — not just every syntax the user
can type. An input set drawn from one entry path proves something about that path and nothing
about the others.

That case also needed its own observable, which is the general lesson: the value is NaN before
*and* after, so reading it back cannot tell "wrote NaN" from "returned early". The undo stack can,
because a commit goes through `edit()` and pushes history — `past 3 → 4` without the guard,
`3 → 3` with it. When the obvious observable cannot distinguish the two outcomes, find one that
can rather than concluding from the one that cannot.

This shape — a correct-looking construct that nothing can reach — has now appeared five times in
two days, across four subsystems and three authors. Expect it rather than being surprised by it.

**Never write a literal where a derived value will do.** The actionable form of the rule below,
and the one that actually stops it. A check that sets `color: '#FF0055'` accuses working code the
moment anything upstream has already set the same value: the edit succeeds, the field is correct,
the picture is correctly identical, and the probe reports the field dead. Derive instead —

    const current = (await call('inspect_item', { itemId })).value?.text?.color
    const next = current === '#00FF88' ? '#FF0055' : '#00FF88'

The literal encodes an assumption about history. The derived value encodes what the check actually
means — *different from whatever it is now* — and survives any reordering upstream. Seven of this
project's wrong answers came from a fixture assumption, and three of those were one afternoon's
checks against a shared timeline that earlier checks had already moved.

**A property measured in one state is not a property.** Ask of every measurement: *which starting
state was I in when I measured that?* This has been the single most repeated error here — three
separate instances in one day, by three people, in three subsystems:

- "`%nonZero` at 0.0% means nothing was drawn" — true only when the source is known to have
  something there, which nobody checked. Cost the most.
- "`VERIFY_PRECONDITION` fails as designed" — true only from an empty project; from a project
  loaded off disk the precondition was already satisfied and the mode hung.
- "`project.save()` opens a dialog, so a probe cannot seed itself" — true only on a profile with
  no `filePath`; on a seeded one it writes silently, which is how a probe came to mutate a
  fixture nobody knew it was writing to.

Each was measured honestly, each was reported as a property of the system, and each sent someone
into code that was working. Say "in state X, this does Y" until you have checked state not-X.

**Write the assertion from the requirement, never from the implementation.** `sweepStaleCaches`
skipped any directory without a `<family>-<scheme>` separator, so a bare `thumbs/` — the one stale
cache every existing install actually has — fell through and was never reclaimed. The function
written to reclaim old caches ignored the only old cache in existence. It was invisible because
its test seeded `thumbs` alongside `thumbs-v0` and asserted `thumbs` **survived**: the author read
the skip out of the code and wrote it down as intended behaviour without asking whether it should
be. A test built that way cannot fail, because it is a description. Ask what the code is *for*,
then assert that.

**A test cannot hold still anything it defines jointly with the code.** Ask of every test: *if I
renamed this, would the test rename with it?* If yes, it asserts a tautology. Four separate
failures this week were that one structure — the key constant read by both sides, the
writer/reader round trip, the mutation harness and the code it mutates, the harness and its own
reporter. It is recognisable before it bites.

The sharpest case is **persisted data, because its reader is one you cannot update**. Renaming
`LAST_PROJECT_KEY` survived mutation: every test read and wrote through the constant, so the
rename moved both sides together while on a real machine the new key finds nothing and every
existing user silently loses their last project on upgrade. The same held for `.bay` documents —
a round-trip test that writes with `writeProjectFile` and reads with `readProjectFile` passes
through any field rename, while every project already on disk stops loading. The fix in both
cases is a **literal**: a version-1 `.bay` file spelled out key by key in the test, plus the
reverse check that today's writer still emits every key the fixture has.

Scope it deliberately, though — not everything durable is a compatibility surface:

- **Yes:** `.bay` field names, database keys, anything read back from disk by a build that is not
  the build that wrote it.
- **No:** IPC channel strings — preload and main ship in the same binary and move together by
  construction, so there is no older reader to break.
- **No:** cache filenames (`cacheKey`). A changed hash *orphans* entries rather than losing data;
  the cost is re-deriving posters and peaks once. Pinning it would freeze an implementation detail
  in exchange for no promise.

The test is whether a reader you cannot change will see the old bytes. If not, pinning buys
nothing and costs you the freedom to refactor. And note the two remedies are opposites: pin the
strings that must never move; **version-and-sweep** the ones that exist in order to move, as the
cache scheme does by living in the directory name (`thumbs-v1`) with a startup sweep of other
schemes. Pinning the second kind would fight the design.

**"Belt and braces", "just in case" and "defensive" are the tell for unfalsifiable code.** Every
instance found so far was labelled that way by the person who wrote it — the phrase is what gets
written about code whose necessity the author could not demonstrate. When you catch yourself
writing it, that is the moment to check whether any input can distinguish the branch's presence
from its absence. If none can, delete it rather than testing it.

**But two guards can address one symptom from different layers, and a fix to one does not retire
the other.** This rule is the thing most likely to cause that mistake, so check before deleting.
Worked example: `edit()` now returns unchanged when a mutator declines to act, so a refused
`moveItem` no longer leaves a dead undo step — which reads like it makes the MCP executor's
pre-check redundant. It does not. `moveItem` returns `void` either way, so without the pre-check
the executor still calls it, still sees nothing, and still returns `ok: true` to an agent whose
clip did not move; the agent then builds its next three calls on a timeline it believes it
changed. One guard fixes the history, the other produces the message. Ask what each guard's
*observable* is: if two guards have different ones, they are different guards.

**A probe is subject to the same discipline as a test: it must be shown capable of detecting what
it reports on.** Instruments fail the same way tests do, and this project has already produced
three confident wrong conclusions from probes that could not observe what they claimed was absent
— `querySelectorAll('video')` against a pool that deliberately keeps elements detached, a canvas
sampled synchronously after a redraw that schedules through rAF, and a background colour read
underneath an opaque full-frame clip. The measurement traps are collected in
[`test/app/README.md`](test/app/README.md); read it before writing a probe, and break the thing on
purpose to confirm the probe notices.

**A build-time fault belongs in a build-time gate, not a runtime check.** The MCP catalog and the
executor disagreeing is decided when the bundle is built and is identical on every machine that
runs it — so reporting it at mount aims the diagnostic at the one person who can do nothing about
it, and an early version threw there, taking the whole editor down over two tools. Contrast
`storageReady`, `mediaToolsReady` and `mcpReady`, which are genuine runtime conditions: the disk
really might be unwritable here and not there, and the app cannot know until it asks. Those belong
at runtime. A disagreement between two source files does not.

The fix is a gate that fires before a build exists to ship — `test/app/mcp.mjs` asserts every
catalog tool answers — plus a *non-fatal* runtime notice, because the two halves are edited by
different people at a seam neither sees whole, which makes the mismatch the likely condition
rather than the impossible one. "It cannot happen in a shipped build" was the tempting argument
and it is false in the direction that matters.

**When reporting several faults at once, order them by how well each one hides.** A text layout
that both substituted a font and clipped the words reported only the clipping, because the checks
ran in `else if` order. Clipping you can see on the canvas; a substituted face has no visual cue
at all — so the invisible fault must come first, and a list beats one chosen string.

**Write the sentence before the type.** Before designing a status, result or error type, write the
line a person reads for each state it can be in. If two states produce the same sentence, or one
produces a sentence you cannot write, the type is missing a field. `{ ready, error }` was complete
on its own terms and could not answer *"the socket is fine and nothing has connected"* — which is
exactly the state that let a database nobody knew had never loaded pass for one nobody had used.
Adding `connectionsSeen` was obvious the moment the sentence had to exist, and invisible while only
the type did. This is the inverse of the usual order and it is worth doing deliberately.

**"The other component happens to handle it" is not "this component reports it."** The distance
between those two is where most of this file's entries live. The export destination check first
deleted a failed job from the map — which made a failed job indistinguishable from a cancelled
one, and `pushFrame` and `finish` both return *silently* for a job they cannot find. A renderer
that ignored the `failed` event would have composited an entire timeline into nothing, received no
error from hundreds of `pushFrame` calls, and reported success: the exact failure the check exists
to prevent, reappearing inside the fix for it. It was nearly left that way because the engine's
export loop does await each push and does watch progress, so in practice it would have caught it.
Design each side as though the other is wrong, because one day a refactor will make it so.

**A hang is not a failure until something makes it one, and `cancelled` is a third outcome.** A
promise that never settles produces no answer rather than a wrong one, and Node's summary reports
it as `pass 7 / fail 0 / cancelled 1` — so anything reading those lines for `fail 0` calls it
green. The **exit code is 1**, so `pnpm test` and CI are safe; the hole is in reading the summary,
which is what a mutation harness and a human skimming output both do. Read the exit code, or match
`cancelled` and `skipped` as well as `fail`. And give tests that can hang an explicit
`{ timeout }`, so a stuck promise is named rather than stalling the suite for two minutes.

This is the third failure in the layer *between* "the bug exists" and "the report says so", after
a mutation that never applied and a harness that could not parse its own output. Expect that layer
to be the broken one.

**A test that exercises a build artifact is only as true as the last build, and the artifact's
freshness belongs in the assertion.** Staleness here is a false *pass*, not a false fail: edit the
transport, skip `pnpm build`, and the suite cheerfully proves the previous build still works. It
bit twice in one mutation run — two mutants failed `noUnusedLocals`, so `pnpm build` never
produced a new bundle, and both would have been scored against the previous artifact. The
`src/main/mcp` suite now asserts the bundle is at least as new as every non-test source beside it
and names `pnpm build` when it is not, because "the transport is broken" and "you did not rebuild"
are otherwise the same red. Same shape as the rest: the link between "the bug exists" and "the
report says so" was itself untested.

When that assertion fires it is **not a broken test** — it is the gate saying you have not built.
`socket-server.ts` newer than the proxy bundle fails the `src/main/mcp` suite by design, on an
otherwise clean tree, and the fix is `pnpm build`. Read the message before diagnosing.

**And the same staleness reaches every probe, because `electron .` compiles nothing.**
`package.json` points `main` at `./out/main/index.js` and the probes launch the binary, so any
`test/app/*.mjs` result describes **the last `pnpm build`**, not the working tree — on a tree
several people share, that means whenever one of *them* last built. It bit in the direction that
does not announce itself: someone fixed a bug, ran the probe, got 29 green *including* the
assertion aimed at the fix, and the change under test was not in the binary. `out/` happened to
contain their new files but not their newest edit. Had that one assertion not existed they would
have reported a verified fix that was never running. **Build before you probe**, and when a probe
result contradicts the source in front of you, compare mtimes before believing either.

**A probe run immediately after a failed build is worth nothing, and the passes scroll below the
failure.** Three probes reported 61/61, 29/29 and 29/29 against the previous bundle because the
build above them had errored and the output had scrolled. Read the build's exit status first; a
green probe cannot tell you it measured the wrong binary.

**Typecheck green over a tree the bundler refuses is possible in this direction too.**
`import { adjustmentFilter } from '@/engine'` type-resolved fine and rollup said *"not exported by
engine/index.ts"* — the barrel does not re-export `looks`. So `pnpm typecheck` is not a proxy for
"it builds", the way `pnpm test` is not a proxy for "it typechecks". Three gates, three different
claims. Use the deep module path rather than a barrel that may not re-export.

**`pnpm typecheck` covers `src/main/**`, `src/preload/**` and `src/shared/**` — and nothing else.**
A new top-level directory under `src/` compiles into the bundle and is invisible to the only gate
main-process code has. `src/mcp/` was nearly that; it is `src/main/mcp/` for this reason, with the
rollup input key still emitting `out/main/mcp/index.js` so the documented command is unchanged. If
you add a top-level source directory, add it to the tsconfig in the same edit.

**Every negative control needs its own positive control.** "The call that should have been refused
was refused" passes trivially against a surface that refuses *everything* — a tool that is simply
broken and a tool that is correctly strict produce identical output. So pair each refusal with the
nearest **legal** call that must still succeed: an unresolvable id beside a resolvable one, a
locked track beside an unlocked one, occupied time beside free time. Without the pair the suite is
a description of current behaviour rather than a test of intended behaviour, which is the
`sweepStaleCaches` shape one level along.

**Assert on an error's content, not its existence.** This codebase holds that an error is a
recovery instruction rather than a diagnosis, and that is only a real standard if something checks
it. A refusal naming the candidate ids lets the next call succeed; one saying "not found" ends the
agent's run — both are correct refusals and only one is usable. So the assertion is that the
message carries what the caller needs in order to retry: the candidates, the conflicting item, the
occupied range. An error that is merely correct should fail the test.

**This shell lies about whether your command ran, in three distinct ways, and all three
produce a confident wrong answer rather than an error.** They cost most of a session between them.

1. **`cp` and `rm` are aliased to interactive mode.** A mutation harness copied a pristine file
   back between runs; every restore stopped at an `overwrite? (y/n)` prompt that scrolled past in
   the output, so the mutations *accumulated* and each row of the results table measured itself
   plus all its predecessors. The whole table was garbage and looked fine. Use `/bin/cp -f`,
   `/bin/rm -f`, or `command cp`, and **re-run the baseline afterwards** — a restore you did not
   verify is not a restore.
2. **zsh has `$pipestatus`, not bash's `$PIPESTATUS`.** `echo "exit: ${PIPESTATUS[0]}"` prints an
   empty string here, so the guard written specifically to avoid reading an exit code through a
   pipe read nothing at all. Redirect to a file and check `$?`, which is unambiguous.
3. **zsh globs an unquoted `--include=*.ts` before `grep` sees it**, and with no match in the cwd
   it fails the whole command with `no matches found`. A loop checking ten identifiers printed
   "absent" ten times because grep never ran once. Quote it: `--include='*.ts'`. Any absence
   established by a command that errored is not an absence.

The shape shared by all three: **the instrument failed silently and its output was indistinguishable
from a real measurement.** That is the same class as a mutation that never applied and a probe that
could not see what it claimed was missing — this file's most repeated theme, one level lower down.

**And a feature absent under the name you guessed is not an absent feature.** A survey of this
tree's editing vocabulary grepped for `rippleDelete`, `rollEdit`, `slipItem` and friends, found
nothing, and concluded the whole ripple family was missing — while `delete_items` had carried a
`ripple` flag for weeks. The verb was a parameter, not a function name. Two habits fix it: grep the
*catalog* and the store's action list rather than a vocabulary you brought with you, and check the
counts move when you think you have added something new. A `git grep` for a name you invented tests
your naming, not the codebase. (This is also what `graft` is for — `graft skeleton` on
`src/renderer/src/store/types.ts` (every store action) or `src/shared/tools/index.ts` (every tool)
lists what is actually there, with no guessing at spelling.)

`pnpm typecheck` runs **two** projects — `tsconfig.node.json` (main + preload + shared) and
`tsconfig.web.json` (renderer + shared). A change to `src/shared/` is checked by both, which is the
point: it is the only code that crosses the process boundary.

`out/` is gitignored, as is `node_modules/`. `strict` and `noUncheckedIndexedAccess` are on in both
projects — indexing an array yields `T | undefined` and you must handle it.

## Conventions

- **`src/shared/` is the contract, and it is written before the implementation.** `project.ts` is
  the model, `ipc.ts` is every call the renderer may make into main. If the preload bridge, a main
  handler and a React component disagree, it is because someone added a channel without adding it
  here. Don't.
- **Timeline time is frames at the timeline's fps, never seconds.** Source offsets into media are
  microseconds, because the source has a frame rate we do not control. The conversions live in
  `project.ts` and are the only place the two are allowed to meet.
- **Assets are the "what", items the "where and when".** One asset backs many items. Moving a clip
  must never touch the asset.
- **Removing *clips* and removing *time* are two operations, and only one of them keeps sync.**
  `delete_items` removes a list of items — with `ripple: true` it closes the gap on the tracks it
  removed from and desynchronises every other track, which it documents and reports. `remove_range`
  removes a span of timeline across every unlocked track at once, splitting whatever straddles the
  bounds, so sync is preserved by construction. Only the second can cut the middle out of one long
  take, which is what a transcript-driven cut mostly is. `Shift+Delete` is the ripple in the UI;
  plain `Delete` lifts and leaves the gap. A locked track cannot be shifted, so `remove_range`
  **names** the tracks it left behind and how many frames adrift they are — never silently drifts.
  Bounds are half-open: `toFrame` is the first frame *kept*, so two calls sharing a bound remove
  exactly the union.
- **One mapping, one implementation — and a *duplicated* mapping is worse than either version of
  it.** `Adjustments` → CSS filter existed twice, in `@shared/project` and `engine/looks.ts`, and
  they disagreed about where `blur` goes in the chain. `contrast(0.5) blur(4px) grayscale(1)` and
  `contrast(0.5) grayscale(1) blur(4px)` are *different pictures*, so this was not a formatting
  difference; and `edit_item` reported one while the canvas drew the other, which made a tool result
  a confident lie about a picture the agent cannot see. The survivor is `adjustmentFilter` in
  `engine/looks.ts`, because the thing that composites is the only honest source for "the filter the
  compositor will use". It kept the shared version's `1e-6` identity epsilon: a strict comparison
  puts `brightness: 1.0000001` on the filtered draw path, which costs roughly twice as much at 4K
  for an image nobody can tell apart. **A default must emit `'none'`, not `brightness(1)`**, for the
  same reason.
- **One `NaN` anywhere in a filter string makes Chromium drop the entire chain.** So a single bad
  field silently removes every *other* adjustment on that item, with no error — which presents as
  "adjustments are flaky". Non-finite values fall back to the identity per field; that guard is
  load-bearing, not defensive.
- **A transition belongs to the junction, not to either clip.** It lives on `Timeline.transitions`,
  and nothing on an `Item` says one is attached — so any code walking items needs to consult
  `resolveTransition` explicitly, which is exactly how export audio came to play a hard cut under a
  cross-dissolving picture. `resolveTransition` is the authority on the window, never the stored
  duration: `transition.durationInFrames` is what was *asked for* and `resolved.durationInFrames` is
  what the handles allow. Using the stored value trims past footage that does not exist. The window
  is **centred on the cut**, so the incoming clip must sound before its own `from` and the outgoing
  past its end — both reading handle footage.
- **Preview and export must share the gain curve, not merely agree about it.**
  `transitionAudioGains` is the one implementation; export samples it per frame into a `volume`
  expression rather than choosing the nearest-named `afade` curve, because an `afade` name that
  merely *resembles* the curve diverges precisely in the middle of the window where the cross-fade
  lives, and both sides sound fine in isolation. That also means the curve is free to be bespoke —
  do not constrain it to what ffmpeg can name. Dip-to-black and dip-to-white are **not**
  cross-fades: both sides are silent at the midpoint, where the picture is fully the dip colour, so
  `acrossfade` would get them wrong.
- **Where a transition and an item's own fade meet, the transition wins and the fade at that end is
  ignored.** They express the same intent at the same place; multiplied, a 12-frame fade-out against
  a dissolve's ramp dips to near-silence mid-window — a hole neither side asked for. `item.volume`
  is a level rather than an envelope, so it multiplies. The rule lives in the shared function that
  resolves the gain, not in a comment on both sides, because a rule kept in two places is re-decided
  independently.
- **J/L cuts and ducking are in that same function, `itemAudioGainAt`** (`src/shared/audio-gain.ts`),
  and the preview's clip gain now reads it too — before, the preview multiplied fade × transition
  itself and so ignored the transition-wins rule above. A J/L item's sound plays from its own
  `<audio>` stand-in for its whole audible span (no seam at the picture cut), and its picture
  element is *claimed* silently, because an unclaimed media element plays to the speakers
  unmixed. Ducking is keyed on the key track's clips being present, not on signal level: Web
  Audio has no sidechain and ffmpeg's `sidechaincompress` has its own detector, so a level-driven
  duck would be two answers. Loudness mastering (`main/export/master.ts`) is a closed loop on the
  **encoded** file — gain, 4×-oversampled `alimiter` with `latency=1`, encode, `ebur128`, correct —
  never `loudnorm` (silently goes dynamic) and never judged on PCM (AAC adds ~0.5–0.8 dB of true
  peak; `master.test.ts` proves its specimen ships over the ceiling without the loop). Off by
  default. The mastered track is muxed with `-c:a copy`, and the delivered file is re-measured.
- **Keyframes have one sampler and item-relative frames** (`item.keyframes`, `@shared/keyframes`,
  `edit_item.keyframes`). The compositor paints `animatedItemAt` (in `#paintItem`, so every kind
  and a transition's two sides animate alike) and `itemAudioGainAt` reads `animatedVolumeAt`, so
  preview, `preview_frame` and export — picture and the per-frame volume envelope — sample one
  curve. No keys returns the item itself. A keyed property takes its value from the keys and its
  static field draws nowhere; `layout.scale` is a zoom about the centre (a transform, so type
  enlarges rather than reflows). Frame 0 is `item.from`: moves carry keys; an in-point trim
  (store trim, roll/slide's `keyframeShiftFrames`, ripple's kept tail, `apply_script` head trim)
  shifts them to stay on their footage; splits use `sliceKeyframes` (keys inside plus the nearest
  beyond each end — exact); slip and speed leave them; `retimeTimeline` scales them. Anything that
  asks "can this clip sound" must use `volumeMayBeAudible`, not `item.volume > 0` — a clip keyed up
  from volume 0 was otherwise dropped from export.
- **The `.bay` format changes additively within a version, and any other change is a bump.** A new
  *optional* field needs nothing: older builds of the same version load the file, carry the key
  through (the loader whitelists nothing) and write it back. Renaming, removing or retyping a field
  is a format change and needs all three of: `PROJECT_VERSION` bumped, a migration registered from
  the previous version in `src/main/project/migrations.ts`, and the new format's document spelled
  out as a string in `src/shared/project-fixtures.ts`. `migrations.test.ts` fails without any of
  them, and `project-format.test.ts` fails if the store stops writing a key the version-1 file has
  — which is what catches a rename that moved every reader along with it. Loading is two layers:
  **migrations** change what a document means, one version step at a time, and a document from a
  *newer* version is refused rather than loaded, because saving it would drop what this build does
  not know; **transforms** repair values (a `null` where `JSON.stringify` wrote a `NaN`, a negative
  start) and must be no-ops on a well-formed file. Never pass a format change off as a transform.
- **Layering is a test, not a comment** (`src/shared/boundaries.ts`). `shared/` reaches neither
  process nor Node/Electron/React; the renderer reaches no `node:`/`electron`; `engine/` reaches
  no store, React or UI; `components/` reaches no store; and the folders of `src/main/` and of
  `src/renderer/src/` import each other one way only. The rules are over what a file can
  *reach*, not what it imports — the engine got to the store through `lib/bay.ts` with no import
  that looked wrong. The failure names the whole route and where the code belongs. This is the
  deliberate alternative to workspace packages: the same boundaries with nothing moved out of
  sight of `committed-imports`, the resolver hook or the tsconfig includes.
- **The store is `store/editor.ts` (state and selectors) over `store/kit.ts` (`edit()`, undo
  bookkeeping) and one slice per concern in `store/slices/`.** A new action goes in the slice
  for its concern and in `EditorActions` (`store/types.ts`); each slice's `Actions` type lists
  exactly what it provides, so a missing or misplaced action fails typecheck.
- **Every project mutation goes through the store's `edit()`**, which snapshots for undo and stamps
  `updatedAt`. Poster and waveform arrivals pass `{ silent: true }` — they are not edits and must
  not land on the undo stack.
- **The renderer never touches the filesystem.** Media reaches it over the `bay://` protocol, which
  serves only allowlisted paths and must honour HTTP Range requests — `<video>` seeking is broken
  without them, and that is the most common way this goes wrong.
- **Nothing reaches the network — with five exceptions, all main's.** No telemetry, no
  analytics, no remote fonts or images. The CSP in `src/renderer/index.html` permits no remote
  origin; loosening it is a product decision, not a fix. The first exception is **access**: main
  (never the renderer) talks to `securetoken.googleapis.com` and `firestore.googleapis.com` only,
  to refresh the sign-in and read/write the access documents (`src/main/auth/google.ts`, whose
  `guardedFetch` refuses any other host). What it sends is a refresh token, an ID token and email
  addresses — never project data, media, paths or usage. It uses Node's `fetch`, because
  Electron's `net.fetch` rides the editor's session, which `offline.ts` (untouched) blocks. The
  second exception is whisper models, fetched
  by main from Hugging Face's `ggerganov/whisper.cpp` repo only when the user clicks Download in
  Settings, or when a transcription finds no model and "Download models when needed" is on (the
  renderer passes `download: true` only then). `downloadVerified` checks the size and SHA-256 from
  the redirect's `x-linked-size`/`x-linked-etag` — measured to be exactly `shasum -a 256` of the
  file — and writes to `.part` until they match, so a half-download never sits at a name the model
  search would pick. Audio never leaves the machine. The same exception covers **visual search's
  model** (`src/main/vision/`, `@shared/visual-search`, `index_footage`/`search_footage`): SigLIP's
  four files from `Xenova/siglip-base-patch16-224` at a pinned commit, each with a pinned size and
  SHA-256, fetched only on Download in Settings › Visual search or when `index_footage` finds no
  model and that same switch is on. Frames, embeddings and queries never leave the machine; the
  model runs on onnxruntime-node in a utility process (`vision/worker.js`, nice 10). The third is **updates**
  (`src/main/update/`): electron-updater's own session (`electron-updater` partition, never the
  editor's) may reach only the origin of the feed in `@shared/update-feed`, enforced in
  `onBeforeRequest` by `allowUpdateRequest`, redirects included. The feed is **unset**, so a
  shipped bay contacts nothing and Settings › About says "Updates: releasing soon".
  `BAY_UPDATE_FEED` points it at a loopback feed for testing, and nothing else. The fourth is
  **AI generation** (`src/main/generate/`, `@shared/generation`, `@shared/speech`, `generate_image`/
  `generate_video`/`generate_speech`/`track_generation`), and only with a key the user set in Settings › Providers (sealed by
  `safeStorage`, memory-only without a keychain, never returned to the renderer), only when a
  generation tool starts a job or a job still running at the last quit is resumed. Hosts, per
  provider, enforced by `providerHttp` on every hop of a redirect (manual follow; credentials
  only to the API host): `api.openai.com`; `generativelanguage.googleapis.com` (Gemini images and
  Veo), with Veo downloads allowed to redirect to `*.googleusercontent.com` and
  `storage.googleapis.com`; `api-singapore.klingai.com`, with results from `*.klingai.com` and
  `*.kling.ai`; `api.elevenlabs.io` (speech only, answered in the response body — no download
  hosts). Speech on OpenAI (`/v1/audio/speech`) and Gemini (`/v1beta/interactions`) uses the hosts
  above. What is sent is the prompt (for speech, the words to be spoken with the voice and style),
  the options and the one reference picture a call names (only a file already admitted to
  `bay://`); no audio ever leaves the machine. `estimate_speech` is local arithmetic
  (`@shared/speech-duration`) and contacts nothing. The job row is persisted *before* the request
  is sent, so a restart resumes polling instead of paying twice; results land content-addressed
  in `<userData>/generated`, are ffprobed, and a file with no picture (for speech: no audio stream, or no length) is a
  blocking finding that is never imported. The redirect hosts for Veo and Kling downloads are from the providers' docs,
  not observed — the tests use a local stub and never a live API. The fifth is **`import_url`**
  (`src/main/media/url-import.ts`, `@shared/url-import`): the *user's own* `yt-dlp`, found like
  `claude` (`search-dirs.ts`), never shipped or fetched by bay — missing, the tool says
  `brew install yt-dlp`. It runs only when that tool is called, on one `http(s)` address
  (`checkDownloadUrl`, checked in the renderer, in main's policy and again in the downloader), as an
  argument array with `--` before the address, and with `--ignore-config --no-config-locations
  --no-plugin-dirs --no-exec`, no cookies, `--no-playlist --playlist-items 1`, ≤1080p, ≤2 GB and
  15 minutes (then the process group is killed; quit kills it too). Output goes to a fresh folder
  under `<userData>/downloads` and the path yt-dlp prints is believed only inside it; a failed
  download's folder is removed. Which hosts it reaches is yt-dlp's business — whatever the page and
  its extractor need — so the guard is consent, not a host list: from the in-app agent every
  download asks the user in a native dialog showing the whole address (`policy.ts`), because an
  injected address can carry what the agent read out in its query string. Terminal clients are not
  asked; they have the network already. `url-import.test.ts` runs the real yt-dlp against
  127.0.0.1 when it is installed, never the internet.
- **Subscribe narrowly to the store** (`useEditor((s) => s.playhead)`), never wholesale, or every
  component re-renders at the frame rate during playback.
- **Playback is driven by wall-clock elapsed time, not by counting rAF callbacks**, and composites at
  the *project's* fps rather than the display's. Counting callbacks makes playback correct at 60Hz
  and double speed at 120Hz; compositing per refresh makes a 120Hz screen pay four times over to show
  30fps of footage. A frame-rate probe must therefore count **pictures**, not ticks — a tick that
  redraws the same image is indistinguishable from a new frame, so "p99 2ms" is entirely compatible
  with a picture updating four times a second.
