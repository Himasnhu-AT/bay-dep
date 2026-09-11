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


## An open question this harness cannot answer

`redraw()` in `engine/index.ts` re-arms a frame request that has been outstanding longer than
250ms, on the theory that a callback queued while hidden can be **dropped** rather than merely
deferred — which would otherwise latch the flag forever and silently kill every future redraw.

That premise is unproven. Two attempts to falsify it here both failed for the same reason: **the
page could never be brought back to `visible`.** `window.bay.window.minimise()` hides it, but
`Page.bringToFront` does not un-minimise; `Page.setWebLifecycleState` freezes it, but restoring to
`active` left `visibilityState` at `hidden` while the terminal was in front. A callback that has
not fired while the page is still hidden is indistinguishable from one that is simply waiting.

So the guard is currently unfalsifiable from this harness, which by this project's own standard is
a reason to suspect it rather than trust it. Settling it needs an environment where occlusion can
be applied *and removed* on demand. If you can produce one, the experiment is: arm a plain
`requestAnimationFrame` while hidden, return the page to visible, and check whether it ever fires.
If it always fires, delete the staleness re-arm.


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
