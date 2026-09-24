/**
 * The freeze-frame planner: an insert that opens the same time on every unlocked track, so every
 * clip after the playhead — on any track — plays the same source at its new frame as it did at its
 * old one, shifted by exactly the hold.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Timeline, Track } from './project'
import { itemEnd, sourceTimeAt } from './project'
import { applyFreezeFrame, freezeItem, freezeRefusal, freezeTarget } from './freeze-frame'

const FPS = 30

function asset(id: string, kind: Asset['kind'], extra: Partial<Asset> = {}): Asset {
  return {
    id, kind, name: `${id}`, path: `/m/${id}`, durationUs: 60_000_000, width: 1920, height: 1080, fps: FPS,
    hasAudio: kind !== 'image' && kind !== 'text', hasVideo: kind === 'video' || kind === 'image', posterPath: null,
    waveformPath: null, createdAt: 0, ...extra
  }
}

function clip(id: string, assetId: string, trackId: string, from: number, duration: number, extra: Partial<Item> = {}): Item {
  return {
    id, assetId, trackId, from, durationInFrames: duration, sourceStartUs: 1_000_000,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...extra
  }
}

function track(id: string, kind: Track['kind'], items: Item[], extra: Partial<Track> = {}): Track {
  return { id, kind, name: id.toUpperCase(), locked: false, muted: false, hidden: false, items, ...extra }
}

const STILL = asset('still', 'image', { durationUs: 0, hasAudio: false })
const ASSETS = [asset('shot', 'video'), asset('bed', 'audio'), asset('title', 'text'), STILL]
const project = (timeline: Timeline) => ({
  id: 'p', name: 'p', version: 1, assets: ASSETS, timelines: [timeline], activeTimelineId: timeline.id, createdAt: 0, updatedAt: 0
})

/**
 * V1: A 0–90 (speed 2, slipped) then B 90–150, dissolving. A1: A's detached sound, linked. A2: a
 * music bed under everything. V2: a title straddling 60. Markers at 30 and 120.
 */
function fixture(): Timeline {
  return {
    id: 'tl', name: 'T', fps: FPS, width: 1920, height: 1080, background: '#000',
    tracks: [
      track('v1', 'video', [
        clip('A', 'shot', 'v1', 0, 90, { speed: 2, sourceStartUs: 4_000_000, linkId: 'L', audioDetached: true, audioTrailFrames: 6 }),
        clip('B', 'shot', 'v1', 90, 60, { sourceStartUs: 20_000_000 })
      ]),
      track('a1', 'audio', [clip('As', 'shot', 'a1', 0, 90, { speed: 2, sourceStartUs: 4_000_000, linkId: 'L' })]),
      track('a2', 'audio', [clip('M', 'bed', 'a2', 0, 300, { sourceStartUs: 0 })]),
      track('v2', 'video', [clip('T', 'title', 'v2', 40, 60, { sourceStartUs: 0 })])
    ],
    transitions: [{ id: 'x', kind: 'cross-dissolve', fromItemId: 'A', toItemId: 'B', durationInFrames: 10 }],
    markers: [{ id: 'm1', frame: 30, label: 'before' }, { id: 'm2', frame: 120, label: 'after' }]
  }
}

let counter = 0
const makeId = (prefix: string): string => `${prefix}_${(counter += 1)}`

/** Every `track:asset@µs` heard or seen at `frame`, the time rounded to 10 µs. */
function playing(timeline: Timeline, frame: number): string[] {
  const out: string[] = []
  for (const t of timeline.tracks) {
    for (const item of t.items) {
      // 10 µs, because a split re-rounds each half's microseconds (as `split_at` does): the tail
      // can read 1 µs from the whole, a thirtieth of a percent of one frame.
      if (frame >= item.from && frame < itemEnd(item)) out.push(`${t.id}:${item.assetId}@${Math.round(sourceTimeAt(item, frame, FPS) / 10)}`)
    }
  }
  return out.sort()
}

test('the clip splits at the playhead, the hold goes between, and every track opens by the same amount', () => {
  const before = fixture()
  const after = fixture()
  const HOLD = 150
  const result = applyFreezeFrame(after, { itemId: 'A', frame: 60, frames: HOLD, still: STILL }, makeId)
  assert.ok(result)

  const v1 = after.tracks[0]!.items
  assert.deepEqual(v1.map((i) => [i.assetId, i.from, i.durationInFrames]), [
    ['shot', 0, 60],
    ['still', 60, HOLD],
    ['shot', 210, 30],
    ['shot', 240, 60]
  ])
  // The tail reads on from where the head stopped: 60 frames at speed 2 is 4 s of source.
  assert.equal(v1[2]!.sourceStartUs, 4_000_000 + 4_000_000)

  // Sync, stated as the requirement: before the playhead nothing changed; from it on, every track
  // plays at frame f + HOLD exactly what it played at f — including the picture's detached sound,
  // the music bed and the title, none of which the freeze was asked about.
  for (let frame = 0; frame < 300; frame += 1) {
    const was = playing(before, frame)
    const now = playing(after, frame < 60 ? frame : frame + HOLD)
    // The freeze's own still is the only newcomer, and only inside the hold.
    assert.deepEqual(now.filter((p) => !p.includes(':still@')), was, `frame ${frame}`)
  }
  // And the hold itself shows the still and nothing else on V1.
  for (let frame = 60; frame < 60 + HOLD; frame += 1) {
    // (A still reads no source time, so only which asset is compared.)
    assert.deepEqual(playing(after, frame).filter((p) => p.startsWith('v1:')).map((p) => p.split('@')[0]), ['v1:still'])
  }

  // Markers after the playhead move with the time; the one before does not.
  assert.deepEqual(after.markers!.map((m) => m.frame), [30, 120 + HOLD])
  // A's dissolve into B now leaves from A's tail, which still meets B.
  const tail = result.split.find((s) => s.headId === 'A')!.tailId
  assert.deepEqual(after.transitions!.map((t) => [t.fromItemId, t.toItemId]), [[tail, 'B']])
  assert.deepEqual(result.removedTransitionIds, [])
  // The L trail stays on the clip's last cut (the tail), not on the hard cut into the hold.
  assert.equal(v1[0]!.audioTrailFrames, undefined)
  assert.equal(v1[2]!.audioTrailFrames, 6)
})

test('a freeze on a clip\'s first frame holds it before the clip, and drops the transition it splits', () => {
  const timeline = fixture()
  const result = applyFreezeFrame(timeline, { itemId: 'B', frame: 90, frames: 30, still: STILL }, makeId)
  assert.ok(result)
  assert.deepEqual(timeline.tracks[0]!.items.map((i) => [i.id === 'A' || i.id === 'B' ? i.id : i.assetId, i.from]), [
    ['A', 0],
    ['still', 90],
    ['B', 120]
  ])
  assert.deepEqual(result.split, [{ headId: 'M', tailId: result.split[0]!.tailId }, { headId: 'T', tailId: result.split[1]!.tailId }])
  assert.deepEqual(result.removedTransitionIds, ['x'], 'A and B no longer meet: the dissolve between them is gone, and said')
  assert.deepEqual(timeline.transitions, [])
})

test('the still takes the clip\'s framing at that frame, its crop and its look', () => {
  const item = clip('K', 'shot', 'v1', 100, 60, {
    keyframes: { scale: [{ frame: 0, value: 1 }, { frame: 60, value: 1.6 }] },
    crop: { left: 0.1, top: 0, right: 0, bottom: 0 },
    adjustments: { brightness: 1, contrast: 1, saturate: 0.5, hueRotate: 0, blur: 0, grayscale: 0, sepia: 0, invert: 0 },
    blendMode: 'screen'
  })
  const still = freezeItem(item, 130, STILL, 45, 'itm_f')
  assert.equal(still.layout.scale, 1.3, 'the zoom halfway through the push-in')
  assert.deepEqual(still.crop, item.crop)
  assert.deepEqual(still.adjustments, item.adjustments)
  assert.equal(still.blendMode, 'screen')
  assert.equal(still.keyframes, undefined, 'a hold does not animate')
  assert.deepEqual([still.from, still.durationInFrames, still.assetId, still.speed], [130, 45, 'still', 1])
})

test('a locked track with clips after the playhead refuses, naming it; one with nothing after does not', () => {
  const locked = fixture()
  locked.tracks[2]!.locked = true
  const refusal = freezeRefusal(locked, locked.tracks[0]!.items[0]!, 60)
  assert.match(refusal ?? '', /A2 is locked with clips there/)
  assert.match(refusal ?? '', /Unlock it first/)

  // Positive control: a locked track whose clips all end before the playhead cannot drift.
  const early = fixture()
  early.tracks[3]!.items = [clip('T', 'title', 'v2', 0, 30)]
  early.tracks[3]!.locked = true
  assert.equal(freezeRefusal(early, early.tracks[0]!.items[0]!, 60), null)
  // And the clip's own locked track says so first.
  const own = fixture()
  own.tracks[0]!.locked = true
  assert.match(freezeRefusal(own, own.tracks[0]!.items[0]!, 60) ?? '', /^V1 is locked/)
})

test('the target is a selected video clip under the playhead, else the topmost, and never a title or a sound', () => {
  const timeline = fixture()
  timeline.tracks.push(track('v3', 'video', [clip('Top', 'shot', 'v3', 50, 30)]))
  const p = project(timeline)
  const pick = (selection: string[], frame: number) => freezeTarget(p, timeline, selection, frame)
  const top = pick([], 60)
  assert.ok(top.ok && top.item.id === 'Top', 'the last video track drawn is the one on top')
  const chosen = pick(['A', 'As'], 60)
  assert.ok(chosen.ok && chosen.item.id === 'A', 'a selected clip wins over the top one')
  // The title on V2 is under the playhead but is not video; with only it selected, the reason says so.
  const title = pick(['T'], 45)
  assert.ok(!title.ok && /not video/.test(title.error))
  const empty = pick([], 400)
  assert.ok(!empty.ok && /no video clip under the playhead/.test(empty.error))
})
