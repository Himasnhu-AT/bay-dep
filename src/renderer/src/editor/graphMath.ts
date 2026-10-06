/**
 * The arithmetic of the keyframe graph: one property's value over the clip's time.
 *
 * Pure, so the graph is checked as numbers — where a key sits, what the curve between two keys
 * looks like, and what a drag is allowed to do — without a DOM. The curve is sampled from
 * `keyframeValueAt`, the function the compositor draws from, so what the graph shows is what plays.
 */

import type { Keyframe } from '@shared/project'
import { keyframeValueAt } from '@shared/keyframes'

export interface GraphBox {
  width: number
  height: number
  /** Room inside the edges, so a key at the first frame or the top value is not half cut off. */
  pad: number
}

export interface GraphScale extends GraphBox {
  /** The clip's length: the x axis runs from frame 0 to this. */
  duration: number
  /** The value range the y axis shows. */
  min: number
  max: number
}

export interface ValueLimits {
  min: number
  max: number
}

/**
 * The value range to show: every key, with a tenth of the spread as headroom — and a flat curve
 * (one key, or all at one value) given a spread around it, or it would be a line with no height
 * to drag in. Held inside the property's legal range where that range is finite, so the top of a
 * 0..1 property is the top of the graph and a key cannot be dragged into a value that is refused.
 */
export function graphRange(keys: readonly Keyframe[], limits: ValueLimits): { min: number; max: number } {
  const values = keys.map((key) => key.value).filter(Number.isFinite)
  let lo = values.length > 0 ? Math.min(...values) : 0
  let hi = values.length > 0 ? Math.max(...values) : 1
  const spread = hi - lo
  const room = spread > 1e-9 ? spread * 0.1 : Math.max(Math.abs(hi) * 0.5, 0.5)
  lo -= room
  hi += room
  if (Number.isFinite(limits.min)) lo = Math.max(lo, limits.min)
  if (Number.isFinite(limits.max)) hi = Math.min(hi, limits.max)
  // Clamping a flat curve that sits on a limit can leave no height at all.
  if (hi - lo < 1e-9) {
    if (Number.isFinite(limits.max) && hi >= limits.max) lo = hi - Math.max(room, 1e-3)
    else hi = lo + Math.max(room, 1e-3)
  }
  return { min: lo, max: hi }
}

export function graphX(frame: number, scale: GraphScale): number {
  const span = Math.max(1, scale.duration)
  return scale.pad + (frame / span) * (scale.width - scale.pad * 2)
}

export function graphY(value: number, scale: GraphScale): number {
  const span = scale.max - scale.min || 1
  // Larger values are higher on screen, which is lower in y.
  return scale.height - scale.pad - ((value - scale.min) / span) * (scale.height - scale.pad * 2)
}

export function frameAtX(x: number, scale: GraphScale): number {
  const span = Math.max(1, scale.duration)
  return ((x - scale.pad) / (scale.width - scale.pad * 2)) * span
}

export function valueAtY(y: number, scale: GraphScale): number {
  const span = scale.max - scale.min || 1
  return scale.min + ((scale.height - scale.pad - y) / (scale.height - scale.pad * 2)) * span
}

/**
 * The curve as an SVG path, sampled at every frame of the clip (at most `maxSamples` points) —
 * so a hold reads as a step and a bezier as the curve it is, with no per-ease drawing code.
 */
export function graphPath(keys: readonly Keyframe[], scale: GraphScale, maxSamples = 240): string {
  if (keys.length === 0) return ''
  const duration = Math.max(1, scale.duration)
  const steps = Math.min(maxSamples, duration)
  const points: string[] = []
  for (let i = 0; i <= steps; i += 1) {
    const frame = (i / steps) * duration
    const value = keyframeValueAt(keys, frame)
    if (value === undefined || !Number.isFinite(value)) continue
    points.push(`${points.length === 0 ? 'M' : 'L'}${graphX(frame, scale).toFixed(2)} ${graphY(value, scale).toFixed(2)}`)
  }
  return points.join(' ')
}

/**
 * `keys` with the key at `index` dragged to `frame` and `value`.
 *
 * The frame is whole, stays on the clip, and stops one frame short of its neighbours: a key
 * dragged past the next would silently reorder the curve, and two keys on one frame is a write
 * the tool refuses. The value is held to the property's range. The list is new; the ease stays
 * with the key it was on.
 */
export function dragKey(
  keys: readonly Keyframe[],
  index: number,
  frame: number,
  value: number,
  duration: number,
  limits: ValueLimits
): Keyframe[] {
  const key = keys[index]
  if (!key) return keys.map((one) => ({ ...one }))
  const before = keys[index - 1]
  const after = keys[index + 1]
  const lowest = Math.max(0, before ? before.frame + 1 : 0)
  const highest = Math.min(Math.max(0, Math.round(duration)), after ? after.frame - 1 : Infinity)
  // A key a trim left outside the clip keeps its frame: there is no legal frame to drag it to.
  const nextFrame = lowest > highest ? key.frame : Math.min(highest, Math.max(lowest, Math.round(frame)))
  const nextValue = Math.min(limits.max, Math.max(limits.min, Number.isFinite(value) ? value : key.value))
  return keys.map((one, i) => (i === index ? { ...one, frame: nextFrame, value: nextValue } : { ...one }))
}
