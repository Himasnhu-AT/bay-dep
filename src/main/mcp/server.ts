/**
 * The unix socket bay listens on, and the bridge from a tool call into the renderer.
 *
 * **Why a unix socket and not a TCP port.** A socket file is protected by the filesystem: it
 * lives in the user's own `userData` directory with `0600`, so only that user can open it,
 * and it is unreachable from another machine by construction rather than by a check anyone
 * could get wrong. A localhost port is reachable by every process on the machine and every
 * container sharing its network, and refusing non-local peers there means writing a
 * comparison that is one mistake away from being wrong in the permissive direction. The
 * permission bits are the mechanism, as you asked — there is no handshake to forge.
 */

import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, type WebContents } from 'electron'
import { IPC } from '@shared/ipc'
import { MCP_CALL_TIMEOUT_MS, type McpToolCall, type McpToolResult } from '@shared/mcp'
import { type ToolOutcome } from './protocol'
import { startSocketServer, type RunningSocket, type SocketStatus } from './socket-server'
import { resourceBody } from './resources'
import { substituteFileArgs } from './file-args'
import { socketPathIn } from './socket-path'
import { readFile } from 'node:fs/promises'

// ---------------------------------------------------------------------------
// The main ↔ renderer round trip
// ---------------------------------------------------------------------------

interface Pending {
  resolve: (result: McpToolResult) => void
  timer: NodeJS.Timeout
}

const pending = new Map<string, Pending>()

/** Called by the IPC handler when the renderer answers. */
export function settleToolCall(result: McpToolResult): void {
  const waiting = pending.get(result.id)
  if (!waiting) return // Late answer, after the timeout already reported. Dropping it is right.
  pending.delete(result.id)
  clearTimeout(waiting.timer)
  waiting.resolve(result)
}

function executorWebContents(): WebContents | null {
  const window = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  return window ? window.webContents : null
}

/**
 * Pushes one call to the renderer and waits for the matching answer.
 *
 * The timeout is the whole reason this is not a bare promise. A call that is never answered —
 * the executor threw before registering, the window closed mid-call, a bug in the handler —
 * would otherwise leave the agent's turn stalled with no verdict at all, which is strictly
 * worse than a failure: a failure it can read and route around.
 */
export function callRenderer(tool: string, args: Record<string, unknown>): Promise<McpToolResult> {
  const target = executorWebContents()
  const id = randomUUID()

  if (!target) {
    return Promise.resolve({
      id,
      ok: false,
      error:
        'bay has no window open, so there is nothing to apply this to. Open bay and try again.'
    })
  }

  return new Promise<McpToolResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({
        id,
        ok: false,
        error:
          `bay did not answer "${tool}" within ${Math.round(MCP_CALL_TIMEOUT_MS / 1000)}s. ` +
          `The edit may or may not have been applied — call read_project before retrying, ` +
          `rather than repeating the call.`
      })
    }, MCP_CALL_TIMEOUT_MS)

    pending.set(id, { resolve, timer })
    const call: McpToolCall = { id, tool, args }
    target.send(IPC.mcpToolCall, call)
  })
}

/**
 * Runs one tool: substitute file references, then hand it to the renderer.
 *
 * Substitution happens here rather than in the renderer because the file is on *this* side of
 * the boundary — the renderer has no filesystem, by design, and shipping a path across only to
 * ask main to read it would put an arbitrary-file-read behind the least-guarded door in the
 * app.
 */
export async function runTool(
  tool: string,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  let resolved: Record<string, unknown>
  try {
    resolved = await substituteFileArgs(args, (path) => readFile(path, 'utf8'))
  } catch (error) {
    return { ok: false, value: error instanceof Error ? error.message : String(error) }
  }

  const result = await callRenderer(tool, resolved)
  return result.ok ? { ok: true, value: result.value } : { ok: false, value: result.error }
}

// ---------------------------------------------------------------------------
// The socket
// ---------------------------------------------------------------------------

let running: RunningSocket | null = null

/**
 * Starts the agent socket. Never throws and never rejects — the failure is a status.
 *
 * The previous version let `socketPathIn` throw straight out of here into a call site with no
 * `.catch()`, which turned "agent control is unavailable" into an unhandled rejection naming
 * an internal frame. The degradation the comment promised did not happen. It does now, and
 * `socket-server.test.ts` holds it rather than the comment doing so.
 */
export async function startMcpServer(): Promise<SocketStatus> {
  if (running) return running.status
  const started = await startSocketServer(
    () => socketPathIn(app.getPath('userData')),
    runTool,
    resourceBody
  )
  running = started
  return started.status
}

export interface McpSurfaceStatus {
  ready: boolean
  error: string | null
  /** The socket to point an MCP client at, or null when there is not one. */
  socketPath: string | null
  /** Distinguishes "never opened" from "open and unused" — the two the UI conflates. */
  connectionsSeen: number
}

/** For the status surface. Opening has not been attempted until `startMcpServer` runs. */
export function mcpStatus(): McpSurfaceStatus {
  if (!running) {
    return {
      ready: false,
      error: 'The agent socket has not been started yet.',
      socketPath: null,
      connectionsSeen: 0
    }
  }
  return {
    ready: running.status.ready,
    error: running.status.error,
    socketPath: running.status.path,
    connectionsSeen: running.connectionsSeen()
  }
}

export async function stopMcpServer(): Promise<void> {
  for (const [, waiting] of pending) clearTimeout(waiting.timer)
  pending.clear()
  const current = running
  running = null
  await current?.close()
}
