/**
 * A score written to disk and read back by bay's own ffmpeg. Run with `pnpm test`.
 *
 * `@shared/sfx`'s tests measure the samples; this is the file. ffprobe and ffmpeg are readers
 * this code never agreed anything with, so what they report — stereo, 48 kHz, 24-bit PCM, the
 * score's length, the same samples, a peak under the ceiling — is evidence the WAV is a WAV and
 * not merely something `parseWavHeader` can read.
 *
 * Skips loudly without the vendored binaries: a check that cannot run must not read as a pass.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { renderScore } from '@shared/sfx/render'
import { checkScore } from '@shared/sfx/score'
import { parseWavHeader } from '@shared/sfx/wav'
import { NO_VENDORED_FFMPEG, vendoredTools } from '../ffmpeg/vendor'
import { sfxSlug, writeSfx, type LoudnessMeter } from './write'

const TOOLS = vendoredTools()
const SKIP = TOOLS ? false : NO_VENDORED_FFMPEG

const FILM = {
  durationSeconds: 5,
  events: [
    { t: 0.3, material: 'whoosh', gain: 0.6, pan: -0.5 },
    { t: 0.9, material: 'thump', gain: 1 },
    { t: 1.5, material: 'knock', gain: 0.5, pan: 0.4 },
    { t: 2.2, material: 'bell', gain: 0.6 },
    { t: 2.2, material: 'bell', gain: 0.5, pitch: 7 },
    { t: 3, material: 'drop', gain: 0.7, pan: 0.6 }
  ]
}

const scratch = (): string => mkdtempSync(join(tmpdir(), 'bay-sfx-write-'))

/** A meter that was never asked: for the tests that are about the file, not the loudness. */
const noMeter: LoudnessMeter = async () => ({ integratedLufs: -30, truePeakDb: -9 })

test('the written file is a WAV ffprobe reads as stereo 48 kHz 24-bit PCM of the score’s length', { skip: SKIP }, async () => {
  const dir = scratch()
  const written = await writeSfx(dir, 'Launch film', FILM)
  assert.equal(written.ok, true, JSON.stringify(written))
  if (!written.ok) return
  const probed = JSON.parse(
    execFileSync(TOOLS!.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', written.path], { encoding: 'utf8' })
  ) as { streams: { codec_name: string; channels: number; sample_rate: string; bits_per_sample: number; duration: string }[]; format: { format_name: string } }
  assert.equal(probed.streams.length, 1)
  const stream = probed.streams[0]!
  assert.equal(stream.codec_name, 'pcm_s24le')
  assert.equal(stream.channels, 2)
  assert.equal(stream.sample_rate, '48000')
  assert.equal(stream.bits_per_sample, 24)
  assert.ok(Math.abs(Number(stream.duration) - FILM.durationSeconds) < 1e-4, `ffprobe says ${stream.duration} s`)
  assert.equal(probed.format.format_name, 'wav')
  assert.equal(written.seconds, FILM.durationSeconds)
  assert.equal(written.events, FILM.events.length)
  // And our own reader agrees with ffprobe, which is what entitles the unit tests to use it.
  const header = parseWavHeader(readFileSync(written.path))
  assert.deepEqual(header && [header.channels, header.sampleRate, header.bitsPerSample, header.frames], [2, 48_000, 24, 5 * 48_000])
})

test('ffmpeg decodes the file to the samples that were rendered, to the last bit of 24', { skip: SKIP }, async () => {
  const written = await writeSfx(scratch(), 'decode', FILM, noMeter)
  assert.equal(written.ok, true)
  if (!written.ok) return
  const raw = execFileSync(TOOLS!.ffmpeg, ['-v', 'error', '-i', written.path, '-f', 'f32le', '-c:a', 'pcm_f32le', '-'], {
    maxBuffer: 64 * 1024 * 1024
  })
  const decoded = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
  const checked = checkScore(FILM)
  assert.ok(checked.ok)
  if (!checked.ok) return
  const rendered = renderScore(checked.score)
  assert.equal(decoded.length, rendered.left.length * 2)
  let worst = 0
  let loudest = 0
  for (let i = 0; i < rendered.left.length; i += 1) {
    worst = Math.max(worst, Math.abs(decoded[i * 2]! - rendered.left[i]!), Math.abs(decoded[i * 2 + 1]! - rendered.right[i]!))
    loudest = Math.max(loudest, Math.abs(decoded[i * 2]!))
  }
  assert.ok(loudest > 0.1, 'the decode is of sound, not of silence')
  // One 24-bit step is 2^-23; ffmpeg scales by 2^23 where the writer scales by 2^23 − 1.
  assert.ok(worst < 2 / 2 ** 23, `the worst sample is off by ${worst}`)
})

test('the measured loudness and true peak are ffmpeg’s reading of the file, and the peak is under the ceiling', { skip: SKIP }, async () => {
  const written = await writeSfx(scratch(), 'measure', FILM)
  assert.equal(written.ok, true)
  if (!written.ok) return
  const run = spawnSync(TOOLS!.ffmpeg, ['-hide_banner', '-nostats', '-i', written.path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], {
    encoding: 'utf8'
  })
  assert.equal(run.status, 0, run.stderr)
  const summary = run.stderr
  const integrated = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary.slice(summary.lastIndexOf('Summary:')))![1])
  const truePeak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary.slice(summary.lastIndexOf('Summary:')))![1])
  assert.equal(written.integratedLufs, integrated)
  assert.equal(written.truePeakDb, truePeak)
  assert.ok(written.integratedLufs !== null && written.integratedLufs < -14 && written.integratedLufs > -40, `${written.integratedLufs} LUFS`)
  assert.ok(written.peakDb !== null && written.peakDb <= -8, `sample peak ${written.peakDb} dBFS`)
  // Between samples the wave can rise a little above its samples; it is still far from the top.
  assert.ok(truePeak <= -7 && truePeak >= written.peakDb! - 0.2, `true peak ${truePeak} dBTP against a sample peak of ${written.peakDb}`)
  assert.equal(written.loudnessNote, undefined)
})

test('the same score is the same file; a changed score is another file and leaves the first alone', async () => {
  const dir = scratch()
  const first = await writeSfx(dir, 'Launch film', FILM, noMeter)
  const again = await writeSfx(dir, 'Launch film', structuredClone(FILM), noMeter)
  assert.ok(first.ok && again.ok)
  if (!first.ok || !again.ok) return
  assert.equal(again.path, first.path)
  assert.match(basename(first.path), /^sfx-launch-film-[0-9a-f]{12}\.wav$/)
  const before = readFileSync(first.path)
  const changed = await writeSfx(dir, 'Launch film', { ...FILM, seed: 9 }, noMeter)
  assert.ok(changed.ok)
  if (!changed.ok) return
  assert.notEqual(changed.path, first.path)
  assert.ok(readFileSync(first.path).equals(before), 'the first file is untouched')
  assert.deepEqual(readdirSync(dir).sort(), [basename(first.path), basename(changed.path)].sort(), 'and no partial file is left behind')
})

test('a bad score is refused in the score’s own sentences and writes nothing', async () => {
  const dir = scratch()
  const refused = await writeSfx(dir, 'bad', { durationSeconds: 5, events: [{ t: 9, material: 'beep' }] }, noMeter)
  assert.equal(refused.ok, false)
  assert.match(refused.ok ? '' : refused.error, /material is "beep".*whoosh, knock, bell, thump, drop/)
  assert.match(refused.ok ? '' : refused.error, /events\[0\]\.t is 9 s, at or past the end/)
  assert.deepEqual(readdirSync(dir), [])
  // The control: the same call with a legal score writes one.
  assert.equal((await writeSfx(dir, 'good', { durationSeconds: 5, events: [{ t: 1, material: 'bell' }] }, noMeter)).ok, true)
  assert.equal(readdirSync(dir).length, 1)
})

test('a folder that cannot be written is a refusal naming it, not a throw', async () => {
  const dir = scratch()
  const blocker = join(dir, 'not-a-folder')
  writeFileSync(blocker, 'x')
  const refused = await writeSfx(blocker, 'x', FILM, noMeter)
  assert.equal(refused.ok, false)
  assert.match(refused.ok ? '' : refused.error, /rendered but could not be written to .*not-a-folder.*Nothing was added/)
  assert.ok(existsSync(blocker))
})

test('a meter that fails, or reads the gate, leaves a good file and says why there is no loudness', async () => {
  const failing = await writeSfx(scratch(), 'x', FILM, async () => {
    throw new Error('ffmpeg is missing')
  })
  assert.ok(failing.ok)
  if (!failing.ok) return
  assert.ok(existsSync(failing.path))
  assert.equal(failing.integratedLufs, null)
  assert.equal(failing.truePeakDb, null)
  assert.match(failing.loudnessNote ?? '', /was written, but its loudness could not be measured: ffmpeg is missing/)
  assert.ok(failing.peakDb !== null && failing.peakDb < -8, 'the sample peak needs no meter')

  const gated = await writeSfx(scratch(), 'x', FILM, async () => ({ integratedLufs: -70, truePeakDb: -30 }))
  assert.ok(gated.ok)
  if (!gated.ok) return
  assert.equal(gated.integratedLufs, null, '−70 is ebur128’s gate, not a level')
  assert.equal(gated.truePeakDb, -30)
  assert.match(gated.loudnessNote ?? '', /needs 0\.4 s of sound above −70 LUFS/)
})

test('the warnings of the score and of the render both come back', async () => {
  const written = await writeSfx(
    scratch(),
    'x',
    { durationSeconds: 3, events: [{ t: 0.5, material: 'knock', kind: 'key' }, { t: 2, material: 'bell', gain: 1 }] },
    noMeter
  )
  assert.ok(written.ok)
  if (!written.ok) return
  assert.ok(written.warnings.some((w) => /"kind" on events\[0\] is not read/.test(w)), written.warnings.join('\n'))
  assert.ok(written.warnings.some((w) => /still ringing at durationSeconds .* faded out/.test(w)), written.warnings.join('\n'))
})

test('a name becomes a file name’s worth of itself', () => {
  assert.equal(sfxSlug('Launch film — v2!'), 'launch-film-v2')
  assert.equal(sfxSlug('../../etc/passwd'), 'etc-passwd')
  assert.equal(sfxSlug(''), 'score')
  assert.equal(sfxSlug('x'.repeat(200)).length, 60)
})
