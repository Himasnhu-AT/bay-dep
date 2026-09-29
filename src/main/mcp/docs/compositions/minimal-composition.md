<!--
Migrated from the HyperFrames project (https://github.com/heygen-com/hyperframes),
packages/../skills/hyperframes-core/references/minimal-composition.md, which is licensed Apache-2.0.
Adapted for bay: the example's timeline is plain JavaScript rather than GSAP from a CDN,
because a composition may load nothing from the network and bay ships no animation library.
-->

# Minimal Composition

The smallest renderable composition — a standalone (top-level) root with one clip and one animated title. The timeline is a plain object: `time(t)` sets every style from `t` alone, and `duration()` returns the length in seconds. No library, nothing to load:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>Minimal Composition</title>
    <style>
      body {
        margin: 0;
        background: #0b0f14;
        color: white;
        font-family: Inter, system-ui, sans-serif;
      }
      #root {
        position: relative;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
      }
      .clip {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
      }
      h1 {
        margin: 0;
        font-size: 96px;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-width="1920"
      data-height="1080"
      data-duration="5"
    >
      <section id="title-card" class="clip" data-start="0" data-duration="5">
        <h1 id="title">Hello bay</h1>
      </section>
    </div>
    <script>
      // 0 before a, 1 after b, eased in between. Copy these three lines into any composition.
      const clamp = (v) => Math.min(1, Math.max(0, v));
      const easeOut = (p) => 1 - Math.pow(1 - p, 3);
      const progress = (t, a, b) => easeOut(clamp((t - a) / (b - a)));

      const title = document.getElementById("title");
      function time(t) {
        const p = progress(t, 0.2, 0.8); // rise in from 0.2s to 0.8s
        title.style.opacity = p;
        title.style.transform = `translateY(${(1 - p) * 48}px)`;
      }
      time(0);
      window.__timelines["main"] = { time, duration: () => 5 };
    </script>
  </body>
</html>
```

What the runtime actually requires:

- Root `<div>` with `data-composition-id`, `data-width`, `data-height`. Root `data-start="0"` is written above by convention and every shipped block has it, but the runtime stamps it when absent, so it is not required.
- A duration: root `data-duration` in seconds (as above). bay reads the length from it.
- Timed elements carry `data-start` plus a duration. That attribute alone is what makes an element a clip: `class="clip"` is a layout and tooling convention, and `data-track-index` is a Studio display lane. Neither is required, and a composition with no clips at all renders fine.
- An object registered on `window.__timelines["<composition-id>"]` with `time(seconds)` and `duration()`. bay calls `time(t)` for every frame it renders, in any order, so `time` must set every animated style from `t` alone — never from the previous call. bay creates `window.__timelines` before your scripts run.
- Nothing loaded over the network. bay blocks every remote origin, and `write_composition` refuses a remote `<script src>`, because the script would never run. A library you are licensed to use can be vendored beside the file and loaded by relative path.

Everything else in the skeleton is ordinary HTML and CSS: the `#root` box, `.clip` positioning, and fonts are yours to choose.

This pattern is **standalone** (top-level `index.html`) — no `<template>` wrapper around the root. For sub-compositions (files loaded by `data-composition-src`), see `sub-compositions.md`.
