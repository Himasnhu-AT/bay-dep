/**
 * Loudness mastering of an export's audio: the closed loop, run through ffmpeg.
 *
 * Pure of Electron on purpose — `encode.ts` imports it and cannot itself load under `pnpm test` —
 * so `master.test.ts` drives this with the ffmpeg bay ships and measures what comes out. The
 * arithmetic of each step lives in `@shared/loudness`; this file only runs passes.
 *
 * The shape: measure the unmastered PCM mix, then repeatedly apply
 * `volume → 4× oversample → alimiter → back to 48 kHz`, **encode with the export's own codec**,
 * and measure the encoded file with `ebur128=peak=true`. The encoded file is what the loop
 * judges because the codec moves the peaks (AAC by ~0.8 dB); a limiter verified on PCM is a
 * ceiling on a file nobody receives.
 */

import { spawn } from 'node:child_process'
import {
  MAX_MASTER_PASSES,
  SILENCE_LUFS,
  firstPass,
  loudnessSummary,
  meetsTarget,
  nextPass,
  parseEbur128Summary,
  type LoudnessMeasurement,
  type LoudnessReport,
  type LoudnessTarget,
  type MasterSettings
} from '@shared/loudness'
import { tailOf } from './codec-args'

function run(ffmpeg: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, [...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      // Bounded, keeping the end: the summary ebur128 prints is the last thing on stderr.
      if (stderr.length > 65536) stderr = stderr.slice(-32768)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stderr)
      else reject(new Error(`ffmpeg exited ${code}: ${tailOf(stderr)}`))
    })
  })
}

/** Integrated loudness and true peak of `path`'s first audio stream. */
export async function measureLoudness(ffmpeg: string, path: string): Promise<LoudnessMeasurement> {
  const stderr = await run(ffmpeg, [
    '-nostdin',
    '-hide_banner',
    '-nostats',
    '-i',
    path,
    '-map',
    '0:a:0',
    '-af',
    // Per-frame lines at verbose, so only the summary reaches stderr at the default level: a
    // ten-minute export would otherwise print six thousand lines to find one block.
    'ebur128=peak=true:framelog=verbose',
    '-f',
    'null',
    '-'
  ])
  const measured = parseEbur128Summary(stderr)
  if (!measured) throw new Error(`ebur128 printed no summary for ${path}: ${tailOf(stderr)}`)
  return measured
}

/**
 * The mastering chain for one pass. The limiter runs at 192 kHz — 4× the output rate — so the
 * inter-sample peaks a true-peak meter reconstructs are samples it can see; at 48 kHz it would
 * hold sample peaks under the ceiling and let the true peak through. `latency=1` removes the
 * limiter's lookahead delay, without which every mastered export's sound would sit `attack`
 * milliseconds behind its picture. `level=false`: its auto-level would undo the gain.
 */
export function masterFilter(settings: MasterSettings): string {
  const limit = 10 ** (settings.limiterCeilingDb / 20)
  return [
    `volume=${settings.gainDb.toFixed(3)}dB`,
    'aresample=192000',
    `alimiter=limit=${limit.toFixed(5)}:attack=3:release=80:level=false:latency=1`,
    'aresample=48000'
  ].join(',')
}

export interface MasterRequest {
  ffmpeg: string
  /** The unmastered mix, PCM. */
  input: string
  /** Where the encoded, mastered audio is written. Overwritten on each pass. */
  output: string
  /** The export's audio codec arguments, so the loop measures the codec that ships. */
  codecArgs: readonly string[]
  target: LoudnessTarget
  /** Extra output arguments, such as `-vn` or a container flag. */
  outputArgs?: readonly string[]
}

/**
 * Masters `input` into `output` and reports what the encoded file measures.
 *
 * Returns rather than throws on a loop that does not converge: the file exists at the level it
 * reached, and the report says so in numbers. Throws only when ffmpeg itself fails.
 */
export async function masterAudio(request: MasterRequest): Promise<LoudnessReport> {
  const { ffmpeg, input, output, codecArgs, target } = request
  const before = await measureLoudness(ffmpeg, input)

  const encode = (settings: MasterSettings): Promise<string> =>
    run(ffmpeg, [
      '-nostdin',
      '-v',
      'error',
      '-i',
      input,
      '-af',
      masterFilter(settings),
      '-ar',
      '48000',
      ...codecArgs,
      ...(request.outputArgs ?? []),
      '-y',
      output
    ])

  if (!(before.integratedLufs > SILENCE_LUFS)) {
    // Silence: deliver it as it is, encoded, rather than applying a gain computed from a
    // floor value — +56 dB of noise floor is not mastering.
    const settings = { gainDb: 0, limiterCeilingDb: target.truePeakDb }
    await encode(settings)
    const partial = {
      status: 'silent' as const,
      target,
      measured: null,
      before,
      gainDb: 0,
      limiterCeilingDb: settings.limiterCeilingDb,
      passes: 0
    }
    return { ...partial, summary: loudnessSummary(partial) }
  }

  let settings = firstPass(target, before)
  let measured: LoudnessMeasurement = before
  let passes = 0
  while (passes < MAX_MASTER_PASSES) {
    await encode(settings)
    measured = await measureLoudness(ffmpeg, output)
    passes += 1
    const step = nextPass(target, settings, measured)
    if (step.done) break
    if (passes === MAX_MASTER_PASSES) break
    settings = step.next
  }

  const partial = {
    status: meetsTarget(target, measured) ? ('met' as const) : ('missed' as const),
    target,
    measured,
    before,
    gainDb: settings.gainDb,
    limiterCeilingDb: settings.limiterCeilingDb,
    passes
  }
  return { ...partial, summary: loudnessSummary(partial) }
}

/**
 * Re-measures the file actually delivered and restates the report from it.
 *
 * The loop measured its own encode; the export then muxes that stream into the container with
 * `-c:a copy`. A copy should change nothing, and this is what makes "should" a measurement —
 * the report the agent reads is about the file at `path`, not about a scratch file that was
 * deleted.
 */
export async function verifyDelivered(
  ffmpeg: string,
  path: string,
  report: LoudnessReport
): Promise<LoudnessReport> {
  if (report.status === 'silent') return report
  const measured = await measureLoudness(ffmpeg, path)
  const partial = {
    ...report,
    measured,
    status: meetsTarget(report.target, measured) ? ('met' as const) : ('missed' as const)
  }
  return { ...partial, summary: loudnessSummary(partial) }
}
