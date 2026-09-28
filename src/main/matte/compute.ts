/**
 * One subject matte, computed: bay's ffmpeg decodes the source range to RGBA at most 960 px on
 * the long edge, each frame goes to the matte engine (Apple Vision, `vision-jxa.ts`), the masks
 * are smoothed and quantised (`smooth.ts`) and written to a pack (`pack.ts`).
 *
 * Frame times come from `showinfo` on stderr (a required filter), not from a frame count: a phone
 * clip with a variable frame rate would otherwise drift against the picture it masks. They are
 * absolute source times — `fromUs` plus ffmpeg's `pts_time` after an input seek, which is how the
 * `<video>` element counts too (both from the file's own start).
 *
 * No Electron import: the tests drive it with the vendored ffmpeg and a fake engine.
 */

import { spawn } from 'node:child_process'
import type { SubjectMatteReport } from '@shared/matte'
import { MattePackWriter, type PackIndex } from './pack'
import { MatteSmoother, subjectArea, SUBJECT_MIN_AREA } from './smooth'

/** A decoded frame for the engine. */
export interface RgbaFrame {
  width: number
  height: number
  rgba: Buffer
}

/** The engine's answer: 8-bit alpha, tightly packed, at the engine's own size. */
export interface MaskFrame {
  width: number
  height: number
  alpha: Uint8Array
  /** The engine's own time for this frame, in ms, when it reports one. */
  ms?: number
}

/**
 * What computes a matte from a frame. Apple Vision (`VisionSegmenter`) is the one built. The seam
 * is here so MODNet can be a second engine — `Xenova/modnet@fa2fa54`, Apache-2.0, 25.9 MB, measured
 * ~83 ms/frame on CPU at 896×512 (CoreML was slower, 140 ms) — run in a utility process the way
 * `vision/host.ts` runs SigLIP, for Macs without Vision or as a cross-check. A different engine is
 * a different `id`, so a different pack key.
 */
export interface MatteEngine {
  readonly id: string
  /** The engine's build, recorded in the pack: a macOS update can change Vision's matte. */
  readonly build: string
  start(): Promise<string>
  /** A new clip: forget any temporal state from the last. */
  reset(): void
  segment(frame: RgbaFrame): Promise<MaskFrame>
  stop(): void
}

/** The long edge frames are scaled to before segmentation. Vision's balanced mask is 512×384 however big the input is. */
export const MATTE_INPUT_EDGE = 960

/** Frames sent to the engine and not yet answered. Enough to keep the pipe full, few enough to hold little memory. */
const IN_FLIGHT = 4

export function matteDecodeFilter(edge: number = MATTE_INPUT_EDGE): string {
  return `scale=w=${edge}:h=${edge}:force_original_aspect_ratio=decrease:force_divisible_by=2,format=rgba,showinfo`
}

/**
 * ffmpeg's arguments: an input seek to `fromUs` (accurate — ffmpeg decodes from the keyframe before
 * and drops what precedes it), the range's length, every frame as it is (`passthrough`, no
 * duplicated or dropped frames), raw RGBA on stdout. The path follows `-i`, never bare.
 */
export function matteDecodeArgs(path: string, fromUs: number, toUs: number, edge: number = MATTE_INPUT_EDGE): string[] {
  const seconds = (us: number): string => (Math.max(0, us) / 1_000_000).toFixed(6)
  return [
    '-nostdin', '-hide_banner', '-nostats', '-loglevel', 'info',
    '-ss', seconds(fromUs),
    '-i', path,
    '-t', seconds(Math.max(1, toUs - fromUs)),
    '-map', '0:v:0', '-an', '-sn', '-dn',
    '-vf', matteDecodeFilter(edge),
    '-fps_mode', 'passthrough',
    '-f', 'rawvideo', '-'
  ]
}

/** One `showinfo` frame line: its time after the seek (µs) and the frame's size. Null for any other line. */
export function showinfoFrame(line: string): { us: number; width: number; height: number } | null {
  if (!line.includes('Parsed_showinfo') || !line.includes(' n:')) return null
  const time = /\bpts_time:\s*(-?[\d.]+(?:e-?\d+)?)/.exec(line)
  const size = /\bs:(\d+)x(\d+)/.exec(line)
  if (!time || !size) return null
  const seconds = Number(time[1])
  if (!Number.isFinite(seconds)) return null
  return { us: Math.round(seconds * 1_000_000), width: Number(size[1]), height: Number(size[2]) }
}

export interface ComputeOptions {
  ffmpeg: string
  path: string
  fromUs: number
  toUs: number
  engine: MatteEngine
  /** Where the finished pack goes (`<key>.bmat`); written as `.part` first. */
  outPath: string
  signal?: AbortSignal
  edge?: number
}

export interface ComputeResult {
  index: PackIndex
  bytes: number
  report: SubjectMatteReport
}

export class MatteCancelledError extends Error {}
export class NoPictureError extends Error {}

/** Median and 90th percentile of a list of times. */
function percentiles(values: number[]): { median: number; p90: number } {
  if (values.length === 0) return { median: 0, p90: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  return { median: sorted[Math.floor(sorted.length / 2)]!, p90: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]! }
}

const round2 = (n: number): number => Math.round(n * 100) / 100

export async function computeSubjectMatte(options: ComputeOptions): Promise<ComputeResult> {
  const started = Date.now()
  const { engine, signal } = options
  const build = await engine.start()
  engine.reset()
  if (signal?.aborted) throw new MatteCancelledError('The subject matte was cancelled.')

  const writer = await MattePackWriter.create(options.outPath)
  const child = spawn(options.ffmpeg, matteDecodeArgs(options.path, options.fromUs, options.toUs, options.edge), { stdio: ['ignore', 'pipe', 'pipe'] })
  let aborted = false
  const abort = (): void => {
    aborted = true
    child.kill('SIGKILL')
    engine.stop()
  }
  signal?.addEventListener('abort', abort, { once: true })

  // stderr and stdout are separate pipes: a frame's bytes can arrive before its showinfo line.
  const infos: { us: number; width: number; height: number }[] = []
  let stderrTail = ''
  let partial = ''
  let stderrEnded = false
  const infoArrived: (() => void)[] = []
  const wake = (): void => {
    for (const resolve of infoArrived.splice(0)) resolve()
  }
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    const lines = (partial + chunk).split('\n')
    partial = lines.pop() ?? ''
    for (const line of lines) {
      const info = showinfoFrame(line)
      if (info) infos.push(info)
      else if (line.trim() && !line.includes('Parsed_showinfo')) stderrTail = (stderrTail + line + '\n').slice(-2000)
    }
    wake()
  })
  child.stderr.on('end', () => {
    const info = showinfoFrame(partial)
    if (info) infos.push(info)
    stderrEnded = true
    wake()
  })
  const exited = new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code))
    child.on('error', () => resolve(-1))
  })

  const smoother = new MatteSmoother()
  const visionMs: number[] = []
  let withSubject = 0
  let areaSum = 0
  let masks = 0
  let maskWidth = 0
  let maskHeight = 0
  const writeSmoothed = async (frame: { ptsUs: number; alpha: Uint8Array } | null): Promise<void> => {
    if (!frame) return
    await writer.append(frame.ptsUs, maskWidth, maskHeight, frame.alpha)
  }

  // In flight: frames sent to the engine, answered in order.
  const inFlight: { ptsUs: number; answer: Promise<MaskFrame> }[] = []
  const settleOne = async (): Promise<void> => {
    const next = inFlight.shift()
    if (!next) return
    const mask = await next.answer
    if (masks === 0) {
      maskWidth = mask.width
      maskHeight = mask.height
    }
    masks += 1
    if (typeof mask.ms === 'number' && Number.isFinite(mask.ms)) visionMs.push(mask.ms)
    const area = subjectArea(mask.alpha)
    if (area >= SUBJECT_MIN_AREA) {
      withSubject += 1
      areaSum += area
    }
    await writeSmoothed(smoother.push({ ptsUs: next.ptsUs, alpha: mask.alpha }))
  }

  try {
    let pending: Buffer = Buffer.alloc(0)
    let index = 0
    for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
      for (;;) {
        if (pending.length === 0) break
        // Each frame's size is on its showinfo line, which may still be on its way.
        while (infos.length <= index && !stderrEnded && !aborted) {
          await new Promise<void>((resolve) => infoArrived.push(resolve))
        }
        if (aborted) throw new MatteCancelledError('The subject matte was cancelled.')
        const info = infos[index]
        if (!info) throw new Error(`ffmpeg did not report the time of frame ${index} of ${options.path}.`)
        const bytes = info.width * info.height * 4
        if (pending.length < bytes) break
        const rgba = Buffer.from(pending.subarray(0, bytes))
        pending = pending.subarray(bytes)
        index += 1
        inFlight.push({ ptsUs: options.fromUs + info.us, answer: engine.segment({ width: info.width, height: info.height, rgba }) })
        // Keep the pipe full without buffering a clip's worth of frames: backpressure is ffmpeg
        // waiting on stdout while the engine catches up.
        while (inFlight.length >= IN_FLIGHT) await settleOne()
      }
    }
    while (inFlight.length > 0) await settleOne()
    await writeSmoothed(smoother.flush())
    const code = await exited
    if (aborted) throw new MatteCancelledError('The subject matte was cancelled.')
    if (code !== 0) {
      throw new Error(`ffmpeg could not read ${options.path}: ${stderrTail.trim().split('\n').slice(-2).join(' ') || `exit ${code}`}`)
    }
    if (writer.frames === 0) {
      throw new NoPictureError(`${options.path} has no picture between ${(options.fromUs / 1e6).toFixed(2)} s and ${(options.toUs / 1e6).toFixed(2)} s.`)
    }
    const seconds = (Date.now() - started) / 1000
    const vision = percentiles(visionMs)
    const report = {
      frames: writer.frames,
      coverage: round2(withSubject / Math.max(1, masks)),
      meanArea: round2(withSubject > 0 ? areaSum / withSubject : 0),
      msPerFrame: round2((seconds * 1000) / Math.max(1, writer.frames)),
      visionMsMedian: round2(vision.median),
      visionMsP90: round2(vision.p90),
      engineBuild: build,
      seconds: round2(seconds)
    }
    const { bytes, index: packIndex } = await writer.finish({
      engine: engine.id,
      engineBuild: build,
      fromUs: options.fromUs,
      toUs: options.toUs,
      report
    })
    return { index: packIndex, bytes, report: { ...report, cached: false, bytes, megabytesPerMinute: megabytesPerMinute(bytes, packIndex) } }
  } catch (error) {
    await writer.abort()
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
    if (child.exitCode === null) child.kill('SIGKILL')
    // Answers still owed by the engine are dropped; the promises must not surface as unhandled.
    for (const flight of inFlight) flight.answer.catch(() => {})
  }
}

/**
 * The pack's size scaled to one minute of its own footage, from its frame times. The measured
 * figure the research asked for; 0 for a pack too short to have a rate.
 */
export function megabytesPerMinute(bytes: number, index: Pick<PackIndex, 'frames'>): number {
  const frames = index.frames
  if (frames.length < 2) return 0
  const spanUs = frames[frames.length - 1]![0] - frames[0]![0]
  if (!(spanUs > 0)) return 0
  const perFrameUs = spanUs / (frames.length - 1)
  const framesPerMinute = 60_000_000 / perFrameUs
  return round2(((bytes / frames.length) * framesPerMinute) / (1024 * 1024))
}
