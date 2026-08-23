# round2 — why `wicks-v2` came out worse, and what to do

Round 1 turned taste into four metrics. The agent hit all four and shipped a video that is
**worse than the three it replaced on eight of nine measured axes**, and better only on the one
axis that became a number. This round measures why, and `50-PLAN.md` says what changes.

**The plan: [`50-PLAN.md`](50-PLAN.md).** Everything else is the evidence behind it.

---

## The three things that matter most

**1. Delete the argument, don't add the check.** 72 of 73 text elements in wicks-v2 are set
*smaller* than `add_text`'s own default `fontSize` of 64 — the tool default beat the agent's
explicit choice 98.6 % of the time — and where the default was wrong (`fontWeight: 400`) it was
taken whole on 73 of 73. No check bay can write is un-gameable in principle; the only lever left
is making the bad video **unrepresentable**. A style kit and a move registry collapse ~30 proposed
rules into two schema changes.

**2. Cap the rule set, not just the report, and make the gate bite.** `check` returned `ok:true`
with 242 warnings; the agent acted on **1** (0.5 %) — rationally, because 236 were false
positives. `render` never calls `check`. Round 2's corpus is ~250 rules and ~640 thresholds with
≥12 hard self-contradictions; **27 of the rules tested against the two admired references fire on
at least one of them, 14 on both.** Ship it as written and it is round 1 at higher resolution:
a distribution falls to a rotation table exactly as a count fell to a sprinkle. Hard budget:
**≤14 gating codes**, each shipping with four measured numbers (fires on wicks-v2, silent on R1,
silent on R2, doesn't rank wicks-v2 above its own predecessors).

**3. Build the ruler before the rules — and add the one rule nobody wrote: continuity.** There is
no reference fixture on disk; every threshold in the corpus is fitted to 1–4 of our own condemned
videos with a false-positive rate of *zero observations*. Separately: every difference metric in
the corpus (ink IoU, descriptor distance, dHash, "which two panels are most alike") pays for
maximal frame-to-frame difference, and **not one rule requires consecutive beats to share
anything** — so the corpus's global optimum is an eight-card carousel. One clause fixes it, and it
cannot be faked because element identity across time is a fact in the project file: *consecutive
compositions must share ≥1 persisting element id, and that element must have changed.*

---

## The files

### Diagnosis — what happened

| # | file | hook |
|---|---|---|
| 20 | [frame-forensics](20-frame-forensics.md) | Measured in pixels, wicks-v2 is worse than all three predecessors on 8 of 9 axes: 9.6 s frozen in stills >2 s (vs 0.0), bottom 22.9 % of frame identical in all 1830 frames, 2 hue bins, audio crest 5.9 dB vs 12.3–14.1 |
| 21 | [check-audit](21-check-audit.md) | The real checker returns `ok:true` with 24 warnings; 25 of 27 finding codes cannot fire by construction, and `no-hook` is switched off entirely by one **invisible** rectangle |
| 22 | [skill-blame](22-skill-blame.md) | The agent read 8 of 9 reference files in full and obeyed them — **wicks-v2 is the skill executed correctly**, so length was never the failure mode |
| 23 | [engine-truth](23-engine-truth.md) | `animate` has two implementations; the one the headless agent reaches rejects `spring-out`, refuses `property:"volume"`, and silently drops per-key easing — which is why the bed became 13 stepped clips |
| 24 | [session-forensics](24-session-forensics.md) | 15 snapshots, 12 opened, 7 fix rounds — **all 7 proofreading.** The agent opened the near-blank hook frame, said nothing, and rendered 91 seconds later |

### Craft — what a good one would do differently

| # | file | hook |
|---|---|---|
| 30 | [motion-doctrine](30-motion-doctrine.md) | The skill's own prescribed curve+duration pairings are below the perceptual floor — `expo-out` at 0.4–0.6 s is a 4–6 frame move, so the doctrine literally instructed the 3-frame pops |
| 31 | [typography](31-typography.md) | `fontWeight` is a silent typeface switch: an unmatched (family, weight) pair drops the family, so "300 vs 900" would ship a video set in Menlo Bold and a Korean UI font while passing every check |
| 32 | [composition](32-composition.md) | The largest object in every frame is a 34.2 %-of-canvas rectangle at 1.10:1 — the video is not sparse, it is **sub-threshold**. Plus C12 regime commitment, the most Goodhart-resistant rule in the corpus |
| 33 | [colour-and-look](33-colour-and-look.md) | The palette is `layout.md`'s table typed in verbatim, including the hex that file labels as failing contrast. And: **do not add a grain or gradient rule** — both references are flatter than we are |
| 34 | [psychology](34-psychology.md) | Opacity is the one class of visual change known *not* to capture attention; 90 % opacity animation means six of the twelve principles are mechanically unavailable |
| 35 | [music-and-sound](35-music-and-sound.md) | There is no tempo — the bed is a beatless drone, so every "land on the beat" line in the skill is unfalsifiable. Sync locks to a sound's **energy peak**, not its start, and by that measure the whooshes are 4 frames late |
| 36 | [story-and-script](36-story-and-script.md) | All six beats do the same job; the stake arrives at 81 % of runtime. **Contains §7, the 9-beat rewritten script that is the benchmark brief** |
| 37 | [prior-art](37-prior-art.md) | Round 1 already wrote the 17-move vocabulary as prose and got ~0 adoption — every system that gets good output from a weak author makes the vocabulary the **API**, not the documentation |
| 38 | [data-in-motion](38-data-in-motion.md) | The card was never empty of elements, it was empty of **ink**; and `back-out` on a data bar displays 110.0 % of its own number for a quarter second |
| 39 | [assets](39-assets.md) | macOS ships an offline asset factory — 8,302 SF Symbols with a synonym index and a full SVG rasteriser at `/usr/bin/sips` — and bay reaches neither. Also: **no pixel-histogram asset metric works**; four of five rank the good reference below us |
| 40 | [cuts-and-camera](40-cuts-and-camera.md) | All five seams are the same crossfade because a correct group seam costs 81 tool calls and a crossfade costs zero — the edit is missing for **economic**, not knowledge, reasons |
| 41 | [agent-craft](41-agent-craft.md) | The tool default beat the agent's explicit choice 98.6 % of the time. Stop writing checks over an unrestricted action space; delete the arguments |

### Prior art and open capability

| # | file | hook |
|---|---|---|
| 42 | [hyperframes-prior-art](42-hyperframes-prior-art.md) | Tested rather than assumed: of 24,300 lines, ~700 survive as content bay should carry (~3 %), and most of what survives is format and mechanism, not taste |
| 43 | [process-prior-art](43-process-prior-art.md) | In both reference pipelines the plan is a **file later steps mechanically read**, and structure is enforced by the filesystem and `process.exit(1)` — 188 elements in one scene is not expressible there |
| 44 | [expressive-tts](44-expressive-tts.md) | The flat read is mostly an **authoring** failure bay's tool surface makes unavoidable — one `speed` per paragraph, no pause authoring, no rate feedback. Fix that before downloading 4 GB of weights |
| 45 | [mix-and-sound-design](45-mix-and-sound-design.md) | Three corrections to the brief: `vol=2.0` was not driving the limiter (the bed sits 12 dB below peak), and the export chain **expands** LRA — the flat mix was authored |

### The deliverable

| # | file | hook |
|---|---|---|
| **50** | **[THE PLAN](50-PLAN.md)** | Diagnosis, then doctrine / guardrails / capability separated and ordered **consequence → representability → measurement → doctrine**; the skill loses 1,580 lines; the benchmark is §36.7 verbatim with 13 numeric pass criteria |

---

*Round-1 corpus: [`../00-index.md`](../00-index.md). Measured evidence for this round is in
`EVIDENCE.md` (scratchpad) and reproduced inline throughout.*
