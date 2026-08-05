# Narration and subtitles

vii speaks with Kokoro (82M params, Apache-2.0), running as a sidecar process. Because Kokoro
reports **per-word timestamps**, captions are synchronised to the audio rather than estimated.

Check availability with `speech_status` before planning around it.

---

## The one rule that matters

**The voice must not read the screen.**

If the frame shows `+50%` and `−50%`, narration that says "plus fifty percent, then minus
fifty percent" teaches nothing and hands the viewer two copies of one message to process at
once. The picture carries the numbers; the voice carries what the picture cannot — the
causation, the consequence, the "so what".

Bad — reads the frame:

> Plus fifty percent. Then minus fifty percent.
> A hundred becomes one fifty, then seventy five.
> To recover a fifty percent loss you need a hundred percent gain.

Good — explains the mechanism:

> A gain, then an equal loss. Feels like a wash.
> **The loss lands on a bigger balance than the gain did.**
> And climbing back always starts from a smaller base.

Test it: read the narration end to end with the video off. It should be a complete, coherent
explanation that never speaks a single on-screen figure. If it reads like a list of labels,
rewrite it.

---

## Budgeting the script

Kokoro at `speed: 1.06` runs roughly **2.5 words/second including pauses**. Budget each line
against its scene, then verify — `narrate` returns `endSeconds`.

```
words ≈ available_seconds × 2.5
```

A line that overruns gets clipped by the render duration, or talks over the next scene. Both
are caught by comparing `endSeconds` to the next line's start. Fix by starting earlier,
shortening the line, or raising `speed` — in that order. Cutting a clause the picture already
carries is usually the best fix.

Speech density above ~85% of runtime reads as an explainer rather than a mood piece. That is a
choice, not a defect, but make it deliberately.

---

## Voices

`speech_status` lists the catalogue. Language codes: `a` American English, `b` British,
`e` Spanish, `f` French, `h` Hindi, `i` Italian, `j` Japanese, `p` Portuguese, `z` Mandarin.

American English includes `af_heart`, `af_bella`, `af_nova`, `af_sarah`, `am_adam`,
`am_michael`, `am_onyx`, `am_puck` and more. `af_heart` is a good neutral default.

There is **no SSML and no voice cloning**. Emphasis and pacing come from punctuation and
`speed` only. A full stop buys a real pause; a comma buys a short one.

---

## Levels

Kokoro's raw output is quiet (mean ≈ −26 dBFS) and **varies ~5 dB line to line**, which reads
as uneven delivery. `narrate` normalizes each utterance to `peakDb` (default −2.0 dBFS), which
is what makes a single voice gain trustworthy. Leave it on.

Target **10–15 dB separation** between speech and the music bed:

| | value |
|---|---|
| speech mean | ≈ −21 dB |
| music mean | ≈ −36 dB |
| separation | **14–15 dB** |
| peak | keep below −1 dB |

Practically, on a normalized voice: music bed at `volume: 0.14`, narration at `volume: 1.15`.
Above ~1.25 the summed peak clips, because each utterance already peaks at −2 dBFS.

Verify by measuring speech windows against music-only gaps:

```bash
ffmpeg -nostdin -ss <t> -t <d> -i out.mp4 -af volumedetect -f null /dev/null 2>&1 | grep volume
```

**Keep the measurement windows in sync with the narration timings.** A "music only" probe that
lands on speech after a rewrite reports a separation collapse that is not real.

---

## Captions

`narrate` places captions from the same synthesis as the audio, so they cannot drift.

| knob | default | notes |
|---|---|---|
| `maxWords` | 4 | 3–5 reads at thumb size |
| `minCaptionSeconds` | 0.7 | below this a caption cannot be read |
| `maxCaptionSeconds` | 3.0 | forces a break in a long run |
| `gapSeconds` | 0.45 | a silence this long is a pause: break the caption there |
| `captionY` | 0.70 | top of the caption box, fraction of height |

Two behaviours that only show up on screen, both handled for you:

- A short cue is extended **only into genuinely free time**, so two captions never share the
  screen.
- Holes *smaller* than `gapSeconds` between consecutive captions are closed. A caption ends on
  its last word, so two captions of one sentence otherwise leave the inter-word silence
  between them — which reads as a blink.

Sizing: 4 words at `captionFontSize: 38` fits an 907px box on one line. At 5 words / 42px a
caption like "bigger balance than the gain" wraps and orphans its last word. Snapshot and
check the longest caption.

Placement: `captionY: 0.70` clears the platform caption band. If the artwork already fills the
frame to y≈1490, captions have to go lower (≈0.79, inside the band) — a compromise worth
naming rather than hiding. A piece designed for captions reserves the space up front.

---

## Subtitle files

- `subtitles_add` reads SRT or WebVTT and places every cue.
- `subtitles_export` writes the timeline's captions back out.
- `subtitles_to_video` does the whole thing in one call: `.srt` in, `.mp4` out, optionally
  narrating each cue at its own time. It reports `overruns` — cues whose spoken audio ran past
  the next cue's start — rather than silently truncating, because speech does not have to fit
  the window a subtitle author chose.
