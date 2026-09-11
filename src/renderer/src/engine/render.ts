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

import {
  findAsset,
  findTimeline,
  itemsAtFrame,
  type Asset,
  type Project,
  type Timeline
} from '@shared/project'
import { Compositor, seekOwners } from './compositor'
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
}

export interface RenderedFrame {
  /** `data:image/png;base64,…` — what the MCP result carries, with no re-encoding needed. */
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
 * **Only the seek owner moves each element.** Two items sharing an asset in one frame share
 * its single element; if both issue their target the element restarts its seek forever,
 * `readyState` sits at 1, and every item reports `pending` — measured, and permanent. The
 * compositor already decides who owns the seek, so this asks it rather than deciding again.
 */
export async function awaitSources(
  pool: MediaPool,
  project: Project,
  timeline: Timeline,
  frame: number,
  timeoutMs = DEFAULT_SOURCE_TIMEOUT_MS
): Promise<void> {
  const fps = Number.isFinite(timeline.fps) && timeline.fps > 0 ? timeline.fps : 30
  const items = itemsAtFrame(timeline, frame, 'video')
  const owners = seekOwners(items)
  const waits: Promise<void>[] = []

  for (const item of items) {
    const asset = findAsset(project, item.assetId)
    if (!asset || asset.error || asset.kind === 'text') continue
    const element = pool.acquire(asset).element
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

    // Not this item's element to move; the owner's seek is the one that decides the frame.
    if (owners.get(asset.id) !== item.id) continue

    const target = sourceSecondsAt(item, asset, frame, fps)
    // A source whose frame rate differs from the timeline's lands on the same decoded frame
    // for several timeline frames; re-seeking inside the frame already shown costs a decode
    // and changes nothing.
    if (Math.abs(element.currentTime - target) <= 0.5 / fps && !element.seeking) continue
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

function unresolvedNames(project: Project, timeline: Timeline, frame: number, pool: MediaPool): string[] {
  const names: string[] = []
  for (const item of itemsAtFrame(timeline, frame, 'video')) {
    const asset: Asset | undefined = findAsset(project, item.assetId)
    if (!asset) {
      names.push('a missing asset')
      continue
    }
    if (asset.kind === 'text') continue
    if (asset.error) {
      names.push(`${asset.name} (${asset.error})`)
      continue
    }
    if (!pool.readiness(asset.id).hasPicture) names.push(asset.name)
  }
  return [...new Set(names)]
}

/**
 * Renders one frame and returns it as a PNG data URL.
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
  const compositor = new Compositor(pool)

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

    let stats = { drawn: 0, pending: 0, placeholders: 0 }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await awaitSources(pool, project, timeline, frame, timeoutMs)
      stats = compositor.drawFrame(ctx, project, timeline, frame, { mode: 'scrub' })
      if (stats.pending === 0) break
      // Something was still decoding. `onReady` fires on `loadeddata` and `seeked`, so this
      // waits for the next actual change rather than sleeping a guessed interval.
      await new Promise<void>((resolve) => {
        const off = pool.onReady(() => {
          off()
          resolve()
        })
        setTimeout(() => {
          off()
          resolve()
        }, timeoutMs)
      })
    }

    return {
      dataUrl: canvas.toDataURL('image/png'),
      width,
      height,
      ...stats,
      unresolved: stats.pending > 0 || stats.placeholders > 0
        ? unresolvedNames(project, timeline, frame, pool)
        : []
    }
  } finally {
    // A 4K-project canvas is 33MB that GC is in no hurry about.
    canvas.width = 0
    canvas.height = 0
    compositor.reset()
    if (ownsPool) pool.dispose()
  }
}
