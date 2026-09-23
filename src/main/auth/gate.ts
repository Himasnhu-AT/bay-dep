/**
 * The gate itself: what main refuses while bay is not entitled. Electron-free, so the refusals are
 * unit-tested; `ipc.ts` and `mcp/server.ts` wrap their real handlers with these.
 *
 * The renderer's access screen is UI. It is not the gate: a renderer that skipped it (devtools, a
 * bug, a probe) would still find every editor channel and every MCP tool refusing here.
 */

import { isEntitled, lockedMessage, type AccessStatus } from '@shared/access'

/**
 * IPC channels (keys of `IPC`) that work while locked: the access screen's own calls, and
 * the window chrome. Every other channel refuses — including anything added later, which is
 * the point of an allow-list.
 */
export const OPEN_WHILE_LOCKED: ReadonlySet<string> = new Set([
  'appVersion',
  'appPlatform',
  'windowMinimise',
  'windowToggleMaximise',
  'windowClose',
  'accessStatus',
  'accessSignIn',
  'accessCancelSignIn',
  'accessSignOut',
  'accessRecheck',
  'accessRequestAccess',
  // Losing access mid-session must not cost the user their work: the renderer writes the open
  // project to its autosave sidecar at the moment it locks. The sidecar is crash recovery — it
  // never overwrites a project file and opens no dialog — so allowing it opens nothing else.
  'projectAutosave'
])

/** Refusal text for a call on `channel` now, or null when the call may run. */
export function refuseChannel(channel: string, status: AccessStatus): string | null {
  if (isEntitled(status) || OPEN_WHILE_LOCKED.has(channel)) return null
  return lockedMessage(status)
}

export type ToolRunner<O> = (tool: string, args: Record<string, unknown>) => Promise<O>

/**
 * Wraps the runner behind both MCP sockets. A locked bay answers every tool call with the unlock
 * instructions and never reaches the renderer.
 */
export function gateToolRunner<O>(
  inner: ToolRunner<O>,
  currentStatus: () => AccessStatus,
  refusal: (message: string) => O
): ToolRunner<O> {
  return async (tool, args) => {
    const status = currentStatus()
    if (!isEntitled(status)) return refusal(lockedMessage(status))
    return inner(tool, args)
  }
}
