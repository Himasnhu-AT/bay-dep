# 52 — FINAL ACCEPTANCE BRIEF C

This is the third brief required by the world-class-editor plan's final benchmark. It is the
**real-footage Brief C** in the A+B+C acceptance cadence. `51-BRIEFS.md` contains an older,
historical section also labelled “Brief C” (`WE ADDED FOUR MEASUREMENTS…`); that section remains
useful research, but it is not this final acceptance brief and is not renamed here.

# Brief C — ONE REASON FOR HOPE

*The real-footage check. 43.93 s. Transcript-first dialogue edit, speaker change, tracked vertical
reframe, and captions driven by the source recording's word timings.*

## Source and licence

`assets/podcast-cut/pod/goodall.webm` — *Jane Goodall, The Green Interview*, 640×360,
373.573 s, CC BY 3.0, by The Green Interview (Silver Donald Cameron), sourced from Wikimedia
Commons. The delivered video must retain `THE GREEN INTERVIEW · CC BY 3.0` on screen and the
benchmark report must name the source.

This source is deliberately awkward:

- it is 16:9 SD footage delivered to a 9:16 canvas, so a fixed centre crop is not an acceptable
  substitute for `auto_reframe`;
- the host asks a question and Jane answers, so diarization has one observable speaker boundary;
- its audio is dual-mono, so stereo position cannot stand in for speaker identity;
- the answer contains removable clauses separated by real pauses, so a transcript edit must prove
  that words, audio, and picture remain aligned after non-contiguous cuts.

## Premise

> Hope is not presented as a mood. Jane Goodall gives one concrete reason for it: under pressure,
> the same human brain that caused damage can understand it and build a less damaging way forward.

**What the viewer knows at the end that they did not know at the start:** the answer to “do you
have hope?” is not a slogan. It starts a numbered argument and completes the first reason.

## Runtime: 43.93 seconds

The runtime is the sum of eight transcript-selected half-open source ranges. It is not a typed
target and must not be padded. At 30 fps the encoded duration may differ by at most one frame
(0.0334 s) after normal container rounding.

| # | source range | timeline range | speaker in the recording | retained words |
|---|---:|---:|---|---|
| 1 | 262.80–270.64 | 0.00–7.84 | host | “Dr. Jane, do you have hope? … What do you say then?” |
| 2 | 270.64–281.20 | 7.84–18.40 | Jane Goodall | “I tell people who ask me if I have hope … four very simple, naive reasons.” |
| 3 | 281.22–283.92 | 18.40–21.10 | Jane Goodall | “Firstly, the human brain.” |
| 4 | 290.58–293.88 | 21.10–24.40 | Jane Goodall | “It’s also creating incredible technology.” |
| 5 | 296.24–301.23 | 24.40–29.39 | Jane Goodall | “People are finally understanding the harm we’ve inflicted on the planet.” |
| 6 | 306.86–312.14 | 29.39–34.67 | Jane Goodall | “When our backs are to the wall … the brain’s always worked over time.” |
| 7 | 315.35–322.23 | 34.67–41.55 | Jane Goodall | “Technologies … enable us to leave a less disastrous environmental footprint.” |
| 8 | 324.90–327.28 | 41.55–43.93 | Jane Goodall | “So that’s one reason for hope.” |

The ranges above are resolved by `transcript_search` against the transcript generated in the run.
They are acceptance inputs, not permission to skip `transcribe`, `transcript_get`, or
`transcript_search`.

## Structure

Four movements, with the source voice carrying the argument:

| beat | span | role | picture | captions |
|---|---:|---|---|---|
| question | 0.00–7.84 | hook | host, already framed on frame one; no fade-up | the host's exact words |
| answer | 7.84–18.40 | setup | cut to Jane; tracked crop settles rather than snapping | Jane's exact words |
| reason | 18.40–34.67 | mechanism | Jane remains the visual anchor across three transcript cuts | one active word at a time |
| consequence | 34.67–43.93 | payoff / landing | crop remains on Jane; `ONE REASON FOR HOPE` lands only after she says it | final source sentence |

The `payoff` marker is committed at 41.55 s, before any sound is added. `ONE REASON FOR HOPE`
is the only authored headline after the hook. The source credit persists for the full runtime.

## Transcript-first edit

The edit must be made from the persisted local transcript:

1. `transcribe` the imported source and record model, language, utterance count, word count, and
   source duration.
2. `transcript_search` the phrases above and use the returned source times.
3. `cut_by_transcript` places paired video and speech clips consecutively. No hand-authored
   `trimStart` values may replace this step.
4. `transcript_get` after the edit must still return the persisted transcript; reopening the saved
   project must not require transcription again.

### Artifact-computed transcript acceptance

- The eight video/audio pairs in the saved project have identical timeline start, duration, and
  source in-point within one media tick.
- Their source ranges are increasing, non-overlapping, and equal to the eight ranges above within
  one 30 fps frame.
- Concatenating transcript words whose source intervals fall inside those ranges yields the
  caption tokens in the same order after punctuation/case normalization. No caption token may be
  invented.
- Delivered duration equals the sum of the eight source-range durations within one frame.
- There is one audio element with `role: speech` for every video range; no speech elements overlap.

These are read from the saved project and encoded file. A tool response saying “cut completed” is
not evidence.

## Diarization

Run `diarize(mediaId: "goodall", speakers: 2)` before cutting. This brief has a visible and audible
ground-truth boundary: the host's question ends and Jane's answer starts at source 270.64 s (the
picture cuts at approximately 270.94 s).

### Artifact-computed diarization acceptance

- Every retained word and every utterance intersecting the retained ranges has a non-empty speaker
  label in the saved project.
- Exactly two speaker labels appear in the retained ranges.
- The label changes once between the final word of range 1 and the first word of range 2, within
  0.75 s of source 270.64 s.
- At least 90% of retained host words share one label and at least 90% of retained Jane words share
  the other.

Cluster count alone does not pass this criterion. Two labels placed elsewhere in the 373 s source
cannot certify the selected clip.

## Vertical reframe

Run `auto_reframe` on every placed video element for a 1080×1920 target, with 0.5 s sampling and
0.9 s damping. Do not copy crop values from the Phase 4 research artifact.

### Artifact-computed reframe acceptance

- Every video element in the saved project carries animated crop insets produced by the run.
- At every contact-sheet sample the source fills the 9:16 picture; no fixed landscape panel or
  pillarbox is accepted as a reframe.
- The visible speaker's head is not clipped by the top edge and their face remains inside the
  central 70% of frame width at the question/answer boundary and at two engine-chosen samples per
  beat.
- The returned path's smoothed jitter is lower than its raw jitter. This is read from the returned
  numeric path, but visual framing is judged from rendered pixels.

## Word-timed karaoke captions

Captions are burned in from the **source transcript's word intervals**, projected through the
eight cuts. They use the committed kit's caption role and accent highlight. Caption text is not
retyped from this document.

### Artifact-computed caption acceptance

- Every retained transcript word appears in exactly one karaoke interval in the saved project.
- For each word, expected timeline start/end is:
  `clip.timelineStart + word.sourceTime - clip.sourceStart`.
- Median absolute start-time error is at most one output frame; 95th-percentile error is at most
  two frames. Uniformly dividing a subtitle cue by word count does not pass.
- At six fixed boundary samples (the first and last word of ranges 1, 2, and 8), the rendered
  active-word colour must change on the expected frame. This is measured from extracted frames,
  not inferred from JSON.
- Captions remain inside title-safe bounds and never cover the visible speaker's eyes or mouth.

## Audio

Use the interview's paired source audio. No narration, replacement voice, or music bed is added.
Apply the dialogue audio chain if needed, but do not alter timing. `no-bed` is an expected warning
for this format, not grounds for an override; any Error-severity audio finding is a failure.

## Gates and proof

Run, in order:

1. `check` with its duration-scoped default.
2. `check_frames` on the complete 43.93 s timeline.
3. `contact_sheet` with engine-selected times.
4. `render` without `ignoreChecks`.
5. Probe the encoded MP4 and extract independent ffmpeg frames if the native contact sheet shows
   decoder placeholders.

Passing requires `check.status == "clean"`, zero Error findings, and empty `skipped`;
`check_frames.status == "clean"` and empty `skipped`; an MP4 with both video and audio at
1080×1920; and the transcript, diarization, reframe, and caption criteria above.

## What would make this benchmark dishonest

1. Reusing `goodall-transcript-cut.mp4` or `research/phase4-seeing/goodall-vertical.project.json`.
   Those are prior outputs, not evidence that the current engine can repeat the work.
2. Typing the source ranges directly without running transcript search.
3. Counting “two speakers” anywhere in the full transcript while the selected host/Jane boundary
   has one label.
4. Creating visually even karaoke timing from subtitle cue duration instead of projecting Whisper
   word intervals.
5. Calling a landscape panel inside a portrait canvas “auto reframe”.
6. Rendering with `ignoreChecks`, weakening a gate, or reporting an unevaluated pixel gate as clean.
