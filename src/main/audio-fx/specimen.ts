/**
 * Test support for the audio-effect suites: specimens made by bay's ffmpeg, rendered through a
 * filter graph by it, and measured here in TypeScript — so a level in an assertion is a number
 * this file computed from samples, not one ffmpeg reported about itself.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const RATE = 48_000

/** A WAV of `expression` (an `aevalsrc` expression in `t`), mono unless two are given as `a|b`. */
export function synth(ffmpeg: string, dir: string, name: string, expression: string, seconds: number): string {
  const path = join(dir, `${name}.wav`)
  execFileSync(ffmpeg, [
    '-v', 'error', '-y', '-f', 'lavfi',
    '-i', `aevalsrc='${expression}':s=${RATE}:d=${seconds}`,
    '-c:a', 'pcm_f32le', path
  ])
  return path
}

/** A sine at `frequency` whose peak is `db` dBFS, as an `aevalsrc` term. */
export function sineTerm(frequency: number, db: number): string {
  return `${Math.pow(10, db / 20).toFixed(8)}*sin(2*PI*${frequency}*t)`
}

/** The first channel of `path` as 48 kHz float samples. */
export function decode(ffmpeg: string, path: string, channel: 0 | 1 = 0): Float32Array {
  const out = `${path}.c${channel}.f32`
  execFileSync(ffmpeg, [
    '-v', 'error', '-y', '-i', path,
    '-af', `aresample=${RATE},pan=mono|c0=c${channel}`,
    '-f', 'f32le', '-c:a', 'pcm_f32le', out
  ])
  const bytes = readFileSync(out)
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4)).slice()
}

/** Renders `input` through a `-filter_complex` whose output label is `label` into a float WAV. */
export function render(ffmpeg: string, inputs: readonly string[], graph: string, label: string, output: string, seconds?: number): string {
  execFileSync(ffmpeg, [
    '-v', 'error', '-y',
    ...inputs.flatMap((i) => ['-i', i]),
    '-filter_complex', graph, '-map', `[${label}]`,
    ...(seconds === undefined ? [] : ['-t', String(seconds)]),
    '-c:a', 'pcm_f32le', output
  ])
  return output
}

/** Peak amplitude, in dB, of one frequency over `[start, start + length)` samples (Goertzel, Hann-free: pick whole cycles). */
export function toneDb(samples: Float32Array, frequency: number, start: number, length: number): number {
  const w = (2 * Math.PI * frequency) / RATE
  const c = 2 * Math.cos(w)
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < length; i += 1) {
    const s0 = (samples[start + i] ?? 0) + c * s1 - s2
    s2 = s1
    s1 = s0
  }
  const amplitude = Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / (length / 2)
  return 20 * Math.log10(Math.max(amplitude, 1e-12))
}

export function rmsDb(samples: Float32Array, start: number, length: number): number {
  let sum = 0
  for (let i = 0; i < length; i += 1) {
    const s = samples[start + i] ?? 0
    sum += s * s
  }
  return 10 * Math.log10(Math.max(sum / Math.max(1, length), 1e-24))
}

export function peakDb(samples: Float32Array, start: number, length: number): number {
  let peak = 0
  for (let i = 0; i < length; i += 1) {
    const m = Math.abs(samples[start + i] ?? 0)
    if (m > peak) peak = m
  }
  return 20 * Math.log10(Math.max(peak, 1e-12))
}

/**
 * A `BiquadFilterNode` as the Web Audio specification defines it, applied to samples — the
 * preview's arithmetic, written from the spec (Q in dB for the two passes, fixed-slope shelves)
 * rather than from `@shared/audio-effects`, so a test comparing the two is not comparing a
 * function with itself.
 */
export function nodeFilter(node: { type: string; frequency: number; Q: number; gain: number }, input: Float32Array): Float32Array {
  const w0 = (2 * Math.PI * node.frequency) / RATE
  const cos = Math.cos(w0)
  const sin = Math.sin(w0)
  const A = Math.pow(10, node.gain / 40)
  const aQ = sin / (2 * node.Q)
  const aQdB = sin / (2 * Math.pow(10, node.Q / 20))
  const aS = (sin / 2) * Math.SQRT2
  const k = 2 * aS * Math.sqrt(A)
  let c: [number, number, number, number, number, number]
  if (node.type === 'lowpass') c = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + aQdB, -2 * cos, 1 - aQdB]
  else if (node.type === 'highpass') c = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + aQdB, -2 * cos, 1 - aQdB]
  else if (node.type === 'peaking') c = [1 + aQ * A, -2 * cos, 1 - aQ * A, 1 + aQ / A, -2 * cos, 1 - aQ / A]
  else if (node.type === 'lowshelf') {
    c = [A * (A + 1 - (A - 1) * cos + k), 2 * A * (A - 1 - (A + 1) * cos), A * (A + 1 - (A - 1) * cos - k), A + 1 + (A - 1) * cos + k, -2 * (A - 1 + (A + 1) * cos), A + 1 + (A - 1) * cos - k]
  } else {
    c = [A * (A + 1 + (A - 1) * cos + k), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - k), A + 1 - (A - 1) * cos + k, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - k]
  }
  const [b0, b1, b2, a0, a1, a2] = c
  const out = new Float32Array(input.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < input.length; i += 1) {
    const x = input[i]!
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    out[i] = y
  }
  return out
}
