/**
 * Tests for the hidden/muted model.
 *
 * Two independent properties, two independent outputs: **`hidden` governs picture only,
 * `muted` governs sound only, and both apply to tracks of either kind.** The reason is
 * editorial — hiding a layer to see what is under it must not silently change the mix you
 * are judging, and silencing a video track that carries speech must not require blanking
 * its picture.
 *
 * It is worth pinning because the engine got it wrong in a way no unit test could see: the
 * compositor's retire sweep paused any pooled element the *draw loop* had not touched, and
 * a hidden track's items never reach the draw loop — so hiding a track paused its element,
 * and a paused element is silent however correctly the audio graph is wired. The fault was
 * in a consumer, but the model is what says the consumer was wrong.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemsAtFrame, type Asset, type Item, type Project, type Timeline } from '@shared/project'
import { audioRoutingAt } from './audio'

function asset(id: string, over: Partial<Asset> = {}): Asset {
  return {
    id,
    kind: 'video',
    name: id,
    path: `/tmp/${id}.mp4`,
    durationUs: 10_000_000,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    hasVideo: true,
    posterPath: null,
    waveformPath: null,
    createdAt: 0,
    ...over
  }
}

function item(id: string, trackId: string, assetId: string): Item {
  return {
    id,
    assetId,
    trackId,
    from: 0,
    durationInFrames: 100,
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  }
}

/** One video track carrying a clip that has both picture and sound. */
function scene(over: { hidden?: boolean; muted?: boolean; hasAudio?: boolean } = {}): {
  project: Project
  timeline: Timeline
} {
  const timeline: Timeline = {
    id: 'tl',
    name: 'Timeline 1',
    fps: 30,
    width: 1920,
    height: 1080,
    background: '#000000',
    tracks: [
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        locked: false,
        muted: over.muted ?? false,
        hidden: over.hidden ?? false,
        items: [item('itm', 'v1', 'ast')]
      }
    ]
  }
  const project: Project = {
    id: 'prj',
    name: 'test',
    version: 1,
    assets: [asset('ast', { hasAudio: over.hasAudio ?? true })],
    timelines: [timeline],
    activeTimelineId: 'tl',
    createdAt: 0,
    updatedAt: 0
  }
  return { project, timeline }
}

test('hiding a video track removes its picture and keeps its sound', () => {
  const { project, timeline } = scene({ hidden: true })

  assert.deepEqual(
    itemsAtFrame(timeline, 0, 'video').map((i) => i.id),
    [],
    'hidden means the compositor draws nothing'
  )

  const routed = audioRoutingAt(project, timeline, 0)
  assert.equal(routed.length, 1, 'but the sound is still in the mix')
  assert.equal(routed[0]?.audible, true, 'and it still reaches the master')
  assert.equal(routed[0]?.metered, true)
})

test('muting a video track removes its sound and keeps its picture', () => {
  const { project, timeline } = scene({ muted: true })

  assert.deepEqual(
    itemsAtFrame(timeline, 0, 'video').map((i) => i.id),
    ['itm'],
    'muted has nothing to do with the picture'
  )

  const routed = audioRoutingAt(project, timeline, 0)
  assert.equal(routed.length, 1, 'the item is still routed, so its meter still reads')
  assert.equal(routed[0]?.metered, true, 'a muted meter that reads zero is lying')
  assert.equal(routed[0]?.audible, false, 'but nothing reaches the master')
})

test('mute applies to video tracks, not only audio ones', () => {
  // The control was nearly left undrawn on video tracks because `itemsAtFrame` only honours
  // `muted` for audio tracks, and that was read as the engine ignoring it.
  const { project, timeline } = scene({ muted: true })
  assert.equal(timeline.tracks[0]?.kind, 'video')
  assert.equal(audioRoutingAt(project, timeline, 0)[0]?.audible, false)
})

test('the two flags are independent, in all four combinations', () => {
  const cases = [
    { hidden: false, muted: false, picture: 1, audible: true },
    { hidden: true, muted: false, picture: 0, audible: true },
    { hidden: false, muted: true, picture: 1, audible: false },
    { hidden: true, muted: true, picture: 0, audible: false }
  ]
  for (const c of cases) {
    const { project, timeline } = scene(c)
    assert.equal(itemsAtFrame(timeline, 0, 'video').length, c.picture, JSON.stringify(c))
    assert.equal(audioRoutingAt(project, timeline, 0)[0]?.audible, c.audible, JSON.stringify(c))
  }
})

test('a clip with no audio contributes nothing to the mix', () => {
  // The discriminator that keeps the decode leak fixed: a hidden clip with no audio is
  // wanted by neither consumer, so the pool retires it.
  const { project, timeline } = scene({ hidden: true, hasAudio: false })
  assert.deepEqual(audioRoutingAt(project, timeline, 0), [])
})

test('an unreadable asset contributes nothing to the mix', () => {
  const { project, timeline } = scene()
  project.assets = [asset('ast', { error: 'probe failed' })]
  assert.deepEqual(audioRoutingAt(project, timeline, 0), [])
})

test('only items under the playhead are routed', () => {
  const { project, timeline } = scene()
  assert.equal(audioRoutingAt(project, timeline, 99).length, 1, 'last frame is inside')
  assert.equal(audioRoutingAt(project, timeline, 100).length, 0, 'one past the end is not')
  assert.equal(audioRoutingAt(project, timeline, -1).length, 0)
})
