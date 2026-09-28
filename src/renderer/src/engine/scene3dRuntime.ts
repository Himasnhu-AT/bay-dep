/**
 * The one door to 3D drawing, and what everything that waits on sources waits on for it.
 *
 * Holds no three.js: `./scene3d` (three.js, opentype.js, the built-in font) is imported the first
 * time a `<scene3d>` layer is drawn, so the editor starts without it. Until it has arrived, and
 * while an imported font's file is being read, a 3D layer is **pending** — the `.brf` item waits,
 * exactly as it does for a variable-font face — and `settle`/`onReady` are how `renderFrame`, the
 * exporter and the live preview hear that it can be drawn now, as they do for every other source.
 */

import type { Scene3dFrame } from '@shared/scene3d'
import type { Scene3dRenderer } from './scene3d'
import type { FontFile } from './scene3dFonts'
import { importedFonts } from './importedFonts'

type Module = { Scene3dRenderer: typeof Scene3dRenderer }

export class Scene3dRuntime {
  readonly #load: () => Promise<Module>
  readonly #files: () => readonly FontFile[]
  #renderer: Scene3dRenderer | null = null
  #module: Module | null = null
  #loading = false
  #error: string | null = null
  readonly #inflight = new Set<Promise<void>>()
  readonly #listeners = new Set<() => void>()

  constructor(load: () => Promise<Module> = () => import('./scene3d'), files: () => readonly FontFile[] = () => importedFonts.files()) {
    this.#load = load
    this.#files = files
  }

  /** Whether `scene` can be drawn now. Never blocks: the first call starts loading the renderer. */
  prepare(scene: Scene3dFrame): { ready: true } | { pending: true } | { error: string } {
    if (this.#error) return { error: this.#error }
    const renderer = this.#ensure()
    if (!renderer) return { pending: true }
    return renderer.prepare(scene, this.#files())
  }

  /** `scene` at `width`×`height` device pixels. Only after `prepare` said ready. */
  render(scene: Scene3dFrame, width: number, height: number): { canvas: OffscreenCanvas } | { error: string } {
    const renderer = this.#ensure()
    if (!renderer) return { error: this.#error ?? '3D was drawn before its renderer had loaded' }
    return renderer.render(scene, this.#files(), width, height)
  }

  #ensure(): Scene3dRenderer | null {
    if (this.#renderer) return this.#renderer
    if (this.#module) {
      this.#renderer = new this.#module.Scene3dRenderer((work) => this.#track(work))
      return this.#renderer
    }
    if (!this.#loading) {
      this.#loading = true
      this.#track(
        this.#load().then(
          (module) => {
            this.#module = module
          },
          (error: unknown) => {
            // A chunk that will not load is a build fault; every 3D layer says so rather than waiting.
            this.#error = `the 3D renderer could not be loaded (${error instanceof Error ? error.message : String(error)})`
          }
        )
      )
    }
    return null
  }

  #track(work: Promise<void>): void {
    const done: Promise<void> = work.finally(() => {
      this.#inflight.delete(done)
      for (const listener of this.#listeners) listener()
    })
    this.#inflight.add(done)
  }

  /** Resolves when nothing is loading, or after `timeoutMs`. */
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

  /** Called whenever the renderer or a font finishes loading, or fails to. */
  onReady(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Frees the GL context and caches; the loaded module is kept, so the next draw is quick. */
  dispose(): void {
    this.#renderer?.dispose()
    this.#renderer = null
  }

  /** For a probe: lose the context on purpose, as a GPU reset would. */
  forceContextLoss(): void {
    this.#renderer?.forceContextLoss()
  }
}

/** The one runtime preview, `preview_frame` and export draw 3D through. */
export const scene3dRuntime = new Scene3dRuntime()
