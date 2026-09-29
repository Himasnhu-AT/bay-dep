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

import type { IncompleteFrames } from '@shared/ipc'
import { fitCanvasInFrame } from '@shared/export-presets'
import { brfRuntime } from './brfCode'
import { variationFaces } from './brfFonts'
import { importedFonts } from './importedFonts'
import { scene3dRuntime } from './scene3dRuntime'
import { subjectMattes } from './subjectMatte'
import {
  findTimeline,
  timelineDuration,
  type Project
} from '@shared/project'
import { Compositor, type DrawStats } from './compositor'
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
  /** Frames written with something still missing; null when every frame was complete. */
  incomplete: IncompleteFrames | null
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
   * Frames written with something still missing, and what.
   *
   * Recorded rather than thrown on: one composition that will not render must not abandon an
   * export that is otherwise correct. But it is *reported* — on the outcome, and live through
   * {@link incomplete} — because a file with a black frame where a title should be is the wrong
   * picture, and an export that finishes as plain "done" over it is the silent version of that.
   * This was a bare counter that nothing read for as long as it existed.
   */
  readonly #incomplete: WrittenFrameIssues[] = []
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

  /**
   * What the frames written so far are missing. Live, not only on the outcome: main reports the
   * job `done` when the encoder closes, which can reach a listener before `run()` returns, and
   * every frame is recorded here before it is pushed — so by the time `done` can arrive, this is
   * already final.
   */
  get incomplete(): IncompleteFrames | null {
    return describeIncomplete(this.#incomplete)
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
    //
    // One scale for both axes, centred: a delivery of another shape (a 1080×1920 file from a
    // 16:9 canvas) gets the whole canvas with black bars, never a stretched picture. For a
    // delivery of the canvas's own shape this is the plain scale it always was.
    const fit = fitCanvasInFrame(timeline.width, timeline.height, width, height)
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, width, height)
    ctx.setTransform(fit.scale, 0, 0, fit.scale, fit.offsetX, fit.offsetY)
    // The bars are outside the canvas, and a clip framed past the canvas edge (a cover fit)
    // must not draw into them.
    ctx.beginPath()
    ctx.rect(0, 0, timeline.width, timeline.height)
    ctx.clip()

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
          await Promise.all([this.#compositions.settle(this.#seekTimeout), brfRuntime.settle(this.#seekTimeout), variationFaces.settle(this.#seekTimeout), importedFonts.settle(this.#seekTimeout), scene3dRuntime.settle(this.#seekTimeout), subjectMattes.settle(this.#seekTimeout)])
          stats = this.#compositor.drawFrame(ctx, project, timeline, frame, { mode: 'scrub' })
        }
        // Both are recorded from the draw that was written — the last one — and nothing else.
        const wrong = writtenFrameIssues(frame, stats)
        if (wrong) this.#incomplete.push(wrong)
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
        return { framesWritten, cancelled: true, incomplete: this.incomplete }
      }

      await bay.export.finish(jobId, { incomplete: this.incomplete !== null })
      return { framesWritten, cancelled: false, incomplete: this.incomplete }
    } catch (error) {
      // The encoder rejects a frame of the wrong size, the wrong dimensions or out of
      // sequence. Letting that propagate without cancelling would leave ffmpeg running on
      // a half-written file that nothing will ever close. Main is told this cancel is a
      // failure, so it counts one: to the encoder it is otherwise the same as the user's.
      await bay.export.cancel(jobId, { failed: true, stage: 'rendering' }).catch(() => {})
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

/** How many frame ranges the sentence spells out before it says "and N more". */
const RANGES_IN_MESSAGE = 6

/** What one written frame got wrong: items still pending, grade failures, placeholder cards. */
export interface WrittenFrameIssues {
  frame: number
  /** Names of the items the frame was written without. */
  missing: readonly string[]
  /** The compositor's grade issues for the frame; each names its clip. */
  gradeIssues: readonly string[]
  /** Items drawn as a placeholder card, each with why (`DrawStats.placeholderNames`). */
  placeholders?: readonly string[]
}

/**
 * What the draw that was written got wrong, or null for a clean frame. Pure over the draw's
 * stats, so the rule — pending, a failed grade, *or a placeholder* makes a frame wrong — is
 * tested without an encoder. Placeholders were once left out: a `.brf` that threw exported as
 * six grey "Box" cards and the dialog said "Done 100%".
 */
export function writtenFrameIssues(
  frame: number,
  stats: Pick<DrawStats, 'pending' | 'pendingNames' | 'gradeIssues' | 'placeholders' | 'placeholderNames'>
): WrittenFrameIssues | null {
  const gradeIssues = stats.gradeIssues ?? []
  if (stats.pending === 0 && gradeIssues.length === 0 && stats.placeholders === 0) return null
  return {
    frame,
    missing: stats.pending > 0 ? stats.pendingNames : [],
    gradeIssues,
    placeholders: stats.placeholders > 0 ? stats.placeholderNames : []
  }
}

function toRanges(frames: readonly number[]): [number, number][] {
  const ranges: [number, number][] = []
  for (const frame of [...new Set(frames)].sort((a, b) => a - b)) {
    const last = ranges[ranges.length - 1]
    if (last && frame === last[1] + 1) last[1] = frame
    else ranges.push([frame, frame])
  }
  return ranges
}

function spellRanges(ranges: readonly [number, number][]): string {
  const count = ranges.reduce((n, [a, b]) => n + b - a + 1, 0)
  const spelled = ranges.slice(0, RANGES_IN_MESSAGE).map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`))
  const more = ranges.length - spelled.length
  return `frame${count === 1 ? '' : 's'} ${spelled.join(', ')}${more > 0 ? ` and ${more} more range${more === 1 ? '' : 's'}` : ''}`
}

/**
 * Each distinct key, the frames it was on, most frames first. A key repeated on one frame is
 * counted once because the frames are deduplicated here, at the count and the ranges.
 */
function tally(written: readonly WrittenFrameIssues[], keys: (w: WrittenFrameIssues) => readonly string[]): { key: string; frames: number; ranges: [number, number][] }[] {
  const on = new Map<string, number[]>()
  for (const w of written) {
    for (const key of keys(w)) {
      const frames = on.get(key) ?? []
      frames.push(w.frame)
      on.set(key, frames)
    }
  }
  return [...on.entries()]
    .map(([key, frames]) => ({ key, frames: new Set(frames).size, ranges: toRanges(frames) }))
    .sort((a, b) => b.frames - a.frames || a.key.localeCompare(b.key))
}

/**
 * The report for frames written with the wrong picture — the sentence first, because it is what
 * the user and the agent act on: which frames, what is wrong on them, and what to do.
 *
 * Grade failures lead: a missing graphic is at least visible on playback, while a clip drawn
 * ungraded looks like a clip nobody graded — the fault that hides better is named first.
 *
 * Takes only frames that were wrong: the exporter records nothing for a clean frame, so a long
 * export holds one entry per bad frame rather than one per frame.
 */
export function describeIncomplete(wrong: readonly WrittenFrameIssues[]): IncompleteFrames | null {
  if (wrong.length === 0) return null
  const ranges = toRanges(wrong.map((w) => w.frame))
  const frames = ranges.reduce((n, [a, b]) => n + b - a + 1, 0)

  const graded = tally(wrong, (w) => w.gradeIssues)
  const missingFrames = wrong.filter((w) => w.missing.length > 0)
  const named = tally(missingFrames, (w) => w.missing)
  const gradeIssues = graded.map(({ key, frames: n, ranges: r }) => ({ issue: key, frames: n, ranges: r }))
  const items = named.map(({ key, frames: n, ranges: r }) => ({ name: key, frames: n, ranges: r }))
  const placeholders = tally(wrong, (w) => w.placeholders ?? []).map(({ key, frames: n, ranges: r }) => ({ name: key, frames: n, ranges: r }))

  const parts: string[] = [`${frames} frame${frames === 1 ? '' : 's'} of this export ${frames === 1 ? 'is' : 'are'} not the picture the timeline describes (${spellRanges(ranges)}).`]
  if (gradeIssues.length > 0) {
    parts.push(
      `A grade was not applied: ${gradeIssues.map((g) => `${g.issue} (${spellRanges(g.ranges)})`).join('; ')}. ` +
        `preview_frame at one of those frames reports the same under gradeWarnings; fix the grade, then export again.`
    )
  }
  if (items.length > 0) {
    const missingCount = new Set(missingFrames.map((w) => w.frame)).size
    parts.push(
      `${missingCount === 1 ? 'One frame was' : `${missingCount} frames were`} written before everything on ` +
        `${missingCount === 1 ? 'it' : 'them'} had rendered, so the file shows the background where it should show ` +
        `${items.map((i) => `"${i.name}" (${spellRanges(i.ranges)})`).join(', ')}. Export again; if the same frames ` +
        `come out incomplete, look at them with preview_frame, which names what is still pending.`
    )
  }
  if (placeholders.length > 0) {
    // Last: a grey card with the item's name on it is the one fault nobody can miss on playback.
    parts.push(
      `These could not be drawn at all, so the file shows a grey placeholder card instead: ` +
        `${placeholders.map((p) => `${p.name} (${spellRanges(p.ranges)})`).join('; ')}. ` +
        `Exporting again will not change them; fix or replace those items first.`
    )
  }
  parts.push('Every other frame is complete.')
  return { frames, ranges, items, gradeIssues, placeholders, message: parts.join(' ') }
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

