/**
 * The five voices of the palette, synthesised: each a mono buffer at 48 kHz, peak 1.
 *
 * None of them is a bare sine. A thing that makes a sound has partials that are not multiples
 * of each other, a noise transient where it is struck, and a pitch that moves as it settles —
 * and a tone with none of the three reads as a beep however it is shaped. The recipes are
 * textbook ones, written here from the literature and not from anyone's code:
 *
 * - `whoosh`: white noise through a state-variable band-pass (Zavalishin's trapezoidal form,
 *   stable while its centre moves) whose centre glides upward, under an asymmetric swell.
 * - `knock`: a damped low mode whose pitch falls in its first milliseconds, a second mode an
 *   inharmonic step above, and a band-passed noise snap.
 * - `bell`: the transverse modes of a free bar (Fletcher & Rossing, *The Physics of Musical
 *   Instruments*: 1 : 2.756 : 5.404 : 8.933), higher modes dying sooner, a slightly detuned
 *   twin of the fundamental for a slow beat, and a strike.
 * - `thump`: a sine falling from a few times its resting pitch, soft-clipped so it has
 *   harmonics a small speaker can show, with a low-passed noise "felt" at the front.
 * - `drop`: a damped resonance whose frequency rises as it decays (the bubble of van den Doel,
 *   "Physically based models for liquid sounds", 2005), with a breath of noise.
 *
 * Every buffer is normalised to peak 1, so an event's `gain` means the same thing for every
 * material; what a material is *for* is its spectrum and length, never its level.
 */

import { SFX_MATERIALS, SFX_SAMPLE_RATE, type SfxMaterial } from './score'
import type { Rng } from './rng'

export interface VoiceParams {
  /** Semitones from the material's home pitch. */
  pitch: number
  /** A multiple of the material's own length. */
  size: number
  /** 0 dark to 1 bright. */
  brightness: number
}

const FS = SFX_SAMPLE_RATE
const TAU = 2 * Math.PI

/** Seconds the voice of an event lasts — what the tail policy and the density of a score read. */
export function voiceSeconds(material: SfxMaterial, size: number): number {
  return SFX_MATERIALS[material].seconds * size
}

const hz = (material: SfxMaterial, pitch: number): number => SFX_MATERIALS[material].homeHz * 2 ** (pitch / 12)

/** White noise in [-1, 1). */
const noise = (rng: Rng): number => rng() * 2 - 1

/**
 * A two-pole band-pass whose centre may change every sample (trapezoidal state-variable
 * filter). Returns the band-pass output scaled to unity gain at the centre.
 */
class BandPass {
  #ic1 = 0
  #ic2 = 0
  step(x: number, centreHz: number, q: number): number {
    const g = Math.tan((Math.PI * Math.min(centreHz, FS * 0.45)) / FS)
    const k = 1 / q
    const a1 = 1 / (1 + g * (g + k))
    const a2 = g * a1
    const a3 = g * a2
    const v3 = x - this.#ic2
    const v1 = a1 * this.#ic1 + a2 * v3
    const v2 = this.#ic2 + a2 * this.#ic1 + a3 * v3
    this.#ic1 = 2 * v1 - this.#ic1
    this.#ic2 = 2 * v2 - this.#ic2
    return v1 * k
  }
}

/** One-pole low-pass coefficient for a cutoff. */
const lowPassCoefficient = (cutoffHz: number): number => 1 - Math.exp((-TAU * cutoffHz) / FS)

/** Scales to peak 1 and closes the last 4 ms to zero, so a truncated decay never ends on a step. */
function finish(buffer: Float32Array): Float32Array {
  const fade = Math.min(buffer.length, Math.round(0.004 * FS))
  for (let i = 0; i < fade; i += 1) {
    const at = buffer.length - fade + i
    buffer[at] = buffer[at]! * (1 - (i + 1) / fade)
  }
  let peak = 0
  for (let i = 0; i < buffer.length; i += 1) peak = Math.max(peak, Math.abs(buffer[i]!))
  if (peak > 0) for (let i = 0; i < buffer.length; i += 1) buffer[i] = buffer[i]! / peak
  return buffer
}

function whoosh(params: VoiceParams, rng: Rng): Float32Array {
  const n = Math.round(voiceSeconds('whoosh', params.size) * FS)
  const out = new Float32Array(n)
  const from = hz('whoosh', params.pitch)
  // The glide is in octaves, so it is even to the ear: 1.3 octaves dark, 2.8 bright.
  const octaves = 1.3 + 1.5 * params.brightness
  const q = 2.2 - params.brightness
  const band = new BandPass()
  const smooth = lowPassCoefficient(4500 + 5000 * params.brightness)
  // The swell peaks late and falls fast: air arriving, then gone.
  const peakAt = 0.62
  let low = 0
  for (let i = 0; i < n; i += 1) {
    const u = i / n
    const centre = from * 2 ** (octaves * u)
    const envelope =
      u < peakAt ? Math.sin((Math.PI / 2) * (u / peakAt)) ** 2 : Math.cos((Math.PI / 2) * ((u - peakAt) / (1 - peakAt))) ** 2
    low += smooth * (band.step(noise(rng), centre, q) - low)
    out[i] = low * envelope
  }
  return finish(out)
}

function knock(params: VoiceParams, rng: Rng): Float32Array {
  const n = Math.round(voiceSeconds('knock', params.size) * FS)
  const out = new Float32Array(n)
  const f = hz('knock', params.pitch)
  const bodyDecay = 0.036 * params.size
  const modeDecay = 0.016 * params.size
  const snapCentre = (2000 + 2400 * params.brightness) * 2 ** (params.pitch / 24)
  // A band of noise is far quieter than the noise it was cut from; the factor makes it a snap.
  const snapLevel = 1.2 + 4 * params.brightness
  const band = new BandPass()
  let phase = 0
  for (let i = 0; i < n; i += 1) {
    const t = i / FS
    // The pitch starts 60% high and is home within ~20 ms: the body settling after the strike.
    phase += (TAU * f * (1 + 0.6 * Math.exp(-t / 0.006))) / FS
    const body = Math.sin(phase) * Math.exp(-t / bodyDecay)
    const mode = 0.35 * Math.sin(TAU * f * 2.63 * t) * Math.exp(-t / modeDecay)
    const snap = snapLevel * band.step(noise(rng), snapCentre, 1.4) * Math.exp(-t / 0.005)
    // A quarter-millisecond rise: the snap is noise, and noise does not start at zero.
    out[i] = (body + mode + snap) * Math.min(1, t / 0.00025)
  }
  return finish(out)
}

/** Free-bar transverse modes, relative to the first. */
const BAR_MODES = [1, 2.756, 5.404, 8.933] as const

function bell(params: VoiceParams, rng: Rng): Float32Array {
  const n = Math.round(voiceSeconds('bell', params.size) * FS)
  const out = new Float32Array(n)
  const f = hz('bell', params.pitch)
  const decay = 0.32 * params.size
  const upper = 0.25 + 1.1 * params.brightness
  const partials = BAR_MODES.map((ratio, index) => ({
    frequency: f * ratio,
    level: index === 0 ? 1 : upper / (index + 1),
    decay: decay / ratio ** 0.9,
    phase: rng() * TAU
  })).filter((partial) => partial.frequency < FS * 0.42)
  // A twin a quarter of a percent sharp: two bars are never quite the same bar.
  partials.push({ frequency: f * 1.0025, level: 0.5, decay, phase: rng() * TAU })
  const strikeLevel = 0.15 + 0.35 * params.brightness
  let previous = 0
  for (let i = 0; i < n; i += 1) {
    const t = i / FS
    let sum = 0
    for (const partial of partials) {
      sum += partial.level * Math.sin(TAU * partial.frequency * t + partial.phase) * Math.exp(-t / partial.decay)
    }
    // Differenced noise is high-passed noise: the strike is all edge, no weight.
    const white = noise(rng)
    const strike = strikeLevel * (white - previous) * Math.exp(-t / 0.002)
    previous = white
    // A half-millisecond rise, because the partials start at arbitrary phase.
    out[i] = (sum + strike) * Math.min(1, t / 0.0005)
  }
  return finish(out)
}

function thump(params: VoiceParams, rng: Rng): Float32Array {
  const n = Math.round(voiceSeconds('thump', params.size) * FS)
  const out = new Float32Array(n)
  const rest = hz('thump', params.pitch)
  const decay = 0.13 * params.size
  // Brighter is a harder hit: more drive (more harmonics), a longer fall, more of the felt.
  const drive = 1.5 + 3 * params.brightness
  const fall = 1.5 + 2.5 * params.brightness
  const felt = lowPassCoefficient(250 + 600 * params.brightness)
  const feltLevel = 0.3 + 0.9 * params.brightness
  let phase = 0
  let low = 0
  for (let i = 0; i < n; i += 1) {
    const t = i / FS
    phase += (TAU * (rest + fall * rest * Math.exp(-t / 0.022))) / FS
    const attack = t < 0.003 ? 0.5 - 0.5 * Math.cos((Math.PI * t) / 0.003) : 1
    const tone = Math.tanh(drive * Math.sin(phase) * attack * Math.exp(-t / decay)) / Math.tanh(drive)
    low += felt * (noise(rng) - low)
    out[i] = tone + feltLevel * low * Math.exp(-t / 0.008)
  }
  return finish(out)
}

function drop(params: VoiceParams, rng: Rng): Float32Array {
  const n = Math.round(voiceSeconds('drop', params.size) * FS)
  const out = new Float32Array(n)
  const f = hz('drop', params.pitch)
  const decay = 0.045 * params.size
  const rise = 0.35 + 0.5 * params.brightness
  const band = new BandPass()
  let phase = 0
  for (let i = 0; i < n; i += 1) {
    const t = i / FS
    phase += (TAU * f * (1 + (rise * t) / decay)) / FS
    const attack = Math.min(1, t / 0.0015)
    const breath = 0.08 * band.step(noise(rng), f * 2, 2) * Math.exp(-t / 0.004)
    out[i] = (Math.sin(phase) * attack + breath) * Math.exp(-t / decay)
  }
  return finish(out)
}

const VOICES: Record<SfxMaterial, (params: VoiceParams, rng: Rng) => Float32Array> = { whoosh, knock, bell, thump, drop }

/** One hit of a material: mono, 48 kHz, peak 1. */
export function synthVoice(material: SfxMaterial, params: VoiceParams, rng: Rng): Float32Array {
  return VOICES[material](params, rng)
}
