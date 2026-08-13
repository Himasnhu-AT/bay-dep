# The music cut

The same story as the narrated version next door, cut differently and — the point — cut *better*.
Two files out of one project:

| | narrated | music |
|---|---|---|
| runtime | 78.3 s | **50.3 s** |
| soundtrack | Kokoro voice + an authored drone bed | the reference reel's track, as supplied |
| picture cuts | 25 (one per spoken line) | **38, every 3 beats — 1.305 s** |
| text cards | 25, tied to the read | **19, 1.7–3.5 s, held over two pictures** |
| mean frame delta | 0.67 % | **0.94 %** |
| hard cuts (scene > 0.20) | 8 | **24** |

## Why the voice went

A voiceover sets the pace of everything. Pictures can only move as fast as somebody talks, which
is why the narrated version runs 78 s to say what this one says in 50 s, and why its pictures sit
still for three seconds at a time. Taking the voice out lets the track set the pace instead: the
music holds the attention, and the cards do the arguing at reading speed rather than at speaking
speed. The words were rewritten to be read, not spoken — shorter, no connective grammar.

## Everything is on the beat grid

The track is **138.00 BPM**, detected off the file by spectral-flux autocorrelation rather than
assumed: 0.435 s a beat, 115 beats, first beat at 0.36 s. `cards.json` gives each card a length
in beats and those lengths **sum to exactly 115**, so the last card lands on the last beat.
Pictures change every 3 beats; cards hold 4–8. That is the whole timing model — there is not a
single hand-typed second in the build.

## Three fixes that mattered, in the order they were found

1. **The panel needed a mask.** The seam `shunt` slid the outgoing picture straight out of the
   panel and over the headline. `mask_set` holds a stencil the size of the panel while the
   picture moves under it, which is exactly what the mask is for. The gap the shunt opens behind
   it never shows, because the incoming picture is already covering the panel.
2. **No cut was actually a cut.** `press`, `swell` and `z-in` each carry an opacity channel that
   ramps over 9–10 frames, so every one of the 38 pictures faded up over 0.3 s no matter how hard
   you cut to it — measured, only **4** frames in the whole piece scored as a scene change.
   Switching to `split` (x only, no opacity) took that to 24 and the mean frame delta from
   0.69 % to 0.94 %.
3. **The entrance must not share a channel with the seam move.** `unveil` is y and so is `shunt`;
   an element carrying two y moves stops matching any single registry signature and the audit
   reports the channel as hand-keyed. Entrances on x, seams on y.

## Two notes on what this still is not

- **`check` returns `unevaluated`, not `clean`** — `speech-masked` and `bed-too-quiet` both skip.
  Neither is a gap in the piece: both measure the relationship between a voice and a bed, and
  there is no voice. A music-only cut cannot make them run, and a skip is honestly reported
  rather than worked around.
- **The mean frame delta is 0.94 % against the reference reel's 1.88 %.** The cut *rate* now
  matches (38 changes in 50 s against its 37), so the remaining gap is content: the reference is
  built from moving archival film and this is built from photographs, which hold still between
  cuts.

## The music is not ours

`music.wav` is the audio track lifted wholesale from the reference reel
(`telegram-cloud-document-5-6334676986044097105.mp4`), on request, and it is **gitignored** — no
third-party audio is checked in here. It is almost certainly a commercial production track, so
this cut is not distributable as it stands, and note the collision with `../CREDITS.md`: the
pictures oblige the finished video to be CC BY-SA, which a copyrighted soundtrack cannot be.
Publishing means replacing the track. Reproducing the build needs:

```bash
ffmpeg -i <the reference reel> -vn -c:a pcm_s16le -ar 48000 -ac 2 music.wav
python3 music_cut.py
```
