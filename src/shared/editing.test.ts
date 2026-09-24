/**
 * The keyboard editing planners (`@shared/editing`): nudge, close gap, pull back, edit points,
 * trim targets and the loop span. Each refusal is paired with the nearest legal call, and each
 * refusal is checked for the name of what is in the way.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  adjacentPoint,
  applyMoves,
  clipsUnderPlayhead,
  editPoints,
  gapAt,
  loopSpan,
  markerPoints,
  planCloseGap,
  planNudge,
  planPullBack
} from './editing'
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

function clip(id: string, trackId: string, from: number, duration: number, over: Partial<Item> = {}): Item {
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
    speed: 1,
    ...over
  }
}

function track(id: string, kind: Track['kind'], items: Item[], over: Partial<Track> = {}): Track {
  return { id, kind, name: id.toUpperCase(), locked: false, muted: false, hidden: false, items, ...over }
}

/**
 * V1: A 0–30, gap 30–60, B 60–90, C 90–120
 * A1: a (linked to B) 60–90, m 130–160
 */
function fixture(over: { a1?: Partial<Track> } = {}): { project: Project; timeline: Timeline } {
  const timeline: Timeline = {
    id: 'tl',
    name: 'T',
    fps: 30,
    width: 1920,
    height: 1080,
    background: '#000',
    tracks: [
      track('v1', 'video', [clip('A', 'v1', 0, 30), clip('B', 'v1', 60, 30, { linkId: 'L' }), clip('C', 'v1', 90, 30)]),
      track('a1', 'audio', [clip('a', 'a1', 60, 30, { linkId: 'L' }), clip('m', 'a1', 130, 30)], over.a1)
    ],
    markers: [
      { id: 'm1', frame: 45, label: 'one' },
      { id: 'm2', frame: 100, label: 'two' }
    ]
  }
  const project: Project = {
    id: 'p',
    name: 'p',
    version: 1,
    assets: ['A', 'B', 'C', 'a', 'm'].map(asset),
    timelines: [timeline],
    activeTimelineId: 'tl',
    createdAt: 0,
    updatedAt: 0
  }
  return { project, timeline }
}

const from = (timeline: Timeline, id: string): number =>
  timeline.tracks.flatMap((t) => t.items).find((i) => i.id === id)!.from

// -- nudge ------------------------------------------------------------------

test('a nudge into free time moves the clip and its linked sound by the same frames', () => {
  const { project, timeline } = fixture()
  const plan = planNudge(project, timeline, ['B'], -5)
  assert.ok(plan.ok)
  applyMoves(timeline, plan.moves)
  assert.equal(from(timeline, 'B'), 55)
  assert.equal(from(timeline, 'a'), 55, 'the linked sound moved with its picture')
})

test('a nudge into a neighbour is refused, naming the neighbour and what to do', () => {
  const { project, timeline } = fixture()
  // B ends at 90 where C starts: one frame right collides.
  const plan = planNudge(project, timeline, ['B'], 1)
  assert.equal(plan.ok, false)
  assert.ok(!plan.ok && plan.error.includes('C.mp4'), !plan.ok ? plan.error : '')
  assert.ok(!plan.ok && /fewer frames|trim/.test(plan.error))
  // Positive control: moving both B and C right is legal, because C moves out of the way.
  assert.ok(planNudge(project, timeline, ['B', 'C'], 1).ok)
})

test('a nudge before frame 0 and a nudge on a locked track are refused by name', () => {
  const { project, timeline } = fixture()
  const early = planNudge(project, timeline, ['A'], -1)
  assert.ok(!early.ok && early.error.includes('A.mp4') && early.error.includes('frame 0'))
  const locked = fixture({ a1: { locked: true } })
  const blocked = planNudge(locked.project, locked.timeline, ['B'], -1)
  assert.ok(!blocked.ok && blocked.error.includes('A1 is locked'), !blocked.ok ? blocked.error : '')
  // Unlinked, the same nudge does not touch the locked track and goes through.
  assert.ok(planNudge(locked.project, locked.timeline, ['B'], -1, false).ok)
})

// -- gaps ------------------------------------------------------------------

test('close gap pulls everything after the gap on that track back, and linked clips with it', () => {
  const { project, timeline } = fixture()
  const plan = planCloseGap(project, timeline, 'v1', 45)
  assert.ok(plan.ok, !plan.ok ? plan.error : '')
  assert.deepEqual(plan.gap, { trackId: 'v1', from: 30, to: 60 })
  applyMoves(timeline, plan.moves)
  assert.equal(from(timeline, 'B'), 30)
  assert.equal(from(timeline, 'C'), 60)
  assert.equal(from(timeline, 'a'), 30, 'linked sound follows')
  assert.equal(from(timeline, 'm'), 130, 'an unlinked clip on another track stays')
  assert.equal(from(timeline, 'A'), 0)
})

test('close gap refuses a playhead on a clip, and past the last clip, saying where to put it', () => {
  const { project, timeline } = fixture()
  const v1 = timeline.tracks[0]!
  const onClip = gapAt(project, v1, 10)
  assert.ok(!onClip.ok && onClip.error.includes('A.mp4') && onClip.error.includes('between two clips'))
  const tail = gapAt(project, v1, 500)
  assert.ok(!tail.ok && tail.error.includes('no gap'))
  assert.ok(gapAt(project, v1, 30).ok, 'the first frame of a gap is in it')
})

test('close gap is refused whole when a linked clip would collide, naming it', () => {
  const { project, timeline } = fixture()
  // Put an unlinked clip on A1 where the linked sound would land.
  timeline.tracks[1]!.items.unshift(clip('x', 'a1', 35, 10))
  project.assets.push(asset('x'))
  const plan = planCloseGap(project, timeline, 'v1', 45)
  assert.ok(!plan.ok && plan.error.includes('x.mp4'), !plan.ok ? plan.error : '')
})

test('pull back moves only by the frames asked, not a gap that was already there', () => {
  const { project, timeline } = fixture()
  // A ripple trim that took 10 frames off B's head: B now starts at 70 and only 10 close up.
  const b = timeline.tracks[0]!.items.find((i) => i.id === 'B')!
  b.from = 70
  b.durationInFrames = 20
  const plan = planPullBack(project, timeline, 'v1', 70, 10)
  assert.ok(plan.ok)
  applyMoves(timeline, plan.moves)
  assert.equal(from(timeline, 'B'), 60, 'the 30–60 gap before it is still there')
  assert.equal(from(timeline, 'C'), 80)
})

// -- jumps -----------------------------------------------------------------

test('next and previous edit land on clip edges on any track, and stop at the ends', () => {
  const { timeline } = fixture()
  const points = editPoints(timeline)
  assert.deepEqual(points, [0, 30, 60, 90, 120, 130, 160])
  assert.equal(adjacentPoint(points, 45, 1), 60)
  assert.equal(adjacentPoint(points, 60, 1), 90, 'from on an edit, the next one — not itself')
  assert.equal(adjacentPoint(points, 60, -1), 30)
  assert.equal(adjacentPoint(points, 160, 1), null)
  assert.equal(adjacentPoint(points, 0, -1), null)
  const markers = markerPoints(timeline)
  assert.equal(adjacentPoint(markers, 50, 1), 100)
  assert.equal(adjacentPoint(markers, 50, -1), 45)
})

// -- trim targets and loop ------------------------------------------------------

test('trim to playhead takes one clip per link group, and only clips the playhead is inside', () => {
  const { timeline } = fixture()
  const under = clipsUnderPlayhead(timeline, [], 75)
  assert.deepEqual(under.map((i) => i.id), ['B'], 'B and its linked a are one target')
  assert.deepEqual(clipsUnderPlayhead(timeline, [], 60).map((i) => i.id), [], 'on an edge is not inside')
  assert.deepEqual(clipsUnderPlayhead(timeline, ['C'], 75).map((i) => i.id), [], 'the selection limits it')
})

test('the loop span is In to Out, either end defaulting to the timeline', () => {
  assert.deepEqual(loopSpan(30, 90, 200), { from: 30, to: 90 })
  assert.deepEqual(loopSpan(null, 90, 200), { from: 0, to: 90 })
  assert.deepEqual(loopSpan(30, null, 200), { from: 30, to: 200 })
  assert.deepEqual(loopSpan(null, null, 200), { from: 0, to: 200 })
  assert.deepEqual(loopSpan(250, null, 200), { from: 0, to: 200 }, 'an In past the end loops the whole timeline')
  assert.equal(loopSpan(null, null, 0), null)
})
