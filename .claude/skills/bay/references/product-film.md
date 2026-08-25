# The product film — a named format

A launch or explainer film: type, shapes and interface mock-ups on a flat canvas, cut to music,
a minute or two long. **This is the genre every gating check was written against**, so unlike a
recorded conversation nothing is suspended — a continuity or response failure here is a real one.
Declare it with `format: "product-film"`.

The numbers below come from breaking down a real one, 118 s, 19 beats.

---

## What it is actually made of

Break a reference down by *technique* before you plan anything, because the answer decides
whether bay can build it at all. On the film this reference comes from, the split was:

- **2D composited layers — everything but four seconds of it.** Type, vector orbs, interface
  panels rebuilt as shapes, chat bubbles, node diagrams, a counter. All of it position, scale,
  opacity and rotation on a flat canvas.
- **Live action — one beat, four seconds:** a grid of clips, each masked to a rounded rectangle.

That ratio is the whole reason this format is worth naming. **It is not a film about footage.**
The interfaces are *rebuilt* as shapes rather than screen-recorded, which is why they can scale
from nothing, translate as a unit and mask into a single node — a screen recording can only be
cropped and moved.

So: if a reference beat is a real 3D camera move through space, or a particle simulation, bay
cannot build it and you should say so rather than approximating it with dozens of elements. If it
is layers moving on a flat canvas — and in this genre it usually is — it is buildable.

---

## Structure

- Beats are short and there are many: **median about 6 s, shortest 3, longest 12**, across nearly
  two minutes. `marker_add` every one before you place an element.
- Each beat is **one idea, fully assembled, then removed**. The removal is as designed as the
  arrival: panels translate out of frame, a group scales to nothing, a view pushes into one
  element until it fills the frame.
- **Carry something across the seam.** This is `broken-continuity`, and here it is a real
  requirement rather than a genre mismatch: the element that survives is usually the thing the
  next beat is about — an orb that becomes the next scene's subject, a panel that masks down into
  a node the next diagram is built from.
- The film opens on **type on a plain ground** and closes on the same lockup. The first beat is
  the claim; the last is the name.

## Building the pieces

**Interface mock-ups.** Rounded rectangles for panels, text for their contents, small shapes for
controls, all parented with `group_create` so the panel moves as one thing. Animate the group,
not the parts — `animate_many` for the parts arriving inside it, staggered. A cursor is one small
shape translating across x and y; it is what makes a mock-up read as a demonstration rather than
a diagram.

**Chat interfaces.** A rounded rect per bubble with text on top, grouped. Each new message scales
from nothing while the whole group translates up — that vertical push is what sells it as a
conversation rather than a list.

**Orbs and marks.** `add_shape` ellipse. A pulse is `push-in`/`pull-back` or a scale keyframe; to
put it *on the music*, read `audio_beats` and place the accents on the grid it returns rather
than guessing an interval.

**Diagrams.** Icons as shapes, connectors as thin rectangles. `mask_set` with a feathered ellipse
gives the radial reveal this genre uses to open a beat, animated on `mask.width`/`mask.height` —
masks are one of the few things whose geometry is animatable.

**A camera.** bay has no camera, but `group_create` over every element in a beat gives you one:
scale the group to push in, translate it to pan. That is how "the view zooms out" and "the frame
pushes into one bubble" get built.

**Type that assembles itself.** There is no per-character animation. A typewriter is a mask over
the text with its width animated — which is the same effect and one element instead of forty.

---

## What bay cannot do here, and what to do instead

Say so rather than approximating. Each of these was a real element in the reference:

| The reference does | bay | Do instead |
|---|---|---|
| A blur that grows as an element leaves | effects are one-shot, not animatable | fade and scale it away instead |
| A border radius morphing into another shape | radius is not a channel | cross-dissolve the two shapes, or accept the cut |
| A plate flipping on the x-axis | rotation is z-only | scale one edge with `scaleY` and swap at the midpoint |
| Per-character text animation | there is no per-glyph channel | a mask over the text with its width animated — the same effect, one element instead of forty |
| A real camera move through 3D space, or a particle simulation | neither exists | say so. This is the case where the honest answer is that a different tool makes this shot |

**Three rows left this table and it is worth knowing which**, because documents like this one go
stale in exactly one direction — they keep saying no after the answer became yes:

- **Gradients exist.** `add_shape` takes `gradientFrom`, `gradientTo` and `gradientAngle`, and
  they are **tones, not colours**, so the kit stays the only place a value comes from. A ramp
  that half-specifies is refused rather than silently ignored.
- **Strokes and dashes exist.** `strokeTone`, `strokeWidth`, `dash` and `gap`. A dashed connector
  is one shape now, not a row of rectangles placed by hand.
- **Audio-reactive scale exists.** `audio_react` samples the sound once and writes ordinary
  keyframes, so the pulse is editable and identical in preview and export. It **rides** the
  curve already on the element rather than replacing it — that bug shipped once and cost a hero
  moment. `check` reports it as `off-vocabulary-motion`, correctly.

The row that most changes how a result looks is the blur. If a reference leans on animated blur
for its transitions, say that up front — a version without it is a different film, and the person
asking should get to decide that rather than discover it in the render.

---

## Sound

Cut to the music, not near it: `audio_beats` returns the grid, `marker_add` puts it on the ruler,
and clips snap to markers. Read `confidence` before trusting `bpm`.

Narration, if there is any, is `narrate` — the captions come from the same synthesis as the
audio, so they cannot drift. The mix wants the loudest moment on the `payoff` marker, which is a
check (`mix`) and not a matter of taste.

---

## Before you call it finished

The full gate in the main skill applies unchanged — this is the genre it was written for. The
three that catch the most in this format:

1. **`no-hook`** — the opening frame decides whether the rest is watched, and this format opens
   on type, so there is no excuse for it to be empty.
2. **`broken-continuity`** — every seam. Keep an id across it and animate it there.
3. **`check_frames`** — `frozen` and `anchor-scale`. A beat where a panel arrives and then
   nothing moves for six seconds is this format's characteristic failure.
