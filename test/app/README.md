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
