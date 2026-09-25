# Format: ranking or listicle

"Top 5 …", a tier list, a countdown, "3 mistakes …". The viewer stays to see what comes next and
what is number one.

## Goal

Every entry gets a clear moment: the viewer always knows which entry is on screen, where it sits
in the list, and why. The best entry is saved for last (a countdown) or promised at the start
(a top-down list).

## Structure

1. **Hook** (0–3 s): the promise — "the five best …, and number one surprised me". Show the
   empty list or the first item immediately; do not open on a logo.
2. **Entries**: each is *reveal → reason → proof*. Reveal the name and number on one word, give
   the reason in a sentence or two, show proof (a clip, a number, an image).
3. **Payoff**: the top entry, given more time than the others.
4. **Close**: a question to the viewer or a call to action.

## The board

A ranking usually has a persistent list — a board — that fills in as entries are revealed.

- Decide what the board shows at the start (empty slots, or the numbers only) and what each
  reveal adds.
- An entry has a reveal moment and stays on the board afterwards; its moment ending is not the
  entry disappearing.
- Keep the board in one place for the whole video. Plan the speaker's position and the board's
  region together: speaker on one side, board on the other, or board in the top band with the
  speaker below.
- Build the board as one `write_brf` module covering the whole video, with each entry's reveal
  time in its data. One module keeps every entry's style identical.

## Pacing

- Entries of roughly equal length, 5–12 s each on short-form; the top entry up to twice that.
- The reveal lands on the word that names the entry — take the time from the transcript.
- A short sound or a cut on each reveal helps; the same whoosh on every cut gets old fast.

## Captions and safe areas

- Subtitles (`add_subtitles`) in the lower third; the board must never sit under them. On
  vertical, the top band and the lower third are both taken — keep the speaker's face in the
  middle.
- Entry names on the board are typography, not captions: they may differ from the spoken words
  ("#3 · iPhone 17" while the speaker says "number three is the new iPhone").
- Real product names, logos and screenshots come from files the user supplies. Do not generate a
  brand's logo or UI.

## Tools, in order

1. `transcribe` the narration or talk; find the word that names each entry.
2. Tighten the talk (`remove_range`) first — every later time depends on it.
3. `write_brf` for the board, with one entry per reveal time taken from the transcript after the
   cut. Place it in the same call (`atFrame`).
4. Proof shots: `import_media` and `place_asset` on a track above the talk, one per entry;
   `edit_item` to trim each to its reason.
5. `add_subtitles`.
6. Optional: `detect_beats` if cut to music, so reveals land on beats.

## Verify

- [ ] `frame_grid` across the video: in every cell you can tell which entry is current.
- [ ] Each reveal appears on the naming word (compare the cell with the words under it).
- [ ] The board never covers the face or the subtitles.
- [ ] Numbers on the board match the order spoken.
- [ ] The top entry gets its extra time; the video ends on the close, not on silence.
