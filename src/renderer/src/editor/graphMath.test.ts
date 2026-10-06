/**
 * The keyframe graph's arithmetic: where a key is drawn, what the curve between keys looks like,
 * and what a drag may do. The curve is checked against the sampler the compositor draws from.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/renderer/src/editor/graphMath.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Keyframe } from '@shared/project'
import { keyframeValueAt } from '@shared/keyframes'
import { dragKey, frameAtX, graphPath, graphRange, graphX, graphY, valueAtY, type GraphScale } from './graphMath'

const SCALE: GraphScale = { width: 240, height: 120, pad: 10, duration: 100, min: 0, max: 2 }
const WIDE = { min: -Infinity, max: Infinity }

test('a key is drawn where its frame and value say, and a point on the graph reads back as that frame and value', () => {
  assert.equal(graphX(0, SCALE), 10)
  assert.equal(graphX(100, SCALE), 230)
  assert.equal(graphX(50, SCALE), 120)
  // Larger values are higher up.
  assert.equal(graphY(2, SCALE), 10)
  assert.equal(graphY(0, SCALE), 110)
  for (const [frame, value] of [[0, 0], [37, 1.25], [100, 2]] as const) {
    assert.ok(Math.abs(frameAtX(graphX(frame, SCALE), SCALE) - frame) < 1e-9)
    assert.ok(Math.abs(valueAtY(graphY(value, SCALE), SCALE) - value) < 1e-9)
  }
})

test('the range shows every key with headroom, gives a flat curve height to drag in, and stays inside a 0..1 property', () => {
  const ramp: Keyframe[] = [{ frame: 0, value: 10 }, { frame: 50, value: 30 }]
  assert.deepEqual(graphRange(ramp, WIDE), { min: 8, max: 32 })
  const flat = graphRange([{ frame: 0, value: 5 }], WIDE)
  assert.ok(flat.min < 5 && flat.max > 5, 'a single key is not on the edge of its own graph')
  // Opacity keyed at 1 throughout: the top of the graph is 1, and there is still room below.
  const opaque = graphRange([{ frame: 0, value: 1 }, { frame: 20, value: 1 }], { min: 0, max: 1 })
  assert.equal(opaque.max, 1)
  assert.ok(opaque.min < 1 && opaque.min >= 0)
  const full = graphRange([{ frame: 0, value: 0 }, { frame: 20, value: 1 }], { min: 0, max: 1 })
  assert.deepEqual(full, { min: 0, max: 1 }, 'the headroom never shows values the property cannot take')
})

test('the curve drawn is the curve that plays: every sampled point is the sampler\'s value at that frame', () => {
  const keys: Keyframe[] = [{ frame: 0, value: 0, ease: 'inOut' }, { frame: 40, value: 2, ease: 'hold' }, { frame: 70, value: 1 }, { frame: 100, value: 1.5 }]
  const points = graphPath(keys, SCALE).split(/[ML]/).filter(Boolean).map((pair) => pair.trim().split(' ').map(Number))
  assert.equal(points.length, 101, 'one point per frame of a 100-frame clip')
  for (const [x, y] of points) {
    const frame = frameAtX(x!, SCALE)
    assert.ok(Math.abs(y! - graphY(keyframeValueAt(keys, frame)!, SCALE)) < 0.01, `frame ${frame}`)
  }
  // A hold is a step: flat until the next key, then there at once.
  const at = (frame: number): number => points[frame]![1]!
  assert.equal(at(69), at(41))
  assert.notEqual(at(70), at(69))
  assert.equal(graphPath([], SCALE), '')
})

test('a dragged key keeps a frame between its neighbours, stays on the clip and inside the property\'s range', () => {
  const keys: Keyframe[] = [{ frame: 10, value: 0.2 }, { frame: 40, value: 0.5, ease: 'out' }, { frame: 70, value: 0.9 }]
  const limits = { min: 0, max: 1 }
  // An ordinary move.
  assert.deepEqual(dragKey(keys, 1, 52.4, 0.75, 100, limits)[1], { frame: 52, value: 0.75, ease: 'out' })
  // Past the next key: stops one frame short of it, never swaps or lands on it.
  assert.equal(dragKey(keys, 1, 95, 0.5, 100, limits)[1]!.frame, 69)
  assert.equal(dragKey(keys, 1, -20, 0.5, 100, limits)[1]!.frame, 11)
  // The ends: the clip's own first and last frame.
  assert.equal(dragKey(keys, 0, -50, 0.2, 100, limits)[0]!.frame, 0)
  assert.equal(dragKey(keys, 2, 500, 0.9, 100, limits)[2]!.frame, 100)
  // Value: held to what the tool would accept.
  assert.equal(dragKey(keys, 1, 40, 7, 100, limits)[1]!.value, 1)
  assert.equal(dragKey(keys, 1, 40, -3, 100, limits)[1]!.value, 0)
  assert.equal(dragKey(keys, 1, 40, Number.NaN, 100, limits)[1]!.value, 0.5, 'a value that is not a number changes nothing')
  // Never edits its input, and the other keys are untouched.
  const moved = dragKey(keys, 1, 55, 0.6, 100, limits)
  assert.deepEqual(keys[1], { frame: 40, value: 0.5, ease: 'out' })
  assert.deepEqual([moved[0], moved[2]], [keys[0], keys[2]])
  // Two keys a frame apart leave the one between them nowhere to go: it stays.
  const tight: Keyframe[] = [{ frame: 10, value: 0 }, { frame: 11, value: 0.5 }, { frame: 12, value: 1 }]
  assert.equal(dragKey(tight, 1, 50, 0.5, 100, limits)[1]!.frame, 11)
})
