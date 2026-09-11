/**
 * The unix socket, with no Electron in it.
 *
 * Split from `server.ts` for one reason, and it is a defect rather than a preference: the
 * caller's comment promised that a socket which will not open costs agent control and nothing
 * else, and that promise was not kept. `socketPathIn` throws for an over-long path, the call
 * site was a bare `void start().then(...)` with no `.catch()`, and the result was an unhandled
 * rejection naming an internal frame — the intended message never printed, and under
 * `--unhandled-rejections=strict` it would take the app down at launch. A comment claiming
 * graceful degradation, in the file that fails to degrade.
 *
 * Nothing here throws. Every failure comes back as a `SocketStatus` carrying a reason, so the
 * caller cannot accidentally do nothing with it — the same shape as `openDatabase`, for the
 * same reason. And because this module imports no Electron, "a bad path degrades rather than
 * throws" is a property a test can actually hold, which is the half that was missing.
 *
 * **Why a unix socket and not a TCP port.** A socket file is protected by the filesystem: it
 * sits in the user's own directory at `0600`, so it is unreachable from another machine by
 * construction rather than by a check someone could get wrong in the permissive direction.
 */

import { chmod, unlink } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { LineBuffer, RPC_INTERNAL_ERROR, encode, failure, parseLine } from './jsonrpc'
import { handleRequest, type RunTool } from './protocol'

export interface SocketStatus {
  ready: boolean
  path: string | null
  /** Non-null exactly when `ready` is false. Written for a person, not for a log parser. */
  error: string | null
}

export interface RunningSocket {
  status: SocketStatus
  close(): Promise<void>
}

function attach(socket: Socket, runTool: RunTool): void {
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
          // A throw here is a bug in bay, not in the client's request, and it still has to
          // come back as a message: a silent drop leaves the agent on its own timeout.
          const message = error instanceof Error ? error.message : String(error)
          if (!socket.destroyed) {
            socket.write(encode(failure(parsed.request!.id ?? null, RPC_INTERNAL_ERROR, message)))
          }
        })
    }
  })

  // Both are expected: a proxy exits when its MCP client does, closing this abruptly.
  socket.on('error', () => undefined)
  socket.on('close', () => undefined)
}

/**
 * Starts listening, or explains why it could not. Never rejects, never throws.
 *
 * `resolvePath` is a thunk rather than a string so that a path computation which *throws* —
 * the over-long-path check — is caught here rather than at the call site, which is exactly
 * where it escaped before.
 */
export async function startSocketServer(
  resolvePath: () => string,
  runTool: RunTool
): Promise<RunningSocket> {
  const degraded = (error: string): RunningSocket => ({
    status: { ready: false, path: null, error },
    close: async () => undefined
  })

  let path: string
  try {
    path = resolvePath()
  } catch (error) {
    return degraded(error instanceof Error ? error.message : String(error))
  }

  // A socket file left by a crash makes `listen` fail with EADDRINUSE even though nothing is
  // listening. Removing it first is safe: a live bay holding it would mean this instance is
  // not the one starting a server.
  await unlink(path).catch(() => undefined)

  let server: Server
  try {
    server = createServer((socket) => attach(socket, runTool))
  } catch (error) {
    return degraded(error instanceof Error ? error.message : String(error))
  }

  // Multiple connections are accepted deliberately: rejecting a second would lock out a
  // reconnect before a stale socket is reaped, and would only appear to address two agents
  // sharing a timeline, which this layer cannot arbitrate.
  server.maxConnections = 8

  return new Promise<RunningSocket>((resolve) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolve(degraded(`${error.message} (${error.code ?? 'no code'}) at ${path}`))
    })
    server.listen(path, () => {
      // Owner-only. This is the access control, not a check in the handler.
      void chmod(path, 0o600).catch(() => undefined)
      resolve({
        status: { ready: true, path, error: null },
        close: async () => {
          await new Promise<void>((done) => server.close(() => done()))
          await unlink(path).catch(() => undefined)
        }
      })
    })
  })
}

/** What to print when the socket is unavailable, or null when it is fine. */
export function describeSocket(status: SocketStatus): string | null {
  if (status.ready) return null
  return (
    `The agent socket could not be opened, so bay cannot be driven over MCP this session. ` +
    `Editing, playback and export are unaffected. Reason: ${status.error ?? 'unknown'}`
  )
}
