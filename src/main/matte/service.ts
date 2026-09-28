/**
 * Subject mattes on this machine: find one in the cache or compute it, one job at a time.
 *
 * Content-addressed by (file content, source range, engine, parameters) — `matteKeyInput` in
 * `@shared/matte` — so the same clip asked for twice, from two projects or after the file moved,
 * is one pack and the second answer is a lookup. Packs live in `<cache>/mattes-<scheme>/`, inside
 * the cache directory `bay://` already serves as a whole, so the renderer reads frames with Range
 * requests and nothing new is admitted.
 *
 * One job at a time because there is one Vision process and it answers in order; a second request
 * for the same key while it runs waits for the first rather than computing twice.
 *
 * No Electron import; `host.ts` gives it the directories and the engine.
 */

import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MATTE_KEY_PATTERN,
  matteKeyInput,
  type SubjectMatte,
  type SubjectMatteIndex,
  type SubjectMatteReport,
  type SubjectMatteRequest,
  type SubjectMatteResult
} from '@shared/matte'
import { contentKey as fileContentKey } from '../vision/cache'
import { mediaUrl } from '../serve'
import { computeSubjectMatte, MatteCancelledError, megabytesPerMinute, NoPictureError, type MatteEngine } from './compute'
import { readPackIndex, type PackIndex } from './pack'
import { VisionUnavailableError } from './vision-jxa'

export interface MatteServiceOptions {
  /** `<cache>/mattes-<scheme>`. */
  dir: string
  ffmpeg: () => string
  engine: MatteEngine
  /** Whether `bay://` would serve this path — the renderer's paths are read only where it would. */
  isAllowed: (path: string) => boolean
  contentKey?: (path: string) => Promise<string>
}

export class MatteService {
  readonly #options: MatteServiceOptions
  readonly #jobs = new Map<string, Promise<SubjectMatteResult>>()
  #queue: Promise<unknown> = Promise.resolve()
  #controller: AbortController | null = null

  constructor(options: MatteServiceOptions) {
    this.#options = options
  }

  /** The pack's file name for a request, and its key. */
  async keyFor(request: SubjectMatteRequest): Promise<string> {
    const content = await (this.#options.contentKey ?? fileContentKey)(request.path)
    return createHash('sha256').update(matteKeyInput(content, request.fromUs, request.toUs, this.#options.engine.id)).digest('hex').slice(0, 32)
  }

  packPath(key: string): string {
    return join(this.#options.dir, `${key}.bmat`)
  }

  async ensure(raw: SubjectMatteRequest): Promise<SubjectMatteResult> {
    const request = checkRequest(raw)
    if ('error' in request) return { ok: false, code: 'refused', error: request.error }
    if (!this.#options.isAllowed(request.path)) {
      return { ok: false, code: 'refused', error: `bay does not serve ${request.path}, so it will not read it. Import the file first (import_media).` }
    }
    let key: string
    try {
      key = await this.keyFor(request)
    } catch (error) {
      return { ok: false, code: 'failed', error: `Could not read ${request.path}: ${message(error)}` }
    }
    const running = this.#jobs.get(key)
    if (running) return running
    const job = this.#run(key, request)
    this.#jobs.set(key, job)
    try {
      return await job
    } finally {
      this.#jobs.delete(key)
    }
  }

  async #run(key: string, request: SubjectMatteRequest): Promise<SubjectMatteResult> {
    const path = this.packPath(key)
    const found = await readPackIndex(path)
    if (found) return { ok: true, matte: recordOf(key, found.index), report: cachedReport(found.index, found.bytes) }
    // Serialised behind whatever job is running: one engine process, answered in order.
    const turn = this.#queue.then(() => this.#compute(key, request, path))
    this.#queue = turn.catch(() => {})
    return turn
  }

  async #compute(key: string, request: SubjectMatteRequest, path: string): Promise<SubjectMatteResult> {
    const again = await readPackIndex(path)
    if (again) return { ok: true, matte: recordOf(key, again.index), report: cachedReport(again.index, again.bytes) }
    await mkdir(this.#options.dir, { recursive: true })
    const controller = new AbortController()
    this.#controller = controller
    try {
      const result = await computeSubjectMatte({
        ffmpeg: this.#options.ffmpeg(),
        path: request.path,
        fromUs: request.fromUs,
        toUs: request.toUs,
        engine: this.#options.engine,
        outPath: path,
        signal: controller.signal
      })
      return { ok: true, matte: recordOf(key, result.index), report: result.report }
    } catch (error) {
      if (error instanceof VisionUnavailableError) return { ok: false, code: 'unavailable', error: error.message }
      if (error instanceof NoPictureError) return { ok: false, code: 'no-picture', error: error.message }
      if (error instanceof MatteCancelledError || controller.signal.aborted) {
        return { ok: false, code: 'failed', error: 'The subject matte was cancelled before it finished; ask again to compute it.' }
      }
      return { ok: false, code: 'failed', error: `The subject matte could not be computed: ${message(error)}` }
    } finally {
      if (this.#controller === controller) this.#controller = null
    }
  }

  /** Where a pack's frames are, for the engine. Only keys, never paths, come in from the renderer. */
  async index(key: unknown): Promise<{ ok: true; index: SubjectMatteIndex } | { ok: false; error: string }> {
    if (typeof key !== 'string' || !MATTE_KEY_PATTERN.test(key)) return { ok: false, error: 'A matte key is 32 hex characters.' }
    const path = this.packPath(key)
    const found = await readPackIndex(path)
    if (!found) {
      return { ok: false, error: 'No subject matte with that key is on this Mac (it was never computed here, or the cache was cleared). Run put_behind_subject again to compute it.' }
    }
    const { index } = found
    return {
      ok: true,
      index: {
        key,
        url: mediaUrl(path),
        width: index.width,
        height: index.height,
        fromUs: index.fromUs,
        toUs: index.toUs,
        ptsUs: index.frames.map((f) => f[0]),
        offsets: index.frames.map((f) => f[1]),
        lengths: index.frames.map((f) => f[2])
      }
    }
  }

  /** Stops the running job and the engine's process. Quit calls this; so does a cancel. */
  dispose(): void {
    this.#controller?.abort()
    this.#options.engine.stop()
  }
}

function checkRequest(raw: unknown): SubjectMatteRequest | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'A subject matte request needs path, fromUs and toUs.' }
  const r = raw as Record<string, unknown>
  if (typeof r.path !== 'string' || !r.path) return { error: 'path must be the asset\'s file path.' }
  const fromUs = Number(r.fromUs)
  const toUs = Number(r.toUs)
  if (!Number.isFinite(fromUs) || !Number.isFinite(toUs) || fromUs < 0 || toUs <= fromUs) {
    return { error: `The source range must be 0 ≤ fromUs < toUs in microseconds; got ${String(r.fromUs)}–${String(r.toUs)}.` }
  }
  return { path: r.path, fromUs: Math.round(fromUs), toUs: Math.round(toUs) }
}

function recordOf(key: string, index: PackIndex): SubjectMatte {
  return { key, fromUs: index.fromUs, toUs: index.toUs, engine: index.engine, frames: index.frames.length, width: index.width, height: index.height }
}

function cachedReport(index: PackIndex, bytes: number): SubjectMatteReport {
  return { ...index.report, cached: true, bytes, megabytesPerMinute: megabytesPerMinute(bytes, index) }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
