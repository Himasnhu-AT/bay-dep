<!--
Migrated from the HyperFrames project (https://github.com/heygen-com/hyperframes),
packages/../skills/hyperframes-core/references/full-screen-motion.md, which is licensed Apache-2.0.
Adapted for bay: examples use a plain-JavaScript timeline rather than GSAP from a CDN,
because a composition may load nothing from the network and bay ships no animation library.
-->

# Full-Screen Motion Pattern

For full-frame motion (continuous backgrounds, color washes, full-bleed visual states that span multiple clips), prefer a **shared background layer + transparent timed content layers** over stacked opaque scene backgrounds.

## Why

Stacking opaque scene divs means every scene change has to repaint the entire frame, every cross-scene visual continuity has to be faked, and every "global" state (a hue shift, a vignette, a film grain) has to be duplicated on every scene. A shared background layer driven by the seekable timeline gives you one continuous visual surface and makes scenes themselves cheap and transparent.

## Pattern

```html
<style>
  /* The runtime auto-positions root children that carry data-start. The shared
     background deliberately has none, so it gets NO automatic layout and must
     size itself, or #bg is 0px tall and the timeline paints nothing. */
  #bg.full-bleed {
    position: absolute;
    inset: 0;
  }
  .clip.transparent {
    background: transparent;
  }
</style>

<div id="root" data-composition-id="main" data-width="1920" data-height="1080" data-duration="20">
  <!-- Shared background — NOT a clip. Always visible. Driven by the timeline. -->
  <div id="bg" class="full-bleed"></div>

  <!-- Timed content layers — transparent backgrounds. -->
  <section
    id="scene1"
    class="clip transparent"
    data-start="0"
    data-duration="6"
    data-track-index="1"
  >
    <!-- content -->
  </section>
  <section
    id="scene2"
    class="clip transparent"
    data-start="6"
    data-duration="14"
    data-track-index="1"
  >
    <!-- content -->
  </section>
</div>

<script>
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const sineInOut = (p) => 0.5 - Math.cos(Math.PI * p) / 2;
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  const mixRgb = (a, b, p) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * p)).join(",")})`;

  const bg = document.getElementById("bg");
  const heading = document.querySelector("#scene1 h1");
  function time(t) {
    // Drive the shared background from t: black → navy over 0–6s, navy → violet over 6–20s.
    bg.style.backgroundColor =
      t < 6
        ? mixRgb([0, 0, 0], [10, 21, 48], sineInOut(clamp(t / 6)))
        : mixRgb([10, 21, 48], [26, 10, 48], sineInOut(clamp((t - 6) / 14)));

    // Scene-local animations stay transparent on top.
    const p = easeOut(clamp((t - 0.2) / 0.6));
    heading.style.opacity = p;
    heading.style.transform = `translateY(${(1 - p) * 48}px)`;
  }
  window.__timelines["main"] = { time, duration: () => 20 };
</script>
```

## Rules

- **The background is not a clip.** No `data-start` / `data-duration`. It exists for the whole composition.
- **Because it is not a clip, it gets no automatic layout.** The runtime only positions and sizes root children that carry `data-start`. An untimed background must set its own `position: absolute; inset: 0`, or it collapses to zero height and nothing you animate on it is visible. This is the most common way this pattern is copied wrong.
- **Content scenes have transparent backgrounds.** Whatever you put in the shared `#bg` shows through.
- **Drive global state from the shared layer.** Hue shifts, vignettes, grain, film-look filters — animate them once on the shared layer, not per-scene.
- **Do not animate visibility on `.clip` elements.** HyperFrames already shows/hides clips based on `data-start` and `data-duration`. Animating `display` / `visibility` on the clip itself races with the framework's own show/hide. Animate a _child wrapper_ inside the clip instead.
- **Verify intentional overflow with snapshots.** Before adding `data-layout-allow-overflow` to silence an inspect warning, run `npx hyperframes snapshot` and confirm the overflow is what you want.

## When Not to Use This Pattern

If scenes really are visually disjoint — hard cuts between distinct color worlds with no continuity — the stacked-opaque pattern is fine. The shared-background pattern is for compositions where the background **is part of the motion language**, not just backdrop.
