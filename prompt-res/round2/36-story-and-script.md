# Script, story structure and narration for a 60-second explainer

Round 2. Everything below is measured against `wicks-v2.mp4` and its project JSON
(`project-1786466680050.json`, 188 elements, 1 scene, 61.013 s) unless a source is cited.
Round-1 findings (`prompt-res/04-story-and-psychology.md`) are assumed and not repeated; where
this file contradicts round 1, it says so.

**Judgement standard for every rule here: if an agent optimised for it and nothing else, would
the output still be wicks-v2?** Rules that fail that test are marked and discarded rather than
shipped.

---

## 0. What the script actually was (reconstructed from the caption elements)

The project has no stored script. It is recoverable exactly, because `narrate` burned every
spoken word as a caption element. Six clips, in playback order:

| # | clip | start | dur | words | w/s | wpm | sentences | longest sentence |
|---|---|---|---|---|---|---|---|---|
| 1 | narration-1 | 0.80 | 5.00 | 14 | 2.80 | 168 | 2 | 8 |
| 2 | narration-4 | 9.00 | 5.38 | 15 | 2.79 | 167 | 1 | 15 |
| 3 | narration-5 | 18.80 | 10.30 | 29 | 2.82 | 169 | 3 | **19** |
| 4 | narration-2 | 33.80 | 6.97 | 22 | 3.16 | **189** | 1 | **22** |
| 5 | narration-6 | 46.00 | 4.62 | 14 | 3.03 | 182 | 1 | 14 |
| 6 | narration-3 | 55.60 | 3.88 | 14 | 3.61 | **216** | 2 | 7 |

Totals: **108 words, 36.15 s of speech, 179 wpm mean, 10 sentences, 10.8 words/sentence.**
Runtime 61.01 s → **speech density 59.2 %**, **silence 24.86 s (40.8 %)**.

The text:

> 1. Hours of trading, thousands of prints. All of it survives as one small mark.
> 2. Ask how violent a session was, and the usual answer only counts the two extremes.
> 3. Reach says nothing about path. A market can walk one way all session, or fight itself the
>    whole time and finish where it began. One measurement calls those identical.
> 4. Take the net move out of the total, and what remains is precisely the distance the market
>    covered and then gave back.
> 5. That is why two sessions with the same reach can carry completely different risk.
> 6. The body tells you where it ended. The wick tells you what it cost.

**Readability was not the problem.** Flesch–Kincaid grade **5.0**, Reading Ease **78**. Both are
inside every published target. The script failed on axes no readability formula measures:

| axis | measured | target | verdict |
|---|---|---|---|
| FK grade | 5.0 | ≤ 8 | pass |
| mean sentence | 10.8 w | ≤ 12 | pass |
| **longest sentence** | **22 w** | ≤ 16 | **fail** |
| **sentences per clip** | 1.67 (3 clips have exactly 1) | ≥ 2 | **fail** |
| **longest clip** | **10.30 s** | ≤ 8.0 | **fail** |
| **delivery rate** | 179 wpm | 145–160 | **fail (fast)** |
| **speech density** | 59.2 % | 72–85 % | **fail (sparse)** |
| **first second-person pronoun** | t = 56.55 s (**92.7 %**) | ≤ 8 s | **fail** |
| **first stake token** ("risk") | t = 49.48 s (**81.1 %**) | in sentence 1 | **fail** |
| **beats whose role is not "explain"** | **0 of 6** | ≥ 3 (hook, turn, landing) | **fail** |
| **new information in last 6.4 s** | **0 tokens** | ≥ 1 | **fail** |

The signature is precise and it matters: **the script is simultaneously too fast inside each line
(179 wpm vs. the 150 wpm standard) and too sparse across the runtime (108 words where a 60-second
explainer carries 140–150).** That combination is only produced one way — by writing lines
independently and then padding the timeline between them. It is the mechanical fingerprint of a
script that was never written *to* a duration.

### Beat structure, measured

Beats delimited by the `kicker*` elements:

| beat | span | dur | narration | speech share of beat | silence tail |
|---|---|---|---|---|---|
| 1 | 0.00–8.72 | 8.72 | L1 0.80–5.80 | 57 % | 2.60 s |
| 2 | 8.40–18.30 | 9.90 | L4 9.00–14.38 | 54 % | 3.62 s |
| 3 | 18.00–33.30 | **15.30** | L5 18.80–29.10 | 67 % | 3.90 s |
| 4 | 33.00–45.50 | 12.50 | L2 33.80–40.77 | 56 % | 4.43 s |
| 5 | 45.20–54.90 | 9.70 | L6 46.00–50.62 | 48 % | 3.98 s |
| 6 | 54.60–61.00 | 6.40 | L3 55.60–59.48 | 61 % | 1.52 s |

Every beat is `[voice][silence]`, in that order, with the voice starting 0.60–1.00 s after the
beat opens and ending 1.52–4.43 s before it closes. Six beats, six identical shapes. **There is
no beat whose job differs from any other beat's job.** No hook beat, no turn beat, no payoff
beat, no landing beat. Six beats of "explain".

---

## 1. Structures that work in 30–90 seconds

A structure is a *complete path through one belief update*. Beat percentages below are of total
runtime `T`, so they scale from 30 s to 90 s; absolute columns are for `T = 60 s`. Below 30 s only
D, F and a 2-item E survive; above 90 s all of them need a second inner arc.

### A. Problem / shift / payoff
Choose when the audience already feels the cost and there is a fix. Strongest for tools.

| beat | %T | 60 s | job |
|---|---|---|---|
| pain, in the viewer's words | 0–10 | 0:00–0:06 | name the cost, not the topic |
| the obvious fix, and why it fails | 10–28 | 0:06–0:17 | the false friend |
| **the shift** | 28–36 | 0:17–0:22 | **turn** |
| how it actually works | 36–70 | 0:22–0:42 | ≤ 2 mechanism steps |
| the same pain, resolved | 70–90 | 0:42–0:54 | payoff must re-show beat 1's frame |
| landing | 90–100 | 0:54–1:00 | lockup |

### B. Question / answer
Choose when the question is one a viewer would type. The question must be answerable in ≤ 8 words.

| pose the question | 0–8 | 0:00–0:05 |
| the tempting wrong answer | 8–22 | 0:05–0:13 |
| **the answer** | 22–30 | 0:13–0:18 | **turn** |
| why it is the answer | 30–68 | 0:18–0:41 |
| test it on a second case | 68–88 | 0:41–0:53 |
| landing | 88–100 | 0:53–1:00 |

### C. Myth / reality  ← the right structure for our subject
Choose when a *specific nameable belief* is wrong and you can show a single counterexample.
Requires: you can state the belief in one sentence, and you have two cases that the belief says
are identical.

| the belief, stated straight and sympathetically | 0–9 | 0:00–0:05 |
| why people believe it (make it credible) | 9–21 | 0:05–0:13 |
| the counterexample, set up but not fired | 21–37 | 0:13–0:22 |
| **the turn** | 37–40 | 0:22–0:24 | **1–2 s, voice ≤ 5 words** |
| the real mechanism | 40–68 | 0:24–0:41 |
| the corrected rule + its consequence | 68–92 | 0:41–0:55 |
| landing | 92–100 | 0:55–1:00 |

### D. Before / after
Choose when the delta is visible in a single frame. Cold-open on the *after*.

| after (no explanation) | 0–7 | before | 7–20 | **the one thing that changed** 20–30 (**turn**) |
| the change running | 30–65 | after again, now legible | 65–88 | landing | 88–100 |

### E. List with a turn
Choose only when there are N parallel items **and** the last one reframes the others. A list
without a turn is the single most common slop shape and should be refused.
Item budget: **3 at 60 s (≥ 12 s each), 2 at 40 s, 4 only at ≥ 90 s.**

| promise the count | 0–8 | item 1 | 8–28 | item 2 | 28–48 |
| **item 3, which reframes 1 and 2** | 48–72 (**turn at 48**) | the reframe stated | 72–90 | landing | 90–100 |

### F. Single demonstration
Choose when the thing is visible and self-explaining. **The run must be one continuous take of
≥ 30 % of runtime with no cut.** That constraint is the whole structure; break it and this
becomes a bad listicle.

| the claim | 0–8 | what you're about to see | 8–18 | **the run, uncut** | 18–70 |
| the result named | 70–88 | landing | 88–100 |

### G. Story as proof
Choose when a named case carries the general point. **Requires ≥ 1 proper noun and ≥ 1 date or
number inside the first 12 % of runtime**, or it is not a story, it is an anecdote.

| character + moment | 0–12 | what they tried | 12–32 | **what went wrong** 32–46 (**turn**) |
| what it revealed | 46–74 | the generalisation | 74–92 | landing | 92–100 |

### Choosing — a decision procedure, in order

1. Can you state a wrong belief in one sentence, and do you have two cases the belief calls
   identical? → **C**.
2. Is the result visible in one frame? → **D**.
3. Can you show it running for ≥ 0.3 T without cutting? → **F**.
4. Are there ≥ 3 co-equal items **and** a reframe? → **E**. No reframe → refuse the list.
5. Named case with a date? → **G**.
6. Does the audience already hurt? → **A**.
7. Is the topic literally a question people ask? → **B**.
8. None of the above → **you do not have a video, you have a definition.** Stop and find the
   stake. *wicks-v2 opened with "A day becomes four numbers." That is step 8.*

---

## 2. The script

### 2.1 Rate

| source | figure |
|---|---|
| explainer / VO industry standard | **150 wpm**, 140–150 words for a 60-second script ([Biteable](https://biteable.com/blog/video-word-count/), [VideoIgniter](https://videoigniter.com/how-many-words-in-a-60-second-script/)) |
| slow / average / fast read | 1.5 / 2.5 / 3.5 words per second |
| BBC subtitle reading rate | 160–180 wpm, ≈ 0.30 s per word minimum on screen ([Clevercast](https://www.clevercast.com/bbc-subtitling-guidelines/)) |
| Netflix timed text | ≤ 17 cps, min cue **5/6 s**, max 7 s ([Netflix TTSG](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215758617-Timed-Text-Style-Guide-General-Requirements)) |
| **bay / Kokoro, measured** | **2.99 w/s = 179 wpm at `speed: 1.06`** (108 words / 36.15 s over 6 clips) |

**The skill's documented budget is wrong.** `narration.md` says "roughly 2.5 words/second
including pauses" at `speed: 1.06`. Measured on this project it is **2.99 w/s — 20 % faster**.
An agent budgeting words from that figure writes 20 % more words than it thinks, and the render
delivers them 20 % faster than the reference standard. To actually hit 150 wpm:
`speed ≈ 1.06 × 2.5 / 2.99 = 0.89`.

Rules:
- **Delivery 145–160 wpm.** Measure it, don't assume it: `words / result.endSeconds`.
- **Speech density 72–85 %** of runtime for a narrated explainer. Ours: 59 %.
- **Word budget = 0.80 × T × 2.5.** At T = 60: **120 words.** (Not 150 — the industry 150
  assumes ~95 % density with no designed holds.)

### 2.2 Sentence and clip

| rule | number | why it is not gameable |
|---|---|---|
| longest sentence | ≤ 16 words | an agent shortening sentences must *split propositions*, and each split needs a picture move to land on |
| mean sentence | 7–12 words | |
| sentences per narration clip | ≥ 2 | forces an internal caesura the picture can cut on |
| narration clip duration | ≤ 8.0 s | a 10.3 s clip cannot be answered by one picture move; ours was 10.3 s |
| clips per 60 s | 7–10 | |

### 2.3 Reading level

FK grade ≤ 8 / Reading Ease ≥ 65 is the published target
([plainlanguage.gov](https://readabilityformulas.com/learn-how-to-use-the-flesch-kincaid-grade-level/)),
and **wicks-v2 already passes it at FK 5.0.** Ship the rule, but know it is a floor, not a
signal. Reading level is fully gameable — "Reach says nothing about path" is FK 2.3 and means
nothing. The load-bearing rules are §2.2 and §2.4.

### 2.4 Concrete nouns, and the line a picture can answer

Every noun in the script falls in one of three buckets:

| bucket | definition | where it may appear |
|---|---|---|
| **drawable** | it is on screen right now as a primitive (candle, body, wick, bar, line, square) | VO **and** on-screen label |
| **stake** | a cost, a consequence, a person, a thing you can lose (stop, risk, money, day) | **VO only** |
| **abstract** | reach, path, measurement, total, distance, variance, session | **budget: ≤ 2 per 60 s** |

wicks-v2's abstract-noun count: **reach ×2, path ×1, measurement ×1, total ×1, distance ×1,
session ×3, market ×2 = 11 abstract nouns in 108 words**, against a drawable count of 3
(mark, body, wick). That inversion is the actual reason the script feels like a textbook.

**The strike test** — for every line `L` and its beat picture `P`, classify:

| result of deleting L | classification | action |
|---|---|---|
| P still communicates the same proposition | **redundant** | cut the line |
| P becomes meaningless | **orphan** — L was a caption | move the words on screen, write a new line |
| P becomes incomplete but still meaningful | **complementary** | keep |

Only complementary lines survive. Applied to wicks-v2: **4 of 6 lines are redundant** (L2, L4,
L5, L6 all restate in prose the formula or comparison already on screen at that instant); L1 is
an orphan; L3 is the only complementary line and it arrives at 55.6 s.

**How to write a complementary line:** the line must perform a *speech act the picture cannot*.
Declare one per line from this closed set — anything outside it belongs on screen:

`stake` · `consequence` · `causation` · `contradiction` · `concession` · `instruction` ·
`address` · `prediction` · `verdict`

Lines whose act is `name`, `describe` or `enumerate` are captions wearing a voice.

### 2.5 Before / after rewrite of a real line

**Before** — clip 4, t = 33.80–40.77, while `W = R − |r|` and `r = C − O` are on screen:

> "Take the net move out of the total, and what remains is precisely the distance the market
> covered and then gave back."

22 words · 1 sentence · 6.97 s · **189 wpm** · FK 9.6 · 0 second-person · 0 stake nouns ·
4 abstract nouns · speech act = `describe` · **strike test: redundant** — it is the on-screen
formula read aloud in English.

**After:**

> "Subtract the net move. What's left never went anywhere. That's the part that hunts stops."

17 words · 3 sentences (4 / 5 / 6) · 6.80 s at 150 wpm · FK 1.2 · Reading Ease 97 ·
speech acts = `instruction` → `verdict` → `stake` · contains one stake noun ("stops") that
appears nowhere on screen · **strike test: complementary** — kill the line and the picture still
shows the subtraction, but "hunts stops" is gone and with it the reason to care.

Three sentences also hands the picture three landing points 2.0 s apart, which is where the three
formula glyphs fly in. One 22-word sentence hands it nothing.

---

## 3. Narration vs caption vs on-screen text

wicks-v2 runs all three at once. Measured:

- narration ↔ caption token overlap: **1.00** (correct by construction — captions mirror speech)
- **static on-screen text: 35 blocks, 100 word-tokens** — 0.93 tokens on screen per spoken word
- **peak simultaneous text: 47 words across 16 blocks at t = 45.20 s** (beat 4's card and beat 5's
  card are both live for 300 ms — the same collision class as the "Different day." occlusion at
  19 s)
- mean words on screen across the runtime: **20.4**

At t = 36.5 s the frame carries `WHAT THE RANGE DROPS`, `W = R − |r|`, `r = C − O`, `TREND`,
`ROUND TRIP` and a caption reading "what remains is", while the voice says the same proposition a
fourth time. Three encodings of one idea, plus a caption fragment that is not a phrase.

### The allocation rule — one proposition, one channel

| proposition type | channel | forbidden |
|---|---|---|
| a number, a value, a unit | **on-screen text** | speaking it |
| a symbol, formula, identifier | **on-screen text** | speaking it as words |
| a label naming a thing on screen (≤ 2 words, anchored to the thing) | **on-screen text** | speaking it |
| a comparison the eye can make (same, bigger, gone, twice) | **picture geometry** | text *or* voice |
| causation, consequence, stake, contradiction, concession, address, instruction | **narration** | on-screen text |
| provenance / citation | post description, or a ≤ 2 s corner credit **during** the body | the terminal frame |
| the one thing to remember | **the lockup** — once, at the end, and never verbatim before it | repeating it mid-video |

**Captions are a mirror of narration, never a third channel.** Turn them on iff the video ships
to a sound-off surface. When they are on, the on-screen text budget **halves**, because the
caption band is now carrying words.

Budgets, per 60 s:
- on-screen text tokens total: **≤ 0.35 × narration words** (ours: 100 / 108 = **0.93**)
- visible text objects at any instant: **≤ 4** (ours: peak 16)
- words on screen at any instant, captions included: **≤ 12** (ours: peak 47)
- text objects encoding the *same* proposition, simultaneously: **1** (ours: 3–4 per beat)

### Caption cue rules (all violated by the current cut)

| rule | source | wicks-v2 |
|---|---|---|
| ≥ 0.30 s per word | BBC | **15 of 38 cues violate** (worst: "you where it", 0.142 s/word) |
| min cue duration 5/6 s = 0.833 s | Netflix | **8 of 38 below**, min 0.36 s |
| ≤ 17 cps | Netflix | **18 of 38 over**, max 28.7 cps |
| never straddle a sentence boundary | — | **2 violations**: `"about path A"`, `"ended The wick"` |
| never end on a closed-class word | — | **11 of 38**: "move out **of**", "the total **and**", "what remains **is**", "you where **it**" … |
| never orphan a 1-word cue | — | **1**: "back" |

**Root cause is one thing:** the cues are derived from Kokoro word timings, and the narration was
delivered at 179 wpm. Slow the read to 150 wpm and a 3-word cue gets 1.20 s — above every floor
above, automatically. **The caption defects are a symptom of the delivery rate, not of the
chunker.** (The chunker still needs a merge-on-underrun fix — see §8 gap 4 — because it currently
honours `minCaptionSeconds` only "into genuinely free time", and contiguous cues never have any.)

---

## 4. Pacing and silence

### Is 25 s of silence a feature or a bug?

**The ratio is a mild bug (40.8 % vs. a 15–28 % target). The distribution is a severe bug, and
what the picture does underneath it is the actual defect.**

wicks-v2's six silences: 3.20, 4.42, 4.70, 5.23, 4.98 s (plus 0.80 head, 1.53 tail).
Mean 4.51 s, spread 2.0 s — six near-identical pads, one per beat, always in the same place
(after the voice, before the next beat). And the evidence's frame sampling found pairs 5 s apart
that are *identical*: the picture is not moving through them. **Silence over a static frame is
dead air; silence over motion is a beat.**

Rules:

| rule | number | gaming answer |
|---|---|---|
| total silence | 15–30 % of T | can't be gamed alone; pair with the next three |
| longest single silence | ≤ 2.5 s | an agent that pads must now pad in many places, which the next rule catches |
| **every voiceless window ≥ 0.8 s must contain visible change** | luma delta ≥ 2/255 over ≥ 3 % of pixels between `w_start+0.15` and `w_end−0.15`, sampled from real frames | animating an invisible element does not move pixels; animating a decorative tick moves < 3 % |
| declared **holds** (silence ≥ 1.5 s) | ≤ 1 per 12 s of runtime, each declared in the beat sheet with a reason | forces the agent to name what the hold is for |
| **≥ 1 window ≥ 1.5 s in which the picture makes its largest single move with no voice** | max transform delta of the video occurs inside a voiceless window | an agent cannot satisfy this by adding noise; it has to *move the hero* while silent |
| picture leads voice | each beat's first picture change precedes its first spoken word by **0.15–0.40 s** | ours: L1 starts at 0.80 s while the headline is still fading in until 1.05 s — the voice led the picture |

### How long a beat holds

- **Floor: reading time.** 1.1 s per line of on-screen text, minimum 1.6 s for any beat with text.
- **Ceiling: 0.18 T** (10.8 s at 60 s) for any beat except a declared single-demonstration run.
  wicks-v2's beat 3 is **15.3 s = 0.25 T**.
- **Count: ≥ 7 beats at 60 s**, and the durations must include **at least one ≤ 0.04 T (≤ 2.4 s)**
  and **at least one ≥ 0.12 T (≥ 7.2 s)**. The short one is, in practice, always the turn. This
  is the anti-uniformity rule that a coefficient-of-variation check cannot give you, because CV
  is satisfiable by two long beats and five medium ones.

---

## 5. The turn

**Definition:** the single instant at which the viewer's model updates. Before it they believe X;
after it they believe not-X and know why. Every structure in §1 except F has exactly one.

**Position:** **0.35–0.42 T**. At 60 s that is **21–25 s**. Earlier and the belief has not been
made credible enough to be worth overturning; later and there is no time to build the corrected
model. wicks-v2 nominally turns at 18.0 s ("Same range. Different day.") — but see below, it
does not actually turn.

**Duration: 1.2–2.5 s.** It is the shortest beat in the video. wicks-v2's turn beat is **15.3 s**,
which is not a turn, it is a chapter.

**Voice at the turn: ≤ 5 words, or none.** After a 15–18 word line, a 3-word line is itself the
signal. wicks-v2 puts a **29-word, 10.3-second run-on** on its turn.

### Why wicks-v2 has no turn even though it has a turn beat

The turn beat is staged **identically to every other beat**: same kicker at y = 0.136, same serif
headline at y = 0.18–0.34, same dark card, same caption slot at y = 0.735, same colours, same
type sizes, same left column at x ≈ 0.085. Nothing about the frame says *something just changed*.
A turn that is not staged differently from its neighbours is not a turn — it is a paragraph
break.

### The turn signal — 3 of 6, inside one 0.5 s window

A single axis is trivially gamed. Require **at least 3 of these 6 to fire simultaneously within
±0.25 s of the declared turn time**:

| # | axis | threshold |
|---|---|---|
| 1 | scale | the largest picture element changes scale by ≥ 1.5× |
| 2 | composition | the centroid of visible non-decorative elements moves ≥ 0.12 of frame height |
| 3 | colour | a hue not present on ≥ 1 % of pixels in the preceding 8 s appears on ≥ 2 % of pixels |
| 4 | bed | music level changes by ≥ 6 dB and returns within 1.0 s |
| 5 | one-shot | a single transient at ≥ 1.2× the bed's peak lands within ±0.15 s of the turn |
| 6 | text load | visible text objects drop to ≤ 1 (ideally 0) for ≥ 0.8 s |

Axes 1, 2, 3 and 6 are measurable from sampled frames; 4 and 5 from the audio graph. **Axis 6 is
the one an agent hates**, because it forces it to delete text at the most important moment — and
it is exactly what wicks-v2 could never do, since its layout is a text template.

wicks-v2 at its nominal turn (18.0 s) fires **0 of 6**: no scale change, no centroid move, the
accent `#FF5B5B` does not appear until 33 s, the bed continues at the same level, no transient
above the bed peak, and text load goes from 5 objects to 6.

---

## 6. The ending

### What the last 3 seconds do

1. **Restate the one thing** — ≤ 7 spoken words, or one glyph, or both. Not a summary; the single
   line the viewer repeats to someone else.
2. **Complete a motion.** The last animation should finish 0.4–0.9 s before the cut. Ending on a
   frame that has been static for 1.5 s reads as the file running out.
3. **Close the loop.** The terminal composition should either return to the hook's exact framing
   (callback) or be a composition used nowhere else (arrival). wicks-v2 does neither: it returns
   to the *fourth* beat's card.
4. **Add something.** Measured: the last 6.4 s of wicks-v2 (`IN ONE LINE` / `W = R − |r|` /
   `W = 0.00` / `W = 3.92`) contains **zero tokens that had not already appeared** — `W = R − |r|`
   was on screen at 33.0 s, `W = 0.00` and `W = 3.92` at 33.0 s. The final 1.53 s has no voice, no
   entrance and no exit. It is a recap card followed by dead air.

### Why a citation card is a bad ending

(Note for the record: wicks-v2's actual ending is a **formula-recap card**, not a citation card —
verified by dumping all 73 text elements and the frame at 60.6 s. Same failure class, so both are
covered.)

- It spends the **highest-retention real estate in the piece** — the loop point, the frame a
  viewer sees twice — on provenance nobody screenshots.
- It converts the last emotional beat into an administrative one. The arc ends on *bookkeeping*.
- It **breaks the loop**: a short that ends on a static card does not re-enter frame 1 cleanly, so
  autoplay replays read as a stutter rather than a rhyme.
- Sources belong in the post description, or as a ≤ 2 s corner credit **during** the body, at the
  moment the sourced number is on screen — where it also does more for credibility.

Rule: **the terminal 3 s must contain ≥ 1 element or token that appears nowhere earlier**, and
**≤ 2 visible text objects**.

### CTA or no CTA

| condition | verdict |
|---|---|
| there is a specific named next action (a repo, a tool, a link) | CTA allowed, **≤ 5 words**, over the lockup, **not the last audio** |
| there is no product, only an idea | **no CTA.** Use a callback to the hook instead — it is a stronger loop signal and costs 0 s |
| the CTA would require a new composition | **no CTA** — it is a second ending |

A generic "follow for more" costs ~2.5 s of a 60 s piece (4 %) and replaces the payoff with a
transaction. Refuse it unless the first row applies.

### The lockup

The terminal composition. Exactly:

- **one** text object — the mark — at ≥ 12 % of canvas height
- **one** accent, on the one thing the mark refers to
- held **1.2–2.5 s**, with the final motion landing inside that window
- containing nothing that has to be read for the first time

---

## 7. The worked example — how wicks-v2 should have been written

Subject: `R = H − L` (range), `r = C − O` (net move / body), `W = R − |r|` (total wick),
`W²` as a variance-like volatility proxy.

**Structure: C, myth / reality.** Chosen by §1's procedure at step 1 — the belief ("the range
tells you how violent the day was") is stateable in one sentence, and two candles with identical
range are exactly the pair the belief calls identical.

**Stake (the thing wicks-v2 never says): you size risk off the range, and on a round-trip day the
range is mostly noise your stop sits inside.**

Thesis, landing by beat 3: *range measures reach; the wick measures the round trip, and the round
trip is the part that costs you.*

### Script

| # | line | words | s @150 wpm | speech act |
|---|---|---|---|---|
| 1 | Two days. Identical on paper. One would have taken you out. | 11 | 4.40 | stake |
| 2 | Range is high minus low. It's the number your risk is sized from. | 14 | 5.60 | causation |
| 3 | So here's the test. If two days give the same number, they carried the same risk. | 17 | 6.80 | prediction |
| 4 | **They did not.** | 3 | 1.20 | verdict |
| 5 | The range counts the trip out and the trip back as one distance. It can't tell them apart. | 18 | 7.20 | causation |
| 6 | Subtract the net move. What's left never went anywhere. That's the part that hunts stops. | 17 | 6.80 | instruction → verdict → stake |
| 7 | Square it, and you get a volatility number that doesn't care which way the day went. | 17 | 6.80 | consequence |
| 8 | The day that would have taken you out is the one on the right. | 14 | 5.60 | verdict (callback to line 1) |
| 9 | The body is the story. The wick is the cost. | 10 | 4.00 | landing |

**121 words · 48.40 s of speech · 150 wpm · 17 sentences · mean 7.1 words · longest 17 ·
FK 1.4 · Reading Ease 98 · speech density 80.7 % · silence 11.60 s (19.3 %) · longest silence
2.50 s.** Second person in sentence 1 ("you"). Stake token ("taken you out") in sentence 1.
Kokoro setting: `speed: 0.89` (from the measured 2.99 w/s at 1.06).

### Beat sheet

Nine beats. **Each beat is its own scene** — that alone makes every per-scene check in
`check.rs` capable of firing, which on a one-scene project it arithmetically is not.

| # | span | dur | role | VO (start–end) | on-screen text | picture | audio | seam |
|---|---|---|---|---|---|---|---|---|
| **1** | 0.00–5.00 | 5.00 | **hook** | 0.30–4.70 · L1 | *nothing until 3.30*, then `SAME RANGE` 176 px (9.2 % H) wipe-on L→R 0.32 s | **frame 1 is already composed** — two bone candles, 0.34 H, at x 0.32 / 0.68, no fade-up. 0.30: hairline rule snaps across both highs (0.18 s expo-out). 0.52: rule across both lows. 1.20: the two rules clamp inward 3 % and settle (0.35 s spring-out) — a *measuring* gesture | bed from t=0, 0.4 s rise; dry clack on each rule | hard cut on "out" |
| **2** | 5.00–12.60 | 7.60 | belief | 5.30–10.90 · L2 | `H` 96, `L` 96, `H − L` 120, **`4.20` 300 px (15.6 % H)** | right candle exits right (0.45 s power4-in). left candle travels to x 0.30 and grows to 0.62 H (0.65 s expo-out). range bar fills bottom→top 0.9 s. numeral counts 0.00→4.20 in 0.85 s, lands 7.60 | bed at level; soft tick per count decade | **HOLD 1** 10.90–12.60 (1.70 s): numeral holds, whole card push-in 3 %, voice off |
| **3** | 12.60–22.00 | 9.40 | setup | 12.90–19.70 · L3 | single `4.20` 300 px centred; `TREND` 84; `ROUND TRIP` 84 | candle A shrinks to 0.44 H, slides to x 0.28. candle B rises from below at x 0.72 (0.60 s spring-out, 6 % overshoot) — long wicks, tiny body. **both `4.20` labels slide to centre and dock into one numeral** (0.55 s power4-out, lands 17.10) | bed thins (HP filter) from 20.6; long riser | **HOLD 2** 19.70–22.00 (2.30 s): two candles under one number. hairlines draw from each candle to the shared numeral over 1.2 s. **This is the loaded gun and it is silent** |
| **4** | 22.00–23.60 | **1.60** | **TURN** | 22.20–23.40 · L4 (3 words) | **none — 0 text objects for 1.6 s** | at 22.00 exactly: shared numeral scales 1.25× and ejects up out of frame (0.30 s power4-in); both candles snap to **1.65×** (0.22 s expo-out); centroid drops y 0.40 → 0.55; **candle B's wicks turn accent — first appearance of the accent in the video** (0.18 s) | bed −18 dB for 0.35 s; sub-drop at 22.02 at 1.4× bed peak; bed returns +4 dB above its beat-3 level | cut |
| **5** | 23.60–32.70 | 9.10 | mechanism | 23.90–31.10 · L5 | `OUT` 84 on A's stroke; `AND BACK` 84 on B's | on A an arrow traces open→close in one stroke (1.0 s) and the range bar collapses onto it — same length, tick on coincidence. on B the path goes up / back / down / back (4 × 0.5 s) while **B's range bar does not change** and a path-length tally racks up beside it | ticks on each stroke reversal | **HOLD 3** 31.10–32.70 (1.60 s): B's path replays once at 2× speed, voice off |
| **6** | 32.70–41.40 | 8.70 | the fix | 33.00–39.80 · L6 | **`W = R − |r|` at 232 px (12.1 % H) — the largest type in the video** | the formula assembles one glyph at a time, each flying **from the thing it names**: `R` from the range bar, `|r|` from B's body, `W` from the wicks (which light accent as it leaves). assembled 36.0. then both wicks lift out of the candles and stack right as two bars — A's a stub, B's near full range | impact on each glyph landing, descending in pitch | **HOLD 4** 39.80–41.40 (1.60 s): the two wick bars settle, voice off |
| **7** | 41.40–49.00 | 7.60 | consequence | 41.70–48.50 · L7 | `W²` 260 px, and nothing else | each wick bar extrudes into a **square of its own side length** — A's is a dot, B's fills 0.42 of the frame. the *area* difference is the argument and it is shown, never stated. counter runs on B's square only | riser into the square growth, resolves on land | 0.80 s hold |
| **8** | 49.00–55.10 | 6.10 | payoff | 49.30–54.90 · L8 | `STOP` 84 on the line | **the hook's composition returns** — two candles at beat 1's size and position. a stop line draws across both at equal distance below each open. on A it is never touched; **on B the lower wick pierces it**, the line flashes accent 4 frames, then dims | one dry impact at the crossing (51.9) | 0.20 s |
| **9** | 55.10–60.00 | 4.90 | **landing / lockup** | 55.40–59.40 · L9 | `W = R − |r|` 232 px (2nd and last appearance); `COST` 96 px accent, lands 58.90 on the wick | everything except candle B's wick fades to 12 % over 0.6 s. the wick stays. formula re-enters at 56.60 (0.35 s power4-out) beneath it. **last motion completes 59.25; cut at 60.00** | bed resolves, no new one-shot after 58.9 | **loop**: the terminal composition matches frame 1's framing, so autoplay replay reads as a rhyme, not a stutter |

### What this beat sheet satisfies, by number

| rule | plan | wicks-v2 |
|---|---|---|
| beats | 9 | 6 |
| scenes | 9 | **1** |
| longest beat | 9.40 s (0.157 T) | 15.30 s (0.251 T) |
| shortest beat | 1.60 s (0.027 T) | 6.40 s (0.105 T) |
| roles present | hook, belief, setup, **turn**, mechanism, fix, consequence, payoff, landing | explain ×6 |
| turn position | 22.00 s = 0.367 T | none |
| turn duration | 1.60 s | n/a |
| turn signal axes firing | 6 of 6 | 0 of 6 |
| words | 121 | 108 |
| wpm | 150 | 179 |
| speech density | 80.7 % | 59.2 % |
| longest silence | 2.50 s | 5.23 s |
| declared holds | 4 (one per 15 s) | 0 (6 undeclared pads) |
| first "you" | 0.30 s (1.5 % T) | 56.55 s (92.7 %) |
| first stake token | sentence 1 | 49.48 s (81.1 %) |
| on-screen text tokens | ~19 | 100 |
| peak simultaneous text objects | 4 | **16** |
| frames with 0 text objects | 1.6 s (the turn) | 0 |
| new tokens in last 3 s | `COST` | **0** |
| hero type size | 300 px = 15.6 % H | 96 px = 5.0 % H |

**Use this as the benchmark brief.** Hand the agent §7's script and beat sheet verbatim and
render it. If the output does not look like a different video from wicks-v2, the problem is not
the brief.

---

## 8. What bay cannot check today

`check.rs` (2193 lines) can read the project model only. It has **no element roles, no beat
structure, and no frame access**, which is why every rule that would have caught wicks-v2 is
currently unexpressible. Two things found while reading it:

**`no-hook` is dead code on this project.** `hook_findings` returns `Vec::new()` — clearing the
check — the moment it meets *any* shape in the first 2 s whose scale is below `GROUND_SCALE`
(0.95), on the reasoning that "a composed shape in the opening is a hook"
(`check.rs:1186-1191`). wicks-v2 has 14 tick-mark rects of scale 0.0074 × 0.025 alive from t=0.
**An 8 × 48 px rectangle satisfies `no-hook`.** The frame at t = 0.5 s is black except those
ticks, and the check cannot say so.

**`no-hook` also never reads the words, and never evaluates opacity at t.** `head1` animates from
opacity 0 (hold to 0.50 s) to 1.0 at 1.05 s — so the headline is invisible for the first half of
the hook window — and the check measures only `font_size × scale × scale_y`, statically.

Gaps, in the order they unblock rules in this file:

| # | capability | unlocks |
|---|---|---|
| 1 | **element `role`** (`hook`/`headline`/`kicker`/`label`/`caption`/`lockup`/`data`/`decoration`) on every element, set by `add_text`/`add_shape` and automatically by `narrate` | the entire §3 allocation rule; caption-specific checks; "text objects encoding one proposition"; distinguishing a decorative tick from the hook |
| 2 | **a beat sheet in the project** — `beats: [{id, start, end, role, proposition, vo_line, hold, hold_reason}]` (markers today carry only `{id, time, label}`) | §1 structure verification, §4 hold budget, §5 turn detection, §6 landing rules, and the *declaration* half of every rule — without a declared role an agent cannot be held to a role's constraints |
| 3 | **frame sampling inside `check`** (render N thumbnails at ~64×114, 4 fps, compute luma delta / hue histogram / ink coverage per window) | §4's "the picture must move through the silence", §5 axes 1–3 and 6, and every anti-gaming rule in this file. Model-only checks are gameable by construction: they measure intent, not pixels |
| 4 | **`narrate` retains sentence boundaries and merges cues on underrun** (never emit a cue crossing a `.`/`?`/`!`; merge when `duration < 0.30 × words`) | fixes 15 BBC-rate violations, 8 sub-833 ms cues, and both sentence-straddling cues, measured above |
| 5 | **`narrate` reports and targets words/second** (`wordsPerSecond` in the result; `targetWordsPerSecond` picking `speed`), plus a hard reject above 8.0 s per clip | §2.1 — the skill's documented 2.5 w/s is 20 % off the measured 2.99, and nothing today measures it |
| 6 | **hard-fail `scenes.len() == 1` above 15 s runtime** | every per-scene check in `check.rs` degenerates to nothing on a one-scene project; this is the single highest-leverage line of code in the file |
