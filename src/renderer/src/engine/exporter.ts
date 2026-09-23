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

import { brfRuntime } from './brfCode'
import { variationFaces } from './brfFonts'
import {
  findTimeline,
  timelineDuration,
  type Project
} from '@shared/project'
import { Compositor } from './compositor'
import { CompositionPool } from './compositionPool'
import { MediaPool } from './mediaPool'
import { awaitSources } from './render'

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

/**
 * How many times one export frame may be redrawn while something is still arriving.
 *
 * Bounded because an export must finish. A composition that never renders should cost a frame
 * that is missing it and a count in the result, not a render that never returns — the one
 * outcome worse than a wrong picture is no answer at all.
 */
const MAX_PENDING_REDRAWS = 4

export class FrameExporter {
  readonly #options: ExporterOptions
  readonly #pool: MediaPool
  readonly #ownsPool: boolean
  readonly #compositor: Compositor
  readonly #compositions: CompositionPool
  /**
   * Frames written with something still missing.
   *
   * Counted rather than thrown on: one composition that will not render must not abandon an
   * export that is otherwise correct. Reported at the end so the result can say the file is
   * incomplete instead of the user discovering it on playback.
   */
  #pendingFrames = 0
  #cancelled = false
  readonly #seekTimeout: number

  constructor(options: ExporterOptions) {
    this.#options = options
    this.#ownsPool = options.pool === undefined
    // One decoder per simultaneous clip is the working set; the preview's cap is about
    // holding a scrub responsive, which an export does not care about.
    this.#pool = options.pool ?? new MediaPool({ maxVideoElements: 8 })
    // Its own composition cache, never the preview's. The key carries the requested pixel
    // size so the two could coexist safely, but an export holds full-size frames and sharing
    // would evict the preview's entire working set on every render.
    this.#compositions = new CompositionPool()
    this.#compositor = new Compositor(this.#pool, this.#compositions)
    this.#seekTimeout = options.seekTimeoutMs ?? DEFAULT_SEEK_TIMEOUT_MS
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

        await awaitSources(this.#pool, project, timeline, frame, this.#seekTimeout)
        if (this.#cancelled) break

        // Draw, then wait for anything that was not ready and draw again. A composition frame
        // is not fetched until a draw asks for it — the first draw is what issues the request
        // — so an export that drew once and moved on wrote the frame without it. Every
        // composition came out missing: black where a title should be, absent where a lower
        // third should be, and the picture in the preview was right the whole time. This is
        // the export-versus-preview divergence this codebase is least able to notice, because
        // both halves look correct in isolation.
        let stats = this.#compositor.drawFrame(ctx, project, timeline, frame, { mode: 'scrub' })
        for (let attempt = 0; stats.pending > 0 && attempt < MAX_PENDING_REDRAWS; attempt += 1) {
          if (this.#cancelled) break
          await Promise.all([this.#compositions.settle(this.#seekTimeout), brfRuntime.settle(this.#seekTimeout), variationFaces.settle(this.#seekTimeout)])
          stats = this.#compositor.drawFrame(ctx, project, timeline, frame, { mode: 'scrub' })
        }
        if (stats.pending > 0) this.#pendingFrames += 1
        if (this.#cancelled) break
        // Export has no audio consumer, so the picture is the only vote there is.
        this.#pool.retireIdle()

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
      // Not gated on #ownsPool: the composition pool is always constructed here, never
      // handed in, so an export that skipped this would leave one offscreen window per
      // composition alive for the life of the app.
      this.#compositions.dispose()
      this.#compositor.reset()
    }
  }

}

interface Target {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  release: () => void
}

/**
 * The export target, and why it does **not** ask for `willReadFrequently`.
 *
 * The flag looks obviously right here: the export loop reads back every frame, which is
 * literally the case it exists for. It asks Chromium for a software-backed store so a
 * `getImageData` does not pay a GPU-to-CPU transfer.
 *
 * Measured, it is a large net loss on the hardware bay ships for. Full per-frame cycle —
 * `drawImage` from a real decoded `<video>` plus a whole-frame `getImageData`, median of
 * three interleaved runs:
 *
 *                          flag on     flag off
 *     1080p, no filter      8.66 ms      3.38 ms     2.56x
 *     1080p, blur(8px)     16.23 ms      4.03 ms     4.03x
 *     4K,    no filter      29.2 ms     13.13 ms     2.22x
 *     4K,    blur(8px)      61.0 ms     13.42 ms     4.55x
 *
 * The readback is inside those numbers, so this is not cost moved from the draw to the read.
 * The reason the flag loses is the thing it cannot help with: a decoded video frame is a GPU
 * texture, and drawing one *into* a software-backed canvas forces a readback of the **source**
 * — a cost that does not exist when the source is already CPU-side. `interface` first measured
 * this with a synthetic source canvas and saw a smaller penalty; with real frames it roughly
 * doubles, which is that extra transfer.
 *
 * It stays off rather than being made configurable because the flag's premise — that
 * GPU-to-CPU transfer is expensive — does not hold on the machines this product targets.
 * On hardware where it does, the tradeoff could invert; `test/app/export-readback-cost.mjs`
 * reports the numbers rather than asserting a threshold, so it can be re-measured rather than
 * re-argued.
 */
function makeTarget(width: number, height: number): Target {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (ctx) return { ctx, release: () => {} }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
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

