# Final acceptance benchmark — 2026-08-16

Branch: `fix/pending-sweep`

This run used the current branch's `bay` binary and authenticated MCP server. Every brief ran
`check`, `check_frames`, `contact_sheet`, and `render` without `ignoreChecks`. All three renders
were correctly blocked by Error-severity findings. Consequently, there are no benchmark MP4s:
inventing them with a bypass would invalidate the acceptance run. The saved projects and native
contact sheets are the visual evidence available at the stopping point.

## Brief C definition

The new real-footage brief is:

`/Users/himanshu/codes/synthai/vii/prompt-res/round2/52-BRIEF-C-PODCAST.md`

It is separate because `51-BRIEFS.md` already contains a historical drawn-explainer section named
Brief C. The new brief defines artifact-computed acceptance for transcript-selected cuts,
two-speaker diarization, tracked 1080×1920 reframing, and karaoke intervals projected from Whisper
word times.

## Brief A — drawn explainer

Final tool summary:

```text
brief A duration 30.0
check failed errors ['broken-continuity', 'off-vocabulary-motion', 'off-grid', 'no-response', 'bed-too-quiet']
frames failed errors ['frozen', 'anchor-scale', 'bottom-dead']
contact success /Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-a-contact-sheet.png
render failed rendered None
```

The first pass also found `past-source-end` on the music bed. That authoring error was fixed by
splitting the bed at its real source duration; it is absent from the final result. The remaining
findings are legitimate. The contact sheet shows repeated static arrangements, tiny central
anchors, unused lower-frame area, abrupt whole-composition swaps, and a badly colliding final
title. The narration schedule also causes one overlap because actual TTS duration did not match the
requested speaking-rate estimate.

Evidence:

- project: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-a.project.json`
- contact sheet: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-a-contact-sheet.png`
- requested render: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-a.mp4`
- render result: **not created; blocked by gates**

## Brief B — image-led generalization check

Final tool summary:

```text
brief B duration 30.0
check failed errors ['broken-continuity', 'off-vocabulary-motion', 'off-grid', 'no-response', 'bed-too-quiet']
frames failed errors ['frozen', 'bottom-dead']
contact success /Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-b-contact-sheet.png
render failed rendered None
```

These findings are legitimate. The contact sheet is visibly sparse, holds the same icon
arrangements for long windows, leaves most of the lower frame unused, and replaces rather than
evolves compositions at seams. Hand-keyed `scale`, `x`, and `rotation` triggered
`off-vocabulary-motion`; this also exposes a practical mismatch between expressive authoring and
the gate's accepted move vocabulary. The final narration extends about 0.63 s beyond the 30 s
timeline because generated speech duration was longer than the target-rate estimate.

Evidence:

- project: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-b.project.json`
- contact sheet: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-b-contact-sheet.png`
- requested render: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-b.mp4`
- render result: **not created; blocked by gates**

## Brief C — real-footage podcast clip

The engine successfully imported and transcribed the 373.573 s source, persisted 49 utterances and
500 words, searched the transcript, created eight paired non-contiguous video/speech cuts totalling
43.93 s, ran diarization, applied `auto_reframe`, and produced a portrait contact sheet.

Final tool summary:

```text
diarization speakers ['speaker-2']
brief C duration 43.93
check failed errors ['broken-continuity', 'text-collision', 'off-vocabulary-motion', 'off-grid', 'no-response']
frames failed errors ['frozen', 'anchor-scale', 'bottom-dead']
contact success /Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-c-contact-sheet.png
render failed rendered None
```

The brief independently compared 101 retained transcript words with the generated karaoke
intervals:

```text
words 101 median_start_error_seconds 0.34 p95 1.67 max 2.11
one_frame 0.0333 two_frames 0.0667 within_two_frames 16
```

Only 16/101 starts were within two frames. `subtitles_add` uniformly divided each SRT cue instead
of projecting the source transcript's word intervals, so the central karaoke requirement fails.
Diarization also fails: all retained speech was labelled `speaker-2`, with no host/Jane boundary.

Most other gate findings are legitimate. The hook overlaps the credit near 1.96 s; the credit
overlaps the payoff near 42.15 s; the payoff card replaces the footage; and the card's layout is
too small and top-heavy. `off-vocabulary-motion` is more ambiguous: the cited hand-keyed
`cropLeft`/`cropRight` tracks were generated by `auto_reframe`, so the built-in tool and the gate
disagree. `broken-continuity` is directionally correct but noisy for hard cuts created by the
first-party transcript-cut tool.

Evidence:

- project: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-c.project.json`
- caption input: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-c-captions.srt`
- contact sheet: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-c-contact-sheet.png`
- requested render: `/Users/himanshu/codes/synthai/vii/research/final-acceptance/brief-c.mp4`
- render result: **not created; blocked by gates**

## Verdict

Bay can now execute substantial editor operations through one authenticated engine: project
creation, media import, local transcription, transcript search, paired A/V cutting, reframing,
caption authoring, project persistence, pixel inspection, and deterministic render blocking all
worked. The gates prevented known-bad artifacts from being exported, which is meaningful.

Bay does **not** yet satisfy the stronger claim that it can take these briefs to acceptable
deliverables end to end. The most important gaps are:

1. The agent-facing workflow can assemble a timeline but does not reliably converge after the
   gates diagnose it.
2. Transcript cutting creates structurally valid paired clips but does not solve visual continuity
   at splice boundaries.
3. Diarization can return populated labels while failing the actual speaker boundary completely.
4. The karaoke API exposed in this run does not consume real word intervals when given SRT cues.
5. `auto_reframe` produces usable portrait framing, but its own crop animation can violate the
   motion-vocabulary gate.
6. TTS speaking-rate requests are not dependable enough to schedule narration against a fixed
   timeline without post-generation measurement and retiming.
7. Contact-sheet generation can show the failed artifact, but render-time gating means no encoded
   A/B/C proof exists when a project is not clean.

In short: Bay is a credible editing engine and quality firewall, but not yet an autonomous
world-class editor. Its breadth is real; the last-mile composition, timing, speaker attribution,
and repair loop remain thin.

## Repository verification

```text
$ ./test.sh
exit 0
```

The script completed formatting, Clippy with warnings denied, and the full workspace test suite.

```text
$ env -u CARGO_TARGET_DIR cargo check --workspace --all-targets
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.81s
warning: the following packages contain code that will be rejected by a future version of Rust: block v0.1.6, proc-macro-error2 v2.0.1
```

No commit was created.
