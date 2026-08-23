# prompt-res — how to make videos that don't look AI-made

Research corpus assembled 2026-08-11 for **bay** (`vii/`). The question it answers:

> Our AI-authored videos are bad. What actually separates a professional motion graphic from
> what we ship, and what has to change in the software for the agent to be *able* to make one?

Everything here is either (a) craft knowledge sourced from the web and from the encoded
practice of other AI video tools installed on this machine, or (b) a measurement of bay's
current engine read against that standard. The final two files are the deliverable: a
capability map and a ranked plan.

---

## The one-page version

**The diagnosis is not "the model has bad taste." It is three compounding things:**

1. **The expressive ceiling is low.** An agent can only make the moves the tool can express.
   bay can animate 7 scalar channels through *one* easing curve per channel, on rectangles,
   ellipses and single-style text. So every entrance is `opacity + y`, every emphasis is
   `scale`, every cut is a dissolve. The monotony people read as "AI slop" is, mechanically,
   the tool's move vocabulary showing through.

2. **Nothing in the loop measures the axes that matter.** `check` catches off-canvas, tiny
   type, gaps, silence — structural defects. Nothing measures *motion variety, rhythm,
   depth, contrast-under-motion, audio balance, or hook strength*. What isn't measured
   regresses to the model's average, and the average of all motion graphics is slop.

3. **The craft isn't written down where the agent reads it.** The skill teaches the API and
   some layout. It does not carry the doctrine — smooth over bouncy, sequential reveal timed
   to voice, no motion over bad motion, cut at peak velocity, land on the beat, three layers
   per frame. Competing tools ship 3,500+ lines of exactly this.

**Then we measured five real videos** (§12) — two references we admire, three of our own — and
the evidence sharpened point 1 considerably. Both references turn out to be reproducible in
bay's *current* primitive set: neither needs a gradient, an animated mask, a keyframable effect,
a stroked path, or a 3D transform. Meanwhile our three videos contain **one distinct motion
behaviour between them**, no music, no SFX, and sit 11–13 LU below the references' loudness —
all of it capability bay already has and the agent is not using.

**Therefore the fix is, in this order:** teach the doctrine in the skill (§02–§08) and delete
the line that prescribes the monotony; turn on the audio bay already has; make the quality gate
measure what actually breaks (§11 Phase B); build an asset pipeline, because the references are
made of *stuff* and ours are text on black; and only then raise the engine's expressive ceiling
(§10). The full re-ranking is at the end of §12.

---

## The files

| # | File | What's in it |
|---|---|---|
| 01 | [why-ai-video-is-bad.md](01-why-ai-video-is-bad.md) | The 14 failure modes, with the mechanical cause of each |
| 02 | [motion-craft.md](02-motion-craft.md) | Timing, easing, spacing, the 12 principles, the load-bearing doctrine |
| 03 | [typography-and-layout.md](03-typography-and-layout.md) | Type in motion, kinetic type, canvas grids, safe areas, captions |
| 04 | [story-and-psychology.md](04-story-and-psychology.md) | Hooks, retention, structure, emotional arc, narration, rhythm |
| 05 | [cuts-transitions-camera.md](05-cuts-transitions-camera.md) | Editing grammar, velocity-matched cuts, transition taxonomy, camera |
| 06 | [color-look-and-texture.md](06-color-look-and-texture.md) | Palette systems, grading, grain, vignette, bloom, depth layering |
| 07 | [audio.md](07-audio.md) | SFX design, beat sync, ducking, LUFS, the mix that sells the picture |
| 08 | [data-in-motion.md](08-data-in-motion.md) | Animated charts, count-ups, staging, annotation |
| 09 | [how-other-ai-tools-encode-this.md](09-how-other-ai-tools-encode-this.md) | Survey: HyperFrames, faceless-explainer, brag, kai-video |
| 10 | [capability-map-bay-vs-ideal.md](10-capability-map-bay-vs-ideal.md) | **The gap map** — engine, MCP surface, skill, quality gate |
| 11 | [action-plan.md](11-action-plan.md) | **What to build, ranked by quality-per-unit-work** |
| 12 | [video-teardowns.md](12-video-teardowns.md) | **Measured teardowns of 2 reference videos and 3 of ours — and the re-ranking they force** |

## How to read this if you are the agent making a video

Read 02, 03 and 04 before writing a timeline. Read 05 before placing a second scene. Read 07
before rendering. 06 and 08 are situational. 09–11 are for the people changing the software,
not for making a video.

## Provenance

Web sources are cited inline in each file. The encoded-practice sources are the skills
installed at `~/.claude/skills/`: `hyperframes-creative`, `hyperframes-animation`,
`hyperframes-core`, `faceless-explainer`, `brag`, `kai-video`. bay's own state was read from
the code on branch `fix/pending-sweep`, 2026-08-11 — see
[`docs/native/editor-capability-audit.md`](../docs/native/editor-capability-audit.md) for the
prior audit this builds on.
