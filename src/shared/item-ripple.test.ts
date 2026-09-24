/**
 * The per-track ripple (`delete_items({ ripple: true })` and the clip menu's "Ripple Delete
 * (This Track Only)"): which survivors close up, by how much, and which other tracks it names as
 * left out of sync.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemRippleNote, planItemRipple } from './item-ripple'
import type { Item, Timeline, Track } from './project'

function clip(id: string, trackId: string, from: number, duration: number): Item {
  return {
    id,
    assetId: id,
    trackId,
    from,
    durationInFrames: duration,
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  }
}

function track(id: string, kind: Track['kind'], items: Item[]): Track {
  return { id, kind, name: id.toUpperCase(), locked: false, muted: false, hidden: false, items }
}

/**
 * V1: A 0–30, B 30–60, gap 60–90, C 90–120
 * V2: T 100–130 (a title over C)
 * A1: m 0–20 (ends before anything is cut)
 */
function fixture(): Timeline {
  return {
    id: 'tl',
    name: 'T',
    fps: 30,
    width: 1920,
    height: 1080,
    background: '#000',
    tracks: [
      track('v1', 'video', [clip('A', 'v1', 0, 30), clip('B', 'v1', 30, 30), clip('C', 'v1', 90, 30)]),
      track('v2', 'video', [clip('T', 'v2', 100, 30)]),
      track('a1', 'audio', [clip('m', 'a1', 0, 20)])
    ],
    markers: []
  }
}

test('closes exactly the gap the delete made, keeping a gap that was already there', () => {
  const plan = planItemRipple(fixture(), ['B'])
  // C moves back by B's 30 frames only — the 60–90 gap it sat behind stays a gap.
  assert.deepEqual(plan.shifts, [{ itemId: 'C', to: 60 }])
  assert.deepEqual(plan.rippledTrackIds, ['v1'])
})

test('names the other tracks that play after the cut as out of sync, and not the ones that end before it', () => {
  const plan = planItemRipple(fixture(), ['B'])
  // V2's title sits over C and did not move; A1's music ends at 20, before B began at 30.
  assert.deepEqual(plan.outOfSyncTrackIds, ['v2'])
})

test('a delete that shifts nothing reports nothing out of sync (the positive control)', () => {
  // C is last on V1: removing it leaves nothing to close up, so nothing is left behind either.
  const plan = planItemRipple(fixture(), ['C'])
  assert.deepEqual(plan.shifts, [])
  assert.deepEqual(plan.rippledTrackIds, [])
  assert.deepEqual(plan.outOfSyncTrackIds, [])
})

test('deleting on two tracks ripples both and names neither as left behind', () => {
  const plan = planItemRipple(fixture(), ['B', 'm'])
  assert.deepEqual(plan.shifts, [{ itemId: 'C', to: 60 }])
  // A1 was touched (m deleted) but nothing on it shifted; it is not "left behind" by the cut.
  assert.deepEqual(plan.outOfSyncTrackIds, ['v2'])
})

test('shifts are ordered earliest destination first, so each move lands on free time', () => {
  const tl = fixture()
  tl.tracks[0]!.items.push(clip('D', 'v1', 120, 10))
  const plan = planItemRipple(tl, ['A'])
  assert.deepEqual(
    plan.shifts.map((s) => s.itemId),
    ['B', 'C', 'D']
  )
  assert.deepEqual(
    plan.shifts.map((s) => s.to),
    [0, 60, 90]
  )
})

test('the note names the tracks, both ways', () => {
  assert.match(itemRippleNote(['V1'], ['V2', 'A1']), /V1 only\. V2, A1 did not move and are now out of sync/)
  assert.match(itemRippleNote(['V1'], []), /nothing is out of sync/)
})
