# Finding a shot by what it shows

When the user names a shot by its picture — "the bit with the car", "a wide of the beach",
"where she holds up the phone" — and you do not already know where it is, search for it. Do not
page through the footage with `frame_grid` shot by shot: that works on a minute of video and is
slow and costly on an hour of it. Visual search runs on this Mac and sends nothing anywhere.

## 1. Index once

Call `index_footage` with no arguments. It answers at once and indexes every video and image in
the project in the background; files already indexed (by content, across sessions) are skipped.
Call it again with no arguments to see progress — it says `done: true` when nothing is left.
If it says the model is not downloaded, tell the user to get it in Preferences › Visual search; do
not keep calling.

## 2. Search in words, like a caption

Call `search_footage` with `query` written as a caption of the picture — "a gold luxury car
parked under palm trees", not "car". Several short searches beat one long one: a detail ("a
ceiling fan") finds the shot that has it as well as the whole scene does.

Read the order, not the score. `separation` says how far the best hit stands above the rest; near
0 means nothing really matched. Even a clear winner can be wrong when the footage has no such
shot — a search for something absent still returns its nearest neighbour, often with a
respectable separation. So:

## 3. Look before you cut

A hit is a **moment** (`seconds` in the file; `onTimeline` frames where the file is placed), not a
shot. Before using it:

- `frame_grid` with the `assetId` and a few seconds either side of the hit, to see it is the
  shot the user meant. If it is not, say what you found and search again with other words.
- `detect_cuts` on the asset to get the shot's real boundaries: the shot is the stretch between
  the last cut at or before the hit and the next cut after it. Use those times, not the hit's.
  Soft cuts (dissolves, letterboxed or dark footage) may need a lower `threshold`.

## 4. Place it

`place_asset` puts the whole file down; then `edit_item` the new clip to exactly that stretch —
`sourceStartSeconds` at the cut, `durationInFrames` ending on the next cut. Check the first and
last frame of the clip with `preview_frame` so no frame of the neighbouring shot slipped in.

`similarTo` (an `assetId` and `seconds`) finds shots that look like one you already have — more
angles of the same scene, or B-roll that matches it.
