/**
 * Entrances: something arrives. Each takes the film time and the moment the arrival starts, and is
 * at rest (offset 0, scale 1, opaque) once it has settled — so an element that has entered needs
 * no special case afterwards.
 */

import { clamp, easeOf, progress, spring, springOvershoot, springSpeed, type Curve, type SpringOptions } from './core'

export interface WordLandOptions extends SpringOptions {
  /** How far below its place the word starts, px. */
  rise?: number
  /** The scale it starts at. */
  from?: number
  /** Seconds for opacity to reach 1. Short on purpose: the spring carries the entrance, not a fade. */
  lead?: number
}

/**
 * A word lands on a spring: it rises `rise` px and grows from `from`, overshooting a little.
 * Opacity is done within `lead` seconds, long before the spring settles, so the eye reads a
 * landing rather than a fade.
 */
export function wordLand(t: number, t0: number, options: WordLandOptions = {}): { op: number; y: number; s: number } {
  const rise = options.rise ?? 36
  const from = options.from ?? 0.86
  const lead = options.lead ?? 0.09
  const u = spring(t - t0, { damping: options.damping ?? 0.62, frequency: options.frequency ?? 16 })
  return { op: t < t0 ? 0 : progress(t, t0, t0 + lead), y: rise * (1 - u), s: from + (1 - from) * u }
}

export interface LetterFallOptions extends SpringOptions {
  /** Seconds between one letter starting and the next. */
  stagger?: number
  /** How far above its place each letter starts, px. */
  drop?: number
  /** How much a letter flattens at the bottom of its landing, 0..1 of its height. */
  squash?: number
}

/**
 * Letter `i` of a word falls into place and squashes as it lands. While it falls it is stretched
 * along the fall; as the spring carries it past its resting place it flattens (`sy` below 1, `sx`
 * above) by `squash` at the deepest point, and the ring-out restores it. Scale about the baseline.
 */
export function letterFall(
  t: number,
  t0: number,
  i: number,
  options: LetterFallOptions = {}
): { op: number; y: number; sx: number; sy: number } {
  const stagger = options.stagger ?? 0.045
  const drop = options.drop ?? 120
  const squash = options.squash ?? 0.3
  const config = { damping: options.damping ?? 0.5, frequency: options.frequency ?? 18 }
  const tau = t - t0 - i * stagger
  if (tau < 0) return { op: 0, y: -drop, sx: 1, sy: 1 }
  const u = spring(tau, config)
  // Speed in units of the spring's own rate, so the stretch does not change with `frequency`.
  const fall = Math.max(0, springSpeed(tau, config) / config.frequency)
  const peak = springOvershoot(config.damping)
  const pressed = peak > 0 ? clamp((u - 1) / peak) : 0
  // The stretch fades as the letter reaches its place, so it meets the squash without a step.
  const sy = 1 + squash * 2 * fall * clamp(1 - u) - squash * pressed
  return { op: progress(tau, 0, 0.06), y: -drop * (1 - u), sx: 1 / sy, sy }
}

export interface CardPopOptions extends SpringOptions {
  rise?: number
  from?: number
}

/** A card springs up into place: `dy` px below and at scale `from` to start, a small overshoot, then rest. */
export function cardPop(t: number, t0: number, options: CardPopOptions = {}): { op: number; s: number; dy: number } {
  const rise = options.rise ?? 28
  const from = options.from ?? 0.9
  const u = spring(t - t0, { damping: options.damping ?? 0.7, frequency: options.frequency ?? 15 })
  return { op: t < t0 ? 0 : progress(t, t0, t0 + 0.08), s: from + (1 - from) * u, dy: rise * (1 - u) }
}

export interface CardLiftOptions {
  /** Seconds the exit takes. */
  dur?: number
  /** How far it lifts, px. */
  dist?: number
  /** How much it grows as it leaves (0.04 is 4%). */
  grow?: number
  /** Blur at the end, px — depth, not motion blur. */
  blur?: number
}

/**
 * A card leaves by lifting away from `t1`: it rises, grows a touch, blurs and is gone after `dur`.
 * At rest (all zeros, scale 1, opaque) before `t1`.
 */
export function cardLift(
  t: number,
  t1: number,
  options: CardLiftOptions = {}
): { op: number; s: number; dy: number; blur: number } {
  const p = easeOf('cubicIn')(progress(t, t1, t1 + (options.dur ?? 0.28)))
  return {
    op: 1 - p,
    s: 1 + (options.grow ?? 0.04) * p,
    dy: 0 - (options.dist ?? 40) * p,
    blur: (options.blur ?? 8) * p
  }
}

export interface LineRevealOptions {
  stagger?: number
  /** How far below its place the line starts, in whatever unit the caller applies (px, or % of the line). */
  dist?: number
  dur?: number
  curve?: Curve
}

/**
 * Line `i` rises into place from behind a mask. Put each line in a wrapper with `overflow: hidden`
 * (or clip the canvas to the line's box) and move the line by `y`: it is hidden below the mask
 * until its turn, and opacity never changes — the edge of the mask is the reveal.
 */
export function lineReveal(t: number, t0: number, i: number, options: LineRevealOptions = {}): { y: number; visible: boolean } {
  const start = t0 + i * (options.stagger ?? 0.07)
  const dist = options.dist ?? 110
  const p = easeOf(options.curve ?? 'expoOut')(progress(t, start, start + (options.dur ?? 0.6)))
  return { y: dist * (1 - p), visible: t >= start }
}

export interface TypeOnOptions {
  /** Characters per second. */
  cps?: number
  /** Seconds the caret stays on, and then off, once typing has stopped. */
  blink?: number
}

/**
 * Text typed at a steady rate from `t0`. `n` characters are showing (`str`); the caret is solid
 * while typing and blinks before it starts and after it is `done`.
 */
export function typeOn(
  t: number,
  t0: number,
  text: string,
  options: TypeOnOptions = {}
): { n: number; str: string; done: boolean; caret: boolean } {
  const cps = options.cps ?? 22
  const blink = options.blink ?? 0.53
  // By code point, so an emoji or an accented letter is typed whole.
  const chars = Array.from(text)
  const n = clamp(Math.floor((t - t0) * cps + 1e-9), 0, chars.length)
  const done = n >= chars.length
  const typing = t >= t0 && !done
  // The blink runs from when the caret last became idle, so it is always on at that moment.
  const idleSince = done ? t0 + chars.length / cps : t0
  const phase = Math.floor(Math.abs(t - idleSince) / blink + 1e-9)
  return { n, str: chars.slice(0, n).join(''), done, caret: typing || phase % 2 === 0 }
}

export interface CheckTickOptions extends SpringOptions {
  /** The scale the mark pops from. */
  from?: number
}

/** A checkbox ticks at `t0`: `on` flips at once, and the mark pops from `from` to 1 with a small ring. */
export function checkTick(t: number, t0: number, options: CheckTickOptions = {}): { on: boolean; s: number } {
  const from = options.from ?? 0.8
  const u = spring(t - t0, { damping: options.damping ?? 0.5, frequency: options.frequency ?? 22 })
  return { on: t >= t0, s: from + (1 - from) * u }
}
