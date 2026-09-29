import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatTimecode } from '@shared/project'
import { easeProgress, NAMED_EASES } from '@shared/ease'
import { spokenTimecode, timecodeEntry } from './timecode'
import { bezierOf, curvePath, describeBezier, easeFromBezier, presetOf, snapHandle, HANDLE_Y, HANDLE_Y_UNIT } from './ease'

// -- timecode ------------------------------------------------------------------------------------

test('timecode round trip: what the field shows, typed back, is the same frame', () => {
  for (const fps of [24, 25, 30, 60]) {
    for (let frames = 0; frames < fps * 7400; frames += 997) {
      const shown = formatTimecode(frames, fps, true)
      assert.equal(timecodeEntry(shown, fps, 0), frames, `${frames} at ${fps} shown as ${shown}`)
    }
  }
})

test('a field reads absolute times the ways a person types them', () => {
  assert.equal(timecodeEntry('00:00:04:15', 30, 999), 135)
  assert.equal(timecodeEntry('4:15', 30, 999), 135)
  assert.equal(timecodeEntry('4.5s', 30, 999), 135)
  assert.equal(timecodeEntry('135f', 30, 999), 135)
  // A bare number is seconds, as everywhere in bay.
  assert.equal(timecodeEntry('2', 30, 999), 60)
  assert.equal(timecodeEntry('soon', 30, 999), null)
})

test('a signed entry is a distance from what the field holds', () => {
  assert.equal(timecodeEntry('+15f', 30, 100), 115)
  assert.equal(timecodeEntry('-1s', 30, 100), 70)
  assert.equal(timecodeEntry('+0:10', 30, 100), 110)
  // The distance is from the current value, not from zero: the same entry lands elsewhere.
  assert.equal(timecodeEntry('+15f', 30, 0), 15)
})

test('a duration is spoken in words, frames always, larger units only when there are some', () => {
  assert.equal(spokenTimecode(0, 30), '0 frames')
  assert.equal(spokenTimecode(12, 30), '12 frames')
  assert.equal(spokenTimecode(30, 30), '1 second')
  assert.equal(spokenTimecode(30 * 64 + 15, 30), '1 minute, 4 seconds, 15 frames')
  assert.equal(spokenTimecode(30 * 3600 + 1, 30), '1 hour, 1 frame')
})

// -- ease ----------------------------------------------------------------------------------------

test('handles on the diagonal are linear, and a preset’s own handles store its name', () => {
  assert.equal(easeFromBezier([0, 0, 1, 1]), 'linear')
  assert.equal(easeFromBezier([0.3, 0.3, 0.6, 0.6]), 'linear')
  assert.equal(easeFromBezier([...NAMED_EASES.in]), 'in')
  assert.equal(easeFromBezier([...NAMED_EASES.out]), 'out')
  assert.equal(easeFromBezier([...NAMED_EASES.inOut]), 'inOut')
  assert.deepEqual(easeFromBezier([0.2, 1.3, 0.7, 1]), [0.2, 1.3, 0.7, 1])
})

test('a handle cannot run time backwards, and its overshoot is bounded', () => {
  assert.deepEqual(easeFromBezier([-0.4, 0.5, 1.7, 0.5]), [0, 0.5, 1, 0.5])
  assert.deepEqual(easeFromBezier([0.2, 9, 0.8, -9]), [0.2, HANDLE_Y.max, 0.8, HANDLE_Y.min])
})

test('bezier round trip: every ease draws with handles that store it again', () => {
  for (const ease of ['in', 'out', 'inOut', [0.1, 0.8, 0.3, 1.2]] as const) {
    const handles = bezierOf(ease as never)!
    assert.deepEqual(easeFromBezier(handles), ease)
  }
  assert.equal(bezierOf('hold'), null)
  assert.equal(presetOf(undefined), 'linear')
  assert.equal(presetOf([0.42, 0, 1, 1]), 'in')
  assert.equal(presetOf([0.2, 1.3, 0.7, 1]), 'custom')
})

test('a transition’s editor keeps its handles inside 0..1; a keyframe’s may overshoot', () => {
  assert.deepEqual(easeFromBezier([0.2, 1.4, 0.8, -0.3], HANDLE_Y_UNIT), [0.2, 1, 0.8, 0])
  assert.deepEqual(easeFromBezier([0.2, 1.4, 0.8, -0.3]), [0.2, 1.4, 0.8, -0.3])
})

test('Shift snaps a handle to 0.05', () => {
  assert.equal(snapHandle(0.4321), 0.45)
  assert.equal(snapHandle(0.4249), 0.4)
  assert.equal(snapHandle(-0.12), -0.1)
})

test('the drawn curve is the sampled curve: its ends at 0 and 1, its middle where the sampler says', () => {
  const path = curvePath('inOut', 100, 100, 0, 1, 4)
  const points = path.slice(2).split(' L ').map((p) => p.split(',').map(Number))
  assert.deepEqual(points[0], [0, 100])
  assert.deepEqual(points.at(-1), [100, 0])
  // The middle sample, at t = 0.5: y = 100 − 100 × easeProgress.
  assert.ok(Math.abs(points[2]![1]! - (100 - 100 * easeProgress('inOut', 0.5))) < 0.01)
  assert.equal(describeBezier('inOut'), 'cubic-bezier(0.42, 0, 0.58, 1)')
})
