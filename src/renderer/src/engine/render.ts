/**
 * Rendering one frame on demand — the engine side of the `preview_frame` tool.
 *
 * This is the only tool in the agent catalog that shows the model what an edit *looks like*.
 * Every other one answers from the arguments it was given: `read_project` will happily report
 * an item at frame 90 with opacity 0.5 while the clip it describes is letterboxed into a
 * corner, an overlay sits across a face, or a title runs off the edge. Those are invisible in
 * the model and obvious in a picture.
 *
 * Which makes the failure mode specific and severe: **a plausible wrong frame is worse than
 * no tool at all.** An agent that receives a black image concludes the timeline is empty; one
 * that receives the frame before a cut concludes the edit is misplaced and "fixes" something
 * that was right. So this path waits for its media the way the exporter does, rather than
 * drawing whatever the elements happen to hold, and when it cannot resolve it says which
 * assets were still loading instead of returning a picture of nothing.
 */

import { findAsset, findTimeline, type Project, type Timeline } from '@shared/project'
import { Compositor, elementSlots, itemsToDraw, type DrawStats } from './compositor'
import { CompositionPool } from './compositionPool'
import type { TextFit } from './text'
import { MediaPool } from './mediaPool'
import { sourceSecondsAt } from './sync'

/**
 * Longest edge of the returned image, by default.
 *
 * The reader is a model looking at framing and occlusion, not a tool measuring pixels, and
 * the image crosses JSON-RPC as base64 — a 1920x1080 PNG is megabytes of tokens to answer
 * "is the subject centred". 640 is enough to see a face covered by an overlay or a clip
 * sitting in the wrong third. The caller can ask for more; nothing upscales past the
 * project's own resolution, because inventing pixels cannot add information.
 */
export const DEFAULT_PREVIEW_MAX_EDGE = 640

/** How long one source may take to decode and seek before the frame is rendered without it. */
export const DEFAULT_SOURCE_TIMEOUT_MS = 5000

export interface RenderFrameOptions {
  project: Project
  timelineId: string
  frame: number
  /** Longest edge of the result. Defaults to {@link DEFAULT_PREVIEW_MAX_EDGE}. */
  maxSize?: number
  /**
   * Share a pool only when nothing else is drawing from it. By default this gets its own,
   * because seeking elements to an arbitrary frame would scramble the preview the user is
   * watching — and this tool is declared read-only.
   */
  pool?: MediaPool
  timeoutMs?: number
  /**
   * `png` by default, because a probe comparing stills wants them lossless. The agent surface
   * asks for `jpeg`: a PNG of a video frame at 640px is several hundred kilobytes of base64,
   * which a client counts as tokens, while a JPEG of the same picture answers the same question
   * — "is the caption covering her face?" — at a tenth of that.
   */
  format?: 'png' | 'jpeg'
  /**
   * A line of text burned into the bottom-left corner after compositing — the timecode, when
   * an agent asks for it. Drawn in image space, not timeline space, so it is the same size at
   * any canvas resolution, and on a plate so it reads over any picture.
   */
  stamp?: string
}

export interface RenderedFrame {
  /** `data:image/png;base64,…` (or jpeg) — what the MCP result carries, unre-encoded. */
  dataUrl: string
  width: number
  height: number
  /** Items that put pixels on the canvas. */
  drawn: number
  /** Items whose media never became drawable. Non-zero means the picture is incomplete. */
  pending: number
  /** Items drawn as a placeholder because the asset is missing or unreadable. */
  placeholders: number
  /** Names of the assets behind `pending` and `placeholders`, for an honest message. */
  unresolved: string[]
  /**
   * How each text item came out. Non-default `scale`, `clipped`, or `fontAvailable: false`
   * each mean the picture is not what was asked for in a way nothing in it reveals.
   */
  textFits: TextFit[]
  /** The transition at this frame, including why it is shorter than asked for. */
  transition?: DrawStats['transition']
}

/** Resolves on the first of `events`, or after `timeoutMs`. Never rejects. */
export function settle(target: EventTarget, events: string[], timeoutMs: number): Promise<void> {
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

/**
 * Puts every source this frame needs where it belongs, and waits for it.
 *
 * The difference from the preview path in one line: the preview draws whatever an element
 * currently holds rather than stalling the window on a seek, and anything that arrives late
 * triggers a redraw. Nothing redraws here — there is one frame and one answer — so the wait
 * has to happen before the draw.
 *
 * **Each item waits on its own element.** Two items on one asset in one frame get two
 * elements (see `elementSlots`), which is what lets a transition show both source times. The
 * assignment comes from the compositor so that the element awaited here is the element that
 * frame will draw from — deriving it twice by different rules would wait on one and draw from
 * another, which looks exactly like a source that never became ready.
 */
export async function awaitSources(
  pool: MediaPool,
  project: Project,
  timeline: Timeline,
  frame: number,
  timeoutMs = DEFAULT_SOURCE_TIMEOUT_MS
): Promise<void> {
  const fps = Number.isFinite(timeline.fps) && timeline.fps > 0 ? timeline.fps : 30
  // The same list *and* the same assignment the compositor will use, from the same function.
  // Deriving either one separately is not a hypothetical: when the compositor began adding a
  // transition's second clip and this still called `itemsAtFrame`, the lists differed at the
  // cut and every frame from there on rendered black.
  const { items } = itemsToDraw(project, timeline, frame)
  const slots = elementSlots(items)
  const waits: Promise<void>[] = []

  for (const item of items) {
    const asset = findAsset(project, item.assetId)
    if (!asset || asset.error || asset.kind === 'text') continue
    const element = pool.acquire(asset, slots.get(item.id) ?? 0).element
    if (!element) continue

    if (element instanceof HTMLImageElement) {
      if (!element.complete) waits.push(settle(element, ['load', 'error'], timeoutMs))
      continue
    }
    if (!(element instanceof HTMLVideoElement)) continue

    if (element.readyState < HTMLMediaElement.HAVE_METADATA) {
      await settle(element, ['loadedmetadata', 'error'], timeoutMs)
    }
    if (!element.paused) element.pause()

    const target = sourceSecondsAt(item, asset, frame, fps)
    // A source whose frame rate differs from the timeline's lands on the same decoded frame
    // for several timeline frames; re-seeking inside the frame already shown costs a decode
    // and changes nothing.
    const atTarget = Math.abs(element.currentTime - target) <= 0.5 / fps && !element.seeking

    if (atTarget) {
      // **Being at the right time is not the same as holding a frame.** A freshly created
      // element reports `currentTime` 0 before it has decoded anything, so a clip whose
      // source time is 0 satisfies "already there" while holding nothing at all — and this
      // shortcut then returned without issuing a seek and without waiting for one. The
      // export drew background for that frame and moved on: exactly one black frame, at the
      // first frame of every clip that starts at the beginning of its source. Measured in a
      // delivered MP4 at every cut, and reproduced here in isolation at `readyState` 1.
      if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) continue
      // Seeking to where we already are may never fire `seeked`, so wait for the data.
      waits.push(settle(element, ['loadeddata', 'canplay', 'error'], timeoutMs))
      continue
    }

    element.currentTime = target
    waits.push(settle(element, ['seeked', 'error'], timeoutMs))
  }

  if (waits.length > 0) await Promise.all(waits)
}

/**
 * The size to composite at: the project's own resolution, capped so the longest edge fits.
 *
 * Never upscales. A 320x240 project asked for 640 comes back at 320x240 — there is nothing
 * in the source to fill the extra pixels, and a model looking at an upscaled frame is being
 * charged tokens for interpolation.
 */
export function previewSize(
  timelineWidth: number,
  timelineHeight: number,
  maxEdge: number
): { width: number; height: number } {
  const w = Math.max(1, Math.round(timelineWidth))
  const h = Math.max(1, Math.round(timelineHeight))
  const cap = Math.max(1, Math.round(maxEdge))
  const scale = Math.min(1, cap / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}


function drawStamp(ctx: CanvasRenderingContext2D, text: string, width: number, height: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.filter = 'none'
  const size = Math.max(10, Math.round(Math.min(width, height) * 0.045))
  const pad = Math.round(size * 0.4)
  ctx.font = `600 ${size}px ui-monospace, Menlo, monospace`
  ctx.textBaseline = 'bottom'
  const measured = ctx.measureText(text).width
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
  ctx.fillRect(0, height - size - pad * 2, measured + pad * 2, size + pad * 2)
  ctx.fillStyle = '#FFFFFF'
  ctx.fillText(text, pad, height - pad)
}

/**
 * Renders one frame and returns it as a PNG (or JPEG) data URL.
 *
 * Retries while anything is `pending` rather than returning early: a first attempt often
 * finds an element that has only just been created, and `onReady` fires when it decodes. The
 * retry is bounded, and a frame that still cannot resolve comes back *with* its `pending`
 * count and the names behind it, so the caller can say "2 clips still loading" instead of
 * handing the agent a black picture that reads as a correct answer about an empty timeline.
 */
export async function renderFrame(options: RenderFrameOptions): Promise<RenderedFrame> {
  const { project, timelineId, frame } = options
  const timeline = findTimeline(project, timelineId)
  if (!timeline) {
    throw new Error(
      `no timeline ${timelineId} in this project — call read_project and use its timeline id`
    )
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS
  const ownsPool = options.pool === undefined
  const pool = options.pool ?? new MediaPool({ maxVideoElements: 8 })
  const compositions = new CompositionPool()
  const compositor = new Compositor(pool, compositions)

  const { width, height } = previewSize(
    timeline.width,
    timeline.height,
    options.maxSize ?? DEFAULT_PREVIEW_MAX_EDGE
  )

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: false })
  if (!ctx) throw new Error('this renderer has no 2D canvas to render a preview with')

  try {
    // The compositor draws in timeline coordinates; this is the only place the preview size
    // enters, which is what keeps the framing identical to what the user is looking at.
    ctx.setTransform(
      width / Math.max(1, timeline.width),
      0,
      0,
      height / Math.max(1, timeline.height),
      0,
      0
    )

    let stats: DrawStats = { drawn: 0, pending: 0, placeholders: 0, textFits: [], unresolvedNames: [] }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await awaitSources(pool, project, timeline, frame, timeoutMs)
      stats = compositor.drawFrame(ctx, project, timeline, frame, { mode: 'scrub' })
      if (stats.pending === 0) break

      // A pending *composition* is not a decode in progress — it is a render this draw has
      // just asked for, and it arrives whether or not anything else happens. `settle` is the
      // wait built for exactly that, and the exporter has always called it; the preview never
      // did, which made `preview_frame` unable to converge on any frame carrying two
      // compositions. The cache is constructed per call and disposed below, so nothing carries
      // over between calls either: asking again could not accumulate what the last call had
      // fetched, and `MAX_CONCURRENT_REQUESTS` silently drops the third request of a draw. The
      // symptom was a frame that alternated which composition it reported missing, forever.
      //
      // Bounded by the same timeout as the media wait, so a composition that never renders
      // still costs a reported-incomplete frame rather than a call that does not return.
      await compositions.settle(timeoutMs)
      // What settled may be all that was missing. Waiting for the *next* readiness event after
      // it did waited out the whole timeout — nothing else was coming — and cost every frame with
      // a composition ~5s in `preview_frame`. Look again first.
      await awaitSources(pool, project, timeline, frame, timeoutMs)
      stats = compositor.drawFrame(ctx, project, timeline, frame, { mode: 'scrub' })
      if (stats.pending === 0) break
      // Something was still decoding. `onReady` fires on `loadeddata` and `seeked`, so this
      // waits for the next actual change rather than sleeping a guessed interval.
      //
      // Both pools, because a composition is pending for a different reason than a video: its
      // first frame is not requested until the first draw asks for it, so a render that only
      // waited on media returned a picture with the composition missing — correctly warned
      // about, and still the wrong picture. Whichever settles first wakes the retry.
      await new Promise<void>((resolve) => {
        const offs = [pool.onReady(finish), compositions.onReady(finish)]
        const timer = setTimeout(finish, timeoutMs)
        function finish(): void {
          clearTimeout(timer)
          for (const off of offs) off()
          resolve()
        }
      })
    }

    if (options.stamp) drawStamp(ctx, options.stamp, width, height)

    return {
      dataUrl:
        options.format === 'jpeg' ? canvas.toDataURL('image/jpeg', 0.85) : canvas.toDataURL('image/png'),
      width,
      height,
      ...stats,
      // Straight from the compositor. This used to be reconstructed here by re-deriving which
      // assets looked unready, and it was wrong both times it was written.
      unresolved: [...new Set(stats.unresolvedNames)]
    }
  } finally {
    // A 4K-project canvas is 33MB that GC is in no hurry about.
    canvas.width = 0
    canvas.height = 0
    compositor.reset()
    if (ownsPool) pool.dispose()
    // Unconditional: the composition pool is always this call's own, and every asset it
    // touched left an offscreen window open in main.
    compositions.dispose()
  }
}
