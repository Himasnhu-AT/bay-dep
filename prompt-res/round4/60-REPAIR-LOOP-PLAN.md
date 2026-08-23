# Round 4 — the repair loop

Two acceptance runs are on record: `research/final-acceptance/REPORT.md` and `REPORT-2.md`. Both
end at **0/3 renders**. Round 3 fixed real bugs — karaoke went from 16/101 words within two frames
to 101/101, `auto_reframe` stopped self-incriminating, transcript splices stopped inflating
continuity failures — and acceptance did not move at all. That is the finding this round starts
from: bay can *diagnose* a bad edit accurately and cannot *repair* one.

The loop terminates at "rejected." Nothing consumes a finding and changes the timeline.

## 1. What actually blocks a render

This is the most important correction to how we have been reasoning about the benchmark, and it
changes the priority order.

`bay-core/src/check.rs` assigns each code a severity, and **only `Error` blocks**. Reading the
table, several findings we have been treating as blockers are `Warning`:

| Code | Severity | Blocks render? |
|---|---|---|
| `broken-continuity` | Error | **yes** |
| `text-collision` | Error | **yes** |
| `frozen` (frame check) | Error | **yes** |
| `anchor-scale` (frame check) | Error | **yes** |
| `bottom-dead` (frame check) | Error | **yes** |
| `off-grid` | Warning | no |
| `no-response` | Warning | no |
| `bed-too-quiet` | Warning | no |
| `off-vocabulary-motion` | Warning | no |
| `no-bed` | Warning | no |

So the actual gate between bay and its first delivered video is five codes, not ten. From
`REPORT-2.md`, the per-brief blocking set is:

| Brief | Blocking findings |
|---|---|
| A | `broken-continuity` ×8, `frozen`, `anchor-scale`, `bottom-dead` |
| B | `broken-continuity` ×2, `frozen`, `bottom-dead` |
| C | `broken-continuity` ×1 (at 7.84 s), `text-collision` ×2, `frozen`, `anchor-scale`, `bottom-dead` |

`off-grid` at 14/22 values and `bed-too-quiet` at −27.9 LUFS are worth fixing for quality, but
fixing them delivers nothing. Work the five.

## 2. The central design risk

A loop that mutates a project until the gates stop complaining is **automated Goodhart**. It is
the exact failure round 2 diagnosed, with the human taken out and the iteration count raised. A
repair loop that reaches 3/3 by discovering that a 0.261 anchor scale clears a 0.260 floor has
made the benchmark green and the videos no better, and it will have done so faster than any
person could have.

Three structural defences, all non-negotiable:

**Repairs are semantic, not numeric.** A repair may only be expressed as an edit from a fixed
vocabulary that a human editor would recognise — "push this element down so the wrapped line
clears the one under it", "carry the incumbent across this seam", "let the anchor own the frame".
It may never be a search over a threshold. Concretely: no repair may read a gate's threshold
constant. The repair vocabulary and the gate constants must not share a module, and a test must
assert that `bay-repair` does not import threshold values from `check.rs`.

**Overshoot, deliberately.** Every repair targets a margin well past the floor, not the floor.
`anchor-scale` requires 0.260; the repair takes the anchor to roughly 0.40 because that is what
"the subject owns the frame" actually looks like. A repair that lands within a few percent of a
threshold is a bug, and there should be a test asserting the margin.

**A held-out judge that is not the gates.** Gate-clean is necessary, never sufficient. Every
repaired project is judged by the Phase 2 critic (`bay-agent/src/trust.rs`,
`apply_critic_submission`, `pairwise_decide`) on *craft*, not on findings. If a repair cannot win
on judgement, it is wrong even at 0 findings. This reuses the tournament machinery that already
exists rather than inventing a second one.

> **Amended 2026-08-17.** This originally required the repaired project to win a pairwise
> comparison **against the unrepaired version**. That is impossible by construction:
> `pairwise_decide` requires that "both variants must have clean engine-verified renders before
> comparison", and the unrepaired incumbent contains the blocking finding by definition, so it can
> never render cleanly. The invariant is correct and must not be weakened — the requirement was
> wrong. The judge therefore works in two parts:
>
> 1. **Candidate versus candidate.** Where a finding yields several legal repairs, all surviving
>    candidates are gate-clean and renderable, so `pairwise_decide` ranks them against each other.
>    This is what the tournament is actually for: choosing among survivors.
> 2. **Absolute craft judgement on the winner.** Because "better than the other candidate" does not
>    mean "good", the winning candidate must additionally carry critic panel evidence
>    (`PanelEvidence` / `CriticSubmission`) judging the result on its own merits. This is what
>    keeps gate-clean from silently becoming the definition of good.
>
> A single-candidate repair skips step 1 and still requires step 2.

## 3. Architecture

New crate `bay-repair`, sitting between `bay-core` (which produces findings) and `bay-agent`
(which drives). It must not be inside `bay-core`: the thing that diagnoses and the thing that
repairs need to stay separable, or the temptation to co-design them into agreement is
irresistible.

```
Report (findings)  ──►  bay-repair::plan(findings, project)  ──►  Vec<Repair>
                                                                      │
                          bay-core::Command (existing edit ops) ◄──────┘
                                       │
                                       ▼
                        re-check ──► converged? ──► critic ──► render
```

Design points:

- A `Repair` lowers to existing `bay_core::Command` values. The loop introduces **no new mutation
  path** — it can only do what an agent driving MCP could already do. This keeps the trust model,
  the undo history, and the receipt trail intact for free.
- Each `Repair` carries the finding it answers and a one-line rationale, so a repair receipt can
  be written next to the render receipt (`{path}.bay-render.json` already sets the precedent).
- Repairs are **proposals**. The loop applies, re-checks, and keeps the change only if it reduced
  the finding set without introducing a new code. This is the same "no new findings" discipline
  the round-3 benchmark used, enforced automatically.

## 4. Tranche 1 — deterministic repairs

These need arithmetic and geometry, not taste. No model in the loop.

**`anchor-scale`** — Brief A peaks at 0.159 sqrt-area, C at 0.146, against a 0.260 floor. The
repair identifies the beat's anchor element and scales it so it genuinely dominates, targeting
~0.40. Mechanical, with one judgement guard: scaling must not push the element off-canvas or
into a collision, so it re-checks `off-canvas` and `text-collision` after.

**`text-collision`** — C has two: hook/credit at 99% overlap and credit/payoff at 18%. The 99%
case is an oversized card whose lettering is clipped, so the repair is compound: reflow the text
to fit its box, then push stacked siblings down by the measured ink delta. `bay-text` already
rasterises and returns ink bounds — the collision gate uses exactly that — so the repair can be
driven from measured glyph geometry rather than estimated line height.

**`bottom-dead`** — A is alive in 15.8% of samples, B in 0%, C in 17.6%, against a 50% floor.
Deterministic part: where a beat has content only in the upper frame and the lower frame is
empty, redistribute the existing stack down the canvas. This is a layout transform on elements
that already exist, and it is the honest fix for B, whose panels genuinely cluster everything up
top over black.

**`off-grid` and `bed-too-quiet`** (non-blocking, cheap, do them anyway) — snap start/duration to
the frame grid; raise the gap bed to hit the programme target. Both are pure arithmetic. Listed
here because they are nearly free once the harness exists, not because they matter.

## 5. Tranche 2 — judgement repairs

These need to decide *what* should happen, which is a craft question.

**`broken-continuity`** is the one that matters — it is the sole blocker on Brief C and the
dominant one on A. The gate's meaning is "two consecutive beats with nothing carried between
them." The repair vocabulary is the editor's real one: carry an incumbent element across the
seam, hold a background while the foreground changes, let the outgoing element exit *as* the
incoming one arrives rather than swapping wholesale, or bridge with a transition.

Choosing among those is judgement, but the *candidate set* is enumerable per seam, which makes
this tractable: propose all legal carries at the seam, apply each, re-check, and let the critic
pick between the survivors. That is the Phase 2 variant/tournament machinery pointed at a seam
instead of a whole project.

Note the honest constraint: C's remaining continuity error at 7.84 s is a real authored
replacement — the hook card gives way to the answer with nothing carried. Repairing it means
genuinely rethinking that transition, not exempting it. Round 3 already took the exemption route
as far as it legitimately goes.

**`frozen`** — every brief trips it, A with 83 static 1.2 s windows, B and C from 0.00 s. The
repair is to introduce motion within the named vocabulary (`bay-project/src/moves.rs`), which is
why it must be judgement-driven: which element should move, and how, is a craft decision, and
adding arbitrary drift to satisfy a pixel-difference metric is precisely the Goodhart failure.
The critic gate is the defence here.

**`no-response`** (non-blocking, 0/4 and 0/8 arrivals) — when a new element arrives, an incumbent
should react. Same vocabulary, same critic.

## 6. Convergence and termination

The loop must be provably bounded, because an unbounded repair loop on a 90-tool engine is a way
to burn an afternoon and a lot of tokens.

- **Bounded iterations.** Hard cap on rounds (start at 5). Each round must strictly reduce the
  blocking finding count or the loop stops and reports.
- **No oscillation.** Hash the project each round (`bay_agent::trust::project_hash` already
  exists). A repeated hash is a cycle — stop.
- **No new codes.** A repair that clears one code and introduces another is reverted, and the
  finding is reported as unrepairable rather than traded.
- **Honest failure.** When the loop cannot converge it must say so, with the findings it could
  not fix and what it tried. This is the diarization precedent from round 3: returning "I could
  not do this" beat returning a confident wrong answer, and it is the behaviour we want by
  default.

## 7. Testing

The gates were built with a discipline worth repeating: a check is only trusted once a test
proves it *rejects* a known-bad fixture. Repairs need the mirror of that.

For every repair: a fixture exhibiting the finding, an assertion the repair clears it, an
assertion no new code appears, and — the important one — **an assertion the repair overshoots the
threshold by a real margin** rather than landing on it. Plus a negative test per repair: a
superficially similar case the repair must decline to touch.

The saved benchmark projects (`brief-a-2.project.json`, `brief-b-2.project.json`,
`brief-c-2.project.json`) are the integration corpus. They have known finding lists, which makes
them regression fixtures for free.

## 8. Adjacent work this unblocks

**TTS retiming.** Both reports flag narration overrunning because requested speaking rate does
not match generated duration — B overran 30 s by 0.63 s. The fix belongs in this loop's idiom:
generate, *measure* the produced audio, then retime to fit rather than trusting the rate
estimate. Small, deterministic, and it removes a recurring authoring error from every brief.

**Diarization.** Still returns `speakers: 0, confidence: 0.2163, lowConfidence: true`. Local
acoustic clustering reached 95% consistency on the host and 54% on Goodall, which is not fixable
by tuning. This needs a real speaker-embedding model provisioned through `bay-provision`
(the whisper.cpp precedent), and it is independent of the repair loop — schedule it in parallel.

## 9. Phasing

1. `bay-repair` crate, the `Repair` type, lowering to `bay_core::Command`, and the bounded loop
   harness with cycle detection and no-new-codes enforcement. No repairs yet — just the skeleton
   and its tests.
2. Tranche 1 deterministic repairs: `anchor-scale`, `text-collision`, `bottom-dead`, plus the
   free `off-grid` and `bed-too-quiet`. Re-run A+B+C and measure. Expect findings to fall
   substantially and renders to *still* be blocked by continuity and frozen.
3. Tranche 2 judgement repairs: `broken-continuity` and `frozen`, wired to the existing
   variant/tournament/critic path. This is where a render should first complete.
4. TTS measure-and-retime.
5. Re-run A+B+C as round-4 acceptance. Success is a completed render whose contact sheet a human
   would call acceptable — *and* which carries critic panel evidence judging it acceptable on its
   own merits (see the amendment in section 2; comparison against the unrepaired cut is not
   available, because an unrepaired project cannot render cleanly). Gate-clean alone does not count.

## 10. What success is not

If A, B and C all render and the contact sheets still show tiny anchors over dead lower frames
with cards replacing footage, the loop has learned to satisfy the gates and we have built the
thing round 2 was written to prevent. The contact sheet and the critic are the real acceptance
tests. The finding count is a progress indicator, not the goal.
