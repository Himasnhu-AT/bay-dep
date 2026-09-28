/**
 * Apple Vision person segmentation, reached with no native addon and no new binary: one long-lived
 * `osascript -l JavaScript` process, whose JXA bridge calls `VNGeneratePersonSegmentationRequest`.
 *
 * Measured on this Mac (macOS 26.6.2, M-series), frames streamed at 960×540 RGBA:
 *
 * - **Vision's own time is ~9 ms per frame at `.balanced`** (median 8.8, p90 10.3 over a 246-frame
 *   1080p clip); the whole pipe — ffmpeg decode and scale, 2 MB over stdin, Vision, the mask back —
 *   is ~11 ms per frame of wall time, after a ~0.3 s start. The audit's 31 ms was one image per
 *   run *including* a PNG decode from disk; streaming raw frames into one process is what removes
 *   it. Full-HD input costs 25 ms of wall time for the same 512×384 mask, so input is capped at 960.
 * - **The mask is 4:3 whatever the frame is** (512×384 for a 16:9 frame): Vision scales the whole
 *   frame non-uniformly. The pack stores it as it comes, and the compositor stretches it over the
 *   source's own pixel rect — the matte covers exactly the frame, so the stretch is the mapping.
 *   Checked by overlaying a mask on its frame: the silhouettes land on the people.
 * - Reused through one `VNSequenceRequestHandler` per job, so Vision's own temporal smoothing runs
 *   across the frames of a clip; `reset()` starts a new sequence for the next clip.
 *
 * The protocol is binary on stdin/stdout, in order, with fixed 32-byte ASCII headers (JXA reads
 * exact byte counts with `readDataOfLength`, which a line protocol would have to do byte by byte):
 *
 *     → `F <w> <h>` + w·h·4 bytes RGBA       ← `M <mw> <mh> <rowBytes> <ms>` + rowBytes·mh bytes
 *     → `S` (new sequence)                    ← nothing
 *                                             ← `E <n>` + n bytes UTF-8, for a frame that failed
 *     at start:                               ← `R <n>` + n bytes: the OS version, or `X <n>` + why not
 *
 * This is the *engine* seam (`MatteEngine` in `compute.ts`). MODNet (Apache-2.0,
 * `Xenova/modnet@fa2fa54`, measured ~83 ms/frame on CPU at 896×512) would be a second engine
 * behind the same interface, run in a utility process the way `vision/host.ts` runs SigLIP — not
 * built in this slice.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { MATTE_ENGINE_VISION } from '@shared/matte'
import type { MaskFrame, MatteEngine, RgbaFrame } from './compute'

const HEADER = 32

/** The JXA program. `run` reads frames until stdin closes; everything moves as NSData, never per pixel in JS. */
export const VISION_JXA = String.raw`
ObjC.import('Foundation'); ObjC.import('CoreVideo'); ObjC.import('CoreImage'); ObjC.import('CoreGraphics'); ObjC.import('Vision')
function run(argv) {
  const inH = $.NSFileHandle.fileHandleWithStandardInput
  const outH = $.NSFileHandle.fileHandleWithStandardOutput
  const enc = $.NSUTF8StringEncoding
  const header = (text) => outH.writeData($(text.padEnd(32, ' ')).dataUsingEncoding(enc))
  const message = (tag, text) => { const d = $(text).dataUsingEncoding(enc); header(tag + ' ' + d.length); outH.writeData(d) }
  const quality = parseInt(argv[0] || '1', 10)
  if (typeof $.VNGeneratePersonSegmentationRequest !== 'function' || typeof $.VNSequenceRequestHandler !== 'function') {
    message('X', 'Apple Vision person segmentation needs macOS 12 or later; this Mac is ' + $.NSProcessInfo.processInfo.operatingSystemVersionString.js)
    return
  }
  message('R', $.NSProcessInfo.processInfo.operatingSystemVersionString.js)
  const cs = $.CGColorSpaceCreateDeviceRGB()
  let seq = $.VNSequenceRequestHandler.alloc.init
  while (true) {
    const hd = inH.readDataOfLength(32)
    if (hd.length < 32) return
    const parts = $.NSString.alloc.initWithDataEncoding(hd, enc).js.trim().split(/\s+/)
    if (parts[0] === 'S') { seq = $.VNSequenceRequestHandler.alloc.init; continue }
    const w = parseInt(parts[1], 10), h = parseInt(parts[2], 10)
    const data = inH.readDataOfLength(w * h * 4)
    if (data.length < w * h * 4) return
    try {
      const t0 = $.NSDate.date
      const image = $.CIImage.imageWithBitmapDataBytesPerRowSizeFormatColorSpace(data, w * 4, $.CGSizeMake(w, h), $.kCIFormatRGBA8, cs)
      const request = $.VNGeneratePersonSegmentationRequest.alloc.init
      request.qualityLevel = quality
      request.outputPixelFormat = 1278226488
      const error = Ref()
      const ok = seq.performRequestsOnCIImageError($([request]), image, error)
      if (!ok || !request.results || request.results.count < 1) {
        message('E', (error[0] && error[0].localizedDescription) ? error[0].localizedDescription.js : 'Vision returned no mask for this frame')
        continue
      }
      const buffer = request.results.objectAtIndex(0).pixelBuffer
      $.CVPixelBufferLockBaseAddress(buffer, 1)
      const mw = $.CVPixelBufferGetWidth(buffer), mh = $.CVPixelBufferGetHeight(buffer), rowBytes = $.CVPixelBufferGetBytesPerRow(buffer)
      const bytes = $.NSData.dataWithBytesLength($.CVPixelBufferGetBaseAddress(buffer), rowBytes * mh)
      $.CVPixelBufferUnlockBaseAddress(buffer, 1)
      header('M ' + mw + ' ' + mh + ' ' + rowBytes + ' ' + (-t0.timeIntervalSinceNow * 1000).toFixed(2))
      outH.writeData(bytes)
    } catch (e) {
      message('E', String(e))
    }
  }
}
`

/** `VNGeneratePersonSegmentationRequest.QualityLevel`: 0 accurate, 1 balanced (Apple's advice for video), 2 fast. */
export const VISION_QUALITY_BALANCED = 1

interface Waiter {
  resolve(frame: MaskFrame): void
  reject(error: Error): void
}

export class VisionUnavailableError extends Error {}

export interface VisionSegmenterOptions {
  /** Injectable for tests; `/usr/bin/osascript` otherwise. */
  osascript?: string
  quality?: number
  /** How long the process may take to answer `R` before it counts as unavailable. */
  startTimeoutMs?: number
}

/**
 * One `osascript` process, started on first use, answering frames in the order they were sent.
 * `stop()` kills it (quit, cancel, idle); the next `segment` starts another.
 */
export class VisionSegmenter implements MatteEngine {
  readonly id = MATTE_ENGINE_VISION
  readonly #osascript: string
  readonly #quality: number
  readonly #startTimeoutMs: number
  #child: ChildProcess | null = null
  #ready: Promise<string> | null = null
  #buffer: Buffer = Buffer.alloc(0)
  #waiters: Waiter[] = []
  #onReady: ((build: string) => void) | null = null
  #onUnavailable: ((why: string) => void) | null = null
  #stderr = ''
  #build = ''

  constructor(options: VisionSegmenterOptions = {}) {
    this.#osascript = options.osascript ?? '/usr/bin/osascript'
    this.#quality = options.quality ?? VISION_QUALITY_BALANCED
    this.#startTimeoutMs = options.startTimeoutMs ?? 20_000
  }

  /** The OS version string Vision is running on, once started. */
  get build(): string {
    return this.#build
  }

  /** Whether a process is running — for tests of the kill-on-quit path. */
  get running(): boolean {
    return this.#child !== null
  }

  /** The child's pid, or null. */
  get pid(): number | null {
    return this.#child?.pid ?? null
  }

  start(): Promise<string> {
    if (this.#ready) return this.#ready
    if (process.platform !== 'darwin') {
      return Promise.reject(new VisionUnavailableError(
        `Subject mattes use Apple Vision, which only macOS has; this is ${process.platform}.`
      ))
    }
    const child = spawn(this.#osascript, ['-l', 'JavaScript', '-e', VISION_JXA, String(this.#quality)], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.#child = child
    this.#buffer = Buffer.alloc(0)
    this.#stderr = ''
    const ready = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new VisionUnavailableError(`Apple Vision did not start within ${Math.round(this.#startTimeoutMs / 1000)} s.`))
        this.stop()
      }, this.#startTimeoutMs)
      this.#onReady = (build) => {
        clearTimeout(timer)
        resolve(build)
      }
      this.#onUnavailable = (why) => {
        clearTimeout(timer)
        reject(new VisionUnavailableError(why))
      }
    })
    child.stdout?.on('data', (chunk: Buffer) => this.#read(chunk))
    child.stderr?.on('data', (chunk: Buffer) => {
      // Kept for the message when the process dies; bounded, since nothing else reads it.
      this.#stderr = (this.#stderr + chunk.toString('utf8')).slice(-4000)
    })
    child.stdin?.on('error', () => {
      // EPIPE after the process died: the exit handler reports it.
    })
    child.on('error', (error) => {
      this.#fail(new VisionUnavailableError(`Could not start ${this.#osascript} for Apple Vision: ${error.message}`), child)
    })
    child.on('exit', (code, signal) => {
      const why = this.#stderr.trim()
      this.#fail(
        new Error(`The Apple Vision process stopped (${signal ?? `exit ${code}`})${why ? `: ${why.split('\n').slice(-3).join(' ')}` : ''}.`),
        child
      )
    })
    this.#ready = ready.then((build) => {
      this.#build = build
      return build
    })
    this.#ready.catch(() => {
      this.#ready = null
    })
    return this.#ready
  }

  /** Starts a new sequence: Vision's temporal smoothing must not carry one clip's person into the next. */
  reset(): void {
    this.#child?.stdin?.write(Buffer.from('S'.padEnd(HEADER, ' ')))
  }

  async segment(frame: RgbaFrame): Promise<MaskFrame> {
    await this.start()
    const child = this.#child
    if (!child?.stdin) throw new Error('The Apple Vision process is not running.')
    const expected = frame.width * frame.height * 4
    if (frame.rgba.length !== expected) {
      throw new Error(`A ${frame.width}×${frame.height} frame must be ${expected} bytes of RGBA; got ${frame.rgba.length}.`)
    }
    return new Promise<MaskFrame>((resolve, reject) => {
      this.#waiters.push({ resolve, reject })
      child.stdin!.write(Buffer.from(`F ${frame.width} ${frame.height}`.padEnd(HEADER, ' ')))
      child.stdin!.write(frame.rgba)
    })
  }

  /** Kills the process. Frames still waiting are failed, so no caller hangs on a dead pipe. */
  stop(): void {
    const child = this.#child
    if (!child) return
    this.#fail(new Error('The Apple Vision process was stopped.'), child)
    try {
      child.kill('SIGKILL')
    } catch {
      // Already gone.
    }
  }

  #fail(error: Error, child: ChildProcess): void {
    if (this.#child !== child) return
    this.#child = null
    this.#ready = null
    this.#onUnavailable?.(error.message)
    this.#onUnavailable = null
    this.#onReady = null
    const waiting = this.#waiters
    this.#waiters = []
    for (const waiter of waiting) waiter.reject(error)
  }

  #read(chunk: Buffer): void {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk])
    for (;;) {
      if (this.#buffer.length < HEADER) return
      const head = this.#buffer.subarray(0, HEADER).toString('latin1').trim().split(/\s+/)
      const tag = head[0]
      if (tag === 'M') {
        const [mw, mh, rowBytes, ms] = head.slice(1).map(Number) as [number, number, number, number]
        const size = rowBytes * mh
        if (this.#buffer.length < HEADER + size) return
        const rows = this.#buffer.subarray(HEADER, HEADER + size)
        this.#buffer = this.#buffer.subarray(HEADER + size)
        const gray = new Uint8Array(mw * mh)
        for (let y = 0; y < mh; y += 1) gray.set(rows.subarray(y * rowBytes, y * rowBytes + mw), y * mw)
        this.#waiters.shift()?.resolve({ width: mw, height: mh, alpha: gray, ms })
        continue
      }
      const length = Number(head[1])
      if (!Number.isFinite(length) || length < 0) {
        this.#fail(new Error(`The Apple Vision process answered something unreadable (${JSON.stringify(head.join(' '))}).`), this.#child!)
        return
      }
      if (this.#buffer.length < HEADER + length) return
      const text = this.#buffer.subarray(HEADER, HEADER + length).toString('utf8')
      this.#buffer = this.#buffer.subarray(HEADER + length)
      if (tag === 'R') this.#onReady?.(text)
      else if (tag === 'X') this.#onUnavailable?.(text)
      else if (tag === 'E') this.#waiters.shift()?.reject(new Error(`Apple Vision could not segment a frame: ${text}`))
    }
  }
}
