# Motion craft — timing, easing, and the doctrine

The core reference. If only one file gets read before authoring a timeline, this is it.

---

## Part 1 — the physics the eye expects

### The 12 principles, and the four that matter here

The 12 principles (Thomas & Johnston, *The Illusion of Life*, 1930s Disney) are: squash and
stretch, anticipation, staging, straight-ahead vs pose-to-pose, follow-through and overlapping
action, slow in / slow out, arcs, secondary action, timing, exaggeration, solid drawing, appeal.

For motion graphics and UI the heavy hitters are **easing, timing, follow-through/overlap, and
anticipation** — internalising those four is what immediately reads as professional.

| Principle | What it means for a title card or a chart |
|---|---|
| **Slow in / slow out (easing)** | Nothing in the physical world starts or stops instantly. Linear motion reads mechanical — it is the single loudest amateur tell. |
| **Timing** | Duration communicates weight. A 0.15 s move and a 1.2 s move of the same element say different things about how heavy it is. |
| **Follow-through / overlap** | Parts of a thing do not stop at the same instant. Overlapping entries (start the next before the last settles) is what makes a group arrival feel alive rather than gridded. |
| **Anticipation** | A small preparatory move before the main action tells the eye where to look. A 3-frame dip before a rise. |
| **Arcs** | Natural motion travels curves, not straight lines. A move that changes both x and y should not do it on a diagonal ruler line. |
| **Squash & stretch** | Even rigid elements benefit from a subtle stretch on a fast move and a small squash on landing. In a compositor: `scaleY` up + `scaleX` down by a few percent, resolving to 1. |
| **Secondary action** | The supporting move that follows the primary one — the underline that draws *after* the word lands, the shadow that catches up. |
| **Staging** | One clear subject per moment. If the eye has to choose, the composition has failed. |

### Easing is emotion, not technique

**The transition is the verb. The easing is the adverb.** A slide-in with `expo.out` is
confident; with `sine.inOut` it is dreamy; with `elastic.out` it is playful. Same motion,
different meaning.

**Direction rules — not optional:**

- `.out` for things **entering**. Starts fast, decelerates. Feels responsive. The default.
- `.in` for things **leaving**. Starts slow, accelerates away. Throws them off.
- `.inOut` for things **moving between positions** in place.

Getting this backwards is common and costly: ease-in on an entrance feels sluggish; ease-out on
an exit feels reluctant.

### Speed communicates weight

| Duration | Reads as |
|---|---|
| 0.15–0.3 s | energy, urgency, confidence |
| 0.3–0.5 s | professional, most content |
| 0.5–0.8 s | gravity, luxury, contemplation |
| 0.8–2.0 s | cinematic, emotional, atmospheric |

**Asymmetry:** entrances need longer than exits. A card takes 0.4 s to appear and 0.25 s to
leave.

### Motion blur, and why crisp reads as fake

Motion blur comes from shutter angle: at 24 fps with a 180° shutter the exposure is 1/48 s, and
whatever moves during it smears. That smear is what the eye has learned to expect from moving
images. Rendered motion with none of it is *unnaturally* sharp — the give-away that something
was composited rather than filmed. A VFX element whose blur does not match the plate reads as
fake instantly.

For a motion graphic the practical form is: **fast moves need blur, and the blur must resolve
to zero at the settle.** Peak blur scales with subject size — ~10 px on text (20 px smears
letterforms into illegibility and reads as a glitch, not speed), 18–20 px on a full-frame
surface (big textured surfaces survive heavy blur; light blur on a full-frame move reads as a
rendering hiccup).

---

## Part 2 — the doctrine (load-bearing)

These four rules are the difference between a clip that reads as a serious piece and one that
reads as an agent-made PowerPoint. They are the distilled house rules of the most developed AI
motion-graphics toolchain surveyed (§09), and they match what the professional shops do.

### 1. Smooth beats bouncy — long-tail deceleration is the default

Elements should settle on **long-tail decel curves**. `power3.out` is enough in most cases;
`expo.out` for a fast arrival with a long settle. **No bouncy, no overshoot, no `back.out` /
`elastic.out` / `bounce.out` as a default.**

Bouncy is the #1 instant turn-off in user-made motion videos. The model reaches for it because
it thinks overshoot adds emphasis — it buys that emphasis at the cost of cleanliness. Overshoot
is demoted to a rare, explicitly-playful exception (a consumer logo slam, a deliberate bell
hit), never the house style.

The physically-correct form of "smooth settle" is a **critically damped spring** (ζ = 1) — real
physics, same doctrine, not a licence for bounce.

### 2. Sequential reveal in the back ~50%, timed to the voice

The anti-slideshow mechanism, and the sharpest rule in this document.

- **Do not dump everything on screen in the first ~25%** of a scene.
- **Reveal each piece — a line, a card, even the headline — when the voiceover mentions it**,
  sequencing reveals across the later ~50%.
- **Less is more.** Fewer things, each arriving on its spoken cue, beats a full canvas that
  animated once and froze.

Practically: the scene's entrance carries only what the voice is saying at t=0; everything else
waits in the timeline for its cue. Same amount of authoring, coherent result.

This is why the *script* has to be written as discrete cues rather than one run-on breath.
"First the snowball — then the hill — then the speed" hands the shot its reveal cadence for
free; a single long clause leaves the frame nothing to pace to.

### 3. No lazy breathing, no bad pan/push — "no motion over bad motion"

The two reflexive ways to fake aliveness both read cheap:

- **No lazy breathing.** Scaling cards or text up and down in a loop to look "alive" is the
  tell. Do not reach for it.
- **No slow pan/push in the back half of a shot.** It disrupts the viewer's sightline and
  causes eye discomfort — it actively makes the frame worse.

The fix for both is rule 2 — stagger reveals in time with the script. The governing principle:
**a held, still frame is better than a frame kept "alive" by breathing or a drifting camera.**

The **only** sanctioned aliveness during a hold is a **low-amplitude jitter** — a small
positional/scale wobble that keeps a settled frame from reading dead without reading weak. Also
acceptable: internal motion of the subject itself (a clock's hands turning, a dashed line
flowing) — that is the subject doing something, not a card breathing.

### 4. Seams are velocity-matched cuts

When two things swap — a line for a line, a scene for a scene — make it a velocity-matched cut,
not a slideshow cut: **cut at peak velocity, match direction and speed on both sides.** Full
recipes in [`05-cuts-transitions-camera.md`](05-cuts-transitions-camera.md).

**One-line summary of the doctrine:** *Smooth long-tail over bouncy; reveal sequentially in the
back 50% timed to the voice, not dumped in the first 25%; no lazy breathing and no bad slow
pan — prefer stillness, with subtle jitter as the only aliveness; cut at peak velocity with
matched direction and speed.*

---

## Part 3 — the guardrails you know and violate anyway

Stated as prohibitions because that is the only form that survives contact with a generating
model.

- **Don't use the same ease on every move.** Vary eases like you vary font weights — no more
  than two independent moves sharing an ease in a scene.
- **Don't use the same speed on everything.** The slowest scene should be ~3× the fastest.
- **Don't enter everything from the same direction.** Vary: from left, from right, from scale,
  opacity-only, letter-spacing, from behind a mask.
- **Don't use the same stagger everywhere.** Each scene needs its own rhythm.
- **Don't put ambient motion on every scene.** Pick a different ambient per scene — or none.
  Stillness after motion is powerful.
- **Don't start at t=0.** Offset the first move 0.1–0.3 s. Zero-delay reads as a jump cut.

---

## Part 4 — scene structure and choreography

### Build / breathe / resolve

Every scene has three phases, and the common failure is dumping everything into the first:

- **Build (0–30%)** — elements enter, staggered. Not all at once.
- **Breathe (30–70%)** — content visible and readable, at most ONE ambient behaviour.
- **Resolve (70–100%)** — exit or a decisive stop. Exits are faster than entrances.

Everything must **settle before its reading window opens.** No element should still be moving
when the viewer is meant to read it.

### Choreography is hierarchy

**The element that moves first is perceived as most important.** Stagger in order of
importance, not in document order. Overlap entries rather than waiting for completion. Cap a
group's total stagger at **~500 ms regardless of item count** so the arrival reads as one beat
rather than a queue.

### Transitions carry meaning

- **Crossfade** = "this continues"
- **Hard cut** = "wake up" / disruption / register shift
- **Slow dissolve** = "drift with me"

The common error is to crossfade everything. Hard cuts are for disruption and are correct for
rapid-fire lists and percussive edits.

---

## Part 5 — the move vocabulary

Naming the move is what stops an agent from defaulting. Every element in a storyboard should
carry a **verb**; if you cannot name the verb, the element is not yet designed.

**Impact / weight:** SLAMS · CRASHES · PUNCHES · STAMPS · SHATTERS · DROPS
**Directional / deliberate:** SLIDES · PUSHES · PULLS · WIPES · CUTS
**Reveals / builds:** DRAWS · FILLS · GROWS · EXPANDS · ASSEMBLES · COUNTS UP
**Organic / ambient:** FLOATS · DRIFTS · BREATHES · PULSES · ORBITS · MORPHS
**Mechanical / precise:** TYPES ON · CLICKS · LOCKS IN · SNAPS · STEPS

A named-move palette, as a shared vocabulary between a plan and its implementation:

| Family | Moves |
|---|---|
| Kinetic type | hard-cut word-swap · in-place token cycle · per-word staggered reveal · beat-slam |
| Typewriter | type-on with caret · backspace-and-retype |
| Count-up / data | value-scaled counter (size grows with value) · bar / progress / star-wipe |
| Reveal / decode | 3D char flip-decode · SVG self-draw |
| Camera | push / focus / drift · zoom-to-target · pan / focus-lock · cursor tracking |
| Layout | cluster→outward expansion · orbit · split-tilt cards · ring + connectors |
| Morph / handoff | scale-swap · card morph-anchor |
| Emphasis | highlight sweep · hand-drawn circle · burst · scribble · underline draw |
| Aliveness | subtle jitter · live SVG internals · one bounded ambient (last resort) |
| Depth | depth-of-field / selective blur · motion-blur streak · 3D scatter-assemble |

---

## Part 6 — determinism (why some "obvious" motion cannot be rendered)

Anything frame-rendered rather than played must be a **pure function of time**:

- **No infinite motion.** "Particles loop forever," "logo rotates forever" — any aliveness is a
  *finite* tween over the hold.
- **No randomness, no wall-clock.** Variation must derive from element index, not `random()`.
  Two renders of the same project must be identical.
- **State at any time must be reachable by seeking**, not by having played through.

bay is already on the right side of this (keyframes sampled at a time; no runtime randomness),
which is an advantage over browser-based pipelines where this is the top source of
"looked right in preview, wrong in the render" bugs.

---

## Sources

- [12 Principles of Animation — Adobe](https://www.adobe.com/creativecloud/animation/discover/principles-of-animation.html)
- [Understanding the 12 Principles of Animation — Pluralsight](https://www.pluralsight.com/resources/blog/software-development/understanding-12-principles-animation)
- [Motion Design Principles: The Complete Animation Guide](https://trydemotion.com/blog/motion-design-principles-animation)
- [Motion Blur: What It Is and How It Affects Visuals](https://garagefarm.net/blog/motion-blur-what-it-is-and-how-it-affects-visuals)
- [Debunking the 180-degree shutter rule — Wipster](https://www.wipster.io/blog/debunking-the-180-degree-shutter-rule)
- [Frame Rate, Motion Blur, and the Cinematic Look](https://camerabutter.com/blogs/the-camera-butter-reel/frame-rate-motion-blur-and-the-cinematic-look)
- Encoded practice: `~/.claude/skills/hyperframes-creative/references/motion-principles.md`,
  `~/.claude/skills/faceless-explainer/references/motion-language.md`,
  `~/.claude/skills/hyperframes-animation/rules-index.md`
