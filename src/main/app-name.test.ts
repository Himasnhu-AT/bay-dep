/**
 * Where a build keeps its data. A test build (`--app-name bay-reltest`) must never land on the
 * real profile, and a real build must never leave it.
 *
 *   node --import ./src/test-hooks.mjs --test src/main/app-name.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appNameFor } from './app-name'

test('a packaged test build keeps its own name, so its data stays out of the real profile', () => {
  assert.equal(appNameFor('bay-reltest', true), 'bay-reltest')
  assert.equal(appNameFor('bay-update-proof-2', true), 'bay-update-proof-2')
})

test('the real build is unchanged: bay', () => {
  assert.equal(appNameFor('bay', true), 'bay')
})

test('an unpackaged run is unchanged, whatever its package says', () => {
  // A checkout keeps using the profile its developer's probes and ./run.sh expect.
  for (const name of ['bay', 'bay-reltest', 'Electron']) assert.equal(appNameFor(name, false), 'bay', name)
})

test('nothing else moves a packaged build off bay', () => {
  for (const name of ['Electron', 'Bay', 'bay-', 'bay-Reltest', 'bay/../x', 'bay-rel test', 'other', '', `bay-${'x'.repeat(60)}`]) {
    assert.equal(appNameFor(name, true), 'bay', JSON.stringify(name))
  }
})
