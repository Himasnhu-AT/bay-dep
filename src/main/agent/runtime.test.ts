/**
 * Which runtime `BAY_AGENT_RUNTIME` selects.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseRuntime, RUNTIME_ENV } from './runtime'

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
  assert.ok(error.includes('"cli"') && error.includes('"sdk"'))
})
