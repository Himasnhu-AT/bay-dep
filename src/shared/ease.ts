/**
 * Eases: the curve a value travels along between two moments — a keyframe segment
 * (`Keyframe.ease`) or a transition's progress (`Transition.ease`). One sampler for both, so a
 * custom curve drawn in the ease editor means the same thing wherever it is used, in the preview
 * and in the export.
 *
 * Its own module rather than part of `keyframes.ts` because `project.ts` samples a transition's
 * ease, and `keyframes.ts` imports values from `project.ts`: the two importing each other would
 * leave whichever loads second reading the other's exports before they exist.
 */

import type { KeyframeEase } from './project'

/** CSS's named curves, so an `inOut` here is the `ease-in-out` a designer already knows. */
export const NAMED_EASES = {
  in: [0.42, 0, 1, 1],
  out: [0, 0, 0.58, 1],
  inOut: [0.42, 0, 0.58, 1]
} as const

export const EASE_NAMES = ['linear', 'hold', 'in', 'out', 'inOut'] as const

/**
 * `y` of a CSS cubic-bezier at horizontal position `x`. Newton's method from `x`, falling back to
 * bisection when the slope flattens — the same approach browsers use, to well under a thousandth
 * of a frame's value.
 */
export function cubicBezierAt(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t
  const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx

  let t = x
  for (let i = 0; i < 8; i += 1) {
    const error = sampleX(t) - x
    if (Math.abs(error) < 1e-7) return sampleY(t)
    const slope = slopeX(t)
    if (Math.abs(slope) < 1e-6) break
    t -= error / slope
  }
  let lo = 0
  let hi = 1
  t = x
  for (let i = 0; i < 60; i += 1) {
    const value = sampleX(t)
    if (Math.abs(value - x) < 1e-7) break
    if (value < x) lo = t
    else hi = t
    t = (lo + hi) / 2
  }
  return sampleY(t)
}

/** How far along a segment the value is at progress `t` (0..1) under `ease`. */
export function easeProgress(ease: KeyframeEase | undefined, t: number): number {
  const p = t <= 0 ? 0 : t >= 1 ? 1 : t
  if (ease === undefined || ease === 'linear') return p
  if (ease === 'hold') return p >= 1 ? 1 : 0
  const curve = Array.isArray(ease) ? ease : NAMED_EASES[ease]
  if (!curve) return p
  return cubicBezierAt(curve[0], curve[1], curve[2], curve[3], p)
}

function describeEase(ease: unknown): string {
  return JSON.stringify(ease)
}

/**
 * An ease as a tool argument gives it: a name, a cubic-bezier tuple, or nothing. `linear` reads as
 * absent (it is the default, and absence is how it is stored). `what` names the segment in the
 * refusal — "from this key to the next", "across the cut".
 */
export function parseEase(
  raw: unknown,
  where: string,
  what = 'the segment from this key to the next'
): KeyframeEase | undefined | { error: string } {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'string' && (EASE_NAMES as readonly string[]).includes(raw)) {
    return raw === 'linear' ? undefined : (raw as KeyframeEase)
  }
  if (
    Array.isArray(raw) &&
    raw.length === 4 &&
    raw.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    const [x1, , x2] = raw as number[]
    if (x1! < 0 || x1! > 1 || x2! < 0 || x2! > 1) {
      return {
        error:
          `${where}.ease ${describeEase(raw)} is a cubic-bezier whose x1 and x2 must be within 0..1 ` +
          `(time cannot run backwards); y1 and y2 may overshoot. Try [0.25, 0.1, 0.25, 1].`
      }
    }
    return raw as [number, number, number, number]
  }
  return {
    error:
      `${where}.ease is ${describeEase(raw)}. Use one of ${EASE_NAMES.map((n) => `"${n}"`).join(', ')}, ` +
      `or a cubic-bezier tuple [x1, y1, x2, y2] such as [0.25, 0.1, 0.25, 1]. The ease shapes ` +
      `${what}.`
  }
}
