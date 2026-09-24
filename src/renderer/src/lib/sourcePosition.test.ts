import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lastSourceFrame, sourceFrameAtSeconds, sourceFrameStartUs, sourceRate, sourceSeekSeconds } from './sourcePosition'

/** Chromium hands `currentTime` back truncated to whole microseconds. */
const chromium = (seconds: number): number => Math.floor(seconds * 1e6) / 1e6

const RATES = [24, 25, 30, 30000 / 1001, 24000 / 1001, 60]

test('thirty steps from the start are exactly one second: frame 30, marked at 1 000 000 µs', () => {
  // The verification run: 30 × → read 00:00:00:29 and a mark stored 999999 µs.
  let frame = 0
  for (let i = 0; i < 30; i += 1) {
    // Seek, let the element report back its truncated time, read the frame from that — the loop
    // the viewer runs on every step, which is where the old microsecond state drifted.
    frame = sourceFrameAtSeconds(chromium(sourceSeekSeconds(frame + 1, 30)), 30)
  }
  assert.equal(frame, 30)
  assert.equal(sourceFrameStartUs(frame, 30), 1_000_000)
})

test('a seek shows its frame, and reading the element back gives the same frame, at every rate', () => {
  for (const rate of RATES) {
    for (let n = 0; n < 5000; n += 1) {
      const seconds = chromium(sourceSeekSeconds(n, rate))
      // An element shows the frame whose timestamp is at or before currentTime, with no tolerance.
      assert.equal(Math.floor(seconds * rate), n, `rate ${rate}, frame ${n}: the element would show the frame before`)
      assert.equal(sourceFrameAtSeconds(seconds, rate), n, `rate ${rate}, frame ${n}`)
    }
  }
})

test('a playing element a hair short of a frame start reads as that frame, not the one before', () => {
  // 0.999989 s is what the run read back after thirty steps at 30 fps.
  assert.equal(sourceFrameAtSeconds(0.999989, 30), 30)
  // Positive control: well inside the previous frame is still the previous frame.
  assert.equal(sourceFrameAtSeconds(0.99, 30), 29)
})

test('the last frame is the one playing at the very end; a file with no rate counts at 30', () => {
  assert.equal(lastSourceFrame(1_000_000, 30), 29)
  assert.equal(lastSourceFrame(1_010_000, 30), 30)
  assert.equal(lastSourceFrame(0, 30), 0)
  assert.equal(sourceRate(null), 30)
  assert.equal(sourceRate(0), 30)
  assert.equal(sourceRate(25), 25)
})
