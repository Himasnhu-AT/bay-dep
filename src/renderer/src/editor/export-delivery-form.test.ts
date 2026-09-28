/**
 * The export form shows the same loudness default `export_timeline` uses: the target the last
 * mastered export of the timeline remembered. Adopted when the remembered decision changes, so a
 * choice made in the form afterwards stands, and the Deliver page's first-look preset keeps it.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_EXPORT_SETTINGS, matchExportPreset } from '@shared/export-presets'
import { useExportSession } from './export-session'

const PODCAST = { integratedLufs: -16, truePeakDb: -1 }
const session = () => useExportSession.getState()

test('the form adopts the remembered target, keeps a later choice, and follows a new decision', () => {
  useExportSession.setState({ settings: DEFAULT_EXPORT_SETTINGS, progress: null, starting: false })
  assert.equal(session().settings.loudness, 'off', 'the specimen: the defaults are unmastered')

  assert.equal(session().adoptRememberedLoudness('tl_a', PODCAST), true)
  assert.equal(session().settings.loudness, 'podcast')

  // The Deliver page's first look still chooses the canvas's preset, and keeps the remembered loudness.
  assert.equal(session().adoptFittingPreset(1920, 1080), true)
  assert.equal(session().settings.loudness, 'podcast')
  assert.equal(session().settings.format, 'mp4')

  // The user chooses Off; the same remembered decision on the next render does not undo that.
  session().setSettings({ ...session().settings, loudness: 'off' })
  assert.equal(session().adoptRememberedLoudness('tl_a', PODCAST), false)
  assert.equal(session().settings.loudness, 'off')

  // A new decision (an agent export at custom numbers) reaches the form.
  assert.equal(session().adoptRememberedLoudness('tl_a', { integratedLufs: -15, truePeakDb: -2 }), true)
  assert.deepEqual(session().settings.loudness, { integratedLufs: -15, truePeakDb: -2 })
  assert.equal(matchExportPreset(session().settings), 'custom')

  // Forgotten ("off" from the agent): the form shows Off.
  assert.equal(session().adoptRememberedLoudness('tl_a', undefined), true)
  assert.equal(session().settings.loudness, 'off')
})

test('an invalid remembered value is never adopted into the form', () => {
  useExportSession.setState({ settings: { ...DEFAULT_EXPORT_SETTINGS, loudness: 'broadcast' }, progress: null, starting: false })
  assert.equal(session().adoptRememberedLoudness('tl_bad', { integratedLufs: 400, truePeakDb: -1 }), false)
  assert.equal(session().settings.loudness, 'broadcast')
  // Positive control: the same timeline with a valid target adopts it.
  assert.equal(session().adoptRememberedLoudness('tl_bad', PODCAST), true)
  assert.equal(session().settings.loudness, 'podcast')
})

test('a timeline that never remembered anything leaves the form’s own choice alone', () => {
  useExportSession.setState({ settings: { ...DEFAULT_EXPORT_SETTINGS, loudness: 'broadcast' }, progress: null, starting: false })
  assert.equal(session().adoptRememberedLoudness('tl_never', undefined), false)
  assert.equal(session().settings.loudness, 'broadcast')
})
