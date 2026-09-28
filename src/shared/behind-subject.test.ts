/**
 * "Text behind the subject" as an arrangement: the clip, the title above it, the cut-out above
 * that — and each refusal carrying what to do instead, beside the nearest call that succeeds.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Item, Timeline, Track } from './project'
import { planBehindSubject } from './behind-subject'
import { subjectMaskOf } from './matte'

let n = 0
const makeId = (prefix: string): string => `${prefix}_${++n}`
const options = {
  makeId,
  makeVideoTrack: (timeline: Timeline): Track => ({ id: makeId('trk'), kind: 'video' as const, name: `V${timeline.tracks.length + 1}`, locked: false, muted: false, hidden: false, items: [] })
}

function item(id: string, assetId: string, trackId: string, from: number, durationInFrames: number, extra: Partial<Item> = {}): Item {
  return {
    id, assetId, trackId, from, durationInFrames, sourceStartUs: 1_000_000,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...extra
  }
}
function track(id: string, items: Item[], extra: Partial<Track> = {}): Track {
  return { id, kind: 'video', name: id, locked: false, muted: false, hidden: false, items, ...extra }
}
function timeline(tracks: Track[]): Timeline {
  return { id: 'tl', name: 'tl', fps: 30, width: 1920, height: 1080, background: '#000', tracks, transitions: [] }
}
const ids = (tl: Timeline): string[][] => tl.tracks.map((t) => t.items.map((i) => i.id))

test('title above the clip: the cut-out goes directly above the title, a copy of the same moment, linked and silent', () => {
  const tl = timeline([track('v1', [item('clip', 'vid', 'v1', 0, 300, { grade: { saturation: 0.8 } })]), track('v2', [item('title', 'txt', 'v2', 30, 90)])])
  const result = planBehindSubject(tl, { videoItemId: 'clip', overlayItemId: 'title' }, options)
  assert.ok(result.ok, JSON.stringify(result))
  assert.equal(tl.tracks.length, 3, 'a new track above the title')
  assert.deepEqual(ids(tl), [['clip'], ['title'], [result.cutoutItemId]])
  const clip = tl.tracks[0]!.items[0]!
  const cutout = tl.tracks[2]!.items[0]!
  // The same moment of the same file: what makes the compositor draw it from the clip's element.
  for (const field of ['assetId', 'from', 'durationInFrames', 'sourceStartUs', 'speed'] as const) assert.equal(cutout[field], clip[field], field)
  assert.deepEqual(cutout.layout, clip.layout)
  assert.deepEqual(cutout.grade, clip.grade, 'the look comes along, or the edge shows')
  assert.deepEqual(subjectMaskOf(cutout), { kind: 'subject' })
  assert.equal(subjectMaskOf(clip), null, 'the clip itself is not masked')
  assert.ok(cutout.linkId && cutout.linkId === clip.linkId, 'linked to the clip, so they move and trim together')
  assert.equal(cutout.audioDetached, true, 'silent: the clip already plays its sound')
  assert.equal(cutout.trackId, tl.tracks[2]!.id)
  assert.equal(result.movedOverlay, false)
  assert.ok(result.warnings.some((w) => /grade/.test(w)), 'the copied look is named')
})

test('title under the clip: it moves above the clip, and the cut-out above it', () => {
  const tl = timeline([track('v1', [item('title', 'txt', 'v1', 30, 90)]), track('v2', [item('clip', 'vid', 'v2', 0, 300)])])
  const result = planBehindSubject(tl, { videoItemId: 'clip', overlayItemId: 'title' }, options)
  assert.ok(result.ok)
  assert.equal(result.movedOverlay, true)
  assert.deepEqual(ids(tl), [[], ['clip'], ['title'], [result.cutoutItemId]])
  assert.equal(tl.tracks[2]!.items[0]!.trackId, tl.tracks[2]!.id)
})

test('a free track directly above the title is used; one with something at that time is not', () => {
  const free = timeline([track('v1', [item('clip', 'vid', 'v1', 0, 300)]), track('v2', [item('title', 'txt', 'v2', 30, 90)]), track('v3', [item('late', 'img', 'v3', 400, 30)])])
  const a = planBehindSubject(free, { videoItemId: 'clip', overlayItemId: 'title' }, options)
  assert.ok(a.ok)
  assert.equal(a.cutoutTrackId, 'v3', 'free for the clip\'s span')
  assert.equal(free.tracks.length, 3)
  const busy = timeline([track('v1', [item('clip', 'vid', 'v1', 0, 300)]), track('v2', [item('title', 'txt', 'v2', 30, 90)]), track('v3', [item('logo', 'img', 'v3', 100, 30)])])
  const b = planBehindSubject(busy, { videoItemId: 'clip', overlayItemId: 'title' }, options)
  assert.ok(b.ok)
  assert.notEqual(b.cutoutTrackId, 'v3')
  assert.deepEqual(ids(busy), [['clip'], ['title'], [b.cutoutItemId], ['logo']], 'inserted between the title and the logo')
})

test('asked twice: the cut-out is reused, not stacked', () => {
  const tl = timeline([track('v1', [item('clip', 'vid', 'v1', 0, 300)]), track('v2', [item('title', 'txt', 'v2', 30, 90)])])
  const first = planBehindSubject(tl, { videoItemId: 'clip', overlayItemId: 'title' }, options)
  const second = planBehindSubject(tl, { videoItemId: 'clip', overlayItemId: 'title', feather: 4 }, options)
  assert.ok(first.ok && second.ok)
  assert.equal(second.reused, true)
  assert.equal(second.cutoutItemId, first.cutoutItemId)
  assert.equal(tl.tracks.length, 3)
  assert.deepEqual(subjectMaskOf(tl.tracks[2]!.items[0]!), { kind: 'subject', feather: 4 })
})

test('refusals say what to do next; the nearest legal call succeeds', () => {
  const apart = timeline([track('v1', [item('clip', 'vid', 'v1', 0, 60)]), track('v2', [item('title', 'txt', 'v2', 100, 30)])])
  const r1 = planBehindSubject(apart, { videoItemId: 'clip', overlayItemId: 'title' }, options)
  assert.equal(r1.ok, false)
  if (!r1.ok) assert.match(r1.error, /title \(title, frames 100–130\) and the clip \(clip, frames 0–60\) never play at the same time.*edit_item/)
  assert.deepEqual(ids(apart), [['clip'], ['title']], 'nothing changed')
  const touching = timeline([track('v1', [item('clip', 'vid', 'v1', 0, 101)]), track('v2', [item('title', 'txt', 'v2', 100, 30)])])
  assert.equal(planBehindSubject(touching, { videoItemId: 'clip', overlayItemId: 'title' }, options).ok, true, 'one frame of overlap is enough')

  const locked = timeline([track('v1', [item('title', 'txt', 'v1', 0, 30)], { locked: true }), track('v2', [item('clip', 'vid', 'v2', 0, 300)])])
  const r2 = planBehindSubject(locked, { videoItemId: 'clip', overlayItemId: 'title' }, options)
  assert.equal(r2.ok, false)
  if (!r2.ok) assert.match(r2.error, /title is under the clip, on v1, which is locked.*Unlock v1/)
  const unlocked = timeline([track('v1', [item('title', 'txt', 'v1', 0, 30)]), track('v2', [item('clip', 'vid', 'v2', 0, 300)])])
  assert.equal(planBehindSubject(unlocked, { videoItemId: 'clip', overlayItemId: 'title' }, options).ok, true)

  const same = planBehindSubject(unlocked, { videoItemId: 'clip', overlayItemId: 'clip' }, options)
  assert.equal(same.ok, false)
  if (!same.ok) assert.match(same.error, /same item/)
  const unknown = planBehindSubject(unlocked, { videoItemId: 'nope', overlayItemId: 'title' }, options)
  assert.equal(unknown.ok, false)
  if (!unknown.ok) assert.match(unknown.error, /No clip nope.*read_project/)
})
