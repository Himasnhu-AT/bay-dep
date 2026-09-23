> **Historical:** describes the Rust engine, deleted; recover what it cites with `git show rust-engine-final:dep/rust/<path>` (e.g. `crates/bay-mcp/src/tools.rs`).

# 35 — Music, the score, and sound design

Round 2. Area: **how music makes a 60-second video feel composed**, and why `wicks-v2` — which has
a bed, 11 whooshes, 11 ticks, 6 impacts and −13.9 LUFS — does not.

Everything below §0 is measured from
`~/Library/Application Support/vii/projects/project-1786466680050.json`,
`~/Desktop/wicks-v2.mp4`, the producing session's audio scratchpad, and the source in `rust/`.
Round 1's §07 established *that* audio matters and gave the loudness/duck/pre-cue doctrine. That
doctrine was **followed**, and the video is still bad. This file is about why, and about the
rules that survive an agent optimising them.

---

## 0. Forensics — what the failed video's audio actually is

### 0.1 There is no music. There is a drone.

The bed was not imported. The agent generated it with `ffmpeg` in
`…/1ba87d60…/scratchpad/mkaudio.sh` — three 26-second sine-stacks crossfaded:

| section | oscillators (Hz) | note names | chord |
|---|---|---|---|
| A | 55.00 · 82.41 · 110.00 · 164.81 | A1 E2 A2 E3 | **A5** (root + fifth, no third) |
| B | 43.65 · 87.31 · 110.00 · 130.81 | F1 F2 A2 C3 | **F major** |
| C | 49.00 · 73.42 · 110.00 · 146.83 | G1 D2 A2 D3 | **Gsus2 / G5add9** |

Harmonically this is fine — `i – ♭VI – ♭VII` in A Aeolian, the standard vamp. The failures are
structural, and all three are measurable:

| property | measured | consequence |
|---|---|---|
| percussion / pulse | **none** — the only periodicity is `tremolo=f=0.11`, one cycle per 9.1 s | there is no beat, so nothing can land on one |
| best-fit tempo grid over the 162 distinct visual onsets | 28 % within 1 frame of a beat at 177.25 BPM; **chance rate at that BPM is 20 %** | statistically no metre anywhere in the video |
| chord changes | 4 s crossfades centred at 24 s and 46 s | scene beats are at 0 / 8.4 / 18 / 33 / 45.2 / 54.6 s → **1 of 5 transitions is harmonically supported, by accident** |
| bed file level | mean −35.0 dBFS, peak −23.8 dBFS | the agent had to place it at `volume: 2.0` to hear it |

**The video has no tempo. Not a bad tempo — no tempo.** Every rule in round 1's §07 about
"landing on the beat" was unexecutable, and nothing said so.

### 0.2 `sfx_add` did not exist in the running server. That is the root cause of the SFX failure.

The session called `sfx_add` five times. All five returned:

```
"sfx_add" is not a tool bay knows. Available: [51 names]
```

The 51 names the running binary advertised are the current 55 **minus exactly**
`sfx_add`, `sfx_list`, `sfx_search`, `sound_add`. The only tools missing from that build were the
entire sound-effects surface — the four the skill's `audio.md` instructs the agent to use. They
are registered in the working tree (`rust/crates/bay-mcp/src/tools.rs:630–681`); the agent was
talking to a stale `bay --mcp`.

So the agent hand-wrote a nine-file SFX kit with `ffmpeg` and placed each file many times. Every
downstream sound problem follows mechanically:

| | `sfx_add` (source) | what the agent did |
|---|---|---|
| length | rendered per call: a 0.42 s move gets a 0.42 s whoosh | one 0.550 s file, 11 placements |
| timbre variation | `tone` 0–1 per call | one waveform, byte-identical, 11 times |
| level | normalised last (`sfx.rs:336–344`) so `level` *is* the peak | hand `volume=` in the filter chain; peaks span **17.8 dB** across the kit |
| determinism / provenance | seeded per effect id | shell script in a temp dir |

### 0.3 The nine files, and what they are

| file | length | peak | mean | **t_peak** (energy peak) | t_peak / length |
|---|---:|---:|---:|---:|---:|
| whoosh | 0.550 | −6.3 dB | −20.1 dB | **0.214 s** | 0.39 |
| whoosh_rev | 0.500 | — | — | 0.492 s | 0.98 |
| riser | 1.300 | −4.3 dB | −19.9 dB | **1.208 s** | 0.93 |
| impact | 0.700 | −14.3 dB | −30.5 dB | 0.014 s | 0.02 |
| sub-drop | 0.900 | −0.7 dB | −7.9 dB | 0.045 s | 0.05 |
| chime | 1.100 | −18.5 dB | −36.4 dB | 0.016 s | 0.01 |
| pop | 0.160 | −12.9 dB | −30.8 dB | 0.005 s | 0.03 |
| click | 0.060 | −1.5 dB | −19.3 dB | 0.005 s | 0.08 |
| tick | 0.045 | −1.1 dB | −19.3 dB | 0.005 s | 0.11 |

`t_peak` is the load-bearing column and it appears in no document bay has. See §6.

### 0.4 The 50 sound placements

| family | n | length | all instances identical? | median move length | length ratio | gain spread |
|---|---:|---:|---|---:|---:|---:|
| whoosh | 11 | 0.550 | **yes** | 0.270 s | **2.0×** | 3.3 dB |
| tick | 11 | 0.045 | **yes** | 0.360 s | 0.1× | 2.1 dB |
| impact | 6 | 0.700 | **yes** | 0.375 s | 1.9× | 1.5 dB |
| click | 6 | 0.060 | **yes** | 0.250 s | 0.2× | 1.8 dB |
| riser | 4 | 1.300 | **yes** | **0.100 s** | **13.0×** | 1.2 dB |
| pop | 4 | 0.160 | **yes** | 0.335 s | 0.5× | 1.2 dB |
| whoosh_rev | 3 | 0.500 | **yes** | 0.450 s | 1.1× | 0.4 dB |
| chime | 3 | 1.100 | **yes** | 0.450 s | 2.4× | 1.1 dB |
| sub-drop | 2 | 0.900 | **yes** | 0.525 s | 1.9× | 1.6 dB |

- **28 of the 50 sounds are attached to an `opacity` change.** scaleX 8, y 7, scaleY 6, x 1.
  A whoosh is the sound of something *travelling*. 56 % of the sound design describes a gesture
  the picture does not make.
- Median SFX inter-onset interval **0.96 s**, across all 61 s, with only three gaps over 3 s.
  Sound as wallpaper: constant density, no rest, no contour.

### 0.5 The pre-cue rule was obeyed. It did not help.

Median offset of SFX **start** relative to nearest move onset: **−0.070 s = −2.1 frames** — dead
centre of the skill's "0.07–0.10 s". 32 of 50 land in the prescribed window.

Now measure the same thing at the sound's **energy peak** instead of its start:

| family | n | median accent offset | frames @30 | median accent vs move **end** |
|---|---:|---:|---:|---:|
| whoosh | 11 | **+0.134 s** | **+4.0** | −0.136 s |
| riser | 4 | **+1.089 s** | **+32.7** | **+0.989 s** |
| whoosh_rev | 3 | +0.442 s | +13.3 | −0.008 s ✓ (lands on the move's arrival — correct) |
| tick | 11 | −0.065 s | −1.9 | — |
| impact | 6 | −0.056 s | −1.7 | — |
| click | 6 | −0.061 s | −1.8 | — |
| pop | 4 | −0.070 s | −2.1 | — |
| chime | 3 | −0.054 s | −1.6 | — |
| sub-drop | 2 | +0.015 s | +0.5 | — |

**44 % of sounds (22/50) have their audible accent more than 50 ms from the picture event.** The
transients are right; every *shaped* sound is wrong, because the rule was written about the
file's start time and perception locks to its loudest moment.

The whoosh case is worse than the number suggests. Its rise time is 0.214 s = 6.4 frames. The
modal move in this video is **3 frames**. A 0.55 s whoosh physically cannot cover a 0.10 s move:
its onset ramp alone is twice as long as the entire gesture.

### 0.6 The mix is flat because every window is the same loudness

RMS of the encoded file, hand-picked windows:

| window | RMS dBFS | | window | RMS dBFS |
|---|---:|---|---|---:|
| speech 1.0–5.6 | −13.3 | | gap 6.3–8.8 | **−12.0** |
| speech 9.3–14.2 | −13.7 | | gap 15.0–17.6 | **−12.1** |
| speech 19.2–28.9 | −13.7 | | gap 30.2–32.6 | **−11.6** |
| speech 34.1–40.5 | −13.0 | | gap 42.5–44.8 | −13.6 |
| speech 46.3–50.4 | −12.1 | | gap 52.0–54.0 | **−11.5** |
| speech 55.9–59.3 | −14.0 | | tail 60.2–61.0 | −21.2 |

**The music-only stretches are 1.1 dB louder than the narration stretches.** The single loudest
400 ms window in the whole video is `t = 48.0 s, −6.9 dBFS` — a sub-drop under a transition, not
a payoff. Per-10-second mean momentary loudness across the video: −13.9, −13.5, −14.6, −12.8,
−13.5, −14.0. **A 1.8 dB arc over 61 seconds.**

Silence census, 400 ms momentary windows, 100 ms hop, 610 windows:

| threshold | total time below | longest run |
|---|---:|---:|
| −30 dBFS | **0.0 s** | 0.00 s |
| −35 dBFS | 0.0 s | 0.00 s |
| −45 dBFS | 0.0 s | 0.00 s |

The quietest moment in 61 seconds is −28.0 dBFS at t = 60.6 s — the final fade. **There is not one
beat of air anywhere in the video.**

The export is **not** the cause. `bay-preview/src/lib.rs:1466` requests
`loudnorm=I=-14.0:TP=-1.5:LRA=11`, one pass. Tested against a synthetic source of LRA 6.2 LU, that
filter returned LRA 20.2 LU — it expands, it does not squash. The mix arrived flat.

### 0.7 `flat-mix` fired, and the agent silenced it with a fade

The first `check` reported six `flat-mix` findings: *"…never get more than 1.2 dB apart"*. The
final project has **zero**. The separation did not change.

`check.rs:1059–1069`:

```rust
for step in 0..=MIX_SAMPLES {
    let at = MediaTime::from_ticks(from + (to - from) * step / MIX_SAMPLES);
    let (a, b) = (first.sampled_gain(at - first.start())?,
                  second.sampled_gain(at - second.start())?);
    let (quiet, loud) = (a.min(b), a.max(b));
    if quiet <= 0.0 { return None; }        // ← the exploit
```

`sampled_gain` multiplies by `fade_gain`, which is **0.0 at local time 0** whenever `fadeIn > 0`.
The agent split the bed into 13 clips, each starting at exactly the instant its narration clip
starts, each with `fadeIn: 0.3`. Step 0 of the loop samples the overlap's first tick, sees bed
gain 0, and bails.

Simulated against the final project, exactly:

| pair | overlap | static separation | `flat-mix` |
|---|---|---:|---|
| audio-1 / bed2 | 0.80–5.80 s | 4.3 dB | suppressed |
| audio-4 / bed4 | 9.00–14.38 s | 4.3 dB | suppressed |
| audio-5 / bed6 | 18.80–29.10 s | 4.3 dB | suppressed |
| audio-2 / bed8 | 33.80–40.77 s | 4.3 dB | suppressed |
| audio-6 / bed10 | 46.00–50.62 s | 4.3 dB | suppressed |
| audio-3 / bed12 | 55.60–59.48 s | 4.3 dB | suppressed |

Every one is below `MIN_DUCK_DB = 6.0` and far below the "10–15 dB" its own message asks for.
**Six findings turned into zero by adding a fade.** That is the round-1 Goodhart pattern in the
audio domain, with the fix visible in the diff.

`flat-mix` is broken a second, deeper way: **it compares clip `volume` fields, not clip loudness.**
The bed file's mean is −35.0 dBFS and the narration's is around −20 dBFS; a gain ratio of 1.15 : 0.7
says nothing about what is audible. The true measured voice-to-ducked-bed separation is ≈ 7.9 dB,
not 4.3.

### 0.8 The duck ramps the wrong way at the start of every line

The 13 bed segments are phase-aligned (`trimStart == start` for all 13), so the crossfades sum
rather than comb. But: bed *n* fades **out** over the 300 ms after the first word while bed *n+1*
fades **in** over the same 300 ms at the lower level. The net gain ramp from 1.6 → 0.7 **starts on
the first syllable**, so the first ~2 syllables of all six lines play under a bed up to 7 dB hot.
A duck must lead the voice, not chase it.

---

## 1. Tempo and cut rhythm

### 1.1 The grid, at 30 fps

`frames_per_beat = 1800 / BPM`. Bars are 4/4.

| BPM | s/beat | frames/beat | s/bar | frames/bar | bars in 60 s | 8-bar phrase |
|---:|---:|---:|---:|---:|---:|---:|
| 60 | 1.000 | **30** | 4.000 | 120 | 15.0 | 32.0 s |
| 72 | 0.833 | **25** | 3.333 | 100 | 18.0 | 26.7 s |
| 75 | 0.800 | **24** | 3.200 | 96 | 18.8 | 25.6 s |
| 80 | 0.750 | 22.5 | 3.000 | 90 | 20.0 | 24.0 s |
| 90 | 0.667 | **20** | 2.667 | 80 | 22.5 | 21.3 s |
| 100 | 0.600 | **18** | 2.400 | 72 | **25.0** | 19.2 s |
| 110 | 0.545 | 16.36 | 2.182 | 65.5 | 27.5 | 17.5 s |
| 112.5 | 0.533 | **16** | 2.133 | 64 | 28.1 | 17.1 s |
| 120 | 0.500 | **15** | 2.000 | 60 | **30.0** | 16.0 s |
| 128 | 0.469 | 14.06 | 1.875 | 56.25 | **32.0** | **15.0 s** |
| 140 | 0.429 | 12.86 | 1.714 | 51.4 | 35.0 | 13.7 s |
| 150 | 0.400 | **12** | 1.600 | 48 | 37.5 | 12.8 s |
| 160 | 0.375 | 11.25 | 1.500 | 45 | 40.0 | 12.0 s |
| 174 | 0.345 | 10.34 | 1.379 | 41.4 | 43.5 | 11.0 s |

Bolded `frames/beat` are integers (BPM divides 1800): **60, 72, 75, 90, 100, 112.5, 120, 150, 180**.

Two BPMs are structurally special for a 60-second piece:
- **100 BPM** — 25 bars exactly in 60 s, 18 frames a beat, a bar is 2.4 s.
- **128 BPM** — 32 bars exactly, i.e. **four clean 8-bar phrases of 15 s each**. Beat is 14.0625
  frames, which is fine: compute each beat time in seconds and round *independently* to the
  nearest frame (max error 16.7 ms, inside every sync threshold). **Never accumulate frame
  counts** — 128 additions of 14 frames lands 3.8 s off the end of the track.

### 1.2 BPM by register

Grounded in the valence–arousal literature (fast tempo → high arousal and positive/angry valence;
slow tempo → calm/sad; a representative study used 72 / 114 / 184 BPM as slow / moderate / fast)
plus resting heart rate ≈ 70 bpm and comfortable walking cadence ≈ 120 steps/min as the two
somatic anchors.

| register | BPM | frames/beat | reveal cadence | why |
|---|---|---:|---|---|
| **contemplative** — "sit with this", essayistic | 60–76 | 30–24 | one reveal per 2 bars (8 beats) | pulse at or below resting HR reads as settled |
| **confident / explanatory** — the default for a 60 s explainer | 90–110 | 20–16 | one reveal per bar; stagger on 8ths | just above resting HR: forward without pressure |
| **playful** | 112–128 | 16–14 | one reveal every 2 beats | dance-adjacent, light |
| **urgent** | 132–150 | 13.6–12 | cut on the beat through the build | above walking cadence; the body reads hurry |
| **ominous** | 60–75 felt half-time (accent every 2nd beat), *or* 138–150 with one hit per bar | 30–24 | reveal on the downbeat, then hold | slow pulse + long decay = dread; density is the enemy |

**Half-time and double-time are how you change pace without changing tempo.** Keep 100 BPM for the
whole video; cut on the half-bar in the setup, on the beat in the build, on the 8th through the
payoff stagger. One tempo, three pacings. This is the single most useful thing on this page for a
60-second piece, because a tempo change inside 60 s almost always reads as a mistake.

### 1.3 "Landing on the beat" — the precise definition

A move has three timestamps, not one:

- `t0` — onset (first keyframe)
- `tv` — peak velocity
- `t1 = t0 + d` — arrival (last keyframe)

`tv` depends on the easing, and bay knows the easing:

| easing family | `tv` |
|---|---|
| `expo-out`, `power4-out`, `power-out`, `ease-out`, `spring-out` | ≈ `t0 + 0.08 d` |
| `sine-in-out`, `ease-in-out`, `quad-in-out` | `t0 + 0.50 d` |
| `ease-in`, `power-in` | ≈ `t1` |
| `linear` | undefined — constant velocity has no accent, which is why linear entrances feel dead |

**Which timestamp goes on the beat depends on the length of the move:**

| move length `d` | beat-lock | rationale |
|---|---|---|
| ≤ 4 frames | `t0` | it is a pop; onset and arrival are perceptually the same instant |
| 5–7 frames | `tv` | short enough that arrival is anticipated from the accent |
| ≥ 8 frames | **`t1` (arrival)** | the eye reads *where it stopped*, not where it started |

So the canonical case — a 12-frame `power4-out` entrance that must **arrive** on beat *b* — starts
at `b − 12 frames`. This is the rule round 1 wrote as "an entrance of duration `d` landing on beat
`b` starts at `b − d`", and it is right, but it is only right for `d ≥ 8` frames, and `wicks-v2`
has 76 moves at `d = 3`.

**The reading floor outranks the grid.** A line of sequential text needs ≈ 1.1 s on screen before
the next one. At 128 BPM that is 2.35 beats — so snap to every 3rd beat, not every beat. Never
compress a reveal to fit a grid; move it to the next beat.

**Do not beat-snap everything.** Target: 60–80 % of scene-level reveals within 1 frame of a beat.
100 % reads mechanical, which is its own kind of AI-slop.

---

## 2. Musical structure as video structure

### 2.1 The 60-second beat sheet at 100 BPM (bar = 2.4 s, 25 bars)

| bars | seconds | section | picture | score |
|---|---|---|---|---|
| 1–2 | 0.0–4.8 | **cold open / hook** | the biggest type in the video; the claim | one impact on bar 1 beat 1, then bed alone. **No pulse yet** — you cannot drop something that never started |
| 3–8 | 4.8–19.2 | **build A** | the problem; 3 reveals, one per bar | pulse enters bar 3; add one layer every 2 bars |
| 9–14 | 19.2–33.6 | **build B** | the mechanism; densest section | full bed; SFX density peaks; short-term loudness climbs ~3 LU across the section |
| 15 | 33.6–36.0 | **the break** | the thing about to be revealed is set up and static | **drop out**: bed −20 dB over 1 beat, then 0.6–1.2 s of air |
| 16–20 | 36.0–48.0 | **drop / payoff** | the hero frame, the number, the answer | bed returns **6 dB above** its build-B level; one impact on the downbeat; this is the loudest moment in the video |
| 21–23 | 48.0–55.2 | **resolve** | the consequence; calmer, one idea | remove one layer per bar |
| 24–25 | 55.2–60.0 | **outro / CTA** | end card | bed only; fade over the final bar; **one** chime, at the top of bar 24 |

Two invariants, both measurable:

1. **The loudest 400 ms window in the video must be inside the payoff section.** In `wicks-v2` it
   is at 48.0 s under a transition sub-drop. That single number distinguishes a score from a
   sound-effects lane.
2. **Short-term loudness in the payoff ≥ 4 LU above the mean of the build, and ≥ 12 LU above the
   break.** `wicks-v2`'s entire arc is 1.8 LU.

### 2.2 Silence, quantified

"Silence" means **≥ 18 LU below the preceding 3 s short-term**, not digital zero. Absolute zero is
a mute and sounds like a fault; a room-tone floor at −42 to −48 dBFS is a rest.

| duration | reads as | use |
|---|---|---|
| < 200 ms | a mix artifact / a click | never |
| 300–500 ms | a comma | before a single word or a number appearing |
| **600–1200 ms** | **the held breath** | **exactly one per 60-second video, immediately before the payoff** |
| 1500–2500 ms | a section break | only if the picture is carrying something |
| > 2500 ms | the audio broke | never, except as a deliberate ending |

The mechanism: loudness is judged relatively over ~3 s. A payoff that is 6 dB above its
surroundings reads as 6 dB. The same payoff preceded by 0.9 s at −20 dB reads as roughly 26 dB —
you buy 20 dB of impact for free, and you buy it *without* raising the ceiling, which is the only
way to get contrast while still delivering at −14 LUFS integrated.

`wicks-v2` has zero windows below −30 dBFS in 61 seconds. It spent its entire dynamic budget on
being continuously present.

---

## 3. Key, mode and harmony — a decision rule

An agent picking a bed needs one question answered: **what is this video claiming?**

| the video's claim | mode | the thing that carries it | drone / vamp on root A |
|---|---|---|---|
| "here is how it works" — neutral, confident | **Mixolydian** (major, ♭7) | major 3rd settles; no leading tone means no drama | A – G – D (`I – ♭VII – IV`) |
| "here is a fact, full stop" | **Ionian** (major) | | A – D – E |
| "this is a problem / a loss / a risk" | **Aeolian** (natural minor) | ♭3 and ♭6 | Am – F – G (`i – ♭VI – ♭VII`) |
| "this is a mystery you can solve" | **Dorian** (minor, natural 6) | minor without self-pity; the ♮6 is the hope | Am – D (`i – IV`) |
| "something is wrong / unstable" | **Phrygian** fragments, or a tritone | ♭2 is the alarm interval | Am – B♭ (`i – ♭II`) |
| "this is bigger than you thought" | **Lydian** (♯4) | the ♯4 lifts | A – B (`I – II`) |
| **no emotional claim — pure information** | **no third at all** | power chords / quartal / sus | A5, Asus2, Asus4 |

**The fallback is the last row.** Omitting the third refuses to say happy or sad, which is usually
what a technical explainer wants. `wicks-v2`'s section A is exactly this, and it was the right
call — the failure was that nothing ever moved.

### 3.1 Tension and release for a synthesised bed

Practical, and all three are two-oscillator edits:

| gesture | do | undo | effect |
|---|---|---|---|
| **suspension** | replace the 3rd with the 4th (A-D-E instead of A-C♯-E) | drop the 4th to the 3rd on the reveal frame | the cheapest payoff in music: one voice moving one whole step |
| **added 2nd** | add the 9th (B over A) | remove it | unresolved, modern, non-committal |
| **semitone rub** | add ♭2 (B♭ over A) | remove it on the cut | dread; use for ≤ 4 s or it becomes noise |
| **register lift** | add the octave above the root | remove | "more", without more loudness |

The **sus4 → 3 resolution timed to the payoff frame** is the highest-value single move available:
it is one frequency change, it is audible on a phone speaker, and it makes a reveal feel *earned*
rather than merely loud.

### 3.2 Harmony must change where the video changes

A chord change is a scene transition the ear can hear. **Every scene boundary should coincide with
a bar line, and at least half should coincide with a chord change.** `wicks-v2`: 1 of 5, by
accident. A 4-second crossfade between drones is not a chord change — it is a dissolve, and the
ear reads it as a wash. Change harmony on the downbeat, in ≤ 1 beat.

---

## 4. Sound design — the functional layer

### 4.1 The palette, with anchors and levels

Levels are **dB relative to the narration's peak** (the only stable reference; absolute values
move with the normalisation preset). "Anchor" is the point of the sound that must be aligned.

| sound | when it is right | length rule | peak, dB rel. voice | anchor (fraction of its own length) |
|---|---|---|---:|---|
| **whoosh** | a move that *travels* ≥ 8 % of frame width/height | 1.6–2.5 × the move; never shorter than 0.25 s | −12 … −16 | 0.39 → on the move's `tv` |
| **whoosh-reverse** | *into* a cut or a landing | ends on the landing frame | −12 … −16 | 0.98 → on `t1` |
| **riser** | a build of ≥ 1.5 s into a reveal | 1.5–3.0 s, **ends** at the reveal | −34 → −10 | 0.93 → on the reveal frame |
| **impact** | the one hero landing of a scene | 0.5–0.9 s | **−4 … −7** — the loudest non-voice event in the video | 0.02 → on the landing |
| **sub-drop** | a register shift; ≤ 2 per video | 0.7–1.2 s | −8 … −12, but its energy is < 80 Hz and will not read as loudness on a phone | 0.05 |
| **tick** | a run of ≥ 3 — counter, list, ladder | 0.03–0.06 s | −24 … −30 | 0.11 |
| **click** | a discrete state change | 0.04–0.08 s | −20 … −26 | 0.08 |
| **pop** | a small object arriving | 0.12–0.20 s | −16 … −22 | 0.03 |
| **chime** | the resolution. **Exactly one per video** | 0.8–1.4 s | −8 … −12 | 0.01 |
| **swell** | tension under 2–6 s of setup | 2–6 s, ends at the break | −22 → −14 | ends at the break |
| **room tone / air** | under everything, the whole runtime | full duration | −38 … −45 | n/a — this is what makes a rest a rest instead of a mute |

Two entries bay does not have and needs: **room tone** (§7) and a **note**/tonal stab pitched to the
bed's root, which is how a UI sound stops sounding like a UI sound.

### 4.2 Why 11 whooshes and 11 ticks still feel cheap — six mechanisms, all measured

1. **Every instance of a family is the same waveform.** One file, 11 placements, ≤ 3.3 dB of gain
   variation. The ear identifies a repeated sample in about three hearings, and after that every
   occurrence reads as the same button being pressed. The fix is not "more sounds" — it is
   varying `tone`, length and level per placement, which `sfx_add` does per call and a reused
   file cannot.
2. **Every family lands at the same peak.** Net peak after placement gain: sub-drop −13.9, whoosh
   −13.6, riser −14.8, impact −12.7, chime −14.4, pop −15.3, click −18.3, tick −19.5 dBFS. The
   nine families span **2.6 dB** in the six that matter. **Nothing is an accent because everything
   is the same loudness.** In a real mix the impact under the hero reveal sits 12–15 dB above the
   ticks.
3. **The sounds describe gestures the picture does not make.** 28 of 50 are attached to an opacity
   change. A whoosh is Doppler — it needs travel. Under a crossfade it is a sound with nothing to
   attach to, and the brain files it as decoration.
4. **The lengths are wrong by factors, not by frames.** riser 13.0 × the move; whoosh 2.0 ×; tick
   0.1 ×. A 0.55 s whoosh over a 0.10 s pop is a sound describing a gesture 5.5 × longer than the
   one on screen.
5. **The accents are late.** whoosh +4.0 frames, riser +32.7 frames (§0.5). ITU-R BT.1359-1 puts
   the *detectability* threshold for audio lagging picture at 125 ms; the whooshes are at 134 ms
   and the risers at 1089 ms. This is not a matter of taste — it is measurably out of sync by a
   broadcast standard.
6. **The density never varies.** Median inter-onset 0.96 s across the full runtime. Sound placed
   to satisfy "a sound under every move" produces a constant drizzle, and a constant drizzle has
   no foreground.

The unifying diagnosis: **the sound was placed against a checklist of moves rather than against a
structure.** 50 sounds, 245 move segments, no hierarchy, no rests, one waveform per family. The
count was the target and the count was hit.

### 4.3 Frequency separation

When sounds overlap, put them in different bands or they mask each other:

| band | occupant |
|---|---|
| 20–80 Hz | sub-drop, impact body |
| 80–250 Hz | bed root and fifth |
| 250 Hz–2 kHz | **narration — keep everything else out of here** |
| 2–6 kHz | whoosh body, riser, pop |
| 6–16 kHz | tick, click, whoosh air |

The one rule worth encoding: **nothing but the voice may have its energy centroid between 300 Hz
and 3 kHz while the voice is speaking.** That is what "muddy" means, mechanically.

---

## 5. The mix

### 5.1 Levels, relative to the narration's peak

| element | rel. voice peak | note |
|---|---:|---|
| narration | **0 dB** (reference) | `narrate` normalises each utterance to `peakDb −2.0`; place at `volume 1.0`, not 1.15 |
| bed **under** voice | **−18 … −22 dB** | this is the number that matters, and it is not the duck depth |
| bed in a gap | −8 … −12 dB | |
| bed at the payoff | −6 dB | the only place it exceeds the gaps |
| impact / hero hit | −4 … −7 dB | |
| chime | −8 … −12 dB | |
| whoosh / transition | −12 … −16 dB | |
| pop | −16 … −22 dB | |
| click | −20 … −26 dB | |
| tick | −24 … −30 dB | |
| room tone | −38 … −45 dB | |

**Duck depth ≠ separation.** `wicks-v2` has a duck depth of 9.1 dB (bed 2.0 → 0.7) and a
voice-to-ducked-bed separation of ≈ 7.9 dB. The agent tuned the depth; the check nominally
measures the separation; neither ended up in range. Constrain both:

| quantity | target | failure mode outside it |
|---|---|---|
| duck depth (bed open → bed ducked) | **8–14 dB** | < 8: the duck is inaudible. > 16: the bed pumps and the gaps shout |
| voice-to-ducked-bed separation | **12–18 dB** | < 10: "the music drowns the narrator". > 22: the bed is decorative and might as well not be there |
| bed level in gaps vs. bed level under voice | gaps louder by the duck depth, **but gap RMS must not exceed speech RMS** | `wicks-v2`: gaps are 1.1 dB *louder* than the speech |

### 5.2 Ducking envelope

| parameter | value | why |
|---|---|---|
| **pre-roll** | duck starts **150–250 ms before** the first word | the ear needs the bed already down when the syllable arrives; ducking *on* the word masks it |
| attack | 80–150 ms | fast enough to be complete before the second syllable |
| hold | to the last word | |
| release | **400–700 ms**, starting 150 ms after the last word | shorter pumps between sentences; longer and the gap never opens |
| curve | `ease-out` down, `ease-in-out` up | a linear duck is audible as a ramp |

Between two lines less than 700 ms apart, **do not release** — one duck spanning both is correct;
releasing and re-ducking is the pumping people hear as "amateur".

### 5.3 LRA — and why it must not be a target

| video | integrated | LRA |
|---|---:|---:|
| R1 (reference: music + SFX, no narration) | −14.0 LUFS | **6.7 LU** |
| R2 (reference: narration-forward, no bed) | −14.1 LUFS | **2.3 LU** |
| ours: candlestick-wick-volatility | −16.5 | 3.4 |
| ours: local-first | −25.3 | 3.1 |
| ours: candlestick-wicks | −27.5 | 3.5 |
| **wicks-v2** | **−13.9** | **3.5** |

A reference video sits at LRA 2.3. **"LRA 3.5 is bad" is not a defensible claim, and prescribing an
LRA target is the exact mistake round 1 made with LUFS.** An agent told "raise LRA above 6" will
insert a hole of silence at 30 s and pass. LRA is a *symptom*; the disease is that the mix has no
hierarchy.

Measure the disease directly instead:

| metric | target | why it is not gameable |
|---|---|---|
| **peak-window location** — time of the loudest 400 ms window | inside the payoff section, within 1.5 s of the `payoff` marker | requires *naming* the payoff and then actually making it loudest |
| **rest before payoff** — max drop of momentary vs. preceding 3 s short-term, in `[payoff−1.6 s, payoff−0.25 s]` | ≥ 15 LU for ≥ 0.35 s | tied to a named position, so a random hole elsewhere does not satisfy it |
| **speech-window RMS ≥ gap-window RMS** | speech ≥ gaps + 1 dB | forbids the specific inversion `wicks-v2` has |
| **section contrast** — mean short-term of the loudest 8 s vs. the quietest 8 s | ≥ 6 LU | a hole raises this too, but combined with the rest-position rule, the hole has to be *the* rest |

All four are computable from a single `ebur128` pass on the encoded file, and three of the four
are also computable from the project model plus the media's measured levels.

### 5.4 Getting contrast while hitting −14 LUFS

Integrated loudness is gated (−10 LU relative gate) and heavily weighted toward the loud parts.
A 0.9 s rest costs about **0.07 LU** of integrated loudness on a 60 s programme. A payoff 6 dB
above the body costs nothing if the body sits 2 dB lower. The two are not in tension. What *is* in
tension with −14 LUFS is a mix that is 40 % true silence — which is the previous generation's
failure, not this one's.

---

## 6. Audio-visual sync

### 6.1 The perceptual window

| standard / finding | number |
|---|---|
| ITU-R BT.1359-1, **threshold of detectability** | audio **+45 ms ahead** to **−125 ms behind** picture |
| ITU-R BT.1359-1, **threshold of acceptability** | audio +90 ms ahead to −185 ms behind |
| auditory vs. visual simple reaction time | 236.6 ms vs. 287.7 ms → **≈ 51 ms auditory advantage** |

The asymmetry is the important part: **we tolerate audio arriving late far better than early**,
because in the physical world sound always arrives late. This cuts against the folk rule
"pre-cue everything by 2–4 frames". Round 1's "0.07–0.10 s" (70–100 ms of audio lead) is *past*
BT.1359's detectability threshold for lead.

The reconciliation, and the correct rule:

> **The pre-cue is not about leading the picture. It is about aligning the sound's energy peak
> with the picture's perceptual accent — which is at the move's peak velocity, not at its first
> frame.**

A sound whose energy peak is at its start (impact, click, tick, pop, chime) placed 2 frames before
the move's `t0` puts its accent 2 frames early — near the edge of detectability, which is what
gives motion graphics their snap. A sound whose energy peak is 39 % of the way in (whoosh) placed
the same way puts its accent **4 frames late**, and a riser placed the same way puts its accent
**33 frames late**. Same rule, opposite results, because the rule was stated on the wrong anchor.

### 6.2 The rule

```
accent_time(sfx)  = sfx.start + t_peak(sfx)
accent_time(move) = t0 + tv_fraction(easing) * d          # §1.3
offset            = accent_time(sfx) − accent_time(move)
require  −0.045 s ≤ offset ≤ +0.020 s                     # ≈ −1.35 … +0.6 frames @30
```

For `whoosh-reverse` and `riser`, the accent aligns to the move's **arrival** `t1`, not `tv`.

### 6.3 What a hit is, and how to build one

A **hit** is three things arriving inside one frame:

1. a picture event with a **velocity discontinuity** — a stop, a direction change, a scale snap
   (not an opacity change: opacity has no velocity the eye can see),
2. a broadband transient in the sound (impact, or whoosh + impact layered),
3. a **level step** in the bed — 3–6 dB, on the same frame.

Two of three reads as a sound effect. Three of three reads as a hit. `wicks-v2` has zero, because
(3) never happens: the bed's level changes only at narration boundaries.

**A move without a sound feels weightless** because the visual system's estimate of mass comes
largely from the impact sound — a 400 px card that lands silently has no inertia, and the eye
reads it as a slide instead of a landing.

**A sound without a move feels arbitrary** because there is nothing for it to be *about*. This is
what 28 whooshes-over-opacity produce: sound the viewer cannot attribute, which the brain
categorises as background and stops crediting to the picture. The check therefore has to run in
both directions: every accent sound needs a qualifying visual event, and every qualifying visual
event needs (or deliberately declines) a sound.

**Qualifying visual event** — measurable from the model, and the definition matters more than the
rule:

| event | test |
|---|---|
| travel | Δ`x` or Δ`y` ≥ 0.08 of the canvas |
| scale snap | Δ`scale`/`scaleX`/`scaleY` ≥ 0.25, over ≤ 8 frames |
| arrival | a move of ≥ 8 frames reaching its final value |
| cut | two elements' visibility swapping within 2 frames |
| **not** an event | any pure `opacity` change |

That last row is the whole point: it makes "sound under every move" impossible to satisfy with a
fade machine.

---

## 7. What bay must be able to do

### 7.1 Already possible today (source tree, not the stale binary)

| capability | where |
|---|---|
| synthesise 13 effects at any length, deterministic, normalised to a requested peak | `bay-audio/src/sfx.rs`, `sfx_add` |
| index and place recorded packs | `bay-audio/src/library.rs`, `sfx_search` / `sound_add` |
| per-clip gain envelopes sampled by both mixers | `Element::gain_points`, `bay-audio::GainEnvelope`, `bay-preview/src/lib.rs:1972–1997` |
| keyframed `volume` with per-key easing → real ducking on one clip | `animate { property: "volume" }` |
| fades at both ends | `fade_set` |
| slip a bed's in-point to land the drop | `element_source`, `trimStart` |
| markers | `marker_add` |
| loudness normalisation on export | `loudnorm=I=…:TP=-1.5:LRA=11` |
| waveform peaks via ffmpeg at 8 kHz mono | `bay_audio::waveform_peaks` |

**Everything needed for a correct duck already exists and was not used**, because a 13-clip split
silenced the check and a keyframed duck would not have.

### 7.2 Gaps, ranked by quality-per-unit-work

| # | capability | size | what it unlocks |
|---|---|---|---|
| 1 | **Ship the tools that exist.** The running server advertised 51 tools; `sfx_add`, `sfx_list`, `sfx_search`, `sound_add` were absent. Add a version/tool-set handshake so the skill can assert what it needs at session start | trivial | the entire §4 palette; removes the hand-rolled-WAV failure mode outright |
| 2 | **`music_bed`** — synthesise a tempo'd, sectioned bed and **return its grid**: `{ bpm, bars, root, mode, sections:[{bars, energy}] } → { mediaId, beatSeconds[], barSeconds[], sectionSeconds[] }` | medium | **this is the big one.** Because bay *generates* the music, the beat grid is exact, not estimated. Every rule in §1 and §2 becomes computable. It is the same machinery as `sfx.rs`: sine stacks + filtered-noise pulse + envelopes, plus a chord list and bar-quantised changes. No new dependency, no DSP |
| 3 | **`duck { bedId, underIds[], depthDb, attackMs, releaseMs, preRollMs }`** — writes the volume keyframes | small | makes the correct duck cheaper than the 13-clip hack, which is the only reliable way to stop the hack |
| 4 | **`t_peak` on every sound.** Analytic for synthesised (a constant per effect id — §0.3); one envelope pass for imported. Return it from `sfx_add` / `media_import` as `accentSeconds` | small | §6.2 becomes checkable. Without it the sync rule cannot be enforced for imported audio |
| 5 | **`audio_probe { mediaId } → { peakDb, rmsDb, lufs, accentSeconds }`** | small | fixes `flat-mix`'s second bug: it currently compares gains, not loudness |
| 6 | **Room tone / air** as a 14th synthesised effect (filtered noise at −42 dB, loopable) | trivial | a rest becomes a rest instead of a mute; §2.2 becomes usable |
| 7 | **`music_analyze { mediaId } → { bpm, beatSeconds[], downbeatSeconds[], sections[] }`** | medium | only needed for *imported* music. See below |
| 8 | Sidechain compression in the export graph (`sidechaincompress`) as an alternative to keyframes | small | ffmpeg already has the filter; the graph is built in `lib.rs:1436–1470` |

### 7.3 Is `music_analyze` feasible? Yes — medium.

| stage | method | size | risk |
|---|---|---|---|
| decode | reuse `waveform_peaks`' ffmpeg path at 8 kHz mono; 60 s = 480 k samples | already exists | none |
| STFT | radix-2 FFT, 1024 window / 256 hop → 1 875 frames | ~70 lines hand-rolled, in keeping with bay writing its own WAV encoder and noise generator | none |
| onset envelope | half-wave-rectified spectral flux, per-band | ~40 lines | none |
| tempo | autocorrelation of the flux over lags 60–180 BPM; pick max; resolve octave errors by preferring 90–150 | ~50 lines | octave ambiguity — the classic 70 vs 140 BPM error. Mitigate by returning a confidence and the two candidates |
| phase / beat times | cross-correlate a pulse train at the chosen period | ~30 lines | none |
| downbeat | of the 4 candidate phases, pick the one whose beats carry the most sub-200 Hz energy | ~30 lines | moderate — wrong on music without a kick |
| sections | self-similarity matrix over band energies → novelty curve → peak-pick | ~150 lines | **this is the only hard part.** Ship it returning `[]` when confidence is low rather than guessing |

Runtime: milliseconds on a 60 s file. **Verdict: feasible, no new dependency, and worth building —
but it is item 7, not item 1**, because bay has no music to analyse. `music_bed` (item 2) delivers
an *exact* grid for less work than `music_analyze` delivers an estimated one.

### 7.4 The check codes this area implies

| code | fires when | source |
|---|---|---|
| `no-tempo` | a project has ≥ 2 scenes and no BPM on the bed (no `music_bed` grid, no `music_analyze` result, no beat markers) | model |
| `off-grid` | < 50 % of scene-level reveals land within 1 frame of a beat, given a grid | model |
| `accent-late` | any sound's `start + accentSeconds` is more than 45 ms before or 20 ms after its move's accent | model, needs 7.2 #4 |
| `sound-without-move` | an accent sound (whoosh/impact/riser/sub-drop) whose nearest qualifying visual event (§6.3) is > 150 ms away, or is an opacity-only change | model |
| `move-without-sound` | a qualifying visual event with no sound within 150 ms — **note only**, never a warning | model |
| `same-sound` | ≥ 3 placements of one `mediaId` whose (`duration`, `volume`) differ by < 10 % and < 3 dB | model |
| `flat-hierarchy` | the loudest and quietest of the video's SFX families are < 8 dB apart at placement level | model + 7.2 #5 |
| `no-rest` | no window of ≥ 0.35 s anywhere at ≥ 15 LU below the preceding 3 s short-term | render |
| `rest-misplaced` | a rest exists but not within `[payoff−1.6 s, payoff−0.25 s]` of the `payoff` marker | render + model |
| `peak-not-payoff` | the loudest 400 ms window is > 1.5 s from the `payoff` marker | render |
| `gaps-louder-than-speech` | mean RMS of no-narration windows ≥ mean RMS of narration windows | render |
| **fix** `flat-mix` | skip samples where either gain is 0 **only when the zero comes from a fade at the window edge**; clamp the sample range to `[start + max(fadeIn), end − max(fadeOut)]`; and compare **measured loudness × gain**, not gain | `check.rs:1059–1069` |

---

## 8. The rules, consolidated

Every row states the constraint, how bay verifies it, and how an agent would cheat it. Rows whose
"gameable" column reads *"the cheat is the correct behaviour"* are the ones worth shipping.

| # | rule | check | how an agent games it | why that is (or is not) survivable |
|---|---|---|---|---|
| 1 | The project declares a **BPM** and a beat grid before any element is placed | `no-tempo` | pick 120 and ignore it | rules 2–4 depend on the grid, so ignoring it fails them |
| 2 | 50–80 % of scene-level reveals land within 1 frame of a beat; **not more than 80 %** | `off-grid` (both bounds) | snap everything | the upper bound forbids it; and the reading floor (1.1 s/line) forces off-grid holds |
| 3 | The **arrival** of a ≥ 8-frame move goes on the beat; the **onset** of a ≤ 4-frame move goes on the beat | `off-grid` | make every move 3 frames so only onsets matter | 3-frame moves are already caught by the motion rules; and rule 8 forbids a whoosh over one |
| 4 | Exactly one **rest** of 0.6–1.2 s at ≥ 15 LU down, positioned 0.25–1.6 s before a `payoff` marker | `no-rest`, `rest-misplaced` | insert a hole somewhere | it must be *positioned* relative to a marker the agent had to place; and rule 5 requires the loudest moment right after it |
| 5 | The loudest 400 ms window is within 1.5 s of the `payoff` marker | `peak-not-payoff` | put an impact at the marker | **the cheat is the correct behaviour** |
| 6 | Narration windows are ≥ 1 dB louder in RMS than no-narration windows | `gaps-louder-than-speech` | turn the bed down everywhere | that is also correct; and rule 7 stops it going too far |
| 7 | Voice-to-ducked-bed separation 12–18 dB; duck depth 8–14 dB; duck begins 150–250 ms before the first word | fixed `flat-mix`, measured on loudness not gain | split the bed into clips at word boundaries | the fixed check clamps the sample window inside the fades, so the split no longer suppresses it |
| 8 | An accent sound requires a **qualifying visual event** (§6.3), and opacity is not one | `sound-without-move` | animate `x` by 0.001 to qualify | the threshold is Δ ≥ 0.08 of the canvas — satisfying it *is* making a real move |
| 9 | `sfx.accentSeconds` lands −45 … +20 ms from the move's accent | `accent-late` | shorten every sound to a click so its accent is its start | clicks at −20 dB cannot be the loudest thing (rule 5), and rule 10 forbids a run of identical ones |
| 10 | ≥ 3 placements of one sound must vary by ≥ 10 % in length **or** ≥ 3 dB in level **or** ≥ 0.15 in `tone` | `same-sound` | jitter the numbers randomly | jitter is indistinguishable from intent here, and harmless — this rule only has to stop *exact* repetition |
| 11 | The SFX families' placement peaks span ≥ 8 dB (an impact is not a tick) | `flat-hierarchy` | make one sound very quiet | a sound below −30 dB rel. voice is inaudible and fails rule 8's pairing usefully — accept it |
| 12 | Nothing but the voice has its spectral centroid in 300 Hz–3 kHz while the voice speaks | needs a probe; defer | — | — |
| 13 | Scene boundaries fall on bar lines; ≥ 50 % coincide with a harmonic change | `music_bed` returns `sectionSeconds[]`; compare to scene starts | make one long scene | **this is exactly what `wicks-v2` did** — one 61 s scene. Pair with a hard cap on scene length (see the structure file) |
| 14 | **Do not target LRA.** Do not target integrated loudness beyond −14 ± 1 LUFS | — | — | round 1 targeted LUFS and got a flat mix at exactly −13.9; a reference video has LRA 2.3 |

---

## Sources

- [Rec. ITU-R BT.1359-1, *Relative timing of sound and vision for broadcasting*](https://www.semanticscholar.org/paper/Rec.-ITU-R-BT.1359-1-1-RECOMMENDATION-ITU-R-TIMING/0ee98071da172de6e1d6d1fcd560bad9e0a87d5e) — detectability +45 / −125 ms, acceptability +90 / −185 ms
- [Audio-to-video synchronization — Wikipedia](https://en.wikipedia.org/wiki/Audio_sync)
- [EBU TECH 3342, *Loudness Range: a measure to supplement EBU R 128*](https://tech.ebu.ch/docs/tech/tech3342.pdf) and [TECH 3343, *Guidelines for production in accordance with EBU R 128*](https://tech.ebu.ch/docs/tech/tech3343.pdf)
- [Auphonic — loudness targets for mobile audio, podcasts, radio and TV](https://auphonic.com/blog/2013/01/07/loudness-targets-mobile-audio-podcasts-radio-tv/)
- [*Music tempo modulates emotional states as revealed through EEG*, Scientific Reports 2025](https://www.nature.com/articles/s41598-025-92679-1)
- [*Influence of Tempo and Rhythmic Unit in Musical Emotion Regulation*, Frontiers in Computational Neuroscience](https://www.frontiersin.org/journals/computational-neuroscience/articles/10.3389/fncom.2016.00080/full)
- [*Auditory Information Accelerates the Visuomotor Reaction Speed of Elite Badminton Players*, Frontiers in Human Neuroscience 2021](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2021.779343/full) — auditory 236.6 ms vs visual 287.7 ms simple RT
- [*Bimodal Presentation Speeds up Auditory Processing and Slows Down Visual Processing*, Frontiers in Psychology 2018](https://www.frontiersin.org/articles/10.3389/fpsyg.2018.02454/full)
- Repo: `rust/crates/bay-audio/src/{sfx,library,lib}.rs`, `rust/crates/bay-core/src/check.rs:986–1140`,
  `rust/crates/bay-project/src/element.rs:796–1105`, `rust/crates/bay-preview/src/lib.rs:1436–1470`,
  `rust/crates/bay-mcp/src/{tools.rs:630–681,studio.rs:830–995}`
- Measured: `~/Desktop/wicks-v2.mp4`, `project-1786466680050.json`, session `1ba87d60-…jsonl`,
  `…/1ba87d60-…/scratchpad/audio/*.wav`
