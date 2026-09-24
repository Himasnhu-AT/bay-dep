/**
 * The inspector's pure rules: which controls a clip gets, how a multi-selection reads, and the
 * volume scale a person reads (dB) against the one the model stores (linear gain).
 *
 * Shared rather than kept in the component because each rule is a claim about the model — "a
 * text clip has a picture", "a detached sound has none" — and those are what tests should hold,
 * not a React tree that happens to render them.
 */

import type { AssetKind, Keyframe, KeyframeEase, TrackKind } from './project'

// ---------------------------------------------------------------------------
// Which controls a clip gets
// ---------------------------------------------------------------------------

/** Every kind that draws a picture on the canvas. Text draws its own glyphs; it is still a picture. */
export const VISUAL_KINDS = ['video', 'image', 'gif', 'text', 'html', 'brf'] as const

/**
 * Whether a clip draws anything anyone can see — and so gets Transform, Opacity, keyframes on
 * layout, Adjustments and Blend.
 *
 * Decided by the asset's kind **and** the track, never by `asset.hasVideo`. `hasVideo` is a
 * probe result: a text asset is minted with `hasVideo: false` (there is no stream to probe), and
 * gating on it hid every picture control from text clips. The track matters the other way round:
 * a detached sound is an item on an audio track whose asset is the *video* — it plays the
 * sound and draws nothing, which is also the rule the agent's `edit_item` keys on
 * (`hasPicture: track.kind === 'video'`).
 */
export function isVisualItem(kind: AssetKind | undefined, trackKind: TrackKind | undefined): boolean {
  if (trackKind === 'audio') return false
  if (kind === undefined) return trackKind === 'video'
  return (VISUAL_KINDS as readonly string[]).includes(kind)
}

/**
 * Kinds that read through time in a source, so `speed` and the source in-point mean something.
 * A still or a title shows the same picture at every read point; a speed field on one is a
 * control that does nothing.
 */
export const SOURCE_TIMED_KINDS = ['video', 'audio', 'gif', 'html', 'brf'] as const

export function hasSourceTime(kind: AssetKind | undefined): boolean {
  return kind !== undefined && (SOURCE_TIMED_KINDS as readonly string[]).includes(kind)
}

/**
 * Whether a clip can make sound: its asset carries audio (a composition may play its own), and
 * it has not been detached onto a linked audio item — the same test the agent's keyframe merge
 * uses for `volume`, plus the detach the audio engine honours.
 */
export function canSound(
  asset: { kind: AssetKind; hasAudio: boolean } | undefined,
  item: { audioDetached?: boolean }
): boolean {
  if (!asset || item.audioDetached) return false
  return asset.hasAudio || asset.kind === 'html'
}

// ---------------------------------------------------------------------------
// Multi-selection
// ---------------------------------------------------------------------------

/**
 * `===` plus NaN-equals-NaN, which `===` gets wrong and `Object.is` over-corrects.
 *
 * A single selected clip whose value is NaN read "Mixed" — one item disagreeing with itself —
 * because `NaN !== NaN`. `Object.is` would fix that and bring the mirror bug: it separates `-0`
 * from `0`, and `Math.round` produces `-0` readily, so two clips that look identical would read
 * as mixed.
 */
export function sameValue<T>(a: T, b: T): boolean {
  if (a === b) return true
  return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)
}

/**
 * One value across a multi-selection, or `mixed` when they disagree. `value` is the first
 * item's, so a field still has a number to scrub from — but it must *show* "Mixed", because
 * showing the first clip's value as if it spoke for the rest is how an inspector flattens five
 * different opacities into one on the next keystroke.
 */
export function commonValue<T>(values: readonly T[]): { value: T | undefined; mixed: boolean } {
  if (values.length === 0) return { value: undefined, mixed: false }
  const value = values[0] as T
  return { value, mixed: values.some((v) => !sameValue(v, value)) }
}

// ---------------------------------------------------------------------------
// Volume in dB
// ---------------------------------------------------------------------------

/** The loudest a clip may be: the model's volume ceiling, gain 2 — +6.02 dB. */
export const MAX_VOLUME_DB = 20 * Math.log10(2)

/**
 * The bottom of the volume control. At or below it the clip is silent (gain 0), the way every
 * mixer's fader bottoms out at −∞ rather than at a very quiet number.
 */
export const VOLUME_DB_FLOOR = -60

/** Linear gain to dB. 0 is `-Infinity`: silence has no finite level. */
export function gainToDb(gain: number): number {
  if (!Number.isFinite(gain) || gain <= 0) return Number.NEGATIVE_INFINITY
  return 20 * Math.log10(gain)
}

/**
 * dB to the linear gain the model stores — the same `10^(db/20)` the agent's `{ db }` volume keys
 * are converted by. At or below the floor it is 0 (silent); above +6.02 dB it is the ceiling, 2,
 * because the model refuses more and a clamp here is what the fader's end means.
 */
export function dbToGain(db: number): number {
  if (!Number.isFinite(db)) return db > 0 ? 2 : 0
  if (db <= VOLUME_DB_FLOOR) return 0
  return Math.min(2, 10 ** (db / 20))
}

/**
 * A dB readout short enough for the slider's readout column: `−∞`, `0dB`, `-6.0dB`, `+2.5dB`,
 * `-24dB` (whole numbers from ±10, where a tenth of a dB is below anything audible).
 */
export function formatDb(db: number): string {
  if (!Number.isFinite(db) || db <= VOLUME_DB_FLOOR) return '−∞'
  const rounded = Math.abs(db) >= 10 ? Math.round(db) : Math.round(db * 10) / 10
  if (rounded === 0) return '0dB'
  const text = Math.abs(db) >= 10 ? String(Math.abs(rounded)) : Math.abs(rounded).toFixed(1)
  return `${rounded > 0 ? '+' : '-'}${text}dB`
}

// ---------------------------------------------------------------------------
// Editing one key of a property's list
// ---------------------------------------------------------------------------

/** The eases a person picks from a list, in the order a menu shows them. */
export const EASE_CHOICES: { value: Exclude<KeyframeEase, readonly number[]>; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'in', label: 'Ease in' },
  { value: 'out', label: 'Ease out' },
  { value: 'inOut', label: 'Ease in and out' },
  { value: 'hold', label: 'Hold' }
]

/** The name of a key's ease for a menu: a tuple is a curve someone (the agent) wrote by hand. */
export function easeChoice(ease: KeyframeEase | undefined): string {
  if (ease === undefined) return 'linear'
  return Array.isArray(ease) ? 'custom' : (ease as string)
}

/**
 * The property's key list with the key on `frame` changed — moved to `to`, or given `ease`, or
 * both. The result is meant for `mergeKeyframes`, which is what refuses a move onto a frame
 * another key holds (and says so), so this does not second-guess it. `linear` is written as
 * absence, the model's spelling of the default. Unknown `frame`: the list comes back unchanged.
 */
export function editKey(
  keys: readonly Keyframe[],
  frame: number,
  change: { to?: number; ease?: KeyframeEase | 'linear' }
): Keyframe[] {
  return keys
    .map((key) => {
      if (key.frame !== frame) return { ...key }
      const next: Keyframe = { ...key }
      if (change.to !== undefined) next.frame = Math.round(change.to)
      if (change.ease !== undefined) {
        if (change.ease === 'linear') delete next.ease
        else next.ease = change.ease
      }
      return next
    })
    .sort((a, b) => a.frame - b.frame)
}
