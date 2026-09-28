/**
 * The delivery decision, remembered, and the level of a file nobody mastered.
 *
 * The requirement, from a real export (2026-09-28): a news explainer went out mastered at
 * −14.1 LUFS; the next export of the same timeline, to the same path, left `loudness` out and came
 * out at −33.4 LUFS with no word to anyone. So (1) a call without `loudness` keeps the remembered
 * target, and says so; (2) "off" is the one way to drop it; (3) an unmastered file out of range is
 * warned about in a sentence that says what was measured and what to pass.
 *
 * Thresholds are literals on purpose: −20 and −9 are the promise the tool description makes.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LOUDNESS_PRESETS,
  chooseExportLoudness,
  deliveredLoudnessWarning,
  unmasteredLevelWarning
} from './loudness'
import { loudnessSetting } from './export-presets'

const STREAMING = { integratedLufs: -14, truePeakDb: -1 }

test('no argument with a remembered target uses the remembered one, and says where it came from', () => {
  const choice = chooseExportLoudness(undefined, STREAMING)
  assert.deepEqual(choice, { target: STREAMING, source: 'remembered', forget: null })
  // Positive control: a timeline with nothing remembered stays unmastered by default.
  assert.deepEqual(chooseExportLoudness(undefined, undefined), { target: null, source: 'default', forget: null })
})

test('an explicit target wins over the remembered one', () => {
  const choice = chooseExportLoudness('podcast', STREAMING)
  assert.deepEqual(choice, { target: { ...LOUDNESS_PRESETS.podcast }, source: 'argument', forget: null })
})

test('"off" (and null) exports unmastered and names the remembered target to forget', () => {
  assert.deepEqual(chooseExportLoudness('off', STREAMING), { target: null, source: 'off', forget: STREAMING })
  assert.deepEqual(chooseExportLoudness(null, STREAMING), { target: null, source: 'off', forget: STREAMING })
  // With nothing remembered there is nothing to forget.
  assert.deepEqual(chooseExportLoudness('off', undefined), { target: null, source: 'off', forget: null })
})

test('a misspelled preset is still refused with the accepted spellings, even over a remembered target', () => {
  const choice = chooseExportLoudness('streeming', STREAMING)
  assert.ok('error' in choice)
  assert.match(choice.error, /"streaming"/)
  assert.match(choice.error, /"off"/)
})

test('the real case: an unmastered −33.4 LUFS file is warned about with the reading and the fix', () => {
  const warning = deliveredLoudnessWarning({ integratedLufs: -33.4, truePeakDb: -12.3 })
  assert.ok(warning)
  assert.match(warning, /−33\.4 LUFS/)
  assert.match(warning, /−12\.3 dBTP/)
  assert.match(warning, /quieter than −20\.0 LUFS/)
  assert.match(warning, /loudness: "streaming"/)
})

test('the quiet threshold is −20 LUFS: just under warns, just over does not', () => {
  assert.ok(deliveredLoudnessWarning({ integratedLufs: -20.1, truePeakDb: -6 }))
  assert.equal(deliveredLoudnessWarning({ integratedLufs: -19.9, truePeakDb: -6 }), null)
})

test('the loud threshold is −9 LUFS: just over warns with the fix, just under does not', () => {
  const loud = deliveredLoudnessWarning({ integratedLufs: -8.9, truePeakDb: 0.4 })
  assert.ok(loud)
  assert.match(loud, /−8\.9 LUFS/)
  assert.match(loud, /louder than −9\.0 LUFS/)
  assert.match(loud, /loudness: "streaming"/)
  assert.equal(deliveredLoudnessWarning({ integratedLufs: -9.1, truePeakDb: -1 }), null)
})

test('silence gets no level warning: mastering would not fix it, and main reports it otherwise', () => {
  assert.equal(deliveredLoudnessWarning({ integratedLufs: -70.5, truePeakDb: Number.NEGATIVE_INFINITY }), null)
  assert.equal(deliveredLoudnessWarning({ integratedLufs: Number.NEGATIVE_INFINITY, truePeakDb: Number.NEGATIVE_INFINITY }), null)
})

test('a mastered export is never warned about its level, however it reads', () => {
  const quiet = { integratedLufs: -33.4, truePeakDb: -12 }
  assert.equal(unmasteredLevelWarning({ loudness: { status: 'met' }, deliveredLoudness: quiet }), null)
  // Positive control: the same reading, unmastered, is warned about.
  assert.ok(unmasteredLevelWarning({ deliveredLoudness: quiet }))
})

test('a remembered target shows in the form as its preset when it is one, else as numbers', () => {
  assert.equal(loudnessSetting(STREAMING), 'streaming')
  assert.equal(loudnessSetting({ integratedLufs: -23, truePeakDb: -1 }), 'broadcast')
  assert.deepEqual(loudnessSetting({ integratedLufs: -15, truePeakDb: -2 }), { integratedLufs: -15, truePeakDb: -2 })
  assert.equal(loudnessSetting(null), 'off')
})
