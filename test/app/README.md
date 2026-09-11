# App checks

Probes that drive the **built** app over the Chrome DevTools Protocol and measure what actually
reached the screen. They are a second gate, separate from `pnpm test`, because they need a real
window, a real GPU, a real decoder and a built `out/` — none of which exist under `node --test`.

```bash
pnpm build
node test/app/<probe>.mjs
```

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

| probe | what it settles | needs |
|---|---|---|
| `geometry.mjs` | the compositor puts a clip where the layout says | flags on |
| `ticks.mjs`, `transport.mjs` | the clock advances and pictures reach the screen | flags on |
| `latearrival.mjs`, `coldstart.mjs` | a project arriving after mount still draws | flags on |
| `audio-mute.mjs` | mute silences, hide does not, and they are independent | flags on |
| `menu.mjs` | no item in the File menu is dead | flags on, Accessibility permission |
| `storage-warning.mjs` | the status bar speaks when the database is down | a deliberately broken profile |
| `occlusion.mjs` | whether a hidden window drops or defers an rAF callback | **flags OFF** |

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
and error events. Anything escaping any probe is classified and exits 2 — including probes written
later by someone who never read this file, which is the point of putting it at import.

Verified in all four directions, exit codes read **without a pipe**:

    no app on the port          -> exit 2   CANNOT MEASURE: no renderer target on port 9999
    a call that cannot answer   -> exit 2   CANNOT MEASURE: CDP Runtime.evaluate did not answer within 1ms
    a probe returning false     -> exit 1   (a real finding is still reportable)
    a normal run                -> exit 0

The third line matters as much as the first two: a global "exit 2 on anything" would have made
every genuine finding unreportable, which is the failure this fix could easily have introduced.


## `shared-asset.mjs` — the seek thrash, and why it is asserted the way it is

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
- **It never reloads between building and measuring.** `attach()` reloads, and
  `project.initial()` then restores the profile's own project, so the second item disappears
  before it can be seen. That is why the failing state looked like a one-item timeline to three
  people. Timeline state is read in the *same* evaluate as the pixels.

Self-check (`VERIFY_PROBE=1`) replaces `drawImage` with a no-op and asserts FAIL — 0/3 drew.
The sabotage has to break the **draw**: making the two source times agree would remove the
condition and pass, proving nothing. Note what that self-check does and does not establish —
it shows the probe reports FAIL when nothing is drawn. That the probe catches *this* bug rests
on the 1-in-10 vs 10-in-10 measurement across the fix, not on the no-op.
