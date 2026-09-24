> **Historical:** describes the Rust engine, deleted; recover what it cites with `git show rust-engine-final:dep/rust/<path>` (e.g. `crates/bay-mcp/src/tools.rs`).

# The mix, and the mechanism

Audio doctrine for `bay`, round 2. Scope: **why bay's audio is bad for structural rather than
musical reasons.** Music theory and general sound design are a parallel agent's job.

Everything numeric below is measured, from `project-1786466680050.json`, `wicks-v2.mp4`, the
source WAVs, or the repository. Where a measurement contradicts the brief's working hypothesis I
say so and give the number.

---

## Field update — what changed after this was written

`shoot-b` shot Brief B against a binary that had moved, and challenged two findings. Both
challenges were right. Re-verified against the current tree:

**1. The 6-eased-keyframe export ceiling (§3.1) is FIXED — the finding is now historical.**
`decimate_gain_points()` + `MAX_GAIN_EXPRESSION_POINTS = 90` landed in
`bay-preview/src/lib.rs:2012`, with adaptive tolerance doubling and a stride fallback. That is
recommendation §3.1 implemented, and its doc comment cites the 97/98 bisection from this
document. `shoot-b` exported a **21-key duck across 5 windows** with `ease-in-out` / `sine-in-out`
/ `hold`, measured 16.0 dB depth against 16.0 asked, asymmetric attack/release intact. **Keep
§3.1 for the record of why beds got chopped up; do not act on it.** Also landed: the `elementId`
bug (§4.2), `role` on `AudioElement` (§8 #3), the `duck` tool (§3.2), and the `speech-masked` /
`bed-too-quiet` findings (§7 E).

**2. §0.3's mechanism was wrong, and so was the workaround.** The delivered file is **AAC 96 kHz
mono**, not 24 kHz, and placing a 48 kHz stereo bed at `start: 0.0` does not fix it. Isolated:

| filtergraph | delivered |
|---|---|
| bed(48k st) first + narration, amix **+ loudnorm** → aac | 96 000 Hz, **2 ch** |
| same order, amix **without** loudnorm → aac | **48 000 Hz**, 2 ch |
| narration(24k mono) first + bed, amix + loudnorm → aac | 96 000 Hz, **1 ch** |
| bed **only** (48k stereo) + loudnorm → aac | **96 000 Hz**, 2 ch |

Two independent faults, not one:

- **Sample rate is entirely `loudnorm`'s doing.** Its dynamic (one-pass) mode outputs at
  **192 kHz**; the native AAC encoder cannot take that, so ffmpeg auto-resamples to the
  encoder's maximum, **96 kHz**. It happens with a single stereo input and no `amix` at all.
  Every export with loudness enabled ships 96 kHz — spending bitrate on an empty 24–48 kHz band.
- **Channel count is `amix` inheriting input 1**, where input 1 is the first element in the
  track's `elements` array — **insertion order, not timeline position.** In `shoot-b`'s project
  the bed sits at `start: 0.0` but at **array index 33 of 34**, because it was added last. Input
  1 is a mono Kokoro clip, so the mix is mono.

The fix is unchanged and now covers both: `aformat=sample_rates=48000:channel_layouts=stereo`
per input, plus `-ar 48000 -ac 2` on the output. The "put the bed first" workaround I gave
`shoot-b` was wrong — it would need to be *inserted* first, which is not something an author
should have to know.

*(Unresolved: `wicks-v2.mp4` is 24 kHz, which this mechanism does not explain — it predates
today's changes and I have not reproduced it. The channel half of §0.3 stands; treat its rate
claim as superseded by the table above.)*

**4. `bed-too-quiet`'s threshold is right; its statistic is biased low, and it actively makes
videos worse.** This is the highest-priority item in this document.

`gap_bed_lufs` (`bay-project/src/mix.rs`) is the **median of the bed across every non-speaking
hop**. Where gaps are short relative to the duck's ramps, most non-speaking hops are *transition*
rather than steady state, so the median reads the ramp instead of the bed. The error scales with
how tight the gaps are, and it always runs one way — it under-reports the bed, so authors turn
the bed up to clear it.

Measured on two projects:

| | gaps | release | `gapBedLufs` | true plateau | **under-report** |
|---|---|---|---|---|---|
| `shoot-b` | ~1.1 s | 330 ms | −15.3 | −12.6 | **2.7 dB** |
| `shoot-c` | **0.35–0.60 s** | 520 ms | **−32.4** | **−21.1** | **11.3 dB** |

At `shoot-c`'s gap lengths *no* hop is steady state, so the median is reading pure ramp. An
11.3 dB under-report is larger than the entire usable range of the control.

**What it cost.** `shoot-c` chased the warning to `volume 3.0` (and the check wanted 3.6). Going
back down to **1.9** — the value my corrected formula gives, landing the plateau at −21.1, inside
the §1.2 target — improved *every* measured axis at once:

| | vol 3.0 | vol 1.9 |
|---|---|---|
| LRA | 3.70 | **3.90** |
| separation | 8.1 LU | **9.5 LU** |
| silence detected at −34 dB | 1 stretch, 0.61 s | **5 stretches, longest 1.178 s** |
| `check` warnings | 16 | **6** |

The pre-payoff rest went 0.612 s → 1.178 s. **The check was filling in an authored rest and
costing 10 warnings elsewhere to do it.** `shoot-b`, following the same warning, shipped a bed
plateau 1.4 LU *above* programme level.

**Fix: use a high percentile (p90) of the bed over gap hops rather than the median, and report
the plateau** so an author can see the number they are actually setting. The −26 LUFS floor is
well-argued and should stay — it is only ever compared against the wrong statistic.

**A second, independent bias in the same number, pointing the other way.** `mix.rs` models a
clip's level as `file_lufs + 20·log10(gain)` — a **constant** file level times the keyframe gain.
Amplitude shaped into the *file* is therefore invisible: `shoot-c` arranged two smooth drop-outs
into the bed so the music stops under their rests, and `check` scored those stretches as though
the bed were playing at full level. So one statistic is simultaneously **pessimistic about the
plateau and optimistic about bed presence**. `silencedetect` on the encoded file was the only
thing that told the truth. Any check reasoning about beds needs a per-hop measurement of the
file, not a single integrated number.

**Corollary for the level formula:** where a bed has shaped silence in it, the file's *integrated*
level understates its plateau — `shoot-c`'s bed measures −32.35 whole-file but −31.48 across its
body. Measure the body.

Related, and my error rather than bay's: the level formula I gave both shoots sets a *ratio*
(bed N LU under the narration file) where the check sets an *absolute floor on the delivered
scale*. The term connecting them is the export lift, which I omitted:
`delivered_bed_plateau = bed_file_LUFS + 20·log10(volume) + (−14 − authored_LUFS)`. The lift
depends on speech coverage — +12.1 dB on a 76 %-speech piece — so one ratio maps to a different
absolute level in every video. **Any level guidance has to be stated on the delivered scale, or
it is not guidance.** This is the same raw-vs-delivered confusion as §2, one level up, and it
argues hard for `targetLufs` doing the arithmetic inside bay.

Also worth knowing for any check that reasons about beds: `mix.rs` models a clip's level as
`file_lufs + 20·log10(gain)` — a **constant** file level times the keyframe gain. Amplitude
changes baked into the *file* (a bed arranged to drop out under a rest) are invisible to `check`,
which will score those stretches as though the bed were playing.

**3. Field finding worth acting on: `flat-mix` and `speech-masked` are the same check in
different units, and having both creates a tuning trap.** `shoot-b` reports that
`bed-too-quiet`, `flat-mix` and `speech-masked` form a narrow coupled window that trades off
through duck depth — at depth 10, `flat-mix` ×6; at depth 14 with more gain, `bed-too-quiet`;
above `volume` 2.44, `speech-masked`. `flat_mix` samples the overlap of two clips, and with a
real duck the bed is already down for the whole overlap, so what it actually measures is *ducked
separation in linear gain* — which is `speech-masked`'s statistic in worse units. **This is
direct evidence for §7.1: now that `speech-masked` exists, delete `flat-mix`.** Three coupled
thresholds teach an agent to tune to the middle of a window rather than to a correct mix.

The cleanest demonstration came from `shoot-c`: **`flat-mix` went from 10 occurrences to 0 with
only the bed's level changed and no duck parameter touched.** A finding whose text is "nothing
ducks" cannot be cleared by changing a gain while the duck stays identical — it is not measuring
ducking.

---

## 0. Three corrections to the brief, established from source before anything else

The brief asked me to find these out rather than assume them. All three came out differently
from the hypothesis, and two of them change what should be built.

### 0.1 `vol=2.0` was not driving the limiter. It was not even close.

| stem | true peak in the summed mix |
|---|---|
| narration | **−0.6 dBFS** |
| sfx | −5.2 dBFS |
| bed (at `vol=2.0`) | **−12.5 dBFS** |
| **summed mix, pre-`loudnorm`** | **−0.60 dBFS, zero samples over full scale** |

Reconstructed sample-accurately from the project JSON and the source files. The bed is 12 dB
below the peak. What sits at the peak is the **narration**: `narrate` peak-normalises every
utterance to `peakDb: -2.0` by default, and the agent then applied `volume: 1.15` on top (+1.2 dB)
→ −0.6 dBFS.

`bed.wav` itself peaks at **−23.8 dBFS** and the bed stem's integrated level even at `2.0` is
**−31.5 LUFS**. `vol=2.0` was a rational response to a very quiet asset — and it was still about
9 LU below where a bed belongs. The number 2.0 is not the defect.

### 0.2 The export chain is not destroying the LRA. The flat mix was authored.

I ran bay's literal export filter — `amix=inputs=N:normalize=0:dropout_transition=0` then
`loudnorm=I=-14:TP=-1.5:LRA=11` — over controlled 60-second signals:

| authored LRA | delivered LRA | delivered I |
|---|---|---|
| 4.2 LU | **4.0 LU** | −14.3 LUFS |
| 6.5 LU | **7.0 LU** | −13.9 LUFS |
| 6.6 LU | **6.4 LU** | −13.9 LUFS |
| 16.4 LU | **11.2 LU** | −16.4 LUFS |

**One-pass `loudnorm` with `LRA=11` is a ceiling, not a crusher.** Anything at or under 11 LU
passes through within ±0.5 LU while the integrated target lands within 0.1 dB. Only material
*above* the target gets compressed, and it gets compressed to the target, not to nothing.

So the delivered **LRA 3.5 LU was authored**, and an LRA of 7–9 LU is fully deliverable through
the export path exactly as it stands. **No encoder change is needed.** The entire fix is in
authoring, which is the right place for it — but it also means the previous round's instinct to
look at the limiter would have burned the effort in the wrong crate.

*(Caveat, stated because it bears on one number: two of the six narration WAVs in `/var/folders/`
have been truncated by a later `narrate` run — `bay-narration-2` is 1.75 s where the project holds
6.98 s, and `-5` is 1.82 s where the project holds 10.30 s. My reconstruction of the authored
premix therefore understates narration by ~13.7 s and its LRA of 16.4 LU is an upper bound. The
controlled-signal results above are unaffected, and they are what the conclusion rests on.)*

### 0.3 The real export bug: the whole mix is delivered at 24 kHz mono, decided by clip order.

`rust/crates/bay-preview/src/lib.rs:1438-1482` builds the filtergraph with no `aformat` on any
input and no `-ar`/`-ac` on the output. `amix` therefore adopts the format of input 1. Proven
directly:

| first audio clip on the timeline | `amix` output format |
|---|---|
| Kokoro narration (24 kHz mono) | **24 000 Hz, 1 ch** |
| the music bed (48 kHz stereo) | 48 000 Hz, 2 ch |

`wicks-v2.mp4` ships **AAC 24 kHz mono**. Every whoosh's air above 12 kHz and the entire stereo
image of the bed are thrown away, silently, because a narration clip happened to sort first.
Two lines to fix.

---

## 1. The mix spec, in numbers

### 1.1 Programme targets

| quantity | target | note |
|---|---|---|
| Integrated loudness | **−14.0 LUFS ± 0.5** | already correct; platform normalisation target |
| True peak | **≤ −1.5 dBTP** | keep as shipped; survives platform re-encode |
| **Momentary (400 ms) stdev** | **≥ 3.5 LU** | the primary contour statistic — see §1.1.1 |
| **Momentary p5–p95 spread** | **≥ 10 LU** | |
| **Momentary windows within ±3 LU of median** | **≤ 70 %** | |
| Loudness range (LRA) | **≥ 6 LU at 60 s; ≥ 4.5 LU at 30 s** | duration-dependent — see §1.1.1 |
| Sample rate / channels | 48 kHz stereo | currently 24 kHz mono by accident (§0.3) |

#### 1.1.1 Why the contour statistic is momentary, not short-term — a correction

I built a deliberately **correct** 30-second mix to validate these numbers (the pad bed of §8, a
real 8 dB duck with the §3.2 curve, four Kokoro lines, one 1.2 s hole) and ran it through bay's
export chain. Measured on that good mix:

| window | stdev | within ±3 LU | p5–p95 |
|---|---|---|---|
| **Momentary, 400 ms** | **4.56 LU** | **55 %** | **13.6 LU** |
| Short-term, 3 s | 1.87 LU | 92 % | 6.2 LU |

**LUFS-S uses a 3-second window.** On a 30-second piece where speech covers ~60 % in lines of
4–6 s separated by 2–4 s gaps, no short-term window ever sits purely in the gap state, so the
measurement cannot resolve a contour that is unambiguously there. LRA inherits the same window and
the same limitation.

A first draft of this document proposed **LRA 6–9, short-term stdev ≥ 2.2, ≤ 75 % within ±3 LU.**
The good 30-second mix scores **LRA 5.2, stdev 1.93, 91 %** — it would have been failed on all
three. That is precisely the failure this round exists to prevent, one level up: a threshold that
rejects good work teaches people to switch the check off.

**Momentary loudness resolves it** — 4.56 LU of stdev against 1.87 — and gives thresholds with
real headroom at both 30 s and 60 s. Use it for the contour; keep LRA as a secondary,
duration-banded sanity figure:

| runtime | LRA floor |
|---|---|
| ~30 s | ≥ 4.5 LU |
| ~60 s | ≥ 6.0 LU |

*Open item:* the failed video's **momentary** series is not in hand — the file became unreadable
to this session partway through — so the momentary thresholds above are calibrated from the good
mix and the structural argument, with only the short-term figures (stdev 1.19, 100 % within
±3 LU, LRA 3.5) measured on the failure. **Measure `wicks-v2.mp4`'s momentary series before
committing these numbers to `check.rs`.** The gap between 4.56 and whatever it scores is the real
margin, and I have not seen it.

**Why LRA 6–9, argued.** Not taste — arithmetic plus two hard bounds.

*Lower bound.* A narration-led explainer has two sustained states: speech passages and the gaps
between them. If those states differ by `D` LU and the gaps occupy 30–40 % of the timeline, the
gated short-term distribution has its 10th percentile in the gap state and its 95th in the speech
state, so **LRA ≈ D + 1–2 LU** of intra-speech variation. The spec below sets D = 6, which lands
LRA at 7–8. Anything under 5 LU means the two states are not distinguishable — the failed video
at 3.5 LU has **100 % of its short-term windows inside ±3 LU of the median**, which is a
measurement of "there is no contour", not a loose one.

*Upper bound.* Platforms normalise toward −14 LUFS integrated and never expand. A passage 12 LU
below programme level sits at −26 LUFS, which is inaudible on a phone speaker in any room that
is not silent. Past ~11 LU you are authoring content the audience cannot hear — and `loudnorm`
will compress it back anyway (§0.2).

**LRA cannot be gamed with silence.** R128's relative gate excludes blocks more than 20 LU below
the integrated level (≈ −34 LUFS for a −14 LUFS programme). Verified: two control mixes identical
but for 2.8 s vs 1.0 s of true digital silence measured **LRA 6.6 vs 6.5**. This matters for §7 —
it means the LRA target and the silence rule in §6 are independent and neither can fake the other.

### 1.2 Element levels, relative to each other

Narration is the reference; everything is specified against it. Sustained material in LUFS-S
(3 s window), transients in dBTP in the delivered −14 LUFS master.

| element | state | target | relative to speech |
|---|---|---|---|
| **Narration** | speaking | **−15 to −16 LUFS-S** | 0 (reference) |
| **Bed** | ducked, under speech | **−29 to −30 LUFS-S** | **−14 LU** |
| **Bed** | between lines | **−21 to −22 LUFS-S** | **−6 LU** |
| **Bed** | under a title card, no speech | −18 to −19 LUFS-S | −3 LU |
| SFX — accent (impact, chime) | peak | −11 to −7 dBTP | at or just under speech peaks |
| SFX — transition (whoosh, riser) | peak | −20 to −13 dBTP | clearly under |
| SFX — micro (tick, click, beep) | peak | −28 to −22 dBTP | felt, not heard |
| SFX — sub-drop | peak | −13 dBTP | mostly < 80 Hz; reads as weight |

−14 LU of separation under speech is the intelligibility number: speech in a competing signal is
effectively unimpaired above about +15 dB SNR and degrades below +10 dB. The failed video runs
**4.3 dB** (narration 1.15 against bed 0.7 — computed exactly, and `flat-mix` did fire on it).

### 1.3 Ducking, in milliseconds

| parameter | value | why |
|---|---|---|
| **Depth** | **8 dB** (linear ×0.398) | takes the bed from −22 to −30 LUFS-S; it is the 6 LU state difference that produces the LRA |
| **Pre-roll** | **250 ms before the first word** | a duck that begins on the word is heard as a level jump |
| **Attack** | **150 ms** (60–400 ms legal) | under 60 ms pumps audibly; over 400 ms masks the first syllable |
| **Hold** | to line end **+ 150 ms** | releasing on the final consonant clips the tail of the sentence |
| **Release** | **500 ms** (≥ 200 ms, and always > attack) | asymmetry is what makes a duck inaudible; a release faster than the attack is a pump |
| **Join gap** | **1500 ms** | if two lines are closer than this, do not release between them |

The asymmetry lives in the **timing**, not in the curve shapes — 150 ms down against 500 ms up.
That is deliberate: it is one number to specify, one number to check (§7 C), and it cannot be
subtly wrong the way a mismatched pair of easings can.

### 1.4 What a good 60-second loudness envelope looks like

Described so a measurement can be held against it:

- **0.00–0.25 s** — silence or near-silence. The bed starts *after* the first frame is seen, not
  with it. (Failed video: bed starts at t=0.00 at gain 1.6, under a blank frame.)
- **6 speech plateaus at −15 to −16 LUFS-S**, one per line, totalling ~36 s.
- **5 gap troughs at −21 to −22 LUFS-S**, 3–5 s each. These are the LRA.
- **≥ 1 trough at or below −26 LUFS-S for ≥ 0.8 s** — the breath before the payoff.
- **Final 6–8 s sit 1.5–2 LU above the mean of the middle third** — the lift into the end card.
- **Last 0.4–0.6 s decays to silence.** The bed stops before the picture does.

Held against `wicks-v2.mp4`: short-term stdev **1.19 LU**, min −17.1, median −14.1, max −12.0,
**100 %** of windows within ±3 LU of the median. Six plateaus and five troughs are not present;
there is one plateau, 61 seconds long.

---

## 2. Why `vol=2.0` happened, and how to make it impossible

**Why.** §0.1: the source peaks at −23.8 dBFS. At unity it is inaudible under a narration that
`narrate` peak-normalises to −2.0 dBFS. `2.0` made it audible and it was *still* ~9 LU too quiet.
The agent's reasoning was sound; the units it had to reason in were not.

**The root cause is that linear clip gain is dimensionless.** `volume: 2.0` says nothing about how
loud a clip will be, because that depends entirely on the asset. Every check written against that
number inherits the same blindness.

### The three options in the brief, and why each is worse

**(a) Clamp a bed above unity in the engine.** No. It silently changes what was asked for, and
here it would have clamped the *correct* gain — making the bed inaudible with no recourse and no
message. A clamp converts a mix problem into a mystery.

**(b) `add_audio` rejects it.** Worse: same objection, plus it fails a legal and routine
operation. `audio_set`'s own schema already documents a 0–4 range.

**(c) Escalate `gain-above-unity` to an error.** Worst of the three, and it is exactly the failure
mode this round exists to prevent. Simulated against the real project, it fires on **22 elements**:

| element | gain | count |
|---|---|---|
| bed | 1.6 / 1.8 / 2.0 | 7 |
| narration | 1.15 | 6 |
| impact | 1.1–1.3 | 6 |
| chime | 1.5–1.7 | 3 |

Sixteen of those 22 are harmless. An agent forced to clear it does so by scaling every gain down
by a constant — which changes **no relative level, no LRA, and produces a bit-identical mix after
`loudnorm` re-normalises**. It is a check a bad video passes trivially, and it would have pointed
the agent away from the real problem (a bed 9 LU too quiet). **Delete it.**

### Recommendation: (d) — measure assets at import, and specify level in LUFS

1. `media_import` already shells out for probing. Add an `ebur128` pass; store `integratedLufs`
   and `truePeakDb` on `MediaAsset`.
2. Add `targetLufs` (sustained) / `targetPeakDb` (transient) to `add_audio` / `sfx_add` /
   `sound_add`. bay converts to the linear gain that achieves it. `volume` stays for manual work.
   **These must be measured on the source file, before `loudnorm`.** A field report computed a
   bed gain from the *delivered* narration level (−14.7 LUFS) instead of the raw WAV
   (−25.9 LUFS) and came out 11 dB hot. Any tool or doc exposing a level target has to say which
   side of the export chain it is measured on, or it is a trap.
3. Replace `gain-above-unity` with **`speech-masked`** and **`bed-too-quiet`** (§7 E), which
   compare the *measured* bed level against the *measured* speech level over the spans where they
   overlap.

This survives the gaming test by construction: **you cannot game a ratio between two measured
stems by changing a gain number, because changing the gain changes the measurement.** And it makes
the right thing easy rather than making the wrong thing forbidden — the agent wanted "an audible
bed"; give it a way to say that.

---

## 3. Ducking as a real mechanism

### 3.1 Blocking defect: bay could not express a 60-second duck — **fixed, see Field update**

Proven end-to-end against the real code path, not emulated.

`Element::gain_points()` (`rust/crates/bay-project/src/element.rs:826`) subdivides every **eased**
keyframe segment into 16 steps (`EASED_STEPS = 16`). `AudibleClip::volume_filter()`
(`rust/crates/bay-preview/src/lib.rs:1976`) renders those points as a **nested** `if()` chain.
ffmpeg's expression parser accepts at most **97 points** and rejects 98 (bisected).

Measured with the real types, then fed to ffmpeg:

| eased volume keys | `gain_points` | expression chars | ffmpeg |
|---|---|---|---|
| 6 | 82 | 4 613 | **ok** |
| **7** | **98** | 5 541 | **rejected — "Missing ')' or too many args"** |
| 8 | 114 | 6 485 | rejected |
| 24 | 370 | 21 461 | rejected |

(Linear channels are fine: 24 keys → 25 points. But a linear duck is a stairstep with ramps, and
the ramps are the part that wants easing.)

**A duck of one narration line needs 4 keys. Two lines is 8 keys, which does not export.** The
`animate` tool description promises exactly this feature — *"an audio clip takes `volume` — which
is how you duck a music bed under narration instead of splitting it"* — and it does not work past
a single line. That is a sufficient explanation for the 13-slice hack, and it is a hard
prerequisite: **no doctrine may tell an agent to keyframe a duck until this is fixed.**

**Fix** (~30 lines): decimate the emitted polyline with a 0.3 dB tolerance and hard-cap it at 90
points before building the expression. A 150 ms ease needs ~5 points to be indistinguishable from
16, and a flat hold needs exactly 2. Six ducks then cost ~84 points. Add a regression test
asserting both the point count for a 6-line duck and that the decimated curve stays within 0.3 dB
of the ideal. If more points are ever needed, the structural fix is a flat sum
(`v0*between(t,a,b) + v1*between(t,b,c) + …`), whose parse depth is constant.

### 3.2 The tool

```
duck(
  bedId       : string     # the clip to duck
  underIds    : string[]   # the clips it must get out of the way of
  depthDb     : number = 8
  attackMs    : number = 150
  releaseMs   : number = 500
  preRollMs   : number = 250
  holdMs      : number = 150
  joinGapMs   : number = 1500
) -> { keys: [...] }       # returns what it wrote, so the agent can read and adjust it
```

Depth, attack and release are the only three numbers that are a mix decision; the agent supplies
those. Where the lines *are* is something bay already knows from `underIds` — the agent must never
hand-compute 24 keyframe times, because avoiding exactly that arithmetic is why it chopped the
file up instead.

Per line, four keys. Easings are from bay's real set (`plan.rs:432`):

| key | time | value | easing on the segment leaving it |
|---|---|---|---|
| k0 | `lineStart − preRoll` | bed | **`ease-in-out`** |
| k1 | `lineStart − preRoll + attack` | `bed × 10^(−depth/20)` | **`hold`** |
| k2 | `lineEnd + hold` | ducked | **`sine-in-out`** |
| k3 | `lineEnd + hold + release` | bed | **`hold`** |

Both moving segments are corner-free at both ends — a corner in a gain curve on a sustained bed is
audible, and `power-out` has one at its start. The asymmetry that makes the duck disappear comes
from 150 ms against 500 ms, not from the curve shapes.

**The join rule.** If `nextLineStart − thisLineEnd < joinGapMs`, emit no k2/k3 here and no k0/k1
next: hold the duck through the gap. A bed that recovers and re-ducks inside 1.5 s breathes, and
it is also how keyframe counts explode.

### 3.3 Worked example — real numbers from the failed project

`bay-narration-5`: start **18.80 s**, duration **10.30 s**, end **29.10 s**. Bed element starts at
0.0, so local time == timeline time. Bed level 0.85; ducked = 0.85 × 10^(−8/20) = 0.85 × 0.3981 =
**0.338**. Gaps either side are 4.43 s and 4.70 s, both > 1500 ms, so this duck stands alone.

| `t` (s) | `value` | `easing` |
|---|---|---|
| 18.55 | 0.850 | `ease-in-out` |
| 18.70 | 0.338 | `hold` |
| 29.25 | 0.338 | `sine-in-out` |
| 29.75 | 0.850 | `hold` |

**Four keyframes on one element.** What they replace, over the same span, in the shipped project:

| | the 13-slice hack | `duck` |
|---|---|---|
| elements | 3 (`14.38→19.10 @2.0`, `18.80→29.40 @0.7`, `29.10→34.10 @2.0`) | 0 extra |
| gain decisions | 3 hard steps | 1 depth |
| overlap fudges | 2 (−0.3 s each, to hide the seams) | 0 |
| `trimStart` computations | 3 (to keep the music continuous) | 0 |
| transition time | **0 ms — a cliff** | 150 ms down, 500 ms up |
| reversible? | no — re-ducking means re-cutting | yes — change `depthDb` |

Across all six lines: **24 keyframes on one element replaces 13 elements, 13 gains, 12 overlap
fudges and 13 trim computations.** And 24 eased keys is 2.4× over the export limit today, which is
§3.1 again: the mechanism must be fixed before the doctrine can be followed.

---

## 4. SFX selection, not SFX count

### 4.1 What bay can actually vary — established from source

`rust/crates/bay-audio/src/sfx.rs` synthesises **14 effects in code**, rendered per call:

- **`seconds`** — any length to 30 s; a nonsense value falls back to the effect's own default.
- **`tone`** — 0..1, and it is *not* cosmetic. It moves the filter cutoff on whoosh/riser/click/
  glitch (`cutoff = 0.02 + sweep*(0.10 + 0.30*tone)`), the noise-transient amount on the impact
  (`0.25 + 0.4*tone`), the pitch of the pop (`420 + 520*(1−t)³*(0.6 + 0.8*tone)`) and the beep
  (`880*(0.6 + 0.8*tone)`), and the octave shimmer on the chime.
- **`level`** — 0..1, applied by normalising to that exact peak after render, so it really is the
  peak.

**So character can be varied parametrically on two axes plus level. The effects are not fixed
assets.** "Vary your whoosh" is possible today.

**The failed video used none of it — it never called `sfx_add` once.** All 16 media are files the
agent generated outside bay into a scratchpad and `media_import`ed, then stamped with `add_audio`,
one `mediaId` reused up to 11 times. That is why every whoosh is 0.54 s: there is one whoosh.

### 4.2 The bug that pushes it that way

`rust/crates/bay-mcp/src/studio.rs:926` and `:990`:

```rust
"elementId": placed.get("id").cloned().unwrap_or(serde_json::Value::Null),
```

`add_audio` returns `{"elementId": …, "trackId": …}` (`studio.rs:719`). There is no `"id"` key.

**`sfx_add` and `sound_add` both always return `"elementId": null`.** An agent that places a sound
through the intended tool gets no handle back: it cannot `animate` its volume, `fade_set` it,
`element_move` it, or delete it. `media_import` + `add_audio` is the *only* path that returns a
usable id — so the observed failure mode is the only workflow that works. One word each to fix,
and until it lands no rule about varying SFX can be obeyed.

### 4.3 The decision table

Level is peak dBTP in the delivered −14 LUFS master. Pre-roll is how far the sound leads picture.

| event character | weight | sfx | seconds | tone | level | pre-roll |
|---|---|---|---|---|---|---|
| **arrival** | light | `pop` | 0.12–0.18 | 0.55–0.70 | −24 | +40 ms |
| | medium | `whoosh` | = the move | 0.45 | −16 | +70 ms |
| | heavy | `impact` + `sub-drop` | 0.5 / 0.8 | 0.35 | −8 / −12 | +70 ms |
| **departure** | light | *none* | — | — | — | — |
| | medium | `whoosh` | = the move | 0.30 (duller) | −19 | 0 ms |
| | heavy | `sub-drop` | 0.7 | — | −13 | 0 ms |
| **impact** | light | `click` | 0.06 | 0.60 | −26 | +40 ms |
| | medium | `impact` | 0.5 | 0.40 | −11 | +70 ms |
| | heavy | `riser` → `impact` | 1.2 / 0.7 | 0.50 | −14 → −7 | riser **ends** on the frame |
| **transition** | light | `whoosh` | 0.25 | 0.35 | −20 | +70 ms |
| | medium | `whoosh-reverse` | 0.40 | 0.50 | −15 | **ends** on the cut |
| | heavy | `riser` → `impact` | 1.4 / 0.6 | 0.50 | −14 → −8 | riser **ends** on the cut |
| **reveal** | any | `riser` + `chime`\|`impact` | 1.2–2.0 | 0.55 | −12 → −8 | riser **ends** on the frame |
| **emphasis** | light | `tick` | 0.04 | 0.50 | −28 | +40 ms |
| | medium | `pop` | 0.15 | 0.65 | −22 | +40 ms |
| **state change** | light | `beep` | 0.10 | 0.45 | −25 | +40 ms |
| | medium | `click` | 0.06 | 0.70 | −22 | +40 ms |
| **error** | any | `error` | 0.45 | 0.40 | −14 | +70 ms |
| **completion** | any | `chime` | 0.9 | 0.60 | −12 | +70 ms |
| **tension (held shot)** | any | `swell` | 2.0–3.0 | 0.30 | −20 | starts 2 s before |

Pre-roll: the failed video's modal offset is **+0.07 s (2 frames)** and it is **correct — do not
change it.** Micro-punctuation wants +0.04 s (1 frame). Sounds that *land* — `whoosh-reverse`,
`riser` — are aligned by their **end**, not their start.

### 4.4 The rule that prevents stamping

The signature to kill: 11 whooshes each 0.54 s, 11 ticks each 0.04 s, 6 impacts each 0.69 s, with
volume jitter (0.34 / 0.36 / 0.38 / 0.42) applied to *look* like mixing.

- Bad rule — "vary the volume": that is what it already did.
- Bad rule — "use N distinct sounds": a diversity count. It will use N families once each, then stamp.

> **The rule: a sound's duration is a function of the move it scores. Two sounds of the same
> family may not share a duration unless the two moves they score share a duration.**

As a statistic, in two clauses:

1. Per family used more than twice: `distinct(round(duration, 0.02 s)) ≥ ceil(0.6 × count)`.
2. Every sfx's duration must be within **±25 %** of the duration of the visual move nearest it
   within 0.5 s.

Why it cannot be gamed:

- **Volume jitter does nothing** — volume is not in the statistic.
- **Duration jitter fails clause 2** — random spread clears clause 1 and is then caught by the tie
  to a measured property of the picture.
- **Adding more sounds makes it harder** — `count` rises, so the required distinct count rises.
- The only way to pass is to make each sound as long as the thing it covers, which is the actual
  craft rule and is precisely what `sfx_add`'s `seconds` parameter exists for.

### 4.5 Parametric variation, specifically

When a family must recur:

- **`seconds`** — always set from the move. Primary axis, free, and the one clause 2 checks.
- **`tone`** — vary on a *meaningful* axis, never randomly. Brighter **0.60–0.75** for things
  arriving toward the viewer or in the foreground; duller **0.25–0.40** for things leaving,
  receding, or behind. A run of four ticks in a counter should **descend** 0.60 → 0.45 so the run
  reads as one gesture instead of four events.
- **`level`** — set by role from §4.3, never jittered. Two sounds in the same role share a level;
  that is correct, and it is not monotony.
- **Never** place two sounds of the same family within 0.6 s at the same duration and level. That
  is a flam, and it reads as a bug.

---

## 5. The move-count problem

### 5.1 The measurement

Both figures in circulation are real; they measure different things, so here are both:

| statistic | value |
|---|---|
| animated channels | 172 |
| keyframe segments that change value (raw move onsets) | 245 |
| **distinct onset times** | **162** (this is the brief's "160") |
| onsets clustered at 80 ms | 127 |
| **onsets clustered at 150 ms — perceptually separate events** | **89 → 88/min** |
| scored audio events | 50 → 49/min |

Even after clustering at the perceptual limit, **88 visual events per minute — one every 0.68 s.**

### 5.2 The right number of scored events

Derived from structure, not taste. The video is 6 narration lines, 36 s of speech across 61 s
(59 % coverage). Its structural events are: 1 open + 6 beat transitions + ~6 per-beat reveals +
1 payoff + 1 end card ≈ **15**. Allow at most one emphasis accent per beat: **+6**.

> **Target: 18–24 scored events in 60 seconds — one every 2.5–3.3 s.**

The failed video has 50, one every 1.2 s. That is 2–3× over, and every sound above the budget is
spending the audience's attention on something that is not a beat.

### 5.3 Visual events to scored events: not 1:1 — a three-tier hierarchy

| tier | what it is | scored? | budget |
|---|---|---|---|
| **1 Structural** | scene change, beat change, reveal, payoff | **always** | 10–15/min |
| **2 Emphasis** | a number landing, a word highlighted, a list item | **selectively** — max 1 per 3 s, never 2 consecutive from one family | 5–10/min |
| **3 Micro-motion** | entrance, fade, drift, parallax, settle | **never** | — |

**The argument for "never" at tier 3.** A sound is a deictic: it points. If everything is pointed
at, nothing is. This is the same failure as the 107 opacity channels — uniform treatment of
non-uniform importance — expressed in another domain.

**And this is the finding to state plainly:** the evidence notes 37 moves have no sound within
0.4 s. The wrong reading is "37 moves are unscored." The right reading is that **of 162 onsets,
roughly 140 should not exist**, and of the ~20 that should, all 20 should be scored.

The audio layer cannot be repaired independently of the edit. At 50 sounds it is already 2–3× too
many; dropping to 20 while keeping 162 moves just makes 20 arbitrary moves louder than the other
142. **The move count must come down to ~20–30 real moves in 60 s first**, after which the sound
layer maps onto tiers 1 and 2 at nearly 1:1.

That is why the previous round's rule — "a sound under every significant move" — produced 69 audio
elements and a worse video. It applied a *coverage* rule to a timeline whose *event density* was
the defect.

---

## 6. Silence

**Measured: the bed covers 61.00 s of the 61.01 s timeline — 100 %, in 13 segments with no gap
anywhere.** There is no silence in the video except the first 0.3 s, and that is silent for the
wrong reason (the frame is blank too).

What silence does:

- **Before a reveal** — 0.4–0.8 s of near-silence is the cheapest way to make a reveal land.
  Dropping everything for 500 ms then hitting beats any impact sample at any level.
- **After the hook** — a 0.3 s hole separates the claim from the explanation and stops the open
  running into the body.
- **At the end** — the bed stops before the last frame, not with it.

**What to remove, quantified:**

| | shipped | target |
|---|---|---|
| bed coverage | **100 %** (61.00 s) | **78–86 %** (48–52 s) |
| bed start | t = 0.00 at gain 1.6 | t = **0.25–0.40 s** |
| holes ≥ 0.3 s | **0** | **3** |
| — before the payoff reveal | — | **0.5–0.7 s** |
| — after the hook line (≈ 5.8–6.1 s) | — | **0.3 s** |
| — tail-out at the end | — | **0.5 s** |

Note the distinction: the **gap state** between lines (bed at −22 LUFS-S) is not silence, it is the
quiet half of the contour that produces the LRA. True digital silence is for the three holes only.

And per §1.1, R128's relative gate excludes near-silent blocks from LRA entirely (verified: 2.8 s
vs 1.0 s of silence changed LRA by 0.1 LU), so **the silence rule and the LRA target are
independent and neither can be used to fake the other.**

---

## 7. The checks

### 7.1 What to kill

| finding | verdict | why |
|---|---|---|
| **`gain-above-unity`** | **DELETE** | Fires on 22 elements here, 16 of them harmless. Measures a dimensionless number. Satisfied by scaling everything down, which changes nothing audible and which `loudnorm` then undoes. It certifies the bad video *and* points away from the real defect (§2). |
| **`flat-mix`** | **REPLACE** | Fired correctly 6× (4.3 dB < 6 dB) and shipped anyway. Its statistic is max gain ratio at any sampled instant — it measures separation **depth** and is blind to whether the transition is a curve or a cliff. The 13-slice stairstep passes it at any depth ≥ 6 dB. |
| **`no-bed`** | **KEEP** | Narrow, honest, correctly silent here. |
| **`silent`** | **KEEP** | |

### 7.2 Proposed findings

Each: statistic, threshold, where it is computable, and the gaming strategy it must survive.

---

**A. `bed-step` — Error. A gain discontinuity on a music bed.**

- **Statistic** (two clauses): (i) for any two audio clips sharing a `mediaId` whose timeline ends
  abut or overlap within 0.5 s, the dB difference between the outgoing gain at its tail and the
  incoming gain at its head; (ii) within any single clip, two consecutive `gain_points` less than
  60 ms apart differing by more than 1.5 dB.
- **Threshold:** > 1.5 dB. **Computable from the project model** — no encode.
- **Measured on the failed video:** 12 boundaries, steps of 9.1 dB (0.7→2.0) — fires 12×.
- **Gaming:** *"crossfade the slices by 3 frames so the step is technically a ramp."* Survives —
  the threshold is on the **time** of the transition, not its existence; anything under 60 ms
  fires. *"Do it with `hold` keyframes instead of clips"* — clause (ii). The only way to pass is a
  transition ≥ 60 ms, which is a real duck.
- **Error, not Warning:** never intentional, and warnings demonstrably do not stop anything —
  28 audio warnings shipped in this file.

---

**B. `bed-not-automated` — Error. A bed over speech carrying no automation.**

- **Statistic:** the longest audio element overlapping ≥ 2 speech elements. Fire if
  `animations["volume"]` is absent, has < 2 keys, or its `gain_points` span < 4 dB.
- **Computable from the model**, given `role` (§8.3).
- **Measured:** fires — `bed volume automation present: False`, zero volume keyframes project-wide.
- **Gaming:** *"add two keyframes with the same value"* — the 4 dB span clause. *"Split the bed
  into 13 pieces so no single element is long"* — survives because the statistic groups by
  **`mediaId`**, not by element: 13 slices of one file are one bed.

---

**C. `duck-shape` — Warning. The duck exists but is the wrong shape.**

- **Statistic**, per (speech clip, bed) pair, read off the emitted curve: attack time (90 %→10 % of
  travel before the line) and release time.
- **Thresholds:** fire if attack < 60 ms or > 400 ms; release < 200 ms; or **release < attack**.
- **Computable from the model.**
- **Gaming:** none available. The numbers are measured on the curve, and any curve satisfying them
  *is* a good duck. This is a check that can only be satisfied by doing the right thing.

---

**D. `no-dynamics` — Error. The mix has no loudness contour.** *(replaces `flat-mix`)*

- **Statistic:** EBU R128 **momentary** loudness (**400 ms** window, 100 ms hop) over the
  project's own mix, gated. Then (i) standard deviation; (ii) fraction of windows within ±3 LU of
  the median; (iii) p5–p95 spread.
- **Thresholds:** fire if **stdev < 3.5 LU**, **fraction > 0.70**, or **p5–p95 < 10 LU**.
- **Not short-term / LRA** — a 3 s window cannot resolve a 2 s gap, and the first draft of these
  thresholds failed a *good* 30 s mix on all three clauses. See §1.1.1; the good mix scores
  stdev 4.56 / 55 % / 13.6 LU on momentary against 1.87 / 92 % / 6.2 LU on short-term.
- **Calibration gap:** the failed video's momentary series is not measured (§1.1.1). Do that
  before these numbers go into `check.rs`.
- **Needs a rendered mix but not the encoded file.** `bay_audio::mix_stereo` is already pure and
  allocation-only; mix to PCM headlessly and measure. This is the right place — it measures what
  will be heard, not what was typed.
- **Gaming:** *"add loud SFX to create variance"* — survives: a 3 s window moves by under 1 LU for
  a 0.5 s impact. Only **sustained** level differences move the statistic, and sustained level
  differences are the mix contour. *"Insert digital silence"* — survives: the R128 relative gate
  excludes those blocks (verified empirically, ±0.1 LU).
- **This is the one check in the suite a bad video cannot pass**, because it is computed on the
  output rather than on the description of the output.

---

**E. `speech-masked` / `bed-too-quiet` — Error. Wrong separation between voice and bed.**

- **Statistic:** over each speech element's span, median (bed-stem short-term − speech-stem
  short-term). Stems are trivial once roles exist.
- **Thresholds:** fire `speech-masked` if separation < 9 LU; fire `bed-too-quiet` if the bed's
  level **between** lines is more than 12 LU under the speech level.
- **Needs the stem mix** (same machinery as D).
- **Gaming:** *"turn the bed down to nothing everywhere"* — passes `speech-masked`, fails
  `bed-too-quiet` and `no-dynamics`. The pair brackets the answer from **both sides**, which is
  exactly what the old `flat-mix` lacked: it had only a floor.

---

**F. `no-silence` — Warning. The bed never stops.**

- **Statistic:** (i) fraction of the timeline where the summed mix exceeds −45 dBFS; (ii) whether
  at least one hole ≥ 0.3 s falls within the middle 80 % of the timeline.
- **Thresholds:** fire if (i) > 0.95 **or** (ii) is false.
- **Measured:** (i) = 1.00, (ii) false. Fires.
- **Gaming:** *"insert one 3-second silence at the end"* — clause (ii) requires it in the middle.

---

**G. `sfx-stamped` — Warning. The same sound repeated without variation.**

- **Statistic:** per family used more than twice, `distinct(round(duration, 0.02 s)) / count`, plus
  the ±25 % move-duration tie from §4.4.
- **Threshold:** fire if the ratio < 0.6, or if any sfx duration is outside ±25 % of its nearest
  move.
- **Computable from the model.**
- **Measured:** whoosh **1/11 = 0.09**, tick **1/11 = 0.09**, impact **1/6 = 0.17**, click 1/6,
  riser 1/4. **Fires on all five families.**
- **Gaming:** *"jitter durations randomly"* — fails the ±25 % clause. *"Jitter volumes"* — volume
  is not in the statistic.

---

**H. `event-density` — Warning. Too many moves, or too many sounds.**

- **Statistic:** visual move onsets clustered at 150 ms per minute; scored audio events per minute.
- **Thresholds:** fire above **60 moves/min** or **45 sounds/min**.
- **Measured: 88 moves/min and 49 sounds/min.** Fires on both.
- **Gaming:** *"merge moves so they share an onset"* — **that is not gaming, that is the fix.** It
  is precisely what turns 162 scattered onsets into ~25 coordinated ones. A check whose gaming
  strategy is the desired behaviour is a good check.

### 7.3 The severity policy is the actual bug

`check` is an optional read tool; `render` never calls it (`bay-agent/src/plan.rs:597` is the only
call site, and it only reports). **This project carried 28 audio warnings into a delivered file.**

> **`render` must return the Error findings and refuse unless `force: true` is passed.**

Without this, every check above — and every check the previous round added — is decoration.

---

## 8. Capability gaps, ranked by quality per unit of work

| # | gap | work | why here |
|---|---|---|---|
| **1** | **`elementId` bug in `sfx_add`/`sound_add`** (`studio.rs:926`, `:990`) | **one word each** | Every sound placed with the intended tool is unaddressable. The agent's workaround — import a file, stamp it 11× — *is* the observed failure mode. Best ratio in the list by a wide margin. |
| **2** | **Keyframe budget** (`element.rs:826` + `lib.rs:1976`) | ~30 lines | 7 eased volume keys fail to export. Ducking beyond one line is impossible, so §3 is unavailable until this lands. |
| **3** | **`role` on `AudioElement`** (`bed`\|`voice`\|`sfx`), set by the creating tool | small | Precondition for checks B, D, E and for `duck` to take `underIds` implicitly. Also lets the export mix stems separately, which D and E need. It is why `no-bed`'s doc comment has to be so apologetic. |
| **4** | **`duck` tool** (§3.2) | medium | Depends on 2 and 3. |
| **5** | **`amix` format inheritance** (`lib.rs:1438`) | 2 lines | Ships 24 kHz mono, decided by clip order (§0.3). Throws away everything above 12 kHz and the entire stereo image, silently. |
| **6** | **Loudness at import** — `ebur128` in `media_import`; `targetLufs` on the placement tools | small | Makes level a measured quantity instead of a dimensionless multiplier (§2). |
| **7** | **Headless mix + R128 in `check`** | medium | The machinery for D, E, F. `mix_stereo` already exists and is pure; the cheap route is a temp WAV through ffmpeg's `ebur128`, consistent with the rest of bay. This is what makes the suite measure output instead of description. |
| **8** | **`render` refuses on Error** (§7.3) | trivial | Without it, 1–7 remain advisory. |
| **9** | `music_analyze` → bpm/beats/sections | large | See below. |
| — | Expressive TTS (prosody, emphasis, pause authoring) | large | Out of scope here; flagged in §11 of the evidence and it is a real gap. `narrate` exposes only `voice` and `speed`, and `peakDb` **peak**-normalises — the wrong normalisation for speech, since equal peaks are not equal loudness. Measured: the six clips land at −25.8, −18.7, −25.8, −25.9, −18.9, −25.9 LUFS — **a 7.2 LU spread from a parameter whose whole job is evenness.** Switching `peakDb` to a LUFS target is small and belongs at rank 6. |

### Is a beat grid worth it?

**Yes in principle — but rank it 9th, and it is not the thing to build next.**

**For.** The agent currently guesses. Every cut is placed against narration timing; the bed's
musical structure is invisible. The `trimStart` bookkeeping across 13 slices exists *purely*
because the agent was trying to preserve musical continuity blind. A grid would let `marker_add`
be populated automatically and let reveals land on downbeats, which is the most reliable way to
make an edit feel intentional rather than assembled.

**Against, now.**

1. **The problem is not that the cuts are off the beat; it is that there are 162 of them.** A grid
   over that timeline snaps 162 moves to a grid and yields a strobe that merely has rhythm. §5 has
   to land first or the grid amplifies the defect.
2. **bay does not ship music.** The bed here was a user file at −23.8 dBFS peak. Onset detection on
   arbitrary user audio is a real signal-processing project — spectral-flux onset detection plus
   tempo estimation by autocorrelation of the onset envelope, several hundred lines and a
   validation corpus. **A wrong grid is worse than none, because the agent will trust it.**
3. Everything at ranks 1–8 is between one word and ~100 lines, and each fixes something that is
   currently *broken* rather than adding something new.

**The cheap 80 %.** Most of the value needs no DSP: take bpm from the user when they supply a bed,
or parse it from the filename (`..._120bpm.wav` is how nearly every library track is named), and
expose `grid(bpm, offsetMs)` so `marker_add` can populate downbeats. That is an afternoon and it
buys the "land the reveal on a beat" behaviour outright. Build `music_analyze` only if that proves
insufficient.

---

## Appendix — method

- Levels and loudness: `ffmpeg -af ebur128=peak=true` (EBU R128; integrated, LRA, short-term
  series at 100 ms hop, true peak).
- The pre-`loudnorm` mix was reconstructed sample-accurately in Python from the project JSON —
  every clip's `start`, `duration`, `trimStart` and `volume` — and split into bed / narration /
  sfx stems.
- The export chain was reproduced by generating bay's literal filtergraph from the project
  (69 inputs, `atrim`/`asetpts`/`volume`/`adelay`, `amix=normalize=0:dropout_transition=0`,
  `loudnorm=I=-14:TP=-1.5:LRA=11`) and running it.
- The keyframe limit was measured two ways that agree exactly: bisecting ffmpeg's expression
  parser (accepts 97 points, rejects 98), and a temporary integration test against the real
  `Element::gain_points()` and `AudibleClip::volume_filter()` (6 eased keys → 82 points, exports;
  7 → 98 points, ffmpeg rejects). The temporary test has been removed.
- Check behaviour was simulated in Python against the real thresholds in
  `bay-core/src/check.rs` (`MIN_MIX_OVERLAP = 2.0`, `MIN_DUCK_DB = 6.0`, `MIX_SAMPLES = 32`).
