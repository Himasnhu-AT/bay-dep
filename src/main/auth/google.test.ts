/**
 * The network half of access, against a fake `fetch` that records exactly what would be sent.
 *
 *   node --import ./src/test-hooks.mjs --test src/main/auth/google.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commit, guardedFetch, readClaims, referralCommitBody, refreshIdToken, userCreateBody, verifyAccess, type Fetch } from './google'

const DOCS = 'projects/bay-editor-app/databases/(default)/documents'

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

test('the referral batch is the contract\'s two writes, exactly', () => {
  const body = referralCommitBody({ friendEmail: '  Pal@Example.COM ', referrerEmail: 'Me@Example.com', uid: 'uid-1' })
  assert.deepEqual(body, {
    writes: [
      {
        update: {
          name: `${DOCS}/access/pal@example.com`,
          fields: {
            email: { stringValue: 'pal@example.com' },
            via: { stringValue: 'referral' },
            grantedBy: { stringValue: 'uid-1' },
            referrerEmail: { stringValue: 'me@example.com' }
          }
        },
        updateTransforms: [{ fieldPath: 'grantedAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: false }
      },
      {
        update: { name: `${DOCS}/users/uid-1`, fields: { lastReferral: { stringValue: 'pal@example.com' } } },
        updateMask: { fieldPaths: ['lastReferral'] },
        updateTransforms: [{ fieldPath: 'referralsUsed', increment: { integerValue: '1' } }],
        currentDocument: { exists: true }
      }
    ]
  })
})

test('the users doc bay creates carries referralsUsed 0 and a server createdAt', () => {
  assert.deepEqual(userCreateBody({ uid: 'uid-1', email: 'Me@Example.com' }), {
    writes: [
      {
        update: { name: `${DOCS}/users/uid-1`, fields: { email: { stringValue: 'me@example.com' }, referralsUsed: { integerValue: '0' } } },
        updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: false }
      }
    ]
  })
})

test('only Google\'s two access hosts can be reached', async () => {
  const { fetch, sent } = fake(() => json(200, {}))
  const guarded = guardedFetch(fetch)
  for (const url of ['https://evil.example/x', 'https://firestore.googleapis.com.evil.example/', 'http://firestore.googleapis.com/', 'https://huggingface.co/', 'not a url']) {
    await assert.rejects(guarded(url), /refused/, url)
  }
  assert.equal(sent.length, 0)
  // Positive control: the two real hosts pass.
  await guarded('https://securetoken.googleapis.com/v1/token')
  await guarded('https://firestore.googleapis.com/v1/x')
  assert.equal(sent.length, 2)
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

function verifyWith(grant: Response | Error, user: Response = json(200, { fields: { referralsUsed: { integerValue: '3' } } }), idToken = ID) {
  return fake((url) => {
    if (url.includes('securetoken')) return json(200, { id_token: idToken, refresh_token: 'r2' })
    if (url.includes('/access/')) return grant
    if (url.includes('/users/')) return user
    return new Error(`unexpected ${url}`)
  })
}

test('verifyAccess: 200 grants (with referrals), 404 and 403 do not, 5xx is offline', async () => {
  const granted = verifyWith(json(200, { fields: {} }))
  const ok = await verifyAccess(granted.fetch, 'r1')
  assert.deepEqual(ok.outcome, { kind: 'granted', email: 'friend.one@example.com', uid: 'uid-1', referralsUsed: 3 })
  assert.equal(ok.refreshToken, 'r2', 'a rotated refresh token is handed back to be stored')
  // It read the access doc keyed by the normalised email, with the fresh ID token as bearer.
  const read = granted.sent.find((s) => s.url.includes('/access/'))
  assert.ok(read?.url.endsWith('/access/friend.one%40example.com'))
  assert.deepEqual(read?.init?.headers, { Authorization: `Bearer ${ID}` })

  assert.equal((await verifyAccess(verifyWith(json(404, {})).fetch, 'r1')).outcome.kind, 'no-grant')
  assert.equal((await verifyAccess(verifyWith(json(403, {})).fetch, 'r1')).outcome.kind, 'no-grant')
  assert.equal((await verifyAccess(verifyWith(json(503, {})).fetch, 'r1')).outcome.kind, 'network')
  assert.equal((await verifyAccess(verifyWith(new TypeError('fetch failed')).fetch, 'r1')).outcome.kind, 'network')
})

test('an unverified email is refused before Firestore is asked', async () => {
  const unverified = verifyWith(json(200, {}), undefined, jwt({ user_id: 'uid-1', email: 'a@b.co', email_verified: false }))
  assert.equal((await verifyAccess(unverified.fetch, 'r1')).outcome.kind, 'unverified-email')
  assert.equal(unverified.sent.filter((s) => s.url.includes('firestore')).length, 0)
})

test('a users doc that is missing reads as 0 referrals used', async () => {
  const outcome = (await verifyAccess(verifyWith(json(200, {}), json(404, {})).fetch, 'r1')).outcome
  assert.equal(outcome.kind === 'granted' && outcome.referralsUsed, 0)
})

test('commit maps the answers the referral messages need', async () => {
  const cases: [Response | Error, string][] = [
    [json(200, {}), 'ok'],
    [json(409, { error: { status: 'ALREADY_EXISTS' } }), 'exists'],
    [json(400, { error: { status: 'FAILED_PRECONDITION' } }), 'exists'],
    [json(403, { error: { status: 'PERMISSION_DENIED' } }), 'denied'],
    [json(500, {}), 'network'],
    [new TypeError('fetch failed'), 'network'],
    [json(400, { error: { status: 'INVALID_ARGUMENT' } }), 'error']
  ]
  for (const [answer, expected] of cases) {
    const { fetch, sent } = fake(() => answer)
    assert.equal((await commit(fetch, 'id', { writes: [] })).kind, expected)
    assert.ok(sent[0]?.url.endsWith(`${DOCS}:commit`))
  }
})

test('readClaims reads uid, email and verification; refuses junk', () => {
  assert.deepEqual(readClaims(ID), { uid: 'uid-1', email: 'friend.one@example.com', emailVerified: true })
  assert.equal(readClaims('nope'), null)
  assert.equal(readClaims(jwt({ email: 'a@b.co' })), null)
})
