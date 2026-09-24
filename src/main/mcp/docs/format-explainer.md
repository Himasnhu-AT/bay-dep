# Format: explainer with B-roll

Teaching one idea: a presenter on camera with diagrams and cutaways, or narration (a voiceover,
no face) carried entirely by pictures and graphics.

## Goal

The viewer understands one idea by the end. The spoken line is the spine; every picture answers
what the line is saying at that moment.

## Structure

1. **Hook** (0–5 s): the question, the surprising fact, or the problem.
2. **Setup**: what the viewer needs to know first.
3. **Steps**: the explanation in 2–5 steps, each with its own picture or graphic.
4. **Recap**: the idea in one sentence, ideally with the graphic that sums it up.
5. **Close**: what to do or watch next.

## B-roll

- Two kinds. **Exact** B-roll must be on screen while a specific word is said ("this chip" →
  the chip). **Mood** B-roll carries a stretch of thought and need not match each noun.
- Place exact B-roll so it appears on the word it illustrates and holds long enough to read —
  at least 1.5 s, usually 2–4 s.
- A B-roll clip rarely needs its whole length: trim to the part that shows the thing.
- A cutaway covers the picture, not the sound: the presenter's or narrator's voice keeps playing
  under it.
- Mute B-roll clips' own sound unless it is part of the point (`edit_item` `volume: 0`).
- Start B-roll on a clean frame: `detect_cuts` on a supplied clip shows where its own shot
  changes are, so a cutaway does not flash a frame of the previous shot.

## Graphics

- Graphics carry numbers, lists, diagrams and steps. Speech carries the reasoning.
- An object that persists across steps (a diagram that builds up) should stay in the same place
  and style from step to step. Build it as one `write_brf` module rather than one per step.
- Every graphic needs a settled state held long enough to read, not only an entrance.

## Pacing

- A new picture every 3–6 s on long-form, 1.5–3 s on short-form.
- Pauses before a key idea can stay; filler cannot.
- Narration-led: never cut the narration to fit a picture — trim the picture.

## Captions and safe areas

- Captions (`add_captions` for long-form, `add_subtitles` for short-form) sit in the lower third.
  Graphics and diagrams then own the upper two-thirds; do not place a diagram's labels where
  captions will go.
- Presenter-led: the presenter can shrink to an inset while a diagram fills the frame — use
  `edit_item` `scale`/`left`/`top` or keyframes, and keep their audio running.

## Tools, in order

1. `transcribe` the talk or voiceover; mark the words that need a picture.
2. Tighten the speech (`remove_range`).
3. `browse_assets`; `detect_cuts` on long supplied B-roll to find clean shots.
4. For each exact word: `place_asset` on a track above, `edit_item` to trim and time it to the
   word.
5. Diagrams and steps: `write_brf`.
6. Missing pictures: read `bay://guide/generation`, then `generate_image` / `generate_video`.
7. Captions.
8. Optional music under narration: `edit_item` `duck` keyed to the voice track.

## Verify

- [ ] `frame_grid` after transcribing: each exact cutaway sits over its word.
- [ ] No cell flashes the wrong shot at a cutaway's start or end.
- [ ] Graphics readable at delivery size and clear of captions.
- [ ] The voice is continuous under every cutaway.
- [ ] Recap and close are present; export and read `findings` on `track_export`.
