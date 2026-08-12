# 30 — Motion doctrine (executable)

Round 2. Everything here is derived from a measurement of the project model of `wicks-v2`
(`project-1786466680050.json`, 188 elements, 61.0s, 30fps, 1080×1920) or computed directly from
bay's easing implementations in `rust/crates/bay-project/src/element.rs:167-217`. Where a number
comes from the web it is cited.

**The judgment this document is written against:** if an agent optimised for these rules and
nothing else, what would the video look like? Every rule below carries its own gaming analysis.

---

## 0. What round 1 got wrong, in numbers

Round 1's `motion.md` is not vague. It is *specific and wrong in five measurable places.* This
matters more than the missing rules, because the agent followed it.

| Round-1 instruction | Measured consequence | Correct value |
|---|---|---|
| "`spring-out` … typical duration **0.5–0.7s**" | 15–21 frames of `spring-out` delivers a **6.2–8.7 frame** perceptible move (see §2). Below the floor. | 24f (0.80s) minimum |
| "`expo-out` … **0.4–0.6s**" | 12–18f of `expo-out` = **3.8–5.7 frame** perceptible move. **The skill's own recommended entrance is a pop.** | 32f (1.07s) minimum |
| "`ease-out` … a gentler entrance … 0.3–0.45s" | 9–14f → core 5.7–8.9f. Also below floor. The agent used `ease-out` **103 times**, 76 of them over 3 frames. | 16f minimum |
| "bay has **fourteen** easings. Giving each one a job…" | 14 names, **9 perceptually distinct curves**. `ease-in-out` and `sine-in-out` differ by max **2.8%** of travel. An easing-diversity counter is satisfied by visually identical curves. | see §2.2 |
| "**Never `linear` on a positional move**" | Kills arcs. A two-axis move with the *same* curve on both axes is a ruler line by construction. `linear`-x + `power-out`-y is a **19.2% bow** — the cheapest arc bay can make. | never linear on *all* axes of a move |
| "JITTER … ±2px … the only sanctioned aliveness" | ±2px = 0.19% of frame width. At the 452 kbps this encodes at, it is below the rate-distortion floor and is discarded. It costs bitrate and returns nothing. | replaced by §7 |

And what it did not say at all: nothing about **which property carries a move**. The result:
107 of 119 animated channels are opacity.

### The measured state of `wicks-v2`

| measurement | value | method |
|---|---|---|
| value-changing keyframe segments | 245 | project model |
| …that are opacity | 167 (68%) | |
| …that are 1–3 frames long | **76 (34%), 100% of them opacity, 100% of them `ease-out`** | |
| …longer than 25 frames | **1** | |
| visual elements animating **opacity and nothing else** | **66 / 119 (55%)** | |
| visual elements whose entrance moves any geometry | **10 / 119 (8%)** | first 1.2s local |
| visual elements with **no** value change in their first 1.2s | 54 / 119 | i.e. they cut on |
| positional tweens in the whole video | **36** | |
| median positional travel | **30 px** (1.6% of frame height) | Q1 = 20 px |
| scale entrance deltas | 18 of 20 are ≤ 0.24; only 2 exceed 0.4 | |
| exits on opacity alone | **77 / 119** | last 1.0s of element |
| exits with any geometry | **5 / 119** | |
| exits using an `-out` (decelerating) curve | **67** | wrong direction by definition |
| elements with **no** exit at all (hard cut) | 37 | |
| **response coefficient** — arrivals where ≥1 already-present element moves within ±12f | **31 / 119 (26%)** | strict: excludes the responder's own entrance/exit |
| longest interval with no ≥6-frame tween anywhere | **6.33 s** (t=23.07) | 6 such intervals >1s |
| frames containing a ≥6-frame tween | 33.9% | |
| main-track elements | **1** (`panel`, 62s) → `spans()` returns one 62s bucket → every pacing check is arithmetically dead | `check.rs:572` |

---

## 1. The perceptual floor — why 3-frame moves read as broken

### 1.1 The derivation

A UI animation and a video move are different objects and round 1 imported the wrong numbers.

- In a UI, the user *initiated* the change, their gaze is already on the target, and motor
  prediction is running. 150 ms is enough. This is where the LottieFiles/Material/Carbon numbers
  (80–400 ms) come from.
- In a video the viewer initiated nothing and their gaze is somewhere else in a 1080×1920 frame.
  Average fixation duration in free scene viewing is **200–300 ms (mean ≈ 298 ms)**, there are
  **3–4 fixations per second**, and preparing a saccade to a new target takes **≈200 ms**
  ([Cronin et al., *Eye Movements in Real-World Scene Photographs*](https://pmc.ncbi.nlm.nih.gov/articles/PMC6971407/)).

Therefore: **a move that completes in under 200 ms is over before the eye can arrive.** The
viewer sees the before-state and the after-state and never the transit. That is the definition of
a cut. It does not matter what easing you put on it.

Add the frames needed for the motion to be *seen* after the eye lands (≥4 frames of visible
travel) and the floor is **10 frames / 333 ms** for a move the viewer must notice from elsewhere
in the frame, **7 frames / 233 ms** for a move on an element the eye is already on.

### 1.2 Why the 76 three-frame `ease-out` opacity moves specifically look broken

`ease-out` sampled over 3 frames at 30fps produces exactly:

```
frame:  0      1      2      3
value:  0.000  0.556  0.889  1.000
```

There is **one** intermediate frame below 90%, and it is already at 56%. The event the viewer
receives is: nothing → a single 56%-opaque ghost → the thing. That is not a fade; the visual
system files it with dropped frames and compression artifacts. At 452 kbps for 1080×1920 the
single ghost frame is also heavily quantised, which is why it reads as an *error* rather than a
style.

Sample tables for the same curve at other lengths:

| frames | ms | intermediate samples below 0.9 | reads as |
|---|---|---|---|
| 2 | 67 | 1 (0.75) | cut |
| 3 | 100 | 1 (0.556) | **broken cut** ← 76 of these |
| 5 | 167 | 3 (0.36, 0.64, 0.84) | glitch |
| 8 | 267 | 5 | just barely a fade |
| 12 | 400 | 7 | a fade |
| 24 | 800 | 15 | a dissolve |

### 1.3 The three duration classes, and the ban between them

| class | frames @30fps | ms | what it is |
|---|---|---|---|
| **cut** | 0 (`hold`) | 0 | a decision to change instantly. Legal, cheap, often correct. |
| **dead zone** | 1–6 | 33–200 | **forbidden.** Too long to be clean, too short to be motion. |
| **accent** | 3–8, out-and-back only | 100–267 | legal *only* if net displacement is 0 (§9 TAP/THUMP/NUDGE) |
| **move** | ≥7 core frames | ≥233 | see §2 for *core* vs nominal |

An agent that wants a fast change must now decide: is this a **cut** or a **move**? That is a
design decision, and it cannot be dodged by picking a middle number.

---

## 2. Curve physics — the numbers bay's 14 easings actually produce

Computed by sampling `Easing::apply` at 2000 points.

### 2.1 The core-span table — the most important table in this document

`t@10%` and `t@90%` are when the curve has covered 10% and 90% of the travel. The **core span**
is the fraction of the duration in which the visible motion happens; the rest is a tail the eye
cannot resolve.

| easing | v_peak (× average) | t@10% | t@90% | **core span** | **nominal frames for a 10-frame core** |
|---|---|---|---|---|---|
| `linear` | 1.00 | 0.100 | 0.900 | 0.800 | **12.5 f** |
| `ease-out` | 2.00 | 0.051 | 0.684 | 0.633 | **15.8 f** |
| `ease-in` | 2.00 | 0.317 | 0.949 | 0.632 | 15.8 f |
| `sine-in-out` | 1.57 | 0.205 | 0.795 | 0.591 | 16.9 f |
| `ease-in-out` | 2.00 | 0.224 | 0.776 | 0.552 | 18.1 f |
| `power-out` | 3.00 | 0.035 | 0.536 | 0.501 | **20.0 f** |
| `power-in` | 3.00 | 0.465 | 0.966 | 0.501 | 20.0 f |
| `spring-out` | 2.95 | 0.067 | 0.482 | 0.415 | **24.1 f** |
| `power4-out` | 3.99 | 0.026 | 0.438 | 0.412 | 24.3 f |
| `power4-in` | 3.99 | 0.562 | 0.975 | 0.412 | 24.3 f |
| `expo-out` | 6.91 | 0.015 | 0.333 | 0.317 | **31.5 f** |
| `expo-in` | 6.91 | 0.668 | 0.985 | 0.317 | 31.5 f |
| `back-out` | 4.70 | 0.022 | 0.296 | 0.274 | 36.5 f |
| `hold` | — | — | — | 0 | n/a (it is a cut) |

Core frames delivered, by nominal duration:

| easing | 7f | 10f | 12f | 15f | 18f | 20f | 24f | 30f |
|---|---|---|---|---|---|---|---|---|
| `linear` | 5.6 | 8.0 | 9.6 | 12.0 | 14.4 | 16.0 | 19.2 | 24.0 |
| `ease-out` | 4.4 | 6.3 | 7.6 | 9.5 | 11.4 | 12.7 | 15.2 | 19.0 |
| `sine-in-out` | 4.1 | 5.9 | 7.1 | 8.9 | 10.6 | 11.8 | 14.2 | 17.7 |
| `power-out` | 3.5 | 5.0 | 6.0 | 7.5 | 9.0 | **10.0** | 12.0 | 15.0 |
| `spring-out` | 2.9 | 4.2 | 5.0 | 6.2 | 7.5 | 8.3 | **10.0** | 12.5 |
| `power4-out` | 2.9 | 4.1 | 4.9 | 6.2 | 7.4 | 8.2 | 9.9 | 12.4 |
| `expo-out` | 2.2 | 3.2 | 3.8 | 4.8 | 5.7 | 6.3 | 7.6 | **9.5** |
| `back-out` | 1.9 | 2.7 | 3.3 | 4.1 | 4.9 | 5.5 | 6.6 | 8.2 |

**This is the answer to "a slow expo and a fast expo are different animals."** An `expo-out` under
about 24 frames is not a curve at all — it is a jump with a decorative tail. Its perceptible
motion is 2–7 frames, which puts it in the forbidden dead zone of §1.3 no matter what nominal
number you wrote in the tool call.

**Rule M1 (the duration floor, restated so it cannot be gamed):**
`core_frames = core_span(easing) × nominal_frames ≥ 10` for the first move of any element or
group, `≥ 7` for subsequent members of a group already in flight. Checking nominal duration alone
is exactly the mistake round 1 made.

### 2.2 The curve vocabulary is 9 curves, not 14

Max divergence |e₁(t) − e₂(t)| as a fraction of travel:

| pair | max divergence | at 60 px travel |
|---|---|---|
| `ease-in-out` ≈ `sine-in-out` | **0.028** | 1.7 px — indistinguishable |
| `power-out` ≈ `spring-out` | 0.086 | 5.2 px |
| `linear` ≈ `sine-in-out` | 0.105 | 6.3 px |
| `power-out` ≈ `power4-out` | 0.105 | 6.3 px |
| `power-in` ≈ `power4-in` | 0.105 | 6.3 px |

Distinct clusters (positional shape): `{linear, sine-in-out, ease-in-out}` · `{ease-out}` ·
`{power-out, power4-out, spring-out}` · `{expo-out}` · `{back-out}` · `{ease-in}` ·
`{power-in, power4-in}` · `{expo-in}` · `{hold}`.

Two consequences:

1. **A distinct-easing counter is gameable by switching between curves that differ by 3%.** Any
   variety check must count *clusters*, and must weight by how many segments use each.
2. **At a velocity-matched seam, match velocity, not shape.** `power-out` and `power4-out` differ
   by only 10.5% in position but their peak velocities are 3.00× and 3.99× — a 33% mismatch. The
   pair that actually matches is `power4-in` / `power4-out` (both 3.99×), or `power-in`/`power-out`
   (both 3.00×). Never `ease-in` against `power4-out`.

### 2.3 What each curve communicates

| curve | v_peak | tail share | weight it implies | use |
|---|---|---|---|---|
| `linear` | 1.00× | 10% | none — a machine, or a *component* of an arc | one axis of a two-axis move; progress bars; opacity riding under geometry |
| `sine-in-out` | 1.57× | 20% | air, no mass | drift, parallax, ambient |
| `ease-out` | 2.00× | 32% | light, small | secondary elements, captions |
| `power-out` | 3.00× | 46% | a hand placing something | the general-purpose entrance |
| `spring-out` | 2.95× | 52% | mass with damping — a thing that has weight and is caught | hero entrances, cards |
| `power4-out` | 3.99× | 56% | thrown | the entry half of a seam |
| `expo-out` | 6.91× | 67% | teleport with a settle | only at ≥30f; below that it is a cut |
| `back-out` | 4.70× (max 1.100) | 70% | rubber; **fixed 10% overshoot** | ≤1 per video, on a logo or a single accent |
| `ease-in` / `power-in` / `power4-in` / `expo-in` | mirrors | — | leaving | exits, in ascending order of "gone" |
| `hold` | — | — | — | a cut. Not a curve. Not diversity. |

**When a spring is right:** an object with implied mass arriving and being *caught* — a card, a
panel, a hero figure, anything with a visible edge. `spring-out` at ω=8, ζ=1 has no overshoot, so
it is safe as a default.
**When it is kitsch:** on text under ~48px (the settle is invisible at that size, you pay 24
frames for nothing); on more than ~3 elements in the same second (everything acquires the same
implied mass and the frame reads as jelly); on anything that is supposed to be mechanical,
precise, or data (`power-out` or `linear` instead).
**`back-out` is kitsch unless the subject is literally elastic** — its 10% overshoot is fixed and
not tunable, which is why hand-keyed overshoot (§4) is nearly always better.

### 2.4 Arcs, quantified

An element that animates **x and y with the same easing travels a perfectly straight line**,
because both are the same function of t. The arc is produced by giving the two axes different
curves. Perpendicular bow, as a percentage of the chord, for a 45° chord:

| x easing | y easing | bow | reads as |
|---|---|---|---|
| `power-out` | `power-out` | **0.0%** | a ruler — what wicks-v2 does |
| `power-out` | `power4-out` | 5.0% | still straight |
| `ease-out` | `power4-out` | 12.5% | a hint |
| `power-out` | `expo-out` | 13.2% | a gentle arc |
| **`linear`** | **`power-out`** | **19.2%** | **the default arc — cheapest, both cores ≥10f at 20f** |
| `linear` | `spring-out` | 21.6% | a thrown arc |
| `ease-in-out` | `spring-out` | 26.3% | a lob |
| `linear` | `expo-out` | 28.8% | a whip |
| `sine-in-out` | `expo-out` | 33.9% | a dive |

General formula, exact for any chord: **bow_px = dx · dy · max|e_x(t) − e_y(t)| / √(dx²+dy²)**,
and **bow_fraction = dx · dy · max|e_x − e_y| / (dx² + dy²)**, which peaks when dx = dy. The
divergences: `linear`/`power-out` 0.385 · `linear`/`spring-out` 0.431 · `power-out`/`expo-out`
0.264 · `sine-in-out`/`expo-out` 0.677 · `linear`/`expo-out` 0.576 · `ease-in-out`/`spring-out`
0.526 · `ease-out`/`power-out` 0.148 (too close — same cluster).

**Rule M2:** any element animating both `x` and `y` in the same window must use different easing
*clusters* on the two channels, producing a computed bow ≥ 8% of the chord. Cost: **zero extra
keyframes.** This is the highest quality-per-byte rule in the document.

---

## 3. Property choice — the crux

107 of 119 channels are opacity. This is not a stylistic problem; it is a **capability**
problem the agent inflicted on itself.

### 3.1 Why opacity is the worst possible primary channel

**1. Opacity has no vector, so 6 of the 12 principles cannot be expressed in it at all.**
Anticipation, follow-through, overlap, arcs, squash & stretch and exaggeration are all defined on
a *trajectory*. Opacity is a scalar at a fixed retinal location. A video animated in opacity is a
video in which those six principles are mechanically unavailable — which is the precise, boring
reason "our video has none of these."

| principle | expressible in opacity? |
|---|---|
| slow in / slow out | yes (and it is the only one wicks-v2 has) |
| staging | yes |
| timing | partially |
| anticipation | **no** — there is no "opposite direction" |
| follow-through | **no** — there is no overshoot past 1.0 that isn't clipping |
| overlapping action | **no** — nothing to lag |
| arcs | **no** |
| squash & stretch | **no** |
| secondary action | **no** — a fade cannot cause a second fade |
| exaggeration | **no** — the channel is bounded [0,1] |

**2. It is not motion to the visual system.** Displacement drives the motion pathway and pulls a
saccade; a luminance ramp at a fixed location drives only the transient channel. Opacity produces
"something changed *here*", never "something moved *from A to B*". It cannot be tracked by smooth
pursuit, so the viewer cannot follow it, so it cannot lead the eye anywhere.

**3. It spends its entire duration below legibility.** Text at opacity 0.5 on `#0E0E12` is under
the contrast threshold. A 12-frame opacity fade-in of body copy buys 12 frames (400 ms) of
unreadable text. A 12-frame `y` rise buys **zero** unreadable frames — the type is at full
contrast from frame 1 and merely arriving. Measured: wicks-v2 contains **35.8 element-seconds
inside an opacity ramp across 167 ramps, 19.6 of them on text elements** — 19.6 seconds of type
rendered at partial contrast, bought for no expressive return.

**4. It is degenerate under composition.** Two overlapping elements crossfading produce a
double-image at every intermediate frame. Geometry doesn't.

**5. It is also the visibility flag,** which is why the model reaches for it: "appear" and "move"
collapse into one call and the design decision is never made. `fadeIn`/`fadeOut` (`fade_set`)
exist precisely so that "appear" does not have to steal the opacity channel — they were used on
8 of 119 elements.

### 3.2 What carries an entrance instead

Ranked by how much the channel tells the viewer, per keyframe spent:

| rank | lead channel | what it says | typical amplitude @1080×1920 |
|---|---|---|---|
| 1 | `y` | "this belongs in a stack and it came from below/above" | 0.75–1.0 × fontSize, min 40 px |
| 2 | `x` | "this comes from off-frame / from the previous thing" | 100–200 px |
| 3 | `scale` | "this is arriving toward you / receding" | from 0.72–0.86, or from 1.12–1.20 |
| 4 | `scaleX` (anchorX 0/1) | "this draws / fills / wipes" | 0 → 1 |
| 5 | `scaleY` (anchorY 0/1) | "this grows from a baseline" | 0 → 1 |
| 6 | `rotation` | "this is hinged / hand-placed" | 2–8°, ≤1 per scene |
| — | `opacity` | "this is present" | **rides, never leads** |

### 3.3 The target distribution

Two independent tables. **Both** must hold — a distribution alone is gameable by adding a
meaningless tween to every element, which is why the per-element table has floors on *amplitude*
and the aggregate table has ceilings as well as floors.

**A. Channel share, across all animated channels in the project**

| channel | floor | ceiling | wicks-v2 |
|---|---|---|---|
| `opacity` | — | **40%** | **90%** ✗ |
| `y` | 15% | 35% | 14% |
| `x` | 10% | 30% | 16% |
| `scale` | 8% | 25% | 9% |
| `scaleX` + `scaleY` | 10% | 30% | 15% |
| `rotation` | 0% | 12% | **0%** |

**B. Per-element, over visual elements that animate at all**

| statement | target | wicks-v2 |
|---|---|---|
| entrance leads with a geometric channel | **≥ 70%** | **8%** ✗ |
| animates ≥ 2 channels | ≥ 50% | 34% ✗ |
| animates opacity **only** | ≤ 12% | **55%** ✗ |
| exit leads with a geometric channel or is an explicit `hold` cut | ≥ 60% | 4% ✗ |

**C. Entrance-direction diversity.** Classify each entrance by its lead vector:
`{+y, −y, +x, −x, scale-in, scale-out, draw, rotate, mask-travel}`. Within any 90-frame window
containing ≥3 entrances: **≥2 classes present, and no class above 65%.**

### 3.4 Amplitude floors (the anti-gaming layer)

Distribution rules are worthless without these. Every one scales with the element, so "add a 4 px
nudge to everything" fails.

| channel | floor | ceiling |
|---|---|---|
| `y` travel | `max(0.75 × fontSize_px, 40 px)` = 0.0208 canvas | 300 px (0.156) |
| `x` travel | `max(0.5 × elementWidth_px, 64 px)` = 0.0593 canvas | 380 px (0.352) |
| `scale` delta | ≥ 0.10 (i.e. from ≤0.90 or ≥1.10) | ≤ 0.35 for an entrance |
| `scaleX`/`scaleY` | 0 → 1 (a draw is all-or-nothing) | — |
| `rotation` | ≥ 2.0° | ≤ 8° for anything with text in it |
| `opacity` (as a fade) | full 0 → 1 or 1 → 0 | partial fades only for ghosts/grounds |

wicks-v2's median positional travel is **30 px**, below the 40 px floor; its Q1 is **20 px**,
half the floor. Its median scale delta is 0.11, at the floor.

**Peak-speed ceiling (bay has no motion blur).** `peak_px_per_frame = v_peak × travel_px /
duration_frames`. Hard-edged graphics strobe above roughly 30 px/frame; text becomes an unreadable
smear above ~22 px/frame.

- anything the viewer may read during the move: **≤ 22 px/frame**
- solid shapes and grounds: **≤ 40 px/frame**
- above 40 px/frame: legal only while `opacity ≤ 0.35` (the seam trick — you cannot see the
  strobe on something that is 25% visible)

---

## 4. The 12 principles, costed in keyframes

bay's channels are `opacity, scale, scaleX, scaleY, x, y, rotation` (+ `volume` on audio), with
per-key easing. Everything below is expressible.

| principle | how, in bay | keyframe cost | what its absence looks like |
|---|---|---|---|
| **Slow in / slow out** | the channel easing | **0** (it is a field) | linear motion; the loudest amateur tell. wicks-v2 has this one and only this one. |
| **Anticipation** | 1 extra key before the main segment, moving *against* the travel by 12–18% of it over 3–5 frames on `ease-in` | **+1 key** | the move begins from a dead stop; the eye is not cued and misses the first third |
| **Follow-through** | 1 extra key at 102–106% of target at ~70% of the duration, returning on `ease-in-out` over 6–8f | **+1 key** | the element stops like a lift hitting the floor; nothing has mass |
| **Overlapping action** | offset the *settle* frames of a compound's parts by 4 / 8 / 12 frames | **0** (offsets only) | the group lands as one rigid block — a slide, not an arrival |
| **Secondary action** | a distinct element (rule, shadow, ghost) whose move is *caused by* the primary, starting 3–6f later on a softer curve | **+1 element, +2 keys** | the frame contains one event; nothing corroborates it |
| **Arcs** | different easing clusters on x and y (§2.4) | **0** | ruler-straight diagonals; robotic |
| **Squash & stretch** | `scaleY` ↑8% / `scaleX` ↓5% at peak velocity, resolving to 1.0 | **+2 keys** (2 channels) | rigid, weightless, plastic |
| **Timing** | the duration itself | 0 | one speed. wicks-v2's mode is 3 frames on 34% of its moves |
| **Staging** | ≤1 element in significant motion at a time | 0 | competing motion; the eye picks wrong |
| **Exaggeration** | amplitudes 2–3× what looks right in a still (§3.4 floors) | 0 | timid 20 px nudges nobody registers |
| **Straight-ahead vs pose-to-pose** | keyframes *are* pose-to-pose; do not densify | 0 (negative) | key-stuffing. wicks-v2 used 130 `hold` keys to satisfy a diversity counter |
| **Solid drawing / appeal** | not a motion property — layout and type | — | — |

**Total cost of a fully-principled entrance vs a bare one:** a bare opacity fade is 2 keys. A
principled entrance — anticipation + arc + follow-through + a secondary element — is **9 keys and
1 extra element**. That is the honest price. It is affordable because a 60s video needs about 8
of them, not 119.

### The anticipation ratio, adapted

Character animation uses **2:1:1** (anticipation : action : follow-through) and cites a normal
punch as 16f anticipation → 6f action → 8f follow-through
([School of Motion](https://www.schoolofmotion.com/blog/anticipation-principle-quick-tip)). **Do
not use those ratios here.** A graphic element has no muscles; the anticipation is a *cue*, not a
wind-up, and a 2:1 anticipation on a 20-frame entrance would be 40 frames of an element visibly
hesitating. The motion-graphics adaptation is **1:5 to 1:7**:

| element | anticipation | action | follow-through |
|---|---|---|---|
| type line | 3f, 14% of travel | 20f | 6f, 3% overshoot |
| card / panel | 4f, 12% | 24f | 8f, 4% |
| logo / hero | 5f, 18% | 24f | 8f, 6% |
| accent / punch | 2f | 6f | 4f |

---

## 5. Timing tables (30fps, 1080×1920 vertical)

### 5.1 Entrances

| what | nominal frames | seconds | curve | core frames |
|---|---|---|---|---|
| caption / kicker / small type | 16–20 | 0.53–0.67 | `ease-out` | 10.1–12.7 |
| body line, headline line | 20–24 | 0.67–0.80 | `power-out` | 10.0–12.0 |
| card, panel, hero figure | 24–30 | 0.80–1.00 | `spring-out` | 10.0–12.5 |
| full-frame surface / ground | 30–45 | 1.00–1.50 | `sine-in-out` | 17.7–26.6 |
| snappy reveal (mask/draw) | 30–36 | 1.00–1.20 | `expo-out` | 9.5–11.4 |
| stagger member #2..N | 17–20 | 0.57–0.67 | as #1 | 7.1–8.3 |

### 5.2 Exits — **55–70% of the matching entrance**

Sourced: entrances should be 30–50% longer than exits
([LottieFiles motion-design skill](https://github.com/LottieFiles/motion-design-skill/blob/main/skills/motion-design/SKILL.md)).

| what | nominal frames | curve |
|---|---|---|
| caption | 10–12 | `ease-in` |
| headline line | 12–14 | `power-in` |
| card / panel | 14–16 | `power4-in` |
| seam departure (under a cut) | 9–11 | `power4-in` |
| hard cut | 0 | `hold` |

### 5.3 Emphasis and accents (out-and-back only)

| what | frames | channels |
|---|---|---|
| TAP (landing accent) | 9 total (3 out, 6 back) | `scale` ±0.035 |
| THUMP (squash) | 13 | `scaleY` +0.08 / `scaleX` −0.05 |
| NUDGE (shake) | 8 | `x` +9 px, −5 px, 0 |
| TILT | 10 | `rotation` ±2.5° |
| BLINK | 3 | `opacity` on `hold` — the **only** legal sub-7-frame opacity change |

### 5.4 Transitions and seams

| what | frames | note |
|---|---|---|
| velocity-matched seam | 9–11 each side | both sides same distance, same duration, `power4-in`/`power4-out` |
| dissolve (`transition_add`) | 12–24 | clips must already overlap by that much |
| Z-swap (recede/arrive) | out 8, in 15 | never both visible |
| hard cut | 0 | correct for lists and percussive edits |

### 5.5 Holds — how long a thing must stay before it may leave

Anchored to Netflix's timed-text minimums: **5/6 s (25 frames) minimum per event, 7 s maximum,
20 characters/second reading speed**
([Netflix TTSG](https://partnerhelp.netflixstudios.com/hc/en-us/articles/360051554394-Timed-Text-Style-Guide-Subtitle-Timing-Guidelines)).

| element | minimum settled hold before exit | derivation |
|---|---|---|
| any element at all | **25 f (0.83 s)** | Netflix minimum event |
| a line of N characters | **max(25, 30 × N / 20) frames** | 20 cps |
| a headline (≈30 chars) | 45 f (1.5 s) | |
| a caption (≈60 chars) | 90 f (3.0 s) | |
| anything with a number to read | +15 f | numbers are read slower than words |

**Settled** means within 3 px of final position and at opacity ≥0.95. An element that is still
moving during its reading window has not started its hold.

---

## 6. Staggering

Sourced budgets: 30–80 ms between items, 50 ms typical, total under 400–600 ms, cap the group at
10–15 items ([hashbuilds](https://www.hashbuilds.com/patterns/what-is-stagger-animation),
[LottieFiles](https://github.com/LottieFiles/motion-design-skill/blob/main/skills/motion-design/SKILL.md)).
In frames at 30fps:

| cascade type | gap | decay | items | total spread | reads as |
|---|---|---|---|---|---|
| micro | 1 f | 1.00 | 3–5 | ≤4 f | one impact with texture |
| standard | 3 f | 0.86 | 4–7 | 8–13 f | a group arriving as one beat |
| wave | 2 f | 1.00 | 8–14 | 14–26 f | a ripple |
| dramatic | 5 f | 0.92 | 3–5 | 12–19 f | a list being dealt |
| narration-paced | 15–60 f | 1.00 | any | seconds | **not a stagger** — it is scheduling |

`decay` in `animate_many` multiplies each successive **gap** (`plan.rs:852-908`): 6 items at
stagger 3, decay 0.86 → gaps 3.00, 2.58, 2.22, 1.91, 1.64 → total spread **11.4 f (0.38 s)**, and
the last item finishes at 31.4 f (1.05 s).

**Rules:**
- **Total spread ≤ 18 f (0.6 s)** for a group that must read as one beat. Beyond ~26 f the viewer
  starts counting items instead of receiving a phrase.
- **The first member must clear the 10-core-frame floor; members 2..N may run at 7.**
- **Order by importance, not document order** — whatever moves first is read as most important.
- **A stagger over more than 14 items is a distraction,** not a cascade. Split into two groups
  with a beat between them.
- **Never stagger two groups concurrently.** Two overlapping cascades produce a frame with no
  focal point; that is a staging failure, not richness.
- **A stagger is one move for variety purposes.** It counts once against §3.3C, not N times.

**Trap (engine):** `animate_many` writes keys in **element-local** time. If the elements have
different `start`s, the tool's stagger *adds to* the difference in their starts and the cascade
silently becomes something else. Use `animate_many` only on elements that share a start.

---

## 7. Continuous life — solving the freeze

wicks-v2 has a **6.33-second** stretch with no perceptible motion anywhere, six stretches over
1 s, and 74% of its arrivals happen with the entire rest of the frame frozen. Round 1's answer
("prefer stillness; ±2px jitter is the only sanctioned aliveness") produced exactly this.

The correction is not "add ambient motion." It is a precise distinction round 1 did not make:

> **Oscillation is breathing. Monotone displacement is a camera.**
> An ambient channel that returns to its starting value is lazy breathing.
> An ambient channel that never returns is a camera move, and it is free.

That distinction is directly checkable: **count sign changes in the channel's derivative across
the hold.** Breathing has ≥2. A drift has 0. Jitter has many. This single test bans breathing and
jitter and permits drift and parallax, with no taste judgment required.

### 7.1 The five techniques, in bay's channels

**L1 — PARALLAX-DRIFT (the workhorse).** ≥2 depth layers translating at different rates. The
depth is entirely in the *ratio*; a uniform drift is a push and is banned.

| layer | x drift over 150 f (5 s) | ratio |
|---|---|---|
| ground / texture / rule strip | −6 px (0.0056) | 1.0× |
| card, panel, chart body | −16 px (0.0148) | 2.7× |
| foreground type | −34 px (0.0315) | 5.7× |

All on `sine-in-out`, all monotone. Sourced ratios: foreground motion_scale ≈1.0, mid 0.5–0.8,
background 0.1–0.3 ([Motion Array 2.5D](https://motionarray.com/learn/after-effects/animate-flat-2d-images-after-effects/)).
**Rule: adjacent-layer rate ratio ≥ 1.8×, else it is a push.**

**L2 — COUNTER-DRIFT.** Subject +9 px while its ground −22 px over 120 f. Cheaper than parallax
(2 elements), reads as depth, and doubles as a slow reveal because the relationship between the
two changes.

**L3 — MAKE-ROOM (the highest-value one).** When a new element arrives, the elements already on
screen **must move.** A stack shifts up 38 px over 14 f `power-out`, starting 2 f *before* the
arrival. This converts every arrival from a 1-element event into an N-element event and it is the
single biggest difference between wicks-v2 and a designed video. It is also what makes a
composition read as *accumulating* rather than as slides laid on top of each other.

**L4 — DIM-BACK.** The incumbent drops to opacity 0.55 and `scale` 0.97 over 12 f as the new
element lands. Staging by subtraction. Note this is opacity used *correctly*: as a response, not
as an entrance.

**L5 — CREEP (terminal drift).** After an element settles, it continues **0.4% of the canvas in
its arrival direction** over 90 f on `sine-in-out` and never comes back. The motion is below
conscious notice and above the encoder's floor; it keeps the frame from being literally identical
frame to frame without anyone being able to name what is moving.

**L6 — internal motion of the subject.** A bar still filling (`scaleX` 0→1 over 105 f
`power-out`, core 53 f), a counter still stepping, a rule still drawing. Not ambient — the subject
doing its job slowly.

### 7.2 The two clocks

Both must hold, everywhere:

- **Ambient clock — no interval > 60 frames (2.0 s) with zero perceptible change anywhere.**
  Perceptible = a channel whose value moves ≥0.25% of the relevant canvas dimension, or ≥0.05
  opacity, or ≥0.01 scale, across the interval.
- **Event clock — no interval > 180 frames (6.0 s) without an L1 *event*:** an arrival, a
  departure, or a MAKE-ROOM/DIM-BACK response. Drift alone cannot satisfy this.

### 7.3 The anti-breathing caps

- ≤ **3** elements drifting concurrently.
- Drift amplitude within **[0.25%, 3.5%]** of the canvas per 150 frames. Below the floor the
  encoder discards it; above the ceiling it is a pan and it fights the reader.
- **0 derivative sign changes** across the drift.
- The most recently arrived text element **may not drift for its first 45 frames** — the viewer is
  reading it.
- Drift easing is `sine-in-out` or `linear` only. A drift on `expo-out` is not a drift.

---

## 8. Exits

Nobody thinks about exits; wicks-v2 proves it. 77 of 119 exits are opacity-only, 67 of them use
`ease-out` — a *decelerating* curve on a departure, so the element slows down as it vanishes and
spends its last frames crawling at low contrast — and 37 elements have no exit at all.

### 8.1 An exit is not a reversed entrance

They answer different questions.

| | entrance | exit |
|---|---|---|
| the question | "where should I look?" | "stop looking here — look *there*" |
| curve direction | `-out` (decelerate into place) | `-in` (accelerate away) |
| duration | 100% | **55–70%** |
| direction | from wherever creates the best arc into position | **toward the next thing, or out of its way** — *never* back the way it came |
| ordering in a group | most important first | **least important first; the subject leaves last or not at all** |
| opacity | rides, reaching 1.0 by 50% of the move | rides, reaching 0 by **60–75%** of the move, so the last frames are travel you cannot see |
| overlap with the neighbouring event | starts after the previous settle | **overlaps the next entrance by 30–60%** |

A reversed entrance sends the eye back to where the element came from, which is off-frame and
away from wherever the next thing will appear. That is the mechanical reason reversed entrances
feel wrong even when every number is right.

### 8.2 Exit rules

1. **Every element exits deliberately or is explicitly a hard cut.** "The clip just ends" is a
   third thing and it is always wrong at a seam, because the last frame of a clip that ends is
   indistinguishable from a rendering failure. 37 elements in wicks-v2 do this.
2. **Kill opacity early.** Opacity reaches 0 at 60–75% of the exit's duration on `expo-in`, so
   the fastest, ugliest part of the travel happens invisibly. This is also what makes a >40 px/f
   departure legal (§3.4).
3. **Exits stagger in reverse importance**, gap 3–4 f — the mirror of the entrance order.
4. **Never a full-frame exit.** Travel 180–260 px and let opacity finish the job. Travelling
   fully off-frame costs 3× the frames and looks like the element is escaping.
5. **The best exit is often a `hold`**, and the second best is *no exit* — the subject stays and
   becomes the next scene's anchor. A video where everything leaves is a video with no memory.
6. **Never let the frame empty.** The last exit of a scene must start *after* the first entrance
   of the next has begun. Overlap 30–60%.

---

## 9. The named move vocabulary

Notation: `f` = frames at 30fps (`t` in `animate` is seconds = f/30, **relative to the element's
start**). Values in canvas fractions for 1080×1920 with the pixel equivalent in brackets. `core`
= perceptible frames from §2.1. `pk` = peak px/frame. Every entrance below clears core ≥ 10.

### Entrances

**E1 · LIFT** — type rises into place. The house entrance.
| ch | f | value | easing |
|---|---|---|---|
| `y` | 0 | target + 0.0313 [+60 px] | `spring-out` |
| `y` | 24 | target | — |
| `opacity` | 0 | 0 | `linear` |
| `opacity` | 9 | 1 | — |

4 keys · core 10.0 f · pk 7.4 px/f · travel floor: use `max(0.75×fontSize, 40 px)`.
*Wrong for:* anything under 24 px type (the settle is invisible); more than 3 per second.

**E2 · DROP** — arrives from above. Heavier than LIFT; use for things that "land".
| ch | f | value | easing |
|---|---|---|---|
| `y` | 0 | target − 0.0375 [−72 px] | `power-out` |
| `y` | 20 | target | — |
| `opacity` | 0 | 0 | `linear` |
| `opacity` | 7 | 1 | — |

4 keys · core 10.0 f · pk 10.8 px/f.

**E3 · SWEEP** — enters laterally. Alternate the side between neighbours.
| ch | f | value | easing |
|---|---|---|---|
| `x` | 0 | target ± 0.1111 [±120 px] | `power-out` |
| `x` | 20 | target | — |
| `opacity` | 0 | 0 | `linear` |
| `opacity` | 8 | 1 | — |

4 keys · core 10.0 f · pk 18.0 px/f.

**E4 · PRESS** — scale down *to* 1.0 from above. Arrives from in front of the viewer. wicks-v2
never once did this; it is the most under-used entrance in the set.
| ch | f | value | easing |
|---|---|---|---|
| `scale` | 0 | 1.14 | `power-out` |
| `scale` | 20 | 1.00 | — |
| `opacity` | 0 | 0 | `linear` |
| `opacity` | 9 | 1 | — |

4 keys · core 10.0 f · edge pk ≈7.4 px/f on a 700 px-wide card.
*Wrong for:* small type (starts oversized and crops); anything near a frame edge.

**E5 · SWELL** — arrives from behind. Pair with a slight rise so the path is not purely radial.
| ch | f | value | easing |
|---|---|---|---|
| `scale` | 0 | 0.78 | `spring-out` |
| `scale` | 24 | 1.00 | — |
| `y` | 0 | target + 0.0125 [+24 px] | `power-out` |
| `y` | 24 | target | — |
| `opacity` | 0 | 0 | `linear` |
| `opacity` | 10 | 1 | — |

6 keys · core 10.0 f.

**E6 · ARC-IN** — the only entrance with a curved path. Different easing clusters per axis.
| ch | f | value | easing |
|---|---|---|---|
| `x` | 0 | target + 0.1296 [+140 px] | **`linear`** |
| `x` | 20 | target | — |
| `y` | 0 | target + 0.0469 [+90 px] | **`power-out`** |
| `y` | 20 | target | — |
| `opacity` | 0 | 0 | `linear` |
| `opacity` | 8 | 1 | — |

6 keys · max |`linear` − `power-out`| = **0.385**, so bow = `dx·dy·0.385/L` = **29 px** on this
166 px chord (17.5%; 19.2% at a 45° chord) · x core 16.0 f, y core 10.0 f.
*This is the move that makes an agent's output stop reading as generated.* Nothing in wicks-v2
travels a curve.

**E7 · UNVEIL** — a mask wipe. `mask_set` geometry is static, so the element travels under it.
```
mask_set { elementId, shape: "rect", x: 0.5, y: <band centre>, width: 0.86,
           height: 0.075, feather: 0 }
```
| ch | f | value | easing |
|---|---|---|---|
| `y` | 0 | band bottom + 0.0547 [+105 px] | `expo-out` |
| `y` | 32 | target | — |

2 keys · core 10.1 f · pk 22.7 px/f · **`opacity` stays at 1 throughout.** A fade over a wipe
makes it look like neither.

**E8 · SPLIT** — two halves from opposite sides, offset by 3 f so they do not meet symmetrically.
| ch | element | f | value | easing |
|---|---|---|---|---|
| `x` | left half | 0 / 24 | target − 0.0889 [−96 px] → target | `power4-out` |
| `x` | right half | 3 / 27 | target + 0.0889 → target | `power4-out` |

4 keys · core 9.9 f · pk 16.0 px/f.

**E9 · COIL** — LIFT with anticipation. +1 key.
| ch | f | value | easing |
|---|---|---|---|
| `y` | 0 | target + 0.0313 [+60 px] | `ease-in` |
| `y` | 4 | target + 0.0396 [+76 px] | `spring-out` |
| `y` | 28 | target | — |
| `opacity` | 0 | 0 | `linear` |
| `opacity` | 10 | 1 | — |

5 keys · anticipation 27% of a 60 px travel over 4 f · core 10.0 f.

**E10 · WIND-UP** — rotational anticipation. For a badge, a stamp, a logo.
| ch | f | value | easing |
|---|---|---|---|
| `rotation` | 0 | −7.0 | `ease-in` |
| `rotation` | 4 | −11.0 | `power-out` |
| `rotation` | 24 | 0 | — |
| `scale` | 0 | 0.88 | `spring-out` |
| `scale` | 26 | 1.00 | — |

5 keys · rotation core 10.0 f.

**E11 · LAND** — entrance with follow-through. The overshoot is hand-keyed, so its amplitude is
yours instead of `back-out`'s fixed 10%.
| ch | f | value | easing |
|---|---|---|---|
| `y` | 0 | target + 0.0417 [+80 px] | `power-out` |
| `y` | 18 | target − 0.0021 [−4 px] | `ease-in-out` |
| `y` | 26 | target | — |

3 keys · overshoot **5% of travel** · core ≈9.0 + settle. Recommended overshoot: type 2–4%,
cards 3–6%, playful 8–15%.

### Emphasis and accents — out-and-back only, net displacement 0

**A1 · TAP** — the landing accent. Never primary, never more than one per scene.
`scale`: f0 1.000 `ease-out` → f3 1.035 `ease-in-out` → f9 1.000. 3 keys.

**A2 · THUMP** — squash and stretch at the landing.
`scaleY`: f0 1.00 `power-out` → f3 1.08 `ease-in-out` → f7 0.96 `ease-out` → f13 1.00
`scaleX`: f0 1.00 `power-out` → f3 0.95 `ease-in-out` → f7 1.03 `ease-out` → f13 1.00
8 keys, 2 channels. Volume is preserved (a stretch in y is a squash in x), which is what makes it
read as mass rather than as a wobble.

**A3 · NUDGE** — a shake, for a negative or contradicting beat.
`x`: f0 0 `power-out` → f3 +0.0083 [+9 px] `ease-in-out` → f6 −0.0046 [−5 px] `ease-out` → f8 0.
4 keys.

**A4 · TILT** — `rotation`: f0 0 `power-out` → f4 2.5 `ease-in-out` → f10 0. 3 keys.

**A5 · BLINK** — `opacity`: f0 1 `hold` → f1 0 `hold` → f3 1. 3 keys. The **only** legal
opacity change shorter than 7 frames, because `hold` makes it an explicit cut rather than a
3-frame ramp.

### Secondary action and follow-through

**S1 · UNDERSCORE** — a 4 px rule that draws *after* the word it belongs to has settled.
Shape with `anchorX: 0`. `scaleX`: f0 0 `hold` → f_settle+5 0 `expo-out` → f_settle+19 1.
3 keys, 1 element. Starting it before the word settles destroys the causality that makes it a
secondary action.

**S2 · TRAIL** — a duplicate at `opacity` 0.22 running the same path 4 f behind with 1.06× the
travel, landing at the same frame. Reads as motion blur bay cannot render. 1 element, same key
count as its parent.

**S3 · LAG-SETTLE** — a compound (headline / rule / caption) settling at f20 / f24 / f28 instead
of together. 0 extra keys. Without it the group is one rigid block.

**S4 · SHADOW-CATCH** — an offset rect behind a card: same move, +3 f delay, +8% travel,
`ease-out` where the card uses `power-out` (a softer cluster, so it visibly lags).

### Groups

**G1 · CASCADE** — the default group arrival.
```
animate_many { elementIds: [by importance], property: "y",
               from: <target + 0.0281 [+54 px]>, to: <target>,
               duration: 0.667 (20 f), at: 0.0, stagger: 0.100 (3 f),
               decay: 0.86, easing: "power-out" }
```
6 items → spread 11.4 f (0.38 s), last settles at 31.4 f. Core 10.0 f each.
Second call for `opacity` 0→1 over 8 f `linear` at the same stagger.

**G2 · WAVE** — 8–14 items, stagger 2 f, decay 1.00, duration 22 f `ease-out` (core 13.9 f).
Spread 26 f. Use when the items are equal in weight (a word cascade); the even gaps are the point.

**G3 · COUNTER-CASCADE** — odd items from `+x`, even items from `−x`, same stagger. Two
`animate_many` calls. Satisfies §3.3C direction diversity by construction.

### Continuous life

**C1 · PARALLAX-DRIFT** — 3 layers, `x`, 150 f, `sine-in-out`, monotone: −6 px / −16 px / −34 px
(ratios 1.0 / 2.7 / 5.7). 2 keys per layer.

**C2 · COUNTER-DRIFT** — subject `x` +9 px while ground `x` −22 px over 120 f `sine-in-out`.
4 keys total.

**C3 · MAKE-ROOM** — the incumbent stack shifts to open a slot for an arrival.
`y`: f0 current `hold` → f(arrival−2) current `power-out` → f(arrival+12) current − 0.0198
[−38 px]. 3 keys per incumbent. **The highest-value technique in this section.**

**C4 · DIM-BACK** — incumbent `opacity` 1.00 → 0.55 over 12 f `ease-out` and `scale` 1.00 → 0.97,
at the arrival. 4 keys.

**C5 · CREEP** — terminal drift: after settle, continue **0.4% of canvas** in the arrival
direction over 90 f `sine-in-out`, never returning. 2 keys appended to the existing channel.

**C6 · FILL** — the subject still working: `scaleX` 0 → 1 over 105 f `power-out` with
`anchorX: 0` (core 53 f). Satisfies both clocks on its own for 3.5 s.

### Exits

**X1 · DUCK** — the default exit.
`y`: f0 target `power-in` → f11 target + 0.0156 [+30 px]
`opacity`: f2 1 `ease-in` → f11 0
4 keys · duration 11 f = 55% of a 20 f entrance.

**X2 · SWEEP-OUT** — leaves toward the next thing.
`x`: f0 target `power4-in` → f10 target ± 0.176 [±190 px]
`opacity`: f0 1 `expo-in` → f7 0 (opacity gone at 70% of the travel)
4 keys · pk 75.8 px/f, legal because opacity ≤0.35 by f5.

**X3 · RECEDE** — `scale` 1.00 → 0.90 `power-in` over 12 f; `opacity` 1 → 0 `ease-in` over 10 f.
4 keys. For a chapter change, paired with the next scene's E5.

**X4 · SNAP** — `hold`. Zero frames. Correct for rapid-fire lists, percussive edits, and any
element the narration has finished with.

**X5 · DISPERSE** — group exit in **reverse importance order**, gap 3 f, each on X1 or X2, the
subject last or not at all.

### Seams

**M1 · WHIP-SEAM** — the velocity-matched cut. Both sides identical distance and duration.
| | ch | f | value | easing |
|---|---|---|---|---|
| outgoing | `x` | 0 → 9 | 0 → −0.213 [−230 px] | `power4-in` |
| outgoing | `opacity` | 0 → 3 | 1 → 0 | `linear` |
| incoming | `x` | 0 → 9 | +0.213 → 0 | `power4-out` |
| incoming | `opacity` | 0 → 4 | 0.35 → 1 | `linear` |

Both sides peak at 3.99 × 230/9 = **102 px/frame**, which would strobe badly — and does not,
because both are below 0.35 opacity through the fast third. That is why the trick works, and why
substituting `ease-in` (peak 2.00×) for `power4-in` breaks it: the velocities no longer match at
the cut.

**M2 · Z-SWAP** — outgoing `scale` 1.00 → 1.18 `power-in` 8 f with `opacity` → 0.10; incoming
`scale` 0.76 → 1.00 `expo-out` 30 f with `opacity` 0.10 → 1. Never both visible.

**M3 · SHUNT** — no entrance and no exit: the whole stack translates by exactly one slot height
(`y` −0.10 [−192 px]) over 22 f `power-out`, and a new element is already sitting in the vacated
slot at opacity 1. The cheapest way to advance a list without a slideshow.

---

## 10. The executable rule set

Every rule is stated as a threshold on the project model unless marked **[frame]**. `Gaming` is
what an agent that optimised only for this rule would ship.

| # | rule | threshold | catches in wicks-v2 | gaming | counter |
|---|---|---|---|---|---|
| **M1** | core-frame floor | `core_span(easing) × frames ≥ 10` (first move) / `≥ 7` (group member 2..N) | **76 segments** | make everything 30 f — video becomes syrup | pair with M2 tempo spread and §5.5 hold minimums |
| **M2** | no dead-zone tweens | a value-changing segment is `hold` (0 f) or ≥7 nominal frames | 76 | convert all pops to `hold` — legal, and a *better* video than the pops | none needed; this is a win either way |
| **M3** | opacity may not lead | for every element, the entrance window must contain a geometric channel whose amplitude clears §3.4 | **109 of 119** | add a 40 px `y` to everything → conveyor belt | M6 direction diversity + M4 amplitude scaling with fontSize |
| **M4** | amplitude floors | `y ≥ max(0.75×fontSize, 40 px)`, `x ≥ max(0.5×width, 64 px)`, `scale Δ ≥ 0.10`, `rotation ≥ 2°` | median travel 30 px | use exactly the floor everywhere | M7 requires a ≥2.5× spread in travel distances |
| **M5** | channel distribution | opacity ≤40% of channels; x+y ≥30%; scale-family ≥15% | opacity 90% | animate `scaleX` on every element by 0.001 | M4 floors apply per segment, not per channel |
| **M6** | entrance-direction diversity | in any 90 f window with ≥3 entrances: ≥2 direction classes, none >65% | 1 class | alternate ±x mechanically | M11 (staging) caps concurrent motion; a human reads alternation as a conveyor and M12 catches it in frames |
| **M7** | tempo spread | across a scene's moves, `p90(core_frames) / p10(core_frames) ≥ 2.5` | 0.1s/0.25s mode ⇒ ratio ≈1.0 within the mass | one 90 f outlier + everything else identical | use **p90/p10**, not max/min — an outlier cannot move a decile |
| **M8** | curve variety by cluster | ≥4 of the 9 clusters (§2.2) used, none >45% of segments | `ease-out` 103/245 = 42%… **passes** — tighten to 35% | pick 4 clusters arbitrarily | weight by segments *and* require M1, which rules out most short-curve choices |
| **M9** | arcs | any element animating x and y in one window: different clusters, computed bow ≥8% of chord | 3 elements affected | use `linear`/`sine-in-out` (10.5% divergence) as the "different" pair | require different *clusters*, and `linear`+`sine-in-out` are the same cluster |
| **M10** | ambient clock | no interval >60 f with zero perceptible change | 6 intervals, max 6.33 s | give everything a drift | M13 caps (≤3 concurrent, 0 sign changes, ≤3.5%/150 f) |
| **M11** | event clock | no interval >180 f without an arrival, departure or response | passes today — arrivals exist | insert 1-frame invisible elements | an "arrival" requires area ≥0.5% canvas, opacity ≥0.35, duration ≥25 f, and for text fontSize ≥24 px |
| **M12** | response coefficient | ≥50% of arrivals have ≥1 already-present element changing within ±12 f (excluding that element's own entrance/exit) | **26%** | fade a decorative dot on every arrival | require the responder to be a *picture* element with area ≥1% canvas that is on screen ≥45 f either side |
| **M13** | no breathing | an ambient channel must have 0 derivative sign changes and amplitude in [0.25%, 3.5%] per 150 f | n/a (nothing drifts) | one-way drift on everything, forever | ≤3 concurrent drifters; newest text may not drift for 45 f |
| **M14** | no push | if ≥2 layers drift, adjacent rate ratio ≥1.8× | n/a | set ratios to exactly 1.8 | harmless — 1.8× *is* parallax |
| **M15** | exits | ≥60% of elements exit with a geometric channel or an explicit `hold`; exit curve is an `-in` cluster; exit frames = 55–70% of the entrance | 67 exits on `ease-out`; 37 no exit | give everything an X4 `hold` | pair with M16: the frame may not empty |
| **M16** | no dead air at a seam | the last exit must start after the first entrance of the next beat begins; overlap 30–60% | 6 dead runs | overlap everything 100% | ≥30% *and* ≤60% — both bounds |
| **M17** | settle before reading | an element is within 3 px of final and ≥0.95 opacity for ≥12 f before its narration cue | not measured | delay all cues | narration cue times come from `narrate`, which the agent does not control |
| **M18** | hold minimum | settled hold ≥ `max(25, 30×chars/20)` frames before any exit | median element 9.9 s (fine); 30 elements <1.1 s | inflate all holds | M11 event clock forbids >6 s without an event |
| **M19** | peak speed | ≤22 px/f for readable text, ≤40 px/f for shapes, unrestricted only while opacity ≤0.35 | not violated (everything is too slow) | slow everything down | M1 core floor + M7 spread |
| **M20** | stagger budget | group spread ≤18 f; ≤14 items; ≤1 group in flight at a time | n/a | one giant stagger per scene | M6 direction diversity counts the group once, so a stagger cannot be the only entrance type |
| **M21** | windowed evaluation | **every rule above evaluates on a sliding 150-frame window, not on `spans()`** | `spans()` returns one 62 s bucket ⇒ every pacing check dead | author one main-track clip | this rule *is* the counter — remove the dependency on main-track structure |

**[frame] checks worth adding** (cheap, and they catch what the model cannot see):

| check | method | catches |
|---|---|---|
| frame-pair identity | `snapshot` 15 f apart, compare; >0.02% differing pixels required | the freeze, directly |
| motion-energy curve | mean absolute luma difference between consecutive sampled frames, plotted over the video | the 6.33 s hole, and the 3-frame spikes, in one graph |
| transit sampling | for each declared move, sample its midpoint frame; the element must be measurably between its endpoints | a `hold` masquerading as a tween, and any easing that has already finished by the midpoint (`expo-out` at ≤10 f: 50% done at frame 1) |

---

## 11. Engine gaps

| gap | why it matters | effort | unlocks |
|---|---|---|---|
| **Additive / relative channels** (`animate` mode `"add"`, or a second layerable channel per property) | Today an ambient drift and an entrance on the same property must be hand-merged into one key list, with the agent tracking absolute positions. This is *the* reason nothing drifts and nothing responds: C3 MAKE-ROOM, C5 CREEP and C1 PARALLAX-DRIFT each require rewriting the element's whole channel. | medium | §7 in full — the freeze fix |
| **`animate_many` cannot vary `from`/`to` per element** (`plan.rs:836-894` takes scalars) | The decaying-distance cascade the skill already documents (80→60→50→25→12 px) is not expressible in one call. `decay` only multiplies the *gap*. | small | G1/G2 as single calls; distance decay |
| **`animate_many` staggers in element-local time** | Silently does nothing (or something else) when the elements have different `start`s. No error is raised. | small | correctness of every group reveal |
| **No velocity-coupled directional blur** | Caps every move at ~22–40 px/frame (§3.4) and makes the whip seam depend on hiding the fast third under opacity. | large | fast moves, whip pans, real impact |
| **`spring-out` is fixed (ω=8, ζ=1); `back-out` is fixed at 10% overshoot** | Overshoot must be hand-keyed (E11) to get 2–6%; a heavier or lighter settle is not expressible, so every sprung element in a project has identical implied mass. | small | weight differentiation between elements |
| **`rotation` pivots on the quad centre only** | No hinge, pendulum, or pivot-swing family. `anchorX/anchorY` govern scale but not rotation. | small–medium | E10 variants, hinged reveals, dial/needle moves |
| **No `letterSpacing` / per-character elements** | The entire kinetic-type family is off the table; TYPE-ON costs one element per prefix. | large | kinetic typography |
| **`check.rs` `spans()` derives pacing windows from main-track clips** (`check.rs:572-601`) | One main-track element ⇒ one bucket ⇒ `front-loaded`, `inert-scene`, `no-accumulation`, `monotone-*` all arithmetically incapable of firing. This is why a 61-second single-scene video passed everything. | small | every pacing rule in §10 |
| **No `core_span` awareness anywhere** | Nominal duration is what the tool, the skill and the checker all reason about; the perceptible duration is 27–80% of it depending on the curve. | small | M1, M7, M8 — the whole duration doctrine |

---

## Sources

- [Cronin et al., *Eye Movements in Real-World Scene Photographs* (PMC6971407)](https://pmc.ncbi.nlm.nih.gov/articles/PMC6971407/) — fixation 200–300 ms (mean 298 ms), 3–4 fixations/s, saccade latency ≈200 ms
- [Netflix Timed Text Style Guide — Subtitle Timing](https://partnerhelp.netflixstudios.com/hc/en-us/articles/360051554394-Timed-Text-Style-Guide-Subtitle-Timing-Guidelines) — 5/6 s minimum event, 7 s maximum, 20 cps
- [Material Design 3 — Easing and duration tokens](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs) — 150/300/600 ms; emphasized-decelerate for on-screen arrivals
- [Carbon Design System — Motion](https://carbondesignsystem.com/elements/motion/overview/) — duration scales non-linearly with distance; productive vs expressive
- [LottieFiles motion-design skill](https://github.com/LottieFiles/motion-design-skill/blob/main/skills/motion-design/SKILL.md) — per-element durations, "entrances 30–50% longer than exits", "never opacity-only for important state changes", stagger budgets, overshoot by archetype
- [What is Stagger Animation](https://www.hashbuilds.com/patterns/what-is-stagger-animation) — 30–80 ms gaps, 10–15 item cap
- [School of Motion — Anticipation](https://www.schoolofmotion.com/blog/anticipation-principle-quick-tip) and [Follow Through](https://schoolofmotion.com/blog/animation-tricks-follow-through-after-effects) — 2:1:1 character ratio, 16/6/8 frame punch
- [Motion Array — 2.5D parallax](https://motionarray.com/learn/after-effects/animate-flat-2d-images-after-effects/) — layer motion_scale 1.0 / 0.5–0.8 / 0.1–0.3
- [NN/g — Executing UX Animations](https://www.nngroup.com/articles/animation-duration/)
- bay: `rust/crates/bay-project/src/element.rs:113-217` (easings), `rust/crates/bay-agent/src/plan.rs:826-917` (`animate_many`), `rust/crates/bay-core/src/check.rs:572-983` (spans, pacing, motion checks)
- Measured: `~/Library/Application Support/vii/projects/project-1786466680050.json`
