/**
 * What the live preview shows while a playing frame is incomplete. See `pictureHold.ts`.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_HOLD_MS, PictureHold, type HoldInput } from './pictureHold'

const size = { width: 608, height: 1080 }
const frame = (over: Partial<HoldInput>): HoldInput => ({ complete: true, playing: true, now: 0, ...size, ...over })

test('a complete picture is shown and kept; an incomplete one while playing is covered by it', () => {
  const hold = new PictureHold()
  assert.equal(hold.decide(frame({ now: 0 })), 'fresh')
  assert.equal(hold.decide(frame({ complete: false, now: 42 })), 'hold')
  assert.equal(hold.decide(frame({ complete: false, now: 84 })), 'hold')
  assert.equal(hold.decide(frame({ now: 125 })), 'fresh')
})

test('nothing is held before a complete picture exists', () => {
  // The first frame of a session has nothing to stand in; showing the incomplete draw is honest.
  assert.equal(new PictureHold().decide(frame({ complete: false })), 'incomplete')
})

test('a paused or scrubbed preview shows the truth', () => {
  // The positive control for the hold: the same incomplete frame, not playing, is shown as drawn.
  const hold = new PictureHold()
  hold.decide(frame({ now: 0 }))
  assert.equal(hold.decide(frame({ complete: false, playing: false, now: 10 })), 'incomplete')
  assert.equal(hold.decide(frame({ complete: false, playing: true, now: 20 })), 'hold')
})

test('a hold is bounded, so a clip that never decodes shows as missing rather than frozen', () => {
  const hold = new PictureHold()
  hold.decide(frame({ now: 0 }))
  assert.equal(hold.decide(frame({ complete: false, now: 1000 })), 'hold', 'the bound runs from the first held frame')
  assert.equal(hold.decide(frame({ complete: false, now: 1000 + MAX_HOLD_MS })), 'hold')
  assert.equal(hold.decide(frame({ complete: false, now: 1000 + MAX_HOLD_MS + 1 })), 'incomplete')
  assert.equal(hold.decide(frame({ complete: false, now: 5000 })), 'incomplete', 'and stays expired')
  assert.equal(hold.decide(frame({ now: 5042 })), 'fresh')
  assert.equal(hold.decide(frame({ complete: false, now: 5084 })), 'hold', 'a complete picture starts a new bound')
})

test('a picture of another size, or after clear(), is never put back', () => {
  const hold = new PictureHold()
  hold.decide(frame({ now: 0 }))
  assert.equal(hold.decide(frame({ complete: false, now: 10, width: 1080, height: 1920 })), 'incomplete')
  hold.decide(frame({ now: 20 }))
  hold.clear()
  assert.equal(hold.decide(frame({ complete: false, now: 30 })), 'incomplete')
})
