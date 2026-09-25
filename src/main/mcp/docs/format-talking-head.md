# Format: talking head

One person speaking to camera — a vlog, a founder update, a UGC testimony, a lesson. The words
carry the piece; everything you add serves the words.

## Goal

Keep every idea the speaker meant to say, lose everything they did not: long pauses, false
starts, repeated takes, "um" runs. The result should feel like one confident take, not like a
string of fragments.

## Structure

1. **Hook** (first 1–3 s): the line that makes someone stay. If the strongest line is buried,
   ask the user before moving it to the front — reordering speech changes meaning.
2. **Body**: one idea per beat. A beat is usually 1–3 sentences.
3. **Close**: the takeaway or call to action, then out. No dead air after the last word.

## Pacing

- Leave a natural breath between sentences — about 6–10 frames at 30 fps. Cutting every gap
  to zero makes the speaker sound breathless.
- Remove pauses longer than ~0.7 s unless the pause is doing work (a joke's beat, a reveal).
- A jump cut in the same framing is fine and expected. If many land close together, a slight
  zoom (`edit_item` `scale` about 1.1, alternating) hides the jump.
- Speech carries attitude; numbers, names and proof are better on screen as text or B-roll.

## Captions and safe areas

- Short-form (vertical): word-by-word subtitles with `add_subtitles`, sitting in the lower
  third — never over the mouth. Raise them (`bottom`) or reframe the video if they touch the
  chin in a close-up.
- Long-form (landscape): plain lines with `add_captions` if the user wants captions at all.
- Keep text inside the middle 90% of the frame. On vertical, keep clear of the bottom ~20% and
  the right edge, where the platform draws its own buttons.

## Tools, in order

1. `read_project` — which clip is the talk, its length, what else is on the timeline.
2. `transcribe` with the clip's `itemId` — the words and their times. Gaps between lines are
   the pauses; repeated lines are the retakes. Read `findings` before relying on it.
3. Say what you found (so many pauses, these retakes) before cutting.
4. `remove_range` for each cut — it cuts every track at once, so sync holds. Work from the
   end of the timeline towards the start so earlier frame numbers stay valid, or re-read after
   each cut.
5. For vertical delivery: `set_canvas` with `preset: "vertical-1080"`, then `preview_frame` to
   check the face sits in the middle third.
6. Captions: `add_subtitles` (short-form) or `add_captions` (long-form).
7. Optional: a lower third (`add_template` with `lower-third`) the first time the speaker
   appears; one graphic per key number with `write_brf`.

## Verify

- [ ] `frame_grid` over the whole piece, after transcribing — no cut lands mid-word.
- [ ] Listen in your head: the kept lines still say the same thing in the same order.
- [ ] No black or frozen frame at any cut.
- [ ] Captions clear of the mouth and inside the safe area in every cell with text.
- [ ] The first frame is the hook, not a breath or a blink.
- [ ] Report each range you removed and why, in plain words.
