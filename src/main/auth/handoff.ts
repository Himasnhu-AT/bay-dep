/**
 * The loopback half of the browser sign-in: a one-shot HTTP server on 127.0.0.1 that waits for the
 * website to POST the user's tokens back.
 *
 * Electron-free (node:http only) so the refusals are unit-tested against a real socket.
 *
 * What it accepts, and why each refusal exists:
 * - **Only 127.0.0.1**, on a port the OS picks. Never 0.0.0.0: nothing off this machine should
 *   even see a listening socket.
 * - **Only `POST /callback`** (and its CORS preflight). Everything else is 404.
 * - **Only from the site's origin.** A browser always sets `Origin` on a cross-origin POST, and a
 *   page on any other site cannot forge it — so another tab cannot plant *its* tokens in bay
 *   (a login-CSRF that would sign bay into an attacker's account).
 * - **Only with the `state` bay put in the URL**, compared in constant time. The state is the proof
 *   that this POST answers this sign-in.
 * - **Once.** The first valid POST resolves the handoff and closes the server; anything after that
 *   is 410 while the socket drains, then connection-refused.
 * - **For five minutes.** After that the handoff resolves `timeout` and the port is released.
 *
 * A refused POST does not end the wait — a stray request must not be able to cancel a sign-in the
 * user is halfway through.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'

export type HandoffResult =
  | { kind: 'tokens'; idToken: string; refreshToken: string }
  | { kind: 'timeout' }
  | { kind: 'cancelled' }

export interface Handoff {
  port: number
  state: string
  /** Settles exactly once. */
  result: Promise<HandoffResult>
  cancel(): void
}

export interface HandoffOptions {
  allowedOrigins: string[]
  timeoutMs: number
  /** Injected by tests; 32 random bytes, base64url, otherwise. */
  state?: string
}

const MAX_BODY = 64 * 1024

export function newState(): string {
  return randomBytes(32).toString('base64url')
}

function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function startHandoff(options: HandoffOptions): Promise<Handoff> {
  const state = options.state ?? newState()
  let settle!: (result: HandoffResult) => void
  const result = new Promise<HandoffResult>((resolve) => (settle = resolve))
  let done = false

  const cors = (response: ServerResponse, origin: string): void => {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
  }
  const reply = (response: ServerResponse, status: number, body: Record<string, unknown>, origin?: string): void => {
    if (origin) cors(response, origin)
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(body))
  }

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const origin = request.headers.origin
    const path = (request.url ?? '').split('?')[0]
    if (path !== '/callback') return reply(response, 404, { ok: false, error: 'Not found.' })

    const allowed = typeof origin === 'string' && options.allowedOrigins.includes(origin)

    if (request.method === 'OPTIONS') {
      if (!allowed) return reply(response, 403, { ok: false, error: 'This origin may not sign bay in.' })
      cors(response, origin)
      response.setHeader('Access-Control-Allow-Methods', 'POST')
      response.setHeader('Access-Control-Allow-Headers', 'content-type')
      // Chrome's Private Network Access preflight: a public https page reaching 127.0.0.1.
      response.setHeader('Access-Control-Allow-Private-Network', 'true')
      response.setHeader('Access-Control-Max-Age', '60')
      response.writeHead(204)
      response.end()
      return
    }
    if (request.method !== 'POST') return reply(response, 405, { ok: false, error: 'POST only.' })
    if (!allowed) return reply(response, 403, { ok: false, error: 'This origin may not sign bay in.' })
    if (done) return reply(response, 410, { ok: false, error: 'This sign-in was already completed.' }, origin)

    let size = 0
    const chunks: Buffer[] = []
    let overflow = false
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        overflow = true
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (overflow) return
      let body: unknown
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return reply(response, 400, { ok: false, error: 'The body is not JSON.' }, origin)
      }
      const b = (body ?? {}) as Record<string, unknown>
      if (typeof b['state'] !== 'string' || typeof b['refreshToken'] !== 'string' || !b['refreshToken']) {
        return reply(response, 400, { ok: false, error: 'Expected { state, idToken, refreshToken }.' }, origin)
      }
      if (!sameState(b['state'], state)) {
        return reply(response, 403, { ok: false, error: 'This sign-in does not match the one bay started.' }, origin)
      }
      // Checked again: two valid POSTs can both have been reading their bodies.
      if (done) return reply(response, 410, { ok: false, error: 'This sign-in was already completed.' }, origin)
      done = true
      reply(response, 200, { ok: true }, origin)
      finish({
        kind: 'tokens',
        idToken: typeof b['idToken'] === 'string' ? b['idToken'] : '',
        refreshToken: b['refreshToken']
      })
    })
  })

  const timer = setTimeout(() => finish({ kind: 'timeout' }), options.timeoutMs)
  function finish(outcome: HandoffResult): void {
    done = true
    clearTimeout(timer)
    // Stop listening now; the connection that carried the tokens finishes its reply, and idle
    // keep-alive sockets are dropped so they cannot hold the port past close().
    server.close()
    if (outcome.kind === 'tokens') server.closeIdleConnections()
    else server.closeAllConnections()
    settle(outcome)
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as AddressInfo).port

  return {
    port,
    state,
    result,
    cancel: () => {
      if (!done) finish({ kind: 'cancelled' })
    }
  }
}
