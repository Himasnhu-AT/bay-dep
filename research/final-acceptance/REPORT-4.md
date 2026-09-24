> **Historical:** describes the Rust engine, deleted; recover what it cites with `git show rust-engine-final:dep/rust/<path>` (e.g. `crates/bay-mcp/src/tools.rs`).

# Round-5 acceptance benchmark — 2026-08-17

Branch: `fix/pending-sweep`

No gate, threshold, severity, repair, critic invariant, or
`repair_source_cannot_reference_gate_constants` rule was changed. No render used
`ignoreChecks`. GPU work and TTS ran unsandboxed with unrestricted network access. No commit was
created.

## Validity note

The poisoned narration files in `brief-a-2.project.json` and `brief-b-2.project.json` were not
used by the repair or render runs. All 17 narration lines were synthesized again through the
current Kokoro path at `targetWordsPerSecond: 2.5`, inserted into newly identified project
artifacts, and saved through the current durable-media writer.

The visual timelines were reconstructed from the existing brief-derived serialized element graphs
rather than replaying every original MCP authoring command from prose. Brief C similarly retained
the previously persisted transcript/cuts/reframe graph while collecting its still-valid Goodall
source into the new project. Therefore this run proves durable-media, repair, critic, gate, and
render behavior on fresh self-contained artifacts, but it is not a command-by-command fresh
authoring proof for all three briefs. That distinction matters.

## Verdict

**Mechanical: 0/3 MP4s.** All three no-bypass render attempts were refused. No
`brief-*-round5.mp4` exists.

**Craft: 0/3 acceptable delivered videos.** There is no delivered video to accept. The native
contact sheets also remain visibly weak. Brief B still has the exact failure called out after round
4: tiny monochrome icons in a mostly black field, nearly invisible labels, and an almost empty
landing. It renders nothing, and the candidate picture is not good.

Bay still cannot take these briefs to finished video. Durable saves fixed round 4's broken-pipe
failure, but no critic-accepted gate-clean project reached the encoder.

## Durable media

Durability held:

- Brief A: 9 newly generated speech files were collected under
  `brief-a-round5.project.media/`.
- Brief B: 8 newly generated speech files were collected under
  `brief-b-round5.project.media/`.
- Brief C: `goodall.webm` was collected under `brief-c-round5.project.media/`.
- The synthesis temp directory was deleted before each A/B project was reopened.
- Reopening then resolved every relative path beside the project, and every referenced file
  existed.
- The subsequent repair and render processes ran after temp deletion. No `missing-media` finding
  remained once the benchmark loader was corrected.

The measured Kokoro output did not actually achieve a uniform 2.5 words/s. A ranged from 1.481 to
3.094 words/s; B ranged from 1.418 to 2.412 words/s. The resulting B timeline is 30.625 s, already
0.625 s longer than the 30 s brief. Durable TTS is now durable, but rate conformance is still not
reliable.

## Critic result

The critic was active.

- A never converged. Its one continuity candidate was reverted because it worsened
  `bottom-dead`. No clean contender reached absolute judgement.
- B produced three distinct clean contender project hashes internally. The critic rejected the
  run with `termination: criticRejected` because no submitted absolute `PanelEvidence` /
  `CriticSubmission` existed at
  `brief-b-round5.project.phase2-3.project.judge.json`.
- C accepted one continuity repair, then failed to clear `frozen` or `bottom-dead`; no clean
  contender reached absolute judgement.

The critic therefore accepted no video. It did not make a positive or negative visual craft
finding about B: it refused to self-certify without external absolute evidence. That is the correct
shipping behavior, but it also means this run produced no critic-supported winner.

## Brief A — drawn candlestick explainer

Raw → critic-governed result:

- `anchor-scale`: 1 → 0
- `bed-too-quiet`: 1 → 0
- `broken-continuity`: 8 → 8
- `frozen`: 1 → 1
- `bottom-dead`: 1 → 1
- `off-grid`: 1 → 1
- `off-vocabulary-motion`: 2 → 2
- `no-response`: 1 → 1
- peak anchor: 0.158893 → 0.325083 sqrt-area
- bottom alive: 7.92% → 7.92%
- frozen windows: 171 → 174

Render refusal: `check found 8 error(s)`, all eight beat seams reporting
`broken-continuity`.

Craft assessment from
`brief-a-round5.project.phase2-3.project.phase3-judged.contact-sheet.png`:

- panels 1–2 stack “TWO DAYS / SAME RANGE” through the candle and measurement rules;
- panels 5–6 stack repeated “SAME NUMBER” text into an unreadable column;
- panels 7–16 mostly substitute small labels over the same candle arrangement;
- panels 17–18 overprint “THE BODY IS THE STORY / THE WICK IS THE COST” through the candle.

The anchor metric improved by enlarging the candle, but readability, lower-frame composition, and
editorial variation did not.

## Brief B — “The Ox in the Letter”

Raw → critic-governed result:

- `off-grid`: 1 → 0
- `bed-too-quiet`: 1 → 0
- `broken-continuity`: 2 → 2
- `frozen`: 1 → 1 (48 windows)
- `bottom-dead`: 1 → 1 (0% alive)
- `no-response`: 1 → 1
- `off-vocabulary-motion`: 4 → 4
- peak anchor: 0.315446 → 0.315446 sqrt-area

The judgement search found three converged clean alternatives, but none could ship without
absolute evidence. The critic rejected them and retained the blocking incumbent.

Render refusal: `check found 2 error(s)`, at the beat 5→6 and beat 7→8 composition seams.

Craft assessment from
`brief-b-round5.project.phase2-3.project.phase3-judged.contact-sheet.png`:

- panels 1–2 make the floppy readable, but `LAST MADE 2011` is effectively invisible;
- panels 3–8 scatter tiny white icons through large dead black areas;
- panels 9–10 make `WEATHER / STORAGE` too small and dim to carry the comparison;
- panels 11–14 reduce the argument to a small “A”, a tiny floppy, and tiny `ALEPH`;
- panels 15–16 are an almost empty landing with `ALPHABET` and the “A” isolated low in frame.

This still satisfies pieces of the pixel model without satisfying the brief. It is not acceptable
craft.

## Brief C — “One Reason for Hope”

Source: Jane Goodall, *The Green Interview*, by The Green Interview (Silver Donald Cameron),
CC BY 3.0, from Wikimedia Commons.

Raw → deterministic → critic-governed result:

- `text-collision`: 2 → 0 → 0
- `broken-continuity`: 1 → 1 → 0
- `frozen`: 1 → 1 → 1
- `bottom-dead`: 1 → 1 → 1
- peak anchor: 0.541802 → 0.541802 → 0.541802 sqrt-area
- bottom alive: 24.43% → 25.57% → 26.70%
- frozen windows: 18 → 18 → 17

Model checks had zero Error findings. Pixel checks still reported `frozen` and `bottom-dead`, so
render refused before encoding.

Craft assessment from
`brief-c-round5.project.phase2-3.project.phase3-judged.contact-sheet.png`:

- panels 1–2 clip the hook to “DO YOU HAV” and collide it with credit/caption text;
- panels 3–14 generally keep Goodall's face large and centered, the strongest footage treatment
  in the suite, but captions repeatedly sit across her chin and clothing and active red words
  sometimes lack contrast;
- panels 15–16 replace the interview with a mostly black title card and reduce the source footage
  to a thin strip.

The middle is watchable, but the hook is broken and the landing contradicts the brief's requirement
that Goodall remain the visual anchor.

## Render evidence and artifacts

No render completed, so there are no encoded frames or encoded-video contact sheets to extract.
The following are native GPU contact sheets of the exact critic-governed projects attempted:

- `brief-a-round5.project.phase2-3.project.phase3-judged.contact-sheet.png`
- `brief-b-round5.project.phase2-3.project.phase3-judged.contact-sheet.png`
- `brief-c-round5.project.phase2-3.project.phase3-judged.contact-sheet.png`

Projects:

- `brief-a-round5.project.json`
- `brief-b-round5.project.json`
- `brief-c-round5.project.json`
- corresponding `.phase2-3.project.json` deterministic outputs
- corresponding `.phase2-3.project.phase3-judged.project.json` critic-governed outputs

MP4s: **none**.

## Code delta discovered during measurement

One general benchmark-loader fix was necessary in
`rust/crates/bay-repair/examples/repair_benchmarks.rs`.

The harness previously used raw `serde_json` deserialization. That bypassed the product's
project-relative media resolution, so a correct durable save immediately became `missing-media`
when passed to the repair loop. Relative invocation paths could also be joined twice. The loader
now canonicalizes the project path and uses `bay_project::library::read_project`.

Before this fix the new A/B saves incorrectly reported `missing-media` ×9 and ×8, and C frame
evaluation became unevaluated. After it, all three evaluated normally with zero missing-media
findings. This changes no gate, repair, threshold, or critic behavior.

## Verification

`./test.sh` ran with unrestricted network and exited 0 after format, Clippy with warnings denied,
workspace tests, and doc tests. The output enumerated **1,093 tests, 0 failures, 0 ignored**. The
requested “1,098 tests” baseline was not reproduced by the current checkout; this report uses the
actual run rather than claiming the requested number.

```text
Finished `test` profile [unoptimized + debuginfo] target(s) in 1.80s
exit_code: 0
```

`env -u CARGO_TARGET_DIR cargo check --workspace --all-targets` from `rust/`:

```text
Checking bay-repair v0.1.0
Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.72s
```

Both commands emitted the existing future-incompatibility warning for `block v0.1.6` and
`proc-macro-error2 v2.0.1`.

## Bottom line

Bay now preserves its own generated speech and can reopen it after the temp source is gone. That
fix removes the exact mechanical failure that killed round 4.

It still cannot autonomously take these briefs to a finished video. A and C do not converge; B can
produce internally clean alternatives but cannot pass the required absolute critic without real
evidence, and the visible incumbent remains weak. Round 5 is therefore **0/3 mechanically and 0/3
on craft**, not a first delivery.
