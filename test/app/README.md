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

## The traps, so nobody re-derives them

Each of these produced a confident, wrong conclusion before it was understood. They are listed in
the order they cost the most time.

1. **An occluded window stops `requestAnimationFrame`.** A backgrounded app has a frozen clock,
   zero ticks, and a preview that never updates — indistinguishable from a dead engine. Call
   `Page.bringToFront` and wait before measuring anything about playback. A `<video>` element is
   *not* throttled the same way, so audio runs on over a frozen picture.

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
   a hard edge between 0.0% and 100% bands is a geometry fault rather than dark content.

5. **A timeline background colour is unobservable under a full-frame clip.** The compositor fills
   the background and paints the item over every pixel of it, so setting the background and
   reading the canvas is a probe that cannot fail. Use it only where the canvas is genuinely bare.

6. **Scope your process cleanup.** `pkill -f Electron` kills everyone else's instance too; four
   probes were lost to it in one session. Launch with your own `--user-data-dir` and
   `--remote-debugging-port`, and kill the pid you started.

## The standing rule

A probe is subject to the same discipline as a test: **it must be shown capable of detecting the
thing it reports on.** Three of the wrong conclusions above came from instruments that could not
observe what they claimed was absent. Before trusting a probe, break the thing on purpose and
check the probe notices.

## Two more traps, and the gate

**6. A clip's own black regions defeat lit-pixel extent as a test of geometry.** This was the
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

**7. A probe must be proven able to see what it reports on — and the break must be on the side
the probe does not derive its expectation from.** `geometry.mjs` computes `expectedCols` from the
layout, so breaking the *layout* would move both sides together and pass no matter what the code
did. `VERIFY_PROBE=1` instead patches `CanvasRenderingContext2D.prototype.drawImage` to halve the
destination width — a broken compositor without touching the compositor — and asserts the probe
reports FAIL. Run it after changing a probe:

```bash
PORT=<port> VERIFY_PROBE=1 node test/app/geometry.mjs   # exits 0 only if the probe caught it
```

**The probe surface is opt-in.** `window.bayEngine` only exists when `localStorage['bay.debug']`
is `'1'`, so it is absent from a release build unless someone deliberately sets it. `cdp.mjs`
sets the flag and reloads before waiting for the engine; any new probe should use `attach()`
rather than connecting by hand, or it will find no handle and report a dead engine.
