import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planVoiceLevel } from './voice-level'

test('a quiet voice is raised and a loud one lowered onto the target', () => {
  const quiet = planVoiceLevel(-22, 1, 1, -16)
  assert.equal(quiet.volume, 1.995)
  assert.equal(quiet.beforeLufs, -22)
  assert.equal(quiet.afterLufs, -16)
  const loud = planVoiceLevel(-10, 1, 1, -16)
  assert.equal(loud.volume, 0.501)
  assert.equal(loud.afterLufs, -16)
})

test('the clip\'s current gain and the track fader count in "before" and in the answer', () => {
  // Measured -20 on the source, clip at 0.5 (-6 dB), fader at 2 (+6 dB): heard at -20.
  const plan = planVoiceLevel(-20, 0.5, 2, -16)
  assert.equal(plan.beforeLufs, -20)
  // The fader already gives +6.02, so the clip needs -2.02 dB.
  assert.equal(plan.volume, 0.792)
  assert.equal(plan.afterLufs, -16)
})

test('more than +6 dB is clamped and the shortfall reported; within range it is not', () => {
  const far = planVoiceLevel(-30, 1, 1, -16)
  assert.equal(far.volume, 2)
  assert.equal(far.neededGainDb, 14)
  assert.equal(far.afterLufs, -24)
  assert.equal(planVoiceLevel(-20, 1, 1, -16).neededGainDb, undefined)
})
