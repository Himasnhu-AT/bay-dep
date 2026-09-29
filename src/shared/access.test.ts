/**
 * "Write the sentence before the type": every access state reads as its own sentence, and no two
 * states a person must act on differently read the same.
 *
 *   node --import ./src/test-hooks.mjs --test src/shared/access.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeAccess, lockedMessage, normaliseEmail, type AccessStatus } from './access'

const at = Date.UTC(2026, 8, 1)
const states: AccessStatus[] = [
  { state: 'signed-out' },
  { state: 'waiting', url: 'https://bay.himanshuat.com/desktop/sign-in?port=1&state=s', expiresAt: at },
  { state: 'checking', email: 'a@example.com' },
  { state: 'entitled', email: 'a@example.com', lastVerifiedAt: at, lockAt: at, offline: false, persisted: true, bypass: false },
  { state: 'entitled', email: 'a@example.com', lastVerifiedAt: at, lockAt: at, offline: true, persisted: true, bypass: false },
  { state: 'entitled', email: 'dev', lastVerifiedAt: at, lockAt: at, offline: false, persisted: true, bypass: true },
  { state: 'no-access', email: 'a@example.com', reason: 'unverified-email' },
  { state: 'locked-offline', email: 'a@example.com', lastVerifiedAt: at },
  { state: 'revoked', email: 'a@example.com', code: 'USER_DISABLED' },
  { state: 'revoked', email: 'a@example.com', code: 'TOKEN_EXPIRED' },
  { state: 'error', message: 'The browser sign-in was not finished within 5 minutes.' }
]

test('every state has its own sentence', () => {
  const seen = new Map<string, string>()
  for (const status of states) {
    const { title, detail } = describeAccess(status)
    assert.ok(title.length > 0, status.state)
    const sentence = `${title} — ${detail}`
    assert.equal(seen.get(sentence), undefined, `${JSON.stringify(status)} reads the same as ${seen.get(sentence)}`)
    seen.set(sentence, JSON.stringify(status))
  }
})

test('the sentences carry what the person needs: the email, the date, the code', () => {
  assert.match(describeAccess(states[6]!).title, /a@example\.com is not verified/)
  assert.match(describeAccess(states[4]!).detail, /offline until/)
  assert.match(describeAccess(states[7]!).detail, /14 days/)
  assert.match(describeAccess(states[8]!).title, /disabled/)
})

test('no sentence promises a waitlist, a referral or an invitation: signing in is the whole check', () => {
  const signedOut = describeAccess(states[0]!)
  assert.equal(signedOut.title, 'Sign in to use bay')
  assert.equal(signedOut.detail, 'Sign in with your Google account.')
  for (const status of states) {
    const { title, detail } = describeAccess(status)
    assert.doesNotMatch(`${title} ${detail} ${lockedMessage(status)}`, /invite|waitlist|refer|grant/i, status.state)
  }
})

test('the locked message says it is locked, why, and how to unlock', () => {
  const message = lockedMessage({ state: 'signed-out' })
  assert.match(message, /^bay is locked: Sign in to use bay\./)
  assert.match(message, /open the bay window and sign in/)
  assert.match(message, /retry this call/)
})

test('emails are normalised: trimmed and lowercased', () => {
  assert.equal(normaliseEmail('  Pal@Example.COM '), 'pal@example.com')
})
