/**
 * Main's copy of the dubs in flight: what is saved comes back after a restart of the store (a
 * reload of the window reads it the same way), newest first, and main refuses what is not a
 * record — against a real file in a temp folder.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DubRecords, KEEP_DUBS, MAX_DUB_RECORD_BYTES } from './dub-records'

async function file(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'bay-dubs-')), 'generation-dubs.json')
}

const record = (id: string, createdAt: number, extra: Record<string, unknown> = {}) => ({
  id,
  createdAt,
  itemId: 'clip',
  lines: [{ cue: { id: 'c@0' }, status: 'queued', jobId: 'j1' }],
  ...extra
})

test('a saved dub is read back by a new store on the same file, newest first, replaced by id', async () => {
  const path = await file()
  const first = new DubRecords(path)
  assert.deepEqual(await first.save(record('dub-a', 1)), { ok: true })
  assert.deepEqual(await first.save(record('dub-b', 2)), { ok: true })
  assert.deepEqual(await first.save(record('dub-a', 1, { result: { status: 'placed' } })), { ok: true })
  await first.flush()

  const reloaded = new DubRecords(path)
  const dubs = await reloaded.list()
  assert.deepEqual(dubs.map((d) => d.id), ['dub-b', 'dub-a'])
  assert.deepEqual(dubs[1]!.result, { status: 'placed' })
  assert.deepEqual(dubs[1]!.lines, [{ cue: { id: 'c@0' }, status: 'queued', jobId: 'j1' }])
})

test('main keeps only records: an id, a time, a bounded size; the nearest legal one is kept', async () => {
  const store = new DubRecords(await file())
  const refusals = [
    [null, /must be an object/],
    [[1], /must be an object/],
    [{ id: '../../etc', createdAt: 1 }, /needs an id like "dub-…"/],
    [{ id: 'dub-x' }, /needs a createdAt/],
    [record('dub-big', 1, { pad: 'x'.repeat(MAX_DUB_RECORD_BYTES) }), /the limit is 512 KB/]
  ] as const
  for (const [value, message] of refusals) {
    const result = await store.save(value)
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.error, message)
  }
  assert.deepEqual(await store.list(), [])
  assert.deepEqual(await store.save(record('dub-ok', 1)), { ok: true })
  assert.equal((await store.list()).length, 1)
})

test('only the newest records are kept, and a damaged file reads as none rather than failing', async () => {
  const path = await file()
  const store = new DubRecords(path)
  for (let i = 0; i < KEEP_DUBS + 3; i += 1) await store.save(record(`dub-${i}`, i))
  await store.flush()
  const kept = await new DubRecords(path).list()
  assert.equal(kept.length, KEEP_DUBS)
  assert.equal(kept[0]!.id, `dub-${KEEP_DUBS + 2}`)
  assert.equal(kept.at(-1)!.id, 'dub-3')
  assert.equal(JSON.parse(await readFile(path, 'utf8')).version, 1)

  await writeFile(path, '{ not json')
  assert.deepEqual(await new DubRecords(path).list(), [])
})
