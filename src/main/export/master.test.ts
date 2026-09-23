/**
 * Loudness mastering, run through the ffmpeg bay ships and measured on the encoded file.
 *
 * Every measurement here is taken by the test's own `ebur128` call and its own reading of the
 * summary — not through `measureLoudness`/`parseEbur128Summary`, which the code under test uses
 * to decide when to stop. A test that measured with the code's own meter would pass any bug the
 * meter shared with the loop.
 *
 * The specimen is pink noise, chosen because it is dense enough that a −9 LUFS target forces the
 * limiter to work, and there AAC's overshoot is real: the first test proves the naive approach —
 * one pass, limiter at the ceiling, verified as PCM — ships a file over its ceiling. Without that
 * positive control, "the mastered file is under −1 dBTP" could pass against a loop that never
 * needed to correct anything.
 *
 * Skips loudly when the bundled ffmpeg is absent, because a check that cannot run must not read
 * as a pass.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { masterAudio, masterFilter, verifyDelivered } from './master'
import { audioCodecArgs } from './codec-args'

const require_ = createRequire(import.meta.url)
const FFMPEG = (require_('ffmpeg-ffprobe-static') as { ffmpegPath?: string | null }).ffmpegPath ?? ''
const SKIP = existsSync(FFMPEG) ? false : `no bundled ffmpeg at "${FFMPEG}" — run pnpm install`
const RATE = 48_000

/** The test's own meter: integrated LUFS and true peak dBTP, from the last summary block. */
function meter(path: string): { I: number; TP: number } {
  const run = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  const summary = run.stderr.slice(run.stderr.lastIndexOf('Summary:'))
  const I = Number(/I:\s+(\S+)\s+LUFS/.exec(summary)?.[1])
  const TP = Number(/Peak:\s+(\S+)\s+dBFS/.exec(summary)?.[1])
  assert.ok(Number.isFinite(I) && Number.isFinite(TP), `the meter must read ${path}: ${summary.slice(0, 400)}`)
  return { I, TP }
}

function pinkNoise(dir: string, seconds = 8): string {
  const path = join(dir, 'mix.wav')
  execFileSync(FFMPEG, [
    '-v', 'error', '-y', '-f', 'lavfi',
    '-i', `anoisesrc=color=pink:amplitude=0.5:duration=${seconds}:seed=7`,
    '-ac', '2', '-ar', String(RATE), '-c:a', 'pcm_s16le', path
  ])
  return path
}

test('the specimen defeats a PCM-verified limiter: one pass at the ceiling ships AAC over it', { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-master-'))
  const mix = pinkNoise(dir)
  const raw = meter(mix)
  const settings = { gainDb: -9 - raw.I, limiterCeilingDb: -1 }
  const pcm = join(dir, 'naive.wav')
  const aac = join(dir, 'naive.m4a')
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', mix, '-af', masterFilter(settings), '-c:a', 'pcm_f32le', pcm])
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', pcm, ...audioCodecArgs('mp4'), aac])
  const asPcm = meter(pcm)
  const asAac = meter(aac)
  assert.ok(asPcm.TP <= -0.8, `as PCM the limiter holds the peak near its ceiling (${asPcm.TP})`)
  assert.ok(asAac.TP > -1, `encoded, the same audio is over −1 dBTP (${asAac.TP}) — the loop has something to correct`)
})

test('a hot target lands within 0.5 LU and under the ceiling on the encoded AAC', { skip: SKIP, timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-master-'))
  const output = join(dir, 'mastered.m4a')
  const target = { integratedLufs: -9, truePeakDb: -1 }
  const report = await masterAudio({
    ffmpeg: FFMPEG,
    input: pinkNoise(dir),
    output,
    codecArgs: audioCodecArgs('mp4'),
    target,
    outputArgs: ['-vn']
  })
  const measured = meter(output)
  assert.ok(Math.abs(measured.I - target.integratedLufs) <= 0.5, `I ${measured.I} against ${target.integratedLufs}`)
  assert.ok(measured.TP <= target.truePeakDb, `TP ${measured.TP} over the ceiling ${target.truePeakDb}`)
  assert.equal(report.status, 'met', report.summary)
  assert.ok(report.passes > 1, `this specimen needs a correction pass; it took ${report.passes}`)
  // The report is about the file: its numbers are the file's, to the meter's precision.
  assert.ok(Math.abs((report.measured?.integratedLufs ?? 0) - measured.I) <= 0.05)
  assert.ok(Math.abs((report.measured?.truePeakDb ?? 0) - measured.TP) <= 0.05)
  assert.match(report.summary, /LUFS \(target −9\.0\)/)
})

test('the streaming preset lands on −14 LUFS / −1 dBTP, and mp3 is judged as mp3', { skip: SKIP, timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-master-'))
  for (const format of ['mp4', 'mp3'] as const) {
    const output = join(dir, `mastered.${format === 'mp4' ? 'm4a' : 'mp3'}`)
    const report = await masterAudio({
      ffmpeg: FFMPEG,
      input: pinkNoise(dir, 6),
      output,
      codecArgs: audioCodecArgs(format),
      target: { integratedLufs: -14, truePeakDb: -1 }
    })
    const measured = meter(output)
    assert.ok(Math.abs(measured.I + 14) <= 0.5, `${format}: I ${measured.I}`)
    assert.ok(measured.TP <= -1, `${format}: TP ${measured.TP}`)
    assert.equal(report.status, 'met', `${format}: ${report.summary}`)
  }
})

/**
 * Kick, a noise snare with a sharp attack and a pad at 110 BPM, driven into clipping — the shape of
 * a loud score's drums, which is what the codec overshoots on. Pink noise is stationary and does
 * not show it. Found by search: of five drum-like specimens this is the one ffmpeg's native aac
 * cannot be mastered through, which the control in the test below re-proves on every run.
 */
function drums(dir: string): string {
  const path = join(dir, 'drums.wav')
  const beat = 0.5454
  const channel = (seed: number, pad: number): string =>
    `0.7*max(-1,min(1,1.6*(0.9*sin(2*PI*55*t)*exp(-15*mod(t,${beat}))+0.9*(random(${seed})*2-1)*exp(-70*mod(t+${beat / 2},${beat}))+0.25*sin(2*PI*${pad}*t))))`
  execFileSync(FFMPEG, [
    '-v', 'error', '-y', '-f', 'lavfi',
    '-i', `aevalsrc='${channel(0, 220)}|${channel(1, 330)}':s=${RATE}:d=12`,
    '-c:a', 'pcm_s16le', path
  ])
  return path
}

test('drums master to the streaming preset on the encoded file; ffmpeg\'s own aac cannot get there', { skip: SKIP, timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-master-'))
  const input = drums(dir)
  const target = { integratedLufs: -14, truePeakDb: -1 }
  const run = async (codecArgs: string[], name: string) => {
    const output = join(dir, name)
    const report = await masterAudio({ ffmpeg: FFMPEG, input, output, codecArgs, target, outputArgs: ['-vn'] })
    return { report, measured: meter(output) }
  }
  // The control: the same loop through the encoder exports used to ship with. If this ever meets
  // the target, the specimen no longer tells the encoders apart and the assertion below is empty.
  const native = await run(['-c:a', 'aac', '-b:a', '192k'], 'native.m4a')
  assert.ok(native.measured.TP > target.truePeakDb, `native aac should miss the ceiling on this specimen (TP ${native.measured.TP})`)

  const shipped = await run(audioCodecArgs('mp4'), 'shipped.m4a')
  assert.ok(shipped.measured.TP <= target.truePeakDb, `TP ${shipped.measured.TP} over ${target.truePeakDb}: ${shipped.report.summary}`)
  assert.ok(Math.abs(shipped.measured.I - target.integratedLufs) <= 0.5, `I ${shipped.measured.I}`)
  assert.equal(shipped.report.status, 'met', shipped.report.summary)
})

test('mastering does not move the sound in time: the limiter lookahead is compensated', { skip: SKIP, timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-master-'))
  // One second of silence, then a tone. The onset must stay at exactly 1.0 s after mastering.
  const input = join(dir, 'onset.wav')
  execFileSync(FFMPEG, [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `anullsrc=r=${RATE}:cl=stereo:d=1`,
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=3',
    '-filter_complex', '[1:a]aformat=channel_layouts=stereo[t];[0:a][t]concat=n=2:v=0:a=1',
    '-ar', String(RATE), '-c:a', 'pcm_s16le', input
  ])
  const output = join(dir, 'onset-mastered.wav')
  await masterAudio({
    ffmpeg: FFMPEG,
    input,
    output,
    codecArgs: audioCodecArgs('wav'),
    target: { integratedLufs: -14, truePeakDb: -1 }
  })
  const onsetOf = (path: string): number => {
    const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', String(RATE), '-'])
    const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2))
    return samples.findIndex((s) => Math.abs(s) > 64)
  }
  const before = onsetOf(input)
  const after = onsetOf(output)
  assert.ok(Math.abs(before - RATE) <= 2, `the specimen's onset is at 1 s (${before})`)
  assert.ok(Math.abs(after - before) <= RATE / 1000, `mastering moved the onset by ${after - before} samples`)
})

test('silence is reported as silence, not mastered by +56 dB of floor', { skip: SKIP, timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-master-'))
  const input = join(dir, 'silence.wav')
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `anullsrc=r=${RATE}:cl=stereo:d=2`, '-c:a', 'pcm_s16le', input])
  const output = join(dir, 'silence.m4a')
  const report = await masterAudio({
    ffmpeg: FFMPEG,
    input,
    output,
    codecArgs: audioCodecArgs('mp4'),
    target: { integratedLufs: -14, truePeakDb: -1 }
  })
  assert.equal(report.status, 'silent')
  assert.equal(report.gainDb, 0)
  assert.match(report.summary, /silence/)
  assert.ok(existsSync(output), 'the file is still delivered')
  // And re-verifying a silent report leaves it as it is rather than calling it missed.
  assert.equal((await verifyDelivered(FFMPEG, output, report)).status, 'silent')
})
