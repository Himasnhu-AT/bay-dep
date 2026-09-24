/**
 * The multi-clip cross-track drag planner (`@shared/track-move`): lanes counted within the
 * grabbed clip's kind, the other kind left on its tracks, and every refusal paired with the
 * nearest legal drag and checked for the name of what is in the way.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyTrackMoves, planTrackShift } from './track-move'
import type { Asset, Item, Project, Timeline, Track } from './project'

function asset(id: string): Asset {
  return {
    id,
    kind: 'video',
    name: `${id}.mp4`,
    path: `/m/${id}.mp4`,
    durationUs: 60_000_000,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    hasVideo: true,
    posterPath: null,
    waveformPath: null,
    createdAt: 0
  }
}

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

function track(id: string, kind: Track['kind'], items: Item[], over: Partial<Track> = {}): Track {
  return { id, kind, name: id.toUpperCase(), locked: false, muted: false, hidden: false, items, ...over }
}

/**
 * Drawn top to bottom: V3 (empty), V2 (X 200–230), V1 (A 0–30, B 60–90), A1 (a 0–30), A2 (empty).
 * `order` is that display order; the array order of `tracks` is the model's (video bottom-up).
 */
function fixture(over: { v3?: Partial<Track> } = {}): { project: Project; timeline: Timeline; order: string[] } {
  const timeline: Timeline = {
    id: 'tl',
    name: 'T',
    fps: 30,
    width: 1920,
    height: 1080,
    background: '#000',
    tracks: [
      track('v1', 'video', [clip('A', 'v1', 0, 30), clip('B', 'v1', 60, 30)]),
      track('v2', 'video', [clip('X', 'v2', 200, 30)]),
      track('v3', 'video', [], over.v3),
      track('a1', 'audio', [clip('a', 'a1', 0, 30)]),
      track('a2', 'audio', [])
    ],
    markers: []
  }
  const project: Project = {
    id: 'p',
    name: 'p',
    version: 1,
    assets: ['A', 'B', 'X', 'a'].map(asset),
    timelines: [timeline],
    activeTimelineId: 'tl',
    createdAt: 0,
    updatedAt: 0
  }
  return { project, timeline, order: ['v3', 'v2', 'v1', 'a1', 'a2'] }
}

const trackOf = (timeline: Timeline, id: string): string | undefined =>
  timeline.tracks.find((t) => t.items.some((i) => i.id === id))?.id

test('two clips on V1 dragged up one lane both land on V2, the same frames apart', () => {
  const { project, timeline, order } = fixture()
  const plan = planTrackShift(project, timeline, { itemIds: ['A', 'B'], anchorId: 'A', targetTrackId: 'v2', deltaFrames: 5, order })
  assert.ok(plan.ok, plan.ok ? '' : plan.error)
  assert.equal(plan.lanes, -1)
  assert.deepEqual(plan.moves, [
    { itemId: 'A', from: 5, trackId: 'v2' },
    { itemId: 'B', from: 65, trackId: 'v2' }
  ])
  applyTrackMoves(timeline, plan.moves)
  assert.equal(trackOf(timeline, 'A'), 'v2')
  assert.equal(trackOf(timeline, 'B'), 'v2')
  assert.equal(timeline.tracks[0]!.items.length, 0)
  // Sorted by start after the move, and the item's own trackId follows its lane.
  assert.deepEqual(timeline.tracks[1]!.items.map((i) => [i.id, i.trackId]), [['A', 'v2'], ['B', 'v2'], ['X', 'v2']])
})

test('clips on two lanes keep their spacing in lanes: V1 and V2 dragged up one become V2 and V3', () => {
  const { project, timeline, order } = fixture()
  const plan = planTrackShift(project, timeline, { itemIds: ['B', 'X'], anchorId: 'B', targetTrackId: 'v2', deltaFrames: 0, order })
  assert.ok(plan.ok, plan.ok ? '' : plan.error)
  assert.deepEqual(
    plan.moves.map((m) => [m.itemId, m.trackId]),
    [['B', 'v2'], ['X', 'v3']]
  )
})

test('the linked sound stays on its audio track and shifts in time only', () => {
  const { project, timeline, order } = fixture()
  const plan = planTrackShift(project, timeline, { itemIds: ['A', 'a'], anchorId: 'A', targetTrackId: 'v2', deltaFrames: 10, order })
  assert.ok(plan.ok, plan.ok ? '' : plan.error)
  assert.deepEqual(plan.moves.find((m) => m.itemId === 'a'), { itemId: 'a', from: 10, trackId: 'a1' })
})

test('a drag past the top video lane is refused, naming the clip and the missing lane', () => {
  const { project, timeline, order } = fixture()
  // Legal: V1+V2 up one (the pair lands on V2+V3).
  assert.ok(planTrackShift(project, timeline, { itemIds: ['A', 'X'], anchorId: 'A', targetTrackId: 'v2', deltaFrames: 0, order }).ok)
  // Refused: up two — X would need a lane above V3.
  const plan = planTrackShift(project, timeline, { itemIds: ['A', 'X'], anchorId: 'A', targetTrackId: 'v3', deltaFrames: 0, order })
  assert.equal(plan.ok, false)
  assert.match(plan.ok ? '' : plan.error, /X\.mp4 is on V2, and there is no video track 2 above it/)
})

test('a locked destination is refused by name; the same drag to an unlocked lane is not', () => {
  const locked = fixture({ v3: { locked: true } })
  const plan = planTrackShift(locked.project, locked.timeline, { itemIds: ['B', 'X'], anchorId: 'B', targetTrackId: 'v2', deltaFrames: 0, order: locked.order })
  assert.equal(plan.ok, false)
  assert.match(plan.ok ? '' : plan.error, /V3 is locked, so X\.mp4 cannot move onto it/)
  const free = fixture()
  assert.ok(planTrackShift(free.project, free.timeline, { itemIds: ['B', 'X'], anchorId: 'B', targetTrackId: 'v2', deltaFrames: 0, order: free.order }).ok)
})

test('landing on a clip that is not moving is refused, naming it; clear of it is fine', () => {
  const { project, timeline, order } = fixture()
  // B 60–90 moved to V2 at +140 → 200–230, exactly on X.
  const plan = planTrackShift(project, timeline, { itemIds: ['A', 'B'], anchorId: 'A', targetTrackId: 'v2', deltaFrames: 140, order })
  assert.equal(plan.ok, false)
  assert.match(plan.ok ? '' : plan.error, /B\.mp4 would land on X\.mp4 on V2/)
  assert.ok(planTrackShift(project, timeline, { itemIds: ['A', 'B'], anchorId: 'A', targetTrackId: 'v2', deltaFrames: 100, order }).ok)
})

test('a target of the other kind is refused with the kind to drag onto', () => {
  const { project, timeline, order } = fixture()
  const plan = planTrackShift(project, timeline, { itemIds: ['A', 'B'], anchorId: 'A', targetTrackId: 'a2', deltaFrames: 0, order })
  assert.equal(plan.ok, false)
  assert.match(plan.ok ? '' : plan.error, /A2 is an audio track.*Drag onto a video track/)
})

test('audio lanes count in audio order: A1 dragged down one lands on A2', () => {
  const { project, timeline, order } = fixture()
  const plan = planTrackShift(project, timeline, { itemIds: ['a', 'A'], anchorId: 'a', targetTrackId: 'a2', deltaFrames: 0, order })
  assert.ok(plan.ok, plan.ok ? '' : plan.error)
  assert.deepEqual(
    plan.moves.map((m) => [m.itemId, m.trackId]),
    [['a', 'a2'], ['A', 'v1']]
  )
})

test('applying a move to a track that does not exist changes nothing rather than dropping the clip', () => {
  const { timeline } = fixture()
  applyTrackMoves(timeline, [{ itemId: 'A', from: 0, trackId: 'gone' }])
  assert.equal(trackOf(timeline, 'A'), 'v1')
})
