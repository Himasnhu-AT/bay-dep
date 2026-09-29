/**
 * The network half of access, against a fake `fetch` that records exactly what would be sent.
 *
 *   node --import ./src/test-hooks.mjs --test src/main/auth/google.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardedFetch, readClaims, refreshIdToken, verifyAccess, type Fetch } from './google'

function jwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`
}

interface Sent {
  url: string
  init: RequestInit | undefined
}

function fake(routes: (url: string, init?: RequestInit) => Response | Error): { fetch: Fetch; sent: Sent[] } {
  const sent: Sent[] = []
  return {
    sent,
    fetch: async (url, init) => {
      sent.push({ url, init })
      const answer = routes(url, init)
      if (answer instanceof Error) throw answer
      return answer
    }
  }
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ID = jwt({ user_id: 'uid-1', email: 'Friend.One@Example.com ', email_verified: true })

test('only securetoken can be reached — Firestore included, now that nothing reads a grant', async () => {
  const { fetch, sent } = fake(() => json(200, {}))
  const guarded = guardedFetch(fetch)
  for (const url of [
    'https://evil.example/x',
    'https://securetoken.googleapis.com.evil.example/',
    'http://securetoken.googleapis.com/v1/token',
    'https://firestore.googleapis.com/v1/x',
    'https://huggingface.co/',
    'not a url'
  ]) {
    await assert.rejects(guarded(url), /refused/, url)
  }
  assert.equal(sent.length, 0)
  // Positive control: the real host passes.
  await guarded('https://securetoken.googleapis.com/v1/token')
  assert.equal(sent.length, 1)
})

test('securetoken answers map to revoked / network / error', async () => {
  const cases: [Response | Error, string][] = [
    [json(400, { error: { message: 'USER_DISABLED' } }), 'revoked'],
    [json(400, { error: { message: 'TOKEN_EXPIRED' } }), 'revoked'],
    [json(400, { error: { message: 'INVALID_REFRESH_TOKEN' } }), 'revoked'],
    [json(400, { error: { message: 'USER_NOT_FOUND' } }), 'revoked'],
    [json(400, { error: { message: 'INVALID_GRANT_TYPE' } }), 'error'], // bay's bug, not the user's
    [json(403, { error: { message: 'API_KEY_INVALID' } }), 'error'],
    [json(503, {}), 'network'],
    [json(429, {}), 'network'],
    [new TypeError('fetch failed'), 'network'],
    [json(200, { id_token: ID, refresh_token: 'r2' }), 'ok']
  ]
  for (const [answer, expected] of cases) {
    const { fetch } = fake(() => answer)
    const outcome = await refreshIdToken(fetch, 'r1')
    assert.equal(outcome.kind, expected, JSON.stringify(answer instanceof Error ? answer.message : answer.status))
  }
})

test('the refresh sends only the refresh token, form-encoded, to securetoken', async () => {
  const { fetch, sent } = fake(() => json(200, { id_token: ID, refresh_token: 'r2' }))
  await refreshIdToken(fetch, 'r1')
  assert.equal(sent.length, 1)
  assert.match(sent[0]!.url, /^https:\/\/securetoken\.googleapis\.com\/v1\/token\?key=/)
  assert.equal(sent[0]!.init?.body, 'grant_type=refresh_token&refresh_token=r1')
})

/** securetoken answers the refresh; any other request is recorded and fails the verification. */
function verifyWith(refresh: Response | Error) {
  return fake((url) => (url.includes('securetoken') ? refresh : new Error(`unexpected ${url}`)))
}

const refreshed = (idToken: string): Response => json(200, { id_token: idToken, refresh_token: 'r2' })

test('verifyAccess: a verified email with no access doc anywhere is entitled, and Firestore is never asked', async () => {
  const { fetch, sent } = verifyWith(refreshed(ID))
  const ok = await verifyAccess(fetch, 'r1')
  assert.deepEqual(ok.outcome, { kind: 'granted', email: 'friend.one@example.com', uid: 'uid-1' })
  assert.equal(ok.refreshToken, 'r2', 'a rotated refresh token is handed back to be stored')
  assert.deepEqual(
    sent.map((s) => new URL(s.url).hostname),
    ['securetoken.googleapis.com'],
    'the refresh is the only request: no grant, no users doc'
  )
})

test('verifyAccess: an unverified email is still refused, after only the refresh', async () => {
  const { fetch, sent } = verifyWith(refreshed(jwt({ user_id: 'uid-1', email: 'a@b.co', email_verified: false })))
  assert.deepEqual((await verifyAccess(fetch, 'r1')).outcome, { kind: 'unverified-email', email: 'a@b.co', uid: 'uid-1' })
  assert.equal(sent.length, 1)
  // An account with no email at all is an error, not an entitlement.
  const noEmail = verifyWith(refreshed(jwt({ user_id: 'uid-1', email_verified: true })))
  assert.equal((await verifyAccess(noEmail.fetch, 'r1')).outcome.kind, 'error')
})

test('verifyAccess: a disabled account is revoked — how the owner takes access away', async () => {
  const { fetch } = verifyWith(json(400, { error: { message: 'USER_DISABLED' } }))
  const result = await verifyAccess(fetch, 'r1')
  assert.deepEqual(result.outcome, { kind: 'revoked', code: 'USER_DISABLED' })
  assert.equal(result.refreshToken, null)
})

test('verifyAccess: no network, or Google down, is the offline case — not an answer about access', async () => {
  assert.equal((await verifyAccess(verifyWith(new TypeError('fetch failed')).fetch, 'r1')).outcome.kind, 'network')
  assert.equal((await verifyAccess(verifyWith(json(503, {})).fetch, 'r1')).outcome.kind, 'network')
})

test('readClaims reads uid, email and verification; refuses junk', () => {
  assert.deepEqual(readClaims(ID), { uid: 'uid-1', email: 'friend.one@example.com', emailVerified: true })
  assert.equal(readClaims('nope'), null)
  assert.equal(readClaims(jwt({ email: 'a@b.co' })), null)
})
