/**
 * The spend guard's limits on disk: defaults when there is no file, the user's values when there
 * is, refusals that name the range — and the file shape pinned by a literal, because a later
 * build reads what this one wrote.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_GENERATION_LIMITS } from '@shared/generation'
import type { KeyStorage } from './keys'
import { GenerationLimitsStore } from './limits'

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

test('with no file the limits are $5 a session and 3 jobs at once', async () => {
  const store = new GenerationLimitsStore(memoryStorage())
  await store.load()
  assert.deepEqual(store.get(), { budgetUsd: 5, maxActive: 3 })
  assert.deepEqual(DEFAULT_GENERATION_LIMITS, { budgetUsd: 5, maxActive: 3 })
})

test('a version-1 file written by an earlier build still loads', async () => {
  const store = new GenerationLimitsStore(memoryStorage(Buffer.from('{"version":1,"budgetUsd":12.5,"maxActive":2}')))
  await store.load()
  assert.deepEqual(store.get(), { budgetUsd: 12.5, maxActive: 2 })
})

test('set limits are written in the pinned shape and come back after a restart', async () => {
  const storage = memoryStorage()
  const store = new GenerationLimitsStore(storage)
  const saved = await store.set({ budgetUsd: 20, maxActive: 5 })
  assert.deepEqual(saved, { ok: true, limits: { budgetUsd: 20, maxActive: 5 } })
  assert.deepEqual(JSON.parse(storage.bytes!.toString()), { version: 1, budgetUsd: 20, maxActive: 5 })
  const again = new GenerationLimitsStore(storage)
  await again.load()
  assert.deepEqual(again.get(), { budgetUsd: 20, maxActive: 5 })
})

test('an out-of-range limit is refused naming the range, and nothing changes; an in-range one is taken', async () => {
  const storage = memoryStorage()
  const store = new GenerationLimitsStore(storage)
  const negative = await store.set({ budgetUsd: -1, maxActive: 3 })
  assert.equal(negative.ok, false)
  assert.match(negative.ok ? '' : negative.error, /between \$0 and \$1000; got -1/)
  const fractional = await store.set({ budgetUsd: 5, maxActive: 2.5 })
  assert.match(fractional.ok ? '' : fractional.error, /whole number from 1 to 20; got 2\.5/)
  const text = await store.set({ budgetUsd: 'lots', maxActive: 3 })
  assert.equal(text.ok, false)
  // A blank field arrives as NaN or null — never read as $0.
  for (const blank of [NaN, null, '']) {
    const refused = await store.set({ budgetUsd: blank, maxActive: 3 })
    assert.equal(refused.ok, false, String(blank))
  }
  assert.equal(storage.bytes, null, 'a refused change writes nothing')
  assert.deepEqual(store.get(), DEFAULT_GENERATION_LIMITS)
  // Positive control: zero is a legal budget — it switches paid generation off.
  assert.equal((await store.set({ budgetUsd: 0, maxActive: 1 })).ok, true)
  assert.deepEqual(store.get(), { budgetUsd: 0, maxActive: 1 })
})

test('a damaged or invalid file falls back to the defaults rather than to no limit', async () => {
  for (const bytes of ['{"version":1,"budget', '{"version":1,"budgetUsd":-5,"maxActive":3}', '{"version":1,"budgetUsd":null,"maxActive":null}']) {
    const store = new GenerationLimitsStore(memoryStorage(Buffer.from(bytes)))
    await store.load()
    assert.deepEqual(store.get(), DEFAULT_GENERATION_LIMITS, bytes)
  }
})
