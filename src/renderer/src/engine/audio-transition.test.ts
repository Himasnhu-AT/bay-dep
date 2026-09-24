import { test } from 'node:test'
import assert from 'node:assert/strict'
import { audioRoutingAt } from './audio'
import type { Project, Timeline } from '@shared/project'

/**
 * A transition's two clips must BOTH sound, on their own elements, with gains that cross.
 *
 * This exists because `test/app/transition-audio.mjs` measures the real mixer and reports
 * silence, and there was no way to tell whether the routing was wrong or the graph downstream
 * of it was. It is the half that can be tested without a browser, and it pins the half that
 * turned out to be correct — so the next person to look starts below this line instead of
 * re-deriving it.
 */

const ASSET = {
  id: 'a1',
  kind: 'video' as const,
  name: 'clip.mp4',
  path: '/tmp/clip.mp4',
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

function item(id: string, from: number, trackId: string, sourceStartUs: number) {
  return {
    id,
    assetId: 'a1',
    trackId,
    from,
    durationInFrames: 60,
    sourceStartUs,
    layout: { x: 0, y: 0, width: 1, height: 1, rotation: 0, opacity: 1, scale: 1 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  }
}

/** Two abutting clips with a 30-frame dissolve centred on frame 60. */
function fixture(incomingSourceStartUs: number): { project: Project; timeline: Timeline } {
  const timeline = {
    id: 'tl',
    name: 'T',
    fps: 30,
    width: 1920,
    height: 1080,
    background: '#000',
    tracks: [
      {
        id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false,
        items: [item('A', 0, 'v1', 5_000_000)]
      },
      {
        id: 'v2', kind: 'video', name: 'V2', locked: false, muted: false, hidden: false,
        items: [item('B', 60, 'v2', incomingSourceStartUs)]
      }
    ],
    transitions: [
      { id: 't1', fromItemId: 'A', toItemId: 'B', kind: 'cross-dissolve', durationInFrames: 30 }
    ]
  } as unknown as Timeline

  const project = {
    id: 'p', name: 'P', createdAt: 0, updatedAt: 0,
    assets: [ASSET], timelines: [timeline], activeTimelineId: 'tl'
  } as unknown as Project

  return { project, timeline }
}

test('both clips sound inside the window, on separate elements', () => {
  const { project, timeline } = fixture(30_000_000)

  const mid = audioRoutingAt(project, timeline, 60)

  assert.equal(mid.length, 2, `expected both clips at the cut, got ${mid.map((r) => r.item.id)}`)
  // Separate slots, because a MediaElementAudioSourceNode is bound to one element for life —
  // two clips sounding at once from one asset need two elements or one of them is silent.
  assert.notEqual(mid[0]!.slot, mid[1]!.slot)
})

test('the balance crosses over, rather than one side merely fading', () => {
  const { project, timeline } = fixture(30_000_000)
  const gainOf = (frame: number, id: string): number =>
    audioRoutingAt(project, timeline, frame).find((r) => r.item.id === id)?.transitionGain ?? 0

  // Asserted as a relationship at three points rather than as three numbers: the curve may be
  // retuned, but the outgoing clip must always start ahead and end behind.
  assert.ok(gainOf(50, 'A') > gainOf(50, 'B'), 'outgoing leads early')
  assert.ok(gainOf(70, 'B') > gainOf(70, 'A'), 'incoming leads late')
  assert.ok(Math.abs(gainOf(60, 'A') - gainOf(60, 'B')) < 0.2, 'roughly level at the midpoint')
})

test('gains stay inside a range a gain node should ever see', () => {
  const { project, timeline } = fixture(30_000_000)
  for (const frame of [46, 50, 55, 60, 65, 70, 74]) {
    for (const routed of audioRoutingAt(project, timeline, frame)) {
      assert.ok(
        routed.transitionGain >= 0 && routed.transitionGain <= 1,
        `frame ${frame}: ${routed.item.id} gain ${routed.transitionGain}`
      )
    }
  }
})

test('an incoming clip with no handle gets no transition, and still sounds normally', () => {
  // `sourceStartUs: 0` means there is no footage before the clip's start, so the dissolve
  // cannot play and `resolveTransition` refuses it. The clip must still be audible — a refused
  // transition silencing a clip would be far worse than a hard cut.
  const { project, timeline } = fixture(0)

  const routed = audioRoutingAt(project, timeline, 70)

  assert.equal(routed.length, 1)
  assert.equal(routed[0]!.item.id, 'B')
  assert.equal(routed[0]!.transitionGain, 1, 'a clip outside a transition plays at full gain')
})
