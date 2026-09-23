/**
 * `edit_item`'s grade merge: fields merge, null removes, and every refusal carries what the next
 * call needs (the field, the range, the id to use). Each refusal is paired with the nearest legal
 * call, so a surface that refused everything would fail here.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset } from '@shared/project'
import { mergeGrade } from './grade'
import { ToolError } from './helpers'

const lutAsset: Asset = {
  id: 'lut1',
  kind: 'lut',
  name: 'night.cube',
  path: '/l/night.cube',
  durationUs: 0,
  width: null,
  height: null,
  fps: null,
  hasAudio: false,
  hasVideo: false,
  posterPath: null,
  waveformPath: null,
  createdAt: 0,
  lut: { size: 2, title: null, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data: '' }
}
const clip: Asset = { ...lutAsset, id: 'vid1', kind: 'video', name: 'a.mp4', lut: undefined, hasVideo: true }
const byId = (id: string): Asset | undefined => [lutAsset, clip].find((a) => a.id === id)

function refuses(patch: unknown, pattern: RegExp, current = undefined): void {
  assert.throws(
    () => mergeGrade(current, patch, byId),
    (error: unknown) => error instanceof ToolError && pattern.test(error.message),
    `expected ${JSON.stringify(patch)} to be refused with ${pattern}`
  )
}

test('fields merge: setting saturation keeps the wheels, and one channel keeps the others', () => {
  const first = mergeGrade(undefined, { gain: { r: 0.1 }, lift: { b: 0.02 } }, byId)
  assert.deepEqual(first, { gain: { r: 0.1, g: 0, b: 0 }, lift: { r: 0, g: 0, b: 0.02 } })
  const second = mergeGrade(first, { saturation: 0.8, gain: { g: -0.05 } }, byId)
  assert.deepEqual(second, { gain: { r: 0.1, g: -0.05, b: 0 }, lift: { r: 0, g: 0, b: 0.02 }, saturation: 0.8 })
})

test('null removes the whole grade, or one group', () => {
  const graded = mergeGrade(undefined, { saturation: 0.8, grain: { amount: 0.1 } }, byId)
  assert.equal(mergeGrade(graded, null, byId), undefined)
  assert.deepEqual(mergeGrade(graded, { grain: null }, byId), { saturation: 0.8 })
  // Removing the last field leaves no grade at all rather than an empty object.
  assert.equal(mergeGrade({ saturation: 0.8 }, { saturation: null }, byId), undefined)
})

test('out-of-range values are refused with the field and the range, not clamped', () => {
  refuses({ saturation: 5 }, /grade\.saturation must be a number from 0 to 4; got 5/)
  assert.deepEqual(mergeGrade(undefined, { saturation: 4 }, byId), { saturation: 4 })
  refuses({ gain: { r: 'x' } }, /grade\.gain\.r must be a number from -1 to 4/)
  refuses({ temperature: 5000 }, /from -3000 to 3000/)
  refuses({ grain: { amount: 1.5 } }, /grade\.grain\.amount must be a number from 0 to 1/)
})

test('unknown fields are refused naming what is accepted', () => {
  refuses({ exposure: 1 }, /grade has no field "exposure"\. It accepts lift, gamma, gain, temperature/)
  refuses({ gain: { master: 0.1 } }, /grade\.gain has no field "master"\. It accepts r, g, b/)
  refuses({ halation: { amount: 0.2, glow: 1 } }, /accepts amount, threshold, radius, color/)
})

test('a group without an amount is refused, because it would do nothing', () => {
  refuses({ halation: { radius: 20 } }, /grade\.halation needs an amount/)
  // Positive control: an amount already present lets a later call change only the radius.
  const graded = mergeGrade(undefined, { halation: { amount: 0.2 } }, byId)
  assert.deepEqual(mergeGrade(graded, { halation: { radius: 20 } }, byId), { halation: { amount: 0.2, radius: 20 } })
})

test('curves: points validated, duplicates refused, per-channel replace', () => {
  refuses({ curves: { r: [] } }, /1 to 16 \[input, output\] points/)
  refuses({ curves: { r: [[0.5, 0.5], [0.5, 0.6]] } }, /two points at input 0\.5/)
  refuses({ curves: { r: [[0.5, 1.2]] } }, /curves\.r\[0\]\[1\] must be a number from 0 to 1/)
  refuses({ curves: { luma: [[0.5, 0.6]] } }, /accepts master, r, g, b/)
  const graded = mergeGrade(undefined, { curves: { r: [[0.5, 0.6]], master: [[0.25, 0.2]] } }, byId)
  assert.deepEqual(mergeGrade(graded, { curves: { r: null } }, byId), { curves: { master: [[0.25, 0.2]] } })
})

test('a LUT must be a readable lut asset, and the refusal says how to get one', () => {
  refuses({ lut: { assetId: 'nope' } }, /No asset nope\. Import the \.cube file with import_media/)
  refuses({ lut: { assetId: 'vid1' } }, /a\.mp4\) is a video, not a LUT/)
  refuses({ lut: { assetId: 'lut1', intensity: 2 } }, /lut\.intensity must be a number from 0 to 1/)
  // Positive control, with the default intensity.
  assert.deepEqual(mergeGrade(undefined, { lut: { assetId: 'lut1' } }, byId), { lut: { assetId: 'lut1', intensity: 1 } })
  // And a later call may change only the intensity.
  assert.deepEqual(
    mergeGrade({ lut: { assetId: 'lut1', intensity: 1 } }, { lut: { intensity: 0.4 } }, byId),
    { lut: { assetId: 'lut1', intensity: 0.4 } }
  )
})

test('halation colour must be hex', () => {
  refuses({ halation: { amount: 0.2, color: 'orange' } }, /must be a hex colour such as "#FF8C40"/)
  assert.deepEqual(mergeGrade(undefined, { halation: { amount: 0.2, color: '#ff0000' } }, byId), {
    halation: { amount: 0.2, color: '#ff0000' }
  })
})
