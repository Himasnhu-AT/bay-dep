/**
 * A clip's speed over its own length, and the integral that turns it into source time.
 *
 * **The curve is `item.keyframes.speed`** — ordinary keys (`@shared/keyframes`), item-relative
 * frames, the same eases, sampled by the same `keyframeValueAt`. That choice is what makes every
 * edit behave: a head trim shifts them, a split slices them exactly, a move carries them, with no
 * walker here knowing speed keys exist. A value is an absolute rate (1 is source speed, 0.25 a
 * quarter, 0 a held frame); like every keyed property it replaces the static `item.speed`, which
 * is what a clip with no speed keys plays at — byte for byte what it did before this file.
 *
 * **The integral is a sum over frames, on purpose.** A timeline frame `k` of the clip advances
 * the source by `speed(k) / fps` seconds: the speed is sampled at the start of each frame, as
 * every keyed property is, and held for that frame. So `consumedFrames(item, n)` for a whole `n`
 * is exactly `speed(0) + … + speed(n-1)` — exact at every key, monotonic because no speed is
 * negative, and the same arithmetic the preview does when it sets `playbackRate` once per frame.
 * A closed-form integral of the eased curve would be a second definition that the per-frame
 * playback could only approximate. Between whole frames it is linear (the frame's speed held).
 *
 * Units here are **frames**: "consumed" is source time measured in timeline frames (source
 * seconds × fps). Microseconds meet frames only in `project.ts` (`sourceEdgeAt`), as always.
 *
 * A hold is a run of frames at speed 0: nothing is consumed, so the same source frame is read for
 * each of them. `frameAtConsumed` answers with the *first* frame that reaches an amount, so a
 * question asked inside a hold lands on its start.
 */

import { keyframeValueAt } from './keyframe-sample'
import type { Item, Keyframe } from './project'

/** The rates a speed key may hold. 0 holds a frame; 16 is the fastest the preview can play. */
export const SPEED_KEY_RANGE = { min: 0, max: 16 } as const

type Timed = Pick<Item, 'speed' | 'keyframes'>

/** The clip's speed keys, or undefined when it plays at its one constant `speed`. */
export function speedKeysOf(item: Pick<Item, 'keyframes'>): readonly Keyframe[] | undefined {
  const keys = item.keyframes?.speed
  return keys && keys.length > 0 ? keys : undefined
}

export function hasSpeedCurve(item: Pick<Item, 'keyframes'>): boolean {
  return speedKeysOf(item) !== undefined
}

/** The constant rate of a clip with no keys: a non-finite or non-positive one plays at 1×. */
function constantSpeed(speed: number): number {
  return Number.isFinite(speed) && speed > 0 ? speed : 1
}

function keyedSpeed(keys: readonly Keyframe[], frame: number, fallback: number): number {
  const value = keyframeValueAt(keys, frame)
  if (value === undefined || !Number.isFinite(value)) return fallback
  return value < SPEED_KEY_RANGE.min ? SPEED_KEY_RANGE.min : value > SPEED_KEY_RANGE.max ? SPEED_KEY_RANGE.max : value
}

/** The rate the clip plays at during item-relative frame `rel` (sampled at the frame's start). */
export function speedAtFrame(item: Timed, rel: number): number {
  const keys = speedKeysOf(item)
  if (!keys) return constantSpeed(item.speed)
  return keyedSpeed(keys, Math.floor(rel), constantSpeed(item.speed))
}

/**
 * Running sums of the keyed span. `sums[i]` is the source consumed over frames `first .. first+i-1`,
 * so `sums[0]` is 0. Outside the span the speed is the first or last key's, so nothing more is
 * stored. Kept per key list, because the compositor asks once per clip per frame; the signature
 * catches a list edited in place, which no writer here does but a cache must not depend on.
 */
interface Table {
  signature: string
  first: number
  last: number
  before: number
  after: number
  sums: Float64Array
}

const tables = new WeakMap<readonly Keyframe[], Table>()

function signatureOf(keys: readonly Keyframe[], fallback: number): string {
  let out = String(fallback)
  for (const key of keys) out += `|${key.frame},${key.value},${Array.isArray(key.ease) ? key.ease.join('/') : key.ease ?? ''}`
  return out
}

function tableFor(keys: readonly Keyframe[], fallback: number): Table {
  const signature = signatureOf(keys, fallback)
  const cached = tables.get(keys)
  if (cached && cached.signature === signature) return cached
  const first = Math.floor(keys[0]!.frame)
  const last = Math.max(first, Math.ceil(keys[keys.length - 1]!.frame))
  const sums = new Float64Array(last - first + 1)
  for (let i = 1; i < sums.length; i += 1) sums[i] = sums[i - 1]! + keyedSpeed(keys, first + i - 1, fallback)
  const table: Table = {
    signature,
    first,
    last,
    before: keyedSpeed(keys, first - 1, fallback),
    after: keyedSpeed(keys, last, fallback),
    sums
  }
  tables.set(keys, table)
  return table
}

/** Source consumed from the table's first frame up to whole frame `n` (negative before it). */
function sumTo(table: Table, n: number): number {
  if (n <= table.first) return (n - table.first) * table.before
  if (n >= table.last) return table.sums[table.sums.length - 1]! + (n - table.last) * table.after
  return table.sums[n - table.first]!
}

function sumAt(table: Table, keys: readonly Keyframe[], fallback: number, rel: number): number {
  const whole = Math.floor(rel)
  const part = rel - whole
  const base = sumTo(table, whole)
  return part === 0 ? base : base + part * keyedSpeed(keys, whole, fallback)
}

/**
 * How much source, in frames, the clip has read by item-relative frame boundary `rel`: 0 at 0,
 * negative before the clip's first frame (the handle a transition or a J-cut reads), and never
 * decreasing. With no speed keys it is `rel × speed`.
 */
export function consumedFrames(item: Timed, rel: number): number {
  const keys = speedKeysOf(item)
  const fallback = constantSpeed(item.speed)
  if (!keys) return rel * fallback
  const table = tableFor(keys, fallback)
  return sumAt(table, keys, fallback, rel) - sumTo(table, 0)
}

/**
 * The inverse: the first item-relative frame boundary by which `consumed` frames of source have
 * been read. Fractional. `Infinity` when the curve never gets there (it ends on a hold) and
 * `-Infinity` when it was always past it (it starts on one) — a held frame has no end of its own.
 */
export function frameAtConsumed(item: Timed, consumed: number): number {
  const keys = speedKeysOf(item)
  const fallback = constantSpeed(item.speed)
  if (!keys) return consumed / fallback
  const table = tableFor(keys, fallback)
  const target = consumed + sumTo(table, 0)
  const total = table.sums[table.sums.length - 1]!
  if (target <= 0) return table.before > 0 ? table.first + target / table.before : Number.NEGATIVE_INFINITY
  if (target > total) return table.after > 0 ? table.last + (target - total) / table.after : Number.POSITIVE_INFINITY
  return firstReaching(table, target)
}

/** The first boundary inside the keyed span whose running sum reaches `target` (0 ≤ target ≤ total). */
function firstReaching(table: Table, target: number): number {
  const sums = table.sums
  if (target <= 0) return table.first
  // The first index whose sum is at least the target: the sums never decrease.
  let lo = 0
  let hi = sums.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sums[mid]! >= target) hi = mid
    else lo = mid + 1
  }
  const below = sums[lo - 1]!
  const step = sums[lo]! - below
  return table.first + (lo - 1) + (target - below) / step
}

// ---------------------------------------------------------------------------
// Ramp presets
// ---------------------------------------------------------------------------

export const SPEED_RAMP_PRESETS = ['ramp-down', 'ramp-up', 'montage', 'bullet', 'hold'] as const
export type SpeedRampPreset = (typeof SPEED_RAMP_PRESETS)[number]

/** What each preset is called in the inspector and what it does, in one line. */
export const SPEED_RAMP_LABELS: Record<SpeedRampPreset, { name: string; description: string }> = {
  'ramp-down': { name: 'Ramp down', description: 'Starts at full speed and eases down to a quarter.' },
  'ramp-up': { name: 'Ramp up', description: 'Starts at a quarter speed and eases up to full.' },
  montage: { name: 'Montage', description: 'Fast in, slow through the middle, fast out.' },
  bullet: { name: 'Bullet', description: 'Full speed, a sudden near-stop in the middle, full speed again.' },
  hold: { name: 'Hold', description: 'Plays, freezes on the middle frame for a second, plays on.' }
}

/**
 * A preset's shape: speeds at fractions of the clip's *footage* (0 its first frame, 1 its last).
 * Laid over footage rather than over time so that the slow part lands on the same picture
 * whatever the clip's length turns out to be.
 */
const SHAPES: Record<Exclude<SpeedRampPreset, 'hold'>, { at: number; speed: number; ease?: Keyframe['ease'] }[]> = {
  'ramp-down': [
    { at: 0, speed: 1 },
    { at: 0.4, speed: 1, ease: 'inOut' },
    { at: 0.7, speed: 0.25 }
  ],
  'ramp-up': [
    { at: 0, speed: 0.25 },
    { at: 0.3, speed: 0.25, ease: 'inOut' },
    { at: 0.6, speed: 1 }
  ],
  montage: [
    { at: 0, speed: 2, ease: 'inOut' },
    { at: 0.35, speed: 0.5 },
    { at: 0.65, speed: 0.5, ease: 'inOut' },
    { at: 1, speed: 2 }
  ],
  bullet: [
    { at: 0, speed: 1 },
    { at: 0.42, speed: 1, ease: 'out' },
    { at: 0.5, speed: 0.1 },
    { at: 0.56, speed: 0.1, ease: 'in' },
    { at: 0.64, speed: 1 }
  ]
}

/**
 * The speed keys a preset gives a clip that reads `footageFrames` of source (source time measured
 * in timeline frames), with `fps` for the hold's one second. Keys land on whole frames, in time
 * order, one per frame. The clip's new length is not decided here: `planRetime` finds the frame at
 * which these keys have read the same footage.
 *
 * Each shape point sits at a fraction of the footage; its frame is found by walking the curve
 * built so far, so a point placed "40% into the footage" is on that picture after the slow
 * section before it has stretched the clip.
 */
export function speedRampKeys(preset: SpeedRampPreset, footageFrames: number, fps: number): Keyframe[] {
  const footage = Math.max(1, footageFrames)
  if (preset === 'hold') {
    const at = Math.max(1, Math.round(footage / 2))
    const length = Math.max(1, Math.round(fps))
    return [
      { frame: 0, value: 1, ease: 'hold' },
      { frame: at, value: 0, ease: 'hold' },
      { frame: at + length, value: 1 }
    ]
  }
  const keys: Keyframe[] = []
  for (const point of SHAPES[preset]) {
    const probe: Timed = { speed: 1, keyframes: keys.length > 0 ? { speed: keys } : undefined }
    const reached = keys.length === 0 ? 0 : frameAtConsumed(probe, point.at * footage)
    const previous = keys[keys.length - 1]
    const frame = Math.max(previous ? previous.frame + 1 : 0, Math.round(Number.isFinite(reached) ? reached : 0))
    keys.push({ frame, value: point.speed, ...(point.ease ? { ease: point.ease } : {}) })
  }
  return keys
}

/** Which preset, if any, made these keys for a clip of this footage — so the inspector can show it. */
export function speedRampOf(keys: readonly Keyframe[] | undefined, footageFrames: number, fps: number): SpeedRampPreset | null {
  if (!keys) return null
  for (const preset of SPEED_RAMP_PRESETS) {
    const made = speedRampKeys(preset, footageFrames, fps)
    if (
      made.length === keys.length &&
      made.every((key, i) => key.frame === keys[i]!.frame && Math.abs(key.value - keys[i]!.value) < 1e-9)
    ) {
      return preset
    }
  }
  return null
}

/** A short reading of a curve for a badge: `25–100%`, or `hold` when it stops. */
export function speedCurveLabel(item: Timed & Pick<Item, 'durationInFrames'>): string {
  const keys = speedKeysOf(item)
  if (!keys) return `${Math.round(constantSpeed(item.speed) * 100)}%`
  let low = Number.POSITIVE_INFINITY
  let high = 0
  const fallback = constantSpeed(item.speed)
  for (let frame = 0; frame < Math.max(1, item.durationInFrames); frame += 1) {
    const speed = keyedSpeed(keys, frame, fallback)
    if (speed < low) low = speed
    if (speed > high) high = speed
  }
  const percent = (speed: number): string => String(Math.round(speed * 100))
  return low === high ? `${percent(low)}%` : `${percent(low)}–${percent(high)}%`
}
