/**
 * Draws one timeline frame.
 *
 * The compositor is synchronous and total: given a frame it always returns, always leaves
 * the context's state as it found it, and never throws for anything the project model can
 * contain. A NaN in a layout, a 1x1 canvas, an asset whose file was deleted under us and a
 * clip whose decoder has not produced a picture yet are all normal inputs here.
 *
 * It owns the transport of `<video>` elements, because the picture is what they exist for:
 * during playback it lets them run and only corrects gross drift, while scrubbing it pins
 * each one to the exact source time. `<audio>` elements belong to the audio engine for the
 * same reason — split by element type so there is never a question of who moved something.
 */

import {
  fadeGainAt,
  findAsset,
  itemsAtFrame,
  type Asset,
  type Item,
  type Project,
  type Timeline
} from '@shared/project'
import { MediaPool, isDrawable, type MediaEntry } from './mediaPool'
import {
  DRIFT_TOLERANCE_SECONDS,
  STALE_SEEK_MS,
  clamp,
  clamp01,
  finite,
  playbackRateFor,
  sourceSecondsAt
} from './sync'

export type RenderTarget = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface DrawOptions {
  /**
   * 'playback' lets video elements run and tolerates {@link DRIFT_TOLERANCE_SECONDS} of
   * slip; 'scrub' pauses them and pins each to the frame, which is what a paused playhead
   * and an export both need.
   */
  mode?: 'playback' | 'scrub'
  /** Injectable for tests. */
  now?: () => number
}

export interface DrawStats {
  /** Items that put pixels on the canvas. */
  drawn: number
  /** Items whose media has not decoded anything yet — the frame is incomplete, not empty. */
  pending: number
  /** Items drawn as a placeholder because their asset is missing or unreadable. */
  placeholders: number
}

interface SeekState {
  targetSeconds: number
  issuedAt: number
}

const PLACEHOLDER_FILL = '#232329'
const PLACEHOLDER_EDGE = '#3a3a44'
const PLACEHOLDER_INK = '#8b8b96'

export class Compositor {
  readonly #pool: MediaPool
  /**
   * Outstanding seeks, keyed by asset rather than by item. One element cannot be at two
   * source times at once, so two items sharing an asset in the same frame would otherwise
   * issue competing seeks every frame and neither would ever land. Keyed this way, the
   * item drawn last (the topmost) owns the element's time and the other draws whatever it
   * holds. Two simultaneous items from one asset needs two elements; that is a pool change,
   * and nothing in the product asks for it yet.
   */
  readonly #seeks = new Map<string, SeekState>()
  #touched = new Set<string>()

  constructor(pool: MediaPool) {
    this.#pool = pool
  }

  get pool(): MediaPool {
    return this.#pool
  }

  /**
   * Draws `frame` of `timeline` into `ctx`, in timeline coordinates. The caller owns the
   * transform: the preview leaves it alone, the exporter scales it to the delivery size.
   */
  drawFrame(
    ctx: RenderTarget,
    project: Project,
    timeline: Timeline,
    frame: number,
    options: DrawOptions = {}
  ): DrawStats {
    const mode = options.mode ?? 'scrub'
    const now = options.now ?? (() => performance.now())
    const stats: DrawStats = { drawn: 0, pending: 0, placeholders: 0 }

    this.#pool.beginGeneration()
    this.#touched.clear()

    const width = Math.max(1, finite(timeline.width, 1))
    const height = Math.max(1, finite(timeline.height, 1))
    const fps = finite(timeline.fps, 30) > 0 ? timeline.fps : 30

    ctx.save()
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = timeline.background || '#000000'
    ctx.fillRect(0, 0, width, height)

    // itemsAtFrame already returns lowest track first, so painting in order is the stack.
    for (const item of itemsAtFrame(timeline, frame, 'video')) {
      const asset = findAsset(project, item.assetId)
      if (!asset || asset.error) {
        this.#drawPlaceholder(ctx, item, asset?.name ?? 'Missing media')
        stats.placeholders += 1
        continue
      }

      const entry = this.#pool.acquire(asset)
      this.#touched.add(asset.id)

      if (entry.status === 'error') {
        this.#drawPlaceholder(ctx, item, asset.name)
        stats.placeholders += 1
        continue
      }

      if (asset.kind === 'text') {
        this.#drawText(ctx, item, asset, frame)
        stats.drawn += 1
        continue
      }

      this.#syncElement(entry, item, asset, frame, fps, mode, now())

      if (!isDrawable(entry)) {
        // Nothing decoded yet. Drawing a placeholder here would flash a grey card for the
        // one or two frames a load takes, which reads as a glitch in the edit rather than
        // as a load; the background showing through for that long does not.
        stats.pending += 1
        continue
      }

      this.#drawSource(ctx, entry.element, item, frame)
      stats.drawn += 1
    }

    ctx.restore()
    this.#retireUntouched()
    return stats
  }

  /**
   * Pauses every video element immediately, without waiting for a draw.
   *
   * `#retireUntouched` normally does this as part of compositing, which is fine while
   * frames are arriving. It is not fine when they stop: an occluded window stops
   * `requestAnimationFrame`, so the next draw never comes, and a "stop playing" that is
   * only carried out by the next draw leaves the element running — measured at 4.5 seconds
   * of sound continuing past a frozen picture.
   */
  pauseAll(): void {
    this.#pool.forEach((entry) => {
      const element = entry.element
      if (element instanceof HTMLVideoElement && !element.paused) element.pause()
    })
  }

  /** Drops seek bookkeeping for assets no longer on screen. */
  reset(): void {
    this.#seeks.clear()
    this.#touched.clear()
  }

  // -- internals ------------------------------------------------------------

  #drawSource(
    ctx: RenderTarget,
    element: HTMLVideoElement | HTMLImageElement,
    item: Item,
    frame: number
  ): void {
    const box = layoutBox(item)
    if (!box) return
    const alpha = clamp01(finite(item.layout.opacity, 1) * fadeGainAt(item, frame))
    if (alpha <= 0) return

    ctx.save()
    ctx.globalAlpha = alpha
    applyRotation(ctx, item, box)
    try {
      ctx.drawImage(element, box.left, box.top, box.width, box.height)
    } catch {
      // A frame can be pulled out from under us mid-draw (the element reloaded, the source
      // went away). One missing item must not abandon the rest of the frame.
    }
    ctx.restore()
  }

  /**
   * Text has no styling in the project model yet — only the string. Rather than invent a
   * style system here, this draws the honest minimum: the string fitted to the item's box.
   * When `Asset` grows font/colour/alignment, this reads them instead of guessing.
   */
  #drawText(ctx: RenderTarget, item: Item, asset: Asset, frame: number): void {
    const box = layoutBox(item)
    if (!box) return
    const text = asset.text ?? asset.name
    if (!text) return
    const alpha = clamp01(finite(item.layout.opacity, 1) * fadeGainAt(item, frame))
    if (alpha <= 0) return

    ctx.save()
    ctx.globalAlpha = alpha
    applyRotation(ctx, item, box)
    const size = Math.max(8, Math.round(box.height * 0.4))
    ctx.font = `600 ${size}px system-ui, -apple-system, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    const measured = ctx.measureText(text).width
    if (measured > box.width && measured > 0) {
      const shrink = box.width / measured
      ctx.font = `600 ${Math.max(8, Math.round(size * shrink))}px system-ui, -apple-system, sans-serif`
    }
    ctx.fillText(text, box.left + box.width / 2, box.top + box.height / 2)
    ctx.restore()
  }

  #drawPlaceholder(ctx: RenderTarget, item: Item, name: string): void {
    const box = layoutBox(item)
    if (!box) return
    ctx.save()
    ctx.globalAlpha = clamp01(finite(item.layout.opacity, 1))
    applyRotation(ctx, item, box)
    ctx.fillStyle = PLACEHOLDER_FILL
    ctx.fillRect(box.left, box.top, box.width, box.height)
    ctx.strokeStyle = PLACEHOLDER_EDGE
    ctx.lineWidth = 2
    ctx.strokeRect(box.left + 1, box.top + 1, Math.max(0, box.width - 2), Math.max(0, box.height - 2))
    // A 12px label in a 16px box is unreadable noise; below that the box alone says enough.
    if (box.width > 64 && box.height > 32) {
      ctx.fillStyle = PLACEHOLDER_INK
      ctx.font = `500 ${Math.max(11, Math.min(28, Math.round(box.height * 0.12)))}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.save()
      ctx.beginPath()
      ctx.rect(box.left, box.top, box.width, box.height)
      ctx.clip()
      ctx.fillText(name, box.left + box.width / 2, box.top + box.height / 2)
      ctx.restore()
    }
    ctx.restore()
  }

  /**
   * Puts the element at the source time this item wants, without ever waiting for it.
   *
   * A seek is asynchronous and may take longer than a frame. Issuing one every frame for
   * the same target means the element restarts the seek before finishing it and never
   * arrives, so the outstanding target is remembered and only re-issued when the target
   * moves or the seek goes stale.
   */
  #syncElement(
    entry: MediaEntry,
    item: Item,
    asset: Asset,
    frame: number,
    fps: number,
    mode: 'playback' | 'scrub',
    now: number
  ): void {
    const element = entry.element
    if (!(element instanceof HTMLVideoElement)) return

    const target = sourceSecondsAt(item, asset, frame, fps)
    // Half a frame while scrubbing: closer than that is the same picture, and a seek that
    // lands on the same picture costs a decode for nothing.
    const tolerance = mode === 'playback' ? DRIFT_TOLERANCE_SECONDS : 0.5 / fps

    if (mode === 'playback') {
      element.playbackRate = playbackRateFor(item.speed)
      if (element.paused) {
        // Rejected autoplay is not fatal — the picture still advances by seeking, and the
        // audio engine resumes the context on the next user gesture.
        void element.play().catch(() => {})
      }
    } else if (!element.paused) {
      element.pause()
    }

    const drift = Math.abs(element.currentTime - target)
    if (drift <= tolerance) {
      this.#seeks.delete(asset.id)
      return
    }

    const pending = this.#seeks.get(asset.id)
    const sameTarget = pending !== undefined && Math.abs(pending.targetSeconds - target) <= tolerance
    const stale = pending !== undefined && now - pending.issuedAt > STALE_SEEK_MS
    if (sameTarget && !stale) return

    try {
      element.currentTime = target
      this.#seeks.set(asset.id, { targetSeconds: target, issuedAt: now })
    } catch {
      // Seeking before metadata arrives throws; the next frame retries with metadata.
    }
  }

  /**
   * Pauses video elements that are no longer on screen. A hidden track's items never reach
   * the draw loop, so without this an element left playing keeps decoding — and keeps
   * making sound — for a clip that is not in the picture.
   */
  #retireUntouched(): void {
    this.#pool.forEach((entry) => {
      if (this.#touched.has(entry.assetId)) return
      const element = entry.element
      if (element instanceof HTMLVideoElement && !element.paused) element.pause()
    })
  }
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** A drawable box, or null when the layout cannot produce one. */
function layoutBox(item: Item): Box | null {
  const layout = item.layout
  const width = finite(layout.width, 0)
  const height = finite(layout.height, 0)
  // Zero is a no-op in the spec but negative sizes are a mirror in some engines and an
  // exception in others; neither is what a broken layout means, so neither is drawn.
  if (width <= 0 || height <= 0) return null
  return {
    left: finite(layout.left, 0),
    top: finite(layout.top, 0),
    width,
    height
  }
}

function applyRotation(ctx: RenderTarget, item: Item, box: Box): void {
  const degrees = finite(item.layout.rotation, 0) % 360
  if (degrees === 0) return
  const centreX = box.left + box.width / 2
  const centreY = box.top + box.height / 2
  ctx.translate(centreX, centreY)
  ctx.rotate((degrees * Math.PI) / 180)
  ctx.translate(-centreX, -centreY)
}

/** Exported for the exporter, which needs the same clamping the compositor applies. */
export { clamp, sourceSecondsAt }
