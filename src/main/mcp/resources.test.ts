import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findResource, RESOURCES } from '@shared/resources'

/**
 * The catalog is tested here rather than beside the bodies because the bodies import markdown
 * through `?raw`, which only Vite resolves — `pnpm test` runs under plain Node and cannot load
 * that module at all. The pairing of catalog to body is therefore checked at build time by the
 * guard in `resources.ts` and by `test/app/mcp.mjs` against the running server; what can be
 * checked here is that the catalog itself is coherent.
 */

test('every resource has a distinct uri', () => {
  const uris = RESOURCES.map((r) => r.uri)
  assert.equal(new Set(uris).size, uris.length, `duplicate uri in ${uris.join(', ')}`)
})

test('every uri is under the bay guide scheme, so a client can recognise one', () => {
  for (const resource of RESOURCES) {
    assert.match(resource.uri, /^bay:\/\/guide\//, resource.uri)
  }
})

test('every resource says what it is for, not just what it is called', () => {
  for (const resource of RESOURCES) {
    assert.ok(resource.name.length > 0, `${resource.uri} has no name`)
    // A description is what an agent reads to decide whether to spend tokens on the body, so
    // a one-word placeholder makes the whole catalog unusable without reading all of it.
    assert.ok(
      resource.description.length >= 40,
      `${resource.uri} description is too short to choose by: "${resource.description}"`
    )
    assert.equal(resource.mimeType, 'text/markdown')
  }
})

test('the editing guide is in the catalog, because it is the one to read first', () => {
  const guide = findResource('bay://guide/editing')
  assert.ok(guide, 'bay://guide/editing must exist')
  assert.match(guide!.description, /first/i)
})

test('an unknown uri resolves to nothing rather than to the first entry', () => {
  assert.equal(findResource('bay://guide/nope'), undefined)
  assert.equal(findResource(''), undefined)
})

test('a known uri resolves to itself', () => {
  // The positive control: a lookup that returned undefined for everything would pass the test
  // above and break every read.
  for (const resource of RESOURCES) {
    assert.equal(findResource(resource.uri)?.uri, resource.uri)
  }
})
