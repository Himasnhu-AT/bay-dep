import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTopModal, openModal, takeKey } from './modalStack'

test('one dialog: it is on top, and keys go to it (the positive control)', () => {
  const only = openModal()
  assert.equal(isTopModal(only.token), true)
  only.release()
  assert.equal(isTopModal(only.token), false)
})

test('a dialog opened over another takes the keys; the one under it gets them back when it closes', () => {
  // Export, then Project Settings from its "Change canvas…": one Escape used to close both.
  const exportDialog = openModal()
  const settings = openModal()
  assert.equal(isTopModal(settings.token), true)
  assert.equal(isTopModal(exportDialog.token), false, 'the dialog underneath must ignore the Escape')
  settings.release()
  assert.equal(isTopModal(exportDialog.token), true)
  exportDialog.release()
})

test('the lower dialog closing first leaves the upper one on top; releasing twice changes nothing', () => {
  const lower = openModal()
  const upper = openModal()
  lower.release()
  lower.release()
  assert.equal(isTopModal(upper.token), true)
  upper.release()
  assert.equal(isTopModal(null), false)
})

test('an Escape one dialog took is not taken again by the dialog that is on top a moment later', () => {
  const escape = new Event('keydown')
  assert.equal(takeKey(escape), true, 'the first dialog to see it takes it')
  assert.equal(takeKey(escape), false, 'the one under it, now on top, must not close too')
  assert.equal(takeKey(new Event('keydown')), true, 'the next Escape is a new key')
})
