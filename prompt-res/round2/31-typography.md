> **Historical:** describes the Rust engine, deleted; recover what it cites with `git show rust-engine-final:dep/rust/<path>` (e.g. `crates/bay-mcp/src/tools.rs`).

# 31 — Typography for vertical video

Round 2. Everything below was **measured on this machine** against bay's own text stack
(`bay-text` → cosmic-text 0.14 → fontdb → swash), not recalled. Raw probes and the code that
produced them are in the scratchpad (`typeprobe.rs`, `typeresolve.rs`, `typeframe.rs`,
`specimen.png`, `thumbtest.png`).

**Headline: `fontWeight` is a silent typeface switch.** If the requested weight does not exist in
the requested family, cosmic-text does not fall back to the nearest weight *in that family* — it
drops the family and renders in a different family entirely. On this Mac, `fontWeight: 700` on
any family without a 700 face renders in **Menlo Bold**, and `fontWeight: 900` renders in **Apple
SD Gothic Neo Heavy** (a Korean UI face). The obvious round-2 fix — "use extreme weight contrast,
300 vs 900" — would have produced a video set in a *terminal font and a Korean UI font* while
passing `fonts_check`, passing `check`, and passing any weight-diversity metric anyone adds.

---

## 1. What the engine actually does

### 1.1 The full surface (`bay-text::TextStyle`, `bay-project::TextElement`)

| available | not available |
|---|---|
| `family: Option<&str>` | italic / oblique (no `Style` axis at all) |
| `weight: u16` (CSS numeric) | width / stretch axis (condensed, narrow, expanded) |
| `align: left/center/right` | stroke, outline, drop shadow, glow |
| `letter_spacing: f32` (em; negative tightens) | per-span or per-word styling inside one element |
| `line_height: f32` (× font size) | OpenType features (`tnum`, `onum`, `smcp`, `case`) |
| `color: #rrggbb` (single flat fill) | text transform (uppercase/lowercase) |
| `\n` hard line breaks; auto-wrap at box width | gradient / image fill, per-character colour |
| | any way to **measure** a string before placing it |

`fontSize` is quoted against a **1080-tall reference** and scaled by `canvas_height / 1080`
(`check.rs:130`, mirrored in `bay-preview`). On a 1080×1920 canvas **rendered px = fontSize ×
1.7778**. Every size in this document is given both ways; getting this backwards is a 1.78×
error in either direction.

`transform.scale` sizes the **layout box**, not the glyphs. The box is `scale × canvas_width`
wide, and text wraps inside it. Glyph size comes only from `fontSize`.

### 1.2 The font-resolution matrix — measured

Method: `Buffer::layout_runs()` → `LayoutGlyph.font_id` → `fontdb::Database::face()`, so this is
the face that actually drew the glyphs, not an inference from pixel width.

**Fallback identity by requested weight (any unmatched family/weight lands here):**

| requested weight | face you actually get |
|---:|---|
| 100 | Apple SD Gothic Neo Thin |
| 300 | Apple SD Gothic Neo Light |
| 400 | System Font (`.SFNS-Regular`) |
| 500 | Apple SD Gothic Neo Medium |
| 600 | Apple SD Gothic Neo SemiBold |
| **700** | **Menlo Bold** |
| 900 | Apple SD Gothic Neo Heavy |

Matching requires an **exact weight** *and* **stretch = Normal**. There is no nearest-weight
snapping and no synthetic bolding.

**Weights that actually resolve to the requested family** (fine scan, 100→950 step 25):

| family | usable weights | trap |
|---|---|---|
| **Avenir Next** | 275, 400, 500, 600, 700, 900 | — (widest real ramp on macOS) |
| **Helvetica Neue** | 100, 200, 300, 400, 500, 700 | 600 → Apple SD Gothic Neo; 900 → Apple SD Gothic Neo |
| **Avenir** | 300, 400, 500, 800, 900 | **700 → Menlo Bold** |
| **Charter** | 400, 700, 900 | — |
| **Iowan Old Style** | 400, 700, 900 | — |
| **Superclarendon** | 300, 400, 700, 900 | — |
| **Optima** | 400, 700, 900 | — |
| **Gill Sans** | 300, 400, 600, 700 | — |
| **Seravek** | 300, 400, 500, 700 | — |
| **Baskerville** | 400, 600, 700 | — |
| Athelas, PT Serif, Georgia, Didot, Bodoni 72, Rockwell, Palatino, PT Sans, Trebuchet MS, Verdana, Galvji, Menlo, PT Mono, Courier New | 400, 700 | — |
| American Typewriter | 300, 400, 600, 700 | — |
| Copperplate | 300, 400, 700 | caps only, cap height 53/100 |
| **System Font** (SF Pro) | **400 only** | 700 → Menlo Bold. SF's Bold/Black are unreachable. |
| **.New York** | **400 only** | 700 → Menlo Bold |
| Monaco, Andale Mono | 400 only | 700 → Menlo Bold |
| **DIN Alternate** | **700 only** | 400 → SF Regular |
| **Arial Black** | **900 only** | 400 → SF Regular, 700 → Menlo Bold |
| **Big Caslon** | **500 only** | 400 → SF Regular |
| **Cochin** | **500, 700** | 400 → SF Regular |
| **Hoefler Text** | **700 only** | **400 renders `HoeflerText-Ornaments` — dingbats, verified visually in `specimen.png`** |
| **Phosphate** | 400 → `Phosphate-Inline` | the Solid cut is unreachable |
| **Impact** | **none** | every weight falls back |
| **DIN Condensed, Arial Narrow, PT Sans Narrow, Avenir Next Condensed, Skia** | **none** | non-Normal stretch, and bay never sets stretch |
| **.SF NS** | **none** | `fonts_check` reports it *available*; no weight ever renders it |

`fonts_check` answers "does any face claim this family name", which is **not** the same question
as "will my text render in it". `.SF NS` is available and unusable; `Hoefler Text` is available
and renders ornaments; `Impact` is available and renders SF.

### 1.3 What `check.rs` can see today

`bay-core` does **not** depend on `bay-text` (`bay-core/Cargo.toml` deps: serde, bay-project,
bay-time). So `check` cannot measure a single glyph. It cannot see: wrapping, line width, ink
box, text-over-shape occlusion, mono share, font fallback, or whether a headline fits. Its only
typographic finding is `small-text`, which is:

```rust
const MIN_LEGIBLE_TEXT_FRACTION: f32 = 0.022;      // of canvas HEIGHT
rendered_font_px(font_size, h) = (font_size * h / 1080.0).max(8.0)
```

On 1080×1920 that floor is **42 rendered px**. wicks-v2's modal 34 nominal = **60.4 rendered px
= 3.15% of height** — comfortably clear of the floor. And it is a **Warning**, which
`Report::is_clean()` ignores. `small-text` was never going to catch this video.

---

## 2. Type scale for 1080×1920

### 2.1 The ladder

Modular scale, **ratio 1.25 (major third)**, base = body at 80 rendered px. Nine roles, each
role separated from the ones it appears beside by ≥2 steps (≥1.5625×), because one step of 1.25
is not visible as hierarchy in motion.

| role | rendered px | `fontSize` to pass | cap height (Avenir Next, 0.71 em) | cap as % of 1920 | max chars/line in a 900 px column (Avenir Next 400) |
|---|---:|---:|---:|---:|---:|
| footnote / source | 51 | 29 | 36 | 1.9% | 37 |
| kicker / eyebrow | 64 | 36 | 45 | 2.4% | 29 |
| label / axis / unit | 64 | 36 | 45 | 2.4% | 29 |
| body / supporting line | 80 | 45 | 57 | 3.0% | 23 |
| burned-in caption | 100 | 56 | 71 | 3.7% | 19 |
| subhead / deck | 125 | 70 | 89 | 4.6% | 15 |
| headline | 195 | 110 | 138 | 7.2% | **10** |
| hero statement | 305 | 172 | 217 | 11.3% | **6** |
| data value / payoff figure | 244–477 | 137–268 | 173–339 | 9–17.7% | fit to column, see §5 |

Full ladder in rendered px: 41 · 51 · 64 · 80 · 100 · 125 · 156 · 195 · 244 · 305 · 381 · 477.
Intermediate steps (41, 156, 244, 381) exist for a second tier inside a scene; do not invent
sizes off the ladder.

**Floor: 48 rendered px (fontSize 27).** Nothing below that carries meaning. Raise `check`'s
`MIN_LEGIBLE_TEXT_FRACTION` from 0.022 to 0.025 (48/1920) and make it an **Error** for any
element whose content is more than 3 words.

### 2.2 Justification — viewing distance and the thumb test

Two constraints, and they point at different numbers:

**(a) Phone at arm's length.** A 6.1" 19.5:9 phone is ~140 mm of active height for a 1920 px
frame → **13.7 px/mm**. At a 350 mm viewing distance one arcminute (the acuity limit) subtends
0.102 mm = **1.40 px**. Comfortable continuous reading wants an x-height of 12–16 arcminutes →
**17–22 px of x-height** → for Avenir Next (x-height 0.47 em) a font of **36–48 rendered px**. So
on a phone, held normally, wicks-v2's 60 px body type is *comfortably above* the legibility
floor. That is the point: **legibility was never the failure.** Sizing rules justified only by
legibility (which is what `small-text` is) will always certify a video like this one.

**(b) The thumb test — the constraint that actually bites.** In feed, before the tap, the frame
is ~200 px wide: a **0.185×** downscale. `thumbtest.png` renders both treatments at exactly
200×356 and upscales 3× for inspection. Cap height *at thumb size*:

| role | wicks-v2 | cap @ thumb | proposed | cap @ thumb |
|---|---|---:|---|---:|
| kicker | Menlo 400 @ 46 px | 6.2 px | Avenir Next 700 @ 41 px, +0.20 em | 5.4 px |
| headline | Baskerville 400 @ 110 px, 2 lines, hairline strokes | 13.6 px | Charter 900 @ 195 px | **24.2 px** |
| body | Menlo 400 @ 60 px, wraps to 3 lines and clips | 8.1 px | Avenir Next 400 @ 64 px, 2 lines | 8.4 px |

At 200 px wide the left frame has **no** element that arrests a scroll — its largest cap height
is 13.6 px in a 41-contrast hairline serif. The right frame has exactly one. That is the whole
test: **at 200 px wide, exactly one thing must be readable, and it must be the point of the
scene.** The ladder is built backwards from a ~24 px thumb cap height, which is where a 2–3 word
phrase stops being text you decode and becomes a shape you recognise.

Corollary the ladder encodes: **anything at or below the body step is invisible in feed and must
not be load-bearing.** Kickers, labels, footnotes and axis text are texture for the people who
already stopped. Do not put the argument there.

### 2.3 Normalising across families

`fontSize` is not a size; cap height is. Measured cap heights per 100 px em:

| family | cap | x-height | family | cap | x-height |
|---|---:|---:|---|---:|---:|
| Futura | **76** | 48 | Charter | 67 | 48 |
| Superclarendon / Rockwell | 74 | 51 | Baskerville | 67 | 41 |
| Menlo / Verdana | 73 | 55 | Athelas | 67 | 44 |
| Helvetica Neue / Avenir Next / Didot / .New York | 71 | 52/47/43/46 | Cochin | 65 | 37 |
| Iowan Old Style / PT Serif | 70 | 48/50 | Copperplate | **53** | 44 |
| Optima / Georgia | 69 | 48 | Courier New | 58 | 43 |

**Rule:** when swapping the display face, hold cap height constant, not `fontSize`. Charter at
the headline step needs `fontSize × 71/67 = ×1.06` to match Avenir Next; Copperplate needs
**×1.34**; Courier New **×1.22**. Ignoring this is why a "same size" face swap looks like a
mistake.

---

## 3. Typeface selection

### 3.1 Verified usable — what is on this machine and what it is for

Every family below was resolved through bay's own stack at the weight given. Character notes are
what the face *says*, because "pick a nice font" is not an instruction an agent can follow.

**Sans**

| family | weights | character | genre it suits | caution |
|---|---|---|---|---|
| Avenir Next | 275/400/500/600/700/**900** | geometric-humanist, wide apertures, round bowls, calm | product, explainer, optimistic tech, data essay | it is Apple's marketing sans — ubiquitous; earn it with the 900 |
| Helvetica Neue | 100/200/300/400/500/700 | neo-grotesque, closed apertures, tight, neutral to the point of refusing to have an opinion | Swiss/institutional, finance, editorial data | banned as a *default*; at 100 or 700 it is a decision, at 400 it is a shrug |
| Avenir | 300/400/500/800/900 | warmer, older cut, longer ascenders | documentary, human-scale | **700 → Menlo Bold**; use 800 |
| Futura | 500/700 | pure geometric, single-storey a, x-height only 0.48 em | fashion, mid-century, luxury, film titling | terrible below 100 rendered px (tiny x-height); uppercase display only |
| Gill Sans | 300/400/600/700 | humanist English, calligraphic g, slightly uneven | publishing, documentary, heritage | weight jumps are inconsistent between 400 and 600 |
| Optima | 400/700/**900** | flared stems — a sans with serif modulation | cosmetics, memorial, elegance, wellness | ExtraBlack (900) is genuinely distinctive and almost never used |
| Seravek | 300/400/500/700 | humanist, soft, faintly quirky terminals | friendly editorial, health, education | **not in the model monoculture** — a real differentiator |
| Galvji | 400/700 | neutral Apple Indic-companion sans | anywhere a plain sans is wanted without reaching for Helvetica | proportional figures |
| PT Sans | 400/700 | neutral, faintly condensed | UI-adjacent, technical | dull; use as text partner only |

**Serif**

| family | weights | character | genre it suits | caution |
|---|---|---|---|---|
| **Charter** | 400/700/**900** | sturdy low-contrast transitional, designed for coarse output — survives H.264 | journalism, data essay, editorial | the single best display serif on this machine; the Black is real |
| Iowan Old Style | 400/700/**900** | warm old-style, large x-height, generous | long-form, book, human interest | — |
| Superclarendon | 300/400/700/**900** | Clarendon slab with ball terminals, widest advance measured (0.60 em) | sport, western, bold titling, retail | 15 chars per 900 px line at 100 px — plan for it |
| Baskerville | 400/600/700 | high contrast, refined, small x-height (0.41 em) | literary, formal, luxury | needs ×1.15 size vs Charter for equal presence |
| Athelas | 400/700 | delicate transitional | literary, quiet | strokes thin out below 60 rendered px |
| Didot / Bodoni 72 | 400/700 | didone, hairline serifs, extreme contrast | fashion, beauty, masthead | **hairlines shimmer under motion and vanish under H.264 below ~150 rendered px** — display only |
| PT Serif / Georgia / Palatino / Rockwell | 400/700 | workhorses | fallback text faces | Georgia has **proportional figures** — disqualified for data |
| Big Caslon | **500 only** | display Caslon, sharp | title cards ≥200 rendered px | one weight; no hierarchy inside the family |
| Hoefler Text | **700 only** | Black, dense | heavy titling | **400 = ornaments.** Never request 400. |

**Mono — use as a *voice*, not as a default**

| family | weights | character |
|---|---|---|
| PT Mono | 400/700 | humanist skeleton, reads less like a terminal than Menlo |
| Menlo | 400/700 | DejaVu Sans Mono derivative — this *is* the terminal |
| Courier New | 400/700 | typewriter, low cap height (0.58) — reads as document, not code |
| Monaco / Andale Mono | 400 only | one weight; no hierarchy |

**Display / special**

| family | weights | note |
|---|---|---|
| DIN Alternate | **700 only** | engineering/signage grotesque, narrow advance (0.44 em → 20 chars/900 px at 100 px), tabular figures. The best available face for large numbers and technical labels. |
| Arial Black | **900 only** | the only true black grotesque reachable; ugly but loud |
| Copperplate | 300/400/700 | engraved caps, no real lowercase, cap height 0.53 — title cards only |
| American Typewriter | 300/400/600/700 | slab typewriter, tabular figures |
| Phosphate | 400 → Inline | outlined display caps; the Solid cut cannot be selected |

### 3.2 Do not use

| family | why |
|---|---|
| **Menlo / Monaco / Courier New / Andale Mono as a body or headline face** | see §3.3 |
| Impact, Skia, DIN Condensed, Arial Narrow, PT Sans Narrow, Avenir Next Condensed | **unreachable** — the engine cannot select a non-Normal stretch. Requesting them renders SF or Menlo Bold. |
| `System Font`, `.SF NS`, `.New York` | one weight (or none). No hierarchy is possible inside them. `System Font` is also *the fallback*, so using it deliberately makes fallback bugs invisible. |
| Georgia, Seravek, Athelas, Superclarendon, `.New York`, Big Caslon, Galvji, Hoefler Text **for numbers** | proportional figures — measured spread 18–32 px at 120 px (§5) |
| Papyrus, Comic Sans MS, Chalkboard SE, Marker Felt, Brush Script, Zapfino, Herculanum, Luminari, Trattatello, Party LET, Bradley Hand, Snell Roundhand | costume fonts |
| Verdana, Tahoma, Trebuchet MS, Lucida Grande, Arial | reads as a 1998 desktop, not a film |
| Inter, Roboto, Poppins, Outfit, Sora, Syne, Playfair Display, Cormorant, EB Garamond, Bodoni Moda | the model monoculture — and **none of them are installed**, so requesting one silently renders SF |

### 3.3 Why a monospace body face reads as a developer mockup

Not taste — three mechanical properties, all measured:

1. **Uniform advance destroys word shape.** Fluent reading is largely word-shape recognition;
   monospace flattens `i`, `l`, `m` and `w` to one width (Menlo: every glyph 0.6023 em). Menlo's
   average lowercase advance is **0.6002 em vs 0.4735 for Helvetica Neue — 27% wider**, so the
   same sentence occupies 27% more line, and you get **15 characters per 900 px line at 100
   rendered px vs 19–21** for a proportional face. wicks-v2's body copy wrapped to three lines
   and clipped for exactly this reason (reproduced in `thumbtest.png`, left frame).
2. **Two weights, maximum.** Menlo, PT Mono and Courier New resolve at 400 and 700 only; Monaco
   and Andale Mono at 400 only. A family that cannot express a third weight cannot express a
   hierarchy, so a mono-only project is *structurally* forced into the one-weight look
   wicks-v2 has (`fontWeight: 400` on all 73 elements).
3. **Monospace is a costume with one meaning.** Fixed advance exists because of teletypes,
   punched cards and terminals. It signals *machine output* — which is correct for a log line
   and a lie for a sentence a person wrote. 69 of 73 elements in Menlo does not read as a
   typographic choice; it reads as a screenshot of a terminal that someone animated.

The correct use of mono in this house: a kicker, a ticker, a source line, a code fragment, a
unit — **never the headline, never the body, never the hero figure**, and never more than ~15% of
the type on screen.

**And the numbers argument is false.** `banned-defaults.md` and `layout.md` both say "numbers are
always mono", which is what put Menlo in this video. Measured (§5), **13 of the 20 non-mono
families tested already have perfectly tabular figures** — including Charter, Avenir Next,
Helvetica Neue, Optima, Baskerville, Iowan Old Style, Didot, DIN Alternate and Arial Black. You
have never needed a mono for numbers on macOS.

### 3.4 Pairings — display + text + numeric, all verified to resolve

Each crosses a real boundary (serif↔sans, or geometric↔slab), each has a stated tension, and
each numeric face is measured-tabular.

| # | name | display | text | numeric | the tension |
|---|---|---|---|---|---|
| 1 | **Editorial data** | Charter 900 | Avenir Next 400 | Avenir Next 500 | printed argument vs digital instrument |
| 2 | **Technical brief** | DIN Alternate 700, uppercase, +0.06 em | Seravek 400 | DIN Alternate 700 | measured/engineered vs spoken/human |
| 3 | **Documentary** | Iowan Old Style 900 | Gill Sans 400 | Gill Sans 400 | archival vs reportorial |
| 4 | **Mid-century luxury** | Futura 700 uppercase, +0.10 em | Optima 400 | Optima 400 | machine-drawn vs hand-carved |
| 5 | **Sport / retail** | Superclarendon 900 | Helvetica Neue 500 | Helvetica Neue 500 | shouted vs stated |
| 6 | **Formal notice** | Copperplate 700 uppercase, +0.14 em | Baskerville 400 | Baskerville 400 | engraved vs set |
| 7 | **Terminal, on purpose** | PT Mono 700 | PT Mono 400 | PT Mono 400 | only when the subject *is* software |

Rules that survive whatever you pick: never two sans; never two faces from the same genre; the
display face must carry a weight the text face does not; one expressive face per project, not
per scene.

---

## 4. Weight and contrast as hierarchy

wicks-v2 is `fontWeight: 400` on all 73 text elements. A hierarchy needs **four axes moving
together**, because any one of them alone is gameable and none alone is visible at thumb size.

| axis | weak (what we shipped) | what a real hierarchy does | measurable as |
|---|---|---|---|
| size | 34 nominal ×41 elements, max 96 | ≥3 tiers, adjacent tiers ≥1.5625× apart, top tier ≥195 rendered | `fontSize` ratios per scene |
| weight | 400 everywhere | display ≥700 (ideally 900), body 400, quiet 300 — **a ≥300-unit gap between the loudest and quietest** | `fontWeight` spread, and each pair must *resolve* |
| colour value | `#EDECE6` ×48, `#73737E` ×19 | primary 16:1, secondary 8:1, muted 4.5:1 on ground; accent on exactly one element per scene | contrast ratio vs the composited ground |
| case + tracking | none | kicker uppercase +0.14…0.20 em; display ≥150 rendered px at −0.01…−0.03 em | `letterSpacing`, and `content.chars().all(uppercase)` |

**Families that can actually express a ≥300-unit weight gap in one family:** Avenir Next
(275→900, 625), Helvetica Neue (100→700, 600), Avenir (300→900, but skip 700), Charter
(400→900, 500), Optima (400→900), Superclarendon (300→900), Iowan Old Style (400→900), Gill Sans
(300→700), Seravek (300→700), Baskerville (400→700). **Everything else is a two-weight family and
must borrow its contrast from a partner face.**

Light-on-dark optical corrections (dark ground is the house default):
- drop one weight step: use 300–400 for body where a light ground would take 400–500;
- add 0.05–0.10 to `lineHeight` (so body = 1.30–1.35 rather than 1.20);
- add back ~+0.01 em tracking at display sizes to fight the halo — but keep display negative
  overall (net −0.01 to −0.02 em).

---

## 5. Numerals

### 5.1 Tabular vs proportional — measured, not assumed

Digit advances at 120 px, ten digits, per family. Spread 0 = tabular = digits never move.

| tabular (spread 0) | proportional (spread @120 px) |
|---|---|
| Helvetica Neue 400/500/700 · Avenir Next 400/500/700/900 · **Charter 400/700/900** · Optima 400/900 · Gill Sans 400/700 · Futura 500/700 · Iowan Old Style 400/900 · Baskerville 400/700 · PT Serif · Didot · Bodoni 72 · Rockwell · American Typewriter · **DIN Alternate 700** · Arial Black 900 · Copperplate · Verdana · PT Sans · Trebuchet MS · Menlo · PT Mono · Courier New | **System Font / SF (21)** · **.New York (32)** · Athelas (26) · Seravek (28/29) · Superclarendon (25/19) · Georgia (22) · Galvji (20) · Big Caslon (28) · Hoefler Text 700 (18) |

A spread of 21 px at 120 px is **17% of a digit's width**. In a count-up from `0` to `999`, every
frame where a `1` replaces a `0` shifts every digit to its left — 3-digit numbers visibly
breathe. `.New York`'s 32 px spread (36%) is the worst; SF — the default face when anything falls
back — is nearly as bad.

### 5.2 The count-up problem in bay specifically

bay has no count-up primitive: a counting number is **one text element per displayed value**,
each with `start`/`duration`, produced by `add_text` in a loop (this is what `recipes.md:196`
does, with `fontFamily: "Menlo"`). Three consequences:

1. **Anchor the element, not the string.** With `anchorX: 0.5` and a proportional face, the
   number re-centres every frame; with `anchorX: 1` (right edge) and a **tabular** face, digits
   stay on a fixed grid and only the leftmost column grows. Right-anchor every counter.
2. **Reserve the widest string's width.** Set the box (`scale`) from the *final* value, not the
   first, or the layout box grows mid-count.
3. **Do not count more than ~24 steps.** One element per frame of a 1 s count at 30 fps is 30
   elements for one number — which is how a project reaches 188 elements and one scene. Count in
   8–15 steps with an ease-out on the *value* (large jumps first), not 30 linear steps.

### 5.3 How big is the payoff number

The payoff figure is sized **to the column**, not picked off the ladder:

> target ink width = **0.80–0.95 × content column width**

For a 900 px column and Charter 900 (digit advance 1.13 em at weight 900 ÷ 120 px sample =
0.943 em/digit… use the measured 113/120 = 0.94 em):

| digits | rendered px for 0.88 column fill | `fontSize` |
|---:|---:|---:|
| 2 | 420 | 236 |
| 3 | 280 | 158 |
| 4 with a separator (`1,234` ≈ 4.16 em) | 190 | 107 |
| `+248%` (≈ 4.62 em) | 171 | 96 |

**The label is 1/5 to 1/7 of the value.** A figure at 280 rendered px takes a label at 41–56
rendered px (footnote/kicker step). Ratios between 1:2 and 1:3 read as two headlines arguing;
1:5 and beyond reads as a number with a caption, which is what a data video wants.

Unit and currency glyphs go at the **label** size, baseline-aligned, not at the figure size —
`$` and `%` at hero size steal the frame from the digits. bay cannot mix sizes inside one
element, so this is two elements with hand-computed x offsets, which needs §10 gap G1.

Beware glyph-width surprises when a value flips sign: `−` (U+2212) is wider than `+` in most of
these faces, and a "safe" figure can push into a keep-out on the negative frame only.

---

## 6. Measure and line breaking

### 6.1 Characters per line — the number nobody computed

`chars ≈ 900 / (avg_advance_em × rendered_px)`, avg advance measured per family (§2.3 table
source data). For a **900 px content column**:

| rendered px | role | Avenir Next 400 | Avenir Next 700 | Charter 400 | Charter 900 | Baskerville 400 | Menlo 400 | DIN Alt 700 |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 64 | kicker/label | 29 | 27 | 30 | 25 | 33 | 23 | 32 |
| 80 | body | 23 | 22 | 24 | 20 | 27 | 19 | 26 |
| 100 | caption | 19 | 18 | 19 | 16 | 21 | 15 | 20 |
| 125 | subhead | 15 | 14 | 16 | 13 | 17 | 12 | 16 |
| 156 | — | 12 | 11 | 12 | 10 | 14 | 10 | 13 |
| 195 | headline | **10** | **9** | **10** | **8** | 11 | 8 | 10 |
| 305 | hero | 6 | 6 | 6 | 5 | 7 | 5 | 7 |

**A headline line holds 8–10 characters.** wicks-v2's headline was "Same range. / Different day."
— 11 and 14 characters. Both overflow at the headline step. `thumbtest.png` reproduces it: set at
156 rendered px in Charter 900 (10.4 chars/line), *"Same range." alone wraps to two lines*, which
pushes "Different day." onto lines 3–4 and out of the box entirely. The copy and the size were
never compatible, and nothing in the pipeline could tell anyone.

This is the number that should govern copywriting: a headline is **2–3 words, ≤10 characters per
line, ≤3 lines**. If the line you want is 14 characters, you do not shrink the type — you cut the
words, or you accept a third line, or you need a condensed face (which the engine cannot reach,
gap G5).

Optimal measure for the body step is 23–27 characters per line, which is *below* the print ideal
of 45–75 and correct: a video line is read in one saccade or not at all.

### 6.2 Line breaking rules

- **Always author breaks with `\n`. Never rely on auto-wrap.** Auto-wrap breaks at whatever
  character overflows the box, which is how "Same range. / Different day." became a shape nobody
  chose. Every multi-word element ≥ the subhead step gets explicit breaks.
- **Never end a line on a function word.** Stop list: `a an the of in on at to for with from by
  and or but as is are was were that than into over under its his her their this these`. Break
  *before* the phrase, not inside it.
- **Balance the lines.** Rendered widths of the lines of one element within **±25%** of each
  other. A 9-character line above a 3-character line reads as a mistake.
- **Widows and orphans.** The last line of a multi-line element must have ≥2 words **or** be ≥40%
  of the mean line width — unless it is deliberately the payoff, in which case it should be a
  *separate element at a different size*, not a short last line.
- **≤3 lines for a headline, ≤2 for a caption, ≤4 for body.** No hyphenation exists; a line that
  needs one is too long.
- **Punctuation is not a break point.** A full stop mid-line is fine; a full stop that lands
  alone at the start of a line is not.

### 6.3 The occlusion bug, and the rule that prevents its whole class

wicks-v2 at t≈19 s: the headline's second line is behind the card. The mechanism:

- text was placed by a y fraction with an unknown ink height (nobody could measure it);
- the card was placed by a y fraction with a known height;
- nothing compared the two, because `check` cannot compute a text ink box (§1.3).

**Rule L1 (reserved bands).** Every scene declares horizontal bands, and each element belongs to
exactly one. No two bands overlap; every element's ink box must stay inside its band.

```
band          y range        px      fits
safe top      0.000–0.055     106    nothing (platform chrome)
kicker        0.055–0.125     134    1 line @ 64px × 1.2 = 77
headline      0.125–0.360     451    2 lines @ 195px × 1.1 = 429   (3 lines needs 643 — does not fit)
artwork       0.360–0.660     576    card / chart / image
body          0.660–0.780     230    2 lines @ 80px × 1.35 = 216
caption       0.780–0.845     125    1 line @ 100px × 1.2 = 120
platform      0.845–1.000     298    nothing (caption band + action rail)
```

The band table is what makes the rule checkable without solving general layout: an element's
required height is `lines × lineHeight × rendered_px`, and that number is computable **without**
text measurement, today, from the project model alone. Occlusion becomes impossible by
construction.

Note what the arithmetic says: **a three-line headline at the headline step does not fit its
band.** It needs 643 px against 451. So a three-line headline must explicitly claim the artwork
band as well — merging two bands is allowed, but it is then a stated decision that costs you the
card, rather than a card silently drawn on top of line two. That is the difference between
wicks-v2's bug and a layout.

**Rule L2 (ink overlap).** Additionally, once `check` can measure text (gap G1), no text element's
ink box may be covered by more than **8%** of its area by an opaque (`opacity ≥ 0.5`) element on a
higher layer at any sampled time. L1 prevents the common case; L2 catches the rest.

And note the round-1 finding this compounds with: nothing in wicks-v2 sits below y = 0.73. The
band table is also a **coverage** obligation — a scene with an empty artwork band and an empty
body band is the "bottom half is dead" defect, now nameable.

---

## 7. Kinetic type

### 7.1 What works, and what it costs in bay today

| technique | quality | bay today | cost |
|---|---|---|---|
| **by line** — each line its own element, staggered 80–140 ms, decaying y offset (48 → 32 → 20 px), binary opacity | the workhorse; reads as one arrival | **yes** | 1 element per line |
| **mask wipe** — a rect mask animated across the type so it reveals from behind an edge | the single best-looking move available; no fade at all | **yes** — `mask_set` exists and masks are on `TextElement` | 1 element + 1 mask |
| **by phrase** — 2–4 word chunks on a percussive grid, each with a *distinct* entrance | best for narration sync | **yes** | 1 element per phrase |
| **by word, inline** — words appearing left-to-right on one line | modern default for captions | **no, in practice** — needs the x offset of each preceding word, and bay cannot measure text (§1.3). Guessing offsets is what produces collisions. | blocked on G1 |
| **by word, stacked** — each word on its own line, revealed in order | the workable substitute today | **yes** | 1 element per word |
| **by character / typewriter** | rarely worth it; reads as a terminal | **no** — same measurement problem, ×5 the elements | blocked on G1 |
| **word-level highlight** (current word brightens inside a visible phrase) | materially raises watch-through on short-form | **no** — needs per-span colour inside one element | blocked on G6 |
| **weight or width morph** | premium | **no** — no variable-axis animation | large |

Timing constraints that hold for all of them:

- total stagger across a phrase ≤ **500 ms**, or it reads as a queue, not an arrival;
- per-element entrance **180–400 ms** — the wicks-v2 mode of **0.098 s (3 frames) is a pop, not a
  move**, and 76 of ~150 moves were that;
- decay the travel distance across the stagger (48 → 32 → 20 → 12 px), do not repeat one offset;
- **binary opacity on a cascade** — 0→1 in one step, let position carry the entrance. Fading each
  line individually is what makes a cascade mush, and is a large part of how 107 of 119 animated
  channels ended up being opacity;
- a line must be on screen ≥ **1.1 s** to be read, ≥ **0.6 s** if it is ≤3 words.

### 7.2 Which of these avoids the fade machine

Of the moves available today, exactly three do not use opacity as the primary channel: the mask
wipe, the by-line positional cascade with binary opacity, and a scale-from-0.92 emphasis on a
figure. Any typography plan that does not name one of those three per scene will regress to
fades, because fade is the only move that requires no layout knowledge.

---

## 8. Colour on type

### 8.1 Contrast, measured (WCAG relative luminance, sRGB)

Against the house ground `#0E0E12`:

| fg | ratio | verdict |
|---|---:|---|
| `#FFFFFF` | 19.26 | reserved for the single loudest element |
| `#EDECE6` | 16.27 | primary type |
| `#A8A8B0` | 8.16 | secondary |
| `#FFC940` | 12.55 | accent that stays readable |
| `#4ADE80` | 11.05 | accent |
| `#6AA9FF` | 8.01 | accent |
| `#FF5B5B` | 6.33 | accent — the house red, fine on the ground, marginal on a card |
| `#73737E` | 4.11 | **below 4.5** — decoration only, never a word that matters |
| `#606070` | 3.12 | chart track only |

wicks-v2 used `#EDECE6` (×48), `#73737E` (×19) and `#FF5B5B` (×3). The value hierarchy is
16.3 → 8.2 → 4.1, i.e. **each tier roughly halves**, which is right; the failure was that 48 of
73 elements sat in the top tier, so the tiering encoded nothing.

**Rule:** primary ≥14:1, secondary 7–9:1, muted 4.5–5:1, and **≤35% of on-screen text elements in
the primary tier**.

### 8.2 Over video, where the backdrop is unknown

| ground | white | off-white |
|---|---:|---:|
| `#000000` | 21.00 | 17.74 |
| `#303030` dark footage | 13.20 | 11.15 |
| `#808080` mid footage | **3.95** | **3.34** |
| `#B4B4B4` bright footage | **2.07** | **1.75** |

**White text alone is never safe over arbitrary footage** — a mid-grey frame drops it to 3.95:1
and a bright frame to 2.07:1, and *every* clip contains both at some point. This is the most
frequently violated caption rule in the field and bay cannot currently do the standard fix
(stroke/shadow, gap G3). What is available today:

| treatment | how, today | worst-case ratio over any backdrop |
|---|---|---:|
| **plate** — `add_shape` rect behind the text, one layer down | `color: "#0E0E12"`, `opacity ≥ 0.60`, corner `radius: 0.12`, padded ≥0.4× cap height on every side | **5.08** at α 0.6; **7.31** at α 0.7; **10.66** at α 0.8 |
| **plate, pure black** | `color: "#000000"`, `opacity 0.70` | 8.45 |
| **fake drop shadow** — duplicate the text element, `color: "#000000"`, offset +0.004 x/y, one layer below, `opacity 0.75` | 2 elements per caption | raises the floor ~2 stops; not a guarantee |
| **fake stroke** — 8 offset copies | 9 elements per caption; do not | — |
| **gradient scrim** | not available (no gradients) | — |

**Rule C1: over any video or image element, a caption must sit on a plate at `opacity ≥ 0.60`, or
the text must be measured ≥4.5:1 against the actual composited frame at ≥5 sampled times.** The
second half is the interesting one: `snapshot` already renders a frame headlessly, so the check
can sample the real pixels under a text element's ink box and compute the 5th-percentile contrast.
That is a check nothing can game, because it measures the finished picture.

### 8.3 Accent discipline

One accent element per scene, and the accent must be on the element that *is* the point. wicks-v2
used its accent 3 times in 188 elements — technically scarce, but never on the payoff. Scarcity
without placement is not discipline, it is absence.

---

## 9. The rules, and how each resists being gamed

Every rule is stated as a number, with the check that proves it and the attack that breaks it.

| # | rule | check | how an agent games it | why it still can't ship wicks-v2 |
|---|---|---|---|---|
| **T1** | Every `(fontFamily, fontWeight)` pair must resolve to a face whose family **is** the requested family. | resolve at `add_text` time via `layout_runs` → `face()`; **Error**, refuse the call | none — it is a fact about the font DB | this is the gate that makes every other weight rule real |
| **T2** | ≤ **35%** of text elements may share the modal `fontSize`, and a scene must show **≥3 size tiers** separated by ≥1.5625×, with the top tier ≥ **195 rendered px** | project model only | make 3 tiers of 1 element each and 60 elements at one size | the modal cap (wicks: 41/73 = 56%) forces the *mass* to spread, not just the extremes |
| **T3** | The largest text element in a scene must have cap height ≥ **6% of canvas height** (115 px on 1920), be on-canvas, `opacity ≥ 0.9` for ≥1.0 s, and contain ≥1 word of the script | project model + cap-height table | place a giant element and hide it behind a card | L2 occlusion + the visibility duration + "must contain script words" close it |
| **T4** | Monospace families ≤ **15% of total text ink area** per scene, and a mono element may never be the largest in its scene | needs text measurement (G1); approximate today as `chars × avg_advance × rendered_px × lines` | set everything in Menlo at 12% ink by making it tiny | tiny type then violates T2's top-tier and the 48 px floor |
| **T5** | ≥ **2 and ≤ 3** families per project; the display family must offer a weight the text family does not | project model | use Charter 400 and Charter 900 and call it two roles | require *distinct family names* for display and text, and cross-genre (a serif/sans or slab/geometric boundary) — enforceable from a genre table |
| **T6** | Weight spread within a project ≥ **300 units**, and both endpoint pairs must satisfy T1 | project model | request 300 and 900 on a two-weight family | T1 rejects it — this is the pair that makes T6 non-vacuous |
| **T7** | No authored line may exceed **0.92 × its layout box width** when measured in the resolved face; no element may auto-wrap | needs G1 | shrink the type until it fits | the 48 px floor and T2's tiers block shrinking |
| **T8** | Every element's ink box stays inside its declared band (§6.3); bands do not overlap or are explicitly merged; ≥ **3 of the 5** content bands occupied per scene, and the occupied bands must span ≥0.45 of the canvas height | project model + line-count arithmetic — **no text measurement needed** | put one 51 px footnote in each empty band | the span requirement plus T3 (top tier ≥6% cap height) means a band counts only if something substantial is in it; wicks-v2 (nothing below y=0.73, span 0.64→ but only 2 occupied bands) fails |
| **T9** | Any element whose content is ≥40% digits must resolve to a face with **digit-advance spread 0** | measure the 10 digit advances of the resolved face | use Menlo | allowed, but T4 caps mono ink and T3 forbids mono as the largest element, so the hero figure has to be a proportional-face tabular figure |
| **T10** | A payoff figure's ink width must be **0.80–0.95 × its content column**, and its label ≤ **1/5** its cap height | needs G1 | make the column narrow | column width is `scale × canvas_width`; require ≥0.75 for a hero scene |
| **T11** | Text over any video/image element requires a plate at `opacity ≥ 0.60` **or** a measured ≥4.5:1 5th-percentile contrast against the composited frame at ≥5 times | frame sampling via the existing snapshot path | put a plate at 0.60 over a black background where it does nothing | harmless — it is the correct answer over black too |
| **T12** | Uppercase runs > 12 characters need `letterSpacing` ≥ 0.08 em; type ≥150 rendered px needs `letterSpacing` ≤ −0.01 em; `lineHeight` ≥1.30 for body on a dark ground, ≤1.10 for display | project model | trivially satisfiable | it is a hygiene rule, not a taste rule — cheap and always right |
| **T13** | No line ends on a function word; last line of a multi-line element ≥2 words or ≥40% of mean line width; ≤3 lines headline / ≤2 caption / ≤4 body | content string only, plus G1 for widths | write one-line headlines | that *is* the improvement |

**The pattern.** Round 1 counted distinct values (19 easings, 47 durations, 188 elements) and got
gamed because a count says nothing about where the mass sits. Every rule above is one of three
shapes instead:

1. **a fact about the rendered result** (T1, T9, T11) — not gameable, only satisfiable;
2. **a cap on the mode, not a floor on the variety** (T2, T4) — forces the bulk to move, not the tail;
3. **a geometric constraint that couples two decisions** (T3+T8, T6+T1, T7+T2) — satisfying one
   by cheating breaks the other.

---

## 10. Engine gaps, ranked by quality unlocked per unit of work

| # | gap | why it matters | effort | unlocks |
|---|---|---|---|---|
| **G2** | `add_text` validates family only (`studio.rs:548`), never `(family, weight)` | `fontWeight: 900` on Baskerville silently renders Apple SD Gothic Neo Heavy; `700` on Avenir renders **Menlo Bold**. This is the landmine directly under round 2's obvious fix. | **small** — resolve once via `layout_runs`, compare family, return `ToolError` | T1, T6; makes every weight rule real |
| **G1** | `bay-core` cannot measure text (`Cargo.toml` has no `bay-text`) | `check` is blind to wrap, measure, widow, ink box, occlusion and mono share — 6 of the 13 rules above | **medium** — add a metrics-only path (`FontSystem` is CPU-only, ~200 ms init, no GPU, so `check`'s "costs nothing" contract survives with a lazily-built shared raster) | T4, T7, T10, T13, L2 |
| **G5** | no width/stretch axis — bay never sets `Stretch`, so every condensed face is unreachable and silently substitutes | DIN Condensed, Avenir Next Condensed, Arial Narrow, PT Sans Narrow, Impact and Skia are all installed and all unusable. Condensed is *the* vertical-video genre: +30% characters per line at headline size, which is exactly the constraint §6.1 shows is binding. | **small** — one field on `TextStyle`/`TextElement`, pass `Attrs::stretch` | six display families, and headlines that fit |
| **G3** | no stroke / shadow / plate on text | captions over footage cannot meet contrast without a second element per caption; standard practice everywhere else | **medium** — a dilated second draw pass in `render_styled`, plus `stroke_width`/`stroke_color`/`shadow` on the element | T11 without element inflation |
| **G4** | no italic/oblique axis (`TextStyle` has no `Style`) | ~40% of the faces on this machine are italics and none can be selected. Pull-quotes, emphasis, citations, species names — all unavailable. | **small** — one field, pass `Attrs::style` | an entire expressive register |
| **G6** | no per-span styling inside an element | word-level caption highlight, a coloured keyword in a headline, a mixed-weight line, a unit at label size next to a hero figure — all impossible or fakeable only with hand-computed offsets (which need G1) | **large** — a rich-text attribute run model through `TextElement`, the wire format, and the raster cache key | kinetic word highlight, mixed-weight display type, proper unit setting |
| **G7** | `fonts_check` reports family-name presence, not renderability | `.SF NS` reports available and never renders; `Hoefler Text` reports available and renders **ornaments** at 400; `Impact` reports available and renders SF | **small** — take `[{family, weight}]`, return the resolved face name and a `substituted: bool` | makes the one tool the skill insists on calling actually load-bearing |
| **G8** | no text transform / small caps / OpenType feature selection | uppercase must be authored in the content string (fine); but `tnum` cannot be forced on a proportional face, so §5.1's family list is the only lever | **medium** | proportional faces usable for data |
| **G9** | `small-text` is a Warning at 2.2% of canvas height (42 rendered px) and `is_clean()` ignores warnings | the one typographic check that exists cannot fail a build, and its threshold is 20% below the practical floor | **small** — raise to 0.025, Error for elements with >3 words | a floor that means something |

### Two skill-level fixes that need no engine work

- **`add_text`'s own description says** *"Numbers should be set in a mono family and sized
  large"* (`tools.rs:215`). The tool schema is the highest-authority text an agent reads. It is
  factually wrong (§5.1) and it is a proximate cause of 69/73 Menlo. Replace with: *"Numbers need
  tabular figures, which most macOS text faces already have — Charter, Avenir Next, Helvetica
  Neue, Optima, DIN Alternate. Do not reach for a mono."*
- **`banned-defaults.md:58` and `tools.md:72` list the same ten families** as "macOS usually
  has", of which five are monos, and `banned-defaults.md` then bans the sans partner
  (Helvetica Neue) while `layout.md:71` offers "Helvetica Neue + Menlo" as the only concrete
  pair. Ban the text face, keep the mono in the example, and mono is what you get. Replace both
  lists with §3.1's verified table, keyed by role and with the resolvable weights inline.

---

## Appendix — provenance

All measurements taken 2026-08-12 on macOS (Darwin 25.5.0), through `bay-text` at
`rust/crates/bay-text` on branch `fix/pending-sweep`, using three throwaway examples
(`typeprobe.rs` — ink mass/box, weight sweep, digit advances, cap/x-height metrics;
`typeresolve.rs` — `LayoutGlyph.font_id` → `fontdb` face identity; `typeframe.rs` — the two mock
frames behind `thumbtest.png`). The examples and their raw output are in the session scratchpad;
the crate was restored to its committed state afterwards. Family availability was cross-checked
three ways: the files under `/System/Library/Fonts{,/Supplemental}`, `system_profiler
SPFontsDataType` (332 families, style lists per family), and bay's own `fonts_check` MCP tool.

Note the three disagree, and bay's answer is the one that matters: Athelas, Iowan Old Style,
Seravek and Superclarendon have **zero** typefaces listed by `system_profiler` (macOS treats them
as downloadable) but their `.ttc` files are present in `/System/Library/Fonts/Supplemental/` and
fontdb reads them straight off disk, so bay can set type in all four.
