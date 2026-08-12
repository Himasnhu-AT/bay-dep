# Data in motion

Animated charts are the highest-value thing a motion-graphics tool can do that a slide cannot,
and the easiest to get wrong. The failure is always the same: animation that decorates the data
instead of teaching it.

---

## 1. The governing rule

**Animate only when the animation carries information.** A bar that grows *is* the growth. A
number that counts up *is* the accumulation. A chart that fades in is just a chart, and would
have been better as a cut.

Ask of every animated property: what does the viewer understand at the end of this move that
they did not understand at the start? If the answer is "nothing," cut the move.

---

## 2. Timing

- **Optimal animation duration for a data transition is 200–500 ms.** Faster and the audience
  does not register it happened; slower and it reads as lag.
- **Everything settles before its reading window opens.** No number should still be moving when
  the viewer is meant to read it. This is stricter for data than for anything else — a moving
  number is not readable at all.
- **Stage, don't simultaneously animate.** Moving many objects at once exceeds the eye's
  tracking capacity (people can reliably track ~3–4 moving targets). Sequencing the steps of a
  transition — and tracing trajectories where objects travel — measurably improves
  comprehension *and* is what viewers prefer.

---

## 3. Techniques that work

| Technique | What it does |
|---|---|
| **Count-up** | a number ticking from 0 to its value. Use only when the accumulation is the point; always with tabular figures |
| **Value-scaled counter** | the number's size grows with its value, so the climb itself escalates |
| **Anchored bar growth** | pin the bar's origin edge, animate one axis. The bar grows *in the direction the data reads* |
| **Progressive disclosure** | reveal series, gridlines, then annotation in sequence, not all at once |
| **Annotation on arrival** | the callout lands *after* its bar settles — the label is the secondary action |
| **Axis highlight** | dim the whole axis, brighten the tick that matters |
| **Scrub / read-head** | a vertical tracking line moves along an already-drawn series with a value readout stepping through the data |
| **Dot grid / unit chart** | one dot per unit, staggered in. Makes a count feel like a quantity |
| **Fractional wipe** | a clip-path revealing a partial star, ring or gauge |

**Salience over motion.** When one series matters, make it salient with colour, weight, or an
annotation — not by moving it more. Motion is an expensive attention mechanism; spend it once.

---

## 4. The anchor problem

This is the mechanical detail that decides whether charts are possible at all in a compositor.

Growing a bar means **scaling one axis while the other holds**, from a **fixed origin edge**. If
the element's anchor is its centre, animating `scaleX` grows it outward in both directions from
its middle, which is not what a bar does. Setting the anchor to the left edge (`anchorX: 0`)
makes `scaleX` grow it rightward from a fixed origin.

Consequences worth stating:

- Vertical bars need `anchorY: 1` (bottom) and animate `scaleY`.
- Horizontal bars need `anchorX: 0` (left) and animate `scaleX`.
- A track behind the bar in a *measured* colour (≥ 3:1 against the ground — see §03) is what
  makes the bar's value legible. A track at low opacity encodes nothing.
- Numbers must be mono/tabular or the count-up jitters.

---

## 5. Honesty

- The animation must not manipulate perception of the data. A y-axis that animates its own
  scale mid-transition, or an easing curve that overshoots a value before settling on it, is
  showing the viewer a number that is not true.
- Never overshoot a value. `back.out` on a count-up literally displays a wrong number.
- Never let a bar exceed its target and settle back.

---

## 6. Chart types and what a compositor needs for each

Ordered by how much engine support they require. This doubles as a requirements list.

| Chart | Needs | Feasible with rect + ellipse fills? |
|---|---|---|
| Bar / column | anchored one-axis scale | **yes** |
| Stacked bar | the above, plus ordering | **yes** |
| Dot grid / unit chart | many small ellipses, staggered | yes, but N elements |
| Progress bar | a track and a fill | **yes** |
| Gauge / ring | stroked arc, or an animated clip | **no — needs stroke/path** |
| Line / area chart | a polyline that draws itself | **no — needs path + stroke** |
| Scatter | many positioned ellipses | yes, but N elements |
| Sparkline | a path | **no** |
| Connectors / flows / arrows | strokes and arrowheads | **no** |

Everything in the "no" column is blocked by the same missing primitive: **a stroked path**. That
single primitive turns a chart toolkit from "bars only" into "most of what a data video needs,"
and it is also what SVG self-draw, underlines, callout arrows, diagrams and ring progress all
depend on. It is the highest-leverage single addition on the visual side (see §10).

---

## Sources

- [Design guidelines for animated data visualization based on perceptual capacity limits — *Cognitive Research: Principles and Implications*](https://link.springer.com/article/10.1186/s41235-026-00724-y)
- [Five ways to effectively use animation in data visualization — Observable](https://observablehq.com/blog/effective-animation)
- [Animating Data Visualizations: A Comprehensive Guide](https://www.numberanalytics.com/blog/ultimate-guide-animation-data-visualization)
- [4 Observations on Animating Your Data Visualizations — Urban Institute](https://urban-institute.medium.com/4-observations-on-animating-your-data-visualizations-cf987b069c35)
- [Life in Motion: A Guide to Animating Mobile Data Visualizations — Toptal](https://www.toptal.com/designers/data-visualization/mobile-data-visualization)
- Encoded practice: `vii/skills/bay/references/charts.md`,
  `~/.claude/skills/hyperframes-animation/rules/stat-bars-and-fills.md`
