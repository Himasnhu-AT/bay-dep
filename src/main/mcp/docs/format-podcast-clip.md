# Format: podcast or interview clip

A 20–90 second vertical clip cut from a long conversation, made to stand on its own in a feed.

## Goal

One complete thought — a question and its answer, a claim and its payoff, a story with an end —
that makes sense to someone who never heard the rest of the episode. It must open strong and end
on the point, not trail into the next topic.

## Choosing the moment

- Transcribe the whole recording first and read it. Pick candidates where one idea starts and
  finishes inside 20–90 s. Offer the user two or three with a line on why each works, unless they
  already named the moment.
- Good openers: a surprising claim, a direct question, a strong opinion. A clip that needs "so,
  as I was saying" to make sense is the wrong clip.
- End on the payoff line. If the answer rambles on, end at the sentence that lands.

## Structure

1. **Hook** (0–3 s): the most striking line of the moment. It may be lifted from inside the
   answer and repeated at the start only if the user agrees.
2. **Setup**: the question or context, as short as it can be.
3. **Answer / story**, tightened like a talking head.
4. **Payoff** and out.

## Framing (vertical 9:16)

- `set_canvas` with `preset: "vertical-1080"` and `fit: "cover"` fills the frame from a
  landscape source by cropping the sides. Then look: the speaking face must be in the frame and
  roughly centred, eyes about a third of the way down.
- Two people in one wide shot rarely both fit a vertical frame. Cut to whoever is speaking — move
  the crop (`edit_item` `left`) per section, splitting at speaker changes with `split_at` — or
  stack the two views, one in each half, if the user wants both visible.
- Cut toward whoever matters now: the answer favours the guest; a reaction that changes the
  meaning earns the listener's face. Do not cut on a timer.
- Leave room above the head for a title band, and room below the chin for subtitles.

## Captions and safe areas

- Word-by-word subtitles with `add_subtitles` are expected in this format. Default to the
  `spotlight` design unless the user named one; `clean` suits a calmer interview.
- Keep subtitles in the lower third, above the bottom ~20% where platform buttons sit, and off
  the right edge. Never across a mouth.
- An optional top band (from `write_brf`) can name the topic or the speaker for the first few
  seconds.

## Pacing

- Remove pauses over ~0.5 s and crosstalk that adds nothing; keep laughter that carries the
  moment. A breath of 4–8 frames between sentences.
- Audio of both speakers stays continuous under any reframe or cutaway.

## Tools, in order

1. `transcribe` the recording (`assetId` for the whole file, or the clip's `itemId`).
2. Pick the moment; `remove_range` everything before and after it (or place a trimmed copy).
3. `set_canvas` to vertical; `split_at` at speaker changes and reframe each part with
   `edit_item`.
4. `remove_range` for pauses inside the moment.
5. `add_subtitles` over the clip.
6. Optional: `write_brf` for a topic band; `add_template` `end-card` for a follow prompt.

## Verify

- [ ] `frame_grid` over the whole clip after transcribing: the speaking face is in frame in every
      cell, the subtitles match the words under the cell.
- [ ] The first second is the hook; the last line is the payoff.
- [ ] No cell shows a half face or an empty chair at the crop.
- [ ] Subtitles clear of mouths and the platform's bottom and right edges.
- [ ] Export, then read `findings` on `track_export` — `complete: true` before you say done.
