# The golden ratio in bay's edits: evidence and spec

φ = 1.618034 · 1/φ = 0.618 · 1/φ² = 0.382 · 1/φ³ = 0.236 · 1/φ⁴ = 0.146

## Summary

**Evidence verdict: no study shows φ beats nearby proportions.** Nobody has found a perceptual or attention advantage for φ over thirds, 3:5, 1.5 or plain centring. Putting the subject on *some* off-centre line has a modest effect, mostly on trained viewers, and centred or symmetric framing often wins. The music claims (Bartók, Debussy) are disputed after the fact. Nobody has tested a φ-placed climax against any other position.

It is still worth using φ as bay's **house system**. What a system buys you is consistency: one ratio for type, margins, timing and colour gives edits a coherent look, and gives the agent numbers it can apply the same way every time. Everything below is a **stylistic choice**, except where a row is marked *evidence* or *standard*. Where a rule with real support disagrees with φ (a beat, reading time, a platform's UI safe zone, accessibility), that rule wins.

## Evidence review

**Composition.**
- Fechner (1876) reported that people prefer golden rectangles. About 150 years of replications split roughly evenly for and against. Godkewitsch (1974) showed the preference was an artefact of where the golden rectangle sat in the range of shapes shown.
- Stieger & Swami (2015) ran three studies of art photos with the subject placed centrally, at ¾ or at φ. They found mostly implicit and explicit preference for the **symmetric** version. φ came out ahead only explicitly, in one study, and only among people with art training.
- Amirshahi et al. (2014) scored large sets of high-quality photos and paintings with saliency maps. Thirds placement "seems to play only a minor, if any, role."
- Svobodová et al. (2014) found that thirds/golden-section composition and horizon position did raise ratings of landscape photos. That study treats thirds and φ as one rule, so it cannot separate them.
- Eye-tracking work finds that experts favour thirds framing and novices do not. That points to a learned convention rather than a fact of perception.
- The φ lines sit at 38.2 % and 61.8 %, about 5 % of the frame closer to centre than the thirds lines. No study has resolved a difference that small.

**Golden spiral.** 16:9 (1.778) is not a golden rectangle, and neither is 9:16 (0.5625 vs 0.618). Every spiral overlay on video is stretched or cropped to fit. The spiral's pole is just a point near a φ intersection, and nothing tests the curve itself. Use the grid points instead.

**Typography.** Modular scales come from Bringhurst's *Elements of Typographic Style*, which builds a two-strand Fibonacci series of type sizes. Tim Brown popularised them in "More Meaningful Typography" (A List Apart, 2011). Designers pick φ for its cultural resonance, not for measured legibility. A φ scale is steep, so it suits video titles, where only 3–4 sizes appear on screen.

**Timing and music.**
- Lendvai claimed Bartók's *Music for Strings, Percussion and Celesta* follows Fibonacci: 89 bars, climax at bar 55, mutes off at bar 34. Howat showed flaws in Lendvai's counting. Bartók left no statement either way, and Roberts (AMS, 2021) calls intentional use "a stretch."
- Howat's *Debussy in Proportion* (1983) is the most careful case. Even there the proportions are analysed after composition, not heard as φ.
- The strongest empirical result on film pacing is not φ at all. Cutting, DeLong & Nothelfer (2010) found that shot lengths in 150 Hollywood films drifted toward 1/f, locally correlated patterns. They argue this holds attention. Shot rhythm is real; φ ratios are one way to produce it.

**Easing.** No perception study favours a φ-derived bézier. At video frame rates, `[0.382,0,0.618,1]` is visually indistinguishable from CSS `ease-in-out` `[0.42,0,0.58,1]`.

**Colour.** 60-30-10 is an interior-design convention with no empirical basis either. The φ split, 61.8 / 23.6 / 14.6, is almost the same thing.

**Audio.** Nothing supports a φ basis. A 1.618× amplitude ratio is 4.2 dB, which is far too small to separate music from speech. The credible reference is WCAG 1.4.7 (AAA): background sound **≥ 20 dB below** foreground speech. Mixing practice puts music beds 12–20 dB under dialogue.

**Skeptics.** Markowsky, "Misconceptions about the Golden Ratio" (*College Math. J.* 23:1, 1992), finds the mathematics usually stated correctly. The claims about art, architecture and aesthetics are, he writes, "false or seriously misleading". The Parthenon, the Mona Lisa and the UN building fit φ only after the measurements are chosen to fit.

## bay φ spec

### 1. Composition lines (px)

| Canvas | x: thirds | x: φ lines | y: thirds | y: φ lines |
|---|---|---|---|---|
| 1920×1080 (`landscape-1080`) | 640 / 1280 | **733.4 / 1186.6** | 360 / 720 | **412.5 / 667.5** |
| 1080×1920 (`vertical-1080`) | 360 / 720 | **412.5 / 667.5** | 640 / 1280 | **733.4 / 1186.6** |

Golden-spiral pole, for reference only: about (72.4 %, 27.6 %) of the frame, i.e. (1390, 298) landscape and (782, 531) vertical. Stylistic.

**Anchors.** bay's `left`/`top` place an item's top-left corner. To centre an item of size w×h on point (X, Y), use `left = X − w/2` and `top = Y − h/2`.

| Element | Landscape 1920×1080 | Vertical 1080×1920 |
|---|---|---|
| Subject centre | x 733 or 1187, looking toward the larger side | x 540 (centred; the evidence favours this too) |
| Eyeline | y 412 | y 733 |
| Horizon | y 412 (sky small) or 667 | y 733 or 1187 |
| Title block centre | opposite the subject: x 1187 (subject left) or 733 | y 412 (above the face) or 1187 (below it) |
| Payoff / logo lockup | centred, baseline on y 667 | centred, on y 1187 |
| Max text line width | 1187 (W/φ) | 960 (W − 2 × side margin) |

### 2. Margins (from φⁿ)

| Margin | Landscape | Vertical | Check against |
|---|---|---|---|
| Side: W/φ⁶ | **107** | **60** | title-safe 5 % = 96 / 54 → passes (*standard*) |
| Top: H/φ⁶ | **60** | **107** | — |
| Bottom UI keep-out | — | ≥ 1920/φ³ = **453** (23.6 %) | platform UI (captions, buttons) sits around the bottom 15–25 %; the platform wins |
| Captions `bottom` (%) | **9.0** (100/φ⁵ → 97 px) | **23.6** (100/φ³ → 453 px) | |

### 3. Type scale (×φ, base 24 px)

| Step | −1 | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|---|
| px | 15 | **24** | **39** | **63** | **102** | **165** | **266** |

- **Landscape 1920×1080.** Lower-third labels 24 · captions 39 (broadcast) or 63 (social) · titles 102 · hero 165 · single-word slam 266.
- **Vertical 1080×1920.** Captions 63 · titles 102 · hero 165.
- **Legibility floor.** A size may never go below 39 px on 1080 wide, whatever the scale says.
- **Line height** (convention, not φ): display 1.1–1.2, captions 1.2–1.3, body copy 1.5–1.618. At display sizes φ leading looks loose.
- **Tracking:** 102 px and up −1 % to −2 %; uppercase 39 px and under +4 % to +6 %.
- **Caption box padding:** vertical = size × 0.382, horizontal = size × 0.618. At 63 px that is **24 / 39 px**, both on the scale. The corner radius is size × 0.236 (15 px).
- **Card shape:** φ:1 (e.g. 610×377) for a standalone title card. Stylistic.

### 4. Timing at 30 fps

**Fibonacci frame ladder**

| Frames | 3 | 5 | 8 | 13 | 21 | 34 | 55 | 89 | 144 | 233 |
|---|---|---|---|---|---|---|---|---|---|---|
| ms | 100 | 167 | 267 | 433 | 700 | 1133 | 1833 | 2967 | 4800 | 7767 |

| Use | Frames |
|---|---|
| Per-word / per-letter stagger | 3 (letters), 5 (words), 8 (lines) |
| Micro move (chip, underline) | 8 |
| Standard entrance / exit | 13 in, 8 out (exits ≈ entrance/φ) |
| Title reveal, large move | 21–34 |
| Slow push-in | whole shot, scale 1 → 1.034 (1 + 1/φ⁷) |
| Punch-in steps | scale 1 → 1.146 → 1.236 |
| Minimum on-screen text hold | max(55, reading time). Reading time is about 13 frames per word, plus 21 (*convention*). |

**Accelerating cuts (stylistic).** Each shot ≈ the previous one ÷ φ: 89 → 55 → 34 → 21 → 13 (212 frames = 7.1 s). Snap every cut to the nearest `detect_beats` beat within ±3 frames; when φ and the beat disagree, the beat wins. Hold at least 13 frames, the practical floor for reading a shot. After the payoff, decelerate back: 13 → 21 → 34.

**Structure points.** Fraction of runtime R:

| Fraction | 0.146 | 0.236 | 0.382 | **0.618** | 0.764 | 0.854 |
|---|---|---|---|---|---|---|
| Role | re-hook 1 | re-hook 2 | turn / midpoint | **climax / payoff** | proof / resolve | CTA begins |
| 60 s (frame) | 8.8 s (263) | 14.2 s (425) | 22.9 s (688) | **37.1 s (1112)** | 45.8 s (1375) | 51.2 s (1538) |
| 45 s (frame) | 6.6 s (197) | 10.6 s (319) | 17.2 s (516) | **27.8 s (834)** | 34.4 s (1031) | 38.4 s (1153) |

The **hook is the first 0–3 s (0–89 frames)**, however long the film. That is platform-retention practice, not φ. Move each point to the nearest downbeat.

**Easing (stylistic; indistinguishable from standard curves)**

- φ inOut: `[0.382, 0, 0.618, 1]`, for position moves.
- φ out: `[0.236, 0.618, 0.382, 1]`, for entrances.
- φ in: `[0.618, 0, 0.764, 0.382]`, for exits.

### 5. Audio (no φ basis; use the standard)

- Duck music under speech to **−20 dB** (*WCAG 1.4.7*). −12 to −18 dB is acceptable for energetic promos.
- Ramps are 8 frames down and 13 up. That is the only φ touch here, and it is stylistic.
- Loudness is set by bay's mastering step, not by φ.

### 6. Colour areas

| Split | Base | Secondary | Accent |
|---|---|---|---|
| φ, three colours | 61.8 % | 23.6 % | 14.6 % |
| φ, two colours | 61.8 % | — | 38.2 % |
| 60-30-10 (convention) | 60 % | 30 % | 10 % |

Keep the spoken-word highlight to 1–2 words per line. That sits well under 14.6 % of the text area.

## Worked examples

### A. 60 s launch film, 1920×1080, 1800 frames

| Time (frame) | Beat | φ applied |
|---|---|---|
| 0–3 s (0–89) | Hook: product silhouette, 266 px word | word centred on (1187, 412) |
| 3–8.8 s | Problem: shots 55, 55, 34 frames | subject x 733; captions `bottom` 9 |
| 8.8 s (263) | Re-hook 1: hard cut plus sound hit | on a downbeat |
| 14.2 s (425) | Re-hook 2: first feature reveal | title at 102 px, 21-frame reveal, 5-frame word stagger |
| 22.9 s (688) | Turn: "Now watch this" | then accelerate: 89 → 55 → 34 → 21 → 13 frames |
| **37.1 s (1112)** | **Payoff:** the hero moment | 165 px, punch-in scale 1 → 1.146 over 13 frames, φ out |
| 45.8 s (1375) | Proof montage | 21–34 frame shots |
| 51.2 s (1538) | CTA begins | logo centred, baseline y 667 |
| 60 s | End | music ducked −20 dB under VO throughout |

Colour: the dark base covers about 62 % of the frame area, the product's colour about 24 %, and the brand accent (CTA, highlights) about 15 %.

### B. 45 s vertical short, 1080×1920, 1350 frames

| Time (frame) | Beat | φ applied |
|---|---|---|
| 0–3 s (0–89) | Hook line in punch subtitles | face eyeline y 733, x 540; subtitles `scale` so type ≈ 63 px, `bottom` 23.6 |
| 6.6 s (197) | Re-hook 1: pattern break (zoom 1 → 1.236 over 8 frames) | on a beat |
| 10.6 s (319) | Re-hook 2: text card, 102 px | centred on y 412 |
| 17.2 s (516) | Turn | cuts accelerate 55 → 34 → 21 → 13 |
| **27.8 s (834)** | **Payoff** | 165 px word on y 1187, 13-frame φ out entrance |
| 34.4 s (1031) | Resolve | 34-frame shots |
| 38.4 s (1153) | CTA to the end | inside the 60 px sides and above the 453 px bottom keep-out |

## How to brief bay's agent

```
House style: golden ratio (φ = 1.618). These are STYLE rules, not proven gains; beats,
reading time, platform safe zones and accessibility override them.

CANVAS: set_canvas preset landscape-1080 or vertical-1080 (30 fps).
GRID (px): landscape x 733/1187, y 412/667; vertical x 412/668, y 733/1187.
  edit_item left/top are the top-left corner: left = X − width/2, top = Y − height/2.
  Landscape: subject at x 733 or 1187, looking toward the larger side; eyeline y 412; title on the opposite φ line.
  Vertical: subject centred (x 540), eyeline y 733; titles centred on y 412 or 1187.
MARGINS: sides 107 (landscape) / 60 (vertical); top 60 / 107; vertical bottom keep-out 453.
TYPE (write_brf <text>, edit_item): sizes only from 15, 24, 39, 63, 102, 165, 266 px; never
  under 39 on 1080 wide. Line height 1.15 display / 1.25 captions. Caption box padding
  0.382 × size vertical, 0.618 × size horizontal.
SUBTITLES: add_subtitles bottom 9 (landscape) or 23.6 (vertical); pick scale so text ≈ 39–63 px
  (landscape) or 63 px (vertical).
MOTION (frames at 30 fps): durations only from 3, 5, 8, 13, 21, 34, 55, 89.
  Stagger 3 letters / 5 words / 8 lines. Entrance 13, exit 8, big reveal 21–34.
  edit_item keyframes eases: in-out [0.382,0,0.618,1]; entrance [0.236,0.618,0.382,1];
  exit [0.618,0,0.764,0.382]. Push-in scale 1→1.034 over the shot; punch-in 1→1.146→1.236.
  In write_brf use the same frame counts in interpolate()/<Sequence> and
  Easing.bezier(0.236,0.618,0.382,1).
TEXT HOLD: max(55 frames, 13 frames per word + 21).
STRUCTURE: hook in 0–89 frames. Re-hooks at 14.6% and 23.6% of runtime, turn at 38.2%,
  PAYOFF at 61.8%, resolve at 76.4%, CTA from 85.4%. Put an add_marker on each.
CUTS: run detect_beats (markers: beats); after the turn each shot ≈ previous ÷ φ
  (89→55→34→21→13, floor 13), then 13→21→34 after the payoff. Snap every cut and every
  structure point to the nearest beat within ±3 frames; the beat wins.
AUDIO: duck music under speech to db −20 (−12 to −18 allowed for high-energy promos),
  ramp down 8 frames, up 13.
COLOUR AREA: base ~62%, secondary ~24%, accent ~15%. Highlight at most 2 words per line.
```

## Sources

- Markowsky, G. (1992). [Misconceptions about the Golden Ratio](https://www.goldennumber.net/wp-content/uploads/George-Markowsky-Golden-Ratio-Misconceptions-MAA.pdf). *College Mathematics Journal* 23(1), 2–19. [T&F](https://www.tandfonline.com/doi/abs/10.1080/07468342.1992.11973428)
- Stieger, S. & Swami, V. (2015). [Time to let go? No automatic aesthetic preference for the golden ratio in art pictures](https://westminsterresearch.westminster.ac.uk/item/8yvwz/time-to-let-go-no-automatic-aesthetic-preference-for-the-golden-ratio). *Psych. Aesthetics, Creativity & the Arts* 9, 91–100.
- Amirshahi, S. A. et al. (2014). [Evaluating the rule of thirds in photographs and paintings](https://www.uniklinikum-jena.de/anatomie1_media/Inhalte/AmirshahiARTP2014.pdf). *Art & Perception* 2, 163–182.
- Svobodová, K. et al. (2014). [Does the composition of landscape photographs affect visual preferences?](https://www.sciencedirect.com/science/article/abs/pii/S0272494414000085) *J. Environmental Psychology* 38, 143–152.
- [Eye-tracking study of expert vs novice perception of composition](https://link.springer.com/chapter/10.1007/978-3-030-80091-8_89) (Springer, 2021).
- [The golden ratio and aesthetics](https://plus.maths.org/golden-ratio-and-aesthetics), *Plus* magazine, on the Fechner replications and Godkewitsch (1974).
- Cutting, J. E., DeLong, J. E. & Nothelfer, C. E. (2010). [Attention and the evolution of Hollywood film](https://journals.sagepub.com/doi/10.1177/0956797610361679). *Psychological Science*.
- Roberts, G. [Did Bartók use Fibonacci numbers in his music?](https://blogs.ams.org/jmm2021/2021/01/08/did-bartok-use-fibonacci-numbers-in-his-music/) (AMS, 2021), and [The Bartók Controversy](https://mathcs.holycross.edu/~groberts/Courses/Mont2/Handouts/Lectures/Bartok-web.pdf).
- Howat, R. (1983). *Debussy in Proportion*. Cambridge UP. [Howat on proportion](https://symmetry-us.com/Journals/5-3/howat.pdf)
- Brown, T. (2011). [More Meaningful Typography](https://alistapart.com/article/more-meaningful-typography/). *A List Apart*.
- Bringhurst, R. *The Elements of Typographic Style*, §8 "Shaping the page". [Canons of page construction](https://en.wikipedia.org/wiki/Canons_of_page_construction)
- W3C WCAG 2.x, SC 1.4.7 Low or No Background Audio (background ≥ 20 dB below speech).
- [NPR Training: mixing audio stories](https://www.npr.org/sections/npr-training/2025/05/31/g-s1-67902/the-producers-handbook-to-mixing-audio-stories), and [Epidemic Sound: audio mixing for video](https://www.epidemicsound.com/blog/audio-mixing-for-video/), on music-bed levels.
