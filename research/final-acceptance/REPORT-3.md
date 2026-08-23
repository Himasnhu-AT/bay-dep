# Round-4 acceptance benchmark — 2026-08-17

Branch: `fix/pending-sweep`

This run measured the current combined repair path: the deterministic tranche first, then the
judgement tranche against the resulting projects. GPU checks and renders ran unsandboxed. No gate,
threshold, severity, repair, or `pairwise_decide` invariant was changed, and no render used
`ignoreChecks`.

## Verdict

**Mechanical: 0/3 MP4s.** A and C were refused by the gates. B became gate-clean in the combined
gate diagnostic, but export then failed because its saved project points at a deleted temporary
Kokoro file, `/private/var/folders/.../T/bay-narration-8.wav`. No `brief-*-round4.mp4` exists.

**Craft: 0/3 acceptable videos.** There is no delivered video to accept. More importantly, the
gate-clean B candidate is still visibly weak: tiny monochrome icons on a black field, large dead
areas, nearly unreadable labels, and an almost empty landing. It satisfies the pixel gates without
satisfying the brief.

Bay therefore still cannot take these briefs to finished videos. Round 4 improves the mechanical
ceiling from “all three blocked by checks” to “one gate-clean candidate reaches the encoder,” but
it produces no file and no acceptable cut.

## Critic result and an orchestration defect

The benchmark example currently exposes two judgement modes:

1. `BAY_REPAIR_CRITIC_REJECT`, which activates a rejecting `CraftJudge`; or
2. `BAY_REPAIR_UNJUDGED_DIAGNOSTIC`, which measures gate convergence but is explicitly not an
   acceptance path.

The judged run used the first mode. The critic rejected every otherwise viable candidate in round
1; no judgement repair was accepted for A, B, or C. Typical receipt:

```text
disposition: revertedCritic
reason: held-out critic rejected the repair: absolute craft judgement rejected:
candidate remains visually weak or cannot yet be compared as a clean deliverable
```

This is not the full two-part judge required by the amendment in the round-4 plan. The production
`TournamentJudge` is not wired into `repair_benchmarks`, and its current ordering cannot be wired
honestly without another design change. Brief B's first round enumerated several continuity
candidates, but even the strongest one still had `frozen` and `bottom-dead`. `TournamentJudge`
would try to pairwise-rank those candidates immediately, while `pairwise_decide` correctly requires
both candidates to have globally clean engine-verified renders. They are not globally clean until
later repair rounds.

The current loop therefore asks the clean-render tournament to choose intermediate, non-clean
states. The invariant must not be weakened; the repair/critic orchestration must instead be
reordered. The unjudged pass below is reported only to show the mechanical ceiling the combined
repairs can reach. It is not treated as critic acceptance.

## Per-brief results

### A — drawn candlestick explainer

Deterministic repairs cleared `anchor-scale` and `bed-too-quiet`. The anchor moved from **0.158893
to 0.325083 sqrt-area**. Lower-frame coverage did not move: **7.92% to 7.92%**. Frozen windows
worsened slightly from **171 to 174** after the anchor enlargement.

Per-code delta from the raw saved baseline to the critic-governed result:

- `anchor-scale`: 1 → 0
- `bed-too-quiet`: 1 → 0
- `broken-continuity`: 8 → 8
- `frozen`: 1 → 1 (174 windows)
- `bottom-dead`: 1 → 1 (7.92% alive)
- `off-grid`: 1 → 1
- `off-vocabulary-motion`: 2 → 2
- `no-response`: 1 → 1

The unjudged combined diagnostic accepted five one-seam continuity repairs before the five-round
cap, reducing `broken-continuity` 8 → 3, but still left `frozen` and `bottom-dead`. The judged run
accepted none.

Render refusal:

```text
check found 8 error(s) and a render would ship them
```

Craft assessment from `brief-a-round4-contact-sheet.png`: panels 1–6 already show headings cutting
through the candle scaffold; panels 7–12 remain minor textual substitutions over essentially the
same arrangement; panels 17–18 visibly overprint “THE BODY IS THE STORY” and “THE WICK IS THE
COST.” The enlarged candle clears the anchor metric, but it does not make the edit readable or
compositionally varied.

### B — image-led “The Ox in the Letter”

The deterministic tranche cleared `off-grid` and `bed-too-quiet`, but did not change any blocking
frame statistic:

- anchor: **0.315446 → 0.315446 sqrt-area**
- bottom alive: **0% → 0%**
- frozen windows: **48 → 48**
- `broken-continuity`: 2 → 2

The unjudged combined diagnostic then reached:

- `broken-continuity`: 2 → 0
- `frozen`: 48 windows → 0
- `bottom-dead`: 0% → **63.41%**
- anchor: 0.315446 → **0.319142**
- remaining findings: `no-response` ×1 and `off-vocabulary-motion` ×3, both warnings

That project was genuinely gate-clean:

```text
check: errors 0, skipped []
check_frames: status clean, skipped []
bottomAliveShare 0.6341463414634146
frozen 0
peakAnchorSqrtArea 0.3191423692521127
```

The no-bypass render reached ffmpeg and then failed:

```text
could not encode .../brief-b-round4.mp4: ffmpeg stopped accepting frames:
Broken pipe (os error 32) — ffmpeg said:
Error opening input file /private/var/folders/.../T/bay-narration-8.wav.
Error opening input files: No such file or directory
```

The saved acceptance project is therefore not self-contained enough to render once its original
temporary TTS directory is gone. The exporter removed the partial output; `brief-b-round4.mp4`
does not exist.

Craft assessment from `brief-b-round4-contact-sheet.png`: panels 1–2 have a readable floppy but
`LAST MADE 2011` is effectively invisible. Panels 3–10 distribute icons across beats, so the
63.41% bottom result is legitimate rather than one parked element, but the marks remain small and
the frame remains mostly black. `WEATHER / STORAGE` is barely readable in panels 9–10. Panels
11–14 reduce the argument to a small “A,” a tiny floppy, and tiny `ALEPH`; panels 15–16 are an
almost empty final card with `ALPHABET` and the “A” isolated near the lower-left. The intended
visual substitution from obsolete icon to alphabetic sign is not staged at a scale or clarity
that can carry the 30-second argument. **This is gate-clean and not good.**

### C — “One Reason for Hope”

The deterministic tranche cleared both `text-collision` findings. Its warmed, decode-complete
frame statistics were:

- anchor: **0.541802 → 0.541802 sqrt-area**
- bottom alive: **24.43% → 25.57%**
- frozen windows: **18 → 18**
- `text-collision`: 2 → 0
- `broken-continuity`: 1 → 1

The unjudged judgement tranche cleared `broken-continuity`, but could not clear either remaining
frame blocker: frozen windows moved **18 → 17** and bottom alive **25.57% → 26.70%**. Every
bottom-layout candidate missed the repair's deliberate 60% semantic margin; the best reached only
52%. The judged run rejected the continuity candidates, leaving the critic-governed result with
`broken-continuity`, `frozen`, and `bottom-dead`.

Render refusal:

```text
check found 1 error(s) and a render would ship them:
broken-continuity — beat 1 (0.0s) and beat 2 (7.8s) replace the composition
```

One measurement trap appeared in the MCP path: `check_frames` immediately after loading the video
project reported the historical undecoded values (anchor 0.146, bottom 17.61%, 27 frozen windows).
After the contact sheet caused decode to complete, the same tool reported the repair harness's
values (anchor 0.541802, bottom 25.57%, 18 frozen windows). The report uses the warmed,
decode-complete values. A frame gate whose result depends on whether a prior tool happened to warm
decode is not reliable acceptance evidence and should be fixed.

Craft assessment from `brief-c-round4-contact-sheet.png`: panels 1–2 clip the hook to “DO YOU HAV”
and overprint it with the source credit and captions. Panels 3–14 keep Jane framed well, but the
captions repeatedly sit across her chin and clothing and several red active words have weak
contrast. Panels 15–16 replace the interview with a mostly black card; the title is large but the
remaining footage is reduced to thin strips. The final treatment contradicts the brief's request
that Jane remain the visual anchor through the landing.

## Artifacts

- A contact sheet: `research/final-acceptance/brief-a-round4-contact-sheet.png`
- B gate-clean candidate contact sheet:
  `research/final-acceptance/brief-b-round4-contact-sheet.png`
- C contact sheet: `research/final-acceptance/brief-c-round4-contact-sheet.png`
- deterministic outputs: `brief-*-2.project.phase2-3.project.json`
- judgement outputs: `brief-*-2.project.phase2-3.project.phase3-diagnostic-3.project.json`
- MP4s: **none**

No MP4 completed, so there were no encoded frames to extract independently. The round-4 contact
sheets above are native GPU renders of the exact attempted projects.

## Verification

`./test.sh` completed formatting, Clippy with warnings denied, and the full suite:

```text
passed: 1092
failed: 0
ignored: 0
```

`env -u CARGO_TARGET_DIR cargo check --workspace --all-targets`, run from `rust/`:

```text
Checking bay-repair v0.1.0
Finished `dev` profile [unoptimized + debuginfo] target(s) in 3.11s
```

Cargo also emitted the existing future-incompatibility warning for `block v0.1.6` and
`proc-macro-error2 v2.0.1`.

One combined shell invocation mistakenly ran the cargo check from the repository root after
`./test.sh`; that second stage failed with “could not find `Cargo.toml`.” The required check was
then rerun from the actual workspace root, `rust/`, and passed as quoted above.

No commit was created.
