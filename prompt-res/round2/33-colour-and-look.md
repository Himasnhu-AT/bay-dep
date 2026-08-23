# 33 — Colour, look, texture, grade

**Round 2. Every number below is measured on this machine, 2026-08-12.** Frames pulled at full
resolution with ffmpeg, analysed with numpy; project numbers read from the JSON. Sources:
`~/Desktop/wicks-v2.mp4`, `~/Downloads/1.mp4` (R1), `~/Downloads/2.mp4` (R2),
`~/Desktop/local-first.mp4` (O2), `~/Desktop/candlestick-wicks.mp4` (O3), and
`~/Library/Application Support/vii/projects/project-1786466680050.json`.
Scripts kept at `/private/tmp/claude-501/.../scratchpad/look{,2,3,4}.py`.

---

## 0. The headline

**wicks-v2 spends 34.17% of the canvas on one shape at 1.10:1 contrast, and 0.57% of the canvas
on its only chromatic colour at a contrast that reads.** That is the whole colour story. It is
not "too few colours" — the project contains twelve. It is that eleven of the twelve are dark
greys, and the one saturated colour was placed at `opacity: 0.28`, which composites to exactly
**1.50:1** against the ground.

And the second finding, which matters more for round 3:

> **`layout.md:77-87` ships one palette, as seven hex values, under the heading "A dark editorial
> palette that works". wicks-v2 uses all seven of them and invents nothing but four more dark
> greys — one of which, `#4A4A58`, appears in the skill *only* as a worked example of a colour
> that is too low-contrast to use.** Round 1 found this exact failure in motion
> (`recipes.md:32`, "Every text reveal in a good reel is this") and fixed it. Nobody looked at
> colour. The agent is not choosing badly; it is **copying**.

Third, and this is the one that will cost round 3 a video if it is ignored:

> **Both reference videos have flatter grounds than ours.** R2 is 79–97% one colour (`#FCF3F5`),
> R1 is 51–62% pure `#000000`, and neither carries grain, vignette, bloom or a gradient. A rule
> that says "the background must not be flat" would fail both references and pass a gamed video
> with a purple radial glow behind monospace type. **The ground is not the defect. The ink is.**

---

## 1. What the frames actually measure

Ten frames per video, evenly spaced, full resolution. "Ground" = the modal 8-bit colour of the
frame. "Ink" = pixels whose WCAG contrast ratio against the ground is ≥ 1.5:1. "Dead ink" =
pixels between 1.02:1 and 1.5:1 — marks that were drawn and cannot be seen.

| metric | **wicks-v2** | R1 palmier | R2 doodle | O2 local-first | O3 wicks-v1 |
|---|---|---|---|---|---|
| ground | `#0C0C11` (9/10) | `#000000` (10/10) | `#FCF3F5` (10/10) | 3 grounds, one per act | `#0C0C11` |
| ground share of frame | 30–33% | 51–62% | 79–97% | 89–94% | — |
| ink % of frame | 1.8–12.1 (med 5.5) | **12.5–17.7** | 1.6–12.0 | 4.5–6.9 | 1.7–6.2 |
| **dead ink % of frame** | **24.6–63.3 (med 30)** | 24.7–31.1 | **0.8–1.9** | 0.6–1.0 | 0.3–2.4 |
| ink value steps (of 12) | 2–5 (med 4) | **12/12, every frame** | 2–9 (med 5) | 2–3 | 1–5 |
| **hue families ≥0.1% of frame** | **0 in 8 of 10 frames** | 3–5 | 0–4 (med 2) | 1–2 | 0–3 |
| bright mass (CR ≥ 12:1) | 1.29% mean, **0.00% min** | 5.68% | 1.40% | 4.32% | 0.91% |
| luma p5→p95 span | 0.223 | **0.965** | 0.105 (light ground) | 0.397 | — |
| ground noise σ (8-bit) | 0.62–0.67 | 0.43–0.66 | 0.22–1.19 | 0.51–0.57 | — |
| frame-to-frame Δ (mid-video) | **0.000** | 0.176 | 0.269 | 0.000 | — |

Read it this way:

- **Nobody has grain.** σ ≤ 1.2/255 everywhere, ours included. Grain is not what separates the
  references from us. See §5.
- **wicks-v2 is achromatic.** Zero hue families covering ≥0.1% of the frame in 8 of 10 samples.
  It is, functionally, a greyscale video with three red dots in it.
- **R1's discriminator is the value ladder**: 12 of 12 contrast steps populated in every single
  frame, and 5.68% of the frame above 12:1. It is a screen recording, so the ladder is free —
  which is exactly teardown finding #6 restated in luminance terms: *the references are made of
  stuff, and stuff has a histogram*.
- **R2's discriminator is hue**, not value. Its ground is a single flat blush; its ink is
  `#359049` green (3.68:1), `#18438D` blue (8.66:1), `#112153` navy (14.11:1), `#595052` grey
  (7.16:1). Two to four hue families per frame, on a ground it never changes in 57 seconds.
- **Dead ink is uniquely ours.** R2 0.8–1.9%, O2 0.6–1.0%, O3 0.3–2.4% — wicks-v2 24.6–63.3%.
  R1 is also ~29%, but R1's dead mass is the dark chrome of a real application window that
  *contains* the 5.68% bright mass. Ours is decoration with nothing in it.

### The project model says the same thing, exactly, without rendering anything

Twelve colours. Contrast against the ground `#0E0E12`:

| hex | uses | CR vs ground | verdict |
|---|---:|---:|---|
| `#EDECE6` | 48 text | 16.27 | fine |
| `#A8A8B0` | 3 | 8.16 | fine |
| `#FF5B5B` | 15 | 6.33 | fine *as authored* |
| `#8A93A3` | 7 | 6.22 | fine |
| `#73737E` | 19 | 4.11 | fine |
| `#606070` | 2 | 3.12 | chart track floor |
| `#4A4A58` | 1 | 2.21 | **skill lists this exact value as "still too low"** |
| `#40404E` | 4 | 1.89 | invisible |
| `#3A3A48` | 14 | 1.72 | invisible |
| `#33333F` | 5 | 1.55 | invisible |
| `#191922` | 1 | **1.10** | invisible — and it is **34.17% of the canvas** |

Area, at each shape's peak animated opacity, composited against the ground:

| area % of canvas | colour | peak opacity | composited CR | element |
|---:|---|---:|---:|---|
| **34.167** | `#191922` | 1.00 | **1.10** | `panel` |
| **8.875** | `#FF5B5B` | **0.28** | **1.50** | `sq` |
| 3.328 | `#8A93A3` | 1.00 | 6.22 | `body_a` |
| 1.776 | `#8A93A3` | 1.00 | 6.22 | `body1` |
| 0.104 | `#FF5B5B` | 1.00 | 6.33 | `awick_up` |
| 0.103 | `#FF5B5B` | 1.00 | 6.33 | `awick_dn` |

- Accent area at peak: **9.45% of canvas**. Accent area at a contrast that reads (≥3:1):
  **0.57%**. The "colour moment" of the video is an 8.875% square at 28% opacity that measures
  1.50:1 — confirmed in the render: at t=49.6 s the frame contains `#582A30` over 4.38% of its
  pixels at **1.66:1**.
- `layout.md:101` says, in prose: *"Opacity defeats the measurement. `#606070` at 28% alpha
  composites back to ~1.3:1."* The agent read that sentence and then did it, with the accent,
  at the same 28%.
- **`effects: {}`** — zero effects across 188 elements. `looks_list` / `effect_add` / `lut` were
  never called. **`blendMode: normal` ×119 of 119.** **1 mask.** **0 images, 0 video.** Every
  colour capability the engine has was left switched off.

---

## 2. Palette construction

### Roles, not colours

A palette is six *roles*. Any piece that names fewer than five of them will look under-designed,
and any piece that invents colours per element will look incoherent.

| role | job | how much of the frame | contrast floor vs ground |
|---|---|---|---|
| **ground** | the bed; never changes within an act | 55–90% | — |
| **surface** | plates, cards, panels that must read as *raised* | 5–25% | **≥1.6:1**, ideally 2.0–2.6:1 |
| **ink** | headlines, hero numbers | 2–6% | ≥12:1 |
| **muted ink** | kickers, axis labels, units, captions | 1–4% | 4.5–7:1 |
| **accent** | the point. Scarce. One per scene | 0.5–4% | ≥4.5:1 **at final composited opacity** |
| **alert / second series** | the opposition to the accent | ≤2% | ≥3:1, **and ≥3:1 against the accent itself** |

The 60/30/10 rule (60% dominant, 30% secondary, 10% accent) is an interior-design heuristic that
transfers to video only if you read it as *area on the frame*, not as *number of colours*. Its
critics are right that it is arbitrary; its useful residue is the **ordering** — dominant ≫
secondary ≫ accent, with a factor of ~2–6 between each. wicks-v2 satisfies 60/30/10 numerically
(ground 31%, panel 34%, accent 9%) and looks like nothing, because all three tiers landed within
0.5 stops of each other. **Ratio without value separation is not a palette.**

The rule that actually bites: **each named role must sit at a different rung of the contrast
ladder, and the ladder must span ≥ 12:1 end to end.** Measured against `#0E0E12`, the neutral
rungs are:

| target CR | first neutral that clears it |
|---:|---|
| 1.5:1 | `#323236` |
| 2.0:1 | `#454549` |
| 3.0:1 | `#5F5F63` |
| 4.5:1 | `#7A7A7E` |
| 7.0:1 | `#9C9CA0` |

wicks-v2's five invented greys (`#191922`, `#33333F`, `#3A3A48`, `#40404E`, `#4A4A58`) occupy
1.10 / 1.55 / 1.72 / 1.89 / 2.21 — **five rungs crammed into less than one stop, all of them
below the second rung.** That is the "five colours" problem: they are one colour, sampled five
times.

### Deriving rather than copying

Pick a hue `H` from the subject, then set lightness rungs in OKLCH and let chroma fall with
lightness:

```
ground   L 0.14  C 0.012  H       (a tinted black — never L 0)
surface  L 0.22  C 0.016  H       (≈2:1 above ground)
muted    L 0.55  C 0.022  H       (≈4.5:1)
ink      L 0.94  C 0.010  H+20    (≈15:1, warmed a touch off the ground hue)
accent   L 0.62  C 0.16   H+180±40
alert    L 0.68  C 0.15   H+90
```

The point of deriving is that **the values differ per subject**, so two videos made a week apart
do not share a palette. That is the whole anti-slop mechanism. A skill that hands over one table
of hexes guarantees they will.

### Eight complete palettes, each anchored to a tradition

All contrast ratios measured, not asserted. `n steps` = distinct relative-luminance rungs.

| # | tradition | ground | surface | ink | muted | accent | second / alert | mood | type pairing (macOS) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Swiss / International Typographic** | `#F2F1ED` | `#FFFFFF` (1.13) | `#111111` (16.71) | `#6E6E68` (4.54) | `#D6301F` (4.32) | `#111111` | objective, systematic, no persuasion | Helvetica Neue 45/75 only, tight tracking, flush-left rag-right |
| 2 | **Editorial / magazine** | `#FAF6EF` | `#FFFFFF` (1.08) | `#1A1714` (16.57) | `#7A7268` (4.40) | `#9A2B1E` (7.12) | rule `#DCD3C4` (1.38) | considered, literate, unhurried | Baskerville display + Helvetica Neue kicker |
| 3 | **Brutalist web** | `#E9E7E2` | `#FFFFFF` (1.24) | `#000000` (16.99) | `#5A5A5A` (5.58) | `#0000EE` (7.60) | `#FF2600` (3.07) | blunt, anti-designed, funny | Helvetica Neue 75 huge + Times Roman body |
| 4 | **Terminal / amber phosphor** | `#12100B` | `#1E1A12` (1.10) | `#FFB000` (10.38) | `#8C6212` (3.50) | `#66FF66` (14.54) | `#FF5F56` (6.36) | machine, forensic, primary-source | **the one place Menlo is correct** — Menlo + Helvetica Neue for chrome |
| 5 | **Risograph** | `#F1ECE0` | `#E4DFD1` (1.13) | `#1B1B1B` (14.61) | `#5E5A52` (5.82) | `#FF4B33` (2.82) | `#0F5BC5` (5.36), `#00A05A` (2.88) | handmade, cheap-on-purpose, zine | a grotesque at two weights; overprint via `multiply` |
| 6 | **Broadcast news** | `#0A1A2F` | `#123054` (1.31) | `#FFFFFF` (17.48) | `#9FB3C8` (8.12) | `#D8232A` (3.49) | data `#F0B429` (9.37) | authoritative, urgent, institutional | a condensed grotesque; all-caps kickers, tight leading |
| 7 | **Cinematic teal/orange** | `#0B1214` | `#17272C` (1.23) | `#F2E9DE` (15.74) | `#8FA3A8` (7.18) | `#E07A3F` (6.32) | highlight `#FFD9A8` (14.17) | filmic, wide, patient | a humanist serif at display size + light sans caption |
| 8 | **Warm documentary** | `#15110D` | `#221B14` (1.10) | `#F0E6D8` (15.22) | `#A08E78` (5.94) | `#C9711F` (5.25) | `#6E8B7B` (5.05) | human, archival, first-person | Baskerville + a light grotesque; generous leading |

Notes an agent must not skip:

- **#5's accent measures 2.82:1 and #6's measures 3.49:1.** Riso and news red are genuinely
  low-contrast; that is *why* those traditions use them at poster scale and never for body text.
  Both palettes are only valid if the accent appears at ≥ 96 px type or as a filled shape.
- **#4 (terminal) is the only palette in which a monospace face is a decision rather than a
  default.** Everywhere else, mono is the tell.
- Palettes 1–3 and 5 are **light-ground**. We have never shipped one. Of the four videos we have
  measured, four are dark. The reference we admire most (R2) is light. That alone is worth
  trying before any shader work.

---

## 3. "Flat near-black looks cheap" — what the evidence actually says

**The premise does not survive measurement.** R1's ground is `#000000` over 51–62% of the frame
with zero treatment. R2's is `#FCF3F5` over 79–97% with zero treatment. Both look made. Our
grounds are *less* flat than R2's and look worse.

What is true is narrower and still useful:

1. **Pure `#000000` and `#FFFFFF` are a tell in a graphic**, because they are what you get by not
   choosing. R1 gets away with `#000000` because 24% of its frame is a screen recording — the
   black is a *matte* around real pixels, not a canvas. In a pure-graphic piece, tint the black.
   Measured off-blacks, all within 1.3 stops of each other, all legitimate:

   | hex | HSL | Y | CR vs `#EDECE6` | reads as |
   |---|---|---:|---:|---|
   | `#000000` | — | 0.00000 | 17.74 | nothing loaded |
   | `#0E0E12` | 240°, 12%, 6% | 0.00451 | 16.27 | **current house — cool, and now over-used** |
   | `#12100E` | 30°, 12%, 6% | 0.00531 | 16.04 | warm, paper-adjacent |
   | `#0B0F0D` | 150°, 15%, 5% | 0.00442 | 16.30 | cold, clinical |
   | `#0A0E18` | 223°, 41%, 7% | 0.00445 | 16.29 | ink navy, editorial |
   | `#0B1214` | 193°, 29%, 6% | 0.00554 | 15.97 | cinematic |
   | `#15110D` | 30°, 24%, 7% | 0.00589 | 15.87 | documentary |
   | `#1A1714` | 30°, 13%, 9% | 0.00883 | 15.08 | **lifted film black** — true black never appears in a print |
   | `#0A1A2F` | 214°, 65%, 11% | 0.01009 | 14.76 | broadcast navy |

2. **If you want a dark piece to look lit rather than painted, the ground needs a low-frequency
   value shift, not a texture.** Centre-to-corner pairs that read as light and not as an object
   (all sit *below* the 1.5:1 ink threshold, so they never register as a shape):

   | centre | corner | CR | 8-bit Δ |
   |---|---|---:|---:|
   | `#1A1A24` | `#0B0B0F` | 1.14:1 | 15 |
   | `#1C1C26` | `#0E0E12` | 1.14:1 | 14 |
   | `#241D14` | `#15110D` | 1.13:1 | 15 |
   | `#18272C` | `#0B1214` | 1.23:1 | 13 |

3. **⚠ There is an engineering blocker on all of §3.2.** bay composites in
   `wgpu::TextureFormat::Rgba8Unorm` (`bay-gpu/src/context.rs:67`) and exports `yuv420p`. A ramp
   of 14 code values across 1920 px is **one step every 137 px** — textbook Mach banding, with no
   dither anywhere in the pipeline. The measured ground noise in our own export is σ = 0.62/255,
   i.e. the encoder adds nothing. **Any gradient we add today will band.** The fix is either an
   `Rgba16Float` intermediate, or a dither in the final pass — and a 1–1.5/255 grain *is* that
   dither, which is the one genuinely load-bearing argument for grain in this codebase (§5).

4. **The way to keep a dark piece from looking flat without any of the above** is what the
   references actually do: put something on it that has its own histogram. R1: a screen
   recording. R2: painted assets. Both are asset pipeline, not render pipeline.

---

## 4. Colour as information

- **Never encode with hue alone.** Every quantity in a data video is already encoded by position
  and length; colour is the third channel and should be redundant with a label. wicks-v2 has the
  opposite problem — it encodes with *nothing*: 8 of 10 sampled frames contain no hue at all.
- **Hue budget for a chart: 4.** Not 6, not "up to 12". At 1080×1920 played at thumbnail size on
  a phone, adjacent categorical hues below ~30° apart are indistinguishable after
  chroma-subsampled H.264. Past 4 series, direct-label and drop to one accent + greys.
- **Semantic pairs must survive greyscale, dichromacy and the encoder.** Measured, using
  Viénot–Brettel–Mollon 1999 simulation; Δ is Euclidean separation in linear light (×100):

  | pair | A | B | CR(A,B) | Δ normal | Δ deuteranopia | Δ protanopia | Δ tritanopia |
  |---|---|---|---:|---:|---:|---:|---:|
  | classic red/green | `#D8232A` | `#2E8B57` | **1.18** | 70.6 | 57.9 | **38.3** | 70.2 |
  | finance red/green | `#FF5B5B` | `#3DD68C` | 1.62 | 112.1 | 75.5 | 52.0 | 112.2 |
  | blue/orange | `#2D7FF9` | `#E07A3F` | 1.27 | 115.0 | 128.5 | 133.1 | 76.0 |
  | **blue/amber** | `#18438D` | `#F0B429` | **5.06** | 98.1 | 109.5 | 110.1 | 96.0 |
  | teal/rust | `#3AA6A0` | `#C9711F` | 1.22 | 67.4 | 112.3 | 122.7 | 63.3 |
  | purple/olive | `#7A4FBF` | `#9BA33A` | 2.08 | 57.4 | 105.2 | 134.0 | **30.4** |

  Classic red/green loses **46% of its separation** under protanopia (~1% of males) and has a
  1.18:1 luminance ratio, so it also dies in greyscale and in a compressed thumbnail.
  **`#18438D` / `#F0B429` is the only pair here that holds under all three dichromacies *and*
  carries 5.06:1 of luminance between its two halves.** Rule: the two colours carrying opposite
  meaning must differ by ≥ 3:1 in contrast ratio, regardless of hue.
- **Sequential data wants one hue and a lightness ramp** (5–7 steps max at video scale);
  **diverging data wants two hues meeting at the ground's lightness**, never at white.
- **Red-means-bad is not universal** (it is up/auspicious in much of East Asia). If the piece has
  no cultural anchor, use the blue/amber pair and label.

---

## 5. Texture and grain

**Honest finding first: neither reference has any.** Ground noise σ: R1 0.43–0.66, R2 0.22–1.19,
ours 0.62–0.67. High-pass energy on the flat ground: R1 0.39–0.41, R2 0.03–0.14, ours 0.98–1.12
— **we are already the noisiest of the three**, entirely from H.264 quantisation at 343 kbps.

Grain is therefore **not** the thing separating us from these references, and a check that
demands it would be pure Goodhart. What grain *is* good for here is narrower and real:

- **As dither for §3.2/§3.3.** 8-bit intermediates + no dither = banded gradients. Monochrome
  grain at σ ≈ 1.2–1.5/255 (0.5–0.6% amplitude) breaks the contour and costs nothing visible.
- **Over a photographic or generated raster asset**, to keep it from sitting on the vector layer
  like a sticker.

Calibration at 1080p, if it is ever built:

| treatment | reads as *film* | reads as *noise/dirt* | how to judge |
|---|---|---|---|
| monochrome grain, animated per frame | σ 1.5–4 / 255 (0.6–1.6%) | σ > 8/255 | at 4/255 you should not be able to *see* it, only miss it when it's off |
| static grain (an image, not re-seeded) | never | always | a fixed pattern reads as dirt on the lens within 0.5 s |
| chroma grain | σ ≤ 1/255 | σ > 2/255 | chroma noise on a flat ground survives `yuv420p` badly; prefer luma-only |
| vignette | centre/corner 1.10–1.25:1 | > 1.6:1 | if you can name where it starts, it is too strong |
| bloom / glow | 8–20% of the source's luminance, σ 12–30 px | > 35% | it should make a bright element read as *emitting*, not as blurred |
| chromatic aberration | ~0 | any visible amount | **usually a mistake** — see below |

**Chromatic aberration is a mistake in a graphic piece**, and the reason is mechanical, not
taste: it is a *lens defect*, so it implies a camera. A frame with no camera in it that has CA
reads as a filter, which is the exact "AI made this" signal we are trying to remove. It is also
destroyed by 4:2:0 chroma subsampling — the fringe is a chroma-only edge at half resolution, so
at 343 kbps it turns into coloured mush around type. Reserve it for footage, at ≤ 1 px, or skip
it.

**The blend-mode stack is where texture actually comes from, and we use zero of it.** 119 of 119
visual elements are `normal`. Multiply for overprint and shadow, screen/plus-lighter for glow and
light leaks, overlay/soft-light for tint that preserves luminance, hue/color for recolouring an
imported asset to the palette. bay has all 17 and has never run one.

⚠ Blending happens in `Rgba8Unorm` — i.e. gamma-encoded, Photoshop-style, not linear light. That
is what designers expect, so it is not a bug, but a *physically* correct bloom (bright areas
bleeding with real falloff) is not achievable; what you get is the Photoshop `screen` look.

---

## 6. Contrast and value structure

### How to measure a frame's value structure

Not a luma histogram in absolute terms — a **contrast-ratio ladder against the frame's own
ground**, because a dark piece and a light piece produce mirror-image luma histograms and the
same ladder.

```
ground  := modal 8-bit colour of the frame
ratio(p):= (max(Y_p,Y_g)+0.05) / (min(Y_p,Y_g)+0.05)
ink     := ratio >= 1.5           dead ink := 1.02 <= ratio < 1.5
steps   := # of 12 log-spaced bins over [1.5, 21] holding >= 0.2% of the frame
```

Measured `steps`: R1 **12/12 in every frame**; R2 2–9 (median 5); wicks-v2 2–5 (median 4);
O2 2–3; O3 1–5.

### Why a two-value frame looks unfinished

Because nothing in it is *lit*. A frame with paper-white on near-black has an ink layer and a
ground and no relationship between them: no surface the ink sits on, no shadow, no mid-tone that
the eye can use to place the two extremes in the same space. The eye reads that as a *diagram*,
which is correct for a diagram and wrong for a film. O2 is the pure case — 2–3 steps, 89–94% one
colour, 4.32% at ≥12:1, and its own teardown calls it "kinetic typography with no image, video,
shape or icon in the entire runtime."

wicks-v2 is worse than two-value: it is two-value *plus 30% of the frame spent trying to be a
third value and failing*. The panel at 1.10:1 is a mid-tone the eye cannot resolve, so it
contributes nothing but a slight lift in the noise floor.

### What a good histogram looks like

| | dark piece | light piece |
|---|---|---|
| ground share of frame | 55–80% | 70–92% |
| **dead ink (1.02–1.5:1)** | **≤ 8%** | ≤ 4% |
| ink at 1.5–3:1 (surfaces) | 4–15% | 2–8% |
| ink at 3–7:1 (muted) | 1.5–5% | 1–4% |
| ink at ≥ 12:1 (hero) | **3–7%** | 1.5–4% |
| populated steps (of 12) | ≥ 6 | ≥ 5 |
| hue families ≥ 0.1% frame | ≥ 2 | ≥ 2 |

R1 hits every dark-piece row. R2 hits every light-piece row except `populated steps` (median 5
against a floor of 5 — exactly at it). wicks-v2 fails **dead ink (30% vs ≤8%)**, **hero mass
(1.29% vs 3–7%)**, **steps (4 vs ≥6)** and **hue (0 vs ≥2)**.

---

## 7. The look of the references, characterised

**R1 — "palmier" reply-screenshot demo.** Ground `#000000`. No grade, no texture, no vignette.
Its entire colour strategy is *borrowed*: 24% of the frame is a real application window, so it
inherits a UI designer's palette, a full 12/12 value ladder, 3–5 hue families and 5.68% of the
frame above 12:1 — free, every frame, for the cost of a screen recording. The 51–62% of pure
black around it is a **matte**, and a matte is allowed to be flat.
*What it does that we do not:* it puts something in the frame that has its own colour system.

**R2 — the doodle explainer.** Ground `#FCF3F5` — a blush white, pointedly not `#FFFFFF`, held
unbroken for 57 seconds across 79–97% of every frame. Its ink is hand-drawn assets in
**saturated, unmixed poster colours** (`#359049` green at 3.68:1, `#18438D` blue at 8.66:1,
`#112153` navy at 14.11:1) plus real corporate logos pasted in at their own brand colours. Dead
ink: **1.2%** — nothing is drawn that cannot be seen. No grade, no grain (σ 0.22–1.19), no
vignette, no gradient.
*What it does that we do not:* (a) a **light** ground; (b) **2–4 hue families in almost every
frame**; (c) it never draws a mark below 1.5:1; (d) the ground never changes, so every hue lands
against a known constant.

**The one-line version.** R1 buys its colour with a screen recording. R2 buys its colour with
illustration. **Neither buys it with a shader.** We have shipped four videos that buy it with
nothing.

---

## 8. Mapped onto bay's actual capability

Read: `bay-effects/src/{effects,looks,lut,pipeline,types}.rs`, `bay-project/src/element.rs`,
`bay-project/src/settings.rs`, `bay-preview/src/lib.rs:20-80`, `bay-masks/src/feather.rs`,
`bay-mcp/src/tools.rs`.

**What exists:** 5 effect shaders (`brightness`, `contrast`, `saturation`, `gaussian-blur`,
`lut`); 6 generated looks (`neutral-contrast`, `teal-orange`, `bleach-bypass`, `warm-film`,
`cool-night`, `mono`) plus arbitrary `.cube` files; 17 blend modes; SDF-feathered elliptical and
rect masks with an `inverted` flag and unbounded feather in pixels; solid-fill rect (with corner
radius) and ellipse shapes; `Background::Color` / `Background::Blur`; image and video elements.

### Achievable today, zero code

| want | mechanism | tool calls |
|---|---|---|
| hue-tinted off-black ground | `project_create { background: "#15110D" }` | 1 |
| **per-act ground change** (R2/O2 do this) | full-frame shape per act at layer 0, `fade_set` across the seam | 2/act |
| **radial glow / light pool** | `add_shape` full-frame + `mask_set { shape:"ellipse", width:1.4, height:0.9, feather: 600 }` + opacity 0.5 | 2 |
| **vignette** | full-frame `#000000` shape + `mask_set { ellipse, width:1.5, height:1.1, feather:500, inverted:true }` + opacity 0.30 | 2 |
| **linear/radial gradient ground** | generate a PNG with python/PIL, `media_import`, `add_image` full-frame at layer 0 | 3 |
| **film grain** (static) | generate a noise PNG, `media_import`, `add_image`, `blend_set overlay`, opacity 0.06 | 4 |
| **animated grain** | N noise PNGs at 2-frame durations, or a generated short `.mp4` via `add_video` | 3N |
| **bloom on hero type** | `element_duplicate` + `effect_add blur amount:18` + `blend_set plus-lighter` + opacity 0.5, under the crisp copy | 3 |
| **creative grade on a clip** | `effect_add { type:"lut", look:"warm-film", params:{amount:0.4} }` | 1 |
| **duotone an imported photo** | `add_image` + coloured shape over it + `blend_set color` | 2 |
| **riso overprint** | two saturated shapes + `blend_set multiply` | 2 |
| **paper/halftone/scanline ground** | generated PNG + `add_image` + `blend_set multiply` | 3 |

Every one of these was available when wicks-v2 was made. Usage: `effects: 0`, `blend: normal
×119`, `masks: 1`, `images: 0`.

### Needs a shader or engine work

| want | why blocked | size |
|---|---|---|
| **a grade over the whole frame** | effects hang off `Element`; `Background::Color` is a clear colour, not an element, so it can never carry one. There is no adjustment layer and no post-composite hook. "One look unifies the piece" is currently **impossible**. | medium |
| **animatable effect params** — grade ramp, pull-focus, bloom-in | `ANIMATABLE_CHANNELS` is exactly `["opacity","scale","x","y","rotation","scaleX","scaleY"]` (`element.rs:1071`); `Effect.params` is `BTreeMap<String,f32>`, never sampled | medium |
| **colour as an animatable property** | same; a colour change today needs two elements and a dissolve | small |
| **gradient fill on a shape** | `ShapeElement.color` is one `#rrggbb`; `layer.wgsl` samples a solid texture | small–medium |
| **procedural grain** | no noise shader; as an image there is no uv-repeat/tiling and no per-frame seed, so an imported grain plate is static (= dirt) unless duplicated N times | small |
| **dither in the final pass** | `Rgba8Unorm` intermediate + no dither ⇒ any large soft ramp bands at one step per ~137 px | small, and it gates §3.2 |
| **stroke / outline on shapes and text** | neither `ShapeKind` nor `TextElement` has a stroke; the riso/brutalist looks want one | medium |
| **colour tags on export** | our MP4 reports `color_range=unknown, color_space=unknown`; R2 reports `tv`/`bt709`. Players guess, and on a near-black piece a wrong guess shifts the blacks. One-line ffmpeg fix. | trivial |

### Not worth chasing

Linear-light compositing / HDR tonemapping (whole-pipeline colour-management work, and the
Photoshop-style gamma blend is what authors expect); chromatic aberration as a pass (§5);
per-pixel lens simulation. None of it stands between us and R1 or R2.

---

## 9. Rules — with the gaming analysis attached

Ordered by *how badly a gamed version of the video would still look*. The first four are
computable from the project JSON alone, exactly, with no render.

### R-COL-1 `dead-plate` — **critical**

> No visual element may cover more than **5% of the canvas** at a composited contrast below
> **1.6:1** against what is behind it. Total sub-1.6:1 element area ≤ **10% of canvas**.
> Computed from `color` × peak animated `opacity` × `scale·scaleX·scaleY`, against the
> background or the topmost opaque element under it.

Fires on wicks-v2 at **34.17%** (`panel`, `#191922`, 1.10:1) and again at **8.875%**
(`sq`, `#FF5B5B` @ 0.28, 1.50:1). Fires on nothing in R2 (1.2% dead ink), O2 (0.75%), O3 (0.6%).

**How an agent games it:** raise the panel to `#323236` (1.51:1) — still fails, floor is 1.6:1;
`#353539` clears at 1.61:1 and is a *visible* surface. Or delete the panel. Or shrink it below
5%. **All three outcomes are improvements.** The only bad escape is deleting the panel and
replacing it with nothing, which `no-accumulation` and the layout rules should catch — worth
pairing.

### R-COL-2 `accent-under-opacity` — **critical**

> Any element whose colour has HSL saturation ≥ 35% must reach a **composited** contrast of
> ≥ 4.5:1 against its ground at its peak animated opacity. Report the composited hex in the
> finding, not the authored one.

Fires on `sq`: authored `#FF5B5B` (6.33:1), composited `#512426` (**1.50:1**). This is the exact
failure `layout.md:101` warns about in prose and the agent committed anyway.

**How an agent games it:** raise the opacity, or pick a colour that reads at that opacity. There
is no third option — the check computes the same number the eye sees. **Ungameable by
construction.**

### R-COL-3 `achromatic` — **high**

> Across the whole video, at least **2 distinct hue families** (30°-wide bins) must each cover
> ≥ 0.4% of the canvas at a composited contrast ≥ 3:1, in at least one frame; and at least one
> such family must appear in ≥ 40% of scenes. A family covering > 25% of the canvas does not
> count (that is a wash, not a hue).

Measured: wicks-v2 has **one** family (`#FF5B5B`) at **0.57% of canvas** at usable contrast —
fails on both count and area. R2 has 2–4 per frame; R1 3–5.

**How an agent games it:** the 25% ceiling kills a full-frame magenta wash; the 0.4% floor
(≈8,300 px on a 1080×1920 canvas — a 91×91 square) is small enough to place two coloured dots.
**This one is genuinely gameable at the margin.** Mitigation: require the qualifying area to be
contiguous (largest connected component ≥ 0.25% of canvas) so it cannot be satisfied by confetti.
Even gamed, two 91-px colour blocks at 3:1 is strictly better than the zero we ship now — the
floor rises.

### R-COL-4 `palette-undeclared` — **high** *(this is the anti-Goodhart one)*

> The project must declare, in metadata, **which named palette it is using and why that tradition
> fits this subject**. `check` then verifies every element colour is within ΔE 6 of one of that
> palette's declared roles, and that ≥ 4 of the 6 roles are actually used.

**And, load-bearing: delete the single hex table from `layout.md:77-87` and replace it with the
eight palettes of §2 plus the derivation recipe.** As long as one palette is "the house palette",
that palette is what ships — that is what the evidence shows, colour for colour, seven of seven.

**How an agent games it:** by naming a palette and then using it. That *is* the desired
behaviour. The failure mode it cannot produce is the current one — 12 undeclared colours, 11 of
them greys, none of them a decision. Its residual weakness is that the agent will pick palette #1
every time unless the skill forces a subject→tradition mapping and `check` can see the project
name; a weaker but real backstop is to fire `palette-repeat` when consecutive projects on the
machine declare the same palette.

### R-COL-5 `value-ladder` — **medium**

> Over sampled frames, ≥ **6 of 12** contrast-ratio steps must hold ≥ 0.2% of the frame each, and
> ≥ **3%** of the frame must sit at ≥ 12:1 against the ground.

Measured: wicks-v2 4 steps / 1.29% bright — fails both. R1 12 / 5.68% — passes. O2 3 / 4.32% —
fails steps. **R2 5 / 1.40% — also fails.** Report it honestly: this rule flags a good reference,
so it must be *advisory*, or the bright-mass clause must be dropped on light grounds (R2's ink is
dark, and the "≥12:1" half still passes for it — it is the 3% area floor that R2 misses because
it is genuinely sparse).

**How an agent games it:** add a big white rectangle. That satisfies bright mass and looks awful.
This is the weakest rule in the set and should ship as a warning with the number quoted, not as a
gate.

### R-COL-6 `look-never-applied` — **medium**

> If the project contains any `image` or `video` element and zero `lut` effects, warn. If it
> contains ≥ 2 raster sources graded differently (or not at all), warn: *"a grade applied
> uniformly is what makes a sequence read as one piece."*

Does not fire on wicks-v2 (no rasters at all) — which is itself the finding. Pair with an
asset-presence rule owned by another area.

### R-COL-7 `blend-never-used` — **low**

> 119 of 119 visual elements at `blendMode: normal`, `effects: {}` on 188 elements, 1 mask,
> 0 images. Report the **capability-usage census** in `check` output as facts, unranked. Not a
> gate — a mirror. An agent that reads "you used 0 of 17 blend modes and 0 of 6 looks" is more
> likely to reach for one than an agent that reads a pass.

**How an agent games it:** by applying a pointless blend mode. Low stakes, low harm; keep it
non-blocking.

---

## 10. The three things round 3 must not do

1. **Do not require a non-flat background.** Both references are flatter than we are. Measured.
2. **Do not require grain.** Neither reference has any; our own export is already the noisiest of
   the three. Build grain as *dither* if and only if gradients ship (§3.3), and say so in those
   terms.
3. **Do not add a "number of distinct colours" check.** wicks-v2 has 12 colours in the model;
   R2 has 8–14 significant colours per frame and looks better. Counting colours is the same
   mistake as counting easings. **Count contrast, count area, count hue families that carry
   contrast.**
