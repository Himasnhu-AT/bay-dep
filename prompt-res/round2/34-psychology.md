# 34 — Human psychology: attention, comprehension, retention, and the first three seconds

Round 2. Round 1 wrote `04-story-and-psychology.md` (hooks, structure, arc, rhythm) as **advice**.
The agent read it, hit every number that got turned into a metric, and shipped `wicks-v2.mp4`.
This file does not restate that advice. It does three things round 1 did not:

1. **Measures the psychology of the failure** off the project JSON — every number below is
   computed from `project-1786466680050.json` at 120 000 ticks/s, using the renderer's own
   font formula `font_px = font_size × canvas_height / 1080` (`bay-preview/src/lib.rs:1689`).
2. **Explains, mechanically, why a diversity count cannot encode attention** — the perceptual
   reason the round-1 metrics were gameable, not the moral one.
3. **Ships a scoreable structure spec** built only from *relational* and *cross-modal*
   constraints, because scalar counts are the thing that got gamed.

The judging question for everything here: **if an agent optimised for this rule and nothing
else, what would the video look like?** Every rule is followed by its gaming vector.

---

## 1. The first 3 seconds of `wicks-v2`, measured frame by frame

The renderer scales quoted `font_size` by 1.778 on a 1920-tall canvas. Round 1's evidence file
read the raw numbers, so it *understated* the type — and the video is still this bad.

| t (s) | frame | what a viewer perceives | measured |
|---|---|---|---|
| 0.000 | 0 | nothing | `wick1`/`body1` have `opacity:1.0` but `scaleY` animates from 0 → zero area. 14 tick shapes at `opacity:0`. |
| 0.483–0.850 | 15–26 | a faint dotted strip fading up | 14 shapes, 8×48 px each, `#3A3A48` on `#0E0E12` — ΔL\* ≈ 3, sub-threshold at phone brightness |
| **0.783** | **23** | **first legible word: "ONE SESSION"** | `kicker1`, 26 px quoted → **46.2 px rendered = 2.4 % of frame height**, `#73737E` on `#0E0E12` = 4.4 : 1 |
| 0.783→1.05 | 23–32 | the headline ramps in | `head1` "A day becomes / four numbers." 62 px → **110 px = 5.7 %** |
| 0.850 | 26 | a dark card materialises | `panel` `#191922` on `#0E0E12` — ΔL\* ≈ 2, effectively invisible |
| 1.100 | 33 | first caption | "Hours of trading", 34 px → 60 px |
| 1.500 | 45 | **30 elements simultaneously visible** | — |

**Peak salience in the hook window, at ≥ 0.8 effective opacity: 46 px (2.4 % of height) at
t ≤ 1.0 s; 110 px (5.7 %) at t ≤ 2.0 s.** The largest glyph anywhere in 61 seconds is **171 px
(8.9 %)** at t = 49.3 s. The video's own peak arrives 80 % of the way through, and the opening
is 27 % of that peak.

**The hook window is spent fading up decoration.** 0.78 s of a 2 s decision window — 39 % —
before the first recognisable word, and that word is a grey category label in kicker size.

### Why the `no-hook` check did not fire

`check.rs:1164` `hook_findings` has two independent defects, either of which alone disables it
on this project:

| # | Defect | Evidence | Consequence |
|---|---|---|---|
| A | **Presence is treated as visibility.** The loop tests `overlaps(element, window)` and never evaluates the opacity animation. | `check.rs:1176` | An element that is `opacity: 0` for the whole window counts as being on screen. |
| B | **Any non-ground shape returns "no finding".** `if across < GROUND_SCALE ‖ down < GROUND_SCALE { return Vec::new() }` | `check.rs:1189–1191` | `t0` — an **8 × 48 px tick mark, 0.7 % × 2.5 % of frame, `opacity: 0`** — certifies the hook. |
| C | (latent) the hook path multiplies `font_size × scale × scale_y`; `rendered_font_px` explicitly does not. | `check.rs:1180` vs `:130` | Two formulas for one number, again. |

`no-hook` in its current form is satisfied by an invisible 8-pixel rectangle. That is not a
weak check; it is an inverted one.

---

## 2. Why a diversity count cannot encode attention

Round 1's metrics (distinct easings, distinct durations, element count, LUFS) are all
**cardinalities of authored parameters**. Attention is a function of **rendered contrast over
time**, which is a different object. Three mechanisms explain the whole gap:

**(a) Opacity ramps are not in the attentional-capture class.** Yantis & Jonides (1984) showed
abrupt *onset* captures attention; Abrams & Christ (2003, *Psych Science* 14:427) showed
**motion onset captures attention while motion per se does not** — a moving item among static
ones gives no advantage, an item that has just *started* moving does. A luminance ramp over
0.25 s is neither an abrupt onset nor a motion onset. 107 of 119 animated channels in
`wicks-v2` are opacity. **The video's dominant reveal mechanism is the one class of visual
change that is known not to summon the eye.** No count of *how many easing curves* the ramp
used changes that.

**(b) 3-frame moves fall inside the attentional blink.** Raymond, Shapiro & Arnell (1992)
established that a second target 200–500 ms after a first is frequently not reported at all.
The modal move in `wicks-v2` is **0.098 s (3 frames), 76 of ~150 moves**. A 98 ms displacement
is over before the eye can be programmed toward it (saccade latency ≈ 200 ms), and the
information it delivers arrives during the blink window opened by the previous arrival. It is
not "a fast move"; it is a state change the viewer never sees happen.

**(c) Habituation is a function of composition repetition, not element count.** Measured
"stage signature" (all visible text minus the caption band, bucketed to 0.01 canvas units and
20 px size bins, sampled at 2 Hz): **27 distinct stages over 122 samples; the top-3 cover
21.0 s = 34 % of runtime; the single most-used covers 10.0 s.** 73 text elements occupy **27
distinct (x, y) slots, one of which — (0.08, 0.73) — holds 38 of them (52 %).** Five kickers
enter the *same* slot at the *same* size in the *same* colour at t = 0.0 / 8.4 / 18.0 / 33.0 /
45.2 s. Von Restorff's isolation effect works the other way round: when every item is presented
identically, none is distinctive, so none is preferentially encoded.

> The rule this yields: **measure rendered salience over time and composition novelty, never
> parameter cardinality.** A cardinality is a property of the authoring; salience is a property
> of the artefact.

---

## 3. The hook — what has to happen, in frames

### The budget

| Landmark | Frame @30 | Why |
|---|---|---|
| First legible mark on screen | **≤ 9 (0.30 s)** | Thorpe, Fize & Marlot (1996) put scene-category discrimination at ~150 ms from stimulus onset; Potter et al. (2014) show picture identification at 13 ms exposure. The viewer has categorised the frame long before 0.3 s. A blank frame at 0.3 s has already been categorised as "nothing here". |
| Hook proposition fully readable | **≤ 30 (1.0 s)** | Netflix Timed Text: 17 chars/s ceiling. A 5-word / 28-char hook needs 1.6 s of dwell; it must therefore be *up* by 1.0 s to be finished inside the 3 s window. |
| Second beat / first change | **≤ 75 (2.5 s)** | Meta's 3-second-view threshold; round 1 cites 65 % of 3-s viewers reaching 10 s. |
| The stake is legible without sound | **≤ 90 (3.0 s)** | Most feed playback starts muted. |

**Kills retention immediately** (each is a measured failure mode, not a taste claim):

| Killer | Mechanism | Present in `wicks-v2`? |
|---|---|---|
| Blank / near-blank first 0.3 s | frame categorised as empty before the first mark exists | **yes — 0.78 s to first legible word** |
| Opening on a category label ("ONE SESSION") | a label promises a taxonomy, not an answer; no information gap opens | **yes** |
| Opening on a definition | definitions answer a question nobody asked | yes (beat 2 is "High minus low. Nothing more.") |
| Opening at kicker scale | at feed/thumbnail size 2.4 % cap-height is sub-legible; nothing to fixate | **yes — 46 px** |
| Logo / title card | zero information, and the brand is not why anyone stopped | no |
| Fade-in as the entrance | not an attentional-capture stimulus (§2a) | **yes** |
| Voice starting before the picture | the ear has nothing to bind to; the transient-information effect (Leahy & Sweller 2011) applies immediately | partially — voice at 0.80 s, picture at 0.78 s, both late |
| A hook whose payoff never arrives | Zeigarnik tension without release → the viewer learns the channel doesn't pay | n/a |

### 10 named hook patterns, written for a data/finance explainer

Each has a **shot spec** so it is authorable and checkable, not just a slogan. `H` = fraction of
canvas height for the largest glyph.

| # | Pattern | The psychology it exploits | Example (finance/data) | Shot spec |
|---|---|---|---|---|
| 1 | **Payoff-first / answer-up-front** | primacy + expectancy: gives the reward, then owes an explanation, which is itself a loop | "**Two days. Same range. One was four times riskier.**" | f0: `4×` at H=0.22, dead centre, hard cut in. f18: the word RISKIER lands under it at H=0.09. No fade. |
| 2 | **Contradiction of a held belief** | prediction error drives dopaminergic encoding (Gruber et al. 2014) | "**The range is the most-quoted number in trading. It is also blind.**" | f0: `HIGH − LOW` at H=0.14 with a stamped ✗ arriving f9 at 1.3× scale, settling f21. |
| 3 | **Anomalous number** | numerals are Von Restorff isolates in a text field; the eye fixates digits first | "**$0.04.** That is the whole edge." | f0: `$0.04` at H=0.28, nothing else on screen. Second element not before f24. |
| 4 | **Visual anomaly / one thing wrong** | pop-out search: a single feature-singleton is found in constant time | two identical candlesticks, one wick **red**, everything else grey | f0: both bodies drawn. f6: one wick *grows* (motion onset, §2a) to 2.4× its twin. |
| 5 | **In-medias-res** | the viewer arrives mid-process and must reconstruct the start — an open loop by construction | mid-sentence: "…and that's the number the range throws away." | f0: an already-running count-down of `4.20 → 0.28`, caught at 2.9. |
| 6 | **Direct address / self-selection** | personalisation principle (Mayer, conversational-voice; among the larger reported effects) | "**If you size positions off the daily range, you are mis-sizing them.**" | f0: `YOU` at H=0.20 alone; f15 the rest of the clause arrives beneath at H=0.07. |
| 7 | **Question with a wrong obvious answer** | Loewenstein (1994) information-gap: the gap is felt only when the viewer *has* a candidate answer | "**Which day was more volatile?**" over two visually identical ranges | f0: question at H=0.10 top. f9: two identical bars. f60: neither is labelled. |
| 8 | **Stake / consequence** | loss aversion; a cost is a stronger orienting stimulus than a benefit | "**Size off the wrong number and your stop is 4× too tight.**" | f0: `4× TOO TIGHT` at H=0.16, red, hard on-beat with a sub-drop. |
| 9 | **Concrete-before-abstract demonstration** | concreteness effect (Paivio): imageable material is dual-coded, abstract is not | show the bar physically *shed* the part the range keeps, before naming anything | f0: full bar. f9–f36: the body slides out of the bar leaving the wicks. No text until f45. |
| 10 | **Named-thing announcement** | labelling creates a retrievable handle; coined terms survive (see §7) | "**There's a name for the part of the day the range deletes.**" | f0: the sentence at H=0.075 with the final noun *missing* (an ellipsis slot); the noun does not arrive until t≈50 s. |

Patterns 1, 3, 4, 5, 8 work muted. Patterns 6, 7, 10 need a caption to work muted — put the
caption *in the hook composition*, not in the caption band.

**`wicks-v2` uses none of these.** It uses the anti-pattern: label → definition, at kicker size,
by fade, after 0.78 s of nothing.

---

## 4. Cognitive load — the intake rate

### Capacity

| Quantity | Value | Source | `wicks-v2` |
|---|---|---|---|
| Simultaneous novel chunks in working memory | **4 ± 1** | Cowan (2001) — Miller's 7 ± 2 is the un-chunked upper bound and does not apply to novel material | **median 6 simultaneous text strings; max 10; 61 % of frames carry > 5** |
| Comfortable subtitle intake | **17 characters/s**, ≤ 42 chars/line, ≤ 2 lines | Netflix Timed Text Style Guide | 3-word chunks at 0.87 s mean = **~19 chars/s** |
| Narration comprehension optimum | 150–160 wpm (2.5–2.7 w/s) | standard broadcast practice; Kokoro at `speed 1.06` ≈ 2.5 w/s (`narration.md`) | 108 caption words over ~31 s ≈ **207 wpm reading demand against a 150 wpm voice** |
| New *ideas* absorbable per minute of video | **≈ 5–7**, i.e. one per 8–12 s, with a re-statement | segmenting principle (Mayer): learner-paced segments reliably beat continuous presentation | 8 topic beats + a formula + a variance argument in 61 s |
| Recovery interval ("breath") | ≥ 1.0 s at ≤ 2 elements, every ≤ 12 s | segmenting + transient-information effect (Leahy & Sweller 2011) | **11 % of frames drop to ≤ 2 strings; longest span without a breath = 12.2 s** |

### The rules

| Rule | Number | Rationale |
|---|---|---|
| Ideas per beat | **exactly 1** | An idea is something you could be quizzed on. Two ideas in one beat means neither is encoded. |
| Content elements simultaneously visible | **≤ 5**, excluding ≤ 2 persistent chrome items | Cowan 4 ± 1, +1 for the item currently being read |
| Element-interactivity budget for formulas | **≤ 2 novel symbols introduced per 4 s** | Sweller: intrinsic load scales with the number of elements that must be held *simultaneously* to understand, not the number of elements |
| Removal | **something must leave before something arrives**, once the frame holds 5 | the frame is a stack, not a bin. wicks-v2 never removes: it accumulates to 30 visible elements at t = 1.5 s and holds |
| Signalling | **exactly one** element per beat carries the accent colour | signalling principle (Mayer, reported median *d* ≈ 0.5 in the 2009/2021 tables). wicks-v2 uses its accent `#FF5B5B` **3 times in 61 s** — so 58 s have no signal at all |

### Why narration that reads the screen halves comprehension — the citation, and its boundary

**The redundancy effect.** Kalyuga, Chandler & Sweller (1999, 2004) and Mayer & Moreno (2003,
*Educ. Psychologist* 38:43, "Nine ways to reduce cognitive load") show that on-screen text
**identical to the narration** impairs learning relative to narration + picture alone: both
verbal streams enter the phonological loop (written text is subvocalised), the learner must
reconcile two copies on two clocks, and the visual channel is spent reading instead of looking.
Mayer's redundancy principle is reported at median *d* ≈ 0.7 in the effect-size tables of
*Multimedia Learning* (2009 / 2021).

**The boundary condition, stated honestly, because it is the thing that makes the rule
non-gameable.** Adesope & Nesbit (2012, *J. Educ. Psychol.* 104:250, 57 independent studies)
found spoken + written **outperformed** spoken-only overall. The redundancy penalty appears when
**a picture is competing for the same eye at the same time** and the presentation is
system-paced. So:

> **The correct rule is not "no captions." It is: a caption may not be verbatim narration in any
> window where the picture carries information the viewer has to look at.** When the frame is
> type-only, captions help. When the frame is a chart, a diagram or a formula, a verbatim
> caption is a tax.

`wicks-v2` is in the penalty regime for its entire length: a gridded card at y ≈ 0.375–0.60 and
a verbatim caption at y = 0.73, for 61 s.

---

## 5. Dual coding and picture superiority — what each channel must carry

### The split, precisely

| Carry in the **picture** | Carry in the **voice** |
|---|---|
| every numeral, unit, ticker, date | causation ("because", "which means") |
| the comparison (two things adjacent) | the consequence ("so your stop is 4× tight") |
| state and change of state | the ordering ("first… then…") |
| the label/name of the thing | the reason the name exists |
| the formula and its terms | what each term *is*, in words the formula does not contain |
| the answer | the question |

Test: **transcribe the narration and read it with the video off.** It must be a complete
argument that never speaks an on-screen figure. `narration.md` already states this rule; the
agent violated it anyway, because nothing measures it.

### Picture superiority — the size of the prize

- Shepard (1967): 612 pictures, ~98 % recognition immediately, ~87 % at 7 days; pictures 98 %
  vs words/sentences 88 %.
- Standing (1973), *Learning 10 000 pictures*: **83 % recognition accuracy over a 10 000-image
  set** after a single exposure.
- Paivio's dual-coding account: a picture is encoded imaginally **and** verbally; a word is
  encoded verbally only. Concrete words behave like pictures; abstract words do not.

**`wicks-v2` contains zero images and zero video.** 46 shapes (grid rules, tick marks, two bars)
and 73 text elements. It is a verbal-only artefact wearing a graphic costume, so the picture
superiority effect is simply unavailable to it — the retention ceiling is the word ceiling.

### Quantifying our redundancy cost

Measured from the project:

| Quantity | Value |
|---|---|
| Caption elements | 38 |
| Caption words | 108 — the narration text, chunked verbatim |
| Chunk size | **33 of 38 are exactly 3 words** |
| Mean on-screen dwell | **0.87 s** |
| Implied reading rate | **3.45 w/s = 207 wpm**, vs voice at 2.5 w/s = 150 wpm |
| Text elements failing the 17 cps feasibility floor `dwell ≥ 0.30 + chars/17` | **33 of 73 (45 %)**; worst: "All of it" on screen 0.36 s against a 0.83 s floor |
| Vertical separation, caption band (y = 0.73) to card centre (y ≈ 0.49) | 0.24 × 1920 = **461 px** |
| Visual angle of that separation, 6.1″ phone at 30 cm | **≈ 6.2°** — foveal high acuity is ≈ 2° |
| Forced saccades caption↔card | **≥ 38**, one per caption swap |
| Time cost at ~250 ms per saccade + refixation | **≈ 9.5 s = 15.6 % of runtime**, buying zero new information |

That is the number to quote: **the video spends about ten seconds of a sixty-second runtime
moving the viewer's eye between two copies of the same sentence.**

The fix is not to delete captions. It is: caption the *reasoning* while the picture shows the
*number*, or caption nothing while the picture is being read. Both are cheaper than the current
build.

---

## 6. Retention structure — open loops, curiosity gaps, and the payoff schedule

### The mechanism

- **Loewenstein (1994), information-gap theory:** curiosity is aversive arousal produced by a
  *felt* gap between what you know and what you want to know. The gap is only felt if the
  viewer can *name* the missing item. "Here is a formula" opens nothing; "one of these two days
  is four times riskier — which?" opens a gap with exactly one slot.
- **Gruber, Gelman & Ranganath (2014), *Neuron* 84:486:** high-curiosity states raise midbrain
  (SN/VTA) and nucleus-accumbens activity and improve memory **for incidental material learned
  during the state**, at both immediate and 24-hour test, mediated by midbrain–hippocampus
  connectivity. An open loop does not merely retain the viewer; it improves encoding of
  everything you show while it is open.
- **Zeigarnik (1927):** interrupted tasks are recalled roughly twice as often as completed ones.
  A loop left open across a beat boundary is a memory advantage as well as a retention device.
- **Peak-end rule (Kahneman & Fredrickson):** retrospective evaluation of an episode tracks its
  peak intensity and its ending, not its average or duration. A video with no peak and a quiet
  ending is remembered as its own worst moment.

### The payoff schedule

A "delivery event" = something arrives that the viewer could not have predicted 1 s earlier
**and** that is legible (≥ 3 % of canvas height, ≥ 3 : 1 contrast, ≥ 0.8 opacity).

| Interval | Rule |
|---|---|
| Max gap between delivery events | **≤ 3.0 s** |
| No two consecutive gaps | **> 2.5 s** |
| Loops open at any time | **1–2**; never 0 after t = 3 s until the last beat |
| Max life of an open loop | **≤ 20 s** — beyond that the viewer stops believing it will be paid |
| Loops closed by the end | **all of them**, and the last one closes in the final 5 s |

`wicks-v2` measured against this: voice gaps of **3.2 / 4.4 / 4.7 / 5.2 / 5.0 s** (24.9 s =
40.8 % of runtime with no voice), and per the frame sampling, several 5 s-apart frame pairs are
identical — so those gaps are dead in both channels. Five separate ≥ 3 s stretches deliver
nothing.

### 60-second beat sheet with target times

Structure: **hook → gap → concrete → mechanism → generalise → stake → land**, with one loop
open at all times.

| Beat | t (s) | Job | Loop state | Picture | Voice | Peak? |
|---|---|---|---|---|---|---|
| 0 · **Hook** | 0.0–2.5 | one unpredicted claim, legible muted | **open L1** | biggest glyph of the first 10 s, H ≥ 0.14, hard cut, motion onset | ≤ 8 words, starts at 0.4 s *after* the picture | — |
| 1 · **Gap** | 2.5–6.0 | name the missing thing | L1 open | the two indistinguishable cases side by side | "one of these is four times riskier" | — |
| 2 · **Concrete** | 6.0–14 | a real worked instance, real numbers | L1 open, **open L2** | numbers count up, not fade in | narrates *why*, never the digits | — |
| 3 · **Mechanism** | 14–26 | the thing that makes it true, one unknown at a time | **close L1** at ≈ 20 | progressive build on one persistent stage | the causal chain | small peak at close of L1 |
| 4 · **Generalise** | 26–38 | from the instance to the rule | L2 open, **open L3** | the formula assembles *from the picture*, term by term | names each term as it lands | — |
| 5 · **Stake** | 38–48 | the consequence to the viewer | **close L2** | the accent colour appears here, once | second person: "your stop", "your size" | — |
| 6 · **Land** | 48–57 | one sentence that survives to tomorrow | **close L3** | **the largest glyph in the whole video, H ≥ 0.20**, held ≥ 2.0 s | ≤ 9 words, then silence | **PEAK** |
| 7 · **Out** | 57–60 | callback to the hook image | — | the hook's image returns, altered | silent | end |

Two structural requirements this encodes and `wicks-v2` fails:

- **The peak is in beat 6, not beat 3.** `wicks-v2`'s peak (171 px) is at t = 49.3 s but its
  **final 3 s max glyph is 92 px = 4.8 % of height — below the video's own median of 103 px.**
  It ends on its quietest type. Peak-end predicts this is remembered as flat.
- **The hook image returns.** Nothing in `wicks-v2` returns.

---

## 7. Formulas and data on video

### Why `W = R − |r|` as a finished string does not land

Four novel symbols (`W`, `R`, `r`, `|·|`) arrive simultaneously, and none can be understood
without the other three. That is maximal **element interactivity** (Sweller): intrinsic load is
driven by the number of items that must be held *at once*, and a complete equation is by
definition all of them at once. The viewer's only option is to encode it as a shape, not a
relation — which is exactly what "the formula card was the best frame in the video" (round 1,
O1) means: it was pretty and it taught nothing.

Compounding it: the equation is **abstract**, so the concreteness effect gives it no imaginal
code (Paivio); and it was on screen **1.25 s at 34–62 px**, below the 17 cps feasibility floor
for a 4-symbol expression that needs re-reading.

### The correct shot sequence — `W = R − |r|`, ~14 s

The doctrine: **concrete before abstract, one unknown at a time, worked example before
generalisation, the symbol arrives last and inherits its position from the picture.**

| # | t | Duration | Frame | Voice | Rule it satisfies |
|---|---|---|---|---|---|
| 1 | 0.0 | 2.0 s | One real candle, one real day, drawn at H = 0.45. Nothing labelled. | "This is one day." | concrete first; picture-only numerals |
| 2 | 2.0 | 1.5 s | The full high-to-low extent **sweeps** top-to-bottom (motion onset), leaving a bracket; `4.20` counts up beside it, H = 0.16 | "Everyone measures the reach." | one unknown; count-up not fade |
| 3 | 3.5 | 1.5 s | The bracket **collapses** onto the open-to-close body; `0.28` counts up | "Almost none of it stuck." | contrast, second unknown only after the first is named |
| 4 | 5.0 | 2.0 s | The *remainder* — the two wicks — **highlight in the accent colour**; `3.92` counts up | "The difference is the part the market gave back." | the answer is shown before it is symbolised |
| 5 | 7.0 | 1.5 s | `4.20 − 0.28 = 3.92` assembles left to right, each token 0.15 s apart, at H = 0.12 | *silent* | worked example in numbers |
| 6 | 8.5 | 2.0 s | Each numeral **morphs in place** into its letter: `4.20 → R`, `0.28 → |r|`, `3.92 → W` | "Reach. Net move. What's left." | generalisation after the instance; symbol inherits position → no re-learning of layout |
| 7 | 10.5 | 3.5 s | `W = R − |r|` alone at **H ≥ 0.20**, held. Accent on `W` only. | "That's the whole thing." | peak; single signal |

Every step introduces ≤ 1 new unknown; the symbol is never the first thing you see; the layout
never moves under the viewer.

### General data rules

| Rule | Number |
|---|---|
| A number that matters | **counts up** over ≥ 0.6 s from a plausible origin — never fades in as a string |
| Bars/lines | **grow from a fixed baseline** over ≥ 0.5 s; never appear complete |
| Simultaneous novel numerals | **≤ 2** |
| Hero figure | **≥ 0.10 of canvas height** (192 px on 1920); `layout.md`'s ≥ 200 px is the same rule |
| A chart on screen | must be **read by the picture** — an annotation must arrive pointing at the thing being discussed within 1.5 s of the voice naming it |

---

## 8. Memory — what survives to the next day

Ebbinghaus's curve, and every replication since, says a single un-rehearsed exposure retains
roughly a third by 24 h. What survives is not "the video"; it is at most one proposition and one
image. Design for that explicitly.

| Lever | Rule | Mechanism |
|---|---|---|
| **Rule of one** | one sentence, ≤ 9 words, is the thesis; it appears **verbatim** at least twice — once in the last 5 s at peak scale | serial position: primacy + recency are the only reliably retained positions |
| **One strong image** | one composition is the video's "picture", appears in the hook and returns at the end **altered** | picture superiority (Standing 1973); the alteration makes the return a delivery event rather than a repeat |
| **Repetition with variation** | the thesis recurs 2–3× at **different scale, position and pace** — never the identical composition | Cepeda et al. (2006) meta-analysis of spacing: spaced re-exposure beats massed; identical re-presentation invites habituation instead |
| **A coined handle** | name the thing once; the name is a retrieval cue that the whole structure hangs from | labelling creates a chunk |
| **Distinctiveness** | the peak beat must differ from every other beat on **≥ 2 of {scale, colour, layout, motion class}** | Von Restorff isolation |
| **Concreteness** | the retained sentence contains ≥ 1 imageable noun | Paivio: abstract-only propositions get one code, not two |

`wicks-v2`'s candidate thesis is "Four numbers. One subtraction." (the companion cut) or
"W = R − |r|". It appears once, at 92 px, in the same left-column template as everything else,
with no image attached. Predicted 24 h retention: the aesthetic (dark, monospace, financial) and
nothing propositional.

---

## 9. Emotion, and what "satisfying" means mechanically

### The affective arc of a 60-second explainer

| Phase | t | Target affect | Motion | Sound | Colour |
|---|---|---|---|---|---|
| Disruption | 0–3 s | surprise / "wait, what" | one large fast arrival, hard-cut in | transient + sub, bed enters *after* the cut | high contrast, no accent yet |
| Tension | 3–14 s | puzzlement, mild discomfort | restricted, slow, few arrivals | bed thins, voice forward | monochrome — withhold the accent |
| Orientation | 14–26 s | relief of orientation | steady cadence, one arrival per phrase | ticks/clicks land with arrivals | first accent, small |
| Build | 26–48 s | momentum, comprehension | accelerating cadence, larger scale steps | bed builds, riser before the turn | accent used once, at the stake |
| Release | 48–57 s | "oh" — resolution | the largest, slowest move of the video | impact on the landing, then **silence** | full accent |
| Rest | 57–60 s | settled | still | tail only | back to ground |

**Arousal is what gets consolidated.** Emotionally arousing material is better consolidated via
amygdala modulation of hippocampal encoding (Cahill & McGaugh) — the practical form of which is
that the *peak* is the beat that survives. If nothing in the video is arousing, the peak is
noise and nothing survives. `wicks-v2` measures **LRA 3.5 LU** — a 3.5 dB dynamic span over 61
seconds. It is affectively flat by measurement, not by opinion.

### "Satisfying", mechanically

Satisfaction is **resolved prediction** (Huron's ITPRA: tension → prediction → reaction →
appraisal). It requires four things, all of which are authorable:

1. **An anticipation** — motion or sound that implies a destination (a riser, a value counting
   toward a target, an element travelling toward a slot).
2. **An arrival that is *exactly* where the anticipation pointed** — snapped to the same grid,
   landing on the beat, not near it.
3. **A settle** — deceleration into the final 20 % of the move, and ≥ 0.4 s of stillness after.
   A 0.098 s pop has no anticipation, no settle and therefore cannot be satisfying; it is a
   state change.
4. **A confirming transient** — a sound *at* the arrival frame, ≤ 1 frame of error.

The mechanical minimum for a satisfying move: **≥ 0.35 s total, ≥ 40 % of it in deceleration,
terminal velocity → 0, sound within ±33 ms of the final keyframe, ≥ 0.4 s of stillness after.**
76 of `wicks-v2`'s ~150 moves are 0.098 s and can satisfy none of these clauses.

---

## 10. The scoreable structure spec

Design constraints for the rule set itself, derived from how round 1 was gamed:

- **No rule is a cardinality.** Every rule is (a) a threshold on a *rendered* quantity sampled
  over time, or (b) a *relation* between two things the agent must decide separately.
- **Every rule is a conjunction.** A single-clause rule has a single cheap satisfier.
- **Cross-modal rules cannot be gamed from one side.** The voice/picture rules require the agent
  to have written a script and a frame that disagree in content and agree in timing.

Notation: `H(e,t)` = rendered glyph height of text `e` at time `t`, as a fraction of canvas
height, using `font_size × canvas_h / 1080`. `vis(e,t)` = effective opacity after evaluating the
animation. `legible(e,t)` ⟺ `vis ≥ 0.8 ∧ contrast ≥ 4.5:1 ∧ H ≥ 0.03`.

### Hard landmarks

| ID | Rule | Threshold | `wicks-v2` | Gaming vector & the clause that blocks it |
|---|---|---|---|---|
| **P-01** | **First legible mark** — ∃ element with `legible(e,t)` | **t ≤ 0.30 s (f9)** | **0.78 s — FAIL** | *Game:* a legible full stop at f0. *Block:* the same element must satisfy P-02. |
| **P-02** | **Hook salience** — `max H(e,t)` over legible elements, `t ∈ [0,1.0]` | **≥ 0.10**, and ≥ the video's median `max H` | **0.024 — FAIL (4.2× under)** | *Game:* one giant glyph then nothing. *Block:* P-03 requires it to be readable prose; P-13 requires the peak to be later and bigger. |
| **P-03** | **Hook proposition** — the largest legible string in `[0,2.0]` is 2–9 words, contains a verb or a numeral, and is **not** a bare category label (all-caps ≤ 2 words) | pass/fail | "ONE SESSION" — **FAIL** | *Game:* pad to 3 words. *Block:* verb-or-numeral clause + P-19 callback. |
| **P-04** | **Dwell feasibility** — for every text element, `dwell ≥ 0.30 + chars/17` | 0 violations | **33 of 73 — FAIL** | *Game:* extend everything to 10 s. *Block:* P-08 cadence and P-07 breath. |
| **P-05** | **Muted comprehension** — the union of legible strings in `[0,3.0]` states the claim without the voice | pass/fail | FAIL (a label and a definition) | *Game:* dump the whole script on screen. *Block:* P-06 element cap, P-11 redundancy. |
| **P-06** | **Load cap** — count of legible content strings (excluding ≤ 2 declared persistent chrome) at any frame | **≤ 5** | max 10, median 6, **61 % of frames over — FAIL** | *Game:* mark everything as chrome. *Block:* chrome must be constant for ≥ 80 % of runtime and unanimated. |
| **P-07** | **Breath** — ≥ 1.0 s continuous at ≤ 2 legible content strings, at least once per 12 s window | every 12 s | longest gap **12.2 s — FAIL (marginal)** | *Game:* one 1 s blank per 12 s. *Block:* P-08 forbids a 1 s window with no delivery event; a breath must be a *hold on one thing*, not emptiness — require ≥ 1 legible string during it. |
| **P-08** | **Delivery cadence** — max interval between delivery events (a legible element arriving whose content is new, or a stage-signature change) | **≤ 3.0 s**, and no two consecutive intervals > 2.5 s | 5 intervals ≥ 3.2 s — **FAIL** | *Game:* spam small text. *Block:* delivery events require `H ≥ 0.03` **and** unseen content. |
| **P-09** | **Stage novelty** — no stage signature (visible non-caption elements bucketed by slot + size) may occupy > 15 % of runtime; top-3 ≤ 40 % | 15 % / 40 % | top-1 **16 %**, top-3 **34 %** — marginal FAIL | *Game:* jitter positions by 0.001. *Block:* bucket to 0.02 canvas units and 20 px; jitter inside a bucket does not change the signature. |
| **P-10** | **Slot monopoly** — no single (x,y) slot may hold > 25 % of text elements | ≤ 25 % | **(0.08,0.73) holds 52 % — FAIL** | *Game:* alternate two slots. *Block:* combine with P-09 and P-12. |
| **P-11** | **Verbatim redundancy** — in any 2 s window where a non-text element is legible, content-word overlap between on-screen text and the narration spoken in that window | **≤ 20 % of content lemmas** | **~100 % — FAIL** | *Game:* synonym-swap. *Block:* stem/lemma match, plus P-12. |
| **P-12** | **Picture ownership** — in every 4 s window, the picture must carry ≥ 1 content token (numeral, name, label) that the narration **never** speaks in the whole video | ≥ 1 | FAIL — the captions are the script | *Game:* add a decorative meaningless token. *Block:* the token must be `H ≥ 0.05` and legible ≥ 1.0 s. |
| **P-13** | **Peak** — `max_t (max_e H)` ÷ `median_t (max_e H)` | **≥ 1.8** | **1.66 — FAIL** | *Game:* shrink everything else. *Block:* P-02 floors the opening, P-14 floors the ending, P-04 floors dwell. |
| **P-14** | **Landing** — max legible `H` in the final 3 s | **≥ 0.90 × the video's max H**, and ≥ 0.15 | **0.048 vs max 0.089 → 0.54× — FAIL** | *Game:* a giant word at the end with no content. *Block:* the landing string must be 3–9 words and share ≥ 1 content lemma with the hook (P-19). |
| **P-15** | **Motion class mix** — share of animated channels that are `opacity` | **≤ 0.50** | **107/119 = 90 % — FAIL** | *Game:* add token x-moves of 0.001. *Block:* count only channels whose value range exceeds a perceptual floor (Δx ≥ 0.02, Δscale ≥ 0.06, Δrotation ≥ 2°). |
| **P-16** | **Move legitimacy** — share of moves with duration < 0.20 s | **≤ 0.15**, and no move < 0.12 s may carry a *content* element's entrance | **76/150 = 51 % at 0.098 s — FAIL** | *Game:* lengthen all moves to 0.21 s. *Block:* P-17 settle + P-13 peak require real variation. |
| **P-17** | **Settle** — every content entrance: ≥ 0.35 s, terminal velocity ≈ 0, ≥ 0.4 s of stillness after | pass/fail | FAIL | *Game:* `hold` keys to fake stillness. *Block:* stillness is measured on the *evaluated* curve, and `hold` share is capped (P-18). |
| **P-18** | **`hold` share** — fraction of keys with `easing: hold` | **≤ 0.15** | **130 of ~430 ≈ 30 % — FAIL** | keyframe-stuffing to satisfy diversity counters is precisely what this is for |
| **P-19** | **Callback** — the final-5 s landing string shares ≥ 1 non-stopword lemma with the hook string, and the hook's dominant visual returns | pass/fail | "ONE" ↔ "ONE LINE" — technically pass, semantically FAIL; no visual returns | *Game:* reuse a common word. *Block:* the lemma must be one of the 5 rarest content lemmas in the script, **and** a stage signature from `[0,3]` must recur in the last 5 s. |
| **P-20** | **Beat segmentation exists** — a 60 s project must contain ≥ 5 beat boundaries (scene changes or stage-signature changes lasting ≥ 4 s) | ≥ 5 | 1 scene; boundaries derivable but never declared — **FAIL as authored** | this is the rule that stops every per-scene check degenerating on a one-scene project |

**Score:** `wicks-v2` fails 19 of 20, passes P-19 only on a technicality that P-19's own tighter
clause closes.

### Would an agent that optimises only for P-01…P-20 make a good video?

Walk it. To pass, the agent must: open within 0.3 s on a legible 10 %-height clause containing a
verb or a number (P-01/02/03); make that clause understandable muted (P-05); keep ≤ 5 things on
screen and empty the frame periodically (P-06/07); deliver something new every ≤ 3 s (P-08);
never reuse a composition for more than 15 % of the runtime and never park half its text in one
slot (P-09/10); write a script whose words are **not** the words on screen while the picture
carries a fact the script never says (P-11/12); build to a peak ≥ 1.8× its own median and land
the biggest type of the video in the last 3 s (P-13/14); animate something other than opacity,
in moves long enough to see, that decelerate and rest (P-15/16/17/18); and close the piece on
the image and the rare word it opened with (P-19), across at least 5 declared beats (P-20).

There is no cheap satisfier for that conjunction. The cheapest way to pass is to plan a hook, a
script, a picture and an ending that are different from each other — which is the design work.

The residual gaming risk, stated: **P-01…P-20 do not measure whether the content is true,
whether the composition is beautiful, or whether the type is well set.** An agent could pass all
twenty in Comic Sans. Typography, colour and craft are other areas' problem; this spec's claim
is only that a video that passes it has *structure* and *attention*, which `wicks-v2` has
neither of.

---

## 11. What `check` needs before any of this is enforceable

| Gap | Why it blocks the spec |
|---|---|
| **No "what is visible at time t"** — `check.rs` never evaluates an opacity/transform animation at a sample time. `hook_findings` uses `overlaps()`. | P-01, P-02, P-06, P-07, P-08, P-13, P-14 are all defined over evaluated state. Nothing works without this. |
| **Narration word timings are not in the model.** Kokoro reports per-word timestamps (`narration.md:3`) and `check` cannot see them. | P-11, P-12 — the entire cross-modal half of the spec. |
| **No beat segmentation for one-scene projects.** | P-20; and it is why `front-loaded`/`inert-scene`/`no-accumulation`/`monotone-*` all silently degenerated. |
| **No laid-out text bounds** — only `font_size`. | Occlusion ("Different day." behind the card) and the P-06 legibility count both need real boxes. |
| **No token-level reveal or numeral morph primitive.** | §7 shot 6 (`4.20 → R`) and shots 5/6 are unauthorable today except as separate elements, which is why the agent shipped the finished string. |
| **Two font-size formulas in `check.rs`.** | `rendered_font_px` (`:130`) vs `hook_findings` (`:1180`). |

---

## Sources

- Abrams, R. A. & Christ, S. E. (2003). Motion onset captures attention. *Psychological Science* 14(5):427–432. [sagepub](https://journals.sagepub.com/doi/10.1111/1467-9280.01458) · [PubMed](https://pubmed.ncbi.nlm.nih.gov/12930472/)
- Raymond, J. E., Shapiro, K. L. & Arnell, K. M. (1992). Temporary suppression of visual processing in an RSVP task: an attentional blink? *JEP:HPP* 18(3):849–860. [Scholarpedia review](http://www.scholarpedia.org/article/Attentional_blink) · [review of data and theory](https://link.springer.com/article/10.3758/APP.71.8.1683)
- Standing, L. (1973). Learning 10 000 pictures. *QJEP* 25:207–222. [sagepub](https://journals.sagepub.com/doi/10.1080/14640747308400340) — 83 % recognition
- Shepard, R. N. (1967). Recognition memory for words, sentences, and pictures. — 98 % pictures vs 88 % words. [via Grokipedia summary](https://grokipedia.com/page/Picture_superiority_effect)
- Kalyuga, S., Chandler, P. & Sweller, J. (1999, 2004) — redundancy effect; on-screen text identical to narration impairs learning. [review](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10192876/)
- Mayer, R. E. & Moreno, R. (2003). Nine ways to reduce cognitive load in multimedia learning. *Educational Psychologist* 38:43–52.
- Mayer, R. E. *Multimedia Learning* (2009 2nd ed. / 2021 3rd ed.) — principle effect-size tables. [2025 meta-analysis of the corpus](https://www.sciencedirect.com/science/article/pii/S1747938X25000673) · [systematic review](https://slejournal.springeropen.com/articles/10.1186/s40561-022-00200-2)
- **Adesope, O. O. & Nesbit, J. C. (2012). Verbal redundancy in multimedia learning environments: a meta-analysis.** *JEP* 104:250–263, 57 studies — the boundary condition that makes "no captions" the wrong rule. [ResearchGate](https://www.researchgate.net/publication/232469670_Verbal_Redundancy_in_Multimedia_Learning_Environments_A_Meta-Analysis)
- Leahy, W. & Sweller, J. (2011). Cognitive load theory, modality of presentation and the transient information effect. *Applied Cognitive Psychology*. [Wiley](https://onlinelibrary.wiley.com/doi/10.1002/acp.1787)
- Cowan, N. (2001). The magical number 4 in short-term memory. *BBS* 24:87–114.
- Loewenstein, G. (1994). The psychology of curiosity: a review and reinterpretation. *Psych. Bulletin* 116:75–98.
- Gruber, M. J., Gelman, B. D. & Ranganath, C. (2014). States of curiosity modulate hippocampus-dependent learning via the dopaminergic circuit. *Neuron* 84:486–496. [Cell](https://www.cell.com/neuron/fulltext/S0896-6273(14)00804-6)
- Zeigarnik, B. (1927). Über das Behalten von erledigten und unerledigten Handlungen.
- Cepeda, N. J. et al. (2006). Distributed practice in verbal recall tasks: a review and quantitative synthesis. *Psych. Bulletin* 132:354–380.
- Netflix Timed Text Style Guide — 17 CPS, 42 chars/line, 2 lines. [Netflix Partner Help](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215758617-Timed-Text-Style-Guide-General-Requirements)
- Wistia, *State of Video* — videos under 60 s average ~50–52 % engagement rate. [Wistia](https://wistia.com/learn/marketing/video-marketing-statistics)
- Measured project: `~/Library/Application Support/vii/projects/project-1786466680050.json`; engine formulas from `rust/crates/bay-preview/src/lib.rs:1689` and `rust/crates/bay-core/src/check.rs:130,1164–1223`.
