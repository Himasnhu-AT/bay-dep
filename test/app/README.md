# App checks

Probes that drive the **built** app over the Chrome DevTools Protocol and measure what actually
reached the screen. They are a second gate, separate from `pnpm test`, because they need a real
window, a real GPU, a real decoder and a built `out/` — none of which exist under `node --test`.

```bash
./run.sh              # build and run exactly one instance with CDP on 9222
node test/app/<probe>.mjs
```

**New app-level checks are done with `agent-browser`, not by adding probes here.** The guide is
[`docs/testing.md`](../../docs/testing.md) — use `--session bay`, and read its traps first. These
probes remain the scripted regression gate.

## Why these exist

Every bug that survived to a running app this week was invisible to the unit suite, and all of
them were in the same seam: between a component that was correct in isolation and the thing it
was supposed to be talking to. A media element that decoded perfectly while nothing asked for a
redraw. A compositor whose arithmetic was right and whose output landed in the wrong third of the
canvas. A database that could not load in Electron while passing every test under Node.

The unit suite cannot reach any of that, and the honest response is a second gate rather than a
fake DOM whose fidelity is itself the thing under test.

## Launch the app with the throttling flags

Trap 1 stops being a trap. Found by `interface`: under a fullscreen terminal macOS marks the
Electron window occluded, Chromium freezes `requestAnimationFrame`, and `Page.bringToFront` is
**not** enough to undo it — the window reports `visibilityState: 'hidden'` and `rafOk: false`
with front-ing already called. Every probe then measures a dead clock.

```bash
pnpm build
./node_modules/.bin/electron . \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/bay-probe \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --disable-background-timer-throttling &
node test/app/<probe>.mjs
```

With those flags `visibilityState` is `visible`, `hasFocus()` is true and rAF runs regardless of
what is in front, and `ticks.mjs` reports the same numbers with and without `bringToFront`.

**If that launch exits 133 and prints nothing, you are not in a GUI session.** Execing the
binary directly needs a window server, which an agent shell or a remote session does not have;
Electron starts, `app.whenReady()` never resolves, and you get a SIGTRAP with an empty log —
indistinguishable from a crash on startup. Go through `open`, which routes via launchd into the
logged-in session:

```bash
open -na "node_modules/.pnpm/electron@*/node_modules/electron/dist/Electron.app" \
  --args "$PWD" --remote-debugging-port=9222 --user-data-dir=/tmp/bay-probe \
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
  --disable-background-timer-throttling
```

`agent-browser connect 9222` then drives it, and `agent-browser eval "<expression>"` reaches
`window.bay` directly, which is the cheapest way to exercise a bridge call end to end without
writing a probe for it.

**A composition window is itself a CDP target, and it is the one you will attach to.** An HTML
composition renders in an offscreen `BrowserWindow`, which appears in `/json` alongside the
editor — so the moment a composition has been opened, "the first page target" is `demo.html`
rather than bay. It has no `window.bay`, so every bridge call comes back
`Cannot read properties of undefined`, which reads exactly like the app having crashed. It has
not. List targets and pin the one whose url ends `out/renderer/index.html` before measuring
anything:

```bash
agent-browser tab          # -> [t1] bay ... [t2] demo.html ...
agent-browser tab t1       # ids, not indices; `tab 1` is rejected
```

Use your own port and `--user-data-dir`, and kill the pid you started — several agents drive this
app at once, and a shared port or profile makes two runs fight over one database lock.

**Leave the flags off when you are deliberately testing occlusion behaviour.** They are the thing
that suppresses it.


## The traps, so nobody re-derives them

Each of these produced a confident, wrong conclusion before it was understood. They are listed in
the order they cost the most time.

1. **An occluded window stops `requestAnimationFrame`.** A backgrounded app has a frozen clock,
   zero ticks, and a preview that never updates — indistinguishable from a dead engine. A
   `<video>` element is *not* throttled the same way, so audio runs on over a frozen picture.
   `Page.bringToFront` is **not** sufficient: under a fullscreen terminal the window stays
   occluded and reports `visibilityState: 'hidden'` with fronting already called. Launch with the
   flags above. This one cost three people a combined afternoon and produced two wrong bug
   reports — a "clock that never ticks" and a "playback that never advances", both of which were
   a covered window.

2. **`document.querySelectorAll('video')` cannot see the decoders.** The media pool keeps its
   elements detached from the document on purpose — they are decoders, not markup. An empty
   result is not evidence that nothing was created. Ask the pool.

3. **`redraw()` schedules through rAF; it does not draw synchronously.** Sampling the canvas in
   the same turn measures the frame before. Wait two animation frames.

4. **Sample the whole canvas, and count distinct colours.** One pixel near the origin of a
   letterboxed clip samples the dark part of the picture and reports "black canvas". A single
   mean is nearly as bad — the mean of a correct frame and of a frame drawn into one third of the
   canvas both come out low. **Per-band `%nonZero` is the honest measure**: real footage has
   scattered non-zero pixels everywhere, so a band at exactly 0.0% is an absence of drawing, and
   a hard edge between 0.0% and 100% bands looks like a geometry fault rather than dark
   content. **Read trap 7 before acting on that** — it is true only when the source is known to
   have something there, and assuming it produced the single most expensive error in this file.

5. **A timeline background colour is unobservable under a full-frame clip.** The compositor fills
   the background and paints the item over every pixel of it, so setting the background and
   reading the canvas is a probe that cannot fail. Use it only where the canvas is genuinely bare.

6. **Scope your process cleanup.** `pkill -f Electron` kills everyone else's instance too; four
   probes were lost to it in one session. Launch with your own `--user-data-dir` and
   `--remote-debugging-port`, and kill the pid you started.

**7. A clip's own black regions defeat lit-pixel extent as a test of geometry.** This was the
most expensive one: three observers independently measured a vertical clip covering only the
bottom third of the canvas, with a hard 0.0%-to-100% edge at row 666, and all three concluded
the compositor was misplacing it. It was not. Decoding the source directly settles it —

    ffmpeg -v error -ss 20 -i <clip> -frames:v 1 -f rawvideo -pix_fmt gray -s 1080x1920 -

and profiling that raw luma shows **eight consecutive bands at exactly 0.0% non-zero**, rows
288-1056, then 100.0% at mean 95.7. The hard edge is in the footage. Mapping it through the
layout predicts a canvas boundary at row **666.7**; the measured boundary was **666**.

The lesson generalises: `%nonZero` distinguishes "dark here" from "nothing drawn here" *only*
when the source is known to have something there. To test a **layout**, measure the extent of
the drawn rectangle along an axis where the clip is not black — `colExtent` for this clip — and
compare it against `left * scale` and `(left + width) * scale`. `geometry.mjs` does exactly that
and prints the band profile beside it, so the vertical story reads as footage rather than as a
mystery.

**8. A probe must be proven able to see what it reports on — and the break must be on the side
the probe does not derive its expectation from.** `geometry.mjs` computes `expectedCols` from the
layout, so breaking the *layout* would move both sides together and pass no matter what the code
did. `VERIFY_PROBE=1` instead patches `CanvasRenderingContext2D.prototype.drawImage` to halve the
destination width — a broken compositor without touching the compositor — and asserts the probe
reports FAIL. Run it after changing a probe:

```bash
PORT=<port> VERIFY_PROBE=1 node test/app/geometry.mjs   # exits 0 only if the probe caught it
```

**9. Agreement between instruments is not evidence when they share a premise.** Trap 7 was
believed because three people measured the same boundary independently and got the same answer.
They were not three observers; they were one method applied three times, and what agreed was the
assumption underneath it — that a 0.0% band meant nothing had been drawn there. Corroboration only
counts when the second measurement can fail in a way the first cannot: decoding the source
directly is independent of the canvas, so it settled in one run what three canvas measurements
had entrenched. When a result is confirmed, ask what the confirmations have in common before
counting them.

The same error has a mirror image, and both bit this project within an hour: a *single* real
measurement standing beside an unverified premise, lending it authority it had not earned. One
number checked and one assumed reads exactly like two things checked.


## The standing rule

A probe is subject to the same discipline as a test: **it must be shown capable of detecting the
thing it reports on.** Three of the wrong conclusions above came from instruments that could not
observe what they claimed was absent. Before trusting a probe, break the thing on purpose and
check the probe notices.


**The probe surface is opt-in.** `window.bayEngine` only exists when `localStorage['bay.debug']`
is `'1'`, so it is absent from a release build unless someone deliberately sets it. `cdp.mjs`
sets the flag and reloads before waiting for the engine; any new probe should use `attach()`
rather than connecting by hand, or it will find no handle and report a dead engine.


## Answered: a queued rAF is deferred across occlusion, not dropped

`redraw()` once carried a staleness re-arm on the theory that a callback queued while the
window is hidden could be **dropped**, latching the coalescing flag forever and silently
killing every later redraw. `interface` settled it. Across occlusions held 4s, 6s and 15s:

    r1 armed while visible   -> fired
    r2 armed while hidden    -> false during occlusion (page verifiably still 'hidden')
    r2 after restore         -> true   (visibility checked as 'visible' before the read)

**The queue survives occlusion and drains on restore.** The latch cannot be permanent, nothing
could distinguish the guard's presence from its absence, and it was deleted rather than kept and
tested — per the standing rule about unfalsifiable code.

The negative control is what makes that conclusion load-bearing rather than four repetitions of
one method: the same run arms a third callback while hidden and **cancels** it, and after restore
that reads `false` in the same turn that `r2` reads `true`. The probe can distinguish a callback
that never runs from one that was merely waiting. Without that control, four identical runs would
have been trap 8 all over again.

### Restoring a window to genuinely visible: only the Dock works

This is what blocked the experiment for a long time. Once macOS has occluded the window, these
all leave the page `hidden`:

    System Events "set frontmost"   -> hidden
    AXRaise                         -> error (no window for that pid)
    CDP Page.bringToFront           -> hidden
    Dock icon click                 -> VISIBLE   <- the only one

```bash
osascript -e 'tell application "System Events" to tell process "Dock" \
  to click UI element 1 of list 1 whose title contains "Electron"'
```

The Dock entry is titled **"Electron"** for an unpackaged run and **"bay"** once the app names
itself, so try both and re-check `visibilityState` after each. It also needs a retry loop; it
fails intermittently just after launch. Occluding is the easy half — `tell application "Terminal"
to activate` with a fullscreen terminal, then confirm `hidden`.

Full recipe for anything that measures behaviour across occlusion:

    1. launch WITHOUT the throttling flags (they suppress the thing under test)
    2. Dock-click to visible, verify
    3. Terminal activate to occlude, verify 'hidden'
    4. arm what you are measuring
    5. Dock-click back, verify 'visible' BEFORE reading
    6. read

## "I could not measure" is a third result, and it needs its own exit code

`geometry.mjs` once ran against a freshly launched instance and printed:

    timeline          1920x1080 -> canvas 300x150
    measured columns  [300,-1]      all 20 bands 0% nonZero
    FAIL: drawn rect does not match the layout

**300x150 is the HTML default canvas size.** The element had never been sized by the engine, so
nothing had been composited — and the probe rendered that as a claim about the compositor's
arithmetic. That is worse than a flake. A flake teaches people to re-run; a false accusation
sends them into code that was working.

So every probe here distinguishes three outcomes:

    0   measured, and it is right
    1   measured, and it is wrong        <- a finding about the code
    2   could not measure                <- a finding about the harness

`cdp.mjs` provides `requirePrecondition(evaluate, label, expression)` and `runProbe(body)`. A
precondition that does not hold throws `PreconditionError`, which `runProbe` turns into
`CANNOT MEASURE: <the precondition, named>` and exit 2. `CANVAS_READY` collects the three that
every canvas measurement depends on: the canvas has been sized by the engine, the engine has
composited at least once, and the timeline has an item under the playhead.

**Wait on the precondition, never on a timer.** Every fixed sleep is a guess about how long a
cold start takes, and the guess is wrong on the machine that happens to be compiling something
else. The 300x150 run above was a 2.5s sleep that was not enough.

Self-check for the machinery itself, because it is subject to the same rule as everything else:

```bash
PORT=<port> VERIFY_PRECONDITION=1 node test/app/geometry.mjs   # places nothing; must exit 2
PORT=<port> VERIFY_PROBE=1        node test/app/geometry.mjs   # breaks the draw; must exit 0
```

Verified: the first prints `CANNOT MEASURE: the timeline has an item under the playhead` and
exits 2; the second still detects a halved destination rect and exits 0.

**And read the probe's real exit code.** `node probe.mjs | head` reports `head`'s status, not the
probe's — the same pipe trap the Rust tree records for `./test.sh | tail`. It has already caused
one probe to be reported as a broken gate when it was working correctly.


## Bound every CDP call, or a probe exits 13 instead of reporting

A probe reported `exit 13` with no verdict and one line of output:

    Warning: Detected unsettled top-level await at geometry.mjs:19
    const { evaluate, close } = await attach()

**Exit 13 is Node's code for an unsettled top-level await.** The hang was not in the check or
in `runProbe` — it was in the transport. `cdp.mjs` rejected every pending call when the socket
*closed*, which covers a dead renderer; it did not cover a socket that is still open while the
page behind it has stopped answering, which is what a reload, a crashed renderer or a frozen
compositor look like from here. The call's promise stayed pending, the event loop emptied, and
Node exited with a status no caller interprets and a message naming the harness rather than the
check. That is strictly worse than the wrong verdict it replaced: a wrong verdict at least says
something about the system.

Every `cdp.send` now takes a timeout and rejects when it expires, `Runtime.evaluate` carries
both Chromium's own execution cap *and* an outer cap on ever hearing back, and `runProbe` has a
watchdog so the body always settles. **A rejection is a verdict; a hang is not.**

Note that Chromium's `Runtime.evaluate` `timeout` parameter cannot save you here — it bounds
running the expression, and it cannot fire if the page has stopped processing CDP messages at
all. Two different bounds for two different failures.

## A self-check needs to work from every starting state

`VERIFY_PRECONDITION=1` originally worked by *placing nothing* and waiting for "an item under
the playhead" to fail. Against an empty project that is a real test. Against a **seeded** project
— one loaded from disk with a clip already on the timeline — the precondition is satisfied before
the probe does anything, the mode proves nothing, and it looks like it passed.

A self-check that only works from one starting state has a precondition of its own, undeclared.
The mode now **empties the timeline explicitly**, so it fails deterministically from any state,
and it is verified from both:

```bash
PORT=<p> VERIFY_PRECONDITION=1 node test/app/geometry.mjs               # empty start  -> exit 2
PORT=<p> SEED_ITEM=1 VERIFY_PRECONDITION=1 node test/app/geometry.mjs   # item present -> exit 2
```

Run each mode against a **fresh app instance**. Several probes in one instance contaminate each
other — one run's clip persists into the next, and a run that kills the app makes the following
one report "no renderer target", which reads like a probe fault.


## The one draw path still untested: a project reopened from disk

`latearrival.mjs` covers a project delivered to the store *after* the engine mounts, which is
the shape `project.initial()` produces — but it delivers it by calling `setProject` directly.
The real launch path goes through main's persistence, and that is different code.

`coldstart.mjs` is that probe. It needs a profile with a saved project and **cannot create one
itself**, which is worth knowing before you try:

    project.save(project)      -> opens a system dialog; a CDP run cancels it
    project.autosave(project)  -> resolves fine, but with project.filePath === null it does
                                  not become the reopenable project
    app.storageReady()         -> {ready: true, error: null}   (so this is not a DB failure)
    project.recent()           -> []
    project.initial()          -> "Untitled", 0 items

So seed a `--user-data-dir` by saving a project by hand once, then point the probe at a launch
using that profile. Against an unseeded profile it reports CANNOT MEASURE, which is the correct
answer and not a failure of the app.

**Against a live instance it proves less, and says so.** `attach()` no longer reloads a page
that already has the probe handle, so when a project is already open nothing was reopened. The
probe then blanks the canvas, re-delivers the open project with `setProject` (a structural copy)
and waits for a draw: that proves a project *arriving* draws itself, not that persistence hands
the store a drawable one. Its first line names which path it measured. Only a fresh launch —
bay on its projects screen, `attach()` opening the project through `open_project` — exercises
the real reopen path.


## The bridge cannot be faked from the renderer

Before reaching for it: **you cannot stub `window.bay` to force an unhappy path.** `contextBridge`
freezes the object it exposes, so an assignment to one of its methods silently does nothing —
no throw, no warning, and the real implementation still answers.

This was measured rather than assumed, because the obvious conclusion from a failed attempt is
"my injection ran too late". `Page.addScriptToEvaluateOnNewDocument` with a polling patch was
confirmed to run at **12.9ms**, well before React mounted, and to reach `window.bay.app`:

    window.__injected        -> 'ran'
    window.__patchedAt       -> 12.9      (ms, so the patch was applied)
    bay.app.mediaToolsReady() -> the real result, unchanged

So an error state has to be produced for real — a broken profile, a missing binary — or left
unverified and said to be unverified. It is a good security property and worth knowing before
spending an hour on the trick.

The corollary is that **the ffmpeg-missing warning in the status bar is still unverified**. Both a
bundled copy (`node_modules/.../ffmpeg-ffprobe-static`) and a Homebrew copy resolve, and
`onPath` hardcodes `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, so clearing `PATH` does not
defeat it. Breaking either copy means mutating machine state shared by everyone working here,
which is a worse trade than one unverified JSX branch that is structurally identical to the
storage one — and that one *is* verified, by `storage-warning.mjs`.

## The probes

Every probe runs as `node test/app/<name>.mjs` against the one running instance
(`./run.sh`, CDP on 9222; `PORT=` to point elsewhere). Exit codes: **0** right, **1** wrong,
**2** could not measure — see below. Every probe that uses `attach()` restores the project,
its undo history, dirty flag, playhead, selection, agent state and any prototype it patched
when it ends (see *Probes leave the app as they found it*). "Live app" means it is safe to run
against the instance someone is using; the others say what they need instead.

**Report, no verdict** marks a probe that prints numbers and exits 0 whenever it could
measure. Its green exit says the numbers exist, not that they are good — read them.

| probe | what it settles | run / needs |
|---|---|---|
| `adjustments-ui.mjs` | the Adjustments panel reaches the compositor, in the compositor's order | live app |
| `agent-gate.mjs` | the approval gate in the executor: no session ungated; default session (Ask before editing **off**) ungated and writes land; with it **on**, writes refused until approved, each approval spent once, a failed call keeps its approval | live app; turns the setting on itself, restores it |
| `agent-panel.mjs` | a real `claude` spawned by bay reaches bay's tools, and with Ask before editing on its write is refused with the refusal text intact | **costs tokens** — `claude` signed in; do not sweep |
| `agent-proposal.mjs` | propose → Approve on the card → the model makes exactly the approved edit, and a further write is refused | **costs tokens**; turns Ask before editing on itself |
| `agent-sees-frame.mjs` | `preview_frame` returns an image and the model can actually see it | **costs tokens** |
| `audio.mjs` | the audio graph runs, meters read, a muted track still meters, volume 0 silences | live app |
| `audio-mute.mjs` | mute disconnects each muted track's analyser (count derived from the tracks muted), hide removes the picture and leaves audio alone | live app, flags on |
| `coldstart.mjs` | a project reopened from disk draws with nothing forcing a redraw — on a live instance it can only re-deliver the open project (arrival, not persistence), and says so | fresh launch for the real claim; needs a project with an item |
| `composition-scale.mjs` | more compositions on one frame than the pool fetches at once all draw | live app |
| `compositions.mjs` | HTML compositions render at 1080p and authored size, follow time, re-render when rewritten, keep transparency, and tool calls survive composition windows | live app; uses `script/demo/gsap.min.js` |
| `export-boundary.mjs` | a clip's first exported frame carries picture, not background | live app |
| `export-readback-cost.mjs` | `willReadFrequently` cost with a real decoded frame — **report, no verdict** | live app |
| `export-readback-synthetic.mjs` | the same cost with a CPU-side source, the lower bound — **report, no verdict** | live app |
| `export-vs-preview.mjs` | a real MP4 export matches `preview_frame` frame by frame across cuts | live app; runs a real export |
| `filter-support.mjs` | `ctx.filter` and blend modes apply on the **export** context, and what they cost | live app |
| `frame-rate.mjs` | the frame-rate control exists, retimes the timeline, and says what it nudged | live app |
| `geometry.mjs` | the compositor puts a clip where the layout says (`VERIFY_PROBE=1` sabotages `drawImage` and must still exit 0) | live app, flags on |
| `item-source-look.mjs` | `sourceStartSeconds`, `adjustments` and `blendMode` behave as documented, on positions derived from the timeline | live app |
| `latearrival.mjs` | a project handed to the store after mount still draws — **reloads the page**, so its restore can only put the project back, not its undo history | not on a live app someone is using |
| `looks.mjs` | adjustments and blend modes change pixels in the predicted direction | live app |
| `mcp.mjs` | every catalog tool answers, and the refusals say what to do next | live app |
| `mcp-during-reload.mjs` | a tool call during a reload is resent or failed, never stranded — **reloads repeatedly**, the window flashes | not while someone is working |
| `mcp-scale.mjs` | what `read_project` costs an agent at 10/50/200 clips — **report, no verdict** | live app |
| `mcp-socket.mjs` | the tools over the real stdio → socket → IPC path, and a call the renderer never answers rejects | live app; needs the built proxy |
| `menu.mjs` | no item in the File menu is dead | flags on, Accessibility permission; drives the native menu |
| `occlusion.mjs` | whether a hidden window drops or defers an rAF callback | **flags OFF**, own instance |
| `playback-probe.mjs` | pictures per second, ticks and fingerprints during 6s of real playback — **report, no verdict** | live app |
| `preview-frame.mjs` | `preview_frame` follows the edit (content, empty, back); `VERIFY_PROBE=1` freezes `toDataURL` | live app |
| `shared-asset.mjs` | two items on one asset each draw from their own element at their own source time (`TRIALS=10`) | live app |
| `shared-asset-two-times.mjs` | two items on one asset at two source times draw **different** pictures — the gate for transitions | live app |
| `storage-warning.mjs` | the status bar speaks when the database is down | a deliberately broken profile; `EXPECT=healthy` for the control |
| `templates.mjs` | every shipped template draws, animates, fits the canvas and honours its variables | live app |
| `text-style.mjs` | text draws as styled, and the engine reports what it could not honour | live app |
| `ticks.mjs` | the clock runs, with and without `bringToFront` — **report, no verdict** | live app, flags on |
| `transition-audio.mjs` | a transition cross-fades the sound as well as the picture (preview analysers, not export) | live app |
| `transition-playback.mjs` | a transition plays in real time with nothing dropped | live app |
| `transitions.mjs` | the seven transition kinds draw across their window, and a clamped one says why | live app |
| `transitions-ui.mjs` | a cut can be given a transition in the UI, and says so when it cannot | live app |
| `transport.mjs` | clicking the real Play button advances the clock, the store and the on-screen timecode | live app |
| `whichcanvas.mjs` | forensics: which canvas the engine draws to — **reloads the page**, no verdict | not on a live app someone is using |

`latch.mjs` was deleted: it referenced an undefined `PROFILE` from the commit that added it, so
it had never run; it had no verdict, minimised the user's window without restoring it, and its
question — does a redraw requested while hidden land on restore — is answered, with controls,
by `occlusion.mjs`.

## Probes leave the app as they found it

The probes run against the app someone is using, and they used to leave their work in it: a
clip on the timeline, a timeline replaced wholesale by `setProject`, playback running, and —
worst — a sabotaged `drawImage` or `toDataURL` still installed, so the user's editor drew
nothing until a reload. A replaced project also carried the probe's idea of `filePath` and
`dirty`, which put the user one Cmd+S from writing a probe's timeline over their file.

Cleanup is now in `cdp.mjs`, not in each probe, because the probes that most need it are the
ones whose author did not think about it:

- `attach()` snapshots the store — `project`, `past`, `future`, `dirty`, `playhead`,
  `selection`, `playing`, `panel`, `debugMode` and every `agent*` key — plus
  `localStorage['bay.agentApproval']` and which screen was showing. The snapshot is held in the
  page **by reference**: the store never mutates a project in place, so the objects captured
  are the state as it stood.
- `runProbe` restores in a `finally` — on pass, fail, cannot-measure, the watchdog, an escaped
  error, and Ctrl-C — through `store.setState` with those same objects, so the user's undo stack
  and unsaved-changes flag end exactly as they began. It then compares a fingerprint (project
  hash, `filePath`, history lengths, dirty, playhead, screen, gate, approval) with the one taken
  at attach, and prints `[cdp] restored: …` or `RESTORE INCOMPLETE: …`. **A restore that fails
  turns a pass into exit 2**: a green run has to mean the app was left as found.
- Sabotage goes through `patch(target, key, factory)` from `attach()`, which records the
  original; the restore puts every patched method back and checks that `drawImage`,
  `toDataURL` and `AnalyserNode.connect/disconnect` are native again.
- A probe that **reloads** the page loses the in-page snapshot. The restore then puts the
  project back from a JSON copy taken at attach, says the undo history could not come back, and
  exits 2 on an otherwise green run.
- Outside `runProbe`, `close()` restores and must be awaited before `process.exit`.

What it cannot put back: media imported into main's allowlist and database, composition windows
opened, files a probe wrote to `/tmp`, and a `claude` process — the agent probes dispose theirs
in their own `finally`.

## `electron .` runs the last build, not your working tree

The probes launch `./node_modules/.bin/electron .`, and `package.json` points `main` at
`./out/main/index.js`. **Nothing in that path compiles anything.** A probe run after an edit
tests whatever `pnpm build` last produced, which on a tree several agents share is whenever
someone else last built.

This is not hypothetical and it fails in the most expensive direction — *passing*. A fix to
`TransitionDialog` was verified green by a probe that could not have exercised it: `out/` had
been rebuilt by another agent at a point that happened to include the new files but not the
newest edit, so the markers appeared, the dialog opened, every check passed, and the one
assertion aimed at the change failed with a diff that made no sense against the source. The
source was right. The build was old.

Run `pnpm build` before probing, and when a result contradicts the code in front of you,
compare mtimes before debugging the code:

```bash
find src -name '*.ts*' | xargs stat -f '%m %N' | sort -rn | head -3
find out -name '*.js'  | xargs stat -f '%m %N' | sort -rn | head -3
```

A source file newer than every build artefact means the probe is measuring the past.

### `transitions-ui.mjs`, and two ways it accused working code

Worth reading before writing any probe that clicks, because both mistakes are cheap to repeat.

**It read the DOM in the tick a mutation resolved.** A store write lands before React renders
it, so the first version reported "no marker on the cut at frame 200" against a build where
the marker was correct and present. Every DOM read in that file now polls. An instrument that
races the thing it measures is worse than no instrument, because it accuses the code.

**Then it drove a `NumberField` by typing, and failed one run in three.** `NumberField` commits
on blur, reading a `draft` that `onChange` set — two React state updates in two events. Over
CDP the blur handler could close over a `draft` still holding `null` and commit nothing, so the
probe reported a missing clamp warning from a dialog that was working fine. Two fixes, and the
second is the general lesson:

- the fixture was reshaped so the interesting case needs **one keystroke, not a typed number** —
  the incoming clip gets a deliberately short handle, so the cut's capacity is a handful of
  frames and a single Shift+ArrowUp exceeds it. Arrow keys call `commit` directly inside the
  keydown handler and depend on no flushed state.
- the assertion that matters most — a transition asked for long and played short — is set up
  **through MCP instead of through the field**, so it tests the reported number without driving
  a control at all.

A probe that fails one run in three teaches people to re-run until green, which is how a real
failure gets ignored. Four consecutive clean runs is the bar for calling one stable, and the
two earlier flakes are why the number is four and not one.

Two of these need setting up rather than just running:

```bash
# storage-warning: app.db as a directory is what node:sqlite cannot open
mkdir -p /tmp/bay-broken/app.db
./node_modules/.bin/electron . --remote-debugging-port=9222 --user-data-dir=/tmp/bay-broken &
PORT=9222 node test/app/storage-warning.mjs              # expects the warning
PORT=9223 EXPECT=healthy node test/app/storage-warning.mjs   # control: must stay quiet

# occlusion: launch WITHOUT the throttling flags, or there is nothing to measure
./node_modules/.bin/electron . --remote-debugging-port=9222 --user-data-dir=/tmp/bay-occ &
PORT=9222 HOLD_MS=5000 node test/app/occlusion.mjs
```

`menu.mjs` drives the real macOS menu bar, so it needs this terminal to hold Accessibility
permission, and it finds the app by asking **which Electron process owns a menu bar** — `$!` from
the shell is the `npx` wrapper and "the first process named Electron" is usually a helper. It also
fronts the app and waits before the first click: without that, the first menu click is swallowed
establishing focus and whichever item is checked first reports dead, which looks exactly like the
bug it is hunting.


## A probe must not write to the fixture it measures

`coldstart.mjs` used to seed itself: import a clip, place it, `project.save()`. On a profile
whose project already has a `filePath`, **`save()` writes without a dialog** — so every run
silently *appended* a clip to the shared seeded project, taking it from 1 item to 3.

The damage was not local. `audio-mute.mjs` hid `tracks.find(t => t.kind === 'video')` — the
first video track — so once the fixture had three, hiding V1 left the other two drawing and
the probe reported "hide left the picture drawn" while hide worked correctly. A fixture
mutated by one probe made a second probe accuse the code.

Two rules follow, and both are cheap:

- **Probes are read-only against shared state.** `coldstart.mjs` now requires a seeded profile
  and refuses to create one. Seed by hand, once.
- **Act on every element that matches, not the first.** `audio-mute.mjs` now hides and mutes
  *all* video tracks carrying items, so the assertion is about the picture as a whole and
  holds whatever the fixture contains.

## Name the subsystem the evidence implicates, not the one you suspect

`coldstart.mjs`'s failure message used to read "nothing asked for a frame". It fired on a run
where draws were happening throughout and the real fault was a seek thrash between two items
sharing one pooled element — so the verdict sent two people into the scheduling path, which
was innocent.

`drawFrame` already returns `{drawn, pending, placeholders}`. The probe now forces one
synchronous draw and branches on it: everything `pending` means the media is not drawable
(pool/compositor); all `placeholders` means the assets are unreadable (`bay://` or the files);
`drawn` with no lit pixels means geometry or content; lit-after-forcing but bare before means
it really is the scheduler.

And do not use `stats().samples` as a draw counter — it is the length of a rolling window
**capped at 240**, so past that it stops rising and reads as a stall.


## The exit-code hole: failures that escape `runProbe`

Every probe here calls `attach()` at module top level, **outside** `runProbe`. So a connection
failure was not a verdict at all — it escaped as an unhandled rejection and exited **1**, which
this file defines as "measured, and it is wrong: a finding about the code". Two real runs hit it:

    Error: CDP Page.bringToFront did not answer within 30000ms
    Error: no renderer target on port 9355 - is the app built and running?

Both were an Electron someone else had killed. **An app that is gone was reading as a bug in the
compositor** — the false-accusation class again, one level below where it was fixed before.

Rather than restructure ten probes, `cdp.mjs` now installs `uncaughtException` and
`unhandledRejection` handlers at import, and the connection failures throw `PreconditionError`:
`findRenderer` when no target appears, `send` when a call is not answered, and the socket's close
and error events. Anything escaping any probe is classified — exit 2, except a `ProbeFailure` or
`AssertionError`, which is a finding and exits 1 — and the app is restored first, including for
probes written later by someone who never read this file, which is the point of putting it at
import.

Verified in all four directions, exit codes read **without a pipe**:

    no app on the port          -> exit 2   CANNOT MEASURE: no renderer target on port 9999
    a call that cannot answer   -> exit 2   CANNOT MEASURE: CDP Runtime.evaluate did not answer within 1ms
    a probe returning false     -> exit 1   (a real finding is still reportable)
    a normal run                -> exit 0

**And the opposite hole, closed later: a failed assertion exiting 2.** Every probe's `check()`
threw a plain `Error`, and `runProbe` mapped anything unclassified to "PROBE ERROR — nothing was
measured", exit 2. So a real finding read as a harness fault: the false *acquittal*, the mirror
of the false accusation above. `cdp.mjs` now exports `ProbeFailure` (and a shared `check()` that
throws it); it and `node:assert`'s `AssertionError` exit **1** with `FAIL: <message>`, whether
thrown inside `runProbe` or escaping it. `PreconditionError` and anything else still exit 2.
Verified by breaking one expectation in a scratch copy of `item-source-look.mjs` (exit 1,
`FAIL: and the new one is applied / got 4 / expected 5`) and of `audio-mute.mjs` (exit 1).

The third line matters as much as the first two: a global "exit 2 on anything" would have made
every genuine finding unreportable, which is the failure this fix could easily have introduced.


## `shared-asset.mjs` — the seek thrash, and why it is asserted the way it is

**Current contract, ahead of the history below:** the pool now holds an element per item drawing
an asset, so the probe asserts that the elements in **slots 0 and 1** — the two the compositor
binds this frame, in draw order — are each ready and on their own item's source time (20s and
0s). It used to also require that the pool held *exactly two* elements for the asset, which
failed whenever an earlier draw had left an idle element in slot 2; the pool keeps up to 12 and
evicts least-recently-used, so that was correct behaviour reported as a fault. Extra slots are
now listed and not judged, and a failure names what it saw (nothing drawn, or a slot on the
wrong time) instead of "seek thrash", a mechanism the shared-element pool no longer has.

Two items under the playhead sharing one asset share the single pooled element, and each
wants it at a different `currentTime`. Before `seekOwners()` both issued their target every
frame: the element never finished a seek (`readyState` 1, `seeking` true), every item reported
`pending`, and the canvas stayed blank permanently — a forced `redraw()` did not mend it,
because the next draw restarted the fight.

Measured, fixed, 10 trials:

    lit 79650   cols [0,1796]   element {readyState 4, seeking false, currentTime 0}   10/10

`currentTime 0` is the real assertion. The element settles on the **topmost** item's source
time — the one actually on screen — not the lower item's 20s. `lit > 0` is the symptom;
this is the mechanism, and a probe that only checked pixels would pass a fix that settled on
the wrong frame.

Three decisions in it, each of which was a wrong turn first:

- **It builds its own scenario** rather than trusting a fixture. Against a one-item profile
  the condition cannot occur at all — which is precisely why this probe passed for one person
  and failed for another on identical code.
- **It asserts the positive, over N trials.** Unfixed this failed 9 runs in 10, not 10 in 10;
  decode timing moves it. "The picture is there and the element settled" is deterministic with
  the fix and fails often without it. Asserting *blankness* would be pinning a race. One trial
  would call the fix unnecessary about one time in ten — run `TRIALS=10`.
- **It never reloads between building and measuring.** `attach()` used to reload on every run
  (it now reloads only when the probe handle is missing), and a reload restores the profile's
  own project, so the second item disappeared before it could be seen. That is why the failing state looked like a one-item timeline to three
  people. Timeline state is read in the *same* evaluate as the pixels.

Self-check (`VERIFY_PROBE=1`) replaces `drawImage` with a no-op and asserts FAIL — 0/3 drew.
The sabotage has to break the **draw**: making the two source times agree would remove the
condition and pass, proving nothing. Note what that self-check does and does not establish —
it shows the probe reports FAIL when nothing is drawn. That the probe catches *this* bug rests
on the 1-in-10 vs 10-in-10 measurement across the fix, not on the no-op.


### Two numbers that measure different moments must say so

`shared-asset.mjs` reports `drew` and `settled`, and pre-fix they disagreed: **drew 0/10,
settled 4/10**. That reads as a contradiction and is not one. `drew` is what reached the
canvas; `settled` is the element's state *sampled after* the draw. The element settles
between draws — the draw that mattered caught it mid-seek, reported `pending`, drew nothing,
and nothing scheduled another.

The probe now prints that explanation whenever the two disagree, instead of leaving the
reader to decide which number to trust. It is the "name what you measured" rule applied to
output rather than to a claim: two quantities sampled at different instants, shown side by
side, will be read as one quantity unless the difference is stated.

Verified against a real pre-fix build by `engine-fix`, which closes the gap `VERIFY_PROBE`
cannot:

    PRE-FIX  1337f2c   drew  0/10   settled  4/10   exit 1   FAIL
    POST-FIX 3807e37   drew 10/10   settled 10/10   exit 0   PASS
    VERIFY_PROBE=1 on both builds                   exit 0   SELF-CHECK PASSED

So the probe fails on the code that had the bug, passes on the code that fixed it, and
detects a broken draw independently of either. Those are three different claims and each
needed its own evidence.


## `preview-frame.mjs`, and a prefix that cannot see a difference

`preview_frame` is the tool the agent trusts to check every other tool, so the failure to
guard is not "it errors" but **"it always returns something plausible"** — a stale, constant
or wrong-frame image that the model then acts on confidently, unfixing work that was correct.

An absolute assertion cannot catch that. Rendering one frame and finding pixels in it would
pass against a hard-coded picture. So the probe is differential: it renders the frame, moves
the clip entirely off-canvas, renders again, and puts it back — and requires the image to
follow the edit in the direction the edit predicts.

    clip in frame     78720 lit    640x360
    clip off-canvas       0 lit
    clip restored     78720 lit
    image changed     yes
    PASS

`VERIFY_PROBE=1` replaces `toDataURL` with a constant — precisely the always-plausible tool —
and the probe must fail against it. It does.

**The trap, found by this probe failing against a working tool.** The first version compared
`dataUrl.slice(0, 48)` to decide whether the image had changed. Two PNGs of the same
dimensions share a byte-identical header, so the prefix matched for a full frame and an empty
one alike: the probe reported FAIL while the numbers beside it — 78720 lit versus 0 — showed
the tool working perfectly. Same class as trap 2 and trap 5, in a probe written the same day
by someone who had just documented both. Hash the whole artefact, not a prefix of it; and
when a verdict contradicts the evidence printed next to it, suspect the verdict.

## A probe that mutates state must not assume the state it started in

Four times in one session a probe reported FAIL while the code was right, and all four had
the same root: an assertion built on a fixture assumption that earlier checks had already
invalidated. Three of them nearly became "fixes" to working code, which is why this is worth
its own rule — a red line that is the test's fault feels exactly like a red line that is the
code's, and the instinct it produces is to change the code.

The four, because the shape is more convincing than the summary:

- A "free" slot at frame 500 — inside a clip that was 2035 frames long. The refusal naming
  the occupied range was correct and read as a broken executor.
- A duration read from an item that earlier checks had trimmed and split, then used to place
  three clips that could not fit.
- An assertion that only allowed the error wording used when *no* export jobs exist; by then
  one did, and the message correctly named it instead.
- `set_playhead` to frame 7 on an empty timeline, which correctly clamps to 0 and *says so*
  in `clampedTo`. The probe read the clamp as a dead socket.

Two habits prevent all four:

**Derive fixture values from the call that produced them, not from a shared earlier read.**
Chain positions from each placement's own returned `endFrame` rather than computing them
from a duration fetched once at the top. The first is true when it is used; the second is
true when it was written.

**Choose an observable that does not depend on state you did not control.** For "did this
write reach the store", `add_track` is unconditional and `set_playhead` is clamped by the
timeline's duration — so the first tests the transport and the second tests the transport
*and* whatever the fixture happened to leave behind. When a check fails, ask what the state
was at that moment before asking what the code did.


## `preview_frame` as an oracle: `export-vs-preview.mjs`

The strongest check on an export is not a property of the frames — it is a comparison
against a consumer that gets the same answer by a different route. `preview_frame` renders
any frame with its own pool, its own loop and its own awaited seeks, so it is independent of
the export path and can be treated as the correct answer.

    frame    preview mean/nonZero      export mean/nonZero     verdict
       10      58.6 /  61.1%            58.6 /  61.1%          match
      148      32.9 /  34.4%            32.9 /  35.1%          match
      149      32.9 /  34.4%            32.9 /  35.1%          match
      150      40.3 /  34.4%            40.3 /  34.7%          match
      151      40.3 /  34.4%            40.3 /  34.7%          match
      160      40.1 /  34.4%            40.1 /  34.7%          match

This runs a **real** export to a real MP4 and profiles the encoded file with ffmpeg, so it
measures the delivered artefact rather than anything in memory.

Three things it gets right that the first two attempts did not:

- **It catches a *wrong* frame, not only a missing one.** "No exported frame is uniformly
  background" was the earlier idea; an incoming clip decoded at the outgoing clip's source
  time is perfectly bright and completely wrong, and only a comparison against a known-good
  answer sees it.
- **It compares statistics with a tolerance, not pixels.** The export is h264 and the oracle
  is PNG; demanding equality would produce a check nobody can keep green. A black frame is
  unmistakable at any tolerance — 0.0 against 40.3.
- **It refuses to judge when the oracle is not trustworthy.** If `preview_frame` reports
  `pending` or `placeholders` on any sampled frame, the probe says CANNOT TRUST rather than
  comparing one broken consumer against another.

`VERIFY_PROBE=1` hands the **export** a timeline whose cut is 10 frames early while the
oracle keeps describing the real edit; frames 148 and 149 then mismatch. The break is on the
export side on purpose — sabotaging the oracle would move the probe's own expectation, which
only shows that two identical things are identical.

## Intercepting `window.bay` is not possible

Two attempts, both dead ends, before settling on "run the real export and read the file":

    window.bay.export = stub                    silently does nothing (frozen contextBridge,
                                                and CDP evaluates in sloppy mode)
    Object.defineProperty(window, 'bay', …)     TypeError: Cannot redefine property: bay

The first is the dangerous one: the frames went to the real encoder, the probe's array stayed
empty, and "no black frames among zero frames" reported **PASS**. Any probe that collects
results into an array must assert it collected something — `if (frames.length === 0) throw`.

### The same trap, seven times, and what actually stops it

The rule above was written after four. Three more followed in one afternoon, all in the
`mcp.mjs` text checks, and the third of those is the one worth studying:

- A `preview_frame` at frame 0, where a clip an *earlier check* had placed sat instead of the
  text item under test. Empty `textFits` read as "nothing consumes `item.text`".
- The same check again with the frame fixed, still failing, because a full-frame video on a
  higher track drew over the text — a colour change that reaches the pixels and is then
  painted over is indistinguishable from one that never happened.
- And finally: the check set `color: '#FF0055'` — which an **earlier check had already set**.
  The edit succeeded, the field was correct, the picture was correctly identical, and the
  probe called the field dead.

Each time the failure said "the code is broken" and each time the fixture was. What actually
stops it is not more care: it is never writing a literal where a derived value will do.

    // accuses working code the moment anything upstream sets the same value
    await call('edit_item', { itemId, text: { color: '#FF0055' } })

    // cannot
    const current = (await call('inspect_item', { itemId })).value?.text?.color
    const next = current === '#00FF88' ? '#FF0055' : '#00FF88'

The literal encodes an assumption about history. The derived value encodes the thing the
check actually means — *different from whatever it is now* — and survives any reordering,
insertion, or deletion upstream of it.
