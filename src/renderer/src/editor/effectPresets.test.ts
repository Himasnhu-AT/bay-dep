import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Item } from '@shared/project'
import { coverLayout } from '@shared/project'
import {
  activeFramePreset,
  lookAdjustments,
  lookPresetActive,
  fadePresetActive,
  fadePresetFrames,
  framePresetActive,
  framePresetLayout,
  speedPresetActive
} from './effectPresets'

const canvas = { width: 1920, height: 1080 }

function item(patch: Partial<Item> = {}): Item {
  return {
    id: 'itm',
    assetId: 'ast',
    trackId: 'trk',
    from: 0,
    durationInFrames: 60,
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, rotation: 0, opacity: 1 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    ...patch
  }
}

test('Fill reads active only once the clip is framed as Fill would frame it', () => {
  const portrait = { width: 1080, height: 1920 }
  const clip = item()
  // Specimen: a full-frame layout is NOT what Fill gives a portrait source.
  const cover = coverLayout(canvas, portrait.width, portrait.height)
  assert.notEqual(cover.height, clip.layout.height)
  assert.equal(framePresetActive('fill', [clip], canvas, () => portrait), false)
  const filled = item({ layout: framePresetLayout('fill', clip, canvas, portrait) })
  assert.equal(framePresetActive('fill', [filled], canvas, () => portrait), true)
  assert.equal(framePresetActive('fit', [filled], canvas, () => portrait), false)
})

test('Centre is active when centred and not when moved; every clip must agree', () => {
  const small = item({ layout: { left: 0, top: 0, width: 960, height: 540, rotation: 0, opacity: 1 } })
  assert.equal(framePresetActive('centre', [small], canvas, () => undefined), false)
  const centred = item({ layout: framePresetLayout('centre', small, canvas, undefined) })
  assert.equal(centred.layout.left, 480)
  assert.equal(framePresetActive('centre', [centred], canvas, () => undefined), true)
  assert.equal(framePresetActive('centre', [centred, small], canvas, () => undefined), false)
  assert.equal(framePresetActive('centre', [], canvas, () => undefined), false, 'nothing selected is nothing active')
})

test('a fade preset is active when both ends hold its capped length', () => {
  const short = item({ durationInFrames: 10 })
  assert.equal(fadePresetFrames(15, short), 5, 'capped at half the clip')
  assert.equal(fadePresetActive(15, [item({ ...short, fadeInFrames: 5, fadeOutFrames: 5 })]), true)
  assert.equal(fadePresetActive(15, [item({ fadeInFrames: 15, fadeOutFrames: 0 })]), false)
  assert.equal(fadePresetActive(0, [item()]), true, 'None is active on an unfaded clip')
})

test('a speed preset is active only when every clip plays at it', () => {
  assert.equal(speedPresetActive(2, [item({ speed: 2 }), item({ speed: 2 })]), true)
  assert.equal(speedPresetActive(2, [item({ speed: 2 }), item({ speed: 1 })]), false)
})

test('a clip Fit to the canvas shows Fit alone, not Fit and Centre (the double tick)', () => {
  const portrait = { width: 1080, height: 1920 }
  const fitted = item({ layout: framePresetLayout('fit', item(), canvas, portrait) })
  // Specimen: the fitted box is centred, so Centre on its own terms does hold — that was the bug.
  assert.equal(framePresetActive('centre', [fitted], canvas, () => portrait), true)
  assert.equal(framePresetActive('fit', [fitted], canvas, () => portrait), true)
  assert.equal(activeFramePreset([fitted], canvas, () => portrait), 'fit')
  const small = item({ layout: { left: 480, top: 270, width: 960, height: 540, rotation: 0, opacity: 1 } })
  assert.equal(activeFramePreset([small], canvas, () => portrait), 'centre')
  assert.equal(activeFramePreset([item({ layout: { ...small.layout, left: 0 } })], canvas, () => portrait), null)
})

test('a look replaces the adjustments, and reads active only when every field matches', () => {
  const mono = lookAdjustments('mono')
  assert.equal(mono.grayscale, 1)
  assert.equal(mono.saturate, 1, 'fields the look does not name are identity')
  assert.equal(lookPresetActive('none', [item()]), true, 'no adjustments is no look')
  assert.equal(lookPresetActive('mono', [item({ adjustments: mono })]), true)
  assert.equal(lookPresetActive('mono', [item({ adjustments: { ...mono, blur: 2 } })]), false)
  assert.equal(lookPresetActive('mono', [item({ adjustments: mono }), item()]), false)
  assert.equal(lookPresetActive('none', []), false)
})
