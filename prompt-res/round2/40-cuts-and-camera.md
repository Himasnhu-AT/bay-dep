# Cuts, transitions, camera, and the seam between beats

Round 2. Area: **the edit**. Everything here is measured against
`project-1786466680050.json` (wicks-v2), the bay source on `fix/pending-sweep`, or a cited
source. Round-1 findings (`prompt-res/05-cuts-transitions-camera.md`) are assumed read and are
not repeated — where round 1 was wrong or unusable I say so and give the replacement.

**Sibling dependency:** `round2/23-engine-truth.md` §7 already established the scene-model
mechanics (`export_video` takes one `&Scene`; no scene MCP tool; `check` reads
`active_scene()`). I build on that rather than re-deriving it. My §7 is about the *beat* object
and the tool surface, which is a different question from "do scenes concatenate".

---

## 0. Headline

wicks-v2 has **five seams in 61 seconds, and all five are the same 0.30 s crossfade.** Two of
them additionally carry a textbook velocity-matched cut, executed correctly, from the skill's
own recipe — and the other three do not, because a velocity-matched seam costs **one tool call
per element per side** and those three beats had 14–23 elements each. The agent did not fail to
know the grammar. It priced the grammar, found it cost more than its whole animation budget,
and fell back to the free one (`fade_set`). **The edit is missing because the correct edit is
O(N) in tool calls and the wrong edit is O(1).**

Second finding, equally mechanical: **every one of the five cuts lands inside a 2.6–4.4 s hole
in the narration.** Picture and sound change at the same instant, every time, with silence on
both sides. That is the definition of a butt cut, and it is why the video reads as slides even
at the two seams where the motion was right.

---

## 1. Measured forensics of the five seams (new evidence)

### 1.1 The seams

Derived from element arrival/exit clusters. `T` = ticks/120000 (`bay-time/src/media_time.rs:7`).

| # | seam t | beat length | headline (Baskerville) / hero (Menlo) | outgoing elements | incoming | transition used |
|---|---|---|---|---|---|---|
| — | 0.00 | 8.40 s | "A day becomes / four numbers." | — | 12 | fade up from nothing |
| 1 | 8.40 | 9.60 s | "High minus low. / Nothing more." + `4.20` | 2 (+4 exit 8.72) | 8 | **cut-the-curve, both halves** + crossfade |
| 2 | 18.00 | 15.30 s | "Same range. / Different day." | 18 | 14 | crossfade only |
| 3 | 33.00 | 12.20 s | `W = R − \|r\|` | 7 | 9 | crossfade only |
| 4 | 45.20 | 9.40 s | "Squared, it's / a variance." + `W²` | 16 | 9 | crossfade only |
| 5 | 54.60 | 6.40 s | `W = R − \|r\|` (reprise) | 9 | 8 | **cut-the-curve, both halves** + crossfade |

Beat lengths 8.4 / 9.6 / 15.3 / 12.2 / 9.4 / 6.4 s → longest:shortest **2.4×**, CV 0.28. The
*beat* rhythm is defensible. What is missing is any cut **inside** a beat: the 15.3 s beat at
t=18.0 contains zero frame replacements.

### 1.2 The two correct cuts, measured

At t = 8.40 and t = 54.60 the agent produced this, exactly:

```
exit :  head1  x  0.089 → −0.124   over 0.300 s   power4-in    (v̄ = −0.710 canvas/s)
        kicker1 x 0.089 → −0.124   over 0.300 s   power4-in    (offset +0.03 s)
entry:  head2  x  0.302 →  0.089   over 0.300 s   power4-out   (v̄ = −0.710 canvas/s)
        kicker2 x 0.302 →  0.089   over 0.300 s   power4-out
```

Δ = 0.213 canvas widths = **230 px on 1080** — the literal number from
`.claude/skills/bay/references/motion.md`. Same distance, same duration, mirrored `.in`/`.out`,
same direction. This is a correct velocity-matched seam and there is no craft problem with it.

*(Correction to round 1: `05-cuts-transitions-camera.md` states "≈3,070 px/s for 230 px over
0.3 s". Mean velocity is 230/0.3 = **767 px/s**; ~3,000 px/s is the instantaneous peak of a
quartic at u=1. Quote the mean or say "peak" — the number as written is wrong by 4× and an
agent copying it will size the wrong move.)*

### 1.3 Why the other three seams are crossfades

Seams 2, 3 and 4 involve 14–23 elements each, all at different `x`. To move them together:

- `animate_many` takes an **absolute** `from`/`to` shared by every element
  (`bay-agent/src/plan.rs:836-837`) and writes `channel.upsert(secs(0.0), from)` at t=0
  (`plan.rs:891`), so calling it on a group with differing `x` **collapses them all onto one
  x**. It cannot express "move each element by −0.213 from wherever it is".
- Therefore a group seam = one `animate` call per element per side.

| seam | elements out | elements in | `animate` calls for a proper cut | what it actually cost |
|---|---|---|---|---|
| 1 | 2 | 2 | 4 | 4 (done) |
| 2 | 18 | 14 | 32 | 0 (`fade_set` on both sides) |
| 3 | 7 | 9 | 16 | 0 |
| 4 | 16 | 9 | 25 | 0 |
| 5 | 2 | 2 | 4 | 4 (done) |
| | | | **81 calls** | 8 |

The session spent **94 `animate` + 24 `animate_many` = 118 motion calls** in total
(455 tool calls, 401 of them bay). Doing all five seams properly would have added **81 calls,
+69% on the motion budget.** The agent's fallback is not laziness; it is the only affordable
option in the tool surface as it exists.

### 1.4 The wash window — a measurable defect nobody has named

`fade_gain` is **linear** (`bay-project/src/element.rs:796-814`) and the agent used `fade_set`
on both sides of each seam (21 `fade_set` calls, 0 `transition_add` calls). Two independently
alpha-composited layers each at 0.5 cover 1−(1−0.5)² = 0.75 of the ground, so the middle of a
two-sided crossfade shows the flat `#0E0E12` background through everything.

Measured (opacity channels evaluated with the per-key easing, × `fade_gain`, text elements only):

| seam | window where **no** text element is at ≥0.95 opacity | frames @30 |
|---|---|---|
| 0.00 (open) | 0.00 → 0.95 s (nothing on screen at all until 0.55) | **28** |
| 8.40 | none | 0 |
| 18.00 | none (a caption survives) | 0 |
| 33.00 | none | 0 |
| 45.20 | 45.25 → 45.47 | **7** |
| 54.60 | 54.55 → 54.77 | **7** |

`transition_add` already solves this and was never called: it sets `fade_in` on the **incoming
clip only** and leaves the outgoing playing at full underneath
(`bay-agent/src/plan.rs:1557-1568`, comment included). The tool exists, is registered
(`plan.rs:72`), is documented (`tools.rs:539`), and was used zero times.

### 1.5 The seam sound and the voice

| seam | nearest sound onset | voice ends before | voice starts after | gap in speech |
|---|---|---|---|---|
| 8.40 | whoosh −0.380 | 5.80 (−2.60) | 9.00 (+0.60) | 3.20 s |
| 18.00 | whoosh −0.250, subdrop −0.080, click +0.230 | 14.38 (−3.62) | 18.80 (+0.80) | 4.42 s |
| 33.00 | whoosh −0.250, click +0.080 | 29.10 (−3.90) | 33.80 (+0.80) | 4.70 s |
| 45.20 | whoosh −0.250, whoosh +0.400 | 40.77 (−4.43) | 46.00 (+0.80) | 5.23 s |
| 54.60 | whoosh −0.380 | 50.62 (−3.98) | 55.60 (+1.00) | 4.98 s |

**0 of 5 cuts land while the voice is sounding. 0 J-cuts. 0 L-cuts.** Narration covers
36.15 s of 61.0 s = **59%**; 22.5 s of the remaining silence sits in these five holes. Every
seam is: voice stops → ~3 s of music → whoosh → picture changes → ~0.8 s → voice restarts.
That structure is what "slideshow" *is*, independent of how the pixels moved.

---

## 2. The cut

### 2.1 Why the hard cut is the default

A cut costs zero frames of screen time and zero tool calls. Every other transition spends
frames the video does not get back and asks the viewer to watch a *mechanism* instead of the
content. The rule that follows: **a transition must be justified by a meaning the cut cannot
carry** (time passing, softening, a register change). "It looked abrupt" is not a
justification; abrupt is the point.

**In bay a hard cut is free and exact.** The renderer selects layers with
`element.start() <= playhead && playhead < element.end()`
(`bay-preview/src/lib.rs:1660`), and export samples the playhead at `start + index/fps`
(`lib.rs:1533`). So two clips butt-joined at the same tick produce **no blank frame and no
double-exposed frame** — A shows on the frame before, B on the frame at the join. There is no
need to overlap, and no `transition_add` call, to get a clean cut.

**Corollary rule (frame grid):** picture events quantize to `k/fps`; audio does not
(`bay-audio/src/lib.rs:122` mixes at sample resolution). A cut authored at 8.410 s renders at
frame 253 = 8.4333 s while its whoosh fires at 8.410 s exactly — **0.023 s of accidental
pre-lap**. Author every cut time and every move duration as an exact multiple of `1/fps`.
wicks-v2's modal move duration, 0.098 s, is 2.94 frames; it is not on the grid and never was.

### 2.2 What determines cut placement

Ranked by how much they buy, with the check in the right column.

| Placement rule | Numbers | How bay checks it |
|---|---|---|
| **Cut on the word.** The cut lands within ±2 frames of a stressed syllable / a named noun in the narration. | ±0.067 s | needs word timings — `narrate` already produces them for captions; expose them |
| **Cut while the voice is sounding.** ≥70% of cuts fall inside a narration clip, not in a gap. | measured: 0/5 | model-only, exact |
| **Cut on action.** The cut lands at the peak-velocity frame of a move that began before it. | overlap 2–5 frames is the film convention (≈83–208 ms @24) [Grokipedia, *Cutting on action*] | model-only: a moving keyframe segment must straddle the cut |
| **Cut on the beat.** Within ±1 frame of a music beat. | ±0.033 s | needs a beat grid (bay has none — see §9 gaps) |
| **Never cut in silence with silence on both sides.** | — | model-only, exact |

The perceptual reason the first three work: a saccade lasts 150–200 ms and vision is
suppressed during it [Grokipedia, *Cutting on action*]. A cut placed on a word, an action, or a
beat lands inside a moment the viewer is already re-fixating; a cut placed in dead air is the
only thing happening and gets all the attention.

### 2.3 J-cuts and L-cuts, in frames

A **J-cut** runs the *incoming* shot's audio under the *outgoing* picture (audio leads). An
**L-cut** carries the *outgoing* audio over the *incoming* picture (picture leads). Named for
the shape on the timeline [Wikipedia, *J cut*; Adobe, *L and J cut*]. No source gives a single
canonical frame count — the practical guidance is "let audio lead or lag by a second or two at
key moments" [Soundstripe] — so here is the table bay should encode, derived from the frame
grid and from what the pre-cue evidence already establishes (+0.07 s ≈ 2 frames is the modal
sound-leads-picture offset in wicks-v2 and is correct):

| Edit | Audio offset vs picture cut | Frames @30 | Use for |
|---|---|---|---|
| SFX pre-cue (not a J-cut) | −0.067 | 2 | every seam, always — the transient must precede the frame it explains |
| **Short J** | −0.20 to −0.40 | 6–12 | the next beat's first word starts under the last frames of the old beat; the standard explainer seam |
| **Long J** | −0.60 to −1.20 | 18–36 | a register change: the new voice/idea arrives before its picture, so the cut answers a question already asked |
| **Short L** | +0.20 to +0.50 | 6–15 | the outgoing sentence finishes over the new picture; the natural way to *leave* a beat |
| **Long L** | +0.80 to +2.00 | 24–60 | the voice narrates the new picture from the old beat's momentum — best on a payoff |
| butt cut (what wicks-v2 does) | 0, in silence | — | **banned unless the silence is the point and lasts ≥1.0 s** |

Why it reads as professional: with a butt cut the viewer gets two simultaneous discontinuities
(picture and sound), which is one more discontinuity than the world ever supplies. Staggering
them by 6–12 frames means only one channel changes at a time, and the ear — which has no
saccades and cannot look away — is the one that carries continuity across the seam.

**bay can do all of this today with zero new capability:** `narrate` takes an `at`, and audio
mixes at sample resolution. A J-cut is `narrate(at = cut − 0.30)`. The reason it never happens
is that the skill's narration reference times the voice to the *beat*, and nothing anywhere
says the voice should cross the seam.

### 2.4 Rules

| # | Rule | Check | Gaming |
|---|---|---|---|
| C1 | Cut times are exact multiples of `1/fps`. | model, exact | none |
| C2 | ≥70% of cuts land while a narration clip is sounding. | model, exact | pad narration with filler to cover the cut — countered by the speech-density cap in §6 |
| C3 | At each cut, `\|t_cut − nearest voice boundary\| ≥ 0.133 s` (4 frames) OR the voice is mid-clip. | model, exact | offset every voice by the same 5 frames — countered by C4 |
| C4 | Across all cuts, ≥1/3 are J (voice leads) and ≥1/3 are L (voice trails), and the offsets are not all within 2 frames of each other. | model, exact | forces a per-seam decision |
| C5 | No frame between two beats where every content element is below 0.95 opacity for more than 2 frames. ("Content element" = duration ≤ 60% of runtime.) | model, exact | keep a permanent element at 1.0 — excluded by the duration filter |

---

## 3. Match cuts and velocity matching

### 3.1 The construction, as keyframes

The mechanism in one line: **make the last instantaneous velocity of the outgoing element equal
the first instantaneous velocity of the incoming one, on the same axis, in the same direction.**
`power4-in` and `power4-out` over the same Δ and the same duration are the two halves of one
`power4-in-out`, so the equality is exact — it is not an approximation.

At 30 fps, with the cut at `T` (a frame multiple):

```
D    = 0.300            # 9 frames — the seam length; use 0.267 (8f) for a snappier deck
DIST = 0.213            # canvas fractions; 230 px on a 1080-wide canvas
```

```jsonc
// OUTGOING — element A starts at aStart
animate { elementId: "A", property: "x", easing: "power4-in", keys: [
  { t: T - aStart - D, value: X_A },
  { t: T - aStart,     value: X_A - DIST } ] }
animate { elementId: "A", property: "opacity", easing: "linear", keys: [
  { t: T - aStart - D,        value: 1 },
  { t: T - aStart - D + 0.09, value: 0 } ] }   // dies at 30% of travel (3 of 9 frames)

// INCOMING — element B starts exactly at T
animate { elementId: "B", property: "x", easing: "power4-out", keys: [
  { t: 0, value: X_B + DIST },
  { t: D, value: X_B } ] }
animate { elementId: "B", property: "opacity", easing: "linear", keys: [
  { t: 0,    value: 0.35 },
  { t: 0.13, value: 1 } ] }                    // enters already visible, under deceleration
```

Constraints that make it work, and the failure if you break them:

| Constraint | Number | If broken |
|---|---|---|
| Same axis, same sign | — | the eye tracks left, the frame goes right → reads as two moves |
| Same Δ both sides | 0.213 (±0.01) | the velocity step is visible as a stutter |
| Same duration both sides | D (exact) | ditto |
| Mirrored curve | `power4-in` ↔ `power4-out` | a `spring-out` entry after a `power4-in` exit reads as slow |
| Exit opacity dies at 25–30% of travel | 0.09 s of 0.30 s | otherwise the element must reach the frame edge, which costs 3× the distance |
| Entry opacity starts ≥0.30, not 0 | 0.35 | entering from 0 reads as a fade, not a move |
| Last outgoing fade ends **at or after** `T − 0.033` | 1 frame | earlier ⇒ dead air at the seam |
| B's `start` is exactly `T` | — | 1 frame early ⇒ a double-exposed frame; 1 late ⇒ a black frame |

### 3.2 Direction as meaning

| Direction | What it says | Where |
|---|---|---|
| leftward (−x) | progress along a sequence | list items, steps, "and then" |
| rightward (+x) | going back, a reprise | callbacks, "remember when" |
| upward (−y) | ascent, a stack building | accumulating figures |
| downward (+y) | consequence, landing | payoff, the number that matters |
| Z-in (scale ↑) | going *into* the topic | hook → context |
| Z-out (scale ↓, entry oversized) | arriving *at* the answer | the payoff beat |

**Do not use the same direction at every seam.** wicks-v2 used leftward at both of its two
motion seams: 2/2 identical. A five-seam video wants at most two seams sharing a direction.

### 3.3 Zoom-through in bay, and its one hard limit

The Z-axis variant round 1 documents needs a blur ramp (0 → 10 px on text). **bay cannot ramp
an effect.** `ANIMATABLE_VISUAL` is exactly `["opacity","scale","x","y","rotation","scaleX",
"scaleY"]` (`bay-project/src/element.rs:1071`); `Effect.params` are constants, and `effect_set`
is a one-shot state change (`bay-mcp/src/tools.rs:485-497`). So the blur half of zoom-through is
not available and the skill's own capability table (`references/motion.md:347`) already says so.

The version that *does* work: scale + opacity only, with **larger scale deltas to compensate for
the missing blur** —

```
exit  : scale 1.00 → 1.18, power3-in, 0.20 s;  opacity 1.0 → 0.15 on a SEPARATE linear channel
cut   : at the peak (frame T); A hard-off, B on at scale 0.72
entry : scale 0.72 → 1.00, expo-out, 0.50 s;  opacity 0.15 → 1.0 linear over 0.17 s
```

**Text-specific ceiling:** the text raster is built once at the element's *base* `scale`
(`bay-preview/src/lib.rs:1685-1688`) and then resampled by `fit_contain`. Scaling **above** the
base softens the glyphs. Exits (which are on their way out and half-transparent) tolerate
1.18×; a *held* state above ~1.15× is visibly soft. So zoom-through entries must come **up to**
1.0 from below, never overshoot past it. `back-out` on a text scale is doubly banned for this
reason: it both overshoots and resamples.

---

## 4. The transition catalogue, verified against the source

`✅` = expressible today with existing tools; `⚠️` = a degraded variant only; `❌` = not
possible. "Calls" is the marginal tool-call cost per seam beyond placing the elements.

| Transition | When it is correct | Frames @30 | bay today | How, or what blocks it | Calls |
|---|---|---|---|---|---|
| **Hard cut** | the default; any seam without a reason for more | 0 | ✅ | butt-join on the same tick; `lib.rs:1660` guarantees no blank/double frame | **0** |
| **Cut-the-curve** (velocity-matched) | idea continues across visually distinct beats | 9 (0.30 s) | ✅ | §3.1 | 2/element/side |
| **Cross dissolve** | "this continues"; time passing; a soft register change | 12–24 (0.4–0.8 s); film convention is 24–48 @24 = 1–2 s [StudioBinder, Boris FX] — halve it for short-form | ✅ | `transition_add{fromId,toId,duration}`; clips must already overlap on **one lane**; only the incoming fades so the middle does not dip (`plan.rs:1557`) | **1** |
| **Dip to colour** (black/white/brand) | a chapter break; a hard reset of attention | 8 in + 4 hold + 8 out | ✅ | full-bleed `add_shape` rect on the top layer, `animate` opacity 0→1→0; use `blendMode:"screen"` for a light-leak flavour (17 modes, `element.rs:300-319`) | **2** |
| **Cover wipe** (a bar sweeps across and takes the beat with it) | mechanical, deliberate, "next" | 10–14 | ✅ | full-bleed rect, `animate x` across the canvas; second beat swaps under it at the covered frame | **2–3** |
| **Reveal wipe** (edge travels over a static image) | a map, a chart filling | — | ❌ | `mask_set` geometry is not a channel (`element.rs:1071`); the mask is canvas-space and static (`lib.rs:1838`) | — |
| **Mask reveal** (element slides out from behind a fixed edge) | a card sliding out of a slot; a "printing" effect | 12–18 | ⚠️ | static mask + `animate x/y` on the element under it — the *element* moves, the edge cannot | **2** |
| **Iris / radial** | a spotlight closing on one thing | 10–16 | ⚠️ | close only: an ellipse shape scaling up as a cover. Iris **open** needs an animatable mask → ❌ | **2** |
| **Push / slide** | parallel co-equal items; a list advancing | 9–12 | ✅ | `animate x` on every element of both beats — this is cut-the-curve without the fade trick, and costs the same O(N) | 2/element/side |
| **Zoom-through** | state change; hook → context | 6 out + 15 in | ⚠️ | §3.3 — no blur ramp, and text softens above base scale | 4/element |
| **Whip pan** | energetic lateral jump between two frames | 4–6 | ❌ | needs **directional** blur; bay has one isotropic gaussian (`bay-effects/src/pipeline.rs:10`) and it cannot ramp. Do not fake it — a 5-frame x-slam with no smear reads as a glitch | — |
| **Blur-through** | soft focus change between related beats | 12–18 | ❌ | no ramp (as above) | — |
| **Rack focus** | pull attention between two planes in one frame | 15–24 | ⚠️ | a *static* blur on the background layer for depth; the focus cannot travel | 1 |
| **Morph** | one shape becoming another | 15–30 | ❌ | no path interpolation, no stroke; `ShapeKind` is rect+ellipse only (`element.rs:598-607`) | — |
| **Glitch / RGB split** | instability, an error state | 3–5 | ⚠️ | three duplicates with `blendMode:"screen"` offset in x — no per-channel tint, so it is a white ghost, not an RGB split | 6+ |
| **Light leak / film burn** | organic warmth on a chapter break | 12–20 | ✅ | full-bleed rect, `blendMode:"screen"`, opacity in/out; use a warm hex | **2–3** |

**Budget rule.** A 60 s explainer gets **at most two non-cut transitions**, and they belong to
the two structurally important seams (the turn, and the payoff). Everything else is a hard cut
or a velocity-matched cut. wicks-v2 inverted this: 5 of 5 seams were the same soft transition,
which spends the "this is special" signal on nothing and leaves no signal for the beat that is.

---

## 5. Camera without a camera

### 5.1 There is no camera, and no group

Verified: `Element` has no parent/group field; `Scene` is `{id, name, is_main, tracks, markers}`
(`bay-project/src/scene.rs:10-23`); `Track` has no transform; the compositor computes each
layer's centre independently at `bay-preview/src/lib.rs:1834-1835`. There is no node between
the canvas and an element.

### 5.2 The exact maths for faking one

Layer geometry (from `lib.rs:1806-1835`):

```
box      = (scale·W, scale·H)
layer    = fit_contain(natural, box) · (scaleX, scaleY)
centre.x = x·W + (0.5 − anchorX)·layer.w
```

For a camera scaling by `k` about the canvas centre `C = (0.5, 0.5)`, the required per-element
values are:

```
scale' = scale · k
x'     = 0.5 + (x − 0.5) · k
y'     = 0.5 + (y − 0.5) · k
```

The anchor term cancels exactly (it is proportional to `layer.w`, which already scales by `k`),
so this is exact, not an approximation — a genuinely correct camera push is three animated
channels per element and nothing else.

### 5.3 Cost table

Per beat, `N` = elements in the beat. wicks-v2's mean beat is 12 elements.

| Move | Per-element channels | Calls for N=12 | `animate_many` usable? | Worth it today? |
|---|---|---|---|---|
| **Push in** (k: 1.00 → 1.06 over the beat) | scale, x, y | **36** | no — `from`/`to` are absolute and every element's value differs (`plan.rs:836`) | no |
| **Pull out** (k: 1.06 → 1.00) | scale, x, y | 36 | no | no |
| **Pan** (Δx across the beat) | x | 12 | no (differing base x) | marginal |
| **Whip pan** | x | 12 | no | **no** — needs the blur it cannot have |
| **Parallax** (3 depth planes, Δ×{0.3,0.6,1.0}) | x per plane | 12 | **yes, if elements on one plane share a base x** — otherwise no | yes for 3 grouped bars/cards |
| **Rack focus** | — | 1 `effect_add` (static) | n/a | yes, as a static depth cue only |
| **Push-in on ONE element** (the "Ken Burns" of a card) | scale | 1 | n/a | **yes — always affordable** |

**The honest conclusion:** of seven camera moves, exactly two are worth their price today — a
single-element scale drift, and static background blur. Everything else costs 12–36 calls per
beat, against a total session budget that ran 401 bay calls for 61 s of video (6.6 calls per
second of output). A push-in on every beat of a six-beat video is 216 calls: **54% of the entire
session** for one move nobody would name in a review.

### 5.4 What a real scene-level transform would save

Two options, ranked by cost-to-build.

**(a) `animate_many` gains `by` (delta) semantics — small.** Add an optional `by` alongside
`from`/`to`: each element animates from its own current base value to `base + by`. Reading the
base is one lookup that the loop already does (`plan.rs:869-874` fetches the element). This
alone turns a group seam from 2·N calls into **2 calls**:

```jsonc
animate_many { elementIds: [...outgoing], property: "x", by: -0.213,
               duration: 0.30, easing: "power4-in", stagger: 0.03, at: T - beatStart - 0.30 }
animate_many { elementIds: [...incoming], property: "x", by: -0.213, from_offset: +0.213,
               duration: 0.30, easing: "power4-out", stagger: 0.03 }
```

All five wicks-v2 seams become 10 calls instead of 81. **This is the single highest-leverage
change in this area.**

**(b) `Scene.camera` / `Track.transform` — medium.** A 7-channel transform on the scene (or on
a track), composed into the layer centre at `lib.rs:1834`:

```
centre' = C + (centre − C)·cam.scale + (cam.x·W, cam.y·H)
layer'  = layer · cam.scale
opacity' = opacity · cam.opacity
```

Cost: ~30 lines in the compositor path, plus model + serde round-trip test + one MCP tool
(`camera_animate {property, keys}`). Payoff: a push-in is **1 call** regardless of N, parallax
is one call per track, and a "world" push becomes the cheapest move in the tool rather than the
most expensive. It also gives the wipe/iris that masks cannot: a camera that pushes past the
frame edge is a real move out.

Do (a) first. (b) is the right model but (a) unblocks the seam grammar this week.

---

## 6. Rhythm

### 6.1 What the sources say

| Source | Number |
|---|---|
| Short-form retention benchmark | "change something on screen every **3–5 s**"; static shots >5 s hurt retention [Retensis, *TikTok Retention Benchmarks 2026*] |
| Pattern-interrupt study cited by the same | interrupts every **4 s** → 58% retention vs 41% for static, same length |
| YouTube Shorts top-100 analysis | mean clip **2.5 s** correlated with 35% higher completion than 4 s+ [Retensis] |
| Educational / explainer segmenting | **10–20 s** per topic block [Vidpros, *Video Clip Length*] |
| Tight-edit floor | 0.7 s per shot is the extreme end [Vidpros] |

These two families of numbers are not in conflict: **10–20 s is the beat, 2.5–5 s is the
visual change inside it.** wicks-v2 got the first right (mean beat 10.2 s) and the second
catastrophically wrong (zero frame replacements inside any beat).

### 6.2 Why constant intervals are boring, precisely

A constant interval is *predictable*: after three cuts at 3.0 s the viewer's expectation is
calibrated and the fourth cut carries no information. Editing rhythm works the same way as
musical rhythm — the meaning lives in the deviation from the grid, not the grid. Two structures
carry meaning:

- **Accelerando into a payoff.** Intervals shrink geometrically (×0.8 per cut) over 3–5 cuts,
  then the payoff shot is held **2.5–4× the previous interval**. The held shot is where the
  point goes. This is the same shape as `decay: 0.84` on `animate_many` and for the same reason.
- **Hold on the turn.** The beat where the argument changes direction gets the longest interval
  in the video, immediately after the shortest. The contrast is the punctuation.

### 6.3 The target for a 60 s explainer

Three levels, each with its own budget. Levels are defined so they cannot be conflated.

| Level | Definition | Target for 60 s | wicks-v2 | Mean interval |
|---|---|---|---|---|
| **L1 — cut** | ≥60% of on-screen *content ink* is replaced within 2 frames | **9–14** | **0** (5 crossfades) | 4.3–6.7 s |
| **L2 — reveal** | a content element arrives, or a move ≥8 frames on a non-opacity channel | **22–34** | 56 non-opacity segments, but 76 of 245 total segments are 3-frame pops | 1.8–2.7 s |
| **L3 — accent** | any other keyframe segment | ≤ 2 × L2 | 189 opacity segments | — |

Distribution constraints (the part a count cannot express):

| # | Rule | Number | Gaming, and the counter |
|---|---|---|---|
| R1 | L1 interval CV between **0.35 and 0.85** | — | random jitter satisfies CV — countered by R2 and R3 |
| R2 | No 3 consecutive L1 intervals within **15%** of each other | — | forces structure, not noise |
| R3 | Exactly one interval ≥ **2.5×** the median, and it is in the last 40% of the runtime | the payoff hold | placing a dead 15 s hold at the end — countered by L2 density inside it (R5) |
| R4 | Longest beat ≤ **3.0×** shortest (already `MIN_SPAN_RATIO` in `check.rs:970`, but it never fires on 1 span) | 2.4× measured | — |
| R5 | **No 5.0 s window anywhere with zero L1 or L2 events** | — | fill with 3-frame pops — countered by R6 |
| R6 | L2 events must have duration ≥ **8 frames (0.267 s)**; segments shorter than 4 frames do not count as anything and are capped at ≤10% of all segments | 76/245 = 31% measured, all 2.94 frames | this is the rule that kills the pop-machine |
| R7 | Speech coverage between **55% and 80%** of runtime, and no speech gap > **2.5 s** | 59%, five gaps of 3.2–5.2 s | pad with filler — countered by the words-per-second cap in the narration reference |

---

## 7. The seam sound

Cross-referenced with `EVIDENCE.md` §10 and the audio-craft brief. The evidence's one correct
finding — the +0.07 s (2-frame) modal pre-cue — stays. What is missing is that **the sound
should differ per transition type**, and in wicks-v2 it never does: 11 whooshes of identical
0.54 s duration served 5 seams and 6 other moves.

| Seam type | Sound | Length | Offset vs cut | Level rel. voice |
|---|---|---|---|---|
| Hard cut, on the word | **nothing**, or a 40 ms tick | 0.04 s | −0.067 | −22 dB |
| Hard cut, chapter break | impact + 0.8 s tail | 0.7 s | −0.067 | −12 dB |
| Cut-the-curve | whoosh, **length = the move** (0.30 s), pitch follows direction: falling for leftward/exit, rising for rightward/entry | 0.30 s | −0.067 to −0.10 | −16 dB |
| Cross dissolve | **no transient.** A dissolve that clicks is a cut wearing a dissolve. Instead: a bed filter sweep or a swell across the overlap | = the dissolve | starts at the dissolve start | — |
| Dip to colour | sub-drop on the way in, silence at the bottom, the new beat's first sound on the way out | 0.5 s + gap | −0.10 | −10 dB |
| Cover wipe | mechanical: a *short* noise burst with a hard stop at the covered frame | = the wipe | −0.067 | −18 dB |
| Zoom-through | riser into the cut (0.6–1.2 s), cut off **at** the cut, not after | riser 0.8 s | ends at T+0.000 | −14 dB |
| Payoff hold (R3) | the bed comes **up**, no SFX at all | — | — | — |

Two rules that make this checkable and not gameable:

- **S1 — every seam has exactly one transient in ±0.2 s.** wicks-v2's seam 2 has three
  (whoosh −0.25, subdrop −0.08, click +0.23): a three-transient seam reads as a stumble, not
  as emphasis. Gaming ("add more sounds") is what produces exactly that.
- **S2 — every transient implies a seam.** Any SFX with no L1 or L2 event within ±0.2 s is a
  finding. Measured: 37 of the 160 visual onsets had no sound within 0.4 s, and the inverse also
  holds — sounds fired at nothing. Both directions must be checked or the count gets gamed from
  whichever side is cheaper.
- **S3 — no two seams in one video use the same SFX asset at the same duration.** Measured:
  11 whooshes, all 0.54 s, all the same render. `sfx_add` synthesises to any length
  (`tools.rs:660-670`), so identical durations are a *decision not taken*, and it is detectable
  in one pass over the audio lane.

---

## 8. Scene structure as the fix

### 8.1 What the one-scene project actually costs

**(a) It disables the check suite arithmetically.** `check::check()` reads
`project.active_scene()` (`check.rs:140`). Beats are derived by `spans()`
(`check.rs:572-600`), whose honest derivation is *clips on the main lane*:

```rust
if cuts.len() > 1 { return cuts; }     // main-lane clips are the beats
// … otherwise: one span covering every picture element
```

wicks-v2 has **exactly one element on the main lane** — `panel`, a `#191922` rect, `start 0`,
`duration 7 440 000 ticks = 62.0 s`. So `spans()` returns one 62 s bucket and:

| finding | threshold | value on one 62 s span | fires? |
|---|---|---|---|
| `front-loaded` | ≥90% of keys in the first 25% | keys spread to 59 s | never |
| `inert-scene` | nothing arrives after 1.0 s | last arrival 58.5 s | never |
| `no-accumulation` | last arrival within last 20% | 58.5/62 = 94% | never |
| span-rhythm (`monotone-duration`) | needs `MIN_SPANS_FOR_RHYTHM` spans | 1 | never |

Four of the six pacing checks are dead, and nothing in the report says so. **A check suite that
silently degrades to zero on the most common project shape is worse than absent** — it emitted
a clean-ish report on this video.

**(b) It costs the agent its own working memory.** With one scene, `timeline` returns 188
elements in five layer buckets with no beat structure, no markers (0 in this project), and no
keyframes at all (`studio.rs:999-1024` maps `describe_element`, which omits animation). The
agent cannot ask "what is in beat 3" or "what moves at the seam" — it must hold the entire
video in context. The session shows the consequence: `check` was called **twice** in 401 bay
calls, and `snapshot` 15 times for 61 s of video.

**(c) It costs reuse.** Nothing is addressable as a unit. The eight-topic template repeats
identically at 8.4, 18.0, 33.0, 45.2 and 54.6 s because reusing it means re-issuing ~20 calls,
not placing a beat.

**(d) It makes the correct edit unpriceable.** §1.3: with no group object, a seam costs one
call per element per side. Everything downstream of that — the missing cuts, the missing camera,
the crossfade monoculture — is this one fact.

### 8.2 The proposal: a **Beat**, not a Scene

`Scene` is the wrong object to reach for and `round2/23-engine-truth.md` §7 says why: scenes do
not concatenate (`export_video` takes one `&Scene`, `bay-preview/src/lib.rs:1358`), so a
multi-scene project renders one scene and drops the rest. Adding `scene_add` without rewriting
export would give the agent a way to make a project that silently renders 1/6 of itself.

Instead: **a Beat is a named, half-open time range on the active scene, plus the set of
elements whose lifetime falls inside it.** It is a *partition*, not a container — which means it
requires no change to the render path at all.

```rust
// bay-project/src/scene.rs, next to `markers`
#[serde(default)]
pub beats: Vec<Beat>,

pub struct Beat {
    pub id: String,
    pub name: String,          // "hook", "the turn", "payoff"
    pub start: MediaTime,
    pub duration: MediaTime,
    pub seam: SeamKind,        // how this beat is ENTERED: Cut | Dissolve{d} | Dip{colour,d}
                               //   | Curve{axis, delta, d} | ZoomThrough{d} | Wipe{dir,d}
}
```

Why this shape and not a container:

- Serde-compatible with every existing project (`#[serde(default)]`, same pattern as `markers`).
- `spans()` becomes `if !beats.is_empty() { beats } else { main-lane clips }` — a **three-line
  change** that resurrects `front-loaded`, `inert-scene`, `no-accumulation` and span-rhythm on 6
  buckets instead of 1.
- The `seam` field makes "what kind of edit is this" a **declared** value, so `check` can verify
  the declaration against the keyframes (declaring `Curve` with no matching x-channels is a
  finding) rather than inferring intent.
- An element's beat membership is derived from time, so nothing has to be re-parented and no
  existing tool changes meaning.

### 8.3 The tool surface

| Tool | Signature | Why it is the path of least resistance |
|---|---|---|
| `beats_plan` | `{ beats: [{name, duration, seam}] }` → ids + absolute start times | **One call lays out the whole film.** Called *before* any element exists, it is cheaper than not planning. This is the lever: the agent plans beats because planning is one call and not planning is zero calls but then every seam costs 30. |
| `beat_list` | `{}` → id, name, start, duration, seam, element count, ink coverage | lets the agent re-read its own structure instead of holding 188 elements in context |
| `beat_elements` | `{beatId}` → element ids | makes `animate_many` on a whole beat a two-call operation |
| `beat_seam` | `{beatId, kind, duration, axis?, delta?}` | **authors the transition, both sides, in one call** — the exit keyframes on the outgoing beat's elements and the mirrored entry keyframes on the incoming beat's. This is where §5.4(a) `by` semantics get used internally. |
| `beat_retime` | `{beatId, duration}` | ripples the beat and everything after it — the operation that is currently "delete and rebuild" |

`beat_seam` is the one that matters. With it, a five-seam video is **5 calls** for its entire
edit grammar, versus 81 today. The economics invert: the correct edit becomes cheaper than the
crossfade, because the crossfade still costs 2 `fade_set` calls per side.

### 8.4 Migration for the checks

| check | today | with beats |
|---|---|---|
| `spans()` | main-lane clips, else one span | `beats` if present, else main-lane clips, else one span |
| `inert-scene` | dead on 1 span | fires per beat at 1.0 s |
| `front-loaded` | dead | fires per beat |
| `no-accumulation` | dead | fires per beat |
| span-rhythm | dead | R1–R4 of §6.3 |
| **new** `no-cut` | — | a beat entered with `SeamKind::Cut` whose ink turnover at its start is <60% |
| **new** `seam-undeclared` | — | ≥60% ink turnover at a time that is not a beat boundary |
| **new** `wash-window` | — | §2.4 C5 |
| **new** `butt-cut` | — | §2.4 C2/C3 |

---

## 9. The checks, and how an agent would game each

Every rule above restated as a check, with the attack and the counter. **A rule with no counter
listed is one I could not make ungameable and should not be shipped as a score.**

| Code | Rule | Computed from | Attack | Counter |
|---|---|---|---|---|
| `no-cut` | ≥1 L1 cut per 8 s of runtime; 9–14 for 60 s | model: ink turnover across ±1 frame | pop 30 tiny elements on/off | L1 requires ≥60% of *content ink*, where content = elements with duration ≤60% of runtime and ink = `scale·scaleX·scaleY` area × opacity |
| `crossfade-monoculture` | ≤2 of N seams may use the same `SeamKind`; ≤2 non-cut transitions per 60 s | model: declared `seam` + verification against keyframes | declare `Curve` and animate nothing | verify: `Curve` requires matched Δ/duration/mirrored easing on both sides within 5% |
| `butt-cut` | ≥70% of cuts sound while the voice is sounding; ≥1/3 J and ≥1/3 L | model: narration clip spans vs cut times | shift every voice by an identical 5 frames | the J/L split plus "offsets not all within 2 frames" |
| `wash-window` | no >2-frame window at a seam where every content element is <0.95 opacity | model: opacity channels × `fade_gain` | park a permanent full-opacity element | content filter excludes duration >60% of runtime |
| `pop` | segments <4 frames ≤10% of all segments; L2 events ≥8 frames | model: keyframe segments | lengthen 3-frame pops to 8 frames and change nothing else | `pop` is a floor, not a score — it removes a way to cheat rather than granting points |
| `off-grid` | every cut time and move duration is a multiple of `1/fps` | model | none needed | — |
| `dead-window` | no 5 s window with zero L1/L2 events | model | fill with L2-sized opacity fades | L2 excludes pure-opacity segments (see `property-monoculture`, owned by the motion brief) |
| `seam-sound` | exactly one transient within ±0.2 s of each seam; every transient within ±0.2 s of an event | model: audio onsets vs event times | stamp one whoosh per seam | `sfx-identical`: no two seams may use the same asset at the same duration |
| `persistent-chrome` | ≤35% of mean frame ink may come from elements present >80% of runtime | model | slice the grid into 6 butt-joined copies | fingerprint `(type,colour,x,y,scale,scaleX,scaleY,content)`; butt-joined identical fingerprints count as one element |
| `frame-turnover` | two rendered frames sampled 0.5 s apart inside a beat must differ by ≥2% of pixels | **frames** — bay cannot do this today | — | see gap E4 |

The single most important property of this list: **`no-cut`, `butt-cut` and
`crossfade-monoculture` cannot all be satisfied without deciding, per seam, what kind of edit it
is and where the voice sits relative to it.** There is no arrangement of 3-frame opacity pops
that passes them. That is the test the round-1 metrics failed.

---

## 10. Engine gaps, ranked by quality-per-unit-work

| # | Gap | Effort | Unlocks |
|---|---|---|---|
| **E1** | `animate_many` gains **`by` (delta)** semantics: each element travels from its own base value to `base + by`, keeping its existing channel. `plan.rs:836-838`, ~20 lines. | small | Every group seam drops from 2·N calls to 2. All five wicks-v2 seams become 10 calls instead of 81. This is the change that makes the correct edit cheaper than the wrong one. |
| **E2** | **`Beat`** on `Scene` (§8.2) + `spans()` prefers it + `beats_plan`/`beat_seam`/`beat_elements` tools | medium | Resurrects four dead pacing checks; makes the whole edit grammar 5 calls; gives the agent a structure it can re-read instead of holding 188 elements in context |
| **E3** | **Animatable effect params** — `Effect.params: BTreeMap<String, AnimationChannel>` | medium | Blur-through, zoom-through's blur half, rack focus, exposure ramps, a grade arriving with a cut. Four of the fifteen catalogue rows go ❌→✅ |
| **E4** | **Frame statistics** — a `frame_diff{a, b}` or `snapshot` returning mean-abs-difference and ink coverage | small | `frame-turnover`, and the only check that measures the rendered image rather than the model. The skill currently asks the agent to `cmp -s` two PNGs in bash (`recipes.md:398`), which detects nothing but bit-identity |
| **E5** | **Scene/track camera transform** (§5.4b) — compose at `lib.rs:1834` | medium | Push/pull/pan/parallax become 1 call instead of 36. The only route to a move *out of frame* that masks cannot give |
| **E6** | **`timeline` returns keyframes, fades and markers** (also raised as G2 in `23-engine-truth.md`) | small | Without it the agent cannot audit its own seams; every rule in §9 is post-hoc only |
| **E7** | **Word timings from `narrate`** returned to the caller | small | `cut on the word` becomes authorable; today the agent knows only clip start/end |
| **E8** | **Beat grid** — tempo/downbeat detection on the imported bed | medium | `cut on the beat`; also the only honest basis for "land the reveal on the beat", which the skill asks for and no tool can supply |
| **E9** | **Directional blur** effect | medium | Whip pan, real motion smear. Lowest priority: one transition, and it needs E3 to ramp anyway |

---

## Sources

- [Cutting on action — Grokipedia](https://grokipedia.com/page/Cutting_on_action) (2–5 frame overlaps ≈83–208 ms; saccade 150–200 ms)
- [Cutting on action — Wikipedia](https://en.wikipedia.org/wiki/Cutting_on_action)
- [J cut — Wikipedia](https://en.wikipedia.org/wiki/J_cut)
- [L cut and J cut — Adobe](https://www.adobe.com/creativecloud/video/post-production/cuts-in-film/l-and-j-cut.html)
- [A Video Editor's Guide to J Cuts and L Cuts — Soundstripe](https://www.soundstripe.com/blogs/a-video-editors-guide-to-j-cuts-and-l-cuts)
- [What is a Dissolve in Film — StudioBinder](https://www.studiobinder.com/blog/what-is-a-dissolve-in-film-definition/) (24–48 frames)
- [Dissolve Transition Tutorial — Boris FX](https://borisfx.com/blog/dissolve-transition-tutorial-2024-what-are-dissolves/)
- [TikTok Retention Rate Benchmarks 2026 — Retensis](https://retensis.com/blog/tiktok-retention-rate-benchmarks-2026) (change every 3–5 s; 4 s interrupts 58% vs 41%; Shorts 2.5 s mean clip)
- [Video Clip Length: Ultimate Guide — Vidpros](https://vidpros.com/video-clip-length/) (10–20 s explainer segments; 0.7 s tight-cut floor)
- Repo, branch `fix/pending-sweep`: `bay-preview/src/lib.rs:1533,1660,1685,1806-1835`;
  `bay-project/src/element.rs:300-319,598-607,796-814,1071`; `bay-project/src/scene.rs:10-23`;
  `bay-agent/src/plan.rs:44-83,826-914,1513-1568`; `bay-mcp/src/tools.rs:302-360,485-552,999-1024`;
  `bay-core/src/check.rs:140,572-600,899-980`; `bay-core/src/command.rs:191-193`;
  `bay-audio/src/lib.rs:122`; `bay-time/src/media_time.rs:7`.
- Measured: `~/Library/Application Support/vii/projects/project-1786466680050.json`;
  session `~/.claude/projects/-Users-himanshu-codes-synthai-vii/1ba87d60-…jsonl` (455 tool calls).
