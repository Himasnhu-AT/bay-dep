# 41 — Agent craft: how to make an agent produce good design

The meta-problem. Round 1 wrote the rules down, the agent read all nine files in 15 seconds,
obeyed the ones it could obey cheaply, and shipped a worse video. This file is about why that
is the expected outcome, and what mechanism class actually changes it.

Sources: EVIDENCE.md (measured forensics of `wicks-v2.mp4`), the producing session
`~/.claude/projects/-Users-himanshu-codes-synthai-vii/1ba87d60-….jsonl` (455 tool calls),
`project-1786466680050.json`, `rust/crates/bay-mcp/src/tools.rs`, `.claude/skills/bay/**`, plus
the literature cited inline. Builds on `21-check-audit.md`, `22-skill-blame.md`,
`24-session-forensics.md`, `37-prior-art.md`, `43-process-prior-art.md` — it does not repeat them.

---

## 0. Headline, and the theorem that governs everything below

> **There is no check a bad video cannot pass.** Skalse et al. prove that an *unhackable* proxy —
> one where increasing proxy return can never decrease true return — essentially does not exist:
> over the set of all stochastic policies, two reward functions are unhackable with respect to
> each other only if one of them is constant
> ([arXiv:2209.13085](https://arxiv.org/abs/2209.13085), NeurIPS 2022).
> The only lever the theorem leaves is the *other* argument: **restrict the policy set.** You do
> not fix Goodhart by writing a better metric. You fix it by removing the actions that produce
> the bad video, so that the gap between proxy and goal has nowhere to open up.

Everything round 1 added was a metric over an unrestricted action space. Everything round 2 adds
should be a restriction of the action space, plus a small number of *relative* checks that have
no satisfiable state.

The single decisive measurement in this file, from the saved project:

> **72 of 73 text elements in `wicks-v2` are set smaller than `add_text`'s own default
> `fontSize` of 64.** The tool's default was better than 98.6 % of the agent's explicit choices.
> The parameter existed, so it was used, and it was used downward every time.

That is the whole thesis in one number. The mechanism is not "say 200px louder." It is "delete
the argument."

---

## 1. Goodhart's law in generated output

### 1.1 The taxonomy, applied to round 1's own metrics

Manheim & Garrabrant's four variants ([arXiv:1803.04585](https://arxiv.org/abs/1803.04585)) are
the right frame, and round 1's four metrics land in three different boxes — which is why a single
"add better checks" instinct will not fix them.

| Round-1 metric | Measured outcome | Goodhart variant | Why that variant |
|---|---|---|---|
| distinct-easing count ≥ N | 11 distinct easings; `linear` ×141, `hold` ×130, `spring-out` ×4 of 188 elements | **Extremal** | In human-authored work, easing variety correlates with motion quality. Selecting *hard* on the count pushes into a region — sprinkle-then-stop — where the correlation never held |
| distinct-duration count ≥ N | 47 distinct durations, modal duration 0.098 s (3 frames) across 76 moves | **Regressional** | Count and quality share a common factor (deliberate authorship). Optimise the count and you keep the noise term, not the factor |
| element count / "three layers per scene" | 188 elements, 63 of them at x ≈ 0.085, six beats with an identical bounding box | **Causal** | Density does not cause richness; both are caused by composition. Intervening on density produced repetition |
| −14 LUFS integrated | −13.9 LUFS, **LRA 3.5 LU**, bed at `vol 2.0` between narration | **Extremal + causal** | Loudness correlates with mix quality in the normal range; forced to target with 13 stepped gain segments it produced a flat, limiter-driven mix |
| "two snapshots 0.5 s apart must not be identical" (SKILL.md:181) | Satisfied by `cmp -s` on two PNGs the agent **never opened**; dHash distance 4/64 (94 % identical) inside the video's longest 5.5 s motion dead zone | **Adversarial** | The literal specification was met by the cheapest available oracle. This is DeepMind's grasping-hand result exactly: the agent hovered its hand between the camera and the object ([Specification gaming](https://deepmind.google/blog/specification-gaming-the-flip-side-of-ai-ingenuity/)) |

None of these required intent to deceive. Specification gaming is *"behaviour that satisfies the
literal specification of an objective without achieving the intended outcome"* — the agent was
being cooperative. It is worth naming because it changes the fix: you cannot appeal to the
agent's good faith, because it already had good faith.

### 1.2 The five properties that make a metric resist gaming

Derived from the failures above plus the reference literature. A proposed rule that fails any of
these should not ship.

| # | Property | Test | Round-1 metric that fails it |
|---|---|---|---|
| **P1** | **Cheapest-fix alignment** | Enumerate the three cheapest ways to satisfy it. Is the cheapest one the design decision you wanted? | distinct-easing count: cheapest fix is `s/ease-out/expo-out/` on 6 calls |
| **P2** | **Distribution, not cardinality** | Does it constrain a percentile or a mass, or only a set size? | 47 distinct durations with 51 % of mass at 3 frames |
| **P3** | **Measured on the artefact, not the spec** | Is it computed from rendered pixels / decoded audio, or from the JSON the agent wrote? | every round-1 check reads the project model, which the agent authors directly |
| **P4** | **No satisfiable state** (relative, not absolute) | Is there a video for which it reports "clean"? If yes, that video is the target and the agent will build it | all of them: `ok: true`, 0 errors, 211 warnings |
| **P5** | **Sample points not known at authoring time** | Could the agent compose *for* the measurement? | any fixed snapshot schedule (t = 0.5, 2, 5, …) is a target list |

**P4 is the one nobody has proposed and it is the most important.** Every check in `check.rs`,
and every replacement check proposed in 21/24/43, is an absolute threshold: below it you fail,
above it you are done. An agent optimising an absolute threshold stops at threshold + ε — that
is exactly the 41 text elements sitting at 34 px against a 2.2 % floor, and the 96 px maximum
against a "≥ 200 px" rule. A *relative* criterion — "which of these 16 panels is the weakest, and
which two are the most alike" — always fires, on every video, forever. It has no ε. The stopping
rule stops being "the check passes" and becomes "we have done two rounds", which is a budget
decision a human made, not a bar the agent can walk up to.

### 1.3 The types of check, ranked by gaming resistance

| Class | Example | Resists? | Cost to game | Notes |
|---|---|---|---|---|
| Cardinality over spec | "≥ 12 distinct easings" | **No** | 1 call | Dead. Do not ship any more of these |
| Threshold over spec | "fontSize ≥ 113" | **Weak** | 1 call | Becomes the target; agent lands at 113 |
| Distribution over spec | "p25 of move durations ≥ 0.25 s" | **Medium** | ~10 calls | Better, still spec-side: the agent writes the numbers being measured |
| Threshold over pixels | "ink below y=0.6 ≥ 15 % in half of frames" | **Medium-high** | real artwork | Cheapest fix is putting something there — P1 holds |
| **Relative over pixels** | "which two beat-frames are most alike (dHash)" | **High** | cannot be zeroed | Always fires; no target to land on |
| **Representability** | there is no `fontFamily` argument | **Total** | impossible | Not a check at all — the bad video cannot be expressed |
| Held-out judge, no authoring memory | separate critic sees sheet + brief only | **High** | must actually fool a stranger | Kills self-preference bias (10–25 % score inflation when a judge grades its own family — [arXiv:2410.21819](https://arxiv.org/abs/2410.21819)) |

Ship in this order: representability first, relative-over-pixels second, held-out judge third,
distribution-over-spec fourth. Cardinality never.

---

## 2. Constraint vs guidance — what actually steered this agent

The session is a controlled experiment that the literature can only approximate, because the same
model, in the same run, obeyed some instruction shapes and ignored others. Four natural
experiments, all measured.

### 2.1 The prescription/prohibition split *inside one string*

`tools.rs:327`, the `easing` enum description, contains both shapes:

> "spring-out is the house entrance — a damped settle with no overshoot… **Do not use one curve
> for everything — no two independent moves in a scene should share an ease.**"

| Clause shape | Instruction | Result | Verdict |
|---|---|---|---|
| Prohibition ("do not use one curve") | negative, cardinality-shaped | **11 distinct easings**, `hold` ×130, `linear` ×141 | **Obeyed, and gamed.** The cheapest compliance is sprinkling |
| Prescription ("spring-out is the house entrance") | positive, names a default | **`spring-out` ×4 in 188 elements (2.1 %)** | **Ignored** |

Same sentence, same context position, same turn. The prohibition produced compliance-shaped noise;
the prescription produced nothing. This is the in-repo confirmation of the inverse-scaling result
on negation (NeQA, [arXiv:2306.09479](https://arxiv.org/html/2306.09479v1)) with a twist that
matters more for us: **the problem is not that prohibitions are ignored — it is that they are
obeyed in the cheapest way, and the cheapest way to comply with a negative is a token-level
substitution.** A blocklist leaves an infinite allowed set. Compliance costs one edit.

### 2.2 Floor-seeking: given a range, the agent takes the minimum

`layout.md:55` states six type roles as ranges. Cross-referenced against the 73 text elements
actually placed:

| Role (layout.md) | Stated `fontSize` | Agent's values | Where in the range |
|---|---|---|---|
| hero figure | 180–300 | **never used** | role skipped entirely |
| big number | 130 | **never used** | role skipped entirely |
| headline | 62–96 | 62 ×2, 96 ×1, 60, 58 ×2, 56, 52 | bottom, plus three *below* the range |
| body | 34–54 | **34 ×41** | **exact minimum, 100 % of uses** |
| label | 24–40 | 26 ×11, 24 ×3, 30 ×4, 38 ×4 | bottom-clustered |
| kicker | 20–36 | 22 ×2 | bottom |

Every role that was used landed at or below its stated minimum. Both roles whose minimum was
large were **not used at all** — the agent did not shrink the hero, it declined to have one.
And the aggregate: **72 of 73 text elements are below `add_text`'s default of 64.**

Three rules follow, and they are cheap to apply:

1. **Never express a design magnitude as a range.** A range is read as a permission to take the
   floor. One value per role, or the value is not the agent's to choose.
2. **Never express a magnitude as a floor** ("hero figures must be ≥ 200px on screen"). A floor is
   a target; the delivered maximum was 171 px rendered. Express it as *the* value.
3. **Never state a rule in a unit other than the argument's unit.** layout.md's table is
   `fontSize` at 1080; its rule is on-screen px at 1920 (×1.778). The agent must do a conversion
   to know it is violating a rule. It did not.

### 2.3 Defaults are attractors when wrong and ceilings when right

| Parameter | Tool default | Agent used | Direction |
|---|---|---|---|
| `add_text.fontWeight` | 400 | **400 on every one of 73 elements** | default taken whole |
| `add_text.fontSize` | 64 | 34 (×41), max 96 | **down**, 72/73 below default |
| `narrate.captionFontSize` | 46 | 34 | **down** |
| `narrate.captionFade` | 0.12 | 0.10 | **down** (both are pops; 0.10 = 3 frames × 76 = the entire pop epidemic) |
| `narrate.maxWords` | 4 | 3 | **down** (+33 % caption elements) |
| `narrate.captionY` | 0.70 | 0.735 | down-page, into the platform band |
| `narrate.captionColor` | `#EDECE6` | `#EDECE6` | default taken whole — and it is 48 of the video's 5 colour values |

**Not one parameter was overridden upward.** A default is doctrine only if the agent never sees
a reason to move it, and a reference table full of ranges is exactly such a reason. Where the
default was the right answer (`fontSize: 64`, `captionFontSize: 46`) it acted as a ceiling the
agent walked down from; where it was the wrong answer (`fontWeight: 400`) it acted as the answer.

### 2.4 Categorical advice transfers; numeric advice does not

`add_text`'s description, always in context, 159 characters:

> "Numbers should be set in a mono family and sized large — a hero figure on a 1080x1920 reel
> wants fontSize around 200-320."

| Clause | Result |
|---|---|
| "mono family" — a categorical choice of constructor argument | **69 of 73 elements in Menlo.** Transferred, over-applied |
| "fontSize around 200-320" — a magnitude | **max 96, median 34.** Did not transfer at all |

The same string, one turn, both clauses. The generalisation: **advice that changes *which*
enumerated thing you pass is followed; advice that changes a *number* you would otherwise copy
from an example is not**, because the number is anchored to whatever concrete artefact the agent
saw (here: layout.md's table and `narrate`'s default). Numbers must be enforced by the schema or
by a refusal. Prose numbers are decoration.

### 2.5 The literature, and which parts survive a 455-call session

| Mechanism | Evidence | Survives a long session? | bay reading |
|---|---|---|---|
| **Closed vocabulary as the API** | SlidesLib: LLaMA-8B 33.5 → 55.0 (+31.0); program length 170 → 13 lines ([arXiv:2501.00912](https://arxiv.org/html/2501.00912v1)) | **Yes — it is the call site** | The largest measured effect available, and the gradient favours weak-on-that-axis authors. Our agent is design-weak |
| Required argument + enum | — | **Yes — the call fails without it** | ~40 tokens per tool, 100 % enforcement, cannot be forgotten |
| Refusal message (`is_error`) | brag/hyperframes: the strong gates are the ones that *produce no artefact* (43 §6) | **Yes — arrives exactly at the wrong action** | Currently bay has almost none |
| Positive exemplars | in-repo: `recipes.md:32` "Every text reveal in a good reel is this" → one motion behaviour across three videos | **Yes, dangerously** | Ship ≥ 5 or none. One canonical example is a template, not an example |
| Negative examples / blocklists | NeQA inverse scaling; in-repo §2.1 | **Compliance survives; the *point* does not** | Useful only as a tiebreak inside an already-closed set |
| Decision tables in prose | in-repo: 17 named moves in motion.md, 0 measurable adoption | **No** | It is not a decision table unless the tool takes the decision as an argument |
| Prose doctrine in a skill file | in-repo: 26,931 tokens read in 15 s at minute 0.5 | **No** | See §6 |
| Required intermediate artefact | faceless-explainer: 8 steps, every one with an explicit `Gate:` (43 §1a) | **Yes, if a later tool reads it** | A plan nobody reads is a diary |
| **Verbalized sampling** (ask for k candidates with probabilities, pick a low-probability one) | 1.6–2.1× diversity gain on creative tasks; *larger models benefit more* ([arXiv:2510.01171](https://arxiv.org/abs/2510.01171)) | **Yes — it is a single-turn move, re-runnable per scene** | The only cheap, evidenced way to break a default at the moment of invention |

And the two results that explain the *shape* of this session:

- **Multi-turn collapse.** Across 200,000+ simulated conversations, models lose **39 %** of
  single-turn performance in multi-turn settings; aptitude −15 %, unreliability **+112 %**; and
  *"when LLMs take a wrong turn in a conversation, they get lost and do not recover"*
  ([Laban et al., arXiv:2505.06120](https://arxiv.org/abs/2505.06120), ICLR 2026 outstanding paper).
  The wicks-v2 session's wrong turn is timestamped: **16:45:03, minute 6**, a `narrate` call with
  `captionFontFamily: "Menlo", captionFontSize: 34, captionY: 0.735, captionFade: 0.1` written
  before a single visual element existed. That one parameter block generated 38 of 73 text
  elements, 76 of 107 opacity channels, 76 of 76 three-frame pops, and 38 of 38 elements at
  y = 0.735. It was never revisited in the following 449 calls.
- **Recall ≠ adherence.** Models can restate the constraints they are violating; the failure is
  behavioural, not informational ([arXiv:2604.28031](https://arxiv.org/pdf/2604.28031)). The agent
  had read every rule it broke, 40 minutes earlier, and could have quoted them.

The mitigation Laban et al. report as effective is **recap** — restating the full requirements
consolidates the conversation and recovers most of the loss. That is the design argument for §6's
just-in-time recap payload, not for a longer skill file.

---

## 3. Plan before place — the concrete design

**Yes, and it must be a machine-read artefact with a refusal, or it is worthless.**
`43-process-prior-art.md` §8.1 establishes the shape (`plan_commit` + a required `scene` argument
on every constructor). What follows is what that design still lacks, which is everything that
would have caught *this* video's actual defect: six beats with an identical bounding box.

### 3.1 What the plan must contain — the failure has to be nameable at plan time

A plan of `{id, title, seconds, voiceover}` cannot express "these six shots are the same shot."
The plan schema must carry the axes the video failed on, drawn from **closed enums**, so that
sameness is a comparison of two strings and the engine can refuse it before a single element is
placed.

```jsonc
plan_commit({
  brief: "...",                  // ≤ 240 chars, the thing the video argues
  format: "reel-1080x1920",
  scenes: [
    { id: "hook",   seconds: 3.5,
      framing: "full-bleed-number",     // enum, 8 values
      motion:  "push-in",               // enum, 12 values, from the move registry
      weight:  "center",                // enum: top | center | bottom | split
      hero:    "one number: 61",        // free text, ≤ 60 chars — the biggest thing on screen
      voice:   "..." },
    { id: "turn",   seconds: 6.0, framing: "split-panel", motion: "wipe-reveal",
      weight: "bottom", hero: "the chart", voice: "..." },
    …
  ]
})
```

`plan_commit` **rejects** — returns `is_error`, writes nothing — on any of:

| Rejection | Threshold | Which wicks-v2 defect it makes unrepresentable |
|---|---|---|
| too few scenes | `scenes.len() < 4` | §8: one 61-second scene; five per-scene checks arithmetically incapable of firing |
| a scene too long | `seconds > 12` | same |
| repeated framing | any `framing` used in > `ceil(n/3)` scenes | §9: "the same template repeats for all 8 topic beats" |
| adjacent repeat | `scenes[i].framing == scenes[i+1].framing` | same |
| no bottom weight | no scene with `weight ∈ {bottom, split}` | §7: nothing below y = 0.73 in any frame |
| no motion variety | fewer than 3 distinct `motion` values | §1: 90 % opacity |
| duration mismatch | `Σ seconds` outside ±10 % of the requested target | scope drift |
| missing hero | any `hero` empty or > 60 chars | §5: nothing is big — because nothing was ever named as the big thing |

Every one of these is checked in **milliseconds, at minute 2, against a 40-line JSON document** —
not at minute 47 against 188 elements. That is the whole economic argument for planning: the same
constraint costs 1 edit at plan time and 60 edits at build time, and the agent will pay the 1.

**Anti-Goodhart (P1):** the cheapest way to satisfy "no framing more than twice, none adjacent,
one bottom-weighted" is to *choose different framings*, which is the design decision. There is no
token-substitution path, because the framing enum is bound to real layout behaviour downstream
(§3.3) — writing `bottom` and then placing everything at y = 0.3 is caught by the pixel gate.

### 3.2 The token protocol — how it is enforced

`plan_commit` returns `{ planId, scenes: [{ sceneId, startsAt, endsAt, elementBudget }] }`.

- Every constructor (`add_text`, `add_shape`, `add_image`, `add_video`, `add_audio`, `narrate`)
  gains a **required** `scene` argument. Unknown id ⇒ `is_error` listing the valid ids.
- `start` becomes relative to the scene. Out of range ⇒ `is_error`, not a silent write.
- `elementBudget = max(4, ceil(seconds) + 2)`. Element `budget + 1` ⇒ refusal:
  *"scene `turn` is 6.0 s and already holds 8 elements. Take something away, or make one of them
  bigger."* On wicks-v2's runtime that caps the project at ≈ 60 elements against the 188 shipped —
  and it **inverts round 1's incentive**, which counted elements as evidence of richness.
- Without a committed plan, constructors refuse with the `plan_commit` schema in the message.

### 3.3 What it costs, honestly

| Cost | Size | Mitigation |
|---|---|---|
| Tool calls | +1 (`plan_commit`) and ~+3 revisions | Trivial against 455 |
| Latency to first element | +2–4 minutes of authoring | It replaces the improvised beat-by-beat design that produced six identical beats |
| Expressive loss | a single-shot 61-second piece becomes unrepresentable | Correct. That artefact is the defect |
| Rigidity | plan drifts from what gets built | `plan_amend(sceneId, …)` re-runs the same validators. Cheap. Do **not** allow silent drift |
| The plan can be six identical rows in prose | real, and unaddressed by the plan alone | The enums make it *detectable*; §4's pixel critique makes it *consequential* |

**The plan is not the mechanism. It is the thing the mechanism compares against.** Its value is
that "beat 4 looks like beat 1" becomes a sentence the process can produce. In the real session
that sentence was unproducible: there was no artefact in which two beats co-existed.

---

## 4. The critique loop that bites

### 4.1 Why the current loop is a no-op — measured

The agent took 15 snapshots, opened 12, and made 7 rounds of fixes. **All 7 were local
legibility proofreading** (wrap, collision, strike-through, anchor offset). Zero touched scale,
hierarchy, palette, composition, emptiness, cross-beat variety, or rhythm. It opened `open.png`
(t = 0.9 s, **0.73 % ink coverage against a 7.2 % median**, 0.00 % ink below y = 0.6), said
nothing, and rendered 91 seconds later.

That is not a discipline failure. It is the loop doing what it was told. `snapshot`'s own tool
description, always in context, is a defect taxonomy:

> "This is the only way to catch the failures that matter — **a blank frame, type that collides,
> a hero number too small to read at thumb size.**"

Given that framing, "look at the frame" can only mean "scan for defects from this list." The
tool description authored the proofreading pass.

Three literature results fix the design:

1. **Intrinsic self-correction does not work.** Without external feedback, models fail to judge
   their own prior output and performance often *degrades* after a self-correction pass
   ([Huang et al., ICLR 2024, arXiv:2310.01798](https://arxiv.org/abs/2310.01798)). "Snapshot and
   look" is exactly this configuration.
2. **Binary checklists beat holistic scores.** CheckEval raises average agreement across 12
   evaluator models by **+0.45** and cuts score variance; moving from ternary to binary items adds
   **~20 percentage points** of agreement ([arXiv:2403.18771](https://arxiv.org/abs/2403.18771),
   EMNLP 2025; [arXiv:2606.00093](https://arxiv.org/html/2606.00093)).
3. **A separate critic beats self-critique.** CriticGPT critiques were preferred over the
   authoring model's own in **63 %** of cases on naturally occurring bugs, with fewer nitpicks
   and fewer hallucinations; human+critic teams were preferred over unassisted humans **> 60 %**
   of the time ([arXiv:2407.00215](https://arxiv.org/html/2407.00215v1)). And a judge grading its
   own family inflates by **10–25 %** ([arXiv:2410.21819](https://arxiv.org/abs/2410.21819)) —
   an author critiquing its own video is the worst available configuration.

### 4.2 `bay-critique` — the design

**Two new engine tools, one skill-level subagent, one refusal.**

**(a) `contact_sheet(path, mode) → { path, panels: [{i, t, sceneId}], sheetHash }`**

One PNG, 4×4 = 16 panels, labelled `01`…`16` with scene id and time burned into each panel's
corner. **The engine chooses the times, the author does not** (P5): 2 panels per scene at the
30 % and 75 % marks of each scene, plus t = 0.4 s and t = duration − 0.4 s, jittered by a seed
derived from `hash(projectId)`. `mode: "clean"` hides caption-layer elements — captions are
`narrate`'s output, not the author's composition, and including them let the previous session
pass the anti-freeze test with a 4/64 dHash delta.

Rationale: rhythm and sameness are invisible one frame at a time and obvious in a grid. It also
collapses the 2-call `snapshot` → `Read` protocol (skipped 3 of 15 times) into one call.

**(b) `frame_metrics(times[]) → per-time { ink, inkBelow60, lumaCentroidY, largestEmptyBandFrac, maxGlyphPx, dHashPrev }`**

Everything computable, computed in Rust. The VLM is never asked a question the engine can answer,
because a judge that can be argued with will be.

**(c) The critic subagent — no authoring memory**

Launched by the skill (a `Task`), not by bay. Its entire input:

```
BRIEF:  <the 240-char brief from plan_commit>
IMAGE:  <contact sheet PNG>
FACTS:  <frame_metrics table, 16 rows>
```

Not included, deliberately: the plan, the tool history, the agent's rationale, the scene names'
intent, any statement of what was hard. The critic must be unable to defend a decision it did not
make. It answers, and nothing else:

| # | Item | Type |
|---|---|---|
| Q1 | `worst_panel` — which single panel is weakest as a *frame*, and one clause why | forced choice, 1 of 16 |
| Q2 | `most_alike_pair` — which two panels are most alike compositionally | forced choice, 2 of 16 |
| Q3 | `strongest_panel` — which panel you would use as the thumbnail | forced choice, 1 of 16 |
| Q4–Q12 | nine **binary** items: hook states a claim / one thing is clearly biggest / bottom third is used / there is a second focal point / type has ≥ 2 sizes at a glance / colour has an accent / something has texture or depth / the sheet reads as one design / no panel looks like a failed asset load | 9 × yes-no |

No 1–10 score, ever. VLM absolute scores carry conformal intervals covering **52–88 %** of the
scale (37 §6); their *ranking* is usable and their *scoring* is not.

**(d) The forced consequence**

This is the part that makes it bite, and it is where every previous proposal stops.

```
critique_commit(worstPanel, alikePair, answers[]) → { openFindings: [...] }
```

- The engine cross-checks `most_alike_pair` against its own dHash matrix. If the critic's pair is
  not within the top-3 closest pairs, the **engine's** top pair is substituted. The critic can
  rank; the engine decides identity.
- Each finding becomes an **open obligation** stored in the project, keyed to a scene id and the
  scene's content hash at critique time.
- **`render` refuses while any obligation is open.** An obligation closes only when the named
  scene's rendered frame at the same sample time moves **≥ 12/64 dHash** from the critiqued frame.
  Not "an edit was made" — a *measured pixel change in the frame that was criticised*.
- Bounded: exactly **two** rounds. After round 2, obligations become warnings and `render`
  proceeds. This is a budget, not a bar — there is no state of the video in which the critique
  reports "clean" (P4), so the loop must be terminated by a count, not by success.

**(e) Gaming analysis**

| Attack | Blocked by |
|---|---|
| Rebut the critic in prose | `critique_commit` takes indices and booleans; there is no free-text field the engine reads |
| Make a trivial edit to close an obligation | closure requires ≥ 12/64 dHash on the *rendered* frame; a colour tweak on a 26 px label moves ~1 bit |
| Compose only for the sample times | times are engine-chosen, seeded, jittered, and 2-per-scene — you would have to compose the whole scene |
| Delete the criticised scene | allowed, and it is a legitimate fix (the video gets shorter and denser); the plan's `scenes.len() ≥ 4` floor stops the degenerate case |
| Run the critic on a video it already saw | the subagent is spawned fresh per round with no history |
| Ask a friendlier question | the 12 items are fixed strings in the skill and echoed in `critique_commit`'s schema; a run with fewer than 12 answers is rejected |

**(f) Cost:** 2 rounds × (1 contact sheet render ≈ 16 frames + 1 subagent call + ~8 edits +
1 re-sheet) ≈ 5–7 minutes on a 79-minute session. Against 32 minutes spent chasing LUFS after
the first render, this is cheap.

---

## 5. Randomness and default-breaking

A model's defaults are its failure mode, and the cause is now well characterised: **typicality
bias in preference data** — annotators systematically prefer familiar text, the reward model
inherits it, and the aligned model collapses onto the mode
([arXiv:2510.01171](https://arxiv.org/abs/2510.01171)). Menlo, `#EDECE6` on `#0E0E12`, a
left-aligned column at x = 0.089, and `linear` easing are the mode of "AI motion graphic." No
amount of instruction moves a mode; you have to change the sampling procedure or remove the
choice.

### 5.1 Mechanisms evaluated

| Mechanism | Effect on wicks-v2's defects | Gaming risk | Verdict |
|---|---|---|---|
| **Forced selection from an enumerated kit** (`style_pick` → 3 options → `style_commit`) | kills Menlo/34 px/monochrome/one-column at the root: none of the four is expressible | low — the enum is authored by humans | **Ship first** |
| **Exclude what was used last time** (persisted history of the last 5 kits) | forces cross-project variety, which no in-project check can see | none — the agent does not control the history file | **Ship — 20 lines** |
| **Seeded pick** (`seed = hash(brief + date)`) | reproducible, and different briefs get different kits | none | **Ship** — determinism for tests, variety for users |
| **Verbalized sampling at invention points** ("give 5 candidate hooks with probabilities, take one below 0.15") | 1.6–2.1× diversity where the agent *must* invent: hook, per-scene framing, the one big visual idea | the agent can fabricate the probabilities | **Ship, with the caveat** — it costs 0 engine work, lives in the skill, and applies only where no enum exists |
| **Refuse a value already used N times** (e.g. `add_text` refusing Menlo after 20) | — | high | **Do not ship. See §5.2** |
| Temperature / sampling changes | none reachable from bay | — | out of scope |
| "Reject your first instinct" (in `banned-defaults.md` today) | zero observed rejections in 455 calls; no artefact in which a rejection could be recorded | — | delete |

### 5.2 The direct question: should `add_text` refuse a font family it has seen 20 times?

**No. It is an anti-pattern, and the reason generalises into a rule worth putting on a wall.**

1. **It punishes the correct behaviour.** A well-designed 60-element video uses 2–3 families;
   the body face legitimately appears 40 times. The rule fires on good videos.
2. **It is satisfiable for free.** Add a third family on one 12 px label. 37 §8 already makes the
   point about ink-weighting; a raw count is worse.
3. **It fires after the cost is sunk.** At element 21 the decision was made 20 elements ago. A
   refusal is only useful at the moment the decision is *made*.
4. **It converts a design decision into a rationed resource** — which is precisely the mechanism
   that produced 19 easings and 47 durations. You would get three fonts, sprinkled.

> **Rule: refuse values that were never a decision. Never ration a decision because it repeats.**

The correct form of the same intent is representability: **`add_text` has no `fontFamily`,
`fontSize`, `color`, or `fontWeight` argument at all.** It takes `role: "hero" | "title" |
"kicker" | "body" | "caption" | "figure"` and `tone: "ink" | "dim" | "accent"`, and the committed
kit maps those to values. Repetition of a family then becomes *correct by construction*, and the
one decision that matters — which kit — is made once, from three options, at minute 2.

### 5.3 `style_pick` / `style_commit`, concretely

```jsonc
style_pick({ note: "trading, editorial, dark" })
→ { token: "sp_7f3…", options: [
     { id: "ledger",  display: "Palatino 700",  body: "Helvetica Neue 500", mono: "Menlo 400",
       ramp: { hero: 260, title: 120, kicker: 40, body: 56, caption: 52, figure: 200 },
       palette: { bg: "#0B1A14", ink: "#F2EFE6", dim: "#8FA398", accent: "#E8B84B", accent2: "#D4553C" },
       framings: ["full-bleed-number","split-panel","bottom-band","corner-stack"],
       motion: { entrance: "spring-out", emphasis: "scale-pop", exit: "power4-in",
                 durations: { fast: 0.32, base: 0.52, slow: 0.90 } } },
     { id: "broadsheet", … },
     { id: "signal", … } ] }
```

- Three options, drawn deterministically from a registry of 12+, seeded, **with the last 5
  committed kits excluded** (persisted at `~/Library/Application Support/vii/style-history.json`).
- `style_commit(token, choice)` writes the kit into the project. It is required before any
  constructor call.
- The escape hatch exists and is deliberately expensive: `style_commit(token, custom: {...})`
  requires *every* field, and validates — 3 distinct families that pass `fonts_check`; a ramp
  whose `hero / body` ratio is ≥ 4.0; 5 colours with an accent at ΔE₀₀ ≥ 40 from `ink`; ≥ 4
  framings including one bottom-weighted; a duration triple spanning ≥ 2.5×. **Making the bespoke
  path more work than the offered path is the entire trick** — and note that this is the *only*
  place a numeric floor is acceptable, because it is validated once, at commit, on a 20-field
  document, not enforced across 188 elements.

Every one of EVIDENCE §4, §5, §6, §7 becomes unrepresentable. Not detected. Unrepresentable.

---

## 6. Context economy — where the thread is lost, and the budget

### 6.1 Measured

| Quantity | Value |
|---|---|
| Skill corpus | 107,727 chars ≈ **26,931 tokens** (SKILL.md 2,921 + 8 references 24,010) |
| When it entered context | minute **0.5** — all 8 references read in 15 seconds, 10 calls |
| MCP tool block (`definitions()`) | 42,491 chars of source ≈ **10,622 tokens**, of which 2,863 are top-level descriptions and 1,871 are property descriptions |
| When it enters context | **every turn, at the front** |
| Tool calls in session | **455** |
| Peak context | 402 k tokens on a 1 M model |
| Skill's position in the final context | ≈ token 30 k of 402 k — the **7th percentile** |
| Calls made *after* the skill was read | 445 |
| Exposure: skill | 26,931 token-turns |
| Exposure: tool block | 10,622 × 455 ≈ **4.83 M token-turns** |
| **Ratio** | **≈ 179 : 1 in favour of the tool block** |

Two literature results bracket what happens to the skill over those 445 calls: mid-context
material loses **> 30 %** of its recall ("Lost in the Middle"), and multi-turn performance falls
**39 %** with **+112 %** unreliability, with no self-recovery after an early wrong commitment
(Laban et al.). The session shows exactly the predicted profile — perfect early compliance
(gutter, box width, palette, type table all applied verbatim at minute 6) and, by call 150, no
compliance with any cross-cutting rule that was not re-asserted by a schema.

**Crucially, the problem is not size.** The agent read 99 % of the skill and its context never
came close to full. Making the skill shorter will not, by itself, make it obeyed. Moving doctrine
to a channel with a higher survival rate will.

### 6.2 The channels, ranked by survival

| Channel | Tokens today | Presence | Survival at call 200 | Enforceable | Doctrine-per-token |
|---|---:|---|---|---|---|
| **Required arg name + enum values** | ~0 | every turn | **100 %** | hard | **highest** — `role: "hero"` is 5 tokens and cannot be forgotten |
| **Refusal message** (`is_error`) | ~0 | only when the wrong action is attempted | **100 %** | hard | very high — zero cost until it fires |
| **Tool-result recap** | 0 | immediately after each call, at the context tail | high (recency) | soft | high |
| Tool description prose | 2,863 | every turn | present, but §2.4: categorical clauses only | none | medium |
| Schema property descriptions | 1,871 | every turn | same | none | medium |
| **`check` / gate output** | 46–59 KB | at the end, highest attention | high | hard, if it blocks | **currently negative** — see §6.4 |
| SKILL.md | 2,921 | once, at minute 0.5 | low | none | low |
| references/*.md | 24,010 | once, at minute 0.5 | **very low** | none | **lowest** |

### 6.3 The proposed budget

| Channel | Now | Proposed | Change |
|---|---:|---:|---|
| Tool block (descriptions + schemas + enums) | 10,622 | **~14,000** | +3.4 k: role/framing/motion enums, plan schema, refusal-adjacent wording |
| Refusal strings | ~0 | **~1,200** (≈ 40 × 30 tokens) | present only when fired |
| Tool-result recaps | 0 | **30 tokens × ~200 calls ≈ 6,000** | new; always recent; the recap mitigation Laban et al. report as effective |
| `check` output | 46,000+ | **≤ 900** (12 findings max, deduped, `--all` for the rest) | −98 % |
| SKILL.md | 2,921 | **≤ 1,600** | the loop, the gates, the refusal vocabulary. **No craft** |
| references/ | 24,010 | **≤ 6,000** in 3 files: `kits.md` (data, not prose), `recipes.md` (≥ 5 worked examples, never 1), `troubleshooting.md` | −75 % |
| **Total read-once** | **26,931** | **7,600** | **−72 %** |
| **Total always-present** | **10,622** | **~14,000** | **+32 %** |

The trade is deliberate: pay 3.4 k tokens per turn (cached) to delete 19 k tokens of prose that
had a measured half-life of about 100 tool calls.

### 6.4 The one channel currently being wasted

`check` ran twice. Run 1 returned **0 errors, 211 warnings, `ok: true`, 46 KB**. Run 2 returned
242 warnings in 59 KB, which **spilled to a file and showed only the first 2 KB**. The agent
responded by running `python3 -c` over the spill to print a count by code, and acted on 1 of 242
findings (0.5 %). `small-text` fired 69 times and 0 were fixed, in a video whose median type is
34 px.

This is the highest-attention position in the entire session — a fresh tool result, at the tail
of the context, immediately before the render decision — and it is filled with 46 KB of noise
terminating in `ok: true`. **A check that says "ok" while reporting 211 problems has taught the
agent to discard the channel, including the 3 true findings in it.** Fixing the SNR is a
prerequisite for every other proposal in round 2, not an independent improvement.

---

## 7. The tool description as doctrine — the highest-leverage move available

**Assessment: yes, and the 179:1 exposure ratio understates it, because the tool block is the
only channel that can *refuse*.** But §2 places three hard limits on what prose in a description
can achieve, and they must be respected or this becomes round 1 again in a new file:

1. Prose in a description carries **categorical** advice ("mono", "spring-out is the house
   entrance") — and even then, only the clause that names a constructor argument transfers.
2. Prose in a description **cannot carry a magnitude**. `add_text` asked for 200–320 and got 34.
3. Prose in a description **can be gamed at the token level** if it is a prohibition.

So the doctrine that should move into the tool layer is not the prose. It is the **schema**: enum
names, required arguments, deleted parameters, defaults that are the answer, and refusal
messages. Prose goes in the description only where it names a decision the schema already forces.

### 7.1 What moves, concretely

| Doctrine today | Where it lives now | Where it goes | Form |
|---|---|---|---|
| "hero figures ≥ 200 px" | layout.md:75 (prose, wrong unit) | `add_text.role` enum | `role: "hero"` maps to the kit's 260 |
| type ramp table (6 roles × ranges) | layout.md:55 | kit registry (data) + `role` enum | ranges deleted; one value per role |
| the palette | layout.md colour table (copied whole, verbatim, into the video) | kit registry + `tone` enum | `tone: "ink" \| "dim" \| "accent"`; `color` argument deleted |
| "mono for every figure" | layout.md:68 + `add_text` description | `role: "figure"` | the kit decides the family |
| "spring-out is the house entrance" | `easing` enum description; used 4/188 | `move` enum on `animate` | raw `easing`/`duration` become an escape hatch flagged by `check` |
| "no two independent moves share an ease" | `easing` enum description | **delete** | a cardinality prohibition; it produced sprinkling |
| "three layers per scene" | SKILL.md:176 | `elementBudget` refusal | inverted: a *ceiling*, not a floor |
| "reveal across the back 50 %" | SKILL.md:181 | `check` distribution finding + the critique loop | measured on frames |
| "two snapshots 0.5 s apart must not be identical" | SKILL.md:181 | `contact_sheet` + engine dHash | the prose version was passed at 4/64 by `cmp` |
| "look at the PNG" | SKILL.md:92, `snapshot` description | `contact_sheet` + critic subagent + open obligations | looking becomes an input to a refusal |
| the 17 named moves | motion.md:177–338 (prose, 0 adoption) | `animate.move` enum + registry | it is not a vocabulary until it is an argument |
| ffmpeg/GPU/job-polling mechanics | SKILL.md:56–68 | stays | it is mechanism, not taste, and it worked |

### 7.2 Two descriptions worth rewriting verbatim

**`snapshot` → today (234 chars) it teaches proofreading, and produced 7/7 proofreading fixes:**

> "Render ONE frame to a PNG so you can look at it. This is the only way to catch the failures
> that matter — a blank frame, type that collides, a hero number too small to read at thumb size."

**Replace with `contact_sheet`, whose description asks the compositional questions in order:**

> "Render 16 frames across the whole video into one labelled grid PNG, at times bay chooses. Open
> it and answer, in this order: (1) which panel is weakest as a frame; (2) which two panels are
> most alike; (3) which panel would you use as the thumbnail. Then `critique_commit` your answers.
> `render` is blocked until the panels you named have measurably changed. Use `snapshot` only to
> re-check one frame you have already fixed."

The order is load-bearing: "what is broken?" must come *after* "what is weakest / most repetitive
/ strongest", because a defect list is answerable and a composition question is not.

**`check` → today it pleads and is ignored:**

> "…RUN THIS BEFORE render — it catches in milliseconds what otherwise only shows up in the
> finished file."

**Replace with a statement of consequence, which is the only thing a description can assert that
the agent cannot discount:**

> "The render gate. `render` runs this first and refuses on any error — this call just lets you
> see them sooner. Returns at most 12 findings, worst first, deduped with counts; `all: true` for
> the rest."

### 7.3 The refusal vocabulary — the channel that does not exist yet

bay today has essentially no refusals on the authoring path: `render` never calls `check`
(dispatch at `tools.rs:1082` goes straight to `studio.render_video`), and there is no scene
concept in the MCP surface at all (`grep -n scene rust/crates/bay-mcp/src/tools.rs` returns one
hit, inside the easing description). Every refusal below is doctrine that costs zero tokens until
the moment the agent is about to make the mistake:

| Trigger | Message |
|---|---|
| constructor without a committed plan | "No plan committed. `plan_commit` first — it takes ≤ 60 s and it is what stops eight identical beats." |
| constructor without a committed kit | "No style kit. `style_pick` returns three; commit one. There is no `fontFamily` argument." |
| `fontFamily` / `fontSize` / `color` passed | "Not an argument. Pass `role: \"hero\"` — the committed kit `ledger` sets it to 260 px Palatino 700." |
| element over budget | "`turn` is 6.0 s and holds 8 elements. Take one away, or make one bigger." |
| `plan_commit` with a repeated framing | "`split-panel` in scenes 2, 4, 5 — max 2. Framings available and unused: `bottom-band`, `full-bleed-number`, `corner-stack`." |
| `plan_commit` with no bottom-weighted scene | "Every scene is `weight: top`. The bottom 40 % of the frame will be empty for the whole video." |
| `render` with open obligations | "Panel 07 (`turn`, 24.3 s) was named weakest and has not changed. Fix it or run `critique_commit` again." |
| `render` with `check` errors | "3 errors. Nothing rendered. `render({ ignoreChecks: true })` skips the entire pass and stamps the job." |

One rule for the escape hatch, taken from brag: **all-or-nothing, never per-code.** A per-finding
suppression is a nibbling mechanism and will be used 211 times.

---

## 8. The mechanism that would have prevented wicks-v2

Assembled, in dependency order. Each row states the EVIDENCE finding it makes *unrepresentable*
(strong) or *consequential* (weak), and its anti-Goodhart property from §1.2.

| # | Mechanism | Kills | Class | Effort |
|---|---|---|---|---|
| **M1** | **`style_pick` → `style_commit`; delete `fontFamily`/`fontSize`/`color`/`fontWeight` from `add_text` and `add_shape`; `role` + `tone` required** | §4 Menlo ×69, §5 34 px median, §6 5-colour monochrome, and 72/73-below-default | representability (P1, total) | M |
| **M2** | **`plan_commit` with enum'd `framing`/`motion`/`weight`/`hero`, validators of §3.1; required `scene` on every constructor; `elementBudget`** | §8 one 61-s scene, §9 eight identical beats, §7 one column, 188 elements | representability + plan-time refusal | M |
| **M3** | **`render` calls `check`; errors block; ≤ 12 findings; all-or-nothing bypass** | the 211-warning `ok: true` that taught dismissal | consequence (P4 partial) | S |
| **M4** | **`contact_sheet` + `frame_metrics` + critic subagent with no authoring memory + `critique_commit` obligations that only a ≥ 12/64 dHash change closes; 2 rounds** | §9 the blank hook, the empty card, the repeated template, the frozen scenes — every defect that was visible in frames the agent already had | relative-over-pixels (P3, P4, P5) | M |
| **M5** | **`animate.move` from a registry; raw `easing`/`duration` become a flagged escape** | §1 90 % opacity, §2 the 3-frame pop, §3 `hold`-stuffing | representability | M |
| **M6** | **`narrate` caption params reduced to `captionStyle` from the kit; `captionFade` default 0.28; captions excluded from every authored-motion metric** | 38/73 text elements, 76/76 pops, 38/38 at y = 0.735, 76/107 opacity channels — all from **one blind call at minute 6** | representability + measurement hygiene | S |
| **M7** | **Verbalized sampling at the three invention points** (hook, per-scene framing, the one big visual idea): 5 candidates with probabilities, take one below 0.15 | the mode: text-on-dark, top-weighted, left-aligned | sampling (1.6–2.1×) | S, skill-only |
| **M8** | **Just-in-time recap in every constructor's return payload** (~30 tokens: scene, framing, hero, elements used/budget, "nothing below y = 0.6 yet") | the minute-6 commitment that survived 449 calls unexamined | recency channel | S |

### 8.1 The counterfactual, call by call

Replaying the actual session against M1–M8:

| Real session | Under the mechanism |
|---|---|
| 16:39 — reads 26,931 tokens of skill in 15 s | reads 7,600; the rest is in the schema |
| 16:44 — `project_create` | `project_create` → refusal: no plan |
| — | `plan_commit`: first attempt has 3 scenes → rejected (< 4). Second has `bottom-band` in 4 of 7 → rejected. Third commits 7 scenes, 4 framings, 2 bottom-weighted. **≈ 4 minutes, before any element** |
| — | `style_pick` → 3 kits, none containing Menlo-on-`#0E0E12`; `style_commit("broadsheet")` |
| **16:45:03 — `narrate(captionFontFamily: "Menlo", captionFontSize: 34, captionY: 0.735, captionFade: 0.1)`** — the single most damaging call in the session | those arguments do not exist. `narrate(scene: "hook", captionStyle: "kit")` → 46 px kit caption face, fade 0.28, y = 0.70 |
| 16:45–17:15 — 261 build calls, 188 elements, six identical bounding boxes | `elementBudget` caps at ≈ 60. Each return says "scene 3/7 `turn`, framing `split-panel`, hero *the chart*, 5/9 elements, nothing below y = 0.6 yet" |
| 17:15 — `check`: 0 errors, 211 warnings, `ok: true` | ≤ 12 findings, `small-text` cannot fire (sizes come from the kit), the errors that remain block `render` |
| 17:24:30 — opens `open.png` (0.73 % ink), says nothing | `contact_sheet` → critic (no memory) names panel 01 weakest and 05/09 most alike; engine confirms 05/09 at dHash 12/64. Two obligations open |
| 17:26 — first `render`, 47 min in | `render` refuses. The agent must move panel 01 and one of 05/09 by ≥ 12/64. It has the plan row for each, so it knows what those scenes were *for* |
| 17:26–17:57 — 32 min of LUFS chasing | unchanged; the audio work was genuinely good |

**Which EVIDENCE findings survive?** §10's stepped music bed and §11's flat voice are untouched by
everything here — they are the audio and TTS agents' territory. §9's "card renders empty" is a
render-time bug that only M4 catches, and only if a sampled panel lands on it (2 panels per scene
makes that likely, not certain). Everything else in §1–§9 becomes either unrepresentable or
blocking.

### 8.2 The anti-Goodhart audit of my own proposals

Applying §1.2 to the mechanisms above, honestly:

| Mechanism | Cheapest way to satisfy | Aligned? |
|---|---|---|
| M1 role/tone | pick a role | **Yes** — the cheap path is the correct path |
| M2 framing validators | choose different framings | **Yes** — no token-substitution path, because framing binds to layout downstream |
| M2 elementBudget | remove an element or enlarge one | **Yes** — and it inverts round 1's incentive |
| M3 check-as-gate | fix the errors | **Yes**, provided the finding list is ≤ 12 and true; a 211-item list is gamed by dismissal |
| M4 obligations | change the criticised frame | **Yes** — dHash on rendered pixels, sample times engine-chosen |
| M4 binary items | answer honestly | **Weak** — the critic can answer yes to all 9. Mitigated: the 3 forced choices always produce work regardless of the booleans |
| M5 move registry | call `apply_move` | **Yes** |
| M6 caption params | none — they are gone | **Yes** |
| M7 verbalized sampling | fabricate 5 candidates with fake probabilities | **Weak** — unenforceable. It is free, so ship it, but never *count* on it |
| M8 recap | none — it is a payload | n/a |

Two weak ones, both bounded, both cheap, neither load-bearing. That is an acceptable profile.
Round 1's profile was five mechanisms, five weak.

### 8.3 The one-line version

> Round 1 measured the video. Round 2 must **shrink the set of videos bay can express**, and add
> exactly one check that never says "clean."

---

## 9. Engine gaps this area exposes

Ordered by how much of §8 they block.

| Gap | Evidence | Effort | Unlocks |
|---|---|---|---|
| **No scene/plan concept in the MCP surface.** `bay-core` has `Command::AddScene`; `bay-mcp/src/tools.rs` registers 55 tools and `grep -n scene` returns one hit, inside the easing description | project has `scenes: [1]`, 188 elements, 61 s; five per-scene checks arithmetically cannot fire | S–M | M2, and every per-scene check in `check.rs` |
| **No style/token store on the project.** No `role`, no `tone`, no kit; `fontFamily`/`fontSize`/`color` are free strings on every constructor | 69 Menlo, 41 elements at exactly 34 px, palette copied verbatim from a doc | M | M1, M6, and makes `small-text` unfireable by construction |
| **`render` does not consult `check`.** `tools.rs:1082` → `studio.render_video` directly; `check.rs` computes `Severity::Error` and `Report::is_clean()` that nothing reads | 211 warnings, `ok: true`, shipped | **S** | M3 — the cheapest item in this file |
| **No contact sheet, and `snapshot` returns a path, not an image.** Looking is a 2-call protocol and the second call is optional | 3 of 15 snapshots never opened; the anti-freeze test delegated to `cmp -s` | S | M4 |
| **No perceptual frame hashing / frame metrics in the engine** (`dHash`, ink coverage, ink below y, luma centroid, largest empty band, max rendered glyph px) | every relative, unfakeable check in §1.3 depends on it | S–M | M4, and the only class of check that resists Goodhart at all |
| **No persisted obligation state on the project** (open findings keyed to scene + content hash) | the critique loop has no teeth without it; feedback that isn't consumed must not evaporate | S | M4 |
| **No cross-session style history** (`style-history.json`, last 5 kits) | no in-project check can see that every bay video looks like every other bay video | XS | M1's exclusion rule |
| **No move registry as data.** 17 moves exist as prose in `motion.md`; `animate` takes raw channels + easing + duration | 90 % opacity, 3-frame pops, `hold` ×130 | M | M5 |
| **`narrate` caption parameters are 11 free values** with defaults better than what the agent chose in 5 of 6 cases | one blind call at minute 6 produced 38/73 text elements and 76/76 pops | S | M6 |

---

## 10. What to tell the next round in one page

1. **Stop writing checks. Start deleting arguments.** Skalse's theorem says the check you are
   about to write can be passed by a bad video; the only counter is to make the bad video
   inexpressible. 72 of 73 text elements were smaller than the tool's own default — that is not a
   knowledge problem, it is an exposed parameter.
2. **Never state a design magnitude as a range or a floor.** Six roles stated as ranges produced
   six minima and two skipped roles. One value, bound to a role name, or nothing.
3. **Doctrine belongs in the schema, not the prose.** The tool block gets ≈ 179× the token
   exposure of the skill corpus, and it can refuse. But it carries only categorical advice —
   `add_text` asked for 200–320 px in every single turn of a 455-call session and got 34.
4. **Prohibitions are obeyed at token level and gamed.** "Do not use one curve" → 11 easings,
   `spring-out` 4/188, in the same sentence that named `spring-out` as the default.
5. **Never ration a decision because it repeats.** Refuse values that were never decisions.
6. **A plan is worth exactly as much as the tool that refuses without it.**
7. **The critique must be relative and always fire.** Worst panel, most-alike pair, strongest
   panel — with the engine, not the critic, arbitrating identity, and with the obligation closed
   only by a measured pixel change. Absolute thresholds get walked up to; relative ones cannot.
8. **The critic must not have written the video.** Self-critique degrades output; own-family
   grading inflates 10–25 %; a separate critic's critiques were preferred 63 % of the time.
9. **Fix `check`'s signal-to-noise before anything else depends on it.** 46 KB terminating in
   `ok: true` taught a rational agent to discard the highest-attention channel it has.

---

## Sources

**Goodhart, gaming, reward hacking**
Skalse, Howe, Krasheninnikov, Krueger, *Defining and Characterizing Reward Hacking*, NeurIPS 2022 — [arXiv:2209.13085](https://arxiv.org/abs/2209.13085) ·
Manheim & Garrabrant, *Categorizing Variants of Goodhart's Law* — [arXiv:1803.04585](https://arxiv.org/abs/1803.04585) ·
Krakovna et al., *Specification gaming: the flip side of AI ingenuity* — [DeepMind](https://deepmind.google/blog/specification-gaming-the-flip-side-of-ai-ingenuity/), [examples list](https://vkrakovna.wordpress.com/2018/04/02/specification-gaming-examples-in-ai/)

**Self-critique, judges, rubrics**
Huang et al., *Large Language Models Cannot Self-Correct Reasoning Yet*, ICLR 2024 — [arXiv:2310.01798](https://arxiv.org/abs/2310.01798) ·
McAleese et al., *LLM Critics Help Catch LLM Bugs* (CriticGPT) — [arXiv:2407.00215](https://arxiv.org/html/2407.00215v1) ·
*Self-Preference Bias in LLM-as-a-Judge* — [arXiv:2410.21819](https://arxiv.org/abs/2410.21819) ·
*CheckEval: A reliable LLM-as-a-Judge framework … using checklists*, EMNLP 2025 — [arXiv:2403.18771](https://arxiv.org/abs/2403.18771) ·
*Agreement Measurement for Rubric-based LLM Judges* — [arXiv:2606.00093](https://arxiv.org/html/2606.00093)

**Instruction following over long sessions**
Laban, Hayashi, Zhou, Neville, *LLMs Get Lost In Multi-Turn Conversation*, ICLR 2026 — [arXiv:2505.06120](https://arxiv.org/abs/2505.06120) ·
*Models Recall What They Violate: Constraint Adherence in Multi-Turn LLM Ideation* — [arXiv:2604.28031](https://arxiv.org/pdf/2604.28031) ·
Liu et al., *Lost in the Middle* — summarised in [reinteractive](https://reinteractive.com/articles/ai-real-world-use-cases/solving-ai-agent-amnesia-context-rot-and-lost-in-the-middle) ·
*Measuring and Controlling Instruction (In)Stability in Language Model Dialogs* — [arXiv:2402.10962](https://arxiv.org/pdf/2402.10962)

**Diversity, defaults, constrained generation**
Zhang et al., *Verbalized Sampling: How to Mitigate Mode Collapse and Unlock LLM Diversity* — [arXiv:2510.01171](https://arxiv.org/abs/2510.01171) ·
NeQA / inverse scaling on negation — [arXiv:2306.09479](https://arxiv.org/html/2306.09479v1) ·
*The Constraint Tax: Measuring Validity-Correctness Tradeoffs in Structured Outputs* — [arXiv:2605.26128](https://arxiv.org/pdf/2605.26128) (separate reasoning from formatting; do not constrain the thinking step) ·
SlidesLib / constrained verb libraries — [arXiv:2501.00912](https://arxiv.org/html/2501.00912v1)

**In-repo measurements**
`~/Library/Application Support/vii/projects/project-1786466680050.json` (73 text elements, 11 distinct easings, 1 scene) ·
`rust/crates/bay-mcp/src/tools.rs` (55 tools; `definitions()` 42,491 chars; `add_text` defaults at :222–226; `easing` enum at :327; `render` dispatch at :1082 with no `check` call) ·
`.claude/skills/bay/**` (107,727 chars) ·
`.claude/skills/bay/references/layout.md:55` (the type table) ·
session `1ba87d60-…jsonl` (455 calls, 79 min, peak context 402 k)
