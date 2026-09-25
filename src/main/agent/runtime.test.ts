/**
 * Which runtime `BAY_AGENT_RUNTIME` selects.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseRuntime, providerOf, RUNTIME_ENV, runtimeFor } from './runtime'

test('the CLI stays the default', () => {
  assert.deepEqual(chooseRuntime(undefined), { ok: true, kind: 'cli' })
  assert.deepEqual(chooseRuntime(''), { ok: true, kind: 'cli' })
  assert.deepEqual(chooseRuntime('cli'), { ok: true, kind: 'cli' })
})

test('the SDK is chosen by name, forgiving case and whitespace', () => {
  assert.deepEqual(chooseRuntime('sdk'), { ok: true, kind: 'sdk' })
  assert.deepEqual(chooseRuntime(' SDK '), { ok: true, kind: 'sdk' })
})

test('a misspelling is refused, not quietly turned into the default', () => {
  const choice = chooseRuntime('skd')
  assert.equal(choice.ok, false)
  // The refusal names the variable, the bad value and the values that work.
  const error = (choice as { error: string }).error
  assert.ok(error.includes(RUNTIME_ENV))
  assert.ok(error.includes('"skd"'))
  assert.ok(error.includes('"cli"') && error.includes('"sdk"') && error.includes('"codex"'))
})

test('codex is a runtime by name', () => {
  assert.deepEqual(chooseRuntime('codex'), { ok: true, kind: 'codex' })
  assert.deepEqual(chooseRuntime(' Codex '), { ok: true, kind: 'codex' })
})

test('the Settings provider picks the runtime when the environment says nothing', () => {
  assert.deepEqual(runtimeFor(undefined, 'codex'), { ok: true, kind: 'codex' })
  assert.deepEqual(runtimeFor('', 'claude'), { ok: true, kind: 'cli' })
  assert.deepEqual(runtimeFor(undefined, undefined), { ok: true, kind: 'cli' })
})

test('BAY_AGENT_RUNTIME overrides the Settings provider, both ways', () => {
  assert.deepEqual(runtimeFor('sdk', 'codex'), { ok: true, kind: 'sdk' })
  assert.deepEqual(runtimeFor('codex', 'claude'), { ok: true, kind: 'codex' })
  // A misspelt override is still refused, not replaced by the Settings choice.
  assert.equal(runtimeFor('skd', 'codex').ok, false)
})

test('each runtime belongs to its provider', () => {
  assert.equal(providerOf('cli'), 'claude')
  assert.equal(providerOf('sdk'), 'claude')
  assert.equal(providerOf('codex'), 'codex')
})
