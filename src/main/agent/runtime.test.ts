/**
 * Which runtime `BAY_AGENT_RUNTIME` selects.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseRuntime, providerOf, resolveForStart, RUNTIME_ENV, runtimeFor, sameConversation } from './runtime'

// --- a project edited in DaVinci Resolve ------------------------------------------------------

const CONNECTOR: { command: string; args: string[]; env: Record<string, string> } = {
  command: '/opt/resolve-mcp/venv/bin/python',
  args: ['/opt/resolve-mcp/src/server.py'],
  env: { DAVINCI_RESOLVE_BRIDGE: '1' }
}

test('a start for another editor replaces the conversation, as a start for another provider does', () => {
  assert.equal(sameConversation({ provider: 'claude', host: 'bay' }, { provider: 'claude', host: 'bay' }), true)
  assert.equal(sameConversation({ provider: 'claude', host: 'resolve' }, { provider: 'claude', host: 'resolve' }), true)
  // The bay conversation has no Resolve tools; the Resolve one edits Resolve.
  assert.equal(sameConversation({ provider: 'claude', host: 'bay' }, { provider: 'claude', host: 'resolve' }), false)
  assert.equal(sameConversation({ provider: 'claude', host: 'resolve' }, { provider: 'claude', host: 'bay' }), false)
  assert.equal(sameConversation({ provider: 'claude', host: 'bay' }, { provider: 'codex', host: 'bay' }), false)
})

test('a bay project gets no connector and never asks for one', () => {
  let asked = 0
  const server = (): typeof CONNECTOR => {
    asked += 1
    return CONNECTOR
  }
  assert.deepEqual(resolveForStart('bay', 'claude', 'resolve', server), { ok: true, resolve: null })
  // Codex is refused for Resolve only; a bay project on Codex starts as it always did.
  assert.deepEqual(resolveForStart('bay', 'codex', 'resolve', server), { ok: true, resolve: null })
  assert.equal(asked, 0)
})

test('a Resolve project on Claude gets the connector under its name, with its update check off', () => {
  const started = resolveForStart('resolve', 'claude', 'resolve', () => CONNECTOR)
  assert.ok(started.ok && started.resolve)
  assert.equal(started.resolve.name, 'resolve')
  assert.equal(started.resolve.entry.command, CONNECTOR.command)
  assert.deepEqual(started.resolve.entry.args, CONNECTOR.args)
  // What the connector was given stays; the switch that stops it asking GitHub for releases is added.
  assert.equal(started.resolve.entry.env['DAVINCI_RESOLVE_BRIDGE'], '1')
  assert.equal(started.resolve.entry.env['DAVINCI_RESOLVE_MCP_UPDATE_CHECK'], '0')
  // Even over a connector entry that turned it on.
  const on = resolveForStart('resolve', 'claude', 'resolve', () => ({ ...CONNECTOR, env: { DAVINCI_RESOLVE_MCP_UPDATE_CHECK: '1' } }))
  assert.ok(on.ok && on.resolve)
  assert.equal(on.resolve.entry.env['DAVINCI_RESOLVE_MCP_UPDATE_CHECK'], '0')
  assert.equal(CONNECTOR.env['DAVINCI_RESOLVE_MCP_UPDATE_CHECK'], undefined, 'the entry given is not changed')
})

test('a Resolve project with no connector is refused with the command that sets it up', () => {
  const refused = resolveForStart('resolve', 'claude', 'resolve', () => null)
  assert.ok(!refused.ok)
  assert.match(refused.error, /connector is not set up/)
  assert.match(refused.error, /script\/setup-resolve-mcp\.sh/)
  // The nearest legal start: the same project with the connector present.
  assert.equal(resolveForStart('resolve', 'claude', 'resolve', () => CONNECTOR).ok, true)
})

test('a Resolve project on Codex is refused, saying which provider it needs and where to choose it', () => {
  const refused = resolveForStart('resolve', 'codex', 'resolve', () => CONNECTOR)
  assert.ok(!refused.ok)
  assert.match(refused.error, /Resolve/)
  assert.match(refused.error, /Claude/)
  assert.match(refused.error, /Preferences › Agent › Model/)
  // With no connector either, it is still the provider the user is told about: setting the
  // connector up would not have let this start.
  const both = resolveForStart('resolve', 'codex', 'resolve', () => null)
  assert.ok(!both.ok)
  assert.match(both.error, /Claude/)
  // The nearest legal starts: the same project on Claude, and a bay project on Codex.
  assert.equal(resolveForStart('resolve', 'claude', 'resolve', () => CONNECTOR).ok, true)
  assert.equal(resolveForStart('bay', 'codex', 'resolve', () => CONNECTOR).ok, true)
})

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
