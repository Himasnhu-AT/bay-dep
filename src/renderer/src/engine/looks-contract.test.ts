/**
 * The two properties that made `adjustmentFilter` the survivor of a duplicated mapping.
 *
 * This file replaces `lib/looks-agree.test.ts`, which compared this builder against
 * `filterStringFor` in `@shared/project` and was skipped because the comparison *failed*: the
 * two disagreed on blur's position in the chain and on whether a near-identity value counts as
 * the identity. A parity test is the right instrument while two implementations exist and the
 * wrong one afterwards — `filterStringFor` is now deleted, so there is nothing left to agree
 * with, and what needs guarding is that the winner kept the behaviour it won on.
 *
 * Both properties are load-bearing and neither is cosmetic:
 *
 *  - **Order changes the image.** `contrast(0.5) blur(4px)` and `blur(4px) contrast(0.5)` are
 *    different pictures, so "blur goes last" is a rendering decision, not formatting.
 *  - **The identity epsilon is a cost decision.** Emitting `brightness(1.0000001)` is visually
 *    identical to emitting nothing and roughly twice the price at 4K, because it moves the clip
 *    onto the filtered draw path.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultAdjustments, type Adjustments } from '@shared/project'
import { adjustmentFilter, NO_FILTER } from './looks'

/** The order the chain must appear in. Blur last; the rest in the order colour is corrected. */
const CANONICAL = [
  'brightness',
  'contrast',
  'saturate',
  'hue-rotate',
  'grayscale',
  'sepia',
  'invert',
  'blur'
]

const NON_IDENTITY: Adjustments = {
  brightness: 1.4,
  contrast: 0.8,
  saturate: 1.6,
  hueRotate: 45,
  blur: 4,
  grayscale: 0.3,
  sepia: 0.2,
  invert: 0.1
}

const functionsIn = (filter: string): string[] =>
  filter === NO_FILTER ? [] : filter.split(' ').map((part) => part.slice(0, part.indexOf('(')))

test('blur is last in the chain, because it must act on corrected colour', () => {
  const filter = adjustmentFilter(NON_IDENTITY)
  const names = functionsIn(filter)

  assert.equal(names.at(-1), 'blur', filter)
  // Stated as the full order rather than just blur's position, so a later reshuffle of the
  // colour operations is caught too.
  assert.deepEqual(names, CANONICAL, filter)
})

test('the order holds for every subset, not just the all-fields case', () => {
  const fields = Object.keys(NON_IDENTITY) as (keyof Adjustments)[]
  // Every one of the 256 subsets of the eight fields.
  for (let mask = 0; mask < 1 << fields.length; mask++) {
    const adjustments = { ...defaultAdjustments() }
    for (const [index, field] of fields.entries()) {
      if (mask & (1 << index)) adjustments[field] = NON_IDENTITY[field]
    }

    const names = functionsIn(adjustmentFilter(adjustments))
    const expected = CANONICAL.filter((name) => names.includes(name))
    assert.deepEqual(names, expected, `subset ${mask}: ${adjustmentFilter(adjustments)}`)
  }
})

test('a value within a hair of the identity emits nothing, so the clip stays on the fast path', () => {
  const d = defaultAdjustments()
  for (const field of Object.keys(d) as (keyof Adjustments)[]) {
    const nudged: Adjustments = { ...d, [field]: d[field] + 1e-9 }
    assert.equal(
      adjustmentFilter(nudged),
      NO_FILTER,
      `${field} at ${d[field] + 1e-9} should be treated as the identity`
    )
  }
})

test('but a change large enough to see is still emitted', () => {
  const d = defaultAdjustments()
  for (const field of Object.keys(d) as (keyof Adjustments)[]) {
    // Just outside the epsilon. The guard must not have swallowed real edits.
    const nudged: Adjustments = { ...d, [field]: d[field] + 1e-4 }
    assert.notEqual(
      adjustmentFilter(nudged),
      NO_FILTER,
      `${field} at ${d[field] + 1e-4} should still produce a filter`
    )
  }
})

test('identity adjustments cost nothing at all', () => {
  assert.equal(adjustmentFilter(defaultAdjustments()), NO_FILTER)
  assert.equal(adjustmentFilter(undefined), NO_FILTER)
})

test('a non-finite field falls back to the identity rather than poisoning the chain', () => {
  // The reason this matters: one NaN in a CSS filter string makes the browser drop the whole
  // chain, so a single bad field would silently remove every other adjustment on the clip.
  for (const bad of [NaN, Infinity, -Infinity]) {
    const filter = adjustmentFilter({ ...NON_IDENTITY, contrast: bad })
    assert.ok(!filter.includes('NaN'), filter)
    assert.ok(!filter.includes('Infinity'), filter)
    assert.ok(filter.includes('brightness('), `other fields survived: ${filter}`)
    assert.ok(!filter.includes('contrast('), `the bad field was dropped: ${filter}`)
  }
})
