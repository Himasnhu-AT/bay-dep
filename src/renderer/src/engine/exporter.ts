/**
 * Drives an export: walk the frame range, composite each frame, read it back, hand it to
 * the encoder.
 *
 * Two things separate this from the preview path, and both are deliberate:
 *
 * - **Export waits; preview never does.** The preview draws whatever an element currently
 *   holds rather than stalling the window on a seek. An export that did that would deliver
 *   the wrong frame — silently, and only visible in the finished file — so here every seek
 *   is awaited before the frame is drawn, with a timeout so a source that will not seek
 *   costs one slow frame instead of a hung export.
 * - **Backpressure is the encoder's.** Every `pushFrame` is awaited. Draining ahead of the
 *   encoder would mean the renderer producing 4K frames as fast as it can composite them
 *   into a queue nothing is emptying: at 33MB a frame that is a gigabyte in thirty frames.
 *   One frame in flight is the whole memory bound.
 *
 * The exporter uses its own {@link MediaPool} by default so that seeking elements to
 * export positions does not scramble the preview the user is watching.
 */

import {
  findAsset,
  findTimeline,
  itemsAtFrame,
  timelineDuration,
  type Project,
  type Timeline
} from '@shared/project'
import { Compositor } from './compositor'
import { MediaPool } from './mediaPool'
import { sourceSecondsAt } from './sync'

export interface ExportProgressReport {
  /** The frame just handed to the encoder. */
  frame: number
  framesDone: number
  framesTotal: number
  /** 0..1 */
  progress: number
}

export interface ExporterOptions {
  project: Project
  timelineId: string
  /** The job id returned by `window.bay.export.start`. */
  jobId: string
  /** Delivery size. Defaults to the timeline's own. */
  width?: number
  height?: number
  /** Inclusive frame range. Defaults to the whole timeline. */
  fromFrame?: number
  toFrame?: number
  onProgress?: (report: ExportProgressReport) => void
  /** Share a pool only when nothing else is drawing from it. */
  pool?: MediaPool
  /** How long one frame may wait for its sources. */
  seekTimeoutMs?: number
}

export interface ExportOutcome {
  framesWritten: number
  cancelled: boolean
}

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled.')
    this.name = 'ExportCancelled'
  }
}

const DEFAULT_SEEK_TIMEOUT_MS = 5000

export class FrameExporter {
  readonly #options: ExporterOptions
  readonly #pool: MediaPool
  readonly #ownsPool: boolean
  readonly #compositor: Compositor
  #cancelled = false

  constructor(options: ExporterOptions) {
    this.#options = options
    this.#ownsPool = options.pool === undefined
    // One decoder per simultaneous clip is the working set; the preview's cap is about
    // holding a scrub responsive, which an export does not care about.
    this.#pool = options.pool ?? new MediaPool({ maxVideoElements: 8 })
    this.#compositor = new Compositor(this.#pool)
  }

  cancel(): void {
    this.#cancelled = true
  }

  get cancelled(): boolean {
    return this.#cancelled
  }

  async run(): Promise<ExportOutcome> {
    const bay = globalThis.window?.bay
    if (!bay) throw new Error('The export bridge is not available in this renderer.')

    const { project, timelineId, jobId } = this.#options
    const timeline = findTimeline(project, timelineId)
    if (!timeline) throw new Error(`No timeline ${timelineId} in this project.`)

    const width = Math.max(1, Math.round(this.#options.width ?? timeline.width))
    const height = Math.max(1, Math.round(this.#options.height ?? timeline.height))
    const duration = timelineDuration(timeline)
    const from = Math.max(0, Math.round(this.#options.fromFrame ?? 0))
    const to = Math.max(from, Math.round(this.#options.toFrame ?? Math.max(from, duration - 1)))
    const framesTotal = to - from + 1

    const { ctx, release } = makeTarget(width, height)
    // The compositor draws in timeline coordinates; this is the only place the delivery
    // size enters the render path, which is what keeps a 4K export from being a preview
    // scaled up after the fact.
    ctx.setTransform(width / Math.max(1, timeline.width), 0, 0, height / Math.max(1, timeline.height), 0, 0)

    let framesWritten = 0
    try {
      for (let frame = from; frame <= to; frame += 1) {
        // Two checks with different jobs. This one is a cost guard: it skips seeking every
        // source for a frame that will be thrown away, which on a 4K export is real work.
        // Deleting it changes no observable behaviour — the check below still stops the
        // walk — so no test can tell it apart, and it is deliberately not claimed as
        // covered. The one below is the correctness check: cancellation usually arrives
        // *during* the awaited prepare, and without it that frame would still be pushed.
        if (this.#cancelled) break

        await this.#prepare(timeline, frame)
        if (this.#cancelled) break

        this.#compositor.drawFrame(ctx, project, timeline, frame, { mode: 'scrub' })

        // getImageData is in device pixels, so it ignores the transform above — which is
        // what we want: the whole target, once. Its `data` is a fresh view spanning its own
        // buffer, so `.buffer` is exactly `width * height * 4` bytes and matches the length
        // the encoder checks; a subarray of something larger would not, and would be
        // rejected. There is no transfer to arrange — Electron's `invoke` has no transfer
        // list and structured-clones the buffer whatever we do.
        const image = ctx.getImageData(0, 0, width, height)
        await bay.export.pushFrame({
          jobId,
          frame,
          data: image.data.buffer as ArrayBuffer,
          width,
          height
        })

        framesWritten += 1
        this.#options.onProgress?.({
          frame,
          framesDone: framesWritten,
          framesTotal,
          progress: framesTotal > 0 ? framesWritten / framesTotal : 1
        })
      }

      if (this.#cancelled) {
        await bay.export.cancel(jobId)
        return { framesWritten, cancelled: true }
      }

      await bay.export.finish(jobId)
      return { framesWritten, cancelled: false }
    } catch (error) {
      // The encoder rejects a frame of the wrong size, the wrong dimensions or out of
      // sequence. Letting that propagate without cancelling would leave ffmpeg running on
      // a half-written file that nothing will ever close.
      await bay.export.cancel(jobId).catch(() => {})
      throw error
    } finally {
      release()
      if (this.#ownsPool) this.#pool.dispose()
      this.#compositor.reset()
    }
  }

  /**
   * Positions every source this frame needs and waits for it. Unlike the preview, an
   * export cannot draw "whatever the element holds" — that is how a cut comes back with
   * the frame before it.
   */
  async #prepare(timeline: Timeline, frame: number): Promise<void> {
    const { project } = this.#options
    const timeout = this.#options.seekTimeoutMs ?? DEFAULT_SEEK_TIMEOUT_MS
    const fps = Number.isFinite(timeline.fps) && timeline.fps > 0 ? timeline.fps : 30
    const waits: Promise<void>[] = []

    for (const item of itemsAtFrame(timeline, frame, 'video')) {
      const asset = findAsset(project, item.assetId)
      if (!asset || asset.error || asset.kind === 'text') continue
      const entry = this.#pool.acquire(asset)
      const element = entry.element
      if (!element) continue

      if (element instanceof HTMLImageElement) {
        if (!element.complete) waits.push(settle(element, ['load', 'error'], timeout))
        continue
      }
      if (!(element instanceof HTMLVideoElement)) continue

      if (element.readyState < HTMLMediaElement.HAVE_METADATA) {
        await settle(element, ['loadedmetadata', 'error'], timeout)
      }
      if (!element.paused) element.pause()

      const target = sourceSecondsAt(item, asset, frame, fps)
      // A source whose frame rate differs from the timeline's lands on the same decoded
      // frame for several timeline frames; re-seeking to a time inside the frame already
      // shown costs a decode and changes nothing.
      if (Math.abs(element.currentTime - target) <= 0.5 / fps && !element.seeking) continue
      element.currentTime = target
      waits.push(settle(element, ['seeked', 'error'], timeout))
    }

    if (waits.length > 0) await Promise.all(waits)
  }
}

interface Target {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  release: () => void
}

function makeTarget(width: number, height: number): Target {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (ctx) return { ctx, release: () => {} }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('This renderer has no 2D canvas to export with.')
  return {
    ctx,
    release: () => {
      // Releasing the backing store; a 4K canvas is 33MB that GC is in no hurry about.
      canvas.width = 0
      canvas.height = 0
    }
  }
}

/** Resolves on the first of `events`, or after `timeoutMs`. Never rejects. */
function settle(target: EventTarget, events: string[], timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      for (const event of events) target.removeEventListener(event, finish)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    for (const event of events) target.addEventListener(event, finish)
  })
}
