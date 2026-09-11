/**
 * Turning an item's adjustments and blend mode into the two canvas properties that apply them.
 *
 * Pure, because it is string assembly and a default check, and both are places to be wrong
 * without a canvas noticing: a filter chain in the wrong order gives a different picture, and
 * emitting a chain at all when every value is the identity costs a filter pass per frame for
 * no visual difference.
 *
 * Deliberately **not** validating ranges. The model and the MCP schema decide what a legal
 * saturation is; clamping again here would put the rule in two places and let them disagree.
 * What this does guarantee is that a nonsense number cannot reach the context — a `NaN` in a
 * filter string makes Chromium ignore the *whole* chain silently, so one bad field would
 * remove every adjustment on the item rather than its own.
 */

import { defaultAdjustments, type Adjustments, type BlendMode } from '@shared/project'

/** The identity, as the canvas spells it. */
export const NO_FILTER = 'none'

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

/**
 * Is this value the identity, to within a tolerance?
 *
 * A strict `!==` looks right and is a performance bug: a slider that lands on `1.0000001`, or a
 * value that has been through a JSON round trip, emits `brightness(1.0000001)` and puts the clip
 * on the filtered draw path for an image nobody can distinguish from the unfiltered one. That
 * path costs roughly twice as much at 4K. The epsilon is inherited from the shared builder that
 * used to duplicate this function and has now been deleted in its favour.
 */
function isIdentity(value: number, identity: number): boolean {
  return Math.abs(value - identity) < 1e-6
}

/**
 * The `ctx.filter` string for these adjustments, or `'none'` when they are the identity.
 *
 * Order is fixed and matters: filters compose left to right, so blurring before a brightness
 * change is a different picture from blurring after it. This order — colour first, blur last —
 * matches what every NLE's adjustment stack does, and more usefully it means blur operates on
 * the final colour rather than on colours that are about to change.
 *
 * `'none'` for the identity is not a micro-optimisation. Asking for `brightness(1)` still puts
 * the draw on the filtered path, which was measured at roughly 2x the cost of an unfiltered
 * one at 4K — so an item with default adjustments must produce no filter at all, or every clip
 * in every project pays for a feature it is not using.
 */
export function adjustmentFilter(adjustments: Adjustments | undefined): string {
  if (!adjustments) return NO_FILTER
  const d = defaultAdjustments()
  const parts: string[] = []

  const brightness = finite(adjustments.brightness, d.brightness)
  const contrast = finite(adjustments.contrast, d.contrast)
  const saturate = finite(adjustments.saturate, d.saturate)
  const hueRotate = finite(adjustments.hueRotate, d.hueRotate)
  const grayscale = finite(adjustments.grayscale, d.grayscale)
  const sepia = finite(adjustments.sepia, d.sepia)
  const invert = finite(adjustments.invert, d.invert)
  const blur = finite(adjustments.blur, d.blur)

  if (!isIdentity(brightness, d.brightness)) parts.push(`brightness(${brightness})`)
  if (!isIdentity(contrast, d.contrast)) parts.push(`contrast(${contrast})`)
  if (!isIdentity(saturate, d.saturate)) parts.push(`saturate(${saturate})`)
  if (!isIdentity(hueRotate, d.hueRotate)) parts.push(`hue-rotate(${hueRotate}deg)`)
  if (!isIdentity(grayscale, d.grayscale)) parts.push(`grayscale(${grayscale})`)
  if (!isIdentity(sepia, d.sepia)) parts.push(`sepia(${sepia})`)
  if (!isIdentity(invert, d.invert)) parts.push(`invert(${invert})`)
  // Last, so it blurs the corrected colour rather than colour about to be corrected.
  if (!isIdentity(blur, d.blur)) parts.push(`blur(${blur}px)`)

  return parts.length === 0 ? NO_FILTER : parts.join(' ')
}

/**
 * The `globalCompositeOperation` for a blend mode.
 *
 * `'normal'` maps to `'source-over'` — the canvas default — and an absent mode maps there too,
 * so an item that has never been given one behaves exactly as it did before blend modes
 * existed. The `BlendMode` union is deliberately the fifteen blend modes rather than the whole
 * `GlobalCompositeOperation` type, so every value here is a legal operation by construction and
 * there is nothing to validate.
 */
export function blendOperation(mode: BlendMode | undefined): GlobalCompositeOperation {
  if (!mode || mode === 'normal') return 'source-over'
  return mode
}

/** True when this item needs neither a filter nor a non-default blend — the common case. */
export function isPlainLook(filter: string, operation: GlobalCompositeOperation): boolean {
  return filter === NO_FILTER && operation === 'source-over'
}
