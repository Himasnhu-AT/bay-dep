# Why AI-authored video comes out bad

A failure taxonomy. Each entry: what it looks like, why it happens *mechanically*, and what
kills it. This is the diagnostic half of the corpus — the prescriptions live in 02–08.

A note on scope: bay does not generate pixels with a diffusion model, so the well-known
generative artifacts (six-fingered hands, objects that fail to persist between frames, lighting
that drifts because every frame is estimated independently) do not apply to us. What *does*
apply is the second, larger half of the "AI slop" literature — the part that is about
**meaningless averages** rather than technical glitches. Every shot centre-framed, eye-level,
static; no camera movement, no depth variation; generic brief in, generic output out. That
failure is fully available to a compositor-driven agent, and it is the one we have.

---

## The meta-cause

**An agent optimises for what it can verify.** Today that is: the tool call succeeded, the
element is on the canvas, the render exited zero. Every one of those can be true of a video
that is unwatchable. Perceptual quality is not in the loop, so it regresses to the training
average — and the average of all motion graphics ever posted is exactly the thing people call
slop.

Compounding it: **the tool's move vocabulary is the ceiling on the agent's taste.** If the
only entrance the API can express is "fade opacity and move y," then a model with perfect
taste still ships a video where every entrance fades and moves y. Sub-par output is partly a
missing-features problem wearing a taste problem's clothes.

---

## The 14 failure modes

### 1. Slideshow disease — the primary failure

Everything for a scene arrives in the first ~25% of it, then freezes until the cut. The video
is a deck with entrance animations.

**Cause:** placing elements is one tool call each and it is natural to place them all at the
scene's start; nothing prompts the agent to *withhold* an element until its moment.

**Kill it:** reveal each piece **when the narration names it**, sequencing reveals across the
back ~50% of the scene. Same total work, completely different read. This is the single
highest-leverage motion rule in the corpus. (§02, §04)

### 2. Monotone motion

One easing curve, one duration, one direction, one stagger — for the whole video. Everything
enters from below with a 0.4 s ease-out.

**Cause:** the model's default is `power2.out` at 0.4 s and it has no reason to vary. In bay
specifically, an `AnimationChannel` carries **one** easing for *all* its segments, so varying
the curve within a move is not merely un-prompted, it is unexpressible.

**Kill it:** no more than two independent moves may share an ease in one scene; the slowest
scene should be ≥3× the fastest; vary entrance direction (left, right, scale, opacity-only,
tracking). (§02)

### 3. The empty frame

One text block floating in the middle of a flat field. Reads as "nothing loaded."

**Cause:** the agent builds for a web page, where whitespace is a virtue and one focal point is
correct. A video frame is not a page — the eye has nowhere to travel and 24 frames a second in
which to notice.

**Kill it:** **two focal points minimum, three layers minimum** (background treatment,
foreground content, accent elements), hero type at 60–80% of frame width, content anchored to
edges rather than centred-and-floating. (§03)

### 4. Web-scale type

14–40 px type on a 1080-wide canvas. Hero numbers at 72 px. Legible on a 27" display in the
preview; invisible in a feed on a phone.

**Cause:** the model's type-size prior comes from CSS, where 16 px is body text. Nothing
converts "readable" into the viewing condition that matters.

**Kill it:** body ≥ 32 px and headlines ≥ 90 px for in-feed viewing; hero figures ≥ 200 px on
screen. Type is sized against the *thumb*, not the monitor. (§03)

### 5. Dead air at the cut

A frame with nothing on it, usually one to three frames wide, at a scene boundary. Or a full
half-second of black because one scene ended before the next began.

**Cause:** scenes authored as disjoint time ranges that happen to abut. Rounding puts a hole
between them.

**Kill it:** overlap neighbouring scenes and cross-fade over the overlap; something legible on
screen at every instant from ~0.3 s onward. `scripts/inkcheck.py` measures this; it is the one
perceptual check bay already has. (§05)

### 6. Hard cuts everywhere, no continuity

Every seam is a straight cut between two static compositions. The video reads as a pile of
slides regardless of how good each slide is.

**Cause:** a cross-dissolve is the only seam bay can express, so seams are either a dissolve or
nothing — and there is no vocabulary at all for the thing professionals actually use, which is
a **velocity-matched cut**: cut at peak velocity, with matched direction and speed on both
sides, so the eye reads one continuous camera move. (§05)

### 7. Flat, ungraded colour

Pure `#000` and `#fff`, saturated primary accents, no grade, no grain, no vignette. Every
element at full opacity on a dead background.

**Cause:** the agent picks colours per element instead of declaring a palette; nothing tints
neutrals; the look library exists but is not reached for.

**Kill it:** declare bg/fg/accent before writing anything; tint neutrals toward the accent hue;
one accent, used scarcely, always on the point; apply a look. **And measure the contrast** —
`#26262E` on `#0E0E12` is 1.28:1 and encodes nothing, and opacity defeats the measurement
(a colour that measures 3.12:1 at full alpha composites back to ~1.3:1 at 28%). (§06)

### 8. Silence, or a flat mix

No sound at all, or music and voice sitting at the same level for the whole duration with no
automation.

**Cause:** audio is the last thing added and the easiest to declare done. The single most
common real-world complaint — "the music drowns the narrator" — is diagnosed in the literature
as *a flat mix*: same levels throughout, no ducking.

**Kill it:** narration peaks −12 to −6 dB, bed at −12 to −14 dB when nobody is speaking, ducked
15–25 dB under speech with a 10–30 ms attack and 200–500 ms release; deliver to ≈ −14 LUFS.
And put a sound under every move — a whoosh *starting slightly before* the visual, because the
brain processes audio faster than picture and the pre-cue is what makes a move feel
intentional. (§07)

### 9. The narration reads the screen

The voice says the number that is already on the frame in 300 px type.

**Cause:** script and layout authored from the same outline, so they say the same thing.

**Kill it:** the picture carries the numbers; the voice carries the reasoning. If the voice
says what the frame says, cut one of them.

### 10. No hook

The video opens with a title card, a logo, or a definition. Nothing has been promised, so
there is no reason to stay.

**Cause:** the agent structures the video like a document — title, then body.

**Kill it:** the first 1–3 seconds do three jobs at once: break the pattern, set a promise,
open a curiosity gap. Meta's own data: 65% of viewers who watch three seconds watch ten, 45%
watch thirty; videos holding above 65% at three seconds see multiples more distribution. (§04)

### 11. Uniform pacing

Every scene the same length. No peak, no hold, no breath.

**Cause:** duration is assigned by dividing total time by scene count.

**Kill it:** name the rhythm before implementing — *fast-fast-SLOW-fast-hold* — and derive it
from the content, not from the runtime. (§04)

### 12. Decoration without meaning

Ambient zoom on every scene. Cards breathing. A slow push in the back half of every shot.

**Cause:** the agent knows "static is bad" and reaches for the cheapest motion available.

**Kill it:** *"I'd rather have no motion than bad motion."* A slow pan or push in the back half
of a shot disrupts the sightline and actively makes the frame worse. Stillness after motion is
powerful. The only sanctioned aliveness during a hold is a low-amplitude jitter. (§02)

### 13. Bouncy as the default emphasis

`back.out` / `elastic.out` on every entrance, because overshoot reads as "emphatic."

**Cause:** the model believes overshoot adds emphasis. It buys that emphasis at the cost of
cleanliness, and it is reported as the **#1 instant turn-off** in user-made motion videos.

**Kill it:** long-tail deceleration (`power3`) is the house default. Overshoot is a rare,
explicitly-playful exception. (§02)

### 14. Reveals that start on the beat

The agent has the beat times, passes one as an animation's start, and the element *begins*
moving on the beat — arriving a full duration late. Nothing is actually synced.

**Cause:** off-by-one-duration reasoning. bay's skill already warns about this; it is worth
repeating because it is invisible in a still and obvious in a render.

**Kill it:** an entrance of duration `d` that should land on beat `b` starts at `b − d`. (§07)

---

## What this means for the software

Six of the fourteen are **unexpressible-in-bay** problems, not judgement problems:

| Failure | The missing capability |
|---|---|
| 2. Monotone motion | one easing per channel; no per-segment curves, no spring, no stagger primitive |
| 3. The empty frame | no gradients, strokes, paths, glows or textures to build a background layer from |
| 6. No continuity | no velocity-matched cut vocabulary; blur is not animatable, so no cut-at-peak-blur |
| 7. Flat colour | no vignette, grain, glow/bloom; effect params are not keyframable |
| 12. Bad aliveness | no jitter/noise primitive, so "alive" can only be expressed as a slow zoom |
| 13. Bouncy default | `back-out` is one of only eight curves, and the smooth alternatives are thin |

That table is the bridge to [`10-capability-map-bay-vs-ideal.md`](10-capability-map-bay-vs-ideal.md).

---

## Sources

- [Why AI Video Quality Fails and How to Fix It in 2026](https://resource.digen.ai/fixing-low-quality-ai-video-output-2026/)
- [AI Slop in Images and Videos: How to Fix It](https://www.imagine.art/blogs/ai-slop-in-images-and-videos)
- [What is AI slop and why it matters for video creators — Artlist](https://artlist.io/blog/what-is-ai-slop-and-why-it-matters-for-video-creators/)
- [The AI slop video trend (2026) — Kompozy](https://kompozy.io/guides/ai-slop-video-content-trend)
- [AI Video Quality Checklist: Avoid Looking Like AI Slop (2026)](https://greenfroglabs.com/blog/ai-video-quality-avoid-slop-appearance)
- [Video Hook Psychology: Stop the Scroll in 1-3 Seconds](https://pixelplot.ai/video-hook-psychology/)
- [Music Is Too Loud in Video — How to Fix Your Audio Mix](https://vidpros.com/fix-background-music-too-loud-video/)
