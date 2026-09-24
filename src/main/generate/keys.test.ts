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

test('two saves at once never overlap their writes, and the file ends holding both keys', async () => {
  let inFlight = 0
  let most = 0
  const storage = memoryStorage()
  const slow: KeyStorage & { bytes: Buffer | null } = {
    get bytes() {
      return storage.bytes
    },
    read: storage.read,
    write: async (bytes) => {
      inFlight++
      most = Math.max(most, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 20))
      storage.bytes = bytes
      inFlight--
    }
  }
  const ring = new KeyRing(sealing, slow)
  await Promise.all([ring.set('openai', { apiKey: 'o' }), ring.set('gemini', { apiKey: 'g' })])
  assert.equal(most, 1, 'the app writes through one temp file, so two writes at once corrupt or lose it')
  assert.deepEqual(Object.keys(JSON.parse(storage.bytes!.toString()).sealed).sort(), ['gemini', 'openai'])
})

test('a key set before the file was read keeps the keys the file held', async () => {
  const sealed = sealing.encrypt(JSON.stringify({ accessKey: 'ak', secretKey: 'sk' })).toString('base64')
  const storage = memoryStorage(Buffer.from(`{"version":1,"sealed":{"kling":"${sealed}"}}`))
  const ring = new KeyRing(sealing, storage)
  // No `load()` first: Settings can save a key while main is still starting.
  await ring.set('openai', { apiKey: SECRET })
  assert.deepEqual(Object.keys(JSON.parse(storage.bytes!.toString()).sealed).sort(), ['kling', 'openai'])
  assert.deepEqual(ring.get('kling'), { accessKey: 'ak', secretKey: 'sk' })
})

test('a keys file that cannot be parsed is reported per provider, not silently dropped; a good one reports nothing', async () => {
  const broken = new KeyRing(sealing, memoryStorage(Buffer.from('{"version":1,"sealed":{"openai":')))
  await broken.load()
  for (const status of broken.status()) {
    assert.equal(status.set, false)
    assert.match(status.problem ?? '', /saved provider keys could not be read \(.+\)\. Set the key again\./)
  }
  // Setting the key again clears that provider's problem.
  await broken.set('openai', { apiKey: SECRET })
  assert.equal(broken.status().find((s) => s.provider === 'openai')?.problem, undefined)

  // A key sealed by another keychain is named for its provider only.
  const foreign = new KeyRing(sealing, memoryStorage(Buffer.from('{"version":1,"sealed":{"gemini":"bm90LXNlYWxlZA=="}}')))
  await foreign.load()
  assert.match(foreign.status().find((s) => s.provider === 'gemini')?.problem ?? '', /Google Gemini key could not be unsealed/)
  assert.equal(foreign.status().find((s) => s.provider === 'openai')?.problem, undefined)

  // Positive control: a readable file has no problem anywhere.
  const good = new KeyRing(sealing, memoryStorage())
  await good.set('openai', { apiKey: SECRET })
  const again = new KeyRing(sealing, memoryStorage(Buffer.from(JSON.stringify({ version: 1, sealed: {} }))))
  await again.load()
  assert.ok(good.status().every((s) => s.problem === undefined))
  assert.ok(again.status().every((s) => s.problem === undefined))
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
