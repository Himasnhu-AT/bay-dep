/**
 * Audio measurements for the speech tools — levels over time, silences, loudness — each over a
 * span of *source* time, run through bay's own ffmpeg.
 *
 * - `audioLevels`: RMS per window, in dBFS. ffmpeg decodes mono s16le at 8 kHz (the same decode
 *   `waveform.ts` makes for peaks) and the stream is reduced as it arrives, so an hour of audio is
 *   never held: 8 kHz × 2 bytes is 57 MB an hour, and only one number per window is kept.
 *   `switch_speakers` asks for 50 ms windows (podclip's rate), `sync_angles` for 10 ms.
 * - `detectSilences`: ffmpeg's `silencedetect`, printed to stdout by `ametadata` — stdout rather
 *   than silencedetect's log lines because `run` keeps only the tail of stderr, and a long file's
 *   early silences would fall off the front of it (the same reason `scene-cuts.ts` uses stdout).
 * - `measureLoudness`: `ebur128` integrated loudness of the span, read from its summary with the
 *   parser mastering already uses.
 *
 * Every span is seeked with `-ss` before `-i`, and ffmpeg then reports times from the seek point:
 * measured on the vendored build, a silence at 1–2 s of a file read with `-ss 0.5` is reported at
 * 0.50–1.50. So every time these functions return is seconds from the *span's* start.
 *
 * Pure Node — no Electron — so the reductions and the real binary run under `pnpm test`.
 */

import { spawn } from 'node:child_process'
import { parseEbur128Summary } from '@shared/loudness'
import type { AudioSpan, SilenceInterval } from '@shared/ipc'
import { ffmpegBin, MediaToolError, run } from '../ffmpeg/ffmpeg'
import { withSlot } from './queue'

/** The decode rate for levels. Voice energy is well inside 4 kHz, and it is what the waveform uses. */
export const LEVEL_SAMPLE_RATE = 8000

/** What a window of digital silence reads, instead of `-Infinity` (podclip's floor too). */
export const SILENCE_FLOOR_DB = -120

/** Longest an analysis may run before it is stopped: an hour-long file decodes in well under this. */
const ANALYSIS_TIMEOUT_MS = 10 * 60_000

const seconds = (us: number): string => (Math.max(0, us) / 1_000_000).toFixed(6)

/** `-ss start -t duration -i path`, audio only: the span every analysis reads. */
export function spanInput(path: string, span: AudioSpan): string[] {
  const args = ['-nostdin', '-v', 'error']
  if (span.startUs > 0) args.push('-ss', seconds(span.startUs))
  if (Number.isFinite(span.durationUs) && span.durationUs > 0) args.push('-t', seconds(span.durationUs))
  args.push('-i', path, '-vn', '-sn', '-dn', '-map', '0:a:0')
  return args
}

export function levelArgs(path: string, span: AudioSpan): string[] {
  return [...spanInput(path, span), '-ac', '1', '-ar', String(LEVEL_SAMPLE_RATE), '-f', 's16le', '-']
}

/**
 * Streamed s16le → one RMS dB per window. Windows are fractional in samples — window k covers
 * samples [⌊k·w⌋, ⌊(k+1)·w⌋) — so a window of 51.5 ms (50 ms of a clip at 1.03×) does not round
 * to a whole sample count and drift by seconds over an hour. A trailing partial window is kept
 * only when at least half full: a sliver of a window is not a measurement.
 */
export class RmsWindows {
  readonly #perWindow: number
  readonly #out: number[] = []
  #carry: number | null = null
  #index = 0
  #sum = 0
  #count = 0
  #boundary: number

  constructor(samplesPerWindow: number) {
    if (!(samplesPerWindow >= 1)) throw new Error(`A window must hold at least one sample, not ${samplesPerWindow}.`)
    this.#perWindow = samplesPerWindow
    this.#boundary = Math.floor(samplesPerWindow)
  }

  push(chunk: Buffer): void {
    let offset = 0
    if (this.#carry !== null && chunk.length > 0) {
      const joined = Buffer.from([this.#carry, chunk[0]!])
      this.#sample(joined.readInt16LE(0))
      this.#carry = null
      offset = 1
    }
    for (; offset + 1 < chunk.length; offset += 2) this.#sample(chunk.readInt16LE(offset))
    if (offset < chunk.length) this.#carry = chunk[offset]!
  }

  #sample(value: number): void {
    const x = value / 32768
    this.#sum += x * x
    this.#count += 1
    this.#index += 1
    if (this.#index >= this.#boundary) this.#close()
  }

  #close(): void {
    this.#out.push(toDb(this.#count > 0 ? Math.sqrt(this.#sum / this.#count) : 0))
    this.#sum = 0
    this.#count = 0
    this.#boundary = Math.floor((this.#out.length + 1) * this.#perWindow)
  }

  finish(): number[] {
    if (this.#count >= this.#perWindow / 2) this.#close()
    return this.#out
  }
}

export function toDb(rms: number): number {
  if (!(rms > 0)) return SILENCE_FLOOR_DB
  return Math.max(SILENCE_FLOOR_DB, Math.round(20 * Math.log10(rms) * 100) / 100)
}

/** RMS dBFS per `windowUs` of source, from `span.startUs`. Index k starts k·windowUs into the span. */
export async function audioLevels(path: string, span: AudioSpan, windowUs: number): Promise<number[]> {
  if (!(windowUs >= 1000)) throw new Error(`A level window must be at least 1 ms, not ${windowUs} µs.`)
  const reducer = new RmsWindows((windowUs / 1_000_000) * LEVEL_SAMPLE_RATE)
  const bin = ffmpegBin()
  await withSlot(
    () =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(bin, levelArgs(path, span), { stdio: ['ignore', 'pipe', 'pipe'] })
        let stderr = ''
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          reject(new Error(`Reading the audio levels of ${path} ran past ${ANALYSIS_TIMEOUT_MS / 60_000} minutes and was stopped.`))
        }, ANALYSIS_TIMEOUT_MS)
        child.stdout.on('data', (chunk: Buffer) => reducer.push(chunk))
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (chunk: string) => {
          stderr = (stderr + chunk).slice(-4096)
        })
        child.on('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          if (code === 0) resolve()
          else reject(new MediaToolError(bin, code, stderr.trim()))
        })
      })
  )
  return reducer.finish()
}

/** The silencedetect graph. Its filter names are asked of the vendored binary by `capabilities.test.ts`. */
export function silenceFilter(thresholdDb: number, minSilenceSec: number): string {
  const noise = Math.max(-90, Math.min(0, thresholdDb))
  const d = Math.max(0.01, minSilenceSec)
  return `silencedetect=noise=${noise}dB:d=${d},ametadata=mode=print:file=-`
}

export function silenceArgs(path: string, span: AudioSpan, thresholdDb: number, minSilenceSec: number): string[] {
  return [...spanInput(path, span), '-af', silenceFilter(thresholdDb, minSilenceSec), '-f', 'null', '-']
}

/**
 * `ametadata=print` output → silences, in seconds from the span's start. A silence still open at
 * the end (the span ends quiet) closes at `durationSec`; a stray end with no start opens at 0,
 * which is what silencedetect means when the span *starts* quiet on some builds.
 */
export function parseSilences(stdout: string, durationSec: number): SilenceInterval[] {
  const out: SilenceInterval[] = []
  let open: number | null = null
  for (const line of stdout.split('\n')) {
    const match = /^lavfi\.silence_(start|end)=(-?[\d.]+)/.exec(line.trim())
    if (!match) continue
    const at = Number(match[2])
    if (!Number.isFinite(at)) continue
    if (match[1] === 'start') {
      open = at
    } else {
      out.push({ startSec: Math.max(0, open ?? 0), endSec: at })
      open = null
    }
  }
  if (open !== null && Number.isFinite(durationSec) && durationSec > open) out.push({ startSec: Math.max(0, open), endSec: durationSec })
  return out
    .map((s) => ({ startSec: round3(s.startSec), endSec: round3(Math.min(s.endSec, Number.isFinite(durationSec) ? durationSec : s.endSec)) }))
    .filter((s) => s.endSec > s.startSec)
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000

export async function detectSilences(
  path: string,
  span: AudioSpan,
  thresholdDb: number,
  minSilenceSec: number
): Promise<SilenceInterval[]> {
  const { stdout } = await withSlot(() =>
    run(ffmpegBin(), silenceArgs(path, span, thresholdDb, minSilenceSec), undefined, { timeoutMs: ANALYSIS_TIMEOUT_MS })
  )
  return parseSilences(stdout, span.durationUs / 1_000_000)
}

/** The loudness graph: true peak on, because the summary parser reads both numbers. */
export const LOUDNESS_FILTER = 'ebur128=peak=true:framelog=verbose'

export async function measureLoudness(path: string, span: AudioSpan): Promise<{ integratedLufs: number; truePeakDb: number }> {
  const args = [...spanInput(path, span), '-af', LOUDNESS_FILTER, '-f', 'null', '-']
  // `-v error` would hide the summary, which ebur128 prints at info level.
  args[2] = 'info'
  const stderr = await withSlot(
    () =>
      new Promise<string>((resolve, reject) => {
        const bin = ffmpegBin()
        const child = spawn(bin, ['-hide_banner', '-nostats', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
        let text = ''
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          reject(new Error(`Measuring the loudness of ${path} ran past ${ANALYSIS_TIMEOUT_MS / 60_000} minutes and was stopped.`))
        }, ANALYSIS_TIMEOUT_MS)
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (chunk: string) => {
          text += chunk
          if (text.length > 65536) text = text.slice(-32768)
        })
        child.on('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          if (code === 0) resolve(text)
          else reject(new MediaToolError(bin, code, text.slice(-4096).trim()))
        })
      })
  )
  const measured = parseEbur128Summary(stderr)
  if (!measured) throw new Error(`ebur128 printed no loudness summary for ${path}.`)
  return measured
}
