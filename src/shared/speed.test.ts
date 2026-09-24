/**
 * Speed keeps the footage (`@shared/speed`): the clip menu's Speed…, the inspector, Paste
 * Attributes › Speed and `edit_item({ speed })` all plan through here.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applySpeedPlan, planSpeed, retimedLength, speedNote } from './speed'
import { findItem, type Asset, type Item, type Project, type Timeline, type Track } from './project'

const FPS = 30

function asset(id: string, seconds: number, over: Partial<Asset> = {}): Asset {
  return {
    id,
    kind: 'video',
    name: `${id}.mp4`,
    path: `/m/${id}.mp4`,
    durationUs: seconds * 1_000_000,
    width: 1920,
    height: 1080,
    fps: FPS,
    hasAudio: true,
    hasVideo: true,
    posterPath: null,
    waveformPath: null,
    createdAt: 0,
    ...over
  }
}

function clip(id: string, assetId: string, trackId: string, from: number, duration: number, over: Partial<Item> = {}): Item {
  return {
    id,
    assetId,
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

function track(id: string, kind: Track['kind'], items: Item[]): Track {
  return { id, kind, name: id.toUpperCase(), locked: false, muted: false, hidden: false, items }
}

/** V1: A (a 5s file, all of it, 0–150) then B at 150. A1: M at 200. */
function fixture(): { project: Project; timeline: Timeline } {
  const timeline: Timeline = {
    id: 'tl',
    name: 'T',
    fps: FPS,
    width: 1920,
    height: 1080,
    background: '#000',
    tracks: [
      track('v1', 'video', [clip('A', 'five', 'v1', 0, 150), clip('B', 'five', 'v1', 150, 60)]),
      track('a1', 'audio', [clip('M', 'bed', 'a1', 200, 30)])
    ]
  }
  const project: Project = {
    id: 'p',
    name: 'p',
    version: 1,
    assets: [asset('five', 5), asset('four', 4), asset('bed', 60, { kind: 'audio', hasVideo: false }), asset('still', 0, { kind: 'image', hasAudio: false })],
    timelines: [timeline],
    activeTimelineId: 'tl',
    createdAt: 0,
    updatedAt: 0
  }
  return { project, timeline }
}

const item = (timeline: Timeline, id: string): Item => findItem(timeline, id)!.item
const tc = (frame: number): string => `f${frame}`

test('2x halves the clip, so it plays the same footage instead of freezing on its last frame', () => {
  const { project, timeline } = fixture()
  const plan = planSpeed(project, timeline, 'A', 2)!
  applySpeedPlan(timeline, plan)
  assert.equal(item(timeline, 'A').speed, 2)
  assert.equal(item(timeline, 'A').durationInFrames, 75, 'was kept at 150: frames 75–150 held the last frame')
  assert.equal(item(timeline, 'B').from, 150, 'without ripple nothing else moves; a gap is left')
  assert.equal(speedNote(project, timeline, plan, tc), null, 'nothing surprising to say')
})

test('slower lengthens the clip; into the next clip it stops there and says so, and ripple makes room', () => {
  const clamped = fixture()
  const plan = planSpeed(clamped.project, clamped.timeline, 'A', 0.5)!
  assert.equal(plan.wanted, 300)
  assert.equal(plan.length, 150, 'B starts at 150')
  assert.deepEqual(plan.clampedBy, { kind: 'next-clip', itemId: 'B', trackId: 'v1', at: 150 })
  assert.match(speedNote(clamped.project, clamped.timeline, plan, tc) ?? '', /"five\.mp4" starts at f150 on V1.*Push later clips/)

  const rippled = fixture()
  const ripple = planSpeed(rippled.project, rippled.timeline, 'A', 0.5, { ripple: true })!
  applySpeedPlan(rippled.timeline, ripple)
  assert.equal(item(rippled.timeline, 'A').durationInFrames, 300)
  assert.equal(item(rippled.timeline, 'B').from, 300, 'B pushed by the 150 frames A grew')
  assert.equal(item(rippled.timeline, 'M').from, 200, 'another track does not move…')
  assert.deepEqual(ripple.outOfSyncTrackIds, ['a1'], '…and is named as out of step')
})

test('a clip never runs past its footage, and a still keeps its length', () => {
  const { project, timeline } = fixture()
  // A 4s file on a 150-frame clip: 120 frames of footage at 1x, 240 at 0.5x.
  item(timeline, 'A').assetId = 'four'
  const plan = planSpeed(project, timeline, 'A', 0.5, { ripple: true })!
  assert.equal(plan.wanted, 300)
  assert.equal(plan.length, 240)
  assert.deepEqual(plan.clampedBy, { kind: 'footage', available: 240 })
  assert.deepEqual(retimedLength({ durationInFrames: 90, speed: 1, sourceStartUs: 0 }, 0, 3, FPS), {
    wanted: 90,
    available: Number.POSITIVE_INFINITY
  })
})

test('a linked sound takes the same speed and length, and its own track can clamp the change', () => {
  const { project, timeline } = fixture()
  item(timeline, 'A').linkId = 'L'
  item(timeline, 'A').audioDetached = true
  timeline.tracks[1]!.items.unshift(clip('S', 'five', 'a1', 0, 150, { linkId: 'L' }))
  // M sits at 200 on A1: S can grow by 50 there, while V1 is free once B is gone.
  timeline.tracks[0]!.items = timeline.tracks[0]!.items.filter((i) => i.id !== 'B')
  const plan = planSpeed(project, timeline, 'A', 0.5)!
  assert.equal(plan.length, 200)
  assert.deepEqual(plan.clampedBy, { kind: 'next-clip', itemId: 'M', trackId: 'a1', at: 200 })
  applySpeedPlan(timeline, plan)
  assert.equal(item(timeline, 'S').speed, 0.5)
  assert.equal(item(timeline, 'S').durationInFrames, 200)
})

test('speeding up keeps the fades inside the shorter clip', () => {
  const { project, timeline } = fixture()
  item(timeline, 'A').fadeInFrames = 30
  item(timeline, 'A').fadeOutFrames = 60
  applySpeedPlan(timeline, planSpeed(project, timeline, 'A', 4)!)
  const a = item(timeline, 'A')
  assert.equal(a.durationInFrames, 37, '150 frames of footage at 4x, whole frames only')
  assert.ok(a.fadeInFrames + a.fadeOutFrames <= a.durationInFrames)
})
