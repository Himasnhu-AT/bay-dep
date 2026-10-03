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
| `<glass>` | `w`, `h`, `radius`, `material`, `blur`, `saturation`, `tint`, `tintOpacity`, `refraction`, `bezel`, `edgeHighlight` — frosted glass over what is below the clip ([Glass](#glass)) |
| `<scene3d>` | `w`, `h` (or `width`, `height`), `camera`, `fog`, `background`; children are `<text3d>`, `<box3d>`, `<plane3d>`, `<light3d>` — a 3D view drawn in its box ([3D](#3d-extruded-text-and-a-camera)) |

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

### Measured moves: `BM`

`import { BM } from 'bay'` is bay's move library: each move is a function of `t` that returns
plain numbers — offsets, scales, opacity, a radius — for you to put on an element. It is the same
library, under the same name, that an HTML composition loads as `bay-motion.js`, so a move looks
the same in both. Times are absolute seconds: `BM.wordLand(t, 0.2)` lands a word at 0.2 s and is
at rest ever after.

| Family | Moves |
|---|---|
| enter | `wordLand(t, t0)` → `{op, y, s}` · `letterFall(t, t0, i)` → `{op, y, sx, sy}` · `cardPop(t, t0)` → `{op, s, dy}` · `cardLift(t, t1)` → `{op, s, dy, blur}` · `lineReveal(t, t0, i)` → `{y, visible}` · `typeOn(t, t0, text)` → `{n, str, done, caret}` · `checkTick(t, t0)` → `{on, s}` |
| carry | `rectMorph(t, t0, t1, A, B)` → `{x, y, w, h, r, cx, cy, p}` · `iris(t, t0, t1, cx, cy)` → `{r, covered}` · `pushInto(t, t0, t1, rect)` → `{s, tx, ty, matrix}` · `arcHop(t, t0, t1, from, to)` → `{x, y}` · `converge(t, t0, t1, i, n, from, to)` → `{x, y, rot}` · `rail(t, switches)` → `{shift, index, wobble, sx, sy, textShift}` · `wordCuts(t, cuts)` → `{word, i, tau}` |
| contact | `impact(t, tHit)` → `{ring, sx, sy}` · `press(t, tDown)` → `{s, down, active}` · `pointer(t, knots, clicks)` → `{x, y, s, down}` · `stretch(vx, vy)` → `{angle, sx, sy}` · `simFollower(target, { duration })`, `simMagnet(…)`, `simString(…)` → `{ at(t) }` |
| camera | `cameraAt(t, keys)` → `{x, y, zoom, rot}` · `layerMatrix(camera, { depth })` · `toScreen` / `toWorld` / `boxToScreen` · `shake(t, tHit)` · `farGrid(camera)` · `frameTravel(c0, c1)` |
| core | `spring(tau, { damping, frequency })`, `springTimed(tau, { duration, bounce })`, `EASES`, `EASE_T80`, `easeOf`, `progress`, `lerp`, `spline`, `rng(seed)` |

`BM.spring` is not the `spring` above: it takes seconds since release and a damping ratio.
A sim (`simFollower`, `simString`, `simMagnet`) is built **once, at the top of the module** —
it is a recording, and `.at(t)` reads it — never inside the default export.

```tsx
import { BM } from 'bay'

export const vars = { word: 'Carried' }

const CARD = { x: 660, y: 420, w: 600, h: 240, r: 40 }
const FULL = { x: 0, y: 0, w: 1920, h: 1080, r: 0 }

export default ({ t, vars }) => {
  const word = BM.wordLand(t, 0.2)
  // One rect becomes the next scene's ground: a carry, not a cut.
  const box = BM.rectMorph(t, 1.4, 2.2, CARD, FULL)
  const hit = BM.impact(t, 0.2 + 0.35)
  return (
    <scene duration={3} size={[1920, 1080]} background="#0B0E14">
      <rect anchor={[0, 0]} x={box.x} y={box.y} w={box.w} h={box.h} radius={box.r} fill="#1B2A4A" />
      <text x={960} y={540 + word.y} size={120} weight={800} opacity={word.op}
        sx={word.s * hit.sx} sy={word.s * hit.sy}>{vars.word}</text>
    </scene>
  )
}
```

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

## 3D: extruded text and a camera

`<scene3d>` is a box in the 2D scene that shows a 3D world through a camera. Place it like any
element (`x`, `y`, `w`, `h`, `opacity`, `in`/`out` all apply to the box), and put 3D objects inside
it. It draws in the same pass as everything else, so it scrubs, previews and exports alike.
**Everything that moves is computed from `t`** — to fly the camera through a title, compute
`camera.position` each frame, exactly as you would compute `x` for a rect.

The world is y-up, in units you choose: a `size={1}` text is one unit per em. The default camera
sits at `[0, 0, 10]` looking at the origin with `fov` 40, which frames about 7 units top to bottom.

| Element | Props |
|---|---|
| `<scene3d>` | `camera={{ position: [x, y, z], lookAt: [x, y, z], fov, roll, near, far }}` (`roll` degrees; positive tilts the picture clockwise), `fog={{ near, far, color, mode }}`, `background` (`"transparent"` default, or a colour) |
| `<text3d>` | children are the text (≤ 200 characters, `\n` for lines); `size` (default 1), `depth` (0.2), `bevel` (0 = sharp; try 0.02–0.04 of size), `weight` (700), `font`, `align`, `lineHeight`, `curveSegments` (1–24, default 8) |
| `<box3d>` | `size={[w, h, d]}` |
| `<plane3d>` | `size={[w, h]}` — visible from both sides |
| `<light3d>` | `type="ambient"`, `"directional"` or `"point"`; `color`, `intensity`, `position`, `distance` (point: how far it reaches; no falloff before) |

Every mesh (`text3d`, `box3d`, `plane3d`) takes `position`, `rotation` (degrees about x, y, z),
`scale`, and a material: `color`, `metalness` (0–1), `roughness` (0–1), `emissive`,
`emissiveIntensity`, `opacity`. With no `<light3d>` at all the scene gets a soft ambient light and
a key light from the upper right.

- **Fog**: `mode: "fade"` (the default over a transparent background) makes distant things
  see-through, which is what you want over footage. `"tint"` turns them the fog colour — only right
  over an opaque `background` of that colour; over video it turns far letters a flat colour.
- **Fonts**: 3D text needs the font's outlines, so `font` is **`"Inter"`** (built in, weights
  400/700/900, Latin) or a font the project **imported** as `.ttf`, `.otf` or `.woff` (by its
  family; a variable font extrudes its default instance). WOFF2 cannot be read, and an installed
  font is refused — `write_brf` names what you can use. A character the font has no glyph for is
  refused by name.
- **Keep shapes still, move the objects.** A text's geometry is built once per `text`, `font`,
  `weight`, `bevel`, `align`, `lineHeight` and `curveSegments`, then reused; `size`, `depth` and a
  box's or plane's `size` are applied as a scale, so animating them is free, like `position`,
  `rotation`, `scale`, colours, `opacity` and the camera. **A bevel is the exception**: it is an
  absolute width, so a bevelled text is rebuilt whenever its `bevel`, `size` or `depth` changes —
  animating any of those on a bevelled text rebuilds it every frame (up to the whole vertex budget).
  Animate `scale` instead, or drop the bevel.
- **Limits**: 64 meshes and 8 lights per `<scene3d>`, and a vertex budget (about 2M, estimated from
  the text before anything is built) — a very long bevelled title at high `curveSegments` is
  refused with what to lower.

### Fly through a 3D title

```tsx
import { interpolate, spring } from 'bay'

export const vars = { line1: 'SOC 2', line2: 'in minutes', accent: '#7CF2C4' }

export default ({ t, vars }) => {
  // Far back, glide in, then fly through the first line as it ends.
  const z = interpolate(t, [0, 2.6, 4.2], [22, 5.5, -3], { easing: 'inOutCubic' })
  const x = interpolate(t, [0, 2.6, 4.2], [0, 0.8, 0], { easing: 'inOutCubic' })
  const lookZ = interpolate(t, [2.6, 4.2], [0, -12], { easing: 'inExpo' })
  const rise = spring(t, { delay: 0.6, damping: 200 })
  return (
    <scene duration={5}>
      <scene3d x="50%" y="50%" w="100%" h="100%"
        camera={{ position: [x, 0.3, z], lookAt: [0, 0, lookZ], fov: 38, roll: interpolate(t, [0, 4.2], [0, -6]) }}
        fog={{ near: 8, far: 30 }} out={['fade', 0.4]}>
        <light3d type="ambient" intensity={0.4} />
        <light3d type="directional" position={[4, 6, 8]} intensity={2.4} />
        <text3d size={1.8} depth={0.55} bevel={0.035} weight={900} position={[0, 0.9, 0]}
          color="#E9EDF6" metalness={0.55} roughness={0.28} opacity={interpolate(t, [0, 0.5], [0, 1])}>
          {vars.line1}
        </text3d>
        <text3d size={0.9} depth={0.3} bevel={0.02} position={[0, -0.9 - 0.6 * (1 - rise), -2.5]}
          color={vars.accent} emissive={vars.accent} emissiveIntensity={0.25} opacity={rise}>
          {vars.line2}
        </text3d>
      </scene3d>
    </scene>
  )
}
```

Check it with `preview_frame` at the start (the title small and far), mid-glide, and just before
the fly-through, over the footage it will sit on.

## Glass

`<glass>` is a pane of frosted glass: what the **tracks below this clip** show through it
blurred, a little more saturated, and bent at the rim, with a tint and a rim light on top. It is a
leaf, so put text and shapes *after* it to sit on the glass.

```tsx
import { spring, interpolate } from 'bay'

export const vars = { title: 'Nothing leaves your Mac', kicker: 'PRIVATE BY DESIGN' }

export default ({ t, vars }) => {
  const rise = spring(t, { delay: 0.1, damping: 200 })
  const y = 540 + 60 * (1 - rise)
  return (
    <scene duration={4} size={[1920, 1080]}>
      <glass x={960} y={y} w={1100} h={300} radius={48} material="regular" tint="#ffffff"
        tintOpacity={0.14} opacity={rise} out={['fade', 0.3]} />
      <text x={960} y={y - 50} size={34} weight={700} tracking={6} fill="#0B0B0Fb3"
        opacity={interpolate(t, [0.3, 0.6], [0, 1])} out={['fade', 0.3]}>{vars.kicker}</text>
      <text x={960} y={y + 30} size={84} weight={900} fill="#0B0B0F"
        opacity={interpolate(t, [0.35, 0.7], [0, 1])} out={['fade', 0.3]}>{vars.title}</text>
    </scene>
  )
}
```

**Materials** are quick-liquid's, clearest to most frosted — each sets `blur`, `saturation`,
`tintOpacity`, `refraction` and `bezel`, and any of them given beside it wins:

| `material` | blur | saturation | tintOpacity | refraction | bezel | Use |
|---|---|---|---|---|---|---|
| `clear` | 2 | 1.55 | 0.03 | 26 | 36 | a lens over a busy shot; the picture stays legible |
| `thin` | 6 | 1.5 | 0.05 | 18 | 26 | chips and small labels |
| `regular` (default) | 14 | 1.7 | 0.09 | 16 | 30 | cards and lower thirds with text on them |
| `thick` | 22 | 1.8 | 0.13 | 12 | 28 | long text over detailed footage |
| `ultra` | 30 | 1.85 | 0.17 | 10 | 26 | the backdrop only as colour and light |

**Parameters**, and where each stops reading as glass — `write_brf` refuses a value past these:

| Prop | Safe range | Past it |
|---|---|---|
| `blur` | 0–40 px | past 40 px the backdrop turns to fog and the glass reads as a grey card |
| `saturation` | 0–2.5 (1 = unchanged) | past 2.5 skin and skies go neon under the glass |
| `tint` | a colour, or `"r, g, b"` | — (its strength is `tintOpacity`) |
| `tintOpacity` | 0–0.6 | past 0.6 the tint hides the backdrop and it reads as a flat card |
| `refraction` | 0–60 px | past 60 px the rim smears the backdrop into streaks |
| `bezel` | 0–120 px | past 120 px the bend covers the whole pane and it reads as a fisheye |
| `edgeHighlight` | 0–1 | above 1 the rim clips to a white outline |

A glass number given as a `"$name"` var is not refused past its range; it is clamped to the
range when drawn, so check the look with `preview_frame`. Plain numbers and keys are refused. Lengths are in the scene's own
pixels and scale with it. `blur` on a glass pane is its frost —
the pane itself is never blurred.

**Text on glass: dark ink on light glass, light ink on dark glass.** A white tint lifts
whatever is behind it, so white text on it disappears; use near-black (`#0B0B0F`) at full
strength and a lighter alpha for secondary lines. For light text, tint dark
(`tint="#0B0B0F" tintOpacity={0.35}`). Check both with `preview_frame` over the actual footage —
the backdrop decides the contrast, not the tint alone.

What glass frosts, and what it does not:

- It frosts what is **under the clip** — footage, photos and other clips on lower tracks. Shapes
  earlier in the **same** scene, and a scene `background`, are painted on the same layer as the
  glass and are not behind it; to frost a graphic, put it in its own `.brf` on a lower track.
- A clip with a **blend mode** other than normal draws its glass as tint and rim only, without
  the frost: a blended clip is meant to mix with what is under it.
- A `group`'s `clip` does not clip the frost; keep panes inside their group's box.
- Near the edge of the frame the frost fades a little, because there is nothing beyond the frame
  to blur in.

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
