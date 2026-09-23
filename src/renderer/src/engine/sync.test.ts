import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item } from '@shared/project'
import { sourceSecondsAt } from './sync'

/**
 * The frame a video element shows for `currentTime`: the last one whose timestamp is at or before
 * it. Measured in bay's Chromium — a 24 fps take asked for 3.958333 s (0.33 µs short of frame 95)
 * showed frame 94.
 */
const shownFrame = (seconds: number, sourceFps: number): number => Math.floor(seconds * sourceFps)

const item = (sourceStartSeconds: number): Item =>
  // The rounding `edit_item { sourceStartSeconds }` applies (mcp/write.ts).
  ({ from: 100, sourceStartUs: Math.round(sourceStartSeconds * 1_000_000), speed: 1 }) as Item
const asset = { durationUs: 3_600_000_000 } as Asset

test('a clip cut on a source frame shows that frame and each one after it, never the one before', () => {
  for (const fps of [24, 25, 30, 30000 / 1001, 60]) {
    for (let inFrame = 0; inFrame < 240; inFrame += 1) {
      const clip = item(inFrame / fps)
      for (let k = 0; k < 120; k += 1) {
        const shown = shownFrame(sourceSecondsAt(clip, asset, clip.from + k, fps), fps)
        assert.equal(shown, inFrame + k, `${fps} fps, in-point frame ${inFrame}, timeline frame +${k}`)
      }
    }
  }
})

test('the specimen is one the unnudged time gets wrong', () => {
  // The measured case: s3 at 2.833333 s (frame 68), 27 frames in, is 3.958333 s — frame 94 by
  // timestamp, where 95 was asked. If this stops holding the test above proves nothing.
  const clip = item(68 / 24)
  const raw = (clip.sourceStartUs + Math.round((27 / 24) * 1_000_000)) / 1_000_000
  assert.equal(shownFrame(raw, 24), 94)
  assert.equal(shownFrame(sourceSecondsAt(clip, asset, clip.from + 27, 24), 24), 95)
})
