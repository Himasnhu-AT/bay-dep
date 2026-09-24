# Motion graphics as `.brf`

A `.brf` (bay render file) is a JSX/TypeScript module you write the way you write React or
Remotion. bay runs it in a sandbox and draws what it returns directly on its canvas — no browser,
no screenshots — so it scrubs and exports instantly and looks the same in both.

Create one with `write_brf` (pass `atFrame` to place it in the same call), look at it with
`preview_frame`, change it with `read_brf` → edit → `write_brf` with the same `assetId`.

Use `write_composition` (an HTML page) when you need what only a web page has: CSS layout, flexbox
and grid, embedded video, a DOM library. Titles, lower thirds, callouts, counters, charts, kinetic
type, shapes and anything procedural are `.brf`.

## The module

```tsx
import { interpolate, spring } from 'bay'

export const vars = { title: 'Launch day', accent: '#11D1A0' }

export default ({ t, vars }) => (
  <scene duration={4}>
    <rect x="50%" y="56%" w="40%" h={8} radius={4} fill={vars.accent} sx={spring(t, { delay: 0.3 })} />
    <text x="50%" y="48%" size="8%" weight={900} opacity={interpolate(t, [0, 0.4], [0, 1])}>
      {vars.title}
    </text>
  </scene>
)
```

- **`export default`** is called once per frame with `{ t, frame, fps, width, height, vars }` —
  `t` in **seconds** from the start, `width`/`height` the size it lays out on. It returns
  `<scene duration={seconds}>`, optionally with `size={[w, h]}` (design at a fixed size, fitted
  into the clip) and `background="#101018"`. Leave `size` out to lay out on the timeline canvas,
  so `"50%"` adapts to any aspect ratio.
- **`export const vars`** declares what each placement may change — words, colours, numbers.
  The Inspector and `edit_item` `variables` set them per placement; your code reads `vars.x`.
- **It is a pure function of time.** The same frame always draws the same picture: `Math.random()`
  is seeded per frame (use `random(seed)` for values that must stay fixed across frames) and
  `Date.now()` is 0. Keep state out of module scope.
- Import only from `'bay'` or `'remotion'`. There is no DOM, no network, no filesystem and no
  `import()`; write helpers inline.

## Elements

| Element | Own props |
|---|---|
| `<rect>` | `w`, `h`, `radius`, `fill`, `stroke`, `strokeWidth` |
| `<ellipse>` | `w`, `h`, `fill`, `stroke`, `strokeWidth` |
| `<path>` | `d` (SVG path data, in pixels, origin at the anchor), `fill`, `stroke`, `strokeWidth`, `draw` (0–1 of the stroke drawn) |
| `<text>` | children are the text; `size`, `weight` (100–1000, default 700), `font`, `italic`, `fill` (default white), `stroke`, `strokeWidth`, `align` (default `center`), `w` (wrap width), `lineHeight` (×size, default 1.2), `tracking` (px), `split`, `stagger`, `variations` (variable-font axes, below) |
| `<group>` | children; `w`, `h` (its box, for `anchor`, `clip` and `wipe`), `clip` |

Every element also takes:

| Prop | |
|---|---|
| `x`, `y` | Where the element's **anchor** sits. Pixels, or `"50%"` of the frame's width (x) / height (y). |
| `anchor` | `[ax, ay]`, fractions of the element's own box. Default `[0.5, 0.5]`, the centre. `[0, 0]` top-left, `[0, 0.5]` left-middle. For text the box is the laid-out block. |
| `rotate` | Degrees, clockwise, about the anchor. |
| `scale`, `sx`, `sy` | About the anchor. |
| `opacity` | 0–1. A group's opacity multiplies its children's. |
| `blur` | Pixels. |
| `shadow` | `{{ color: '#00000099', blur: 24, x: 0, y: 8 }}` |
| `t` | `[start, end]` seconds: when it exists. |
| `in`, `out` | Entrance and exit presets (below). |

Sizes in `%`: `w` is of the frame's width, `h` of its height, and `size`, `radius`, `strokeWidth`
of its **short side** — so `size="8%"` is the same weight on 1080×1920 and 1920×1080.

Colours: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgba(r,g,b,a)`, `white`, `black`, `transparent`.
Gradient fills: `"linear(180, #000000cc, #00000000 80%)"` (angle as CSS: 0 up, 90 right, 180
down) or `"radial(#ffffff22, #00000000)"`; they span the element's own box.

Fonts: `font` is a family the editor has — a font the project **imported** (`import_media` a
`.ttf`/`.otf`/`.woff`/`.woff2`; the result and `read_project.fonts` give its `family`),
`"Inter Variable"` or `"JetBrains Mono Variable"` (they ship with bay), or one installed on this
Mac. Prefer importing: an imported font travels with the project, an installed one does not.
Never install a font system-wide for bay. Nothing is fetched: a web font name that is not
available draws in the fallback.

**Variable-font axes**: `variations={{ wdth: 87, wght: 600 }}` sets any axis the font has —
width, weight, optical size, slant, or its own (`GRAD`, `XTRA`). An axis given here wins over
`weight`. Axes need a font bay can load a copy of: an imported font (by its `family`, any axis its
file declares — `read_project.fonts` lists them), one that ships with bay, or an installed font
named by its **full or PostScript name** (`"Skia-Regular"`, not `"Skia"`). Any other family is
refused by `write_brf`, naming the project's imported fonts and bay's. Each distinct set of values is a font face of its
own, loaded the first time it is drawn — so when animating an axis, step it
(`Math.round(v / 10) * 10`) rather than giving every frame a new value.

## Animating

Compute any prop from `t` — that is the whole model:

| Helper (`from 'bay'`) | |
|---|---|
| `interpolate(t, [0, 1], [a, b], { easing })` | Maps `t` across ranges; **clamps** outside them. `easing` is a function or a name (below). |
| `spring(t, { delay, stiffness, damping, mass, from, to })` | A physical spring, `t` and `delay` in seconds. Default config overshoots a little then settles; `damping: 200` does not overshoot. |
| `interpolateColors(t, [0, 1], ['#f00', '#0f0'])` | Blends colours. |
| `Easing` | Remotion's: `Easing.out(Easing.cubic)`, `Easing.bezier(.2,.8,.2,1)`, `Easing.back()`… |
| `random(seed)` | A fixed number in [0, 1) for a seed. |
| `useCurrentFrame()`, `useVideoConfig()`, `useTime()` | Inside components: the frame (relative to the enclosing `<Sequence>`), `{ fps, width, height }`, and seconds. |
| `<Sequence from={frames} durationInFrames={frames}>` | Shows its children in that window, and their frame starts at 0 there. |

Named easings (for `easing:` or keys): `linear`, `in`, `out`, `inOut`, `inQuad`, `outQuad`,
`inOutQuad`, `inCubic`, `outCubic`, `inOutCubic`, `inExpo`, `outExpo`, `inOutExpo`, `inBack`,
`outBack`, `inOutBack`, `outElastic`, `outBounce`, `spring`, `hold`.

**Remotion code runs**: `import { useCurrentFrame, interpolate, spring, Sequence } from 'remotion'`
gives Remotion's own semantics — frames, `spring({ frame, fps, config })`, and `interpolate`
extending past its range unless you pass `extrapolateRight: 'clamp'`. Draw with bay's elements
instead of `<div>`/`<AbsoluteFill>`.

Declarative shortcuts, when they say it more briefly than code:

- **Presets**: `in="up"` / `out="fade"`, or `in={['pop', 0.4, 0.2]}` = `[name, duration, delay]`.
  `fade`, `up`, `down`, `left`, `right` (slide 6% of the short side while fading), `pop`, `grow`,
  `wipe`, `blur`, `type` (typewriter).
- **Split text**: `split="word"` (or `"char"`, `"line"`) plays the element's `in`/`out` on each
  piece, `stagger` seconds apart, in reading order.
- **Keys**: any number or colour prop may be `[[t, value], [t, value, 'outBack']]`, seconds.

## Examples

### Counter with a growing bar

```tsx
import { interpolate, spring, Easing } from 'bay'

export const vars = { value: 3200, label: 'new users this week', accent: '#FFB020' }

export default ({ t, vars }) => {
  const count = Math.round(interpolate(t, [0.2, 1.8], [0, vars.value], { easing: Easing.out(Easing.cubic) }))
  return (
    <scene duration={4}>
      <rect x="50%" y="50%" w="60%" h="30%" radius="3%" fill="#111118ee" in={['pop', 0.5]} out="fade" />
      <text x="50%" y="46%" size="11%" weight={900} fill={vars.accent}>{count.toLocaleString('en-US')}</text>
      <text x="50%" y="56%" size="3.4%" weight={600} fill="#ffffffcc" in={['fade', 0.4, 0.3]}>{vars.label}</text>
      <rect x="20%" y="61%" anchor={[0, 0.5]} w="60%" h={6} radius={3} fill={vars.accent}
        sx={spring(t, { delay: 0.2, damping: 200 })} />
    </scene>
  )
}
```

### Lower third, as components

```tsx
import { spring, interpolate } from 'bay'

export const vars = { name: 'Ada Lovelace', role: 'Analyst, Difference Engine', accent: '#11D1A0' }

const Line = ({ t, delay, children, y, size, fill }) => (
  <text x={34 - 26 * (1 - interpolate(t - delay, [0, 0.4], [0, 1], { easing: 'outCubic' }))} y={y}
    anchor={[0, 0.5]} align="left" size={size} weight={900} fill={fill}
    opacity={interpolate(t - delay, [0, 0.3], [0, 1])} shadow={{ color: '#000000aa', blur: 24, y: 6 }}>
    {children}
  </text>
)

export default ({ t, vars }) => (
  <scene duration={5}>
    <group x="6%" y="80%" anchor={[0, 0.5]} out={['fade', 0.3]}>
      <rect anchor={[0, 0.5]} w={10} h={130} radius={5} fill={vars.accent} sy={spring(t, { stiffness: 180, damping: 14 })} />
      <Line t={t} delay={0.1} y={-26} size={64} fill="#ffffff">{vars.name}</Line>
      <Line t={t} delay={0.22} y={40} size={36} fill={vars.accent}>{vars.role}</Line>
    </group>
  </scene>
)
```

### Bar chart from data

```tsx
import { spring } from 'bay'

const DATA = [
  { label: 'Mon', value: 32 },
  { label: 'Tue', value: 58 },
  { label: 'Wed', value: 41 },
  { label: 'Thu', value: 77 },
  { label: 'Fri', value: 64 }
]

export default ({ t, width, height }) => {
  const max = Math.max(...DATA.map((d) => d.value))
  const barW = (width * 0.6) / DATA.length
  return (
    <scene duration={4} background="#0B0B0F">
      {DATA.map((d, i) => {
        const grow = spring(t, { delay: 0.15 * i, damping: 18 })
        const x = width * 0.2 + barW * (i + 0.5)
        const h = height * 0.45 * (d.value / max) * grow
        return (
          <group key={d.label}>
            <rect x={x} y={height * 0.72} anchor={[0.5, 1]} w={barW * 0.7} h={h} radius={6}
              fill={i === 3 ? '#11D1A0' : '#3B82F6'} />
            <text x={x} y={height * 0.77} size="2.6%" weight={600} fill="#ffffffaa">{d.label}</text>
          </group>
        )
      })}
    </scene>
  )
}
```

### Kinetic captions, back to back

```tsx
const LINES = [
  { at: 0, text: 'Nothing leaves your Mac.' },
  { at: 2, text: 'Not even the audio.' }
]

export default () => (
  <scene duration={4}>
    {LINES.map((line, i) => (
      <text key={i} t={[line.at, LINES[i + 1]?.at ?? 4]} x="50%" y="78%" size="6%" weight={900}
        stroke="#000000" strokeWidth={10} split="word" stagger={0.06}
        in={['pop', 0.3]} out={['fade', 0.15]}>
        {line.text}
      </text>
    ))}
  </scene>
)
```

### Remotion-style, with Sequence

```tsx
import { useCurrentFrame, useVideoConfig, spring, interpolate, Sequence } from 'remotion'

const Title = ({ children }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const enter = spring({ frame, fps, config: { damping: 200 } })
  return (
    <text x="50%" y="50%" size="8%" weight={900} scale={enter}
      opacity={interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' })}>
      {children}
    </text>
  )
}

export default () => (
  <scene duration={4}>
    <Sequence from={0} durationInFrames={60}><Title>Chapter one</Title></Sequence>
    <Sequence from={60}><Title>Chapter two</Title></Sequence>
  </scene>
)
```

### A top band for short-form graphics

```tsx
export default () => (
  <scene duration={6}>
    <rect anchor={[0, 0]} x={0} y={0} w="100%" h="30%" fill="linear(180, #0000008c, #00000000)" />
    <text t={[0.4, 2.6]} x="50%" y="11%" size="8%" weight={900} tracking={2} fill="#EF4B3C"
      in={['up', 0.2]} out={['fade', 0.15]}>OVERTHINKER</text>
    <text t={[2.8, 6]} x="50%" y="12%" size="7%" weight={900} w="86%" split="word" stagger={0.05}
      in={['up', 0.2]} out={['fade', 0.15]}>TOO MUCH INPUT</text>
  </scene>
)
```

### Weight that breathes (variable-font axes)

```tsx
import { interpolate } from 'bay'

export default ({ t }) => {
  const wght = Math.round(interpolate(t, [0, 1.2, 2.4], [200, 900, 200]) / 25) * 25
  return (
    <scene duration={3}>
      <text x="50%" y="50%" size="12%" font="Inter Variable" variations={{ wght }}>
        Variable
      </text>
    </scene>
  )
}
```

## When `write_brf` refuses

The module is compiled and run across its whole duration before anything changes. A compile
error, a throw on any frame (`frame 45 (line 12:7): Cannot read properties of undefined`), a
prop that does not exist (`layers[0].opactiy — did you mean "opacity"?`), a `<div>`, text outside
`<text>` — each comes back with where it is, and nothing is created. A module that runs longer
than 3 seconds for half a second of frames is stopped: look for a loop that never ends.

## Checking the result

`write_brf` confirms the module runs, not that it looks right. Look at it with `preview_frame` at
the start, mid-entrance, at rest and mid-exit: text off the frame, an element hidden behind a
later one, an anchor on the wrong corner are the usual surprises, and only a look finds them.
