import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BeatGrid } from '@shared/beats'
import type { Asset, Item, Project, Timeline } from '@shared/project'
import { snapFrame, snapTargets } from './snap'

function item(partial: Partial<Item> & Pick<Item, 'id' | 'assetId' | 'trackId' | 'from' | 'durationInFrames'>): Item {
  return {
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1, height: 1, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    ...partial
  } as Item
}

/** A song on A1 with beats at 1.0, 1.5, 2.0 … s (frames 30, 45, 60 … at 30 fps), and a clip on V1. */
function fixture(options: { analysed: boolean; markers?: number[] }): { project: Project; timeline: Timeline } {
  const grid: BeatGrid = {
    version: 1,
    bpm: 120,
    confidence: 0.9,
    beatsPerBar: 4,
    beatsUs: Array.from({ length: 20 }, (_, i) => 1_000_000 + i * 500_000),
    downbeatsUs: [],
    downbeatConfidence: 0,
    dropouts: []
  }
  const song = { id: 'song', kind: 'audio', path: '/song.wav', durationUs: 20_000_000 } as Asset
  if (options.analysed) song.beats = grid
  const shot = { id: 'shot', kind: 'video', path: '/shot.mp4', durationUs: 20_000_000 } as Asset
  const timeline: Timeline = {
    id: 'tl',
    name: 'Timeline',
    fps: 30,
    width: 1920,
    height: 1080,
    background: '#000',
    tracks: [
      { id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items: [item({ id: 'clip', assetId: 'shot', trackId: 'v1', from: 200, durationInFrames: 50 })] },
      { id: 'a1', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items: [item({ id: 'music', assetId: 'song', trackId: 'a1', from: 0, durationInFrames: 600 })] }
    ],
    markers: (options.markers ?? []).map((frame, i) => ({ id: `mk${i}`, frame, label: `M${i}` }))
  }
  return {
    timeline,
    project: { id: 'p', name: 'P', version: 1, assets: [song, shot], timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0 }
  }
}

const TOLERANCE = 4 // frames: 8 px at 2 px per frame

test('a clip dragged near a beat of the music snaps onto it', () => {
  const { project, timeline } = fixture({ analysed: true })
  const targets = snapTargets(project, timeline, 0, new Set(['clip']))
  // 107.4 is 2.4 frames from the beat at 105 (3.5 s) and nowhere near an edge or the playhead.
  assert.equal(snapFrame(107.4, targets, TOLERANCE), 105)
  // The same drag over music nobody analysed lands where it was dropped: the beat is the cause.
  const bare = fixture({ analysed: false })
  assert.equal(snapFrame(107.4, snapTargets(bare.project, bare.timeline, 0, new Set(['clip'])), TOLERANCE), 107)
})

test('a drag snaps to a marker, and not to one out of reach', () => {
  const { project, timeline } = fixture({ analysed: false, markers: [333] })
  const targets = snapTargets(project, timeline, 0, new Set(['clip']))
  assert.equal(snapFrame(331, targets, TOLERANCE), 333)
  assert.equal(snapFrame(320, targets, TOLERANCE), 320)
})

test('the dragged music does not snap to its own beats', () => {
  // Dragging the song itself: its beats move with it, so they are not targets — or every drag
  // of an analysed song would stick to wherever it already is.
  const { project, timeline } = fixture({ analysed: true })
  const targets = snapTargets(project, timeline, 0, new Set(['music']))
  assert.ok(!targets.includes(105), `the song's own beat at 105 is a target: ${targets.join(',')}`)
  // Its neighbour's edges still are.
  assert.ok(targets.includes(200) && targets.includes(250))
})

test('the existing targets are all still there: origin, playhead, clip edges', () => {
  const { project, timeline } = fixture({ analysed: false })
  const targets = snapTargets(project, timeline, 77, new Set(['music']))
  for (const expected of [0, 77, 200, 250]) assert.ok(targets.includes(expected), `missing ${expected}`)
})
