/**
 * The geometry behind the audio controls — a fader's taper and a knob's arc — as pure functions,
 * so the mapping the eye reads and the value the model stores can be tested as one round trip.
 */

import { MODIFIER_SCALE, type Modifiers } from './values'

// ---------------------------------------------------------------------------
// Fader
// ---------------------------------------------------------------------------

/**
 * Where 0 dB sits on a fader's travel, from the bottom. Consoles put unity about three quarters
 * up, so a fader has headroom above it and most of its travel in the range mixing happens in.
 */
export const FADER_UNITY = 0.75

/**
 * A fader's position (0 bottom … 1 top) for a level in dB — a log taper, not a linear one.
 *
 * Above unity the travel is linear in dB to `maxDb`. Below it, dB falls with the *square* of the
 * distance from unity, so the travel near 0 dB is fine and the bottom quarter sweeps the quiet
 * end: -6 dB sits at ~52% of the travel, -20 at ~32%, -40 at ~14%. A fader linear in dB (bay's old
 * horizontal slider) gave −60…−40 dB — all but silence — as much travel as −20…0. At or below
 * `floorDb` the fader is at the bottom: −∞.
 */
export function faderPosition(db: number, floorDb: number, maxDb: number): number {
  if (!(db > floorDb)) return 0
  if (db >= maxDb) return 1
  if (db >= 0) return FADER_UNITY + (1 - FADER_UNITY) * (db / maxDb)
  return FADER_UNITY * (1 - Math.sqrt(db / floorDb))
}

/** The level in dB at a fader position — `faderPosition`'s inverse. The bottom is −∞. */
export function faderDb(position: number, floorDb: number, maxDb: number): number {
  if (!(position > 0)) return Number.NEGATIVE_INFINITY
  if (position >= 1) return maxDb
  if (position >= FADER_UNITY) return ((position - FADER_UNITY) / (1 - FADER_UNITY)) * maxDb
  const t = 1 - position / FADER_UNITY
  return floorDb * t * t
}

/**
 * A fader's level one step of `deltaDb` from `current`: from −∞ (or the floor) a step up lands on
 * the floor plus the step, a step down stays at −∞; above the top it holds at the top; at or below
 * the floor it is −∞. A NaN level stays NaN, for `committable` to refuse.
 */
export function faderStep(current: number, deltaDb: number, floorDb: number, maxDb: number): number {
  if (Number.isNaN(current)) return Number.NaN
  if (!Number.isFinite(current) || current <= floorDb) return deltaDb > 0 ? floorDb + deltaDb : Number.NEGATIVE_INFINITY
  const next = Math.round((current + deltaDb) * 100) / 100
  return next <= floorDb ? Number.NEGATIVE_INFINITY : Math.min(maxDb, next)
}

/** Reads a typed level: `-6`, `+2.5`, `-6 dB`, `−6`, or `-inf`/`−∞` for silence. Null otherwise. */
export function parseDb(text: string): number | null {
  const t = text.trim().replace(/−/g, '-').replace(/db$/i, '').trim()
  if (/^-?(inf|infinity|∞)$/i.test(t)) return Number.NEGATIVE_INFINITY
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * The scale a position-mapped control (fader, knob) applies to a drag. Its travel already spans
 * the whole range, so a coarser drag means nothing; every modifier — Cmd/Ctrl and Alt as in the
 * rest of the kit, and Shift too, as the owner's spec asks for faders and as Pro Tools does — is
 * fine (×0.1). Keys keep the kit's table (`keyStep`): Shift+arrow is still the bigger step.
 */
export function positionDragScale(mods: Modifiers): number {
  return mods.shift || mods.alt || mods.meta ? MODIFIER_SCALE.fine : 1
}

// ---------------------------------------------------------------------------
// Knob
// ---------------------------------------------------------------------------

/** A knob's sweep: 270°, from 7:30 to 4:30 on a clock face, centre straight up. */
export const KNOB_SWEEP_DEG = 270

/**
 * The pointer angle for a value, in degrees clockwise from straight up: `min` at −135°, `max` at
 * +135°, the middle at 0.
 */
export function knobAngle(value: number, min: number, max: number): number {
  if (!(max > min)) return 0
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)))
  return (t - 0.5) * KNOB_SWEEP_DEG
}

/**
 * The value a vertical-and-horizontal knob drag reaches: up and right increase, as in every audio
 * plugin (react-knob-headless and Ableton alike). `pixelsForRange` is the travel that sweeps the
 * whole range at scale 1.
 */
export function knobDragValue(
  start: number,
  dx: number,
  dy: number,
  min: number,
  max: number,
  pixelsForRange: number,
  scale: number
): number {
  const travel = dx - dy
  return start + (travel / pixelsForRange) * (max - min) * scale
}

/**
 * The pointer's angle around a centre, in degrees clockwise from straight up (−180…180]. Screen
 * y grows downward, which is why the sign of `dy` is flipped.
 */
export function pointerAngle(dx: number, dy: number): number {
  return (Math.atan2(dx, -dy) * 180) / Math.PI
}

/**
 * The signed change from angle `from` to angle `to`, taking the short way round, so a circular
 * drag that crosses straight down (±180°) keeps counting instead of jumping by a whole turn.
 */
export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % 360
  if (delta > 180) delta -= 360
  if (delta <= -180) delta += 360
  return delta
}

/** An angle folded into −180…180 for drawing; the value itself keeps its revolutions. */
export function foldAngle(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0
  const folded = ((((degrees + 180) % 360) + 360) % 360) - 180
  return folded === -180 ? 180 : folded
}
