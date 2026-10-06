/**
 * The baked kinds — compressor, gate, de-esser, limiter, noise removal — rendered by the real
 * ffmpeg through `AudioFxBaker` and measured, and the baker's own promises: content-addressed,
 * cached, refused for a path bay may not read, never half-written, kept in sync and under a cap.
 *
 * Levels are measured here from the samples (`specimen.ts`), against the textbook static curves in
 * `@shared/audio-effects`. Skips loudly without the vendored ffmpeg.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  compressorOutDb,
  defaultEffect,
  gateOutDb,
  limiterOutDb,
  type AudioEffect,
  type AudioEffectKind
} from '@shared/audio-effects'
import { NO_VENDORED_FFMPEG, vendoredTools } from '../ffmpeg/vendor'
import { AudioFxBaker, bakeArgs, sweepBakes } from './bake'
import { RATE, decode, peakDb, rmsDb, sineTerm, synth, toneDb } from './specimen'

const FFMPEG = vendoredTools()?.ffmpeg ?? ''
const SKIP = FFMPEG ? false : NO_VENDORED_FFMPEG

const fx = (kind: AudioEffectKind, params: Record<string, number> = {}): AudioEffect => {
  const base = defaultEffect(kind, kind)
  return { ...base, params: { ...base.params, ...params } }
}

function setup(name: string): { dir: string; baker: AudioFxBaker; runs: () => number } {
  const dir = mkdtempSync(join(tmpdir(), `bay-afx-${name}-`))
  let runs = 0
  const baker = new AudioFxBaker({
    dir: join(dir, 'bakes'),
    ffmpeg: () => {
      runs += 1
      return FFMPEG
    },
    isAllowed: (path) => !path.includes('forbidden')
  })
  return { dir, baker, runs: () => runs }
}

async function baked(baker: AudioFxBaker, path: string, effects: AudioEffect[]): Promise<Float32Array> {
  const result = await baker.ensure({ path, effects })
  assert.ok(result.ok, result.ok ? '' : result.error)
  return decode(FFMPEG, result.path)
}

/** A tone that steps through `levels` (dBFS peak), `seconds` each. */
function steps(dir: string, name: string, frequency: number, levels: readonly number[], seconds: number): string {
  const gain = levels
    .map((db, i) => `${Math.pow(10, db / 20).toFixed(8)}*between(t,${i * seconds},${(i + 1) * seconds - 1e-6})`)
    .join('+')
  return synth(FFMPEG, dir, name, `(${gain})*sin(2*PI*${frequency}*t)`, levels.length * seconds)
}

/** Stated tolerances, in dB, of ffmpeg's dynamics against the textbook static curves. */
const CURVE_TOLERANCE_DB = 0.15
const DEESSER_TOLERANCE_DB = 1

test('the compressor follows the textbook static curve: quiet passes, loud is reduced by the ratio, the knee bends', { skip: SKIP, timeout: 60_000 }, async () => {
  const { dir, baker } = setup('comp')
  // A quiet section, sections through the knee, and loud ones — settled for 4 s each.
  const levels = [-40, -30, -21, -18, -15, -12, -6, -3]
  const source = steps(dir, 'steps', 1000, levels, 4)
  for (const knee of [0, 6, 12]) {
    // A fast attack and a slow release: the detector then sits on the sine's peak, which is the
    // level a static curve is drawn against. (At the default 10/120 ms it rides ~0.5 dB under.)
    const params = { threshold: -18, ratio: 4, knee, attack: 0.1, release: 3000, makeup: 0 }
    const out = await baked(baker, source, [fx('compressor', params)])
    let reduced = 0
    for (const [i, level] of levels.entries()) {
      const measured = toneDb(out, 1000, (i * 4 + 2.5) * RATE, RATE)
      const expected = compressorOutDb(level, params)
      reduced = Math.max(reduced, level - measured)
      assert.ok(Math.abs(measured - expected) <= CURVE_TOLERANCE_DB, `knee ${knee} dB, in ${level}: out ${measured.toFixed(2)}, the curve ${expected.toFixed(2)}`)
    }
    assert.ok(reduced > 10, `the loud section must be reduced (${reduced.toFixed(1)} dB of gain reduction)`)
  }
  const made = await baked(baker, source, [fx('compressor', { threshold: -18, ratio: 4, knee: 0, attack: 0.1, release: 3000, makeup: 6 })])
  assert.ok(Math.abs(toneDb(made, 1000, 2.5 * RATE, RATE) - -34) <= CURVE_TOLERANCE_DB, 'make-up is added below the threshold too')
})

test('at its default attack and release the compressor is within 1 dB of the curve on a sustained tone', { skip: SKIP, timeout: 60_000 }, async () => {
  const { dir, baker } = setup('comp-default')
  // The default timing is what a user who adds a compressor and sets only threshold and ratio gets.
  const params = { threshold: -18, ratio: 4, knee: 0 }
  for (const frequency of [220, 1000, 3000]) {
    const out = await baked(baker, synth(FFMPEG, dir, `t${frequency}`, sineTerm(frequency, -6), 4), [fx('compressor', params)])
    const measured = toneDb(out, frequency, 2 * RATE, RATE)
    const expected = compressorOutDb(-6, params)
    assert.ok(Math.abs(measured - expected) <= 1, `${frequency} Hz at −6: out ${measured.toFixed(2)}, the curve ${expected.toFixed(2)}`)
    assert.ok(measured < -6 - 7, `and it is compressing: ${(-6 - measured).toFixed(1)} dB of reduction`)
  }
})

test('the gate follows the textbook curve: above the threshold untouched, below it expanded, never past the range', { skip: SKIP, timeout: 60_000 }, async () => {
  const { dir, baker } = setup('gate')
  const levels = [-70, -50, -45, -30, -20]
  const source = steps(dir, 'steps', 1000, levels, 4)
  const params = { threshold: -40, ratio: 2, range: -20, knee: 0, attack: 0.1, release: 3000 }
  const out = await baked(baker, source, [fx('gate', params)])
  for (const [i, level] of levels.entries()) {
    const measured = toneDb(out, 1000, (i * 4 + 2.5) * RATE, RATE)
    const expected = gateOutDb(level, params)
    assert.ok(Math.abs(measured - expected) <= CURVE_TOLERANCE_DB, `in ${level}: out ${measured.toFixed(2)}, the curve ${expected.toFixed(2)}`)
  }
  assert.equal(gateOutDb(-70, params), -90, 'the −70 dB step is the one held by the range, not the ratio')
})

test('the de-esser turns sibilance down and leaves a low tone at the same level alone', { skip: SKIP, timeout: 60_000 }, async () => {
  const { dir, baker } = setup('deess')
  const params = { frequency: 4000, threshold: -30, ratio: 4 }
  const hiss = await baked(baker, synth(FFMPEG, dir, 'hiss', sineTerm(8000, -12), 3), [fx('deesser', params)])
  const measured = toneDb(hiss, 8000, 2 * RATE, RATE / 2)
  const expected = compressorOutDb(-12, { threshold: -30, ratio: 4 })
  assert.ok(Math.abs(measured - expected) <= DEESSER_TOLERANCE_DB, `8 kHz at −12: out ${measured.toFixed(2)}, the curve ${expected.toFixed(2)}`)
  // The same level an octave under the detector's frequency never reaches the threshold.
  const voice = await baked(baker, synth(FFMPEG, dir, 'voice', sineTerm(500, -12), 3), [fx('deesser', params)])
  assert.ok(Math.abs(toneDb(voice, 500, 2 * RATE, RATE / 2) - -12) <= 0.05, `500 Hz at −12 is untouched (${toneDb(voice, 500, 2 * RATE, RATE / 2).toFixed(2)})`)
  // And sibilance under the threshold is left alone too.
  const soft = await baked(baker, synth(FFMPEG, dir, 'soft', sineTerm(8000, -40), 3), [fx('deesser', params)])
  assert.ok(Math.abs(toneDb(soft, 8000, 2 * RATE, RATE / 2) - -40) <= 0.05)
})

test('the limiter is a ceiling: nothing comes out over it, and what is under it is only made louder by its gain', { skip: SKIP, timeout: 60_000 }, async () => {
  const { dir, baker } = setup('limit')
  const params = { ceiling: -6, gain: 6, release: 50 }
  for (const level of [-20, -6, -3, 0]) {
    const out = await baked(baker, synth(FFMPEG, dir, `l${-level}`, sineTerm(1000, level), 3), [fx('limiter', params)])
    const peak = peakDb(out, RATE, RATE)
    assert.ok(Math.abs(peak - limiterOutDb(level, params)) <= 0.1, `in ${level}: peak ${peak.toFixed(2)}, expected ${limiterOutDb(level, params)}`)
    assert.ok(peakDb(out, 0, out.length) <= params.ceiling + 0.05, `no sample over the ceiling (${peakDb(out, 0, out.length).toFixed(2)})`)
  }
})

/** Stated: at 50 % strength the noise drops by at least this, and the tone moves by at most that. */
const NOISE_DROP_DB = 15
const TONE_HOLD_DB = 0.5

test('noise removal: the noise floor drops by at least 15 dB at 50 %, and the tone stays within 0.5 dB', { skip: SKIP, timeout: 90_000 }, async () => {
  const { dir, baker } = setup('denoise')
  const withNoise = (name: string, tone: string): string => {
    const path = join(dir, `${name}.wav`)
    execFileSync(FFMPEG, [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `aevalsrc='${tone}':s=${RATE}:d=8`,
      '-f', 'lavfi', '-i', `anoisesrc=color=white:amplitude=0.02:seed=7:r=${RATE}:d=8`,
      '-filter_complex', '[0:a][1:a]amix=inputs=2:normalize=0[o]', '-map', '[o]', '-c:a', 'pcm_f32le', path
    ])
    return path
  }
  /** The noise under a steady tone: the window's power less the tone's. */
  const noiseUnderTone = (samples: Float32Array, start: number): number => {
    const tone = toneDb(samples, 1000, start, RATE)
    const total = rmsDb(samples, start, RATE)
    return 10 * Math.log10(Math.max(1e-12, Math.pow(10, total / 10) - Math.pow(10, (tone - 3.0103) / 10)))
  }

  // "Speech": a tone that comes and goes, noise throughout — the quiet stretches are the noise.
  const speech = withNoise('speech', `(between(t,1,3)+between(t,5,7))*${sineTerm(1000, -12)}`)
  const dry = decode(FFMPEG, speech)
  const dryGap = rmsDb(dry, 3.5 * RATE, RATE)
  assert.ok(dryGap > -42 && dryGap < -36, `the specimen's noise is about −39 dB RMS (${dryGap.toFixed(2)})`)
  const wet = await baked(baker, speech, [fx('denoise', { strength: 50 })])
  assert.equal(wet.length, dry.length, 'the processed file is as long as the source')
  const drop = dryGap - rmsDb(wet, 3.5 * RATE, RATE)
  assert.ok(drop >= NOISE_DROP_DB, `the noise between the tones dropped by ${drop.toFixed(1)} dB (stated: at least ${NOISE_DROP_DB})`)
  assert.ok(Math.abs(toneDb(wet, 1000, 5.5 * RATE, RATE) - -12) <= TONE_HOLD_DB, `the tone is ${toneDb(wet, 1000, 5.5 * RATE, RATE).toFixed(2)} dB (was −12)`)
  const underDrop = noiseUnderTone(dry, 5.5 * RATE) - noiseUnderTone(wet, 5.5 * RATE)
  assert.ok(underDrop >= 10, `and the noise under the tone dropped by ${underDrop.toFixed(1)} dB`)

  // More strength removes more; a quarter removes less than half.
  const light = await baked(baker, speech, [fx('denoise', { strength: 25 })])
  const lightDrop = dryGap - rmsDb(light, 3.5 * RATE, RATE)
  assert.ok(lightDrop > 5 && lightDrop < drop - 5, `25 % removes ${lightDrop.toFixed(1)} dB, 50 % ${drop.toFixed(1)}`)

  // A steady tone with noise and no pauses at all: still at least 10 dB, tone still held.
  const steady = withNoise('steady', sineTerm(1000, -12))
  const steadyDry = decode(FFMPEG, steady)
  const steadyWet = await baked(baker, steady, [fx('denoise', { strength: 50 })])
  const steadyDrop = noiseUnderTone(steadyDry, 4 * RATE) - noiseUnderTone(steadyWet, 4 * RATE)
  assert.ok(steadyDrop >= 10, `under a steady tone the noise dropped by ${steadyDrop.toFixed(1)} dB`)
  assert.ok(Math.abs(toneDb(steadyWet, 1000, 4 * RATE, RATE) - -12) <= TONE_HOLD_DB)
})

test('a processed file is in sync with its source: every baked kind, to the sample', { skip: SKIP, timeout: 90_000 }, async () => {
  const { dir, baker } = setup('sync')
  const loud = join(dir, 'pink.wav')
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=0.25:seed=3:r=${RATE}:d=4`, '-c:a', 'pcm_f32le', loud])
  const dry = decode(FFMPEG, loud)
  const lagOf = (out: Float32Array): number => {
    let best = Number.NEGATIVE_INFINITY
    let at = 0
    for (let lag = -64; lag <= 2400; lag += 1) {
      let sum = 0
      for (let i = RATE; i < RATE + 12000; i += 1) sum += dry[i]! * (out[i + lag] ?? 0)
      if (sum > best) {
        best = sum
        at = lag
      }
    }
    return at
  }
  // The instrument: it must find a delay that is there. 1200 samples is the one afftdn has.
  const delayed = new Float32Array(dry.length)
  delayed.set(dry.subarray(0, dry.length - 1200), 1200)
  assert.equal(lagOf(delayed), 1200, 'the cross-correlation finds a 1200-sample delay')

  const chains: AudioEffect[][] = [
    [fx('compressor')],
    [fx('gate')],
    [fx('deesser')],
    [fx('limiter')],
    [fx('denoise', { strength: 10 })],
    [fx('highpass'), fx('denoise', { strength: 10 }), fx('compressor'), fx('limiter')]
  ]
  for (const chain of chains) {
    const out = await baked(baker, loud, chain)
    assert.equal(lagOf(out), 0, `${chain.map((e) => e.kind).join(' → ')} is delayed by ${lagOf(out)} samples`)
    assert.equal(out.length, dry.length, `${chain.map((e) => e.kind).join(' → ')} keeps the source's length`)
  }
})

test('a source whose sound starts late keeps that delay in its processed file', { skip: SKIP, timeout: 60_000 }, async () => {
  const { dir, baker } = setup('late')
  const tone = synth(FFMPEG, dir, 'tone', sineTerm(1000, -12), 2)
  // A picture from zero and a sound that starts half a second in, as a camera's file can. (A file
  // of sound alone would not do: ffmpeg shifts a whole file to start at zero, so nothing is late.)
  const late = join(dir, 'late.mkv')
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=s=64x64:d=2.5:r=10', '-itsoffset', '0.5', '-i', tone, '-c:v', 'mjpeg', '-c:a', 'pcm_s16le', late])
  // The specimen defeats a bake that ignores the offset: rendered plainly, the tone is there at 0.1 s.
  const plain = join(dir, 'plain.wav')
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', late, '-vn', '-af', 'aresample=48000', '-c:a', 'pcm_f32le', plain])
  assert.ok(toneDb(decode(FFMPEG, plain), 1000, 0.1 * RATE, 0.3 * RATE) > -13, 'without the pin, the sound comes out half a second early')
  const out = await baked(baker, late, [fx('compressor', { threshold: -6 })])
  assert.ok(toneDb(out, 1000, 0.1 * RATE, 0.3 * RATE) < -80, 'the first half second is the silence the stream starts after')
  assert.ok(Math.abs(toneDb(out, 1000, 0.75 * RATE, RATE / 2) - -12) < 0.2, 'and the tone begins where the source says it does')
})

test('a bake is made once, found again by content, and shared by requests that overlap', { skip: SKIP, timeout: 60_000 }, async () => {
  const { dir, baker, runs } = setup('cache')
  const source = synth(FFMPEG, dir, 'a', sineTerm(440, -12), 2)
  const chain = [fx('compressor', { threshold: -20 })]
  const [first, same] = await Promise.all([baker.ensure({ path: source, effects: chain }), baker.ensure({ path: source, effects: chain })])
  assert.ok(first.ok && same.ok)
  assert.equal(first.path, same.path)
  assert.equal(runs(), 1, 'two requests at once are one render')
  assert.match(first.path, /[0-9a-f]{32}\.wav$/)

  const again = await baker.ensure({ path: source, effects: chain })
  assert.ok(again.ok && again.path === first.path)
  assert.equal(runs(), 1, 'a bake that exists is not rendered again')

  // The same bytes under another name are the same bake; the same name with other settings is not.
  const copy = join(dir, 'copy.wav')
  copyFileSync(source, copy)
  const copied = await baker.ensure({ path: copy, effects: [{ ...chain[0]!, id: 'another-id' }] })
  assert.ok(copied.ok && copied.path === first.path, 'named by content and settings, not by path or effect id')
  const other = await baker.ensure({ path: source, effects: [fx('compressor', { threshold: -21 })] })
  assert.ok(other.ok && other.path !== first.path)
  assert.equal(runs(), 2)
  assert.deepEqual(readdirSync(join(dir, 'bakes')).filter((n) => n.endsWith('.part')), [], 'nothing half-written is left')
})

test('a bake is refused, with what to do, for a path bay may not read and for effects that are not effects', { skip: SKIP, timeout: 60_000 }, async () => {
  const { dir, baker, runs } = setup('refuse')
  const allowed = synth(FFMPEG, dir, 'ok', sineTerm(440, -12), 1)
  const forbidden = join(dir, 'forbidden.wav')
  copyFileSync(allowed, forbidden)
  const chain = [fx('gate')]

  const no = await baker.ensure({ path: forbidden, effects: chain })
  assert.ok(!no.ok)
  assert.match(no.error, /may not read .*forbidden\.wav.*Import the file first/)
  assert.equal(runs(), 0, 'nothing was run for it')
  const yes = await baker.ensure({ path: allowed, effects: chain })
  assert.ok(yes.ok, 'the same request for a path bay may read is rendered')

  const bad = await baker.ensure({ path: allowed, effects: [{ id: 'x', kind: 'compressor', params: { ratio: 99 } }] })
  assert.ok(!bad.ok)
  assert.match(bad.error, /compressor\.ratio must be 1 to 20/)
  // A filter string in place of an effect is not run: the graph is only ever built from checked effects.
  const injected = await baker.ensure({ path: allowed, effects: [{ id: 'x', kind: 'volume=0[out];amovie=/etc/passwd' as never, params: {} }] })
  assert.ok(!injected.ok)
  assert.match(injected.error, /Unknown effect kind/)
  const idle = await baker.ensure({ path: allowed, effects: [fx('compressor', { ratio: 1 })] })
  assert.ok(!idle.ok)
  assert.match(idle.error, /nothing to bake/)
})

test('a bake that fails leaves nothing behind and says which file', { skip: SKIP, timeout: 60_000 }, async () => {
  const { dir, baker } = setup('fail')
  const notAudio = join(dir, 'broken.wav')
  writeFileSync(notAudio, 'this is not a wav file')
  const result = await baker.ensure({ path: notAudio, effects: [fx('gate')] })
  assert.ok(!result.ok)
  assert.match(result.error, /The sound of .*broken\.wav could not be processed/)
  assert.deepEqual(existsSync(join(dir, 'bakes')) ? readdirSync(join(dir, 'bakes')) : [], [])
})

test('the sweep removes old bakes past the cap, oldest first, and never one in use or a file that is not a bake', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-afx-sweep-'))
  const name = (letter: string, ext = 'wav'): string => `${letter.repeat(32)}.${ext}`
  const put = (file: string, bytes: number, ageSeconds: number): string => {
    const path = join(dir, file)
    writeFileSync(path, Buffer.alloc(bytes))
    const when = new Date(Date.now() - ageSeconds * 1000)
    utimesSync(path, when, when)
    return path
  }
  const oldest = put(name('a'), 1000, 400)
  const inUse = put(name('b'), 1000, 300)
  const newer = put(name('c'), 1000, 200)
  const newest = put(name('d'), 1000, 100)
  const crashed = put(name('e', 'part'), 500, 50)
  const foreign = put('notes.wav', 5000, 999)
  const foreignHex = put(`${'f'.repeat(31)}.wav`, 5000, 999)

  // 4000 bytes of bakes against a cap of 2000: two must go, and `b` may not be one of them.
  const removed = await sweepBakes(dir, 2000, new Set(['b'.repeat(32)]))
  assert.deepEqual(removed.sort(), [oldest, newer, crashed].sort())
  assert.ok(existsSync(inUse) && existsSync(newest))
  assert.ok(existsSync(foreign) && existsSync(foreignHex), 'a file without a bake’s name is not bay’s to delete')
  assert.ok(statSync(newest).size === 1000)

  // Under the cap nothing is removed.
  assert.deepEqual(await sweepBakes(dir, 2000, new Set()), [])
})

test('the bake reads only the audio and writes 24-bit PCM at the export’s rate', () => {
  const args = bakeArgs('/in.mov', [fx('compressor')], '/out.part')
  assert.equal(args[args.indexOf('-c:a') + 1], 'pcm_s24le')
  assert.equal(args[args.indexOf('-map') + 1], '[out]')
  assert.match(args[args.indexOf('-filter_complex') + 1]!, /^\[0:a\]aresample=48000:async=1:first_pts=0,acompressor=/)
  assert.equal(args[args.length - 1], '/out.part')
})
