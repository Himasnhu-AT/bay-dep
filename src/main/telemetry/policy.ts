/**
 * The decisions telemetry makes that are not about the queue: where reports go, the fence around
 * that one origin, how long to wait after a failed send, and which crashes are repeats.
 *
 * Electron-free — `app.isPackaged` and the environment are passed in — so each is unit-tested
 * over both values of what it depends on.
 */

import { SITE_ORIGIN } from '@shared/access'
import { CRASH_REPEAT_MS, TELEMETRY_BASE_ENV } from '@shared/telemetry'

type Env = Record<string, string | undefined>

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

export type TelemetryOrigin =
  | { kind: 'site'; origin: string }
  | { kind: 'local'; origin: string }
  /** This build sends nothing; `reason` is logged once at startup. */
  | { kind: 'none'; reason: string }

/**
 * An installed bay reports to `SITE_ORIGIN` and nowhere else, whatever its environment says. A
 * checkout (`electron .`) reports only to `BAY_TELEMETRY_BASE`, and only when that names a literal
 * loopback host — no name is resolved — so a development build never reaches production.
 */
export function telemetryOrigin(env: Env, isPackaged: boolean): TelemetryOrigin {
  if (isPackaged) return { kind: 'site', origin: SITE_ORIGIN }
  const value = env[TELEMETRY_BASE_ENV]
  if (!value) return { kind: 'none', reason: `a development build sends no telemetry unless ${TELEMETRY_BASE_ENV} names a stub on this Mac` }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { kind: 'none', reason: `${TELEMETRY_BASE_ENV} is not a URL: ${value}` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { kind: 'none', reason: `${TELEMETRY_BASE_ENV} must be http(s): ${value}` }
  }
  if (!LOOPBACK.has(parsed.hostname.toLowerCase())) {
    return { kind: 'none', reason: `${TELEMETRY_BASE_ENV} must be a stub on this Mac (http://127.0.0.1:<port>), not ${parsed.host}` }
  }
  return { kind: 'local', origin: parsed.origin }
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

/**
 * `fetch`, refusing every URL whose origin is not `origin` — the same shape as `guardedFetch` in
 * `auth/google.ts`. Redirects are not followed (`redirect: 'error'`): a 3xx from the site must not
 * carry a report to another host.
 */
export function guardedTelemetryFetch(inner: Fetch, origin: string): Fetch {
  const allowed = new URL(origin)
  return (url, init) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return Promise.reject(new Error(`bay's telemetry refused a malformed URL.`))
    }
    if (parsed.origin !== allowed.origin) {
      return Promise.reject(new Error(`bay's telemetry refused to contact ${parsed.host}: only ${allowed.host}.`))
    }
    return inner(url, { ...init, redirect: 'error' })
  }
}

export const BACKOFF_BASE_MS = 60_000
export const BACKOFF_MAX_MS = 60 * 60_000

/**
 * How long to wait before the next send after `failures` consecutive failures: 1, 2, 4 … minutes,
 * capped at an hour, with up to a fifth added at random (`jitter` in [0, 1)) so a site outage does
 * not bring every bay back at the same second.
 */
export function backoffMs(failures: number, jitter: number): number {
  if (failures <= 0) return 0
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 20))
  return Math.round(base * (1 + 0.2 * Math.min(Math.max(jitter, 0), 1)))
}

export type SendVerdict = 'sent' | 'drop' | 'retry'

/**
 * What a response means for the reports it carried. 2xx: sent. 400 (and the other "this body is
 * wrong" answers): dropped, never retried — the same bytes would be refused again. 429, 5xx and
 * anything else: kept, and retried after the backoff.
 */
export function verdictFor(status: number): SendVerdict {
  if (status >= 200 && status < 300) return 'sent'
  if (status === 400 || status === 413 || status === 422) return 'drop'
  return 'retry'
}

/** Same crash, same place: process, kind, the message's first line and the stack's first frame. */
export function crashSignature(report: { process: string; kind: string; message: string; stack?: string | undefined }): string {
  const firstLine = report.message.split('\n', 1)[0] ?? ''
  const frame = (report.stack ?? '').split('\n').find((line) => /^\s*at\s/.test(line))?.trim() ?? ''
  return `${report.process}|${report.kind}|${firstLine}|${frame}`
}

/**
 * At most one report per signature per `CRASH_REPEAT_MS`. A crash in a render loop throws sixty
 * times a second; one report says as much as all of them.
 */
export class CrashLimiter {
  readonly #last = new Map<string, number>()
  readonly #windowMs: number

  constructor(windowMs = CRASH_REPEAT_MS) {
    this.#windowMs = windowMs
  }

  /** True when this signature may be reported now (and records that it was). */
  admit(signature: string, now: number): boolean {
    const last = this.#last.get(signature)
    if (last !== undefined && now - last < this.#windowMs) return false
    this.#last.set(signature, now)
    // Bounded: a pathological stream of distinct signatures cannot grow this without limit.
    if (this.#last.size > 500) {
      for (const [key, at] of this.#last) if (now - at >= this.#windowMs) this.#last.delete(key)
      if (this.#last.size > 500) this.#last.delete(this.#last.keys().next().value as string)
    }
    return true
  }
}
