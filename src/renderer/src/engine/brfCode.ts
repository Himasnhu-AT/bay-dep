/**
 * Runs `.brf` source modules and hands the compositor their scenes.
 *
 * The code runs in workers (`./brf.worker.ts`), one per module, so this side is asynchronous
 * while drawing is not. The compositor asks for a frame's scene synchronously and gets it from
 * cache, or is told it is pending — the same contract the composition pool keeps — and the frames
 * around it are rendered in chunks of half a second, so playback asks the worker a couple of
 * times a second rather than once a frame. A scene is a few kilobytes of JSON; the worker does
 * not draw anything.
 *
 * `settle` and `onReady` are what `renderFrame` and the exporter wait on, exactly as they wait on
 * compositions: draw, and if anything was pending, settle and draw again. A module that never
 * answers — an infinite loop — is terminated after `TIMEOUT_MS` and reported as an error on its
 * clip rather than hanging an export.
 */

import type { BrfDocument } from '@shared/brf'
import type { BrfMeta } from '@shared/brf-code'

export type BrfWorkerRequest =
  | { id: number; type: 'load'; source: string; fps: number; width: number; height: number }
  | {
      id: number
      type: 'render'
      frames: number[]
      fps: number
      width: number
      height: number
      vars: Record<string, string | number | boolean>
    }

export type BrfWorkerReply =
  | { id: number; ok: true; meta: BrfMeta }
  | { id: number; ok: true; scenes: BrfDocument[] }
  | { id: number; ok: false; error: string }

/** `Omit` per member: a plain `Omit` over a union keeps only the keys they share. */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never

export type MetaResult = { ok: true; meta: BrfMeta } | { ok: false; error: string }

/** How much is rendered per request. */
const CHUNK_SECONDS = 0.5
/** A request not answered in this long means a module that will not return. */
const TIMEOUT_MS = 3000
const MAX_SCENES = 6000
const MAX_RUNNERS = 8

interface Runner {
  worker: WorkerLike
  loaded: Promise<MetaResult>
  error: string | null
  seq: number
  pending: Map<number, { resolve: (reply: BrfWorkerReply) => void; timer: ReturnType<typeof setTimeout> }>
  usedAt: number
}

/** A stable key for a source: the text itself would do, but not as a Map key a thousand times. */
export function sourceKey(source: string): string {
  let h = 5381
  for (let i = 0; i < source.length; i++) h = ((h * 33) ^ source.charCodeAt(i)) >>> 0
  return `${h.toString(36)}:${source.length}`
}

const varsKey = (vars: Record<string, unknown>): string =>
  JSON.stringify(Object.keys(vars).sort().map((k) => [k, vars[k]]))

/** What the runtime needs of a worker: the app's is a real one; the tests' runs in-process. */
export interface WorkerLike {
  postMessage(message: unknown): void
  terminate(): void
  onmessage: ((event: MessageEvent<BrfWorkerReply>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

const spawnWorker = (): WorkerLike =>
  new Worker(new URL('./brf.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike

export class BrfCodeRuntime {
  #spawn: (() => WorkerLike) | null = typeof Worker === 'undefined' ? null : spawnWorker

  /** Replaces how workers are started. The seam the tests use to run modules in-process. */
  useWorkers(spawn: () => WorkerLike): void {
    this.dispose()
    this.#spawn = spawn
  }

  #runners = new Map<string, Runner>()
  #scenes = new Map<string, BrfDocument>()
  #inflight = new Set<string>()
  #errors = new Map<string, string>()
  #listeners = new Set<() => void>()
  #idle: (() => void)[] = []

  /**
   * Compiles `source` and reads what it declares — duration, size, vars — by rendering its first
   * frame. What `write_brf` and import wait on before an asset exists.
   */
  meta(source: string, fps = 30, width = 1920, height = 1080): Promise<MetaResult> {
    return this.#runner(source, fps, width, height).loaded
  }

  /**
   * Compiles, probes and renders `samples` frames spread across the whole duration — so a module
   * that throws at frame 45 is refused when it is written, with the frame and line, rather than
   * drawn as a placeholder the first time someone scrubs there.
   */
  async verify(
    source: string,
    fps: number,
    width: number,
    height: number,
    vars?: Record<string, string | number | boolean>,
    samples = 9
  ): Promise<MetaResult> {
    const loaded = await this.meta(source, fps, width, height)
    if (!loaded.ok) return loaded
    const key = sourceKey(source)
    const runner = this.#runners.get(key)
    if (!runner) return { ok: false, error: this.#errors.get(key) ?? 'stopped before it could be checked' }
    const last = Math.max(0, Math.ceil(loaded.meta.duration * fps) - 1)
    const frames = [...new Set(Array.from({ length: samples }, (_, i) => Math.round((last * i) / Math.max(1, samples - 1))))]
    const reply = await this.#send(key, runner, { type: 'render', frames, fps, width, height, vars: { ...loaded.meta.vars, ...(vars ?? {}) } })
    if (!reply.ok) {
      this.#fail(key, runner, reply.error)
      return { ok: false, error: reply.error }
    }
    return loaded
  }

  /**
   * The scene for `frame`, or that it is on its way, or why it never will be. Never blocks.
   */
  scene(
    source: string,
    vars: Record<string, string | number | boolean>,
    frame: number,
    fps: number,
    width: number,
    height: number
  ): { doc: BrfDocument } | { pending: true } | { error: string } {
    const key = sourceKey(source)
    const failed = this.#errors.get(key)
    if (failed) return { error: failed }
    const base = `${key}|${varsKey(vars)}|${fps}|${Math.round(width)}x${Math.round(height)}`
    const chunk = Math.max(1, Math.round(fps * CHUNK_SECONDS))
    const start = Math.floor(frame / chunk) * chunk
    const hit = this.#scenes.get(`${base}|${frame}`)
    // Ahead of need: once a frame is in the second half of its chunk, the next is fetched.
    if (frame - start >= chunk / 2) this.#request(source, base, start + chunk, chunk, vars, fps, width, height)
    if (hit) return { doc: hit }
    this.#request(source, base, start, chunk, vars, fps, width, height)
    return { pending: true }
  }

  /** Resolves when nothing is in flight, or after `timeoutMs`. */
  settle(timeoutMs: number): Promise<void> {
    if (this.#inflight.size === 0) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(done, timeoutMs)
      const idle = this.#idle
      function done(): void {
        clearTimeout(timer)
        const i = idle.indexOf(done)
        if (i >= 0) idle.splice(i, 1)
        resolve()
      }
      idle.push(done)
    })
  }

  onReady(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  get stats(): { runners: number; scenes: number; inflight: number; errors: number } {
    return { runners: this.#runners.size, scenes: this.#scenes.size, inflight: this.#inflight.size, errors: this.#errors.size }
  }

  /** Forgets a module that failed, so a rewritten one is tried afresh. Rewrites change the key anyway. */
  dispose(): void {
    for (const runner of this.#runners.values()) runner.worker.terminate()
    this.#runners.clear()
    this.#scenes.clear()
    this.#inflight.clear()
    this.#errors.clear()
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
    if (this.#inflight.size === 0) for (const done of [...this.#idle]) done()
  }

  #runner(source: string, fps: number, width: number, height: number): Runner {
    const key = sourceKey(source)
    const existing = this.#runners.get(key)
    if (existing) {
      existing.usedAt = performance.now()
      return existing
    }
    if (this.#runners.size >= MAX_RUNNERS) {
      const oldest = [...this.#runners.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt)[0]
      if (oldest) {
        oldest[1].worker.terminate()
        this.#runners.delete(oldest[0])
      }
    }
    if (!this.#spawn) {
      const error = 'cannot run here: this environment has no workers'
      const inert: WorkerLike = { postMessage() {}, terminate() {}, onmessage: null, onerror: null }
      return { worker: inert, loaded: Promise.resolve({ ok: false, error }), error, seq: 0, pending: new Map(), usedAt: 0 }
    }
    const worker = this.#spawn()
    const runner: Runner = { worker, loaded: Promise.resolve({ ok: false, error: '' }), error: null, seq: 0, pending: new Map(), usedAt: performance.now() }
    worker.onmessage = (event: MessageEvent<BrfWorkerReply>) => {
      const reply = event.data
      const waiting = runner.pending.get(reply?.id)
      if (!waiting) return
      clearTimeout(waiting.timer)
      runner.pending.delete(reply.id)
      waiting.resolve(reply)
    }
    worker.onerror = (event) => this.#fail(key, runner, `crashed: ${event.message || 'the worker stopped'}`)
    runner.loaded = this.#send(key, runner, { type: 'load', source, fps, width, height }).then((reply) => {
      if (reply.ok && 'meta' in reply) return { ok: true, meta: reply.meta }
      const error = reply.ok ? 'answered a load with something else' : reply.error
      this.#fail(key, runner, error)
      return { ok: false, error }
    })
    this.#runners.set(key, runner)
    return runner
  }

  #send(key: string, runner: Runner, message: WithoutId<BrfWorkerRequest>): Promise<BrfWorkerReply> {
    const id = ++runner.seq
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const error =
          `took longer than ${TIMEOUT_MS / 1000}s to answer and was stopped — look for a loop that ` +
          `never ends, or work that grows with the frame number`
        this.#fail(key, runner, error)
        resolve({ id, ok: false, error })
      }, TIMEOUT_MS)
      runner.pending.set(id, { resolve, timer })
      runner.worker.postMessage({ ...message, id })
    })
  }

  #fail(key: string, runner: Runner, error: string): void {
    this.#errors.set(key, error)
    runner.worker.terminate()
    for (const waiting of runner.pending.values()) clearTimeout(waiting.timer)
    runner.pending.clear()
    this.#runners.delete(key)
    this.#notify()
  }

  #request(
    source: string,
    base: string,
    start: number,
    count: number,
    vars: Record<string, string | number | boolean>,
    fps: number,
    width: number,
    height: number
  ): void {
    const chunkKey = `${base}|@${start}`
    if (this.#inflight.has(chunkKey) || this.#scenes.has(`${base}|${start}`)) return
    const key = sourceKey(source)
    if (this.#errors.has(key)) return
    this.#inflight.add(chunkKey)
    const runner = this.#runner(source, fps, width, height)
    void runner.loaded
      .then(async (loaded) => {
        if (!loaded.ok) return
        const last = Math.max(0, Math.ceil(loaded.meta.duration * fps) - 1)
        const frames = Array.from({ length: count }, (_, i) => start + i).filter((f) => f <= last)
        if (frames.length === 0) return
        const reply = await this.#send(key, runner, { type: 'render', frames, fps, width, height, vars })
        if (!reply.ok) {
          this.#fail(key, runner, reply.error)
          return
        }
        if (!('scenes' in reply)) return
        reply.scenes.forEach((doc, i) => this.#scenes.set(`${base}|${frames[i]}`, doc))
        if (this.#scenes.size > MAX_SCENES) {
          let drop = Math.floor(MAX_SCENES / 5)
          for (const k of this.#scenes.keys()) {
            if (drop-- <= 0) break
            this.#scenes.delete(k)
          }
        }
      })
      .finally(() => {
        this.#inflight.delete(chunkKey)
        this.#notify()
      })
  }
}

/** One runtime for the preview, `renderFrame` and export: scenes are pure, so all share the cache. */
export const brfRuntime = new BrfCodeRuntime()
