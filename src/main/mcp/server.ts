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

import { chmod, unlink } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, type WebContents } from 'electron'
import { IPC } from '@shared/ipc'
import { MCP_CALL_TIMEOUT_MS, type McpToolCall, type McpToolResult } from '@shared/mcp'
import { LineBuffer, RPC_INTERNAL_ERROR, encode, failure, parseLine } from './jsonrpc'
import { handleRequest, type ToolOutcome } from './protocol'
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

let server: Server | null = null

function attach(socket: Socket): void {
  const buffer = new LineBuffer()
  socket.setEncoding('utf8')

  socket.on('data', (chunk: string) => {
    for (const line of buffer.push(chunk)) {
      const parsed = parseLine(line)
      if (!parsed) continue
      if (parsed.error) {
        socket.write(encode(parsed.error))
        continue
      }
      void handleRequest(parsed.request!, runTool)
        .then((answer) => {
          if (answer && !socket.destroyed) socket.write(encode(answer))
        })
        .catch((error: unknown) => {
          // A throw here is a bug in bay, not in the client's request. It still has to come
          // back as a message: a silent drop leaves the agent waiting on its own timeout.
          const message = error instanceof Error ? error.message : String(error)
          if (!socket.destroyed) {
            socket.write(encode(failure(parsed.request!.id ?? null, RPC_INTERNAL_ERROR, message)))
          }
        })
    }
  })

  // Both are expected: a proxy exits when its MCP client does, and that closes this abruptly.
  socket.on('error', () => undefined)
  socket.on('close', () => undefined)
}

export async function startMcpServer(): Promise<string | null> {
  if (server) return socketPathIn(app.getPath('userData'))

  const path = socketPathIn(app.getPath('userData'))
  // A socket file left by a crash makes `listen` fail with EADDRINUSE even though nothing is
  // listening. Removing it first is safe: if a live bay held it, this instance would not be
  // starting a second server.
  await unlink(path).catch(() => undefined)

  const created = createServer(attach)
  // Multiple connections are accepted deliberately — see the report. Rejecting a second
  // client would lock out a reconnect before a stale socket is reaped, and would only appear
  // to address two agents sharing a timeline, which this layer cannot arbitrate.
  created.maxConnections = 8

  return new Promise<string | null>((resolve) => {
    created.once('error', (error: NodeJS.ErrnoException) => {
      console.error(
        `[bay] The MCP socket could not be opened at ${path}: ${error.message}. ` +
          `Agent control is unavailable this session; everything else is unaffected.`
      )
      resolve(null)
    })
    created.listen(path, () => {
      server = created
      // Owner-only. This is the access control, not a check in the handler.
      void chmod(path, 0o600).catch(() => undefined)
      resolve(path)
    })
  })
}

export async function stopMcpServer(): Promise<void> {
  for (const [, waiting] of pending) clearTimeout(waiting.timer)
  pending.clear()
  const current = server
  server = null
  if (!current) return
  await new Promise<void>((resolve) => current.close(() => resolve()))
  await unlink(socketPathIn(app.getPath('userData'))).catch(() => undefined)
}
