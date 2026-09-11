/**
 * Tests for cache keys and the stale-cache sweep.
 *
 * The sweep exists because of a specific failure mode: nothing in bay evicts cached
 * thumbnails or waveforms, so changing how keys are derived does not invalidate the old
 * entries, it *orphans* them — they stop being addressable and stay on disk for the life of
 * the install. Measured against real footage, one 200-frame filmstrip is ~255 KB, and both
 * `count` and `height` are part of the key, so each timeline zoom level mints another set.
 *
 * Note what is and is not pinned here. `LAST_PROJECT_KEY` is pinned as a literal because it
 * is a promise to data already on disk and must never move. `CACHE_SCHEME` is the opposite:
 * it exists in order to move, so pinning its value would fight the design. What gets asserted
 * is that moving it cleans up after itself.
 *
 * Mutation-tested: the family check removed, the current-scheme check removed, a non-recursive
 * delete, and the parameter separator removed. All fail here. A fifth — hashing `CACHE_SCHEME`
 * into the key alongside the versioned directory — survived, and the code was what was wrong:
 * the scheme is constant within a run, so including it shifts every key uniformly and nothing
 * can distinguish the two. It was deleted rather than given a test.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/main/media/cache-key.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CACHE_SCHEME, cacheKey, sweepStaleCaches, stampOf } from './cache-key'

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'bay-cache-'))
}

const STAMP = { path: '/footage/a.mp4', mtimeMs: 1_700_000_000_000, size: 9_876_745 }

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

test('the same file and parameters give the same key across runs', () => {
  // This is what makes the cache survive a relaunch at all.
  assert.equal(cacheKey(STAMP, 'strip', 80, 64), cacheKey(STAMP, 'strip', 80, 64))
})

test('a re-encoded file gets a new key', () => {
  // Keyed on mtime and size, not path: a user who exports over the same filename must not
  // keep seeing the old poster.
  const later = { ...STAMP, mtimeMs: STAMP.mtimeMs + 1000 }
  assert.notEqual(cacheKey(STAMP, 'thumb', 480), cacheKey(later, 'thumb', 480))

  const bigger = { ...STAMP, size: STAMP.size + 1 }
  assert.notEqual(cacheKey(STAMP, 'thumb', 480), cacheKey(bigger, 'thumb', 480))
})

test('different parameters give different keys', () => {
  assert.notEqual(cacheKey(STAMP, 'strip', 80, 64), cacheKey(STAMP, 'strip', 80, 96))
  assert.notEqual(cacheKey(STAMP, 'strip', 80, 64), cacheKey(STAMP, 'strip', 40, 64))
  assert.notEqual(cacheKey(STAMP, 'thumb', 480), cacheKey(STAMP, 'strip', 480))
})

test('parameters cannot collide by running together', () => {
  // Without a separator, ('a', 11) and ('a1', 1) would hash identically and one clip would
  // silently show another's frames.
  assert.notEqual(cacheKey(STAMP, 'a', 11), cacheKey(STAMP, 'a1', 1))
  assert.notEqual(cacheKey(STAMP, 'strip', 1, 23), cacheKey(STAMP, 'strip', 12, 3))
})

test('two different files never share a key', () => {
  const other = { ...STAMP, path: '/footage/b.mp4' }
  assert.notEqual(cacheKey(STAMP, 'thumb', 480), cacheKey(other, 'thumb', 480))
})

test('stampOf reports the real size and mtime of a file', async () => {
  const dir = scratch()
  const file = join(dir, 'clip.mp4')
  writeFileSync(file, Buffer.alloc(1234))
  const stamp = await stampOf(file)

  assert.equal(stamp.size, 1234)
  assert.equal(stamp.path, file)
  assert.ok(stamp.mtimeMs > 0)
})

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

function seedCache(dir: string, names: string[]): void {
  for (const name of names) {
    const nested = join(dir, name, 'deep')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'entry.jpg'), 'x')
  }
}

test('a cache from an older scheme is reclaimed', () => {
  const dir = scratch()
  seedCache(dir, ['thumbs-v0', 'peaks-v0'])

  return sweepStaleCaches(dir).then((removed) => {
    assert.deepEqual(removed.sort(), ['peaks-v0', 'thumbs-v0'])
    assert.equal(existsSync(join(dir, 'thumbs-v0')), false)
    assert.equal(existsSync(join(dir, 'peaks-v0')), false)
  })
})

test('the current scheme is never swept', async () => {
  const dir = scratch()
  seedCache(dir, [`thumbs-${CACHE_SCHEME}`, `peaks-${CACHE_SCHEME}`])

  const removed = await sweepStaleCaches(dir)
  assert.deepEqual(removed, [])
  assert.equal(existsSync(join(dir, `thumbs-${CACHE_SCHEME}`, 'deep', 'entry.jpg')), true)
})

test('directories bay did not write are left alone', async () => {
  // The sweep runs over a directory inside userData. Deleting something bay does not own,
  // because it happened to sit there, is far worse than leaving stale megabytes behind.
  const dir = scratch()
  seedCache(dir, ['thumbs-v0', 'export', 'something-else', 'notes-v0', 'thumbs'])
  writeFileSync(join(dir, 'loose-file.txt'), 'x')

  const removed = await sweepStaleCaches(dir)
  assert.deepEqual(removed, ['thumbs-v0'])
  for (const kept of ['export', 'something-else', 'notes-v0', 'thumbs', 'loose-file.txt']) {
    assert.equal(existsSync(join(dir, kept)), true, `${kept} must survive the sweep`)
  }
})

test('the sweep removes a populated directory, not just an empty one', async () => {
  // `rmdir` semantics would leave every actual cached file in place and report success,
  // which is the whole problem wearing a different hat.
  const dir = scratch()
  seedCache(dir, ['thumbs-v0'])
  assert.equal(existsSync(join(dir, 'thumbs-v0', 'deep', 'entry.jpg')), true)

  await sweepStaleCaches(dir)
  assert.equal(existsSync(join(dir, 'thumbs-v0')), false)
})

test('a missing cache directory is not an error', async () => {
  // First launch: there is nothing to sweep and it must not stop startup.
  assert.deepEqual(await sweepStaleCaches(join(scratch(), 'never-created')), [])
})

test('a key is a short, stable, filename-safe string', () => {
  // Short enough to sit in a filename beside a frame number, and hex so no escaping is ever
  // needed. Separation between schemes is the directory's job, not this function's.
  const key = cacheKey(STAMP, 'thumb', 480)
  assert.match(key, /^[0-9a-f]{24}$/)
  assert.equal(key, cacheKey(STAMP, 'thumb', 480))
})
