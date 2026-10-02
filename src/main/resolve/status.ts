/**
 * Whether the agent can reach Resolve: the facts gathered from the machine, and the one pure
 * function that turns them into a `ResolveStatus` (`@shared/host`).
 *
 * The probe connects exactly as the server does — it imports the connector's own
 * `connect_resolve` — so "ready" here means the server's first tool call will connect too.
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ResolveStatus } from '@shared/host'
import { connectorEnv, RESOLVE_APP, type Connector } from './connector'

/** What the probe printed. */
export interface ProbeReport {
  connected: boolean
  /** `DaVinci Resolve` or `DaVinci Resolve Studio`. */
  product?: string
  version?: string
  projectName?: string
  transport?: 'bridge' | 'external'
  error?: string
}

/** A probe that answered, or the reason it did not. */
export type ProbeOutcome = { report: ProbeReport } | { failed: string }

export interface StatusFacts {
  installed: boolean
  /** From the app's Info.plist. */
  version?: string
  /** The connector's server and venv are both present. */
  located: boolean
  running: boolean
  /** Null when the probe was not run — it is only run against a running Resolve. */
  probe: ProbeOutcome | null
  bridgeInstalled: boolean
  setup: string
}

export const PROBE_MARKER = 'BAY_RESOLVE_PROBE '
export const PROBE_TIMEOUT_MS = 10_000

/**
 * Run with the venv's Python and the connector's folder as the working directory.
 *
 * It mirrors `_try_connect` in the connector's `src/server.py`: without Blackmagic's module and
 * without the bridge forced, the server does not try at all, so neither does this. The answer is
 * one marked line, because the scripting library may print to stdout on its own.
 */
export const PROBE_SCRIPT = `
import json, os, sys
sys.path.insert(0, os.getcwd())
out = {"connected": False}
try:
    try:
        import DaVinciResolveScript as dvr
    except Exception as exc:
        dvr = None
        out["error"] = "Resolve's scripting module did not load: %s" % exc
    from src.utils.resolve_connection import connect_resolve, bridge_client
    forced = bridge_client is not None and bridge_client.bridge_enabled()
    resolve = connect_resolve(dvr) if (dvr is not None or forced) else None
    if resolve is not None and resolve.GetVersion():
        out["transport"] = "bridge" if type(resolve).__name__ == "BridgeProxy" else "external"
        out["product"] = str(resolve.GetProductName() or "")
        out["version"] = str(resolve.GetVersionString() or "")
        out["connected"] = True
        out.pop("error", None)
        try:
            project = resolve.GetProjectManager().GetCurrentProject()
            name = project.GetName() if project else None
            if name:
                out["projectName"] = str(name)
        except Exception as exc:
            out["error"] = "The open project could not be read: %s" % exc
except Exception as exc:
    out["error"] = "%s: %s" % (type(exc).__name__, exc)
sys.stdout.write("\\n${PROBE_MARKER}" + json.dumps(out) + "\\n")
`

/** The probe's report from its stdout, or null when it printed none. The last marked line wins. */
export function parseProbeOutput(stdout: string): ProbeReport | null {
  const lines = stdout.split('\n').filter((line) => line.startsWith(PROBE_MARKER))
  const last = lines[lines.length - 1]
  if (!last) return null
  let raw: unknown
  try {
    raw = JSON.parse(last.slice(PROBE_MARKER.length))
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  const text = (key: string): string | undefined => {
    const field = value[key]
    return typeof field === 'string' && field.trim() ? field.trim() : undefined
  }
  const transport = text('transport')
  return {
    connected: value.connected === true,
    product: text('product'),
    version: text('version'),
    projectName: text('projectName'),
    transport: transport === 'bridge' || transport === 'external' ? transport : undefined,
    error: text('error')
  }
}

/** Free or Studio, from the product name Resolve reports. Anything else is not known. */
export function editionOf(product: string | undefined): 'free' | 'studio' | undefined {
  if (!product) return undefined
  if (/\bstudio\b/i.test(product)) return 'studio'
  return /^davinci resolve$/i.test(product.trim()) ? 'free' : undefined
}

/** Unknown fields are left out rather than sent as `undefined`: the status crosses IPC. */
function defined(value: ResolveStatus): ResolveStatus {
  return strip(value)
}

function strip<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) delete value[key]
  }
  return value
}

/** The facts, read in the order a person would fix them. */
export function decideStatus(facts: StatusFacts): ResolveStatus {
  if (!facts.installed) return { state: 'not-installed' }
  if (!facts.located) {
    return defined({ state: 'not-set-up', version: facts.version, setup: facts.setup })
  }
  if (!facts.running) return defined({ state: 'not-running', version: facts.version })

  const probe = facts.probe
  if (probe && 'report' in probe && probe.report.connected) {
    return defined({
      state: 'ready',
      version: probe.report.version ?? facts.version,
      edition: editionOf(probe.report.product),
      projectName: probe.report.projectName,
      // Connected, and one thing still went wrong (the open project could not be read).
      detail: probe.report.error
    })
  }
  const detail = !probe
    ? 'The connection to Resolve was not tried.'
    : 'failed' in probe
      ? probe.failed
      : probe.report.error
  return defined({
    state: 'bridge-needed',
    version: facts.version,
    bridgeInstalled: facts.bridgeInstalled,
    setup: facts.setup,
    detail
  })
}

// ── Reading the machine ─────────────────────────────────────────────────────────────────────

function run(
  command: string,
  args: string[],
  timeout = 5000
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout }, (error, stdout) => {
      const code = error ? (typeof error.code === 'number' ? error.code : null) : 0
      resolve({ code, stdout: String(stdout) })
    })
  })
}

export function resolveInstalled(app = RESOLVE_APP): boolean {
  return existsSync(join(app, 'Contents', 'Info.plist'))
}

/** `CFBundleShortVersionString`, read by plutil so a binary plist is no different. */
export async function resolveVersion(app = RESOLVE_APP): Promise<string | undefined> {
  const { code, stdout } = await run('/usr/bin/plutil', [
    '-extract',
    'CFBundleShortVersionString',
    'raw',
    '-o',
    '-',
    join(app, 'Contents', 'Info.plist')
  ])
  const version = stdout.trim()
  return code === 0 && /^\d+(\.\d+)*$/.test(version) ? version : undefined
}

/** Whether Resolve's own executable is a running process (the app, not its helpers). */
export async function resolveRunning(app = RESOLVE_APP): Promise<boolean> {
  const { code } = await run('/usr/bin/pgrep', ['-f', `${app}/Contents/MacOS/Resolve`])
  return code === 0
}

/** The launcher the connector's installer writes into Resolve's Scripts menu. */
export function bridgeScriptPath(home = homedir()): string {
  return join(
    home,
    'Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility',
    'resolve_bridge.py'
  )
}

/**
 * Ask Resolve who it is, through the connector's own connection code. Never rejects, and never
 * outlives `timeoutMs`: a Resolve with a dialog open holds the bridge for 30 seconds.
 */
export function runProbe(
  connector: Connector,
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv; script?: string } = {}
): Promise<ProbeOutcome> {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const settle = (outcome: ProbeOutcome): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(outcome)
    }
    const child = spawn(connector.python, ['-c', options.script ?? PROBE_SCRIPT], {
      cwd: connector.dir,
      env: { ...(options.env ?? process.env), ...connectorEnv() },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      settle({
        failed: `Resolve did not answer within ${Math.round(timeoutMs / 1000)} seconds. A dialog open in Resolve blocks its scripting; close it and check again.`
      })
    }, timeoutMs)
    child.stdout.on('data', (chunk) => (stdout += String(chunk)))
    child.stderr.on('data', (chunk) => (stderr = (stderr + String(chunk)).slice(-2000)))
    child.on('error', (error) =>
      settle({ failed: `The connector's Python could not be started: ${error.message}` })
    )
    child.on('close', (code) => {
      const report = parseProbeOutput(stdout)
      if (report) return settle({ report })
      const last = stderr.trim().split('\n').pop() ?? ''
      settle({
        failed: `The connector's probe exited with code ${code} and no answer${last ? `: ${last}` : '.'}`
      })
    })
  })
}
