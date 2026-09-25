/**
 * The mixer's fader and pan through the store: one undo step each, clamped, and unity/centre kept
 * as absence so a project that never touched the mixer saves the same bytes as before.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyProject, useEditor } from './editor'

const state = () => useEditor.getState()
const audio = () => state().project.timelines[0]!.tracks.find((t) => t.kind === 'audio')!

test('the fader and pan are stored, clamped, one undo step each; unity and centre are absence', () => {
  state().enterProject({ ...emptyProject(), name: 'Mix' })
  const id = audio().id
  const past = state().past.length
  state().patchTrack(id, { volume: 0.5 })
  assert.equal(audio().volume, 0.5)
  assert.equal(state().past.length, past + 1, 'one undo step')
  state().patchTrack(id, { volume: 9, pan: -3 })
  assert.equal(audio().volume, 2, 'clamped to +6 dB')
  assert.equal(audio().pan, -1, 'clamped to hard left')
  state().patchTrack(id, { volume: Number.NaN })
  assert.equal('volume' in audio(), false, 'a NaN fader is unity, stored as absence — never NaN in the file')
  state().patchTrack(id, { volume: 1, pan: 0 })
  assert.equal('volume' in audio() || 'pan' in audio(), false, 'unity and centre are absence')
  state().undo()
  assert.equal(audio().pan, -1, 'undo brings the previous mix back')
})
