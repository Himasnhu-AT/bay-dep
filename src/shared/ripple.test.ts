import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rippleDelete } from './ripple'
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
  return {
    id: 'tl',
    name: 'Timeline',
    fps: 30,
    width: 1920,
    height: 1080,
    background: '#000',
    tracks
  }
}

/**
 * Which frame of which source is on screen at timeline frame `f` — the only thing the viewer
 * can actually perceive. Assertions are written against this rather than against `from` and
 * `sourceStartUs`, because those are implementation and this is the requirement.
 */
function playingAt(
  tl: Timeline,
  trackId: string,
  frame: number
): { assetId: string; sourceUs: number } | null {
  const t = tl.tracks.find((x) => x.id === trackId)
  if (!t) return null
  for (const i of t.items) {
    if (frame >= i.from && frame < itemEnd(i)) {
      return {
        assetId: i.assetId,
        sourceUs: i.sourceStartUs + Math.round(framesToUs(frame - i.from, tl.fps) * i.speed)
      }
    }
  }
  return null
}

test('a clip after the cut moves up by exactly what was removed', () => {
  const tl = timeline([track('v1', [item({ id: 'a', from: 0, durationInFrames: 50 }), item({ id: 'b', from: 100, durationInFrames: 40 })])])
  const before = tl.tracks[0]!.items[1]!.from

  const result = rippleDelete(tl, 50, 80, makeId)

  assert.equal(result.removedFrames, 30)
  const moved = tl.tracks[0]!.items.find((i) => i.id === 'b')!
  assert.equal(moved.from, before - result.removedFrames)
})

test('a clip the range covers completely is gone', () => {
  const tl = timeline([track('v1', [item({ id: 'a', from: 10, durationInFrames: 20 })])])
  const result = rippleDelete(tl, 5, 40, makeId)

  assert.deepEqual(result.removedItemIds, ['a'])
  assert.equal(tl.tracks[0]!.items.length, 0)
})

test('cutting the middle out of one clip leaves two that abut, and the seam skips the source', () => {
  // 90 frames at 30fps: three seconds of one take. Remove the middle second.
  const tl = timeline([track('v1', [item({ id: 'a', from: 0, durationInFrames: 90 })])])
  const sourceAtCutEnd = playingAt(tl, 'v1', 60)!.sourceUs

  const result = rippleDelete(tl, 30, 60, makeId)

  assert.equal(result.trimmedItemIds.length, 1)
  assert.equal(result.createdItemIds.length, 1)

  const items = tl.tracks[0]!.items
  assert.equal(items.length, 2)
  // No gap and no overlap at the seam.
  assert.equal(itemEnd(items[0]!), items[1]!.from)
  // The requirement: the frame after the seam is the frame that followed the removed span.
  assert.equal(playingAt(tl, 'v1', 30)!.sourceUs, sourceAtCutEnd)
  // And the programme is one second shorter.
  assert.equal(itemEnd(items[1]!), 90 - result.removedFrames)
})

test('every unlocked track stays in sync — the reason this takes a range and not a selection', () => {
  // A talking head with its audio on a separate track, which is what a podcast cut is.
  const tl = timeline([
    track('v1', [item({ id: 'v', from: 0, durationInFrames: 300, assetId: 'cam' })]),
    track('a1', [item({ id: 'a', from: 0, durationInFrames: 300, assetId: 'mic' })])
  ])

  const cutFrom = 90
  const cutTo = 150
  const sampleFrames = [0, 30, 89, 90, 120, 200, 239]
  const expected = sampleFrames.map((f) => ({
    frame: f,
    // After the cut, the frame that shows is the one that used to be `span` later.
    video: playingAt(tl, 'v1', f < cutFrom ? f : f + (cutTo - cutFrom)),
    audio: playingAt(tl, 'a1', f < cutFrom ? f : f + (cutTo - cutFrom))
  }))

  rippleDelete(tl, cutFrom, cutTo, makeId)

  for (const { frame, video, audio } of expected) {
    assert.deepEqual(playingAt(tl, 'v1', frame), video, `video at ${frame}`)
    assert.deepEqual(playingAt(tl, 'a1', frame), audio, `audio at ${frame}`)
  }

  // The invariant that matters, stated directly: picture and sound read the same source
  // position as each other at every frame, before and after.
  for (const f of sampleFrames) {
    assert.equal(
      playingAt(tl, 'v1', f)?.sourceUs,
      playingAt(tl, 'a1', f)?.sourceUs,
      `picture and sound diverged at frame ${f}`
    )
  }
})

test('a locked track holding later content is reported as left behind, not silently drifted', () => {
  const tl = timeline([
    track('v1', [item({ id: 'v', from: 0, durationInFrames: 200 })]),
    track('a1', [item({ id: 'a', from: 0, durationInFrames: 200 })], true)
  ])

  const result = rippleDelete(tl, 50, 80, makeId)

  assert.deepEqual(result.desyncedTrackIds, ['a1'])
  // And it really was left alone, so the report is about a thing that happened.
  assert.equal(tl.tracks[1]!.items[0]!.durationInFrames, 200)
})

test('a locked track with nothing after the cut is not reported', () => {
  const tl = timeline([
    track('v1', [item({ id: 'v', from: 0, durationInFrames: 200 })]),
    track('a1', [item({ id: 'a', from: 0, durationInFrames: 40 })], true)
  ])

  const result = rippleDelete(tl, 50, 80, makeId)

  assert.deepEqual(result.desyncedTrackIds, [])
})

test('an empty or reversed range changes nothing', () => {
  for (const [from, to] of [
    [50, 50],
    [80, 50]
  ]) {
    const tl = timeline([track('v1', [item({ id: 'a', from: 0, durationInFrames: 100 })])])
    const snapshot = JSON.stringify(tl)

    const result = rippleDelete(tl, from!, to!, makeId)

    assert.equal(result.removedFrames, 0)
    assert.equal(JSON.stringify(tl), snapshot, `range ${from}..${to} touched the timeline`)
  }
})

test('a transition loses its junction when a clip it joined is removed', () => {
  const tl = timeline([
    track('v1', [
      item({ id: 'a', from: 0, durationInFrames: 50 }),
      item({ id: 'b', from: 50, durationInFrames: 50 }),
      item({ id: 'c', from: 100, durationInFrames: 50 })
    ])
  ])
  tl.transitions = [
    { id: 't-ab', fromItemId: 'a', toItemId: 'b', kind: 'cross-dissolve', durationInFrames: 10 },
    { id: 't-bc', fromItemId: 'b', toItemId: 'c', kind: 'cross-dissolve', durationInFrames: 10 }
  ]

  // Remove b entirely.
  const result = rippleDelete(tl, 50, 100, makeId)

  assert.deepEqual(result.removedItemIds, ['b'])
  assert.deepEqual(result.removedTransitionIds.sort(), ['t-ab', 't-bc'])
  assert.deepEqual(tl.transitions, [])
})

test('a clip at a non-unit speed skips the right amount of source', () => {
  // At 2x, one timeline frame consumes two frames of source; the seam must respect that or a
  // sped-up clip jumps by the wrong amount and nothing about the timeline looks wrong.
  const tl = timeline([track('v1', [item({ id: 'a', from: 0, durationInFrames: 90, speed: 2 })])])
  const sourceAtCutEnd = playingAt(tl, 'v1', 60)!.sourceUs

  rippleDelete(tl, 30, 60, makeId)

  assert.equal(playingAt(tl, 'v1', 30)!.sourceUs, sourceAtCutEnd)
})

test('a fade that no longer fits is shortened, not left longer than its clip', () => {
  const tl = timeline([
    track('v1', [item({ id: 'a', from: 0, durationInFrames: 100, fadeOutFrames: 40 })])
  ])

  rippleDelete(tl, 20, 90, makeId)

  const only = tl.tracks[0]!.items[0]!
  assert.ok(
    only.fadeOutFrames <= only.durationInFrames,
    `fade ${only.fadeOutFrames} exceeds clip ${only.durationInFrames}`
  )
})

test('markers after a cut slide up with the program, and one inside it lands on the cut', () => {
  const tl = timeline([track('v1', [item({ id: 'a', from: 0, durationInFrames: 300 })])])
  tl.markers = [
    { id: 'before', frame: 40, label: 'before' },
    { id: 'inside', frame: 120, label: 'inside' },
    { id: 'at-end', frame: 150, label: 'first frame kept' },
    { id: 'after', frame: 200, label: 'after' }
  ]
  const named = (id: string): number => tl.markers!.find((m) => m.id === id)!.frame

  rippleDelete(tl, 100, 150, makeId)

  assert.equal(named('before'), 40, 'a marker before the cut does not move')
  assert.equal(named('after'), 150, 'a marker after the cut moves with the footage under it')
  assert.equal(named('at-end'), 100, 'toFrame is kept, so a marker on it moves like the rest')
  assert.equal(named('inside'), 100, 'a marker on removed time lands on the cut, not nowhere')
})
