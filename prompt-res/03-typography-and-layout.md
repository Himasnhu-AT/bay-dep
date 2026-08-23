# Typography, composition and captions

Type is most of the frame in a motion graphic. Layout is what stops it reading as a slide.

---

## 1. Type in motion is not type on a page

- **Video sizes, not web sizes.** Full-screen viewing (YouTube, an embed): body ≥ 20 px,
  headlines 60 px+, data labels 16 px. **In-feed viewing** (X, LinkedIn, Instagram — the video
  plays small inside a scrolling feed): body ≥ 32 px, headlines ≥ 90 px, data labels ≥ 24 px.
  Calibrate against real renders, not against the number.
- **Fixed reading time.** 3 seconds on screen means it must be readable in 2. Fewer words,
  larger type. Reading floor for sequential lines: ~1.1 s per line.
- **Weight contrast must be extreme.** 400 vs 700 is a web distinction. Video needs 300 vs 900
  — the difference has to be visible at a glance, in motion, after encoding.
- **Tracking tighter than web.** −0.03 em to −0.05 em at display sizes; video encoding
  compresses letter detail and loose tracking falls apart.
- **Time is hierarchy.** In video, *sequence replaces position* — the first element to appear
  is the most important, whatever the layout says.
- **Motion is typography.** How a word enters carries as much meaning as which face it is set
  in. A 0.1 s slam and a 2 s fade of the same word are different messages.

### Light on dark — two optical corrections

Light text on a dark ground reads **heavier** and **tighter** than the same values on a light
ground:

- Use ~350 instead of 400 for body weight.
- Add 0.05–0.1 to line-height beyond the light-ground value.
- At display sizes add ~0.01 em letter-spacing back to counteract the halo.

### Numbers

- **Tabular figures are mandatory** any time digits stack or count. Without them a count-up
  jitters horizontally as glyph widths change — a very visible amateur tell.
- Mono for every figure, label, ticker and formula. Numbers are always mono.

---

## 2. Pairing and selection

- **Never pair two sans-serifs.** The commonest AI pairing and it creates friction without
  hierarchy. Cross a boundary: serif + sans, or sans + mono, or condensed + wide.
- **Never pair two fonts that are similar but not identical** — two geometric sans, two
  transitional serifs. The viewer senses something is off and cannot name it.
- **One expressive font per scene.** One performs, one recedes.
- **Tension should mean something.** Ask *why* these two faces disagree — mechanical vs human,
  institutional vs personal. If you cannot articulate it, the pairing is arbitrary.
- **Register switching** beats hierarchy: assign faces to communicative *modes* — one voice for
  statements, another for data, another for attribution. Voices in a conversation, not levels
  on a page.
- **Reject your first instinct.** The first face that feels right for a register is the training
  default for that register. An editorial brief does not need a serif; a technical brief does
  not need a sans.

**The monoculture list** — faces every model reaches for, which produce identical-looking
output across unrelated projects: Inter, Roboto, Open Sans, Noto Sans, Lato, Source Sans, PT
Sans, Nunito, Poppins, Outfit, Sora, Playfair Display, Cormorant Garamond, Bodoni Moda, EB
Garamond, Cinzel, Prata, **Syne** (the most overused "distinctive" display font and an instant
AI tell).

**Physical-object test for picking a face:** imagine the typeface as an object the brand could
ship — a museum caption, a hand-painted shop sign, a 1970s mainframe manual, a fabric label, a
tax form. Whichever object fits the register points at the right *kind* of face.

---

## 3. Kinetic typography

The core technique for narration-driven video: words appear one at a time, synced to word
timestamps.

**What makes it read professional rather than gimmicky:**

- **Legibility survives the animation.** Sans-serif, clear strong lines, adequate weight and
  spacing. A face that becomes illegible once animated is the wrong face.
- **Consistent motion, varied rhythm.** Uniform *animation* per element, varied *timing*
  between elements. Erratic per-word treatments distract.
- **Reading order drives sequence.** Left-to-right, top-to-bottom. Sequence carries meaning.
- **Decay the entrance.** Per-word slide distance should *decrease* across the phrase (e.g.
  80 → 60 → 50 → 25 → 12 px). It mimics a camera settling and is the difference between a
  cascade and a conveyor belt.
- **Cap the total stagger at ~500 ms** so the phrase reads as one arrival, not a queue.
- **Binary opacity on an arrival cascade.** Fading each word in individually mushes the wave —
  set opacity 0→1 and let the positional move carry the entrance.

**Named effects worth having in the vocabulary:** typewriter (character-by-character with a
blinking caret) · backspace-and-retype · per-word staggered reveal · beat-slam (short phrases
on a shared percussive grid, each with a *distinct* entrance, resolving to a locked finale) ·
in-place token cycle (a fixed line whose one variable slot changes) · hard-cut word swap ·
3D char flip-decode · gradient sweep through letterforms · keyword glow synced to the word
timestamps.

---

## 4. Composition — video frames are not web pages

- **Two focal points minimum per scene.** The eye needs somewhere to travel. Never one text
  block floating in space.
- **Fill the frame.** Hero text 60–80% of the width. Web-sized elements in a video frame read
  as unfinished.
- **Three layers minimum:** background treatment (glow, oversized faded type bleeding off
  frame, colour panel) · foreground content · accent elements (dividers, labels, data bars).
- **The background is not empty.** Radial glows, ghost type at 3–8% opacity, hairline rules,
  grain, grid patterns, thematic decoratives — 2–5 per scene. Pure `#000` reads as "nothing
  loaded."
- **Anchor to edges.** Pin content to left/top or right/bottom. Centred-and-floating is a web
  pattern.
- **Split the frame.** Data panel left, content right. Metadata bar on top, full-width below.
  Zone layouts, not centred stacks.
- **Use structural elements.** Rules and dividers create paths for the eye and animate well
  (a rule growing from zero along one axis is one of the cheapest strong moves available).

### Images are never placed flat

Every still needs a motion treatment: a slow Ken Burns push (scale 1 → 1.04 over the beat), a
perspective tilt with a shadow for depth, a device frame, a parallaxed foreground element at a
different depth, or a clipped window the image scrolls through. A raw flat image on screen for
three seconds is dead frame.

---

## 5. The canvas — a worked grid for 1080×1920

This is bay's own house grid (from `skills/bay/references/layout.md`), reproduced because it is
correct and because the keep-outs are platform facts, not preferences.

```
  0 ┌─────────────────────────┐
    │        (safe top)       │
250 │  KICKER                 │  ← mono, uppercase, tracked 0.18em
    │                         │
    │   content lives here    │  x from 96 to 900
    │                         │
1450│                         │  ← last element should sit around here
1500├─────────────────────────┤
    │   platform caption band │  ← keep clear
1920└─────────────────────────┘
         ↑                 ↑
       x=96            x=900   (right 180px is the action rail)
```

- Left gutter 96 px; content width 804 px.
- **Bottom ~420 px is the platform caption band; right ~180 px is the action rail.** Keep both
  clear. Independently corroborated by the platform guidance: avoid the bottom 20% (like /
  comment / share buttons) and the right 10%; keep the payload between ~15% and ~75% of the
  height, horizontally centred; avoid the top and bottom 10% for notches and overlays.
- Leaving 900 px of dead space at the bottom is a real defect — the last element belongs around
  y ≈ 1400–1450.
- Centred text in an 804 px box centres at x ≈ 498, slightly left of the canvas centre. That is
  **correct**: it accounts for the action rail.

### Type scale for that canvas

`fontSize` quoted against a 1080-tall canvas; multiply by 1.778 for a 1920-tall one.

| Role | fontSize | On screen |
|---|---:|---:|
| hero figure | 180–300 | 320–530 px |
| big number | 130 | 231 px |
| headline | 62–96 | 110–170 px |
| body | 34–54 | 60–96 px |
| label | 24–40 | 43–71 px |
| kicker | 20–36 | 36–64 px |

**Hero figures must be ≥ 200 px on screen.** A 72 px number is invisible at thumb size.

Beware glyph-width surprises: `−50%` is wider than `+50%` because U+2212 is wider than `+`, and
a "safe" line can push into a keep-out. Snapshot and check.

---

## 6. Captions and subtitles

85% of social video is first watched **without sound**, and captioned video retains ~40%
better. Captions are not an accessibility afterthought; they are the primary text layer.

- **Size:** minimum 48–60 pt, bold sans. 24–32 pt is unreadable on a phone.
- **Placement:** within the middle ~60% of the width; above the bottom 20% UI band.
- **Legibility treatment:** a **stroke and a drop shadow** around the glyphs. Over arbitrary
  footage, plain fill text will land on a same-value background at some point in every clip.
  This is the single most-cited caption rule and bay currently cannot do it (see §10).
- **Two lines maximum**, and break lines on *semantics*: after punctuation, before conjunctions
  and prepositions — never at an arbitrary width.
- **Never orphan the last word** of a phrase onto its own line or its own card.
- Word-level highlight (the current word glowing/scaling within the visible phrase) is the
  modern default for short-form and materially raises watch-through.

---

## 7. Colour contrast, measured

Eyeballing contrast on a dark ground is unreliable. Measured against `#0E0E12`:

| | ratio | verdict |
|---|---:|---|
| `#16161C` | 1.07:1 | invisible |
| `#26262E` | 1.28:1 | invisible — a chart track here encodes nothing |
| `#4A4A58` | 2.21:1 | still too low |
| `#606070` | 3.12:1 | usable track |
| `#EDECE6` | 16.27:1 | body text |

**Opacity defeats the measurement.** `#606070` at 28% alpha composites back to ~1.3:1 — the
same invisible track you were avoiding. If something must be visible, give it a colour that
measures, at full opacity.

Text must remain readable with all decorative layers removed. That is the test.

---

## Sources

- [Typography for Motion Graphics — RMCAD](https://www.rmcad.edu/blog/typography-for-motion-graphics-fonts-that-move-the-message/)
- [Kinetic typography: the what, why, and how — Linearity](https://www.linearity.io/blog/kinetic-typography/)
- [Typography in Motion: 7 Design Principles](https://www.upskillist.com/blog/typography-in-motion-7-design-principles/)
- [Vertical Video for Social: Aspect Ratios, Safe Areas & Subtitles](https://expoproductions.com/vertical-video-for-social-aspect-ratios-safe-areas-and-subtitles/)
- [Best Practices for Video Caption Design — OpusClip](https://www.opus.pro/blog/video-caption-design-placement)
- [Guide to Safe Zones for TikTok, Facebook, Instagram](https://houseofmarketers.com/guide-to-safe-zones-tiktok-facebook-instagram-stories-reels/)
- [Captioning for 9x16 Video](https://www.closedcaptioncreator.com/blog/articles/captioning-for-9x16-video.html)
- Encoded practice: `~/.claude/skills/hyperframes-creative/references/typography.md`,
  `vii/skills/bay/references/layout.md`
