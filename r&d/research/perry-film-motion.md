# Perry launch film: what its motion does, as rules for bay

Source: `/Users/himanshu/codes/perry/film/perry.html` (884 lines, canvas, 1920×1080 @ 60 fps),
rendered through its own `render.mjs` pipeline. Stills were rendered with a copy of that script
pointed at the macOS Chrome, output kept in `/tmp/perry-study-1774922965/`; the reference repo was
not modified. Line refs below are `perry.html:N`.

## Why it works

1. **It is built on the music's clock.** Every scene cut falls on a bar line, every entrance
   lands within 0.1 s of its cut, and the mascot's hat, the bell icon, the heartbeat line and the
   orbit dots all tick on the beat. You feel the edit before you read it.
2. **It uses one move and repeats it.** Nearly every headline is the same masked word rise
   (a quart-out ease, 0.55 s, 0.05 s between words). Exits use one other curve, a hard in-out
   "whip" that runs twice as fast. With two curves and one spring the whole film reads as one
   system.
3. **It is restrained.** White paper, near-black ink, one teal used on about one thing per
   scene. No glows, gradients, grids or 3D. The header says so: *"No glows, no grids"* (`:22`).
4. **The small things keep moving.** Blinks, a bob, typing dots, marching dashes and a rotating
   orbit mean no frame is ever fully still, even during a hold. The loud moves stay rare.
5. **Real UI, drawn precisely.** The Telegram mockup has true iPhone proportions (`:501`), real
   bubble radii, a tail corner, read ticks, and a composer that types. It is believable because
   it is specific.
6. **Motion blur.** Each frame averages 4 sub-frames over a 180° shutter (`:733-741`). This is
   why the slot-machine whip smears (visible in the 3.2 s still) and does not strobe.

Note: `blurWords()` (`:74-93`, the site's BlurWords focus-in, 10 px blur→0, 0.18 em rise, 0.06 s
stagger, 0.8 s) is **defined but never called**. What looks like a blur-in in stills is the
motion blur on the whip. Every headline uses `words()`, the masked rise.

## The timing system

```js
const BT = 60 / 128, BAR = 4 * BT, DUR = 18 * BAR;   // :26  → 0.46875 s, 1.875 s, 33.75 s
const beatK = x => x < 0 ? 0 : Math.exp(-(x % BT) * 10); // :389 a 1→0 decay every beat
```

At 60 fps a beat is 28.125 frames and a bar 112.5, so bar lines fall on half-frames. Scenes are
hard cuts at bar starts (`:726`, *"hard cuts on the bar lines"*). Each scene receives local time
`lt` from its own cut (`:731`).

| Bars | Start s | Scene | Length | What happens |
|---|---|---|---|---|
| 0 | 0.00 | Hook | 1 bar | one statement per beat: "You ask." / "It answers." / "Then it forgets." |
| 1 | 1.875 | Logo | 1 | mascot lands and squashes, whips left, "Perry" rises beside it |
| 2 | 3.75 | Promises | 1 | slot machine, 3 lines |
| 3–5 | 5.625 | Chat | **3** | phone: type, send, reply, 7:59→8:00 flip, Monday message (the code comment says "2 bars", but it lasts 3) |
| 6 | 11.25 | Connectors | 1 | 8 logos orbit the mascot |
| 7 | 13.125 | Memory | 1 | "Remembers **you.**" plus cards |
| 8 | 15.0 | Computer | 1 | terminal, approval card, cursor click |
| 9 | 16.875 | Activity | 1 | trace waterfall, token counter |
| 10–11 | 18.75 | Heartbeat | 2 | the one dark scene |
| 12 | 22.5 | Private | 1 | the lock closes on "Self-hosted." (the music breaks down here) |
| 13–14 | 24.375 | Montage | 2 | 8 cards, **one per beat** (the comment says "half-beat") |
| 15–17 | 28.125 | End card | **3** | 5.6 s to read, audio fades over the last 0.7 s |

Rule of thumb from the table: **one idea gets one bar**. A story (the chat) or a mood (the
night) gets 2–3 bars, and the end card gets 3 bars so there is time to read it. Foley is keyed
to the same picture events (`:821-837`): a send or receive sound per bubble, a tick every second
typed character, a pop per logo.

## Curves

| Name | Definition | Line | Used for |
|---|---|---|---|
| `EZ.rise` | cubic-bezier(.165, .84, .44, 1) (easeOutQuart) | `:45` | every entrance: words, cards, rows |
| `EZ.whip` | cubic-bezier(.72, 0, .18, 1) | `:45` | exits, slides, the slot machine, the cursor |
| `EZ.blur` | cubic-bezier(.25, .46, .45, .94) | `:45` | BlurWords (unused) |
| `SPRING` | stiffness 420, damping 32, mass 1 (ζ≈0.78, a small overshoot, settles ≈0.35 s) | `:47` | bubbles, logos, mascot, CTA, cards |
| `E3` | x³ | `:419` | the scattering letters |
| `E2` | smoothstep | `:178` | keyboard keys collapsing |
| land | `exp(-7t)·sin(22t)` | `:429` | the mascot's squash after it lands |

In bay, `spring(t, { delay, stiffness: 420, damping: 32 })` is **the same closed form**
(`src/shared/brf-code.ts:194`). Keys accept a cubic-bezier as `[x1,y1,x2,y2]` for the easing
(`brf.ts:488`), so both beziers carry over exactly. The presets (`in="up"` etc.) always use
`outCubic`, which is close to `rise` but cannot express `whip`.

## Technique catalogue

Shared bay constants for the snippets:

```tsx
import { interpolate, spring } from 'bay'
const BT = 60 / 128, BAR = 4 * BT
const RISE = [0.165, 0.84, 0.44, 1], WHIP = [0.72, 0, 0.18, 1]
const beatK = (t) => (t < 0 ? 0 : Math.exp(-(t % BT) * 10))
const pop = (t, d) => spring(t, { delay: d, stiffness: 420, damping: 32 })
```

### 1. Masked word rise and whip exit (`words()`, `:362-378`)
Each word is clipped to its own rect: its advance width plus `size` on each side, from
`baseline − 1.05·size`, `1.32·size` tall. The word rises from `+1.1·size` below its baseline.
The ease is `rise`, `d` = 0.55 s, and words start `st` = 0.05 s apart (0.035–0.04 for long
lines). The exit whips it up by `1.2·size` in 0.25 s, with the stagger halved (0.025 s). The
word never fades; the mask does all the hiding. The text is Inter Tight 600, tracking
**−0.04 em** (`-6px` at 150), ink `#1d1d1f`.

bay has no text measurement, so the mask can only be per line. That form is exact:

```tsx
// one line, exact: the group is the mask, the text travels 1.1×size inside it
const Line = ({ t, t0, out, size, x, y, children }) => (
  <group x={x} y={y} anchor={[0, 0.8]} w="90%" h={size * 1.32} clip>
    <text x={0} anchor={[0, 0.5]} align="left" size={size} weight={600} font="Inter Tight"
      tracking={-0.04 * size} fill="#1d1d1f"
      y={[[t0, size * 0.66 + size * 1.1], [t0 + 0.55, size * 0.66, RISE],
          [out, size * 0.66], [out + 0.25, size * 0.66 - size * 1.2, WHIP]]}>{children}</text>
  </group>
)
// per word, approximate: split pieces rise 3.6% of the short side and fade (outCubic); the clip cuts their tail
<group x={150} y={400} anchor={[0, 0.8]} w="90%" h={150 * 1.32} clip>
  <text x={0} y={100} anchor={[0, 0.5]} align="left" size={150} weight={600} tracking={-6}
    split="word" stagger={0.05} in={['up', 0.55]} out={['down', 0.25]}>You ask.</text>
</group>
```
Trap: an exit plays its preset **backwards**, so `out="up"` leaves *downward*. Perry's upward
exit is `out="down"`.

### 2. Letter scatter (`:399-415`)
"forgets." rises as a unit (`rise`, 0.45 s, from +160 px), then each character breaks off at
`3.05·BT + i·0.035`. Over 0.5 s with `x³`, each one drifts `+(60..180)` px in x, `−(40..200)`
px in y, rotates up to ±0.4 rad, blurs to 6 px, greys to `ink3` and fades. The cut at 1.875 s
lands mid-scatter, so the scene ends on motion. In bay: `split="char"` cannot give each piece
its own path, so draw one `<text>` per character and hard-code the x advances (or set the word
in JetBrains Mono so the advance is fixed). Seed each piece with `random(i)`.

### 3. Slot machine (`sPromise`, `:449-465`)
There are three rows, and the focus index `f` whips 0→1→2 at `k·1.33·BT` (0.52 s and 1.15 s),
each move taking 0.28 s. A row at distance `d = i − f` is offset `d·190` px, drawn at alpha
`1 − |d|·0.9` and scaled `1 − |d|·0.12` about the frame centre. Text is 116/600, tracking −4.6
px. A 104 px teal-tinted icon tile (radius 26, `#e3f4f2`, 5.5 px teal stroke) shares one left
edge with the text and is centred on the cap height. The bell rings on the beat:
`rotate = sin(38t)·0.12·beatK`.

```tsx
const f = [1, 2].reduce((a, k) => a + interpolate(t, [k*1.33*BT - 0.1, k*1.33*BT + 0.18], [0, 1], { easing: WHIP }), 0)
{ROWS.map((s, i) => { const d = i - f; return (
  <group key={i} x="50%" y={405 + d * 190} scale={1 - Math.abs(d) * 0.12} opacity={Math.max(0, 1 - Math.abs(d) * 0.9)}>
    <text size={116} weight={600} tracking={-4.6} fill="#1d1d1f">{s}</text></group>) })}
```
(Perry scales about the frame centre, not each row's centre. The difference is small at ±1.)

### 4. Chat column: spring in, push up (`chatColumn`, `:181-201`)
The column is anchored at the bottom. Walking from newest to oldest, `y -= h·pres + 6·pres`,
where `pres = clamp(spring(t − t0))·(1 − exit)`. That makes **the column push up on the same
spring**, overshoot included. Each item enters with alpha `clamp(s·1.4)`, offset `(1−s)·14` px,
and scale `0.96 + 0.04·s` about its tail corner (bottom-right for outgoing, bottom-left for
incoming, bottom-centre for pills). Bubbles use radius 17 with 5 on the tail corner, 12 px
padding, 15/400 sans with inline 13.5/500 mono runs, line height 1.36, an 11.5 px timestamp
and a 1 px shadow `rgba(0,0,0,.13)`. The script:
send 1.75 s → typing dots 2.0–2.7 s → reply 2.7 → pill 3.0 → "Monday" 3.95 → message 4.1 →
quick-reply keys 4.2, pressed at 4.7 with a ripple, collapsing at 4.8 over 0.15 s → reply 4.95.
Typing dots are phased 0.16 s apart on a 1 s sine (`:208`).

```tsx
const items = [/* {t0, h, side} newest last; h fixed per bubble: bay cannot measure wrapped text */]
let y = bottom; const out = []
for (let i = items.length - 1; i >= 0; i--) {
  const it = items[i], s = pop(t, it.t0), p = Math.min(1, s); if (t < it.t0) continue
  y -= it.h * p
  out.push(<group key={i} x={it.side === 'out' ? colR : colL} y={y + it.h + (1 - p) * 14}
    anchor={[it.side === 'out' ? 1 : 0, 1]} w={it.w} h={it.h} scale={0.96 + 0.04 * s} opacity={Math.min(1, s * 1.4)}>
    <rect anchor={[0, 0]} w={it.w} h={it.h} radius={17} fill={it.side === 'out' ? '#effdde' : '#ffffff'}
      shadow={{ color: '#00000021', blur: 1, y: 1 }} />…</group>)
  y -= 6 * p
}
```
The tail corner (one radius of 5) cannot be drawn with `<rect radius>`. Use a `<path>`.

### 5. Spring-in for objects (`springIn`, `:379-382`)
This is the same recipe with a larger offset: alpha `clamp(s·1.4)`, `+16 px`, scale
`0.94 + 0.06·s`. It is used for the mascot, logos, approval card, CTA and night bubble.
`<group y={Y + (1 - Math.min(1, s)) * 16} scale={0.94 + 0.06 * s} opacity={Math.min(1, s * 1.4)}>`.

### 6. Rise for secondary text (`rise`, `:95-98`)
Kickers, body copy and footnotes do not use the word mask. They fade up 8–12 px over 0.4–0.5 s
with `rise`, starting 0.3–0.45 s after the headline. In bay: `in={['up', 0.5, 0.35]}` is close
enough (`up` moves 6% of the short side, about 65 px; for Perry's 10 px, key `y` instead).

### 7. Number flip (`:490-493`)
7:59 rolls up to 8:00 inside a 210 px clip in 0.15 s with `rise`, 190/600, −8 px. The phone's
status-bar clock changes on the same frame. In bay: a `<group clip>` with two `<text>` keyed
−200 px. Counters (`:629`) run 0→12,480 with `rise` over 1.2 s on tabular figures (`tnum()`,
`:60`, a fixed digit cell).

### 8. Typing and tapping
The composer types at 45 chars/s (`:498`) and the terminal at 90 (`:590`), with a caret in
`#2f89e0`. A tap (`:173-177`) is a dark 20 px disc fading over ±0.12 s, then a white ring
growing 10→44 px at alpha 0.35→0 over 0.5 s. A pressed key scales `1 − 0.05·sin(π·p)`. The
cursor (`:611`) whips over 0.27 s, then presses (scale 0.88). In bay: `in="type"` is linear over
its duration, so set duration = chars / 45.

### 9. Mascot (`:236-298`)
The mascot is 12 SVG paths in a 240×262 box: flat colour, one ink outline (`#123f3b`, 3.2 px)
and one shade tone at 55%.
- **Idle lid** sits at 0.32 (he looks unimpressed). A **blink** is a 0.14 s sine to shut, every
  1.4–3.1 s, with a different phase per scene (`blinkAt`, `:291`).
- **Bob**: `sin(4.2t)·0.025·width`.
- **Land/squash**: `sx = 1 + 0.12·q`, `sy = 1 − 0.12·q`, with `q = exp(-7t)·sin(22t)`.
- **Hat hop on the beat**: lift `7·beatK` box units, and the hat tilts to `−7° − 0.6·lift`
  about (120, 90). On the end card the hop fades out over bar 2 (`:714`).
- **Look**: pupils shift 4 units (`look: [0, .15]` on the end card).

The paths are plain SVG `d` strings, so they port directly to bay's `<path>`. The lid is drawn
clipped to the eye ellipse, and bay clips only to rectangles. Approximate the blink with
`sy` on a lid ellipse.

```tsx
<group x={cx} y={cy} w={240} h={262} scale={k} sx={1 + 0.12 * q} sy={1 - 0.12 * q}>
  <path x={0} y={0} anchor={[0, 0]} d={BODY} fill="#26b5a9" stroke="#123f3b" strokeWidth={3.2} />
  <group x={120} y={90 - 7 * beatK(t)} w={0} h={0} rotate={-7 - 7 * beatK(t) * 0.6}>
    <path x={-120} y={-90} anchor={[0, 0]} d={CROWN} fill="#4b3326" stroke="#123f3b" strokeWidth={3.2} /></group>
</group>
```

### 10. Device and card framing
- **Phone** (`:299-346`): 334×690 in the 1440-wide design space, bezel `#1b1c1e` with radius 52
  and a 10 px bezel, screen radius 43, rim stroke `#2c2d30`, shadow `rgba(0,0,0,.28)` blur 70
  offset y 36. Header 98 px and composer 72 px, both white at 95%. Island 96×28. Home bar
  128×5. It enters by rising 80 px over 0.5 s.
- **Card** (`:356-360`): radius 20–22, shadow alpha 0.09 blur 44 y 20, plus a 1 px hairline
  `rgba(0,0,0,.09)`.
- **Terminal**: `#1d1d1f` radius 20, traffic lights 6 px, 13 px mono title.
In bay these are all `<rect radius shadow stroke>`. The Telegram doodle wallpaper is an SVG
image and cannot be drawn; use two or three `radial()` blobs over `#dbddbb` (`:110-115`).

### 11. Orbit (`sConnect`, `:513-539`)
Eight logos sit on an ellipse (rx 440, ry 205) that rotates 0.45 rad/s. They are depth-sorted
by `sin(a)` and scaled `0.88 + (z+1)·0.08`. They spring in 0.035 s apart. Dashed spokes (4/6)
march at 40 px/s, and each beat a teal dot runs from the centre out to every logo. bay can do
all of this: sort in code, and draw the spokes as `<path d draw>`. There is no dash pattern, so
use short `<rect>` dots.

### 12. Transitions
**There are none.** Every scene change is a hard cut on a bar line. The motion comes from inside
the scene: an exit whip just before the cut (`out: BT − .08`), and an entrance starting at
`lt ≈ 0–0.1`. The only colour change is a cut to night for 2 bars. The montage cycles four
backgrounds (paper, mist, `#1d1d1f`, teal) one per beat, and its text reaches rest at 45% of
the beat (`clamp(u·2.2)`, `:700`) under an 8-dash progress bar.

## Palette, type, composition

- **Palette** (`:29-34`): paper `#ffffff`, mist `#f5f5f7` (alternate scenes), ink `#1d1d1f`,
  ink2 `#424245`, ink3 `#6e6e73` (all secondary text), hairline `rgba(0,0,0,.09)`, teal
  `#0c7a70`. Night: `#0a0c0f` with teal `#5fd4c8`. Success green `#1f8a4c` and warning
  `#b25e00` each appear once.
- **Accent rationing.** Teal is used for: small kicker labels (21/600: "Sunday · 21:40",
  "Monday", "02:13"), **one word** in one headline ("you."), progress bars and dots, the CTA, and
  one of four montage backgrounds. A whole headline is never teal, and there is never more than
  one teal element per scene at display size.
- **Type scale** (1440 design px; ×1.333 on 1920): hero 150 (hook, logo, "Self-hosted.",
  end), 116 (promises), 110/104 (left-column heroes), 190 (the clock), 72/64 (scene titles), 40/30
  (taglines, 500, tracking −0.01 em, ink3), 22/21/19 (body, 400, ink3, line height ≈1.5), 15–17
  (UI labels). Display text is always 600 with −0.04 em tracking. Mono appears only for code,
  commands, trace names and inline tokens. Numbers use tabular figures.
- **Composition.** There are three layouts. (a) **Centred statement**: baseline ≈57% of the
  height, a subline 100 px below in ink3. (b) **Left column + object**: text at x ≈ 10.5% of the
  width (150/1440), the object in the right half (the phone's centre ≈ 77%). (c) **Title top
  centre** at y ≈ 15%, with the object filling the middle band 22–90%. Footnotes sit at ≈95%.
  Each scene has one hero and at most one secondary line.

## Motion rules for bay's agent

Paste into the launch-film skill.

1. Set the tempo first. Get the beat from `detect_beats` or choose a BPM, then compute
   `BT = 60/BPM`, `BAR = 4·BT`, and make the film a whole number of bars.
2. Cut only on bar lines. Give one idea one bar. A story or a mood gets 2–3 bars, and the end
   card gets at least 2 bars of hold.
3. Use hard cuts between scenes. Put the movement in the exit before the cut and the entrance
   after it, not in a transition.
4. Start an entrance at 0–0.1 s after its cut. No scene opens on a still frame.
5. Bring headlines in with a masked rise: clip to one line, travel 1.1×size, 0.55 s,
   `[.165,.84,.44,1]`, words 0.035–0.06 s apart, no fade.
6. Take headlines out upward in 0.25 s with `[.72,0,.18,1]`, at half the entrance stagger,
   ending 0.08 s before the cut.
7. Make exits at least twice as fast as entrances.
8. Pop objects (cards, bubbles, logos, buttons, the mascot) with
   `spring({stiffness: 420, damping: 32})`: alpha `min(1, 1.4s)`, +14–16 px, scale `0.94 + 0.06s`.
9. Use at most two curves and one spring in a film. Do not use `outElastic` or `outBounce`.
10. Fade secondary text up 8–12 px over 0.4–0.5 s, starting 0.3–0.45 s after its headline.
11. Stagger siblings 0.035–0.1 s. Never bring in two elements on the same frame, and never
    leave more than 0.5 s between related ones.
12. Set display type at weight 600 with tracking −0.04 em. Taglines are 500 at −0.01 em in the
    secondary ink. Body is 400 with line height 1.5.
13. Keep the palette to paper, ink, three greys and one accent. Put the accent on at most one
    element per scene: a kicker, a single word, a CTA or a data mark. Never a whole headline.
14. Use no glows, gradients-as-decoration, grids, lens flares or 3D.
15. Give each scene one hero and at most one supporting line. Use mono only for code, commands
    and data.
16. Lay out left text + right object, or centre a statement at ~57% height, or put a title at
    the top 15% with the object below. Left text starts at ~10% of the width.
17. Tie one secondary motion to the beat in every scene (`exp(-10·(t mod BT))`): a hop, a tick,
    a pulse, a dot.
18. Keep something alive during every hold: a blink every 1.4–3 s (0.14 s), a bob
    (`sin(4.2t)·2.5%`), typing dots, a slow rotation.
19. Land things with a squash, `exp(-7t)·sin(22t)` at ±12%, never with a bounce preset.
20. Build UI mockups to real proportions and radii: phone ratio 0.485, screen radius ≈13% of
    width, bubble radius 17 with 5 on the tail. A mock gets its detail from specifics.
21. When a list pushes a column (chat, feed), drive the push with the same spring as the new
    item, so the column overshoots with it.
22. Type text at 45 chars/s (a terminal at 90) with a caret. Show a tap as a press
    (−5% scale) plus a ripple.
23. When a number changes, roll it in a clip (0.15 s) or count it up with the entrance curve.
    Use tabular figures.
24. Sync one foley hit to every visible event: a send, a receive, a pop, a tick every second
    character.
25. Check with `preview_frame` at the cut, mid-entrance, at rest and 0.1 s before the next cut.

## Gaps: what bay's `.brf` cannot do yet

Ordered by how much they cost this film.

1. **No text measurement.** Without word widths, a mask per word, a chat bubble sized to its
   text, a rich run of mono and sans, or a letter scatter can only be done by guessing widths.
   Add `measureText(text, { size, weight, font, tracking })` → `{ width, ascent, descent, lines }`
   to `'bay'`. It must be synchronous and deterministic, and it must use the painter's own
   metrics.
2. **Split pieces cannot be masked or shaped.** `split` fixes distance (3.6% of the short side),
   the curve (`outCubic`) and always fades. Add `pieceClip` (each piece in its own line-height
   mask), `distance` (in `%` or ×size), and an easing for presets (`in={['up', .55, 0, RISE]}`).
   With those, rule 5 becomes one line.
3. **No motion blur.** Perry averages 4 sub-frames per frame with a 180° shutter. That can go in
   the exporter (and in `preview_frame`) as a scene-level `shutter` prop that samples the pure
   function at sub-frame times. The `.brf` purity rule already makes this possible.
4. **Clipping is rectangles only.** Blinking eyelids, masks shaped like a device screen, or a
   text-shaped reveal need `clip` on an ellipse, a rounded rect (`radius`) or a `path`.
5. **Per-corner radius and dashes.** Bubble tails need `radius={[17,17,5,17]}`, and spokes need
   `dash={[4,6]}` and `dashOffset`.
6. **Font features.** `features={{ tnum: 1 }}` for tabular clocks and counters. Perry draws each
   digit into a fixed cell by hand.
7. **Images are missing** (the wallpaper pattern, avatars from bitmaps). These need an HTML
   composition. Everything else in this film, including the mascot and the brand logos (SVG
   paths), fits in `.brf`.
8. **Group blur is not drawn** (`brf.ts:1018`). A scene-wide defocus has to blur each child.
9. Font: Inter Tight is not bundled (bay ships Inter Variable). Import the woff2 as a project
   font. Using Inter at −0.04 em is close but a little wider.
