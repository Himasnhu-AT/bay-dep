import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOOLS } from '@shared/mcp'
import { HANDLER_GROUPS, HANDLERS } from './registry'

test('no tool is claimed by two modules', () => {
  // `HANDLERS` is a spread, so a second claim would silently win over the first.
  const claims = new Map<string, string[]>()
  for (const [module, handlers] of Object.entries(HANDLER_GROUPS)) {
    for (const name of Object.keys(handlers)) claims.set(name, [...(claims.get(name) ?? []), module])
  }
  const twice = [...claims].filter(([, modules]) => modules.length > 1).map(([n, m]) => `${n} (${m.join(', ')})`)
  assert.deepEqual(twice, [])
})

test('every catalog tool has a handler, and every handler a catalog entry', () => {
  // The executor reports this at runtime too (`catalogMismatch`); this is the build-time gate.
  const catalog = TOOLS.map((t) => t.name).sort()
  assert.ok(catalog.length > 0)
  assert.deepEqual(Object.keys(HANDLERS).sort(), catalog)
})
