# Reviewing your own edit

An edit is not done when the last tool call returned. It is done when you have **watched** it and
it holds up. Tool results tell you what you asked for; only pictures and read-back files tell you
what you got. Run this review after an export, and after any big edit (a cut-down, B-roll pass,
captions, a new graphic), before you tell the user it is finished.

## 1. Look at it

Call `frame_grid` over the stretch you changed — the whole timeline for a short piece, or
`fromFrame`/`toFrame` around each change for a long one. Transcribe the dialogue first
(`transcribe` with the clip's `itemId`) so every cell is labelled with the words being said; a
grid without words cannot tell you whether a shot lands on its line. Zoom in with a smaller
`count` over a short range, or `preview_frame` on one frame, when a cell looks wrong.

## 2. The checklist

- **B-roll covers the right line.** Each cutaway should sit over the words it illustrates. Read
  the words under the cells: if the shot of the product appears while the speaker is still on the
  previous sentence, move it (`edit_item` `from`) to the word it belongs to.
- **Cues land on the intended word.** Captions, titles, graphics and cuts timed to speech should
  appear on the word, not a beat before or after. Compare the cell where the graphic appears with
  the words labelled under it.
- **Captions and graphics do not cover faces.** Look at every cell with text in it. A lower third
  over a chin, or subtitles across a mouth in a close-up, is wrong even if the text is correct —
  move it (`edit_item` `left`/`top`) or shrink it (`width`/`height`, `scale`).
- **Safe areas.** Keep text inside the middle ~90% of the frame (title safe) and nothing
  important in the outer 5%. For vertical video, keep clear of the bottom ~20% and right edge,
  where the platform's own buttons and captions sit.
- **No black or stray frames between shots.** A black cell, a flash of the wrong shot, or a
  frozen frame at a cut is a gap or an overlap on the timeline. `read_project` shows the items
  around it; close the gap or trim the overlap.
- **Transitions are clean.** A dissolve needs footage either side of the cut; a transition that
  resolved shorter than asked, or shows a hold frame, needs longer handles.
- **Audio.** Dialogue should not be buried under music (duck it, or lower the music's `volume`),
  and there should be no unintended silent stretches — a clip placed with `volume: 0`, a muted
  track, or a gap in the dialogue track. If loudness mastering was asked for, `track_export`
  reports the measured level; `status: 'missed'` is a finding to report.
- **Shots start clean.** A clip that starts one frame before its shot change shows a flash of
  the previous shot. `detect_cuts` gives the exact frames of the shot changes in a source.

## 3. Export findings

When `track_export` says `stage: 'done'`, read `findings` before anything else. Main has read
the delivered file back: a missing audio stream under a timeline with sound, a length more than
2% off the range, an empty or unreadable file, and frames written with an item still missing are
all **blocking**. `complete: false` means at least one blocking finding (or incomplete frames).

A blocking finding means the export is **not done**: fix what it names and export again, or — if
you cannot fix it — tell the user plainly what is wrong with the file. Never report an export
with a blocking finding as finished. A `warn` finding is worth a sentence to the user if it
matters to them.

`transcribe` carries `findings` too: no speech found, or lines with no words, is blocking — do
not caption from a transcript like that, and do not invent the words.

## 4. Then report

Say what you checked, not only what you did: "Watched the whole cut — the B-roll lands on each
product mention and the captions stay clear of faces." If you could not check something (no
transcript, a cell still loading), say that instead of implying it looks right.
