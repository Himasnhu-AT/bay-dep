# Charts in vii

vii has no chart primitive. Every chart is rectangles and text, which is enough for the shapes
that carry a story: bars, columns, gridlines, dot grids, progress tracks.

The whole technique is **anchor + one-axis scale**.

---

## A bar that grows rightward

`anchorX: 0` pins the left edge, so animating `scaleX` extends the bar instead of inflating it
from its middle.

```jsonc
// add_shape
{ "id": "bar", "start": 0, "duration": 3, "color": "#FF5B5B", "radius": 0.5,
  "x": 0.089, "y": 0.5, "anchorX": 0.0, "anchorY": 0.5,
  "scaleX": 0.6, "scaleY": 0.012 }

// animate
{ "elementId": "bar", "property": "scaleX", "easing": "power-out",
  "keys": [{ "t": 0, "value": 0 }, { "t": 0.8, "value": 0.6 }] }
```

Geometry: `scaleX` is a fraction of canvas **width**, `scaleY` of canvas **height**. A bar
`w` px wide and `h` px tall on a 1080×1920 canvas is `scaleX: w/1080, scaleY: h/1920`.

## A column that grows upward

`anchorY: 1` pins the baseline.

```jsonc
{ "x": cx/1080, "y": baseline/1920, "anchorX": 0.5, "anchorY": 1.0,
  "scaleX": 170/1080, "scaleY": height/1920 }
```

Then animate `scaleY` from 0 to `height/1920`. Stagger neighbouring columns by ~0.26s.

**Frame 0 of a grow animation is a zero-extent quad** — vii skips it rather than drawing a 1px
sliver, so you get nothing on screen, not a stray line.

---

## Give the data a denominator

A bar with no reference encodes nothing. Two ways:

**A track behind the bar** — for "x% of a maximum". Must measure ≥3:1 against the ground at
**full opacity** (`#606070` on `#0E0E12`). Fading it to look subtle composites it back to
invisible.

**A gridline at the level that matters** — usually better for grouped columns. A line at the
starting value shows instantly that the final column ends up *below* where it started, which
a per-column track cannot say. Draw it as a 2–3px rect and animate its `scaleX` in.

Order matters: draw the baseline rule and gridline **before** the columns so the columns sit
on top of them.

---

## Label placement

Put captions and values **below the axis, on one grid**:

```
   START      +50%      −50%     ← caption, muted, mono, 40
    100        150        75     ← value, coloured, mono, 68
```

Floating each value above its own column looks better in the tall cases and breaks in the
short ones: a short column's label collides with the gridline above it, and with that
gridline's own label. Below the axis nothing can collide, and every column reads in the same
order — caption, then figure.

Centre each label on its column's axis with a box of the column pitch:
`x: cx − pitch/2`, `scale: pitch/1080`, `align: "center"`.

---

## A count-up

Numbers can't be interpolated — `animate` moves transform properties, not text. So a count-up
is either:

- **A scale-punch on the final figure** (cheap, usually enough): animate `scale`
  `1.0 → 1.04 → 1.0` over 0.22s as it lands, and pair it with a coral underline whose
  `scaleX` grows on the identical curve, so the bar and the number are the same fact twice.
- **One text element per value**, each with `easing: "hold"` on opacity so it cuts rather than
  fades. Expensive above ~20 steps.

## A dot grid

N ellipses on a lattice, staggered opacity. Highlighted dots must be **contiguous** — scattered
highlights read as decoration, a contiguous block reads as a proportion.

```jsonc
{ "shape": "ellipse", "scaleX": 26/1080, "scaleY": 26/1920,
  "x": (x0 + col*pitch)/1080, "y": (y0 + row*pitch)/1920 }
```

---

## Rules that keep a chart honest

1. **Check your arithmetic.** Any number on screen must be true and must reconcile with every
   other number on screen. Three bars summing to 52 under a headline of 97 is a real defect
   that shipped once.
2. **The label, the figure and the sentence must describe the same thing.** "53 verification
   agents / 37 survived" was wrong — agents don't survive, findings do.
3. **Never give the payoff away in the hook.** If the chart reveals a number, the opening
   frame must not already say it.
4. **Align to one grid.** Hero numbers flush-left with their own labels.
