import { test } from 'node:test'
import assert from 'node:assert/strict'
import { beatFramesForItem, beatSnapFrames, timelineFrameAt, type BeatGrid } from './beats'
import { sourceTimeAt, type Asset, type Item, type Project, type Timeline } from './project'

function item(partial: Partial<Item> & Pick<Item, 'id' | 'from' | 'durationInFrames'>): Item {
  return {
    assetId: 'song',
    trackId: 'a1',
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1, height: 1, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    ...partial
  } as Item
}

/** A 120 BPM grid: a beat every 0.5 s from 0.5 s, a downbeat every fourth. */
function grid120(count = 40): BeatGrid {
  const beatsUs = Array.from({ length: count }, (_, i) => 500_000 + i * 500_000)
  return {
    version: 1,
    bpm: 120,
    confidence: 0.9,
    beatsPerBar: 4,
    beatsUs,
    downbeatsUs: beatsUs.filter((_, i) => i % 4 === 0),
    downbeatConfidence: 0.5,
    dropouts: [{ startUs: 10_000_000, endUs: 12_000_000, kind: 'percussion' }]
  }
}

function project(items: Item[], grid: BeatGrid | undefined): { project: Project; timeline: Timeline } {
  const timeline: Timeline = {
    id: 'tl',
    name: 'Timeline',
    fps: 30,
    width: 1920,
    height: 1080,
    background: '#000',
    tracks: [{ id: 'a1', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items }]
  }
  const song = { id: 'song', kind: 'audio', name: 'song.wav', path: '/song.wav', durationUs: 30_000_000 } as Asset
  if (grid) song.beats = grid
  return {
    timeline,
    project: { id: 'p', name: 'P', version: 1, assets: [song], timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0 }
  }
}

test('a beat maps to the timeline frame at which the clip plays it — in-point, position and speed', () => {
  // Placed at frame 100, reading from 2 s in, at 2× speed: source 3.0 s is 1.0 s of source
  // past the in-point, which is 0.5 s of timeline, which is 15 frames.
  const clip = item({ id: 'c', from: 100, durationInFrames: 300, sourceStartUs: 2_000_000, speed: 2 })
  assert.equal(timelineFrameAt(clip, 3_000_000, 30), 115)
  // The inverse of sourceTimeAt, which is what "maps" has to mean.
  assert.equal(sourceTimeAt(clip, 115, 30), 3_000_000)
  // Before the in-point and past the out-point it does not play at all.
  assert.equal(timelineFrameAt(clip, 1_900_000, 30), null)
  assert.equal(timelineFrameAt(clip, 2_000_000 + 2 * 10_000_000, 30), null) // 10 s of timeline = frame 400 = the end
  assert.equal(timelineFrameAt(clip, 2_000_000 + 2 * 9_900_000, 30), 397) // 9.9 s of timeline, the last beat inside
})

test('beatFramesForItem keeps only the beats the clip plays, and clips drop-outs to it', () => {
  // From 1.0 s of source for 5 s of timeline: beats at 1.0 … 5.5 s play, 0.5 s and 6.0 s do not.
  const clip = item({ id: 'c', from: 30, durationInFrames: 150, sourceStartUs: 1_000_000 })
  const mapped = beatFramesForItem(grid120(), clip, 30)
  assert.deepEqual(mapped.beats, [30, 45, 60, 75, 90, 105, 120, 135, 150, 165])
  // Downbeats are every fourth beat of the source: 0.5, 2.5, 4.5 s → 2.5 and 4.5 s play.
  assert.deepEqual(mapped.downbeats, [75, 135])
  // The drop-out at 10-12 s of source is past this clip entirely.
  assert.deepEqual(mapped.dropouts, [])

  const late = item({ id: 'd', from: 0, durationInFrames: 330, sourceStartUs: 0 }) // plays 0-11 s
  assert.deepEqual(beatFramesForItem(grid120(), late, 30).dropouts, [{ startFrame: 300, endFrame: 330, kind: 'percussion' }])
})

test('beatSnapFrames: every placed clip of an analysed file, except the ones being dragged', () => {
  const a = item({ id: 'a', from: 0, durationInFrames: 60 }) // beats at 0.5, 1.0, 1.5 s → 15, 30, 45
  const b = item({ id: 'b', from: 300, durationInFrames: 30, sourceStartUs: 500_000 }) // 0.5 s → 300, 1.0 s → 315
  const { project: p, timeline } = project([a, b], grid120())
  assert.deepEqual(beatSnapFrames(p, timeline, new Set()), [15, 30, 45, 300, 315])
  assert.deepEqual(beatSnapFrames(p, timeline, new Set(['b'])), [15, 30, 45])
  // Positive control's pair: a file nobody analysed contributes nothing.
  const bare = project([a, b], undefined)
  assert.deepEqual(beatSnapFrames(bare.project, bare.timeline, new Set()), [])
})
