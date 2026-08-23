# The scarcitycircle explainer format

A reverse-engineering study of `downloaded-assets/scarcitycircle/` (78 video posts,
19 image posts, public Instagram account about price-action trading). Reference
material only — nothing in this document quotes their scripts or reuses their artwork.
The goal is a reproducible recipe; the companion skill is
`.claude/skills/explainer-short/`.

## Corpus and method

The account has **two eras**. The earlier ~50 videos (median 51 s, range 5–80 s) are
music-only chart animations — a looping candle build over a beat, no voice. The later
**28 videos are narrated explainers** (median 132 s, range 28–178 s), and that is the
format this study characterizes and the skill reproduces. The split was detected by
transcript word count (>20 words spoken).

How the corpus was sampled:

- **All 78 videos** probed (ffprobe), scene-detected (ffmpeg `scene>0.2`), and frame-
  extracted (a montage tile every 0.8 s plus six full-res frames each).
- **All 28 narrated videos** transcribed with whisper (`ggml-small.en-q5_1`, the model
  bay's own STT runtime ships) and measured centrally: words/second, sentence lengths,
  hook/turn/close detection over timestamped sentences.
- **9 narrated videos** got freeze-fraction and audio-mix (ebur128) measurement.
- **6 videos analyzed deeply by hand**: frame-by-frame montage reading, pixel sampling
  for palette and type metrics, beat-by-beat say-vs-show against the transcript
  (`Db3bMNWxKqX`, `DaxFl_VRCAV`, `Da3Ze0Don6q`, `Dann1-ixC1e`, `DZfcDA_x-cH`,
  `DaxPnt_RWTo`).
- **All 78 videos analyzed by parallel workers** against a fixed observation schema
  (structure, per-beat say-vs-show, typography fractions, palette hexes, entrances,
  audio). Worker classification: 39 chart-explainers, 15 text-card pieces, 20 mixed
  (mostly chaptered cheat-sheet templates), 4 other.

Worker consensus on the 39 chart-explainers (which spans both eras): serif type in
38/39, title underline in 27/39, background `#000000` or a near-black variant in all,
zero hard cuts in 36/39 (75/78 across the whole corpus), a detectable turn in 36/39,
beat count 5–14 (median 8). Close types across them: CTA 17, restate 11, punchline 4,
callback 4, question 3. Say-vs-show relations coded per beat: literal staging 146,
second-idea 24, compressed-echo 11, complement 2 — the screen usually *stages the
sentence as a case* rather than carrying an unrelated idea. Where any number is spoken
it is shown (18 of 20 videos that speak one); an equal number of videos speak none at
all and leave every figure to the screen.

## The DNA

One take, no cuts. A **black void** (`#000000`, 94–99 % of all pixels) on which a
TradingView-style candlestick diagram **accumulates for the whole runtime** — nothing
is ever torn down and rebuilt; annotations pile onto the same chart the hook started.
A serif chapter lockup sits in the top ~12 % of frame and swaps text as the argument
advances. A one-line serif caption in a near-black pill sits at ~92 % frame height and
paraphrases — never subtitles — the narration. Voice enters at 0.0 s over a barely-there
music bed. The visual grammar is *drawing as proof*: every claim the voice makes is
immediately staged on the chart as a concrete case, labeled with 1–4 word annotations.

## Canvas and palette

- 720×1280 (9:16) at 30 fps, every video. All content respects roughly a 7 % side margin.
- Background pure black `#000000`. Faint horizontal gridlines `#090909`–`#131313`
  (barely above black; they read as texture, not chart furniture).
- Candles: green `#26a69a`→sampled body `#3f926d`, red `#ef5350`→sampled body
  `#c36b68` (TradingView defaults, slightly dimmed).
- Text: white `#ffffff` (titles), `#abadb3` at caption size (antialiased white).
- **One accent hue per video**, used for the concept word in the lockup, key labels,
  and annotation chrome: periwinkle `#a297ff` / salmon `#ff8f80` / gold-orange
  `#d49a7c`–`#e8a87c` observed in the deep dive; workers most often sampled gold
  `#f0c800` across the corpus. Red `#f36254`/`#f02840` is reserved for danger/violation
  marks, blue `#918df0` for highlight circles.
- Caption pill: `#0a0b12` (near-black, ~4 % lighter than bg) with white serif text.

## Structure and pacing

| measure | value |
|---|---|
| runtime | 88–178 s typical; median 132 s; two short outliers (28, 50 s) |
| hard cuts | **0** in 26 of 28 narrated videos (scene>0.2 never fires) |
| speech onset | 0.00 s in all 28 — voice on frame one |
| hook | first sentence, 6–34 words (median 13), ends 2.0–8.4 s (median ~5 s) |
| first visual event | candles already printing by t≈0.5–1.0 s; lockup fades in ~1–3 s |
| turn | verbal contrarian pivot ("what most traders miss…") in ~half the transcripts, at 7–48 % of runtime, median 22 %; workers found a *visual* turn (staging change) in 32/35 chart-explainers |
| chapters | 3–6 lockup text swaps per video, i.e. one per 25–45 s |
| motion events | one per ~2.5–4.5 s (39–46 freeze intervals per ~2 min video) |
| holds | static 40–84 % of runtime; single holds up to 5.3 s |
| close | didactic restatement + soft CTA ("follow for more…", "curriculum on my profile"); 3/28 transcripts end on a question. Worker coding across 35: CTA 15, restate 10, punchline 4, callback 4, question 2 |

Words: 204–513 per video (median 330). The script is the skeleton; the chart follows it.

## Narration

- **2.16–3.02 words/second** (median 2.51) — deliberate, teacher-paced, well under
  the 2.8–3.3 of hype-style shorts.
- Sentences 5.2–14.0 words average (median ~9.5). Declarative, second person.
- Register: precise trader vocabulary used unapologetically (liquidity, order block,
  fair value gap, sweep) but every term is *defined by the drawing* the moment it is
  spoken. No filler, no "hey guys", no self-reference until the CTA.
- Rhetorical spine: *misconception → mechanism → two cases (it holds / it fails) →
  rule of thumb → CTA.* The two-case contrast (continuation vs. rejection) appears
  in nearly every deep-analyzed video.

## Say-vs-show (the core of the format)

The voice and the screen are **complementary channels, not mirrors**:

- The voice carries *causation and generality* ("when price returns to this level,
  those orders defend it"). The screen carries *one concrete case* — an actual candle
  sequence staged to demonstrate exactly that sentence.
- The caption pill **compresses, never transcribes**. Voice: "…or the level fails to
  hold and price breaks through" → pill: "or it fails to hold". 3–8 words, always
  shorter than the sentence it accompanies, swapped every ~3–6 s.
- On-chart labels are **1–4 word noun phrases in caps** ("LIQUIDITY SWEEP",
  "TOO FAST"), placed next to the thing they name, in the accent color. They appear
  at the moment the term is first spoken — the spoken definition and the visual
  instance are synchronized to within a beat.
- Spoken numbers are rare; when structure matters ("two equal highs") the chart shows
  exactly that count, circled.
- A signature correction device: the wrong word is stamped, struck through, and swapped
  for the right one on the spoken beat ("don't chase PRICE" → strikethrough → "chase
  LIQUIDITY"). Workers found it across every era of the corpus.
- At the moment of the key claim the newest element is always the most visually
  active thing on screen (brightest, moving, or freshly stamped).

## Motion grammar

- **Additive, never substitutive.** Candles print one at a time (~0.3–1 s apart in
  build phases); zones, dashed levels, circles, and arrows are stamped on top. The
  chart never resets; later chapters annotate the same price history.
- Element entrances: candles grow (scale-from-baseline); lockups and labels fade
  (~0.2–0.4 s); levels draw on left→right; circles pop in. No slides across frame,
  no masks, no camera moves.
- Occasional slow x-pan of the whole chart as new candles need room.
- Between events the frame **genuinely freezes** (see gate tension below).
- Motion resolves *with* speech: an element lands as its sentence lands, then holds
  through the explanation.

## Typography and composition

- Everything is **serif** (a Georgia/Playfair-class face), including the caption —
  unusual for the genre and a big part of the look.
- Chapter lockup: 1–2 lines, ALL CAPS, centered, top edge of the text ~2–14 % from the
  top of frame (median 6 % across 39 worker-measured videos). Line cap-height
  **1.6–4.1 % of frame height in the narrated era** (worker median 2.3 % across all
  eras, with listicle-style titles reaching 8 %; the deep-dive titles measured 2.7–4.0 %);
  the concept word takes the accent color and often the larger size; a thin white/accent
  underline rule sits beneath (~55 % of frame width; present in 25/35).
- Kicker/status line (when present): ALL CAPS, cap-height **1.3–1.9 %**, accent color,
  centered under the lockup.
- On-chart labels: caps, ~1.6–1.9 % cap-height, accent color, adjacent to referent.
- Caption lane: present in **19 of 28 narrated videos** (and only 5/50
  music-only ones — it is a narrated-era feature); the rest stage the spoken words as
  in-scene labels instead. Where present: centered, y 0.62–0.92 (the deep-dive pills sit
  at **91–93 % frame height**), text cap-height 1.1–2.2 % (median 1.6 %), bare text or a
  dark pill `#0a0b12` with generous padding, one line only, swapped per phrase.
- Composition: chart occupies the middle 50–70 % vertically; the eye path is
  lockup (what we're learning) → newest chart element (the case) → pill (the takeaway).
  Enormous negative space is deliberate — early frames are >95 % black.

## Audio bed

- Voice at −15.8 to −20.1 LUFS momentary. Music bed nearly subliminal: in speech gaps
  the bed measures −25 to −35 LUFS, i.e. **8–17 LU below voice**; in several videos
  gaps are effectively silent (bed −70/absent).
- No audible ducking pumping — the bed is simply mixed very low and constant.
- No transition sound effects detected in the deep-analyzed set; the format relies on
  visual stamps, not whooshes.

## Rigid vs. variable

**Load-bearing (never varies):** black canvas; single continuous accumulating scene
with zero cuts; serif type; voice from frame one; say-vs-show discipline (screen stages
the case, voice carries the cause, on-screen text compresses); one-accent-plus-chart-
semantics palette; additive annotation; 2.2–3.0 wps narration; lockup-top /
chart-middle vertical order.

**Free (varies per video):** accent hue; runtime (88–178 s); whether an explicit
verbal turn exists and where (7–48 %); chapter count (3–6); close type (CTA vs restate
vs punchline vs question); kicker presence; how much of the chart pans; whether the
paraphrase lane is a bottom pill (19/28 narrated) or in-scene labels (the rest).

## Per-video measurements (28 narrated videos)

Measured centrally from probes, transcripts, freeze detection, and ebur128. "–" =
not in the measured subset for that column. (`DbBq8XSo9P5`'s whisper output carried
no punctuation, so its hook/sentence parse is unreliable.)

| video | dur (s) | words | wps | avg sent | hook words | hook ends (s) | turn @ | freezes | frozen frac | max hold (s) | voice M (LUFS) | bed gap M | sep (LU) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Db3bMNWxKqX | 151 | 370 | 2.45 | 9.5 | 10 | 3.9 | 16% | 43 | 0.45 | 3.5 | -20.1 | -32.8 | 12.7 |
| DbwP9rbIVG0 | 165 | 435 | 2.65 | 6.8 | 7 | 3.0 | 2% | 45 | 0.40 | 3.4 | -17.6 | -25.3 | 7.7 |
| Dbq3mTUSF5o | 131 | 323 | 2.51 | 12.0 | 17 | 6.7 | 22% | – | – | – | – | – | – |
| DbnsSFPIsD2 | 118 | 328 | 2.80 | 9.1 | 22 | 8.3 | 7% | – | – | – | – | – | – |
| DblVgLvRcey | 113 | 285 | 2.55 | 8.1 | 13 | 4.8 | 48% | – | – | – | – | – | – |
| DbeOLf_oCjU | 158 | 344 | 2.16 | 9.3 | 34 | 13.1 | 26% | 46 | 0.46 | 3.5 | -19.3 | -35.1 | 15.8 |
| DbY16CtSNcg | 171 | 492 | 2.88 | 12.3 | 25 | 8.4 | – | – | – | – | – | – | – |
| DbWW6NBIkZ3 | 88 | 204 | 2.34 | 5.8 | 6 | 2.0 | 31% | – | – | – | – | – | – |
| DbTzQffICF7 | 28 | 70 | 2.60 | 14.0 | 70* | 27.0* | – | 6 | 0.45 | 4.4 | -17.8 | – | – |
| DbOht6KoOdR | 178 | 384 | 2.17 | 8.8 | 14 | 6.0 | 11% | – | – | – | – | – | – |
| DbLRu2xofeT | 166 | 429 | 2.59 | 10.7 | 10 | 3.3 | 44% | – | – | – | – | – | – |
| DbG-CgYIhCD | 142 | 332 | 2.33 | 10.1 | 13 | 4.5 | – | – | – | – | – | – | – |
| DbBq8XSo9P5 | 125 | 332 | 2.66 | 12.3 | –* | –* | – | – | – | – | – | – | – |
| Da_IgB2ozBx | 178 | 463 | 2.65 | 11.0 | 23 | 7.1 | – | – | – | – | – | – | – |
| Da53zFSIE3m | 170 | 513 | 3.02 | 9.7 | 32 | 10.0 | – | – | – | – | – | – | – |
| Da3Ze0Don6q | 132 | 321 | 2.43 | 9.4 | 16 | 5.0 | 22% | 42 | 0.59 | 4.2 | – | – | – |
| Da09abUTM3Y | 172 | 399 | 2.39 | 9.1 | 12 | 5.1 | – | 45 | 0.57 | 5.3 | -18.8 | – | – |
| DaySNmCTziI | 116 | 251 | 2.25 | 8.1 | 13 | 5.5 | – | – | – | – | – | – | – |
| DaxPnt_RWTo | 97 | 259 | 2.79 | 7.6 | 8 | 2.6 | – | 34 | 0.69 | 3.4 | – | – | – |
| DaxFl_VRCAV | 113 | 239 | 2.19 | 8.0 | 17 | 7.7 | – | – | – | – | – | – | – |
| DavNK7Mx3sT | 132 | 321 | 2.44 | 10.0 | 15 | 5.0 | 34% | – | – | – | – | – | – |
| DasAXS7RRGD | 136 | 343 | 2.52 | 13.7 | 14 | 6.0 | – | – | – | – | – | – | – |
| Daq0L5nzcO4 | 162 | 480 | 2.96 | 13.7 | 15 | 4.3 | 31% | – | – | – | – | – | – |
| Dann1-ixC1e | 118 | 299 | 2.59 | 12.5 | 13 | 4.4 | – | 39 | 0.84 | 5.0 | -15.8 | – | – |
| DanGC8OxyLR | 152 | 429 | 2.87 | 12.6 | 13 | 3.9 | – | – | – | – | – | – | – |
| DaksqkVRXKk | 50 | 113 | 2.26 | 8.7 | 7 | 2.7 | – | 11 | 0.72 | 5.0 | -19.8 | – | – |
| DZhjb-RRpLH | 69 | 168 | 2.44 | 5.2 | 11 | 6.4 | – | – | – | – | – | – | – |
| DZfcDA_x-cH | 113 | 258 | 2.29 | 8.6 | 10 | 2.7 | – | 22 | 0.55 | 5.0 | -17.9 | -35.4 | 17.4 |

\* unpunctuated transcript; sentence segmentation unreliable for this row.

## Tensions with bay's quality gates

The format was authored in a conventional editor with no liveness constraint; bay
enforces one. Three genuine tensions and how the skill resolves them:

1. **`frozen` (error).** The source holds a truly static frame 40–84 % of the time,
   with single holds up to 5.3 s; bay rejects any 1.2 s window where nothing moves.
   The skill's adaptation: the chart never stops printing — candle/annotation arrivals
   are staggered so no 1.2 s window is empty, and holds for emphasis are carried by
   the caption-pill swap (authored text, so its entrance counts as ink change) rather
   than by dead air. This changes the format's texture slightly (constant quiet
   accumulation instead of stamp-then-freeze) but preserves the additive grammar.
2. **`bottom-dead` (warn).** The source's only bottom-of-frame content is the caption
   pill at 91–93 % height. In bay, tool-generated narration captions are suppressed
   during checks — so the pill must be **authored** as a text element (which the skill
   does anyway, since pill text is a paraphrase an agent writes, not a transcript),
   and the chart's baseline/axis furniture is kept low in frame.
3. **`text-collision` / `safe-margins` (error).** The lockup, kicker, on-chart labels,
   and pill are four independent text lanes; the source keeps them apart by
   convention. The skill fixes each lane to a non-overlapping band (top 0–14 %,
   under-lockup 14–18 %, chart interior, bottom 88–96 % within margins) so collision
   is impossible by construction.

Non-tensions worth noting: the format's zero-cut continuity trivially satisfies
continuity/carry-over checks; its one-accent palette and serif discipline map
directly onto a bay StyleKit; its additive entrances map onto registry grow/fade
moves with no invented motion.
