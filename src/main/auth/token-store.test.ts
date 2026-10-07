/**
 * The refresh token never reaches disk in plaintext. These inspect the exact bytes that would be
 * written, not a round trip — a round trip passes whether the token was sealed or not.
 *
 *   node --import ./src/test-hooks.mjs --test src/main/auth/token-store.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeAccessFile, encodeAccessFile, type Cipher } from './token-store'
import type { AccessRecord } from './policy'

const TOKEN = 'AMf-vBx_refresh_token_7f3a9c'

/** A stand-in for safeStorage: reversible, and never contains its input. */
const sealing: Cipher = {
  available: () => true,
  encrypt: (plain) => Buffer.from(`sealed:${Buffer.from(plain).reverse().toString('hex')}`),
  decrypt: (sealed) => Buffer.from(sealed.toString().slice('sealed:'.length), 'hex').reverse().toString()
}
const noKeychain: Cipher = {
  available: () => false,
  encrypt: () => {
    throw new Error('must not be called without a keychain')
  },
  decrypt: () => {
    throw new Error('must not be called without a keychain')
  }
}

const record: AccessRecord = {
  email: 'a@example.com',
  uid: 'u1',
  lastVerifiedAt: 1_790_000_000_000,
  highWaterAt: 1_790_000_000_000,
  lastAttemptFailed: false,
  lock: null
}

/** Every form the token could leak in: raw, base64, hex, JSON-escaped. */
function leaks(bytes: Buffer): string[] {
  const text = bytes.toString('utf8')
  const forms = {
    raw: TOKEN,
    base64: Buffer.from(TOKEN).toString('base64'),
    base64url: Buffer.from(TOKEN).toString('base64url'),
    hex: Buffer.from(TOKEN).toString('hex')
  }
  return Object.entries(forms)
    .filter(([, form]) => text.includes(form))
    .map(([name]) => name)
}

test('with a keychain: the token is sealed, and no form of the plaintext is in the bytes', () => {
  const { bytes, persisted } = encodeAccessFile(record, TOKEN, sealing)
  assert.equal(persisted, true)
  assert.deepEqual(leaks(bytes), [])
  // Positive control for `leaks`: it does see a plaintext token when one is there.
  assert.deepEqual(leaks(Buffer.from(JSON.stringify({ token: TOKEN }))), ['raw'])
  // And the sealed token is in the file, so the next launch can use it.
  assert.equal(decodeAccessFile(bytes, sealing).refreshToken, TOKEN)
})

test('without a keychain: the token is not written at all, and the caller is told', () => {
  const { bytes, persisted } = encodeAccessFile(record, TOKEN, noKeychain)
  assert.equal(persisted, false)
  assert.deepEqual(leaks(bytes), [])
  const back = decodeAccessFile(bytes, noKeychain)
  assert.equal(back.refreshToken, null)
  assert.deepEqual(back.record, record)
})

test('signed out writes no token and counts as persisted', () => {
  const { bytes, persisted } = encodeAccessFile(null, null, sealing)
  assert.equal(persisted, true)
  assert.deepEqual(decodeAccessFile(bytes, sealing), { record: null, refreshToken: null })
})

test('a token sealed by another keychain is unusable, not an error', () => {
  const { bytes } = encodeAccessFile(record, TOKEN, sealing)
  const other: Cipher = { ...sealing, decrypt: () => { throw new Error('bad key') } }
  assert.deepEqual(decodeAccessFile(bytes, other), { record, refreshToken: null })
  assert.deepEqual(decodeAccessFile(Buffer.from('not json'), sealing), { record: null, refreshToken: null })
})

test('a version-1 access.json, spelled out, still loads (a later build reads what this one wrote)', () => {
  const sealed = sealing.encrypt(TOKEN).toString('base64')
  const v1 = `{
  "version": 1,
  "record": {
    "email": "a@example.com",
    "uid": "u1",
    "lastVerifiedAt": 1790000000000,
    "highWaterAt": 1790000000000,
    "lastAttemptFailed": false,
    "lock": null
  },
  "sealedToken": "${sealed}"
}`
  assert.deepEqual(decodeAccessFile(Buffer.from(v1), sealing), { record, refreshToken: TOKEN })
  // And today's writer still emits every key the literal has.
  const written = JSON.parse(encodeAccessFile(record, TOKEN, sealing).bytes.toString()) as Record<string, unknown>
  assert.deepEqual(Object.keys(written).sort(), ['record', 'sealedToken', 'version'])
  assert.deepEqual(Object.keys(written['record'] as object).sort(), Object.keys(JSON.parse(v1).record).sort())
})

test('an access.json from the referral days, with referralsUsed, still decodes — the key is ignored', () => {
  const sealed = sealing.encrypt(TOKEN).toString('base64')
  // Spelled out exactly as builds with referrals wrote it; those files are on users' disks.
  const old = `{
  "version": 1,
  "record": {
    "email": "a@example.com",
    "uid": "u1",
    "lastVerifiedAt": 1790000000000,
    "highWaterAt": 1790000000000,
    "lastAttemptFailed": false,
    "referralsUsed": 3,
    "lock": null
  },
  "sealedToken": "${sealed}"
}`
  assert.ok(old.includes('"referralsUsed": 3'), 'the specimen carries the retired key')
  assert.deepEqual(decodeAccessFile(Buffer.from(old), sealing), { record, refreshToken: TOKEN })
  // An unused referral count (null) decoded the same way.
  assert.deepEqual(decodeAccessFile(Buffer.from(old.replace('"referralsUsed": 3', '"referralsUsed": null')), sealing).record, record)
})
