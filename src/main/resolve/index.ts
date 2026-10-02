/**
 * DaVinci Resolve as a project's editor: where the connector is, whether it can reach Resolve,
 * and the MCP server entry the in-app agent is given for a Resolve project (`@shared/host`).
 *
 * The connector is samuelgursky/davinci-resolve-mcp (MIT), installed by
 * `script/setup-resolve-mcp.sh` — never shipped inside bay and never fetched by it.
 *
 * This file is only the Electron glue: which folders to search. The search, the entry and the
 * status decision are in `connector.ts` and `status.ts`, which the tests can load.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { ResolveStatus } from '@shared/host'
import {
  connectorEntry,
  locateConnector,
  setupCommand,
  type Connector,
  type ConnectorPlaces,
  type McpServerEntry
} from './connector'
import {
  bridgeScriptPath,
  decideStatus,
  resolveInstalled,
  resolveRunning,
  resolveVersion,
  runProbe
} from './status'

export type { McpServerEntry } from './connector'

/** The name the Resolve server has in the agent's MCP config; its tools are `mcp__resolve__*`. */
export const RESOLVE_SERVER_NAME = 'resolve'

function places(): ConnectorPlaces {
  return {
    envDir: process.env.BAY_RESOLVE_MCP || undefined,
    userDataDir: join(app.getPath('userData'), 'resolve-mcp'),
    // Unpackaged, the app path is the checkout; a packaged bay has no repo to look in.
    repoDir: app.isPackaged ? undefined : join(app.getAppPath(), 'vendor', 'davinci-resolve-mcp')
  }
}

function connector(): Connector | null {
  return locateConnector(places())
}

/** A packaged bay installs into its own data folder; a checkout into `vendor/`. */
function setup(): string {
  return app.isPackaged ? setupCommand(places().userDataDir) : setupCommand()
}

/** The Resolve MCP server as a stdio entry, or null when the connector is not set up. */
export function resolveMcpServer(): McpServerEntry | null {
  const found = connector()
  return found ? connectorEntry(found) : null
}

/** Installed, set up, running, connected — probed now. Never throws. */
export async function resolveStatus(): Promise<ResolveStatus> {
  try {
    const installed = resolveInstalled()
    const found = connector()
    const [version, running] = await Promise.all([
      installed ? resolveVersion() : Promise.resolve(undefined),
      installed ? resolveRunning() : Promise.resolve(false)
    ])
    // Only a running Resolve is asked: the probe cannot connect to a closed one.
    const probe = found && running ? await runProbe(found) : null
    return decideStatus({
      installed,
      version,
      located: found !== null,
      running,
      probe,
      bridgeInstalled: existsSync(bridgeScriptPath()),
      setup: setup()
    })
  } catch (error) {
    return {
      state: 'not-set-up',
      setup: setupCommand(),
      detail: `Resolve could not be checked: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/** Bring Resolve to the front, launching it if it is closed. */
export function openResolve(): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    execFile('/usr/bin/open', ['-a', 'DaVinci Resolve'], { timeout: 15_000 }, (error, _out, err) => {
      if (!error) return resolve({ ok: true })
      const said = String(err).trim()
      resolve({ ok: false, error: said || error.message })
    })
  })
}
