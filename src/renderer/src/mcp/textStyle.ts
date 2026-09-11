/**
 * Validating and merging the `text` argument of `edit_item`.
 *
 * The dispatcher's schema validator deliberately understands only the keywords the catalog
 * uses, and `TextStyle` is the one argument with a nested shape — so its checking lives
 * here, where it can say things the schema could not. "fontWeight must be a multiple of 100
 * between 100 and 900" is a sentence an agent can act on; a schema violation on an object
 * it cannot see inside is not.
 *
 * **Merge semantics, chosen to be unambiguous rather than clever.** Top-level fields merge,
 * so setting a colour leaves the size alone. The three effect groups — `stroke`, `shadow`,
 * `background` — replace wholesale, or `null` to switch off. A partial `stroke` merged into
 * an absent one would have to invent a width, and an agent reading back a value it did not
 * set is how a style drifts from what was asked for.
 */

import { defaultTextStyle, type TextStyle } from '@shared/project'
import { fail } from './helpers'

const ALIGN = ['left', 'center', 'right'] as const
const VERTICAL = ['top', 'middle', 'bottom'] as const

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} must be an object, but got ${Array.isArray(value) ? 'array' : typeof value}.`)
  }
  return value as Record<string, unknown>
}

function number(value: unknown, path: string, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    fail(`${path} must be a number, but got ${JSON.stringify(value)}.`)
  }
  if (parsed < min || parsed > max) {
    fail(`${path} must be between ${min} and ${max}, but got ${parsed}.`)
  }
  return parsed
}

/**
 * Colours are CSS strings, but only the hex forms are accepted.
 *
 * A name or an `rgb()` would render — the canvas takes anything CSS takes — and then read
 * back in a different form than it was written, which an agent comparing what it set
 * against what it reads would treat as a failed write.
 */
function colour(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(`${path} must be a colour string, but got ${typeof value}.`)
  const hex = value.trim()
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex)) {
    fail(`${path} must be a hex colour such as "#FFFFFF", but got "${hex}".`)
  }
  return hex.toUpperCase()
}

function choice<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(`${path} must be one of ${allowed.map((a) => `"${a}"`).join(', ')}, but got ${JSON.stringify(value)}.`)
  }
  return value as T
}

/** One of the three effect groups: a complete object, or null to turn it off. */
function group<T>(
  value: unknown,
  path: string,
  build: (raw: Record<string, unknown>) => T
): T | null {
  if (value === null) return null
  const raw = asRecord(value, path)
  return build(raw)
}

/**
 * Merges `patch` onto `current`, validating as it goes. Returns the complete style to
 * store — `patchItem` assigns the whole `text` field, so a partial would drop the rest.
 */
export function mergeTextStyle(current: TextStyle | undefined, patch: unknown): TextStyle {
  const base = current ?? defaultTextStyle()
  const raw = asRecord(patch, '"text"')

  const known = [
    'fontFamily', 'fontSize', 'fontWeight', 'italic', 'color', 'align', 'verticalAlign',
    'lineHeight', 'letterSpacing', 'stroke', 'shadow', 'background'
  ]
  for (const key of Object.keys(raw)) {
    if (!known.includes(key)) {
      fail(`"text" has no field "${key}". It accepts ${known.map((k) => `"${k}"`).join(', ')}.`)
    }
  }

  const next: TextStyle = { ...base }

  if (raw.fontFamily !== undefined) {
    if (typeof raw.fontFamily !== 'string' || raw.fontFamily.trim() === '') {
      fail('"text.fontFamily" must be a non-empty font stack, such as "Georgia, serif".')
    }
    next.fontFamily = raw.fontFamily
  }
  if (raw.fontSize !== undefined) next.fontSize = number(raw.fontSize, '"text.fontSize"', 1, 2000)
  if (raw.fontWeight !== undefined) {
    const weight = number(raw.fontWeight, '"text.fontWeight"', 100, 900)
    if (weight % 100 !== 0) {
      fail(`"text.fontWeight" must be a multiple of 100 between 100 and 900, but got ${weight}.`)
    }
    next.fontWeight = weight
  }
  if (raw.italic !== undefined) {
    if (typeof raw.italic !== 'boolean') fail('"text.italic" must be true or false.')
    next.italic = raw.italic
  }
  if (raw.color !== undefined) next.color = colour(raw.color, '"text.color"')
  if (raw.align !== undefined) next.align = choice(raw.align, '"text.align"', ALIGN)
  if (raw.verticalAlign !== undefined) {
    next.verticalAlign = choice(raw.verticalAlign, '"text.verticalAlign"', VERTICAL)
  }
  if (raw.lineHeight !== undefined) {
    next.lineHeight = number(raw.lineHeight, '"text.lineHeight"', 0.5, 4)
  }
  if (raw.letterSpacing !== undefined) {
    next.letterSpacing = number(raw.letterSpacing, '"text.letterSpacing"', -100, 100)
  }

  if (raw.stroke !== undefined) {
    next.stroke = group(raw.stroke, '"text.stroke"', (s) => ({
      color: colour(s.color, '"text.stroke.color"'),
      width: number(s.width, '"text.stroke.width"', 0, 100)
    }))
  }
  if (raw.shadow !== undefined) {
    next.shadow = group(raw.shadow, '"text.shadow"', (s) => ({
      color: colour(s.color, '"text.shadow.color"'),
      blur: number(s.blur, '"text.shadow.blur"', 0, 400),
      offsetX: number(s.offsetX ?? 0, '"text.shadow.offsetX"', -400, 400),
      offsetY: number(s.offsetY ?? 0, '"text.shadow.offsetY"', -400, 400)
    }))
  }
  if (raw.background !== undefined) {
    next.background = group(raw.background, '"text.background"', (b) => ({
      color: colour(b.color, '"text.background.color"'),
      padding: number(b.padding ?? 0, '"text.background.padding"', 0, 1000),
      radius: number(b.radius ?? 0, '"text.background.radius"', 0, 1000)
    }))
  }

  return next
}
