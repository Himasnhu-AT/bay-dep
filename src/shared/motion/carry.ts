/**
 * Carries: the moves that make one beat grow out of the one before. In each, something that was
 * on screen survives the boundary and visibly becomes, opens, or travels into what follows — so
 * build a carry as ONE element changing, not as one element fading out under another fading in.
 */

import { FRAME, clamp, easeOf, lerp, progress, spring, springSpeed, type Curve, type Frame, type Point, type SpringOptions } from './core'
import type { Matrix } from './matrix'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
  /** Corner radius, px. Absent is square. */
  r?: number
}

/**
 * A container transform: rect `A` becomes rect `B` between `t0` and `t1`, corner radius included.
 * Exactly `A` at and before `t0` and exactly `B` from `t1`. `cx`/`cy` is the centre, `p` the eased
 * progress (use it to cross the contents over inside the one moving container).
 */
export function rectMorph(
  t: number,
  t0: number,
  t1: number,
  A: Rect,
  B: Rect,
  options: { curve?: Curve } = {}
): { x: number; y: number; w: number; h: number; r: number; cx: number; cy: number; p: number } {
  const p = easeOf(options.curve ?? 'quintInOut')(progress(t, t0, t1))
  const x = lerp(A.x, B.x, p)
  const y = lerp(A.y, B.y, p)
  const w = lerp(A.w, B.w, p)
  const h = lerp(A.h, B.h, p)
  return { x, y, w, h, r: lerp(A.r ?? 0, B.r ?? 0, p), cx: x + w / 2, cy: y + h / 2, p }
}

/** The radius a circle centred at (cx, cy) needs to reach the farthest corner of the frame. */
export function irisReach(cx: number, cy: number, frame: Frame = FRAME): number {
  const dx = Math.max(Math.abs(cx), Math.abs(frame.w - cx))
  const dy = Math.max(Math.abs(cy), Math.abs(frame.h - cy))
  return Math.hypot(dx, dy)
}

/**
 * A circle opens from a point until it is the frame. `r` is its radius; `covered` is true only
 * once the circle contains all four corners of the frame — the moment the stage inside it can
 * become the scene and whatever was outside can stop being drawn. `from` is the radius it starts
 * at (the subject's own size, so the stage opens out of the subject).
 */
export function iris(
  t: number,
  t0: number,
  t1: number,
  cx: number,
  cy: number,
  options: { curve?: Curve; from?: number; frame?: Frame } = {}
): { r: number; covered: boolean; p: number } {
  const reach = irisReach(cx, cy, options.frame ?? FRAME)
  const p = easeOf(options.curve ?? 'cubicInOut')(progress(t, t0, t1))
  const r = lerp(options.from ?? 0, reach, p)
  return { r, covered: r >= reach, p }
}

/**
 * Push in until `target` fills the frame. The scale grows in log space, so the push reads as a
 * steady approach rather than one that crawls and then lunges, and every point moves along a
 * straight line from one vanishing point. Put the whole scene in one layer and give it `matrix`:
 * identity at and before `t0`; from `t1` it maps the target's centre to the frame's centre at a
 * scale where the target covers the frame (`fit: 'cover'`, the default) or just fits inside it
 * (`'contain'`). A target with the frame's aspect ratio maps onto the frame exactly.
 */
export function pushInto(
  t: number,
  t0: number,
  t1: number,
  target: Rect,
  options: { curve?: Curve; fit?: 'cover' | 'contain'; frame?: Frame } = {}
): { s: number; tx: number; ty: number; matrix: Matrix; p: number } {
  const frame = options.frame ?? FRAME
  const p = easeOf(options.curve ?? 'expoInOut')(progress(t, t0, t1))
  const sx = frame.w / target.w
  const sy = frame.h / target.h
  const full = options.fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy)
  const cx = target.x + target.w / 2
  const cy = target.y + target.h / 2
  const s = Math.exp(Math.log(full) * p)
  let tx: number
  let ty: number
  if (Math.abs(full - 1) < 1e-9) {
    // No change of scale, so there is no vanishing point: a plain slide.
    tx = (frame.w / 2 - cx) * p
    ty = (frame.h / 2 - cy) * p
  } else {
    // The one point the finished transform leaves where it is; scaling about it at every step
    // lands the target's centre on the frame's centre at the end.
    const fx = (full * cx - frame.w / 2) / (full - 1)
    const fy = (full * cy - frame.h / 2) / (full - 1)
    tx = fx * (1 - s)
    ty = fy * (1 - s)
  }
  return { s, tx, ty, matrix: [s, 0, 0, s, tx, ty], p }
}

/**
 * A hop from one slot to the next along an arc `height` px high. It travels like a thrown thing —
 * even across, a parabola up and down — so it leaves and arrives at speed: land it with `impact`.
 */
export function arcHop(
  t: number,
  t0: number,
  t1: number,
  from: Point,
  to: Point,
  options: { height?: number; curve?: Curve } = {}
): { x: number; y: number; p: number } {
  const p = easeOf(options.curve ?? 'linear')(progress(t, t0, t1))
  const lift = (options.height ?? 120) * 4 * p * (1 - p)
  return { x: lerp(from[0], to[0], p), y: lerp(from[1], to[1], p) - lift, p }
}

export interface ConvergeOptions {
  /** Seconds between one item leaving and the next. Every item still arrives by `t1`. */
  stagger?: number
  /** How far the outermost arcs bow out, as a fraction of each item's own journey. */
  arc?: number
  /** Turns the outermost items make on the way (they arrive upright). */
  spin?: number
  curve?: Curve
}

/**
 * Item `i` of `n` travels from its own place to its place in a cluster, on an arc. The arcs fan:
 * the first and last items bow out to opposite sides and the middle one goes nearly straight, so
 * many things read as one gesture gathering. Exactly `from` until the item leaves and exactly
 * `to`, upright, once it has arrived.
 */
export function converge(
  t: number,
  t0: number,
  t1: number,
  i: number,
  n: number,
  from: Point,
  to: Point,
  options: ConvergeOptions = {}
): { x: number; y: number; rot: number; p: number } {
  const span = Math.max(0, t1 - t0)
  // The stagger is cut down if it would leave the last item under 40% of the span to travel in.
  const gap = n > 1 ? Math.min(options.stagger ?? 0.04, (span * 0.6) / (n - 1)) : 0
  const travel = span - gap * (n - 1)
  const start = t0 + gap * i
  const p = easeOf(options.curve ?? 'cubicInOut')(progress(t, start, start + travel))
  const fan = n > 1 ? (i / (n - 1)) * 2 - 1 : 0
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  // A quadratic curve whose control point sits off the chord's midpoint, perpendicular to it.
  const bow = (options.arc ?? 0.35) * fan
  const mx = (from[0] + to[0]) / 2 - dy * bow
  const my = (from[1] + to[1]) / 2 + dx * bow
  const q = 1 - p
  return {
    x: q * q * from[0] + 2 * q * p * mx + p * p * to[0],
    y: q * q * from[1] + 2 * q * p * my + p * p * to[1],
    // `+ 0` so an item that has arrived is at 0, not at the -0 a negative fan would leave.
    rot: (options.spin ?? 0.5) * 360 * fan * q + 0,
    p
  }
}

export interface RailOptions extends SpringOptions {
  /** How much the rail stretches along its travel at full speed (0.12 is 12%). */
  amp?: number
  /** Seconds the text trails the panel it sits on. */
  lag?: number
}

/**
 * An elastic rail of panels. Each time in `switches` moves the rail on by one panel, on a spring
 * that overshoots and rings out. `shift` is the rail's position in panels (multiply by the panel
 * pitch); `index` is the panel it is heading for; `wobble` is how far it still is from there,
 * signed, zero at rest. `sx`/`sy` stretch the panels along the travel while it is fast, and
 * `textShift` is how far, in panels, the words on a panel trail behind it — add it to the text's
 * position so the words arrive a beat after their panel.
 */
export function rail(
  t: number,
  switches: readonly number[],
  options: RailOptions = {}
): { shift: number; index: number; wobble: number; sx: number; sy: number; textShift: number } {
  const config = { damping: options.damping ?? 0.48, frequency: options.frequency ?? 15 }
  const at = (time: number): number => {
    let sum = 0
    for (const s of switches) sum += spring(time - s, config)
    return sum
  }
  let index = 0
  let speed = 0
  for (const s of switches) {
    if (t >= s) index++
    speed += springSpeed(t - s, config)
  }
  const shift = at(t)
  const sx = 1 + (options.amp ?? 0.12) * clamp(Math.abs(speed) / (config.frequency * 0.5))
  return { shift, index, wobble: shift - index, sx, sy: 1 / sx, textShift: at(t - (options.lag ?? 0.08)) - shift }
}

export interface WordCut {
  t: number
  word: string
}

/**
 * Hard-cut words: at each cut's time the word is replaced outright — no fade, no slide. `i` is
 * the cut showing (-1 and an empty word before the first) and `tau` the seconds since it landed,
 * for a pop on each hit. This is the one place a bare cut is right: a burst of three or more.
 */
export function wordCuts(t: number, cuts: readonly WordCut[]): { word: string; i: number; tau: number } {
  let i = -1
  for (let k = 0; k < cuts.length; k++) {
    if (t >= cuts[k]!.t && (i < 0 || cuts[k]!.t >= cuts[i]!.t)) i = k
  }
  const cut = cuts[i]
  return cut ? { word: cut.word, i, tau: t - cut.t } : { word: '', i: -1, tau: 0 }
}
