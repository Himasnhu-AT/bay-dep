# Layout, type and colour

Composition rules that hold whatever the subject is. Everything here was learned by looking at
rendered frames, not by reasoning about the API.

---

## The canvas

A 1080×1920 vertical reel:

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
       x=96            x=900  (right 180px is the action rail)
```

- **Left gutter 96px** → `x: 0.089`
- **Content width 804px** → a text box of `scale: 0.744` wraps there
- **Bottom 420px** is the caption band; **right 180px** is the action rail. Keep both clear.
- Leaving 900px of dead space at the bottom is a real defect — the last element should sit
  around y≈1400–1450, not y≈1030.

## Placing text by pixel

Text is drawn from its box's **top-left**, and `scale` sets the box. So to put a paragraph at
pixel `(x, y)`:

```jsonc
{ "x": x/1080, "y": y/1920, "anchorX": 0, "anchorY": 0, "scale": boxWidth/1080 }
```

Centred text: give the box the content width and use `align: "center"`. Its centre lands at
`96 + 804/2 = 498`, slightly left of the canvas centre — which is correct, because it accounts
for the action rail.

## Type sizes

`fontSize` is quoted against a 1080-tall canvas; on a 1920-tall canvas multiply by 1.778.

| Role | `fontSize` | On screen |
|---|---:|---:|
| hero figure | 180–300 | 320–530px |
| big number | 130 | 231px |
| headline | 62–96 | 110–170px |
| body | 34–54 | 60–96px |
| label | 24–40 | 43–71px |
| kicker | 20–36 | 36–64px |

**Hero figures must be ≥200px on screen.** A 72px number is invisible at thumb size.

A wide glyph can push a "safe" line into the keep-out: `−50%` is wider than `+50%` because
U+2212 is wider than `+`. Snapshot and check, don't assume.

Give hero figures a wider box (`scale: 0.95`) than body text so a 4-glyph figure never wraps.

## Pairing

Display face for headlines and body; **mono for every figure, label, ticker and formula**.
Numbers are always mono. Kickers are mono, uppercase, letterspaced ~0.18em.

On macOS: `Helvetica Neue` + `Menlo` is a solid default pair. Run `fonts_check` first.

---

## Colour and contrast

A dark editorial palette that works:

| Token | Value | Use |
|---|---|---|
| ground | `#0E0E12` | the bed, every frame |
| type primary | `#EDECE6` | headlines, hero numbers |
| type secondary | `#A8A8B0` | supporting lines |
| type muted | `#73737E` | kickers, axis ticks, units |
| accent | `#FF5B5B` | **scarce** — one element per scene, always the point |
| cool grey | `#8A93A3` | secondary data series |
| chart track | `#606070` | measured at 3.12:1 against ground |

### Measure contrast, don't eyeball it

Against `#0E0E12`:

| | ratio | |
|---|---:|---|
| `#16161C` | 1.07:1 | invisible |
| `#26262E` | 1.28:1 | invisible — a chart track here encodes nothing |
| `#4A4A58` | 2.21:1 | still too low |
| `#606070` | 3.12:1 | usable track |
| `#EDECE6` | 16.27:1 | body text |

**Opacity defeats the measurement.** `#606070` at 28% alpha composites back to ~1.3:1 — the
same invisible track you were trying to avoid. If a track needs to be visible, give it a
colour that measures, at full opacity.

---

## Motion doctrine

Nothing moves for decoration.

- Type arrives by rising from below its own baseline and fading in: animate `y` with
  `power-out` over ~0.5s plus `opacity` over ~0.35s.
- Numbers count up only when the count *is* the information.
- A bar grows in the direction its data reads — set the anchor, animate one axis.
- Everything settles before its reading window opens. No element should still be moving when
  the viewer is meant to read it.
- Easing: `power-out` for entrances, `ease-in-out` for anything transforming in place.

## Timing to music

- One bar at 111 BPM = 2.143s. A 6-clip 2/2/1/2/2/1-bar structure is 21.429s total.
- **Land reveals on the beat.** An entrance of duration `d` that should settle on beat time
  `b` must start at `b − d`. Passing `b` as the start makes it arrive `d` late — nothing is
  actually synced.
- Don't beat-snap everything. Sequential text needs a reading floor of ~1.1s per line.

## No blank frames

Something legible must be on screen at every instant from ~0.3s onward, including across
every cut. Overlap neighbouring scenes rather than cutting to nothing: extend each element
past its scene's end and fade it out over the overlap while the next scene fades in.

A 0.45s crossfade works. Verify with `scripts/inkcheck.py` — and note that a small kicker is
~0.1% of the frame and perfectly legible, so "blank" has to mean *no ink at all*, not "little
ink".
