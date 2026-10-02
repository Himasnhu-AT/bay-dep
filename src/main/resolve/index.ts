/**
 * DaVinci Resolve as a project's editor: where the connector is, whether it can reach Resolve,
 * and the MCP server entry the in-app agent is given for a Resolve project (`@shared/host`).
 *
 * The connector is samuelgursky/davinci-resolve-mcp (MIT), installed by
 * `script/setup-resolve-mcp.sh` — never shipped inside bay and never fetched by it.
 */
import type { ResolveStatus } from '@shared/host'

/** A stdio MCP server entry, the shape `bayMcpServer` returns (`agent/cli.ts`). */
export interface McpServerEntry {
  command: string
  args: string[]
  env: Record<string, string>
}

/** The name the Resolve server has in the agent's MCP config; its tools are `mcp__resolve__*`. */
export const RESOLVE_SERVER_NAME = 'resolve'

/** The Resolve MCP server as a stdio entry, or null when the connector is not set up. */
export function resolveMcpServer(): McpServerEntry | null {
  return null
}

/** Installed, set up, running, connected — probed now. Never throws. */
export async function resolveStatus(): Promise<ResolveStatus> {
  return { state: 'not-set-up', setup: 'script/setup-resolve-mcp.sh' }
}

/** Bring Resolve to the front, launching it if it is closed. */
export async function openResolve(): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: 'Not built yet.' }
}
