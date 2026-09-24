/**
 * The generation job table: persisted before anything is sent, polled until it lands, resumed
 * after a restart.
 *
 * Order of operations for one job, and why:
 *
 * 1. The row is written to `generation-jobs.json` as `queued` **before** the request goes out. A
 *    paid request bay has no record of is the one failure that costs the user money and leaves
 *    nothing to show for it.
 * 2. The provider answers. An image provider answers with the picture (→ collect). A video
 *    provider answers with a handle, written to the row as `running` before polling begins, so a
 *    restart resumes polling that handle instead of paying for a second clip.
 * 3. Collect writes the bytes content-addressed under the output folder (`<userData>/generated`
 *    in the app), probes the file, and records findings. A blocking finding — no picture in it —
 *    fails the job rather than handing the editor a blank to import.
 *
 * On load, a `running` row with a handle resumes polling. A `queued` row, or a `running` one
 * with no handle, was in flight when bay stopped: bay cannot know whether the provider started
 * (and charged for) it, so it is failed with that sentence rather than silently resubmitted.
 *
 * Electron-free: the adapters, HTTP, credentials, probe and clock are injected, so `jobs.test.ts`
 * runs the whole cycle — resume included — against a local stub server.
 */

import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  DEFAULT_GENERATION_LIMITS,
  PROVIDERS,
  REFERENCE_IMAGE_TYPES,
  REFERENCE_MAX_BYTES,
  findingsFor,
  spendRefusal,
  validateGeneration,
  type GenerationJob,
  type GenerationLimits,
  type GenerationProvider,
  type GenerationRequest,
  type GenerationSpending,
  type ProbedOutput
} from '@shared/generation'
import { validateSpeech } from '@shared/speech'
import type { Adapter, AdapterContext, Credentials, Output, Reference } from './adapter'
import { ProviderError, extensionFor } from './adapter'
import type { ProviderHttp } from './http'

export interface JobDeps {
  /** `<userData>/generation-jobs.json`. */
  file: string
  /** Where collected results are written. */
  outDir: string
  adapters: Record<GenerationProvider, Adapter>
  http(provider: GenerationProvider): ProviderHttp
  baseUrl(provider: GenerationProvider): string
  credentials(provider: GenerationProvider): Credentials | null
  probe(path: string): Promise<ProbedOutput>
  /** Whether a reference path may be sent: in the app, only media already admitted to `bay://`. */
  referenceAllowed?(path: string): boolean
  now?(): number
  /** Delay before the next poll of a job, by how many polls it has had. */
  pollDelayMs?(polls: number): number
  /**
   * A job still unfinished after this long *of polling by this process* is failed. Measured from
   * when this process began polling it, and checked only after a poll says it is still running,
   * so a job resumed after a long quit is always asked once, and collected if it finished.
   */
  maxAgeMs?: number
  /** Consecutive transient poll errors tolerated before the job fails. */
  maxPollErrors?: number
  /** How long `start` waits for the submission before answering with the job as it stands. */
  startWaitMs?: number
  /**
   * The spend guard's limits, read on every `start`. Absent means the defaults. Enforced here,
   * in main, so the in-app agent, a terminal client on the socket and a script all meet the same
   * wall; the renderer's checks are for the agent's benefit, not the lock.
   */
  limits?(): GenerationLimits
  onChange?(job: GenerationJob): void
}

const KEEP_JOBS = 200

interface FileShape {
  version: 1
  jobs: GenerationJob[]
}

export class GenerationJobs {
  readonly #deps: JobDeps
  readonly #jobs = new Map<string, GenerationJob>()
  readonly #timers = new Map<string, NodeJS.Timeout>()
  /** When this process began polling each job: the age limit runs from here, not `createdAt`. */
  readonly #pollingSince = new Map<string, number>()
  #writing: Promise<void> = Promise.resolve()
  #loading: Promise<void> | null = null
  /** Estimated USD of every job this process has sent. Resumed jobs were paid for by an earlier run. */
  #spentUsd = 0
  #stopped = false

  constructor(deps: JobDeps) {
    this.#deps = deps
  }

  #now(): number {
    return this.#deps.now?.() ?? Date.now()
  }

  /**
   * Reads the table and resumes every job that can be resumed. Idempotent: `start` awaits it
   * first, so a job started while the file is still being read cannot write a table that lacks
   * every row the file held.
   */
  load(): Promise<void> {
    this.#loading ??= this.#load()
    return this.#loading
  }

  async #load(): Promise<void> {
    let file: Partial<FileShape> | null = null
    try {
      file = JSON.parse(await readFile(this.#deps.file, 'utf8')) as Partial<FileShape>
    } catch {
      file = null
    }
    for (const job of Array.isArray(file?.jobs) ? file.jobs : []) {
      if (!job || typeof job.id !== 'string' || !job.request) continue
      this.#jobs.set(job.id, job)
    }
    const interrupted: GenerationJob[] = []
    for (const job of this.#jobs.values()) {
      if (job.status === 'running' && job.remote) this.#schedule(job, 0, 0)
      else if (job.status === 'queued' || job.status === 'running') interrupted.push(job)
    }
    for (const job of interrupted) {
      this.#update(job, {
        status: 'failed',
        error:
          'bay stopped while this request was being sent or answered, so it cannot tell whether the provider ' +
          'started (and charged for) it. Check the provider’s dashboard before generating again.'
      })
    }
    if (interrupted.length > 0) await this.#persist()
  }

  list(): GenerationJob[] {
    return [...this.#jobs.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  /** What the spend guard has counted this session, and the limits it holds calls to. */
  spending(): GenerationSpending {
    const limits = this.#deps.limits?.() ?? DEFAULT_GENERATION_LIMITS
    let active = 0
    for (const job of this.#jobs.values()) if (job.status === 'queued' || job.status === 'running') active++
    return {
      spentUsd: Math.round(this.#spentUsd * 100) / 100,
      budgetUsd: limits.budgetUsd,
      active,
      maxActive: limits.maxActive
    }
  }

  get(id: string): GenerationJob | null {
    const job = this.#jobs.get(id)
    return job ? structuredClone(job) : null
  }

  /** Stops every poll. Jobs stay `running` on disk and resume on the next `load`. */
  stop(): void {
    this.#stopped = true
    for (const timer of this.#timers.values()) clearTimeout(timer)
    this.#timers.clear()
  }

  /** Waits for every pending write. For tests and quit. */
  async flush(): Promise<void> {
    await this.#writing
  }

  /**
   * Validates again (main trusts nothing the renderer sends), persists the row, then submits.
   * Answers with the job as it stands once the submission settles or `startWaitMs` passes,
   * whichever is first — so a refused key comes back in the same call, and a slow image does
   * not hold the tool call open.
   */
  async start(input: GenerationRequest): Promise<{ ok: true; job: GenerationJob; spending: GenerationSpending } | { ok: false; error: string }> {
    await this.load()
    const checked =
      input?.kind === 'speech' ? validateSpeech({ ...input }) : validateGeneration({ ...input }, input?.kind === 'video' ? 'video' : 'image')
    if (!checked.ok) return { ok: false, error: checked.errors.join(' ') }
    const request = checked.request
    const provider = request.provider
    const credentials = this.#deps.credentials(provider)
    if (!credentials) {
      return {
        ok: false,
        error: `No ${PROVIDERS[provider].label} key is set. Ask the user to add one in Settings › Providers — never ask for a key in chat.`
      }
    }

    let reference: Reference | null = null
    if (request.referencePath) {
      const loaded = await this.#reference(request.referencePath)
      if ('error' in loaded) return { ok: false, error: loaded.error }
      reference = loaded
    }

    // The guard's check and the reservation below are one synchronous step (no await between
    // them), so two calls racing each other cannot both fit under a limit only one fits under.
    const refusal = spendRefusal(this.spending(), checked.estimatedCostUsd)
    if (refusal) return { ok: false, error: refusal }

    const now = this.#now()
    const job: GenerationJob = {
      id: randomUUID(),
      provider,
      model: request.model,
      kind: request.kind,
      status: 'queued',
      request,
      estimatedCostUsd: checked.estimatedCostUsd,
      createdAt: now,
      updatedAt: now
    }
    this.#jobs.set(job.id, job)
    this.#spentUsd += checked.estimatedCostUsd
    this.#prune()
    // The one write that must land: a paid request bay has no record of is the failure this
    // table exists to prevent, so if the row cannot be written the request is not sent.
    try {
      await this.#write()
    } catch (error) {
      this.#jobs.delete(job.id)
      this.#spentUsd -= checked.estimatedCostUsd
      return {
        ok: false,
        error:
          `bay could not record this request before sending it (${messageOf(error)}), so it was not sent and nothing was charged. ` +
          'Tell the user bay cannot write to its data folder (disk full or permissions); retrying fails the same way until that is fixed.'
      }
    }

    const submission = this.#submit(job, credentials, reference)
    const wait = this.#deps.startWaitMs ?? 4000
    await Promise.race([submission, new Promise((resolve) => setTimeout(resolve, wait).unref?.())])
    return { ok: true, job: structuredClone(job), spending: this.spending() }
  }

  async #reference(given: string): Promise<Reference | { error: string }> {
    // Resolved once, before both the check and the read, so `<allowed dir>/../secret.png` is
    // judged (and read) as the file it actually names.
    const path = resolve(given)
    const name = path.split('/').pop() ?? 'reference'
    if (this.#deps.referenceAllowed && !this.#deps.referenceAllowed(path)) {
      return { error: `The reference "${name}" is not media in this project. Import it first and pass its asset id.` }
    }
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    const mime = Object.hasOwn(REFERENCE_IMAGE_TYPES, ext) ? REFERENCE_IMAGE_TYPES[ext] : undefined
    if (!mime) return { error: `The reference must be a PNG, JPEG or WebP picture; "${name}" is not.` }
    let bytes: Buffer
    try {
      bytes = await readFile(path)
    } catch (error) {
      return { error: `The reference "${name}" could not be read (${error instanceof Error ? error.message : String(error)}). Relink it, or choose another picture.` }
    }
    if (bytes.length > REFERENCE_MAX_BYTES) {
      return { error: `The reference "${name}" is ${(bytes.length / 1048576).toFixed(1)} MB; providers take at most ${REFERENCE_MAX_BYTES / 1048576} MB. Use a smaller export of it.` }
    }
    return { bytes, mime, name }
  }

  #context(provider: GenerationProvider, credentials: Credentials, reference: Reference | null): AdapterContext {
    return {
      http: this.#deps.http(provider),
      credentials,
      baseUrl: this.#deps.baseUrl(provider),
      reference,
      now: () => this.#now()
    }
  }

  async #submit(job: GenerationJob, credentials: Credentials, reference: Reference | null): Promise<void> {
    const adapter = this.#deps.adapters[job.provider]
    this.#update(job, { status: 'running' })
    try {
      const started = await adapter.start(job.request, this.#context(job.provider, credentials, reference))
      if (started.kind === 'pending') {
        this.#update(job, { remote: started.handle })
        await this.#persist()
        this.#schedule(job, 0, 0)
        return
      }
      await this.#persist()
      await this.#collect(job, started.output)
    } catch (error) {
      this.#update(job, { status: 'failed', error: messageOf(error) })
      await this.#persist()
    }
  }

  #schedule(job: GenerationJob, polls: number, errors: number): void {
    if (this.#stopped) return
    if (!this.#pollingSince.has(job.id)) this.#pollingSince.set(job.id, this.#now())
    const delay = polls === 0 ? 0 : (this.#deps.pollDelayMs?.(polls) ?? Math.min(15000, 5000 + polls * 1000))
    const timer = setTimeout(() => {
      this.#timers.delete(job.id)
      void this.#poll(job, polls + 1, errors)
    }, delay)
    timer.unref?.()
    this.#timers.set(job.id, timer)
  }

  async #poll(job: GenerationJob, polls: number, errors: number): Promise<void> {
    if (this.#stopped) return
    const adapter = this.#deps.adapters[job.provider]
    const credentials = this.#deps.credentials(job.provider)
    if (!credentials) {
      this.#update(job, { status: 'failed', error: `The ${PROVIDERS[job.provider].label} key was removed while this job ran, so bay cannot check on it. Set the key again and generate again.` })
      await this.#persist()
      return
    }
    if (!adapter.poll || !job.remote) {
      this.#update(job, { status: 'failed', error: 'This job has nothing to poll. Generate again.' })
      await this.#persist()
      return
    }
    const ctx = this.#context(job.provider, credentials, null)
    try {
      const result = await adapter.poll(job.remote, ctx)
      if (result.kind === 'running') {
        this.#update(job, result.progress === undefined ? {} : { progress: result.progress })
        const maxAge = this.#deps.maxAgeMs ?? 45 * 60 * 1000
        const since = this.#pollingSince.get(job.id) ?? this.#now()
        if (this.#now() - since > maxAge) {
          this.#update(job, {
            status: 'failed',
            error: `Still unfinished after ${Math.max(1, Math.round(maxAge / 60000))} minutes of waiting, so bay stopped. The provider may yet finish it — its dashboard will say.`
          })
          await this.#persist()
          return
        }
        this.#schedule(job, polls, 0)
        return
      }
      if (result.kind === 'failed') {
        this.#update(job, { status: 'failed', error: result.error })
        await this.#persist()
        return
      }
      if (!adapter.collect) throw new ProviderError('This provider has no way to collect its result.', false)
      const output = await adapter.collect(result.location, ctx)
      await this.#collect(job, output)
    } catch (error) {
      const retryable = !(error instanceof ProviderError) || error.retryable
      const limit = this.#deps.maxPollErrors ?? 8
      if (retryable && errors + 1 < limit) {
        this.#schedule(job, polls, errors + 1)
        return
      }
      this.#update(job, { status: 'failed', error: messageOf(error) })
      await this.#persist()
    }
  }

  async #collect(job: GenerationJob, output: Output): Promise<void> {
    const ext = extensionFor(output.mime) ?? (job.kind === 'video' ? 'mp4' : job.kind === 'speech' ? 'mp3' : 'png')
    const hash = createHash('sha256').update(output.bytes).digest('hex').slice(0, 12)
    const slug =
      job.request.prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'generated'
    await mkdir(this.#deps.outDir, { recursive: true })
    const path = join(this.#deps.outDir, `${slug}-${hash}.${ext}`)
    // Content-addressed: an existing file here already holds exactly these bytes.
    const exists = await access(path).then(
      () => true,
      () => false
    )
    if (!exists) {
      const temp = `${path}.part`
      await writeFile(temp, output.bytes)
      await rename(temp, path)
    }
    let probed: ProbedOutput | null = null
    let probeError: string | undefined
    try {
      probed = await this.#deps.probe(path)
    } catch (error) {
      probeError = messageOf(error)
    }
    const findings = findingsFor(job.request, probed, probeError)
    const blocking = findings.find((f) => f.severity === 'blocking')
    if (blocking) {
      this.#update(job, { status: 'failed', error: blocking.message, findings })
    } else {
      this.#update(job, { status: 'done', outputPath: path, findings, progress: 1 })
    }
    await this.#persist()
  }

  #update(job: GenerationJob, patch: Partial<GenerationJob>): void {
    Object.assign(job, patch, { updatedAt: this.#now() })
    this.#deps.onChange?.(structuredClone(job))
  }

  #prune(): void {
    if (this.#jobs.size <= KEEP_JOBS) return
    const finished = this.list()
      .filter((j) => j.status === 'done' || j.status === 'failed')
      .slice(KEEP_JOBS / 2)
    for (const job of finished) this.#jobs.delete(job.id)
  }

  /**
   * A write whose failure is logged, not returned: every write after the first, when the
   * request is already out and failing the job over a disk error would only hide a result that
   * is on its way.
   */
  #persist(): Promise<void> {
    return this.#write().catch((error: unknown) => {
      console.error(`[bay] generation: could not save the job table: ${messageOf(error)}`)
    })
  }

  /** Writes are chained, so two jobs finishing together cannot interleave their temp files. Rejects on failure. */
  #write(): Promise<void> {
    const snapshot: FileShape = { version: 1, jobs: this.list() }
    const bytes = JSON.stringify(snapshot, null, 2)
    const next = this.#writing.then(async () => {
      const temp = `${this.#deps.file}.tmp`
      await writeFile(temp, bytes, { mode: 0o600 })
      await rename(temp, this.#deps.file)
    })
    // The chain itself never rejects, so one failed write does not fail every write after it.
    this.#writing = next.catch(() => undefined)
    return next
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
