/**
 * Subject matte frames, cached, for a compositor that cannot wait.
 *
 * A matte frame lives in a pack in main's cache (`main/matte/pack.ts`): one Range request through
 * `bay://` for its bytes, one `DecompressionStream('deflate-raw')` for its 8-bit alpha, and an
 * `ImageBitmap` whose alpha is the matte. That is async and `drawFrame` is not, so this answers
 * **from cache or not at all** and fetches behind the caller's back — the contract `MediaPool`
 * and `CompositionPool` already have, so the compositor's "pending, draw again" path covers it:
 * export and `preview_frame` wait on `settle`, the preview redraws on `onReady`.
 *
 * Exact in every consumer: a frame is the one whose timestamp is at or before the asked source
 * time (`matteFrameIndex`), never "the nearest one loaded". A stale matte under a moving head is
 * a halo that slides against the picture, which is the fault the shared element exists to
 * prevent. During playback the frames ahead are fetched so the exact one is usually there; when it
 * is not the item is pending and the preview's picture hold covers the frame.
 *
 * One store for the app (`subjectMattes`), like `brfRuntime`, so the three consumers share what
 * has been decoded. The loader is injectable for the node tests.
 */

import { matteFrameIndex, type SubjectMatte, type SubjectMatteIndex } from '@shared/matte'
import { bay } from '@/lib/bridge'

/** A decoded matte frame: a drawable whose alpha channel is the matte, at the matte's own size. */
export interface MatteImage {
  image: CanvasImageSource
  width: number
  height: number
  close?(): void
}

export interface MatteLoader {
  index(key: string): Promise<{ ok: true; index: SubjectMatteIndex } | { ok: false; error: string }>
  frame(index: SubjectMatteIndex, i: number): Promise<MatteImage>
}

export type MatteLookup =
  | { image: MatteImage; frame: number }
  | { pending: true }
  /** Outside the pack (`missing`) or unreadable (`error`) — a placeholder, never an unmasked draw. */
  | { missing: string }
  | { error: string }

/** Decoded frames kept: 512×384×4 bytes each, so ~64 MB. */
const MAX_FRAMES = 160
/** A pack or frame that failed is not asked for again for this long. */
const RETRY_AFTER_MS = 2_000

type IndexState = { state: 'loading' } | { state: 'ready'; index: SubjectMatteIndex } | { state: 'error'; error: string; at: number }

export class MatteStore {
  #loader: MatteLoader
  readonly #indexes = new Map<string, IndexState>()
  readonly #frames = new Map<string, MatteImage>()
  readonly #inflight = new Set<string>()
  readonly #failed = new Map<string, { error: string; at: number }>()
  readonly #listeners = new Set<() => void>()
  readonly #idle: (() => void)[] = []

  constructor(loader: MatteLoader) {
    this.#loader = loader
  }

  /** Tests: a loader of their own, and nothing cached from before. */
  useLoader(loader: MatteLoader): void {
    this.#loader = loader
    this.reset()
  }

  reset(): void {
    for (const frame of this.#frames.values()) frame.close?.()
    this.#frames.clear()
    this.#indexes.clear()
    this.#inflight.clear()
    this.#failed.clear()
  }

  /**
   * The matte frame of `record` showing at `sourceUs`, if it is decoded. `ahead` frames after it are
   * fetched too (playback), and so is the frame itself when it is not there yet.
   */
  lookup(record: SubjectMatte, sourceUs: number, options: { ahead?: number } = {}): MatteLookup {
    const state = this.#indexes.get(record.key)
    if (!state) {
      this.#loadIndex(record.key)
      return { pending: true }
    }
    if (state.state === 'loading') return { pending: true }
    if (state.state === 'error') {
      if (Date.now() - state.at > RETRY_AFTER_MS) {
        this.#indexes.delete(record.key)
        this.#loadIndex(record.key)
        return { pending: true }
      }
      return { error: state.error }
    }
    const index = state.index
    const i = matteFrameIndex(index.ptsUs, sourceUs)
    if (i < 0) {
      return { missing: `${(sourceUs / 1e6).toFixed(3)} s is outside the subject matte (${(index.fromUs / 1e6).toFixed(2)}–${(index.toUs / 1e6).toFixed(2)} s)` }
    }
    for (let k = 1; k <= (options.ahead ?? 0) && i + k < index.ptsUs.length; k += 1) this.#loadFrame(index, i + k)
    const key = `${index.key}#${i}`
    const held = this.#frames.get(key)
    if (held) {
      // Most recently used last: the map's order is the eviction order.
      this.#frames.delete(key)
      this.#frames.set(key, held)
      return { image: held, frame: i }
    }
    const failed = this.#failed.get(key)
    if (failed && Date.now() - failed.at <= RETRY_AFTER_MS) return { error: failed.error }
    this.#loadFrame(index, i)
    return { pending: true }
  }

  /** Resolves when nothing is being fetched, or after `timeoutMs`. */
  settle(timeoutMs: number): Promise<void> {
    if (this.#inflight.size === 0) return Promise.resolve()
    return new Promise((resolve) => {
      const idle = this.#idle
      const timer = setTimeout(done, timeoutMs)
      function done(): void {
        clearTimeout(timer)
        const at = idle.indexOf(done)
        if (at >= 0) idle.splice(at, 1)
        resolve()
      }
      idle.push(done)
    })
  }

  onReady(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  get stats(): { indexes: number; frames: number; inflight: number } {
    return { indexes: this.#indexes.size, frames: this.#frames.size, inflight: this.#inflight.size }
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
    if (this.#inflight.size === 0) for (const done of [...this.#idle]) done()
  }

  #loadIndex(key: string): void {
    const flight = `index:${key}`
    if (this.#inflight.has(flight)) return
    this.#inflight.add(flight)
    this.#indexes.set(key, { state: 'loading' })
    void this.#loader
      .index(key)
      .then(
        (answer) => {
          this.#indexes.set(key, answer.ok ? { state: 'ready', index: answer.index } : { state: 'error', error: answer.error, at: Date.now() })
        },
        (error: unknown) => {
          this.#indexes.set(key, { state: 'error', error: error instanceof Error ? error.message : String(error), at: Date.now() })
        }
      )
      .finally(() => {
        this.#inflight.delete(flight)
        this.#notify()
      })
  }

  #loadFrame(index: SubjectMatteIndex, i: number): void {
    const key = `${index.key}#${i}`
    if (this.#frames.has(key) || this.#inflight.has(key)) return
    const failed = this.#failed.get(key)
    if (failed && Date.now() - failed.at <= RETRY_AFTER_MS) return
    this.#inflight.add(key)
    void this.#loader
      .frame(index, i)
      .then(
        (image) => {
          this.#failed.delete(key)
          this.#frames.set(key, image)
          while (this.#frames.size > MAX_FRAMES) {
            const oldest = this.#frames.keys().next().value as string
            this.#frames.get(oldest)?.close?.()
            this.#frames.delete(oldest)
          }
        },
        (error: unknown) => {
          this.#failed.set(key, { error: `the subject matte could not be read (${error instanceof Error ? error.message : String(error)})`, at: Date.now() })
        }
      )
      .finally(() => {
        this.#inflight.delete(key)
        this.#notify()
      })
  }
}

/** 8-bit alpha to RGBA with that alpha and white colour: what `destination-in` reads. */
export function alphaToRgba(alpha: Uint8Array, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let i = 0, o = 0; i < width * height; i += 1, o += 4) {
    out[o] = 255
    out[o + 1] = 255
    out[o + 2] = 255
    out[o + 3] = alpha[i] ?? 0
  }
  return out
}

/** Raw-deflated bytes back to what was deflated. */
export async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** The app's loader: the index over IPC, each frame's bytes through `bay://` with a Range request. */
export const bridgeLoader: MatteLoader = {
  async index(key) {
    const api = bay()
    if (!api) return { ok: false, error: 'this window has no bridge to main, so it cannot read subject mattes' }
    return api.media.subjectMatteIndex(key)
  },
  async frame(index, i) {
    const offset = index.offsets[i]
    const length = index.lengths[i]
    if (offset === undefined || length === undefined) throw new Error(`frame ${i} is not in the matte`)
    const response = await fetch(index.url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } })
    if (!response.ok) throw new Error(`bay:// answered ${response.status}`)
    const alpha = await inflateRaw(new Uint8Array(await response.arrayBuffer()))
    if (alpha.length !== index.width * index.height) throw new Error(`frame ${i} inflated to ${alpha.length} bytes, not ${index.width * index.height}`)
    const data = new ImageData(alphaToRgba(alpha, index.width, index.height), index.width, index.height)
    const bitmap = await createImageBitmap(data, { premultiplyAlpha: 'premultiply' })
    return { image: bitmap, width: index.width, height: index.height, close: () => bitmap.close() }
  }
}

export const subjectMattes = new MatteStore(bridgeLoader)
