import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clamp,
  decimalsOf,
  dragValue,
  keyStep,
  modifierScale,
  modifiersOf,
  roundTo,
  snapToStep,
  wheelAdjusts,
  wheelSteps,
  WHEEL_PIXELS_PER_STEP,
  WHEEL_SCROLL_QUIET_MS
} from './values'

const none = { shift: false, alt: false, meta: false }

test('Shift is coarse (×10) and Cmd/Ctrl or Alt is fine (×0.1), for drags and keys alike', () => {
  // The requirement, from the editors bay's users come from: Adobe scrubs Shift = tens and
  // Cmd = tenths; Resolve's fine key is Alt. The old NumberField drag had Shift = fine.
  assert.equal(modifierScale(none), 1)
  assert.equal(modifierScale({ ...none, shift: true }), 10)
  assert.equal(modifierScale({ ...none, meta: true }), 0.1)
  assert.equal(modifierScale({ ...none, alt: true }), 0.1)
  // A drag of 10px at step 1 moves 100 with Shift and 1 with Alt — not the other way round.
  assert.equal(dragValue(0, 10, 1, { ...none, shift: true }), 100)
  assert.equal(roundTo(dragValue(0, 10, 1, { ...none, alt: true }), 6), 1)
  // An arrow press takes the same table: Shift+Up is ten steps, Cmd+Up a tenth.
  assert.equal(keyStep(0.5, { ...none, shift: true }, 2), 5)
  assert.equal(keyStep(0.5, { ...none, meta: true }, 2), 0.05)
})

test('fine wins over coarse when both are held', () => {
  assert.equal(modifierScale({ shift: true, alt: true, meta: false }), 0.1)
  assert.equal(modifierScale({ shift: true, alt: false, meta: true }), 0.1)
})

test('Ctrl reads as the fine key as Cmd does, from a keyboard event', () => {
  assert.deepEqual(modifiersOf({ shiftKey: false, altKey: false, metaKey: false, ctrlKey: true }), { shift: false, alt: false, meta: true })
  assert.deepEqual(modifiersOf({ shiftKey: true, altKey: false, metaKey: false, ctrlKey: false }), { shift: true, alt: false, meta: false })
})

test('a fine arrow press on a whole-number field still moves it by the smallest shown step', () => {
  // 1 × 0.1 rounds back to where it started at precision 0; a fine press must still move.
  assert.equal(keyStep(1, { ...none, alt: true }, 0), 1)
  assert.equal(keyStep(1, { ...none, alt: true }, 1), 0.1)
  // …and never finer than the field shows at any precision.
  assert.equal(keyStep(0.005, { ...none, alt: true }, 3), 0.001)
})

test('clamp holds to either bound and leaves an unbounded side alone', () => {
  assert.equal(clamp(5, 0, 3), 3)
  assert.equal(clamp(-5, 0, 3), 0)
  assert.equal(clamp(-5, undefined, 3), -5)
  assert.equal(clamp(50, 0, undefined), 50)
})

test('snapToStep lands on the step grid with the step’s own decimals', () => {
  assert.equal(snapToStep(0.1 + 0.2, 0.1), 0.3)
  assert.equal(snapToStep(0.37, 0.05), 0.35)
  assert.equal(snapToStep(7.3, 0.5, 0, 6), 6)
  assert.equal(snapToStep(-0.26, 0.005, -1, 1), -0.26)
  assert.equal(decimalsOf(0.005), 3)
  assert.equal(decimalsOf(1e-7), 7)
  assert.equal(decimalsOf(2), 0)
})

test('the wheel: down decreases, notches are whole steps, and a trackpad accumulates to the same', () => {
  // One mouse notch down (deltaY +100) is one step down.
  assert.deepEqual(wheelSteps(0, WHEEL_PIXELS_PER_STEP), { steps: -1, rest: 0 })
  // A line-mode notch counts as one.
  assert.deepEqual(wheelSteps(0, -1, 1), { steps: 1, rest: 0 })
  // A trackpad's small deltas carry over until they make a step.
  let rest = 0
  let steps = 0
  for (let i = 0; i < 10; i += 1) {
    const out = wheelSteps(rest, -12)
    rest = out.rest
    steps += out.steps
  }
  assert.equal(steps, 1)
  assert.equal(rest, 20)
})

test('the wheel round trip: N notches up then N down is back where it started', () => {
  let value = 0.5
  let rest = 0
  const step = 0.01
  const move = (deltaY: number): void => {
    const out = wheelSteps(rest, deltaY)
    rest = out.rest
    value = roundTo(value + out.steps * step, 6)
  }
  for (let i = 0; i < 7; i += 1) move(-100)
  assert.equal(value, 0.57)
  for (let i = 0; i < 7; i += 1) move(100)
  assert.equal(value, 0.5)
  assert.equal(rest, 0)
})

test('the wheel changes a value only when hovered, focused, and the page is not scrolling', () => {
  const quiet = WHEEL_SCROLL_QUIET_MS
  assert.equal(wheelAdjusts({ hovered: true, focused: true, msSinceScroll: quiet }), true)
  // Each missing condition, alone, is a refusal: a field passing under the pointer, a field
  // focused elsewhere, and a focused field scrolling under the pointer mid-scroll.
  assert.equal(wheelAdjusts({ hovered: false, focused: true, msSinceScroll: quiet }), false)
  assert.equal(wheelAdjusts({ hovered: true, focused: false, msSinceScroll: quiet }), false)
  assert.equal(wheelAdjusts({ hovered: true, focused: true, msSinceScroll: quiet - 1 }), false)
})
