/**
 * Frame rates, and the two places a rate stops being exact.
 *
 * A rate here is a *quotient*, not a decimal: `30000 / 1001`, never `29.97`. That is not
 * fastidiousness, it is measurable at the encoder — ffmpeg's `av_d2q` recovers `30000/1001`
 * from the full-precision double and gives the file a `1/30000` timebase, while the rounded
 * `29.97` becomes `2997/100` at `1/11988`, which nothing reads back as NTSC. So the rounding
 * has to stay on the outside of the model, and these tests hold that boundary.
 *
 * `retimeTimeline` is the other half. Changing a rate moves every clip, because a clip's
 * position is *expressed in* frames at that rate, and the subtle failure is not a clip landing
 * in the wrong place — it is two clips that used to touch no longer touching, which stops a
 * transition resolving with nothing on screen to say why.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FRAME_RATES,
  formatFps,
  formatTimecode,
  matchFrameRate,
  retimeTimeline,
  itemEnd,
  type Item,
  type Timeline,
  type Transition
} from './project'

const NTSC = 30000 / 1001

// --- the rate catalogue -------------------------------------------------------------------

test('every offered rate is stored as an exact quotient, not a decimal', () => {
  // The four NTSC-family rates are the ones that can be written wrong. `24000/1001` as a
  // decimal literal would be `23.976`, which is a different number; this asserts the stored
  // value is the division, by reproducing it.
  assert.equal(matchFrameRate(24000 / 1001)?.id, 'ntsc-film')
  assert.equal(matchFrameRate(30000 / 1001)?.id, 'ntsc')
  assert.equal(matchFrameRate(60000 / 1001)?.id, 'ntsc-double')
  for (const rate of FRAME_RATES) assert.ok(rate.fps > 0 && Number.isFinite(rate.fps))
})

test('a decimal-rounded rate is NOT recognised as one of ours', () => {
  // The positive control for the tolerance in `matchFrameRate`. If the window were loose
  // enough to accept 29.97 it would also accept a rate that exports at 2997/100, and the
  // inspector would show `29.97 · NTSC` over a file that is not NTSC. 29.97 is ~3e-5 away
  // from the real rate, so a 1e-6 window separates them and a 1e-4 window would not.
  assert.equal(matchFrameRate(29.97), undefined)
  assert.equal(matchFrameRate(23.976), undefined)
  assert.notEqual(29.97, NTSC)
})

test('formatFps rounds for display without the model ever seeing it', () => {
  assert.equal(formatFps(NTSC), '29.97')
  assert.equal(formatFps(24000 / 1001), '23.976')
  assert.equal(formatFps(60000 / 1001), '59.94')
  assert.equal(formatFps(30), '30')
  // And the round trip must not be usable as a shortcut: parsing the display form back gives a
  // rate this module refuses, which is the guard against someone doing exactly that.
  assert.equal(matchFrameRate(Number(formatFps(NTSC))), undefined)
})

// --- timecode -----------------------------------------------------------------------------

test('a non-integer rate does not put a fraction in the frames field', () => {
  // The bug: `total % 29.97002997` is fractional, so this read `0:01:0.02997002997003051`.
  for (const frames of [30, 31, 59, 60, 1000, 107892]) {
    const shown = formatTimecode(frames, NTSC, true)
    assert.doesNotMatch(shown, /\./, `${frames} at 29.97 produced ${shown}`)
    assert.match(shown, /^\d{2}:\d{2}:\d{2}:\d{2}$/)
  }
})

test('the frames field counts 0..29 at 29.97, the way non-drop timecode does', () => {
  assert.equal(formatTimecode(0, NTSC, true), '00:00:00:00')
  assert.equal(formatTimecode(29, NTSC, true), '00:00:00:29')
  assert.equal(formatTimecode(30, NTSC, true), '00:00:01:00')
  assert.equal(formatTimecode(30, 30, true), '00:00:01:00', 'and 30fps is unchanged by the fix')
})

// --- retiming -----------------------------------------------------------------------------

function item(id: string, from: number, duration: number, patch: Partial<Item> = {}): Item {
  return {
    id,
    assetId: 'ast_x',
    trackId: 'trk_1',
    from,
    durationInFrames: duration,
    sourceStartUs: 1_234_567,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    ...patch
  }
}

function timeline(items: Item[], transitions: Transition[] = []): Timeline {
  return {
    id: 'tl_1',
    name: 'Timeline',
    fps: 30,
    width: 1920,
    height: 1080,
    background: '#000',
    tracks: [{ id: 'trk_1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items }],
    transitions
  }
}

test('two clips that touched still touch after a retime', () => {
  // These numbers are not arbitrary and the test is worthless without them. At k = 24/30 the
  // naive arithmetic — scale `from`, scale `durationInFrames`, add — agrees with scaling the
  // end edge for most lengths, so a wrong implementation passes against almost any fixture.
  // `from: 3, duration: 3` is the smallest case where they disagree: 0.8·3 = 2.4 rounds down
  // twice to 2 + 2 = 4, while the end edge 0.8·6 = 4.8 rounds up to 5. The naive version ends
  // the first clip on frame 4 and starts the second on frame 5 — a one-frame gap at a cut that
  // had none, and a transition across it silently stops resolving.
  //
  // Derived by enumerating from×duration up to 200×60 rather than picked by eye, and proven by
  // mutation: scaling the duration instead of the edge fails this assertion.
  const a = item('a', 3, 3)
  const b = item('b', 6, 3)
  const tl = timeline([a, b])
  assert.equal(itemEnd(a), b.from, 'the fixture must actually abut, or nothing is being tested')

  retimeTimeline(tl, 24)

  const [first, second] = tl.tracks[0]!.items as [Item, Item]
  assert.equal(itemEnd(first), second.from, 'the cut must survive, or its transition stops resolving')
  assert.equal(second.from, 5, 'the second clip sits on the scaled edge, not on the naive sum')
  assert.equal(tl.fps, 24)
})

test('a clip stays at the same wall-clock time, within a frame', () => {
  const tl = timeline([item('a', 300, 150)])
  const secondsBefore = 300 / 30

  retimeTimeline(tl, 24)

  const after = tl.tracks[0]!.items[0]!
  assert.ok(
    Math.abs(after.from / 24 - secondsBefore) <= 1 / 24,
    `moved from ${secondsBefore}s to ${after.from / 24}s`
  )
  assert.equal(after.from, 240)
  assert.equal(after.durationInFrames, 120)
})

test('no two clips overlap after a retime, and the report says when one was nudged', () => {
  // Three abutting clips at a rate change that forces a collision on rounding.
  const tl = timeline([item('a', 0, 1), item('b', 1, 1), item('c', 2, 1)])

  const { nudged } = retimeTimeline(tl, 10) // k = 1/3, so every clip rounds onto frame 0

  const items = tl.tracks[0]!.items
  for (let i = 1; i < items.length; i += 1) {
    assert.ok(items[i]!.from >= itemEnd(items[i - 1]!), 'clips must not overlap')
  }
  assert.ok(nudged > 0, 'a collision that had to be resolved must be reported, not silent')
})

test('a retime never re-cuts the footage', () => {
  const tl = timeline([item('a', 60, 60)])
  retimeTimeline(tl, 60)
  assert.equal(
    tl.tracks[0]!.items[0]!.sourceStartUs,
    1_234_567,
    'sourceStartUs is microseconds into the source, whose rate is not ours to change'
  )
})

test('a fade is scaled and stays within half its clip', () => {
  const tl = timeline([item('a', 0, 30, { fadeInFrames: 15, fadeOutFrames: 15 })])
  retimeTimeline(tl, 60)
  const after = tl.tracks[0]!.items[0]!
  assert.equal(after.durationInFrames, 60)
  assert.equal(after.fadeInFrames, 30)
  assert.ok(after.fadeInFrames + after.fadeOutFrames <= after.durationInFrames)
})

test('a transition duration is scaled and never drops below two frames', () => {
  const tl = timeline(
    [item('a', 0, 30), item('b', 30, 30)],
    [{ id: 'trn_1', kind: 'cross-dissolve', fromItemId: 'a', toItemId: 'b', durationInFrames: 12 }]
  )
  retimeTimeline(tl, 60)
  assert.equal(tl.transitions![0]!.durationInFrames, 24)

  retimeTimeline(tl, 1)
  assert.equal(tl.transitions![0]!.durationInFrames, 2, 'one frame per side is the floor')
})

test('retiming to the same rate, or to nonsense, changes nothing', () => {
  for (const rate of [30, 0, -5, Number.NaN]) {
    const tl = timeline([item('a', 90, 30)])
    assert.deepEqual(retimeTimeline(tl, rate), { nudged: 0 })
    assert.equal(tl.tracks[0]!.items[0]!.from, 90)
    assert.equal(tl.fps, 30)
  }
})

test('a marker on a cut is still on that cut after a retime', () => {
  // The same specimen as the abutment test: the cut at frame 6 lands on 5 at 24fps, where the
  // naive `from + duration` would say 4. A marker scaled any other way than an edge drifts off.
  const tl = timeline([item('a', 3, 3), item('b', 6, 3)])
  tl.markers = [{ id: 'mk_cut', frame: 6, label: 'the cut' }]

  retimeTimeline(tl, 24)

  const b = tl.tracks[0]!.items[1]!
  assert.equal(tl.markers[0]!.frame, b.from, 'the marker must still name the cut it was placed on')
})

test('a marker keeps its wall-clock time when the rate changes', () => {
  const tl = timeline([item('a', 0, 900)])
  tl.markers = [{ id: 'mk', frame: 300, label: 'ten seconds' }]
  retimeTimeline(tl, 60)
  assert.equal(tl.markers[0]!.frame, 600)
})
