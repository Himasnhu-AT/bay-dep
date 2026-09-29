/**
 * Sync by sound, on synthetic level curves: speech-like bursts at random times, heard by two
 * "mics" at different gains, with their own noise, one starting later. The offset must come back
 * to within a window; unrelated audio and a metronome (every lag fits) must come back not
 * confident — the case beside each positive.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { correlationAt, crossCorrelate, findSyncOffset, onsetEnvelope, SYNC_WINDOW_SEC } from './audio-sync'

/** A seeded PRNG, so the specimens are the same on every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** Seconds of "speech": bursts of 0.1–0.6 s at random gaps, as dB per 10 ms window. */
function speech(seconds: number, seed: number): number[] {
  const random = rng(seed)
  const n = Math.round(seconds / SYNC_WINDOW_SEC)
  const out = Array.from({ length: n }, () => -60)
  let i = 0
  while (i < n) {
    i += Math.round((0.05 + random() * 0.4) / SYNC_WINDOW_SEC)
    const len = Math.round((0.1 + random() * 0.5) / SYNC_WINDOW_SEC)
    const level = -30 + random() * 15
    for (let k = i; k < Math.min(n, i + len); k += 1) out[k] = level + random() * 3
    i += len
  }
  return out
}

/** What a second mic hears of `source`: shifted by `lagSec`, quieter, with its own noise. */
function heardBy(source: number[], lagSec: number, gainDb: number, seed: number, length: number): number[] {
  const random = rng(seed)
  const lag = Math.round(lagSec / SYNC_WINDOW_SEC)
  return Array.from({ length }, (_, j) => {
    const v = source[j - lag]
    const base = v === undefined ? -60 : v + gainDb
    return Math.max(base, -58 + random() * 4)
  })
}

test('crossCorrelate matches the direct sum at every lag, including negative ones', () => {
  const a = [1, -2, 3, 0.5, -1]
  const b = [0.5, 2, -1]
  const c = crossCorrelate(a, b)
  for (let lag = -(b.length - 1); lag <= a.length - 1; lag += 1) {
    let direct = 0
    for (let i = 0; i < a.length; i += 1) if (i - lag >= 0 && i - lag < b.length) direct += a[i]! * b[i - lag]!
    assert.ok(Math.abs(c[lag + b.length - 1]! - direct) < 1e-9, `lag ${lag}: ${c[lag + b.length - 1]} vs ${direct}`)
  }
})

test('the onset envelope ignores a constant gain difference', () => {
  const a = speech(10, 3)
  const quieter = a.map((v) => v - 12)
  const ea = onsetEnvelope(a)
  const eb = onsetEnvelope(quieter)
  assert.ok(correlationAt(ea, eb, 0) > 0.99)
})

test('a camera that started 2.37 s after the mic is found at +2.37 s, confidently', () => {
  const mic = speech(60, 7)
  // The camera's recording starts 2.37 s into the event: its sample j is the mic's j + 237.
  const camera = heardBy(mic, -2.37, -9, 11, 5000)
  const found = findSyncOffset(mic, camera)
  assert.ok(found, 'an offset')
  assert.ok(Math.abs(found.offsetSec - 2.37) <= SYNC_WINDOW_SEC, JSON.stringify(found))
  assert.equal(found.confident, true, JSON.stringify(found))
  assert.ok(found.correlation >= 0.6 && found.peakRatio >= 2, JSON.stringify(found))
})

test('a clip that started first comes back negative', () => {
  const mic = speech(40, 21)
  const camera = heardBy(mic, 1.5, -3, 5, 4500)
  const found = findSyncOffset(mic, camera)!
  assert.ok(Math.abs(found.offsetSec + 1.5) <= SYNC_WINDOW_SEC, JSON.stringify(found))
  assert.equal(found.confident, true)
})

test('unrelated recordings are not confident', () => {
  const found = findSyncOffset(speech(40, 1), speech(40, 99))!
  assert.equal(found.confident, false, JSON.stringify(found))
  assert.ok(found.correlation < 0.2, JSON.stringify(found))
})

test('a metronome fits many lags, so its peak ratio is too low to trust', () => {
  const click = (offset: number) => Array.from({ length: 3000 }, (_, i) => ((i + offset) % 50 < 5 ? -20 : -60))
  const found = findSyncOffset(click(0), click(13))!
  assert.equal(found.confident, false, JSON.stringify(found))
  assert.ok(found.peakRatio < 1.3, JSON.stringify(found))
})

test('too little shared sound at any lag is no answer', () => {
  assert.equal(findSyncOffset(speech(1, 2), speech(1, 3)), null)
})
