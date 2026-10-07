# Motion design: one film, carried

Read this before a launch film, a promo, a title sequence or any graphic with more than one beat.
It is the long form of the `motion-graphics` and `launch-film` skills: the rules, every move in
bay's library, the contract the oracle reads, and a kit that passes it.

A film here is **one composition**: a single `<canvas>` that `time(t)` redraws, every value a pure
function of `t`. Three tools carry the work, and none of them is optional:

- **the move library** — `<script src="bay-motion.js"></script>` gives the global `BM`: measured
  moves that return plain numbers. (`write_composition` writes the file beside yours.)
- **the oracle** — `check_film` seeks the film, follows the boxes your `window.__film.track(t)`
  declares, and says whether it reads as a film or as slides, before anyone watches it.
- **the sound** — `score_sfx` synthesises a small palette in one room from the film's own event
  list.

## Before any code

**Measure the reference, if there is one.** `detect_cuts` gives its cut times and shot lengths;
`frame_grid` coarse, then frame by frame around each move, shows what moves and how. Write the
numbers down — the share of the film that is still, how many hard cuts and where they bunch, how
large things are in the frame, whether moves snap or glide. A film built from the memory of
watching a reference once comes out on an even cadence, because an even cadence is what is left
when the measurements are missing.

**Three concepts, not one.** A concept is one sentence about the *picture*: the single idea the
whole film is made of. One element that turns into everything. One camera move through scale. A
chain in which each beat is the cause of the next. One surface that never leaves the frame.
Propose three that differ in that idea, and for each say the hook frame, what carries every
boundary, what it rules out, and its look (ground, ink, one accent, type, how the camera behaves).
The look belongs to the concept: take it from the product's own colours, or make it for this film;
never inherit the last film's. Then the user picks. Three orderings of the same cards are one
concept.

**A beat sheet, in two halves.** One line per beat:

| t | beat | what moves | what is still | what carries into the next |
|---|---|---|---|---|
| 0.0 | a button, and a hand arriving | the hand; the button pops in | the ground | the button: pressed, it becomes the panel |
| 1.3 | the panel fills | a bar, a count, a tick | the panel, then everything | the thumbnail: the camera pushes into it |
| 4.3 | inside the thumbnail | the whole frame, fast | nothing | its dot: it opens into the last ground |
| 5.1 | the word | a word lands; a line rises | everything, for 3 s | — |

That is the kit below. Its two halves:

- **Rhythm.** Beat lengths vary — the longest at least 4× the shortest. Short beats come together
  as a burst. And the film stops: rests where nothing moves at all, about a quarter of the
  running time, one of them a second or longer. A move only lands against stillness.
- **Carry.** At every boundary, one thing that was on screen survives it and visibly moves or
  scales into the next beat. If nothing survives, it is a slide change, however good the rhythm.

## The rules

1. **Carry, do not replace.** Build each carry as *one element that changes* — one rect whose
   corners, size and contents change — not as one thing fading out under another fading in. A
   cross-fade is a replacement with a soft edge.
2. **Hard cuts are for hits.** A bare cut is right inside a burst of three or more quick hits
   (`BM.wordCuts`) and into the end card. Anywhere else, carry. Never a dissolve.
3. **Show the cause.** Nothing reacts to nothing. A pointer presses and the control changes; a
   thing lands and the frame shakes; a bar fills because a button was pressed. The cause is drawn,
   at the same instant as its effect (`BM.pointer` + `BM.press`, `BM.impact`, `BM.shake`).
4. **Redraw real UI.** Draw the product's interface in code, from screenshots you have looked at
   with `frame_grid` — its proportions, radii, real labels and values. Only a drawn interface can
   be choreographed and pushed into. A recording is reference, or a moving element inside a beat;
   it is never the whole frame with a caption.
5. **One camera, operated.** Author the world as the home camera sees it and draw every layer
   through `BM.layerMatrix(camera)`. Key the camera to *chase*: on the subject a little ahead of
   it, on a soft in-out curve; for a snap, key where the subject will land before it
   moves, on `expoInOut`. Give landings a `BM.shake`. Depth is a real pinhole: pass `{ depth }` and
   far layers lag by themselves. Put a faint `BM.farGrid` behind an empty ground, or the move has
   nothing to slide against.
6. **Rests are dead still.** No drift, no slow push, no breathing — any of those is motion, to a
   viewer and to the oracle. If you add `BM.handheld`, multiply it by an envelope that is zero in
   every hold.
7. **Choose curves by t80, not by name.** t80 is the share of a move's time by which it has
   covered 80% of its distance: small is a snap, 0.8 is linear. Landings and reactions snap;
   carries and the camera take an in-out; a spring overshoots. A film where every move shares one
   soft curve reads as slides.

   | curve | t80 | what it is |
   |---|---|---|
   | `expoOut` | 0.23 | a snap: nearly there at once, then settling |
   | `backOut` | 0.24 | a snap that overshoots about 10 % |
   | `quintOut` | 0.28 | a hard landing |
   | `quartOut` | 0.33 | a landing |
   | `cubicOut` | 0.42 | a soft landing |
   | `quadOut` | 0.55 | barely eased out |
   | `expoInOut` | 0.57 | a whip: slow, sudden, slow |
   | `quintInOut` | 0.58 | a firm carry |
   | `cubicInOut` | 0.63 | a carry |
   | `smoother` | 0.67 | a glide |
   | `sineInOut` | 0.70 | a camera drift |
   | `smooth` | 0.71 | a glide |
   | `linear` | 0.80 | constant speed: a thrown thing, a fill |
   | `cubicIn` | 0.93 | leaving: slow, then gone |
   | `quintIn` | 0.96 | leaving, harder |
   | `expoIn` | 0.97 | leaving, hardest |

   These are `BM.EASE_T80`, measured from the curves themselves; `BM.easeTime(curve)` measures
   any other. Anywhere a move takes `curve`, it takes a name, four bezier numbers or a function.
8. **Fast moves need a shutter.** A move past the oracle's speed limit strobes into separate
   copies unless the frame is blurred along it. Draw the frame several times across a half-frame
   shutter and average: `BM.frameTravel` (the camera's share) and `BM.boxTravel` (a box's) give
   the travel, and `BM.blurSamples(travel)` the number of sub-frames. A CSS blur is not motion blur.
9. **Small things, a lot of ground.** One accent on a quiet ground, one or two type voices, and
   elements smaller than feels safe. No particles, confetti or sparkles: if a beat wants a
   flourish, the thing itself lands with squash (`BM.impact`, `BM.letterFall`).
10. **Sound is a palette in a room.** Five materials, one reverb, fewer sounds than the picture
    has events. See *Sound* below.
11. **Deterministic.** `time(t)` asked twice gives the same picture, in any order: no counters, no
    state kept between calls, no `Math.random()` (`BM.rng(seed)`), no clock. Simulations
    (`BM.simFollower`, `BM.simMagnet`, `BM.simString`) are built **once, outside `time(t)`**, with
    `{ duration }`, and read with `.at(t)`.
12. **Drafts first.** Look, measure, rebuild. Nothing is exported until the cut is accepted.

## The moves

Every move is called on `BM` with the film time first and its own times in absolute seconds, and
returns numbers for you to put on a canvas call or a style. Before its start a move is at its
starting value, and after its end it is at rest — an eased move exactly, a spring to within a
rounding error — so an element that has arrived needs no special case. `import { BM } from 'bay'`
gives the same object to a `.brf` module.

**Enter — something arrives**

| move | returns | use it for |
|---|---|---|
| `wordLand(t, t0)` | `{ op, y, s }` | a word rising onto a spring; opacity is done in under a tenth of a second |
| `letterFall(t, t0, i)` | `{ op, y, sx, sy }` | letter `i` dropping in and squashing as it lands; scale about the baseline |
| `cardPop(t, t0)` | `{ op, s, dy }` | a card or control springing up into place |
| `cardLift(t, t1)` | `{ op, s, dy, blur }` | a card leaving upward |
| `lineReveal(t, t0, i)` | `{ y, visible }` | line `i` rising from behind a mask; clip to the line's box, never fade |
| `typeOn(t, t0, text)` | `{ n, str, done, caret }` | typed text and its caret |
| `checkTick(t, t0)` | `{ on, s }` | a state flipping with a small pop |

**Carry — the next beat grows out of this one**

| move | returns | which boundary it carries |
|---|---|---|
| `rectMorph(t, t0, t1, A, B)` | `{ x, y, w, h, r, cx, cy, p }` | a container becomes the next scene: button → panel, card → full frame. Cross the contents over inside it with `p` |
| `pushInto(t, t0, t1, rect)` | `{ s, tx, ty, matrix, p }` | the camera goes into a detail until it *is* the frame. A rect with the frame's aspect lands exactly on it |
| `iris(t, t0, t1, cx, cy)` | `{ r, covered, p }` | a stage opens out of the subject (`from` is the subject's own radius). Once `covered`, stop drawing what was outside |
| `arcHop(t, t0, t1, from, to)` | `{ x, y, p }` | the subject hops to the next slot; land it with `impact` |
| `converge(t, t0, t1, i, n, from, to)` | `{ x, y, rot, p }` | many things gather into one lockup, on fanned arcs |
| `rail(t, switches)` | `{ shift, index, wobble, sx, sy, textShift }` | sibling panels on one elastic strip. `shift` is in panels: multiply by the panel pitch |
| `wordCuts(t, cuts)` | `{ word, i, tau }` | the one bare cut: a burst of hard-cut words |

**Contact — one thing causes another**

| move | returns | use it for |
|---|---|---|
| `pointer(t, knots, clicks)` | `{ x, y, s, down }` | the hand: a smooth path through timed points, dipping at each click |
| `press(t, tDown)` | `{ s, down, active }` | the control under the hand; `active` flips at release — change its state then |
| `impact(t, tHit)` | `{ ring, sx, sy }` | a landing: squash at the hit, ringing back. Scale about the contact edge |
| `stretch(vx, vy)` | `{ angle, sx, sy }` | squash and stretch from a velocity (`BM.velocity(position, t)`) |
| `simFollower(target, { duration })` | `.at(t)` → `{ x, y, vx, vy }` | something trailing a leader on a spring |
| `simMagnet(pointerAt, home, { duration })` | `.at(t)` → `{ x, y, k }` | a control leaning toward the hand |
| `simString(anchor, { duration })` | `.at(t)` → `[[x, y], …]` | a hanging line that trails and swings |

**Camera — one camera over one world**

| move | returns | notes |
|---|---|---|
| `cameraAt(t, keys)` | `{ x, y, zoom, rot }` | keys ascend in `t`; a key's `curve` is the curve of the move *arriving* at it; a key keeps whatever it leaves out; zoom moves in log space |
| `homeCamera()` | the camera that shows the layout as authored | |
| `layerMatrix(camera, { depth })` | layout → screen matrix | `ctx.setTransform(...BM.matCanvas(M, dpr))`, or `el.style.transform = BM.matCss(M)` with `transform-origin: 0 0` |
| `layerScale(camera, depth)` | how large a layer is drawn | |
| `toScreen(M, x, y)` / `toWorld(M, x, y)` | a point through a matrix, and back | |
| `boxToScreen(M, box)` | the screen box around a layout box | what `__film.track` returns for anything under a camera; `op` is carried across |
| `inFrame(box, { whole })` | whether a screen box is on the frame | |
| `shake(t, tHit)` | `{ x, y, rot }` | **screen px** — divide `x`/`y` by the camera's zoom. One seed per hit |
| `handheld(t)` | `{ x, y, rot }` | **screen px**; multiply by an envelope that is zero in the holds |
| `farGrid(camera)` | `{ matrix, r, spacing, x0, x1, y0, y1 }` | a far lattice of dots for a move to read against |
| `frameTravel(c0, c1)` / `boxTravel(a, b)` | px travelled in one frame | feed `blurSamples(travel)` → sub-frames to draw |

**Core** — `spring(tau, { damping, frequency })` (seconds since release and a damping ratio; not
the `spring` a `.brf` imports from `'bay'`), `springSpeed`, `springOvershoot`,
`springTimed(tau, { duration, bounce })`, `EASES`, `EASE_T80`, `easeOf`, `easeTime`, `bezier`,
`progress(t, t0, t1)`, `lerp`, `clamp`, `smooth`, `smoother`, `spline(knots, t)`,
`velocity(position, t)`, `rng(seed)`, `irisReach(cx, cy)`, `FRAME`. **Matrices** —
`matIdentity`, `matTranslate`, `matScale`, `matRotate`, `matMultiply(A, B)` (B is applied first),
`matInvert`, `matApply`, `matCss`, `matCanvas`.

`pushInto` and `layerMatrix` both return layout → screen matrices, so they compose: a push over a
camera is `BM.matMultiply(push.matrix, BM.layerMatrix(camera))`, with the push's target given in
the camera's screen coordinates (`BM.boxToScreen(BM.layerMatrix(camera), rect)`; when the camera
is home, that is the rect itself).

## `window.__film`: what the oracle reads

Declare it beside the timeline registration:

```js
window.__film = {
  beats: [0, 1.3, 4.3, 5.1],   // where each beat starts, seconds, ascending, the first at 0
  cuts: [],                    // beat starts that are deliberate hard cuts (a burst, the end card)
  inFrame: { panel: [0.5, 4.3], word: [6.2, 10, 'whole'] }, // id -> [from, to] it must stay in frame
  blur: true,                  // true ONLY if time(t) draws its own motion blur
  track(t) {                   // what is on screen at t: boxes in SCREEN pixels, x/y the top-left
    return { panel: { x: 460, y: 240, w: 1000, h: 600, op: 1 } }
  },
  events() {                   // where the sounds are; check_film returns the list as `events`, for score_sfx
    return [{ t: 1.2, material: 'knock', gain: 0.45, pan: -0.2 }]
  }
}
```

`track(t)` is the whole of what `check_film` knows. Return a box for everything the viewer is
looking at, under one stable id each; leave out, or give `op: 0` to, what is not on screen. Under
a camera, return `BM.boxToScreen(matrix, { x, y, w, h, op })`. **A carry is one id that changes** —
the button and the panel it becomes are `panel` throughout; the dot and the ground it opens into
are `dot`.

`check_film` answers five legs, each `pass`, `warn`, `fail` or `unmeasured`. `findings` says what
to change, the failures nobody can see by watching first.

| leg | fails on | change |
|---|---|---|
| `faults` | `time(t)` or `track(t)` throws; the same time gives two answers; a box that is not five finite numbers | compute every value from `t` alone; build sims outside `time(t)`; never measure the DOM before layout |
| `continuity` | carry score under 0.5 (warns under 0.7). At each boundary a tracked id either survives and, from the boundary on, moves 2 % of the frame diagonal or scales 10 % (**carried**, 1 — a move that ended on the beat is the last beat's and does not count), survives unmoved while covering 3 % of the frame (**anchored**, ½), or nothing survives (**bare**, 0) | keep one id on screen across the boundary and move or scale it into the next beat; or list a deliberate cut in `cuts`. 3 bare boundaries within 1.5 s are a burst, and one in the last 1.2 s is the end card: neither counts |
| `curves` | a move over 80 px/frame at 1080p without `blur: true`, measured on the part of the box inside the frame. Warns when three or more moves all share one t80 | give the move more frames or less travel, or draw real blur and declare it; ease moves by what they are |
| `rhythm` | beat lengths with a coefficient of variation under 0.25 (warns when the longest is under 4× the shortest); under 25 % of the film dead still, or no rest of 1 s | shorten the hits, lengthen one hold, and make the hold truly still |
| `framing` | an id named in `inFrame` that is absent, off frame, or (with `'whole'`) cut by the edge | key the camera to where the subject lands before it gets there, or widen the shot |

`pictures: false` skips the captures: carry, curves, framing and faults in about a second, with
the stillness half of `rhythm` unmeasured. Use it while the beats are still moving, then run it
with pictures.

**Where it is blind** — the report repeats this in `blind`, and a pass has to be read with it:

- It follows ids. A carry made of two elements is a replacement to it.
- It believes `track(t)`. What is drawn and not tracked does not exist; a box that does not match
  the picture is taken at its word. (One cross-check: a picture that changes wholesale while every
  box holds is reported as untracked.)
- A replacement slower than 0.5 s looks like survival, because the outgoing thing is still there
  when the window closes.
- Stillness is read from a small picture: fine detail averages away, and its unit has not been
  calibrated against a film made here.
- A film with one or two boundaries has a score that is not evidence.

So a pass is not a look. `frame_grid` the film and read the boundaries with your own eyes.

## The kit

A whole film on `BM`: four beats, three boundaries, each carried by a different move
(`rectMorph`, `pushInto`, `iris`), a hand whose press causes the state change, a keyed camera, a
three-second hold, motion blur sized from travel, and a `__film` the oracle passes. Start from its
structure — one table of times, a `track(t)` that the drawing and the blur both read — and write
your own concept's beats. Its story is not a default.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>Motion kit</title>
    <style>
      body { margin: 0; background: #f2efe8; }
      #root { position: relative; width: 1920px; height: 1080px; overflow: hidden; }
      .clip { position: absolute; inset: 0; }
      canvas { width: 1920px; height: 1080px; display: block; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="10">
      <section id="stage" class="clip" data-start="0" data-duration="10">
        <canvas id="c" width="1920" height="1080"></canvas>
      </section>
    </div>
    <script src="bay-motion.js"></script>
    <script>
      // ---- the film, as numbers ------------------------------------------------------------
      const W = 1920, H = 1080, DUR = 10, FPS = 30;
      // Every time in the film is named once, here. The beats, the sound and the drawing all read these.
      const T = { pop: 0.15, press: 1.2, open: 1.3, fill: 2.1, done: 3.3, push: 4.3, iris: 5.1, word: 5.9, hit: 6.02, line: 6.3 };
      const BEATS = [0, T.open, T.push, T.iris]; // 1.3 s, 3 s, 0.8 s, 4.9 s: the longest is six times the shortest
      const C = { paper: '#f2efe8', ink: '#16181d', card: '#ffffff', mute: '#8a8f98', accent: '#e4572e' };
      const SANS = 'Inter, system-ui, sans-serif';

      // Layout, authored as the home camera sees it.
      const CHIP = { x: 580, y: 564, w: 240, h: 72, r: 36 };     // the button…
      const PANEL = { x: 460, y: 240, w: 1000, h: 600, r: 28 };  // …and the window it opens into
      const THUMB = { x: 1012, y: 330, w: 384, h: 216 };         // 16:9, so a push lands it exactly on the frame
      const DOT = { x: THUMB.x + THUMB.w / 2, y: THUMB.y + THUMB.h / 2, r: 7 };
      const WORD = { x: 510, y: 420, w: 900, h: 190 };
      const PUSH = W / THUMB.w; // how much larger the world is once the push has landed

      // ---- the camera: keyed to chase, shaken by the landing ------------------------------
      // A key's curve is the curve of the move that ARRIVES at it; a key inherits what it leaves out.
      const KEYS = [
        { t: 0, x: 700, y: 600, zoom: 1.5 },                         // close on the chip
        { t: T.open },                                                // held there through the press
        { t: T.open + 0.6, x: 960, y: 540, zoom: 1, curve: 'cubicOut' }  // leaves with the snap and settles on the panel
      ];
      function camera(t) {
        const cam = BM.cameraAt(t, KEYS);
        const hit = BM.shake(t, T.hit, { amp: 9, rot: 0.25, seed: 4 }); // px, so divided by zoom
        return { x: cam.x + hit.x / cam.zoom, y: cam.y + hit.y / cam.zoom, zoom: cam.zoom, rot: cam.rot + hit.rot };
      }
      // Layout → screen for the world. The camera is home by the time the push starts, so the
      // push's target can be given in layout coordinates.
      const push = (t) => BM.pushInto(t, T.push, T.iris, THUMB);
      const worldMatrix = (t) => BM.matMultiply(push(t).matrix, BM.layerMatrix(camera(t)));
      const iris = (t) => BM.iris(t, T.iris, T.iris + 0.7, W / 2, H / 2, { from: DOT.r * PUSH, curve: 'quartOut' });

      // ---- the hand: one path, one click, and what the click causes ----------------------
      const HAND = [{ t: 0.25, x: 1180, y: 900 }, { t: 1.05, x: 716, y: 606 }, { t: 1.45, x: 716, y: 606 }, { t: 2.3, x: 2040, y: 1180 }];
      const hand = (t) => BM.pointer(t, HAND, [T.press]);
      const pressed = (t) => BM.press(t, T.press);
      // The chip is one rect all the way: it pops in, dips under the hand, and becomes the panel.
      function panelBox(t) {
        const box = BM.rectMorph(t, T.open, T.open + 0.7, CHIP, PANEL, { curve: 'expoOut' }); // released by the press: it snaps open
        const pop = BM.cardPop(t, T.pop), s = pop.s * pressed(t).s;
        return { x: box.cx - (box.w * s) / 2, y: box.cy - (box.h * s) / 2 + pop.dy, w: box.w * s, h: box.h * s, r: box.r * s, op: pop.op, p: box.p };
      }
      const thumbPop = (t) => BM.cardPop(t, T.fill + 0.05);
      function wordBox(t) {
        const land = BM.wordLand(t, T.word, { rise: 60 });
        const w = WORD.w * land.s, h = WORD.h * land.s;
        return { x: WORD.x + (WORD.w - w) / 2, y: WORD.y + (WORD.h - h) / 2 + land.y, w, h, op: land.op, s: land.s, dy: land.y };
      }

      // ---- what is on screen, in screen pixels: the oracle and the blur both read this ---
      function track(t) {
        const boxes = {}, ir = iris(t);
        if (!ir.covered) {
          const M = worldMatrix(t), p = panelBox(t), tp = thumbPop(t), h = hand(t);
          boxes.panel = BM.boxToScreen(M, { x: p.x, y: p.y, w: p.w, h: p.h, op: p.op });
          boxes.thumb = BM.boxToScreen(M, { x: THUMB.x, y: THUMB.y + tp.dy, w: THUMB.w, h: THUMB.h, op: tp.op });
          boxes.hand = BM.boxToScreen(M, { x: h.x, y: h.y, w: 26, h: 38, op: 1 });
        }
        // The dot is one id from a 7 px mark in the thumbnail to the ground of the last beat.
        if (t < T.iris) {
          const M = worldMatrix(t), tp = thumbPop(t);
          boxes.dot = BM.boxToScreen(M, { x: DOT.x - DOT.r, y: DOT.y - DOT.r + tp.dy, w: DOT.r * 2, h: DOT.r * 2, op: tp.op });
        } else {
          boxes.dot = { x: W / 2 - ir.r, y: H / 2 - ir.r, w: ir.r * 2, h: ir.r * 2, op: 1 };
        }
        if (t >= T.word) {
          const b = wordBox(t);
          boxes.word = BM.boxToScreen(BM.layerMatrix(camera(t)), { x: b.x, y: b.y, w: b.w, h: b.h, op: b.op });
        }
        return boxes;
      }

      // ---- drawing -------------------------------------------------------------------------
      const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
      const mix = (a, b, p) => { const x = hex(a), y = hex(b); return `rgb(${x.map((v, i) => Math.round(BM.lerp(v, y[i], p))).join(',')})`; };
      const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, Math.max(0, r)); };
      function label(c, s, x, y, px, weight, colour, align) {
        c.font = `${weight} ${px}px ${SANS}`; c.fillStyle = colour; c.textAlign = align || 'left'; c.textBaseline = 'middle'; c.fillText(s, x, y);
      }

      function drawWorld(c, t) {
        const cam = camera(t), ps = push(t), M = worldMatrix(t);
        // A far grid for the camera to slide against: on an empty ground a move does not read.
        const g = BM.farGrid(cam);
        c.setTransform(...BM.matCanvas(BM.matMultiply(ps.matrix, g.matrix)));
        c.fillStyle = 'rgba(22,24,29,0.16)';
        for (let x = g.x0; x <= g.x1; x += g.spacing) for (let y = g.y0; y <= g.y1; y += g.spacing) { c.beginPath(); c.arc(x, y, g.r, 0, Math.PI * 2); c.fill(); }

        c.setTransform(...BM.matCanvas(M));
        const p = panelBox(t), pr = pressed(t);
        if (p.op > 0) {
          c.globalAlpha = p.op;
          // One container; its contents cross over inside it as it opens.
          c.fillStyle = mix(pr.active ? C.accent : C.ink, C.card, p.p); rr(c, p.x, p.y, p.w, p.h, p.r); c.fill();
          c.globalAlpha = p.op * (1 - BM.progress(p.p, 0, 0.4));
          label(c, pr.active ? 'Rendering' : 'Render', p.x + p.w / 2, p.y + p.h / 2, 30, 600, C.card, 'center');
          const inside = BM.progress(p.p, 0.7, 1);
          if (inside > 0) {
            c.globalAlpha = inside;
            label(c, 'Export', PANEL.x + 56, PANEL.y + 76, 40, 600, C.ink);
            // The bar fills because the button was pressed: the press is the cause, on screen.
            const fill = BM.EASES.quadOut(BM.progress(t, T.fill, T.done - 0.1)), tick = BM.checkTick(t, T.done);
            c.fillStyle = '#e7e3da'; rr(c, PANEL.x + 56, PANEL.y + 470, 888, 14, 7); c.fill();
            c.fillStyle = tick.on ? C.ink : C.accent; rr(c, PANEL.x + 56, PANEL.y + 470, 888 * fill, 14, 7); c.fill();
            label(c, tick.on ? 'Done' : `${Math.round(fill * 100)}%`, PANEL.x + 56, PANEL.y + 524, 26, 500, C.mute);
            if (tick.on) { c.fillStyle = C.ink; c.beginPath(); c.arc(PANEL.x + 920, PANEL.y + 524, 14 * tick.s, 0, Math.PI * 2); c.fill(); }
            const tp = thumbPop(t);
            c.globalAlpha = tp.op;
            c.fillStyle = C.ink; c.fillRect(THUMB.x, THUMB.y + tp.dy, THUMB.w, THUMB.h);
            c.fillStyle = C.accent; c.beginPath(); c.arc(DOT.x, DOT.y + tp.dy, DOT.r, 0, Math.PI * 2); c.fill();
          }
          c.globalAlpha = 1;
        }
        const h = hand(t); // the hand: it leaves the frame once it has pressed
        c.setTransform(...BM.matCanvas(BM.matMultiply(M, BM.matTranslate(h.x, h.y), BM.matScale(h.s))));
        c.fillStyle = C.card; c.strokeStyle = C.ink; c.lineWidth = 2; c.lineJoin = 'round';
        c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 32); c.lineTo(8, 24); c.lineTo(14, 37); c.lineTo(20, 34); c.lineTo(14, 21); c.lineTo(25, 21); c.closePath(); c.fill(); c.stroke();
      }

      function drawStage(c, t) {
        // The last beat's ground is the dot, opened: everything in here is clipped to the iris.
        const ir = iris(t);
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.save(); c.beginPath(); c.arc(W / 2, H / 2, ir.r, 0, Math.PI * 2); c.clip();
        c.fillStyle = C.accent; c.fillRect(0, 0, W, H);
        if (t >= T.word) {
          c.setTransform(...BM.matCanvas(BM.layerMatrix(camera(t))));
          const b = wordBox(t), hit = BM.impact(t, T.hit, { squashX: 0.05, squashY: 0.08 });
          c.globalAlpha = b.op;
          c.translate(WORD.x + WORD.w / 2, WORD.y + WORD.h + b.dy); c.scale(b.s * hit.sx, b.s * hit.sy); // squash about the baseline
          label(c, 'Rendered.', 0, -WORD.h / 2, 170, 700, C.ink, 'center');
          c.setTransform(...BM.matCanvas(BM.layerMatrix(camera(t))));
          // The second line rises from behind a mask: no fade, the mask's edge is the reveal.
          const line = BM.lineReveal(t, T.line, 0, { dist: 60 });
          if (line.visible) {
            c.globalAlpha = 1; c.beginPath(); c.rect(WORD.x, 650, WORD.w, 60); c.clip();
            label(c, 'From one press.', W / 2, 680 + line.y, 40, 500, C.ink, 'center');
          }
        }
        c.restore(); c.globalAlpha = 1;
      }

      function draw(c, t) {
        c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1;
        c.fillStyle = C.paper; c.fillRect(0, 0, W, H);
        const ir = iris(t);
        if (!ir.covered) drawWorld(c, t);   // once the iris is the frame, the world is gone
        if (t >= T.iris) drawStage(c, t);
      }

      // ---- the frame: a 180° shutter, with as many sub-frames as the travel needs ---------
      const view = document.getElementById('c'), out = view.getContext('2d');
      const scratch = document.createElement('canvas'); scratch.width = W; scratch.height = H;
      const sc = scratch.getContext('2d');
      const SHUTTER = 0.5 / FPS;
      // The farthest anything moves on screen while the shutter is open: the camera's share, and each tracked box's.
      function travel(t0, t1) {
        const a = track(t0), b = track(t1);
        let far = BM.frameTravel(camera(t0), camera(t1));
        for (const id in a) if (b[id] && a[id].op > 0 && b[id].op > 0) far = Math.max(far, BM.boxTravel(a[id], b[id]));
        return far;
      }
      function time(t) {
        const open = t - SHUTTER / 2, n = BM.blurSamples(travel(open, open + SHUTTER));
        if (n === 1) { draw(out, t); return; } // a hold is drawn once, exactly at t: dead still
        for (let i = 0; i < n; i++) {
          draw(sc, open + (SHUTTER * (i + 0.5)) / n);
          out.setTransform(1, 0, 0, 1, 0, 0); out.globalAlpha = 1 / (i + 1); out.drawImage(scratch, 0, 0);
        }
        out.globalAlpha = 1;
      }

      // ---- what bay and its tools read -----------------------------------------------------
      const pan = (x) => BM.clamp(x / (W / 2) - 1, -1, 1);
      window.__film = {
        beats: BEATS,
        inFrame: { panel: [0.5, T.push], word: [T.word + 0.3, DUR, 'whole'] },
        blur: true, // time(t) draws its own motion blur, above
        track,
        // Where the sounds are, for score_sfx: fewer than the picture has events, and one loudest.
        events: () => [
          { t: T.press, material: 'knock', gain: 0.45, pan: pan(BM.toScreen(worldMatrix(T.press), 716, 606)[0]) },
          { t: T.done, material: 'bell', gain: 0.35, pan: pan(PANEL.x + 920) },
          { t: T.push, material: 'whoosh', gain: 0.5, pan: pan(DOT.x), size: 1.4 },
          { t: T.hit, material: 'thump', gain: 0.9, pan: 0 }
        ]
      };
      time(0);
      window.__timelines['main'] = { time, duration: () => DUR };
    </script>
  </body>
</html>
```

What to take from it:

- **One table of times** (`T`). The beats, the drawing, the blur and the sound all read it, so a
  retimed beat moves everything that depends on it and no time is typed twice.
- **`track(t)` is written first and used three times**: the oracle follows it, the blur sizes
  itself from it, and writing it forces the question "which id carries this boundary?" before any
  drawing exists.
- **The carries are single ids.** `panel` is the button, then the window. `dot` is a 7 px mark in
  the thumbnail, then the ground of the last beat.
- **The hold is drawn once.** When nothing travels, `blurSamples` is 1 and the frame is drawn
  exactly at `t`.
- **Under plain Node** (`src/main/html/film-fixtures.test.ts`) this kit gets: faults pass,
  continuity pass with a carry score of 1.00 over three boundaries (by `panel`; by
  `panel`, `thumb` and `dot` together under the push; by `dot`), curves pass, framing pass, and
  the cadence half of rhythm (lengths 1.3, 3, 0.8, 4.9 s). The stillness half needs pictures,
  which that test does not take.

A DOM film is the same program with styles in place of canvas calls: one absolutely positioned
layer at `left: 0; top: 0` with `transform-origin: 0 0`, and `el.style.transform = BM.matCss(M)`.
It cannot draw its own motion blur, so it must keep every move under the speed limit and leave
`blur` false.

## Sound

`score_sfx` renders a film's effects from a score: `whoosh` (something through air), `knock` (a
small dry contact), `bell` (an accent with a pitch), `thump` (weight — the one big hit), `drop` (a
soft arrival), all sent to one room. There is no other sound, and that is the point: one palette
in one space is what makes a film's sounds belong to each other.

- Keep the events in the composition, as `__film.events()`, built from the same table of times
  as the picture. `check_film` calls it and returns the list as `events`: pass that to
  `score_sfx` as it came — do not retype the times — with `durationSeconds` the film's length and
  `atFrame` the frame the film's clip starts on.
- **Fewer sounds than events.** A sound on every visual event is a slot machine. Score the
  contacts a viewer should feel, one of each run (one key in three), and leave rests.
- Pan each sound to where the thing is on screen (−1 left, 1 right). Vary `gain`, and save the
  loudest for the biggest moment.
- `validateOnly: true` first: it reports hits piling into the limiter and sounds cut off by the
  end, without writing anything.
- One `room` per film. Leave `ceilingDb` at its default so music has room above the effects.
- You cannot hear it. Say so, and ask the user to listen.

## Before you show it

- **Carry:** name, for every boundary, the id that survives it. A fade anywhere is a failure.
- **Cause:** every state, number and colour change has something on screen that caused it.
- **Rhythm:** the beats are uneven, there is a burst, and at least one hold of a second or more is
  dead still.
- **Camera:** it chases, it never loses a subject named in `inFrame`, and it stops in the holds.
- **Look:** `preview_frame` at every boundary and in the middle of every move; `frame_grid` of the
  whole film.
- **Measure:** `check_film` with pictures, no failing leg, `blind` read, unmeasured legs said out
  loud.
- **Sound:** `score_sfx` from the film's own events, fewer than the picture has.
