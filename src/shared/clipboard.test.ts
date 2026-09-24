/**
 * The clip clipboard (`@shared/clipboard`): where Paste puts clips, what it keeps, what it never
 * does (overwrite, re-link to the originals), and Paste Attributes.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attributePatch, copyClips, pasteClips, type ClipboardPayload } from './clipboard'
import { linkedPartners, normaliseLinks } from './links'
import { itemsOverlap, type Asset, type Item, type Project, type Timeline, type Track } from './project'

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
    assetId: 'shot',
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

function fixture(): { project: Project; timeline: Timeline } {
  const timeline: Timeline = {
    id: 'tl',
    name: 'T',
    fps: 30,
    width: 1920,
    height: 1080,
    background: '#000',
    tracks: [
      track('v1', 'video', [
        clip('P', 'v1', 0, 30, {
          linkId: 'L',
          audioDetached: true,
          grade: { exposure: 0.5 } as Item['grade'],
          keyframes: { opacity: [{ frame: 0, value: 0 }, { frame: 10, value: 1 }] } as Item['keyframes']
        }),
        clip('Q', 'v1', 30, 30)
      ]),
      track('a1', 'audio', [clip('S', 'a1', 0, 30, { linkId: 'L' })])
    ],
    transitions: [{ id: 't', kind: 'cross-dissolve', fromItemId: 'P', toItemId: 'Q', durationInFrames: 10 }]
  }
  const project: Project = {
    id: 'p',
    name: 'p',
    version: 1,
    assets: [asset('shot')],
    timelines: [timeline],
    activeTimelineId: 'tl',
    createdAt: 0,
    updatedAt: 0
  }
  return { project, timeline }
}

let n = 0
const options = {
  makeId: (prefix: string) => `${prefix}_${++n}`,
  makeTrack: (timeline: Timeline, kind: Track['kind']): Track =>
    track(`new${timeline.tracks.length}`, kind, [])
}

const all = (timeline: Timeline): Item[] => timeline.tracks.flatMap((t) => t.items)

function paste(at: number, over: Partial<typeof options> & { trackId?: string } = {}) {
  const { project, timeline } = fixture()
  const payload = copyClips(project, timeline, ['P', 'Q', 'S']) as ClipboardPayload
  const result = pasteClips(project, timeline, payload, at, { ...options, ...over })
  assert.ok(result.ok, !result.ok ? result.error : '')
  const pasted = all(timeline).filter((item) => result.ok && result.itemIds.includes(item.id))
  return { project, timeline, result, pasted }
}

test('paste lands the earliest clip on the frame and keeps the rest at their distance', () => {
  const { pasted } = paste(100)
  const byOrigin = (from: number, trackId: string) => pasted.find((i) => i.from === from && i.trackId === trackId)
  assert.ok(byOrigin(100, 'v1'), 'P at 100 on V1')
  assert.ok(byOrigin(130, 'v1'), 'Q at 130 on V1, 30 frames after, as before')
  assert.ok(byOrigin(100, 'a1'), 'S at 100 on A1, under its picture')
  assert.equal(pasted.length, 3)
})

test('paste keeps keyframes, grade and the detached flag, as copies', () => {
  const { timeline, pasted } = paste(100)
  const picture = pasted.find((i) => i.from === 100 && i.trackId === 'v1')!
  assert.deepEqual(picture.keyframes, { opacity: [{ frame: 0, value: 0 }, { frame: 10, value: 1 }] })
  assert.deepEqual(picture.grade, { exposure: 0.5 })
  assert.equal(picture.audioDetached, true)
  // A copy, not a shared reference: editing the paste leaves the original alone.
  picture.grade = { exposure: 2 } as Item['grade']
  assert.deepEqual(all(timeline).find((i) => i.id === 'P')!.grade, { exposure: 0.5 })
})

test('pasted clips are linked to each other and never to the originals, even overlapping them', () => {
  // At 10 the pasted sound overlaps the original picture in time. With the original link id kept,
  // `normaliseLinks` would join them into one group and a move of one would drag the other.
  const { timeline, pasted } = paste(10)
  normaliseLinks(timeline, () => 'fresh')
  const picture = pasted.find((i) => i.trackId === 'v1' && i.from === 10) ?? pasted.find((i) => i.from === 10)!
  const partners = linkedPartners(timeline, picture.id).map((i) => i.id)
  assert.equal(partners.length, 1)
  assert.ok(pasted.some((i) => i.id === partners[0]), 'its partner is the pasted sound')
  assert.deepEqual(
    linkedPartners(timeline, 'P').map((i) => i.id),
    ['S'],
    'the original picture is still linked to its own sound only'
  )
})

test('paste never overwrites: occupied original tracks send the group to a free or new track', () => {
  const { timeline, result, pasted } = paste(10)
  for (const track of timeline.tracks) {
    for (const a of track.items) {
      for (const b of track.items) {
        if (a !== b) assert.equal(itemsOverlap(a, b), false, `${a.id} overlaps ${b.id} on ${track.id}`)
      }
    }
  }
  assert.ok(result.ok && result.createdTrackIds.length === 2, 'V1 and A1 are both occupied at 10')
  // Positive control: pasting into free time uses the original tracks and makes none.
  const free = paste(100)
  assert.ok(free.result.ok && free.result.createdTrackIds.length === 0)
  assert.equal(pasted.length, 3)
})

test('a transition between two copied clips is pasted between their copies', () => {
  const { timeline, pasted } = paste(100)
  const copies = new Set(pasted.map((i) => i.id))
  const transitions = (timeline.transitions ?? []).filter((t) => copies.has(t.fromItemId) && copies.has(t.toItemId))
  assert.equal(transitions.length, 1)
  assert.notEqual(transitions[0]!.id, 't')
})

test('a single-track copy pastes onto a chosen track of its kind', () => {
  const { project, timeline } = fixture()
  timeline.tracks.push(track('v2', 'video', []))
  const payload = copyClips(project, timeline, ['Q'])!
  const result = pasteClips(project, timeline, payload, 0, { ...options, trackId: 'v2' })
  assert.ok(result.ok)
  assert.equal(timeline.tracks.find((t) => t.id === 'v2')!.items.length, 1)
})

test('pasting into another project brings the media the clips need', () => {
  const { project, timeline } = fixture()
  const payload = copyClips(project, timeline, ['Q'])!
  const other = fixture()
  other.project.assets = []
  const result = pasteClips(other.project, other.timeline, payload, 200, options)
  assert.ok(result.ok)
  assert.deepEqual(result.addedAssetIds, ['shot'])
  assert.equal(other.project.assets.length, 1)
})

test('paste attributes carries only what is chosen, and pastes absence as absence', () => {
  const { timeline } = fixture()
  const source = all(timeline).find((i) => i.id === 'P')!
  const target: Item = clip('T', 'v1', 0, 5, {
    volume: 0.2,
    grade: { exposure: -1 } as Item['grade'],
    keyframes: { volume: [{ frame: 0, value: 0.5 }] } as Item['keyframes']
  })
  const gradeOnly = attributePatch(source, target, new Set(['grade']))
  assert.deepEqual(Object.keys(gradeOnly), ['grade'])
  assert.deepEqual(gradeOnly.grade, { exposure: 0.5 })

  const transform = attributePatch(source, target, new Set(['transform']))
  assert.deepEqual(transform.keyframes, {
    volume: [{ frame: 0, value: 0.5 }],
    opacity: [{ frame: 0, value: 0 }, { frame: 10, value: 1 }]
  }, 'transform keys arrive; the target keeps its own volume keys')

  const fromUngraded = attributePatch(clip('U', 'v1', 0, 5), target, new Set(['grade', 'volume']))
  assert.ok('grade' in fromUngraded && fromUngraded.grade === undefined, 'no grade is pasted as removing one')
  assert.equal(fromUngraded.volume, 1)
  assert.ok('keyframes' in fromUngraded && fromUngraded.keyframes === undefined, 'volume keys removed, nothing left')
})
