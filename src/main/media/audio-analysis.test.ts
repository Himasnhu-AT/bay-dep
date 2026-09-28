/**
 * The audio measurements against bay's own ffmpeg, on specimens made in the test: a tone with
 * silences cut into it at known times, and the same tone 6 dB apart. The reducers and the parser
 * are also held on their own, including a PCM stream split on an odd byte.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NO_VENDORED_FFMPEG, vendoredTools } from '../ffmpeg/vendor'
import { audioLevels, detectSilences, measureLoudness, parseSilences, RmsWindows, SILENCE_FLOOR_DB, toDb } from './audio-analysis'

const FFMPEG = vendoredTools()?.ffmpeg ?? ''
const SKIP = FFMPEG ? false : NO_VENDORED_FFMPEG

function pcm(values: number[]): Buffer {
  const out = Buffer.alloc(values.length * 2)
  values.forEach((v, i) => out.writeInt16LE(Math.round(v * 32767), i * 2))
  return out
}

test('RmsWindows: RMS per window in dB, across chunks split mid-sample', () => {
  const samples = [...Array(4).fill(0.5), ...Array(4).fill(-0.5), ...Array(4).fill(0)]
  const bytes = pcm(samples)
  const reducer = new RmsWindows(4)
  // Split on an odd byte: the sample straddling the chunks must be read whole.
  reducer.push(bytes.subarray(0, 7))
  reducer.push(bytes.subarray(7))
  const out = reducer.finish()
  assert.equal(out.length, 3)
  assert.ok(Math.abs(out[0]! - 20 * Math.log10(0.5)) < 0.01, String(out[0]))
  assert.ok(Math.abs(out[1]! - 20 * Math.log10(0.5)) < 0.01, String(out[1]))
  assert.equal(out[2], SILENCE_FLOOR_DB)
})

test('RmsWindows: fractional windows do not drift, and a trailing sliver is not a window', () => {
  // 2.5 samples a window over 100 samples: exactly 40 windows, not 33 (rounded to 3) or 50 (to 2).
  const reducer = new RmsWindows(2.5)
  reducer.push(pcm(Array(100).fill(0.25)))
  assert.equal(reducer.finish().length, 40)
  const sliver = new RmsWindows(10)
  sliver.push(pcm(Array(23).fill(0.25)))
  assert.equal(sliver.finish().length, 2, '3 samples of a 10-sample window are dropped')
  const half = new RmsWindows(10)
  half.push(pcm(Array(25).fill(0.25)))
  assert.equal(half.finish().length, 3, 'half a window is kept')
})

test('toDb floors silence at -120', () => {
  assert.equal(toDb(0), -120)
  assert.equal(toDb(1), 0)
})

test('parseSilences pairs starts with ends, and closes a silence still open at the end', () => {
  const out = [
    'frame:9    pts:36864   pts_time:0.768',
    'lavfi.silence_start=0.502667',
    'frame:17   pts:69632   pts_time:1.450667',
    'lavfi.silence_end=1.505333',
    'lavfi.silence_duration=1.002667',
    'frame:32   pts:131072  pts_time:2.730667',
    'lavfi.silence_start=2.507833',
    ''
  ].join('\n')
  assert.deepEqual(parseSilences(out, 5), [
    { startSec: 0.503, endSec: 1.505 },
    { startSec: 2.508, endSec: 5 }
  ])
  assert.deepEqual(parseSilences('', 5), [])
})

function specimen(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'bay-audio-analysis-'))
  const path = join(dir, 'tone-with-gaps.wav')
  // lavfi's 440 Hz sine (amplitude 1/8), mono, silent over 1–2 s and 3–4.5 s of 6 s.
  execFileSync(FFMPEG, [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=f=440:d=6:sample_rate=48000',
    '-af', "volume='if(between(t,1,2)+between(t,3,4.5),0,1)':eval=frame",
    path
  ])
  return { dir, path }
}

test('silencedetect finds the silences where they were cut, in seconds from the span start', { skip: SKIP }, async () => {
  const { path } = specimen()
  const whole = await detectSilences(path, { startUs: 0, durationUs: 6_000_000 }, -30, 0.3)
  assert.equal(whole.length, 2, JSON.stringify(whole))
  assert.ok(Math.abs(whole[0]!.startSec - 1) < 0.03 && Math.abs(whole[0]!.endSec - 2) < 0.03, JSON.stringify(whole))
  assert.ok(Math.abs(whole[1]!.startSec - 3) < 0.03 && Math.abs(whole[1]!.endSec - 4.5) < 0.03, JSON.stringify(whole))
  // Read from 0.5 s, the same silences come back 0.5 s earlier: times are from the span's start.
  const late = await detectSilences(path, { startUs: 500_000, durationUs: 5_000_000 }, -30, 0.3)
  assert.ok(Math.abs(late[0]!.startSec - 0.5) < 0.03 && Math.abs(late[0]!.endSec - 1.5) < 0.03, JSON.stringify(late))
  // The minimum length is honoured: a 1.2 s floor keeps only the 1.5 s silence.
  const long = await detectSilences(path, { startUs: 0, durationUs: 6_000_000 }, -30, 1.2)
  assert.equal(long.length, 1, JSON.stringify(long))
})

test('levels are the tone\'s RMS where it plays and the floor where it does not', { skip: SKIP }, async () => {
  const { path } = specimen()
  const levels = await audioLevels(path, { startUs: 0, durationUs: 6_000_000 }, 50_000)
  assert.equal(levels.length, 120)
  // Amplitude 1/8: RMS 0.125/√2 → -21.07 dBFS.
  const tone = levels[10]!
  assert.ok(Math.abs(tone - -21.07) < 0.3, `tone at ${tone}`)
  assert.ok(levels[30]! < -80, `silence at ${levels[30]}`)
  assert.ok(levels[50]! > -22, `tone again at ${levels[50]}`)
  // A span from 1 s: its first window is the silence.
  const late = await audioLevels(path, { startUs: 1_000_000, durationUs: 2_000_000 }, 50_000)
  assert.equal(late.length, 40)
  assert.ok(late[5]! < -80 && late[25]! > -22, JSON.stringify([late[5], late[25]]))
})

test('loudness tracks gain: the same tone 6 dB down reads 6 LU quieter', { skip: SKIP }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-loudness-'))
  const make = (name: string, volume: string): string => {
    const path = join(dir, name)
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=1000:d=4:sample_rate=48000', '-af', `volume=${volume}`, path])
    return path
  }
  const loud = await measureLoudness(make('loud.wav', '0.5'), { startUs: 0, durationUs: 4_000_000 })
  const quiet = await measureLoudness(make('quiet.wav', '0.25'), { startUs: 0, durationUs: 4_000_000 })
  assert.ok(Math.abs(loud.integratedLufs - quiet.integratedLufs - 6.02) < 0.3, JSON.stringify({ loud, quiet }))
  assert.ok(Number.isFinite(loud.integratedLufs) && loud.integratedLufs > -40, JSON.stringify(loud))
})
