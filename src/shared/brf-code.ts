/**
 * `.brf` source — motion graphics written as JSX/TS, drawn natively.
 *
 * A `.brf` file is a module an agent writes the way it writes React or Remotion: a default export
 * that takes the moment and returns a scene.
 *
 *     import { interpolate, spring } from 'bay'
 *     export const vars = { title: 'Launch day' }
 *     export default ({ t, vars }) => (
 *       <scene duration={4}>
 *         <text x="50%" y="50%" size="8%" opacity={interpolate(t, [0, 0.4], [0, 1])}>{vars.title}</text>
 *       </scene>
 *     )
 *
 * The shipped lower third is 3663 characters of HTML, CSS and script; as a module (the guide's
 * example, with components and springs) it is 947 — held under a third by `brf-code.test.ts`.
 *
 * Nothing it returns is a DOM: `<scene>`, `<rect>`, `<ellipse>`, `<path>`, `<text>`, `<glass>`,
 * `<group>` and `<scene3d>` (with its `<text3d>`, `<box3d>`, `<plane3d>` and `<light3d>`) resolve to
 * the `.brf` scene format (`./brf`, `./scene3d`) as data, which the compositor paints directly —
 * so the code gets everything a program can do (loops, maths, components, data) and the picture
 * still costs well under a millisecond, with no browser to capture.
 *
 * This module is the runtime: compile (Sucrase — JSX and TypeScript, nothing else), load (a
 * module whose only importable names are `bay` and `remotion`), and render one frame to a
 * validated scene. It is pure so the whole pipeline is testable in Node. It is **not** the
 * sandbox: in the app the code runs in a Worker that has no bridge to main, whose network and
 * code-generation are locked down before any of it runs (`./brf-lockdown`), and whose session
 * main refuses every remote request (`src/main/offline.ts`).
 *
 * `import … from 'remotion'` resolves to the same helpers with Remotion's own defaults
 * (`interpolate` extends rather than clamps, `spring` takes `{ frame, fps, config }`), so code
 * written against Remotion's API — frames, `useCurrentFrame`, `<Sequence from>` — runs as long as
 * it draws with bay's elements. Real React components are the planned next step; elements are
 * resolved lazily, top-down, precisely so a component tree can be evaluated with context
 * (a `<Sequence>` shifts the frame its children see) the way React would.
 */

import { transform } from 'sucrase'
// The file, not the folder: Node's resolver (the test suite) does not open a directory's index.
import * as BM from './motion/index'
import { ease as namedEase, parseBrf, parseColor, type BrfCodeMeta, type BrfDocument, type Easing as EasingName, type Layer } from './brf'

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

export type Component = (props: Record<string, unknown>) => unknown

export interface BrfElement {
  $$brf: true
  type: string | Component
  props: Record<string, unknown>
  children: unknown[]
}

const PRIMITIVES = new Set(['scene', 'rect', 'ellipse', 'path', 'text', 'group', 'glass', 'scene3d'])
/** What a `<scene3d>` holds, and nothing else does. */
const PRIMITIVES_3D = new Set(['text3d', 'box3d', 'plane3d', 'light3d'])

/** The JSX factory: `<rect w={4}/>` compiles to `__brf_h('rect', { w: 4 })`. */
export function h(type: string | Component, props: Record<string, unknown> | null, ...children: unknown[]): BrfElement {
  return { $$brf: true, type, props: props ?? {}, children }
}

export function Fragment(props: Record<string, unknown>): unknown {
  return props.children
}

const isElement = (value: unknown): value is BrfElement =>
  typeof value === 'object' && value !== null && (value as BrfElement).$$brf === true

// ---------------------------------------------------------------------------
// The moment being rendered
// ---------------------------------------------------------------------------

interface Moment {
  frame: number
  fps: number
  width: number
  height: number
  durationInFrames: number
}

let moment: Moment | null = null

function now(): Moment {
  if (!moment) throw new Error('useCurrentFrame and useVideoConfig can only be called while a scene renders')
  return moment
}

/** The frame being drawn, relative to the enclosing `<Sequence>` (Remotion's contract). */
export function useCurrentFrame(): number {
  return now().frame
}

export function useVideoConfig(): { fps: number; width: number; height: number; durationInFrames: number } {
  const m = now()
  return { fps: m.fps, width: m.width, height: m.height, durationInFrames: m.durationInFrames }
}

/** Seconds since the start of the enclosing `<Sequence>` — `useCurrentFrame() / fps`. */
export function useTime(): number {
  const m = now()
  return m.frame / m.fps
}

/**
 * Shows its children from frame `from` for `durationInFrames`, and shifts the frame they see so
 * that they start at 0 — Remotion's `<Sequence>`. Resolved by the tree walk, not called.
 */
export function Sequence(_props: { from?: number; durationInFrames?: number; children?: unknown }): unknown {
  throw new Error('<Sequence> is resolved by bay, not called')
}

// ---------------------------------------------------------------------------
// Animation helpers
// ---------------------------------------------------------------------------

type EasingFn = (t: number) => number
type Extrapolate = 'clamp' | 'extend' | 'identity'

interface InterpolateOptions {
  easing?: EasingFn | EasingName
  extrapolateLeft?: Extrapolate
  extrapolateRight?: Extrapolate
}

function easingOf(easing: EasingFn | EasingName | undefined): EasingFn {
  if (easing === undefined) return (t) => t
  if (typeof easing === 'function') return easing
  return (t) => namedEase(easing, t)
}

function makeInterpolate(defaultExtrapolate: Extrapolate) {
  return function interpolate(
    input: number,
    inputRange: readonly number[],
    outputRange: readonly number[],
    options: InterpolateOptions = {}
  ): number {
    if (inputRange.length < 2 || inputRange.length !== outputRange.length) {
      throw new Error(`interpolate needs inputRange and outputRange of the same length, at least 2 (got ${inputRange.length} and ${outputRange.length})`)
    }
    for (let i = 1; i < inputRange.length; i++) {
      if (!(inputRange[i]! > inputRange[i - 1]!)) throw new Error(`interpolate's inputRange must be strictly increasing: ${inputRange.join(', ')}`)
    }
    const ease = easingOf(options.easing)
    const last = inputRange.length - 1
    let seg = 0
    while (seg < last - 1 && input > inputRange[seg + 1]!) seg++
    const x0 = inputRange[seg]!
    const x1 = inputRange[seg + 1]!
    const y0 = outputRange[seg]!
    const y1 = outputRange[seg + 1]!
    let p = (input - x0) / (x1 - x0)
    const left = options.extrapolateLeft ?? defaultExtrapolate
    const right = options.extrapolateRight ?? defaultExtrapolate
    if (input < inputRange[0]!) {
      if (left === 'clamp') return outputRange[0]!
      if (left === 'identity') return input
    }
    if (input > inputRange[last]!) {
      if (right === 'clamp') return outputRange[last]!
      if (right === 'identity') return input
    }
    // Inside the range the easing shapes progress; outside it (extend) the line continues.
    if (p >= 0 && p <= 1) p = ease(p)
    return y0 + (y1 - y0) * p
  }
}

/** bay's `interpolate`: clamps outside the range, because a fade that overshoots to 1.4 is a bug. */
export const interpolate = makeInterpolate('clamp')

/** Colours at the stops, blended through their channels. Returns `rgba(…)`. */
export function interpolateColors(input: number, inputRange: readonly number[], colors: readonly string[]): string {
  const rgba = colors.map((c) => {
    const parsed = parseColor(c)
    if (!parsed) throw new Error(`interpolateColors: "${c}" is not a colour (use #rrggbb, #rrggbbaa or rgba(…))`)
    return parsed
  })
  const channel = (k: number): number => interpolate(input, inputRange, rgba.map((c) => c[k]!))
  return `rgba(${Math.round(channel(0))},${Math.round(channel(1))},${Math.round(channel(2))},${Math.round(channel(3) * 1000) / 1000})`
}

interface SpringConfig {
  stiffness?: number
  damping?: number
  mass?: number
  overshootClamping?: boolean
}

/**
 * A damped spring from `from` to `to`, `elapsed` seconds after it was released — the closed form
 * of the same physics Remotion steps through (critically damped from a ratio of 1 up, as there),
 * so there is no frame-rate dependence.
 */
function springAt(elapsed: number, config: SpringConfig, from: number, to: number): number {
  if (elapsed <= 0) return from
  const k = config.stiffness ?? 100
  const c = config.damping ?? 10
  const m = config.mass ?? 1
  const w0 = Math.sqrt(k / m)
  const zeta = c / (2 * Math.sqrt(k * m))
  let x: number
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta)
    x = 1 - Math.exp(-zeta * w0 * elapsed) * (Math.cos(wd * elapsed) + ((zeta * w0) / wd) * Math.sin(wd * elapsed))
  } else {
    // Any damping ratio at or above 1 is treated as critically damped — Remotion's own rule
    // (spring-utils.ts), and the one its users' habits are built on: `damping: 200` there is "smooth,
    // no bounce" and settles in about half a second. The true overdamped curve (ratio 10 here) takes
    // seconds, and the first version of this drew a Remotion example's title at a fifth of its size.
    x = 1 - Math.exp(-w0 * elapsed) * (1 + w0 * elapsed)
  }
  if (config.overshootClamping) x = Math.min(1, x)
  return from + (to - from) * x
}

/**
 * bay's spring: `spring(t, { delay, stiffness, damping, mass, from, to })` with `t` and `delay`
 * in seconds. Remotion's object form — `spring({ frame, fps, config, delay })` with frames — is
 * accepted too, so either habit works.
 */
export function spring(
  t: number | { frame: number; fps: number; config?: SpringConfig; from?: number; to?: number; delay?: number },
  options: SpringConfig & { delay?: number; from?: number; to?: number } = {}
): number {
  if (typeof t === 'object') {
    const { frame, fps, config = {}, from = 0, to = 1, delay = 0 } = t
    return springAt((frame - delay) / fps, config, from, to)
  }
  return springAt(t - (options.delay ?? 0), options, options.from ?? 0, options.to ?? 1)
}

const remotionSpring = (args: { frame: number; fps: number; config?: SpringConfig; from?: number; to?: number; delay?: number }): number =>
  spring(args)

/** Remotion's `Easing`, for code that composes easings as functions. */
export const Easing = {
  linear: (t: number) => t,
  ease: (t: number) => namedEase([0.25, 0.1, 0.25, 1], t),
  quad: (t: number) => t * t,
  cubic: (t: number) => t * t * t,
  poly: (n: number) => (t: number) => t ** n,
  sin: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  circle: (t: number) => 1 - Math.sqrt(1 - t * t),
  exp: (t: number) => (t === 0 ? 0 : 2 ** (10 * (t - 1))),
  elastic: (bounciness = 1) => (t: number) => {
    const p = bounciness * Math.PI
    return 1 - Math.cos((t * Math.PI) / 2) ** 3 * Math.cos(t * p)
  },
  back: (s = 1.70158) => (t: number) => t * t * ((s + 1) * t - s),
  bounce: (t: number) => 1 - namedEase('outBounce', 1 - t),
  bezier: (x1: number, y1: number, x2: number, y2: number) => (t: number) => namedEase([x1, y1, x2, y2], t),
  in: (f: EasingFn) => f,
  out: (f: EasingFn) => (t: number) => 1 - f(1 - t),
  inOut: (f: EasingFn) => (t: number) => (t < 0.5 ? f(t * 2) / 2 : 1 - f((1 - t) * 2) / 2)
}

/** A number in [0, 1) from a seed — the same seed, the same number, every frame and every run. */
export function random(seed: string | number | null): number {
  let h = 2166136261
  const text = String(seed)
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return mulberry32(h >>> 0)()
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const common = {
  h,
  Fragment,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  useTime,
  interpolateColors,
  Easing,
  random
}

/**
 * `import { … } from 'bay'`. `BM` is the move library (`./motion`) — the same object, under the
 * same name, that an HTML composition gets as a global from `bay-motion.js`, so a move is written
 * `BM.wordLand(t, 0.2)` in both. It is one name rather than fifty because `spring` and
 * `interpolate` already mean something here.
 */
export const BAY_MODULE = { ...common, interpolate, spring, BM }
/** `import { … } from 'remotion'` — Remotion's defaults: `interpolate` extends, `spring` takes an object. */
export const REMOTION_MODULE = { ...common, interpolate: makeInterpolate('extend'), spring: remotionSpring }

// ---------------------------------------------------------------------------
// Compile and load
// ---------------------------------------------------------------------------

export interface BrfModule {
  render: (props: Record<string, unknown>) => unknown
  /** `export const vars = {…}`: the defaults each placement may override. */
  vars: Record<string, string | number | boolean>
}

export type Loaded = { ok: true; module: BrfModule } | { ok: false; error: string }

/** How many lines `new Function` puts before the body, for turning its line numbers back into the source's. */
const FUNCTION_HEADER_LINES = 2

/** "line 12:5" from an error's stack, mapped to the compiled source (which Sucrase keeps line-aligned). */
export function sourceLine(error: unknown): string {
  const stack = error instanceof Error ? (error.stack ?? '') : ''
  const m = /<anonymous>:(\d+):(\d+)/.exec(stack)
  if (!m) return ''
  return ` (line ${Number(m[1]) - FUNCTION_HEADER_LINES}:${m[2]})`
}

/**
 * Compiles and loads `source`. `makeFunction` is the Function constructor to use — the worker
 * passes the one it saved before locking the global one away.
 */
export function loadBrf(
  source: string,
  makeFunction: (...args: string[]) => (...args: unknown[]) => unknown = Function as never
): Loaded {
  // A dynamic import compiles to a promise-wrapped `require`, which would be refused only after
  // the frame had rendered — silently. Refused here instead, where the author hears about it.
  if (/\bimport\s*\(/.test(source)) {
    return {
      ok: false,
      error: 'uses import(): a .brf cannot load code at run time. Import from \'bay\' or \'remotion\' at the top, or write the helper inline.'
    }
  }
  let js: string
  try {
    js = transform(source, {
      transforms: ['jsx', 'typescript', 'imports'],
      // Names no author will shadow: `const h = height * 0.4` is ordinary code, and with the
      // factory called `h` it broke every element in its scope ("h is not a function").
      jsxPragma: '__brf_h',
      jsxFragmentPragma: '__brf_Fragment',
      production: true
    }).code
  } catch (error) {
    return { ok: false, error: `does not compile: ${(error as Error).message}` }
  }

  const exports: Record<string, unknown> = {}
  const module = { exports }
  const require = (name: string): unknown => {
    if (name === 'bay') return BAY_MODULE
    if (name === 'remotion') return REMOTION_MODULE
    throw new Error(
      `cannot import "${name}": a .brf can import only from 'bay' or 'remotion' — it runs with ` +
        `no network, no filesystem and no other packages. Write the helper inline instead.`
    )
  }
  try {
    const run = makeFunction('exports', 'require', 'module', '__brf_h', '__brf_Fragment', js)
    run(exports, require, module, h, Fragment)
  } catch (error) {
    return { ok: false, error: `failed while loading${sourceLine(error)}: ${(error as Error).message}` }
  }
  const out = module.exports as Record<string, unknown>
  const render = out.default
  if (typeof render !== 'function') {
    return { ok: false, error: 'needs a default export: `export default ({ t, frame, vars }) => <scene duration={4}>…</scene>`' }
  }
  const vars = out.vars ?? {}
  if (typeof vars !== 'object' || vars === null || Array.isArray(vars)) {
    return { ok: false, error: '`export const vars` must be an object of names to strings, numbers or booleans' }
  }
  for (const [name, value] of Object.entries(vars)) {
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      return { ok: false, error: `vars.${name} must be a string, number or boolean` }
    }
  }
  return { ok: true, module: { render: render as BrfModule['render'], vars: vars as BrfModule['vars'] } }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export interface RenderInput {
  frame: number
  fps: number
  /** The size the scene lays out on when it declares none: the clip's box. */
  width: number
  height: number
  /** Values for `vars`, already merged over the module's defaults. */
  vars: Record<string, string | number | boolean>
}

export type Rendered = { ok: true; doc: BrfDocument } | { ok: false; error: string }

class ResolveError extends Error {}

/**
 * Children to layers, walking components top-down so a `<Sequence>` can shift what they see.
 * `in3d`: inside a `<scene3d>`, where only 3D objects belong (and 2D elements do not).
 */
function resolve(node: unknown, m: Moment, where: string, in3d = false): Layer[] {
  if (node === null || node === undefined || node === false || node === true || node === '') return []
  if (Array.isArray(node)) return node.flatMap((child, i) => resolve(child, m, `${where}[${i}]`, in3d))
  if (typeof node === 'string' || typeof node === 'number') {
    throw new ResolveError(`${where}: text "${String(node).slice(0, 30)}" must be inside <text>`)
  }
  if (!isElement(node)) {
    throw new ResolveError(`${where}: ${typeof node} is not something bay can draw — return elements like <rect/>, <text>…</text>, <group>…</group>`)
  }
  const { type, props, children } = node
  if (type === Sequence) {
    const from = Number(props.from ?? 0)
    const length = Number(props.durationInFrames ?? Infinity)
    if (m.frame < from || m.frame >= from + length) return []
    const inner: Moment = { ...m, frame: m.frame - from }
    const saved = moment
    moment = inner
    try {
      return resolve(children, inner, `${where}<Sequence>`, in3d)
    } finally {
      moment = saved
    }
  }
  if (typeof type === 'function') {
    const name = type.name || 'component'
    return resolve(type({ ...props, children: children.length <= 1 ? children[0] : children }), m, `${where}<${name}>`, in3d)
  }
  if (in3d) {
    if (!PRIMITIVES_3D.has(type)) {
      throw new ResolveError(`${where}: <${type}> cannot go inside <scene3d>, which holds text3d, box3d, plane3d and light3d — put 2D elements beside the <scene3d>, not in it`)
    }
    const { type: lightType, key: _key, children: _children, ...rest } = props
    const object: Record<string, unknown> = { type, ...rest }
    // `<light3d type="point">`: the element's own name is its `type`, so the light's is `kind`.
    if (type === 'light3d' && lightType !== undefined && rest.kind === undefined) object.kind = lightType
    if (type === 'text3d') {
      if (object.text === undefined) object.text = flattenText(children)
    } else if (children.length > 0) {
      throw new ResolveError(`${where}: <${type}> takes no children`)
    }
    return [object as unknown as Layer]
  }
  if (PRIMITIVES_3D.has(type)) {
    throw new ResolveError(`${where}: <${type}> belongs inside a <scene3d x y w h camera={…}>, which gives it a camera and a box to draw in`)
  }
  if (!PRIMITIVES.has(type)) {
    throw new ResolveError(`${where}: <${type}> is not a bay element — use scene, rect, ellipse, path, text, group, glass or scene3d (DOM elements are not drawn)`)
  }
  if (type === 'scene') throw new ResolveError(`${where}: <scene> can only be the root`)
  const layer: Record<string, unknown> = { type, ...props }
  delete layer.key
  delete layer.children
  if (type === 'group') {
    layer.layers = resolve(children, m, `${where}<group>`)
  } else if (type === 'scene3d') {
    // `width`/`height` read naturally on a 3D viewport; the format's box is `w`/`h` everywhere.
    for (const [long, short] of [['width', 'w'], ['height', 'h']] as const) {
      if (layer[long] === undefined) continue
      if (layer[short] !== undefined) throw new ResolveError(`${where}: <scene3d> has both ${long} and ${short} — give one`)
      layer[short] = layer[long]
      delete layer[long]
    }
    layer.objects = resolve(children, m, `${where}<scene3d>`, true)
  } else if (type === 'text') {
    if (layer.text === undefined) layer.text = flattenText(children)
  } else if (children.length > 0) {
    throw new ResolveError(`${where}: <${type}> takes no children`)
  }
  return [layer as unknown as Layer]
}

function flattenText(children: unknown[]): string {
  return children
    .flat(Infinity)
    .filter((c) => c !== null && c !== undefined && c !== false && c !== true)
    .map((c) => (isElement(c) ? '' : String(c)))
    .join('')
}

/**
 * One frame of `mod` as a validated scene document. Deterministic: `Math.random` is seeded by the
 * frame and `Date.now()` is the start of the document, for the length of the call.
 */
export function renderBrf(mod: BrfModule, input: RenderInput): Rendered {
  const m: Moment = { frame: input.frame, fps: input.fps, width: input.width, height: input.height, durationInFrames: Infinity }
  const savedRandom = Math.random
  const savedNow = Date.now
  const saved = moment
  moment = m
  Math.random = mulberry32(input.frame * 2654435761)
  Date.now = () => 0
  try {
    const root = mod.render({
      t: input.frame / input.fps,
      frame: input.frame,
      fps: input.fps,
      width: input.width,
      height: input.height,
      vars: input.vars
    })
    const scene = unwrapScene(root)
    const doc = {
      brf: 1,
      duration: scene.props.duration,
      ...(scene.props.size !== undefined ? { size: scene.props.size } : {}),
      ...(scene.props.background !== undefined ? { background: scene.props.background } : {}),
      vars: input.vars,
      layers: resolve(scene.children, m, 'scene')
    }
    // `vars` is included so `$name` strings keep working inside code; `layers` may be empty on a
    // frame where nothing is showing yet, which an authored document may not be.
    const parsed = parseBrf(doc, { allowEmptyLayers: true })
    if (!parsed.ok) {
      return { ok: false, error: `frame ${input.frame}: ${parsed.faults.map((f) => `${f.at}: ${f.message}`).join('; ')}` }
    }
    return { ok: true, doc: parsed.doc }
  } catch (error) {
    if (error instanceof ResolveError) return { ok: false, error: `frame ${input.frame}: ${error.message}` }
    return { ok: false, error: `frame ${input.frame}${sourceLine(error)}: ${(error as Error).message}` }
  } finally {
    Math.random = savedRandom
    Date.now = savedNow
    moment = saved
  }
}

function unwrapScene(root: unknown): BrfElement {
  let node = root
  // A component returning <scene> is fine: unwrap components until a primitive appears.
  for (let depth = 0; isElement(node) && typeof node.type === 'function' && node.type !== Sequence && depth < 32; depth++) {
    node = node.type({ ...node.props, children: node.children })
  }
  if (!isElement(node) || node.type !== 'scene') {
    throw new ResolveError('the default export must return <scene duration={seconds}>…</scene>')
  }
  const duration = node.props.duration
  if (typeof duration !== 'number' || !(duration > 0)) {
    throw new ResolveError('<scene> needs duration={seconds}, a number above 0')
  }
  return node
}

/** What a module declares about itself, read by rendering its first frame with its default vars. */
export type BrfMeta = BrfCodeMeta

export function probeBrf(mod: BrfModule, fps: number, width: number, height: number): { ok: true; meta: BrfMeta } | { ok: false; error: string } {
  const first = renderBrf(mod, { frame: 0, fps, width, height, vars: mod.vars })
  if (!first.ok) return first
  const doc = first.doc
  return {
    ok: true,
    meta: {
      duration: doc.duration,
      ...(doc.size ? { size: doc.size } : {}),
      ...(doc.background ? { background: doc.background } : {}),
      vars: mod.vars
    }
  }
}
