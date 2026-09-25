import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Project, Timeline } from '@shared/project'
import { itemsToDraw } from './compositor'
import { audioRoutingAt } from './audio'

/**
 * A transition on an audio track is the music's, not the picture's.
 *
 * Measured before this: a cross-dissolve joining two clips of a score on A1 made the export report
 * every frame of its window incomplete — "shows the background where it should show
 * score-seed333.flac" — because the picture pass took the audio transition for the frame's and
 * put both music clips on its draw list, where they waited for a picture they will never have.
 */

const asset = (id: string, video: boolean) => ({
  id, kind: video ? 'video' : 'audio', name: `${id}.file`, path: `/tmp/${id}`, durationUs: 60_000_000,
  width: video ? 1080 : null, height: video ? 1920 : null, fps: video ? 24 : null,
  hasAudio: true, hasVideo: video, posterPath: null, waveformPath: null, createdAt: 0
})

const item = (id: string, assetId: string, trackId: string, from: number, sourceStartUs: number) => ({
  id, assetId, trackId, from, durationInFrames: 60, sourceStartUs,
  layout: { left: 0, top: 0, width: 1080, height: 1920, opacity: 1, rotation: 0 },
  volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
})

/** A picture on V1 over the whole span; a two-clip `pair` joined by a 20-frame dissolve at 60. */
function fixture(pairOn: 'audio' | 'video' | 'hidden-video'): { project: Project; timeline: Timeline } {
  const pairKind = pairOn === 'audio' ? 'audio' : 'video'
  const pairAsset = pairOn === 'audio' ? 'music' : 'clip'
  const timeline = {
    id: 'tl', name: 'T', fps: 24, width: 1080, height: 1920, background: '#000',
    tracks: [
      { id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false,
        items: [{ ...item('P', 'shot', 'v1', 0, 0), durationInFrames: 120 }] },
      { id: 'x', kind: pairKind, name: 'X', locked: false, muted: false, hidden: pairOn === 'hidden-video',
        items: [item('M1', pairAsset, 'x', 0, 5_000_000), item('M2', pairAsset, 'x', 60, 20_000_000)] }
    ],
    transitions: [{ id: 't', fromItemId: 'M1', toItemId: 'M2', kind: 'cross-dissolve', durationInFrames: 20 }]
  } as unknown as Timeline
  const project = {
    id: 'p', name: 'P', createdAt: 0, updatedAt: 0, activeTimelineId: 'tl', timelines: [timeline],
    assets: [asset('shot', true), asset('clip', true), asset('music', false)]
  } as unknown as Project
  return { project, timeline }
}

test('the picture does not draw an audio track\'s transition; the sound still crossfades it', () => {
  const { project, timeline } = fixture('audio')
  const picture = itemsToDraw(project, timeline, 60)
  assert.deepEqual(picture.items.map((i) => i.id), ['P'], 'only the picture is on the draw list')
  assert.equal(picture.active, null, 'no picture transition at the audio crossfade')

  // What the change must not break: both music clips sound through the window, on two elements.
  const sound = audioRoutingAt(project, timeline, 60)
  const music = sound.filter((r) => r.item.id === 'M1' || r.item.id === 'M2')
  assert.equal(music.length, 2, `both halves of the crossfade sound (${sound.map((r) => r.item.id)})`)
  assert.notEqual(music[0]!.slot, music[1]!.slot, 'on separate elements')
  assert.ok(music.every((r) => r.transitionGain > 0 && r.transitionGain < 1), 'with crossing gains')
})

test('a transition on a visible video track is still the picture\'s (the control)', () => {
  const { project, timeline } = fixture('video')
  const picture = itemsToDraw(project, timeline, 60)
  assert.ok(picture.active, 'the video dissolve is active at its cut')
  assert.deepEqual(picture.items.map((i) => i.id), ['P', 'M1', 'M2'])
})

test('a transition on a hidden video track is not drawn, as its clips are not', () => {
  const { project, timeline } = fixture('hidden-video')
  const picture = itemsToDraw(project, timeline, 60)
  assert.equal(picture.active, null)
  assert.deepEqual(picture.items.map((i) => i.id), ['P'])
})

test('a transition is painted at its own track, under the tracks above it', () => {
  // The video fixture with the pair moved below the picture: V1 holds the dissolve, V2 a title
  // over the whole span. Measured before the fix: the pair was appended after every track, so
  // the V2 picture vanished for the dissolve's whole window, in the preview and in the export.
  const { project, timeline } = fixture('video')
  const [picture, pair] = timeline.tracks
  timeline.tracks = [pair!, picture!]
  const drawn = itemsToDraw(project, timeline, 60)
  assert.ok(drawn.active, 'the dissolve is active at its cut')
  // The specimen is only a specimen if the higher track is really present at this frame.
  assert.ok(drawn.items.some((i) => i.id === 'P'), 'the V2 picture is on the draw list')
  assert.deepEqual(drawn.items.map((i) => i.id), ['M1', 'M2', 'P'], 'bottom first: the pair, then the track above it')
})
