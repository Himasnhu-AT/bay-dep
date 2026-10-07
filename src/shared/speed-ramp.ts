/**
 * Reading a speed ramp someone wrote — the agent's `edit_item.speedRamp` and the inspector's
 * presets go through here, so both are refused for the same reasons in the same words.
 *
 * The curve itself is `@shared/speed-curve`; what a ramp does to the clip's length is `planRetime`
 * in `@shared/speed`.
 */

import { parseEase } from './ease'
import type { Item, Keyframe, KeyframeEase } from './project'
import {
  consumedFrames,
  SPEED_KEY_RANGE,
  SPEED_RAMP_PRESETS,
  speedRampKeys,
  type SpeedRampPreset
} from './speed-curve'

export type SpeedRampRead = { ok: true; keys: Keyframe[] | null; preset?: SpeedRampPreset } | { ok: false; error: string }

/** The footage a clip reads, as timeline frames of source — what a ramp preset is laid over. */
export function footageFramesOf(item: Pick<Item, 'durationInFrames' | 'speed' | 'keyframes'>): number {
  return consumedFrames(item, item.durationInFrames)
}

/**
 * `speedRamp` as a caller gives it: a preset name, a list of `{ frame, speed, ease? }`, or null
 * for no ramp. `footageFrames` is what a preset is laid over (`footageFramesOf`).
 *
 * Frames are item-relative and may run past the clip's present end: a ramp changes the length, so
 * the end it is written against is the new one. The last key must be above 0, or the clip would
 * never finish its footage.
 */
export function readSpeedRamp(given: unknown, footageFrames: number, fps: number): SpeedRampRead {
  if (given === null) return { ok: true, keys: null }
  if (typeof given === 'string') {
    if (!(SPEED_RAMP_PRESETS as readonly string[]).includes(given)) {
      return {
        ok: false,
        error: `speedRamp has no preset "${given}". Presets: ${SPEED_RAMP_PRESETS.join(', ')} — or pass a list of { frame, speed, ease? }, or null to remove the ramp.`
      }
    }
    return { ok: true, keys: speedRampKeys(given as SpeedRampPreset, footageFrames, fps), preset: given as SpeedRampPreset }
  }
  if (!Array.isArray(given)) {
    return {
      ok: false,
      error: `speedRamp must be a preset name (${SPEED_RAMP_PRESETS.join(', ')}), a list of { frame, speed, ease? }, or null to remove the ramp.`
    }
  }
  if (given.length === 0) return { ok: true, keys: null }
  const keys: Keyframe[] = []
  for (let index = 0; index < given.length; index += 1) {
    const where = `speedRamp[${index}]`
    const raw = given[index] as Record<string, unknown> | null
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { ok: false, error: `${where} must be an object { frame, speed, ease? }.` }
    }
    const frame = raw.frame
    if (typeof frame !== 'number' || !Number.isInteger(frame) || frame < 0) {
      return {
        ok: false,
        error: `${where}.frame must be a whole number of frames from the clip's first frame (0 or more); got ${JSON.stringify(frame)}.`
      }
    }
    const speed = raw.speed
    if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < SPEED_KEY_RANGE.min || speed > SPEED_KEY_RANGE.max) {
      return {
        ok: false,
        error:
          `${where}.speed must be a rate from ${SPEED_KEY_RANGE.min} to ${SPEED_KEY_RANGE.max} — 1 is source speed, 0.25 a quarter, ` +
          `0 a held frame; got ${JSON.stringify(speed)}.` +
          (typeof speed === 'number' && speed > SPEED_KEY_RANGE.max ? ' A percentage is a fraction here: 25% is 0.25.' : '')
      }
    }
    const ease = parseEase(raw.ease, where)
    if (ease && typeof ease === 'object' && 'error' in ease) return { ok: false, error: ease.error }
    const unknown = Object.keys(raw).filter((k) => !['frame', 'speed', 'ease'].includes(k))
    if (unknown.length > 0) return { ok: false, error: `${where} has no field "${unknown[0]}". A speed key is { frame, speed, ease? }.` }
    if (keys.some((key) => key.frame === frame)) {
      return { ok: false, error: `speedRamp has two keys on frame ${frame}. One frame holds one speed; put them a frame apart for a jump.` }
    }
    keys.push(ease === undefined ? { frame, value: speed } : { frame, value: speed, ease: ease as KeyframeEase })
  }
  keys.sort((a, b) => a.frame - b.frame)
  const last = keys[keys.length - 1]!
  if (!(last.value > 0)) {
    const back = last.frame + Math.max(1, Math.round(fps))
    return {
      ok: false,
      error:
        `speedRamp ends at speed 0 (frame ${last.frame}), so the clip would hold there for ever and never finish its footage. ` +
        `End the hold with a key back above 0 — for a one-second freeze add { frame: ${back}, speed: 1 } ` +
        `and give the key at ${last.frame} ease "hold".`
    }
  }
  return { ok: true, keys }
}
