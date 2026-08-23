# Action plan — what to build, in what order

Derived from [`10-capability-map-bay-vs-ideal.md`](10-capability-map-bay-vs-ideal.md). Ordered
by quality unlocked per unit of work. Each item states what it is, why it is where it is in the
order, and what would prove it.

**The shape of the plan:** two phases that need no engine work at all come first, because they
fix more failure modes than anything else in the list and they make the engine work
*measurable* once it starts. Then the motion-expressiveness work, then the drawing primitives,
then the depth and texture work.

> **Revised 2026-08-11 after measuring five videos — see [`12-video-teardowns.md`](12-video-teardowns.md).**
> Two things changed. **(a) Phases A and B were confirmed and got sharper**: our three videos
> contain one distinct motion behaviour between them, and the skill turns out to *prescribe*
> that (`recipes.md:32` — "Every text reveal in a good reel is this"). **(b) Two items were
> promoted above all engine work**: a one-day **audio-defaults** fix (Phase E1/E3 and the
> `-14 LUFS` export preset, all of which bay already has and the agent is not using — our
> videos measure −16.5, −25.3 and −27.5 LUFS against the references' −14.0), and a new
> **Phase A8, an asset pipeline**, because both reference videos are built from imported
> illustration and screen capture while ours are 100% text on flat black. Conversely,
> Phase D1 (paths), C4 (animatable blur) and F (3D) were **demoted**: both references are
> reproducible in bay's current primitive set without any of them. They remain real gaps —
> they are just not what stands between us and the videos we admire.

---

## Phase A — the knowledge layer (no engine changes)

**Fixes failure modes 1, 2, 3, 4, 10, 11, 12, 13 from [§01](01-why-ai-video-is-bad.md).** This
is the largest single quality win available and it is entirely writing.

### A1. A doctrine file in the skill

Add `skills/bay/references/motion.md` carrying, written as *prohibitions* because that is the
form that survives contact with a generating model:

- Smooth long-tail over bouncy; `power-out` / `expo-out` as the house default; `back-out` is a
  rare explicitly-playful exception.
- Sequential reveal in the back ~50%, timed to the voice. Never dump a scene at t=0.
- No lazy breathing, no slow push in the back half; prefer stillness; jitter is the only
  sanctioned aliveness.
- Seams are velocity-matched cuts — with the numbers from [§05](05-cuts-transitions-camera.md).
- The guardrails: don't reuse one ease, one duration, one direction, one stagger; don't start
  at t=0; entrances longer than exits; total stagger ≤ 500 ms.
- Build / breathe / resolve; everything settles before its reading window opens.

### A2. A move vocabulary the agent cites rather than invents

A named palette (from [§02 part 5](02-motion-craft.md)) with, for each move, the exact channels,
durations and easings bay should use. The point is not documentation — it is **removing the
model's freedom to default.** A shot plan names a move; the implementation reproduces it.

Start with the ~15 moves that are expressible today, and mark the rest "blocked on
<capability>" so the vocabulary doubles as a live requirements list.

### A3. Blueprints — whole-shot templates

Time-coded shot templates (`Scene N (a–b s): …`) with slots and one named signature move, each
declaring the narrative role it serves and its duration range. Six to ten is enough to start:
hook-statement, kinetic-type-beats, stat-reveal, bar-race, quote card, list, before/after,
end-card lockup.

A blueprint encodes a shot across its *full* duration, which is what structurally prevents the
slideshow failure. This is the highest-value single artifact in the phase.

### A4. Style presets, written down

Palette + type pairing + motion energy + easing set + durations + atmosphere, as one named
block. Six to eight, each anchored to a real design tradition. Plus a **mood → style** picker
so the choice is made from "what should the viewer feel," not from "what's the topic."

### A5. Banned defaults

The monoculture font list, the lazy-visual list (gradient text, left-edge accent stripes,
cyan-on-dark, pure `#000`, identical card grids, everything centred), and the reason each is a
tell.

### A6. Story and hook reference

Structures, hook strategies, the clarity-technique catalog, emotional arc, the "narration must
not read the screen" rule, rhythm planning. Condensed from
[`04-story-and-psychology.md`](04-story-and-psychology.md).

### A7a. Delete the sentence that causes the monotony

`skills/bay/references/recipes.md:32` says of the rise-and-fade entrance: **"Every text reveal
in a good reel is this."** It is the only entrance pattern the skill documents, and our three
measured videos have exactly one motion behaviour between them. Replace it with the move
vocabulary from A2 — at least six entrances, with the rule that no two independent moves in a
scene may share an ease.

### A8. An asset pipeline *(new — promoted from nothing)*

The two reference videos are ~25% and ~70% non-text content: real screen recording, hand-drawn
illustration, unmodified corporate logos. Our three are 100% text and vector primitives on flat
near-black. That difference is not a rendering capability — it is **having something to place.**

The work: a way for the agent to obtain and register illustration assets (generated or sourced),
a small logo/mark library, and a screen-capture path for product demos. Without it, every bay
video is typography on a field, and typography on a field is the genre with the least room to
be good.

### A7. Fix the stale gap list

`skills/bay/references/troubleshooting.md`'s "Still missing" table lists masks and audio trim
as absent; both shipped. **A stale gap list is worse than no gap list** — it makes the agent
design around constraints that no longer exist. Add a test that fails if a capability named
there is reachable from the MCP surface.

**Proof it worked:** author the same brief twice, before and after, and compare — the histogram
of easings and durations should widen, and no scene should have all its keyframes in its first
25%.

---

## Phase B — the perceptual check (small engine work, large leverage)

**Turns taste into a test.** Every one of these is computable from the project model plus a few
sampled frames — no new rendering capability required. Extend `bay-core/src/check.rs`, which
already has the right shape (severity levels, stable machine-readable codes, warnings that do
not block).

| New finding code | What it measures | Why it matters |
|---|---|---|
| `front-loaded` | fraction of a scene's keyframes falling in its first 25% | catches failure mode #1 directly |
| `inert-scene` | **no pixel changes at all after the first second of a scene** | the defect measured in all three of our videos — frames 0.5 s apart were pixel-identical. This is the single most diagnostic check in the list |
| `no-accumulation` | count of distinct elements arriving during a scene, and how they are spread over its duration | **use this instead of an ink-coverage threshold.** Reference video R2 is 60–90% empty frame and is excellent; what makes it work is that a new element lands every ~3 s and stays. Measuring ink would flag the good reference alongside our bad ones |
| `monotone-easing` | distinct easings ÷ animated channels, per scene | catches #2 |
| `monotone-duration` | ratio of longest to shortest scene; variance of move durations | catches #2 and #11 |
| `monotone-entrance` | how many elements enter on the same channel in the same direction | catches #2 |
| `contrast-in-place` | sample the composited backdrop under each text element and measure the ratio **at the element's actual opacity** | catches #7, and closes the "opacity defeats the measurement" trap |
| `caption-unreadable` | contrast of a caption against its own backdrop across its whole duration | the most-watched text in the video |
| `still-moving-at-read` | an element whose keyframes are still running when its reading window opens | a moving number is unreadable |
| `flat-mix` | narration and bed envelopes overlapping within N dB — both are already available from `gain_points()` | catches #8, the most common real-world complaint |
| `no-sfx` | seams with no sound under them | catches #8 |
| `no-bed` | no music under a narrated timeline | all three of our videos; both references have one |
| `under-loud` | predicted integrated loudness more than ~2 LU from the delivery target | ours measured −16.5 / −25.3 / −27.5 LUFS against the references' −14.0. bay has the loudnorm path already — this check is what makes the agent use it |
| `no-hook` | first 2 s carrying only a kicker, a definition, or silence | all three of ours; O3 opens with 0.87 s of silence then a jargon glossary |
| `dead-air` | promote `inkcheck.py` into `check` proper | catches #5 |
| `no-hold` | a scene with no still moment at all | the "everything is always moving" failure |
| `overshoot-on-value` | `back-out` easing on a channel feeding a displayed number | §08 honesty — it shows a wrong number |

Also worth adding as a tool: **`contact_sheet(times[]) → one image`.** `snapshot` is one frame
per call, and inspecting eight moments currently costs eight calls and eight image attachments.
One grid image is cheaper and produces better judgements, because the agent sees the video's
*rhythm* rather than eight unrelated stills.

**Proof it worked:** a deliberately bad timeline (everything at t=0, one easing, grey-on-grey
captions, music at narration level) produces a finding for each defect; a known-good timeline
produces none. A check that fires on good work gets turned off, and then it is worth nothing.

---

## Phase C — motion expressiveness (the engine work that matters most)

### C1. Per-segment easing

Move `easing` from `AnimationChannel` onto `Keyframe` (as the curve *leaving* that key), with
the channel-level value kept as the default so every existing project deserializes and renders
identically. Without this, "ease in, hold, ease out" on one property is impossible, and the
agent fakes it with dense keyframes that read as linear.

### C2. A spring / critically-damped curve

The doctrine's default settle (§02) is not in the easing set. Add `spring-out` (ζ = 1, no
overshoot) and optionally `power4-out`. Keep it a named curve, not a parameterised physics sim —
determinism and the wire format both prefer that.

### C3. A stagger verb

`animate_many(elementIds[], property, from, to, duration, easing, stagger, decay)`. A six-word
kinetic headline is currently twelve calls with hand-computed offsets; the agent gets it wrong
or gives up and uses one text element. This one tool makes the most-wanted motion-graphics
technique a single call, and it can enforce the ≤ 500 ms total-stagger cap in code.

### C4. Keyframable effect parameters — blur first

Give `Effect.params` animation channels the same way elements have them. Blur alone unlocks:
velocity-matched cuts at peak blur, rack focus / depth of field, blur-through transitions,
motion-blur streaks on fast entrances. This is the single highest-value engine item on the
visual side after paths.

### C5. A group / camera transform

Either a real group element, or a scene-level transform that composes onto every layer. Today a
camera push over twelve elements is twelve `animate` calls that must agree, and any drift is
visible. With it: pushes, pans, zoom-to-target, and parallax (different groups at different
rates) all become one call each.

**Proof for the phase:** re-author a reference reel and check that a scene push is one call,
a kinetic headline is one call, and a seam can be a velocity-matched cut.

---

## Phase D — drawing primitives

### D1. Stroked paths and polylines

One primitive, very large payoff: line charts, sparklines, connectors, arrows, underlines,
callouts, ring/arc progress, self-draw reveals, diagrams, key-line frames. With a `dash offset`
parameter it also gives the classic draw-on reveal for free. Everything in the "no" column of
[§08](08-data-in-motion.md) is blocked on this and only this.

### D2. Text stroke, shadow and plate

Three fields on `TextElement`. The most-watched text in every video is the caption, 85% of
social video is first watched muted, and over arbitrary footage a plain fill will land on a
same-value background at some point in every clip. This is a small change with a
disproportionate effect on perceived quality.

### D3. Gradients (linear and radial)

Background layers stop being flat; glows get falloff; a shape can imply light. Pairs with D5.

### D4. Per-word / per-character text animation inside one element

A range selector over the shaped glyph runs, with per-index offset. Removes the "one element
per word" tax and makes modern word-highlight captions native rather than assembled.

### D5. Texture effects — grain, vignette, glow/bloom

Three shaders, each small, each individually the difference between "rendered" and
"photographed" (§06). Grain first: it is the cheapest anti-synthetic treatment that exists.

---

## Phase E — audio and rhythm

### E1. Auto-duck

`duck(bedId, againstId, depth, attack, release)` writing the volume keyframes bay can already
carry. Defaults from the literature: 15–25 dB depth, 10–30 ms attack, 200–500 ms release. The
flat-mix failure becomes impossible by default rather than avoidable by diligence.

### E2. A beat grid

`music_analyze(mediaId) → { bpm, beats[], sections[] }`, cached beside the media. Today the
agent cuts to music by guessing. With a grid it can place reveals at `beat − duration` — and
the check in Phase B can verify that reveals *land* on beats rather than starting on them.

(Prior art worth copying: `brag` ships pre-analysed music-cue files alongside each bundled
track. Analysis once, at import, is the right shape.)

### E3. SFX defaults at seams

With the SFX synthesiser already in place, a transition should be able to bring its own sound —
a whoosh generated at exactly the transition's duration, pre-cued a few frames early because
audio leads picture (§07). This is a small amount of wiring over capability that already exists,
and it removes the most common "why does this feel cheap" cause in one move.

---

## Phase F — later, larger

- **Animatable masks** → wipes, iris reveals, and the whole geometry-based transition family.
- **3D transforms** (perspective, rotateX/Y, translateZ) → flips, zoom-through, depth scatter,
  camera flight.
- **Speed / retime / freeze frame** → an entire absent grammar: slow-motion emphasis, a freeze
  on the punchline, ramps.
- **Adjustment layers / track-level effects** → one grade over twenty clips instead of twenty
  grades that drift.
- **A storyboard artifact** — a first-class object between the prompt and the tool calls, so the
  plan can be reviewed and revised before forty calls are spent on it, and so a shot can *cite*
  a blueprint.
- **Recipe freeze** — an approved video saved as a reusable named bundle (design spec +
  structure, content blanked), so the second video of a kind starts from a proven one.

---

## Sequencing rationale

**Why the knowledge layer is first, ahead of every engine item:** it fixes eight of fourteen
failure modes, it costs no engine work, and — critically — it is what makes the engine work
*legible*. Adding a spring curve to a system with no doctrine about when to use it changes
nothing, because the agent will keep reaching for whatever it reached for before.

**Why the perceptual check is second:** it is the mechanism that stops the improvement from
regressing. Every capability added after this point arrives with a way to tell whether it is
being used well. Without it, the eleventh video is as bad as the first and nobody can say why.

**Why motion before drawing:** the monotony failure is more visible than the missing-primitive
failure. A video with rectangles and *varied, well-timed* motion reads as designed; a video
with beautiful vector art and one easing curve reads as a slideshow.
