/**
 * Detached audio and linked clips (`@shared/links`), the pure half: what detach builds, that it is
 * audibly a no-op when it lands, what `normaliseLinks` makes of a cut pair, and reattach.
 *
 * The preview's routing is `engine/audio-detach.test.ts`; the store's linked edits are
 * `store/links.test.ts`; the rendered file is `main/export/detached-audio-render.test.ts`.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemAudioGainAt } from './audio-gain'
import {
  detachAudio,
  linkedPartners,
  normaliseLinks,
  reattachAudio,
  soundAlignedWithPicture,
  unlinkItems,
  withLinked
} from './links'
import type { Asset, Item, Project, Timeline, Track } from './project'

const FPS = 30

function asset(id: string, over: Partial<Asset> = {}): Asset {
  return {
    id,
    kind: 'video',
    name: `${id}.mp4`,
    path: `/m/${id}.mp4`,
    durationUs: 60_000_000,
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
    sourceStartUs: 3_000_000,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 0.7,
    fadeInFrames: 5,
    fadeOutFrames: 9,
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
    fps: FPS,
    width: 1920,
    height: 1080,
    background: '#000',
    tracks: [
      track('v1', 'video', [
        clip('A', 'shot', 'v1', 0, 90),
        clip('B', 'shot', 'v1', 90, 60, { sourceStartUs: 20_000_000 }),
        clip('P', 'still', 'v1', 150, 30)
      ]),
      track('a1', 'audio', [clip('M', 'bed', 'a1', 0, 40)])
    ],
    transitions: [{ id: 'x', kind: 'cross-dissolve', fromItemId: 'A', toItemId: 'B', durationInFrames: 12 }]
  }
  const project: Project = {
    id: 'p',
    name: 'p',
    version: 1,
    assets: [asset('shot'), asset('bed', { kind: 'audio', hasVideo: false, width: null, height: null }), asset('still', { kind: 'image', hasAudio: false, durationUs: 0 })],
    timelines: [timeline],
    activeTimelineId: 'tl',
    createdAt: 0,
    updatedAt: 0
  }
  return { project, timeline }
}

let counter = 0
const options = {
  makeId: (prefix: string) => `${prefix}_${++counter}`,
  makeAudioTrack: (timeline: Timeline): Track =>
    track(`a${timeline.tracks.filter((t) => t.kind === 'audio').length + 1}`, 'audio', [])
}

const find = (timeline: Timeline, id: string): Item =>
  timeline.tracks.flatMap((t) => t.items).find((i) => i.id === id)!

/** The sound of the whole timeline at each frame, as one number per sounding item — preview and export both read this. */
function soundAt(project: Project, timeline: Timeline, frame: number): number {
  let sum = 0
  for (const t of timeline.tracks) {
    if (t.muted) continue
    for (const item of t.items) {
      const a = project.assets.find((x) => x.id === item.assetId)
      if (!a?.hasAudio || item.assetId === 'bed') continue
      sum += itemAudioGainAt(project, timeline, item, frame)
    }
  }
  return sum
}

test('detach puts the sound on a free audio track, linked, with the same in-point and span', () => {
  const { project, timeline } = fixture()
  const result = detachAudio(project, timeline, ['A'], options)
  assert.deepEqual(result.refused, [])
  assert.equal(result.detached.length, 1)
  const pair = result.detached[0]!
  // A1 holds M at 0–40, which overlaps A, so the sound needed a new track.
  assert.equal(result.createdTrackIds.length, 1, 'A1 is occupied, so a track was added')
  assert.equal(pair.trackId, result.createdTrackIds[0])
  const audio = find(timeline, pair.audioId)
  const picture = find(timeline, 'A')
  assert.ok(soundAlignedWithPicture(audio, picture), 'same asset, span, in-point and speed')
  assert.equal(picture.audioDetached, true)
  assert.equal(audio.linkId, picture.linkId)
  assert.deepEqual(linkedPartners(timeline, 'A').map((i) => i.id), [pair.audioId])
  assert.equal(audio.volume, 0.7, "the audio item takes the clip's level")
})

test('detaching is audibly a no-op, fades and the dissolve included — then the picture fade is the picture\'s alone', () => {
  const { project, timeline } = fixture()
  const before = Array.from({ length: 160 }, (_, f) => soundAt(project, timeline, f))
  // A specimen that can tell: the sound is not flat (fades and a dissolve move it).
  assert.ok(new Set(before.map((v) => v.toFixed(4))).size > 5, 'specimen: the sound changes over the range')

  const result = detachAudio(project, timeline, ['A', 'B'], options)
  assert.equal(result.detached.length, 2)
  assert.equal(result.addedTransitionIds.length, 1, 'the dissolve is copied onto the audio track')
  const after = Array.from({ length: 160 }, (_, f) => soundAt(project, timeline, f))
  for (let f = 0; f < 160; f += 1) {
    assert.ok(Math.abs(after[f]! - before[f]!) < 1e-9, `frame ${f}: ${before[f]} before, ${after[f]} after`)
  }
  // Now the requirement the feature exists for: fade the picture out, and the sound does not move.
  find(timeline, 'B').fadeOutFrames = 30
  const faded = Array.from({ length: 160 }, (_, f) => soundAt(project, timeline, f))
  for (let f = 0; f < 160; f += 1) assert.ok(Math.abs(faded[f]! - after[f]!) < 1e-9, `frame ${f}`)
  assert.equal(itemAudioGainAt(project, timeline, find(timeline, 'B'), 140), 0, 'the picture plays no sound')
})

test('a transition with one side detached is not copied, and the result says the sound now cuts there', () => {
  const { project, timeline } = fixture()
  const result = detachAudio(project, timeline, ['A'], options)
  assert.deepEqual(result.addedTransitionIds, [])
  assert.ok(
    result.warnings.some((w) => w.includes('x') && w.includes('Detach the other clip too')),
    result.warnings.join(' | ')
  )
})

test('refusals name the reason: a still, an audio-track clip, one already detached — beside one that detaches', () => {
  const { project, timeline } = fixture()
  const result = detachAudio(project, timeline, ['P', 'M', 'A'], options)
  assert.deepEqual(result.detached.map((d) => d.pictureId), ['A'], 'the legal one still goes through')
  const reason = (id: string): string => result.refused.find((r) => r.itemId === id)?.reason ?? ''
  assert.match(reason('P'), /no sound/)
  assert.match(reason('M'), /audio track A1/)
  const again = detachAudio(project, timeline, ['A'], options)
  assert.match(again.refused[0]?.reason ?? '', new RegExp(`already detached — it is ${result.detached[0]!.audioId}`))
})

test('an explicit trackId that is occupied is refused with the clashing clip, not placed over it', () => {
  const { project, timeline } = fixture()
  const clash = detachAudio(project, timeline, ['A'], { ...options, trackId: 'a1' })
  assert.match(clash.refused[0]?.reason ?? '', /A1 has M at 0-40, which overlaps A at 0-90/)
  assert.equal(find(timeline, 'A').audioDetached, undefined, 'nothing changed')
  // The nearest legal call: B (90–150) fits on A1.
  const fits = detachAudio(project, timeline, ['B'], { ...options, trackId: 'a1' })
  assert.equal(fits.detached[0]?.trackId, 'a1')
})

test('normaliseLinks: a linked pair cut at one frame becomes two linked pairs, and an orphan is unlinked', () => {
  const { project, timeline } = fixture()
  const { detached } = detachAudio(project, timeline, ['A'], options)
  const audioId = detached[0]!.audioId
  assert.equal(normaliseLinks(timeline, () => 'fresh'), false, 'a well-formed timeline is left alone')

  // Cut both at 40, the way splitAt, ripple and remove_range do: the tails carry the old linkId.
  for (const id of ['A', audioId]) {
    const item = find(timeline, id)
    const tail = { ...item, id: `${id}-tail`, from: 40, durationInFrames: item.durationInFrames - 40 }
    item.durationInFrames = 40
    timeline.tracks.find((t) => t.items.includes(item))!.items.push(tail)
  }
  assert.equal(normaliseLinks(timeline, () => 'fresh'), true)
  assert.deepEqual(withLinked(timeline, ['A']).sort(), ['A', audioId].sort())
  assert.deepEqual(withLinked(timeline, ['A-tail']).sort(), ['A-tail', `${audioId}-tail`].sort())
  assert.equal(find(timeline, 'A-tail').linkId, 'fresh')

  // Delete one tail: the other has nothing left to be in sync with.
  const v1 = timeline.tracks.find((t) => t.id === 'v1')!
  v1.items = v1.items.filter((i) => i.id !== 'A-tail')
  normaliseLinks(timeline, () => 'unused')
  assert.equal(find(timeline, `${audioId}-tail`).linkId, undefined)
})

test('reattach restores the picture\'s sound and removes its audio item; unlink keeps both', () => {
  const { project, timeline } = fixture()
  const before = Array.from({ length: 160 }, (_, f) => soundAt(project, timeline, f))
  const { detached } = detachAudio(project, timeline, ['A', 'B'], options)
  // Reattach through the audio item's id — either side names the pair.
  const back = reattachAudio(timeline, [detached[0]!.audioId, 'B'])
  assert.deepEqual(back.reattached.map((r) => r.pictureId), ['A', 'B'])
  assert.equal(find(timeline, 'A').audioDetached, undefined)
  assert.equal(find(timeline, 'A').linkId, undefined)
  assert.equal(timeline.transitions?.length, 1, 'the copied audio transition went with its items')
  const after = Array.from({ length: 160 }, (_, f) => soundAt(project, timeline, f))
  for (let f = 0; f < 160; f += 1) assert.ok(Math.abs(after[f]! - before[f]!) < 1e-9, `frame ${f}`)

  const again = detachAudio(project, timeline, ['A'], options)
  const unlinked = unlinkItems(timeline, ['A'])
  assert.deepEqual(unlinked.sort(), ['A', again.detached[0]!.audioId].sort())
  assert.equal(find(timeline, 'A').audioDetached, true, 'unlinking does not give the picture its sound back')
  assert.equal(reattachAudio(timeline, ['M']).refused[0]?.reason, 'M has no detached sound to reattach')
})
