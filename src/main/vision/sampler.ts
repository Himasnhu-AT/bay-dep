/**
 * Frames for the index: bay's ffmpeg decodes, keeps one frame per interval, squashes it to
 * 224×224 RGB and writes the bytes to stdout; each kept frame's source time comes from `showinfo`
 * on stderr, in the same order.
 *
 * Two passes are possible and only one runs. Keyframes alone are decoded when the file's
 * keyframes are close enough together (`needsFullDecode`, from ffprobe's packet list, which reads
 * no pixels); otherwise every frame is decoded. Measured on five minutes of 1080p H.264 (2 s GOP):
 * 0.78 s keyframes-only against 6.47 s decoding every frame, 150 frames either way;
 * VideoToolbox decoding was slower still (16.99 s), because each frame is copied back from the GPU
 * to be scaled.
 *
 * No Electron import; the tests run it against the vendored ffmpeg.
 */

import { spawn } from 'node:child_process'
import { IMAGE_SIZE, needsFullDecode, sampleFilter, SAMPLE_INTERVAL_US } from '@shared/visual-search'
import { run } from '../ffmpeg/ffmpeg'

export const FRAME_BYTES = IMAGE_SIZE * IMAGE_SIZE * 3

export interface SampledFrame {
  us: number
  rgb: Uint8Array
}

export interface SampleOptions {
  ffmpeg: string
  ffprobe: string
  kind: 'video' | 'image'
  durationUs: number
  intervalUs?: number
  signal?: AbortSignal
}

/** ffprobe's keyframe times, from packets alone (no decode). Empty when there are none or it failed. */
export async function keyframeTimesUs(ffprobe: string, path: string): Promise<number[]> {
  try {
    const { stdout } = await run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', path])
    return parseKeyframes(stdout)
  } catch {
    return []
  }
}

/** `0.000000,K__` lines → keyframe times in µs, ascending. */
export function parseKeyframes(csv: string): number[] {
  const out: number[] = []
  for (const line of csv.split('\n')) {
    const [time, flags] = line.trim().split(',')
    if (!flags?.includes('K')) continue
    const seconds = Number(time)
    if (Number.isFinite(seconds)) out.push(Math.round(seconds * 1_000_000))
  }
  return out.sort((a, b) => a - b)
}

/** The keyframes a keyframes-only pass would keep: the same "≥ one interval after the last" rule as the filter. */
export function keptKeyframes(keyframesUs: readonly number[], intervalUs: number = SAMPLE_INTERVAL_US): number[] {
  const kept: number[] = []
  for (const t of keyframesUs) if (kept.length === 0 || t - kept[kept.length - 1]! >= intervalUs) kept.push(t)
  return kept
}

export function sampleArgs(path: string, keyframesOnly: boolean, intervalUs: number = SAMPLE_INTERVAL_US): string[] {
  return [
    '-nostdin', '-hide_banner', '-nostats', '-loglevel', 'info',
    ...(keyframesOnly ? ['-skip_frame', 'nokey'] : []),
    '-i', path,
    '-map', '0:v:0', '-an', '-sn', '-dn',
    '-vf', sampleFilter(intervalUs),
    '-fps_mode', 'passthrough',
    '-f', 'rawvideo', '-'
  ]
}

/** `showinfo`'s `pts_time:` for one line, in µs; null for any other line. */
export function showinfoTimeUs(line: string): number | null {
  if (!line.includes('Parsed_showinfo')) return null
  const match = /\bpts_time:\s*(-?[\d.]+(?:e-?\d+)?)/.exec(line)
  if (!match) return null
  const seconds = Number(match[1])
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1_000_000)) : null
}

/**
 * Every kept frame of `path`, in order, as it is decoded. Backpressure is the consumer's: the
 * next frame is not read until the previous one's `yield` returns, so a slow embed pauses ffmpeg
 * rather than buffering an hour of frames in memory.
 */
export async function* sampleFrames(path: string, options: SampleOptions): AsyncGenerator<SampledFrame> {
  const intervalUs = options.intervalUs ?? SAMPLE_INTERVAL_US
  let keyframesOnly = false
  if (options.kind === 'video') {
    const kept = keptKeyframes(await keyframeTimesUs(options.ffprobe, path), intervalUs)
    keyframesOnly = !needsFullDecode(kept, options.durationUs, intervalUs)
  }
  if (options.signal?.aborted) return

  const child = spawn(options.ffmpeg, sampleArgs(path, keyframesOnly, intervalUs), { stdio: ['ignore', 'pipe', 'pipe'] })
  const abort = (): void => {
    child.kill('SIGKILL')
  }
  options.signal?.addEventListener('abort', abort, { once: true })

  const times: number[] = []
  let stderrTail = ''
  let partial = ''
  let stderrEnded = false
  child.stderr.setEncoding('utf8')
  child.stderr.on('end', () => {
    const us = showinfoTimeUs(partial)
    if (us !== null) times.push(us)
    stderrEnded = true
  })
  child.stderr.on('data', (chunk: string) => {
    const lines = (partial + chunk).split('\n')
    partial = lines.pop() ?? ''
    for (const line of lines) {
      const us = showinfoTimeUs(line)
      if (us !== null) times.push(us)
      else if (line.trim()) stderrTail = (stderrTail + line + '\n').slice(-2000)
    }
  })
  const exited = new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code))
    child.on('error', () => resolve(-1))
  })

  let pending: Buffer = Buffer.alloc(0)
  let index = 0
  try {
    for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
      while (pending.length >= FRAME_BYTES) {
        const rgb = new Uint8Array(pending.subarray(0, FRAME_BYTES))
        pending = pending.subarray(FRAME_BYTES)
        // stderr and stdout are separate pipes: a frame can arrive before its showinfo line.
        // Wait for the line rather than guess the time — a frame at the wrong time is a hit that
        // points somewhere else.
        while (times.length <= index && !stderrEnded && !options.signal?.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
        const us = times[index]
        if (us === undefined) throw new Error(`ffmpeg did not report the time of frame ${index} of ${path}.`)
        index += 1
        yield { us, rgb }
      }
    }
    const code = await exited
    if (options.signal?.aborted) return
    if (code !== 0) throw new Error(`ffmpeg could not read ${path}: ${stderrTail.trim().split('\n').slice(-2).join(' ') || `exit ${code}`}`)
    if (index === 0) throw new Error(`${path} has no picture to index.`)
  } finally {
    options.signal?.removeEventListener('abort', abort)
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}
