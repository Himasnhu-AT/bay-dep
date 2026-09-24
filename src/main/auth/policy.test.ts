/**
 * The offline policy, written from the owner's rules rather than from the code:
 * works offline; a network failure never locks before 14 days; 14 consecutive unverified days
 * lock; a definitive "no" (no grant, unverified email, revoked/disabled token) locks at once.
 *
 *   node --import ./src/test-hooks.mjs --test src/main/auth/policy.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyVerification, parseRecord, statusOf, type AccessRecord, type VerifyOutcome } from './policy'

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const T0 = Date.UTC(2026, 8, 1)

function verifiedAt(at: number, extra: Partial<AccessRecord> = {}): AccessRecord {
  return {
    email: 'a@example.com',
    uid: 'u1',
    lastVerifiedAt: at,
    highWaterAt: at,
    lastAttemptFailed: false,
    referralsUsed: 1,
    lock: null,
    ...extra
  }
}

const granted: VerifyOutcome = { kind: 'granted', email: 'a@example.com', uid: 'u1', referralsUsed: 2 }
const network: VerifyOutcome = { kind: 'network', message: 'getaddrinfo ENOTFOUND' }
const noGrant: VerifyOutcome = { kind: 'no-grant', email: 'a@example.com', uid: 'u1' }

test('age table: entitled strictly before 14 days, locked from 14 days on', () => {
  const table: [number, string][] = [
    [0, 'entitled'],
    [1 * HOUR, 'entitled'],
    [7 * DAY, 'entitled'],
    [14 * DAY - 1, 'entitled'], // the last millisecond of grace
    [14 * DAY, 'locked-offline'], // the first locked instant
    [20 * DAY, 'locked-offline'],
    [400 * DAY, 'locked-offline']
  ]
  for (const [age, expected] of table) {
    assert.equal(statusOf(verifiedAt(T0), T0 + age, true).state, expected, `age ${age / DAY} days`)
  }
})

test('a network failure does not lock before 14 days, and says it is offline', () => {
  for (const age of [1 * HOUR, 6 * HOUR, 5 * DAY, 13 * DAY]) {
    const now = T0 + age
    const next = applyVerification(verifiedAt(T0), network, now, 'background')
    assert.ok(next)
    const status = statusOf(next, now, true)
    assert.equal(status.state, 'entitled', `age ${age / DAY}`)
    assert.equal(status.state === 'entitled' && status.offline, true)
    // The failure did not count as a verification: the clock still runs from T0.
    assert.equal(next.lastVerifiedAt, T0)
    assert.equal(status.state === 'entitled' && status.lockAt, T0 + 14 * DAY)
  }
  // …and consecutive failures do lock once the 14 days are up.
  const late = applyVerification(verifiedAt(T0), network, T0 + 14 * DAY + HOUR, 'background')
  assert.equal(statusOf(late, T0 + 14 * DAY + HOUR, true).state, 'locked-offline')
})

test('a success resets the 14 days (positive control for the table above)', () => {
  const now = T0 + 13 * DAY
  const next = applyVerification(verifiedAt(T0), granted, now, 'background')
  assert.equal(next?.lastVerifiedAt, now)
  assert.equal(statusOf(next, now + 13 * DAY, true).state, 'entitled')
  assert.equal(statusOf(next, now + 14 * DAY, true).state, 'locked-offline')
})

test('404 (no grant) locks at once, at any age — even one hour after verification', () => {
  const now = T0 + HOUR
  const next = applyVerification(verifiedAt(T0), noGrant, now, 'background')
  const status = statusOf(next, now, true)
  assert.deepEqual(status, { state: 'no-access', email: 'a@example.com', reason: 'no-grant' })
})

test('an unverified email locks at once', () => {
  const next = applyVerification(verifiedAt(T0), { kind: 'unverified-email', email: 'a@example.com', uid: 'u1' }, T0 + HOUR, 'background')
  assert.deepEqual(statusOf(next, T0 + HOUR, true), { state: 'no-access', email: 'a@example.com', reason: 'unverified-email' })
})

test('a revoked or disabled account locks at once, naming the code', () => {
  for (const code of ['USER_DISABLED', 'TOKEN_EXPIRED', 'INVALID_REFRESH_TOKEN']) {
    const next = applyVerification(verifiedAt(T0), { kind: 'revoked', code }, T0 + HOUR, 'background')
    assert.deepEqual(statusOf(next, T0 + HOUR, true), { state: 'revoked', email: 'a@example.com', code })
  }
})

test('network vs 404 vs revoked, side by side at the same age', () => {
  const now = T0 + 2 * DAY
  const outcomes: [VerifyOutcome, string][] = [
    [network, 'entitled'],
    [{ kind: 'error', message: 'Firestore answered 400.' }, 'entitled'],
    [noGrant, 'no-access'],
    [{ kind: 'revoked', code: 'USER_DISABLED' }, 'revoked']
  ]
  for (const [outcome, expected] of outcomes) {
    assert.equal(statusOf(applyVerification(verifiedAt(T0), outcome, now, 'background'), now, true).state, expected, outcome.kind)
  }
})

test('past 14 days a background success does not unlock; a fresh sign-in does', () => {
  const now = T0 + 15 * DAY
  const background = applyVerification(verifiedAt(T0), granted, now, 'background')
  assert.equal(statusOf(background, now, true).state, 'locked-offline')
  const signIn = applyVerification(verifiedAt(T0), granted, now, 'sign-in')
  assert.equal(statusOf(signIn, now, true).state, 'entitled')
})

test('a no-access lock lifts when a later check finds a grant; a revoked one does not', () => {
  const now = T0 + DAY
  const waiting = verifiedAt(0, { lock: { kind: 'no-access', reason: 'no-grant' } })
  assert.equal(statusOf(applyVerification(waiting, granted, now, 'background'), now, true).state, 'entitled')
  const revoked = verifiedAt(T0, { lock: { kind: 'revoked', code: 'TOKEN_EXPIRED' } })
  assert.equal(statusOf(applyVerification(revoked, granted, now, 'background'), now, true).state, 'revoked')
})

test('a sign-in that never got an answer grants nothing', () => {
  assert.equal(applyVerification(null, network, T0, 'sign-in'), null)
  assert.equal(applyVerification(verifiedAt(T0), network, T0 + DAY, 'sign-in'), null)
  assert.equal(statusOf(null, T0, true).state, 'signed-out')
})

test('setting the clock back does not buy offline time', () => {
  // bay has already seen T0+13d (a failed check there moved the high-water mark)…
  const seen = applyVerification(verifiedAt(T0), network, T0 + 13 * DAY, 'background')
  assert.equal(seen?.highWaterAt, T0 + 13 * DAY)
  // …and a later check with the clock wound back to T0+1d does not move it backwards.
  const rewound = applyVerification(seen, network, T0 + DAY, 'background')
  assert.equal(rewound?.highWaterAt, T0 + 13 * DAY)
  // Seen T0+14d, clock now reads T0+1d: locked, because 14 days did pass.
  const seen14 = verifiedAt(T0, { highWaterAt: T0 + 14 * DAY })
  assert.equal(statusOf(seen14, T0 + DAY, true).state, 'locked-offline')
  // Positive control: with the mark at T0+1d the same clock is entitled.
  assert.equal(statusOf(verifiedAt(T0, { highWaterAt: T0 + DAY }), T0 + DAY, true).state, 'entitled')
})

test('referrals left is 5 minus referralsUsed', () => {
  const status = statusOf(verifiedAt(T0, { referralsUsed: 3 }), T0, true)
  assert.equal(status.state === 'entitled' && status.referralsLeft, 2)
})

test('parseRecord refuses malformed records rather than trusting them', () => {
  assert.equal(parseRecord(null), null)
  assert.equal(parseRecord({ email: 'a', uid: 'u' }), null)
  assert.equal(parseRecord({ ...verifiedAt(T0), lastVerifiedAt: 'yesterday' }), null)
  assert.equal(parseRecord({ ...verifiedAt(T0), lock: { kind: 'whatever' } }), null)
  assert.deepEqual(parseRecord(verifiedAt(T0)), verifiedAt(T0))
})
