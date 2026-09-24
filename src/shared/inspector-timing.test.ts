/**
 * Typed Start and Duration in the inspector: the store refuses a collision or a locked track by
 * doing nothing, so the field just snapped back. `timingRefusal` says why, in words — and says
 * nothing for the nearest legal value, which is the positive control for each refusal.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asSentences, timingRefusal } from './inspector'
import type { Asset, Item, Project, Timeline } from './project'

const base = { durationUs: 6_000_000, width: 1280, height: 720, fps: 30, hasAudio: true, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 0, path: '/m.mp4' }

function clip(id: string, from: number, durationInFrames: number, trackId = 'v1', extra: Partial<Item> = {}): Item {
  return {
    id, assetId: id === 'b' ? 'ast_b' : 'ast_a', trackId, from, durationInFrames, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...extra
  }
}

function world(items: Item[], locked = false): { project: Project; timeline: Timeline } {
  const assets: Asset[] = [
    { ...base, id: 'ast_a', kind: 'video', name: 'Interview.mp4' },
    { ...base, id: 'ast_b', kind: 'video', name: 'B-roll.mp4' }
  ]
  const timeline: Timeline = {
    id: 'tl', name: 'tl', fps: 30, width: 1920, height: 1080, background: '#000000',
    tracks: [
      { id: 'v1', kind: 'video', name: 'V1', locked, muted: false, hidden: false, items: items.filter((i) => i.trackId === 'v1') },
      { id: 'a1', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items: items.filter((i) => i.trackId === 'a1') }
    ]
  }
  return { project: { id: 'p', name: 'p', version: 1, assets, timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0 }, timeline }
}

test('a typed Start that lands on the next clip is refused, naming both clips and the track', () => {
  // a 0..60, b 150..240: moving a to 120 overlaps b.
  const { project, timeline } = world([clip('a', 0, 60), clip('b', 150, 90)])
  const refusal = timingRefusal(project, timeline, ['a'], { from: 120 })
  assert.equal(refusal, 'Interview.mp4 would land on B-roll.mp4 on V1. Pick a start in free time, or move B-roll.mp4 first.')
  // The nearest legal start: flush against b.
  assert.equal(timingRefusal(project, timeline, ['a'], { from: 90 }), null)
})

test('a typed Duration that runs into the next clip is refused; the longest that fits is not', () => {
  const { project, timeline } = world([clip('a', 0, 60), clip('b', 150, 90)])
  assert.match(timingRefusal(project, timeline, ['a'], { durationInFrames: 151 }) ?? '', /Interview\.mp4 would run into B-roll\.mp4 on V1\. Make it shorter/)
  assert.equal(timingRefusal(project, timeline, ['a'], { durationInFrames: 150 }), null)
})

test('a locked track is named, with how to get past it', () => {
  const { project, timeline } = world([clip('a', 0, 60)], true)
  assert.equal(timingRefusal(project, timeline, ['a'], { from: 10 }), 'V1 is locked, so Interview.mp4 cannot move. Unlock V1 first.')
  assert.equal(timingRefusal(project, timeline, ['a'], { durationInFrames: 30 }), 'V1 is locked, so Interview.mp4 cannot change length. Unlock V1 first.')
})

test('J/L clamp notes become one sentence each, not two clauses run together', () => {
  // The measured run-on: "the audio lead is 0 frames, not 10: … in-point the audio trail is …".
  const notes = [
    "the audio lead is 0 frames, not 10: the source has only 0 frames before this clip's in-point",
    "the audio trail is 0 frames, not 15: the source has only 0 frames after this clip's out-point"
  ]
  assert.deepEqual(asSentences(notes), [
    "The audio lead is 0 frames, not 10: the source has only 0 frames before this clip's in-point.",
    "The audio trail is 0 frames, not 15: the source has only 0 frames after this clip's out-point."
  ])
  assert.deepEqual(asSentences(['Already a sentence.', '  ']), ['Already a sentence.'])
})

test('a linked sound moves and trims with its picture, so its collisions count too', () => {
  // The picture has room; its detached sound on A1 would land on another sound.
  const picture = clip('a', 0, 60, 'v1', { linkId: 'lnk' })
  const sound = clip('s', 0, 60, 'a1', { linkId: 'lnk' })
  const other = clip('b', 100, 60, 'a1')
  const { project, timeline } = world([picture, sound, other])
  assert.match(timingRefusal(project, timeline, ['a'], { from: 80 }) ?? '', /would land on B-roll\.mp4 on A1/)
  assert.equal(timingRefusal(project, timeline, ['a'], { from: 40 }), null)
})
