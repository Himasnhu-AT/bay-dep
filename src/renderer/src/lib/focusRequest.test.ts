import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requestFocus, takeFocusRequest } from './focusRequest'

test('a focus request waits for its target, is taken once, and only by that target', () => {
  assert.equal(takeFocusRequest('subtitles'), false, 'nothing asked yet')
  requestFocus('subtitles')
  assert.equal(takeFocusRequest('transcript'), false, 'another target does not take it')
  assert.equal(takeFocusRequest('subtitles'), true, 'the target mounting later still gets it')
  assert.equal(takeFocusRequest('subtitles'), false, 'and only once: a later remount does not steal focus')
  // A newer request replaces an older one that never found its target.
  requestFocus('transcript')
  requestFocus('subtitles')
  assert.equal(takeFocusRequest('transcript'), false)
  assert.equal(takeFocusRequest('subtitles'), true)
})
