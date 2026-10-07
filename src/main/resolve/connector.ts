/**
 * Where bay's Resolve connector is on this Mac, and the stdio entry that starts it.
 *
 * The connector is a clone of samuelgursky/davinci-resolve-mcp with a Python 3.11 venv beside
 * it, made by `script/setup-resolve-mcp.sh`. No Electron here: `index.ts` supplies the folders,
 * so the search order and the entry are tested under plain Node.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** A stdio MCP server entry, the shape `bayMcpServer` returns (`agent/cli.ts`). */
export interface McpServerEntry {
  command: string
  args: string[]
  env: Record<string, string>
}

export const RESOLVE_APP = '/Applications/DaVinci Resolve/DaVinci Resolve.app'

/** Blackmagic's scripting module and library, where the macOS installer puts them. */
export const RESOLVE_SCRIPT_API =
  '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting'
export const RESOLVE_SCRIPT_LIB = `${RESOLVE_APP}/Contents/Libraries/Fusion/fusionscript.so`

export const SETUP_SCRIPT = 'script/setup-resolve-mcp.sh'

export interface ConnectorPlaces {
  /** `BAY_RESOLVE_MCP`: a directory the user points bay at. Wins when set. */
  envDir?: string
  /** `<userData>/resolve-mcp`. */
  userDataDir: string
  /** `<repo>/vendor/davinci-resolve-mcp` — passed only by an unpackaged build. */
  repoDir?: string
}

export interface Connector {
  dir: string
  python: string
  server: string
}

function connectorAt(dir: string): Connector {
  return {
    dir,
    python: join(dir, 'venv', 'bin', 'python'),
    server: join(dir, 'src', 'server.py')
  }
}

/** The places searched, in order. */
export function connectorCandidates(places: ConnectorPlaces): string[] {
  const dirs: string[] = []
  if (places.envDir) dirs.push(places.envDir)
  dirs.push(places.userDataDir)
  if (places.repoDir) dirs.push(places.repoDir)
  return dirs
}

/**
 * The first place that is set up: the server's source *and* the venv's Python. A clone without
 * its venv is not set up — the system Python cannot run the server — so it is passed over
 * rather than chosen and then failing at spawn.
 */
export function locateConnector(
  places: ConnectorPlaces,
  exists: (path: string) => boolean = existsSync
): Connector | null {
  for (const dir of connectorCandidates(places)) {
    const found = connectorAt(dir)
    if (exists(found.server) && exists(found.python)) return found
  }
  return null
}

/**
 * The connector's own environment.
 *
 * `DAVINCI_RESOLVE_MCP_UPDATE_CHECK=0` and `…_UPDATE_MODE=never` stop its startup request to
 * api.github.com (`src/utils/update_check.py`, `update_check_enabled`): bay reaches the network
 * only when the user asks. Either one is enough; both are set so the mode it reports reads
 * `never` too.
 *
 * `DAVINCI_RESOLVE_BRIDGE` is left unset on purpose. Set, the bridge is the only transport
 * tried; unset, the server uses outside scripting (Studio) and falls back to the bridge when
 * that yields nothing (the free edition) — `connect_resolve` in `src/utils/resolve_connection.py`.
 */
export function connectorEnv(): Record<string, string> {
  return {
    RESOLVE_SCRIPT_API,
    RESOLVE_SCRIPT_LIB,
    PYTHONPATH: `${RESOLVE_SCRIPT_API}/Modules`,
    DAVINCI_RESOLVE_MCP_UPDATE_CHECK: '0',
    DAVINCI_RESOLVE_MCP_UPDATE_MODE: 'never'
  }
}

/** The compound server (36 tools), not `--full`. */
export function connectorEntry(connector: Connector): McpServerEntry {
  return { command: connector.python, args: [connector.server], env: connectorEnv() }
}

/** The command the status line tells the user to run. */
export function setupCommand(targetDir?: string): string {
  return targetDir ? `${SETUP_SCRIPT} --dir "${targetDir}"` : SETUP_SCRIPT
}
