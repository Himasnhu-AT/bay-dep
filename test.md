# Testing `.brf`

How to test `.brf` motion modules properly: what is already proven and by what, and what is not
yet tested, as runnable cases with pass criteria. Read `CLAUDE.md` and `docs/testing.md` first —
especially **build before you probe**, **drive the app with `agent-browser --session bay`**, and
**undo what a probe did; do not save**.

## What a `.brf` is, in one paragraph

A JSX/TS module (`export default ({ t, vars }) => <scene duration={4}>…</scene>`) that
`write_brf` stores on an asset (`asset.brfCode`). In the app it runs in a locked-down Web Worker,
one per module (`engine/brf.worker.ts`), which turns frame numbers into JSON scenes
(`@shared/brf`) that the compositor paints (`engine/brf.ts`). The editor's session refuses every
remote request (`src/main/offline.ts`). Code: `src/shared/brf-code.ts` (compile, load, render),
`src/shared/brf-lockdown.ts` (sandbox), `src/renderer/src/engine/brfCode.ts` (runtime, cache,
timeouts), `src/renderer/src/mcp/brf.ts` (tools). Guide: `bay://guide/brf`
(`src/main/mcp/docs/brf.md`).

---

## 0. Before anything

```bash
pnpm typecheck; echo "typecheck $?"
pnpm test > /tmp/t.log 2>&1; echo "test $?"; grep -E '^ℹ (tests|pass|fail|cancelled|skipped)' /tmp/t.log
pnpm build; echo "build $?"
./run.sh --no-build          # after a successful build; read its first line
```

Pass: every exit status is 0; `fail 0`, `cancelled 0`, `skipped 0`; the test count is **not lower**
than the last recorded one (1169 at commit `bb1a1a5`). A drop means a test file stopped loading.

Before restarting a running instance, check nothing is unsaved (the title bar, or the projects
screen). A probe restores the project; a restart does not.

---

## 1. Already covered — run these, do not re-derive them

| What | Where | Proves |
|---|---|---|
| Scene format | `src/shared/brf.test.ts` | validation names every fault with its path and a suggestion; keys, easings, `%`, presets, stagger order, groups, clip, colours, gradients (with `$vars`), determinism |
| Runtime | `src/shared/brf-code.test.ts` | the example the format was designed around; Remotion idioms (`useCurrentFrame`, object `spring`, `<Sequence>` shifting the frame); `interpolate` clamp vs Remotion extend; spring physics incl. Remotion's critical-damping rule; components/fragments/loops; vars; seeded `Math.random`/`Date.now`; empty frames; every error message; `h`/`Fragment` shadowing; **every guide and worked-edit example compiled and run on every frame** |
| Sandbox | `src/shared/brf-lockdown.test.ts` | in a separate realm: network/messaging gone on global **and prototype**; `eval`, `Function`, async/generator constructors and `(() => 0).constructor.constructor` all blocked; the loader keeps its own; the host handler survives the seal |
| Network wall | `src/main/offline.test.ts` | remote schemes refused however spelt; local schemes allowed; dev server only on loopback |
| Tools | `src/renderer/src/mcp/brf.test.ts` | create+place is one undo step; compile error and a throw on a *later* frame change nothing and name frame+line; replace is one undoable edit; create-and-place is all or nothing (mutation-tested) |
| One undo step | `src/renderer/src/mcp/one-undo-step.test.ts` | `write_brf` create, create+place, replace each move history by exactly 1 |
| Worker failure | `src/renderer/src/engine/brfCode.test.ts` | a worker that cannot load (`onerror`) answers `crashed: …` at once instead of hanging; nothing is left in flight; a timeout on one request answers the runner's others (mutation-tested); a runner evicted to make room for a 9th module is not marked failed (fails against HEAD before the fix) |
| Cases 2.2–2.8 | `node test/app/brf-cases.mjs`, `node test/app/brf-persist.mjs` | playback/scrub blinks, undo/redo, Inspector variables, hostile and heavy modules; save/reopen/relaunch (see §3) |
| Export | `node test/app/brf-export.mjs` | the guide's counter exported cold: frame count, **every** frame of the file against `renderFrame`, the placement override in the file; `VERIFY_PROBE=1` (settle returns at once) must fail |
| In the app | `node test/app/brf.mjs` | every sandbox door shut **from inside the real worker** (sentinel throw as the control); foreign imports and endless loops refused; draws, moves, repeats exactly, takes placement vars; timing vs the HTML lower third |

Expected from `test/app/brf.mjs`: exit 0, 15 `ok` lines, a restore line, and
`renderFrame median: .brf ~3 ms · HTML ~90 ms`.

---

## 2. Not yet tested — the cases to run

Each case says how, and what passes. Record the result (✅ / ❌ with the observed output) in the
table at the end. When a case fails, check it is the code and not the instrument: rerun, and
break the thing on purpose to confirm the check notices (CLAUDE.md, "a probe must be shown
capable of detecting what it reports on").

### 2.1 Export of a code module ⚠️ highest value

Only a JSON scene was exported and inspected so far. CLAUDE.md: *a probe of the preview is not a
probe of the export*.

1. Through `window.bayMcp` (as `test/app/brf.mjs` does), clear the timeline and `write_brf` the
   guide's **Counter with a growing bar** example with `atFrame: 0`.
2. `export_timeline` to `~/Movies/bay/brf-code-export.mp4`, poll `track_export` until `done`.
3. `ffprobe -count_frames` → frame count = duration × fps (120 at 30 fps).
4. Extract frames at 0.1 s, 1.0 s, 3.0 s; compare each with `preview_frame` at the same frame
   (mean and non-zero share, as `test/app/export-vs-preview.mjs` does).

Pass: frame count exact; the counter reads `3,200` at 3.0 s in the file; export and preview
agree within the tolerance `export-vs-preview.mjs` uses; **no frame of the file is missing the
graphic** (the failure mode is an export that did not wait for the worker — a black frame where
the card should be). Delete the file afterwards.

Also export a module with **placement overrides** (`edit_item variables`) and check the override
is what the file shows.

### 2.2 Live playback

Scenes arrive in half-second chunks; the preview shows nothing for a frame that is still pending.

1. Place the **Kinetic captions** example over a video clip. Play from 0 for 4 s.
2. Sample `window.bayEngine.engine.stats()` (debug on) before and after, as
   `test/app/playback-probe.mjs` does; count pictures, not ticks.
3. Scrub rapidly back and forth across the clip with the mouse (agent-browser) for 5 s.

Pass: pictures/second stays at the project fps (29–30 at 30 fps); composite p99 does not rise by
more than ~2 ms over the same timeline without the `.brf`; no visible blink of the graphic during
steady playback after the first half second; scrubbing never shows a placeholder card. A blank
first frame after a seek is acceptable; a blank every half second is not (that would mean
prefetch is not running ahead).

### 2.3 Save, reopen, relaunch

The source lives in the `.bay` file (`asset.brfCode`); nothing else persists.

1. Write a module, place it, set a placement override, **save** to a scratch project (not a
   fixture), close it, reopen it.
2. Quit bay completely and relaunch; open the project again.

Pass: the clip draws identically before and after (compare `preview_frame` hashes at three
frames); the override is kept; `read_brf` returns byte-identical source. Also open the saved
`.bay` in a text editor: `brfCode` is a plain string field, `kind` is `"brf"`.

### 2.4 Undo, redo, and the agent's Revert

1. `write_brf` (create+place) → Cmd+Z → Cmd+Shift+Z. Then `write_brf` with `assetId` (replace) →
   undo → redo.
2. With the in-app agent (costs tokens): ask it for a title card; when the turn ends, check the
   Changes card lists the new asset/item; press **Revert**.

Pass: each step leaves exactly one history entry; undo of a replace restores the previous
source (the picture changes back); Revert removes the asset and item and the picture with them;
nothing about the `.brf` survives a revert (no orphan asset in the media pool).

### 2.5 Importing a `.brf` file from disk (UI path)

1. Save the **Bar chart** example as `~/Desktop/chart.brf`. Import it with the Media panel's
   Import button, and again by dragging it onto the window.
2. Import a broken one (`export default () => <scene>` — no duration).
3. Import a `.brf` that is plain JSON (an old scene document).

Pass: (1) the asset lists with the right duration (4 s) and places and draws; (2) the asset lists
**with an error naming the problem**, cannot be placed, and nothing crashes; (3) is rejected with
a compile error, not silently drawn wrong. Main must never run the file: confirm with
`grep -rn "brfCode" src/main` that main only reads it as text.

### 2.6 Inspector variables

1. Place the **Lower third, as components** example. Select it: the Inspector shows a section
   with `name`, `role` (text fields) and `accent` (a colour well).
2. Change each; select two placements and change `name` once.

Pass: the preview updates within a frame or two; one edit across a multi-selection is **one** undo
step; `inspect_item` reports the override; `edit_item { variables: { nope: 1 } }` is refused
naming the real variables.

### 2.7 The sandbox, adversarially

`test/app/brf.mjs` covers the direct doors. Try the indirect ones, each as a `write_brf` module
that throws `'OPEN: …'` if it succeeds (so an accepted write means the door is shut — keep the
sentinel control from the probe):

- `Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Object.getPrototypeOf(globalThis)), 'fetch')`
- `Reflect.construct(Function, ['return 1'])`
- `Object.getPrototypeOf(async () => {}).constructor`, via a class method, via a getter
- `new (Object.getPrototypeOf(function* () {}).constructor)('')`
- `setTimeout('fetch("https://example.com")', 0)` (string form of setTimeout evaluates code)
- `new Blob([...])` + `URL.createObjectURL` + a new `Worker` from it
- `self.navigator.sendBeacon`, `WebAssembly.compile` of a module importing host functions
- `globalThis.postMessage` fake reply — build a message shaped like a host reply and try to send it

Pass: every write is **accepted** (all doors shut) — except where the module legitimately cannot
compile. A door found open is a finding: add the name to `REMOVED_GLOBALS` or the constructor
list in `brf-lockdown.ts`, add the case to `brf-lockdown.test.ts`, and re-run. `setTimeout` with
a string is the likeliest gap; check it first.

Then the outer wall, independently of the lockdown: from DevTools on the editor window,
`await fetch('https://example.com')` must reject, and main's log must show
`[bay] refused a network request from the editor`.

**Automated:** `node test/app/brf-sandbox.mjs` runs every door above and more (24 synchronous,
8 deferred, each deferred one judged only after a function control has fired, and the instrument
shown able to read `OPEN`), then the outer wall. Note on the wall as first written here: a fetch
from the editor *document* is refused by its CSP (`connect-src 'self' bay:`) before main sees it
— measured, no `[bay] refused` line appears — so it tests the CSP, not main. The probe turns on
CDP's CSP bypass and fetches from a fresh iframe (its `data:` fetch answering proves the CSP no
longer binds it); only main can refuse that one, and the log line appears.

### 2.8 Hostile and heavy modules

| Module | Expected |
|---|---|
| `for (;;) {}` at module top level | `write_brf` refused after ~3 s: "took longer than 3s" |
| Allocates 2 GB (`new Array(3e8).fill(0)`) | refused with an error (worker crashes or throws); the app stays responsive; other `.brf` clips still draw |
| 5,000 `<rect>`s per frame | draws; note preview fps and composite time — this sets the documented practical limit |
| 60 s duration at 60 fps | scrubbing anywhere draws within ~0.5 s; memory stays bounded (scene cache cap 6000) |
| 9 different `.brf` clips on one frame | all draw (the runtime keeps 8 workers; the 9th forces an eviction and re-load — acceptable if it recovers) |
| A module whose output depends on `Math.random()` | same picture for the same frame across renders and across relaunch |

For each, record the app's memory (Activity Monitor, bay Helper (Renderer)) before and after.

### 2.9 Packaged app ⚠️

The worker is a separate file (`out/renderer/assets/brf.worker-*.js`), loaded as a module worker.
Development loads it from `file://`; the packaged app loads it from inside `app.asar`, which has
**not been tried**.

```bash
pnpm bundle && open release/mac-arm64/bay.app
```

Then write a module (in-app agent, or the socket MCP client) and check it draws, and that
`test/app/brf.mjs` passes against the packaged app (launch it with
`--remote-debugging-port=9222`). Pass: identical results to the dev build. Fail mode to look
for: `write_brf` refused with "crashed: …" or the worker never answering (3 s timeout) —
a worker that cannot load from the asar.

### 2.10 Dev mode (`pnpm dev`)

The worker is served by the Vite dev server; the session filter must allow the dev server and
its HMR socket. Pass: a module draws; editing `src/shared/brf.ts` hot-reloads without breaking
the next write; no `[bay] refused a network request` lines for `localhost:5173`.

Run it isolated. electron-vite passes everything after `--` to Electron, and sets the debugging
port itself:

```bash
./node_modules/.bin/electron-vite dev --remoteDebuggingPort 9237 -- --user-data-dir=$HOME/.bay-wt/NAME
```

Check main's first line says `MCP socket listening at …/.bay-wt/NAME/bay-mcp.sock` before you
probe. Probes find the dev renderer at `http://localhost:<port>/` (`cdp.mjs` also matches the dev
server's root, not only `index.html`). Test the cold path too: `rm -rf node_modules/.vite` first.

### 2.11 Agent quality (the reason the format exists)

With the in-app agent (costs tokens), give the same five briefs twice — once asking for HTML
(`write_composition`), once for a `.brf` — and record, per brief: succeeded on first write
(yes/no), number of `write_*` calls to a correct picture, tokens in the tool inputs, and
`preview_frame` checks it made. Briefs:

1. "A lower third for Jane Goodall, primatologist, in green."
2. "A counter that rolls from 0 to 12,400 subscribers with a bar underneath."
3. "Word-by-word captions for these two lines: …"
4. "An animated bar chart of these five numbers: …"
5. "A title card that types out 'Chapter 3' letter by letter."

Pass (the claim to test): `.brf` needs no more attempts than HTML and at least 3× fewer input
tokens. If it needs more attempts, read the refusals — the fix is usually in the error text or
the guide, not the model.

### 2.12 Regression sweep after any change to the engine

```bash
for p in brf mcp templates compositions composition-scale preview-frame; do node test/app/$p.mjs; echo "$p $?"; done
PROBE_TIMEOUT_MS=400000 node test/app/export-vs-preview.mjs; echo "export-vs-preview $?"
```

`preview-frame.mjs` derives its size check from the canvas (it used to hard-code 640×360 and
fail on every vertical project); `CANVAS=vertical-1080` runs it on a vertical canvas and the
restore puts the project's own back. `export-vs-preview.mjs` needs the longer watchdog when the video decoder is busy.

---

## 3. Results

| Case | Result | Notes (observed output, date, build) |
|---|---|---|
| 0 gates | ✅ | 2026-09-24, worktree build: `pnpm typecheck` 0; `pnpm test` 0, 1380 tests, 1380 pass, 0 fail/cancelled/skipped (up from 1169); `pnpm build` 0. |
| 1 automated + `brf.mjs` | ✅ | Isolated profile, CDP 9273: `brf.mjs` exit 0, 15 ok, `.brf 2.8 ms · HTML 103.7 ms`. It must run on a project with no `.brf` assets in its pool: on one that had some it failed "refused modules left no asset behind: got 3, expected 1". It counts every `.brf` asset in the project, so this is a limit of the probe, not a fault in bay. |
| 2.1 export of a code module | ✅ | `test/app/brf-export.mjs` against the packaged build (2026-09-23, 1920×1080 @ 30): export finished, `ffprobe -count_frames` 120 = 4 s × 30; all 120 frames of the file match `renderFrame` (worst grid cell 1.8 pts, tol 4; lit share within 0.03 pts); 0.1/1.0/3.0 s: preview 0.20/1.98/1.96 % lit, file 0.20/1.97/1.96 %; no frame missing the graphic; the 3.0 s frame read by eye: **3,200**. Override `value 3200→7`: oracle moves 19.6 pts at 3.0 s, file matches the override (worst cell 0.6). Control `VERIFY_PROBE=1` (settle returns at once): frames 0 and 1 black in the file — caught; the three sampled frames alone all matched, so only the every-frame scan sees it. The exporter already waited; no fix needed there. **Reported since** (same day, isolated build, CDP 9237): `track_export` now answers `complete: false` with `incompleteFrames` for the `VERIFY_PROBE=1` export: `{frames: 2, ranges: [[0,1]], items: [{name: "Counter probe", frames: 2, ranges: [[0,1]]}], gradeIssues: []}`. Those are exactly the file's two black frames. The warning names them and says to export again. The normal export is the positive control: `complete: true`, no warning, every frame matching. |
| 2.2 live playback | ✅ | `test/app/brf-cases.mjs` (`CASES=playback`) records every preview draw by wrapping `Compositor.prototype.drawFrame`, and the `.brf` named in `pendingNames` counts as a blink. Kinetic captions over the Goodall clip, 4 s from 0. **Without the `.brf`:** 30.7 pictures/s, composite p50 0.2 ms, p99 0.4 ms. **With it:** 30.0 pictures/s, p50 0.3 ms, p99 1.7 ms (+1.3 ms; a second run measured +1.3). 0 of 138 steady draws had the `.brf` pending, and none in the first 0.5 s either. **Control:** after `brfRuntime.dispose()` and a seek, 2 of 4 draws were pending and then it drew. So the recorder can see a blink. **Mouse scrub:** a CDP drag on the ruler for 5 s across the clip, starting cold: 268 draws over 60 distinct frames (range ≥ 100 frames), the `.brf` pending in 2 draws (longest run 2, the first touches of a chunk), 0 placeholder cards, and the last draw complete. |
| 2.3 save / reopen / relaunch | ✅ | `test/app/brf-persist.mjs`. `PHASE=write` makes a scratch project through `project.create()` (Vivid Scarlet Gecko, since deleted). It contains the Lower third with an override `{name: 'Jane Goodall', accent: '#FF3366'}` and a `Math.random` module. **Control:** the override changes the picture. After saving, going home and reopening, each clip rendered alone gives the same `renderFrame` hash at frames 10/45/100, the override is kept, and `read_brf` returns byte-identical source. Then I quit bay completely and relaunched it. `PHASE=verify`: the same hashes for both modules, the override kept, `read_brf` byte-identical. The `.bay` holds each module as a plain string `brfCode` with `kind: "brf"`. |
| 2.4 undo / redo / Revert | ✅ | `brf-cases.mjs` (`CASES=undo`), with real Cmd+Z / Cmd+Shift+Z key events from CDP. Create+place is 1 entry. Cmd+Z removes the new asset and the item (lit 0.0154 → 0). Redo brings back the same picture. Replace is 1 entry and changes the picture. Undo restores the previous source (`read_brf`) and the previous picture hash, and redo puts the replacement back. An earlier version of the check asserted "0 `.brf` assets left" and failed on a project that already had some, so the counts are now taken against the pool as it was. **In-app agent** (claude CLI): "Make a short title card as a .brf that says 'Chapter 3'…" → `write_brf` + `preview_frame`. The Changes card listed "Imported 'Chapter 3 Title' / Added track V4 / Added 'Chapter 3 Title' on V4, 0:00:00–0:03:00". **Revert** removed the asset, the V4 track and the item, and left no orphan asset in the pool. It added one undoable entry (past 6 → 7). |
| 2.5 import from disk | ✅ with a note | These are real drops on the window: CDP `Input.dispatchDragEvent` with `files`, which goes through `webUtils.getPathForFile` and `importPaths`. (1) `chart.brf` (the Bar chart example) is listed as `brf`, 0:04. `place_asset` placed it, and `renderFrame` at 3 s drew it (drawn 1, 0 pending, blue and green bars present). (2) `export default () => <scene>` → error `does not compile: Unexpected token, expected ";" (1:19)`. A missing duration (`<scene>` without `duration`) → `frame 0: <scene> needs duration={seconds}, a number above 0`. (3) An old JSON scene document → `does not compile: … (2:13)`, so it is not drawn. Each broken one appears in the pool as a disabled card that cannot be dragged. `place_asset` refuses it and names the error, `placeAsset` returns null, and nothing crashed. **Note:** the card says "Could not be read", and the actual error is only in its hover title. The toast also says "Could not read 1 file". The file *was* read; the problem is that it does not compile. I left this wording unchanged. **Import button:** clicking "Import media" opens main's "Import media" dialog (window-server list), which I cancelled. I did not automate picking a file in the native panel, because that means typing into a panel through global keystrokes. Main never runs a `.brf`: the only `brfCode` in `src/main` outside tests is `media/import.ts:163`, which reads it as text. |
| 2.6 Inspector variables | ✅ | `brf-cases.mjs` (`CASES=variables`), Lower third placed twice. The Inspector shows `Name` and `Role` as text fields and `Accent` as a colour well. Text typed with CDP `Input.insertText` changes the preview within 200 ms, as one undo step. `inspect_item` reports `{name, role}`. For Accent I typed into the hex field and pressed Enter, because the native picker cannot be driven. That sets the accent, changes the preview, and is one undo step. With both placements selected, one edit changes both and is one undo step. `edit_item {variables: {nope: 1}}` is refused with "Lower third declares no variable \"nope\". It declares: name (string), role (string), accent (color)." **Control:** `{role: 'Ethologist'}` is accepted. Not measured: typing character by character. The text field commits on every `input` event, so each keystroke would be its own undo step. |
| 2.7 sandbox, adversarial | **pass after fix** | 2026-09-23, worktree build, isolated profile. **Found open** in the real worker: string `setTimeout`/`setInterval` ran (global and via `WorkerGlobalScope.prototype`; would also have carried a generated `import()` past the source check); a `dispatchEvent`ed `MessageEvent` shaped like a host `load` replaced the probed module with an unprobed one; `new FontFace('x','url(https://…)')` + `self.fonts` issued a request only main's filter stopped; the `webkitRequestFileSystem*` storage API was present. **Fixed** in `brf-lockdown.ts`: timers wrapped (made in the target realm, `Reflect.apply` captured) to refuse non-functions; the host listener ignores untrusted events; `FontFace`, `fonts`, `webkit*FileSystem*` removed. **Shut already:** `Reflect.construct(Function)`, async/generator/async-generator constructors via prototypes, class methods, getters, bound functions, indirect eval, `Worker`/`SharedWorker` (Blob URL), `importScripts`, `navigator.sendBeacon`, WebSocket/EventSource/XHR/WebTransport, `postMessage`, `queueMicrotask`/`scheduler.postTask` with a string (TypeError). **Not doors:** WebAssembly (an instance calls only the imports the module hands it), `structuredClone` (cannot clone functions), `Atomics.wait` (no `SharedArrayBuffer`: not cross-origin isolated). `brf-sandbox.mjs` exit 0, and against the pre-fix build it failed at `shut: setTimeout with a string` (got `OPEN`). Outer wall: iframe fetch rejected, main logged `refused a network request from the editor: https://example.com/?bay-outer-wall`. |
| 2.8 hostile and heavy | ✅ after a fix | `brf-cases.mjs` (`CASES=heavy`). `for(;;)` at the top level is refused at 3003 ms with "took longer than 3s…", and the app answers at once. `new Array(3e8).fill(0)` is refused, but the reason varies between runs: once a 3 s timeout, once `failed while loading (line 1:99): Invalid array length`. The app stays responsive and a bystander `.brf` draws the identical picture. 5,000 rects: accepted in 78–146 ms, and plays at 30 pictures/s with composite p50 6–8 ms and p99 7–10 ms, 0 draws pending. That sets the practical limit at roughly 5k shapes for a 33 ms budget. 60 s at 60 fps: 10 seeks across the minute each drew within 0–102 ms (most 9 ms), and the scene cache peaked at 750, under the 6000 cap. `Math.random`: the same hash for the same frame across renders and with a fresh worker (`brfRuntime.dispose()`); relaunch is covered in 2.3. **Found and fixed:** with nine different `.brf` clips on one frame, one module became a **permanent placeholder**. In `renderFrame` 8 drew, 1 was a placeholder, and all 113 live draws had a placeholder. The eviction that makes room for a 9th worker terminated the runner without answering what it was waiting on. That request hit the 3 s timeout and recorded "took longer than 3s … look for a loop" against a module that had done nothing wrong. Now `#evict` answers the waiters and records nothing against the module (`brfCode.ts`). After the fix: nine drawn, 0 placeholders, runtime errors unchanged. HEAD's runtime failed the same probe (drawn 8, placeholder 1, +1 error), and so did the fix with its guard removed. The unit test `brfCode.test.ts` › "nine modules on one frame…" fails against HEAD's code (`took longer than 3s…`) and against the guard-less mutant. **Still true after the fix:** during playback with nine modules, the 8-worker LRU thrashes. 52–56 of ~130 live draws had some module pending (blank for that draw), and it settles once paused. **Memory** (every process of the app, by the debugging port's owner): 281 MB → 331 after the hostile modules → 468–672 MB during the long and nine-module cases. The JS heap stayed at 13–31 MB. |
| 2.9 packaged app | ✅ after a fix | `pnpm bundle` → `release/mac-arm64/bay.app`, launched directly (own `--user-data-dir`, CDP 9231; renderer at `file://…/app.asar/out/renderer/index.html`): `brf.mjs` exit 0, 15 ok, `.brf 3.1 ms · HTML 91.8 ms`. Worker loads from inside `app.asar` over `file:` (allowed by `offline.ts`'s local schemes and by the CSP's `script-src 'self'`). **Broken on purpose** (worker renamed inside the asar header): before the fix `write_brf` never answered (CDP "Promise was collected", probe CANNOT MEASURE after 120 s) — `#fail` dropped waiters without resolving them; after it, `brf.mjs` exits 1 at the control with `The .brf crashed: the worker could not start …`. |
| 2.10 dev mode | ✅ after a fix | 2026-09-23, electron-vite 4 / Vite 7.3.6, dev server `http://localhost:5173/`, own profile (`--user-data-dir` after `--`; the socket was under `~/.bay-wt/devx`) and CDP 9237. `brf.mjs` exit 0, 15 ok, `.brf 3.4 ms · HTML 95.9 ms`. **Network:** no `refused` line for the dev server or its HMR socket. Positive control: `brf-sandbox.mjs`'s CSP-bypassed fetch logged `[bay] refused a network request from the editor: https://example.com/?bay-outer-wall`, the only refused line. `offline.ts` needed no change. **HMR:** a line appended to `src/shared/brf.ts` → Vite `page reload …/src/shared/brf.ts` over the HMR socket (a marker set in the page was gone after it). It is a full reload, not a hot update: the module has no HMR boundary. Then `brf.mjs` again: exit 0, 15 ok. **Found and fixed:** with a cold `node_modules/.vite`, the first `write_brf` made Vite discover `sucrase`, which only the worker imports, and log `new dependencies optimized: sucrase … reloading`. That reloaded the editor in the middle of the call (probe: `Inspected target navigated or closed`), and any unsaved edits went with it. Reproduced twice. `optimizeDeps.include: ['sucrase']` in `electron.vite.config.ts`: cold cache again, `brf.mjs` exit 0, 15 ok, no reload, `sucrase.js` optimised at startup. Also seen: `window.__vite_plugin_react_preamble_installed__` is false in dev, because the CSP's `script-src 'self'` blocks plugin-react's inline preamble. React Fast Refresh was not exercised. Left alone, since the CSP is a product decision. |
| 2.11 agent quality | ✅ 5/5 (`.brf` only) | I did not use the in-app agent for the briefs. A Claude subagent was given only `src/main/mcp/docs/brf.md` and the five briefs from §2.11 (brief 3's lines: 'Chimpanzees make tools.' / 'They taught us what makes us human.'; brief 4: 12, 45, 30, 60, 22). It wrote one file per brief on its first attempt. Each file went through `write_brf` in the app unchanged. **All 5 were accepted on the first write**, with no refusals. Each rendered alone with nothing pending and no placeholders at four frames. By eye at 60% of each duration, all five are correct: the green lower third "Jane Goodall / Primatologist", "12,400 subscribers" with a bar, the word-by-word second line mid-entrance, five labelled bars with the maximum highlighted, and "Chapter 3_" typing with a cursor. The in-app agent (claude CLI), asked separately for a 'Chapter 3' card (2.4), used 1 `write_brf` and 1 `preview_frame` and succeeded first time. **Not done:** the HTML (`write_composition`) side of the comparison, and token counts, so the "3× fewer input tokens" claim is untested. |
| 2.12 regression sweep | | |

A failing case gets a test before its fix: the automated test goes where section 1 says that
kind of thing lives, and is shown failing against the bug before it is trusted.
