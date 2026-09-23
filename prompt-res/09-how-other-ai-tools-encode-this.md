> **Historical:** describes the Rust engine, deleted; recover what it cites with `git show rust-engine-final:dep/rust/<path>` (e.g. `crates/bay-mcp/src/tools.rs`).

# How other AI video tools encode craft

A survey of the AI video toolchains installed on this machine, read for **architecture** rather
than for output. The question: what do they know that bay's skill doesn't, and how is that
knowledge structured so a model actually applies it?

Surveyed: **HyperFrames** (`hyperframes`, `-core`, `-creative`, `-animation`, `-keyframes`,
`-cli`, `-registry`), **faceless-explainer**, **brag**, **kai-video**.

---

## 1. The headline finding

HyperFrames ships **~3,700 lines of craft doctrine** across `hyperframes-creative`,
`hyperframes-animation` and `faceless-explainer` — before any code. bay's skill ships ~450 lines
across SKILL.md plus six references, most of which is API usage and layout.

That is the gap, stated numerically. The engines are not that far apart in raw capability (bay
is arguably *better* at determinism, export fidelity and running headless). The knowledge layer
is not close.

---

## 2. The architecture they all converge on

Every mature tool in the survey uses the same five-layer separation:

```
  BRIEF        what, for whom, where it will play, aspect, length
    ↓
  STORY        beats: role, persuasion technique, emotional beat, voiceover, seam
    ↓
  DESIGN SPEC  palette, type, spacing, motion energy, easing set, atmosphere  (one file)
    ↓
  SHOTS        per beat: a time-coded shot sequence naming moves from a fixed vocabulary
    ↓
  BUILD        one worker per beat, implementing the cited recipe — never improvising motion
    ↓
  VERIFY       lint + check + contact sheet, then a human look
```

**The load-bearing property is that motion is *cited*, not invented.** A shot names a move
("per-word staggered reveal") and a rule id; the implementer *reads that rule's body* and
reproduces it. Names come from an index; a name that isn't in the index is an error. This is
what stops the model from defaulting to `y:30, opacity:0, power2.out` on everything — it never
gets to choose freely.

bay has none of this. An agent using bay goes straight from a prompt to `add_text` +
`animate`, choosing every curve, duration and direction itself, at the moment of the call, with
no vocabulary to draw from and nothing to cite.

---

## 3. What each layer contains

### A design spec, written once, referenced everywhere

A single token block per project carrying colours, type scales, radii, spacing, **and motion**:
energy level, entry/exit/ambient easings, entrance/hold/transition durations, atmosphere
layers, signature transition. The coupling is deliberate — a luxury palette with 0.2 s snappy
entrances is incoherent, and a spec that carries both makes the incoherence impossible.

Eight named starter styles (§06) each anchored to a real design tradition (Müller-Brockmann,
Vignelli, Brody, Scher, Anadol, Sagmeister, Terrazas, Hillmann) — with a **mood → style** picker
so the choice is made from "what should the viewer feel" rather than from "what's the topic."

### A rule registry — atomic, citable motion recipes

~45 rules, each a file at `rules/<id>.md`, each with a one-line description, tags, and a
**Critical Constraints** section listing only what is specific to it beyond a shared contract.
Categories: text & typography, data & stats, camera & viewport, layout & network, SVG & icons,
idle & ambient, transition & motion.

The shared contract is stated **once**, at the index, and every rule inherits it: one paused
timeline; seek-safe in both directions with explicit from-states; deterministic (no random, no
wall-clock, finite repeats); transforms and paint-only properties (no width/height animation);
group stagger capped at ~500 ms; no CSS transitions on animated elements.

### A blueprint layer — proven whole-shot shapes

22 blueprints, each a **time-coded shot template** (`Scene N (a–b s): …` with slots and one
named signature move), reverse-engineered from **178 real product-launch clips**. Each declares
which narrative roles it serves and its duration range. A blueprint encodes a whole shot across
its full duration — reveals paced to the spoken line, not dumped at t=0 — so instantiating one
*structurally prevents* the slideshow failure.

This is the most interesting artifact in the survey. It is empirical: someone watched 178 good
videos and extracted the shapes. That is a different kind of knowledge from a style guide, and
it is the kind an agent can actually execute.

### A cut catalog

Four velocity-matched seam techniques with exact numbers — distances, durations, eases, blur
peaks, opacity values at the cut frame, stagger decay factors — plus a choosing table and an
anti-pattern table. Reproduced in [`05-cuts-transitions-camera.md`](05-cuts-transitions-camera.md).

### A doctrine file, written as prohibitions

`motion-language.md` Part 2 is four rules stated as *what the model does wrong and must stop
doing*, with the reason attached. The framing matters: "don't use the same ease on every tween —
**you default to `power2.out` on everything**" lands where "vary your easing" does not.

### A verification loop

`lint` (structural), `check` (contrast/WCAG, layout, timing), a **contact sheet** of frame
midpoints inspected in one batch, then a human look before render. Plus an explicit note that
batching visual checks matters for cost, so inspect at phase boundaries rather than mid-build.

---

## 4. Practices worth stealing wholesale

| Practice | Why it matters | bay today |
|---|---|---|
| **Cited motion from a named vocabulary** | removes the model's freedom to default | absent |
| **Blueprints as time-coded shot templates** | structurally prevents slideshow | absent |
| **Design spec coupling palette + motion** | prevents incoherent combinations | absent (looks are grades only) |
| **Doctrine written as prohibitions** | survives contact with a generating model | partial (`layout.md` has some) |
| **Banned-defaults list** (fonts, colours, patterns) | breaks monoculture | absent |
| **Rule contract stated once, inherited** | keeps 45 recipes consistent and short | n/a |
| **Sketch/wireframe pass before dressing** | catches layout errors before motion is spent | absent |
| **Contact sheet, batched** | one image beats N single-frame views | `snapshot` is one-at-a-time |
| **Per-beat metadata: role, technique, emotional beat** | forces each beat to have a job | absent |
| **Recipe freeze** — an approved run saved as a reusable named bundle | second video of a kind starts from a proven one | absent (templates exist but thin) |

## 5. Where bay is genuinely ahead

Worth stating, because the plan should not throw these away:

- **Determinism is free.** Keyframes sampled at a time in a Rust engine; no browser clock, no
  `immediateRender` surprises, no "looked right in the preview, wrong in the render." A large
  fraction of HyperFrames' rule contract exists purely to work around the browser being a
  real-time engine. bay does not need any of it.
- **Export is real.** Source-resolution streamed encode with an explicit codec/CRF path,
  distinct from the preview cache by design. Browser-capture pipelines fight this constantly.
- **One engine, three front ends.** The same logic serves the GPUI app, wasm, and MCP — an
  agent's edit lands in the timeline a human is looking at, and undoes with the same keystroke.
  No surveyed tool has this.
- **Synthesised SFX at the exact length of the move** (§07). The others ship sample packs and
  inherit the duration-mismatch problem.
- **A structural `check` already exists** and is well-designed (severity levels, stable codes,
  warnings that don't block). It is the right foundation; it just measures the wrong axes so far.
- **Nothing downloads.** Looks are generated in code, not fetched — no licence question, no
  broken path, works offline.

## 6. What the other tools are for (so we don't copy the wrong thing)

- **kai-video** is upstream of all of this: it produces *scripts and clipping plans*, not
  compositions — hook/body/CTA structure, on-screen text cues with timings, platform notes. It
  is a useful model for the **script artifact** bay's pipeline currently skips over.
- **brag** is a narrow vertical: turn a project's own code into a launch video, with bundled
  music and SFX libraries and pre-analysed **music cue files** (beat/section markers extracted
  per track, stored alongside the audio). That cue-file idea is directly applicable — a bed with
  its beat grid already computed removes the hardest part of cutting to music.
- **faceless-explainer** is the closest analogue to bay's typical job (invent every visual from
  text) and is therefore the best single source for story structure and seam craft.

---

## Sources

All in `~/.claude/skills/`:
`hyperframes/SKILL.md` · `hyperframes-core/references/production-loop.md`, `review-loop.md` ·
`hyperframes-creative/references/{motion-principles,typography,visual-styles,beat-direction,house-style,audio-reactive}.md` ·
`hyperframes-animation/{rules-index,blueprints-index,techniques}.md` ·
`faceless-explainer/references/{story-design,motion-language,cut-catalog,visual-design}.md` ·
`brag/assets/music/cues/*.music-cues.json` · `kai-video/SKILL.md`
