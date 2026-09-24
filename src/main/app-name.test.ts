/**
 * Where a build keeps its data. A test build (`--app-name bay-reltest`) must never land on the
 * real profile, and a real build must never leave it.
 *
 *   node --import ./src/test-hooks.mjs --test src/main/app-name.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appNameFor } from './app-name'

test('a test build keeps its own name, so its data stays out of the real profile', () => {
  assert.equal(appNameFor('bay-reltest'), 'bay-reltest')
  assert.equal(appNameFor('bay-update-proof-2'), 'bay-update-proof-2')
})

test('everything else runs as bay, so a real install always finds its data', () => {
  // `bay` is the real build; `Electron` is what an unpackaged run would otherwise be called.
  for (const name of ['bay', 'Electron', 'Bay', 'bay-', 'bay-Reltest', 'bay/../x', 'bay-rel test', 'other', '', `bay-${'x'.repeat(60)}`]) {
    assert.equal(appNameFor(name), 'bay', JSON.stringify(name))
  }
})
