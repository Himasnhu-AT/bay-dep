> **Historical:** describes the Rust engine, deleted; recover what it cites with `git show rust-engine-final:dep/rust/<path>` (e.g. `crates/bay-mcp/src/tools.rs`).

# 38 — Data, charts, diagrams and formulas in motion

Round 2. Everything below is measured against `wicks-v2.mp4` and
`project-1786466680050.json`, or read out of `element.rs` / `templates.rs` / `check.rs` on
`fix/pending-sweep`. Round-1 §08 is assumed read; this file does not repeat it.

**The judging question for every rule here:** if an agent optimised for this and nothing else,
what would the video look like? Each rule below carries its own *gameable* line. Rules whose
gameable line is "it would still look like wicks-v2" have been deleted rather than shipped.

---

## 0. The headline finding

The card was never empty of **elements**. It was empty of **ink**.

| window | duration | what is inside the card | why |
|---|---|---|---|
| 0.90 – 2.90 s | 2.00 s | `wick1`, `body1` present, `scaleY = 0` | grow animations held at zero |
| **18.90 – 20.20 s** | **1.30 s** | `body_a`,`body_b`,`wick_b`,`mid_*` present, `opacity = 0` | first reveal key is 2.15 s after element `start` |
| 45.50 – 47.20 s | 1.70 s | `sq`, `wbar` present, `scaleY/scaleX = 0` | same |
| 61.00 – 62.00 s | 1.00 s | nothing alive | scene 6 content ends at 61.0, panel runs to 62.0 |

Total **6.00 s of 62 s (9.7 %)** with a visible card containing zero marks above 3:1 contrast
against its own fill. Sampled at 10 Hz over the 611 frames where the panel is ≥ 50 % opaque:
**11.3 % of frames have < 1 % of the card inked; the median is 14.9 %; the maximum ever
reached is 23.4 %.** The card is 34.2 % of the canvas and is, on a median frame, 85 % empty.

Every existing `check` code is blind to this because they all count *elements* and *animations*.
`inert-scene` sees 188 elements and 119 animated channels in the window. `nothing-visual` sees
elements present. Nobody computes what is actually on the glass.

Second finding, equally concrete: the one honesty rule round 1 wrote down — *never overshoot a
value* — **is violated in the shipped file**. `m_a` (the trend-session candle body, whose label
reads `W = 0.00`) animates `scaleY: 0 → 0.0885` with `easing: "back-out"`. bay's `BackOut` peaks
at **1.10005× at t = 0.580** of the segment. For ~0.25 s that bar is 10.0 % taller than its own
datum, and taller than `m_bw`, the wick it is supposed to exactly equal.

---

## 1. Chart-in-motion grammar

### 1.1 The order, and why

**axis → gridlines → data → value labels → annotation.** Never any other order.

| wrong order | what breaks, mechanically |
|---|---|
| data before axis | For the whole reveal the mark has no coordinate system, so the viewer cannot tell growth from entrance. bay makes this worse: a column with `anchorY: 1` growing on `scaleY` is *visually identical* to a rect sliding up from below when there is no baseline rule under it. |
| labels before data | Gives the payoff away. `charts.md` rule 3 already says this; the mechanism is that a read number terminates attention, and the remaining 0.5 s of growth is then decoration. |
| axis last | Re-frames data already read. The viewer must re-read every mark. Measured cost in comprehension studies is a full re-fixation per mark. |
| everything at once | > 4 simultaneous moving targets exceeds multiple-object-tracking capacity. A 5-column chart revealing simultaneously teaches nothing; the same 5 staggered 0.07 s apart teaches the ranking. |

The failure is not aesthetic. Each of those is a *readability* loss you can name.

### 1.2 Animating from a meaningful zero

A bar's start value must be the pixel row the axis calls zero, not "invisible".

```
start_scaleY = max(0, (axis_zero_px - baseline_px) / H)
```

If `baseline_px == axis_zero_px` (an honest zero axis), `start_scaleY = 0` and the bar grows
through every value it passes. If the axis is truncated, growing from `0` marches the bar
through values that do not exist on that axis — so **a truncated axis forbids growth**: the mark
must arrive at full length on opacity/position, because a fade is merely mute where a grow is a
lie.

### 1.3 Per-type table

`W = 1080`, `H = 1920`, 30 fps. Durations are the *move*, not the hold.

| chart | animate | anchor | duration | easing | stagger | zero |
|---|---|---|---|---|---|---|
| horizontal bar | `scaleX` | `anchorX: 0` | 0.45–0.65 s | `power-out` | 0.08 s | left of axis |
| column | `scaleY` | `anchorY: 1` | 0.40–0.55 s | `power-out` | 0.07 s | baseline rule |
| grouped columns | `scaleY` | `anchorY: 1` | 0.40 s | `power-out` | 0.07 s within group, 0.22 s between groups | shared `y`, shared `k` px/unit |
| stacked bar | `scaleY` per segment, `y` of the segment above tracks it | `anchorY: 1` | 0.34 s per segment | `expo-out` | contiguous (n starts when n−1 ends) | bottom segment from the baseline |
| line chart | per-segment 3-channel draw-on (§4.2) | `anchorX/Y: 0.5` | 0.10–0.14 s each | `linear` per segment, whole run reads as `ease-out` | contiguous | first point at the axis |
| area chart | **use columns at zero gap** (§4.7) | `anchorY: 1` | 0.03 s each | `linear` | contiguous, left→right | baseline |
| scatter | `scale` 0 → 1 | centre | 0.26 s | `spring-out` | 0.03 s | n/a |
| dot grid | `scale` 0 → 1 | centre | 0.22 s | `spring-out` | 0.018 s (100 dots = 2.0 s) | n/a |
| candle body | `scaleY` | `anchorY: 1` | 0.42 s | `power-out` | — | session open/close |
| candle wick | `scaleY` | `anchorY: 1` (up) / `0` (down) | 0.30 s, starts 0.06 s *after* the body settles | `expo-out` | — | high/low |
| gridline | `scaleX` | `anchorX: 0` | 0.24 s | `expo-out` | 0.05 s, reading order | — |
| axis / baseline rule | `scaleX` | `anchorX: 0` | 0.30 s | `power-out` | first | — |
| value label | `y` (Δ 0.010 of canvas) + `opacity` | `anchorY: 0` | 0.20 s, starts 0.10 s after its shape settles | `power4-out` | 0.10 s | — |
| annotation / callout | leader draw-on then label | — | 0.30 s, starts ≥ 0.35 s after the last datum | `expo-out` | — | — |

**Reveal budget:** a chart of *n* data marks completes in `0.45 + 0.07n` seconds, and must be
fully settled **≥ 0.8 s before** the narration clause that reads it ends.

**The 8-frame floor:** no move on a data-bearing shape may be shorter than **0.25 s (8 frames)**.
wicks-v2's modal move is 0.098 s (3 frames), used 76 times. A 3-frame move on a value channel
is not a move — it is a cut with extra keyframes, and it teaches nothing about magnitude.

---

## 2. The honesty rules (the full trap set)

`Easing::BackOut` is the only curve in bay that leaves the unit range. Its peak is exactly
`1 + c3·u³ + c1·u²` maximised at `u = −2c1/(3c3) = −0.41990`, giving **1.10005 at t = 0.58**.
`SpringOut` is critically damped (ζ = 1) and is provably monotone with max = 1.0000 — it is safe
on a value channel and is the correct default there.

| # | trap | what the viewer sees | rule |
|---|---|---|---|
| H1 | **overshoot on a value channel** | a bar 10.0 % longer than its number, for 0.25 s | on any element whose `scaleX`/`scaleY`/`scale` encodes a magnitude, easing ∈ {linear, ease-out, power-out, power4-out, expo-out, sine-in-out, spring-out}. `back-out` is a hard error. **Live violation: `m_a`.** |
| H2 | **truncated axis** | ratios that are 3× wrong | every column in a group shares one `y` and `anchorY: 1.0`; the baseline exists as an element; if the axis is not zero, a break marker element exists AND the caption text contains the axis start value |
| H3 | **uniform `scale` on a data shape** | area changes as length does; the reader integrates area, so a 2× bar looks 3× | on a data shape animate exactly one of `scaleX`/`scaleY`. Never `scale`. |
| H4 | **count-up through wrong values** | a number that was never true | the sample sequence must be non-decreasing toward the target, and the final string must equal the label's string byte-for-byte |
| H5 | **area-by-radius** | a 2× value drawn 4× bigger | for a circle, `scale ∝ √value`. Record it in the element name (`dot-sqrt-…`) so it is auditable |
| H6 | **two denominators in one card** | two bars on different scales, read as comparable | compute `k = px_per_unit` once per card; every mark's extent is `value·k/H`. Assert the invariant. |
| H7 | **opacity as a magnitude** | a de-emphasised bar reads as a smaller bar on a dark ground | de-emphasise with hue or chroma, never with opacity, on anything whose size is a datum |
| H8 | **reveal order implying causation** | "A caused B" from a 0.9 s gap | if two series are not causally ordered, land them within 0.12 s of each other |
| H9 | **label / figure / shape disagree** | already in `charts.md` §1–2 | extend: the numeral in a text element under a mark must reconcile with that mark's extent ratio to its sibling |
| H10 | **silent value replacement** | a number cutting to a different number in the same slot reads as a correction, not a change | a value replacing another either counts between them (§3a) or moves to a new slot |
| H11 | **wrong ground for a contrast floor** | the chrome disappears | contrast is measured against **the element actually beneath**, not the canvas background. See §7.3 — this is a live defect in the skill text itself. |

---

## 3. Count-ups and number reveals

bay cannot interpolate text (`AnimationChannel` is `f32`; `content` is a `String`). There are
exactly two honest constructions.

### 3a. Stepped count-up — when the accumulation *is* the point

*n* text elements, identical `x`, `y`, `scale`, `fontFamily`, `fontWeight`, `align`; each with
`duration = step` and `opacity` easing `hold` so it cuts rather than cross-fades.

- **n = 9–12, not 27.** The eye cannot resolve more than ~12 distinct values in under a second;
  more elements is cost with no perceptual return.
- **Value spacing decelerates, not the timing.** Keep the step uniform in time and put the
  ease in the *values*: `v_i = V · easeOutExpo(i/n)`. Timing-eased steps of a linear value
  sequence read as a stutter; value-eased steps of uniform timing read as a settle.
- **Digit stability.** Mono family; fixed decimal places; pad with a figure space, never drop a
  digit. `4.20` → `04.20`/` 4.20`, not `4.2`. Menlo's advance is 0.602 em, so the string width
  is `chars × 0.602 × fontSize` and is exactly computable — that is the one legitimate use of
  a code font in a finance explainer.
- **Never sample a spring or a back curve.** H4.
- Cost: *n* elements, *n* × 1 channel. Once per video, not once per number.

### 3b. Land-the-number — the default

The final figure only.

```
opacity : 0 → 1        0.14 s   linear
scale   : 0.92 → 1.00  0.34 s   spring-out     (same start frame)
underline scaleX: 0 → w  0.22 s  power-out     (starts at +0.10 s, accent colour, 4 px)
```

The bar/bracket that means the same fact lands on the **identical frame** as the underline
completes — the number and the geometry are one fact stated twice.

**The emphasis frame is a frame with nothing else moving.** Hold ≥ 1.0 s after the underline
with zero animated channels anywhere in the composition. That stillness *is* the emphasis. Any
additional motion subtracts from it. wicks-v2 has 160 move onsets in 61 s (one every 0.38 s):
there is no still frame anywhere in it, so no number in it can land.

**Size floor.** Hero figure ≥ **180 px** (16.7 % of 1080). Supporting figure ≥ **96 px**. A
label is ≤ 0.42× its figure. Measured in wicks-v2: the largest number is `rvalue` `"4.20"` at
**58 px (5.4 % of width)** — 3.1× under the hero floor. `small-text` exists as a finding code
and did not fire, because 58 px clears whatever its threshold is; the threshold is not the
problem, the *absence of a per-role floor* is.

---

## 4. Diagrams without a stroked path

**Verified against `rust/crates/bay-project/src/element.rs`:** `ShapeKind` has exactly two
variants — `Rect { radius }` and `Ellipse` (lines 596–607). There is no path, polyline, stroke,
or arc primitive anywhere in the model. There is no `stroke_width` field on any element.

What you *do* have, and what the project used none of:

| capability | line | note |
|---|---|---|
| `rotation` (degrees, animatable) | `Transform.rotation`, `ANIMATABLE[4]` | **rotated 0 times in 188 elements.** This is the single most under-used channel in the engine. Rotation is about the **quad's centre**, not the anchor (`lib.rs:1832` comment). |
| `Mask { shape, x, y, width, height, feather, inverted }` | element.rs:33–50 | canvas-space, **static** (not in `ANIMATABLE`). `inverted: true` is a hole-punch. Used 0 times. |
| `radius` as a fraction of the shorter side | element.rs:601 | `0.5` = a full pill, i.e. round line caps for free |
| 17 blend modes incl. `difference`, `screen`, `plus-lighter` | element.rs:300–319 | used 0 times |

### 4.1 Geometry you need to get any of this right

For a shape (`natural_size = None`, so `fit_contain` returns the box):

```
layer_w_px = scale · scaleX · W
layer_h_px = scale · scaleY · H
centre_px  = ( x·W + (0.5 − anchorX)·layer_w_px ,
               y·H + (0.5 − anchorY)·layer_h_px )
rotation is applied about centre_px.
```

### 4.2 A line between two points (the connector)

Given `P1 = (x1, y1)` px, `P2 = (x2, y2)` px, thickness `t` px:

```
dx = x2 − x1 ;  dy = y2 − y1
L  = hypot(dx, dy)
θ  = degrees(atan2(dy, dx))          // clockwise, y down — matches bay's rotation sense

add_shape:
  shape "rect", radius 0.5           // 0.5 gives round caps; 0 gives butt caps
  anchorX 0.5, anchorY 0.5
  x  = ((x1+x2)/2)/W
  y  = ((y1+y2)/2)/H
  scale 1, scaleX = L/W, scaleY = t/H
  rotation = θ
```

### 4.3 A line that *draws itself* from P1 (no path primitive needed)

The centre of a partially drawn line of length ℓ is `P1 + (ℓ/2)·(cosθ, sinθ)` — **linear in ℓ**.
So animate three channels on **identical key times and identical easing**:

```
scaleX : 0        → L/W
x      : x1/W     → ((x1+x2)/2)/W
y      : y1/H     → ((y1+y2)/2)/H
```

Proof it is exact, not approximate: with shared eased progress `e(u)`, `ℓ = L·e`, and the
animated `x` evaluates to `x1 + e·(mid_x − x1) = x1 + e·(L·cosθ/2)` — precisely the centre the
partial line requires, at every frame. The start point is pinned to the pixel.

This is a *three-channel* move on `scaleX`/`x`/`y`. It is also the cheapest way to break the
opacity monoculture: one connector contributes 3 non-opacity channels.

For an axis-aligned line (θ = 0 or 90) drop to one channel: `anchorX: 0` + animate `scaleX`.

### 4.4 An arrow

Shaft = §4.3, shortened by the head length so the head's point is the true terminus.
Head = two arms, each built by §4.2 from `P2`:

```
a = max(18, 3.5·t)                    // arm length, px
arm1 : P2 → P2 + a·(cos(θ+155°), sin(θ+155°))
arm2 : P2 → P2 + a·(cos(θ−155°), sin(θ−155°))
```

25° half-angle. Both arms `radius 0` (a rounded arm reads as a blob at this size). Reveal both
arms together, 0.12 s, `expo-out`, starting when the shaft's draw-on completes.

Filled triangular head, axis-aligned only: a square rect at `rotation: 45` with a static
`Mask { shape: rect }` covering the half you keep. Because the mask is canvas-space and does
**not** rotate with the element, this works for ↑ ↓ ← → and nothing else. For any other angle,
use two arms.

### 4.5 A ring / donut / annulus

```
add_shape shape "ellipse", colour C
  x, y = centre, scaleX = D/W, scaleY = D/H
mask_set:
  { shape: "ellipse", x, y, width: (D−2t)/W, height: (D−2t)/H,
    feather: 0, inverted: true }
```

The inverted ellipse mask punches the hole, so the ring composites correctly over **any**
ground — unlike the two-concentric-ellipses trick, which only works over a known flat fill.

Limitation to state out loud: the mask is canvas-space and static, so if you animate the ring's
`x`/`y` the hole stays put. A moving ring must be built as two ellipses.

### 4.6 A ring gauge / arc progress

No arcs exist. Use a **segmented ring**: `n = 36` ticks at 10°, tick *k* at

```
φ_k = −90 + 10k
pos = C + r·(cos φ_k, sin φ_k)
rect: anchor (0.5,0.5), scaleX = ℓ/W, scaleY = t/H, rotation = φ_k
```

Reveal `floor(p·n)` ticks (**floor, never round** — rounding up shows more than the datum, H4),
`opacity` easing `hold`, 0.02 s stagger. Cost: 36 elements, and it is honest and legible at
thumbnail size where a thin arc is not.

If you genuinely need a smooth arc, the segment count for sub-half-pixel polygon error at
radius *r* is `Δ ≤ 2·acos(1 − 0.5/r)` degrees — at `r = 200 px`, `Δ ≤ 8.1°`, so a 90° arc is
12 segments and a full circle is 45.

### 4.7 The other constructions, exactly

| thing | construction | draw-on |
|---|---|---|
| **underline** | rect, `anchorX 0`, `anchorY 0.5`, at `(word_left, baseline + 0.012·H)`, `scaleY = 3/H` | `scaleX: 0 → w/W`, 0.24 s, `power-out`, start +0.06 s after the word |
| **span bracket** `[` | 3 rects: vertical at `(bx, mid_y)` `anchor (0.5,0.5)` `scaleX=t/W scaleY=(y2−y1)/H`; two arms at `(bx, y1)`/`(bx, y2)` `anchor (0,0.5)` `scaleX=w/W scaleY=t/H` | vertical `scaleY 0→span` 0.30 s `power-out` (grows from the middle out — correct read for a *span*), then both arms together 0.18 s `expo-out` |
| **elbow connector** | 2 axis-aligned rects sharing a corner | H segment 0.22 s `power-out`, V segment starts exactly at its end, 0.22 s — reads as flow |
| **dashed leader** | *n* short rects on one rotation, gap = 2× dash | stagger 0.02 s, opacity `hold` |
| **callout with a dot** | ellipse 6 px at the anchor + §4.3 leader + label | dot `scale 0→1` `spring-out` 0.10 s → leader 0.25 s → label `y`+`opacity` 0.20 s. Total 0.55 s |
| **chevron / caret** | an arrowhead with no shaft | both arms together, 0.12 s |
| **area chart** | *m* columns at **zero gap** (`column width = pitch` exactly), `anchorY 1` | 0.03 s each, contiguous, left→right — the silhouette reads as an area, and a 1 px gridline drawn on top keeps it honest |
| **sparkline** | §4.3 per segment, `t = 3 px`, `radius 0.5` so joints close | contiguous, 0.10 s each |
| **needle / dial hand** | one rect, `anchorY 1`, pivot at the dial centre… | …**you cannot**: rotation is about the quad centre, not the anchor. Place the rect so its *centre* sits at `pivot + (len/2)·(cos φ, sin φ)` and animate `rotation` **and** `x`,`y` on the circle — or file the `pivot` gap (§9.7) |

### 4.8 What this buys the motion census

wicks-v2: opacity 107, x 19, y 17, scale 11, scaleY 10, scaleX 8, **rotation 0**. A single
annotated diagram built the way above — 2 connectors + 1 arrow + 1 bracket + 2 underlines —
contributes 6 `scaleX`, 4 `x`, 4 `y`, 3 `rotation` and 0 new opacity channels. The opacity
share of that scene drops below 50 % without anyone optimising a diversity metric, because the
*construction* requires the channels.

---

## 5. Formulas as a sequence — `W = R − |r|`

This is the section the video failed hardest. Measured: `head4` = the single string
`"W = R − |r|"`, animated on `opacity` + `y`. `sub4` = `"r = C − O"`, animated on `opacity` +
`x`. `head6` = `"W = R − |r|"` again, animated on `opacity` + `x`. **Three finished strings.**
No term ever moves, transforms, is highlighted, or is connected to the diagram. The arithmetic
is correct (`R = 4.20`, `|r|_A = 4.20 → W_A = 0.00`; `|r|_B = 0.28 → W_B = 3.92`) and the
teaching value is zero.

### 5.1 The governing rule

**One element per token you will ever move, highlight, or replace.**

For `W = R − |r|` the tokens are `[W] [=] [R] [−] [|r|]` — five text elements, plus five more
for the concrete row `[3.92] [=] [4.20] [−] [0.28]`. Set them in a **mono** family so the token
x-positions are arithmetic: Menlo advance = **0.602 em**, so a token of *c* characters at
`fontSize` px occupies `c · 0.602 · fontSize` px and the next token starts at
`x_prev + (c + gap) · 0.602 · fontSize`. This is the one place a code font is the right answer,
and it is the opposite of setting the *whole video* in Menlo.

### 5.2 The shot (all times relative to the scene start; total 3.6 s of motion + hold)

The candle for session B is **already on screen from the previous scene**. Do not rebuild it —
carry the element across the scene boundary and animate its `x` to make room.

| t | what appears | how (bay) | why |
|---|---|---|---|
| 0.00 | range bracket `[` at the candle's left, body bracket `[` at its right | §4.7 bracket ×2, verticals 0.30 s `power-out`, arms 0.18 s `expo-out`, second bracket +0.22 s | the geometry is the definition; the symbols are notation for it |
| 0.45 | `4.20` beside the range bracket, in the range colour | §3b land-the-number, 180 px | concrete first |
| 0.90 | `0.28` beside the body bracket, in the body colour | §3b, 180 px | |
| 1.35 | the two numbers **travel** into a sentence line below the diagram; `−`, `=`, `3.92` are new and arrive after them | animate `x` and `y` on the **existing** `4.20` and `0.28` elements, 0.55 s, `power-out`; new tokens `opacity` 0→1 with 0.10 s stagger, arriving at 1.90 | **this is the Manim move**: an element that persists and moves is read as *the same thing*; a fade-out/fade-in of two elements is read as *a different thing*. bay has `x`/`y` channels; this costs nothing |
| 2.10 | each concrete token becomes its symbol **in place** | a second text element at the *same* `x`,`y`,`scale`,`align`: concrete `opacity 1→0` over 0.18 s, symbol `0→1` over 0.18 s, offset **+0.06 s** | shared position ⇒ substitution, not replacement. `−` and `=` never move and never change: they are the invariant that proves it is the same sentence |
| 2.60 | `|r|` is taught | 3 px underline in the body colour, `scaleX 0→w`, 0.26 s `power-out`, **on the frame** the narration says "the net move"; simultaneously the body rect in the diagram brightens (a duplicate at full chroma cross-fades in over 0.20 s) | same fact twice, same frame |
| 3.10 | the abstract row settles into the headline slot; the concrete row is re-instated **below** it, muted, at 0.55× | abstract: `y` −0.06 and `scale` 1.0→1.12, 0.40 s `spring-out`. Concrete: `opacity 0→0.55`, 0.25 s | the two forms must **share the screen**, stacked, left edges aligned, with the `=` of each at the **same x** |
| 3.60 → | hold, nothing moving | — | the emphasis frame (§3b) |

### 5.3 Highlighting a term as it is spoken

Three legal methods, in preference order:

1. **Underline** — 3 px rect, `anchorX 0`, `scaleX 0 → token_width/W`, 0.26 s, `power-out`.
2. **Backing wash** — rect behind the token, accent colour at `opacity 0.14`, `anchorX 0`,
   `scaleX 0 → (token_width + 2·pad)/W`, 0.20 s, `expo-out`.
3. **Colour step** — a duplicate token in the accent colour cross-faded in over 0.12 s.

**Never scale a token to emphasise it.** bay has no layout engine: neighbouring tokens do not
reflow, so a scaled token overlaps its neighbours. The whole row would have to be re-laid out
by hand on the same frame.

Hold the highlight for the whole clause it belongs to (≥ 1.2 s), then release it over 0.20 s.
One term highlighted at a time, ever.

### 5.4 Cost, and the gap it exposes

That shot is ~22 elements for one formula. `TextElement` has one `content`, one `color`, one
`font_size` — so a highlighted word *must* be its own element and a two-colour formula *must*
be *n* elements. See §9.3.

---

## 6. The comparison shot

"Two sessions, same range, different day" is the video's central claim. Measured reveal
schedule of scene 3 (18.0 → 33.3 s, 15.3 s long):

```
18.30–18.85  gl_high draws          |  18.44–18.99  gl_low draws
20.15→20.37  body_a  opacity 0→1, x 0.2130→0.2963
21.08→21.35  wick_b  opacity 0→1, x 0.7870→0.7037
21.12→21.39  body_b  opacity 0→1
22.20 / 22.36  cap_a "TREND" / cap_b "ROUND TRIP"
22.52 / 22.62  val_a "R = 4.20"  / val_b "R = 4.20"
── 6.34 s with nothing whatsoever animating ──
29.38 / 29.40–29.95 / 29.93   mid_bot / mid_v / mid_top   (the range bracket)
── 2.75 s frozen ──
32.70–32.95  everything out
```

4.6 s of reveal, then **6.34 s of a completely static frame**, a 0.6 s bracket, then 2.75 s
static. That is what the evidence saw as "scenes dump and freeze".

### 6.1 Both at once, or one then the other?

**It depends on which half of the claim the mark carries, and both halves are present here.**

- The claim of **sameness** is a simultaneity judgement. Two edges are compared best when they
  arrive together; 1.02 s apart (which is what `body_a`→`body_b` is) means the viewer finishes
  reading A before B exists and must compare from memory.
  **Rule: marks asserting equality must reach their final value within 0.12 s (4 frames).**
- The claim of **difference** is a sequence judgement — "and yet". 0.6–0.9 s apart is right.
  **Rule: marks asserting difference are separated by 0.6–0.9 s, never less than 0.4 s.**

So the correct staging for *this* shot is not "both" or "one then the other" — it is:

```
0.00  axis + gridlines
0.50  BOTH range marks land within 0.12 s of each other   ← the sameness
1.40  body A
2.10  body B                                              ← the difference, 0.7 s later
3.00  tie bar spanning both columns + ONE label "R = 4.20 · BOTH"
4.20  delta bracket over the difference + "3.92"          ← the point of the whole video
5.40  hold, nothing moving
6.50  out
```

Total 6.5–8 s, and nothing static for more than 1.6 s.

### 6.2 Alignment

The two columns already share `y = 0.598958` (baseline), top `0.359375`, and body width
`0.138889`. That part is right. What is not:

- Value labels sit at `y = 0.6333` — that is **0.034 of canvas below the axis and 0.075 above
  the card's bottom edge (0.7083)**. The card has 144 px of dead fill under its own labels.
  Either the card ends 0.03 below the last label, or the space carries something.
- The `=` in `val_a` and `val_b` are at different x (each label is centred on its own column,
  and `"TREND"` ≠ `"ROUND TRIP"` in width), so the two "same" numbers are not visually aligned.
  **Rule: in a comparison, the tokens that are equal must be at the same x.**

### 6.3 The difference must be drawn

Nothing in the composition says *these two R values are equal* and nothing says *these two
paths differ by 3.92*. Two identical strings `"R = 4.20"` placed 0.10 s apart read as a
duplication bug, not as a claim.

- **Tie bar** — the two gridlines `gl_high` / `gl_low` *are* the tie, and they are `#606070`
  on the card `#191922` = **2.83:1**. Below the 3:1 floor in bay's own `charts.md`, and far
  below what a load-bearing element needs. **A decorative rule needs 3:1; a rule that carries
  the argument needs 4.5:1.** `#9AA0AE` on `#191922` ≈ 6.1:1.
- **One label, not two.** One centred label on the tie bar: `R = 4.20 — BOTH`. One fact, one
  element.
- **Delta bracket** — a §4.7 bracket spanning only the difference between the two bodies, with
  `3.92` on it in the accent, landing on the narration beat, and **the only thing moving in
  that second.**

---

## 7. Why the card rendered empty

### 7.1 The cause: the reveal schedule, not a missing asset

`panel` is one shape, `start = 0`, `duration = 62 s`, `x 0.0444 / y 0.3333 / scaleX 0.9111 /
scaleY 0.375`, on `track-main`. It is on screen and unchanged for the entire video.

Every chart element for scene 3 is created with `start = 18.0` — the scene start — and then
held invisible by a keyframe:

| element | `start` | first key > 0 opacity/extent | dead time |
|---|---|---|---|
| `body_a` | 18.0 | opacity 20.15 → 20.37 | **2.15 s** |
| `wick_b` | 18.0 | opacity 21.08 → 21.35 | 3.08 s |
| `body_b` | 18.0 | opacity 21.12 → 21.39 | 3.12 s |
| `mid_v` | 18.0 | `scaleY` 29.40 → 29.95 | 11.40 s |
| `mid_top` | 18.0 | opacity 29.93 | 11.93 s |
| `cap_a`/`val_a` | 18.0 | 22.20 / 22.52 | 4.20 / 4.52 s |

The sample at **t = 19.0 s** lands in the 1.30 s window where the card is drawn, the gridlines
are drawn, and every mark is at `opacity = 0.000`. It is not a failed asset load and not a
layering bug. **It is an authored 1.3-second hole.**

The same pattern produces the other three windows (0.90–2.90, 45.50–47.20, 61.00–62.00).

This also explains why nothing caught it: `check` iterates elements, and *the elements are
there*. `inert-scene`, `nothing-visual`, `front-loaded` all evaluate presence, not visibility —
and on a one-scene project they evaluate it over a single 61-second bucket anyway.

### 7.2 A second, separate defect at the same boundary: text disappearing behind the card

Measured from the encoded frames, not from the model:

| t | `head3` model state | bright-pixel rows in the frame |
|---|---|---|
| 18.00 | `opacity 1.0`, `y 0.3359` → glyphs at rows 666–905 | **absent** (only `head2`, rows 367–571, is visible) |
| 18.90 | `y 0.2755` → glyphs 550–648 and 670–768 | rows **549–634 only**; line 2 entirely gone |
| 19.00 | `y 0.2162` → glyphs 436–534 and 556–655 | rows 436–534 and **556–634** — 19 rows of the `y` descender clipped |
| 24.00 | `y 0.1812` → glyphs 368–467 and 488–586 | rows 368–467 and 488–586, complete |

Everything below **row ≈ 636** is removed; the panel's top edge is row **640** (`0.3333 · 1920`)
with a ~3 px texture AA ramp. Two elements *on the same track* (`head2` at rows 367–571 and
`head3` at rows 666–905 at t = 18.0) behave differently, and the only thing separating them is
which side of row 640 they are on.

This is **not** explained by the code on `fix/pending-sweep`: `render_inner` builds items
`once(&tracks.main).chain(tracks.overlay.iter())` (`bay-preview/src/lib.rs:1655`, identical in
`HEAD`), the compositor blends `frame.items` in order (`compositor.rs:317`), and `panel` is on
`track-main` (layer 0, confirmed in the session log: `add_shape {"id":"panel","layer":0,…}`).
The gridlines on `track-overlay-1` *do* composite above the panel in the same frame. So the
observed behaviour contradicts the model in one direction and agrees with it in another.

**This needs a GPU test, not more reading.** Minimal repro: main-lane opaque rect at
`y 0.3333, scaleX 0.9111, scaleY 0.375, anchorY 0`; overlay-4 text at `y 0.34, anchorY 0,
scale 0.744, fontSize 60`, two lines; render at 1080×1920 and assert the glyph rows below 640
are non-background. (Do **not** run this against the live MCP session — the in-memory project
has already been mutated by another agent: `project_info`/`timeline` now report
`panel.animated = ["opacity","rotation"]`, a rotation channel that does not exist in the saved
JSON, and a snapshot at 18.5 s renders the panel 90° rotated. The saved JSON + the MP4 are the
only trustworthy record.)

Either way the **authoring** conclusion is identical and is the checkable one: a text element's
box overlapped a filled panel's box for 1.55 s, and nothing warned.

### 7.3 A live defect in `charts.md` itself

`charts.md` says a track "must measure ≥ 3:1 against the ground at **full opacity** (`#606070`
on `#0E0E12`)". Measured:

| colour | vs canvas `#0E0E12` | vs the card `#191922` |
|---|---|---|
| `#606070` (gridline highlight) | **3.12:1** ✓ | **2.83:1** ✗ |
| `#4A4A58` (axis) | 2.21:1 ✗ | 2.00:1 ✗ |
| `#33333F` (gridlines) | 1.55:1 ✗ | 1.40:1 ✗ |
| `#3A3A48` (tape ticks) | 1.72:1 ✗ | 1.56:1 ✗ |
| `#40404E` (leader dashes) | 1.89:1 ✗ | 1.71:1 ✗ |
| `#8A93A3` (candle bodies) | 6.22:1 ✓ | 5.64:1 ✓ |
| `#73737E` (captions) | 4.11:1 ✓ | 3.72:1 ✓ |

The skill's own example passes against the background and fails on the card. **The rule must
name the ground as "the element actually beneath", and the agent must compute it.** Every piece
of chart chrome in this video is between 1.40:1 and 2.83:1 against what it sits on — which is
the real reason the card looks like a failed asset load even in the frames where it *is*
inked: the only thing above 3:1 in it is the data marks themselves.

---

## 8. The rules, as checks — with how each is gamed

Ordered by how much of wicks-v2 they would have stopped.

| # | rule | how `check` computes it | how an agent games it, and what that video looks like | mitigation |
|---|---|---|---|---|
| C1 | **`empty-container`** — for any filled shape ≥ 5 % of canvas with `opacity ≥ 0.5`, at 10 Hz, the union area of visible marks with ≥ 3:1 contrast against that fill and centre inside it must be ≥ 4 % of the fill, for every sample. | sample the model; `sampled_transform` already exists; area = `scale·scaleX·W × scale·scaleY·H` clipped to the panel | put a big low-contrast decorative rect inside the card. → mitigated by the 3:1 contrast gate. Or: delete the card and put the marks on the background. **That is a fine outcome** — the card was never carrying information. | require ≥ 3:1 *and* require the mark to be a data-bearing kind (has an animated `scaleX`/`scaleY`, or is text) |
| C2 | **`dark-element`** — `first_visible_time − start > 0.6 s` on any element | per-element scan of `animations["opacity"]` / `scaleX` / `scaleY` | set `start` later and keep the same hole between scene start and first ink. → **this is the point**: the hole then becomes a scene-level gap that `inert-scene`/`gap` can already see | pair C2 with C3 |
| C3 | **`dead-air`** — no animated channel changes value anywhere for > 1.6 s while ≥ 1 visual element is on screen | sample all channels at 10 Hz, diff | add a slow drifting decoration. → produces the "one drifting rect" video. | require the moving channel to be on an element that is ≥ 2 % of the frame **and** ≥ 3:1 against its ground |
| C4 | **`value-overshoot`** — `back-out` (or any easing whose `apply` exceeds 1.0) on a channel of an element that also has a numeric text sibling within 0.15 of canvas | exact: `Easing::BackOut` is the only one; peak 1.10005 | switch to `spring-out` — which is **correct**, monotone, and looks better. This rule is un-gameable in a bad direction. | — |
| C5 | **`short-move`** — any move on a `scaleX`/`scaleY`/`x`/`y`/`rotation` channel shorter than 0.25 s | key-time diff | lengthen all moves to exactly 0.25 s. → a video where everything takes 8 frames. | require the *distribution*: p50 of move durations ≥ 0.35 s **and** ≤ 25 % of moves in any 0.1 s-wide bucket |
| C6 | **`chrome-contrast`** — every shape's colour vs the colour of the largest opaque element beneath its centre, ≥ 3:1 for decoration, ≥ 4.5:1 for anything whose extent is animated | resolve the stack from `items` order; both colours are literals in the model | raise every colour to 4.5:1. → a flat, high-contrast, tonally dead frame. | cap it: ≥ 4.5:1 for animated-extent shapes, and require ≥ 3 distinct luminance tiers among visible elements in any frame |
| C7 | **`label-collision`** — the bbox of a text element overlaps the bbox of an opaque (`opacity ≥ 0.9`) shape for > 0.3 s, unless the text is above it in item order **and** the renderer test in §7.2 passes | bboxes are computable for shapes exactly; text needs §9.4 | move text 1 px outside every panel. → the layout gets *better*. Un-gameable in a bad direction. | — |
| C8 | **`opacity-monoculture`** — share of animated channels that are `opacity` > 55 % | census, already trivial | add `x` channels of 0.001 to everything. → **must** be paired with a magnitude floor: a channel counts only if its value changes by ≥ 0.02 of canvas (`x`,`y`), ≥ 0.05 (`scale*`), ≥ 3° (`rotation`) | the magnitude floor is the whole rule |
| C9 | **`hero-figure`** — at least one text element per project whose content matches `[0-9]` and whose rendered cap height ≥ 16 % of canvas width | needs §9.4 text metrics; today approximable from `fontSize · H/1080 · scale` | set one number to 300 px and leave the rest at 34. → one big number is strictly better than none, and C10 covers the rest. | — |
| C10 | **`type-scale`** — the distinct rendered sizes of visible text in any 2 s window must span ≥ 3.0× | same | two sizes, 34 and 110, everywhere. → still better than 41 elements at 34 px. | require ≥ 3 tiers |
| C11 | **`formula-atom`** — a text element whose content matches `[A-Za-z0-9]\s*[=+−×÷/]\s*` and is never re-positioned or partially re-coloured over its life | regex + channel census | split the string into tokens and animate nothing. → C8/C3 catch the result. | pair with C8 |
| C12 | **`comparison-timing`** — two elements with equal `scaleY` (within 1 %) and the same `y`/`anchorY`, whose reveal times differ by 0.15–0.55 s | pure model arithmetic | offset them by 0.6 s. → that is the *difference* staging, which is also correct. Un-gameable in a bad direction. | — |

**C4, C7 and C12 are the three that cannot be gamed into a worse video** — every escape from
them is an improvement. Weight them highest. C1 and C3 are the two that would have caught the
actual failure. C8's magnitude floor is the fix for the round-1 Goodhart hole.

---

## 9. Engine gaps this area needs

| # | capability | effort | why it matters here | what it unlocks |
|---|---|---|---|---|
| 9.4 | **`text_measure(content, family, size, weight, letterSpacing, lineHeight) → {width, height, lines, baselines}`** | small | Every construction in §5 and §6 is currently guesswork. An agent cannot centre a label on a column, align two `=` signs, size an underline, or know whether a headline crosses a card edge. `bay-text` already computes all of it during raster. | §5 entirely; C7, C9, C10; label placement in `charts.md`; the collision check |
| 9.2 | **animatable mask** (`mask.x/y/width/height/feather` as keyframe channels; today `ANIMATABLE` is a fixed 7-element array and `Mask` is `Copy` with no channels) | small–medium | The masking pipeline (jump-flood SDF) is written, tested, and reachable — but only statically. | wipe reveals; a scrub read-head along a drawn series; progressive path draw; spotlight-on-one-term; the moving ring in §4.5 |
| 9.1 | **a `Line`/`Polyline` shape kind** (`points[]`, `width`, `cap`, plus a `dash` pair) | medium | §4.2–4.7 exist only as multi-element, multi-channel workarounds. A 12-point sparkline is 11 elements × 3 channels today. | line/area/sparkline/connector/arrow/leader/arc as first-class; and `draw progress 0→1` becomes **one** channel instead of three |
| 9.5 | **a numeric text element** — `value: f32` (animatable) + `format: "%.2f"` + `content` as a template | medium | Turns a count-up from 12 elements into 1 element and 1 channel, and lets the engine *enforce* H4 by clamping the channel to monotone. Today "never pass through a wrong value" is unenforceable. | §3a at 1/12 the cost; C4 extends to numbers |
| 9.6 | **`check` that samples the composited model** — per-region ink, per-element resolved ground colour, contrast, bbox overlap, dead-air | medium | §7 is invisible to every existing code because they all count elements. This is the difference between a lint and a quality gate. | C1, C3, C6, C7 — i.e. all four checks that would have caught this video |
| 9.3 | **rich text runs** — per-token colour/weight/size inside one `TextElement` | large | A highlighted word is a duplicate element; a two-colour formula is *n* elements. §5's shot is 22 elements for one equation. | §5 at 1/4 the element count; kinetic type generally |
| 9.7 | **rotation about the anchor** (or an explicit `pivot`) | small | Rotation is about the quad centre (`lib.rs:1832`), so a dial hand, a swinging connector, or a line drawing from one end all need 3 synchronised channels instead of 1. | §4.3 at 1 channel; needles and gauges at all |
| 9.8 | **group / parent transform** | large | A chart that must move as a unit moves *n* elements with *n* identical channels. This is why the card never moves in wicks-v2 — moving it means editing 30 elements. | camera moves on a chart; comparison shots that reframe |

Ranked by quality-per-unit-work for **this** area: **9.4 → 9.6 → 9.2 → 9.1 → 9.5 → 9.7 → 9.3 →
9.8.** 9.4 is small, unblocks the most craft, and is the prerequisite for three of the
un-gameable checks.

---

## 10. What to change in `charts.md` (concrete diffs)

1. Fix the contrast ground: `#606070` on `#0E0E12` is 3.12:1, but on the `#191922` card it is
   **2.83:1**. State "against the element actually beneath it" and give the two-tier floor
   (3:1 decoration / 4.5:1 load-bearing).
2. Add the reveal order (§1.1) and the reveal budget `0.45 + 0.07n`.
3. Add the 8-frame floor and the "settled ≥ 0.8 s before the clause ends" rule.
4. Replace "A count-up" (§charts.md) — it currently offers a scale-punch *or* one element per
   value with no guidance on count, spacing, or digit stability. Use §3.
5. Add §4 wholesale. `charts.md` currently says "bay has no chart primitive… bars, columns,
   gridlines, dot grids, progress tracks" and stops. It never mentions that `rotation` is
   animatable, that `Mask.inverted` exists, or that `radius: 0.5` gives round caps — which is
   why 188 elements contain zero rotations, zero masks, and no diagram of any kind.
6. Add §2 as an explicit trap list, with `back-out` peak = 1.10005 named.
7. Add §5 and §6 as their own recipes — the formula shot and the comparison shot are the two
   shapes a finance explainer is *made of*, and neither exists anywhere in the skill.
