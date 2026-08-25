# The archive reel

A named format, because it has been built three times and the same six things went wrong each
time.

**What it is.** A portrait short, 45–60 s, cut to a music track with **no voice**. A fixed
headline on black at the top, a picture panel filling the middle band, a red caption chip on the
picture, a small mark low left. Archival photographs and documents from an open archive, cutting
on the beat; the cards hold longer than the pictures and carry the whole argument.

**When to reach for it.** A true story with a number in it — a crash, a collapse, a record, a
law, a discovery. Something that happened, that an archive has pictures of, and that a stranger
could not follow without dates and names.

**When not to.** Anything where you would need footage you do not have; anything about the
present, where a photograph is not evidence of anything; anything that needs a person to explain
it, which is a narrated piece and a different shape.

---

## The recipe

```
audio_beats(path)                  → bpm, firstBeatSeconds, beatTimes, candidates, confidence
project_create(portrait, source fps, kit)
marker_add per beat                 the story beats, on card starts
stock_search(query, describe) ×N    keywords for the archive, a sentence for the ranker
stock_fetch → library_save          keep what you chose, with its licence
media_import → add_image(cover:)    no ffmpeg, no plates
animate ×3 per shot                 entrance, ambient pan, seam push
add_shape + add_text per line       the chip and the card
add_audio(role: "bed")              the track, whole
check → snapshot → render
```

## The eight numbers

Everything below was measured on a real build, not chosen.

| | |
|---|---|
| **Canvas** | 1080×1920 at 30 |
| **Picture panel** | y `0.209`–`0.793`, full width. `cover: {width: 1.0, height: 0.584}` |
| **Picture cut** | every **3 beats** — 1.3 s at 138 BPM. The reference reels average 1.35 s |
| **Card hold** | **4–8 beats**, two pictures per card, so the text is still while the picture moves |
| **Caption line** | ≤ **25 characters**, `role: "chrome"`. Longer and the chip is wider than the frame |
| **Chip** | `role: "chrome"`, `tone: "accent"`, `scaleY 0.033`, line pitch `0.0335` |
| **Headline** | `role: "label"`, two lines at y `0.075` / `0.1195`, opaque from frame one |
| **Mark** | `role: "kicker"`, `tone: "accent"`, x `0.058`, y ≈ `0.74`. Keeps the bottom alive |

Card lengths in beats must **sum to the number of beats in the track**, or the last card does not
land on the last beat. `audio_beats` gives you the count.

## The six things that go wrong

1. **Cards that are fragments.** The first build of this opened on the bare word `1923` and
   nobody reading it knew what 1923 was — the cards were pieces of sentences a narration used to
   carry. With no voice, **every card must be a complete statement with its own context**: who,
   where, when, in five or six words a line. `New York, September 1929 / Prices hit a record
   high`, not `1929`.
2. **No cut is actually a cut.** `press`, `swell` and `z-in` all carry an opacity ramp of 9–10
   frames, so every picture fades up over 0.3 s however hard you cut to it. Measured: 4 scene
   changes in a 50 s piece. Use **`split`** — geometry only, no opacity — and it goes to 24.
3. **The seam move slides out of the panel.** Whatever pushes the outgoing picture also pushes it
   over the headline. **`mask_set` a rect the size of the panel** on every shot; the mask is a
   stencil over the canvas, so the picture moves under it and clips.
4. **The entrance shares a channel with the seam move.** `unveil` is y and so is `shunt`; two y
   moves on one element stop matching any registry signature and the audit calls the channel
   hand-keyed. **Entrances on x, seams on y.**
5. **A content word repeated across consecutive beats.** `check` reads a word appearing in two
   beats as two different elements as a rebuild rather than a carry, and refuses the render.
   Reword. `assets/wall-street-1929/audit_cards.py` catches this, the line length and the beat
   sum before a build.
6. **Two of the same thing in a row.** At a 1.3 s cut the eye needs the change to be a change of
   **kind**, not of subject: alternate a photograph with a document — a share certificate, a
   front page, a poster. Nineteen banknotes in a row read as one long banknote.

## Continuity, which this format has to earn

`check` derives a beat from every marker and asks that consecutive beats share an element that
**visibly changed**. `held()` samples a whole beat and *the last sample wins*, so an entrance
that has settled reads identically at the end of its own beat and the end of the next, and
carries nothing however visible it was.

So every shot takes **two moves**: an entrance on its own beat, and a `shunt` on the seam that
leaves it standing somewhere new. It stays alive until ~0.9 s past the next card's start, so it
is present in both beats. A short `fadeIn` on the incoming shot at card boundaries — and only
there — lets you *see* the outgoing one go; a hard cut would bury the move under an opaque frame
and satisfy the rule while changing no pixel, which is the carousel the rule exists to catch.

## Licences decide the subject

Check what the archive has under the **default** policy before committing to a story. Measured
across two subjects:

| | Weimar 1923 | Wall Street 1929 |
|---|---|---|
| public domain / CC0 | 10 of 25 | 30 of 33 |
| CC BY-SA (copyleft) | 13 | 0 |
| the finished video | must be CC BY-SA | no obligation |

Anything in a national archive released as CC BY-SA makes **your film** CC BY-SA. `stock_search`
refuses ShareAlike unless you pass `licence: "allow-sharealike"`, and the result then carries a
`licenceWarning` saying what you took on. A subject whose pictures are US federal or pre-1930 is
free; a subject whose pictures are Bundesarchiv is not.

**Period material only.** The archive is full of modern photographs of the same subject and the
ranker likes them, because they *are* pictures of it. A 2024 photograph in a 1929 piece is a lie
the viewer cannot check. Build a `contact_sheet`, look, and pick by hand — that has caught an
East German party headquarters offered for "Reichsbank", a 1933 boycott photo for a query about
shop windows, and a 2025 index chart for the 1932 low.

## What `check` will say

`status: unevaluated`, `skipped: [speech-masked, bed-too-quiet]`, **zero findings**. Both skips
are structural: they measure a voice against a bed and there is no voice. That is the clean
result for this format — do not add a voice to make them run.
