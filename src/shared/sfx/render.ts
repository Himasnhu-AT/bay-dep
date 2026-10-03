/**
 * A score, rendered: stereo `Float32Array`s at 48 kHz.
 *
 * Three stages, each its own function so a test can stand between them:
 *
 * 1. `mixScore` — every event's voice placed at its time with constant-power pan, onto a dry
 *    bus and, by its `send`, onto the one bus the room reads. The room's answer is added.
 *    Nothing here limits anything: coincident hits add past the ceiling, and past full scale.
 * 2. `limitBus` — the ceiling. A memoryless soft knee: below three quarters of the ceiling the
 *    bus passes untouched, above it the excess is folded under the ceiling by `tanh`, with one
 *    gain for both channels so the stereo image does not move. It cannot overshoot, needs no
 *    look-ahead, and a single hit at `gain: 1` in the centre sits exactly at the knee — so the
 *    limiter is audible only when hits pile up, which is when it is wanted.
 * 3. the tail (`SfxTail`): cut to the score's length, with a fade over anything still ringing
 *    and a measure of how loud what it faded was — or left to ring.
 *
 * Deterministic: seeded noise, fixed room, no clock. The same score is the same samples.
 */

import { reverb, roomSeconds } from './room'
import { eventRng } from './rng'
import { FIT_FADE_SECONDS, SFX_SAMPLE_RATE, type SfxScore } from './score'
import { synthVoice, voiceSeconds } from './voices'

export interface StereoBuffer {
  left: Float32Array
  right: Float32Array
}

/** The knee sits at this fraction of the ceiling. */
export const KNEE = 0.75

export const dbToLinear = (db: number): number => 10 ** (db / 20)
export const linearToDb = (linear: number): number => (linear > 0 ? 20 * Math.log10(linear) : Number.NEGATIVE_INFINITY)

/** Left and right gains for a pan of −1..1, constant power: the sum of squares is always 1. */
export function panGains(pan: number): { left: number; right: number } {
  const angle = ((pan + 1) * Math.PI) / 4
  return { left: Math.cos(angle), right: Math.sin(angle) }
}

/** The largest absolute sample of either channel. */
export function peakOf(buffer: StereoBuffer): number {
  let peak = 0
  for (let i = 0; i < buffer.left.length; i += 1) {
    const l = Math.abs(buffer.left[i]!)
    const r = Math.abs(buffer.right[i]!)
    if (l > peak) peak = l
    if (r > peak) peak = r
  }
  return peak
}

/**
 * Seconds from the start by which every hit and the room after it have died away — where a
 * `ring` render ends, and what a `fit` render is compared with to know it cut something.
 */
export function soundingSeconds(score: SfxScore): number {
  let end = 0
  for (const event of score.events) {
    const sends = event.send > 0 && event.gain > 0
    end = Math.max(end, event.t + voiceSeconds(event.material, event.size) + (sends ? roomSeconds(score.room) : 0))
  }
  return end
}

/**
 * The unlimited bus, long enough for everything to ring out (never shorter than the score).
 * A centred hit at `gain: 1` peaks at the knee.
 */
export function mixScore(score: SfxScore): StereoBuffer {
  const rate = SFX_SAMPLE_RATE
  const frames = Math.max(Math.round(score.durationSeconds * rate), Math.ceil(soundingSeconds(score) * rate))
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  const sendLeft = new Float32Array(frames)
  const sendRight = new Float32Array(frames)
  // A centred hit loses 3 dB to each channel; the level gives it back, so centre is the knee.
  const level = dbToLinear(score.ceilingDb) * KNEE * Math.SQRT2

  score.events.forEach((event, index) => {
    if (event.gain <= 0) return
    const voice = synthVoice(event.material, event, eventRng(score.seed, index))
    const start = Math.round(event.t * rate)
    const gains = panGains(event.pan)
    const l = event.gain * level * gains.left
    const r = event.gain * level * gains.right
    const count = Math.min(voice.length, frames - start)
    for (let i = 0; i < count; i += 1) {
      const sample = voice[i]!
      const at = start + i
      left[at] = left[at]! + sample * l
      right[at] = right[at]! + sample * r
      sendLeft[at] = sendLeft[at]! + sample * l * event.send
      sendRight[at] = sendRight[at]! + sample * r * event.send
    }
  })

  const wet = reverb(sendLeft, sendRight, score.room, rate)
  for (let i = 0; i < frames; i += 1) {
    left[i] = left[i]! + wet.left[i]!
    right[i] = right[i]! + wet.right[i]!
  }
  return { left, right }
}

/** The largest 32-bit float that is not above `value` (positive, finite). */
function float32AtMost(value: number): number {
  const float = new Float32Array([value])
  if (float[0]! > value) new Uint32Array(float.buffer)[0]! -= 1
  return float[0]!
}

/**
 * Folds the bus under `ceiling` (linear), in place. Returns the most it turned anything down,
 * in dB (0 when the bus never reached the knee).
 */
export function limitBus(bus: StereoBuffer, ceiling: number): number {
  const knee = ceiling * KNEE
  const room = ceiling - knee
  // The buffers hold 32-bit floats, and the nearest one to a value just under the ceiling can
  // be just over it: a pile-up far past the knee rounded up by half a billionth and was, by one
  // step, over. `top` is the largest 32-bit float that is not.
  const top = float32AtMost(ceiling)
  let least = 1
  for (let i = 0; i < bus.left.length; i += 1) {
    const magnitude = Math.max(Math.abs(bus.left[i]!), Math.abs(bus.right[i]!))
    if (magnitude <= knee) continue
    const gain = (knee + room * Math.tanh((magnitude - knee) / room)) / magnitude
    bus.left[i] = Math.max(-top, Math.min(top, bus.left[i]! * gain))
    bus.right[i] = Math.max(-top, Math.min(top, bus.right[i]! * gain))
    if (gain < least) least = gain
  }
  return least < 1 ? -linearToDb(least) : 0
}

export interface SfxRender extends StereoBuffer {
  sampleRate: number
  /** Length of the buffers, in seconds: the score's, or longer when it rings on. */
  seconds: number
  /** How many events made sound. */
  events: number
  /** Largest sample, dBFS. `-Infinity` for a silent render. */
  peakDb: number
  /** The most the limiter turned the bus down, dB. 0: it never acted. */
  limitedDb: number
  /**
   * With `tail: "fit"`: the loudest sample of what the closing fade took away — everything
   * from where the fade begins to where the sound would have ended — in dBFS. `-Infinity`
   * when nothing was faded. It is what says whether the cut can be heard: the last of a decay
   * 70 dB down is faded by every score, and nobody should be told about it.
   */
  fadedPeakDb: number
}

/** A faded tail quieter than this, relative to the ceiling, is not worth a sentence. */
const AUDIBLE_BELOW_CEILING_DB = 40

/**
 * What a render did that the score's author probably did not mean, as sentences: sound that
 * could be heard being cut off at the end, and hits piled so high the limiter had to act.
 */
export function renderWarnings(score: SfxScore, did: { fadedPeakDb: number; limitedDb: number }): string[] {
  const warnings: string[] = []
  if (did.fadedPeakDb > score.ceilingDb - AUDIBLE_BELOW_CEILING_DB) {
    warnings.push(
      `Sound was still ringing at durationSeconds (${did.fadedPeakDb.toFixed(0)} dBFS) and was faded out over the last ` +
        `${FIT_FADE_SECONDS} s. Move the last hit earlier, or pass tail: "ring" to keep it (the file is then longer than the film).`
    )
  }
  if (did.limitedDb > 1) {
    warnings.push(
      `The limiter turned the loudest moment down by ${did.limitedDb.toFixed(1)} dB: several hits land at once and add past ` +
        `the ceiling. Lower their gains or move one, so the hit keeps its shape.`
    )
  }
  return warnings
}

export function renderScore(score: SfxScore): SfxRender {
  const rate = SFX_SAMPLE_RATE
  const bus = mixScore(score)
  const limitedDb = limitBus(bus, dbToLinear(score.ceilingDb))
  const scoreFrames = Math.round(score.durationSeconds * rate)

  let { left, right } = bus
  let fadedPeak = 0
  if (score.tail === 'fit' && left.length > scoreFrames) {
    const fade = Math.min(scoreFrames, Math.round(FIT_FADE_SECONDS * rate))
    for (let i = scoreFrames - fade; i < left.length; i += 1) {
      fadedPeak = Math.max(fadedPeak, Math.abs(left[i]!), Math.abs(right[i]!))
    }
    left = left.slice(0, scoreFrames)
    right = right.slice(0, scoreFrames)
    for (let i = 0; i < fade; i += 1) {
      // Raised cosine, reaching zero on the last sample.
      const gain = 0.5 + 0.5 * Math.cos((Math.PI * (i + 1)) / fade)
      const at = scoreFrames - fade + i
      left[at] = left[at]! * gain
      right[at] = right[at]! * gain
    }
  }

  const out = { left, right }
  return {
    ...out,
    sampleRate: rate,
    seconds: left.length / rate,
    events: score.events.filter((event) => event.gain > 0).length,
    peakDb: linearToDb(peakOf(out)),
    limitedDb,
    fadedPeakDb: linearToDb(fadedPeak)
  }
}
