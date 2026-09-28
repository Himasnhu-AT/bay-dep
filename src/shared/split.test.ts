/**
 * Cutting a clip in two: the halves play exactly what the whole did, and a transition out of the
 * clip moves to the right half, whose end is now the cut it sits on. Without that, splitting the
 * outgoing clip of a dissolve left the dissolve naming a clip that no longer ends at the cut.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitItemAt } from './split'
import type { Item, Transition } from './project'

const clip = (id: string, from: number, duration: number, extra: Partial<Item> = {}): Item => ({
  id, assetId: 'a', trackId: 'v1', from, durationInFrames: duration, sourceStartUs: 0,
  layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
  volume: 1, fadeInFrames: 4, fadeOutFrames: 6, speed: 1, ...extra
})

test('the halves play what the whole did', () => {
  const whole = clip('x', 30, 90, { sourceStartUs: 1_000_000, speed: 2 })
  const right = splitItemAt(whole, 60, 30, 'y')!
  assert.deepEqual([whole.from, whole.durationInFrames, whole.fadeInFrames], [30, 30, 4])
  // 30 frames at 2× is 2 s of source past the in-point.
  assert.deepEqual([right.from, right.durationInFrames, right.sourceStartUs, right.fadeInFrames, right.fadeOutFrames], [60, 60, 3_000_000, 0, 6])
  assert.equal(splitItemAt(whole, 30, 30, 'z'), null, 'a cut on an edge is not a cut')
})

test('a transition out of the split clip moves to the right half; one into it stays on the left', () => {
  const middle = clip('middle', 30, 60)
  const transitions: Transition[] = [
    { id: 'in', kind: 'cross-dissolve', fromItemId: 'before', toItemId: 'middle', durationInFrames: 10 },
    { id: 'out', kind: 'cross-dissolve', fromItemId: 'middle', toItemId: 'after', durationInFrames: 10 }
  ]
  const right = splitItemAt(middle, 60, 30, 'middle-2', transitions)!
  assert.equal(transitions[1]!.fromItemId, 'middle-2')
  assert.equal(right.from + right.durationInFrames, 90, 'the right half ends at the cut the transition sits on')
  assert.deepEqual([transitions[0]!.fromItemId, transitions[0]!.toItemId], ['before', 'middle'])
})
