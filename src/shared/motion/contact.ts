/**
 * Contact: one thing causes another. A hit, a press, a pointer, and the simulations that need a
 * history — a follower on a spring, a pulled button, a hanging string.
 *
 * A simulation cannot be a function of `t` alone, because where it is depends on where it has
 * been. So each `sim*` runs once, at a fixed step, over the whole duration when it is built, and
 * hands back `.at(t)`, which only reads the recording. Build it once at the top of the
 * composition, never inside `time(t)`. The same inputs give the same recording on every machine.
 */

import { clamp, easeOf, lerp, progress, rng, spline, spring, type Knot, type Point, type SpringOptions } from './core'

export interface ImpactOptions {
  /** How fast the ring dies, per second. */
  decay?: number
  /** Ring frequency, radians per second. */
  frequency?: number
  /** How much wider it gets at the hit (0.22 is 22%). */
  squashX?: number
  /** How much shorter it gets at the hit. */
  squashY?: number
}

/**
 * A landing at `tHit`: flat and wide at the instant of the hit, then ringing back to shape.
 * Exactly at rest (`ring` 0, scales 1) before the hit. `ring` runs from 1 at the hit through
 * decaying swings to 0 — use it for anything else the hit should drive (a flash, a ripple).
 * Scale about the contact edge, not the centre.
 */
export function impact(t: number, tHit: number, options: ImpactOptions = {}): { ring: number; sx: number; sy: number } {
  const tau = t - tHit
  if (tau < 0) return { ring: 0, sx: 1, sy: 1 }
  const ring = Math.exp(-(options.decay ?? 9) * tau) * Math.cos((options.frequency ?? 38) * tau)
  return { ring, sx: 1 + (options.squashX ?? 0.22) * ring, sy: 1 - (options.squashY ?? 0.3) * ring }
}

export interface PressOptions extends SpringOptions {
  /** How far it dips (0.06 is to 94%). */
  depth?: number
  /** Seconds it is held down before release. */
  hold?: number
}

/**
 * A click at `tDown`: the control dips for `hold` seconds, then is released and rings back.
 * `down` is true while it is held; `active` flips at the release and stays — that is the moment
 * the control's state (and whatever it causes) changes.
 */
export function press(t: number, tDown: number, options: PressOptions = {}): { s: number; down: boolean; active: boolean } {
  const depth = options.depth ?? 0.06
  const hold = options.hold ?? 0.09
  const tUp = tDown + hold
  if (t < tDown) return { s: 1, down: false, active: false }
  if (t < tUp) return { s: 1 - depth * easeOf('quintOut')(progress(t, tDown, tUp)), down: true, active: false }
  const back = spring(t - tUp, { damping: options.damping ?? 0.4, frequency: options.frequency ?? 30 })
  return { s: 1 - depth * (1 - back), down: false, active: true }
}

export interface PointerOptions {
  /** How much the pointer shrinks at a click (0.18 is to 82%). */
  dip?: number
  /** Seconds a click's shrink-and-recover takes. */
  dur?: number
}

/**
 * The pointer: where it is on a smooth path through timed `knots`, and its scale, which dips at
 * each time in `clicks` (smallest at the click itself). `down` is true for the first half of each
 * click. Pair every click with what it causes at the same time — `press` on the thing under it.
 */
export function pointer(
  t: number,
  knots: readonly Knot[],
  clicks: readonly number[] = [],
  options: PointerOptions = {}
): { x: number; y: number; s: number; down: boolean } {
  const dip = options.dip ?? 0.18
  const dur = options.dur ?? 0.22
  const [x, y] = spline(knots, t)
  let bump = 0
  let down = false
  for (const c of clicks) {
    // Shrinks over the 30% before the click, recovers over the 70% after.
    const tau = t - c
    const k = tau < 0 ? progress(tau, -dur * 0.3, 0) : 1 - progress(tau, 0, dur * 0.7)
    bump = Math.max(bump, k * k * (3 - 2 * k))
    if (tau >= 0 && tau < dur * 0.5) down = true
  }
  return { x, y, s: 1 - dip * bump, down }
}

/**
 * Squash and stretch from a velocity (px per second): longer along the direction of travel,
 * thinner across it, by up to `max`. Rotate the thing by `angle` degrees, scale by `sx`/`sy`,
 * and rotate back. At rest it is `{ angle: 0, sx: 1, sy: 1 }`.
 */
export function stretch(vx: number, vy: number, options: { k?: number; max?: number } = {}): { angle: number; sx: number; sy: number } {
  const speed = Math.hypot(vx, vy)
  if (speed === 0) return { angle: 0, sx: 1, sy: 1 }
  const e = Math.min(options.max ?? 0.35, (options.k ?? 0.0004) * speed)
  return { angle: (Math.atan2(vy, vx) * 180) / Math.PI, sx: 1 + e, sy: 1 / (1 + e) }
}

/** A recording of a simulation: `at(t)` reads it, before the start it is the first state, after the end the last. */
export interface Recording<T> {
  at(t: number): T
  /** Seconds simulated. */
  duration: number
  /** Seconds between simulated states. */
  step: number
}

interface SimOptions {
  /** Seconds to simulate, from t = 0. */
  duration: number
  /** Seconds per step. The default, 1/240, is finer than any frame rate bay renders. */
  step?: number
}

function stepsOf(options: SimOptions): { step: number; count: number } {
  const step = options.step ?? 1 / 240
  if (!(options.duration > 0) || !(step > 0)) {
    throw new Error('a sim needs { duration } in seconds, above 0 (and a step above 0 if one is given)')
  }
  return { step, count: Math.ceil(options.duration / step) + 1 }
}

/** Where `t` falls in a recording of `count` states: the state before, the state after, and how far between. */
function locate(t: number, step: number, count: number): { i: number; j: number; f: number } {
  const at = clamp(t / step, 0, count - 1)
  const i = Math.floor(at)
  return { i, j: Math.min(count - 1, i + 1), f: at - i }
}

export interface FollowerOptions extends SimOptions {
  /** Spring stiffness, per second². Higher follows more tightly. */
  stiffness?: number
  /** Damping, per second. Lower overshoots and wobbles more. */
  damping?: number
}

/**
 * A point that follows a moving target on a spring: it lags when the target moves, overshoots
 * when the target stops, and settles on it. `target(t)` is the leader's position (a `pointer`,
 * say). Starts at rest on the target's position at t = 0.
 */
export function simFollower(
  target: (t: number) => Point,
  options: FollowerOptions
): Recording<{ x: number; y: number; vx: number; vy: number }> {
  const { step, count } = stepsOf(options)
  const k = options.stiffness ?? 120
  const c = options.damping ?? 14
  const data = new Float64Array(count * 4)
  let [x, y] = target(0)
  let vx = 0
  let vy = 0
  for (let n = 0; n < count; n++) {
    if (n > 0) {
      const [gx, gy] = target(n * step)
      // Semi-implicit Euler: velocity first, then position from the new velocity. Stable at this step.
      vx += (k * (gx - x) - c * vx) * step
      vy += (k * (gy - y) - c * vy) * step
      x += vx * step
      y += vy * step
    }
    data.set([x, y, vx, vy], n * 4)
  }
  return {
    duration: options.duration,
    step,
    at(t) {
      const { i, j, f } = locate(t, step, count)
      const v = (o: number): number => lerp(data[i * 4 + o]!, data[j * 4 + o]!, f)
      return { x: v(0), y: v(1), vx: v(2), vy: v(3) }
    }
  }
}

export interface MagnetOptions extends FollowerOptions {
  /** How near the pointer has to be, px, before it pulls at all. */
  radius?: number
  /** How far toward the pointer the thing is drawn at most, as a fraction of the distance. */
  pull?: number
}

/**
 * A thing at `home` that leans toward the pointer when it comes near and springs back when it
 * leaves — a magnetic button. `k` is how strongly it is being pulled, 0..1.
 */
export function simMagnet(
  pointerAt: (t: number) => Point,
  home: Point,
  options: MagnetOptions
): Recording<{ x: number; y: number; k: number }> {
  const radius = options.radius ?? 160
  const pull = options.pull ?? 0.35
  const strength = (t: number): number => {
    const [px, py] = pointerAt(t)
    const near = 1 - clamp(Math.hypot(px - home[0], py - home[1]) / radius)
    return near * near * (3 - 2 * near)
  }
  const follower = simFollower(
    (t) => {
      const [px, py] = pointerAt(t)
      const k = pull * strength(t)
      return [lerp(home[0], px, k), lerp(home[1], py, k)]
    },
    { duration: options.duration, step: options.step, stiffness: options.stiffness ?? 260, damping: options.damping ?? 16 }
  )
  return {
    duration: follower.duration,
    step: follower.step,
    at(t) {
      const { x, y } = follower.at(t)
      return { x, y, k: strength(clamp(t, 0, options.duration)) }
    }
  }
}

export interface StringOptions extends SimOptions {
  /** How many points the string is made of, the pinned one included. */
  points?: number
  /** Its length, px. */
  length?: number
  /** Downward pull, px per second². */
  gravity?: number
  /** The fraction of its speed a point loses each second, 0..1. */
  drag?: number
  /** Passes over the segment lengths per step. More is stiffer. */
  iterations?: number
  /** A sideways gust, px per second², that wanders with time. 0 (the default) is still air. */
  gust?: number
  /** Which gusts: the same seed, the same wind. */
  seed?: number
}

/**
 * A string hanging from a moving anchor (Verlet integration with fixed segment lengths): it
 * trails, swings and settles. `at(t)` is its points from the anchor down, `[[x, y], …]` — draw a
 * line through them. Starts hanging straight down, at rest.
 */
export function simString(anchor: (t: number) => Point, options: StringOptions): Recording<Point[]> {
  const { step, count } = stepsOf(options)
  const points = Math.max(2, Math.floor(options.points ?? 12))
  const segment = (options.length ?? 200) / (points - 1)
  const gravity = options.gravity ?? 1800
  const keep = (1 - clamp(options.drag ?? 0.6)) ** step
  const iterations = options.iterations ?? 8
  const gust = options.gust ?? 0
  // The wind: a new random push every quarter second, eased from one to the next.
  const random = rng(options.seed ?? 1)
  const pushes: number[] = []
  for (let n = 0; n <= Math.ceil(options.duration / 0.25) + 1; n++) pushes.push(random() * 2 - 1)
  const wind = (t: number): number => {
    const at = t / 0.25
    const i = Math.floor(at)
    const f = at - i
    return gust * lerp(pushes[i] ?? 0, pushes[i + 1] ?? 0, f * f * (3 - 2 * f))
  }

  const stride = points * 2
  const data = new Float64Array(count * stride)
  const [ax, ay] = anchor(0)
  const now = new Float64Array(stride)
  const was = new Float64Array(stride)
  for (let p = 0; p < points; p++) {
    now[p * 2] = was[p * 2] = ax
    now[p * 2 + 1] = was[p * 2 + 1] = ay + p * segment
  }
  data.set(now, 0)
  for (let n = 1; n < count; n++) {
    const t = n * step
    const push = wind(t)
    for (let p = 1; p < points; p++) {
      const x = now[p * 2]!
      const y = now[p * 2 + 1]!
      now[p * 2] = x + (x - was[p * 2]!) * keep + push * step * step
      now[p * 2 + 1] = y + (y - was[p * 2 + 1]!) * keep + gravity * step * step
      was[p * 2] = x
      was[p * 2 + 1] = y
    }
    const [px, py] = anchor(t)
    for (let pass = 0; pass < iterations; pass++) {
      now[0] = px
      now[1] = py
      for (let p = 1; p < points; p++) {
        const dx = now[p * 2]! - now[p * 2 - 2]!
        const dy = now[p * 2 + 1]! - now[p * 2 - 1]!
        const length = Math.hypot(dx, dy) || 1
        const fix = (length - segment) / length
        // The pinned point does not give; every other pair shares the correction.
        const share = p === 1 ? 1 : 0.5
        now[p * 2] = now[p * 2]! - dx * fix * share
        now[p * 2 + 1] = now[p * 2 + 1]! - dy * fix * share
        if (p > 1) {
          now[p * 2 - 2] = now[p * 2 - 2]! + dx * fix * 0.5
          now[p * 2 - 1] = now[p * 2 - 1]! + dy * fix * 0.5
        }
      }
    }
    data.set(now, n * stride)
  }
  return {
    duration: options.duration,
    step,
    at(t) {
      const { i, j, f } = locate(t, step, count)
      const out: Point[] = []
      for (let p = 0; p < points; p++) {
        out.push([
          lerp(data[i * stride + p * 2]!, data[j * stride + p * 2]!, f),
          lerp(data[i * stride + p * 2 + 1]!, data[j * stride + p * 2 + 1]!, f)
        ])
      }
      return out
    }
  }
}
