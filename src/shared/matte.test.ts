/**
 * Subject mattes' shared rules: which frame of a pack is "now", which source range a clip needs,
 * which record covers a moment, and what a mask may say.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item } from './project'
import { checkMasks, matteCovers, matteFrameIndex, matteKeyInput, matteRecordAt, matteSpanForItem, type SubjectMatte } from './matte'

const at30 = (n: number): number[] => Array.from({ length: n }, (_, i) => Math.round((i * 1_000_000) / 30))

test('matteFrameIndex: the last frame at or before the time, as a <video> shows it', () => {
  const pts = at30(300)
  assert.equal(matteFrameIndex(pts, 0), 0)
  assert.equal(matteFrameIndex(pts, 3_000_000), 90)
  // Between frames 90 (3.0000 s) and 91 (3.0333 s): still 90, never the nearer 91.
  assert.equal(matteFrameIndex(pts, 3_030_000), 90)
  // A hair before a frame's timestamp — microsecond rounding, the 0.5 ms seek edge — is that frame.
  assert.equal(matteFrameIndex(pts, pts[91]! - 400), 91)
  // Two milliseconds early is the frame before: the tolerance is an edge, not a snap.
  assert.equal(matteFrameIndex(pts, pts[91]! - 2_000), 90)
})

test('matteFrameIndex: outside the pack is -1 (missing), never the nearest frame', () => {
  const pts = at30(300).map((t) => t + 5_000_000) // a pack covering 5 s to 15 s
  assert.equal(matteFrameIndex(pts, 4_000_000), -1, 'before the first frame')
  assert.equal(matteFrameIndex(pts, 5_000_000), 0, 'positive control: the first frame')
  const last = pts[pts.length - 1]!
  assert.equal(matteFrameIndex(pts, last + 20_000), pts.length - 1, 'within the last frame\'s own interval')
  assert.equal(matteFrameIndex(pts, last + 100_000), -1, 'past it')
  assert.equal(matteFrameIndex([], 0), -1)
  assert.equal(matteFrameIndex(pts, Number.NaN), -1)
})

test('matteFrameIndex follows variable frame timing, not a frame count', () => {
  // A phone clip: frames 33 ms apart, then a 66 ms gap, then 33 ms again.
  const pts = [0, 33_333, 66_667, 133_333, 166_667]
  assert.equal(matteFrameIndex(pts, 100_000), 2, 'inside the gap, the frame before it is still showing')
  assert.equal(matteFrameIndex(pts, 140_000), 3)
})

function asset(extra: Partial<Asset> = {}): Asset {
  return {
    id: 'a', kind: 'video', name: 'talk.mp4', path: '/m/talk.mp4', durationUs: 60_000_000, width: 1920, height: 1080,
    fps: 25, hasAudio: true, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 0, ...extra
  }
}
function clip(extra: Partial<Item> = {}): Item {
  return {
    id: 'i', assetId: 'a', trackId: 't', from: 30, durationInFrames: 60, sourceStartUs: 2_000_000,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...extra
  }
}

test('matteSpanForItem: the source a clip plays, through its in-point and speed, padded one source frame', () => {
  // 60 frames at 30 fps from a 2 s in-point: 2 s to 4 s; one 25 fps source frame (40 ms) each side.
  assert.deepEqual(matteSpanForItem(clip(), asset(), 30), { fromUs: 1_960_000, toUs: 4_040_000 })
  // At 2× the same clip reads 4 s of source: 2 s to 6 s.
  assert.deepEqual(matteSpanForItem(clip({ speed: 2 }), asset(), 30), { fromUs: 1_960_000, toUs: 6_040_000 })
  // Where it sits on the timeline changes nothing: a matte is in source time.
  assert.deepEqual(matteSpanForItem(clip({ from: 900 }), asset(), 30), { fromUs: 1_960_000, toUs: 4_040_000 })
  // Clamped to the file at both ends.
  assert.deepEqual(matteSpanForItem(clip({ sourceStartUs: 0 }), asset({ durationUs: 1_500_000 }), 30), { fromUs: 0, toUs: 1_500_000 })
})

const record = (key: string, fromUs: number, toUs: number, engine = 'apple-vision-person-balanced'): SubjectMatte =>
  ({ key, fromUs, toUs, engine, frames: 1, width: 512, height: 384 })

test('matteRecordAt: the record covering a moment, the latest written where two do', () => {
  const records = [record('a', 0, 10_000_000), record('b', 5_000_000, 20_000_000)]
  assert.equal(matteRecordAt(records, 2_000_000)?.key, 'a')
  assert.equal(matteRecordAt(records, 7_000_000)?.key, 'b', 'overlap: the later record')
  assert.equal(matteRecordAt(records, 25_000_000), null)
  assert.equal(matteRecordAt(undefined, 0), null)
})

test('matteCovers: only one pack that covers the whole range, of the same engine', () => {
  const records = [record('a', 0, 10_000_000), record('m', 0, 60_000_000, 'modnet')]
  assert.equal(matteCovers(records, 1_000_000, 9_000_000)?.key, 'a')
  assert.equal(matteCovers(records, 1_000_000, 11_000_000), null, 'a longer clip needs a new matte')
})

test('matteKeyInput changes with the file, the range, the engine and the parameters', () => {
  const base = matteKeyInput('c', 0, 1_000_000, 'e', 1)
  for (const other of [matteKeyInput('d', 0, 1_000_000, 'e', 1), matteKeyInput('c', 1, 1_000_000, 'e', 1), matteKeyInput('c', 0, 999_999, 'e', 1), matteKeyInput('c', 0, 1_000_000, 'f', 1), matteKeyInput('c', 0, 1_000_000, 'e', 2)]) {
    assert.notEqual(other, base)
  }
  assert.equal(matteKeyInput('c', 0.4, 1_000_000.2, 'e', 1), base, 'microseconds are whole')
})

test('checkMasks: one subject mask, with named refusals and a legal call beside each', () => {
  assert.deepEqual(checkMasks([{ kind: 'subject' }]), { ok: true, masks: [{ kind: 'subject' }] })
  assert.deepEqual(checkMasks([{ kind: 'subject', invert: true, feather: 4, assetId: 'ast_1' }]), { ok: true, masks: [{ kind: 'subject', invert: true, feather: 4, assetId: 'ast_1' }] })
  const refused = (value: unknown, pattern: RegExp): void => {
    const result = checkMasks(value)
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, pattern)
  }
  refused({ kind: 'subject' }, /must be a list/)
  refused([{ kind: 'rect' }], /kind must be "subject".*got "rect"/)
  refused([{ kind: 'subject', feather: 900 }], /feather must be a number of pixels from 0 to 200; got 900/)
  refused([{ kind: 'subject' }, { kind: 'subject' }], /one mask in this version/)
  refused([{ kind: 'subject', invert: 'yes' }], /invert must be true or false/)
})
