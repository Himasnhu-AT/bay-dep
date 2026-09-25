/**
 * What main accepts for visual search: only files `bay://` would serve, and bounded searches.
 * The allowlist here is `allowedBy` over a set — the same predicate `protocol.ts`'s `isAllowed`
 * is — so a traversal the allowlist refuses is refused here too.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allowedBy } from '../serve'
import { checkSearchRequest, checkVisionAssets, DEFAULT_SEARCH_LIMIT, MAX_QUERY_CHARS, MAX_SEARCH_LIMIT, MAX_VISION_ASSETS, searchLimit } from './requests'

const ADMITTED = '/Users/me/footage/beach.mov'
const CACHE = '/Users/me/Library/Caches/bay'
const isAllowed = (path: string): boolean => allowedBy(new Set([ADMITTED]), CACHE, path)
const ref = (path: string, extra: Record<string, unknown> = {}) => ({ assetId: 'a1', name: 'beach.mov', path, kind: 'video', durationUs: 5_000_000, ...extra })

test('a file the project admitted is accepted; any other path is refused by name', () => {
  const ok = checkVisionAssets([ref(ADMITTED)], isAllowed)
  assert.ok(ok.ok)
  assert.deepEqual(ok.value, [{ assetId: 'a1', name: 'beach.mov', path: ADMITTED, kind: 'video', durationUs: 5_000_000 }])

  const secret = checkVisionAssets([ref('/Users/me/.ssh/id_ed25519', { name: 'id_ed25519' })], isAllowed)
  assert.equal(secret.ok, false)
  assert.match(!secret.ok ? secret.error : '', /"id_ed25519" \(\/Users\/me\/\.ssh\/id_ed25519\) is not a file this project imported or opened.*import_media/)
})

test('a path that walks out of an admitted place is resolved first and refused', () => {
  // Concatenated, not joined: `join` would normalise the `..` away before the check saw it.
  const walk = CACHE + '/../../.ssh/id_ed25519'
  assert.ok(walk.startsWith(CACHE + '/'), 'the specimen passes a naive prefix check')
  const answer = checkVisionAssets([ref(walk)], isAllowed)
  assert.equal(answer.ok, false)
  // Positive control: a file really under the cache is admitted, and comes back resolved.
  const inside = checkVisionAssets([ref(CACHE + '/generated/./clip.mov')], isAllowed)
  assert.ok(inside.ok)
  assert.equal(inside.value[0]!.path, CACHE + '/generated/clip.mov')
})

test('a malformed reference or a relative path is refused; one bad entry refuses the call', () => {
  for (const bad of [null, 'x', { ...ref(ADMITTED), kind: 'audio' }, { ...ref(ADMITTED), path: 42 }, ref('footage/beach.mov')]) {
    const answer = checkVisionAssets([ref(ADMITTED), bad], isAllowed)
    assert.equal(answer.ok, false, JSON.stringify(bad))
  }
  assert.equal(checkVisionAssets('not a list', isAllowed).ok, false)
  // A bad duration is not a refusal: an image, or a clip whose length is unknown, is 0.
  const odd = checkVisionAssets([ref(ADMITTED, { durationUs: Number.NaN })], isAllowed)
  assert.ok(odd.ok)
  assert.equal(odd.value[0]!.durationUs, 0)
})

test('the number of files is capped, in words', () => {
  const many = Array.from({ length: MAX_VISION_ASSETS + 1 }, () => ref(ADMITTED))
  const answer = checkVisionAssets(many, isAllowed)
  assert.equal(answer.ok, false)
  assert.match(!answer.ok ? answer.error : '', new RegExp(`at most ${MAX_VISION_ASSETS} files.*${MAX_VISION_ASSETS + 1}`))
  assert.ok(checkVisionAssets(many.slice(1), isAllowed).ok)
})

test('a search limit is a finite number within 1…100, else the default', () => {
  assert.equal(searchLimit(undefined), DEFAULT_SEARCH_LIMIT)
  assert.equal(searchLimit(Number.NaN), DEFAULT_SEARCH_LIMIT)
  assert.equal(searchLimit(Number.POSITIVE_INFINITY), DEFAULT_SEARCH_LIMIT)
  assert.equal(searchLimit('50'), DEFAULT_SEARCH_LIMIT)
  assert.equal(searchLimit(-3), 1)
  assert.equal(searchLimit(1e9), MAX_SEARCH_LIMIT)
  assert.equal(searchLimit(12.4), 12)
})

test('a search request: the query is capped, similarTo shaped, the files admitted', () => {
  const ok = checkSearchRequest({ assets: [ref(ADMITTED)], query: 'a dog on a beach', limit: 1e6 }, isAllowed)
  assert.ok(ok.ok)
  assert.deepEqual(ok.value, { assets: [ref(ADMITTED)], query: 'a dog on a beach', limit: MAX_SEARCH_LIMIT })

  const long = checkSearchRequest({ assets: [ref(ADMITTED)], query: 'x'.repeat(MAX_QUERY_CHARS + 1), limit: 5 }, isAllowed)
  assert.equal(long.ok, false)
  assert.match(!long.ok ? long.error : '', new RegExp(`at most ${MAX_QUERY_CHARS}`))
  assert.ok(checkSearchRequest({ assets: [ref(ADMITTED)], query: 'x'.repeat(MAX_QUERY_CHARS), limit: 5 }, isAllowed).ok)

  const like = checkSearchRequest({ assets: [ref(ADMITTED)], similarTo: { assetId: 'a1', us: -5 } }, isAllowed)
  assert.ok(like.ok)
  assert.deepEqual(like.value.similarTo, { assetId: 'a1', us: 0 })
  assert.equal(like.value.limit, DEFAULT_SEARCH_LIMIT)

  const outside = checkSearchRequest({ assets: [ref('/etc/passwd')], query: 'x', limit: 5 }, isAllowed)
  assert.equal(outside.ok, false)
})
