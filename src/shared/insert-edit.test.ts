/**
 * Insert and Overwrite's room-making, asserted on what plays: which source frame is on screen at
 * a timeline frame, on each track, before and after.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { insertTime, liftRange } from './insert-edit'
import { framesToUs, itemEnd, type Item, type Timeline, type Track } from './project'

let ids = 0
const makeId = (): string => `new-${++ids}`

function item(partial: Partial<Item> & Pick<Item, 'id' | 'from' | 'durationInFrames'>): Item {
  return {
    assetId: 'asset-1',
    trackId: 'v1',
    sourceStartUs: 0,
    layout: { x: 0, y: 0, width: 1, height: 1, rotation: 0, opacity: 1, scale: 1 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    ...partial
  } as Item
}

function track(id: string, items: Item[], locked = false): Track {
  return {
    id,
    kind: id.startsWith('a') ? 'audio' : 'video',
    name: id.toUpperCase(),
    locked,
    muted: false,
    hidden: false,
    items: items.map((i) => ({ ...i, trackId: id }))
  }
}

function timeline(tracks: Track[]): Timeline {
  return { id: 'tl', name: 'Timeline', fps: 30, width: 1920, height: 1080, background: '#000', tracks }
}

function playingAt(tl: Timeline, trackId: string, frame: number): { id: string; sourceUs: number } | null {
  const t = tl.tracks.find((x) => x.id === trackId)
  for (const i of t?.items ?? []) {
    if (frame >= i.from && frame < itemEnd(i)) {
      return { id: i.assetId, sourceUs: i.sourceStartUs + Math.round(framesToUs(frame - i.from, tl.fps) * i.speed) }
    }
  }
  return null
}

test('insert opens the span on every unlocked track, so picture and sound stay in sync after it', () => {
  const tl = timeline([
    track('v1', [item({ id: 'a', from: 0, durationInFrames: 100 }), item({ id: 'b', from: 100, durationInFrames: 50, assetId: 'B' })]),
    track('a1', [item({ id: 's', from: 0, durationInFrames: 150, assetId: 'S' })])
  ])
  const before = { pic: playingAt(tl, 'v1', 120), sound: playingAt(tl, 'a1', 120) }
  const result = insertTime(tl, 60, 30, makeId)

  // What played at 120 now plays at 150, on both tracks.
  assert.deepEqual(playingAt(tl, 'v1', 150), before.pic)
  assert.deepEqual(playingAt(tl, 'a1', 150), before.sound)
  // And the span itself is empty on both, ready for the new clip.
  for (let f = 60; f < 90; f++) {
    assert.equal(playingAt(tl, 'v1', f), null, `v1 frame ${f}`)
    assert.equal(playingAt(tl, 'a1', f), null, `a1 frame ${f}`)
  }
  // The frame before the insert point is untouched.
  assert.deepEqual(playingAt(tl, 'v1', 59), { id: 'asset-1', sourceUs: Math.round(framesToUs(59, 30)) })
  assert.equal(result.createdItemIds.length, 2, 'the clip on each track was split at the point')
  assert.deepEqual(result.desyncedTrackIds, [])
})

test('a locked track cannot move, and insert names it rather than drifting silently', () => {
  const tl = timeline([
    track('v1', [item({ id: 'a', from: 0, durationInFrames: 100 })]),
    track('a1', [item({ id: 's', from: 0, durationInFrames: 100 })], true),
    track('a2', [item({ id: 't', from: 0, durationInFrames: 10 })], true)
  ])
  const result = insertTime(tl, 50, 20, makeId)
  assert.deepEqual(result.desyncedTrackIds, ['a1'], 'a2 ends before the point, so it is not adrift')
  assert.equal(tl.tracks[1]!.items[0]!.durationInFrames, 100, 'the locked clip is untouched')
})

test('insert moves markers after the point and a transition leaving a split clip stays on its cut', () => {
  const tl = timeline([
    track('v1', [item({ id: 'a', from: 0, durationInFrames: 100 }), item({ id: 'b', from: 100, durationInFrames: 50 })])
  ])
  tl.markers = [{ id: 'm1', frame: 10 }, { id: 'm2', frame: 120 }] as Timeline['markers']
  tl.transitions = [{ id: 't', kind: 'cross-dissolve', fromItemId: 'a', toItemId: 'b', durationInFrames: 10 }] as Timeline['transitions']
  insertTime(tl, 40, 25, makeId)
  assert.deepEqual(tl.markers!.map((m) => m.frame), [10, 145])
  const [transition] = tl.transitions!
  assert.ok(transition, 'the a|b cut still exists, so its transition does')
  const from = tl.tracks[0]!.items.find((i) => i.id === transition.fromItemId)!
  const to = tl.tracks[0]!.items.find((i) => i.id === transition.toItemId)!
  assert.equal(itemEnd(from), to.from, 'it joins two clips that meet')
})

test('insert exactly on a cut drops the transition there: the two clips no longer meet', () => {
  const tl = timeline([
    track('v1', [item({ id: 'a', from: 0, durationInFrames: 100 }), item({ id: 'b', from: 100, durationInFrames: 50 })])
  ])
  tl.transitions = [{ id: 't', kind: 'cross-dissolve', fromItemId: 'a', toItemId: 'b', durationInFrames: 10 }] as Timeline['transitions']
  const result = insertTime(tl, 100, 30, makeId)
  assert.deepEqual(result.removedTransitionIds, ['t'])
  assert.deepEqual(tl.transitions, [])
})

test('overwrite clears the span on one track and moves nothing, on that track or any other', () => {
  const tl = timeline([
    track('v1', [item({ id: 'a', from: 0, durationInFrames: 100 }), item({ id: 'b', from: 100, durationInFrames: 50, assetId: 'B' })]),
    track('a1', [item({ id: 's', from: 0, durationInFrames: 150, assetId: 'S' })])
  ])
  const sound = [0, 70, 149].map((f) => playingAt(tl, 'a1', f))
  const kept = [59, 110, 149].map((f) => playingAt(tl, 'v1', f))
  const result = liftRange(tl, 'v1', 60, 110, makeId)
  assert.ok(result)
  for (let f = 60; f < 110; f++) assert.equal(playingAt(tl, 'v1', f), null, `v1 frame ${f}`)
  assert.deepEqual([59, 110, 149].map((f) => playingAt(tl, 'v1', f)), kept, 'what is outside the span plays as before')
  assert.deepEqual([0, 70, 149].map((f) => playingAt(tl, 'a1', f)), sound, 'another track is untouched')
})

test('overwrite strictly inside one clip leaves both pieces where they were', () => {
  const tl = timeline([track('v1', [item({ id: 'a', from: 0, durationInFrames: 200 })])])
  const tail = playingAt(tl, 'v1', 150)
  const result = liftRange(tl, 'v1', 50, 80, makeId)!
  assert.equal(result.createdItemIds.length, 1)
  assert.deepEqual(playingAt(tl, 'v1', 150), tail)
  assert.equal(playingAt(tl, 'v1', 79), null)
  assert.deepEqual(playingAt(tl, 'v1', 80), { id: 'asset-1', sourceUs: Math.round(framesToUs(80, 30)) })
})

test('overwrite refuses a locked track, and works on the unlocked one beside it', () => {
  const tl = timeline([track('v1', [item({ id: 'a', from: 0, durationInFrames: 100 })], true), track('v2', [item({ id: 'b', from: 0, durationInFrames: 100 })])])
  assert.equal(liftRange(tl, 'v1', 10, 20, makeId), null)
  assert.equal(tl.tracks[0]!.items[0]!.durationInFrames, 100)
  assert.ok(liftRange(tl, 'v2', 10, 20, makeId))
  assert.equal(playingAt(tl, 'v2', 15), null)
})

test('a split by insert keeps a J lead on the head and an L trail on the tail only', () => {
  // The span opened between the halves is a hard cut: the head's sound cannot trail into it, and
  // the tail's cannot lead into it. Freeze frame opens time through this same function.
  const tl = timeline([
    track('v1', [item({ id: 'a', from: 0, durationInFrames: 100, audioLeadFrames: 10, audioTrailFrames: 8 })])
  ])
  const result = insertTime(tl, 40, 20, makeId)
  assert.deepEqual(result.split, [{ headId: 'a', tailId: result.createdItemIds[0] }])
  const head = tl.tracks[0]!.items.find((i) => i.id === 'a')!
  const tail = tl.tracks[0]!.items.find((i) => i.id === result.createdItemIds[0])!
  assert.equal(head.audioLeadFrames, 10)
  assert.equal(head.audioTrailFrames, undefined)
  assert.equal(tail.audioLeadFrames, undefined)
  assert.equal(tail.audioTrailFrames, 8)
})
