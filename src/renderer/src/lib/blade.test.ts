import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snapFrame } from './snap'
import { bladeFrame, clipZone, nearerEdge } from './blade'

/** A clip at 30–90. */
const clip = { from: 30, durationInFrames: 60 }
const noSnap = (frame: number): number => Math.round(frame)

test('a blade click cuts at the frame under the pointer', () => {
  assert.equal(bladeFrame(47.4, clip, noSnap), 47)
  assert.equal(bladeFrame(47.6, clip, noSnap), 48)
})

test('a blade click snaps to the playhead (or any target) inside the clip', () => {
  // The timeline's own snap, with the playhead at 50 and a 4-frame tolerance.
  const snap = (frame: number): number => snapFrame(frame, [0, 50], 4)
  assert.equal(bladeFrame(47.4, clip, snap), 50)
  // Beyond the tolerance it cuts where the pointer is.
  assert.equal(bladeFrame(44, clip, snap), 44)
})

test("a snap onto the clip's own edge is not taken: it would be no cut at all", () => {
  // A neighbour's edge at 30 — which is also this clip's start — pulls the pointer at 32.
  const snap = (frame: number): number => snapFrame(frame, [30], 4)
  assert.equal(snap(32), 30, 'the specimen must actually snap onto the edge')
  assert.equal(bladeFrame(32, clip, snap), 32)
})

test('a click exactly on an edge makes no cut; one frame in does', () => {
  assert.equal(bladeFrame(30, clip, noSnap), null)
  assert.equal(bladeFrame(90.2, clip, noSnap), null)
  assert.equal(bladeFrame(31, clip, noSnap), 31)
  assert.equal(bladeFrame(89, clip, noSnap), 89)
})

test('the trim handle zones are the 8px at each end, the rest is the body', () => {
  assert.equal(clipZone(3, 200), 'start')
  assert.equal(clipZone(100, 200), 'body')
  assert.equal(clipZone(195, 200), 'end')
  // On a sliver the end handle is on top.
  assert.equal(clipZone(5, 10), 'end')
})

test('an armed roll on the body rolls the nearer cut', () => {
  assert.equal(nearerEdge(40, 200), 'start')
  assert.equal(nearerEdge(160, 200), 'end')
})
