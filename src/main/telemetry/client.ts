/**
 * The queue and the sender: everything telemetry does except asking Electron things.
 *
 * Electron-free. `service.ts` builds one with the real `fetch`, paths and switches; the tests
 * build one with a fake fetch and a temp folder and read exactly what would have been sent.
 *
 * - Nothing is queued while its switch is off, and turning a switch off deletes what of it was
 *   queued — the file goes when nothing is left in it.
 * - A build with no destination (`origin: null`) queues nothing and writes no file.
 * - The queue is bounded (`QUEUE_MAX_EVENTS`, `QUEUE_MAX_CRASHES`), oldest dropped first, and kept
 *   on disk only when a send failed, at quit, or when a crash arrives (the process may be dying).
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  CRASH_PATH,
  MAX_CRASH_MESSAGE,
  MAX_CRASH_REASON,
  MAX_CRASH_STACK,
  MAX_EVENTS_PER_BATCH,
  QUEUE_MAX_CRASHES,
  QUEUE_MAX_EVENTS,
  TELEMETRY_PATH,
  crashReportProblem,
  sanitizeEvent,
  telemetryBatchProblem,
  type CrashKind,
  type CrashProcess,
  type CrashReport,
  type TelemetryEnvelope,
  type TelemetryEvent,
  type TelemetryEventName,
  type TelemetryProps,
  type TelemetrySwitch
} from '@shared/telemetry'
import { CrashLimiter, backoffMs, crashSignature, guardedTelemetryFetch, verdictFor, type Fetch } from './policy'
import { redactTo } from './redact'

export interface QueueState {
  events: TelemetryEvent[]
  crashes: CrashReport[]
}

/** The queue with its oldest entries dropped past the caps. */
export function boundQueue(queue: QueueState): QueueState {
  return {
    events: queue.events.length > QUEUE_MAX_EVENTS ? queue.events.slice(-QUEUE_MAX_EVENTS) : queue.events,
    crashes: queue.crashes.length > QUEUE_MAX_CRASHES ? queue.crashes.slice(-QUEUE_MAX_CRASHES) : queue.crashes
  }
}

/**
 * The queue on disk, re-checked entry by entry: a file an older build wrote, or one edited by
 * hand, cannot put anything on the wire that this build would not have queued itself.
 */
export function readQueue(path: string): QueueState {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { events: [], crashes: [] }
  }
  const record = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  const events: TelemetryEvent[] = []
  for (const entry of Array.isArray(record['events']) ? record['events'] : []) {
    const { name, props, at } = (entry ?? {}) as Record<string, unknown>
    const event = typeof at === 'number' && Number.isFinite(at) && at > 0 ? sanitizeEvent(name, props, at) : null
    if (event) events.push(event)
  }
  const crashes: CrashReport[] = []
  for (const entry of Array.isArray(record['crashes']) ? record['crashes'] : []) {
    if (crashReportProblem(entry) === null) crashes.push(entry as CrashReport)
  }
  return boundQueue({ events, crashes })
}

/** Written whole and renamed into place; an empty queue is no file at all. */
export function writeQueue(path: string, queue: QueueState): void {
  if (queue.events.length === 0 && queue.crashes.length === 0) {
    try {
      unlinkSync(path)
    } catch {
      // Already gone.
    }
    return
  }
  mkdirSync(dirname(path), { recursive: true })
  const part = `${path}.part`
  writeFileSync(part, JSON.stringify(queue), { mode: 0o600 })
  renameSync(part, path)
}

export interface CrashInput {
  process: CrashProcess
  kind: CrashKind
  message: string
  stack?: string | undefined
  reason?: string | undefined
  exitCode?: number | undefined
}

export interface ClientOptions {
  envelope: TelemetryEnvelope
  /** Where reports go; null for a build that sends nothing. */
  origin: string | null
  fetch: Fetch
  queuePath: string
  /** The home folder, which redaction turns into `~`. */
  home: string
  switches: Record<TelemetrySwitch, boolean>
  now?: () => number
  random?: () => number
}

export class TelemetryClient {
  readonly #options: ClientOptions
  readonly #fetch: Fetch | null
  readonly #limiter = new CrashLimiter()
  readonly #now: () => number
  readonly #random: () => number
  #switches: Record<TelemetrySwitch, boolean>
  #queue: QueueState
  #failures = 0
  #nextAttemptAt = 0
  #lastProblem: string | null = null
  #flushing: Promise<void> | null = null

  constructor(options: ClientOptions) {
    this.#options = options
    this.#now = options.now ?? Date.now
    this.#random = options.random ?? Math.random
    this.#switches = { ...options.switches }
    this.#fetch = options.origin ? guardedTelemetryFetch(options.fetch, options.origin) : null
    // What a previous run could not send — kept only for the switches still on.
    // A build with nowhere to send leaves the file alone: it may be an installed bay's, waiting.
    this.#queue = options.origin ? this.#filtered(readQueue(options.queuePath)) : { events: [], crashes: [] }
    this.persist()
  }

  get switches(): Record<TelemetrySwitch, boolean> {
    return { ...this.#switches }
  }

  get queued(): { events: number; crashes: number } {
    return { events: this.#queue.events.length, crashes: this.#queue.crashes.length }
  }

  get lastProblem(): string | null {
    return this.#lastProblem
  }

  /** Queues one event, if usage telemetry is on and this build has somewhere to send it. */
  track<N extends TelemetryEventName>(name: N, props?: TelemetryProps<N>): void {
    if (!this.#fetch || !this.#switches.telemetry) return
    const event = sanitizeEvent(name, props, this.#now())
    if (!event) return
    this.#queue = boundQueue({ ...this.#queue, events: [...this.#queue.events, event] })
  }

  /**
   * Queues one crash, redacted, and writes the queue at once — the process reporting it may be
   * about to die. False when crash reports are off, the build sends nothing, or the same crash was
   * reported within the last ten minutes.
   */
  crash(input: CrashInput): boolean {
    if (!this.#fetch || !this.#switches.crash) return false
    const home = this.#options.home
    const report: CrashReport = {
      ...this.#options.envelope,
      at: this.#now(),
      process: input.process,
      kind: input.kind,
      message: redactTo(String(input.message ?? '').slice(0, MAX_CRASH_STACK * 2), home, MAX_CRASH_MESSAGE)
    }
    if (input.stack) report.stack = redactTo(String(input.stack).slice(0, MAX_CRASH_STACK * 2), home, MAX_CRASH_STACK)
    if (input.reason) report.reason = redactTo(String(input.reason), home, MAX_CRASH_REASON)
    if (typeof input.exitCode === 'number' && Number.isInteger(input.exitCode)) report.exitCode = input.exitCode
    if (!this.#limiter.admit(crashSignature(report), report.at)) return false
    this.#queue = boundQueue({ ...this.#queue, crashes: [...this.#queue.crashes, report] })
    this.persist()
    return true
  }

  /**
   * Turns one switch. Off deletes what of that kind was queued (and the file with it when nothing
   * is left); on, while usage telemetry is on, is itself one `pref_changed` event.
   */
  setSwitch(which: TelemetrySwitch, on: boolean): void {
    const was = this.#switches[which]
    this.#switches = { ...this.#switches, [which]: on }
    if (!on) {
      this.#queue = this.#filtered(this.#queue)
      this.persist()
    } else if (!was) {
      this.track('pref_changed', { key: which })
    }
  }

  /** Writes the queue as it is now (or deletes the file when it is empty). Synchronous. */
  persist(): void {
    if (!this.#fetch) return
    this.#write(this.#queue)
  }

  /**
   * Sends what is queued: each crash on its own, events in batches of at most 100. Stops at the
   * first answer that says try later, and waits out the backoff before trying again. One flush at
   * a time; a second call joins the first.
   */
  flush(): Promise<void> {
    if (this.#flushing) return this.#flushing
    this.#flushing = this.#send().finally(() => {
      this.#flushing = null
    })
    return this.#flushing
  }

  async #send(): Promise<void> {
    const fetcher = this.#fetch
    if (!fetcher) return
    if (this.#now() < this.#nextAttemptAt) return
    const origin = this.#options.origin as string

    while (this.#switches.crash && this.#queue.crashes.length > 0) {
      const report = this.#queue.crashes[0]!
      const verdict = await this.#post(fetcher, `${origin}${CRASH_PATH}`, report, crashReportProblem(report))
      if (verdict === 'retry') return this.#settle()
      this.#queue = { ...this.#queue, crashes: this.#queue.crashes.filter((entry) => entry !== report) }
    }

    while (this.#switches.telemetry && this.#queue.events.length > 0) {
      const events = this.#queue.events.slice(0, MAX_EVENTS_PER_BATCH)
      const body = { ...this.#options.envelope, events }
      const verdict = await this.#post(fetcher, `${origin}${TELEMETRY_PATH}`, body, telemetryBatchProblem(body))
      if (verdict === 'retry') return this.#settle()
      const sent = new Set(events)
      this.#queue = { ...this.#queue, events: this.#queue.events.filter((event) => !sent.has(event)) }
    }
    this.#failures = 0
    this.#nextAttemptAt = 0
    this.#settle()
  }

  async #post(fetcher: Fetch, url: string, body: unknown, problem: string | null): Promise<'sent' | 'drop' | 'retry'> {
    // A body this build would itself call malformed is dropped rather than sent to be refused.
    if (problem) {
      this.#lastProblem = `A report was dropped before sending: ${problem}.`
      return 'drop'
    }
    let status: number
    try {
      const response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      status = response.status
    } catch (error) {
      return this.#failed(`the site could not be reached (${error instanceof Error ? error.message : String(error)})`)
    }
    const verdict = verdictFor(status)
    if (verdict === 'retry') return this.#failed(status === 429 ? 'the site asked bay to slow down (429)' : `the site answered ${status}`)
    this.#lastProblem = verdict === 'drop' ? `The site refused a report as malformed (${status}); it was dropped.` : null
    return verdict
  }

  #failed(why: string): 'retry' {
    this.#failures += 1
    const wait = backoffMs(this.#failures, this.#random())
    this.#nextAttemptAt = this.#now() + wait
    this.#lastProblem = `The last send failed: ${why}. Trying again in ${Math.max(1, Math.round(wait / 60_000))} min.`
    return 'retry'
  }

  /** After a send: what is left is written, and the file goes when nothing is. */
  #settle(): void {
    this.persist()
  }

  #filtered(queue: QueueState): QueueState {
    return {
      events: this.#switches.telemetry ? queue.events : [],
      crashes: this.#switches.crash ? queue.crashes : []
    }
  }

  #write(queue: QueueState): void {
    try {
      writeQueue(this.#options.queuePath, queue)
    } catch (error) {
      console.warn(`[bay] telemetry: could not write the queue: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

const INSTALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * This install's id: a random UUID v4 made the first time and kept in `path`. Derived from
 * nothing — not the account, the machine or the user — so it identifies an install and no one.
 * A file that is missing or does not hold a v4 UUID is replaced with a new one.
 */
export function installIdAt(path: string, make: () => string): string {
  try {
    const existing = readFileSync(path, 'utf8').trim()
    if (INSTALL_ID.test(existing)) return existing
  } catch {
    // None yet.
  }
  const id = make()
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${id}\n`, { mode: 0o600 })
  } catch (error) {
    console.warn(`[bay] telemetry: could not keep the install id: ${error instanceof Error ? error.message : String(error)}`)
  }
  return id
}
