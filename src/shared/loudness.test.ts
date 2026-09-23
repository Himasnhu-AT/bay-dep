/**
 * The loudness contract: argument parsing, the loop's step, and reading ffmpeg's summary.
 *
 * `main/export/master.test.ts` runs the loop through the real ffmpeg; these pin the pieces that
 * decide it, with literal inputs — the summary text is copied from the bundled ffmpeg 6.1, so a
 * reader change that stops matching the real output fails here rather than in an export.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LOUDNESS_PRESETS,
  firstPass,
  loudnessSummary,
  meetsTarget,
  nextPass,
  parseEbur128Summary,
  parseLoudness
} from './loudness'

/** Real stderr from `ffmpeg -af ebur128=peak=true`, one per-frame line kept before the summary. */
const REAL = `[Parsed_ebur128_0 @ 0x6000035642c0] t: 7.89998    TARGET:-23 LUFS    M: -9.3 S: -9.3     I: -12.0 LUFS       LRA:   0.2 LU  FTPK: -1.2 -1.3 dBFS  TPK: -0.4 -0.5 dBFS
[out#0/null @ 0x60000376c0c0] video:0kB audio:1500kB subtitle:0kB other streams:0kB global headers:0kB muxing overhead: unknown
[Parsed_ebur128_0 @ 0x6000035642c0] Summary:

  Integrated loudness:
    I:          -9.3 LUFS
    Threshold: -19.3 LUFS

  Loudness range:
    LRA:         0.2 LU
    Threshold: -29.3 LUFS
    LRA low:    -9.4 LUFS
    LRA high:   -9.2 LUFS

  True peak:
    Peak:       -0.5 dBFS
`

test('the summary is read from the summary block, not from the per-frame line before it', () => {
  assert.deepEqual(parseEbur128Summary(REAL), { integratedLufs: -9.3, truePeakDb: -0.5 })
})

test('digital silence reads as the gate floor and a peak of −∞', () => {
  const silent = 'Summary:\n\n  Integrated loudness:\n    I:         -70.0 LUFS\n\n  True peak:\n    Peak:       -inf dBFS\n'
  assert.deepEqual(parseEbur128Summary(silent), { integratedLufs: -70, truePeakDb: Number.NEGATIVE_INFINITY })
})

test('output with no summary is null, not zeros', () => {
  assert.equal(parseEbur128Summary(''), null)
  assert.equal(parseEbur128Summary('Error while filtering: Invalid argument'), null)
  assert.equal(parseEbur128Summary('Summary:\n  Integrated loudness:\n'), null, 'a cut-off summary is not a reading')
})

test('presets, "off" and objects parse; everything else is refused with what is accepted', () => {
  assert.deepEqual(parseLoudness('streaming'), { target: { integratedLufs: -14, truePeakDb: -1 } })
  assert.deepEqual(parseLoudness('off'), { target: null })
  assert.deepEqual(parseLoudness(undefined), { target: null })
  assert.deepEqual(parseLoudness({ integratedLufs: -16 }), { target: { integratedLufs: -16, truePeakDb: -1 } })
  const unknown = parseLoudness('loud')
  assert.ok('error' in unknown && /"streaming"/.test(unknown.error) && /integratedLufs/.test(unknown.error))
  const high = parseLoudness({ integratedLufs: 0 })
  assert.ok('error' in high && /from -40 to -5/.test(high.error) && /got 0/.test(high.error))
  const peak = parseLoudness({ integratedLufs: -14, truePeakDb: 2 })
  assert.ok('error' in peak && /truePeakDb/.test(peak.error))
  const typo = parseLoudness({ integratedLUFS: -14 })
  assert.ok('error' in typo && /no field "integratedLUFS"/.test(typo.error))
  // A preset is copied, so a caller cannot edit the table through the result.
  const got = parseLoudness('podcast')
  assert.ok('target' in got && got.target !== LOUDNESS_PRESETS.podcast)
})

test('the first pass gains straight to the target and starts the limiter under the ceiling', () => {
  const settings = firstPass({ integratedLufs: -14, truePeakDb: -1 }, { integratedLufs: -20.5, truePeakDb: -6 })
  assert.equal(settings.gainDb, 6.5)
  assert.ok(settings.limiterCeilingDb < -1)
})

test('each step corrects the error where it lives, and stops only inside both limits', () => {
  const target = { integratedLufs: -14, truePeakDb: -1 }
  const used = { gainDb: 6, limiterCeilingDb: -1.5 }
  // Quiet by 0.6 LU, peak fine: more gain, same ceiling.
  const quiet = nextPass(target, used, { integratedLufs: -14.6, truePeakDb: -2 })
  assert.ok(!quiet.done && Math.abs(quiet.next.gainDb - 6.6) < 1e-9 && quiet.next.limiterCeilingDb === -1.5)
  // On level, peak 0.4 over: same gain, ceiling down by the overshoot plus 0.1.
  const hot = nextPass(target, used, { integratedLufs: -14.1, truePeakDb: -0.6 })
  assert.ok(!hot.done && hot.next.gainDb === 6 && Math.abs(hot.next.limiterCeilingDb - -2) < 1e-9)
  // Inside both: done.
  assert.deepEqual(nextPass(target, used, { integratedLufs: -14.15, truePeakDb: -1.2 }), { done: true })
  // Inside acceptance but not the aim: one more pass, because 0.45 LU off is a hair from failing.
  assert.equal(nextPass(target, used, { integratedLufs: -14.45, truePeakDb: -1.2 }).done, false)
})

test('met means within 0.5 LU and at or under the ceiling — and the sentence says which', () => {
  const target = { integratedLufs: -14, truePeakDb: -1 }
  assert.equal(meetsTarget(target, { integratedLufs: -14.5, truePeakDb: -1 }), true)
  assert.equal(meetsTarget(target, { integratedLufs: -14.6, truePeakDb: -1.5 }), false)
  assert.equal(meetsTarget(target, { integratedLufs: -14, truePeakDb: -0.9 }), false)
  const base = { target, before: { integratedLufs: -20, truePeakDb: -6 }, gainDb: 6, limiterCeilingDb: -1.5, passes: 2 }
  assert.match(
    loudnessSummary({ ...base, status: 'met', measured: { integratedLufs: -14.1, truePeakDb: -1.4 } }),
    /^Mastered to −14\.1 LUFS \(target −14\.0\), true peak −1\.4 dBTP \(ceiling −1\.0\).*after 2 passes/
  )
  assert.match(
    loudnessSummary({ ...base, status: 'missed', measured: { integratedLufs: -12, truePeakDb: -1.1 } }),
    /did not converge in 2 passes.*−12\.0 LUFS \(target −14\.0\)/
  )
})
