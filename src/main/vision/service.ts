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
 * while one runs adds its files to the running job instead of starting another.
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
  #job: VisionIndexJob | null = null
  #queue: VisionAssetRef[] = []
  #jobController: AbortController | null = null
  #running: Promise<void> | null = null
  #currentPath: string | null = null
  /** Content keys by path+mtime+size, so a search does not re-read every file it has seen. */
  readonly #keys = new Map<string, string>()
  /** Loaded indexes by cache name; small (≈3 KB a frame) and read on every search. */
  readonly #indexes = new Map<string, FrameIndex>()
  readonly #listeners = new Set<(status: VisionStatus) => void>()

  constructor(config: VisionServiceConfig) {
    this.#config = config
    this.#model = config.model ?? VISION_MODEL
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

  /** Free the model's memory (the utility process exits); the next search loads it again. */
  release(): void {
    if (this.#job?.state === 'running') return
    this.#worker?.stop()
    this.#worker = null
  }

  // -- indexing -------------------------------------------------------------------------------

  async #keyOf(path: string): Promise<string> {
    const s = await stat(path)
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
  async plan(assets: readonly VisionAssetRef[]): Promise<VisionIndexPlan & { todo: VisionAssetRef[] }> {
    const unavailable: VisionIndexPlan['unavailable'] = []
    const todo: VisionAssetRef[] = []
    let indexed = 0
    let frames = 0
    for (const asset of assets) {
      let name: string
      try {
        name = await this.#cacheName(asset)
      } catch {
        unavailable.push({ assetId: asset.assetId, name: asset.name, error: `The file is not at ${asset.path} any more (moved, deleted, or on a drive that is not connected).` })
        continue
      }
      if (await hasFrameIndex(this.#config.cacheDir, name)) {
        indexed += 1
        continue
      }
      todo.push(asset)
      frames += asset.kind === 'image' ? 1 : expectedSamples(asset.durationUs)
    }
    return {
      files: assets.length,
      indexed,
      toIndex: todo.length,
      frames,
      estimatedSeconds: Math.round((frames * ESTIMATED_MS_PER_FRAME) / 1000),
      unavailable,
      todo
    }
  }

  /**
   * Plan, and unless `dryRun`, index what is not indexed yet. Refuses in words when the model is
   * missing and `download` (the user's "Download models when needed") is off.
   */
  async index(assets: readonly VisionAssetRef[], options: { dryRun?: boolean; download?: boolean } = {}): Promise<VisionIndexAnswer> {
    const { todo, ...plan } = await this.plan(assets)
    if (options.dryRun) return { ok: true, started: false, plan, job: this.#job }
    if (!(await this.installed())) {
      if (!options.download) return { ok: false, error: VISION_NOT_INSTALLED }
      try {
        await this.downloadModel('index')
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
    if (todo.length === 0) return { ok: true, started: false, plan, job: this.#job }

    if (this.#job?.state === 'running') {
      const queued = new Set([...this.#queue.map((a) => a.path), this.#currentPath])
      const fresh = todo.filter((a) => !queued.has(a.path))
      this.#queue.push(...fresh)
      this.#job = { ...this.#job, filesTotal: this.#job.filesTotal + fresh.length }
    } else {
      this.#queue = [...todo]
      this.#job = { state: 'running', filesTotal: todo.length, filesDone: 0, framesDone: 0, current: null, failed: [], startedAt: Date.now(), finishedAt: null }
      this.#jobController = new AbortController()
      this.#running = this.#run(this.#jobController)
    }
    void this.#emit()
    return { ok: true, started: true, plan, job: this.#job }
  }

  /** Resolves when the running job (if any) has finished — for tests and for quit. */
  async settled(): Promise<void> {
    await this.#running
  }

  cancelIndex(): void {
    this.#jobController?.abort()
  }

  async #run(controller: AbortController): Promise<void> {
    const worker = this.#workerNow()
    let framesBefore = 0
    while (this.#queue.length > 0 && !controller.signal.aborted) {
      const asset = this.#queue.shift()!
      this.#currentPath = asset.path
      this.#job = { ...this.#job!, current: asset.name }
      void this.#emit()
      try {
        const name = await this.#cacheName(asset)
        const frames = await worker.indexFile(
          { path: asset.path, kind: asset.kind, durationUs: asset.durationUs, cacheDir: this.#config.cacheDir, cacheName: name },
          (done) => {
            this.#job = { ...this.#job!, framesDone: framesBefore + done }
            void this.#emit()
          },
          controller.signal
        )
        if (frames === null) break
        framesBefore += frames
        this.#job = { ...this.#job!, filesDone: this.#job!.filesDone + 1, framesDone: framesBefore }
      } catch (error) {
        if (controller.signal.aborted) break
        const message = error instanceof Error ? error.message : String(error)
        this.#job = { ...this.#job!, filesDone: this.#job!.filesDone + 1, failed: [...this.#job!.failed, { assetId: asset.assetId, name: asset.name, error: message }] }
      }
    }
    this.#queue = []
    this.#currentPath = null
    this.#job = { ...this.#job!, state: controller.signal.aborted ? 'cancelled' : 'done', current: null, finishedAt: Date.now() }
    void this.#emit()
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
    const ranking = rankFrames(vector, candidates, Math.max(1, Math.min(50, Math.round(request.limit))), exclude)
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
