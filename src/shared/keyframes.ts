/**
 * Keyframe animation: the one sampler, and the rules that keep keys where a person expects them
 * when the clip under them is edited.
 *
 * **One sampler.** `animatedItemAt` (picture) and `animatedVolumeAt` (sound) are the only readers
 * of `item.keyframes`. The compositor draws what the first returns — so preview, `preview_frame`
 * and export animate through one path — and `itemAudioGainAt` reads the second, so the preview's
 * gain nodes and export's per-frame `volume` envelope ride the same curve. An item with no keys
 * returns itself, untouched: the static path costs one property read.
 *
 * **Frames are item-relative** (0 is `item.from`). Chosen over timeline frames because the
 * commonest edit, moving a clip, must carry its animation with it; keys in timeline frames would
 * have to be rewritten by every move, ripple and slide, and one walker that forgot would leave a
 * push-in behind on empty timeline. The rules for the edits that are not moves:
 *
 * - **Move, slide (the clip itself), ripple shift:** keys move with the clip. Nothing to do.
 * - **Trim the in-point** (store trim, roll's incoming side, slide's right neighbour, the tail
 *   `remove_range` keeps): keys stay on the timeline frame — and so on the footage — they were
 *   on, so they shift by minus the trim. A key that falls before frame 0 is kept: it still shapes
 *   the curve into the clip, and trimming back out reveals it again.
 * - **Trim the out-point:** nothing moves.
 * - **Slip:** the clip does not move, so its keys do not; the footage under them changes. A
 *   push-in over the whole clip is still over the whole clip.
 * - **Split** (`split_at`, and the middle of a clip `remove_range` cuts): each half keeps the keys
 *   inside it plus the nearest key beyond each of its ends (`sliceKeyframes`), so each half draws
 *   exactly what the whole did over its frames — an exact split, not an approximation.
 * - **Speed:** does not retime keys. Speed changes which source plays, not how long the clip is
 *   on the timeline (`edit_item` keeps `durationInFrames`), and keys are picture time.
 * - **Timeline fps change:** keys scale like durations (`retimeTimeline`), keeping wall-clock time.
 */

import {
  KEYFRAME_PROPERTIES,
  type Frames,
  type Item,
  type ItemKeyframes,
  type Keyframe,
  type KeyframeEase,
  type KeyframeProperty,
  type Layout
} from './project'
import { easeProgress, parseEase } from './ease'

// ---------------------------------------------------------------------------
// Eases — in `./ease`, shared with transitions; re-exported so existing imports keep working.
// ---------------------------------------------------------------------------

export { cubicBezierAt, EASE_NAMES, easeProgress, NAMED_EASES } from './ease'

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/**
 * The value `keys` give at item-relative `frame`, or undefined when there are none.
 *
 * Before the first key the first value holds; after the last, the last. `keys` must be sorted by
 * frame with no two on one frame — every writer here keeps them so, and the loader repairs a file
 * that is not (`repairKeyframes`).
 */
export function keyframeValueAt(keys: readonly Keyframe[] | undefined, frame: number): number | undefined {
  if (!keys || keys.length === 0) return undefined
  const first = keys[0]!
  if (frame <= first.frame) return first.value
  const last = keys[keys.length - 1]!
  if (frame >= last.frame) return last.value
  // The last key at or before `frame`: binary search, since a volume ride can carry hundreds.
  let lo = 0
  let hi = keys.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (keys[mid]!.frame <= frame) lo = mid
    else hi = mid
  }
  const a = keys[lo]!
  const b = keys[lo + 1]!
  const t = (frame - a.frame) / (b.frame - a.frame)
  return a.value + (b.value - a.value) * easeProgress(a.ease, t)
}

const LAYOUT_PROPERTIES = ['opacity', 'left', 'top', 'width', 'height', 'rotation', 'scale'] as const

/**
 * The layout `item` draws with at timeline `frame`: each keyed property sampled, every other
 * one as stored. Returns `item.layout` itself when nothing is keyed. A key whose value is not a
 * finite number is skipped rather than drawn: one NaN would otherwise remove the clip.
 */
export function animatedLayoutAt(item: Item, frame: Frames): Layout {
  const keyframes = item.keyframes
  if (!keyframes) return item.layout
  let out: Layout | null = null
  const local = frame - item.from
  for (const property of LAYOUT_PROPERTIES) {
    const value = keyframeValueAt(keyframes[property], local)
    if (value === undefined || !Number.isFinite(value)) continue
    out ??= { ...item.layout }
    out[property] = value
  }
  return out ?? item.layout
}

/**
 * `item` as it draws at `frame`: the same object when nothing is keyed, otherwise a copy whose
 * layout is `animatedLayoutAt`. The compositor paints what this returns, so every draw path —
 * preview, `preview_frame`, export, a transition's two sides — animates identically.
 */
export function animatedItemAt(item: Item, frame: Frames): Item {
  if (!item.keyframes) return item
  const layout = animatedLayoutAt(item, frame)
  return layout === item.layout ? item : { ...item, layout }
}

/** `item`'s volume at timeline `frame`: its keys when it has any, else `item.volume`. */
export function animatedVolumeAt(item: Item, frame: Frames): number {
  const value = keyframeValueAt(item.keyframes?.volume, frame - item.from)
  return value === undefined || !Number.isFinite(value) ? item.volume : value
}

/**
 * Whether `item` can make any sound at all by its volume: above 0 somewhere. With volume keys the
 * static volume is not what plays, so a clip at volume 0 whose keys ride up is audible — and a
 * walker that skipped it on `item.volume <= 0` dropped it from the export.
 */
export function volumeMayBeAudible(item: Item): boolean {
  const keys = item.keyframes?.volume
  if (keys && keys.length > 0) return keys.some((key) => key.value > 0)
  return item.volume > 0
}

// ---------------------------------------------------------------------------
// Keeping keys where they belong through edits
// ---------------------------------------------------------------------------

/** Every key moved by `by` frames. Absent stays absent. */
export function shiftKeyframes(keyframes: ItemKeyframes | undefined, by: Frames): ItemKeyframes | undefined {
  if (!keyframes || by === 0) return keyframes ? cloneKeyframes(keyframes) : undefined
  const out: ItemKeyframes = {}
  for (const property of KEYFRAME_PROPERTIES) {
    const list = keyframes[property]
    if (list && list.length > 0) out[property] = list.map((key) => ({ ...key, frame: key.frame + by }))
  }
  return out
}

export function cloneKeyframes(keyframes: ItemKeyframes): ItemKeyframes {
  const out: ItemKeyframes = {}
  for (const property of KEYFRAME_PROPERTIES) {
    const list = keyframes[property]
    if (list && list.length > 0) out[property] = list.map((key) => ({ ...key }))
  }
  return out
}

/**
 * The keys that shape item-relative frames `start..end`, re-based so `start` is frame 0.
 *
 * Keeps every key inside the window plus the nearest one beyond each end. A value inside the
 * window depends only on the two keys either side of it, so this draws exactly what the whole
 * list did over those frames — which is what makes a split exact rather than approximately right.
 */
export function sliceKeyframes(
  keyframes: ItemKeyframes | undefined,
  start: Frames,
  end: Frames
): ItemKeyframes | undefined {
  if (!keyframes) return undefined
  const out: ItemKeyframes = {}
  for (const property of KEYFRAME_PROPERTIES) {
    const list = keyframes[property]
    if (!list || list.length === 0) continue
    let firstInside = list.findIndex((key) => key.frame >= start)
    if (firstInside === -1) firstInside = list.length
    let lastInside = -1
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i]!.frame <= end) {
        lastInside = i
        break
      }
    }
    const from = Math.max(0, firstInside - 1)
    const to = Math.min(list.length - 1, lastInside + 1)
    out[property] = list.slice(from, to + 1).map((key) => ({ ...key, frame: key.frame - start }))
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * `keyframes` with one key set at `frame` (replacing any key already on that frame, keeping its
 * ease) — or, with `value` null, the key on that frame removed. A property left with no keys is
 * removed, and no properties at all is `undefined`. Never edits its input.
 */
export function withKeyframe(
  keyframes: ItemKeyframes | undefined,
  property: KeyframeProperty,
  frame: Frames,
  value: number | null
): ItemKeyframes | undefined {
  const out = keyframes ? cloneKeyframes(keyframes) : {}
  const list = out[property] ?? []
  const index = list.findIndex((key) => key.frame === frame)
  if (value === null) {
    if (index !== -1) list.splice(index, 1)
  } else if (index !== -1) {
    list[index] = { ...list[index]!, value }
  } else {
    list.push({ frame, value })
    list.sort((a, b) => a.frame - b.frame)
  }
  if (list.length > 0) out[property] = list
  else delete out[property]
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * A load-time repair: sorted by frame, one key per frame (the later wins), non-finite keys
 * dropped, empty lists removed. A no-op on anything a writer here produced. A property this build
 * does not know is carried through untouched — a newer build's key must survive a save here.
 */
export function repairKeyframes(keyframes: unknown): ItemKeyframes | undefined {
  if (typeof keyframes !== 'object' || keyframes === null || Array.isArray(keyframes)) return undefined
  const out: Record<string, unknown> = {}
  for (const [property, list] of Object.entries(keyframes as Record<string, unknown>)) {
    if (!(KEYFRAME_PROPERTIES as readonly string[]).includes(property)) {
      out[property] = list
      continue
    }
    if (!Array.isArray(list)) continue
    const byFrame = new Map<number, Keyframe>()
    for (const raw of list) {
      if (typeof raw !== 'object' || raw === null) continue
      const key = raw as Keyframe
      if (!Number.isFinite(key.frame) || !Number.isFinite(key.value)) continue
      byFrame.set(key.frame, key)
    }
    const sorted = [...byFrame.values()].sort((a, b) => a.frame - b.frame)
    if (sorted.length > 0) out[property] = sorted
  }
  return Object.keys(out).length > 0 ? (out as ItemKeyframes) : undefined
}

// ---------------------------------------------------------------------------
// Writing keys: validation with refusals an agent can act on
// ---------------------------------------------------------------------------

/** The legal value range per property, and the unit said in a refusal. */
export const KEYFRAME_LIMITS: Record<KeyframeProperty, { min: number; max: number; unit: string }> = {
  opacity: { min: 0, max: 1, unit: '0 transparent to 1 opaque' },
  left: { min: -Infinity, max: Infinity, unit: 'canvas pixels' },
  top: { min: -Infinity, max: Infinity, unit: 'canvas pixels' },
  width: { min: 1, max: Infinity, unit: 'canvas pixels, at least 1' },
  height: { min: 1, max: Infinity, unit: 'canvas pixels, at least 1' },
  rotation: { min: -Infinity, max: Infinity, unit: 'degrees clockwise' },
  scale: { min: 0, max: 100, unit: 'a zoom about the centre, 1 unchanged' },
  volume: { min: 0, max: 2, unit: 'linear gain, 1 unchanged, 0 silent (or pass db instead of value)' }
}

export const PICTURE_PROPERTIES: readonly KeyframeProperty[] = LAYOUT_PROPERTIES

export interface KeyframeTarget {
  itemId: string
  from: Frames
  durationInFrames: Frames
  /** Whether the item draws a picture / makes sound — keys on a property it lacks do nothing. */
  hasPicture: boolean
  hasAudio: boolean
}

export type KeyframeMerge =
  | { ok: true; keyframes: ItemKeyframes | undefined; changed: KeyframeProperty[] }
  | { ok: false; error: string; userMessage?: string }

/** How the inspector names each animatable property, for refusals a person reads. */
const PROPERTY_WORDS: Record<KeyframeProperty, string> = {
  opacity: 'Opacity',
  left: 'X position',
  top: 'Y position',
  width: 'Width',
  height: 'Height',
  rotation: 'Rotation',
  scale: 'Scale',
  volume: 'Volume'
}

/**
 * Applies `given` — `{ property: Keyframe[] | null }`, or `null` for "remove every key" — over
 * `current`. Each property named is **replaced** whole (null or [] removes it); properties not
 * named are untouched. Refusals name the property, the key's index, the legal range and the fix,
 * in timeline frames as well as item-relative ones, because the agent reasons in the former.
 */
export function mergeKeyframes(
  current: ItemKeyframes | undefined,
  given: unknown,
  target: KeyframeTarget
): KeyframeMerge {
  if (given === null) {
    return { ok: true, keyframes: undefined, changed: KEYFRAME_PROPERTIES.filter((p) => current?.[p]) }
  }
  if (typeof given !== 'object' || Array.isArray(given)) {
    return {
      ok: false,
      error:
        '`keyframes` must be an object of { property: [{ frame, value, ease? }, …] }, or null to ' +
        `remove every key. Animatable properties: ${KEYFRAME_PROPERTIES.join(', ')}.`
    }
  }
  const out: ItemKeyframes = current ? cloneKeyframes(current) : {}
  const changed: KeyframeProperty[] = []
  const last = target.durationInFrames
  const range =
    `0..${last} (item-relative: 0 is the clip's first frame, timeline frame ${target.from}; ` +
    `${last} is its end, timeline frame ${target.from + last})`

  for (const [name, rawList] of Object.entries(given as Record<string, unknown>)) {
    if (!(KEYFRAME_PROPERTIES as readonly string[]).includes(name)) {
      return {
        ok: false,
        error:
          `keyframes has no property "${name}". Animatable properties: ${KEYFRAME_PROPERTIES.join(', ')}` +
          (name === 'x' || name === 'y' ? ' — position is left/top.' : '') +
          (name === 'zoom' ? ' — a zoom is scale.' : '.')
      }
    }
    const property = name as KeyframeProperty
    if (rawList === null || (Array.isArray(rawList) && rawList.length === 0)) {
      delete out[property]
      changed.push(property)
      continue
    }
    if (!Array.isArray(rawList)) {
      return {
        ok: false,
        error: `keyframes.${property} must be a list of { frame, value, ease? }, or null to remove its keys.`
      }
    }
    if (property === 'volume' && !target.hasAudio) {
      return {
        ok: false,
        error:
          `keyframes.volume on ${target.itemId} would change nothing: its asset has no sound. ` +
          `Animate a picture property (${PICTURE_PROPERTIES.join(', ')}) instead, or key the volume of an audio clip.`
      }
    }
    if (property !== 'volume' && !target.hasPicture) {
      return {
        ok: false,
        error:
          `keyframes.${property} on ${target.itemId} would change nothing: it is a sound-only clip ` +
          `with no picture to move. Only volume can be keyed on it.`
      }
    }
    const limits = KEYFRAME_LIMITS[property]
    const keys: Keyframe[] = []
    for (let index = 0; index < rawList.length; index += 1) {
      const where = `keyframes.${property}[${index}]`
      const raw = rawList[index] as Record<string, unknown> | null
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { ok: false, error: `${where} must be an object { frame, value, ease? }.` }
      }
      const frame = raw.frame
      if (typeof frame !== 'number' || !Number.isInteger(frame)) {
        return {
          ok: false,
          error: `${where}.frame must be a whole number of frames in ${range}; got ${JSON.stringify(frame)}.`
        }
      }
      if (frame < 0 || frame > last) {
        return {
          ok: false,
          error:
            `${where}.frame is ${frame}, outside the clip: keys are item-relative, ${range}. ` +
            `For timeline frame T use frame = T - ${target.from}. ` +
            (frame > last ? `To land on the clip's end use ${last}.` : 'Use 0 for the clip\'s first frame.')
        }
      }
      let value: number
      if (raw.db !== undefined) {
        if (property !== 'volume') {
          return { ok: false, error: `${where}.db only applies to volume; give ${property} a value (${limits.unit}).` }
        }
        if (raw.value !== undefined) {
          return { ok: false, error: `${where} has both value and db; give one — db is converted to value = 10^(db/20).` }
        }
        const db = raw.db
        if (typeof db !== 'number' || !Number.isFinite(db) || db > 20 * Math.log10(2)) {
          return {
            ok: false,
            error:
              `${where}.db is ${JSON.stringify(db)}; it must be a finite number of dB no higher than ` +
              `+6.02 (gain 2). For silence give value: 0 instead.`
          }
        }
        value = 10 ** (db / 20)
      } else {
        const given = raw.value
        if (typeof given !== 'number' || !Number.isFinite(given)) {
          return {
            ok: false,
            error:
              `${where}.value must be a number (${limits.unit}); got ${JSON.stringify(given)}.` +
              (property === 'volume' ? ' Or pass db, such as db: -12.' : '')
          }
        }
        value = given
      }
      if (value < limits.min || value > limits.max) {
        return {
          ok: false,
          error:
            `${where}.value is ${Number(value.toFixed(6))}, outside ${property}'s range ` +
            `${limits.min}..${limits.max} (${limits.unit}).` +
            (property === 'opacity' && value > 1 ? ' Opacity is a fraction: 50% is 0.5.' : '')
        }
      }
      const ease = parseEase(raw.ease, where)
      if (ease && typeof ease === 'object' && 'error' in ease) return { ok: false, error: ease.error }
      const unknown = Object.keys(raw).filter((k) => !['frame', 'value', 'db', 'ease'].includes(k))
      if (unknown.length > 0) {
        return { ok: false, error: `${where} has no field "${unknown[0]}". A key is { frame, value, ease? } (volume may use db for value).` }
      }
      const clash = keys.find((key) => key.frame === frame)
      if (clash) {
        return {
          ok: false,
          userMessage:
            `${PROPERTY_WORDS[property]} already has a key on that frame. One frame holds one value: ` +
            `remove one of them, or put them a frame apart for a jump.`,
          error:
            `keyframes.${property} has two keys on frame ${frame} (timeline frame ${target.from + frame}). ` +
            `One frame holds one value; remove one, or put them a frame apart for a jump.`
        }
      }
      keys.push(ease === undefined ? { frame, value } : { frame, value, ease: ease as KeyframeEase })
    }
    keys.sort((a, b) => a.frame - b.frame)
    out[property] = keys
    changed.push(property)
  }
  return { ok: true, keyframes: Object.keys(out).length > 0 ? out : undefined, changed }
}

/**
 * Per keyed property, what the animation does in the agent's own terms: the timeline frames it
 * spans and the values it runs between. Reported by `edit_item` and `inspect_item`, so a key
 * placed on the wrong frame reads back as the wrong timeline frame rather than as a number that
 * only means something after adding `from`.
 */
export function describeKeyframes(item: Item): Record<string, unknown> | undefined {
  const keyframes = item.keyframes
  if (!keyframes) return undefined
  const out: Record<string, unknown> = {}
  for (const property of KEYFRAME_PROPERTIES) {
    const list = keyframes[property]
    if (!list || list.length === 0) continue
    const first = list[0]!
    const lastKey = list[list.length - 1]!
    out[property] = {
      keys: list.length,
      timelineFrames: [item.from + first.frame, item.from + lastKey.frame],
      values: [first.value, lastKey.value],
      ...(list.some((key) => key.frame < 0 || key.frame > item.durationInFrames)
        ? { note: 'some keys lie outside the clip (left by a trim); they still shape the curve inside it' }
        : {})
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}
