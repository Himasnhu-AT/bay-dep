# Cutting a raw interview into a clip

A 6:13 interview down to a 67.8 s vertical clip: dead air removed, shots chosen by who is on
screen, the interview's own audio, no voiceover and no music.

```bash
bay --mcp
python3 podcut.py     # expects pod/goodall.webm and shots_labelled.json beside it
```

## The source

*Jane Goodall, The Green Interview* — 640×360, 373.6 s, **CC BY 3.0**, by The Green Interview
(Silver Donald Cameron), from Wikimedia Commons. Gitignored; it is 34 MB of somebody else's
video. The licence permits the edit and requires the credit, which is on screen for the whole
clip and repeated here.

## Three decisions, each from a measurement

**1. Where the dead air is.** `silence_detect`. The threshold is derived, not typed: the noise
floor is the 10th percentile of 20 ms frame levels, speech is the 75th, and anything within 6 dB
of the floor is nothing. On this recording that is a floor of **−50.9 dB**, speech at **−30.7**,
threshold at **−44.9** — the number a person would have chosen, arrived at without choosing. It
found **59 gaps, 35.9 s, 9.6 %** of the take.

A fixed dBFS threshold would be wrong on the next file: −40 dB is the noise floor in one room and
the speech in another. The test that matters is `a_quieter_recording_yields_the_same_cuts`.

**2. Who is on screen.** `shots_detect` finds 38 cuts; a frame from each of the 22 substantial
ones is scored by SigLIP against four descriptions — the guest, the host, the b-roll, the titles.
The separation is unambiguous:

| shot | | guest | host | broll | titles | called |
|---|---|---|---|---|---|---|
| 17 | 20.4–86.2 s | 0.039 | **0.096** | −0.004 | −0.002 | host |
| 18 | 86.2–120.9 s | **0.169** | 0.078 | −0.035 | −0.058 | guest |
| 22 | 137.4–142.7 s | −0.114 | −0.147 | **0.051** | −0.100 | broll |
| 16 | 11.4–20.4 s | −0.007 | −0.032 | 0.025 | **0.041** | titles |

**This is why the vision component is in the editor.** The recording's audio is dual-mono — left
and right correlate at **1.000** with zero side energy — so there is no stereo cue to tell the
speakers apart and nothing to diarise with. The picture is the only signal there is, and
scoring it against a sentence is what `bay-vision` does.

That labelling picks the section: shots 32–35 are host question, guest answer, host question,
guest answer, with no b-roll in them. Chosen from a table, not by scrubbing.

**3. Where the picture sits.** The source is 640×360. A portrait crop of a 360-line source is
202 px wide and upscales 5.3× — mush. So the video stays landscape inside the portrait frame at
1.7×, which is the shape every podcast clip is actually cut in, and the frame carries the rest:
strap above, the speaker's name below, the credit at the foot.

## Two things the gate taught this edit

- **`add_video` carries no audio.** The first export was silent and `check` said so
  (`silent` — "nothing will be audible"). Picture and sound are separate elements, which turns
  out to be what makes the rest work: the video clips can overlap for continuity while the audio
  stays butted. Two pictures on top of each other is a dissolve; two voices on top of each other
  is both people talking at once.
- **Every splice is a beat.** `check` derives one from each `role: speech` clip's start, so all
  20 splices are beats and each needs the outgoing frame to visibly move or the join reads as a
  rebuild. So there is a `shunt` on every seam — larger where the speaker changes, so the two
  kinds of cut do not look the same. That is also just the right treatment: a silence cut in a
  talking head is a jump cut, and a push makes it deliberate instead of a glitch.

## Measured

| | |
|---|---|
| source | 373.6 s, 640×360 |
| section chosen | shots 32–35, 76.8 s |
| after silence removal | **67.8 s** in 20 splices, 11.7 % removed |
| speaker changes | 4 |
| output | 1080×1920, h264 + aac, 9.2 MiB |
| loudness | LRA 4.7 LU, peak −1.4 dBFS |
| `check` | zero errors; one `no-bed` warning |

`no-bed` is correct and ignored: there is no music under this, on purpose. The user asked for no
voiceover and nothing added, so the only sound is the interview's own.

## What this is not

- **Not diarisation.** It knows who is *on screen*, not who is *talking*. On this source they
  coincide because it is already cut that way. On a single-camera two-shot they would not, and
  nothing here would help.
- **Not a transcript edit.** Removing filler words, false starts and repeated sentences is the
  other half of what a podcast editor does, and it needs speech-to-text, which bay does not have
  — `bay-speech` speaks, it does not listen.
- **Not reframing.** "Cut to whoever is speaking" here means choosing whole shots, not panning
  a crop around a wide master. That wants face detection.
