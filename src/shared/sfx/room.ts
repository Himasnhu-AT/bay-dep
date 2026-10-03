/**
 * The room: one algorithmic reverb that every hit of a score is sent to.
 *
 * It is what makes five unrelated voices one film — a sound with no space sits on top of the
 * picture, and sounds in different spaces sit in different films. So there is exactly one, it
 * takes the whole score's send bus, and nothing about it depends on which material is playing.
 *
 * No impulse response is loaded: the room is a feedback delay network built from the
 * literature —
 *
 * - eight delay lines of mutually prime lengths, mixed by a Hadamard matrix (Stautner &
 *   Puckette 1982; Jot & Chaigne 1991), which is lossless, so the decay is set entirely by
 * - a gain and one-pole low-pass in each line, sized so every line loses 60 dB in
 *   `decaySeconds` at low frequencies and sooner at high ones (Jot's absorptive filters) —
 *   lines of different lengths therefore decay at the *same rate*, which is what makes the tail
 *   one exponential and not eight;
 * - two Schroeder all-passes in front of each channel, so a click arrives in the network
 *   already smeared and the tail does not start as a flutter of discrete echoes;
 * - a handful of early reflections, a pre-delay, and a high-pass on the way in, so a sub hit
 *   excites the room with its knock and not its 46 Hz.
 *
 * The left input feeds four lines and the right the other four, and each output reads the
 * lines its own input feeds: the first pass of a hit panned left is heard on the left, and
 * from the first trip through the matrix on it is everywhere — a tail that is wide but starts
 * where the hit was.
 * Everything is fixed: there is no randomness here to seed, which is the strongest form of
 * deterministic.
 */

import type { SfxRoom } from './score'

/** Delay-line lengths at 48 kHz, in samples: primes, 30–62 ms. */
const LINE_SAMPLES = [1423, 1637, 1877, 2063, 2281, 2531, 2749, 2999] as const
const LINES = LINE_SAMPLES.length
/** The sample rate the lengths above were chosen at. */
const REFERENCE_RATE = 48_000
/** Input diffusion: all-pass lengths (samples at 48 kHz) and their coefficient. */
const DIFFUSERS = [
  [241, 83],
  [263, 97]
] as const
const DIFFUSION = 0.6
/** Early reflections: milliseconds after the pre-delay, and level. Odd ones cross the stereo field. */
const EARLY = [
  [7.1, 0.42],
  [13.7, 0.34],
  [21.3, 0.26],
  [29.9, 0.19]
] as const
/** The send is high-passed here, in Hz. */
const SEND_HIGH_PASS_HZ = 140
/**
 * Scales the tail so that, in the default room, a hit sent at 1 returns about as much energy as
 * it had dry (measured on an impulse, `room.test.ts`). `send` and `wet` scale from there.
 */
const RETURN_LEVEL = 0.71

/** In-place fast Walsh–Hadamard transform of 8 values, orthonormal. */
function hadamard(v: Float64Array): void {
  for (let span = 1; span < LINES; span *= 2) {
    for (let i = 0; i < LINES; i += span * 2) {
      for (let j = i; j < i + span; j += 1) {
        const a = v[j]!
        const b = v[j + span]!
        v[j] = a + b
        v[j + span] = a - b
      }
    }
  }
  const scale = 1 / Math.sqrt(LINES)
  for (let i = 0; i < LINES; i += 1) v[i] = v[i]! * scale
}

class AllPass {
  readonly #buffer: Float64Array
  #at = 0
  constructor(samples: number) {
    this.#buffer = new Float64Array(Math.max(1, samples))
  }
  step(x: number): number {
    const delayed = this.#buffer[this.#at]!
    const y = delayed - DIFFUSION * x
    this.#buffer[this.#at] = x + DIFFUSION * y
    this.#at = (this.#at + 1) % this.#buffer.length
    return y
  }
}

/** Seconds the room keeps sounding after its last input: the pre-delay and one full decay. */
export function roomSeconds(room: SfxRoom): number {
  return room.wet > 0 ? room.preDelayMs / 1000 + room.decaySeconds : 0
}

/**
 * The room's answer to a stereo send, the same length as the send. Silent, and free, when
 * `wet` is 0.
 */
export function reverb(
  sendLeft: Float32Array,
  sendRight: Float32Array,
  room: SfxRoom,
  sampleRate: number
): { left: Float32Array; right: Float32Array } {
  const n = sendLeft.length
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  if (room.wet <= 0) return { left, right }

  const rate = sampleRate / REFERENCE_RATE
  const lengths = LINE_SAMPLES.map((samples) => Math.max(1, Math.round(samples * rate)))
  const lines = lengths.map((samples) => new Float64Array(samples))
  const at = new Int32Array(LINES)
  // Jot's absorptive filter per line: gain for the low-frequency decay, a pole for the highs.
  // `highRatio` is how long the highs last relative to the lows.
  const highRatio = 1 - 0.75 * room.damping
  const gains = new Float64Array(LINES)
  const poles = new Float64Array(LINES)
  for (let i = 0; i < LINES; i += 1) {
    const decibels = (-60 * lengths[i]!) / (sampleRate * room.decaySeconds)
    gains[i] = 10 ** (decibels / 20)
    poles[i] = Math.min(0.95, (Math.LN10 / 4) * (decibels / 20) * (1 - 1 / highRatio ** 2))
  }
  const damped = new Float64Array(LINES)
  const mixed = new Float64Array(LINES)

  const preDelay = Math.round((room.preDelayMs / 1000) * sampleRate)
  const early = EARLY.map(([ms, level]) => ({ samples: preDelay + Math.round((ms / 1000) * sampleRate), level }))
  const diffuseLeft = DIFFUSERS.map(([samples]) => new AllPass(Math.round(samples * rate)))
  const diffuseRight = DIFFUSERS.map(([, samples]) => new AllPass(Math.round(samples * rate)))
  const highPass = Math.exp((-2 * Math.PI * SEND_HIGH_PASS_HZ) / sampleRate)
  let lowLeft = 0
  let lowRight = 0
  // The send, high-passed, kept so the pre-delay and the early taps can read back into it.
  const inLeft = new Float32Array(n)
  const inRight = new Float32Array(n)
  const out = RETURN_LEVEL * room.wet

  for (let i = 0; i < n; i += 1) {
    lowLeft = highPass * lowLeft + (1 - highPass) * sendLeft[i]!
    lowRight = highPass * lowRight + (1 - highPass) * sendRight[i]!
    inLeft[i] = sendLeft[i]! - lowLeft
    inRight[i] = sendRight[i]! - lowRight

    let earlyLeft = 0
    let earlyRight = 0
    for (let tap = 0; tap < early.length; tap += 1) {
      const from = i - early[tap]!.samples
      if (from < 0) continue
      const level = early[tap]!.level
      // Alternate taps arrive from the far wall.
      if (tap % 2 === 0) {
        earlyLeft += level * inLeft[from]!
        earlyRight += level * inRight[from]!
      } else {
        earlyLeft += level * inRight[from]!
        earlyRight += level * inLeft[from]!
      }
    }

    let feedLeft = i >= preDelay ? inLeft[i - preDelay]! : 0
    let feedRight = i >= preDelay ? inRight[i - preDelay]! : 0
    for (const stage of diffuseLeft) feedLeft = stage.step(feedLeft)
    for (const stage of diffuseRight) feedRight = stage.step(feedRight)

    let tailLeft = 0
    let tailRight = 0
    for (let line = 0; line < LINES; line += 1) {
      const read = lines[line]![at[line]!]!
      const sign = line % 2 === 0 ? 1 : -1
      if (line % 4 < 2) tailLeft += sign * read
      else tailRight += sign * read
      damped[line] = gains[line]! * (1 - poles[line]!) * read + poles[line]! * damped[line]!
      mixed[line] = damped[line]!
    }
    hadamard(mixed)
    for (let line = 0; line < LINES; line += 1) {
      const buffer = lines[line]!
      buffer[at[line]!] = mixed[line]! + (line % 4 < 2 ? feedLeft : feedRight) * 0.5
      at[line] = (at[line]! + 1) % buffer.length
    }

    left[i] = out * (tailLeft + earlyLeft)
    right[i] = out * (tailRight + earlyRight)
  }
  return { left, right }
}
