/**
 * A pool of media elements, one per asset, created on first use and reused after that.
 *
 * Three things this exists to prevent:
 *
 * 1. **An element per frame.** Constructing a `<video>` and pointing it at a file starts a
 *    decoder, a network (here, protocol) read and a demux. Doing that inside a draw loop is
 *    the classic way this design dies: the picture never arrives, because nothing survives
 *    long enough to decode.
 * 2. **A decoder per clip.** A 200-clip timeline must not open 200 decoders, so live video
 *    elements are capped and the least recently used are torn down. Audio and images are
 *    cheap and are not capped.
 * 3. **Eviction under the audio graph's feet.** A `MediaElementAudioSourceNode` is bound to
 *    one element for life; if the pool drops that element without saying so, the graph keeps
 *    a node wired to a corpse. Hence `onEvict`.
 *
 * The pool answers "not yet decoded" and "nothing to draw" as different states
 * (`readiness`), because the compositor must respond to them differently: the first is a
 * frame to wait for, the second is a placeholder to draw.
 */

import type { Asset, AssetKind } from '@shared/project'

/** Live `<video>` elements. Chosen as a cap, not measured — raise it with a measurement. */
export const DEFAULT_MAX_VIDEO_ELEMENTS = 12

export type MediaStatus =
  /** Element exists, has not produced anything drawable yet. */
  | 'loading'
  /** Has at least one decoded picture (or, for audio, enough data to play). */
  | 'ready'
  /** The source could not be read. Never becomes 'ready' without a new src. */
  | 'error'
  /** This asset has no element by design — text is drawn, not loaded. */
  | 'none'

export type PoolElement = HTMLVideoElement | HTMLAudioElement | HTMLImageElement

export interface MediaEntry {
  assetId: string
  /**
   * Which of this asset's elements this is.
   *
   * Almost always 0: one decoder per asset, reused across time, which is the whole point of
   * a pool. It is non-zero only when one asset must be shown at **two source times in the
   * same frame** — a transition between two halves of a split clip, which is the commonest
   * transition there is. One element cannot be at two times at once, so that case needs two.
   */
  slot: number
  kind: AssetKind
  /** Null for `kind: 'text'` and for assets that failed to probe. */
  element: PoolElement | null
  status: MediaStatus
  error?: string
}

export interface MediaReadiness {
  status: MediaStatus
  /** True when a `drawImage` right now would put pixels on the canvas. */
  hasPicture: boolean
  error?: string
}

interface PoolSlot extends MediaEntry {
  /** `assetId` for slot 0, `assetId#n` beyond it. The map key, kept for eviction. */
  key: string
  /** Monotonic counter; the eviction order. */
  lastUsed: number
  /** Which draw generation last touched this, so the frame in flight is never evicted. */
  generation: number
  /** Set once we have retried without `crossOrigin`; the retry happens at most once. */
  retriedWithoutCors: boolean
  detach: () => void
}

export type EvictListener = (entry: MediaEntry) => void
export type ReadyListener = (entry: MediaEntry) => void

/**
 * The URL a media element loads from. The main process serves files over the `bay://`
 * protocol; the renderer never sees a filesystem path in a `src`.
 *
 * The shape — `bay://media/<base64url of the absolute path>` — is the mirror of
 * `mediaUrl()` in `src/main/serve.ts`, which cannot be imported here: it lives in the other
 * tsconfig. This is the only place in the engine that builds one, so a change to the scheme
 * is a change to these four lines and the decoder. `serve.test.ts` asserts the two agree,
 * from that side.
 */
export function assetUrl(asset: Asset): string | null {
  if (!asset.path) return null
  return `bay://media/${base64url(asset.path)}`
}

function base64url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  // A path with a character outside Latin-1 (any non-ASCII filename) breaks `btoa`
  // directly, so the UTF-8 bytes go through one at a time.
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * The pool's map key. Slot 0 keys on the bare asset id so that every existing caller — and
 * every probe reading `peek(assetId)` — is unaffected by slots existing at all.
 */
function elementKey(assetId: string, slot: number): string {
  return slot === 0 ? assetId : `${assetId}#${slot}`
}

function elementKindFor(asset: Asset): 'video' | 'audio' | 'image' | null {
  switch (asset.kind) {
    case 'text':
      return null
    case 'image':
    case 'gif':
      return 'image'
    case 'audio':
      return 'audio'
    case 'video':
      // A "video" file with no video stream is an audio file in a video container; giving
      // it a <video> would waste a decoder slot on something that will never draw.
      return asset.hasVideo ? 'video' : 'audio'
  }
}

export class MediaPool {
  readonly #slots = new Map<string, PoolSlot>()
  readonly #evictListeners = new Set<EvictListener>()
  readonly #readyListeners = new Set<ReadyListener>()
  readonly #maxVideoElements: number
  #clock = 0
  #generation = 0

  constructor(options: { maxVideoElements?: number } = {}) {
    this.#maxVideoElements = Math.max(1, options.maxVideoElements ?? DEFAULT_MAX_VIDEO_ELEMENTS)
  }

  /**
   * Marks the start of a new draw. Anything acquired after this call is off-limits to
   * eviction until the next one — otherwise a timeline with more than the cap of
   * simultaneous clips would evict the element it is about to draw.
   */
  beginGeneration(): void {
    this.#generation += 1
  }

  get generation(): number {
    return this.#generation
  }

  /**
   * The element for `asset`, creating one on first use.
   *
   * `slot` selects *which* of the asset's elements. Callers that only ever need the asset at
   * one time per frame — the audio graph, a single clip — leave it at 0 and behave exactly as
   * before. A caller drawing the same asset twice in one frame at different source times must
   * pass distinct slots, or the two writers fight over one `currentTime` and neither seek ever
   * lands: measured as a permanently blank frame, not a degraded one.
   */
  acquire(asset: Asset, slot = 0): MediaEntry {
    const key = elementKey(asset.id, slot)
    const existing = this.#slots.get(key)
    if (existing) {
      existing.lastUsed = ++this.#clock
      existing.generation = this.#generation
      return existing
    }
    const created = this.#create(asset, slot, key)
    this.#slots.set(key, created)
    this.#evictIfOverCap()
    return created
  }

  /** The entry for an asset if one exists, without creating or touching its LRU position. */
  peek(assetId: string, slot = 0): MediaEntry | undefined {
    return this.#slots.get(elementKey(assetId, slot))
  }

  readiness(assetId: string, slot = 0): MediaReadiness {
    const entry = this.#slots.get(elementKey(assetId, slot))
    if (!entry) return { status: 'loading', hasPicture: false }
    return {
      status: entry.status,
      hasPicture: hasPicture(entry.element),
      ...(entry.error === undefined ? {} : { error: entry.error })
    }
  }

  /**
   * Warms elements for assets that are about to be needed. Deliberately not a promise: a
   * caller that awaits a preload is a caller that blocks a draw on a decode.
   */
  preload(assets: Iterable<Asset>): void {
    for (const asset of assets) this.acquire(asset)
  }

  /** Drops one element. Without `slot`, every element of the asset goes. */
  release(assetId: string, slot?: number): void {
    if (slot !== undefined) {
      const one = this.#slots.get(elementKey(assetId, slot))
      if (one) this.#evict(one)
      return
    }
    for (const entry of [...this.#slots.values()]) {
      if (entry.assetId === assetId) this.#evict(entry)
    }
  }

  /**
   * Pauses video elements that no consumer asked for this generation.
   *
   * "Consumer" is the whole point, and it is why this lives on the pool rather than in the
   * compositor. An element is idle only when *neither* the picture nor the sound wants it,
   * and the compositor alone cannot know that: a hidden video track never reaches the draw
   * loop, so a sweep driven by the draw loop pauses the element — and a paused element is
   * silent however correctly the audio graph is wired. Hiding a track to see what is under
   * it would change the mix you are judging.
   *
   * `acquire` stamps the current generation, so both consumers vote simply by asking for
   * the asset. A hidden track whose clip has no audio is asked for by nobody and is still
   * retired, which is the decode leak this sweep exists to prevent.
   *
   * Call it after every consumer has run, not inside one of them.
   */
  retireIdle(): void {
    for (const slot of this.#slots.values()) {
      if (slot.generation === this.#generation) continue
      const element = slot.element
      if (element instanceof HTMLVideoElement && !element.paused) element.pause()
    }
  }

  forEach(visit: (entry: MediaEntry) => void): void {
    for (const slot of this.#slots.values()) visit(slot)
  }

  /**
   * Fires when an element becomes drawable — decoded, or finished seeking.
   *
   * This exists because media readiness is the one input to the picture that is not a
   * store change, a clock tick or a resize, and those are the only things that schedule a
   * draw. Without it a frame that found its media still loading draws the background,
   * returns `pending`, and nothing ever asks again: the preview stays black over a clip
   * that loaded correctly milliseconds later. Measured, in the running app, as a timeline
   * with one ready clip and a canvas of exactly one colour.
   */
  onReady(listener: ReadyListener): () => void {
    this.#readyListeners.add(listener)
    return () => this.#readyListeners.delete(listener)
  }

  onEvict(listener: EvictListener): () => void {
    this.#evictListeners.add(listener)
    return () => this.#evictListeners.delete(listener)
  }

  dispose(): void {
    for (const slot of [...this.#slots.values()]) this.#evict(slot)
    this.#evictListeners.clear()
    this.#readyListeners.clear()
  }

  // -- internals ------------------------------------------------------------

  #create(asset: Asset, slotIndex: number, key: string): PoolSlot {
    const kind = elementKindFor(asset)
    const url = assetUrl(asset)

    const base = {
      assetId: asset.id,
      slot: slotIndex,
      key,
      kind: asset.kind,
      lastUsed: ++this.#clock,
      generation: this.#generation,
      retriedWithoutCors: false
    }

    if (kind === null) {
      return { ...base, element: null, status: 'none', detach: () => {} }
    }
    if (asset.error || !url) {
      return {
        ...base,
        element: null,
        status: 'error',
        error: asset.error ?? 'This asset has no file to read.',
        detach: () => {}
      }
    }

    const element: PoolElement =
      kind === 'image'
        ? document.createElement('img')
        : kind === 'video'
          ? document.createElement('video')
          : document.createElement('audio')

    const slot: PoolSlot = { ...base, element, status: 'loading', detach: () => {} }

    // `bay://` is a different origin from the document, so a media element loaded from it
    // taints any canvas it is drawn into and `getImageData` throws — which would fail the
    // export at readback, after every frame already looked right on screen. Asking for an
    // anonymous (CORS) load is what keeps the canvas clean. If the protocol handler does
    // not send `Access-Control-Allow-Origin`, that same request *fails*, so the error
    // handler retries once without it: preview keeps working and only export is affected,
    // which is a better failure than a blank window.
    element.crossOrigin = 'anonymous'

    if (element instanceof HTMLImageElement) {
      element.decoding = 'async'
    } else {
      element.preload = 'auto'
      // The audio engine routes every element through the graph. Until it does, an element
      // playing here would be a second, unmixed copy of the sound.
      element.volume = 1
      element.autoplay = false
      if (element instanceof HTMLVideoElement) element.playsInline = true
    }

    const onReady = (): void => {
      slot.status = 'ready'
      delete slot.error
      this.#announceReady(slot)
    }
    // A completed seek is the second way an element becomes drawable, and it is the one
    // that bites at a standing playhead: `readyState` drops below HAVE_CURRENT_DATA while
    // a seek is in flight, so the frame that asked for it draws nothing.
    const onSeeked = (): void => this.#announceReady(slot)
    const onError = (): void => {
      if (!slot.retriedWithoutCors && element.crossOrigin !== null) {
        // The protocol handler sends `Access-Control-Allow-Origin`, so this should never
        // run. If it does, media still loads — but the canvas is tainted and every export
        // will fail at `getImageData`, long after the frames looked right on screen. That
        // is worth saying out loud rather than absorbing into a working-looking preview.
        console.warn(
          `[bay] ${asset.name} would not load as a CORS request; retrying without it. ` +
            'Export readback will fail until the bay:// handler sends access-control-allow-origin.'
        )
        slot.retriedWithoutCors = true
        element.crossOrigin = null
        element.src = url
        if (!(element instanceof HTMLImageElement)) element.load()
        return
      }
      slot.status = 'error'
      slot.error = `${asset.name} could not be read.`
    }

    const readyEvent = element instanceof HTMLImageElement ? 'load' : 'loadeddata'
    element.addEventListener(readyEvent, onReady)
    element.addEventListener('error', onError)
    if (element instanceof HTMLVideoElement) element.addEventListener('seeked', onSeeked)
    slot.detach = () => {
      element.removeEventListener(readyEvent, onReady)
      element.removeEventListener('error', onError)
      if (element instanceof HTMLVideoElement) element.removeEventListener('seeked', onSeeked)
    }

    element.src = url
    if (!(element instanceof HTMLImageElement)) element.load()
    return slot
  }

  #announceReady(slot: PoolSlot): void {
    for (const listener of this.#readyListeners) listener(slot)
  }

  #evictIfOverCap(): void {
    const videos: PoolSlot[] = []
    for (const slot of this.#slots.values()) {
      if (slot.element instanceof HTMLVideoElement) videos.push(slot)
    }
    if (videos.length <= this.#maxVideoElements) return

    videos.sort((a, b) => a.lastUsed - b.lastUsed)
    let excess = videos.length - this.#maxVideoElements
    for (const slot of videos) {
      if (excess <= 0) break
      // Never take the element the frame in flight is about to draw.
      if (slot.generation === this.#generation) continue
      this.#evict(slot)
      excess -= 1
    }
  }

  #evict(slot: PoolSlot): void {
    this.#slots.delete(slot.key)
    // Listeners first: the audio graph has to let go of the element before it dies.
    for (const listener of this.#evictListeners) listener(slot)
    slot.detach()
    const element = slot.element
    if (element && !(element instanceof HTMLImageElement)) {
      element.pause()
      // `removeAttribute` alone leaves the decoder alive in Chromium; the reload against an
      // empty src is what releases it.
      element.removeAttribute('src')
      element.load()
    } else if (element instanceof HTMLImageElement) {
      element.removeAttribute('src')
    }
  }
}

function hasPicture(element: PoolElement | null): boolean {
  if (!element) return false
  if (element instanceof HTMLImageElement) return element.complete && element.naturalWidth > 0
  if (element instanceof HTMLVideoElement) {
    return element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && element.videoWidth > 0
  }
  return false
}

/** True when this entry can be handed to `drawImage`. */
export function isDrawable(entry: MediaEntry): entry is MediaEntry & {
  element: HTMLVideoElement | HTMLImageElement
} {
  return hasPicture(entry.element)
}
