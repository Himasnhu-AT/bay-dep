/**
 * The app's telemetry allow-list, copied VERBATIM from ../src/shared/telemetry.ts
 * (the section between "-- events and their allow-listed props" and "-- the
 * contract as a check"). That file is the contract; it imports nothing and says
 * the website may copy it verbatim, so this is a copy, not a rewrite.
 *
 * Why the server needs it: the privacy rule is "nothing outside TELEMETRY_EVENTS
 * leaves the machine", and a rule only the client enforces is a rule anyone with
 * curl can ignore. checkTelemetry (telemetry.ts) runs every event through
 * sanitizeEvent below: an unknown name is dropped, a prop that is not listed or
 * has the wrong type is dropped.
 *
 * Do not edit the section below by hand. Change ../src/shared/telemetry.ts and
 * paste it again: src/lib/telemetry-contract.test.ts compares the two byte for
 * byte and fails on any drift. The style (no semicolons, single quotes) is the
 * app's, kept so the comparison is exact.
 */

export type TelemetryPropValue = string | number | boolean

export interface TelemetryEvent {
  name: string
  /** ms since the epoch */
  at: number
  props?: Record<string, TelemetryPropValue>
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

