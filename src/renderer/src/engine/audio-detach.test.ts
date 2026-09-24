/**
 * The preview's routing of detached sound — the half that can be checked without a browser.
 *
 * What it pins: a detached sound playing exactly what its picture shows shares the picture's
 * element (one decode per clip, the element the compositor already drives); one that no longer
 * lines up plays from its own `<audio>` stand-in with the picture element claimed silently; a
 * detached picture never routes its own sound; and a picture dissolve over a copied audio
 * cross-fade sounds both audio items — which the one-active-transition routing did not.
 * The real mixer is metered by `test/app/detach-audio.mjs` (PREVIEW), the file by
 * `main/export/detached-audio-render.test.ts` (EXPORT).
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { audioRoutingAt, silentPictureClaimsAt } from './audio'
import { detachAudio } from '@shared/links'
import type { Asset, Item, Project, Timeline, Track } from '@shared/project'

const FPS = 30

function asset(id: string): Asset {
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
    createdAt: 0
  }
}

function clip(id: string, trackId: string, from: number, duration: number, sourceStartUs: number): Item {
  return {
    id,
    assetId: 'shot',
    trackId,
    from,
    durationInFrames: duration,
    sourceStartUs,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  }
}

function track(id: string, kind: Track['kind'], items: Item[]): Track {
  return { id, kind, name: id.toUpperCase(), locked: false, muted: false, hidden: false, items }
}

/** V1: A (0–90) dissolving into B (90–150), two halves of one take. */
function fixture(): { project: Project; timeline: Timeline } {
  const timeline: Timeline = {
    id: 'tl',
    name: 'T',
    fps: FPS,
    width: 1920,
    height: 1080,
    background: '#000',
    tracks: [track('v1', 'video', [clip('A', 'v1', 0, 90, 5_000_000), clip('B', 'v1', 90, 60, 20_000_000)])],
    transitions: [{ id: 'x', kind: 'cross-dissolve', fromItemId: 'A', toItemId: 'B', durationInFrames: 12 }]
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
  makeAudioTrack: (): Track => track('a1', 'audio', [])
}

test('an aligned detached sound shares the element its picture is drawn from — one decode', () => {
  const { project, timeline } = fixture()
  const { detached } = detachAudio(project, timeline, ['A'], options)
  const audioId = detached[0]!.audioId
  const routed = audioRoutingAt(project, timeline, 30)
  assert.deepEqual(routed.map((r) => r.item.id), [audioId], 'only the audio item sounds; the picture routes nothing')
  const r = routed[0]!
  assert.equal(r.asset.id, 'shot', 'the picture asset itself, not a stand-in')
  assert.equal(r.detached, undefined, 'not positioned as its own element')
  assert.equal(r.track.id, detached[0]!.trackId, "mixed into the audio track's gain and meter")
  assert.deepEqual(silentPictureClaimsAt(project, timeline, 30), [{ asset: project.assets[0], slot: 0 }])
})

test('once the sound is slipped off its picture it plays from its own element, and the picture element is claimed', () => {
  const { project, timeline } = fixture()
  const { detached } = detachAudio(project, timeline, ['A'], options)
  const audio = timeline.tracks.flatMap((t) => t.items).find((i) => i.id === detached[0]!.audioId)!
  audio.sourceStartUs += 100_000
  const r = audioRoutingAt(project, timeline, 30)[0]!
  assert.notEqual(r.asset.id, 'shot', 'a stand-in: the picture element cannot play two source times')
  assert.equal(r.asset.hasVideo, false)
  assert.ok(r.detached, 'positioned by the audio engine')
  assert.ok(Math.abs(r.detached.mediaSeconds - (5.1 + 30 / FPS)) < 0.001, `source ${r.detached.mediaSeconds}`)
  assert.deepEqual(r.detached.claim, { asset: project.assets[0], slot: 0 })
})

test('a hidden picture track does not take the shared element away from the sound, it moves it to a stand-in', () => {
  const { project, timeline } = fixture()
  detachAudio(project, timeline, ['A'], options)
  timeline.tracks[0]!.hidden = true
  const r = audioRoutingAt(project, timeline, 30)[0]!
  assert.ok(r.detached, 'nothing draws the picture, so nothing drives its element')
  assert.equal(r.detached.claim, null)
  assert.deepEqual(silentPictureClaimsAt(project, timeline, 30), [])
})

test('a picture dissolve over the copied audio cross-fade sounds both audio items, complementary', () => {
  const { project, timeline } = fixture()
  const { detached, addedTransitionIds } = detachAudio(project, timeline, ['A', 'B'], options)
  assert.equal(addedTransitionIds.length, 1)
  const [a, b] = detached.map((d) => d.audioId)
  // The picture transition is listed first, so a routing that honours one active transition
  // answers with it and drops the audio pair's handles.
  assert.equal(timeline.transitions![0]!.id, 'x', 'specimen: the picture dissolve comes first')
  let crossed = 0
  for (let frame = 84; frame <= 95; frame += 1) {
    const routed = audioRoutingAt(project, timeline, frame)
    const gainOf = (id: string): number => routed.find((r) => r.item.id === id)?.gain ?? Number.NaN
    assert.ok(Number.isFinite(gainOf(a!)) && Number.isFinite(gainOf(b!)), `frame ${frame}: both sound`)
    assert.ok(Math.abs(gainOf(a!) + gainOf(b!) - 1) < 1e-9, `frame ${frame}: ${gainOf(a!)} + ${gainOf(b!)}`)
    if (gainOf(a!) > 0 && gainOf(b!) > 0) crossed += 1
    assert.ok(!routed.some((r) => r.item.id === 'A' || r.item.id === 'B'), 'the pictures route no sound')
  }
  assert.ok(crossed >= 10, `cross-faded over ${crossed} frames`)
})
