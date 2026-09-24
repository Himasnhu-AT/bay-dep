/**
 * JKL's rate state machine (`nextShuttle`). The driver that moves the playhead is checked in the
 * running app, and this pins what each key press asks for.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { holdsK, MAX_SHUTTLE_RATE, nextShuttle } from './shuttle'

const press = (keys: string, from = 0): number => {
  let rate = from
  for (const key of keys) rate = nextShuttle({ rate, kHeld: false }, key as 'J' | 'K' | 'L').rate
  return rate
}

test('L plays, and each further L doubles up to 8×', () => {
  assert.equal(press('L'), 1)
  assert.equal(press('LL'), 2)
  assert.equal(press('LLL'), 4)
  assert.equal(press('LLLL'), 8)
  assert.equal(press('LLLLLL'), MAX_SHUTTLE_RATE, 'capped')
})

test('J is the same backwards, and reversing starts over at 1× the other way', () => {
  assert.equal(press('J'), -1)
  assert.equal(press('JJJ'), -4)
  assert.equal(press('LLLJ'), -1, 'J while playing forward at 4× goes to 1× backwards, not 2×')
  assert.equal(press('JJL'), 1)
})

test('L during ordinary playback (rate 1) goes to 2×', () => {
  assert.equal(press('L', 1), 2)
})

test('K stops, from any rate', () => {
  assert.equal(press('LLK'), 0)
  assert.equal(press('JK'), 0)
  assert.equal(press('K'), 0)
})

test('holding K turns J and L into one-frame steps, and stops playback', () => {
  assert.deepEqual(nextShuttle({ rate: 0, kHeld: true }, 'L'), { rate: 0, step: 1 })
  assert.deepEqual(nextShuttle({ rate: 4, kHeld: true }, 'J'), { rate: 0, step: -1 })
  // Positive control: the same key without K held plays rather than steps.
  assert.equal(nextShuttle({ rate: 0, kHeld: false }, 'L').step, undefined)
})

test('Playback › Stop from the menu does not leave K held, so the next L plays', () => {
  // The menu's Stop, then the menu's (or the key's) Play Forwards.
  let held = holdsK('K', 'menu', false)
  let rate = nextShuttle({ rate: 1, kHeld: held }, 'K').rate
  held = holdsK('L', 'menu', held)
  const next = nextShuttle({ rate, kHeld: held }, 'L')
  assert.equal(next.step, undefined, 'stepped one frame instead of playing')
  assert.equal(next.rate, 1)
  // Positive control: the K key itself does hold, until its key-up, so K+L still steps.
  held = holdsK('K', 'key', false)
  rate = nextShuttle({ rate: 1, kHeld: held }, 'K').rate
  assert.deepEqual(nextShuttle({ rate, kHeld: holdsK('L', 'key', held) }, 'L'), { rate: 0, step: 1 })
})
