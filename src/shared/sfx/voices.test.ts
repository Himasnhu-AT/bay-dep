/**
 * The five voices, measured. Run with `pnpm test`.
 *
 * A voice is what its spectrum is: a "thump" whose energy sat at 4 kHz would still be called a
 * thump, still render, and be a click. So each material is put through a Fourier transform and
 * its energy is asserted to be where the material's job says it must be — and, as the control
 * that the measurement can tell materials apart at all, absent from where another's is.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rng } from './rng'
import { SFX_MATERIALS, SFX_MATERIAL_NAMES, SFX_SAMPLE_RATE, type SfxMaterial } from './score'
import { synthVoice, voiceSeconds, type VoiceParams } from './voices'

const FS = SFX_SAMPLE_RATE
const HOME: VoiceParams = { pitch: 0, size: 1, brightness: 0.5 }

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const r = re[i]!
      re[i] = re[j]!
      re[j] = r
      const m = im[i]!
      im[i] = im[j]!
      im[j] = m
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const step = (-2 * Math.PI) / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k += 1) {
        const wr = Math.cos(step * k)
        const wi = Math.sin(step * k)
        const a = start + k
        const b = a + size / 2
        const xr = re[b]! * wr - im[b]! * wi
        const xi = re[b]! * wi + im[b]! * wr
        re[b] = re[a]! - xr
        im[b] = im[a]! - xi
        re[a] = re[a]! + xr
        im[a] = im[a]! + xi
      }
    }
  }
}

/** Power per FFT bin, and the Hz one bin spans. */
function spectrum(samples: Float32Array): { power: Float64Array; binHz: number } {
  const n = 2 ** Math.ceil(Math.log2(samples.length))
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  re.set(samples)
  fft(re, im)
  const power = new Float64Array(n / 2)
  for (let k = 0; k < n / 2; k += 1) power[k] = re[k]! ** 2 + im[k]! ** 2
  return { power, binHz: FS / n }
}

/** Share of the energy between two frequencies, 0–1. */
function share(samples: Float32Array, fromHz: number, toHz: number): number {
  const { power, binHz } = spectrum(samples)
  let inside = 0
  let total = 0
  for (let k = 1; k < power.length; k += 1) {
    total += power[k]!
    if (k * binHz >= fromHz && k * binHz < toHz) inside += power[k]!
  }
  return inside / total
}

function centroid(samples: Float32Array): number {
  const { power, binHz } = spectrum(samples)
  let weighted = 0
  let total = 0
  for (let k = 1; k < power.length; k += 1) {
    weighted += k * binHz * power[k]!
    total += power[k]!
  }
  return weighted / total
}

function loudestHz(samples: Float32Array): number {
  const { power, binHz } = spectrum(samples)
  let best = 1
  for (let k = 1; k < power.length; k += 1) if (power[k]! > power[best]!) best = k
  return best * binHz
}

const voice = (material: SfxMaterial, params: Partial<VoiceParams> = {}, seed = 1): Float32Array =>
  synthVoice(material, { ...HOME, ...params }, rng(seed))

test('the spectrum measurement finds a known tone where it is, and nowhere else', () => {
  // The instrument first: a 1 kHz sine must read as 1 kHz, or nothing below means anything.
  const tone = new Float32Array(FS / 2).map((_, i) => Math.sin((2 * Math.PI * 1000 * i) / FS))
  assert.ok(Math.abs(loudestHz(tone) - 1000) < 3)
  assert.ok(share(tone, 900, 1100) > 0.99)
  assert.ok(share(tone, 20, 500) < 0.001)
  assert.ok(Math.abs(centroid(tone) - 1000) < 20)
})

/** Where each material's energy must be for it to do its job, and where it must not be. */
const HOME_BAND: Record<SfxMaterial, { from: number; to: number; atLeast: number; absent: [number, number] }> = {
  // Air: mid band, no weight underneath.
  whoosh: { from: 300, to: 6000, atLeast: 0.9, absent: [20, 150] },
  // A dry knock: a low body, not a sub.
  knock: { from: 120, to: 700, atLeast: 0.75, absent: [20, 80] },
  // A struck bar at 880 Hz and its partials.
  bell: { from: 700, to: 9000, atLeast: 0.95, absent: [20, 400] },
  // Weight: under 150 Hz, and nothing a small click would have.
  thump: { from: 20, to: 150, atLeast: 0.9, absent: [1000, 24000] },
  // A rounded pop: a rising resonance from 520 Hz.
  drop: { from: 450, to: 1600, atLeast: 0.9, absent: [20, 250] }
}

for (const material of SFX_MATERIAL_NAMES) {
  test(`${material}: its energy is where a ${material} lives, and not where it must not be`, () => {
    const band = HOME_BAND[material]
    const samples = voice(material)
    const inside = share(samples, band.from, band.to)
    assert.ok(inside >= band.atLeast, `${(inside * 100).toFixed(1)}% between ${band.from} and ${band.to} Hz; needs ${band.atLeast * 100}%`)
    const stray = share(samples, band.absent[0], band.absent[1])
    assert.ok(stray < 0.03, `${(stray * 100).toFixed(1)}% between ${band.absent[0]} and ${band.absent[1]} Hz, where a ${material} has none`)
  })
}

test('the bands tell the materials apart: no other material passes as a thump, and a thump passes as nothing else', () => {
  // The control for the test above — a band that every material satisfied would prove nothing.
  const thumpBand = HOME_BAND.thump
  for (const material of SFX_MATERIAL_NAMES.filter((name) => name !== 'thump')) {
    assert.ok(share(voice(material), thumpBand.from, thumpBand.to) < 0.2, `${material} is not weight`)
    const own = HOME_BAND[material]
    assert.ok(share(voice('thump'), own.from, own.to) < 0.2, `a thump is not a ${material}`)
  }
})

test('a thump keeps its weight at every size and brightness, and across the pitch range it is still below a knock', () => {
  for (const size of [0.25, 1, 4]) {
    for (const brightness of [0, 1]) {
      const low = share(voice('thump', { size, brightness }), 20, 200)
      assert.ok(low > 0.9, `size ${size} brightness ${brightness}: ${(low * 100).toFixed(1)}% under 200 Hz`)
    }
  }
  assert.ok(centroid(voice('thump', { pitch: 12 })) < centroid(voice('knock', { pitch: -12 })))
})

test('every voice is peak 1, starts and ends at rest, and lasts as long as voiceSeconds says', () => {
  for (const material of SFX_MATERIAL_NAMES) {
    for (const size of [0.25, 1, 2]) {
      const samples = voice(material, { size })
      assert.equal(samples.length, Math.round(voiceSeconds(material, size) * FS), `${material} × ${size}`)
      let peak = 0
      for (const s of samples) peak = Math.max(peak, Math.abs(s))
      assert.ok(Math.abs(peak - 1) < 1e-6, `${material} × ${size} peaks at ${peak}`)
      assert.ok(Math.abs(samples[0]!) < 0.05, `${material} starts at ${samples[0]}`)
      assert.ok(samples[samples.length - 1] === 0, `${material} ends at rest`)
      for (const s of samples) assert.ok(Number.isFinite(s))
    }
    assert.equal(voiceSeconds(material, 1), SFX_MATERIALS[material].seconds)
  }
})

test('pitch moves a voice by the interval asked: an octave doubles the bell, and every material rises', () => {
  const home = loudestHz(voice('bell'))
  assert.ok(Math.abs(home - SFX_MATERIALS.bell.homeHz) < 12, `the bell sounds at ${home} Hz`)
  assert.ok(Math.abs(loudestHz(voice('bell', { pitch: 12 })) / home - 2) < 0.03)
  assert.ok(Math.abs(loudestHz(voice('bell', { pitch: -12 })) / home - 0.5) < 0.03)
  // A fifth is 2^(7/12).
  assert.ok(Math.abs(loudestHz(voice('bell', { pitch: 7 })) / home - 2 ** (7 / 12)) < 0.03)
  for (const material of SFX_MATERIAL_NAMES) {
    assert.ok(centroid(voice(material, { pitch: 12 })) > centroid(voice(material, { pitch: -12 })) * 1.5, material)
  }
})

test('brightness is brightness: every material’s spectral centroid rises with it', () => {
  for (const material of SFX_MATERIAL_NAMES) {
    const dark = centroid(voice(material, { brightness: 0 }))
    const bright = centroid(voice(material, { brightness: 1 }))
    assert.ok(bright > dark * 1.05, `${material}: ${dark.toFixed(0)} Hz dark, ${bright.toFixed(0)} Hz bright`)
  }
})

test('no voice is a bare sine: none has more than 97% of its energy within a semitone of one frequency… except weight', () => {
  // "One sine beep per event" is what the palette replaces. A pure tone has ~100% of its
  // energy in one narrow band; a voice with partials, a transient or a moving pitch does not.
  const narrow = (samples: Float32Array): number => {
    const at = loudestHz(samples)
    return share(samples, at / 2 ** (1 / 12), at * 2 ** (1 / 12))
  }
  const sine = new Float32Array(FS / 2).map((_, i) => Math.sin((2 * Math.PI * 880 * i) / FS))
  assert.ok(narrow(sine) > 0.99, 'the control: a sine is narrow by this measure')
  for (const material of SFX_MATERIAL_NAMES) {
    assert.ok(narrow(voice(material)) < 0.97, `${material}: ${(narrow(voice(material)) * 100).toFixed(1)}% in one semitone`)
  }
})

test('the noise in a voice is the seed’s: the same seed is the same samples, another seed is not', () => {
  for (const material of SFX_MATERIAL_NAMES) {
    assert.deepEqual(voice(material, {}, 7), voice(material, {}, 7), material)
    assert.notDeepEqual(voice(material, {}, 7), voice(material, {}, 8), material)
  }
})
