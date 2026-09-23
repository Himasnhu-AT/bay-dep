/**
 * Frames of an HTML composition, cached, for a compositor that cannot wait.
 *
 * `drawFrame` is synchronous — it has to be, because it runs inside a rAF and the export loop
 * calls it in a tight sequence. A composition frame is not: it comes from main, which seeks an
 * offscreen page and reads its pixels back, measured at 40-80ms. So this pool answers from
 * cache **immediately or not at all**, and fills the gap behind the caller's back. That is
 * exactly the contract `MediaPool` already has for a `<video>` that has not decoded yet, and
 * the compositor already knows how to draw nothing for a frame and try again.
 *
 * **The cache key is the exact source microsecond, not a rounded one.** A frame index times a
 * rate produces the same microsecond every time for a given timeline, so scrubbing back over
 * ground already covered hits the cache exactly; quantising to some canonical grid instead
 * would resample 24fps onto 60ths and put 2.5-frame jitter into the picture. The key carries
 * the requested pixel size too, because a preview asking for 960x540 and an export asking for
 * 1920x1080 are different pictures and one must not be served for the other.
 */

import type { Asset, Item } from '@shared/project'
import { sourceTimeAt } from '@shared/project'
import {
  cssVariables,
  resolveVariables,
  variablesKey,
  type CompositionVariable
} from '@shared/composition'
import { bay } from '@/lib/bay'

/**
 * How much decoded composition imagery to keep.
 *
 * Counted in bytes rather than frames because the frames are not one size: 120 preview frames
 * at 960x540 and 30 export frames at 4K are both about this, and a count would let the second
 * case use eight times the memory the first was budgeted for.
 */
const DEFAULT_BUDGET_BYTES = 256 * 1024 * 1024

/**
 * How long to leave a frame alone after it failed to render.
 *
 * Long enough that a composition which cannot render costs a request every two seconds rather
 * than thirty a second; short enough that fixing the composition and scrubbing back shows the
 * repair without restarting anything.
 */
const RETRY_AFTER_MS = 2_000

/**
 * How many frames may be in flight at once.
 *
 * Each is a seek plus a full pixel read-back in main, answered one at a time per composition.
 * Letting a scrub queue fifty of them does not make any of them arrive sooner — it just puts
 * every other IPC message behind them, including the tool calls an agent is waiting on.
 */
const MAX_CONCURRENT_REQUESTS = 2

interface CacheEntry {
  bitmap: ImageBitmap
  bytes: number
  usedAt: number
  /** Asset, size and variables — everything in the key but the time — for finding a held frame. */
  stream: string
  atUs: number
}

/**
 * Live preview only: how far back a decoded frame may stand in for the one asked for. Long
 * enough to cover a capture's 40-80ms and a backlog behind it; short enough that a paused
 * composition never shows a picture from a different moment of its animation for long.
 */
const HOLD_US = 1_000_000

/** Live preview only: how many frames ahead of the playhead to fetch while playing. */
const LOOKAHEAD_FRAMES = 3

/**
 * Live preview only: queued captures beyond this are dropped, oldest first. While playing, a
 * capture for a moment already past is work nobody will see; export and `preview_frame` use
 * their own pools, which queue everything.
 */
const LIVE_QUEUE_LIMIT = 8

type ReadyListener = () => void

export class CompositionPool {
  readonly #cache = new Map<string, CacheEntry>()
  /** Keys currently being fetched, so a miss re-asked every frame asks main once. */
  readonly #inFlight = new Set<string>()
  /**
   * Captures asked for while the pool was at its concurrency cap, keyed like the cache so one
   * picture is only ever queued once. Emptied by `#pump` as slots free up, and waited on by
   * `settle` — a queued capture is outstanding work, and an export that stopped waiting at the
   * in-flight set would write the frame before its compositions arrived.
   */
  readonly #queued = new Map<string, () => void>()
  /**
   * Keys that failed, and when — so a frame that cannot be produced is not re-requested on
   * every redraw.
   *
   * Without this the pool is a denial-of-service attack on its own main process. `#inFlight`
   * only dedupes a request that is still running; the moment one fails it clears, the next
   * redraw asks again, and at 30fps that is thirty IPC round trips a second, forever. Measured
   * consequence: putting the playhead over a composition whose frame could not be produced
   * wedged every MCP call within 1.5 seconds and never recovered, while the renderer itself
   * stayed responsive — so it read as a hung executor rather than as a flood.
   */
  readonly #failedAt = new Map<string, number>()
  readonly #listeners = new Set<ReadyListener>()
  readonly #budgetBytes: number
  #bytes = 0
  #hits = 0
  #misses = 0
  /** Assets this pool has ever opened, so `dispose` can close their windows in main. */
  readonly #opened = new Set<string>()

  /**
   * The preview's pool, as opposed to export's or `preview_frame`'s. They answer "the exact frame
   * or nothing" — a render writes each frame once and waits for it. The preview cannot wait: it
   * draws thirty times a second, and every frame of a playing composition is a new moment that
   * is not in the cache yet, so a pool that answered only exact hits drew the composition only
   * while paused (it was invisible during playback). Live, a miss is answered with the latest
   * frame already decoded for that clip, the newest requests are served first, and frames ahead
   * of the playhead are fetched while playing.
   */
  readonly #live: boolean
  #playing = false

  constructor(options: { budgetBytes?: number; live?: boolean } = {}) {
    this.#budgetBytes = options.budgetBytes ?? DEFAULT_BUDGET_BYTES
    this.#live = options.live === true
  }

  /** The preview tells the pool when playback starts and stops, so it only looks ahead while playing. */
  setPlaying(playing: boolean): void {
    this.#playing = playing
  }

  /**
   * The picture for this item at this frame, if it is already decoded.
   *
   * Returns null on a miss and starts fetching. Callers must treat null as "not yet", never as
   * "nothing here" — drawing a placeholder for it would flash a card for the 40-80ms a fetch
   * takes, which reads as a glitch in the edit rather than as a load.
   */
  frameFor(
    asset: Asset,
    item: Item,
    frame: number,
    fps: number,
    size: { width: number; height: number }
  ): ImageBitmap | null {
    if (asset.kind !== 'html' || !asset.path || !asset.compositionId) return null

    const width = Math.max(1, Math.round(size.width))
    const height = Math.max(1, Math.round(size.height))
    const atUs = clampToAsset(sourceTimeAt(item, frame, fps), asset)
    // The values are part of the identity of the picture. Two lower thirds naming two people
    // are two different frames at the same instant, and a key without them would hand the
    // second clip whatever the first rendered — with nothing looking broken.
    const values = resolveVariables({ variables: asset.compositionVariables ?? [] }, item.variables)
    const variables = variablesKey(values)
    const key = cacheKey(asset.id, width, height, atUs, variables)

    const hit = this.#cache.get(key)
    if (hit) {
      hit.usedAt = performance.now()
      this.#hits += 1
      if (this.#live && this.#playing) this.#lookAhead(asset, item, frame, fps, width, height, values, variables)
      return hit.bitmap
    }

    this.#misses += 1
    const info = { variables: asset.compositionVariables ?? [] }
    this.#request(key, asset, atUs, width, height, values, info)
    if (!this.#live) return null
    if (this.#playing) this.#lookAhead(asset, item, frame, fps, width, height, values, variables)
    return this.#held(streamOf(asset.id, width, height, variables), atUs)
  }

  /** Ask for the next few frames, so they are decoded by the time the playhead reaches them. */
  #lookAhead(
    asset: Asset,
    item: Item,
    frame: number,
    fps: number,
    width: number,
    height: number,
    values: Record<string, string | number | boolean>,
    variables: string
  ): void {
    const info = { variables: asset.compositionVariables ?? [] }
    for (let k = 1; k <= LOOKAHEAD_FRAMES; k++) {
      const atUs = clampToAsset(sourceTimeAt(item, frame + k, fps), asset)
      const key = cacheKey(asset.id, width, height, atUs, variables)
      if (!this.#cache.has(key)) this.#request(key, asset, atUs, width, height, values, info)
    }
  }

  /** The latest decoded frame of this clip at or before `atUs`, within `HOLD_US`; else the nearest after. */
  #held(stream: string, atUs: number): ImageBitmap | null {
    let before: CacheEntry | null = null
    let after: CacheEntry | null = null
    for (const entry of this.#cache.values()) {
      if (entry.stream !== stream) continue
      const gap = atUs - entry.atUs
      if (gap >= 0 && gap <= HOLD_US && (!before || entry.atUs > before.atUs)) before = entry
      if (gap < 0 && -gap <= HOLD_US && (!after || entry.atUs < after.atUs)) after = entry
    }
    const held = before ?? after
    if (held) held.usedAt = performance.now()
    return held?.bitmap ?? null
  }

  /**
   * Resolves when every outstanding request has finished, or after `timeoutMs`.
   *
   * For a caller that cannot simply redraw later — an export writes each frame once and moves
   * on, so "try again next frame" is not available to it. The timeout is not optional: a
   * composition that never produces a frame must cost a missing picture, not a render that
   * never returns.
   */
  settle(timeoutMs: number): Promise<void> {
    // The queue counts. Waiting only on the in-flight set resolved the moment the last two
    // captures finished while six more sat queued, and the caller — an export, which writes a
    // frame once and moves on — took the picture without them.
    if (this.#inFlight.size === 0 && this.#queued.size === 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        off()
        resolve()
      }
      const timer = setTimeout(done, timeoutMs)
      const off = this.onReady(() => {
        if (this.#inFlight.size === 0 && this.#queued.size === 0) done()
      })
    })
  }

  /** Fires when a requested frame has decoded, so the preview can redraw and show it. */
  onReady(listener: ReadyListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  get stats(): {
    entries: number
    bytes: number
    hits: number
    misses: number
    inFlight: number
    failed: number
  } {
    return {
      entries: this.#cache.size,
      bytes: this.#bytes,
      hits: this.#hits,
      misses: this.#misses,
      inFlight: this.#inFlight.size,
      failed: this.#failedAt.size
    }
  }

  /** Drops this asset's frames and closes its window in main. */
  release(assetId: string): void {
    for (const [key, entry] of [...this.#cache]) {
      if (!key.startsWith(`${assetId}:`)) continue
      entry.bitmap.close()
      this.#bytes -= entry.bytes
      this.#cache.delete(key)
    }
    // A queued capture for a released asset would reopen the window this just closed.
    for (const key of [...this.#queued.keys()]) {
      if (key.startsWith(`${assetId}:`)) this.#queued.delete(key)
    }
    if (this.#opened.delete(assetId)) void bay()?.composition.release(assetId)
  }

  dispose(): void {
    for (const entry of this.#cache.values()) entry.bitmap.close()
    this.#cache.clear()
    this.#failedAt.clear()
    this.#queued.clear()
    this.#bytes = 0
    this.#listeners.clear()
    // Every window this pool opened is a renderer process in main. Leaving them behind on a
    // project close is the difference between an editor and a leak with a timeline attached.
    for (const assetId of this.#opened) void bay()?.composition.release(assetId)
    this.#opened.clear()
  }

  #request(
    key: string,
    asset: Asset,
    atUs: number,
    width: number,
    height: number,
    variables: Record<string, string | number | boolean>,
    /** The declarations, needed only to know which numbers carry a unit. */
    info: { variables: CompositionVariable[] }
  ): void {
    if (this.#inFlight.has(key)) return

    // A frame that just failed is not asked for again immediately. The retry is what makes a
    // broken composition expensive rather than merely blank.
    const failed = this.#failedAt.get(key)
    if (failed !== undefined && performance.now() - failed < RETRY_AFTER_MS) return

    // And never more than a couple at once. Each one is a seek and a pixel read-back in main;
    // a scrub across a composition can otherwise ask for fifty frames before the first
    // arrives, and main answers them one at a time while every other IPC message waits.
    //
    // **Queued past that, never dropped.** Returning here is what capped a frame at four
    // compositions however many it needed: `renderFrame` draws, requests what is missing and
    // retries a bounded number of times, so at most `MAX_CONCURRENT_REQUESTS` new pictures
    // could arrive per attempt and the rest were discarded without a trace. Three attempts,
    // two requests each, one of them spent drawing — four. Measured on a timeline of eight
    // identical compositions: four drew, four were reported missing, and asking again for
    // ninety seconds never moved the number, because each attempt threw away the same six
    // requests it had just made. The cap still protects main; the work now waits its turn.
    if (this.#inFlight.size >= MAX_CONCURRENT_REQUESTS) {
      if (!this.#queued.has(key)) {
        this.#queued.set(key, () => this.#start(key, asset, atUs, width, height, variables, info))
        // Live, the oldest queued moments are the ones the playhead has already passed.
        while (this.#live && this.#queued.size > LIVE_QUEUE_LIMIT) {
          const oldest = this.#queued.keys().next()
          if (oldest.done) break
          this.#queued.delete(oldest.value)
        }
      }
      return
    }

    this.#start(key, asset, atUs, width, height, variables, info)
  }

  /** Begin one capture. Only `#request` and `#pump` call this, and only under the cap. */
  #start(
    key: string,
    asset: Asset,
    atUs: number,
    width: number,
    height: number,
    variables: Record<string, string | number | boolean>,
    info: { variables: CompositionVariable[] }
  ): void {
    this.#inFlight.add(key)
    this.#opened.add(asset.id)

    void (async () => {
      try {
        // The bridge is absent before preload lands, and in a browser-only harness. A missing
        // bridge is "not yet", exactly like a frame that has not decoded.
        const api = bay()
        if (!api) return
        const frame = await api.composition.frameAt({
          assetId: asset.id,
          path: asset.path!,
          compositionId: asset.compositionId!,
          atUs,
          width,
          height,
          variables,
          cssVariables: cssVariables(info, variables)
        })
        if (!frame) {
          this.#failedAt.set(key, performance.now())
          return
        }
        const data = new Uint8ClampedArray(frame.data)
        if (data.length !== frame.width * frame.height * 4) {
          this.#failedAt.set(key, performance.now())
          return
        }
        const bitmap = await createImageBitmap(new ImageData(data, frame.width, frame.height))
        this.#failedAt.delete(key)
        this.#store(key, bitmap, data.length, streamOf(asset.id, width, height, variablesKey(variables)), atUs)
      } catch {
        // A frame that cannot be produced is a frame the compositor draws nothing for. It is
        // retried, but only after a pause — see `#failedAt`.
        this.#failedAt.set(key, performance.now())
      } finally {
        // Cleared BEFORE anyone is told, and that order is the whole point. `settle` waits for
        // the in-flight set to empty and is woken by this notification; notifying first means
        // its listener always sees the request still outstanding, so it never resolves early
        // and waits out its full timeout instead. On an export that is five seconds a frame —
        // an export that never finishes rather than one that is merely slow.
        this.#inFlight.delete(key)
        // Start the next queued capture before telling anyone, so a waiter woken by this
        // notification sees the work already moving rather than an idle pool with a backlog.
        this.#pump()
        // Told on failure too, for the same reason: a waiter blocked on a frame that will
        // never arrive should learn that as soon as it is known, not on a timeout.
        for (const listener of this.#listeners) listener()
      }
    })()
  }

  /** Start queued captures up to the concurrency cap. */
  #pump(): void {
    while (this.#inFlight.size < MAX_CONCURRENT_REQUESTS && this.#queued.size > 0) {
      // Live, newest first: the playhead is at the latest request, not the earliest. A render
      // needs every queued frame and serves them in order.
      const next = this.#live ? [...this.#queued.entries()].at(-1) : this.#queued.entries().next().value
      if (!next) return
      const [key, begin] = next
      this.#queued.delete(key)
      // A picture that arrived while this was waiting needs no capture at all.
      if (this.#cache.has(key) || this.#inFlight.has(key)) continue
      begin()
    }
  }

  #store(key: string, bitmap: ImageBitmap, bytes: number, stream: string, atUs: number): void {
    const existing = this.#cache.get(key)
    if (existing) {
      existing.bitmap.close()
      this.#bytes -= existing.bytes
    }
    this.#cache.set(key, { bitmap, bytes, usedAt: performance.now(), stream, atUs })
    this.#bytes += bytes
    this.#evictToBudget()
  }

  /**
   * Evict least-recently-used until the cache is inside its budget.
   *
   * Sorted by `usedAt`, which is stamped on every hit rather than only on insert. Evicting by
   * insertion order instead would throw away the frame the playhead is parked on the moment a
   * scrub filled the cache past the budget — the one frame guaranteed to be asked for again.
   */
  #evictToBudget(): void {
    if (this.#bytes <= this.#budgetBytes) return
    const byAge = [...this.#cache.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt)
    for (const [key, entry] of byAge) {
      if (this.#bytes <= this.#budgetBytes) break
      entry.bitmap.close()
      this.#bytes -= entry.bytes
      this.#cache.delete(key)
    }
  }
}

/** Everything that identifies a clip's pictures except the moment: which frames can stand in for each other. */
function streamOf(assetId: string, width: number, height: number, variables: string): string {
  return `${assetId}:${width}x${height}:${variables}`
}

export function cacheKey(
  assetId: string,
  width: number,
  height: number,
  atUs: number,
  variables = ''
): string {
  return `${assetId}:${width}x${height}:${atUs}:${variables}`
}

/**
 * A source time inside the composition.
 *
 * `sourceTimeAt` clamps to the asset for media, but a composition's timeline holds its last
 * frame past its end rather than erroring, so an unclamped value would open a distinct cache
 * entry for every frame past the end — all of them the same picture.
 */
export function clampToAsset(atUs: number, asset: Asset): number {
  if (!Number.isFinite(atUs) || atUs < 0) return 0
  return asset.durationUs > 0 ? Math.min(atUs, asset.durationUs) : 0
}
