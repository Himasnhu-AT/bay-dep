/**
 * Provider keys on disk: sealed or absent, never plaintext — and the file shape pinned by a
 * literal, because a later build reads what this one wrote.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Cipher } from '../auth/token-store'
import { KeyRing, type KeyStorage } from './keys'

/** Reversible and visibly not the plaintext. */
const sealing: Cipher = {
  available: () => true,
  encrypt: (plain) => Buffer.from(`sealed:${Buffer.from(plain).toString('hex')}`),
  decrypt: (sealed) => Buffer.from(sealed.toString().replace(/^sealed:/, ''), 'hex').toString()
}
const noKeychain: Cipher = { ...sealing, available: () => false }

function memoryStorage(initial: Buffer | null = null): KeyStorage & { bytes: Buffer | null } {
  const store = {
    bytes: initial,
    read: async () => store.bytes,
    write: async (bytes: Buffer) => {
      store.bytes = bytes
    }
  }
  return store
}

const SECRET = 'sk-live-THISMUSTNOTLEAK'

test('a set key is written sealed, never in the clear, and comes back after a restart', async () => {
  const storage = memoryStorage()
  const ring = new KeyRing(sealing, storage)
  assert.deepEqual(await ring.set('openai', { apiKey: `  ${SECRET} ` }), { ok: true })
  const text = storage.bytes!.toString()
  assert.equal(text.includes(SECRET), false, 'the key must not appear in the file')
  // The shape a later build reads, spelled out.
  const file = JSON.parse(text) as Record<string, unknown>
  assert.deepEqual(Object.keys(file).sort(), ['sealed', 'version'])
  assert.equal(file.version, 1)
  assert.deepEqual(Object.keys(file.sealed as object), ['openai'])

  const again = new KeyRing(sealing, storage)
  await again.load()
  assert.deepEqual(again.get('openai'), { apiKey: SECRET })
  assert.deepEqual(
    again.status().find((s) => s.provider === 'openai'),
    { provider: 'openai', set: true, persisted: true }
  )
})

test('a version-1 file written by an earlier build still loads', async () => {
  const sealed = sealing.encrypt(JSON.stringify({ accessKey: 'ak', secretKey: 'sk' })).toString('base64')
  const v1 = `{"version":1,"sealed":{"kling":"${sealed}"}}`
  const ring = new KeyRing(sealing, memoryStorage(Buffer.from(v1)))
  await ring.load()
  assert.deepEqual(ring.get('kling'), { accessKey: 'ak', secretKey: 'sk' })
  assert.equal(ring.get('openai'), null)
})

test('without a keychain the key is used from memory and not written at all', async () => {
  const storage = memoryStorage()
  const ring = new KeyRing(noKeychain, storage)
  await ring.set('gemini', { apiKey: SECRET })
  assert.deepEqual(ring.get('gemini'), { apiKey: SECRET })
  assert.equal(storage.bytes!.toString().includes(SECRET), false)
  assert.deepEqual(JSON.parse(storage.bytes!.toString()).sealed, {})
  assert.deepEqual(
    ring.status().find((s) => s.provider === 'gemini'),
    { provider: 'gemini', set: true, persisted: false }
  )
})

test('a key with a field missing or a space inside is refused by name; a whole one is taken', async () => {
  const ring = new KeyRing(sealing, memoryStorage())
  const missing = await ring.set('kling', { accessKey: 'ak' })
  assert.deepEqual(missing, { ok: false, error: 'Kling needs its secret key.' })
  const spaced = await ring.set('openai', { apiKey: 'sk one' })
  assert.equal(spaced.ok, false)
  assert.match(spaced.ok ? '' : spaced.error, /has a space in it/)
  assert.equal(ring.get('kling'), null)
  // Positive control.
  assert.deepEqual(await ring.set('kling', { accessKey: 'ak', secretKey: 'sk' }), { ok: true })
})

test('clearing a key removes it from memory and from the file', async () => {
  const storage = memoryStorage()
  const ring = new KeyRing(sealing, storage)
  await ring.set('openai', { apiKey: SECRET })
  await ring.set('gemini', { apiKey: 'g' })
  await ring.clear('openai')
  assert.equal(ring.get('openai'), null)
  assert.deepEqual(Object.keys(JSON.parse(storage.bytes!.toString()).sealed), ['gemini'])
})
