/**
 * The motion library's ground floor: progress, curves, springs, a seeded generator and a spline.
 *
 * Everything in `src/shared/motion/` is a pure function of time that returns plain numbers. No
 * state is kept between calls and nothing reads a clock or `Math.random`, so a frame can be asked
 * for in any order and twice gives the same picture — which is what seeking, export and sub-frame
 * motion blur all rest on. Times are seconds; `t` is the film's time and `tau` is time since a
 * move began.
 *
 * The folder is also emitted, unchanged, as one classic script (`bay-motion.js`, global `BM`) for
 * HTML compositions — see `../motion-bundle.ts`. So nothing here may import outside `src/shared`,
 * and nothing may use a runtime TypeScript feature (enums, parameter properties).
 */

import { cubicBezierAt } from '../ease'

/** The frame a move is laid out on, in pixels. */
export interface Frame {
  w: number
  h: number
}

/** bay's default composition size. Every move that needs the frame takes `{ frame }` to override it. */
export const FRAME: Frame = { w: 1920, h: 1080 }

export type Point = [number, number]

export function clamp(value: number, lo = 0, hi = 1): number {
  return value < lo ? lo : value > hi ? hi : value
}

/** `a` at 0 and `b` at 1 — exactly, which `a + (b - a) * p` is not at 1. */
export function lerp(a: number, b: number, p: number): number {
  return a * (1 - p) + b * p
}

/** How far `t` is through `[t0, t1]`, 0..1. A span of no length is a step at `t0`. */
export function progress(t: number, t0: number, t1: number): number {
  if (!(t1 > t0)) return t >= t0 ? 1 : 0
  return clamp((t - t0) / (t1 - t0))
}

/** Smoothstep: zero slope at both ends. */
export function smooth(p: number): number {
  const x = clamp(p)
  return x * x * (3 - 2 * x)
}

/** Smootherstep: zero slope and zero acceleration at both ends. */
export function smoother(p: number): number {
  const x = clamp(p)
  return x * x * x * (x * (x * 6 - 15) + 10)
}

/** A generator of numbers in [0, 1) from a seed: the same seed, the same sequence, on every machine. */
export function rng(seed: number): () => number {
  let a = Math.floor(seed) | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let x = Math.imul(a ^ (a >>> 15), 1 | a)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

/** A CSS `cubic-bezier(x1, y1, x2, y2)` as a function of progress. */
export function bezier(x1: number, y1: number, x2: number, y2: number): (p: number) => number {
  return (p) => cubicBezierAt(x1, y1, x2, y2, p)
}

const expoOut = (p: number): number => (p >= 1 ? 1 : 1 - 2 ** (-10 * p))
const expoIn = (p: number): number => (p <= 0 ? 0 : 2 ** (10 * p - 10))
const BACK = 1.70158

/**
 * The named curves. Each maps progress 0..1 to distance 0..1 and is exact at both ends.
 * `EASE_T80` says how snappy each one is; pick by that number, not by the name.
 */
export const EASES = {
  linear: (p: number): number => clamp(p),
  smooth,
  smoother,
  sineInOut: (p: number): number => (1 - Math.cos(Math.PI * clamp(p))) / 2,
  quadOut: (p: number): number => 1 - (1 - clamp(p)) ** 2,
  cubicIn: (p: number): number => clamp(p) ** 3,
  cubicOut: (p: number): number => 1 - (1 - clamp(p)) ** 3,
  cubicInOut: (p: number): number => {
    const x = clamp(p)
    return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
  },
  quartOut: (p: number): number => 1 - (1 - clamp(p)) ** 4,
  quintIn: (p: number): number => clamp(p) ** 5,
  quintOut: (p: number): number => 1 - (1 - clamp(p)) ** 5,
  quintInOut: (p: number): number => {
    const x = clamp(p)
    return x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2
  },
  expoIn: (p: number): number => expoIn(clamp(p)),
  expoOut: (p: number): number => expoOut(clamp(p)),
  expoInOut: (p: number): number => {
    const x = clamp(p)
    return x < 0.5 ? expoIn(2 * x) / 2 : (1 + expoOut(2 * x - 1)) / 2
  },
  /** Overshoots by about 10% before settling. */
  backOut: (p: number): number => {
    if (p <= 0) return 0
    const x = clamp(p) - 1
    return 1 + (BACK + 1) * x * x * x + BACK * x * x
  }
}

export type EaseName = keyof typeof EASES

/**
 * t80: the fraction of a curve's duration at which it has first covered 80% of the distance.
 * Small is snappy (the move is mostly over early and the rest is settling); 0.8 is linear. A
 * film that reads as slides is usually sitting at 0.6 and above on every move.
 *
 * Measured, not chosen: `core.test.ts` re-measures every curve and fails if a number here drifts.
 */
export const EASE_T80: Record<EaseName, number> = {
  linear: 0.8,
  smooth: 0.7129,
  smoother: 0.6734,
  sineInOut: 0.7048,
  quadOut: 0.5528,
  cubicIn: 0.9283,
  cubicOut: 0.4152,
  cubicInOut: 0.6316,
  quartOut: 0.3313,
  quintIn: 0.9564,
  quintOut: 0.2752,
  quintInOut: 0.5837,
  expoIn: 0.9678,
  expoOut: 0.2322,
  expoInOut: 0.5661,
  backOut: 0.2415
}

/** A curve by name, as four bezier control numbers, or already a function. */
export type Curve = EaseName | readonly [number, number, number, number] | ((p: number) => number)

export function easeOf(curve: Curve): (p: number) => number {
  if (typeof curve === 'function') return curve
  if (typeof curve === 'string') {
    const named = EASES[curve]
    if (!named) throw new Error(`"${curve}" is not a curve. The names are: ${Object.keys(EASES).join(', ')}.`)
    return named
  }
  return bezier(curve[0], curve[1], curve[2], curve[3])
}

/** Where a curve first reaches `fraction` of its distance, as a fraction of its duration. */
export function easeTime(curve: Curve, fraction = 0.8): number {
  const f = easeOf(curve)
  const steps = 4000
  for (let i = 1; i <= steps; i++) {
    if (f(i / steps) >= fraction) {
      // Refine inside the step that crossed.
      let lo = (i - 1) / steps
      let hi = i / steps
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2
        if (f(mid) >= fraction) hi = mid
        else lo = mid
      }
      return hi
    }
  }
  return 1
}

export interface SpringOptions {
  /** Damping ratio ζ. Below 1 it overshoots and rings; 1 is the fastest approach with no overshoot. */
  damping?: number
  /** Undamped angular frequency ω, radians per second. Higher is quicker. */
  frequency?: number
}

/**
 * A unit spring released at `tau = 0`: 0 at and before the start, 1 once settled. The closed-form
 * solution of x″ + 2ζω x′ + ω² x = ω², so it does not depend on the frame rate or on having been
 * asked for earlier frames.
 */
export function spring(tau: number, options: SpringOptions = {}): number {
  if (!(tau > 0)) return 0
  const zeta = options.damping ?? 0.6
  const omega = options.frequency ?? 14
  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta)
    return 1 - Math.exp(-zeta * omega * tau) * (Math.cos(wd * tau) + ((zeta * omega) / wd) * Math.sin(wd * tau))
  }
  if (zeta === 1) return 1 - Math.exp(-omega * tau) * (1 + omega * tau)
  const root = Math.sqrt(zeta * zeta - 1)
  const r1 = -omega * (zeta - root)
  const r2 = -omega * (zeta + root)
  return 1 - (r2 * Math.exp(r1 * tau) - r1 * Math.exp(r2 * tau)) / (r2 - r1)
}

/** The unit spring's speed, per second: the derivative of `spring`. Zero at and before the start. */
export function springSpeed(tau: number, options: SpringOptions = {}): number {
  if (!(tau > 0)) return 0
  const zeta = options.damping ?? 0.6
  const omega = options.frequency ?? 14
  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta)
    return Math.exp(-zeta * omega * tau) * ((omega * omega) / wd) * Math.sin(wd * tau)
  }
  if (zeta === 1) return omega * omega * tau * Math.exp(-omega * tau)
  const root = Math.sqrt(zeta * zeta - 1)
  const r1 = -omega * (zeta - root)
  const r2 = -omega * (zeta + root)
  return (-(r1 * r2) / (r2 - r1)) * (Math.exp(r1 * tau) - Math.exp(r2 * tau))
}

/** How far past 1 an underdamped spring goes at its first peak (0 from ζ = 1 up). */
export function springOvershoot(damping: number): number {
  if (!(damping < 1)) return 0
  if (!(damping > 0)) return 1
  return Math.exp((-damping * Math.PI) / Math.sqrt(1 - damping * damping))
}

/**
 * The same spring described the way an interface designer does: `duration` is one period of the
 * undamped motion (so ω = 2π / duration) and `bounce` is 0 for none, toward 1 for more (ζ = 1 − bounce).
 */
export function springTimed(tau: number, options: { duration?: number; bounce?: number } = {}): number {
  const duration = options.duration ?? 0.5
  const bounce = options.bounce ?? 0
  return spring(tau, { damping: 1 - bounce, frequency: (2 * Math.PI) / duration })
}

export interface Knot {
  t: number
  x: number
  y: number
}

/**
 * The point at time `t` on a smooth path through timed knots (a cubic Hermite spline with
 * Catmull-Rom tangents that respect uneven spacing). Before the first knot it is the first knot,
 * after the last the last, and at a knot's time exactly that knot.
 */
export function spline(knots: readonly Knot[], t: number): Point {
  const n = knots.length
  if (n === 0) throw new Error('spline needs at least one knot: [{ t, x, y }, …]')
  const first = knots[0]!
  const last = knots[n - 1]!
  if (t <= first.t) return [first.x, first.y]
  if (t >= last.t) return [last.x, last.y]
  let i = 0
  while (i < n - 2 && t >= knots[i + 1]!.t) i++
  const k0 = knots[i]!
  const k1 = knots[i + 1]!
  const before = knots[i - 1] ?? k0
  const after = knots[i + 2] ?? k1
  const span = k1.t - k0.t
  const u = (t - k0.t) / span
  const u2 = u * u
  const u3 = u2 * u
  const h00 = 2 * u3 - 3 * u2 + 1
  const h10 = u3 - 2 * u2 + u
  const h01 = -2 * u3 + 3 * u2
  const h11 = u3 - u2
  const axis = (a: number, b: number, c: number, d: number): number => {
    // Tangents as velocity (per second) through the neighbours, then scaled to this span.
    const m0 = k1.t > before.t ? (c - a) / (k1.t - before.t) : 0
    const m1 = after.t > k0.t ? (d - b) / (after.t - k0.t) : 0
    return h00 * b + h10 * span * m0 + h01 * c + h11 * span * m1
  }
  return [axis(before.x, k0.x, k1.x, after.x), axis(before.y, k0.y, k1.y, after.y)]
}

/** The velocity of a moving point, per second, by a centred difference `h` either side of `t`. */
export function velocity(position: (t: number) => Point, t: number, h = 1 / 240): Point {
  const a = position(t - h)
  const b = position(t + h)
  return [(b[0] - a[0]) / (2 * h), (b[1] - a[1]) / (2 * h)]
}
