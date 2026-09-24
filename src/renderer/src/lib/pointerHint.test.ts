import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pointerHint } from './pointerHint'

const none = { alt: false, shift: false }
const alt = { alt: true, shift: false }
const altShift = { alt: true, shift: true }

test('nothing held over a clip with the select tool: no hint (the timeline stays quiet)', () => {
  assert.equal(pointerHint('select', null, none, { zone: 'body', frame: null }, 30), null)
})

test('⌥ names the gesture for the part of the clip under the pointer', () => {
  assert.match(pointerHint('select', null, alt, { zone: 'body', frame: null }, 30) ?? '', /^Slip/)
  assert.match(pointerHint('select', null, altShift, { zone: 'body', frame: null }, 30) ?? '', /^Slide/)
  assert.match(pointerHint('select', null, alt, { zone: 'start', frame: null }, 30) ?? '', /^Roll/)
  assert.match(pointerHint('select', null, alt, { zone: 'end', frame: null }, 30) ?? '', /^Roll/)
  // ⌥ over empty lane: nothing to slip.
  assert.equal(pointerHint('select', null, alt, null, 30), null)
})

test('an armed trim says what the next drag does, even with nothing held', () => {
  assert.match(pointerHint('select', 'roll', none, null, 30) ?? '', /^Roll armed/)
  assert.match(pointerHint('select', 'slip', none, null, 30) ?? '', /^Slip armed/)
})

test('the blade names the timecode it will cut at, and ⇧ says every track', () => {
  assert.equal(pointerHint('blade', null, none, { zone: 'body', frame: 45 }, 30), 'Click to cut at 00:00:01:15 · ⇧ cuts every track')
  assert.match(pointerHint('blade', null, { alt: false, shift: true }, { zone: 'body', frame: 45 }, 30) ?? '', /every unlocked track at 00:00:01:15/)
  assert.match(pointerHint('blade', null, none, { zone: 'end', frame: null }, 30) ?? '', /edge/)
  assert.match(pointerHint('blade', null, none, null, 30) ?? '', /Escape for Select/)
})
