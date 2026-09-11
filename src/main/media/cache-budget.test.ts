/**
 * Tests for the media cache budget.
 *
 * The headline is the one specified in E1: fill the cache past its budget and assert the
 * total on disk comes back under. It is written against a real directory with real files
 * rather than a mocked filesystem, because the failure it guards is about bytes actually
 * leaving the disk, and a plan that says it evicted 200 files proves nothing about that.
 *
 * Two properties matter as much as the bound itself, and both are ways a budget goes wrong
 * rather than ways it fails to work:
 *
 * - **A per-entry budget is not a bound.** N assets would get N budgets and the total would
 *   be unlimited. The Rust tree learned this when a 384 MB cap committed 1.5 GB. So the
 *   assertions are always about the *total*, never about any one entry.
 * - **Evicting the working set is worse than being over budget.** If everything is in use,
 *   eviction must stop and report, not evict and let the app re-derive — that loop burns CPU
 *   forever and ends with the cache the same size it started.
 *
 * Mutation-tested: the in-use filter dropped, the sort reversed to evict newest first, the
 * loop's break removed so it evicts everything, grouping by file instead of by key, and
 * `underBudget` hardcoded true. All fail here.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/main/media/cache-budget.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, statSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CACHE_BUDGET_BYTES,
  enforceCacheBudget,
  entryKeyFor,
  groupByKey,
  planEviction,
  type CacheEntry
} from './cache-budget'

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'bay-budget-'))
}

/** A 24-hex key, distinct per index, matching what `cacheKey` produces. */
function key(index: number): string {
  return index.toString(16).padStart(24, '0')
}

function entry(index: number, bytes: number, lastUsedMs: number): CacheEntry {
  return { key: key(index), bytes, lastUsedMs, paths: [`/cache/${key(index)}.jpg`] }
}

/** Writes a filmstrip-shaped group: `<key>_001.jpg` … and dates it. */
function writeStrip(dir: string, index: number, frames: number, bytesEach: number, ageMs: number) {
  const when = new Date(Date.now() - ageMs)
  const paths: string[] = []
  for (let frame = 1; frame <= frames; frame += 1) {
    const path = join(dir, `${key(index)}_${String(frame).padStart(3, '0')}.jpg`)
    writeFileSync(path, Buffer.alloc(bytesEach, 1))
    utimesSync(path, when, when)
    paths.push(path)
  }
  return paths
}

function totalBytes(dir: string): number {
  return readdirSync(dir).reduce((sum, name) => sum + statSync(join(dir, name)).size, 0)
}

// ---------------------------------------------------------------------------
// Grouping — a filmstrip is one entry, not N
// ---------------------------------------------------------------------------

test('files sharing a key are one entry', () => {
  // Evicting half a filmstrip would leave a partial strip that still answers as a cache hit,
  // so a clip would draw with frames missing and nothing would report it.
  const entries = groupByKey([
    { path: `/c/${key(1)}_001.jpg`, bytes: 100, mtimeMs: 10 },
    { path: `/c/${key(1)}_002.jpg`, bytes: 100, mtimeMs: 30 },
    { path: `/c/${key(2)}.jpg`, bytes: 50, mtimeMs: 20 }
  ])
  assert.equal(entries.length, 2)
  const strip = entries.find((e) => e.key === key(1))
  assert.equal(strip?.bytes, 200)
  assert.equal(strip?.paths.length, 2)
  // Newest wins, so touching one file of a group refreshes the whole group.
  assert.equal(strip?.lastUsedMs, 30)
})

test('a file that is not ours is not an entry', () => {
  // The sweep runs inside userData. Anything without a 24-hex stem is somebody else's.
  assert.equal(entryKeyFor('/c/notes.txt'), null)
  assert.equal(entryKeyFor('/c/README'), null)
  assert.equal(entryKeyFor(`/c/${key(7)}.jpg`), key(7))
  assert.equal(groupByKey([{ path: '/c/notes.txt', bytes: 999, mtimeMs: 1 }]).length, 0)
})

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

test('nothing is evicted while the cache is under budget', () => {
  const plan = planEviction([entry(1, 100, 1), entry(2, 100, 2)], 500, new Set())
  assert.deepEqual(plan.evict, [])
  assert.equal(plan.underBudget, true)
})

test('the oldest entries go first, and only enough of them', () => {
  const entries = [entry(1, 100, 300), entry(2, 100, 100), entry(3, 100, 200)]
  const plan = planEviction(entries, 250, new Set())

  assert.deepEqual(
    plan.evict.map((e) => e.key),
    [key(2)],
    'evicted the wrong entry, or more than needed'
  )
  assert.equal(plan.bytesAfter, 200)
  assert.equal(plan.underBudget, true)
})

test('entries used this session are never candidates', () => {
  const entries = [entry(1, 100, 100), entry(2, 100, 200), entry(3, 100, 300)]
  const plan = planEviction(entries, 150, new Set([key(1), key(2)]))

  assert.deepEqual(plan.evict.map((e) => e.key), [key(3)])
  assert.equal(plan.bytesAfter, 200, 'still over budget, which is the honest outcome')
  assert.equal(plan.underBudget, false)
})

test('when everything is in use, nothing is evicted and it says so', () => {
  // The loop this exists to prevent: evict the working set, watch the app re-derive it,
  // evict it again. Forever, at the same size.
  const entries = [entry(1, 400, 100), entry(2, 400, 200)]
  const inUse = new Set([key(1), key(2)])
  const plan = planEviction(entries, 100, inUse)

  assert.deepEqual(plan.evict, [])
  assert.equal(plan.underBudget, false)
  assert.equal(plan.bytesAfter, plan.bytesBefore)
})

test('one entry larger than the whole budget is evicted when it is not in use', () => {
  // The other half of the same question: a single oversized *stale* entry is exactly what
  // should go, and refusing to touch it would leave the cache permanently over budget.
  const plan = planEviction([entry(1, 5000, 100), entry(2, 10, 200)], 100, new Set([key(2)]))
  assert.deepEqual(plan.evict.map((e) => e.key), [key(1)])
  assert.equal(plan.underBudget, true)
})

test('ordering is deterministic when timestamps tie', () => {
  // Same-second writes are the normal case for one filmstrip run; a tie that resolved by
  // object order would make eviction depend on readdir order, which differs per filesystem.
  const a = planEviction([entry(1, 100, 5), entry(2, 100, 5), entry(3, 100, 5)], 100, new Set())
  const b = planEviction([entry(3, 100, 5), entry(2, 100, 5), entry(1, 100, 5)], 100, new Set())
  assert.deepEqual(a.evict.map((e) => e.key), b.evict.map((e) => e.key))
})

// ---------------------------------------------------------------------------
// The specified test: fill past the budget, assert the disk comes back under
// ---------------------------------------------------------------------------

test('filling past the budget brings the bytes on disk back under it', async () => {
  const dir = scratch()
  const bytesEach = 4096
  const frames = 10
  const perEntry = bytesEach * frames // 40 KB
  const budget = perEntry * 5 // room for five entries

  // Twelve entries, each older than the last, none in use.
  for (let index = 1; index <= 12; index += 1) {
    writeStrip(dir, index, frames, bytesEach, (13 - index) * 60_000)
  }
  assert.equal(totalBytes(dir), perEntry * 12, 'the fixture did not write what it claimed')
  assert.ok(totalBytes(dir) > budget, 'the cache must actually start over budget')

  const result = await enforceCacheBudget([dir], budget, new Set())

  // The assertion that matters: bytes *on disk*, re-measured, not the plan's arithmetic.
  const after = totalBytes(dir)
  assert.ok(after <= budget, `cache is still ${after} bytes against a budget of ${budget}`)
  assert.equal(result.underBudget, true)
  assert.equal(after, result.bytesAfter, 'the reported total disagrees with the disk')
  assert.equal(result.filesRemoved, 7 * frames, 'whole groups must go, not loose files')
})

test('the newest entries are the ones that survive', async () => {
  const dir = scratch()
  const bytesEach = 2048
  const frames = 4
  for (let index = 1; index <= 6; index += 1) {
    writeStrip(dir, index, frames, bytesEach, (7 - index) * 60_000)
  }

  await enforceCacheBudget([dir], bytesEach * frames * 2, new Set())

  const survivors = new Set(readdirSync(dir).map((name) => name.slice(0, 24)))
  assert.equal(survivors.has(key(6)), true, 'the newest entry was evicted')
  assert.equal(survivors.has(key(5)), true)
  assert.equal(survivors.has(key(1)), false, 'the oldest entry survived')
})

test('an in-use entry survives even when it is the oldest and the cache is over', async () => {
  const dir = scratch()
  const bytesEach = 2048
  const frames = 4
  for (let index = 1; index <= 4; index += 1) {
    writeStrip(dir, index, frames, bytesEach, (5 - index) * 60_000)
  }

  await enforceCacheBudget([dir], bytesEach * frames, new Set([key(1)]))

  const survivors = new Set(readdirSync(dir).map((name) => name.slice(0, 24)))
  assert.equal(survivors.has(key(1)), true, 'the oldest entry was in use and must survive')
})

test('files that are not ours are never removed, however far over budget', async () => {
  const dir = scratch()
  writeStrip(dir, 1, 4, 4096, 60_000)
  writeFileSync(join(dir, 'notes.txt'), Buffer.alloc(1024))
  mkdirSync(join(dir, 'a-subdirectory'))

  await enforceCacheBudget([dir], 1, new Set())

  const left = readdirSync(dir)
  assert.ok(left.includes('notes.txt'), 'a foreign file was deleted')
  assert.ok(left.includes('a-subdirectory'), 'a subdirectory was deleted')
})

test('a missing cache directory is not an error', async () => {
  const result = await enforceCacheBudget([join(scratch(), 'nope')], 100, new Set())
  assert.equal(result.bytesBefore, 0)
  assert.equal(result.underBudget, true)
})

test('two directories are budgeted together, not one each', async () => {
  // The per-entry mistake at directory scale: budgeting thumbs and peaks separately would
  // give the cache twice the limit it was configured with.
  const thumbs = scratch()
  const peaks = scratch()
  writeStrip(thumbs, 1, 4, 4096, 120_000)
  writeStrip(peaks, 2, 4, 4096, 60_000)
  const budget = 4 * 4096 // room for exactly one of the two

  const result = await enforceCacheBudget([thumbs, peaks], budget, new Set())
  assert.equal(totalBytes(thumbs) + totalBytes(peaks), budget)
  assert.equal(result.underBudget, true)
})

test('the budget is a constant a person can reason about', () => {
  // ~50 KB of derived data per asset, measured. This is roughly ten thousand assets, which is
  // deliberately far past any real project: eviction should bound the pathological case, not
  // be something a working editor runs into.
  assert.equal(CACHE_BUDGET_BYTES, 512 * 1024 * 1024)
  assert.ok(CACHE_BUDGET_BYTES / 50_000 > 5_000)
})
