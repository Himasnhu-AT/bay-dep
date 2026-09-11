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
   * issue competing seeks every frame and neither would ever land.
   *
   * Keying alone did **not** achieve that, and the gap was measured rather than argued: two
   * items on one asset wanting 20s and 0s put the element into a permanent seek thrash —
   * each frame re-issued the other's target, `readyState` sat at HAVE_METADATA with
   * `seeking` true, every item reported `pending`, and **the compositor drew nothing at
   * all, for ever**. Not "the lower one shows a stale frame", which is what this comment
   * used to claim: a blank canvas that no `redraw()` could repair. Make the targets agree
   * and the picture returns; make them differ and it vanishes again.
   *
   * The first fix for that was one writer per asset: the topmost item moved the element and
   * everything else painted what it held. That stopped the blank canvas and left a lie in
   * its place — the outgoing clip showing the incoming clip's frame — which is invisible
   * until two items on one asset are both *meant* to be seen. A dissolve between two halves
   * of a split clip is exactly that, and it is the commonest transition there is.
   *
   * So the pool now holds an element **per (asset, slot)** and {@link elementSlots} gives
   * each item in a frame its own. Every item moves its own element; there is still exactly
   * one writer per element, which is what the thrash needed. This map is keyed by element
   * rather than by asset for the same reason — two independent seeks must not overwrite each
   * other's outstanding target.
   *
   * **The hazard is a property of the frame, not of the project, and that distinction cost
   * most of the time spent finding this.** A project holding *one* clip is not safe: placing
   * that same clip a second time is an ordinary edit, and the moment both items sit under
   * the playhead there are two targets for one element. The repro everyone chased looked
   * like a single-item timeline because the *fixture on disk* held one item — measured at
   * the instant the canvas went blank, the timeline held two, both on the same asset, at
   * 20s and 0s. Nothing about a one-item file prevents this; only a one-item *frame* does.
   *
   * A one-item *frame* really is safe, and that is measured rather than assumed: on the
   * pre-fix build, against a one-item fixture, a probe that places nothing drew every time
   * (8/8), while a probe that places the same clip again failed intermittently — 3 of 8 in
   * one run of trials and 9 of 10 in another. Intermittent because it is a race: the loser
   * of the seek fight is whichever draw happens to catch the element mid-seek, which is why
   * this looked unreproducible for an afternoon.
   *
   * **The reload is not the trigger, and that was measured directly rather than inferred**,
   * because the probes both reload *and* place and so cannot tell the two apart. Driven over
   * a debugger with the handle already primed, so that nothing forced a page load: eight
   * consecutive reloads with nothing placed drew all eight times, and then placing one extra
   * item of the same asset — with no reload anywhere — blanked the canvas immediately. One
   * variable at a time is the only way this question has an answer.
   *
   * The blank also *latches*, which is the part that makes it look like a dead engine rather
   * than a race: the seek fight means every draw catches the element mid-seek and draws
   * nothing, and once the fight settles there is no further `seeked` to fire, so nothing
   * schedules the draw that would finally paint it. Measured sitting at `readyState` 4,
   * `seeking` false, on the topmost item's target, with the canvas still empty four seconds
   * later.
   *
   * One ordering trap for whoever measures this next: a probe reloads *first* (restoring the
   * file's single item) and places its second item *after*, so the frame it measures holds
   * two — and if you then attach again to inspect, that second reload restores the file and
   * the placed item is gone before you can see it. Read the timeline in the same evaluation
   * as the pixels, or the evidence destroys itself.
   */
  readonly #seeks = new Map<string, SeekState>()

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

    const width = Math.max(1, finite(timeline.width, 1))
    const height = Math.max(1, finite(timeline.height, 1))
    const fps = finite(timeline.fps, 30) > 0 ? timeline.fps : 30

    ctx.save()
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = timeline.background || '#000000'
    ctx.fillRect(0, 0, width, height)

    // itemsAtFrame already returns lowest track first, so painting in order is the stack.
    const drawing = itemsAtFrame(timeline, frame, 'video')
    // Decided before any of them is drawn: one element cannot be at two source times, so an
    // asset drawn twice in one frame gets two elements. See `elementSlots`.
    const slots = elementSlots(drawing)

    for (const item of drawing) {
      const asset = findAsset(project, item.assetId)
      if (!asset || asset.error) {
        this.#drawPlaceholder(ctx, item, asset?.name ?? 'Missing media')
        stats.placeholders += 1
        continue
      }

      const entry = this.#pool.acquire(asset, slots.get(item.id) ?? 0)

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

      // Every item now has an element of its own, so every item moves its own — which is
      // what lets two source times coexist in one frame. The bookkeeping that made this
      // safe is in `elementSlots`: one writer per element, still.
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
    // No retire sweep here. Pausing what the *picture* did not use would silence a hidden
    // track, and `hidden` governs picture only. `MediaPool.retireIdle()` does it once both
    // consumers have voted — see the engine.
    return stats
  }

  /**
   * Pauses every video element immediately, without waiting for a draw.
   *
   * The generation sweep normally handles this while frames are arriving. It is not
   * enough when they stop: an occluded window stops
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

    // Keyed by element, not by asset. With two elements for one asset the two seeks are
    // independent, and a shared key would have each overwrite the other's outstanding
    // target — re-issuing both every frame, which is the thrash this bookkeeping prevents.
    const seekKey = `${entry.assetId}#${entry.slot}`

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
      this.#seeks.delete(seekKey)
      return
    }

    const pending = this.#seeks.get(seekKey)
    const sameTarget = pending !== undefined && Math.abs(pending.targetSeconds - target) <= tolerance
    const stale = pending !== undefined && now - pending.issuedAt > STALE_SEEK_MS
    if (sameTarget && !stale) return

    try {
      element.currentTime = target
      this.#seeks.set(seekKey, { targetSeconds: target, issuedAt: now })
    } catch {
      // Seeking before metadata arrives throws; the next frame retries with metadata.
    }
  }

}


/**
 * Which of an asset's elements each item draws from, for the items in one frame.
 *
 * This replaces the one-owner-per-asset rule rather than refining it. That rule stopped the
 * seek thrash by letting a single item move the element and having the rest draw whatever it
 * held — correct as a way of not being permanently blank, and *wrong* as behaviour the moment
 * two items on one asset are both meant to be visible. A transition between two halves of a
 * split clip is exactly that, and it is the commonest transition there is: under the old rule
 * the outgoing half shows the incoming half's frame, so a dissolve dissolves into itself.
 *
 * So each item gets its own element instead. The nth item drawing a given asset in a frame
 * takes slot n, in draw order — which makes the assignment **stable**: `itemsAtFrame` returns
 * lowest track first and items within a track sorted by `from`, so the outgoing clip keeps
 * slot 0 across the whole transition while the incoming one holds slot 1. An assignment that
 * flipped between frames would swap what each element holds and reintroduce the thrash by a
 * different route.
 *
 * Slot 0 is the overwhelmingly common answer, and it keys the pool on the bare asset id, so
 * nothing changes for a timeline without overlaps.
 */
export function elementSlots(items: Item[]): Map<string, number> {
  const slots = new Map<string, number>()
  const used = new Map<string, number>()
  for (const item of items) {
    const next = used.get(item.assetId) ?? 0
    slots.set(item.id, next)
    used.set(item.assetId, next + 1)
  }
  return slots
}

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The destination rectangle `drawImage` is given, in timeline coordinates, or null when the
 * layout cannot produce one.
 *
 * Exported because it is the whole of the compositor's placement arithmetic and it is worth
 * pinning. A `coverLayout` for a portrait clip in a landscape project legitimately produces a
 * negative `top` and a `height` three times the canvas — the image is meant to overflow on
 * both sides — and that shape looks wrong enough that three people have now read it as a bug.
 * The rect goes to `drawImage` unclamped, on purpose: clamping it into the canvas is what
 * would actually break cover framing.
 */
export function layoutBox(item: Item): Box | null {
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
