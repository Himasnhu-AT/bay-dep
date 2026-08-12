# Composition and layout for 9:16 — the frame as a designed object

Round 2. Everything below is measured from `wicks-v2.mp4`, its project JSON, and the two
reference videos (`~/Downloads/1.mp4` = R1, `~/Downloads/2.mp4` = R2), by rasterising frames at
1 fps and by reading element geometry out of the project model. Scripts in
`/private/tmp/claude-501/…/scratchpad/{analyze,frames}*.py`. No number here is estimated.

The brief asked me to solve "one identical template for all 8 beats." The measurement says the
brief understates it. **There are not eight beats sharing a template. There is one composition,
occupying identical pixels, for 61 seconds.**

---

## 0. The indictment, in numbers

### 0.1 The frame never changes

Union bounding box of all visible ink, sampled every 2 s from t=2 to t=60 (31 samples):

```
(0.044, 0.067, 0.956, 0.773)   ← identical at all 31 samples, to 3 decimal places
```

Area-weighted ink centroid, every 4 s from t=4 to t=60 (15 samples):

| | mean | sd | range |
|---|---|---|---|
| centroid x | 0.487 | 0.005 | 0.016 |
| centroid y | 0.494 | 0.013 | 0.048 |

**The centre of visual mass moves less than 1.6 % of the frame height across 56 seconds.**

### 0.2 Rasterised, against the two references

Frames at 1 fps, ink = pixels ≥ 3.0:1 WCAG contrast against the modal ground colour.

| | R1 (good, locked) | R2 (good, varied) | **wicks-v2** |
|---|---:|---:|---:|
| legible ink %, median | 14.35 | **1.02** | 5.50 |
| legible blob count, median | 117 | 23 | 73 |
| anchor size √area, median | 0.240 | 0.057 | 0.138 |
| anchor size √area, **max** | 0.264 | **0.310** | **0.205** |
| anchor/median-blob size ratio | 23.5× | 4.4× | 9.4× |
| distinct compositions per minute (8×4 ink-grid, cos ≤ 0.85) | 3.1 | **22.1** | 6.9 |
| consecutive-second layout cosine, median | 0.988 | **0.743** | **0.996** |
| **seconds where < 0.5 % of pixels change** | 18 % | 16 % | **53 %** |
| churn concentration (grid cells holding 80 % of all change) | **2 / 32** | 8 / 32 | 13 / 32 |
| frames with ink touching a canvas edge | 0 % | 7 % | **0 %** |
| anchor horizontal position, modal share | 100 % centre | 46 % centre | 85 % left |
| anchor vertical band, modal share | 92 % top | 57 % lower-mid | 78 % upper-mid |
| ground | #0E0E12 flat | #FCF3F5 (a material) | #0E0E12 flat |

### 0.3 The single largest object in every frame is invisible

`panel`, id in the project, is a rect at `x 0.0444, y 0.3333, scaleX 0.911, scaleY 0.375`,
colour `#191922`, duration **62.0 s of a 61.0 s video**. That is **34.2 % of the canvas**,
present in 60 of 61 sampled frames, at a measured contrast of **1.10:1** against `#0E0E12`.

The skill's own contrast table (`layout.md:93–99`) lists `#16161C` at 1.07:1 as **"invisible"**.
The panel is one hundredth of a stop above that value and it is a third of the frame.

The gridlines inside it (`#33333F`) measure **1.55:1**. Twenty-five of forty-six shapes in the
project measure ≤ 2.21:1 — below the table's own "still too low" line:

| colour | n | contrast vs `#0E0E12` | verdict per the skill's own table |
|---|---:|---:|---|
| `#191922` | 1 (34 % of frame) | 1.10:1 | invisible |
| `#33333F` | 5 | 1.55:1 | invisible |
| `#3A3A48` | 14 | 1.72:1 | invisible |
| `#40404E` | 4 | 1.89:1 | too low |
| `#4A4A58` | 1 | 2.21:1 | too low |
| `#606070` | 2 | 3.12:1 | usable |
| `#8A93A3` | 5 | 6.22:1 | ok |
| `#FF5B5B` | 12 | 6.33:1 | ok |
| `#A8A8B0` | 2 | 8.16:1 | ok |

**54 % of the shapes in this video are below the visibility floor the skill itself publishes.**
This is why 119 elements produce a frame that reads empty. It is not sparseness. It is
*sub-threshold ink*.

### 0.4 The hero never changes size

Eight text elements exceed 50 px (1080-basis). There are eight beats. These are the beat heroes:

| t (s) | fontSize | on screen | family | y | content |
|---:|---:|---:|---|---:|---|
| 0.00 | 62 | 110 px | Baskerville | 0.181 | A day becomes / four numbers. |
| 8.40 | 56 | 100 px | Baskerville | 0.181 | High minus low. / Nothing more. |
| 8.40 | 58 | 103 px | Menlo | 0.479 | 4.20 |
| 18.00 | 60 | 107 px | Baskerville | 0.336 | Same range. / Different day. |
| 33.00 | 58 | 103 px | Menlo | 0.181 | W = R − \|r\| |
| 45.20 | 62 | 110 px | Baskerville | 0.181 | Squared, it's / a variance. |
| 45.20 | 96 | **171 px** | Menlo | 0.428 | W² |
| 54.60 | 52 | 93 px | Menlo | 0.401 | W = R − \|r\| |

- Hero scale ratio across the whole video, excluding the one 96 px glyph: **1.19×**.
- **No element in 61 seconds reaches 200 px on screen.** The maximum is 171 px, used once.
- Hero y is `0.181` in four of eight beats.

The whole type ladder is not a ladder:

| fontSize | n | share | on screen |
|---:|---:|---:|---:|
| 34 | 41 | **56.2 %** | 60 px |
| 26 | 11 | 15.1 % | 46 px |
| 30 | 4 | 5.5 % | 53 px |
| 38 | 4 | 5.5 % | 68 px |
| 24 | 3 | 4.1 % | 43 px |
| 22/52/56/58/60/62/96 | 1–2 each | 1.4–2.7 % | 39–171 px |

Adjacent-size ratios: 1.09, 1.08, 1.15, 1.13, 1.12, **1.37**, 1.08, 1.04, 1.03, 1.03, **1.55**.
Nine of eleven steps are under 1.16× — invisible as hierarchy. This is a *continuous* size
distribution, not a scale.

### 0.5 There are two placements, not nineteen

73 text elements, keyed by `(x, anchorX, align, boxWidth)`: 19 distinct combinations, of which

- `(0.080, 0.0, center, 0.84)` × **38** — the caption slot at y = 0.73
- `(0.089, 0.0, left, 0.744)` × **11** — the kicker/headline column

**49 of 73 text elements (67 %) sit in two placements.** All 38 caption elements are at
fontSize 34 and y = 0.730 = **1402 px**.

### 0.6 Nothing in the frame uses the frame

Across all 119 visual elements:

| property | value |
|---|---|
| `blendMode` other than `normal` | **0** |
| `effects` attached (blur / brightness / contrast / saturation / lut are all available) | **0** |
| `rotation ≠ 0` | **0** |
| `radius ≠ 0` on 46 rects | **0** |
| masks | 1 |
| elements whose bbox crosses a canvas edge | **0** |
| distinct box widths holding 51 of 73 text elements | 2 (0.84, 0.74) |

The composition uses one of bay's compositional primitives — the axis-aligned opaque rectangle —
and none of the others.

---

## 1. Grid systems for vertical video

### 1.1 Platform safe areas — and the honest state of the evidence

Published numbers disagree badly. Four sources, all for a 1080×1920 canvas, checked 2026-08-12:

| source | scope | TikTok top / bottom / right | IG Reels top / bottom / right | Shorts top / bottom / right |
|---|---|---|---|---|
| solidlabs.com, from platform ad templates | **paid** | 240 / 660 / 300 | 269 / 672 / 65 | 288 / 672 / 192 |
| adaptlypost.com | organic | 108 / 320 / 120 | 210 / 310 / 84 | 120 / 300 / 96 |
| kreatli.com | organic | 130 / 250 / 60 | 108 / 320 / 60 | — / ~250 / — |
| nemovideo / screensnap (via search) | organic | 130 / 484 / 140 | 220 / 430 / ~145 | — |

Spread on TikTok's bottom keep-out alone: **250 px to 660 px**. Anyone quoting a single figure
is guessing. Two things are stable across every source and worth treating as fact:

1. **The bottom of a 9:16 frame is UI on every platform.** The minimum credible figure is 250 px;
   the maximum is 672 px. Auto-captions (on by default across all three platforms as of 2026)
   add 80–300 px depending on string length, on top of the chrome.
2. **The right edge is an action rail on every platform.** 60–300 px.

**House numbers (union of the organic maxima, snapped to a 24 px baseline):**

| zone | px | fraction |
|---|---|---|
| top keep-out | 240 | 0 → 0.125 |
| bottom keep-out | 480 | 0.750 → 1.0 |
| right action rail | 144 | 0.867 → 1.0 |
| left margin | 72 | 0 → 0.067 |

**Content box (must-read): x ∈ [72, 936], y ∈ [240, 1440] — 864 × 1200 px = 45 % × 62.5 %.**

Everything outside that box is **material space**: ground, texture, bleed, a horizon, a value
shift. Never a word the viewer has to read. That distinction — *content space* vs *material
space* — is the single most useful thing on this page, and the current skill does not have it.

### 1.2 The bug in bay's current grid

`skills/bay/references/layout.md:19` reads:

```
1450│                         │  ← last element should sit around here
```

and `:30` reads "Leaving 900px of dead space at the bottom is a real defect — the last element
should sit around y≈1400–1450."

That is an instruction to place content **at the edge of, and on three of the four published
estimates inside, the platform caption band.** The agent obeyed it exactly: 38 elements, a third
of everything visual in the video, sit at y = 1402 px. Under the TikTok figure of 484 px the band
begins at 1436 and they are 34 px clear; under the 660 px ad figure the band begins at 1260 and
they are 142 px *inside* it. Under any figure, they are the lowest thing in the frame and they are
6 % of a frame height away from being covered by a username.

**Replacement:** `y = 1440` is a *floor*, not a target. The last legible glyph belongs no lower
than **1400 px**, and it should be there because the composition ends there, not because the grid
said to reach.

### 1.3 The column grid bay does not have

The present grid defines **one** content column (left gutter 96, width 804). A one-column grid
can only produce one-column layouts. That is, mechanically, why 63 of 119 elements share
x ≈ 0.085 — it is the only x the grid names.

**Six-column grid, 1080 wide:**

```
margin 72 │ 124 │24│ 124 │24│ 124 │24│ 124 │24│ 124 │24│ 124 │ rail 144
          c1        c2        c3        c4        c5        c6
```

| | px | fraction |
|---|---|---|
| column width | 124 | 0.1148 |
| gutter | 24 | 0.0222 |
| column left edges | 72, 220, 368, 516, 664, 812 | 0.0667, 0.2037, 0.3407, 0.4778, 0.6148, 0.7519 |
| 2-col span | 272 | 0.2519 |
| 3-col span (half) | 420 | 0.3889 |
| 4-col span | 568 | 0.5259 |
| 5-col span | 716 | 0.6630 |
| 6-col span (full content) | 864 | 0.8000 |

Six divides by 2 and 3, so it yields halves (3+3), thirds (2+2+2), and asymmetric 2+4 / 4+2
splits without a second grid. A text box is placed by `x = colLeft/1080`, `anchorX = 0`,
`scale = span/1080`.

**Baseline grid: 24 px** (80 baselines over 1920; 50 inside the content box). Every element's top
edge and every `fontSize` snaps to a multiple of 24. Type sizes on the baseline:
24 / 48 / 72 / 96 / 144 / 192 / 264 / 360 / 480 px on screen.

**Band ladder** — the content box divided into four 300 px bands, used to name where an anchor
sits:

| band | px | fraction |
|---|---|---|
| MAT-TOP (material only) | 0 – 240 | 0 – 0.125 |
| **A** | 240 – 540 | 0.125 – 0.281 |
| **B** | 540 – 840 | 0.281 – 0.438 |
| **C** | 840 – 1140 | 0.438 – 0.594 |
| **D** | 1140 – 1440 | 0.594 – 0.750 |
| MAT-BOT (material only) | 1440 – 1920 | 0.750 – 1.0 |

wicks-v2's beat heroes land in A ×4, B ×2, C ×2, **D ×0**.

### 1.4 Where the caption band must sit, and what must never be there

- **Burned-in captions:** baseline of the last line no lower than **y = 1380 px**; two lines
  maximum; cap-height ≥ 3.0 % of frame height (≈ 58 px) — R2's captions measure 3.1 %.
- **Never in the bottom 480 px:** the hero figure, the CTA, the logo, a chart's axis labels, the
  final word of the video.
- **Never in the right 144 px:** any glyph. A right-aligned number whose box ends at x = 936 is
  correct; one ending at x = 1010 will sit under a like button.
- **Never in the top 240 px:** the first word of a hook. It is under the "Following / For You"
  tab bar on TikTok and under the profile row on Reels.
- What *may* be in the keep-outs: ground colour, gradients, a bled shape, a horizon edge, a value
  falloff, texture, the tail of an object whose head is in the content box.

---

## 2. Composition variety — fifteen named layouts

Each layout is defined by a **descriptor** so that a claim about it can be *verified* rather than
trusted:

```
L(scene) = ( anchorBand, anchorScale, clusters, axis, bottomEdge )
```

- **anchor** — the element with the greatest (rendered area × contrast-vs-what-is-behind-it),
  counting only elements ≥ 3:1. This is the thing the eye actually lands on. A decoration cannot
  be an anchor; a 34 %-of-frame slab at 1.10:1 cannot be an anchor either.
- **anchorBand** ∈ {A, B, C, D} from the anchor's centre-y (§1.3).
- **anchorScale** ∈ {XS < 0.06, S 0.06–0.12, M 0.12–0.20, L 0.20–0.32, XL ≥ 0.32}, as √(area
  fraction). Reference maxima: R2 0.310, R1 0.264, wicks-v2 **0.205**.
- **clusters** — count of ink groups separated by ≥ 0.05 of frame height. R2 median 2; R1 2;
  wicks-v2 3 (kicker+headline / card / caption) in 28 of 60 frames and 2 in 30.
- **axis** ∈ {left, centre, right, split, diagonal, none} from the modal x-anchoring of the top
  three elements by contrast mass.
- **bottomEdge** ∈ {bleed, horizon, grounded, float} — see §7.

| # | Layout | descriptor | Use it when | What it does to the eye | What it costs | bay recipe |
|---|---|---|---|---|---|---|
| 1 | **FULL-TYPE** | XL / any band / 1 cluster / centre or left / bleed | The thesis, an act title, the punchline | No travel. A full stop. The frame *is* the word | ≤ 3 words or it wraps into a wall; burns a whole beat | `add_text` fontSize 200–320, `scale` 0.95, `letterSpacing` −0.03 |
| 2 | **HERO-NUM** | XL / B or C / 2 / centre / grounded | One number *is* the story | Number first, label second — the cleanest two-tier read there is | Only honest if the number is the point; else it reads as a stat slide | mono `fontSize` 200–320 + label 24–40 below, tabular figures |
| 3 | **THIRDS** | M–L / A or D / 2 / left or right / grounded | One real object plus a caption in the diagonal void | Travels along the diagonal; the void is charged, not idle | Needs an actual object; text alone at a thirds point reads as misalignment | anchor centre at (0.333 or 0.667, 0.333 or 0.667) |
| 4 | **LOCKUP** | S–M / B–C / 1 / centre / float | A logo, a definition, an epigraph, a hard stop | Dead centre, no travel; reads as a statement of fact | Static. Three in a row and you have a slideshow | symmetric margins; legible ink ≤ 4 %; hold ≤ 3 s |
| 5 | **SPLIT-H** | M–L / B or C / 2 / centre / horizon | Before/after, problem/solution, two series | The horizon reads first, then the heavier half | The boundary must measure ≥ 2:1 or it's two stacked blocks | full-width rect at y ∈ {0.38, 0.50, 0.62}, ≥ 2:1 against what's above |
| 6 | **SPLIT-V** | M / B–C / 2 / split / grounded | Comparison of two entities | Left first (reading order), then right; the gutter carries the argument | Each side is only 420 px wide — halves your type size | cols 1–3 vs 4–6, one anchor each |
| 7 | **BLEED** | L–XL / any / 1–2 / any / bleed | To make the frame a window on something larger | Implies continuation; destroys the "floating card" read | Whatever bleeds must be crop-safe. A bled *text box* is an error, not a style | element bbox crosses x<0 or x>1 or y>1 |
| 8 | **CORNER** | S / A or D / 2–3 / left or right / grounded | An aside, a source line, a running counter | Peripheral. This is where third-read material lives | Nothing anchored to a corner can be the first read | cluster in one quadrant; ≥ 55 % of the content box empty diagonally |
| 9 | **STACK** | S–M / spans A→D / 3–6 / left / grounded | A list, steps, an accumulating argument (R2's engine) | Top-to-bottom, sequential. Time carries the hierarchy | Needs ≥ 3 separate arrivals or it's a paragraph; rows must differ in size or it's a table | rows on the 24 px baseline, `animate_many` with `decay` 0.84 |
| 10 | **DIAG** | M / spans ≥ 2 bands / 3+ / diagonal / grounded | Motion, sequence, instability | Fast travel that exits the frame; the least restful layout | Axis-aligned boxes on a diagonal read as a staircase unless spacing decays | centres fit a line, slope 0.3–3.0, r² ≥ 0.9 |
| 11 | **INSET** | L / B–C / 2–3 / centre / grounded | A screenshot, a quote, a chart | The frame is a container — a second read. If the inside is dense it becomes the first | **This is wicks-v2's only layout.** It works *only* if the inset is dense and its own interior contrast is ≥ 3:1 | rect 25–55 % of frame, edge ≥ 2.5:1, content inside AND outside |
| 12 | **OVERLAP** | M–L / B–C / 2 / any / grounded | Depth, collage, a caption over an image | The occluding object reads as nearer, therefore first | Overlap without a value gap is a collision. bay has no text stroke — over an image this is unsafe | bboxes intersect ≥ 15 % of the smaller; value gap ≥ 3:1 or a blend mode |
| 13 | **VOID** | XS / any / **1** / centre / float | A beat of silence; punctuation between acts | Fixates on the one mark; the emptiness becomes pressure | Must last ≤ 2.5 s or it reads as a stall. A second element destroys it | one element ≥ 4.5:1, nothing else above 3:1, ≥ 85 % ground |
| 14 | **FIELD** | XL / n/a / 1–2 / any / bleed | A mood shift, a chapter break, footage | The field reads first as a colour event, then the type | bay has no gradients and no text stroke — captions over an image go illegible | full-frame image/video/rect ≥ 90 % coverage, type over it |
| 15 | **RAIL** | — | Chrome: a scale, a progress bar, a ticker | Peripheral; ignored after 2 s | **This is not a layout.** wicks-v2's tick strip was the only background element for 61 s | band ≤ 0.12 frame height pinned to an edge |

### 2.1 The rule this derives

> **Consecutive scenes must differ in at least two of the five descriptor fields.**

Not "must not share a layout name" — a name is a claim, and a claim is gameable. Two fields of a
computed descriptor is not.

Measured on wicks-v2, all eight beats compute to the same descriptor:

```
(anchorBand=A, anchorScale=S, clusters=3, axis=left, bottomEdge=none)
```

**0 of 5 fields change between every consecutive pair. Seven consecutive violations.**

Video-level companions:

- ≥ 3 distinct `anchorBand` values, none holding > 50 % of scenes.
- ≥ 3 distinct `anchorScale` buckets, none holding > 50 % of scenes.
- ≥ 2 distinct `axis` values.
- ≥ 1 scene with `bottomEdge = bleed` in any video ≥ 30 s.
- `LOCKUP`, `VOID` and `FULL-TYPE` may not appear in consecutive scenes (they are all "no travel"
  layouts; two in a row is a stall).

**How would an agent game it?** By translating the same template down one band. That flips
`anchorBand` — one field. It needs a second, and every second field costs a real decision: resize
the anchor (`anchorScale`), re-anchor the top three elements (`axis`), merge or split clusters,
or run something off an edge. The cheapest legal pair of changes still produces a visibly
different frame. That is the whole point of using a *computed* descriptor with orthogonal fields
instead of a declared name.

---

## 3. Scale variety across a video

### 3.1 What ours does

- Beat-hero fontSize: 52, 56, 58, 58, 60, 62, 62, 96. **Ratio excluding the single outlier:
  1.19×.** With it: 1.85×.
- Rasterised anchor √area: median 0.138, max **0.205** (4.2 % of the frame).
- 56.2 % of all text is at one size. The five most common sizes span 24–38 px — **1.58×**.
- The `panel` is the same 34.2 % of the canvas in 60 of 61 frames, sd = 0.

### 3.2 What the references do

| | R1 | R2 |
|---|---:|---:|
| anchor √area, p10 → p90 | 0.240 → 0.240 (**locked**) | 0.022 → 0.139 (**6.4×**) |
| anchor √area, max | 0.264 | **0.310** |
| anchor size buckets used | 1 (L) | 4 (XS 52 %, S 36 %, M 9 %, L 4 %) |
| anchor/median-blob size ratio | 23.5× | 4.4× |

R1 is the counter-example that keeps this honest: it never changes scale at all and it is good.
It gets away with it by being *dense* (14.4 % legible ink) with **80 % of all change confined to
2 of 32 grid cells** — one live window inside a locked architecture. See §5.

### 3.3 The targets

For a narrative/explainer piece of 30–90 s that is **not** a locked architecture:

| target | value | ours | R2 |
|---|---|---:|---:|
| anchor √area must reach at least once | **≥ 0.26** (6.8 % of frame) | 0.205 ✗ | 0.310 ✓ |
| anchor √area must drop below at least once | **≤ 0.07** | 0.050 ✓ | 0.022 ✓ |
| anchor √area p90/p10 across beats | **≥ 3.0×** | 4.05 (inflated by a blank frame) | 6.4 ✓ |
| beat-hero fontSize max/min | **≥ 3.0×** | **1.19× ✗** | n/a |
| modal fontSize share of all text | **≤ 45 %** | **56.2 % ✗** | n/a |
| adjacent type-tier ratio | **≥ 1.5×**, ≤ 4 tiers | 1.03–1.15 ✗ | n/a |
| at least one element on screen ≥ 200 px | required | **0 ✗** (max 171) | ✓ |

**Cadence, from R2:** in 57 s it goes to an anchor ≥ 0.20 √area four times (roughly once every
14 s), sits at XS/S for 86 % of its runtime, and reaches its maximum exactly once. The shape is
*mostly small, occasionally enormous, once maximal* — the opposite of our *always medium*.

---

## 4. The empty frame — confidence vs neglect, measured

This is the important section and the answer is not "intentionality."

**Emptiness is not the variable.** R2 — the reference we admire — is **five times emptier than
ours**: 1.02 % legible ink median against our 5.50 %. Its single best frame (t = 44 s, the
`Side.car` logo, alone, centred on blush) is ~96 % ground. Emptiness cannot be what is wrong with
our video, because more of it is what is right with theirs.

Three measurable differences, in descending effect size.

### 4.1 A void is a decision that gets re-made; ours is a constant

| | R1 | R2 | wicks-v2 |
|---|---:|---:|---:|
| distinct compositions per minute | 3.1 | **22.1** | 6.9 |
| consecutive-second layout cosine, median | 0.988 | **0.743** | **0.996** |
| **seconds where < 0.5 % of pixels change** | 18 % | 16 % | **53 %** |
| vertical mass-span sd across the video | 0.011 | **0.185** | 0.055 |
| ink-mass y95 travel, range | 0.042 | **0.383** | 0.179 |

R2 re-decides its composition every 2.7 s. Its content region changes *shape* — sometimes a tall
stack reaching y = 0.95, sometimes a 6 % mark at dead centre (mass-span sd 0.185, 3.4× ours).
Ours re-decides every 8.7 s and is **pixel-frozen for 53 % of its runtime.**

A held void reads as confidence for about two seconds. Past that, held-ness is the whole message,
and the message is "nothing is happening."

### 4.2 A void surrounds something worth looking at; ours surrounds nothing

- R2's anchor reaches **9.6 %** of the frame at ≥ 3:1 (√area 0.310).
- R1's reaches 7.0 % and holds it, permanently, at the centre of a locked frame.
- **Ours peaks at 4.2 %** — and the single largest *object* in our frame, 34.2 % of it, measures
  **1.10:1**.

So the honest description of our frame is not "negative space around a subject." It is **a large
invisible object with small text stacked on top of it.** The emptiness is not around anything.
That is the difference, and it is a contrast measurement, not a taste judgment.

R2's marks, by contrast, are *closed high-contrast shapes*: median blob 1.3 % of frame at 23
blobs, versus our 73 blobs (individual 34 px Menlo glyphs) whose median is 1.5 % but whose anchor
is only 9.4× the median. R2's anchor is 4.4× its median because R2's marks are all substantial;
R1's is 23.5× because R1 has one dominant window over fine UI texture. Ours is 9.4× — in between,
committed to neither.

### 4.3 A void has an edge condition; ours has a residue

R2's contrast mass runs y = 0.115 → 0.881; ink touches a canvas edge in 7 % of frames; 57 % of
its anchors sit at y > 0.5. Its composition is bounded by the canvas.

Ours runs y = 0.067 → 0.776 and **not one of 119 elements crosses any canvas edge in 61 seconds.**
The composition is a 1362 px lockup placed at the top of a 1920 px frame. The 430 px underneath
it is not negative space; it is the remainder of a division. Same remainder, same place, every
beat.

**Test for the difference:** if you removed the frame and re-cropped tight to the ink, would the
composition change? For R2's centred logo: yes, catastrophically — the isolation *is* the design.
For R1: yes — the three-zone architecture is the design. For wicks-v2: **no.** Crop to
`(0.044, 0.067, 0.956, 0.776)` and you lose nothing, because nothing in the composition refers to
the frame. That is the operational definition of neglect: **negative space that carries no
information about the object it surrounds.**

### 4.4 The finding underneath all three

wicks-v2 is not at an extreme on any axis. It is in the middle of every one:

| axis | committed pole A | committed pole B | wicks-v2 |
|---|---|---|---|
| density | R1: 14.4 % ink, dense | R2: 1.0 % ink, sparse | **5.5 %** |
| composition rate | R1: 1 layout / 39 s, locked | R2: 22 / min, restless | **6.9 / min** |
| anchor commitment (x) | R1: 100 % centre | R2: 46/29/25 spread | **85 % left** |
| anchor commitment (band) | R1: 92 % top | R2: 39/57/4 spread | **78 % upper-mid** |
| change locality | R1: 2/32 cells hold 80 % | R2: 8/32 | **13/32** |
| anchor scale | R1: 1.0× range, locked | R2: 6.4× range | **4.05×** |

Both references are *committed*: one to a fixed architecture with a single live window, the other
to a restless accumulating canvas. Ours is a template with jitter. **The defect is not a wrong
choice; it is the absence of a choice**, and the reason a diversity counter cannot detect it is
that the middle of a distribution scores *fine* on every diversity metric ever written.

### 4.5 The rule

> **A video must declare a composition regime and satisfy it. The band between the two regimes is
> a failure.**
>
> **Regime LOCKED** (R1): all scenes share one descriptor. Then it must also hold
> legible ink ≥ 12 %, ≥ 80 % of frame-to-frame change confined to ≤ 4 of 32 grid cells,
> anchor contrast-mass share ≥ 55 %, and < 25 % of seconds with pixel churn under 0.5 %.
>
> **Regime COMPOSED** (R2): ≥ 1 distinct composition per 4 s of runtime, consecutive-scene
> descriptor distance ≥ 2 fields, anchor √area range ≥ 3×, and ≥ 1 anchor at √area ≥ 0.26.
>
> Everything in between — which is where wicks-v2 lives on all six axes — is rejected.

**How would an agent game this?** It cannot satisfy both regimes at once; they pull in opposite
directions (LOCKED demands density and stillness, COMPOSED demands change and scale range).
Moving toward either pole from the middle is a real, visible design commitment. A bimodal
constraint is structurally harder to Goodhart than a threshold, because there is no direction of
cheap monotone improvement.

---

## 5. Focal hierarchy

### 5.1 What we measured

| | R1 | R2 | wicks-v2 |
|---|---:|---:|---:|
| anchor share of total contrast mass | **60.0 %** | 40.2 % | 41.6 % |
| mass₁ / mass₂ (first read vs second), median | 2.90 | 2.37 | 5.26 |
| anchor / median-blob size | 23.5× | 4.4× | 9.4× |
| **change concentration** (cells holding 80 % of change) | **2 / 32** | 8 / 32 | 13 / 32 |

Note that wicks-v2's *static* dominance ratio is the highest of the three (5.26). Its hierarchy
does not fail because the first read is weak. It fails on the other two reads and on time.

### 5.2 The three reads, and what breaks each

| read | should be | built from | ours | what broke it |
|---|---|---|---|---|
| **1st** (0–0.4 s) | the one thing | scale ≥ 2× the next tier, contrast ≥ 8:1, and *arrival order* — whatever moves first reads as most important | 110 px Baskerville headline | Nothing. It works. |
| **2nd** (0.4–1.5 s) | the evidence | 1.5–2.5× the third tier, distinct in *kind* (a number, a shape, an image — not more of the same face) | the card | **1.10:1.** Invisible. There is no second read; the eye falls straight to the caption. |
| **3rd** (scan) | the frame's furniture | ≤ 0.6× the second tier, low contrast, edge-anchored | 38 caption elements at the *same* 34 px as 41 other elements | The third tier and half the second tier are the same size. A plateau, not a staircase. |

**The measurable form:** contrast mass of the top three ink clusters must form a staircase —
`m₁/m₂ ≥ 1.8` **and** `m₂/m₃ ≥ 1.4`. Equivalently, from the project model with no rasteriser:
rendered cap-heights of the top three tiers must satisfy the same ratios, and no size tier may
hold more than 45 % of text elements.

### 5.3 Time is the hierarchy that overrides layout

R1's three zones never move, and its hierarchy is perfectly legible, because 80 % of all change
happens in 2 of 32 cells. **Where the change is, is the first read.** Our change is spread over
13 of 32 cells — every zone twitching a little — which is the visual equivalent of everyone in a
room talking at the same volume.

> **Rule:** in any 2-second window, ≥ 60 % of the frame's total pixel change must occur inside
> the bounding box of one element (or one declared cluster). Diffuse change is not motion; it is
> noise, and it destroys the first read regardless of layout.

This is also the check that separates the two legitimate regimes: LOCKED needs ≤ 4 cells,
COMPOSED tolerates 8, and 13 is neither.

---

## 6. Depth without 3D — what bay can do today

Available primitives: `add_shape` (rect with `radius`, ellipse), `add_text`, `add_image`,
`add_video`, `blend_set` (**17 modes**), `effect_add` (**brightness, contrast, saturation, blur,
lut**), `mask_set` (ellipse/rect, `feather`, `inverted`), `crop_set`, `transform_set`
(x, y, scale, scaleX, scaleY, rotation, opacity, anchorX/Y), layer ordering, `looks_list` (LUT
grades). `animate` covers opacity, scale, x, y, rotation, scaleX, scaleY only.

| depth cue | available? | how, in bay | used in wicks-v2 |
|---|---|---|---|
| **Occlusion / overlap** | yes, free | layer order; require ≥ 15 % bbox intersection and a ≥ 3:1 value gap across the boundary | 0 deliberate overlaps (1 accidental collision at t = 19 s) |
| **Scale contrast** | yes, free | anchor √area ≥ 3× the second tier's | 9.4× vs median but only 4.2 % of frame |
| **Atmospheric value shift** | yes | background layers at 1.6–2.5:1 against ground, midground 4–6:1, foreground ≥ 10:1 | **inverted** — the 34 % background slab is at 1.10:1 with nothing in front of it |
| **Blur as depth** | **yes** — `effect_add type:"blur"` | 12–24 px on a background layer, 0 on the anchor. Costs one call | **0 effects on 119 elements** |
| **Drop shadow** | no primitive; fakeable | duplicate the shape, offset +10 / +14 px, colour = ground, opacity 0.35, blur 16, one layer below. 2 extra elements per object | 0 |
| **Glow / bloom** | no primitive; fakeable | duplicate, blur 24, `blend_set "plus-lighter"` or `"screen"`, opacity 0.4 | 0 (`blendMode` is `normal` on all 119) |
| **Vignette** | yes | full-frame rect, ground colour, `mask_set shape:"ellipse" inverted:true feather:280` | 0 |
| **Spotlight / falloff** | yes | same mask, not inverted, on a lighter rect with `blend_set "screen"` | 0 |
| **Parallax** | yes | animate background `x`/`y` at 0.25–0.40× the foreground's travel over the same window | 0 |
| **Ken Burns on stills** | yes | `scale` 1.00 → 1.04 over the beat, `sine-in-out` | no images in the project |
| **Perspective tilt** | partial | `rotation` + `scaleX` shear-substitute; no real 3D transform | 0 rotations |
| **Gradient ground** | **no** | fake with 6–10 stacked rects at stepped alpha (ugly banding), or an imported PNG | 0 |
| **Grain / texture** | **no** | imported PNG at 4–8 % opacity, `blend_set "overlay"` | 0 |
| **Text stroke / shadow** | **no** | fake by duplicating the text in ground colour behind at 1.02 scale — poor. Real gap for captions over imagery | 0 |
| **Animated blur / focus pull** | **no** — effect params are not keyframable | crossfade two copies, one blurred | 0 |

**Six of these are one tool call and cost nothing, and the video used none of them.** The
strongest single move available today: **blur 16 px on the `panel`, raise it to 2.4:1, and give
the headline 12:1.** That alone converts a flat stack into a foreground and a ground.

---

## 7. The dead-zone problem — the rule, and why a decorative dump cannot satisfy it

### 7.1 The measurement corrects the premise

The brief says "our bottom 40 % is empty in every frame." Measured, it is:

- y ∈ [0.630, 0.730] — 1210 → 1402 px, **192 px empty**, between the card's bottom and the
  caption line
- y ∈ [0.776, 1.000] — 1490 → 1920 px, **430 px empty**, below everything

and the 430 px band **is the platform caption band** (§1.1). Content does not belong there. The
correct fix for the bottom 480 px is not to fill it with content; it is to make it *material*.

The actual defect is that **both empty regions are in the same rows in all eight beats.** The
skeleton is the problem; the dead zone is its shadow.

### 7.2 The rule

> **R-BOTTOM-EDGE.** Every scene must satisfy exactly one of four bottom-edge conditions,
> verified geometrically from the model, and no condition may be used by more than 40 % of a
> video's scenes:
>
> | condition | geometric test |
> |---|---|
> | `bleed` | an element with rendered area ≥ 4 % of frame and contrast ≥ 2:1 has bbox bottom > 1.0 (crosses the canvas edge) |
> | `horizon` | an element ≥ 85 % of canvas width, contrast ≥ 2:1 against the pixels *above* its edge, has that edge at y ∈ [1200, 1560] |
> | `grounded` | the **anchor's** bbox bottom ≥ 1140 px (the anchor itself reaches band D) |
> | `float` | anchor bbox centre-y ∈ [0.42, 0.58] **and** legible-mass p5/p95 margins within 1.43× of each other **and** legible ink ≤ 4 % **and** scene duration ≤ 3.0 s |
>
> `float` may not be used in consecutive scenes.

### 7.3 Why the decorative dump fails

Place a decorative dot at y = 0.90 and check each condition:

- `bleed` — its bbox does not cross y = 1.0, and it is not ≥ 4 % of the frame. Fails.
- `horizon` — it is not ≥ 85 % of the canvas width, and it has no edge that separates two regions.
  Fails.
- `grounded` — it is not the anchor. To become the anchor it would have to exceed the headline in
  (area × contrast), at which point it is the largest, highest-contrast thing in the frame and is
  no longer decorative. Fails.
- `float` — adding it makes the composition asymmetric and pushes legible ink and cluster count
  the wrong way. Fails.

The escape route with the lowest effort is `horizon`: a full-width rule at y = 1400 at 2:1. That
*is* a real compositional move (it terminates the composition and gives the void an edge), it is
what a designer would actually do, and the 40 % cap stops it becoming the only move.

Measured on wicks-v2: **0 elements cross any canvas edge; no full-width element sits in
y ∈ [1200, 1560] (the taperule is at y = 0.119, the gridlines at 0.396–0.583); the anchor's bbox
bottom is ≈ 0.30 in six of eight beats; no beat is a centred lockup.** All eight scenes fail all
four conditions. No marginal calls.

### 7.4 The companion rule that stops the whole class of defect

> **R-NO-GHOST-SLAB.** Any element whose rendered area is ≥ 8 % of the canvas must measure
> ≥ 2.0:1 against the composited pixels beneath it, **or** be declared `role: "ground"` — and a
> scene may have at most one ground element.

wicks-v2: `panel` at 34.2 % and 1.10:1 → error. `grid1–4` and `taperule` are thin, so they clear
the area threshold, but a companion **R-STRUCTURE-CONTRAST** (any element intended as structure —
rule, axis, gridline, track — must measure ≥ 3.0:1, per the skill's own table) catches those:
25 of 46 shapes are below 2.21:1.

This one rule would have changed the video more than any other on this page. It cannot be gamed:
the only way to satisfy it is to make the big thing visible, and once the 34 % slab is visible the
composition is a different composition.

---

## 8. The rule set, consolidated

| id | rule | threshold | measured on wicks-v2 | how `check` computes it | how an agent would game it, and why it can't |
|---|---|---|---|---|---|
| **C1** | No ghost slab | element ≥ 8 % of canvas must be ≥ 2.0:1 vs what's beneath | `panel` 34.2 % @ **1.10:1** | model: bbox area + colour vs z-ordered colours beneath | making it visible *is* the fix |
| **C2** | Structure contrast | rules/axes/tracks ≥ 3.0:1 | 25 of 46 shapes ≤ 2.21:1 | model, per-element | same |
| **C3** | Consecutive-descriptor distance | ≥ 2 of 5 fields differ | **0 of 5**, ×7 pairs | model → descriptor (§2) | each field costs an independent design act |
| **C4** | Anchor band coverage | ≥ 3 of 4 bands, none > 50 % of scenes | A×4 B×2 C×2 **D×0** | model: anchor centre-y | requires moving the biggest legible thing |
| **C5** | Anchor scale reach | ≥ 1 scene at √area ≥ 0.26 | **max 0.205** | model or frame | requires an actual hero element |
| **C6** | Hero type range | max/min beat-hero fontSize ≥ 3.0× | **1.19×** | model, trivially | a giant decorative glyph would satisfy it — pair with C5 (must be the anchor) |
| **C7** | Type ladder | ≤ 4 tiers, adjacent ratio ≥ 1.5×, modal tier ≤ 45 % | 12 sizes, ratios 1.03–1.15, modal **56.2 %** | model | consolidating sizes *is* the fix |
| **C8** | On-screen hero floor | ≥ 1 element ≥ 200 px rendered | **max 171 px, once** | model (`rendered_font_px` exists) | one big word satisfies it; that is the intended behaviour |
| **C9** | Bottom-edge condition | one of 4, none > 40 % of scenes | **0 of 4 in all 8 scenes** | model | see §7.3 |
| **C10** | Safe area | no glyph in y > 1440, y < 240, x > 936 | 38 elements at y = 1402 (28 px clear) | model | moving text up is the fix |
| **C11** | Placement diversity | modal (x, anchor, align, boxWidth) ≤ 40 % of text | **52 %** in one combo | model | forces more than one column |
| **C12** | Regime commitment | LOCKED or COMPOSED, not between (§4.5) | **between, on all 6 axes** | needs frames or a model rasteriser | bimodal — no cheap monotone direction |
| **C13** | Change locality | ≥ 60 % of 2 s change inside one element bbox | 13 / 32 cells hold 80 % | needs frames | concentrating motion is the fix |
| **C14** | Frame-referring composition | ≥ 1 element crossing a canvas edge per 30 s | **0 in 61 s** | model: bbox vs [0,1] | a bled background rect would satisfy it — require area ≥ 4 % *and* ≥ 2:1 |

**Severity note.** C1, C2, C3, C9 are the four that, applied to this project, force a different
video. C5–C8 are necessary but individually gameable; they only bite in combination with C3/C4.
C12/C13 are the deep ones and need frames.

---

## 9. What the engine and the check suite are missing

The blocking gap is not rendering. It is that **`check` cannot see a frame.** `check.rs:16` says
so in its own header: *"it cannot see that a frame came out black, only that nothing was
[placed]."* Ten of the fourteen rules above are computable from the model alone; the four that
matter most (C1's "vs what's beneath", C12, C13, and any honest contrast measurement) are not.

The fix is *not* a GPU dependency. It is a **model-level rasteriser** — a deterministic
`FrameSketch` at 108×192 that composites element rectangles with their colours in z-order and
approximates text as a fill-factor-weighted box using `bay-text`'s metrics (`check.rs` already has
`rendered_font_px`). That single component makes contrast-vs-background, ink mass, anchor
identification, layout signatures, band occupancy, cluster counting and frame-to-frame change all
computable in `bay-core`, with no GPU, no ffmpeg, and no flakiness.

Second gap, in order: **no gradient primitive and no text stroke/shadow.** Both references get
away with flat grounds because R2's ground is a *colour with hue* (#FCF3F5) and R1's is genuinely
black behind real screen capture. A flat #0E0E12 with no gradient, no vignette and no texture is
the third-most-cited cause of "AI-made" in the round-1 corpus, and bay can currently only fake it
with stacked rects.

Third: **effect parameters are not keyframable.** A focus pull, a blur-in, a value ramp — all
unavailable. `animate` takes seven transform channels and volume, and nothing else.
