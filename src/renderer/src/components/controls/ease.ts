import type { KeyframeEase } from '@shared/project'
import { easeProgress, NAMED_EASES } from '@shared/ease'
import { roundTo } from './values'

export type Bezier = [number, number, number, number]

/** The presets, in the order an editor lists them. */
export const EASE_PRESETS: { value: 'linear' | 'in' | 'out' | 'inOut' | 'hold'; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'in', label: 'Ease in' },
  { value: 'out', label: 'Ease out' },
  { value: 'inOut', label: 'Ease in and out' },
  { value: 'hold', label: 'Hold' }
]

/** Where a handle may be dragged: x is time and cannot run backwards; y may overshoot by one. */
export const HANDLE_Y = { min: -1, max: 2 } as const
/**
 * A transition's handles stay inside 0…1: its progress runs from the outgoing clip to the
 * incoming, and a curve past either end would only be clamped there (`add_transition` refuses one).
 */
export const HANDLE_Y_UNIT = { min: 0, max: 1 } as const

export type HandleRange = { readonly min: number; readonly max: number }
/** The step Shift snaps a handle to while dragging. */
export const HANDLE_SNAP = 0.05

/** The two handles an ease draws with. Linear is the diagonal; a name is CSS's curve; hold has none. */
export function bezierOf(ease: KeyframeEase | undefined): Bezier | null {
  if (ease === undefined || ease === 'linear') return [0, 0, 1, 1]
  if (ease === 'hold') return null
  if (Array.isArray(ease)) return [ease[0], ease[1], ease[2], ease[3]]
  const named = NAMED_EASES[ease as keyof typeof NAMED_EASES]
  return named ? [named[0], named[1], named[2], named[3]] : [0, 0, 1, 1]
}

/**
 * The ease a curve is: a preset's name when the handles are exactly a preset's (so dragging back to
 * CSS's `ease-in` stores `'in'`, and the diagonal stores nothing — linear is absence), else the
 * tuple. Handles are held to their range and rounded to three places first.
 */
export function easeFromBezier(bezier: Bezier, range: HandleRange = HANDLE_Y): KeyframeEase {
  const x1 = roundTo(Math.max(0, Math.min(1, bezier[0])), 3)
  const x2 = roundTo(Math.max(0, Math.min(1, bezier[2])), 3)
  const y1 = roundTo(Math.max(range.min, Math.min(range.max, bezier[1])), 3)
  const y2 = roundTo(Math.max(range.min, Math.min(range.max, bezier[3])), 3)
  const tuple: Bezier = [x1, y1, x2, y2]
  const same = (other: readonly number[]): boolean => other.every((n, i) => Math.abs(n - tuple[i]!) < 1e-9)
  // The diagonal — both handles on it — is linear, however far along it they sit.
  if (Math.abs(x1 - y1) < 1e-9 && Math.abs(x2 - y2) < 1e-9) return 'linear'
  for (const name of ['in', 'out', 'inOut'] as const) if (same(NAMED_EASES[name])) return name
  return tuple
}

/** Snaps a handle coordinate to `HANDLE_SNAP` (Shift while dragging). */
export function snapHandle(value: number): number {
  return roundTo(Math.round(value / HANDLE_SNAP) * HANDLE_SNAP, 2)
}

/** The preset a stored ease is, or `'custom'` for a hand-made curve that matches none. */
export function presetOf(ease: KeyframeEase | undefined): (typeof EASE_PRESETS)[number]['value'] | 'custom' {
  if (ease === undefined) return 'linear'
  if (!Array.isArray(ease)) return ease as (typeof EASE_PRESETS)[number]['value']
  const named = easeFromBezier(ease as Bezier)
  return Array.isArray(named) ? 'custom' : (named as (typeof EASE_PRESETS)[number]['value'])
}

/** `cubic-bezier(0.42, 0, 0.58, 1)` — how a curve is written in CSS, for the readout. */
export function describeBezier(ease: KeyframeEase | undefined): string {
  if (ease === 'hold') return 'Hold: jumps at the end'
  const b = bezierOf(ease) ?? [0, 0, 1, 1]
  return `cubic-bezier(${b.map((n) => roundTo(n, 2)).join(', ')})`
}

/**
 * The curve as an SVG path in a `width`×`height` box whose vertical range is `yMin`…`yMax` in
 * progress — drawn by sampling the very sampler the compositor and the audio use (`easeProgress`),
 * so what the editor shows is what plays.
 */
export function curvePath(
  ease: KeyframeEase | undefined,
  width: number,
  height: number,
  yMin = 0,
  yMax = 1,
  samples = 48
): string {
  const toY = (v: number): number => height - ((v - yMin) / (yMax - yMin)) * height
  const points: string[] = []
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples
    // Hold jumps at the very end; sampling up to (not at) 1 shows the flat run, then the jump.
    const v = ease === 'hold' ? (i === samples ? 1 : 0) : easeProgress(ease, t)
    points.push(`${roundTo(t * width, 2)},${roundTo(toY(v), 2)}`)
  }
  if (ease === 'hold') points.splice(points.length - 1, 0, `${width},${roundTo(toY(0), 2)}`)
  return `M ${points.join(' L ')}`
}
