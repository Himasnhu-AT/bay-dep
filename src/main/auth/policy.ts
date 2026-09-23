/**
 * The offline policy, as a pure function of what was stored, what the last check said, and the
 * clock. Electron-free so `pnpm test` can hold it (see CLAUDE.md on the seam rule).
 *
 * The rules, from the owner's decision:
 * - bay works offline. A check that cannot reach Google changes nothing before 14 days.
 * - 14 consecutive days without a successful verification → locked; sign in again.
 * - A definitive "no" locks at once: no grant (the access doc is 404), an unverified email, or a
 *   refresh token Google refuses (`USER_DISABLED`, `TOKEN_EXPIRED`, `INVALID_REFRESH_TOKEN`,
 *   `USER_NOT_FOUND`).
 * - Setting the clock back does not buy more offline time: ages are measured from the latest time
 *   bay has ever seen (`highWaterAt`), not from whatever the clock says now.
 */

import { OFFLINE_GRACE_MS, REFERRAL_LIMIT, type AccessStatus } from '@shared/access'

export interface AccessRecord {
  email: string
  uid: string
  lastVerifiedAt: number
  /** The latest wall-clock time bay has observed. Never moves backwards. */
  highWaterAt: number
  /** The most recent attempt failed without a definitive answer (offline, 5xx). */
  lastAttemptFailed: boolean
  referralsUsed: number | null
  /** A definitive refusal. Cleared by a fresh sign-in, or — for `no-access` only — a later check that finds a grant. */
  lock: { kind: 'no-access'; reason: 'no-grant' | 'unverified-email' } | { kind: 'revoked'; code: string } | null
}

export type VerifyOutcome =
  | { kind: 'granted'; email: string; uid: string; referralsUsed: number | null }
  | { kind: 'no-grant'; email: string; uid: string }
  | { kind: 'unverified-email'; email: string; uid: string }
  | { kind: 'revoked'; code: string }
  /** Could not reach Google, or it answered 5xx / 429. Not an answer about access. */
  | { kind: 'network'; message: string }
  /** An answer bay does not understand. Not definitive either — treated like a network failure. */
  | { kind: 'error'; message: string }

/** Codes on securetoken's 400 that mean the refresh token will never work again. */
export const REVOKED_CODES = ['USER_DISABLED', 'TOKEN_EXPIRED', 'INVALID_REFRESH_TOKEN', 'USER_NOT_FOUND'] as const

function effectiveNow(record: AccessRecord | null, now: number): number {
  return Math.max(now, record?.highWaterAt ?? now)
}

/** True when a record with no definitive lock has gone unverified for the whole grace period. */
export function pastGrace(record: AccessRecord, now: number): boolean {
  return effectiveNow(record, now) - record.lastVerifiedAt >= OFFLINE_GRACE_MS
}

/**
 * Whether a re-verification with the stored token may change this record.
 *
 * - No grant yet (`no-access`): yes — someone may refer this account while bay waits, and the
 *   next check should let them in without another trip through the browser.
 * - Revoked: no — Google has said the token is dead.
 * - Past 14 days offline: no — the rule is "sign in again", so a background success must not
 *   quietly undo the lock.
 */
export function canReverify(record: AccessRecord, now: number): boolean {
  if (record.lock?.kind === 'revoked') return false
  if (record.lock?.kind === 'no-access') return true
  return !pastGrace(record, now)
}

/**
 * The record after one verification.
 *
 * `source: 'sign-in'` is a fresh handoff: the previous record — including its lock — is
 * discarded, because the user has just proved who they are again. `'background'` is a
 * re-verification with the stored token (see `canReverify` for when that may change anything).
 *
 * Returns null when there is nothing to keep: a sign-in whose check never got an answer cannot
 * grant anything offline, since nothing was ever verified.
 */
export function applyVerification(
  previous: AccessRecord | null,
  outcome: VerifyOutcome,
  now: number,
  source: 'sign-in' | 'background'
): AccessRecord | null {
  const prior = source === 'sign-in' ? null : previous
  const highWaterAt = Math.max(now, previous?.highWaterAt ?? now)

  if (prior && !canReverify(prior, now)) return { ...prior, highWaterAt }

  switch (outcome.kind) {
    case 'granted':
      return {
        email: outcome.email,
        uid: outcome.uid,
        lastVerifiedAt: now,
        highWaterAt,
        lastAttemptFailed: false,
        referralsUsed: outcome.referralsUsed ?? prior?.referralsUsed ?? null,
        lock: null
      }
    case 'no-grant':
    case 'unverified-email':
      return {
        email: outcome.email,
        uid: outcome.uid,
        lastVerifiedAt: prior?.lastVerifiedAt ?? 0,
        highWaterAt,
        lastAttemptFailed: false,
        referralsUsed: prior?.referralsUsed ?? null,
        lock: { kind: 'no-access', reason: outcome.kind === 'no-grant' ? 'no-grant' : 'unverified-email' }
      }
    case 'revoked':
      if (!prior) return null
      return { ...prior, highWaterAt, lastAttemptFailed: false, lock: { kind: 'revoked', code: outcome.code } }
    case 'network':
    case 'error':
      if (!prior) return null
      return { ...prior, highWaterAt, lastAttemptFailed: true }
  }
}

/** What the gate reports for a stored record at `now`. */
export function statusOf(record: AccessRecord | null, now: number, persisted: boolean): AccessStatus {
  if (!record) return { state: 'signed-out' }
  if (record.lock?.kind === 'no-access') return { state: 'no-access', email: record.email, reason: record.lock.reason }
  if (record.lock?.kind === 'revoked') return { state: 'revoked', email: record.email, code: record.lock.code }
  if (pastGrace(record, now)) return { state: 'locked-offline', email: record.email, lastVerifiedAt: record.lastVerifiedAt }
  return {
    state: 'entitled',
    email: record.email,
    lastVerifiedAt: record.lastVerifiedAt,
    lockAt: record.lastVerifiedAt + OFFLINE_GRACE_MS,
    offline: record.lastAttemptFailed,
    persisted,
    referralsLeft: record.referralsUsed === null ? null : Math.max(0, REFERRAL_LIMIT - record.referralsUsed),
    bypass: false
  }
}

/** A record read off disk, checked field by field; anything malformed is no record at all. */
export function parseRecord(value: unknown): AccessRecord | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  if (typeof v['email'] !== 'string' || typeof v['uid'] !== 'string') return null
  if (!num(v['lastVerifiedAt']) || !num(v['highWaterAt'])) return null
  const lock = v['lock'] as AccessRecord['lock'] | undefined
  const validLock =
    lock === null ||
    lock === undefined ||
    (lock.kind === 'no-access' && (lock.reason === 'no-grant' || lock.reason === 'unverified-email')) ||
    (lock.kind === 'revoked' && typeof lock.code === 'string')
  if (!validLock) return null
  return {
    email: v['email'],
    uid: v['uid'],
    lastVerifiedAt: v['lastVerifiedAt'],
    highWaterAt: v['highWaterAt'],
    lastAttemptFailed: v['lastAttemptFailed'] === true,
    referralsUsed: num(v['referralsUsed']) ? v['referralsUsed'] : null,
    lock: lock ?? null
  }
}
