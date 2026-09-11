/**
 * Tests for the adjustment filter string and the blend mapping.
 *
 * Two properties carry most of the value here, and neither needs a canvas:
 *
 * 1. **Default adjustments must produce no filter at all.** Not `brightness(1)` — `'none'`.
 *    Asking for an identity filter still puts the draw on the filtered path, measured at
 *    roughly twice the cost at 4K, so every clip in every project would pay for a feature it
 *    is not using. This is the test most likely to catch a well-meaning refactor.
 * 2. **One bad field must not remove the others.** A `NaN` anywhere in a filter string makes
 *    Chromium ignore the *whole* chain silently, so an unguarded value would take every
 *    adjustment on the item down with it rather than just its own.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultAdjustments, type Adjustments, type BlendMode } from '@shared/project'
import { adjustmentFilter, blendOperation, isPlainLook, NO_FILTER } from './looks'

const adj = (over: Partial<Adjustments> = {}): Adjustments => ({ ...defaultAdjustments(), ...over })

test('an item with no adjustments produces no filter', () => {
  assert.equal(adjustmentFilter(undefined), NO_FILTER)
})

test('default adjustments produce no filter, not an identity chain', () => {
  // The performance test disguised as a correctness test: `brightness(1) contrast(1) …` is
  // visually identical and about twice the cost at 4K.
  assert.equal(adjustmentFilter(adj()), NO_FILTER)
})

test('each adjustment appears only when it differs from the default', () => {
  assert.equal(adjustmentFilter(adj({ brightness: 1.2 })), 'brightness(1.2)')
  assert.equal(adjustmentFilter(adj({ contrast: 0.8 })), 'contrast(0.8)')
  assert.equal(adjustmentFilter(adj({ saturate: 0 })), 'saturate(0)')
  assert.equal(adjustmentFilter(adj({ hueRotate: 90 })), 'hue-rotate(90deg)')
  assert.equal(adjustmentFilter(adj({ grayscale: 1 })), 'grayscale(1)')
  assert.equal(adjustmentFilter(adj({ sepia: 0.5 })), 'sepia(0.5)')
  assert.equal(adjustmentFilter(adj({ invert: 1 })), 'invert(1)')
  assert.equal(adjustmentFilter(adj({ blur: 8 })), 'blur(8px)')
})

test('hue rotation carries its unit and blur carries pixels', () => {
  // A unitless hue-rotate or blur is invalid CSS, and an invalid token voids the whole chain.
  assert.match(adjustmentFilter(adj({ hueRotate: 45 })), /hue-rotate\(45deg\)/)
  assert.match(adjustmentFilter(adj({ blur: 3 })), /blur\(3px\)/)
})

test('blur comes last so it blurs the corrected colour', () => {
  const filter = adjustmentFilter(adj({ blur: 4, brightness: 2, saturate: 0 }))
  assert.equal(filter, 'brightness(2) saturate(0) blur(4px)')
  assert.ok(filter.indexOf('blur') > filter.indexOf('brightness'))
})

test('a non-finite value is replaced rather than emitted', () => {
  // NaN in a filter string makes Chromium drop the entire chain, so one bad field would remove
  // every other adjustment on the item. The bad one falls back to its default and the rest survive.
  const filter = adjustmentFilter(adj({ brightness: Number.NaN, saturate: 0 }))
  assert.equal(filter, 'saturate(0)')
  assert.doesNotMatch(filter, /NaN/)

  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const out = adjustmentFilter(adj({ blur: bad, grayscale: 1 }))
    assert.doesNotMatch(out, /NaN|Infinity/, `blur ${bad} leaked into the chain`)
    assert.match(out, /grayscale\(1\)/, `blur ${bad} took grayscale down with it`)
  }
})

test('every adjustment at once produces one chain in a fixed order', () => {
  assert.equal(
    adjustmentFilter(adj({ brightness: 1.1, contrast: 1.2, saturate: 1.3, hueRotate: 10,
                           grayscale: 0.1, sepia: 0.2, invert: 0.3, blur: 2 })),
    'brightness(1.1) contrast(1.2) saturate(1.3) hue-rotate(10deg) grayscale(0.1) sepia(0.2) invert(0.3) blur(2px)'
  )
})

// -- blend ------------------------------------------------------------------

test('an absent or normal blend mode is the canvas default', () => {
  // So an item that never had one behaves exactly as it did before blend modes existed.
  assert.equal(blendOperation(undefined), 'source-over')
  assert.equal(blendOperation('normal'), 'source-over')
})

test('every blend mode in the union is passed through as a composite operation', () => {
  const modes: BlendMode[] = ['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge',
    'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation',
    'color', 'luminosity']
  for (const mode of modes) assert.equal(blendOperation(mode), mode)
})

test('a plain look is recognised so the draw can skip setting anything', () => {
  assert.equal(isPlainLook(NO_FILTER, 'source-over'), true)
  assert.equal(isPlainLook('blur(1px)', 'source-over'), false)
  assert.equal(isPlainLook(NO_FILTER, 'multiply'), false)
})
