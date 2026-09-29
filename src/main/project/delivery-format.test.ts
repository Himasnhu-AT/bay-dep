/**
 * `timeline.delivery` is an additive optional field of the version-1 `.bay` format (CLAUDE.md: a
 * new optional field needs no bump). These load the literal version-1 document with the field
 * added, through the real load path, and write it back through the real writer — the remembered
 * loudness must survive both, or the next session's export silently loses it again.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECT_VERSION, type Project } from '@shared/project'
import { V1_ON_DISK } from '@shared/project-fixtures'
import { migrate, readProjectFile, writeProjectFile } from './persistence'

const REMEMBERED = { loudness: { integratedLufs: -14, truePeakDb: -1 } }

function withDelivery(): unknown {
  const raw = JSON.parse(V1_ON_DISK) as Record<string, unknown> & { timelines: Record<string, unknown>[] }
  raw.timelines[0]!.delivery = REMEMBERED
  return JSON.parse(JSON.stringify(raw))
}

test('delivery is still a version-1 field: adding it needed no format bump', () => {
  assert.equal(PROJECT_VERSION, 1)
})

test('a version-1 document carrying a remembered loudness loads with it, and a plain one without', () => {
  const loaded = migrate(withDelivery(), '/tmp/delivered.bay')
  assert.deepEqual(loaded.timelines[0]!.delivery, REMEMBERED)
  const plain = migrate(JSON.parse(V1_ON_DISK), '/tmp/plain.bay')
  assert.equal('delivery' in plain.timelines[0]!, false)
})

test('the remembered loudness round-trips through the writer and the reader', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bay-delivery-'))
  try {
    const path = join(dir, 'kept.bay')
    const project = migrate(withDelivery(), path) as Project
    await writeProjectFile(project, path)
    const onDisk = JSON.parse(await readFile(path, 'utf8')) as { timelines: { delivery?: unknown }[] }
    assert.deepEqual(onDisk.timelines[0]!.delivery, REMEMBERED, 'the writer keeps the key')
    const back = await readProjectFile(path)
    assert.deepEqual(back.timelines[0]!.delivery, REMEMBERED)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
