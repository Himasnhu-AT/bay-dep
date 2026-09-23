/**
 * The MCP proxy: stdio in, unix socket out.
 *
 * A separate short-lived process, spawned by the MCP client, because a client wants a command
 * and bay is a GUI that may not be running. It is run as plain Node — `ELECTRON_RUN_AS_NODE=1`
 * against the app's own binary, so there is no second runtime to ship — and never inside the
 * Electron main process, for one disqualifying reason: **JSON-RPC over stdio needs a
 * byte-exact stream, and Chromium writes to stdout on its own schedule.** One stray log line
 * corrupts the session with an error nobody can attribute. Measured before designing around
 * it: as plain Node the app binary emits exactly the bytes written and nothing else.
 *
 * Two things it does that a plain pipe would not:
 *
 * - **`tools/list` is answered locally**, from the compiled-in catalog, without touching the
 *   socket. A client asks for the manifest during startup, before anyone has said anything,
 *   and launching a video editor to answer it would make every session start with a
 *   several-second stall and a window appearing unbidden.
 * - **`tools/call` launches bay if it is not running** and waits for the socket to appear.
 *   That is the whole reason the proxy exists rather than the app just listening.
 *
 * Nothing here writes to stdout except protocol messages. Diagnostics go to stderr, which MCP
 * clients log and ignore.
 */

import { connect, type Socket } from 'node:net'
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { LineBuffer, encode, failure, parseLine, RPC_INTERNAL_ERROR } from './jsonrpc'
import { handleRequest, type McpContent, type ToolMode, type ToolOutcome } from './protocol'
import { resourceBody } from './resources'

/** How long to wait for a launched bay to open its socket before giving up. */
const LAUNCH_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 250

function note(message: string): void {
  process.stderr.write(`[bay-mcp] ${message}\n`)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK | constants.W_OK)
    return true
  } catch {
    return false
  }
}

function openSocket(path: string): Promise<Socket | null> {
  return new Promise((resolve) => {
    const socket = connect(path)
    const give = (value: Socket | null): void => {
      socket.removeAllListeners('connect')
      socket.removeAllListeners('error')
      resolve(value)
    }
    socket.once('connect', () => give(socket))
    socket.once('error', () => {
      socket.destroy()
      give(null)
    })
  })
}

export interface ProxyOptions {
  socketPath: string
  /** How to start bay when it is not running. Injected so the launch path is testable. */
  launch: () => void
  /** Which tool surface to publish. `full` unless the entry point read `BAY_MCP_MODE`. */
  mode?: ToolMode
}

/**
 * Connects, launching bay and waiting if the socket is not there yet.
 *
 * Polls rather than watches the directory: a launch takes seconds and a poll every 250ms is
 * both simpler and immune to the case where the socket is created and `chmod`ed in two steps.
 */
async function connectOrLaunch(
  options: ProxyOptions
): Promise<{ socket: Socket } | { socket: null; reason: string }> {
  if (await exists(options.socketPath)) {
    const direct = await openSocket(options.socketPath)
    if (direct) return { socket: direct }
    // The file is there and refuses connections: a bay that crashed without cleaning up, or
    // one still starting. Saying "bay is not running" here would be a guess, and launching a
    // second copy over a stale file would make it worse.
    return {
      socket: null,
      reason:
        `bay's agent socket exists at ${options.socketPath} but is not accepting connections. ` +
        `That usually means bay crashed without cleaning it up — start bay again, which ` +
        `replaces the stale socket.`
    }
  }

  note('bay is not running — launching it')
  options.launch()

  const deadline = Date.now() + LAUNCH_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    if (!(await exists(options.socketPath))) continue
    const socket = await openSocket(options.socketPath)
    if (socket) return { socket }
  }

  // Deliberately not "bay did not start". The proxy cannot see processes, only the socket, and
  // a bay running on a profile whose socket failed to open looks identical from here — that
  // case cost thirty seconds to be told the wrong thing. Naming both possibilities is the
  // honest answer, and the second one is checkable from bay's own log.
  return {
    socket: null,
    reason:
      `No agent socket appeared at ${options.socketPath} within ` +
      `${Math.round(LAUNCH_TIMEOUT_MS / 1000)}s. Either bay did not start, or it is running ` +
      `and its agent socket failed to open — bay logs the reason at startup when that happens.`
  }
}

/**
 * One call forwarded down the socket, with its own reply correlated by id.
 *
 * The socket is opened per call rather than held open for the proxy's life. A held connection
 * would have to survive bay quitting and restarting mid-session — which happens, because the
 * user is driving the app at the same time as the agent — and reconnect logic that only runs
 * on failure is reconnect logic that is never exercised until it matters.
 */
function forward(socket: Socket, line: string, id: string | number | null): Promise<unknown> {
  return new Promise((resolve) => {
    const buffer = new LineBuffer()
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      for (const reply of buffer.push(chunk)) {
        const parsed = parseLine(reply)
        const message = parsed?.request ?? null
        void message
        try {
          const value = JSON.parse(reply) as { id?: unknown; result?: unknown; error?: unknown }
          if (value.id === id) {
            socket.end()
            resolve(value)
            return
          }
        } catch {
          // Not our reply and not parseable; the next line may be.
        }
      }
    })
    socket.on('error', () => resolve(null))
    socket.on('close', () => resolve(null))
    socket.write(line)
  })
}

export async function runProxy(options: ProxyOptions): Promise<void> {
  const buffer = new LineBuffer()
  process.stdin.setEncoding('utf8')

  /** Tool calls go to the app; everything else is answered here. */
  const runTool = async (tool: string, args: Record<string, unknown>): Promise<ToolOutcome> => {
    const attempt = await connectOrLaunch(options)
    if (!attempt.socket) return { ok: false, value: `"${tool}" was not applied. ${attempt.reason}` }
    const socket = attempt.socket
    const id = `proxy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const reply = (await forward(
      socket,
      encode({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args } }),
      id
    )) as { result?: { content?: unknown; isError?: boolean }; error?: { message?: string } } | null

    if (!reply) return { ok: false, value: `bay closed the connection while running "${tool}".` }
    if (reply.error) return { ok: false, value: reply.error.message ?? 'bay reported an error.' }
    // Relayed whole. This used to keep `content[0].text` and re-wrap it, which silently dropped
    // every block after the first — the image a `preview_frame` exists to return.
    const content = Array.isArray(reply.result?.content)
      ? (reply.result.content as McpContent[])
      : []
    return { ok: reply.result?.isError !== true, value: '', content }
  }

  process.stdin.on('data', (chunk: string) => {
    for (const line of buffer.push(chunk)) {
      const parsed = parseLine(line)
      if (!parsed) continue
      if (parsed.error) {
        process.stdout.write(encode(parsed.error))
        continue
      }
      // `resourceBody` is passed, and leaving it out is not a small omission: `handleRequest`
      // defaults `readResource` to `() => null`, so every guide answered "listed but carries no
      // content in this build" through the **only path a client actually takes**, while the raw
      // socket — which nobody configures — served them perfectly. Eleven documents written to
      // teach a model how to edit video, unreadable from the client, with the transport
      // reporting the fault accurately to a reader who was not there.
      //
      // Served from here rather than forwarded to the app on purpose. The bodies are static and
      // inlined at build time, so reading the contract costs nothing and — like `tools/list` —
      // does not boot a video editor to answer a question about documentation.
      void handleRequest(parsed.request!, runTool, resourceBody, options.mode ?? 'full')
        .then((answer) => {
          if (answer) process.stdout.write(encode(answer))
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          process.stdout.write(
            encode(failure(parsed.request!.id ?? null, RPC_INTERNAL_ERROR, message))
          )
        })
    }
  })

  await new Promise<void>((resolve) => {
    process.stdin.on('end', () => resolve())
    process.stdin.on('close', () => resolve())
  })
}

/** Starts bay detached, so the proxy exiting does not take the editor with it. */
export function launchBay(appBinary: string): () => void {
  return () => {
    const child = spawn(appBinary, [], { detached: true, stdio: 'ignore' })
    child.unref()
  }
}
