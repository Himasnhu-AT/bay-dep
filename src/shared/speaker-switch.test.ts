/**
 * The speaker-switch decision, on synthetic level curves (50 ms windows, dBFS).
 *
 * What is held still, each paired with the case beside it that must come out the other way:
 * - onset → cut latency is 0.30 s with the defaults (the audit's measurement of podclip), and the
 *   first speaker is the shot from frame 0 — no leading razor;
 * - one voice only is ONE angle used (podclip's refusal guard never fired: audit §8.3);
 * - bleed 7 dB under is ignored, 5 dB under is a second voice (→ the wide);
 * - an overlap with no wide goes to the louder speaker;
 * - attack, release, min shot, and the lead applied exactly rather than rounded to 50 ms;
 * - per-mic thresholds find a quiet guest an absolute threshold misses.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyAngleSwitch,
  autoThreshold,
  latchMics,
  LEVEL_WINDOW_SEC,
  planSwitch,
  SWITCH_DEFAULTS,
  type SwitchSegment
} from './speaker-switch'
import type { Item, Timeline, Track } from './project'

const FPS = 30
const W = LEVEL_WINDOW_SEC

/** A curve of `seconds` at `floor` dB, with each [from, to, level] stretch set to `level`. */
function curve(seconds: number, parts: [number, number, number][], floor = -60): number[] {
  const out = Array.from({ length: Math.round(seconds / W) }, () => floor)
  for (const [from, to, level] of parts) {
    for (let i = Math.round(from / W); i < Math.round(to / W) && i < out.length; i += 1) out[i] = level
  }
  return out
}

const span = (seconds: number) => ({ startFrame: 0, endFrame: Math.round(seconds * FPS), fps: FPS })

test('a new speaker is cut to 0.30 s after they start, and the first speaker holds from frame 0', () => {
  const a = curve(10, [[0, 5, -20]])
  const b = curve(10, [[5.5, 10, -20]])
  const plan = planSwitch([a, b], span(10), false, { thresholdDb: -40 })
  assert.deepEqual(plan.segments, [
    { angle: 0, fromFrame: 0, toFrame: 174 },
    { angle: 1, fromFrame: 174, toFrame: 300 }
  ])
  // 174 frames = 5.80 s: onset 5.50 + 0.30.
  assert.ok(Math.abs(plan.segments[1]!.fromFrame / FPS - 5.5 - 0.3) < 1e-9)
  assert.equal(plan.anglesUsed, 2)
})

test('the lead is applied exactly, not rounded to a 50 ms window', () => {
  const a = curve(10, [[0, 5, -20]])
  const b = curve(10, [[5.5, 10, -20]])
  // Decision at 5.90 s; 0.12 s earlier is 5.78 s = frame 173.4 → 173. Rounded to whole windows
  // (podclip) the lead would be 0.10 s and the cut frame 174.
  const plan = planSwitch([a, b], span(10), false, { thresholdDb: -40, leadSec: 0.12 })
  assert.equal(plan.segments[1]!.fromFrame, 173)
})

test('one voice is one angle used — the refusal guard sees it — while two voices are two', () => {
  const a = curve(10, [[1, 9, -20]])
  const silent = curve(10, [])
  const one = planSwitch([a, silent], span(10), false, { thresholdDb: -40 })
  assert.equal(one.anglesUsed, 1)
  assert.equal(one.segments.length, 1, 'no leading razor that changes nothing (podclip §4.2)')
  assert.deepEqual(one.segments[0], { angle: 0, fromFrame: 0, toFrame: 300 })
  assert.equal(one.mics[1]!.activeShare, 0)

  const two = planSwitch([a, curve(10, [[9, 10, -20]])], span(10), false, { thresholdDb: -40, minShotSec: 0.5 })
  assert.equal(two.anglesUsed, 2)

  // One mixed track on both angles: identical curves, 0 dB apart — both always active together.
  const mixed = planSwitch([a, a], span(10), false, { thresholdDb: -40 })
  assert.equal(mixed.anglesUsed, 1, 'identical mics cannot tell speakers apart')
})

test('nobody talking is no plan at all', () => {
  const plan = planSwitch([curve(5, []), curve(5, [])], span(5), true, { thresholdDb: -40 })
  assert.deepEqual(plan.segments, [])
  assert.equal(plan.anglesUsed, 0)
})

test('bleed 7 dB under the talker is ignored; 5 dB under is a second voice and goes to the wide', () => {
  const b = curve(10, [[0, 4, -20]])
  const withBleed = (bleedDb: number) => {
    const a = curve(10, [[4, 10, -20]])
    const bBleed = b.map((v, i) => (i * W >= 4 ? -20 - bleedDb : v))
    return planSwitch([a, bBleed], span(10), true, { thresholdDb: -40 })
  }
  const seven = withBleed(7)
  assert.equal(seven.segments.at(-1)!.angle, 0, JSON.stringify(seven.segments))
  assert.ok(!seven.segments.some((s) => s.angle === 2), 'no wide for bleed')
  const five = withBleed(5)
  assert.equal(five.segments.at(-1)!.angle, 2, JSON.stringify(five.segments))
})

test('two voices with no wide go to the louder one; with a wide, to the wide', () => {
  const b = curve(10, [[0, 10, -22]])
  const a = curve(10, [[4, 10, -20]])
  const noWide = planSwitch([a, b], span(10), false, { thresholdDb: -40 })
  assert.deepEqual(noWide.segments.map((s) => s.angle), [1, 0])
  const wide = planSwitch([a, b], span(10), true, { thresholdDb: -40 })
  assert.deepEqual(wide.segments.map((s) => s.angle), [1, 2])
})

test('attack: 6 hot windows do not latch, 7 do; release: 8 cold windows hold, the 9th lets go', () => {
  const opts = { attackSec: SWITCH_DEFAULTS.attackSec, releaseSec: SWITCH_DEFAULTS.releaseSec }
  const six = [-60, ...Array(6).fill(-20), -60]
  assert.ok(latchMics([six], [-40], opts).every((row) => !row[0]))
  const seven = [-60, ...Array(7).fill(-20), -60]
  const latched = latchMics([seven], [-40], opts).map((row) => row[0])
  assert.equal(latched.indexOf(true), 7, 'latches on the 7th hot window')

  const held = [...Array(7).fill(-20), ...Array(12).fill(-60)]
  const rows = latchMics([held], [-40], opts).map((row) => row[0])
  assert.equal(rows[7 + 7], true, '8th cold window still active')
  assert.equal(rows[7 + 8], false, '9th cold window released')
})

test('a blip shorter than the attack never cuts; a pause shorter than the release never cuts away', () => {
  const a = curve(10, [[0, 4, -20], [4.3, 10, -20]])
  const b = curve(10, [[4.0, 4.3, -20]])
  const plan = planSwitch([a, b], span(10), false, { thresholdDb: -40 })
  assert.deepEqual(plan.segments.map((s) => s.angle), [0])
  // The positive beside it: B talking long enough is cut to.
  const long = planSwitch([curve(10, [[0, 4, -20], [6, 10, -20]]), curve(10, [[4.0, 6, -20]])], span(10), false, { thresholdDb: -40 })
  assert.ok(long.segments.some((s) => s.angle === 1))
})

test('no shot is shorter than minShotSec', () => {
  const a = curve(12, [[0, 5.5, -20], [6.5, 12, -20]])
  const b = curve(12, [[5.5, 6.5, -20]])
  for (const minShotSec of [0.75, 1.5, 2]) {
    const plan = planSwitch([a, b], span(12), false, { thresholdDb: -40, minShotSec })
    for (const seg of plan.segments) {
      assert.ok(seg.toFrame - seg.fromFrame >= Math.round(minShotSec * FPS), `${minShotSec}: ${JSON.stringify(plan.segments)}`)
    }
    assert.ok(plan.segments.some((s) => s.angle === 1), 'the interjection still gets its shot')
  }
})

test('per-mic thresholds find a quiet guest that one absolute threshold misses', () => {
  const host = curve(20, [[0, 8, -18], [14, 20, -18]], -55)
  const guest = curve(20, [[8, 14, -44]], -70)
  const absolute = planSwitch([host, guest], span(20), false, { thresholdDb: -40 })
  assert.equal(absolute.anglesUsed, 1, 'the guest never crosses -40')
  const auto = planSwitch([host, guest], span(20), false)
  assert.equal(auto.anglesUsed, 2, JSON.stringify(auto.mics))
  assert.ok(auto.mics[1]!.thresholdDb < -44 && auto.mics[1]!.thresholdDb > -70)
})

test('a mic that never holds a voice gets no automatic threshold', () => {
  const hiss = Array.from({ length: 200 }, (_, i) => -62 + (i % 5))
  assert.equal(autoThreshold(hiss).thresholdDb, Number.POSITIVE_INFINITY)
  const talk = curve(10, [[2, 6, -20]])
  assert.ok(Number.isFinite(autoThreshold(talk).thresholdDb))
})

// ---------------------------------------------------------------------------
// Applying a plan to the timeline
// ---------------------------------------------------------------------------

function clip(id: string, trackId: string, from: number, duration: number, extra: Partial<Item> = {}): Item {
  return {
    id,
    assetId: `ast_${id}`,
    trackId,
    from,
    durationInFrames: duration,
    sourceStartUs: 1_000_000,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    ...extra
  }
}

function track(id: string, items: Item[]): Track {
  return { id, kind: 'video', name: id.toUpperCase(), locked: false, muted: false, hidden: false, items }
}

function tl(tracks: Track[]): Timeline {
  return { id: 'tl', name: 'T', fps: FPS, width: 1920, height: 1080, background: '#000000', tracks, transitions: [] }
}

test('each angle is razored where it goes on or off screen, and its off pieces are disabled', () => {
  const timeline = tl([
    track('v1', [clip('a', 'v1', 0, 300)]),
    track('v2', [clip('b', 'v2', 0, 300)]),
    track('v3', [clip('w', 'v3', 0, 300)])
  ])
  const segments: SwitchSegment[] = [
    { angle: 0, fromFrame: 0, toFrame: 100 },
    { angle: 1, fromFrame: 100, toFrame: 200 },
    { angle: 0, fromFrame: 200, toFrame: 300 }
  ]
  let n = 0
  const result = applyAngleSwitch(timeline, ['a', 'b', 'w'], segments, () => `new${++n}`)
  const shape = (trackIndex: number) =>
    timeline.tracks[trackIndex]!.items.map((i) => [i.from, i.durationInFrames, i.disabled === true, i.sourceStartUs])
  assert.deepEqual(shape(0), [
    [0, 100, false, 1_000_000],
    [100, 100, true, 1_000_000 + 3_333_333],
    // Cut from the already-cut right half: each split rounds once, as the store's Split does.
    [200, 100, false, 1_000_000 + 6_666_666]
  ])
  assert.deepEqual(shape(1).map((p) => p.slice(0, 3)), [
    [0, 100, true],
    [100, 100, false],
    [200, 100, true]
  ])
  // The wide is never on: one piece, disabled, no razor.
  assert.deepEqual(shape(2).map((p) => p.slice(0, 3)), [[0, 300, true]])
  assert.equal(result.createdItemIds.length, 4)
  // At every frame exactly one angle is enabled.
  for (let f = 0; f < 300; f += 7) {
    const on = timeline.tracks.filter((t) => t.items.some((i) => !i.disabled && f >= i.from && f < i.from + i.durationInFrames))
    assert.equal(on.length, 1, `frame ${f}`)
  }
})

test('outside the switched span an angle keeps its state and is razored only where that differs', () => {
  const timeline = tl([track('v1', [clip('a', 'v1', 0, 400)]), track('v2', [clip('b', 'v2', 0, 400)])])
  const segments: SwitchSegment[] = [
    { angle: 0, fromFrame: 50, toFrame: 150 },
    { angle: 1, fromFrame: 150, toFrame: 300 }
  ]
  applyAngleSwitch(timeline, ['a', 'b'], segments, (() => { let n = 0; return () => `n${++n}` })())
  const a = timeline.tracks[0]!.items.map((i) => [i.from, i.durationInFrames, i.disabled === true])
  // a: on before the span (as it was), on 50–150 — one piece to 150 — then off to 300, then on again.
  assert.deepEqual(a, [[0, 150, false], [150, 150, true], [300, 100, false]])
})
