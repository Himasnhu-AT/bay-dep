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
import {
  itemsAtFrame,
  type Asset,
  type Item,
  type Project,
  type Timeline,
  type TransitionKind
} from '@shared/project'
import type { CompositionSound } from '@shared/composition'
import { itemAudioGainAt } from '@shared/audio-gain'
import { audioRoutingAt, compositionSoundsAt } from './audio'

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

// -- transitions ------------------------------------------------------------

/** Two adjacent clips of one asset on one track, with a dissolve across the cut. */
function splitWithTransition(kind: TransitionKind = 'cross-dissolve'): {
  project: Project
  timeline: Timeline
} {
  const layout = { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 }
  const base = {
    assetId: 'ast',
    trackId: 'v1',
    sourceStartUs: 0,
    layout,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  }
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
        muted: false,
        hidden: false,
        items: [
          { ...base, id: 'a', from: 0, durationInFrames: 60, sourceStartUs: 20_000_000 },
          { ...base, id: 'b', from: 60, durationInFrames: 60, sourceStartUs: 40_000_000 }
        ]
      }
    ],
    transitions: [
      { id: 'tx', kind, fromItemId: 'a', toItemId: 'b', durationInFrames: 20 }
    ]
  }
  const project: Project = {
    id: 'prj',
    name: 'test',
    version: 1,
    // Two minutes of source, so both clips have handles either side of the cut. The default
    // 10s asset in this file cannot support a transition at all when the clips read from 20s
    // and 40s — `resolveTransition` correctly returns null, and the first version of these
    // tests failed because the fixture could not represent the case, not because the code was
    // wrong. Worth a sentence: a fixture that cannot hold the condition is the most common way
    // a test in this project has been wrong.
    assets: [{ ...asset('ast'), durationUs: 120_000_000 }],
    timelines: [timeline],
    activeTimelineId: 'tl',
    createdAt: 0,
    updatedAt: 0
  }
  return { project, timeline }
}

test('both clips of a transition contribute audio, even though only one contains the frame', () => {
  // The reason this needs saying: inside the window, frames before the cut are inside the
  // outgoing clip and frames from it on are inside the incoming one, so a plain containment
  // test returns exactly one of them — a dissolve showing two pictures and playing one.
  const { project, timeline } = splitWithTransition()
  const atCut = audioRoutingAt(project, timeline, 60)
  assert.deepEqual(
    atCut.map((r) => r.item.id).sort(),
    ['a', 'b'],
    'the outgoing clip must keep sounding past its own end'
  )
  const beforeCut = audioRoutingAt(project, timeline, 55)
  assert.deepEqual(beforeCut.map((r) => r.item.id).sort(), ['a', 'b'])
})

test('the two clips take different element slots, so they get separate source nodes', () => {
  // One node per asset would bind both clips to one element: two pictures, one sound.
  const { project, timeline } = splitWithTransition()
  const routed = audioRoutingAt(project, timeline, 60)
  const slots = routed.map((r) => r.slot).sort()
  assert.deepEqual(slots, [0, 1])
})

test('the cross-fade gain follows the transition, and reaches each clip alone at its ends', () => {
  const { project, timeline } = splitWithTransition()
  // Window is 20 frames centred on 60: firstFrame 50, lastFrame 69.
  const gainOf = (frame: number, id: string): number =>
    audioRoutingAt(project, timeline, frame).find((r) => r.item.id === id)?.transitionGain ?? -1

  assert.equal(gainOf(50, 'a'), 1, 'at the start of the window the outgoing clip is at full gain')
  assert.equal(gainOf(50, 'b'), 0, 'and the incoming clip is silent')
  assert.equal(gainOf(69, 'a'), 0)
  assert.equal(gainOf(69, 'b'), 1)
  const midA = gainOf(60, 'a')
  const midB = gainOf(60, 'b')
  assert.ok(midA > 0 && midA < 1 && midB > 0 && midB < 1, `mid gains ${midA}/${midB}`)
})

test('outside the window each clip sounds on its own at full gain', () => {
  const { project, timeline } = splitWithTransition()
  const before = audioRoutingAt(project, timeline, 20)
  assert.deepEqual(before.map((r) => r.item.id), ['a'])
  assert.equal(before[0]?.transitionGain, 1)
  const after = audioRoutingAt(project, timeline, 100)
  assert.deepEqual(after.map((r) => r.item.id), ['b'])
  assert.equal(after[0]?.transitionGain, 1)
})

test('a dip silences both clips at its midpoint rather than cross-fading them', () => {
  const { project, timeline } = splitWithTransition('dip-to-black')
  const mid = audioRoutingAt(project, timeline, 60)
  // Window 50..69, so frame 59/60 straddles the midpoint; both gains are near zero there.
  for (const r of mid) {
    assert.ok(r.transitionGain <= 0.15, `${r.item.id} should be near silent, got ${r.transitionGain}`)
  }
})

test('a transition does not change whether a muted track is audible', () => {
  // The cross-fade multiplies the sound; mute decides whether it reaches the master at all.
  // Conflating them would make a dissolve un-mute a track for the length of the window.
  const { project, timeline } = splitWithTransition()
  const track = timeline.tracks[0]
  assert.ok(track)
  track.muted = true
  for (const r of audioRoutingAt(project, timeline, 60)) {
    assert.equal(r.audible, false, 'muted stays muted through a transition')
    assert.equal(r.metered, true, 'and the meter still reads, so the user can see what is muted')
  }
})

// ---------------------------------------------------------------------------
// Sounds an HTML composition declares
// ---------------------------------------------------------------------------

function compositionScene(muted = false, second = false): { project: Project; timeline: Timeline } {
  const comp = asset('comp', { kind: 'html', path: '/c/title.html', hasAudio: false })
  const one: Item = { ...item('c1', 'v1', 'comp'), fadeInFrames: 10, volume: 0.5 }
  const two: Item = { ...item('c2', 'v2', 'comp'), from: 0 }
  const timeline: Timeline = {
    id: 'tl',
    name: 'Timeline 1',
    fps: 30,
    width: 1920,
    height: 1080,
    background: '#000000',
    tracks: [
      { id: 'v1', kind: 'video', name: 'V1', locked: false, muted, hidden: false, items: [one] },
      ...(second
        ? [{ id: 'v2', kind: 'video' as const, name: 'V2', locked: false, muted: false, hidden: false, items: [two] }]
        : [])
    ]
  }
  const project: Project = {
    id: 'p',
    name: 'p',
    version: 1,
    assets: [comp],
    timelines: [timeline],
    activeTimelineId: 'tl',
    createdAt: 0,
    updatedAt: 0
  }
  return { project, timeline }
}

const WHOOSH: CompositionSound = {
  id: 'whoosh',
  src: 'whoosh.wav',
  path: '/c/whoosh.wav',
  startSeconds: 0.1,
  durationSeconds: null,
  mediaStartSeconds: 0,
  volume: 0.8,
  line: 1
}

test('a declared sound is routed at the shared schedule and the shared gain', () => {
  const { project, timeline } = compositionScene()
  const routed = compositionSoundsAt(project, timeline, 6, () => [WHOOSH])
  assert.equal(routed.length, 1)
  const [one] = routed
  assert.equal(one?.asset.path, '/c/whoosh.wav')
  assert.equal(one?.asset.kind, 'audio', 'a stand-in the pool gives an <audio> element')
  const item0 = timeline.tracks[0]!.items[0]!
  assert.equal(one?.gain, itemAudioGainAt(project, timeline, item0, 6) * 0.8)
  // Frame 6 is 0.2s; the sound began at 0.1s.
  assert.ok(Math.abs((one?.mediaSeconds ?? -1) - 0.1) < 1e-9)
  // Before its data-start it is not routed at all.
  assert.deepEqual(compositionSoundsAt(project, timeline, 2, () => [WHOOSH]), [])
})

test('a muted track still routes its composition sound, to the meter and not the master', () => {
  // The same rule as clips: `muted` governs what reaches the master, and the meter keeps
  // showing what is on the track.
  const { project, timeline } = compositionScene(true)
  const [routed] = compositionSoundsAt(project, timeline, 6, () => [WHOOSH])
  assert.equal(routed?.audible, false)
  const unmuted = compositionScene(false)
  const [open] = compositionSoundsAt(unmuted.project, unmuted.timeline, 6, () => [WHOOSH])
  assert.equal(open?.audible, true, 'the positive control')
})

test('a composition whose declarations are not known yet is silent, not an error', () => {
  const { project, timeline } = compositionScene()
  assert.deepEqual(compositionSoundsAt(project, timeline, 6, () => null), [])
})

test('two placements of one composition sounding together get two elements', () => {
  // One element cannot be at two positions; keyed by asset alone, the second placement would
  // fight the first over currentTime and neither would sound right.
  const { project, timeline } = compositionScene(false, true)
  const routed = compositionSoundsAt(project, timeline, 6, () => [WHOOSH])
  assert.equal(routed.length, 2)
  assert.notEqual(routed[0]?.asset.id, routed[1]?.asset.id)
})
