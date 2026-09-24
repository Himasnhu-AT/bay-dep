import { test } from 'node:test'
import assert from 'node:assert/strict'
import { levelOf } from '../../engine/audio'
import {
  emptyChannel,
  meterPosition,
  PEAK_HOLD_MS,
  stepChannel,
  toDb
} from './meter'

test('full scale is 0 dBFS, half is about -6, silence is off the bottom', () => {
  assert.equal(toDb(1), 0)
  assert.ok(Math.abs(toDb(0.5) - -6.0206) < 1e-3)
  assert.equal(meterPosition(toDb(0)), 0)
  assert.equal(meterPosition(0), 1)
  assert.ok(Math.abs(meterPosition(-30) - 0.5) < 1e-9, 'linear in dB: -30 is half way up a 60 dB scale')
  assert.equal(meterPosition(6), 1, 'over full scale pins at the top')
})

test('levelOf reads peak and RMS from float samples, and does not hide an over', () => {
  const sine = Array.from({ length: 1024 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * i) / 64))
  const level = levelOf(sine)
  assert.ok(Math.abs(level.peak - 0.5) < 1e-3)
  assert.ok(Math.abs(level.rms - 0.5 / Math.SQRT2) < 1e-3, 'a sine’s RMS is peak/√2')
  assert.equal(levelOf([0, 1.4, -0.2]).peak, 1.4, 'a clipped sample is reported past 1, not clamped to it')
})

test('the peak holds, then falls; the bar falls smoothly rather than dropping', () => {
  let ch = emptyChannel()
  ch = stepChannel(ch, { peak: 0.5, rms: 0.3 }, 0, 16)
  const held = ch.peakDb
  ch = stepChannel(ch, { peak: 0.01, rms: 0.01 }, 1000, 16)
  assert.equal(ch.peakDb, held, 'still held inside the hold time')
  assert.ok(ch.rmsDb < toDb(0.3) && ch.rmsDb > toDb(0.01), 'the bar is on its way down, not already there')
  ch = stepChannel(ch, { peak: 0.01, rms: 0.01 }, PEAK_HOLD_MS + 500, 500)
  assert.ok(ch.peakDb < held, 'released after the hold time')
})

test('the clip light latches until reset, and only full scale lights it', () => {
  let ch = stepChannel(emptyChannel(), { peak: 0.99, rms: 0.5 }, 0, 16)
  assert.equal(ch.clipped, false, 'just under full scale is not a clip')
  ch = stepChannel(ch, { peak: 1, rms: 0.7 }, 16, 16)
  assert.equal(ch.clipped, true)
  ch = stepChannel(ch, { peak: 0, rms: 0 }, 5000, 16)
  assert.equal(ch.clipped, true, 'a clip that happened must still be visible after it passed')
})

test('without ballistics (reduced motion) the meter shows the reading as it is', () => {
  let ch = stepChannel(emptyChannel(), { peak: 0.5, rms: 0.3 }, 0, 16, false)
  ch = stepChannel(ch, { peak: 0.01, rms: 0.01 }, 16, 16, false)
  assert.equal(ch.rmsDb, toDb(0.01))
  assert.equal(ch.peakDb, toDb(0.01))
})
