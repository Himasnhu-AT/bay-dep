<!--
Migrated from the HyperFrames project (https://github.com/heygen-com/hyperframes),
packages/../skills/hyperframes-core/references/creator-editing-recipes.md, which is licensed Apache-2.0.
Adapted for bay: examples use a plain-JavaScript timeline rather than GSAP from a CDN,
because a composition may load nothing from the network and bay ships no animation library.
-->

# Creator Editing Recipes

Use these copyable contracts after `tracks-and-clips.md`. Global math: **consumed source = timeline duration × rate**; **natural timeline duration = remaining source / rate**.

These recipes keep sound on a separate `<audio>` element with the `<video>` muted, which is the pattern to reach for when picture and sound are cut independently. An unmuted `<video>` that declares `data-has-audio="true"` is also mixed, so a separate track is a choice, not a requirement.

**Every `<video>` and `<audio>` below carries an `id`, and that is not cosmetic**: `lint` errors with `media_missing_id` on timed media without one, and an id-less `<audio>` is never picked up by the mixer, so the render comes out silent. Keep the ids when you copy a recipe.

## Hard cut

```html
<video
  id="a"
  src="take.mp4"
  data-start="0"
  data-duration="2"
  data-media-start="4"
  data-track-index="0"
  muted
  playsinline
></video>
<video
  id="b"
  src="take.mp4"
  data-start="2"
  data-duration="3"
  data-media-start="10"
  data-track-index="0"
  muted
  playsinline
></video>
<audio
  id="a-audio"
  src="take.mp4"
  data-start="0"
  data-duration="2"
  data-media-start="4"
  data-track-index="10"
></audio>
<audio
  id="b-audio"
  src="take.mp4"
  data-start="2"
  data-duration="3"
  data-media-start="10"
  data-track-index="10"
></audio>
```

Timeline math: B starts at A start + duration. Source math: each range starts at `data-media-start`; consumed source = timeline duration × rate. Audio follows: duplicate matching `<audio>` ranges/timing. Owner: `/hyperframes-core`. Limit: adjacent windows only; author the two windows edge to edge.

## Trim in/out

```html
<video
  id="shot-1"
  src="take.mp4"
  data-start="1"
  data-duration="3"
  data-media-start="6"
  data-track-index="0"
  muted
  playsinline
></video>
<audio
  id="shot-1-audio"
  src="take.mp4"
  data-start="1"
  data-duration="3"
  data-media-start="6"
  data-track-index="10"
></audio>
```

Timeline math: visible window is `[1,4]`. Source math: in=6, out=6+3 at 1x; never invent source-end syntax. Audio follows: matching separate audio track uses the same three attributes. Owner: `/hyperframes-core`. Limit: use another clip for another range.

## Split / splice

```html
<video
  id="shot-1"
  src="take.mp4"
  data-start="0"
  data-duration="2"
  data-media-start="0"
  data-track-index="0"
  muted
  playsinline
></video>
<video
  id="shot-2"
  src="take.mp4"
  data-start="2"
  data-duration="2"
  data-media-start="8"
  data-track-index="0"
  muted
  playsinline
></video>
<audio
  id="shot-1-audio"
  src="take.mp4"
  data-start="0"
  data-duration="2"
  data-media-start="0"
  data-track-index="10"
></audio>
<audio
  id="shot-2-audio"
  src="take.mp4"
  data-start="2"
  data-duration="2"
  data-media-start="8"
  data-track-index="10"
></audio>
```

Timeline math: splice at t=2. Source math: independent source offsets select kept pieces. Audio follows: split matching audio identically. Owner: `/hyperframes-core`. Limit: source cuts are core, never keyframes.

## Duplicate / reuse same source

```html
<video
  id="shot-1"
  src="take.mp4"
  data-start="0"
  data-duration="1"
  data-media-start="2"
  data-track-index="0"
  muted
  playsinline
></video>
<video
  id="shot-2"
  src="take.mp4"
  data-start="4"
  data-duration="1"
  data-media-start="2"
  data-track-index="0"
  muted
  playsinline
></video>
<audio
  id="shot-1-audio"
  src="take.mp4"
  data-start="0"
  data-duration="1"
  data-media-start="2"
  data-track-index="10"
></audio>
<audio
  id="shot-2-audio"
  src="take.mp4"
  data-start="4"
  data-duration="1"
  data-media-start="2"
  data-track-index="10"
></audio>
```

Timeline math: copies may occupy different starts. Source math: identical offsets reuse identical source. Audio follows: duplicate the separate audio track too. Owner: `/hyperframes-core`. Limit: every element needs a unique id when ids are present.

## Reorder

```html
<video
  id="shot-1"
  src="take.mp4"
  data-start="0"
  data-duration="2"
  data-media-start="10"
  data-track-index="0"
  muted
  playsinline
></video>
<video
  id="shot-2"
  src="take.mp4"
  data-start="2"
  data-duration="2"
  data-media-start="2"
  data-track-index="0"
  muted
  playsinline
></video>
<audio
  id="shot-1-audio"
  src="take.mp4"
  data-start="0"
  data-duration="2"
  data-media-start="10"
  data-track-index="10"
></audio>
<audio
  id="shot-2-audio"
  src="take.mp4"
  data-start="2"
  data-duration="2"
  data-media-start="2"
  data-track-index="10"
></audio>
```

Timeline math: `data-start` defines authored order. Source math: source offsets need not be chronological. Audio follows: reorder identical matching audio windows. Owner: `/hyperframes-core`. Limit: reordering changes placement only, not source ranges.

## Freeze / hold

```html
<img src="held-frame.png" data-start="2" data-duration="1" data-track-index="0" class="clip" />
```

Timeline math: the still owns its hold duration. Source math: final-source frame, subcomp final state, and visual pose holds are supported. Audio follows: continue, trim, or silence audio deliberately. Owner: `/hyperframes-core` + `/media-use`. Limit: arbitrary mid-source freeze requires preprocess of a still/segment.

## Constant speed / slow motion

```html
<video
  id="shot-1"
  src="take.mp4"
  data-start="0"
  data-duration="2"
  data-media-start="4"
  data-playback-rate="0.5"
  data-track-index="0"
  muted
  playsinline
></video>
```

Timeline math: duration is authored timeline time. Source math: consumed source = timeline duration × rate; natural timeline duration = remaining source / rate. Audio follows: matching separate audio track uses the same constant rate. Owner: `/hyperframes-core`. Limit: normalized 0.1..5 constant only; no speed ramp envelope.

## Zoom / punch

The motion recipes below are lines inside the composition's `time(t)` (see `minimal-composition.md`), using these helpers — define them once per composition:

```js
const clamp = (v) => Math.min(1, Math.max(0, v));
const easeOut = (p) => 1 - Math.pow(1 - p, 3);
// 0 before a, 1 after b, eased in between (pass (p) => p for linear).
const progress = (t, a, b, ease = easeOut) => ease(clamp((t - a) / (b - a)));
const mix = (from, to, p) => from + (to - from) * p;
const inner = document.querySelector("#clip .inner");
```

```js
// inside time(t): punch in over 1.00–1.18s
const p = progress(t, 1, 1.18);
inner.style.transform = `translateX(${mix(0, -8, p)}%) scale(${mix(1, 1.35, p)})`;
```

Timeline math: `t` is composition seconds. Source math: unchanged; the core clip still selects source time. Audio follows: unchanged unless separately edited. Owner: `/hyperframes-keyframes`. Limit: target the inner wrapper, not the timed clip element.

## Pan / Ken Burns

```js
// inside time(t): linear drift over 0–4s
const p = progress(t, 0, 4, (q) => q);
inner.style.transform = `translateX(${mix(0, -12, p)}%) scale(${mix(1.05, 1.2, p)})`;
```

Timeline math: move spans four authored seconds. Source math: unchanged. Audio follows: matching clip timing remains separate. Owner: `/hyperframes-keyframes`. Limit: authored geometry, not automatic face tracking.

## Crop / reframe

```js
// inside time(t): crop in over 2–3s
const p = progress(t, 2, 3);
inner.style.clipPath = `inset(${mix(0, 8, p)}% ${mix(0, 12, p)}% ${mix(0, 6, p)}% ${mix(0, 10, p)}%)`;
inner.style.transform = `translateX(${mix(0, -4, p)}%)`;
```

Timeline math: crop interpolates over `[2,3]`. Source math: unchanged. Audio follows: no automatic change. Owner: `/hyperframes-keyframes`. Limit: inner wrapper only, not temporal trim.

## Clip-path wipe / reveal / mask / split-screen

```js
// inside time(t): wipe the next shot in from the left over 2–2.5s
const next = document.querySelector("#next .inner");
const x = mix(0, 100, progress(t, 2, 2.5));
next.style.clipPath = `polygon(0 0,${x}% 0,${x}% 100%,0 100%)`;
```

Timeline math: overlap placed clips for the 0.5s handoff. Source math: each clip keeps its own range. Audio follows: place matching audio on its own tracks. Owner: `/hyperframes-keyframes` + `/hyperframes-animation`. Limit: visual mask/polygon/split-screen only; source cuts stay `/hyperframes-core`.

## Crossfade

```html
<div id="a-visual" class="inner">
  <video
    id="a"
    data-start="0"
    data-duration="3"
    data-track-index="0"
    src="a.mp4"
    muted
    playsinline
  ></video>
</div>
<div id="b-visual" class="inner">
  <video
    id="b"
    data-start="2.5"
    data-duration="3"
    data-track-index="1"
    src="b.mp4"
    muted
    playsinline
  ></video>
</div>
<audio
  id="a-audio"
  src="a.mp4"
  data-start="0"
  data-duration="3"
  data-track-index="10"
  data-automation='{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":1},{"t":2.5,"v":1},{"t":3,"v":0}]}]}'
></audio>
<audio
  id="b-audio"
  src="b.mp4"
  data-start="2.5"
  data-duration="3"
  data-track-index="11"
  data-automation='{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":0},{"t":0.5,"v":1},{"t":3,"v":1}]}]}'
></audio>
<script>
  const aVisual = document.getElementById("a-visual");
  const bVisual = document.getElementById("b-visual");
  function time(t) {
    const p = Math.min(1, Math.max(0, (t - 2.5) / 0.5)); // 2.5–3s
    aVisual.style.opacity = 1 - p;
    bVisual.style.opacity = p;
  }
  window.__timelines.main = { time, duration: () => 5.5 };
</script>
```

Timeline math: distinct tracks overlap by 0.5s with opposing opacity envelopes. Source math: each source range remains independent. Audio follows: opposing volume envelopes on distinct audio tracks. Owner: `/hyperframes-core` + `/hyperframes-keyframes` + `/hyperframes-audio`. Limit: the crossfade is the opacity/volume envelopes, not a source-level dissolve.

## Volume fades / ducking

```html
<audio
  id="music-bed"
  src="music.wav"
  data-start="0"
  data-duration="5"
  data-track-index="10"
  data-automation='{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":0},{"t":1,"v":1},{"t":2,"v":1},{"t":2.2,"v":0.3},{"t":3,"v":0.3},{"t":3.2,"v":1},{"t":4,"v":1},{"t":5,"v":0}]}]}'
></audio>
```

Timeline math: lane `t` is clip-local authored time: fade-in 0–1, duck down 2–2.2, hold 2.2–3, duck up 3–3.2, fade-out 4–5. Source math: source selection still uses core attributes. Audio follows: the explicit down-hold-up envelope affects this separate audio track. Owner: `/hyperframes-audio`. Limit: automation is not source retiming.

## Audio alignment

```html
<video
  id="shot-1"
  src="take.mp4"
  data-start="3"
  data-duration="2"
  data-media-start="8"
  data-playback-rate="2"
  data-track-index="0"
  muted
  playsinline
></video>
<audio
  id="shot-1-audio"
  src="take.mp4"
  data-start="3"
  data-duration="2"
  data-media-start="8"
  data-playback-rate="2"
  data-track-index="10"
></audio>
```

Timeline math: picture and sound share start/duration. Source math: both consume four source seconds. Audio follows: identical timing, range, and rate on the separate audio track. Owner: `/hyperframes-core` + `/hyperframes-audio`. Limit: no waveform auto-sync or drift correction.
