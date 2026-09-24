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
import { app, BrowserWindow, dialog, type WebContents } from 'electron'
import { IPC } from '@shared/ipc'
import { MCP_CALL_TIMEOUT_MS, findTool, type McpToolCall, type McpToolResult } from '@shared/mcp'
import { type ToolOutcome } from './protocol'
import { startSocketServer, type RunningSocket, type SocketStatus } from './socket-server'
import { isCompositionWindow } from '../html/compositions'
import { pickExecutorWindow } from './executor-target'
import { resourceBody } from './resources'
import { substituteFileArgs } from './file-args'
import { AGENT_SOCKET_NAME, socketPathIn } from './socket-path'
import { checkCallPolicy, type CallOrigin, type PolicyEnv } from './policy'
import { open, readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { EXECUTOR_READY_TIMEOUT_MS, ExecutorReadiness, strandedCall } from './executor-ready'
import { gateToolRunner } from '../auth/gate'
import { accessStatus } from '../auth/access'

// ---------------------------------------------------------------------------
// The main ↔ renderer round trip
// ---------------------------------------------------------------------------

interface Pending {
  resolve: (result: McpToolResult) => void
  timer: NodeJS.Timeout
  /** The window it was sent to, so a reload of that window can find what it stranded. */
  targetId: number
  tool: string
  args: Record<string, unknown>
}

const pending = new Map<string, Pending>()

const readiness = new ExecutorReadiness()
const watched = new WeakSet<WebContents>()

/**
 * The renderer's executor started (or stopped) listening. A reload or a crash makes it stop
 * without saying so, so those are watched here — a page that is tearing down cannot be trusted
 * to announce it.
 */
export function setExecutorReady(contents: WebContents, ready: boolean): void {
  readiness.set(contents.id, ready)
  if (watched.has(contents)) return
  watched.add(contents)
  const id = contents.id
  // On *commit*, not on start. A navigation can start and never commit — bay's own
  // `will-navigate` guard cancels every renderer-initiated one — and the old document then
  // lives on, still listening, with nothing to re-announce it. Keyed on `did-start-navigation`
  // that left the window not-ready for good, and every later call waited out the full 45s:
  // found by `test/app/mcp-during-reload.mjs`, not by reading. `did-navigate` is main-frame and
  // cross-document by definition, and it lands before the new page's own ready message.
  contents.on('did-navigate', () => {
    readiness.set(id, false)
    rescueStranded(id)
  })
  contents.on('render-process-gone', () => readiness.set(id, false))
  contents.once('destroyed', () => readiness.forget(id))
}

/**
 * Every call still waiting on a window that has just navigated will never be answered by it —
 * the document it was sent to is gone. See `strandedCall` for why reads are resent and writes
 * are failed rather than resent.
 */
function rescueStranded(targetId: number): void {
  for (const [callId, waiting] of [...pending]) {
    if (waiting.targetId !== targetId) continue
    pending.delete(callId)
    clearTimeout(waiting.timer)
    const verdict = strandedCall(waiting.tool, (name) => findTool(name)?.readOnly ?? false)
    if (verdict.action === 'fail') {
      waiting.resolve({ id: callId, ok: false, error: verdict.error })
      continue
    }
    void callRenderer(waiting.tool, waiting.args).then((result) =>
      waiting.resolve({ ...result, id: callId })
    )
  }
}

/** Called by the IPC handler when the renderer answers. */
export function settleToolCall(result: McpToolResult): void {
  const waiting = pending.get(result.id)
  if (!waiting) return // Late answer, after the timeout already reported. Dropping it is right.
  pending.delete(result.id)
  clearTimeout(waiting.timer)
  waiting.resolve(result)
}

/**
 * The window holding the editor — never a composition's.
 *
 * "The first window that is not destroyed" was wrong as soon as compositions existed. A
 * composition renders in a hidden `BrowserWindow`, so it is in `getAllWindows()` too, and
 * whichever one comes back first gets the tool call. A composition page has no MCP listener,
 * so the call is simply never answered: main waits out its thirty seconds and reports a
 * timeout, while main, the renderer, the socket and the tool were all working perfectly. The
 * symptom is that every tool stops the instant a composition lands on the timeline.
 */
function executorWebContents(): WebContents | null {
  // The choice itself lives in `./executor-target`, pure and tested. Nothing in this file is
  // reachable from `pnpm test` — it imports `electron` — which is precisely why the rule was
  // wrong here for as long as it was.
  const picked = pickExecutorWindow(
    BrowserWindow.getAllWindows().map((window) => ({
      window,
      destroyed: window.isDestroyed(),
      composition: isCompositionWindow(window)
    }))
  )
  return picked ? picked.window.webContents : null
}

/**
 * Pushes one call to the renderer and waits for the matching answer.
 *
 * The timeout is the whole reason this is not a bare promise. A call that is never answered —
 * the executor threw before registering, the window closed mid-call, a bug in the handler —
 * would otherwise leave the agent's turn stalled with no verdict at all, which is strictly
 * worse than a failure: a failure it can read and route around.
 */
async function callRenderer(
  tool: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const target = executorWebContents()
  const id = randomUUID()

  if (!target) {
    return {
      id,
      ok: false,
      error:
        'bay has no window open, so there is nothing to apply this to. Open bay and try again.'
    }
  }

  // Wait for the page to be listening before sending — see `./executor-ready`. Separate from the
  // call timeout below: a window still loading is not a tool taking too long.
  if (!(await readiness.whenReady(target.id, EXECUTOR_READY_TIMEOUT_MS))) {
    return {
      id,
      ok: false,
      error:
        `bay's window did not finish loading within ${Math.round(EXECUTOR_READY_TIMEOUT_MS / 1000)}s, ` +
        `so "${tool}" was never sent to it and nothing was changed. Try the call again; if it ` +
        `keeps failing, the editor window has a problem bay logs at startup.`
    }
  }
  if (target.isDestroyed()) {
    return { id, ok: false, error: `bay's window closed before "${tool}" could run. Nothing was changed.` }
  }

  // A tool may declare a longer budget: transcribing a long file takes longer than the default,
  // and "bay did not answer" about a job that was still working would send the agent to retry it.
  const timeoutMs = findTool(tool)?.timeoutMs ?? MCP_CALL_TIMEOUT_MS
  return new Promise<McpToolResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({
        id,
        ok: false,
        error:
          `bay did not answer "${tool}" within ${Math.round(timeoutMs / 1000)}s. ` +
          `The edit may or may not have been applied — call read_project before retrying, ` +
          `rather than repeating the call.`
      })
    }, timeoutMs)

    pending.set(id, { resolve, timer, targetId: target.id, tool, args })
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
  args: Record<string, unknown>,
  origin: CallOrigin = 'socket'
): Promise<ToolOutcome> {
  // What the caller may touch on disk — see `./policy`. Before substitution, so an in-app
  // `@file` is refused rather than read.
  const refused = await checkCallPolicy(tool, args, origin, policyEnv())
  if (refused) return { ok: false, value: refused }

  let resolved: Record<string, unknown>
  try {
    resolved = origin === 'in-app' ? args : await substituteFileArgs(args, (path) => readFile(path, 'utf8'))
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
  // Both doors are gated on access: a locked bay answers every tool call with how to unlock it
  // and never reaches the renderer (`auth/gate.ts`). The guides stay readable — they are the
  // product's documentation, not the user's data.
  const locked = (message: string): ToolOutcome => ({ ok: false, value: message })
  const started = await startSocketServer(
    () => socketPathIn(app.getPath('userData')),
    gateToolRunner((tool, args) => runTool(tool, args), accessStatus, locked),
    resourceBody
  )
  running = started
  // The in-app agent's own door: the same tools, under the in-app policy. Its status is not the
  // one the UI reports — the panel says for itself whether it could start.
  runningAgent = await startSocketServer(
    () => socketPathIn(app.getPath('userData'), AGENT_SOCKET_NAME),
    gateToolRunner((tool, args) => runTool(tool, args, 'in-app'), accessStatus, locked),
    resourceBody
  )
  if (!runningAgent.status.ready) console.warn(`[bay] agent socket did not open: ${runningAgent.status.error}`)
  return started.status
}

let runningAgent: RunningSocket | null = null

/** Where the file checks look: home, and the temp folders by both their names. */
function policyEnv(): PolicyEnv {
  const temps = new Set(['/tmp', tmpdir()])
  for (const path of [...temps]) {
    try {
      temps.add(realpathSync(path))
    } catch {
      // Not there; nothing to add.
    }
  }
  return {
    home: homedir(),
    roots: [...temps],
    confirm: async (message, detail) => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((w) => !isCompositionWindow(w))
      const options = {
        type: 'question' as const,
        message,
        detail,
        buttons: ['Download', 'Cancel'],
        defaultId: 1,
        cancelId: 1
      }
      const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
      return response === 0
    },
    head: async (path) => {
      let handle
      try {
        handle = await open(path, 'r')
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : ''
      }
      try {
        const buffer = Buffer.alloc(4096)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        return buffer.subarray(0, bytesRead).toString('utf8')
      } catch {
        return '' // exists, but unreadable as a file (a folder): not a composition, not media
      } finally {
        await handle.close()
      }
    }
  }
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
  const agent = runningAgent
  running = null
  runningAgent = null
  await current?.close()
  await agent?.close()
}
