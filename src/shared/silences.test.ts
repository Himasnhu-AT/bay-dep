/**
 * Silence → frames, through a clip's position, in-point and speed; the "every mic silent" rule;
 * padding and inward rounding. The in-point case matters because `silencedetect` reports seconds
 * from the start of the span it read, which for a clip is its in-point — a mapping that added the
 * in-point again would cut words (the test would move by exactly sourceStartUs).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commonSilence, framesRemoved, removalRanges, silenceFrames, SILENCE_DEFAULTS } from './silences'

const FPS = 30

test('a silence maps through the clip position and speed; the in-point is already in the span', () => {
  // Clip at frame 100, speed 1: a silence 2–3 s into what it plays is frames 160–190.
  assert.deepEqual(silenceFrames({ from: 100, durationInFrames: 300, speed: 1 }, [{ startSec: 2, endSec: 3 }], FPS), [
    { from: 160, to: 190 }
  ])
  // At 2× the same two source seconds pass in one timeline second: frames 130–145.
  assert.deepEqual(silenceFrames({ from: 100, durationInFrames: 300, speed: 2 }, [{ startSec: 2, endSec: 3 }], FPS), [
    { from: 130, to: 145 }
  ])
  // At 0.5× they take four.
  assert.deepEqual(silenceFrames({ from: 0, durationInFrames: 300, speed: 0.5 }, [{ startSec: 1, endSec: 2 }], FPS), [
    { from: 60, to: 120 }
  ])
})

test('a silence running past the clip is clipped to it; one outside it is dropped', () => {
  const clip = { from: 0, durationInFrames: 90, speed: 1 }
  assert.deepEqual(silenceFrames(clip, [{ startSec: 2, endSec: 10 }, { startSec: 4, endSec: 5 }], FPS), [{ from: 60, to: 90 }])
})

test('with several mics a moment is silent only where every mic that plays it is silent', () => {
  const host = { clip: { from: 0, durationInFrames: 300, speed: 1 }, silent: [{ from: 30, to: 120 }, { from: 200, to: 260 }] }
  const guest = { clip: { from: 0, durationInFrames: 300, speed: 1 }, silent: [{ from: 0, to: 60 }, { from: 90, to: 150 }, { from: 210, to: 300 }] }
  assert.deepEqual(commonSilence([host, guest]), [
    { from: 30, to: 60 },
    { from: 90, to: 120 },
    { from: 210, to: 260 }
  ])
  // One mic alone: its own silences.
  assert.deepEqual(commonSilence([host]), host.silent)
})

test('where only one clip plays, its silence counts; where none plays, nothing is silent', () => {
  const early = { clip: { from: 0, durationInFrames: 100, speed: 1 }, silent: [{ from: 80, to: 100 }] }
  const late = { clip: { from: 100, durationInFrames: 100, speed: 1 }, silent: [{ from: 100, to: 130 }] }
  // Abutting clips on one track: the pause spans the join.
  assert.deepEqual(commonSilence([early, late]), [{ from: 80, to: 130 }])
  const gap = { clip: { from: 200, durationInFrames: 50, speed: 1 }, silent: [] }
  assert.deepEqual(commonSilence([early, gap]), [{ from: 80, to: 100 }], 'a gap between clips is not a silence to cut')
})

test('padding is kept at each side and ranges round inwards to whole frames', () => {
  const pad = SILENCE_DEFAULTS.keepPaddingSec * FPS // 6 frames
  assert.deepEqual(removalRanges([{ from: 30, to: 90 }], pad), [{ fromFrame: 36, toFrame: 84 }])
  // Fractional bounds never remove a frame that is not wholly silent.
  assert.deepEqual(removalRanges([{ from: 30.4, to: 89.6 }], 0), [{ fromFrame: 31, toFrame: 89 }])
  // A pause shorter than twice the padding leaves nothing.
  assert.deepEqual(removalRanges([{ from: 30, to: 41 }], pad), [])
  assert.equal(framesRemoved([{ fromFrame: 36, toFrame: 84 }, { fromFrame: 100, toFrame: 110 }]), 58)
})

test('the defaults: -30 dBFS, 0.5 s pauses, 0.2 s kept each side', () => {
  assert.deepEqual({ ...SILENCE_DEFAULTS }, { thresholdDb: -30, minSilenceSec: 0.5, keepPaddingSec: 0.2 })
})
