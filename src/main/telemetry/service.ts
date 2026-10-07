/**
 * Usage telemetry and crash reports, wired to Electron. The decisions live in `client.ts`,
 * `policy.ts` and `redact.ts`, which run under `pnpm test`; this file only asks Electron for what
 * they need and connects the events.
 *
 * Main is the only sender, over Node's `fetch` fenced to one origin (`guardedTelemetryFetch`). The
 * editor's session stays blocked (`offline.ts`): the renderer asks main to record a page view or
 * its own uncaught error, and never reaches the network itself.
 *
 * The switches are main's database's (`project/store.ts`, like "Allow MCP clients"), passed in at
 * start and on every change, so this folder imports no other folder of main.
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, autoUpdater, crashReporter, type WebContents } from 'electron'
import {
  FLUSH_INTERVAL_MS,
  INSTALL_ID_FILE,
  QUEUE_FILE,
  QUIT_FLUSH_MS,
  RENDERER_EVENTS,
  TELEMETRY_VERSION,
  isTelemetryEventName,
  thrownText,
  type CrashProcess,
  type TelemetryEventName,
  type TelemetryProps,
  type TelemetrySwitch
} from '@shared/telemetry'
import { TelemetryClient, installIdAt, type CrashInput } from './client'
import { rendererErrorReport, telemetryOrigin } from './policy'

let client: TelemetryClient | null = null
let destination: string | null = null
let flushTimer: NodeJS.Timeout | null = null
let quitHandled = false
let installingUpdate = false

/**
 * Electron's own crash dumps, kept on this Mac and never uploaded (`uploadToServer: false`). Before
 * `ready`, as Electron asks, so a crash during startup is caught too.
 */
export function startCrashDumps(): void {
  try {
    crashReporter.start({ uploadToServer: false, compress: true })
  } catch (error) {
    console.warn(`[bay] crash dumps: could not start: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function minidumpDir(): string {
  try {
    return app.getPath('crashDumps')
  } catch {
    return join(app.getPath('userData'), 'Crashpad')
  }
}

/** Starts the client with the switches as main's database has them. Call once, after `ready`. */
export function startTelemetry(switches: Record<TelemetrySwitch, boolean>): void {
  if (client) return
  const where = process.platform === 'darwin' ? telemetryOrigin(process.env, app.isPackaged) : { kind: 'none' as const, reason: 'telemetry is sent only from macOS' }
  destination = where.kind === 'none' ? null : where.origin
  if (where.kind === 'none') console.log(`[bay] telemetry: nothing is sent — ${where.reason}`)
  else console.log(`[bay] telemetry: ${switches.telemetry ? 'usage on' : 'usage off'}, ${switches.crash ? 'crash reports on' : 'crash reports off'} → ${where.origin}`)

  const userData = app.getPath('userData')
  client = new TelemetryClient({
    envelope: {
      v: TELEMETRY_VERSION,
      installId: installIdAt(join(userData, INSTALL_ID_FILE), randomUUID),
      appVersion: app.getVersion(),
      os: 'darwin',
      osVersion: process.getSystemVersion(),
      arch: process.arch
    },
    origin: destination,
    fetch: (url, init) => fetch(url, init),
    queuePath: join(userData, QUEUE_FILE),
    home: homedir(),
    switches
  })

  flushTimer = setInterval(() => void client?.flush(), FLUSH_INTERVAL_MS)
  flushTimer.unref()
  // What the last run could not send, a little after launch rather than during it.
  setTimeout(() => void client?.flush(), 10_000).unref()

  installCrashHandlers()
  installQuitFlush()
}

/** Records one event; a no-op before `startTelemetry`, with usage off, or in a build that sends nothing. */
export function track<N extends TelemetryEventName>(name: N, props?: TelemetryProps<N>): void {
  client?.track(name, props)
}

/** An event the renderer asked for — only those in `RENDERER_EVENTS`, props allow-listed as always. */
export function trackFromRenderer(name: unknown, props: unknown): void {
  if (!isTelemetryEventName(name) || !RENDERER_EVENTS.includes(name)) return
  client?.track(name, props as TelemetryProps<typeof name>)
}

export function reportCrash(input: CrashInput): void {
  try {
    if (client?.crash(input)) void client.flush()
  } catch (error) {
    // Reporting a crash must never be the second crash.
    console.warn(`[bay] crash report: could not record: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * The renderer's own uncaught error: only its text arrives, cut to the caps here at the boundary
 * (`rendererErrorReport`), and redacted before queueing. The client admits at most
 * `CRASHES_PER_MINUTE` reports a minute from every source together.
 */
export function reportRendererError(report: unknown, process: CrashProcess): void {
  const value = rendererErrorReport(report)
  if (!value) return
  reportCrash({
    process,
    kind: value.kind === 'rejection' ? 'rejection' : 'renderer-error',
    message: value.message,
    stack: value.stack
  })
}

export function setTelemetrySwitch(which: TelemetrySwitch, on: boolean): void {
  client?.setSwitch(which, on)
}

export function telemetryState(): {
  switches: Record<TelemetrySwitch, boolean> | null
  destination: string | null
  queued: { events: number; crashes: number }
  lastProblem: string | null
} {
  return {
    switches: client?.switches ?? null,
    destination,
    queued: client?.queued ?? { events: 0, crashes: 0 },
    lastProblem: client?.lastProblem ?? null
  }
}

/** What kind of process a `child-process-gone` was, in the contract's words. */
function childProcessKind(type: string): CrashProcess {
  if (type === 'GPU') return 'gpu'
  if (type === 'Utility') return 'utility'
  return 'child'
}

/** Exits nobody needs told about: a process that ended cleanly, or one bay ended on purpose. */
const QUIET_REASONS = new Set(['clean-exit', 'killed'])

/** Which renderer a `render-process-gone` came from; set by `index.ts`, which knows the windows. */
let classifyRenderer: (contents: WebContents) => CrashProcess = () => 'renderer'
export function setRendererClassifier(classify: (contents: WebContents) => CrashProcess): void {
  classifyRenderer = classify
}

function installCrashHandlers(): void {
  // The monitor event: Node reports it and then does exactly what it did before — Electron's
  // dialog, the exit — so reporting changes nothing about how bay behaves when it throws.
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    reportCrash({ process: 'main', kind: origin === 'unhandledRejection' ? 'rejection' : 'exception', ...thrownText(error, origin === 'unhandledRejection' ? 'rejection' : 'thrown') })
  })
  // A listener here replaces Node's warning, so the warning is printed as before.
  process.on('unhandledRejection', (reason) => {
    console.error('[bay] Unhandled promise rejection in main:', reason)
    reportCrash({ process: 'main', kind: 'rejection', ...thrownText(reason, 'rejection') })
  })
  app.on('render-process-gone', (_event, contents, details) => {
    if (QUIET_REASONS.has(details.reason)) return
    reportCrash({
      process: classifyRenderer(contents),
      kind: 'process-gone',
      message: `A renderer process ended: ${details.reason}`,
      reason: details.reason,
      exitCode: details.exitCode
    })
  })
  app.on('child-process-gone', (_event, details) => {
    if (QUIET_REASONS.has(details.reason)) return
    reportCrash({
      process: childProcessKind(details.type),
      kind: 'process-gone',
      message: `A ${details.type} process ended: ${details.reason}`,
      reason: details.reason,
      exitCode: details.exitCode
    })
  })
}

/**
 * Quitting sends what is queued, waiting at most `QUIT_FLUSH_MS`. The queue is written first, so
 * whatever does not make it goes at the next launch. Not while Squirrel is quitting to install an
 * update: its quit is left alone, and the queue waits on disk.
 */
function installQuitFlush(): void {
  autoUpdater.on('before-quit-for-update', () => {
    installingUpdate = true
  })
  app.on('before-quit', (event) => {
    if (quitHandled || !client) return
    quitHandled = true
    if (flushTimer) clearInterval(flushTimer)
    client.track('app_quit')
    client.persist()
    const { events, crashes } = client.queued
    if (installingUpdate || !destination || events + crashes === 0) return
    event.preventDefault()
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, QUIT_FLUSH_MS))
    void Promise.race([client.flush().catch(() => undefined), deadline]).finally(() => {
      client?.persist()
      app.quit()
    })
  })
}
