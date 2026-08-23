# Final acceptance benchmark rerun — 2026-08-16

Branch: `fix/pending-sweep`

This is a measurement rerun against the current branch, not a claim that the briefs now pass.
The current debug binary was built with:

```text
env -u CARGO_TARGET_DIR cargo build -p bay-desktop
Finished `dev` profile [unoptimized + debuginfo] target(s) in 38.57s
```

All GPU work ran unsandboxed. Every brief ran `check`, `check_frames`, `contact_sheet`, and
`render` without `ignoreChecks`. No gate, severity, or threshold was changed. All three renders
were blocked, so the acceptance rate remains **0/3** and there are no new MP4s.

For A and B, the previously authored project artifacts were loaded unchanged, saved under `-2`
names, and rerun through the current engine. No narration timing or other authoring input was
changed; this keeps the comparison focused on the four engine fixes. Brief C was rebuilt from the
real source: import, fresh local transcription, eight transcript searches, diarization,
`cut_by_transcript`, `auto_reframe` on all eight video clips, captions, save/reopen, and gates.

## Executive delta

| Brief | Baseline render | Rerun render | Cleared findings | Remaining findings | New findings |
|---|---|---|---|---|---|
| A | blocked | blocked | none | 8 baseline codes | none |
| B | blocked | blocked | none | 7 baseline codes | none |
| C | blocked | blocked | `off-vocabulary-motion` | 7 baseline codes | `no-bed` warning |

The important top-line result is unchanged: **zero deliverable videos**. The karaoke correction
is real, and the two first-party structural exemptions remove the intended false positives, but
they do not repair the compositions that still fail.

## Brief A — drawn explainer

`check(duration: 30)` returned four errors and four warnings. `check_frames(duration: 30)`
returned findings with no skipped checks. The render was refused. Its preflight reported eight
`broken-continuity` errors across the full 60-second populated project, even though the requested
render duration was 30 seconds; the separately requested 30-second `check` reported four.

| Baseline finding | Rerun status | Evidence |
|---|---|---|
| `broken-continuity` | **REMAINS** | 4 findings in the scoped 30 s check; the render preflight listed 8 across the full project |
| `off-vocabulary-motion` | **REMAINS** | 1 finding: hand-keyed `bed-a` volume, including a 3-core-frame segment |
| `off-grid` | **REMAINS** | 12/52 value-changing segments are under four frames; shortest 3.0 frames |
| `no-response` | **REMAINS** | 0/4 authored arrivals make an incumbent move or scale |
| `bed-too-quiet` | **REMAINS** | gap bed measured −27.9 LUFS against a −14 LUFS programme |
| `frozen` | **REMAINS** | 83 sampled 1.2 s windows; first at 0.75 s |
| `anchor-scale` | **REMAINS** | peak anchor sqrt-area 0.159 against the 0.260 floor |
| `bottom-dead` | **REMAINS** | bottom alive in 15.8% of samples against the 50% floor |
| — | **NEW: none** | no new code appeared |

Render result:

```text
blocked — check found 8 error(s); brief-a-2.mp4 was not created
```

Evidence:

- project: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-a-2.project.json`
- contact sheet: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-a-2-contact-sheet.png`
- requested render: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-a-2.mp4`

### Visual assessment

The contact sheet still shows the same static candlestick scaffold held across long windows.
Most changing information is small type or tiny marks around the middle of the portrait frame,
while the lower frame remains largely unused. Repeated adjacent panels are nearly identical.
The final “THE BODY IS THE STORY / THE WICK IS THE COST” stack visibly overprints itself. This
is not a near-pass hidden behind a strict gate; the frozen, weak-anchor, and dead-bottom findings
describe what is visible.

## Brief B — image-led generalization check

`check(duration: 30)` returned two errors and seven warnings. `check_frames(duration: 30)`
returned findings with no skipped checks. The render was refused by the two continuity errors.

| Baseline finding | Rerun status | Evidence |
|---|---|---|
| `broken-continuity` | **REMAINS** | 2 findings, at 16.1 s and 26.3 s |
| `off-vocabulary-motion` | **REMAINS** | 4 findings: floppy `scale`, floppy `x`, aleph `rotation`, and bed volume |
| `off-grid` | **REMAINS** | 2/36 authored start/duration values are off the 30 fps grid |
| `no-response` | **REMAINS** | 0/8 authored arrivals make an incumbent move or scale |
| `bed-too-quiet` | **REMAINS** | gap bed measured −40.0 LUFS against a −14 LUFS programme |
| `frozen` | **REMAINS** | 48 sampled 1.2 s windows; first at 0.00 s |
| `bottom-dead` | **REMAINS** | bottom alive in 0% of samples |
| — | **NEW: none** | no new code appeared |

Render result:

```text
blocked — check found 2 error(s); brief-b-2.mp4 was not created
```

Evidence:

- project: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-b-2.project.json`
- contact sheet: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-b-2-contact-sheet.png`
- requested render: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-b-2.mp4`

### Visual assessment

The opening floppy is readable, but most later panels cluster small icons in the upper half and
leave most of the portrait canvas black. Once the floppy shrinks, it becomes a tiny lower-left
token rather than a visual anchor. Several low-contrast labels are barely legible in the sheet.
The cloud, aleph, and ox-mark arrangements hold with little visible evolution across adjacent
samples. The 0% bottom-alive result is consistent with the pixels.

## Brief C — real-footage podcast clip

Source: Jane Goodall, *The Green Interview*, by The Green Interview (Silver Donald Cameron),
CC BY 3.0:

`/Users/himanshu/codes/synthai/vii/assets/podcast-cut/pod/goodall.webm`

The fresh source probe measured 373.573 s at 640×360 with audio. The current transcription
returned:

```text
model ggml-small.en-q5_1.bin
language en
utterances 52
words 862
```

All eight required transcript searches returned the expected source starts. `cut_by_transcript`
created eight paired video/speech clips with total duration 43.93 s and the required increasing
source ranges. The saved project was reopened and still contained all 862 transcript words.

### Finding-by-finding delta

| Baseline finding | Rerun status | Evidence |
|---|---|---|
| `broken-continuity` | **REMAINS, narrower** | 1 legitimate finding at 7.84 s where the authored hook is replaced; the seven paired transcript A/V splice false positives are gone |
| `text-collision` | **REMAINS** | 2 frame findings: hook/credit at 0.00 s (99% overlap) and credit/payoff at 41.55 s (18% overlap) |
| `off-vocabulary-motion` | **CLEARED** | zero findings after `auto_reframe` on all 8 clips; its 32 coordinated crop channels were accepted |
| `off-grid` | **REMAINS** | 14/22 authored start/duration values do not land on the 30 fps grid |
| `no-response` | **REMAINS** | 0/8 authored arrivals make an incumbent move or scale |
| `frozen` | **REMAINS** | 27 sampled 1.2 s windows; first at 0.00 s |
| `anchor-scale` | **REMAINS** | peak anchor sqrt-area 0.146 against the 0.260 floor |
| `bottom-dead` | **REMAINS** | bottom alive in 17.6% of samples |
| — | **NEW: `no-bed`** | 1 warning; expected for this dialogue-only brief, but new relative to the exact baseline list |

`speech-masked` was skipped because there is no speech-free gap to compare, and
`bed-too-quiet` was skipped because there is no bed. Those are not passes.

The crop exemption behaved narrowly as claimed. For example, rerunning `auto_reframe` on the
first clip reported raw jitter 0.2279 and smoothed jitter 0.0971, while the contact sheet showed
a full-height portrait crop rather than pillarboxing. The hand-authored A/B motion findings did
not clear.

### Karaoke verification

I independently read the saved transcript, the eight video clips' timeline starts and source
in-points, and every generated karaoke interval. Expected starts were recomputed as:

```text
clip.timelineStart + word.sourceStart - clip.sourceStart
```

Using the brief's half-open clip ranges, normalized token order matched exactly:

```text
words 101
median_start_error_seconds 0.000000000000018
p95_start_error_seconds    0.000000000000057
max_start_error_seconds    0.000000000000064
two_frames_seconds         0.066666666667
within_two_frames          101/101
```

Rounded to the requested reporting precision: **median 0.000 s, p95 0.000 s, max 0.000 s,
101/101 within two frames. The claim holds.**

One boundary detail is worth preserving: transcript word `reasons.` ends at
281.20000000000005 s, infinitesimally outside the half-open range ending at 281.20 s, so it is
not one of the 101 retained karaoke words. With strict half-open arithmetic the generated and
expected token lists are both 101 and match exactly.

### Diarization

The fresh diarization result was:

```text
speakers 0
labelledUtterances 0
confidence 0.2163375169
lowConfidence true
method word-level-acoustic-clustering
```

No word or utterance retained a speaker label after save/reopen. This is an honest deferral and
eliminates the previous false `speaker-2` claim, but it still fails every substantive two-speaker
acceptance criterion: there are not two labels, no host/Jane transition is identified, and no
90% per-speaker agreement can be measured.

### Render and visual assessment

Render result:

```text
blocked — check found 1 error(s): broken-continuity at 7.84 s
brief-c-2.mp4 was not created
```

Evidence:

- project: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-c-2.project.json`
- caption input: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-c-captions.srt`
- contact sheet: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-c-2-contact-sheet.png`
- requested render: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-c-2.mp4`

The tracked crop is the clearest visible improvement: Jane's face fills the portrait frame,
stays near centre, and is not pillarboxed. It does not rescue the overall edit. In the opening
samples, the oversized “DO YOU HAVE HOPE?” card covers almost the entire frame, its lettering is
visibly clipped, and the caption/credit stack overprints it. The persistent credit is extremely
small and rides the top edge. Dialogue captions repeatedly sit across the lower face/chin area.
The final red payoff card replaces the interview instead of evolving from it, leaving only thin
strips of footage and visibly colliding with the credit/caption treatment. Adjacent Jane samples
also remain compositionally repetitive. The contact sheet supports the remaining collision,
frozen, anchor-scale, bottom-dead, and continuity findings.

## Remaining blockers

### A

- Four continuity failures inside the requested 30 seconds; eight across the full populated
  project seen by render preflight.
- Frozen layouts, undersized anchors, and a mostly dead lower frame.
- The final title visibly collides.
- Hand-keyed bed automation remains outside the named motion vocabulary and the bed is too quiet.

### B

- Two real composition-replacement seams.
- Long frozen holds and no substantial bottom-frame use.
- Four authored motion channels remain outside the named vocabulary.
- The music bed is effectively inaudible in gaps.

### C

- One real authored replacement at the hook/answer boundary still blocks structural render.
- Two Error-severity text collisions remain.
- Frozen composition, weak anchor scale, and dead lower-frame area remain.
- Diarization still cannot identify either speaker.
- The payoff card still replaces the footage and the caption/title/credit layout is visibly poor.

## Verdict

This round produced **meaningful local fixes but no acceptance-level outcome change**.

- Karaoke moved from 16/101 within two frames to **101/101**, with effectively zero start error.
- The first-party `auto_reframe` crop no longer self-incriminates as off-vocabulary motion.
- Verified transcript A/V splices no longer inflate continuity failures.
- Diarization stopped lying, but did not start working.

Against the autonomous-delivery goal, bay remains far from done: **0/3 renders complete**, A and
B clear nothing, and C still has a legitimate continuity error, two text collisions, three
visible composition failures, and no speaker attribution. The fixes make the diagnostics more
truthful and the karaoke timing correct. They do not yet give the system the repair loop or
composition judgment needed to turn those diagnostics into a deliverable video.
