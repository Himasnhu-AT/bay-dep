import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FRAME_RATES } from './project'
import { formatTimecode, parseTimecode, resolveTimecode } from './timecode'

test('five seconds reads as five seconds, not five minutes', () => {
  // The walkthrough's complaint, as the literal a person sees.
  assert.equal(formatTimecode(150, 30), '00:00:05:00')
  assert.equal(formatTimecode(5 * 60 * 30, 30), '00:05:00:00')
  assert.notEqual(formatTimecode(150, 30), formatTimecode(5 * 60 * 30, 30))
})

test('always four fields, hours included', () => {
  assert.equal(formatTimecode(0, 30), '00:00:00:00')
  assert.equal(formatTimecode(3600 * 25 + 12, 25), '01:00:00:12')
  assert.equal(formatTimecode(-4, 30), '00:00:00:00')
  assert.equal(formatTimecode(Number.NaN, 30), '00:00:00:00')
})

test('29.97 is non-drop with thirty slots: the frames field is whole and below 30', () => {
  const ntsc = 30000 / 1001
  assert.equal(formatTimecode(29, ntsc), '00:00:00:29')
  assert.equal(formatTimecode(30, ntsc), '00:00:01:00')
  // An hour of wall clock at 29.97 is 107892 frames, which non-drop shows short of an hour.
  assert.equal(formatTimecode(Math.round(3600 * ntsc), ntsc), '00:59:56:12')
})

test('format and parse are exact inverses at every offered rate', () => {
  for (const { fps, label } of FRAME_RATES) {
    for (const frames of [0, 1, 29, 59, 61, 1799, 1801, 107892, 215999]) {
      const shown = formatTimecode(frames, fps)
      assert.deepEqual(parseTimecode(shown, fps), { kind: 'absolute', frame: frames }, `${label}: ${shown}`)
    }
  }
})

test('colon fields are right-aligned to frames, as NLE timecode fields read them', () => {
  assert.deepEqual(parseTimecode('1:23', 30), { kind: 'absolute', frame: 53 })
  assert.deepEqual(parseTimecode('1:00:00', 30), { kind: 'absolute', frame: 60 * 30 })
  assert.deepEqual(parseTimecode('01.02', 25), { kind: 'absolute', frame: 27 })
  // The leading field may overflow; the others may not.
  assert.deepEqual(parseTimecode('90:00', 30), { kind: 'absolute', frame: 90 * 30 })
  assert.equal(parseTimecode('1:30', 30), null, '30 frames is not a frames field at 30 fps')
  assert.equal(parseTimecode('1:60:00', 30), null)
})

test('bare numbers are frames; units are wall-clock time', () => {
  assert.deepEqual(parseTimecode('45', 30), { kind: 'absolute', frame: 45 })
  assert.deepEqual(parseTimecode('2s', 30), { kind: 'absolute', frame: 60 })
  assert.deepEqual(parseTimecode('1.5s', 24), { kind: 'absolute', frame: 36 })
  assert.deepEqual(parseTimecode('1m30s', 25), { kind: 'absolute', frame: 90 * 25 })
  assert.deepEqual(parseTimecode('1m 30s 12f', 25), { kind: 'absolute', frame: 90 * 25 + 12 })
  assert.deepEqual(parseTimecode('10f', 30), { kind: 'absolute', frame: 10 })
  // Two real seconds at 29.97 is 59.94 frames: rounded to 60, not 2 × 30 slots by coincidence.
  assert.deepEqual(parseTimecode('100s', 30000 / 1001), { kind: 'absolute', frame: 2997 })
})

test('a sign makes it a distance from the playhead', () => {
  assert.deepEqual(parseTimecode('+2s', 30), { kind: 'relative', delta: 60 })
  assert.deepEqual(parseTimecode('+15', 30), { kind: 'relative', delta: 15 })
  assert.deepEqual(parseTimecode('- 1:00', 30), { kind: 'relative', delta: -30 })
  assert.equal(resolveTimecode({ kind: 'relative', delta: 60 }, 100, 1000), 160)
  assert.equal(resolveTimecode({ kind: 'relative', delta: -500 }, 100, 1000), 0)
  assert.equal(resolveTimecode({ kind: 'absolute', frame: 5000 }, 100, 1000), 1000)
})

test('text that is not a time is refused, not read as zero', () => {
  for (const bad of ['', '+', 'abc', '1:2:3:4:5', '2x', 's', '1..2', '-', '1s2m']) {
    assert.equal(parseTimecode(bad, 30), null, JSON.stringify(bad))
  }
})

test('the units style names its unit', () => {
  assert.equal(formatTimecode(12, 30, { style: 'units' }), '12f')
  assert.equal(formatTimecode(150, 30, { style: 'units' }), '5s')
  assert.equal(formatTimecode(162, 30, { style: 'units' }), '5s 12f')
  assert.equal(formatTimecode(68 * 30, 30, { style: 'units' }), '1m 08s')
  assert.equal(formatTimecode(3720 * 30, 30, { style: 'units' }), '1h 02m')
})
