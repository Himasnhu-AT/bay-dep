import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemsAtFrame, type Item, type Timeline, type Track } from '@shared/project'
import {
  boxFrom,
  clampFade,
  combineSelection,
  displayOrder,
  formatDb,
  gapAt,
  gapsOf,
  insertIndexFor,
  marqueeHits,
  volumeAtY,
  yForVolume
} from './timelineLayout'

function item(id: string, trackId: string, from: number, durationInFrames: number): Item {
  return {
    id,
    assetId: 'a',
    trackId,
    from,
    durationInFrames,
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1, height: 1, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  }
}

function track(id: string, kind: Track['kind'], items: Item[] = [], extra: Partial<Track> = {}): Track {
  return { id, kind, name: id, locked: false, muted: false, hidden: false, items, ...extra }
}

// -- track order -----------------------------------------------------------------

test('the list shows the front picture layer at the top, then audio below every video track', () => {
  // The shape `addTrack` produces: V1 and A1 from the template, then V2 and V3 appended.
  const tracks = [track('V1', 'video'), track('A1', 'audio'), track('V2', 'video'), track('A2', 'audio'), track('V3', 'video')]
  assert.deepEqual(displayOrder(tracks).map((t) => t.id), ['V3', 'V2', 'V1', 'A1', 'A2'])
})

test('the top of the list is the layer the compositor draws last, i.e. on top', () => {
  // Derived from the compositor's own ordering rather than asserted beside it: whatever
  // `itemsAtFrame` paints last must be the first video track the timeline lists.
  const tracks = [
    track('V1', 'video', [item('i1', 'V1', 0, 10)]),
    track('A1', 'audio'),
    track('V2', 'video', [item('i2', 'V2', 0, 10)])
  ]
  const timeline = { tracks } as unknown as Timeline
  const painted = itemsAtFrame(timeline, 0, 'video')
  const topPainted = painted[painted.length - 1]
  assert.equal(displayOrder(tracks)[0]?.id, topPainted?.trackId)
})

test('a new track lands where the menu said, in display terms, for both kinds', () => {
  const tracks = [track('V1', 'video'), track('A1', 'audio'), track('V2', 'video'), track('A2', 'audio')]
  const shown = (index: number | undefined, kind: Track['kind']): string[] => {
    assert.notEqual(index, undefined)
    const next = [...tracks]
    next.splice(index!, 0, track('NEW', kind))
    return displayOrder(next).map((t) => t.id)
  }
  assert.deepEqual(shown(insertIndexFor(tracks, 'V1', 'above'), 'video'), ['V2', 'NEW', 'V1', 'A1', 'A2'])
  assert.deepEqual(shown(insertIndexFor(tracks, 'V1', 'below'), 'video'), ['V2', 'V1', 'NEW', 'A1', 'A2'])
  assert.deepEqual(shown(insertIndexFor(tracks, 'V2', 'above'), 'video'), ['NEW', 'V2', 'V1', 'A1', 'A2'])
  assert.deepEqual(shown(insertIndexFor(tracks, 'A1', 'above'), 'audio'), ['V2', 'V1', 'NEW', 'A1', 'A2'])
  assert.deepEqual(shown(insertIndexFor(tracks, 'A1', 'below'), 'audio'), ['V2', 'V1', 'A1', 'NEW', 'A2'])
  assert.equal(insertIndexFor(tracks, 'missing', 'above'), undefined)
})

// -- gaps ------------------------------------------------------------------------

test('gaps are the holes a clip follows, not the runway after the last clip', () => {
  const t = track('V1', 'video', [item('b', 'V1', 30, 10), item('a', 'V1', 5, 10), item('c', 'V1', 40, 5)])
  assert.deepEqual(gapsOf(t), [
    { trackId: 'V1', from: 0, to: 5 },
    { trackId: 'V1', from: 15, to: 30 }
  ])
  assert.deepEqual(gapAt(t, 15), { trackId: 'V1', from: 15, to: 30 })
  assert.equal(gapAt(t, 30), undefined, 'half-open: the next clip’s first frame is not the gap')
  assert.equal(gapAt(t, 100), undefined, 'after the last clip there is nothing to close')
  assert.equal(gapAt(t, 42), undefined)
})

// -- marquee ---------------------------------------------------------------------

test('a band selects what it reaches into, dragged in any direction, and not what it only meets', () => {
  const rects = [
    { id: 'a', left: 0, right: 100, top: 0, bottom: 50 },
    { id: 'b', left: 120, right: 200, top: 0, bottom: 50 },
    { id: 'c', left: 0, right: 100, top: 60, bottom: 100 }
  ]
  // Dragged up and to the left: the corners arrive reversed.
  assert.deepEqual(marqueeHits(boxFrom(150, 40, 90, 10), rects), ['a', 'b'])
  assert.deepEqual(marqueeHits(boxFrom(100, 0, 120, 55), rects), [], 'edges only')
  assert.deepEqual(marqueeHits(boxFrom(50, 55, 60, 70), rects), ['c'])
})

test('shift adds to the selection the band started with, cmd toggles against it', () => {
  assert.deepEqual(combineSelection(['x', 'a'], ['a', 'b'], 'replace'), ['a', 'b'])
  assert.deepEqual(combineSelection(['x', 'a'], ['a', 'b'], 'add').sort(), ['a', 'b', 'x'])
  assert.deepEqual(combineSelection(['x', 'a'], ['a', 'b'], 'toggle').sort(), ['b', 'x'])
})

// -- fades -----------------------------------------------------------------------

test('a fade handle stops at the other fade and at zero, in whole frames', () => {
  const clip = { durationInFrames: 60, fadeInFrames: 10, fadeOutFrames: 20 }
  assert.equal(clampFade(clip, 'in', 55), 40, 'fade-in stops where the fade-out begins')
  assert.equal(clampFade(clip, 'out', 55), 50, 'fade-out stops where the fade-in ends')
  assert.equal(clampFade(clip, 'in', -8), 0)
  assert.equal(clampFade(clip, 'in', 12.6), 13)
  assert.equal(clampFade(clip, 'in', Number.NaN), 10, 'a bad pointer value keeps the fade it had')
})

test('the volume line maps top to +6 dB, the middle to unity and the bottom to silence', () => {
  assert.equal(volumeAtY(0, 40), 2)
  assert.equal(volumeAtY(20, 40), 1)
  assert.equal(volumeAtY(40, 40), 0)
  assert.equal(volumeAtY(-10, 40), 2, 'dragged above the clip clamps')
  assert.equal(yForVolume(1, 40), 20)
  assert.equal(formatDb(1), '0.0 dB')
  assert.equal(formatDb(0.5), '−6.0 dB')
  assert.equal(formatDb(2), '+6.0 dB')
  assert.equal(formatDb(0), '−∞ dB')
})
