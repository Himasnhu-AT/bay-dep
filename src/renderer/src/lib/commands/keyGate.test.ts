import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keyMayRun } from './keyGate'

const base = { defaultPrevented: false, modalOpen: false, typing: false, whileTyping: false }

test('a key nobody used runs its command (the positive control)', () => {
  assert.equal(keyMayRun(base), true)
})

test('a key a focused control already used does not also run a command', () => {
  // ← on a slider: the slider prevents the default; the playhead must not also step.
  assert.equal(keyMayRun({ ...base, defaultPrevented: true }), false)
})

test('an open dialog blocks timeline commands', () => {
  // Backspace on a dialog button must not delete the selected clip behind it.
  assert.equal(keyMayRun({ ...base, modalOpen: true }), false)
  // ⌘V with focus on a dialog button is not typing, so it must not paste clips behind it.
  assert.equal(keyMayRun({ ...base, modalOpen: true, whileTyping: true }), false)
})

test('an open dialog still lets its own text fields undo, cut, copy and paste', () => {
  assert.equal(keyMayRun({ ...base, modalOpen: true, typing: true, whileTyping: true }), true)
})
