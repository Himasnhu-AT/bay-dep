import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cacheKey, clampToAsset } from './compositionPool'
import type { Asset } from '@shared/project'

const asset = (durationUs: number): Asset => ({
  id: 'a1',
  kind: 'html',
  name: 'comp.html',
  path: '/tmp/comp.html',
  durationUs,
  width: 1920,
  height: 1080,
  fps: null,
  hasAudio: false,
  hasVideo: true,
  posterPath: null,
  waveformPath: null,
  createdAt: 0,
  compositionId: 'hero'
})

test('the key separates two sizes of the same instant', () => {
  // A preview asking for 960x540 and an export asking for 1920x1080 are different pictures.
  // Serving one for the other is the bug that makes an export look soft and nothing report it.
  assert.notEqual(cacheKey('a1', 960, 540, 1000), cacheKey('a1', 1920, 1080, 1000))
})

test('the key separates two assets at the same instant and size', () => {
  assert.notEqual(cacheKey('a1', 960, 540, 1000), cacheKey('a2', 960, 540, 1000))
})

test('the same request produces the same key, which is what makes a re-scrub a hit', () => {
  assert.equal(cacheKey('a1', 960, 540, 41666), cacheKey('a1', 960, 540, 41666))
})

test('adjacent frames do not collide', () => {
  // 24fps: consecutive frames are 41666us apart. A key that rounded to some coarser grid
  // would serve frame N's picture for frame N+1 and the motion would visibly step.
  const oneFrame = Math.round(1_000_000 / 24)
  assert.notEqual(cacheKey('a1', 960, 540, oneFrame), cacheKey('a1', 960, 540, oneFrame * 2))
})

test('past the end clamps to the end, so a held tail is one entry and not hundreds', () => {
  const a = asset(6_000_000)

  // Every frame past the end is the same picture — a GSAP timeline holds its last frame. An
  // unclamped key would open a distinct cache entry for each one.
  assert.equal(clampToAsset(9_000_000, a), a.durationUs)
  assert.equal(
    cacheKey(a.id, 960, 540, clampToAsset(7_000_000, a)),
    cacheKey(a.id, 960, 540, clampToAsset(9_000_000, a))
  )
})

test('inside the composition is left exactly alone', () => {
  // The positive control: a clamp that clamped everything would pass the test above and be
  // useless, because every frame would key to the end.
  const a = asset(6_000_000)
  assert.equal(clampToAsset(2_500_000, a), 2_500_000)
  assert.equal(clampToAsset(0, a), 0)
  assert.equal(clampToAsset(a.durationUs, a), a.durationUs)
})

test('a negative or non-finite time is the start, not a throw and not the end', () => {
  // Every non-finite value goes to 0, Infinity included. Neither end of the composition is
  // "correct" for a time that arithmetic produced by accident — an item with speed NaN, say —
  // so the useful property is that they all agree. Sending Infinity to the last frame instead
  // would make a corrupted clip show its ending, which reads as an edit rather than a fault.
  const a = asset(6_000_000)
  assert.equal(clampToAsset(-1, a), 0)
  assert.equal(clampToAsset(NaN, a), 0)
  assert.equal(clampToAsset(Infinity, a), 0)
  assert.equal(clampToAsset(-Infinity, a), 0)
})

test('a zero-duration asset cannot produce a time past zero', () => {
  // An html asset that failed to parse has durationUs 0. Asking it for frame 400 must not
  // key on 400 distinct entries of a composition that has no frames at all.
  assert.equal(clampToAsset(5_000_000, asset(0)), 0)
})
