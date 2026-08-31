# bay — how the UI draws things that are not boxes

**Status: decided and implemented.** Written 2026-08-27 against GPUI 0.2.2, from a spike that was
built, measured, and run in the real app. Five milestones build on this — the Motion page's curve
editor, the Color page's scopes and wheels, the Audio page's meters and faders, the easing picker,
and the Deliver page's queue — and none of them should re-open the question.

## The problem

Every visual in bay was a `div` with a background colour. `gpui::canvas()`, `Window::paint_path`
and `PathBuilder` were all present in GPUI 0.2.2 and used **zero times** in the tree. The audio
"waveform" on a timeline clip was 48 peak-bar divs (`editor_view.rs`, `WAVEFORM_BUCKETS = 48`).

That is fine for chrome and impossible for what comes next: a bezier curve with draggable
tangents, four scope panels, a hue disc with a polar 2-D drag over it, tall waveforms, EQ curves,
faders, and a vectorscope that plots ~130,000 samples per frame.

## The two candidates

**(a) `gpui::canvas()` + `PathBuilder`** — a custom element that paints tessellated paths
directly into the scene.

**(b) Render to an image on the CPU and upload it** — build an `RgbaImage`, wrap it in a
`RenderImage`, hand it to `img()`.

## The decision

**Vector geometry is a path. A density plot is a raster. Nothing else uses route (b).**

`rust/crates/bay-ui/src/draw.rs` is the whole of it: a `Shape` enum (`Polyline`, `Polygon`,
`Circle`, `Ring`), a `paint(Vec<Shape>)` canvas element, and `RetiredImages`, which owns the
obligation that route (b) drags behind it.

### Why paths win for everything a panel actually draws

**Cost.** A 1,000-point stroked polyline tessellates in **80 µs** — measured, release build, M-series
Mac, by `draw::tests::a_thousand_point_polyline_tessellates_inside_a_frame`, which prints the
number under `--nocapture` and fails above 8 ms so a regression is caught rather than felt. That
is under half a percent of a 16.6 ms frame, for a curve with more points than a curve editor will
ever have on screen. The GPU side is a vertex buffer and one draw — GPUI batches paths into the
same scene as quads. A 300-point curve, which is what a panel-width plot at one point per pixel
actually is, costs proportionally less.

The image route costs, for the same curve: allocate an RGBA buffer, rasterise the line into it on
the CPU with your own anti-aliasing, upload it as a fresh atlas tile, and — see below — free the
old one by hand. It is slower and it is more code, and every one of those steps is code this repo
would have to write and keep.

**Stroke width and dashes are both there.** `PathBuilder::stroke(width)` takes a width;
`dash_array(&[Pixels])` implements SVG's `stroke-dasharray`, including the odd-length repeat rule.
A scope graticule and a "no engine support" guide line both need dashes and neither needs anything
invented. `PathBuilder` also has cubic and quadratic beziers and elliptical arcs, so a bezier
curve editor draws its curve with the same control points it stores — no sampling step in
between, and no chance of the drawn curve disagreeing with the evaluated one.

**Hit-testing is hand-rolled either way, so it decided nothing.** A path is geometry, not an
element: a canvas has no `on_click`, and mapping a pointer to a datum (which keyframe, which point
on the wheel) is arithmetic the panel has to do. But that is equally true of an uploaded image — a
picture of a curve is no more clickable than a path of one. The join is the same in both worlds
and it is provided here: `draw::measure()` is a zero-ink canvas that stashes its own bounds in an
`Rc<Cell<Bounds>>`, which the mouse handlers built in the same render pass read back. Prepaint
runs before any event for that frame is dispatched, so the geometry is never a frame stale.
`controls.rs` uses exactly this for the slider.

**Theme-correct by construction.** A path takes a `Background`, so it uses `theme::` tokens like
everything else. A CPU raster has to be re-rasterised whenever a colour changes.

### Where paths lose, and what to do instead

**A vectorscope is not a path.** It is a 2-D histogram: every pixel of a frame becomes a point in
UV space, and what is drawn is the *density* of those points. 130,000 points is not a polyline and
not 130,000 circles — at 80 µs per thousand points that is over 10 ms of tessellation per frame,
for a picture that is fundamentally a bitmap anyway.

So a vectorscope, and the waveform/parade/histogram scopes with it, is drawn as a raster:

1. **The reduction is `bay-preview`'s, not the UI's.** Scopes are a CPU reduction over a readback
   that already happens (see `pages.md`, and the M7 milestone). Frame → `Vec<u8>` raster is
   engine work, testable headless, reachable from the MCP server. The UI receives a buffer.
2. **The UI uploads it and obeys the atlas rule** (below).
3. **The graticule over it is still a path.** Rings, skin-tone line, IRE marks, box outlines — all
   `Shape`s painted on top of the uploaded raster, because they are geometry and they change with
   the theme.

**A tall waveform is a path, but one path.** `draw::envelope(samples, buckets)` reduces to one
`(min, max)` pair per pixel column and `draw::envelope_outline` turns those into a single closed
polygon — out along the maxima, back along the minima. Not one rectangle per bucket: at 900px of
mixer width that would be 900 elements per track, rebuilt every frame. Note that `envelope` keeps
**both signs**; the timeline's existing 48 peak bars keep only a magnitude, and a waveform drawn
from those is a rectified signal wearing a waveform's shape.

## The obligation that comes with route (b)

Anything that uploads an image inherits this, and getting it wrong is an atlas leak this
repository has already shipped once (in the preview — see `editor_view.rs`'s `retired_images`).

GPUI keys its sprite atlas on `RenderImage::id`, a fresh monotonic counter value per image, and it
**never evicts on drop**. `Window::drop_image` is the only thing that calls `PlatformAtlas::remove`.
A panel that builds a new `RenderImage` per frame therefore misses the cache every time, allocates
another tile, and pushes a new 1024×1024 atlas texture every couple of frames — none of which is
ever freed. That is tens of MB of VRAM per second until allocation starts failing.

The rule, stated once, in `draw::RetiredImages`:

1. When an image leaves the screen, **retire** it. Do not drop the `Arc`: dropping frees the
   memory and orphans the tile, which is the leak.
2. Once per frame, at the **top** of `render` and before the element tree is rebuilt, **release**.
   Only then is it certain that every queued image was last painted into a frame already
   submitted.

The queue exists because a windowless caller has no `Window` to release with — the `Arc` parks and
the next render drains it. `RetiredImages::replace` is the safe form of "swap the image in this
slot", because assigning over an `Option<Arc<RenderImage>>` directly is precisely the mistake.

## Rules for the milestones that build on this

- **Decimate before you build shapes, not after.** A plot is at most one point per pixel of its
  own width. `Shape::point_count()` is what the tessellator will see; the cost of a frame is
  roughly linear in the sum of it.
- **Bad numbers draw nothing, they do not panic and they do not lie.** Every coordinate in a curve
  editor came from a drag, and this app's transforms are already tested against NaN and ±inf. A
  shape with a non-finite point is skipped *whole* — dropping the one bad point of a curve would
  silently join its neighbours and draw a line the data does not contain.
- **Element-local coordinates.** `(0, 0)` is the element's top-left; `paint` translates. A panel
  never needs to know where it landed in the window.
- **Clipping is free, layering is not.** GPUI's content mask clips a canvas to its bounds. But a
  canvas paints at its place in the tree, so anything that must float over siblings — a popover, a
  tooltip, a dragged handle escaping its panel — needs `deferred()`, *or* to be positioned
  absolutely and placed last. Prefer the latter for a whole panel; `deferred` does not nest (next
  bullet), and a panel that defers itself cannot contain a control that defers.
- **One canvas per logical drawing.** `paint` takes a `Vec<Shape>` for this reason: a scope's
  graticule, trace and readout are one element, not three.
- **A `Select` may not sit inside a `deferred` subtree.** Its open list defers itself, and GPUI
  aborts on `defer_draw` during deferred drawing. A panel that has to float over its siblings
  should be positioned absolutely and placed last, not deferred. This is not theoretical — the
  spike panel was written that way and `editor_view::paint_tests::an_open_select_paints_at_both_sizes`
  is what found it.

## How this is checked

`editor_view::paint_tests` opens a real GPUI window and runs layout → prepaint → paint on the
whole editor, with every widget and every drawing primitive in the tree, at 1440×900, at 640×420
and at 320×240, plus once with a popover open and once with a slider mid-drag. Every other test in
the UI crate drives state and asserts on it, which never touches the element tree; these are what
catch a canvas painting outside its phase, a path built from a NaN, a colliding element id, or an
impossible deferred layout. They are not a substitute for looking at the app — they are the part
of looking at it that runs on every commit.

## What was rejected, and why it might come back

- **A general immediate-mode 2-D context** (`ctx.move_to`, `ctx.stroke`) over the canvas. Nothing
  needs it; `Shape` covers the five panels that are actually planned, and a shape the fifth panel
  wants should be built out of a polyline before the vocabulary grows.
- **Widget-owned pointer capture via GPUI element state.** A slider could hold its own drag with
  `with_element_state` and need nothing from its host. That was rejected for the drag layer, not
  the drawing layer, and the reason is in `drag.rs`: it would be unreachable from a test without a
  window, and it would leave the editor's three existing gestures on a second parallel path.
- **Route (b) for curves**, revisited only if a panel ever wants a per-pixel effect a path cannot
  express — a real heat map, a gradient-shaded region, a blurred glow. The signal is "the drawing
  is a function of position, not a shape". Everything currently planned is a shape.
