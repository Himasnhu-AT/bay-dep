/**
 * The loopback handoff against a real socket. Every refusal is paired with the valid POST that
 * must still succeed afterwards — a server that refused everything would pass the refusals alone.
 *
 *   node --import ./src/test-hooks.mjs --test src/main/auth/handoff.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { startHandoff, type Handoff } from './handoff'

const SITE = 'https://bay.himanshuat.com'
const STATE = 'A'.repeat(43)
const GOOD = JSON.stringify({ state: STATE, idToken: 'id.token.x', refreshToken: 'refresh-1' })

interface Reply {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

function send(port: number, init: { method?: string; path?: string; origin?: string | null; body?: string; headers?: Record<string, string> }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...init.headers }
    if (init.origin !== null) headers['Origin'] = init.origin ?? SITE
    const req = request(
      { host: '127.0.0.1', port, method: init.method ?? 'POST', path: init.path ?? '/callback', headers, agent: false },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
      }
    )
    req.on('error', reject)
    req.end(init.body)
  })
}

async function open(timeoutMs = 5000): Promise<Handoff> {
  return startHandoff({ allowedOrigins: [SITE], timeoutMs, state: STATE })
}

/** Resolves 'pending' if the handoff has not settled within a tick. */
async function peek(handoff: Handoff): Promise<unknown> {
  return Promise.race([handoff.result, new Promise((resolve) => setTimeout(() => resolve('pending'), 50))])
}

test('positive control: the site posting the right state hands over the tokens', { timeout: 5000 }, async () => {
  const handoff = await open()
  const reply = await send(handoff.port, { body: GOOD })
  assert.equal(reply.status, 200)
  assert.equal(reply.headers['access-control-allow-origin'], SITE)
  assert.deepEqual(await handoff.result, { kind: 'tokens', idToken: 'id.token.x', refreshToken: 'refresh-1' })
})

test('a wrong state is refused, and the real sign-in still completes after it', { timeout: 5000 }, async () => {
  const handoff = await open()
  // A same-length state, so the refusal is the comparison and not a length shortcut.
  const forged = JSON.stringify({ state: 'B'.repeat(43), idToken: 'x', refreshToken: 'attacker' })
  const refused = await send(handoff.port, { body: forged })
  assert.equal(refused.status, 403)
  assert.match(refused.body, /does not match/)
  assert.equal(await peek(handoff), 'pending', 'a refused POST must not end the wait')
  const good = await send(handoff.port, { body: GOOD })
  assert.equal(good.status, 200)
  assert.deepEqual(await handoff.result, { kind: 'tokens', idToken: 'id.token.x', refreshToken: 'refresh-1' })
})

test('a wrong or missing Origin is refused, even with the right state', { timeout: 5000 }, async () => {
  const handoff = await open()
  for (const origin of ['https://evil.example', 'https://bay.himanshuat.com.evil.example', 'http://bay.himanshuat.com', 'null', null]) {
    const reply = await send(handoff.port, { origin, body: GOOD })
    assert.equal(reply.status, 403, `origin ${String(origin)}`)
    assert.equal(reply.headers['access-control-allow-origin'], undefined)
  }
  assert.equal(await peek(handoff), 'pending')
  assert.equal((await send(handoff.port, { body: GOOD })).status, 200)
  await handoff.result
})

test('the CORS preflight is answered for the site only, with the private-network header', { timeout: 5000 }, async () => {
  const handoff = await open()
  const ok = await send(handoff.port, { method: 'OPTIONS', headers: { 'Access-Control-Request-Private-Network': 'true' } })
  assert.equal(ok.status, 204)
  assert.equal(ok.headers['access-control-allow-origin'], SITE)
  assert.equal(ok.headers['access-control-allow-private-network'], 'true')
  const refused = await send(handoff.port, { method: 'OPTIONS', origin: 'https://evil.example' })
  assert.equal(refused.status, 403)
  handoff.cancel()
  assert.deepEqual(await handoff.result, { kind: 'cancelled' })
})

test('a second POST after the handoff is refused', { timeout: 5000 }, async () => {
  const handoff = await open()
  assert.equal((await send(handoff.port, { body: GOOD })).status, 200)
  await handoff.result
  // The server has stopped listening: the second attempt cannot even connect — or, if it raced
  // the close, gets 410. Either way no second set of tokens is taken.
  const second = await send(handoff.port, { body: JSON.stringify({ state: STATE, idToken: 'y', refreshToken: 'refresh-2' }) }).then(
    (reply) => reply.status,
    (error: NodeJS.ErrnoException) => error.code
  )
  assert.ok(second === 'ECONNREFUSED' || second === 410, `second POST got ${String(second)}`)
  assert.deepEqual(await handoff.result, { kind: 'tokens', idToken: 'id.token.x', refreshToken: 'refresh-1' })
})

test('two valid POSTs in flight at once: exactly one wins', { timeout: 5000 }, async () => {
  const handoff = await open()
  // Both requests are admitted (headers sent, half a body) before either finishes, so the
  // check that decides this is the one after the body — not the early one at the door.
  const half = Math.floor(GOOD.length / 2)
  const inFlight = [0, 1].map(() => {
    let finish!: () => void
    const reply = new Promise<number | string>((resolve) => {
      const req = request(
        { host: '127.0.0.1', port: handoff.port, method: 'POST', path: '/callback', agent: false, headers: { Origin: SITE, 'Content-Type': 'application/json', 'Content-Length': String(GOOD.length) } },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        }
      )
      req.on('error', () => resolve('refused'))
      req.write(GOOD.slice(0, half))
      finish = () => req.end(GOOD.slice(half))
    })
    return { reply, finish: () => finish() }
  })
  await new Promise((resolve) => setTimeout(resolve, 100))
  for (const request of inFlight) request.finish()
  const statuses = await Promise.all(inFlight.map((r) => r.reply))
  assert.deepEqual([...statuses].sort(), [200, 410], JSON.stringify(statuses))
  await handoff.result
})

test('it gives up after the timeout and releases the port', { timeout: 5000 }, async () => {
  const handoff = await open(150)
  assert.deepEqual(await handoff.result, { kind: 'timeout' })
  const late = await send(handoff.port, { body: GOOD }).then(
    (reply) => reply.status,
    (error: NodeJS.ErrnoException) => error.code
  )
  assert.equal(late, 'ECONNREFUSED')
})

test('bad JSON and missing fields are 400, and the wait goes on', { timeout: 5000 }, async () => {
  const handoff = await open()
  const bad = await send(handoff.port, { body: '{"state": ' })
  assert.equal(bad.status, 400)
  assert.match(bad.body, /not JSON/)
  const missing = await send(handoff.port, { body: JSON.stringify({ state: STATE, idToken: 'x' }) })
  assert.equal(missing.status, 400)
  const empty = await send(handoff.port, { body: JSON.stringify({ state: STATE, refreshToken: '' }) })
  assert.equal(empty.status, 400)
  assert.equal(await peek(handoff), 'pending')
  assert.equal((await send(handoff.port, { body: GOOD })).status, 200)
  await handoff.result
})

test('only POST /callback: other paths and methods are refused', { timeout: 5000 }, async () => {
  const handoff = await open()
  assert.equal((await send(handoff.port, { path: '/', body: GOOD })).status, 404)
  assert.equal((await send(handoff.port, { method: 'GET' })).status, 405)
  assert.equal(await peek(handoff), 'pending')
  handoff.cancel()
})

test('the state bay generates is 32 random bytes, base64url', { timeout: 5000 }, async () => {
  const a = await startHandoff({ allowedOrigins: [SITE], timeoutMs: 1000 })
  const b = await startHandoff({ allowedOrigins: [SITE], timeoutMs: 1000 })
  assert.match(a.state, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(a.state, b.state)
  a.cancel()
  b.cancel()
})
