/**
 * How live playback runs a clip's element (`transportFor` in `./sync`): played at a rate, or
 * stepped frame by frame when an element cannot play it — backwards, or slower than it will go.
 *
 * This decides only what the preview asks of the element. Whether the stepped picture keeps up is
 * a property of the running app (`test/app/speed.mjs`), not of this function.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item } from '@shared/project'
import { playbackRateFor, sourceSecondsAt, transportFor } from './sync'

function clip(over: Partial<Item> = {}): Item {
  return {
    id: 'c', assetId: 'a', trackId: 't', from: 100, durationInFrames: 90, sourceStartUs: 2_000_000,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...over
  }
}

const ASSET = { durationUs: 10_000_000 } as Asset

test('a clip at one forward speed plays at that rate, exactly as it did', () => {
  for (const speed of [0.1, 0.5, 1, 2, 16, 40]) {
    assert.deepEqual(transportFor(clip({ speed }), 120), { mode: 'play', rate: playbackRateFor(speed) })
  }
})

test('a reversed clip is stepped, whatever its speed, and each step asks for an earlier moment', () => {
  const reversed = clip({ reverse: true, sourceStartUs: 5_000_000 })
  assert.deepEqual(transportFor(reversed, 100), { mode: 'step' })
  assert.deepEqual(transportFor({ ...reversed, speed: 2 }, 150), { mode: 'step' })
  let previous = Number.POSITIVE_INFINITY
  for (let frame = 100; frame < 190; frame += 1) {
    const seconds = sourceSecondsAt(reversed, ASSET, frame, 30)
    assert.ok(seconds < previous, `frame ${frame} is earlier in the file than the one before`)
    previous = seconds
  }
  // First frame: the last of its footage. Last frame: the first (2 s), plus the frame-edge margin.
  assert.ok(Math.abs(sourceSecondsAt(reversed, ASSET, 100, 30) - (5 - 1 / 30 + 0.0005)) < 1e-5)
  assert.ok(Math.abs(sourceSecondsAt(reversed, ASSET, 189, 30) - 2.0005) < 1e-5)
})

test('under a ramp the rate is the curve’s at that frame, and a hold is stepped rather than played at 0', () => {
  const ramped = clip({
    keyframes: {
      speed: [
        { frame: 0, value: 1, ease: 'hold' },
        { frame: 30, value: 0, ease: 'hold' },
        { frame: 54, value: 0.25, ease: 'hold' },
        { frame: 70, value: 2 }
      ]
    }
  })
  assert.deepEqual(transportFor(ramped, 110), { mode: 'play', rate: 1 })
  assert.deepEqual(transportFor(ramped, 130), { mode: 'step' }, 'a held frame cannot be played')
  assert.deepEqual(transportFor(ramped, 153), { mode: 'step' })
  assert.deepEqual(transportFor(ramped, 154), { mode: 'play', rate: 0.25 })
  assert.deepEqual(transportFor(ramped, 175), { mode: 'play', rate: 2 })
  // Slower than an element will go is stepped too, not clamped up to a rate the clip is not at.
  assert.deepEqual(transportFor(clip({ keyframes: { speed: [{ frame: 0, value: 0.05 }] } }), 120), { mode: 'step' })
  assert.deepEqual(transportFor(clip({ keyframes: { speed: [{ frame: 0, value: 0.0625 }] } }), 120), { mode: 'play', rate: 0.0625 })
})
