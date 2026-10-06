/**
 * A title's paint stack: several fills, outlines and shadows, a glow, and how its plate is shaped.
 *
 * **Additive over the single colour/outline/shadow/plate.** `TextStyle` keeps `color`, `stroke`,
 * `shadow` and `background` as the stored form of a title that uses only those, so such a title
 * saves exactly as it did before any of this existed. The fields here are optional and extend
 * them: `strokes` wrap outside `stroke`, `shadows` follow `shadow`, `glow` and `plate` add what
 * the single form cannot say. `fills` is the one that replaces — when present it is the whole
 * fill, bottom to top, and `color` draws nowhere (an empty list is a hollow, outline-only title).
 *
 * **One resolver.** `textPaintOf` turns a style into the stack that is drawn; the compositor's
 * painter, the fit report's extents and the inspector all read it, so "what does this style
 * paint" has one answer. A layer with a value that is not a finite number is dropped rather than
 * drawn: one NaN must not remove a title.
 *
 * Also here, because they are the same vocabulary: validating the stack as `edit_item` receives
 * it, and the looks — named styles as data — with the one function that applies one.
 */

import type { TextStyle } from './project'

export interface GradientStop {
  /** 0 at the start of the gradient, 1 at its end. */
  at: number
  color: string
}

interface FillCommon {
  /** 0..1. Absent is 1. */
  opacity?: number
  /** Canvas pixels the fill is moved by: a darker copy under the face is a lifted, extruded look. */
  offsetX?: number
  offsetY?: number
}

export type TextFill =
  | ({ kind: 'solid'; color: string } & FillCommon)
  | ({
      kind: 'linear'
      /** Degrees: 0 runs left to right, 90 top to bottom, across the whole block of text. */
      angle: number
      stops: GradientStop[]
    } & FillCommon)
  | ({
      kind: 'radial'
      stops: GradientStop[]
      /** Centre as a fraction of the block, 0.5 when absent. */
      centerX?: number
      centerY?: number
      /** Radius as a fraction of the block's half-diagonal, 1 when absent. */
      radius?: number
    } & FillCommon)

export type TextJoin = 'round' | 'miter' | 'bevel'

export interface TextStrokeLayer {
  color: string
  /** Canvas pixels this outline adds outside the one before it. */
  width: number
  /** How corners are drawn. Absent is round, as the single outline always was. */
  join?: TextJoin
}

export interface TextShadowLayer {
  color: string
  blur: number
  offsetX: number
  offsetY: number
}

export interface TextGlow {
  color: string
  /** Canvas pixels the halo spreads. */
  blur: number
  /** 1..4: how many times the halo is laid down. Absent is 1; 3 is a neon tube. */
  strength?: number
}

export interface TextPlateOptions {
  /** A bar behind each line, each as wide as its own words, instead of one block. */
  perLine?: boolean
  /** Padding left/right and top/bottom, replacing the plate's single `padding` on that axis. */
  paddingX?: number
  paddingY?: number
}

export const TEXT_JOINS: readonly TextJoin[] = ['round', 'miter', 'bevel']
export const MAX_TEXT_LAYERS = 8
export const MAX_GRADIENT_STOPS = 8

// ---------------------------------------------------------------------------
// The stack that is drawn
// ---------------------------------------------------------------------------

export interface ResolvedStroke {
  color: string
  /** The canvas `lineWidth`: this outline's own width plus every one inside it. */
  lineWidth: number
  join: TextJoin
}

export interface ResolvedPlate {
  color: string
  paddingX: number
  paddingY: number
  radius: number
  perLine: boolean
}

export interface TextPaint {
  plate: ResolvedPlate | null
  /** Back to front: each is cast by the whole silhouette, behind every outline and fill. */
  shadows: TextShadowLayer[]
  /** Outermost first, which is the order they must be drawn in to nest. */
  strokes: ResolvedStroke[]
  /** Bottom to top. Empty is a hollow title. */
  fills: TextFill[]
}

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function usableFill(fill: TextFill): boolean {
  if (!fill || typeof fill !== 'object') return false
  if (fill.kind === 'solid') return typeof fill.color === 'string'
  if (fill.kind !== 'linear' && fill.kind !== 'radial') return false
  if (!Array.isArray(fill.stops) || fill.stops.length < 2) return false
  if (fill.kind === 'linear' && !isNum(fill.angle)) return false
  return fill.stops.every((stop) => stop && isNum(stop.at) && typeof stop.color === 'string')
}

/**
 * What `style` paints, in drawing order. A title with only the single fields resolves to at most
 * one plate, one shadow, one outline and one solid fill — the four things it always drew.
 */
export function textPaintOf(style: TextStyle): TextPaint {
  const background = style.background
  let plate: ResolvedPlate | null = null
  if (background) {
    const padding = Math.max(0, num(background.padding, 0))
    plate = {
      color: background.color,
      paddingX: Math.max(0, num(style.plate?.paddingX, padding)),
      paddingY: Math.max(0, num(style.plate?.paddingY, padding)),
      radius: Math.max(0, num(background.radius, 0)),
      perLine: style.plate?.perLine === true
    }
  }

  const shadows: TextShadowLayer[] = []
  const pushShadow = (shadow: TextShadowLayer | null | undefined): void => {
    if (!shadow || typeof shadow.color !== 'string') return
    if (!isNum(shadow.blur) || !isNum(shadow.offsetX) || !isNum(shadow.offsetY)) return
    shadows.push({ color: shadow.color, blur: Math.max(0, shadow.blur), offsetX: shadow.offsetX, offsetY: shadow.offsetY })
  }
  // The glow sits furthest back, so a drop shadow still reads as a shadow over it.
  const glow = style.glow
  if (glow && typeof glow.color === 'string' && isNum(glow.blur) && glow.blur > 0) {
    const passes = Math.max(1, Math.min(4, Math.round(num(glow.strength, 1))))
    for (let i = 0; i < passes; i += 1) shadows.push({ color: glow.color, blur: glow.blur, offsetX: 0, offsetY: 0 })
  }
  pushShadow(style.shadow)
  for (const shadow of style.shadows ?? []) pushShadow(shadow)

  // Innermost first while the widths accumulate, then reversed: the widest is drawn first.
  const inner: ResolvedStroke[] = []
  let total = 0
  const pushStroke = (stroke: TextStrokeLayer | { color: string; width: number } | null | undefined): void => {
    if (!stroke || typeof stroke.color !== 'string' || !isNum(stroke.width) || stroke.width <= 0) return
    total += stroke.width
    const join = (stroke as TextStrokeLayer).join
    inner.push({ color: stroke.color, lineWidth: total, join: join && TEXT_JOINS.includes(join) ? join : 'round' })
  }
  pushStroke(style.stroke)
  for (const stroke of style.strokes ?? []) pushStroke(stroke)

  const fills: TextFill[] = Array.isArray(style.fills)
    ? style.fills.filter(usableFill)
    : [{ kind: 'solid', color: style.color }]

  return { plate, shadows, strokes: inner.reverse(), fills }
}

/** Whether `style` uses anything beyond the single colour, outline, shadow and plate. */
export function usesTextLayers(style: TextStyle): boolean {
  return (
    style.fills !== undefined ||
    style.strokes !== undefined ||
    style.shadows !== undefined ||
    style.glow !== undefined ||
    style.plate !== undefined
  )
}

export interface Extents {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * How far the paint reaches past the letters themselves on each side, in canvas pixels: half the
 * widest outline, each shadow's blur and offset beyond that, and any offset fill. The plate is not
 * counted — it is measured from the block by `plateRects`.
 *
 * This is what the fit report adds to the block before saying whether a title stays inside its
 * box: an outline is part of the words, and one that crosses the frame edge is cut off there.
 */
export function textExtents(paint: TextPaint): Extents {
  const outline = (paint.strokes[0]?.lineWidth ?? 0) / 2
  const out: Extents = { left: outline, top: outline, right: outline, bottom: outline }
  const reach = (dx: number, dy: number, spread: number): void => {
    out.left = Math.max(out.left, outline + spread - dx)
    out.right = Math.max(out.right, outline + spread + dx)
    out.top = Math.max(out.top, outline + spread - dy)
    out.bottom = Math.max(out.bottom, outline + spread + dy)
  }
  for (const shadow of paint.shadows) reach(shadow.offsetX, shadow.offsetY, shadow.blur)
  for (const fill of paint.fills) reach(num(fill.offsetX, 0), num(fill.offsetY, 0), 0)
  return out
}

// ---------------------------------------------------------------------------
// Validating what edit_item is given
// ---------------------------------------------------------------------------

/** A refusal written for the caller: what was wrong, the legal range, and what to send instead. */
export class TextStyleError extends Error {}

const refuse = (message: string): never => {
  throw new TextStyleError(message)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    refuse(`${path} must be an object, but got ${Array.isArray(value) ? 'an array' : value === null ? 'null' : typeof value}.`)
  }
  return value as Record<string, unknown>
}

function ranged(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return refuse(`${path} must be a number from ${min} to ${max}, but got ${JSON.stringify(value)}.`)
  }
  if (value < min || value > max) return refuse(`${path} must be from ${min} to ${max}, but got ${value}.`)
  return value
}

/** Hex only, upper-cased, so a colour reads back in the form it was written. */
export function hexColour(value: unknown, path: string): string {
  if (typeof value !== 'string') return refuse(`${path} must be a hex colour such as "#FFFFFF", but got ${JSON.stringify(value)}.`)
  const hex = value.trim()
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex)) {
    return refuse(`${path} must be a hex colour such as "#FFFFFF" (or "#FFFFFF80" with alpha), but got "${hex}".`)
  }
  return hex.toUpperCase()
}

function onlyKeys(raw: Record<string, unknown>, path: string, allowed: readonly string[]): void {
  const unknown = Object.keys(raw).find((key) => !allowed.includes(key))
  if (unknown !== undefined) refuse(`${path} has no field "${unknown}". It accepts ${allowed.join(', ')}.`)
}

function list(value: unknown, path: string, example: string): unknown[] {
  if (!Array.isArray(value)) return refuse(`${path} must be a list, such as ${example}, or null to remove it.`)
  if (value.length > MAX_TEXT_LAYERS) {
    return refuse(`${path} has ${value.length} layers; the most is ${MAX_TEXT_LAYERS}. Send the ${MAX_TEXT_LAYERS} that matter.`)
  }
  return value
}

function parseStops(value: unknown, path: string): GradientStop[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_GRADIENT_STOPS) {
    return refuse(
      `${path} must be 2 to ${MAX_GRADIENT_STOPS} stops, such as [{ at: 0, color: "#FFD36E" }, { at: 1, color: "#FF5E7E" }].`
    )
  }
  const stops = value.map((raw, index) => {
    const stop = record(raw, `${path}[${index}]`)
    onlyKeys(stop, `${path}[${index}]`, ['at', 'color'])
    return { at: ranged(stop.at, `${path}[${index}].at`, 0, 1), color: hexColour(stop.color, `${path}[${index}].color`) }
  })
  for (let i = 1; i < stops.length; i += 1) {
    if (stops[i]!.at < stops[i - 1]!.at) {
      refuse(`${path}[${i}].at is ${stops[i]!.at}, before the stop ahead of it (${stops[i - 1]!.at}). List stops from 0 up to 1.`)
    }
  }
  return stops
}

function parseFill(raw: unknown, path: string): TextFill {
  const fill = record(raw, path)
  const common: FillCommon = {}
  if (fill.opacity !== undefined) common.opacity = ranged(fill.opacity, `${path}.opacity`, 0, 1)
  if (fill.offsetX !== undefined) common.offsetX = ranged(fill.offsetX, `${path}.offsetX`, -400, 400)
  if (fill.offsetY !== undefined) common.offsetY = ranged(fill.offsetY, `${path}.offsetY`, -400, 400)
  const shared = ['kind', 'opacity', 'offsetX', 'offsetY']
  if (fill.kind === 'solid') {
    onlyKeys(fill, path, [...shared, 'color'])
    return { kind: 'solid', color: hexColour(fill.color, `${path}.color`), ...common }
  }
  if (fill.kind === 'linear') {
    onlyKeys(fill, path, [...shared, 'angle', 'stops'])
    return {
      kind: 'linear',
      angle: ranged(fill.angle ?? 90, `${path}.angle`, -360, 360),
      stops: parseStops(fill.stops, `${path}.stops`),
      ...common
    }
  }
  if (fill.kind === 'radial') {
    onlyKeys(fill, path, [...shared, 'stops', 'centerX', 'centerY', 'radius'])
    const out: TextFill = { kind: 'radial', stops: parseStops(fill.stops, `${path}.stops`), ...common }
    if (fill.centerX !== undefined) out.centerX = ranged(fill.centerX, `${path}.centerX`, -1, 2)
    if (fill.centerY !== undefined) out.centerY = ranged(fill.centerY, `${path}.centerY`, -1, 2)
    if (fill.radius !== undefined) out.radius = ranged(fill.radius, `${path}.radius`, 0.05, 4)
    return out
  }
  return refuse(
    `${path}.kind must be "solid", "linear" or "radial", but got ${JSON.stringify(fill.kind)}. ` +
      `A solid is { kind: "solid", color }; a gradient is { kind: "linear", angle, stops: [{ at, color }, …] }.`
  )
}

/** The names of the layer fields `edit_item`'s `text` accepts beyond the single ones. */
export const TEXT_LAYER_FIELDS = ['fills', 'strokes', 'shadows', 'glow', 'plate'] as const

/**
 * The layer fields of a `text` patch, checked and applied over `current`. Each field named is
 * **replaced whole** — a stack merged layer by layer would have to guess which layer was meant —
 * and `null` (or an empty `strokes`/`shadows`) removes it, leaving the single field it extends.
 * An empty `fills` is kept: it is how a hollow title is said. Throws {@link TextStyleError}.
 */
export function mergeTextLayers(current: TextStyle, raw: Record<string, unknown>): TextStyle {
  const next: TextStyle = { ...current }
  if (raw.fills !== undefined) {
    if (raw.fills === null) delete next.fills
    else {
      next.fills = list(raw.fills, '"text.fills"', '[{ kind: "solid", color: "#FFFFFF" }]').map((fill, index) =>
        parseFill(fill, `"text.fills"[${index}]`)
      )
    }
  }
  if (raw.strokes !== undefined) {
    const strokes =
      raw.strokes === null
        ? []
        : list(raw.strokes, '"text.strokes"', '[{ color: "#FFFFFF", width: 6 }]').map((rawStroke, index) => {
            const path = `"text.strokes"[${index}]`
            const stroke = record(rawStroke, path)
            onlyKeys(stroke, path, ['color', 'width', 'join'])
            const out: TextStrokeLayer = {
              color: hexColour(stroke.color, `${path}.color`),
              width: ranged(stroke.width, `${path}.width`, 0.5, 100)
            }
            if (stroke.join !== undefined) {
              if (typeof stroke.join !== 'string' || !TEXT_JOINS.includes(stroke.join as TextJoin)) {
                refuse(`${path}.join must be one of ${TEXT_JOINS.join(', ')}, but got ${JSON.stringify(stroke.join)}.`)
              }
              out.join = stroke.join as TextJoin
            }
            return out
          })
    if (strokes.length > 0) next.strokes = strokes
    else delete next.strokes
  }
  if (raw.shadows !== undefined) {
    const shadows =
      raw.shadows === null
        ? []
        : list(raw.shadows, '"text.shadows"', '[{ color: "#000000", blur: 12, offsetX: 0, offsetY: 6 }]').map(
            (rawShadow, index) => {
              const path = `"text.shadows"[${index}]`
              const shadow = record(rawShadow, path)
              onlyKeys(shadow, path, ['color', 'blur', 'offsetX', 'offsetY'])
              return {
                color: hexColour(shadow.color, `${path}.color`),
                blur: ranged(shadow.blur ?? 0, `${path}.blur`, 0, 400),
                offsetX: ranged(shadow.offsetX ?? 0, `${path}.offsetX`, -400, 400),
                offsetY: ranged(shadow.offsetY ?? 0, `${path}.offsetY`, -400, 400)
              }
            }
          )
    if (shadows.length > 0) next.shadows = shadows
    else delete next.shadows
  }
  if (raw.glow !== undefined) {
    if (raw.glow === null) delete next.glow
    else {
      const glow = record(raw.glow, '"text.glow"')
      onlyKeys(glow, '"text.glow"', ['color', 'blur', 'strength'])
      const out: TextGlow = {
        color: hexColour(glow.color, '"text.glow.color"'),
        blur: ranged(glow.blur, '"text.glow.blur"', 1, 400)
      }
      if (glow.strength !== undefined) {
        const strength = ranged(glow.strength, '"text.glow.strength"', 1, 4)
        if (!Number.isInteger(strength)) refuse(`"text.glow.strength" must be a whole number from 1 to 4, but got ${strength}.`)
        if (strength !== 1) out.strength = strength
      }
      next.glow = out
    }
  }
  if (raw.plate !== undefined) {
    if (raw.plate === null) delete next.plate
    else {
      const plate = record(raw.plate, '"text.plate"')
      onlyKeys(plate, '"text.plate"', ['perLine', 'paddingX', 'paddingY'])
      const out: TextPlateOptions = {}
      if (plate.perLine !== undefined) {
        if (typeof plate.perLine !== 'boolean') refuse('"text.plate.perLine" must be true or false.')
        if (plate.perLine) out.perLine = true
      }
      if (plate.paddingX !== undefined) out.paddingX = ranged(plate.paddingX, '"text.plate.paddingX"', 0, 1000)
      if (plate.paddingY !== undefined) out.paddingY = ranged(plate.paddingY, '"text.plate.paddingY"', 0, 1000)
      if (Object.keys(out).length > 0) next.plate = out
      else delete next.plate
      if (next.plate && !next.background) {
        refuse(
          '"text.plate" shapes the plate, and this title has none. Send background too — ' +
            '{ background: { color: "#000000CC", padding: 16, radius: 6 }, plate: { perLine: true } }.'
        )
      }
    }
  }
  return next
}

// ---------------------------------------------------------------------------
// Looks: named styles as data
// ---------------------------------------------------------------------------

/**
 * The paint and weight a look sets. Never a typeface, a size or an alignment: those are the
 * title's own, a look names no font the project may not have, and a caption restyled must stay
 * where and how big it was.
 */
export type LookStyle = Partial<
  Pick<
    TextStyle,
    'fontWeight' | 'italic' | 'color' | 'letterSpacing' | 'stroke' | 'shadow' | 'background' | 'fills' | 'strokes' | 'shadows' | 'glow' | 'plate'
  >
>

export interface TextLook {
  id: string
  name: string
  /** When to reach for it, for the agent and the tooltip. */
  description: string
  /** Lengths are written for {@link LOOK_REFERENCE_SIZE} type and scaled to the title's own size. */
  style: LookStyle
}

/** The type size the looks' pixel lengths are drawn for. */
export const LOOK_REFERENCE_SIZE = 96

export const TEXT_LOOKS: readonly TextLook[] = [
  {
    id: 'title',
    name: 'Title',
    description: 'Heavy white with a long soft shadow. An opener over footage.',
    style: {
      fontWeight: 800,
      color: '#FFFFFF',
      letterSpacing: -1,
      shadow: { color: '#00000099', blur: 28, offsetX: 0, offsetY: 8 }
    }
  },
  {
    id: 'subtitle',
    name: 'Subtitle',
    description: 'Medium weight, off-white, a tight shadow. The line under a title.',
    style: {
      fontWeight: 500,
      color: '#E9ECEF',
      letterSpacing: 0.5,
      shadow: { color: '#000000B3', blur: 8, offsetX: 0, offsetY: 2 }
    }
  },
  {
    id: 'lower-third',
    name: 'Lower-third name',
    description: 'Bold white on a dark rounded plate. A name or a place, low in the frame.',
    style: {
      fontWeight: 700,
      color: '#FFFFFF',
      background: { color: '#10151CE6', padding: 22, radius: 8 },
      plate: { paddingX: 30, paddingY: 12 }
    }
  },
  {
    id: 'caption-bold',
    name: 'Caption bold',
    description: 'White with a thick black outline and a hard drop. Short-form captions over anything.',
    style: {
      fontWeight: 800,
      color: '#FFFFFF',
      stroke: { color: '#000000', width: 12 },
      shadow: { color: '#000000', blur: 0, offsetX: 0, offsetY: 6 }
    }
  },
  {
    id: 'caption-bar',
    name: 'Caption bar',
    description: 'A dark bar behind each line, as wide as its words. Readable captions without an outline.',
    style: {
      fontWeight: 600,
      color: '#FFFFFF',
      background: { color: '#000000CC', padding: 14, radius: 6 },
      plate: { perLine: true, paddingX: 18, paddingY: 4 }
    }
  },
  {
    id: 'highlight',
    name: 'Highlighter',
    description: 'Black type on a yellow bar per line. A word or phrase to be read first.',
    style: {
      fontWeight: 800,
      color: '#111111',
      background: { color: '#FFE600', padding: 10, radius: 2 },
      plate: { perLine: true, paddingX: 16, paddingY: 2 }
    }
  },
  {
    id: 'neon',
    name: 'Neon',
    description: 'A pale tube with a cyan edge and a wide glow. Best on dark footage.',
    style: {
      fontWeight: 600,
      fills: [{ kind: 'solid', color: '#F4FDFF' }],
      stroke: { color: '#39E6FF', width: 3 },
      glow: { color: '#39E6FF', blur: 30, strength: 3 }
    }
  },
  {
    id: 'outline',
    name: 'Outline',
    description: 'Hollow letters: a white line with nothing inside. A big word the footage shows through.',
    style: {
      fontWeight: 800,
      fills: [],
      stroke: { color: '#FFFFFF', width: 4 }
    }
  },
  {
    id: 'double-outline',
    name: 'Double outline',
    description: 'Yellow, a black outline, a white one outside it. Loud and legible: a sticker.',
    style: {
      fontWeight: 800,
      color: '#FFE14A',
      stroke: { color: '#111111', width: 10 },
      strokes: [{ color: '#FFFFFF', width: 8 }],
      shadow: { color: '#00000080', blur: 14, offsetX: 0, offsetY: 8 }
    }
  },
  {
    id: 'gradient',
    name: 'Gradient',
    description: 'A warm-to-violet gradient down the letters with a soft shadow.',
    style: {
      fontWeight: 800,
      fills: [
        {
          kind: 'linear',
          angle: 90,
          stops: [
            { at: 0, color: '#FFD36E' },
            { at: 0.55, color: '#FF5E7E' },
            { at: 1, color: '#7A5CFF' }
          ]
        }
      ],
      shadow: { color: '#00000080', blur: 20, offsetX: 0, offsetY: 6 }
    }
  },
  {
    id: 'chrome',
    name: 'Chrome',
    description: 'A banded steel gradient with a thin dark edge. A logo-like word.',
    style: {
      fontWeight: 800,
      fills: [
        {
          kind: 'linear',
          angle: 90,
          stops: [
            { at: 0, color: '#FFFFFF' },
            { at: 0.45, color: '#B4C0CE' },
            { at: 0.5, color: '#566273' },
            { at: 1, color: '#E6ECF3' }
          ]
        }
      ],
      stroke: { color: '#1B222C', width: 3 },
      shadow: { color: '#00000099', blur: 10, offsetX: 0, offsetY: 5 }
    }
  },
  {
    id: 'lift',
    name: 'Lift',
    description: 'White letters raised off a solid dark copy of themselves. A blocky, printed title.',
    style: {
      fontWeight: 800,
      fills: [
        { kind: 'solid', color: '#0E1116', offsetX: 6, offsetY: 8 },
        { kind: 'solid', color: '#0E1116', offsetX: 3, offsetY: 4 },
        { kind: 'solid', color: '#FFFFFF' }
      ]
    }
  },
  {
    id: 'soft-glow',
    name: 'Soft glow',
    description: 'Cream type in a warm halo. A quiet line over a dim shot.',
    style: {
      fontWeight: 600,
      color: '#FFF3D6',
      glow: { color: '#FFB34799', blur: 36, strength: 2 }
    }
  }
]

export function findTextLook(id: string): TextLook | undefined {
  return TEXT_LOOKS.find((look) => look.id === id)
}

const half = (value: number): number => Math.round(value * 2) / 2

function scaleLook(style: LookStyle, k: number): LookStyle {
  const out: LookStyle = { ...style }
  if (style.letterSpacing !== undefined) out.letterSpacing = half(style.letterSpacing * k)
  if (style.stroke) out.stroke = { ...style.stroke, width: half(style.stroke.width * k) }
  if (style.shadow) {
    out.shadow = {
      ...style.shadow,
      blur: half(style.shadow.blur * k),
      offsetX: half(style.shadow.offsetX * k),
      offsetY: half(style.shadow.offsetY * k)
    }
  }
  if (style.background) {
    out.background = { ...style.background, padding: half(style.background.padding * k), radius: half(style.background.radius * k) }
  }
  if (style.fills) {
    out.fills = style.fills.map((fill) => ({
      ...fill,
      ...(fill.kind !== 'solid' ? { stops: fill.stops.map((stop) => ({ ...stop })) } : {}),
      ...(fill.offsetX !== undefined ? { offsetX: half(fill.offsetX * k) } : {}),
      ...(fill.offsetY !== undefined ? { offsetY: half(fill.offsetY * k) } : {})
    })) as TextFill[]
  }
  if (style.strokes) out.strokes = style.strokes.map((stroke) => ({ ...stroke, width: Math.max(0.5, half(stroke.width * k)) }))
  if (style.shadows) {
    out.shadows = style.shadows.map((shadow) => ({
      ...shadow,
      blur: half(shadow.blur * k),
      offsetX: half(shadow.offsetX * k),
      offsetY: half(shadow.offsetY * k)
    }))
  }
  if (style.glow) out.glow = { ...style.glow, blur: Math.max(1, half(style.glow.blur * k)) }
  if (style.plate) {
    out.plate = {
      ...style.plate,
      ...(style.plate.paddingX !== undefined ? { paddingX: half(style.plate.paddingX * k) } : {}),
      ...(style.plate.paddingY !== undefined ? { paddingY: half(style.plate.paddingY * k) } : {})
    }
  }
  return out
}

/** The paint fields a look owns, so applying one removes whatever the last one set. */
function withoutPaint(style: TextStyle): TextStyle {
  const { fills: _f, strokes: _s, shadows: _sh, glow: _g, plate: _p, ...rest } = style
  return { ...rest, stroke: null, shadow: null, background: null }
}

/**
 * `style` wearing `look`: its paint and weight replaced, its typeface, size, alignment and line
 * height kept, and the look's lengths scaled to this title's size — a 12 px outline drawn for
 * 96 px type is 6 px on a 48 px caption.
 */
export function applyTextLook(style: TextStyle, look: TextLook): TextStyle {
  const k = style.fontSize > 0 && Number.isFinite(style.fontSize) ? style.fontSize / LOOK_REFERENCE_SIZE : 1
  return { ...withoutPaint(style), italic: false, letterSpacing: 0, ...scaleLook(look.style, k) }
}

/**
 * `target` wearing `source`'s whole look — paint, weight, slant and tracking, and (unlike a named
 * look) its typeface, since both titles are in one project — while keeping its own size,
 * alignment and line height. Lengths scale with size, as a named look's do.
 */
export function copyTextLook(target: TextStyle, source: TextStyle): TextStyle {
  const k = source.fontSize > 0 && target.fontSize > 0 ? target.fontSize / source.fontSize : 1
  const { fontFamily, fontWeight, italic, color, letterSpacing, stroke, shadow, background, fills, strokes, shadows, glow, plate } = source
  const paint: LookStyle = { fontWeight, italic, color, letterSpacing, stroke, shadow, background }
  if (fills) paint.fills = fills
  if (strokes) paint.strokes = strokes
  if (shadows) paint.shadows = shadows
  if (glow) paint.glow = glow
  if (plate) paint.plate = plate
  return { ...withoutPaint(target), fontFamily, ...scaleLook(paint, k) }
}

/** The look `style` is wearing, if it is exactly one of them at its size. */
export function activeTextLook(style: TextStyle): TextLook | undefined {
  const key = JSON.stringify(style)
  return TEXT_LOOKS.find((look) => JSON.stringify(applyTextLook(style, look)) === key)
}
