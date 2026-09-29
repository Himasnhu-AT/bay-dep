/**
 * Usage telemetry and crash reports: the contract between bay and its website.
 *
 * Written before either side, and the website implements the receiving end to exactly this. Both
 * are ON by default, each with its own switch in Preferences › Privacy; a switch turned off means
 * nothing of that kind is sent and whatever of it was queued on disk is deleted.
 *
 * **What is never sent** (hard rules, checked in `src/main/telemetry/*.test.ts`): email, account
 * id, project names, file paths, asset names, prompts, transcripts, tool arguments, or media.
 * Event props are an allow-list per event name (`TELEMETRY_EVENTS`) — a prop not listed, or of the
 * wrong type, is dropped before it is queued. Crash messages and stacks are redacted in main
 * (`src/main/telemetry/redact.ts`): the home folder becomes `~`, directories of an absolute path
 * become `…`, the name of a file that is not code becomes `<file>` (its extension kept), and
 * emails become `<email>`.
 *
 * **Where**: `POST {origin}/api/telemetry` and `POST {origin}/api/crash`, JSON. `origin` is
 * `SITE_ORIGIN` in an installed bay. An unpackaged build sends only to `BAY_TELEMETRY_BASE`, and
 * only when that is a literal loopback http(s) URL — otherwise it sends nothing, so a checkout never
 * reports to production.
 *
 * **Answers**: 204 accepted; 400 `{ error }` a bad shape (never retried — the same bytes would be
 * refused again); 429 rate-limited; 5xx or no answer is retried with backoff from a bounded queue
 * on disk (`userData/telemetry-queue.json`: at most `QUEUE_MAX_EVENTS` events and
 * `QUEUE_MAX_CRASHES` crashes, oldest dropped first).
 *
 * Nothing here imports Node, Electron or React: both processes compile it, and the website may
 * copy it verbatim.
 */

export const TELEMETRY_VERSION = 1

export const TELEMETRY_PATH = '/api/telemetry'
export const CRASH_PATH = '/api/crash'

/** The unpackaged build's only destination, and only when it names a loopback host. */
export const TELEMETRY_BASE_ENV = 'BAY_TELEMETRY_BASE'

// -- limits -------------------------------------------------------------------------------------

export const MAX_EVENT_NAME = 64
export const EVENT_NAME_PATTERN = /^[a-z0-9_.]{1,64}$/
export const MAX_PROPS = 20
export const MAX_PROP_STRING = 200
export const MIN_EVENTS_PER_BATCH = 1
export const MAX_EVENTS_PER_BATCH = 100
export const MAX_CRASH_MESSAGE = 2000
export const MAX_CRASH_STACK = 16000
export const MAX_CRASH_REASON = 200

export const QUEUE_FILE = 'telemetry-queue.json'
export const INSTALL_ID_FILE = 'install-id'
export const QUEUE_MAX_EVENTS = 500
export const QUEUE_MAX_CRASHES = 50

export const FLUSH_INTERVAL_MS = 60_000
/** How long quitting waits for the last flush before it quits anyway. */
export const QUIT_FLUSH_MS = 2_000
/** An identical crash (same process, kind, message and top frame) is reported at most this often. */
export const CRASH_REPEAT_MS = 10 * 60_000

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

// -- the two bodies -----------------------------------------------------------------------------

/** Who is sending: the same six fields head both bodies. */
export interface TelemetryEnvelope {
  v: typeof TELEMETRY_VERSION
  /** A random UUID v4 made on first use and kept in userData — derived from nothing. */
  installId: string
  appVersion: string
  os: 'darwin'
  osVersion: string
  arch: string
}

export type TelemetryPropValue = string | number | boolean

export interface TelemetryEvent {
  name: string
  /** ms since the epoch */
  at: number
  props?: Record<string, TelemetryPropValue>
}

/** `POST /api/telemetry` */
export interface TelemetryBatch extends TelemetryEnvelope {
  events: TelemetryEvent[]
}

export const CRASH_PROCESSES = ['main', 'renderer', 'gpu', 'utility', 'child', 'composition'] as const
export type CrashProcess = (typeof CRASH_PROCESSES)[number]
export const CRASH_KINDS = ['exception', 'rejection', 'process-gone', 'renderer-error'] as const
export type CrashKind = (typeof CRASH_KINDS)[number]

/** `POST /api/crash` — one crash per request. */
export interface CrashReport extends TelemetryEnvelope {
  at: number
  process: CrashProcess
  kind: CrashKind
  message: string
  stack?: string
  /** `render-process-gone`/`child-process-gone`: Electron's reason (`crashed`, `oom`, …). */
  reason?: string
  exitCode?: number
}

// -- events and their allow-listed props ---------------------------------------------------------

export type PropSpec =
  | { type: 'count' }
  | { type: 'number' }
  | { type: 'boolean' }
  | { type: 'enum'; values: readonly string[] }
  /** A code name (a tool's name): `[a-z0-9_]`, at most 64. Never free text. */
  | { type: 'identifier' }

const count = { type: 'count' } as const
const number = { type: 'number' } as const
const boolean = { type: 'boolean' } as const
const identifier = { type: 'identifier' } as const
const oneOf = <const T extends readonly string[]>(values: T) => ({ type: 'enum', values }) as const

export const TELEMETRY_SWITCHES = ['telemetry', 'crash'] as const
export type TelemetrySwitch = (typeof TELEMETRY_SWITCHES)[number]

/** Resolve's pages as bay names them (`WorkspacePage` in the renderer's store). */
export const TELEMETRY_PAGES = ['media', 'edit', 'color', 'audio', 'deliver'] as const
/** `AssetKind` from `@shared/project`, spelled out so a new kind is a deliberate addition here. */
export const TELEMETRY_ASSET_KINDS = ['video', 'audio', 'image', 'gif', 'text', 'html', 'brf', 'lut', 'font'] as const
export const TELEMETRY_RUNTIMES = ['cli', 'sdk', 'codex'] as const
/** Where an export failed: `ExportProgress.stage` when the failure arrived. */
export const EXPORT_FAIL_STAGES = ['preparing', 'rendering', 'encoding', 'unknown'] as const
export type ExportFailStage = (typeof EXPORT_FAIL_STAGES)[number]

/**
 * Every event bay sends, and every prop each may carry. The list is the privacy rule: nothing
 * outside it leaves the machine.
 */
export const TELEMETRY_EVENTS = {
  app_open: { launchMs: count },
  app_quit: {},
  project_open: { tracks: count, items: count },
  export_done: { durationSec: number, width: count, height: count, fps: number, ok: boolean, incomplete: boolean, elapsedMs: count },
  export_failed: { stage: oneOf(EXPORT_FAIL_STAGES) },
  agent_turn: { runtime: oneOf(TELEMETRY_RUNTIMES), toolCalls: count, ok: boolean },
  tool_call: { tool: identifier, ok: boolean },
  import_media: { kind: oneOf(TELEMETRY_ASSET_KINDS), count },
  page_view: { page: oneOf(TELEMETRY_PAGES) },
  pref_changed: { key: oneOf(TELEMETRY_SWITCHES) }
} as const satisfies Record<string, Record<string, PropSpec>>

export type TelemetryEventName = keyof typeof TELEMETRY_EVENTS

type ValueOf<S> = S extends { type: 'enum'; values: readonly (infer V)[] }
  ? V
  : S extends { type: 'boolean' }
    ? boolean
    : S extends { type: 'identifier' }
      ? string
      : number

/** The props a caller may pass for an event, typed from `TELEMETRY_EVENTS`. All optional. */
export type TelemetryProps<N extends TelemetryEventName> = {
  [K in keyof (typeof TELEMETRY_EVENTS)[N]]?: ValueOf<(typeof TELEMETRY_EVENTS)[N][K]>
}

/** The only events the renderer may ask main to send; everything else is fired in main. */
export const RENDERER_EVENTS: readonly TelemetryEventName[] = ['page_view']

export function isTelemetryEventName(name: unknown): name is TelemetryEventName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(TELEMETRY_EVENTS, name)
}

function propAllowed(spec: PropSpec, value: unknown): value is TelemetryPropValue {
  switch (spec.type) {
    case 'count':
      return typeof value === 'number' && Number.isInteger(value) && value >= 0
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0
    case 'boolean':
      return typeof value === 'boolean'
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value)
    case 'identifier':
      return typeof value === 'string' && /^[a-z0-9_]{1,64}$/.test(value)
  }
}

/**
 * The event as it may be sent, or null for a name that is not in the list. A prop that is not
 * allow-listed for this event, or has the wrong type, is dropped — never passed through.
 */
export function sanitizeEvent(name: unknown, props: unknown, at: number): TelemetryEvent | null {
  if (!isTelemetryEventName(name)) return null
  const specs = TELEMETRY_EVENTS[name] as Record<string, PropSpec>
  const kept: Record<string, TelemetryPropValue> = {}
  if (props && typeof props === 'object') {
    for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
      const spec = specs[key]
      if (spec && propAllowed(spec, value)) kept[key] = typeof value === 'number' ? Math.round(value * 1000) / 1000 : value
    }
  }
  return Object.keys(kept).length > 0 ? { name, at, props: kept } : { name, at }
}

// -- the contract as a check (what the server refuses with 400) ----------------------------------

function envelopeProblem(body: Record<string, unknown>): string | null {
  if (body['v'] !== TELEMETRY_VERSION) return `v must be ${TELEMETRY_VERSION}`
  if (typeof body['installId'] !== 'string' || !UUID_V4.test(body['installId'])) return 'installId must be a UUID v4'
  for (const key of ['appVersion', 'osVersion', 'arch'] as const) {
    const value = body[key]
    if (typeof value !== 'string' || value.length === 0 || value.length > 64) return `${key} must be a string of 1–64 characters`
  }
  if (body['os'] !== 'darwin') return 'os must be "darwin"'
  return null
}

/** Why a telemetry body breaks the contract, or null when the server must accept its shape. */
export function telemetryBatchProblem(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'the body must be a JSON object'
  const record = body as Record<string, unknown>
  const envelope = envelopeProblem(record)
  if (envelope) return envelope
  const events = record['events']
  if (!Array.isArray(events) || events.length < MIN_EVENTS_PER_BATCH || events.length > MAX_EVENTS_PER_BATCH) {
    return `events must hold ${MIN_EVENTS_PER_BATCH}–${MAX_EVENTS_PER_BATCH} events`
  }
  for (const [index, event] of events.entries()) {
    if (!event || typeof event !== 'object') return `events[${index}] must be an object`
    const { name, at, props } = event as Record<string, unknown>
    if (typeof name !== 'string' || !EVENT_NAME_PATTERN.test(name)) return `events[${index}].name must match [a-z0-9_.], at most ${MAX_EVENT_NAME}`
    if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return `events[${index}].at must be ms since the epoch`
    if (props === undefined) continue
    if (!props || typeof props !== 'object' || Array.isArray(props)) return `events[${index}].props must be an object`
    const entries = Object.entries(props as Record<string, unknown>)
    if (entries.length > MAX_PROPS) return `events[${index}].props may have at most ${MAX_PROPS} keys`
    for (const [key, value] of entries) {
      if (typeof value === 'string' && value.length > MAX_PROP_STRING) return `events[${index}].props.${key} is longer than ${MAX_PROP_STRING}`
      if (typeof value === 'number' && !Number.isFinite(value)) return `events[${index}].props.${key} must be finite`
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return `events[${index}].props.${key} must be a string, number or boolean`
      }
    }
  }
  return null
}

/** Why a crash body breaks the contract, or null when the server must accept its shape. */
export function crashReportProblem(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'the body must be a JSON object'
  const record = body as Record<string, unknown>
  const envelope = envelopeProblem(record)
  if (envelope) return envelope
  if (typeof record['at'] !== 'number' || !Number.isFinite(record['at']) || record['at'] <= 0) return 'at must be ms since the epoch'
  if (!(CRASH_PROCESSES as readonly unknown[]).includes(record['process'])) return `process must be one of ${CRASH_PROCESSES.join(', ')}`
  if (!(CRASH_KINDS as readonly unknown[]).includes(record['kind'])) return `kind must be one of ${CRASH_KINDS.join(', ')}`
  if (typeof record['message'] !== 'string' || record['message'].length > MAX_CRASH_MESSAGE) return `message must be a string of at most ${MAX_CRASH_MESSAGE}`
  if (record['stack'] !== undefined && (typeof record['stack'] !== 'string' || record['stack'].length > MAX_CRASH_STACK)) {
    return `stack must be a string of at most ${MAX_CRASH_STACK}`
  }
  if (record['reason'] !== undefined && (typeof record['reason'] !== 'string' || record['reason'].length > MAX_CRASH_REASON)) {
    return `reason must be a string of at most ${MAX_CRASH_REASON}`
  }
  if (record['exitCode'] !== undefined && (typeof record['exitCode'] !== 'number' || !Number.isInteger(record['exitCode']))) {
    return 'exitCode must be an integer'
  }
  return null
}

// -- what the renderer sees ----------------------------------------------------------------------

/**
 * Preferences › Privacy's status. Each state has its sentence:
 * - `telemetry && destination` — "Usage data is on and goes to bay.himanshuat.com."
 * - `telemetry && !destination` — "On, but this is a development build: nothing is sent."
 * - `!telemetry` — "Off. Nothing is sent and nothing is kept to send later."
 * - `queued.events > 0 && lastProblem` — "12 events are waiting: the last send failed (…)."
 */
export interface TelemetryStatus {
  telemetry: boolean
  crash: boolean
  /** Where reports go, or null when this build sends nothing (unpackaged, no loopback base). */
  destination: string | null
  queued: { events: number; crashes: number }
  /** Why the last send did not land, or null after one that did (or before any). */
  lastProblem: string | null
  /** Electron's crash dumps: kept on this Mac, never uploaded. */
  minidumpDir: string
  /** The one-time first-launch notice has not been dismissed yet. */
  noticePending: boolean
}

/** What the renderer forwards about its own uncaught error: text only, redacted by main. */
export interface RendererErrorReport {
  kind: 'error' | 'rejection'
  message: string
  stack?: string
}
