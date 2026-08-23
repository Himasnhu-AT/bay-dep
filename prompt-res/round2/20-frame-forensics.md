# Round 2 — Frame & motion forensics of `wicks-v2.mp4`

Everything here is measured from pixels and samples, not from the project model. Method:
ffmpeg → raw grayscale/RGB → numpy/OpenCV. Two sampling rates: **5 fps** (motion timeline, ink,
bands) and **30 fps** (burst structure, freeze runs). Full-resolution 1080×1920 frames for type,
clearance and thumbnail work. Audio via `ebur128` verbose (100 ms grid) and 20 ms RMS at 16 kHz.

Scripts: `/private/tmp/claude-501/-Users-himanshu-codes-synthai-vii/04c8682c-.../scratchpad/`
(`measure.py`, `fullrate.py`, `typemeasure2.py`, `audio.py`).

**Headline result: on every pixel axis except type size, `wicks-v2` is WORSE than the three
videos round 1 condemned.** It is the flattest, stillest, least colourful and least dynamic of
the four. It won only on integrated loudness — the one axis round 1 turned into a number.

---

## 0. The four-video scoreboard

`W2` = wicks-v2 · `CW` = candlestick-wicks · `CV` = candlestick-wick-volatility · `LF` = local-first

| Axis | W2 | CW | CV | LF | W2 rank |
|---|---|---|---|---|---|
| duration / fps | 61.0 s / 30 | 74.2 / 30 | 70.5 / 30 | 30.1 / 30 | — |
| mean frame-delta (px >8/255, 5 fps) | **0.565 %** | 0.719 % | 0.797 % | 1.154 % | **4/4 worst** |
| median frame-delta | 0.030 % | 0.056 % | 0.299 % | 0.006 % | 3/4 |
| frames with any motion (30 fps) | 29.7 % | 30.8 % | 39.9 % | 30.6 % | 4/4 |
| **total time in stills > 2 s** | **9.6 s** | 0.0 s | 0.0 s | 0.0 s | **4/4, alone** |
| longest still | **3.83 s** | 1.93 s | 1.83 s | 1.57 s | **4/4 worst** |
| windows ≥1.5 s frozen (<0.1 % px change) | **5 (13.4 s = 22 % rt)** | 2 (3.4 s = 4.6 %) | 2 (3.4 s = 4.8 %) | **0** | **4/4 worst** |
| motion bursts ≤3 frames (pops) | 12 | 10 | 14 | **0** | 3/4 |
| change events / s (τ = 0.02) | **0.213** | 0.283 | 0.326 | 0.567 | **4/4 worst** |
| median glyph cap height | 72 px (6.6 % W) | 62 px | 45 px | **93 px (8.6 %)** | 2/4 |
| max glyph cap height | 88 px (8.2 % W) | **169 px** | 81 px | 104 px | 3/4 |
| median glyph stroke width | 11.8 px | 6.0 px | 6.0 px | **15.6 px** | 2/4 |
| glyph survival at 200 px wide | ≈48 % | ≈33 % | ≈30 % | **≈59 %** | 2/4 |
| rows never inked | 43.0 % | 39.3 % | 45.1 % | 54.4 % | 2/4 |
| bottom dead run | y 0.771–1.0 (**22.9 %**) | y 0.810–1.0 | y 0.737–1.0 | y 0.836–1.0 | 3/4 |
| ink centroid ȳ (0 = top) | **0.400** | 0.453 | 0.435 | 0.449 | **4/4 highest** |
| runtime with ink centroid below mid-frame | **2.3 %** | 16.8 % | 11.4 % | 3.4 % | **4/4 worst** |
| distinct background colours | **1** | 1 | 1 | **4** | 4/4 (tie) |
| saturated hue bins (>0.05 % of px) | **2** (both red) | 4 | 5 | **6** | **4/4 worst** |
| saturated pixels (S>60, V>40) | **1.17 %** | 1.47 % | 2.53 % | 1.62 % | **4/4 worst** |
| **integrated loudness** | **−13.9 LUFS** | −27.5 | −16.5 | −25.3 | **1/4 best** |
| LRA | 3.5 LU | 3.5 | 3.4 | 3.1 | — |
| momentary loudness p95−p5 | **12.7 LU** | 25.8 | 21.3 | 19.7 | **4/4 worst** |
| RMS crest (p99−p50, 20 ms) | **5.9 dB** | 14.1 | 12.3 | 13.5 | **4/4 worst** |
| runtime below −45 dBFS RMS | **0.1 %** | 33.9 % | 29.1 % | 32.3 % | **4/4 worst** |
| runtime with short-term S in [−18,−12] | **99.5 %** | 0 % | 74.2 % | 0 % | **4/4 worst** |
| layout ink-IoU between beats (mean / max) | **0.168 / 0.561** | 0.062 / 0.135 | 0.078 / 0.240 | 0.166 / 0.229 | **4/4 worst** |
| bright ink at t = 0.5 s | **0.00 %** | 0.02 % | 0.02 % | **4.26 %** | 4/4 (tie) |
| time to first 1 % bright ink | 1.3 s | 0.9 s | >3 s | **0.4 s** | 3/4 |

Round 1 added a LUFS target. `wicks-v2` is the only one that hits it, and it is the only one
with **zero** true silence and a 5.9 dB crest factor. The number moved; the sound got worse.

---

## 1. Motion energy — where the video actually moves

### 1.1 Per-second timeline (30 fps diff, summed per second)

```
sec  Σmotion%   sec  Σmotion%   sec  Σmotion%   sec  Σmotion%
  0     0.06     16     0.14     32    19.69     48    13.55
  1    30.79 ◄   17     0.38     33     7.57     49     8.98
  2     4.08     18    46.40 ◄   34     4.89     50     3.90
  3     7.66     19    31.80     35     2.71     51     0.78
  4     2.76     20    27.42     36     4.25     52     0.00 ◄◄
  5     1.21     21    11.05     37     5.78     53     0.00 ◄◄
  6     1.08     22    10.39     38     4.47     54    24.28 ◄
  7     0.00 ◄◄  23     3.54     39     5.17     55     1.53
  8    40.25 ◄   24     3.63     40     0.87     56     4.92
  9     1.67     25     3.23     41     2.05     57     2.69
 10     3.35     26     3.86     42     1.83     58     6.20
 11     7.64     27     4.18     43     0.00 ◄◄  59     0.91
 12     6.15     28     1.78     44     0.00 ◄◄  60     0.00 ◄◄
 13     1.62     29     0.30
 14     2.13     30     0.00 ◄◄
 15     0.53     31     0.00 ◄◄
```

Six transitions (t ≈ 1, 8, 18, 32, 45, 54). **Every dead second sits immediately before a
transition** — each beat animates in, then dies, then cuts. The viewer's decision window is
always spent on a frozen frame.

### 1.2 Freeze runs > 1.5 s (5 fps, <0.1 % pixels changed)

| start | end | length |
|---|---|---|
| 6.4 | 8.0 | 1.60 s |
| 15.2 | 17.8 | 2.60 s |
| 28.8 | 32.6 | **3.80 s** |
| 42.2 | 45.0 | 2.80 s |
| 51.6 | 54.2 | 2.60 s |

**13.4 s = 22.0 % of the runtime is a still image.** At 30 fps the same test gives 9 stills > 1 s
totalling 17.9 s, including **0.03 → 1.13 s at the very start**. The other three videos have
**zero** stills longer than 2 s.

Additional: 48.0 % of adjacent 5 fps sample pairs are pixel-identical (<0.01 % change).

### 1.3 Burst structure — the 3-frame pop, seen in pixels

Burst = a run of consecutive 30 fps frames with >0.05 % pixels changing.

| burst length (frames) | W2 | CW | CV | LF |
|---|---|---|---|---|
| 1–3 (≤0.10 s — a pop) | **12** | 10 | 14 | **0** |
| 4–6 | 24 | 11 | 23 | 1 |
| 7–14 | 19 | 50 | 53 | 25 |
| ≥15 (≥0.5 s — a move) | 11 | 10 | 11 | 3 |
| mode | **6 frames (0.20 s)** | 7–8 | 4 / 7 | 7–8 |

The project's 76 × 0.098 s moves do not each show up as a burst — they overlap — but the pixel
signature survives: 12 of 66 bursts are ≤3 frames, and the modal burst is 0.20 s. `local-first`,
made before any of the round-1 work, has **no** sub-4-frame bursts at all.

Single-frame ink jump p99: W2 0.785 pp, CW 0.722, CV 0.611, **LF 1.402**. `local-first` moves
*more* per frame while never popping — it uses longer, larger moves.

### 1.4 Compression as an independent motion witness

Per-second video bitrate (H.264, all CRF-comparable):

| | mean | p10 | p50 | p90 | secs under 50 kbps |
|---|---|---|---|---|---|
| W2 | 343 | 73 | 326 | 648 | 4 (7 %) |
| CW | 150 | 41 | 131 | 287 | 12 (16 %) |
| CV | 133 | 49 | 114 | 224 | 8 (11 %) |
| LF | 198 | 44 | 146 | 431 | 4 (13 %) |

W2's higher bitrate is dither/grain in the card fill, not motion — its exact-distinct frame count
is 90.6 % while 60.2 % of consecutive frames differ by ≤2/255 everywhere. Bitrate is *not* a
usable proxy; it is fooled by encoder noise the way `check` is fooled by keyframe counts.

---

## 2. Ink coverage and the dead zone

### 2.1 Ink is a two-population distribution

| luminance threshold | W2 mean | CW | CV | LF |
|---|---|---|---|---|
| >24 (anything not background) | **35.92 %** | 4.43 % | 4.91 % | 6.45 % |
| >48 | 6.00 % | 3.80 % | 4.26 % | 5.90 % |
| >96 | 3.89 % | 2.79 % | 3.29 % | 5.06 % |
| >160 (real bright content) | **1.32 %** | 0.93 % | 0.78 % | **4.01 %** |

W2 looks 8× "fuller" than its predecessors at threshold 24 and is the emptiest at threshold 160.
The 30 % difference is **one dark card** (`#1A1A22`-ish on `#0E0E12`) that covers 89.5 % of the
region y 0.30–0.62 for **60.2 of 61.0 seconds and never moves** — its top edge is row **640** in
all 505 sampled full-res frames.

An ink-coverage check with a naive threshold would score `wicks-v2` as the fullest of the four.
`local-first`, which is the most legible at thumbnail size, is 3× brighter and 6× emptier.

### 2.2 The dead zone, per horizontal band (10 bands, top → bottom)

`wicks-v2`:

| band | y range | % runtime with any ink | mean ink % | mean motion % | % of band static all video |
|---|---|---|---|---|---|
| 0 | 0.0–0.1 | 99.0 | 2.41 | **0.015** | 96.5 |
| 1 | 0.1–0.2 | 99.0 | 3.04 | 0.251 | 82.7 |
| 2 | 0.2–0.3 | 83.9 | 14.01 | 1.326 | 40.1 |
| 3 | 0.3–0.4 | 92.5 | 4.00 | 0.243 | 33.1 |
| 4 | 0.4–0.5 | 88.9 | 15.58 | 0.973 | 9.3 |
| 5 | 0.5–0.6 | 91.1 | 14.41 | 0.899 | 9.3 |
| 6 | 0.6–0.7 | 73.4 | 4.00 | 0.430 | 9.3 |
| 7 | 0.7–0.8 | 51.5 | 2.52 | 1.515 | 65.3 |
| **8** | **0.8–0.9** | **0.0** | **0.000** | **0.000** | **100.0** |
| **9** | **0.9–1.0** | **0.0** | **0.000** | **0.000** | **100.0** |

**Bands 8 and 9 — the bottom 20 % of the frame, 414 720 pixels — are literally identical in
every one of the 1 830 frames.** Contiguous never-inked runs: `y 0.771–1.000 = 22.9 % of height`.
Band 0 is the opposite failure: occupied 99 % of the time with 0.015 % motion — the tick strip is
static furniture, not content.

Ink centroid ȳ = 0.400, range 0.087–0.514. **It never crosses y = 0.55.** Share of ink below
y = 0.80: **0.00 %**, for the entire runtime.

Vertical distribution (columns, mean ink %):
`0.47 | 4.51 | 14.10 | 16.84 | 7.75 | 6.20 | 4.84 | 3.91 | 1.14 | 0.19` — mass in columns 2–3,
i.e. left-of-centre, matching the project's `x ≈ 0.085` pile-up.

### 2.3 Static furniture

| | static pixels (range ≤8/255 over whole video) |
|---|---|
| W2 | 55.0 % |
| CW | 71.7 % |
| CV | 66.7 % |
| LF | 77.7 % |

W2 has the *least* static area — but its non-static area is card dither. Per band, W2 is 96.5 %
static in band 0 and 100 % static in bands 8–9. From the model: **21 of 119 visible elements
(17.6 %) start at t=0 and last the full 62 s** — 14 tick marks, a tape rule, the card panel, four
grid lines and an axis. One sixth of the element budget is wallpaper.

---

## 3. Type, at the size it actually renders

Cap height measured from connected components (75th percentile of glyph heights per line), full
resolution, glyph-shaped components only (8 ≤ h ≤ 300, fill 0.08–0.90).

### 3.1 wicks-v2, per sample

| t (s) | max cap px | % of 1080 width | cap at 200 px wide | stroke px | stroke at 200 w | glyph survival at 200 w |
|---|---|---|---|---|---|---|
| 0.3 | — | — | — | — | — | no glyphs at all |
| 0.8 | 35 | 3.24 | 6.5 | 4.0 | 0.74 | 37 % |
| 1.5–6.5 | 74 | 6.81 | 13.6 | 12.0 | 2.22 | 52–56 % |
| 13–16.5 | 88 | 8.19 | **16.4** | 12.0 | 2.22 | 47–48 % |
| 22–30.5 | 72 | 6.65 | 13.3 | 11–12 | 2.0–2.2 | 47–49 % |
| 35–44 | 75 | 6.94 | 13.9 | 8.0 | 1.48 | **14–27 %** |
| 47–52.5 | 61 | 5.65 | 11.3 | 14.0 | 2.59 | 45–53 % |
| 56–60 | 67 | 6.20 | 12.4 | 8–10 | 1.5–1.9 | 23–41 % |

Median 72 px (**6.6 % of frame width**), max 88 px. The project's largest declared font is 96 px;
Baskerville renders that at ~68 px cap. **A font-size floor in the model is not a cap-height floor
on screen** — there is a 0.71 factor between them and it differs per family.

### 3.2 The thumb test — 200 px wide

Rendered at 200 px wide (the width of a feed thumbnail), nearest-upscaled and read:

| video / frame | what survives |
|---|---|
| W2 @ 4 s | serif headline "A day becomes four numbers." legible; kicker, card contents, caption **all illegible smear**; frame reads grey-on-grey |
| W2 @ 25 s | headline legible; `R = 4.20 R = 4.20` gone; caption gone |
| W2 @ 50 s | `W = R − |r|` marginal; everything else gone |
| W2 @ 58 s | **nothing legible** |
| CW @ 36 s | `$0.04` legible (169 px cap) — the one good frame in the series |
| CV @ 50 s | red/green candles read as colour even when type does not |
| **LF @ 5 s** | headline **and** the full-bleed dark-red field read instantly |
| **LF @ 25 s** | headline **and** the full-bleed dark-green field read instantly |

`local-first` wins the thumb test outright and it is the *oldest* of the four. Two reasons, both
measurable: **cap 93–104 px with 15.6 px stroke** (vs 72 px / 11.8 px), and **a full-frame colour
wash that carries meaning with zero legible glyphs**. `wicks-v2` at 200 px is a grey rectangle
with one readable serif line.

Numeric legibility floors implied by the sample: at 200 px wide you need **cap ≥ 20 px** and
**stroke ≥ 2.5 px** to survive. That is **cap ≥ 108 px and stroke ≥ 13.5 px at 1080**. W2 median
is 72 px / 11.8 px. LF is 93 px / 15.6 px. Both fail the cap floor; only LF passes stroke.

### 3.3 Text/shape collision, transient

The `overlap` finding code checks static geometry. This is a *temporal* collision:

| t (s) | clearance, headline bottom → card top (px, 1080×1920) |
|---|---|
| 18.9 | **6** |
| 19.0 | **6** |
| 19.1 | 36 |
| 19.2–20.0 | 47 → 54 |
| median over all 505 samples | 71 |

For 0.2 s the descender of "day." sits 6 px (0.31 % of frame height) off the card's top edge and
visually reads as truncated, because the card fill is lighter than the background. It exists only
during the entrance animation and disappears afterwards. Nothing in the project model shows it.

---

## 4. Beats, cuts and template repetition

### 4.1 Beat cadence

Beats derived from the motion timeline (per-second energy > 35 % of p90, min 3 s apart):

| | beats | mean length | min | max | max/min | tail-freeze total | % runtime |
|---|---|---|---|---|---|---|---|
| W2 | 8 | 7.50 s | 3.0 | 13.0 | 4.33 | 9.67 s | **15.9 %** |
| CW | 15 | 4.88 s | 1.2 | 11.0 | 9.43 | 9.03 s | 12.2 % |
| CV | 12 | 5.54 s | 1.5 | 13.0 | 8.86 | 8.03 s | 11.4 % |
| LF | 4 | 7.51 s | 3.0 | 10.0 | 3.30 | 1.67 s | **5.5 %** |

Change-event density (τ = 0.02, min 0.35 s apart): **W2 0.213/s, CW 0.283, CV 0.326, LF 0.567.**
Against the round-1 references: R1 cuts every 1–3 s (≈0.5/s), R2 changes every ~1.5–3 s
(18 events / 57 s = 0.32/s). **`wicks-v2` is at 40–67 % of the reference cadence and is the
slowest of our four.**

### 4.2 The template never changes

Pairwise similarity of the settled frame of six beats:

| | row-ink-profile *r* (mean / max) | column *r* (mean) | ink IoU (mean / max) |
|---|---|---|---|
| **W2** | **0.498 / 0.870** | **0.583** | **0.168 / 0.561** |
| CW | 0.294 / 0.719 | 0.416 | 0.062 / 0.135 |
| CV | 0.432 / 0.748 | 0.324 | 0.078 / 0.240 |
| LF | 0.525 / 0.785 | 0.797 | 0.166 / 0.229 |

Max ink IoU 0.561 means **56 % of the lit pixels of one beat are lit in the same place in
another beat.** That is the same composition redrawn with different words. CW/CV, for all their
faults, at least move their content around (max IoU 0.135 / 0.240).

### 4.3 The empty container

Card region (y 0.30–0.62, x 0.06–0.94) over time:

| window | card fill drawn | bright content inside |
|---|---|---|
| 0.0 s | 0 % | 0 % |
| **0.8 – 2.8 s** | **89.5 %** | **< 0.4 %** ← the hook is an empty box |
| 3–18 s | 89.5 % | 0.6 → 9.8 % |
| 19–20 s | 89.6 % | 1.9 → 0.57 % (near-empty during transition) |
| 23–29 s | 89.6 % | **14.437 % — constant to 3 decimals for 6 s** |
| **33 – 45 s** | 89.5 % | **14.40–14.46 % — varies < 0.06 pp over 12 s** |
| **45.4 – 47.0 s** | 89.5 % | **< 0.4 %** ← empty again |
| 48–60 s | 89.5 % | 1.0 → 4.8 % |

**4.0 s (6.6 % of runtime) shows a drawn container with nothing in it**, and one of those windows
is the first two seconds of the video. Twelve seconds show a chart whose contents change by less
than 0.06 percentage points.

### 4.4 Element arrival — the metric round 1 recommended, and it PASSES

From `12-video-teardowns.md` §3: *"measure (a) how many distinct elements arrive during a scene,
(b) how they are distributed across the scene's duration, (c) whether anything changes after the
first second."*

Measured on `wicks-v2` (119 visible elements, beats taken from narration boundaries):

| beat | arrivals | last arrival as fraction of beat | arrivals in first 30 % of beat |
|---|---|---|---|
| 0.8–9.0 | 13 | **0.93** | 15 % |
| 9.0–18.8 | 19 | **0.92** | 21 % |
| 18.8–33.8 | 19 | **0.95** | 26 % |
| 33.8–46.0 | 17 | **0.93** | 29 % |
| 46.0–55.6 | 13 | **0.90** | 31 % |
| 55.6–61.0 | 5 | 0.54 | 60 % |

Every beat spreads its arrivals across 90–95 % of its duration. `front-loaded` cannot fire.
Median inter-arrival 0.00 s, p90 1.12 s, max 5.25 s. On-screen element count: median 36, min 29.

**And yet 22 % of the runtime is a frozen frame.** Two mechanisms defeat the metric:
1. The last "arrival" in a beat is the **pre-roll of the next beat** (beat 3's last arrival at
   t = 33.00 s, 0.8 s before beat 4 starts at 33.8 s — after a 3.8 s freeze from 28.9 to 32.7).
   Starting the next scene's elements 0.5 s early satisfies an arrival-spread check for free.
2. An arrival that fades in over 0.098 s and adds 0.3 % ink is an arrival in the model and a
   flicker on screen.

**Do not adopt round 1's §3 recommendation as written. It is already satisfied by the failure.**

### 4.5 Hook, first 3 seconds

| | bright ink @0.1 s | @0.5 s | @1.0 s | @2.0 s | @3.0 s | t to 1 % | mean motion 0–3 s |
|---|---|---|---|---|---|---|---|
| W2 | 0.00 % | **0.00 %** | 0.06 % | 1.99 % | 2.66 % | **1.3 s** | 0.65 % |
| CW | 0.00 % | 0.02 % | 1.14 % | 1.41 % | 2.15 % | 0.9 s | 0.54 % |
| CV | 0.00 % | 0.02 % | 0.56 % | 0.42 % | 0.96 % | **> 3 s** | 0.28 % |
| **LF** | 0.00 % | **4.26 %** | 5.58 % | 5.72 % | 4.43 % | **0.4 s** | **1.43 %** |

The visual at t = 0.5 s in `wicks-v2` is a half-drawn tick strip on black — no headline, no card,
no caption. The first 1.13 s at 30 fps is a **still** frame. `local-first` is at full composition
by 0.5 s.

---

## 5. Audio — how −13.9 LUFS was reached and what it cost

### 5.1 The mix is a wall

| | integrated | LRA | short-term p5 / p50 / p95 | momentary p5–p95 | RMS crest p99−p50 | runtime < −45 dBFS |
|---|---|---|---|---|---|---|
| **W2** | **−13.9** | 3.5 | −16.4 / −14.1 / −12.5 | **12.67 LU** | **5.9 dB** | **0.1 %** |
| CW | −27.5 | 3.5 | −30.6 / −28.4 / −26.6 | 25.81 LU | 14.1 dB | 33.9 % |
| CV | −16.5 | 3.4 | −19.6 / −17.0 / −15.9 | 21.26 LU | 12.3 dB | 29.1 % |
| LF | −25.3 | 3.1 | −28.1 / −25.8 / −24.8 | 19.73 LU | 13.5 dB | 32.3 % |

**99.5 % of `wicks-v2`'s runtime has short-term loudness between −18 and −12 LUFS.** Every
two-second window across 61 seconds sits between −12.2 and −16.4. There is no loud moment and no
quiet moment. The other three all have >29 % of their runtime in true silence.

### 5.2 Why LRA is 3.5 LU — the duck runs backwards

From the project: `bed.wav` is a single 62 s file, split into **13 clips** with matched
`trimStart` (so it is continuous, not retriggered). The clips alternate volume:

| bed clip | span | volume |
|---|---|---|
| bed1 | 0.00–1.10 | 1.6 |
| bed2 | 0.80–6.10 | **0.7** ← narration live |
| bed3 | 5.80–9.30 | **2.0** ← gap |
| bed4 | 9.00–14.68 | 0.7 |
| bed5 | 14.38–19.10 | 2.0 |
| … alternating … | | |
| bed13 | 59.48–61.00 | 1.8 |

Six narration clips cover 36.15 s = **59.3 %** of the runtime; the 24.85 s of gaps get the bed at
**+9.1 dB** relative to its ducked level. The result:

| | momentary loudness |
|---|---|
| inside narration windows (inset 0.4 s) | mean **−14.01** LUFS |
| in gaps (inset 0.4 s) | mean **−15.15** LUFS |
| **separation** | **1.14 LU** |

The bed was turned up by exactly the amount needed to erase the difference between speech and
silence. 90.3 % of the runtime is above −20 LUFS momentary; 0.2 % is below −30.

### 5.3 Is the bed audible under narration? No.

Band energy, narration windows vs gaps, and the bed's predicted level under narration
(gap level − 9.1 dB):

| band | narration dB | gap dB | bed-under-narration (est.) | masked by |
|---|---|---|---|---|
| 40–120 Hz | 29.1 | 36.8 | 27.7 | 1.4 dB |
| **150–300 Hz** (bed's centroid) | 30.9 | 22.2 | 13.1 | **17.8 dB** |
| 300–800 Hz | 22.7 | 11.9 | 2.8 | **20.0 dB** |
| 800–3000 Hz | 14.2 | 12.0 | 2.9 | **11.3 dB** |
| 3–6 kHz | 6.4 | 7.1 | −2.0 | 8.3 dB |
| 6–11 kHz | 5.7 | 2.2 | −6.9 | 12.6 dB |

Masked by 8–20 dB in every band above 120 Hz. **For 59 % of the runtime the bed is inaudible;
for the other 41 % it is the only thing playing.** It is not a bed, it is a silence filler. It
does not "hold the picture up under the voice", which is the job the doctrine assigns it.

### 5.4 `bed.wav` has no musical time

Measured on the source file directly (62.0 s, 48 kHz stereo, synthesised by the agent):

- **RMS per second: −30.2 to −33.4 dB after the first second. A 2 dB envelope across 60 seconds.**
  No build, no drop, no section change.
- **Spectral centroid 202–236 Hz, σ = 6 Hz.** A drone.
- Spectral-flux onsets: 434 in 62 s = 7.0/s, median inter-onset 0.150 s (≈400 BPM), σ 0.045 —
  a continuous arpeggiated texture with no downbeat.

There is **no beat in this video to cut to.** Any "land on the beat" doctrine is unimplementable
against this bed. The `secA.wav / secB.wav / secC.wav` intermediates on disk show the agent did
build three sections — they are all the same drone.

### 5.5 SFX

50 SFX events in 61 s (0.82/s): whoosh ×11, tick ×11, impact ×6, click ×6, riser ×4, pop ×4,
whoosh_rev ×3, chime ×3, subdrop ×2. Durations 0.045–1.3 s. They are present and they are
*inside* the 3.5 LU band — no SFX event produces a momentary peak above −8.5 LUFS anywhere in
the video. The transients are there and the mix has no headroom for them to land in.

---

## 6. Verdict, per axis: is v2 better or worse than its predecessors?

| axis | verdict | evidence |
|---|---|---|
| **loudness delivery** | **BETTER** | −13.9 LUFS vs −27.5 / −25.3; true peak −1.6 dBTP |
| **loudness dynamics** | **WORSE than all three** | crest 5.9 dB vs 12.3–14.1; 0.1 % silence vs 29–34 %; momentary range 12.7 LU vs 19.7–25.8 |
| **motion continuity** | **WORSE than all three** | 9.6 s in stills > 2 s vs 0.0 s in all three; longest still 3.83 s vs 1.57–1.93 s |
| **cut cadence** | **WORSE than all three** | 0.213 events/s vs 0.283 / 0.326 / 0.567 |
| **pop-vs-move** | worse than LF, comparable to CW/CV | 12 bursts ≤3 frames vs 0 / 10 / 14 |
| **type size** | slightly better than CW/CV, worse than LF | median cap 72 px vs 62 / 45 / **93** |
| **type weight (thumbnail)** | better than CW/CV, worse than LF | stroke 11.8 px vs 6.0 / 6.0 / **15.6** |
| **colour** | **WORSE than all three** | 2 hue bins vs 4 / 5 / 6; 1 background vs 4 for LF; 1.17 % saturated vs 1.47–2.53 % |
| **layout variety** | **WORSE than all three** | beat-to-beat ink IoU 0.168 mean / 0.561 max, highest of the four |
| **dead zone** | comparable | bottom 22.9 % never inked; all four are 16–26 % |
| **frame balance** | **WORSE than all three** | ink centroid ȳ = 0.400, below mid-frame only 2.3 % of runtime |
| **hook** | worse than CW and LF | 0.00 % ink at 0.5 s; 1.3 s to reach 1 %; first 1.13 s is a still |
| **element count / layering** | better | 119 visible elements, median 36 concurrent (round 1's target) |

**Net: one axis improved, eight regressed.** The improved axis is the one that was turned into a
number.

---

## 7. What this says about the round-1 metrics

| round-1 metric | what wicks-v2 scored | why it did not help |
|---|---|---|
| distinct easing count | 19 | a diversity count over a channel-level attribute; `hold` × 130 satisfies it |
| distinct duration count | 47 | mass is at 0.098 s; the histogram is wide and useless |
| element count ≥ 3 layers/scene | 119 visible, median 36 concurrent | 21 of them are 62-second wallpaper |
| LUFS target −14 | −13.9 | reached by removing all dynamic range (crest 5.9 dB) |
| *(proposed)* element-arrival spread | last arrival at 0.90–0.95 of every beat | satisfied by pre-rolling the next beat by 0.5 s |
| *(proposed)* "anything changes after first second" | passes — arrivals throughout | changes are 0.098 s pops adding 0.3 % ink |

Every one of these is a **count over the model**. Not one of them samples a frame. The failures
are all in pixels and samples: a frozen frame, a grey field, a 6 px collision, a bed that fills
silence instead of supporting speech.

---

## 8. Rules that survive the "how would an agent game this" test

Each rule below is stated numerically, with what it is checked against and how it could be gamed.
The pattern that works: **pair a pixel measurement with a second measurement that moves the
opposite way when you cheat.**

| # | Rule | Check from | Gaming vector | Counter |
|---|---|---|---|---|
| R1 | No still longer than **1.2 s**. Still = <0.15 % of pixels change over 1.2 s at 10 fps. | 10 fps render + diff | add a permanently drifting decoration | require the change to fall inside the bounding box of the two largest ink clusters, and require ≥0.3 % of pixels |
| R2 | **Change events ≥ 0.30/s** where an event is ≥1.0 % of pixels changing within 0.4 s. | 10 fps render + diff | full-frame flicker / opacity wobble | event must alter the ink *centroid* by ≥2 % of frame height or the ink *area* by ≥0.5 pp |
| R3 | Largest text line: **cap ≥ 108 px** and **stroke ≥ 13.5 px** at 1080 width, in every 5 s window. | rendered frame + connected components | one huge word, unreadable rest | the line must contain 1–7 glyph groups and be the largest ink cluster; require ≥1 such line per 5 s window, not one in the whole video |
| R4 | **Ink centroid must fall below y = 0.55 for ≥20 % of runtime**, and ≥5 % of total ink must lie below y = 0.80. | 5 fps render | a big dim rectangle at the bottom | count only pixels with ≥3:1 contrast against the modal background |
| R5 | Beat-to-beat **ink IoU < 0.25** and row-profile *r* < 0.60 for every pair of settled frames. | one settled frame per beat | translate the whole layout by 60 px | also require the largest ink cluster's bbox area to differ by ≥1.5× between at least two beats |
| R6 | **Short-term loudness p95 − p10 ≥ 6 LU**, and ≥8 % of runtime below −24 LUFS short-term, in ≥3 interior windows of ≥0.7 s. | `ebur128` on the render | pad a silent tail | windows must be interior (not first/last 3 s) and there must be ≥3 of them |
| R7 | **Narration-window vs gap-window momentary loudness separation ≥ 4 LU**, narration louder. | `ebur128` + narration element times | duck the *narration* instead | require narration mean ≥ −16 LUFS as well |
| R8 | A bed must have an **RMS envelope range ≥ 6 dB** over its length and a detectable tempo (inter-onset σ/median ≤ 0.25). Cuts must land within 120 ms of an onset. | analysis of the bed source + beat times | fake a beat grid then cut to it | that *is* the goal — a video cut to a grid is the outcome we want |
| R9 | Any filled shape covering ≥5 % of the frame must hold **≥0.5 % frame ink within 0.5 s of appearing** and for ≥90 % of its life. | 5 fps render + shape geometry | put one dot in the box | ink must be ≥0.5 % of the *frame*, i.e. ~10 000 px |
| R10 | **Hook: ≥3 % bright ink (≥4.5:1 contrast) by t = 0.4 s**, including one text line meeting R3. | first 12 frames | flash a white plate | the ink must be a text cluster passing R3 |
| R11 | Elements that start at t=0, last ≥90 % of runtime and carry no animation may be **≤10 % of visible elements** and **≤15 % of mean ink**. | project model + render | animate the wallpaper 1 px | the animation must move ≥1 % of frame height or change opacity by ≥0.3 |
| R12 | **Minimum inter-element clearance ≥ 24 px at every sampled frame**, not just at element start. | 10 fps render, bbox of bright clusters vs shape edges | nudge one element | 24 px is the fix; the point is *sampled over time*, not evaluated statically |
| R13 | **A project whose scenes cover >20 s in one scene must be rejected**, or all per-scene checks must be re-derived from measured motion beats instead of `scenes`. | project model | make 8 zero-length scenes | require each scene to contain ≥1 measured change event and ≥5 % of runtime |
| R14 | **Move duration floor: no animated channel shorter than 0.20 s (6 frames)**, and ≥40 % of moves ≥0.45 s. | project model | one long move + 75 short ones | it is a distribution rule, not a count: the p50 must be ≥0.30 s |
| R15 | **Animated-property mix**: opacity may be at most 45 % of animated channels; ≥3 distinct non-opacity properties must each hold ≥10 %. | project model | animate `x` by 0.001 | each non-opacity channel must span ≥2 % of the relevant axis (x/y ≥ 0.02 of frame, scale ≥ 0.08) |
| R16 | **≥3 distinct chroma clusters** (hue bins ≥15° apart) each ≥0.3 % of frame area, persisting ≥1 s; **or** ≥2 scene background colours differing by ΔE ≥ 10. | 2 fps RGB frames | three saturated dots | 0.3 % of frame = ~6 200 px ≈ an 80×80 block; require persistence ≥1 s |

The single highest-leverage change is not a rule: **`check` must render frames and measure them.**
Every finding in this document that matters — the freeze, the dead zone, the grey field, the empty
card, the 6 px collision, the flat mix — is invisible to a model-only check and unmissable to a
10 fps diff. Round 1 added counts because counts are cheap to compute from JSON. The video is not
made of JSON.
