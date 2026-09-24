/**
 * The project's imported fonts (`kind: 'font'` assets), registered with the editor document.
 *
 * Each font asset becomes one `FontFace` in `document.fonts`, loading from bay's copy of the file
 * over `bay://`, with the descriptors main read from its tables (`@shared/fonts`). From there:
 *
 * - **Text items** draw in it by naming its family — canvas resolves families through
 *   `document.fonts`, the same as it does the fonts bay bundles.
 * - **`.brf` text** draws in it the same way, and with `variations` the face registry
 *   (`brfFonts.ts`) clones it per axis setting from the source this module reports — so an
 *   imported variable font takes any `wdth`/`wght`/own axis, which `local()` never could reliably.
 * - **HTML compositions** cannot load `bay://` (their sandbox allows only their own folder), so
 *   `compositionFonts()` hands main the file paths and main injects them as `data:` faces.
 *
 * A face that is still loading makes whatever needs it *pending*, never drawn in a fallback:
 * a substituted face is the fault with no visual cue at all. Export and `preview_frame` wait on
 * `settle`, like every other source.
 */

import type { Asset, FontInfo } from '@shared/project'
import { faceDescriptors, faceSource, importedFonts as fontAssets } from '@shared/fonts'
import { assetUrl } from './mediaPool'
import type { FaceSource } from './brfFonts'

/** One face as a composition window needs it: main reads `path` and inlines it. */
export interface CompositionFont {
  family: string
  path: string
  weight: string
  stretch: string
  style: string
  format: FontInfo['format']
}

/** What registering needs from the page — injected, so the bookkeeping runs under Node. */
export interface FaceEnv {
  /** Registers a face and resolves once it is usable; the handle removes it again. */
  load(family: string, source: string, descriptors: Record<string, string>): { handle: unknown; loaded: Promise<void> }
  remove(handle: unknown): void
}

type Entry = {
  assetId: string
  key: string
  family: string
  source: FaceSource
  font: CompositionFont
  handle: unknown
  state: 'loading' | 'ready' | 'failed'
  error?: string
}

export class ImportedFonts {
  readonly #env: FaceEnv
  readonly #entries = new Map<string, Entry>()
  readonly #inflight = new Set<Promise<void>>()
  readonly #listeners = new Set<() => void>()
  readonly #changeListeners = new Set<(families: string[]) => void>()

  constructor(env: FaceEnv) {
    this.#env = env
  }

  /**
   * Brings the registered faces in line with `assets`: registers new fonts, drops removed ones.
   * Cheap to call on every project change — a font is keyed by its id and file, so an unchanged
   * set does nothing.
   */
  sync(assets: readonly Asset[]): void {
    const wanted = new Map<string, Asset & { font: FontInfo; path: string }>()
    for (const asset of fontAssets(assets)) wanted.set(asset.id, asset)
    const changed = new Set<string>()
    for (const [id, entry] of this.#entries) {
      const next = wanted.get(id)
      if (next && entryKey(next) === entry.key) continue
      this.#env.remove(entry.handle)
      this.#entries.delete(id)
      changed.add(entry.family)
    }
    for (const asset of wanted.values()) {
      if (this.#entries.has(asset.id)) continue
      changed.add(asset.font.family)
      const url = assetUrl(asset)
      if (!url) continue
      const descriptors = faceDescriptors(asset.font)
      const src = faceSource(url, asset.font)
      const { handle, loaded } = this.#env.load(asset.font.family, src, descriptors)
      const entry: Entry = {
        assetId: asset.id,
        key: entryKey(asset),
        family: asset.font.family,
        source: { src, weight: descriptors.weight, stretch: descriptors.stretch, style: descriptors.style },
        font: { family: asset.font.family, path: asset.path, ...descriptors, format: asset.font.format },
        handle,
        state: 'loading'
      }
      this.#entries.set(asset.id, entry)
      const done: Promise<void> = loaded.then(
        () => {
          entry.state = 'ready'
        },
        (error: unknown) => {
          entry.state = 'failed'
          entry.error = error instanceof Error ? error.message : String(error)
        }
      ).finally(() => {
        this.#inflight.delete(done)
        for (const listener of this.#listeners) listener()
      })
      this.#inflight.add(done)
    }
    if (changed.size > 0) for (const listener of this.#changeListeners) listener([...changed])
  }

  /** Called with the families whose faces were added or removed by a `sync`. */
  onChange(listener: (families: string[]) => void): () => void {
    this.#changeListeners.add(listener)
    return () => this.#changeListeners.delete(listener)
  }

  /** Every imported family, once each. */
  families(): string[] {
    return [...new Set([...this.#entries.values()].map((e) => e.family))]
  }

  /** The sources of `family`'s imported faces — what `brfFonts` clones a variation face from. */
  sourcesFor(family: string): FaceSource[] {
    const wanted = unquote(family).toLowerCase()
    return [...this.#entries.values()].filter((e) => e.family.toLowerCase() === wanted).map((e) => e.source)
  }

  /**
   * True while any imported face of the first family in `fontList` is loading. What a draw
   * checks before painting: drawn now, the text would be in a fallback face.
   */
  isLoading(fontList: string): boolean {
    const family = unquote(fontList.split(',')[0] ?? '').toLowerCase()
    for (const entry of this.#entries.values()) {
      if (entry.family.toLowerCase() === family && entry.state === 'loading') return true
    }
    return false
  }

  /** Imported faces that failed to load, with why — said, not substituted. */
  failures(): { family: string; error: string }[] {
    return [...this.#entries.values()]
      .filter((e) => e.state === 'failed')
      .map((e) => ({ family: e.family, error: e.error ?? 'did not load' }))
  }

  /** The faces a composition window must be given, as files main can read. */
  compositionFonts(): CompositionFont[] {
    return [...this.#entries.values()].filter((e) => e.state !== 'failed').map((e) => e.font)
  }

  /** Resolves when no face is loading, or after `timeoutMs`. */
  settle(timeoutMs: number): Promise<void> {
    if (this.#inflight.size === 0) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      void Promise.allSettled([...this.#inflight]).then(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /** Called whenever a face finishes loading, or fails to. */
  onReady(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
}

function entryKey(asset: Asset & { font: FontInfo; path: string }): string {
  const f = asset.font
  return `${asset.path}|${f.family}|${f.weight}|${f.stretch}|${f.style}|${f.format}`
}

function unquote(value: string): string {
  return value.trim().replace(/^(['"])(.*)\1$/, '$2')
}

function documentEnv(): FaceEnv {
  return {
    load(family, source, descriptors) {
      // The constructor throws on a descriptor it cannot parse; that is a font that failed to
      // load, not a reason for the draw that registered it to throw.
      let face: FontFace
      try {
        face = new FontFace(family, source, descriptors as FontFaceDescriptors)
      } catch (error) {
        return { handle: null, loaded: Promise.reject(error) }
      }
      document.fonts.add(face)
      return { handle: face, loaded: face.load().then(() => undefined) }
    },
    remove(handle) {
      if (handle instanceof FontFace) document.fonts.delete(handle)
    }
  }
}

const noEnv: FaceEnv = {
  load: () => ({ handle: null, loaded: Promise.reject(new Error('no document to load fonts into')) }),
  remove: () => {}
}

/** The one registry preview, `preview_frame`, export and the font picker read. */
export const importedFonts = new ImportedFonts(
  typeof document !== 'undefined' && typeof FontFace !== 'undefined' ? documentEnv() : noEnv
)
