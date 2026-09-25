/**
 * Visual search, as main runs it: the model on disk, the one download, the one indexing job, and
 * search over what is indexed.
 *
 * No Electron import. The heavy work happens in a `VisionWorker` — the utility process in the app
 * (`host.ts`), the same code in-process under `pnpm test` — so this module's decisions (what is
 * installed, what still needs indexing, what a search answers and what it refuses) are tested
 * against real files without an app.
 *
 * One download and one job at a time, app-wide, like whisper's downloads: a second index request
 * while one runs adds its files to the running job instead of starting another — unless that job
 * has been told to stop, when the request becomes the next job, which starts once the stopping one
 * has let go of the worker. An index request answers at once: the job itself waits for the model
 * download and checks which files are already indexed, so no caller waits on 409 MB or on hashing.
 */

import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ESTIMATED_MS_PER_FRAME,
  expectedSamples,
  rankFrames,
  SAME_MOMENT_US,
  SAMPLE_INTERVAL_US,
  VISION_MODEL,
  VISION_MODEL_BYTES,
  VISION_NOT_INSTALLED,
  visionFileUrl,
  type FrameCandidate,
  type VisionAssetRef,
  type VisionDownload,
  type VisionIndexAnswer,
  type VisionIndexJob,
  type VisionIndexPlan,
  type VisionModelSpec,
  type VisionSearchAnswer,
  type VisionSearchRequest,
  type VisionStatus
} from '@shared/visual-search'
import { downloadVerified } from '../media/download'
import { contentKey, hasFrameIndex, indexFileName, readFrameIndex, type FrameIndex } from './cache'
import type { VisionWorker } from './local-worker'
import { ByteLru } from './lru'
import { searchLimit } from './requests'

/** Content keys are ~64 bytes against a path; two MiB is tens of thousands of files. */
const KEY_CACHE_BYTES = 2 * 1024 * 1024
/** Loaded indexes (≈3 KB a frame): 96 MiB is ~30 hours of footage kept warm between searches. */
const INDEX_CACHE_BYTES = 96 * 1024 * 1024

/** One indexing job: its own queue, controller and state, so a stopping job cannot touch the next. */
interface IndexRun {
  controller: AbortController
  /** Files asked for and not yet checked against the cache. */
  checking: VisionAssetRef[]
  /** Files checked and to be indexed, with their cache name. */
  queue: { asset: VisionAssetRef; name: string }[]
  /** Every path this job has been given, so asking twice indexes once. */
  seen: Set<string>
  job: VisionIndexJob
  done: Promise<void>
}

/** A missing file and a path that is not a file are different sentences. */
class NotAFileError extends Error {}

export interface VisionServiceConfig {
  /** Where models live: the model is `<modelsDir>/<model id>/`. */
  modelsDir: string
  /** The versioned index directory (`visionCacheDir`). */
  cacheDir: string
  /** Made on first use, and again after `stop`. */
  worker: () => VisionWorker
  download?: typeof downloadVerified
  model?: VisionModelSpec
}

export class VisionService {
  readonly #config: VisionServiceConfig
  readonly #model: VisionModelSpec
  #worker: VisionWorker | null = null
  #download: VisionDownload | null = null
  #downloading: { promise: Promise<void>; controller: AbortController } | null = null
  /** The latest job; an older one may still be stopping, holding only its own record. */
  #active: IndexRun | null = null
  /** Content keys by path+mtime+size, so a search does not re-read every file it has seen. */
  readonly #keys = new ByteLru<string>(KEY_CACHE_BYTES, (stamp, key) => 2 * (stamp.length + key.length) + 64)
  /** Loaded indexes by cache name, read on every search. */
  readonly #indexes = new ByteLru<FrameIndex>(INDEX_CACHE_BYTES, (_name, index) => index.vectors.byteLength + index.timesUs.length * 8 + 256)
  readonly #listeners = new Set<(status: VisionStatus) => void>()

  constructor(config: VisionServiceConfig) {
    this.#config = config
    this.#model = config.model ?? VISION_MODEL
  }

  get #job(): VisionIndexJob | null {
    return this.#active?.job ?? null
  }

  get modelDir(): string {
    return join(this.#config.modelsDir, this.#model.id)
  }

  onChange(listener: (status: VisionStatus) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async #emit(): Promise<void> {
    if (this.#listeners.size === 0) return
    const status = await this.status()
    for (const listener of this.#listeners) listener(status)
  }

  /** Installed means every file is at its name with its pinned size — only a verified download gets there. */
  async #bytesOnDisk(): Promise<{ installed: boolean; bytes: number }> {
    let bytes = 0
    let installed = true
    for (const file of this.#model.files) {
      const size = await stat(join(this.modelDir, file.name)).then(
        (s) => s.size,
        () => -1
      )
      if (size !== file.bytes) installed = false
      if (size > 0) bytes += size
    }
    return { installed, bytes }
  }

  async installed(): Promise<boolean> {
    return (await this.#bytesOnDisk()).installed
  }

  async status(): Promise<VisionStatus> {
    const { installed, bytes } = await this.#bytesOnDisk()
    return { installed, modelDir: this.modelDir, bytesOnDisk: bytes, download: this.#download, index: this.#job }
  }

  // -- the model ------------------------------------------------------------------------------

  /** Fetch every file not already in place. A second call while one runs joins it. */
  downloadModel(reason: VisionDownload['reason']): Promise<void> {
    if (this.#downloading) return this.#downloading.promise
    const controller = new AbortController()
    const download = this.#config.download ?? downloadVerified
    const total = VISION_MODEL_BYTES
    const promise = (async () => {
      await mkdir(this.modelDir, { recursive: true })
      let before = 0
      this.#download = { state: 'downloading', receivedBytes: 0, totalBytes: total, reason }
      void this.#emit()
      for (const file of this.#model.files) {
        const dest = join(this.modelDir, file.name)
        const have = await stat(dest).then(
          (s) => s.size,
          () => -1
        )
        if (have !== file.bytes) {
          await download(visionFileUrl(file, this.#model), dest, {
            signal: controller.signal,
            expected: { bytes: file.bytes, sha256: file.sha256 },
            onProgress: (p) => {
              this.#download = { state: 'downloading', receivedBytes: before + p.receivedBytes, totalBytes: total, reason }
              void this.#emit()
            },
            onVerifying: () => {
              this.#download = { state: 'verifying', receivedBytes: before + file.bytes, totalBytes: total, reason }
              void this.#emit()
            }
          })
        }
        before += file.bytes
      }
      this.#download = { state: 'done', receivedBytes: total, totalBytes: total, reason }
    })()
      .catch((error: unknown) => {
        const cancelled = controller.signal.aborted
        const message = error instanceof Error ? error.message : String(error)
        this.#download = {
          state: cancelled ? 'cancelled' : 'failed',
          receivedBytes: this.#download?.receivedBytes ?? 0,
          totalBytes: total,
          reason,
          ...(cancelled ? {} : { error: message })
        }
        throw new Error(cancelled ? `The download of ${this.#model.label} was cancelled.` : `Downloading ${this.#model.label} failed: ${message}`)
      })
      .finally(() => {
        this.#downloading = null
        void this.#emit()
      })
    this.#downloading = { promise, controller }
    return promise
  }

  cancelDownload(): void {
    this.#downloading?.controller.abort()
  }

  async deleteModel(): Promise<{ ok: boolean; error?: string }> {
    if (this.#downloading) return { ok: false, error: 'The model is still downloading; cancel it first.' }
    if (this.#job?.state === 'running') return { ok: false, error: 'Footage is being indexed with the model; stop indexing first.' }
    this.#worker?.stop()
    this.#worker = null
    await rm(this.modelDir, { recursive: true, force: true })
    this.#download = null
    void this.#emit()
    return { ok: true }
  }

  #workerNow(): VisionWorker {
    this.#worker ??= this.#config.worker()
    return this.#worker
  }

  /**
   * Free the model's memory (the utility process exits) and the cached keys and indexes; the next
   * search loads them again. A running job keeps its worker.
   */
  release(): void {
    this.#keys.clear()
    this.#indexes.clear()
    if (this.#job?.state === 'running') return
    this.#worker?.stop()
    this.#worker = null
  }

  // -- indexing -------------------------------------------------------------------------------

  async #keyOf(path: string): Promise<string> {
    const s = await stat(path)
    // Before anything opens it: a FIFO or a device would block the hash (or ffmpeg) for ever.
    if (!s.isFile()) throw new NotAFileError(`${path} is not a file (a folder, device or pipe), so it cannot be indexed.`)
    const stampKey = `${path}\0${s.mtimeMs}\0${s.size}`
    let key = this.#keys.get(stampKey)
    if (!key) {
      key = await contentKey(path)
      this.#keys.set(stampKey, key)
    }
    return key
  }

  async #cacheName(asset: VisionAssetRef): Promise<string> {
    return indexFileName(await this.#keyOf(asset.path), this.#model.id, SAMPLE_INTERVAL_US)
  }

  /** What indexing these files would do, touching nothing. Works without the model. */
  async plan(assets: readonly VisionAssetRef[]): Promise<VisionIndexPlan> {
    const unavailable: VisionIndexPlan['unavailable'] = []
    let toIndex = 0
    let indexed = 0
    let frames = 0
    for (const asset of assets) {
      let name: string
      try {
        name = await this.#cacheName(asset)
      } catch (error) {
        unavailable.push({ assetId: asset.assetId, name: asset.name, error: unavailableReason(error, asset.path) })
        continue
      }
      if (await hasFrameIndex(this.#config.cacheDir, name)) {
        indexed += 1
        continue
      }
      toIndex += 1
      frames += asset.kind === 'image' ? 1 : expectedSamples(asset.durationUs)
    }
    return {
      files: assets.length,
      indexed,
      toIndex,
      frames,
      estimatedSeconds: Math.round((frames * ESTIMATED_MS_PER_FRAME) / 1000),
      unavailable
    }
  }

  /**
   * Unless `dryRun`, start indexing what is not indexed yet, and answer at once: the job checks
   * the files and, when the model is missing and `download` (the user's "Download models when
   * needed") is on, downloads it first. Refuses in words when the model is missing and `download`
   * is off. A dry run answers with the plan, which reads the files, and starts nothing.
   */
  async index(assets: readonly VisionAssetRef[], options: { dryRun?: boolean; download?: boolean } = {}): Promise<VisionIndexAnswer> {
    if (options.dryRun) {
      return { ok: true, started: false, plan: await this.plan(assets), job: this.#job }
    }
    const installed = await this.installed()
    if (!installed && !options.download) return { ok: false, error: VISION_NOT_INSTALLED }

    const active = this.#active
    // Join a job only while it is still going: one told to stop would drop what joins it.
    if (active && active.job.state === 'running' && !active.controller.signal.aborted) {
      const fresh = assets.filter((a) => !active.seen.has(a.path))
      for (const a of fresh) active.seen.add(a.path)
      active.checking.push(...fresh)
      active.job = { ...active.job, checking: active.job.checking + fresh.length }
      void this.#emit()
      return { ok: true, started: true, downloading: active.job.phase === 'download', job: active.job }
    }

    const unique = [...new Map(assets.map((a) => [a.path, a])).values()]
    const run: IndexRun = {
      controller: new AbortController(),
      checking: unique,
      queue: [],
      seen: new Set(unique.map((a) => a.path)),
      job: {
        state: 'running',
        phase: installed ? 'planning' : 'download',
        checking: unique.length,
        alreadyIndexed: 0,
        filesTotal: 0,
        filesDone: 0,
        framesDone: 0,
        current: null,
        failed: [],
        startedAt: Date.now(),
        finishedAt: null
      },
      done: Promise.resolve()
    }
    // A job still stopping holds the worker until its current file lets go; this one starts after.
    const previous = active?.done ?? Promise.resolve()
    run.done = previous.then(() => this.#execute(run, !installed))
    this.#active = run
    void this.#emit()
    return { ok: true, started: true, downloading: !installed, job: run.job }
  }

  /** Resolves when no job is running — including one queued behind a job that was stopping. For tests and for quit. */
  async settled(): Promise<void> {
    let run: IndexRun | null
    do {
      run = this.#active
      await run?.done
    } while (run !== this.#active)
  }

  cancelIndex(): void {
    this.#active?.controller.abort()
  }

  async #execute(run: IndexRun, needsDownload: boolean): Promise<void> {
    const { signal } = run.controller
    const update = (patch: Partial<VisionIndexJob>): void => {
      run.job = { ...run.job, ...patch }
      void this.#emit()
    }
    try {
      if (needsDownload && !signal.aborted && !(await this.installed())) {
        update({ phase: 'download' })
        const download = this.downloadModel('index')
        const stopped = new Promise<'stopped'>((resolve) => signal.addEventListener('abort', () => resolve('stopped'), { once: true }))
        const outcome = await Promise.race([download.then(() => 'downloaded' as const), stopped])
        // Stopping the job stops a download it started; one the user started in Settings goes on.
        if (outcome === 'stopped' && this.#download?.reason === 'index') this.cancelDownload()
      }

      let worker: VisionWorker | null = null
      let framesBefore = 0
      while (!signal.aborted) {
        const next = run.checking.shift()
        if (next) {
          update({ phase: 'planning', checking: run.checking.length })
          let name: string
          try {
            name = await this.#cacheName(next)
          } catch (error) {
            const failed = { assetId: next.assetId, name: next.name, error: unavailableReason(error, next.path) }
            update({ filesTotal: run.job.filesTotal + 1, filesDone: run.job.filesDone + 1, failed: [...run.job.failed, failed] })
            continue
          }
          if (await hasFrameIndex(this.#config.cacheDir, name)) {
            update({ alreadyIndexed: run.job.alreadyIndexed + 1 })
            continue
          }
          run.queue.push({ asset: next, name })
          update({ filesTotal: run.job.filesTotal + 1 })
          continue
        }
        const item = run.queue.shift()
        if (!item) break
        const { asset, name } = item
        update({ phase: 'indexing', current: asset.name })
        try {
          worker ??= this.#workerNow()
          const frames = await worker.indexFile(
            { path: asset.path, kind: asset.kind, durationUs: asset.durationUs, cacheDir: this.#config.cacheDir, cacheName: name },
            (done) => update({ framesDone: framesBefore + done }),
            signal
          )
          if (frames === null) break
          framesBefore += frames
          update({ filesDone: run.job.filesDone + 1, framesDone: framesBefore })
        } catch (error) {
          if (signal.aborted) break
          const message = error instanceof Error ? error.message : String(error)
          update({ filesDone: run.job.filesDone + 1, failed: [...run.job.failed, { assetId: asset.assetId, name: asset.name, error: message }] })
        }
      }
      update({ state: signal.aborted ? 'cancelled' : 'done', current: null, finishedAt: Date.now() })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      update({ state: signal.aborted ? 'cancelled' : 'failed', ...(signal.aborted ? {} : { error: message }), current: null, finishedAt: Date.now() })
    } finally {
      run.checking = []
      run.queue = []
    }
  }

  // -- search ---------------------------------------------------------------------------------

  async #indexOf(asset: VisionAssetRef): Promise<FrameIndex | null> {
    let name: string
    try {
      name = await this.#cacheName(asset)
    } catch {
      return null
    }
    const cached = this.#indexes.get(name)
    if (cached) return cached
    const index = await readFrameIndex(this.#config.cacheDir, name, this.#model.id)
    if (index) this.#indexes.set(name, index)
    return index
  }

  async search(request: VisionSearchRequest): Promise<VisionSearchAnswer> {
    const query = request.query?.trim() ?? ''
    if (!query && !request.similarTo) return { ok: false, error: 'Say what to look for: `query` (a description of the shot) or `similarTo` (an asset and a time).' }
    if (!(await this.installed())) return { ok: false, error: VISION_NOT_INSTALLED }

    const candidates: FrameCandidate[] = []
    const unindexed: string[] = []
    const indexes = new Map<string, FrameIndex>()
    for (const asset of request.assets) {
      const index = await this.#indexOf(asset)
      if (!index) {
        unindexed.push(asset.assetId)
        continue
      }
      indexes.set(asset.assetId, index)
      for (let i = 0; i < index.timesUs.length; i++) {
        candidates.push({ key: asset.assetId, us: index.timesUs[i]!, vector: index.vectors.subarray(i * index.dims, (i + 1) * index.dims) })
      }
    }

    let vector: ArrayLike<number>
    let reference: { assetId: string; us: number } | undefined
    if (request.similarTo) {
      const index = indexes.get(request.similarTo.assetId)
      if (!index || index.timesUs.length === 0) {
        return { ok: false, error: `The asset to compare with (${request.similarTo.assetId}) is not indexed yet. Call index_footage with it first.` }
      }
      let nearest = 0
      for (let i = 1; i < index.timesUs.length; i++) {
        if (Math.abs(index.timesUs[i]! - request.similarTo.us) < Math.abs(index.timesUs[nearest]! - request.similarTo.us)) nearest = i
      }
      vector = index.vectors.subarray(nearest * index.dims, (nearest + 1) * index.dims)
      reference = { assetId: request.similarTo.assetId, us: index.timesUs[nearest]! }
    } else {
      const [embedded] = await this.#workerNow().embedText([query])
      if (!embedded) return { ok: false, error: 'The model returned no embedding for that text.' }
      vector = embedded
    }

    // The frame compared with is not an answer to "what looks like this".
    const exclude = reference ? (c: FrameCandidate) => c.key === reference.assetId && Math.abs(c.us - reference.us) < SAME_MOMENT_US : undefined
    const ranking = rankFrames(vector, candidates, searchLimit(request.limit), exclude)
    return {
      ok: true,
      hits: ranking.hits.map((h) => ({ assetId: h.key, us: h.us, score: h.score })),
      separation: ranking.separation,
      framesSearched: ranking.searched,
      unindexed,
      ...(reference ? { reference } : {})
    }
  }
}

function unavailableReason(error: unknown, path: string): string {
  if (error instanceof NotAFileError) return error.message
  return `The file is not at ${path} any more (moved, deleted, or on a drive that is not connected).`
}
