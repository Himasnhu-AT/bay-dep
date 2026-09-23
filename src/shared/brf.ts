/**
 * `.brf` scenes: motion graphics as data, drawn by bay's own compositor.
 *
 * This is the drawing layer under `.brf` modules (`./brf-code`). An agent writes JSX; each frame
 * of it resolves to one of these documents — layers, positions, keyed values, presets — which
 * `evaluateBrf` turns into draw operations and the renderer paints straight onto the canvas: no
 * window, no capture, the same code in preview and export. A document can also be used on its own
 * (`asset.brf`), which is what bay's own generated graphics are free to do.
 *
 * Three properties the format holds itself to:
 *
 * 1. **Data, never code.** Nothing in a document is executed; code runs in `.brf` modules, in a
 *    locked-down worker, and only its output — one of these — reaches the renderer.
 * 2. **A pure function of time.** `evaluateBrf(doc, t)` depends on nothing else, so any frame
 *    can be drawn in any order — scrubbing, export and `preview_frame` all ask for arbitrary
 *    times, and there is no timeline state to drift.
 * 3. **Short to write.** Positions accept `"50%"`; a property is a number or a list of
 *    `[time, value, easing]` keys; entrances and exits are named presets (`"in": "up"`); a
 *    line of text animates word by word with `"split": "word"` and one `stagger`.
 *
 * This module is the format: types, `parseBrf` (validation whose errors say how to fix the
 * document) and `evaluateBrf` (document + time → a flat list of things to draw). Painting that
 * list is the renderer's (`engine/brf.ts`), because it needs a canvas and this must not.
 */

import type { Asset } from './project'

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export const BRF_VERSION = 1
export const BRF_EXTENSION = '.brf'

export function isBrfPath(path: string): boolean {
  return path.toLowerCase().endsWith(BRF_EXTENSION)
}

/** A number, a percentage of the frame (`"50%"`), or a variable (`"$left"`). */
export type Length = number | string
/** `[time, value]` or `[time, value, easing]`; `time` in seconds from the document's start. */
export type Key<V> = [number, V] | [number, V, Easing]
/** A value held still, or keyed over time. */
export type Animatable<V> = V | Key<V>[]

export type Easing =
  | 'linear'
  | 'hold'
  | 'in'
  | 'out'
  | 'inOut'
  | 'inQuad'
  | 'outQuad'
  | 'inOutQuad'
  | 'inCubic'
  | 'outCubic'
  | 'inOutCubic'
  | 'inExpo'
  | 'outExpo'
  | 'inOutExpo'
  | 'inBack'
  | 'outBack'
  | 'inOutBack'
  | 'outElastic'
  | 'outBounce'
  | 'spring'
  | [number, number, number, number]

export type PresetName =
  | 'fade'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'pop'
  | 'grow'
  | 'wipe'
  | 'blur'
  | 'type'
/** `"up"`, or `["up", duration, delay]` with both in seconds. */
export type Preset = PresetName | [PresetName, number] | [PresetName, number, number]

export interface Shadow {
  color: string
  blur: number
  x?: number
  y?: number
}

interface LayerBase {
  id?: string
  /** `[start, end]` in seconds: when the layer exists. Default: the whole document. */
  t?: [number, number]
  /** Where the layer's anchor sits. Default 0. */
  x?: Animatable<Length>
  y?: Animatable<Length>
  /** Which point of the layer `x`/`y` place, as fractions of its box. Default `[0.5, 0.5]`. */
  anchor?: [number, number]
  /** Degrees, clockwise. */
  rotate?: Animatable<number>
  scale?: Animatable<number>
  sx?: Animatable<number>
  sy?: Animatable<number>
  opacity?: Animatable<number>
  /** Gaussian blur radius in pixels. */
  blur?: Animatable<number>
  shadow?: Shadow
  in?: Preset
  out?: Preset
}

export interface ShapeStyle {
  fill?: Animatable<string>
  stroke?: Animatable<string>
  strokeWidth?: Animatable<Length>
}

export interface RectLayer extends LayerBase, ShapeStyle {
  type: 'rect'
  w: Animatable<Length>
  h: Animatable<Length>
  radius?: Animatable<Length>
}

export interface EllipseLayer extends LayerBase, ShapeStyle {
  type: 'ellipse'
  w: Animatable<Length>
  h: Animatable<Length>
}

export interface PathLayer extends LayerBase, ShapeStyle {
  type: 'path'
  /** SVG path data, in the layer's own pixels with (0, 0) at its anchor. */
  d: string
  /** How much of the stroke is drawn, 0–1 — the "draw on" effect. Default 1. */
  draw?: Animatable<number>
}

export interface TextLayer extends LayerBase {
  type: 'text'
  text: string
  font?: string
  size?: Animatable<Length>
  weight?: number
  italic?: boolean
  fill?: Animatable<string>
  stroke?: Animatable<string>
  strokeWidth?: Animatable<Length>
  align?: 'left' | 'center' | 'right'
  /** Wrap width. Default: no wrapping. */
  w?: Length
  /** Multiple of the font size. Default 1.2. */
  lineHeight?: number
  /** Extra space between letters, in pixels. */
  tracking?: number
  /**
   * Animate the text a piece at a time: the layer's `in` and `out` presets play on each piece,
   * `stagger` seconds apart, entering and leaving in reading order. Keyed properties still
   * move the layer as a whole.
   */
  split?: 'word' | 'char' | 'line'
  stagger?: number
}

export interface GroupLayer extends LayerBase {
  type: 'group'
  /** Box size, for `anchor` and `clip`. Default 0×0: the group's origin is its anchor. */
  w?: Length
  h?: Length
  /** Clip the children to the group's box. */
  clip?: boolean
  layers: Layer[]
}

export type Layer = RectLayer | EllipseLayer | PathLayer | TextLayer | GroupLayer

export interface BrfDocument {
  brf: 1
  /** Seconds. */
  duration: number
  /** The pixel size the document is authored at. Default: whatever box it is drawn into. */
  size?: [number, number]
  background?: string
  /** Named values any string or number may refer to as `"$name"`. Each placement may override them. */
  vars?: Record<string, string | number | boolean>
  layers: Layer[]
}

export type BrfValues = Record<string, string | number | boolean>

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface BrfFault {
  /** Where, as a path into the document: `layers[2].x[1]`. */
  at: string
  message: string
}

export type BrfParse = { ok: true; doc: BrfDocument } | { ok: false; faults: BrfFault[] }

const EASINGS = new Set<string>([
  'linear', 'hold', 'in', 'out', 'inOut', 'inQuad', 'outQuad', 'inOutQuad', 'inCubic',
  'outCubic', 'inOutCubic', 'inExpo', 'outExpo', 'inOutExpo', 'inBack', 'outBack', 'inOutBack',
  'outElastic', 'outBounce', 'spring'
])
const PRESETS = new Set<string>(['fade', 'up', 'down', 'left', 'right', 'pop', 'grow', 'wipe', 'blur', 'type'])
const LAYER_TYPES = ['rect', 'ellipse', 'path', 'text', 'group'] as const

/** Every property each layer type accepts, so a misspelling is named rather than ignored. */
const COMMON = ['type', 'id', 't', 'x', 'y', 'anchor', 'rotate', 'scale', 'sx', 'sy', 'opacity', 'blur', 'shadow', 'in', 'out']
const STYLE = ['fill', 'stroke', 'strokeWidth']
const ALLOWED: Record<Layer['type'], Set<string>> = {
  rect: new Set([...COMMON, ...STYLE, 'w', 'h', 'radius']),
  ellipse: new Set([...COMMON, ...STYLE, 'w', 'h']),
  path: new Set([...COMMON, ...STYLE, 'd', 'draw']),
  text: new Set([...COMMON, ...STYLE, 'text', 'font', 'size', 'weight', 'italic', 'align', 'w', 'lineHeight', 'tracking', 'split', 'stagger']),
  group: new Set([...COMMON, 'w', 'h', 'clip', 'layers'])
}
const NUMERIC = new Set(['rotate', 'scale', 'sx', 'sy', 'opacity', 'blur', 'draw'])
const LENGTH = new Set(['x', 'y', 'w', 'h', 'radius', 'strokeWidth', 'size'])
const COLOR = new Set(['fill', 'stroke'])
/** Lengths that may not be keyed: they size a box that layout depends on. */
const STATIC_LENGTH = new Set(['w'])

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Accept a document or say, for every problem at once, where it is and what to write instead.
 *
 * Every problem, not the first: an agent fixing one fault per round trip spends a turn per
 * typo. And unknown properties are faults, not ignored — a `"opactiy"` that silently does
 * nothing is the costliest kind of mistake, because the picture is merely wrong.
 */
export function parseBrf(input: unknown, options: { allowEmptyLayers?: boolean } = {}): BrfParse {
  const faults: BrfFault[] = []
  const fault = (at: string, message: string): void => {
    faults.push({ at, message })
  }

  let value = input
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch (error) {
      return { ok: false, faults: [{ at: '', message: `not valid JSON: ${(error as Error).message}` }] }
    }
  }
  if (!isObject(value)) {
    return { ok: false, faults: [{ at: '', message: 'a .brf document is a JSON object: {"brf":1,"duration":4,"layers":[…]}' }] }
  }
  const doc = value

  if (doc.brf !== BRF_VERSION) fault('brf', `must be ${BRF_VERSION} (the format version)`)
  const duration = doc.duration
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > 3600) {
    fault('duration', 'must be the length in seconds, a number above 0 (at most 3600)')
  }
  const dur = typeof duration === 'number' && duration > 0 ? duration : Infinity

  if (doc.size !== undefined) {
    const s = doc.size
    if (!Array.isArray(s) || s.length !== 2 || !s.every((n) => typeof n === 'number' && n >= 1 && n <= 8192)) {
      fault('size', 'must be [width, height] in pixels, each 1–8192 — or leave it out to draw at the size of the clip')
    }
  }
  if (doc.background !== undefined && !isColorLike(doc.background)) {
    fault('background', `"${String(doc.background)}" is not a colour: use "#rrggbb", "#rrggbbaa" or "rgba(r,g,b,a)"`)
  }
  const vars: BrfValues = {}
  if (doc.vars !== undefined) {
    if (!isObject(doc.vars)) {
      fault('vars', 'must be an object of names to values: {"accent":"#11D1A0","name":"Ada"}')
    } else {
      for (const [name, v] of Object.entries(doc.vars)) {
        if (!/^[A-Za-z_][\w-]*$/.test(name)) fault(`vars.${name}`, 'a variable name is letters, digits, _ and -, starting with a letter')
        if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
          fault(`vars.${name}`, 'must be a string, a number or a boolean')
        } else vars[name] = v
      }
    }
  }
  for (const key of Object.keys(doc)) {
    if (!['brf', 'duration', 'size', 'background', 'vars', 'layers', 'name'].includes(key)) {
      fault(key, `is not a document property. The document takes brf, duration, size, background, vars and layers${suggest(key, ['brf', 'duration', 'size', 'background', 'vars', 'layers'])}`)
    }
  }
  if (!Array.isArray(doc.layers) || (doc.layers.length === 0 && !options.allowEmptyLayers)) {
    fault('layers', 'must be a non-empty list of layers, drawn first to last (later layers on top)')
  } else {
    doc.layers.forEach((layer, i) => checkLayer(layer, `layers[${i}]`, dur, vars, fault, 0))
  }

  return faults.length > 0 ? { ok: false, faults } : { ok: true, doc: doc as unknown as BrfDocument }
}

function suggest(word: string, candidates: string[]): string {
  const lower = word.toLowerCase()
  const close = candidates.find((c) => {
    const a = c.toLowerCase()
    return a === lower || editDistance(a, lower) <= 2
  })
  return close ? ` — did you mean "${close}"?` : ''
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length]!
}

function checkLayer(
  layer: unknown,
  at: string,
  duration: number,
  vars: BrfValues,
  fault: (at: string, message: string) => void,
  depth: number
): void {
  if (!isObject(layer)) {
    fault(at, 'a layer is an object with a "type"')
    return
  }
  const type = layer.type
  if (typeof type !== 'string' || !(LAYER_TYPES as readonly string[]).includes(type)) {
    fault(`${at}.type`, `must be one of ${LAYER_TYPES.join(', ')}${typeof type === 'string' ? suggest(type, [...LAYER_TYPES]) : ''}`)
    return
  }
  const kind = type as Layer['type']
  const allowed = ALLOWED[kind]
  for (const key of Object.keys(layer)) {
    if (!allowed.has(key)) {
      fault(`${at}.${key}`, `a ${kind} layer has no "${key}"${suggest(key, [...allowed])}`)
    }
  }

  if (layer.t !== undefined) {
    const t = layer.t
    if (!Array.isArray(t) || t.length !== 2 || !t.every((n) => typeof n === 'number' && Number.isFinite(n)) || t[0] >= t[1]) {
      fault(`${at}.t`, 'must be [start, end] in seconds with start before end')
    } else if (t[0] < 0 || t[0] >= duration) {
      fault(`${at}.t`, `starts at ${t[0]}s, outside the document's 0–${duration}s`)
    }
  }
  if (layer.anchor !== undefined) {
    const a = layer.anchor
    if (!Array.isArray(a) || a.length !== 2 || !a.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      fault(`${at}.anchor`, 'must be [ax, ay] as fractions of the layer: [0,0] top-left, [0.5,0.5] centre')
    }
  }
  if (layer.shadow !== undefined) {
    const s = layer.shadow
    if (!isObject(s) || !isColorLike(s.color) || typeof s.blur !== 'number') {
      fault(`${at}.shadow`, 'must be {"color":"#000000aa","blur":20,"x":0,"y":8}')
    }
  }
  for (const key of ['in', 'out'] as const) {
    if (layer[key] !== undefined && !isPreset(layer[key])) {
      fault(
        `${at}.${key}`,
        `must be a preset — ${[...PRESETS].join(', ')} — or [preset, duration, delay] in seconds, e.g. ["up", 0.5, 0.2]`
      )
    }
  }

  for (const [key, value] of Object.entries(layer)) {
    if (NUMERIC.has(key)) checkAnimatable(value, `${at}.${key}`, 'number', duration, vars, fault)
    else if (LENGTH.has(key)) {
      if (STATIC_LENGTH.has(key) && kind === 'text' && Array.isArray(value)) {
        fault(`${at}.${key}`, 'the wrap width of text cannot be keyed; animate scale instead')
      } else checkAnimatable(value, `${at}.${key}`, 'length', duration, vars, fault)
    } else if (COLOR.has(key)) {
      if (key === 'fill' && typeof value === 'string' && /^\s*(linear|radial)\(/i.test(value)) {
        const unknown = [...value.matchAll(/\$([A-Za-z_][\w-]*)/g)].map((m) => m[1]!).filter((name) => !(name in vars))
        if (unknown.length > 0) {
          fault(`${at}.fill`, `refers to ${unknown.map((n) => `$${n}`).join(', ')}, which "vars" does not declare`)
        } else if (!parseGradient(substituteVars(value, vars))) {
          fault(`${at}.fill`, `${JSON.stringify(value)} is not a gradient: "linear(180, #000000cc, #00000000 80%)" or "radial(#ffffff33, #00000000)" — an angle in degrees, then two or more colours, each optionally at a %`)
        }
      } else checkAnimatable(value, `${at}.${key}`, 'color', duration, vars, fault)
    }
  }

  if ((kind === 'rect' || kind === 'ellipse') && (layer.w === undefined || layer.h === undefined)) {
    fault(at, `a ${kind} needs "w" and "h"`)
  }
  if (kind === 'rect' || kind === 'ellipse' || kind === 'path') {
    if (layer.fill === undefined && layer.stroke === undefined) fault(at, `a ${kind} needs a "fill" or a "stroke", or it draws nothing`)
  }
  if (kind === 'path') {
    if (typeof layer.d !== 'string' || !/^\s*[Mm]/.test(layer.d)) fault(`${at}.d`, 'must be SVG path data starting with M, e.g. "M0 0 L100 0"')
  }
  if (kind === 'text') {
    if (typeof layer.text !== 'string') fault(`${at}.text`, 'must be the string to draw ("$name" to use a variable)')
    else if (layer.text.startsWith('$') && !(layer.text.slice(1) in vars)) {
      fault(`${at}.text`, `refers to ${layer.text}, which "vars" does not declare — add it to "vars", or write the text itself`)
    }
    if (layer.align !== undefined && !['left', 'center', 'right'].includes(layer.align as string)) fault(`${at}.align`, 'must be left, center or right')
    if (layer.split !== undefined && !['word', 'char', 'line'].includes(layer.split as string)) fault(`${at}.split`, 'must be word, char or line')
    if (layer.stagger !== undefined && (typeof layer.stagger !== 'number' || layer.stagger < 0)) fault(`${at}.stagger`, 'must be seconds between pieces, 0 or more')
    if (layer.weight !== undefined && (typeof layer.weight !== 'number' || layer.weight < 100 || layer.weight > 1000)) fault(`${at}.weight`, 'must be 100–1000 (400 regular, 700 bold, 900 black)')
    if (layer.font !== undefined && typeof layer.font !== 'string') fault(`${at}.font`, 'must be a font family name')
    if (layer.lineHeight !== undefined && typeof layer.lineHeight !== 'number') fault(`${at}.lineHeight`, 'must be a multiple of the size, e.g. 1.2')
    if (layer.tracking !== undefined && typeof layer.tracking !== 'number') fault(`${at}.tracking`, 'must be pixels between letters')
  }
  if (kind === 'group') {
    if (depth >= 8) {
      fault(at, 'groups nest at most 8 deep')
      return
    }
    if (!Array.isArray(layer.layers) || layer.layers.length === 0) {
      fault(`${at}.layers`, 'a group needs a non-empty "layers" list')
    } else {
      layer.layers.forEach((child, i) => checkLayer(child, `${at}.layers[${i}]`, duration, vars, fault, depth + 1))
    }
  }
}

function isPreset(value: unknown): value is Preset {
  if (typeof value === 'string') return PRESETS.has(value)
  return (
    Array.isArray(value) &&
    (value.length === 2 || value.length === 3) &&
    typeof value[0] === 'string' &&
    PRESETS.has(value[0]) &&
    value.slice(1).every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)
  )
}

function isEasing(value: unknown): value is Easing {
  if (typeof value === 'string') return EASINGS.has(value)
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number' && Number.isFinite(n))
}

function checkAnimatable(
  value: unknown,
  at: string,
  kind: 'number' | 'length' | 'color',
  duration: number,
  vars: BrfValues,
  fault: (at: string, message: string) => void
): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      fault(at, 'an empty key list: give a value, or [[time, value], …]')
      return
    }
    let last = -Infinity
    value.forEach((key, i) => {
      if (!Array.isArray(key) || key.length < 2 || key.length > 3 || typeof key[0] !== 'number') {
        fault(`${at}[${i}]`, 'a key is [time, value] or [time, value, easing], time in seconds')
        return
      }
      if (key[0] < last) fault(`${at}[${i}]`, `keys must be in time order: ${key[0]}s comes after ${last}s`)
      if (key[0] < 0 || key[0] > duration) fault(`${at}[${i}]`, `${key[0]}s is outside the document's 0–${duration}s`)
      last = key[0]
      checkScalar(key[1], `${at}[${i}]`, kind, vars, fault)
      if (key.length === 3 && !isEasing(key[2])) {
        fault(`${at}[${i}]`, `unknown easing ${JSON.stringify(key[2])}: use ${[...EASINGS].join(', ')}, or [x1,y1,x2,y2]`)
      }
    })
    return
  }
  checkScalar(value, at, kind, vars, fault)
}

function checkScalar(
  value: unknown,
  at: string,
  kind: 'number' | 'length' | 'color',
  vars: BrfValues,
  fault: (at: string, message: string) => void
): void {
  if (typeof value === 'string' && value.startsWith('$')) {
    const name = value.slice(1)
    if (!(name in vars)) fault(at, `refers to $${name}, which "vars" does not declare`)
    return
  }
  if (kind === 'color') {
    if (!isColorLike(value)) fault(at, `${JSON.stringify(value)} is not a colour: use "#rrggbb", "#rrggbbaa" or "rgba(r,g,b,a)"`)
    return
  }
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (kind === 'length' && typeof value === 'string' && /^-?\d+(\.\d+)?%$/.test(value)) return
  fault(at, kind === 'length' ? `${JSON.stringify(value)} is not a length: a number of pixels, or "50%" of the frame` : `${JSON.stringify(value)} is not a number`)
}

/** `$name` tokens inside a string (a gradient) replaced by their values. */
function substituteVars(text: string, values: BrfValues): string {
  return text.replace(/\$([A-Za-z_][\w-]*)/g, (whole, name: string) => (name in values ? String(values[name]) : whole))
}

function isColorLike(value: unknown): boolean {
  return typeof value === 'string' && (parseColor(value) !== null || value.startsWith('$'))
}

// ---------------------------------------------------------------------------
// Colour, easing, interpolation
// ---------------------------------------------------------------------------

type RGBA = [number, number, number, number]

export function parseColor(text: string): RGBA | null {
  const s = text.trim()
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s)?.[1]
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex
    const n = (i: number): number => parseInt(full.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1]
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s)
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] === undefined ? 1 : Number(fn[4])]
  if (s === 'transparent') return [0, 0, 0, 0]
  if (s === 'white') return [255, 255, 255, 1]
  if (s === 'black') return [0, 0, 0, 1]
  return null
}

/**
 * A gradient fill: `linear(angle, colour [pos%], colour [pos%], …)` with the angle in degrees as
 * CSS reads it (0 up, 90 right, 180 down), or `radial(colour [pos%], …)` from the centre out.
 * It spans the layer's own box. A fill only, and not keyable — key the layer's opacity instead.
 */
export interface Gradient {
  kind: 'linear' | 'radial'
  angle: number
  stops: { color: string; at: number }[]
}

export function parseGradient(text: string): Gradient | null {
  const m = /^\s*(linear|radial)\((.*)\)\s*$/i.exec(text)
  if (!m) return null
  const kind = m[1]!.toLowerCase() as Gradient['kind']
  // Split on commas that are not inside rgba(…).
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of m[2]!) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else current += ch
  }
  parts.push(current.trim())
  let angle = 180
  if (kind === 'linear' && /^-?\d+(\.\d+)?(deg)?$/.test(parts[0] ?? '')) angle = parseFloat(parts.shift()!)
  if (parts.length < 2) return null
  const stops: Gradient['stops'] = []
  for (const [i, part] of parts.entries()) {
    const sm = /^(.*?)(?:\s+(-?\d+(?:\.\d+)?)%)?$/.exec(part)
    const rgba = sm ? parseColor(sm[1]!) : null
    if (!rgba) return null
    stops.push({ color: formatColor(rgba), at: sm![2] !== undefined ? parseFloat(sm![2]) / 100 : i / (parts.length - 1) })
  }
  return { kind, angle, stops }
}

function formatColor([r, g, b, a]: RGBA): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.round(a * 1000) / 1000})`
}

function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const at = (a: number, b: number, t: number): number => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3
  return (x) => {
    // Bisection on x(t): 24 steps is below a millionth, and it cannot diverge.
    let lo = 0
    let hi = 1
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (at(x1, x2, mid) < x) lo = mid
      else hi = mid
    }
    return at(y1, y2, (lo + hi) / 2)
  }
}

const BACK = 1.70158
const EASE: Record<string, (t: number) => number> = {
  linear: (t) => t,
  hold: (t) => (t >= 1 ? 1 : 0),
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) ** 2,
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inCubic: (t) => t ** 3,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  inExpo: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  outExpo: (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  inOutExpo: (t) => (t === 0 || t === 1 ? t : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2),
  inBack: (t) => (BACK + 1) * t ** 3 - BACK * t * t,
  outBack: (t) => 1 + (BACK + 1) * (t - 1) ** 3 + BACK * (t - 1) ** 2,
  inOutBack: (t) => {
    const c = BACK * 1.525
    return t < 0.5 ? ((2 * t) ** 2 * ((c + 1) * 2 * t - c)) / 2 : ((2 * t - 2) ** 2 * ((c + 1) * (t * 2 - 2) + c) + 2) / 2
  },
  outElastic: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  outBounce: (t) => {
    const n = 7.5625
    const d = 2.75
    if (t < 1 / d) return n * t * t
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375
    return n * (t -= 2.625 / d) * t + 0.984375
  },
  // An underdamped spring settling over the segment: one overshoot of about 5%, then rest.
  spring: (t) => 1 - Math.exp(-6 * t) * Math.cos(7 * t)
}
EASE.in = EASE.inCubic!
EASE.out = EASE.outCubic!
EASE.inOut = EASE.inOutCubic!

const bezierCache = new Map<string, (t: number) => number>()
export function ease(easing: Easing | undefined, t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t
  if (Array.isArray(easing)) {
    const key = easing.join(',')
    let fn = bezierCache.get(key)
    if (!fn) bezierCache.set(key, (fn = cubicBezier(...easing)))
    return fn(x)
  }
  const fn = EASE[easing ?? 'inOut'] ?? EASE.inOut!
  return x >= 1 ? 1 : fn(x)
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** A 2D affine transform, `[a, b, c, d, e, f]` as canvas `setTransform` takes it. */
export type Matrix = [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ]
}

/** One piece of a split text layer, in the state the time puts it in. */
export interface TextPiece {
  alpha: number
  dx: number
  dy: number
  scale: number
  /** 0–1 of this piece's characters shown, for the `type` preset. */
  reveal: number
}

interface OpBase {
  /** Layer → frame transform. The layer's local origin is its box's top-left. */
  matrix: Matrix
  alpha: number
  blur: number
  shadow?: Shadow
  /** Fraction of the box revealed left to right, for the `wipe` preset. 1 = all of it. */
  wipe: number
}

export type DrawOp =
  | (OpBase & { kind: 'rect'; w: number; h: number; radius: number; fill?: string; stroke?: string; strokeWidth: number })
  | (OpBase & { kind: 'ellipse'; w: number; h: number; fill?: string; stroke?: string; strokeWidth: number })
  | (OpBase & { kind: 'path'; d: string; draw: number; fill?: string; stroke?: string; strokeWidth: number })
  | (OpBase & {
      kind: 'text'
      text: string
      font: string
      size: number
      weight: number
      italic: boolean
      fill?: string
      stroke?: string
      strokeWidth: number
      align: 'left' | 'center' | 'right'
      /** Wrap width in pixels, or null. */
      width: number | null
      lineHeight: number
      tracking: number
      split: 'word' | 'char' | 'line' | null
      /** The anchor, as fractions of the laid-out text block. */
      anchor: [number, number]
      /** For a split layer: the state of piece `index` of `count`. Null when not split. */
      piece: ((index: number, count: number) => TextPiece) | null
      /** For an unsplit layer under the `type` preset: fraction of characters shown. */
      reveal: number
    })
  | { kind: 'clip'; matrix: Matrix; w: number; h: number }
  | { kind: 'unclip' }

export const DEFAULT_FONT = '-apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif'

interface Frame {
  width: number
  height: number
  values: BrfValues
}

function resolve(value: unknown, frame: Frame): unknown {
  if (typeof value === 'string' && value.startsWith('$')) return frame.values[value.slice(1)]
  return value
}

function toLength(value: unknown, axis: 'x' | 'y' | 'min', frame: Frame): number {
  const v = resolve(value, frame)
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string' && v.endsWith('%')) {
    const base = axis === 'x' ? frame.width : axis === 'y' ? frame.height : Math.min(frame.width, frame.height)
    return (parseFloat(v) / 100) * base
  }
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** The value of an animatable property at `t`, resolved to a number or colour string. */
function sample(
  value: Animatable<unknown> | undefined,
  t: number,
  fallback: number,
  toNumber: (v: unknown) => number
): number {
  if (value === undefined) return fallback
  if (!Array.isArray(value) || (value.length > 0 && !Array.isArray(value[0]))) return toNumber(value)
  const keys = value as Key<unknown>[]
  const first = keys[0]!
  if (t <= first[0]) return toNumber(first[1])
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!
    if (t <= b[0]) {
      const a = keys[i - 1]!
      const span = b[0] - a[0]
      const p = span <= 0 ? 1 : ease(b[2], (t - a[0]) / span)
      const from = toNumber(a[1])
      return from + (toNumber(b[1]) - from) * p
    }
  }
  return toNumber(keys[keys.length - 1]![1])
}

function sampleColor(value: Animatable<string> | undefined, t: number, frame: Frame): string | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return colorOf(value, frame)
  const keys = value as Key<string>[]
  const rgba = (v: string): RGBA => parseColor(String(resolve(v, frame))) ?? [0, 0, 0, 0]
  const first = keys[0]!
  if (t <= first[0]) return formatColor(rgba(first[1]))
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!
    if (t <= b[0]) {
      const a = keys[i - 1]!
      const span = b[0] - a[0]
      const p = span <= 0 ? 1 : ease(b[2], (t - a[0]) / span)
      const ca = rgba(a[1])
      const cb = rgba(b[1])
      return formatColor(ca.map((c, k) => c + (cb[k]! - c) * p) as RGBA)
    }
  }
  return formatColor(rgba(keys[keys.length - 1]![1]))
}

function colorOf(value: string, frame: Frame): string {
  // A gradient keeps its form for the painter, with any `$var` inside it filled in.
  if (/^\s*(linear|radial)\(/i.test(value)) return substituteVars(value, frame.values)
  const v = String(resolve(value, frame))
  const rgba = parseColor(v)
  return rgba ? formatColor(rgba) : v
}

/** What an entrance or exit preset contributes at a moment: multipliers and offsets. */
interface Motion {
  alpha: number
  dx: number
  dy: number
  scale: number
  blur: number
  wipe: number
  reveal: number
}

const REST: Motion = { alpha: 1, dx: 0, dy: 0, scale: 1, blur: 0, wipe: 1, reveal: 1 }

function presetParts(preset: Preset, defaultDuration: number): { name: PresetName; duration: number; delay: number } {
  if (typeof preset === 'string') return { name: preset, duration: defaultDuration, delay: 0 }
  return { name: preset[0], duration: preset[1] ?? defaultDuration, delay: preset[2] ?? 0 }
}

/** The motion of one preset at progress `p` (0 = away, 1 = at rest). */
function presetMotion(name: PresetName, p: number, distance: number): Motion {
  const e = ease('outCubic', p)
  switch (name) {
    case 'fade':
      return { ...REST, alpha: e }
    case 'up':
      return { ...REST, alpha: e, dy: (1 - e) * distance }
    case 'down':
      return { ...REST, alpha: e, dy: -(1 - e) * distance }
    case 'left':
      return { ...REST, alpha: e, dx: (1 - e) * distance }
    case 'right':
      return { ...REST, alpha: e, dx: -(1 - e) * distance }
    case 'pop':
      return { ...REST, alpha: Math.min(1, p * 3), scale: 0.4 + 0.6 * ease('outBack', p) }
    case 'grow':
      return { ...REST, scale: e }
    case 'wipe':
      return { ...REST, wipe: ease('inOutCubic', p) }
    case 'blur':
      return { ...REST, alpha: e, blur: (1 - e) * 24 }
    case 'type':
      return { ...REST, reveal: p }
  }
}

function combine(a: Motion, b: Motion): Motion {
  return {
    alpha: a.alpha * b.alpha,
    dx: a.dx + b.dx,
    dy: a.dy + b.dy,
    scale: a.scale * b.scale,
    blur: a.blur + b.blur,
    wipe: Math.min(a.wipe, b.wipe),
    reveal: Math.min(a.reveal, b.reveal)
  }
}

function entranceAt(layer: LayerBase, t: number, start: number, distance: number): Motion {
  if (!layer.in) return REST
  const { name, duration, delay } = presetParts(layer.in, 0.5)
  const p = duration <= 0 ? 1 : (t - start - delay) / duration
  return presetMotion(name, Math.max(0, Math.min(1, p)), distance)
}

/** An exit ends `delay` before the layer does, and plays its preset backwards. */
function exitAt(layer: LayerBase, t: number, end: number, distance: number): Motion {
  if (!layer.out) return REST
  const { name, duration, delay } = presetParts(layer.out, 0.4)
  const p = duration <= 0 ? 1 : (end - delay - t) / duration
  return presetMotion(name, Math.max(0, Math.min(1, p)), distance)
}

/** Entrance and exit together, for a layer alive from `start` to `end`, at time `t`. */
function presetsAt(layer: LayerBase, t: number, start: number, end: number, distance: number): Motion {
  return combine(entranceAt(layer, t, start, distance), exitAt(layer, t, end, distance))
}

/**
 * Everything the document draws at `t` seconds, in paint order, for a frame of `width` ×
 * `height` pixels. `values` overrides the document's own `vars` (a placement's settings).
 *
 * Expects a document `parseBrf` accepted; it does not re-validate, and a value it cannot use
 * becomes a neutral one (0, transparent) rather than an exception mid-frame.
 */
export function evaluateBrf(
  doc: BrfDocument,
  t: number,
  width: number,
  height: number,
  values: BrfValues = {}
): DrawOp[] {
  const frame: Frame = { width, height, values: { ...(doc.vars ?? {}), ...values } }
  const ops: DrawOp[] = []
  const time = Math.max(0, Math.min(doc.duration, t))
  for (const layer of doc.layers) emit(layer, time, IDENTITY, 1, 0, doc.duration, frame, ops)
  return ops
}

function emit(
  layer: Layer,
  t: number,
  parent: Matrix,
  parentAlpha: number,
  parentStart: number,
  parentEnd: number,
  frame: Frame,
  ops: DrawOp[]
): void {
  const start = layer.t ? layer.t[0] : parentStart
  const end = layer.t ? layer.t[1] : parentEnd
  if (t < start || t > end) return

  const num = (v: unknown): number => {
    const r = resolve(v, frame)
    return typeof r === 'number' ? r : Number(r) || 0
  }
  const len = (axis: 'x' | 'y' | 'min') => (v: unknown): number => toLength(v, axis, frame)
  const x = sample(layer.x, t, 0, len('x'))
  const y = sample(layer.y, t, 0, len('y'))
  const w = 'w' in layer && layer.w !== undefined ? sample(layer.w as Animatable<Length>, t, 0, len('x')) : 0
  const h = 'h' in layer && layer.h !== undefined ? sample(layer.h as Animatable<Length>, t, 0, len('y')) : 0
  const scale = sample(layer.scale, t, 1, num)
  const sx = sample(layer.sx, t, 1, num) * scale
  const sy = sample(layer.sy, t, 1, num) * scale
  const rotate = (sample(layer.rotate, t, 0, num) * Math.PI) / 180
  const opacity = Math.max(0, Math.min(1, sample(layer.opacity, t, 1, num)))
  const blur = Math.max(0, sample(layer.blur, t, 0, num))
  const [ax, ay] = layer.anchor ?? [0.5, 0.5]
  const distance = Math.min(frame.width, frame.height) * 0.06

  // A split text layer applies its presets per piece, so the layer itself stays at rest.
  const perPiece = layer.type === 'text' && layer.split !== undefined
  const motion = perPiece ? REST : presetsAt(layer, t, start, end, distance)

  // Translate to position (+ preset offset), rotate and scale about the anchor, then move the
  // anchor to the origin so the layer draws from its box's top-left.
  const cos = Math.cos(rotate)
  const sin = Math.sin(rotate)
  const k = motion.scale
  const local: Matrix = multiply(
    [cos * sx * k, sin * sx * k, -sin * sy * k, cos * sy * k, x + motion.dx, y + motion.dy],
    [1, 0, 0, 1, -ax * w, -ay * h]
  )
  const matrix = multiply(parent, local)
  const alpha = parentAlpha * opacity * motion.alpha
  if (alpha <= 0.0005 && layer.type !== 'group') return
  const base = { matrix, alpha, blur: blur + motion.blur, wipe: motion.wipe, ...(layer.shadow ? { shadow: layer.shadow } : {}) }
  const style = (s: ShapeStyle) => ({
    ...(s.fill !== undefined ? { fill: sampleColor(s.fill, t, frame) } : {}),
    ...(s.stroke !== undefined ? { stroke: sampleColor(s.stroke, t, frame) } : {}),
    strokeWidth: sample(s.strokeWidth, t, 0, len('min'))
  })

  switch (layer.type) {
    case 'rect':
      ops.push({ ...base, kind: 'rect', w, h, radius: sample(layer.radius, t, 0, len('min')), ...style(layer) })
      return
    case 'ellipse':
      ops.push({ ...base, kind: 'ellipse', w, h, ...style(layer) })
      return
    case 'path':
      ops.push({ ...base, kind: 'path', d: layer.d, draw: Math.max(0, Math.min(1, sample(layer.draw, t, 1, num))), ...style(layer) })
      return
    case 'text': {
      const text = String(resolve(layer.text, frame) ?? '')
      const stagger = layer.stagger ?? 0.06
      const size = sample(layer.size, t, Math.min(frame.width, frame.height) * 0.05, len('min'))
      ops.push({
        ...base,
        // Text is positioned by its anchor against the laid-out block, which only the painter
        // can measure, so the box offset is undone here and re-applied there.
        matrix: multiply(parent, [cos * sx * k, sin * sx * k, -sin * sy * k, cos * sy * k, x + motion.dx, y + motion.dy]),
        kind: 'text',
        text,
        font: layer.font ?? DEFAULT_FONT,
        size,
        weight: layer.weight ?? 700,
        italic: layer.italic ?? false,
        ...style({ fill: layer.fill ?? '#ffffff', ...(layer.stroke ? { stroke: layer.stroke } : {}), ...(layer.strokeWidth !== undefined ? { strokeWidth: layer.strokeWidth } : {}) }),
        align: layer.align ?? 'center',
        width: layer.w !== undefined ? toLength(layer.w, 'x', frame) : null,
        lineHeight: layer.lineHeight ?? 1.2,
        tracking: layer.tracking ?? 0,
        split: layer.split ?? null,
        anchor: [ax, ay],
        reveal: motion.reveal,
        piece: perPiece
          ? (index: number, count: number): TextPiece => {
              // Piece i enters i staggers late and leaves (count-1-i) staggers early, so the
              // first piece in is the first out and the last is gone as the layer ends.
              const m = combine(
                entranceAt(layer, t - index * stagger, start, distance * 0.6),
                exitAt(layer, t + (count - 1 - index) * stagger, end, distance * 0.6)
              )
              return { alpha: m.alpha, dx: m.dx, dy: m.dy, scale: m.scale, reveal: m.reveal }
            }
          : null
      })
      return
    }
    case 'group': {
      // A `wipe` on a group reveals its box, so it needs `w` and `h`; `blur` on a group is not
      // drawn (canvas cannot blur a group without an extra surface) — blur the children.
      const wiping = motion.wipe < 1 && w > 0 && h > 0
      if (layer.clip) ops.push({ kind: 'clip', matrix, w, h })
      if (wiping) ops.push({ kind: 'clip', matrix, w: w * motion.wipe, h })
      for (const child of layer.layers) emit(child, t, matrix, alpha, start, end, frame, ops)
      if (wiping) ops.push({ kind: 'unclip' })
      if (layer.clip) ops.push({ kind: 'unclip' })
      return
    }
  }
}

// ---------------------------------------------------------------------------
// Variables, for the Inspector and `edit_item`
// ---------------------------------------------------------------------------

/**
 * The document's `vars` in the shape html compositions declare theirs, so a placement's
 * overrides go through the same `item.variables`, Inspector section and `edit_item` argument.
 * The type is read off the default: a `#hex` string is a colour.
 */
export function brfVariableDeclarations(doc: Pick<BrfDocument, 'vars'>): {
  id: string
  type: 'string' | 'number' | 'color' | 'boolean'
  label: string
  default: string | number | boolean
}[] {
  return Object.entries(doc.vars ?? {}).map(([id, value]) => ({
    id,
    type:
      typeof value === 'number'
        ? 'number'
        : typeof value === 'boolean'
          ? 'boolean'
          : parseColor(value) && value.trim().startsWith('#')
            ? 'color'
            : 'string',
    label: id.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    default: value
  }))
}

/**
 * What an asset holding `doc` says about itself: the fields a `.brf` asset derives from its
 * document, in one place so creating one and replacing its document cannot disagree.
 */
export function brfAssetFields(
  doc: BrfDocument
): Pick<Asset, 'kind' | 'brf' | 'durationUs' | 'width' | 'height' | 'fps' | 'hasAudio' | 'hasVideo' | 'compositionVariables'> {
  return {
    kind: 'brf',
    brf: doc,
    durationUs: Math.round(doc.duration * 1_000_000),
    width: doc.size ? doc.size[0] : null,
    height: doc.size ? doc.size[1] : null,
    fps: null,
    hasAudio: false,
    hasVideo: true,
    compositionVariables: brfVariableDeclarations(doc)
  }
}

/** What a `.brf` source module declares about itself, read by rendering its first frame. */
export interface BrfCodeMeta {
  duration: number
  size?: [number, number]
  background?: string
  vars: Record<string, string | number | boolean>
}

/**
 * The fields of an asset holding `.brf` source. The source is what is kept and edited; the rest
 * is derived from it, in one place, so creating one and replacing its source cannot disagree.
 */
export function brfCodeAssetFields(
  source: string,
  meta: BrfCodeMeta
): Pick<Asset, 'kind' | 'brfCode' | 'durationUs' | 'width' | 'height' | 'fps' | 'hasAudio' | 'hasVideo' | 'compositionVariables'> {
  return {
    kind: 'brf',
    brfCode: source,
    durationUs: Math.round(meta.duration * 1_000_000),
    width: meta.size ? meta.size[0] : null,
    height: meta.size ? meta.size[1] : null,
    fps: null,
    hasAudio: false,
    hasVideo: true,
    compositionVariables: brfVariableDeclarations({ vars: meta.vars })
  }
}
