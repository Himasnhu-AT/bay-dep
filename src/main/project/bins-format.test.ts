/**
 * `Project.bins` and `Asset.binId` are additive optional fields of the version-1 `.bay` format
 * (CLAUDE.md: a new optional field needs no bump). These go through the real load and save path
 * with the keys spelled as text — a reader that is not this build will see exactly these bytes —
 * and check that a file without them is still written without them.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECT_VERSION } from '@shared/project'
import { V1_ON_DISK } from '@shared/project-fixtures'
import { groupByBin } from '@shared/bins'
import { migrate, writeProjectFile } from './persistence'

/** The version-1 fixture with a bin, its first asset filed in it, as the text a file would hold. */
function withBins(): string {
  const bins = '\n  "bins": [\n    { "id": "bin_fixed", "name": "Interviews" }\n  ],'
  const fileAsset = '"id": "asset_1",\n      "binId": "bin_fixed",'
  assert.ok(V1_ON_DISK.includes('"id": "asset_1",'), 'the fixture must have the asset this test files')
  assert.ok(V1_ON_DISK.startsWith('{'), 'the fixture must be one object')
  return `{${bins}${V1_ON_DISK.slice(1).replace('"id": "asset_1",', fileAsset)}`
}

test('bins are still version-1 fields: adding them needed no format bump', () => {
  assert.equal(PROJECT_VERSION, 1)
})

test('a version-1 document carrying bins loads with them, and lists the asset in its bin', () => {
  const loaded = migrate(JSON.parse(withBins()), '/tmp/binned.bay')
  assert.deepEqual(loaded.bins, [{ id: 'bin_fixed', name: 'Interviews' }])
  assert.equal(loaded.assets[0]!.binId, 'bin_fixed')
  assert.deepEqual(
    groupByBin(loaded, loaded.assets).map((group) => [group.bin?.name ?? null, group.assets.length]),
    [['Interviews', 1], [null, loaded.assets.length - 1]]
  )
  // Positive control: the same document without the keys loads without them.
  const plain = migrate(JSON.parse(V1_ON_DISK), '/tmp/plain.bay')
  assert.equal('bins' in plain, false)
  assert.ok(plain.assets.every((asset) => !('binId' in asset)))
})

test('what is saved names them `bins` and `binId`, and a project without bins is saved without either', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-bins-'))
  const binned = join(dir, 'binned.bay')
  await writeProjectFile(migrate(JSON.parse(withBins()), binned), binned)
  const text = readFileSync(binned, 'utf8')
  assert.match(text, /"bins": \[\s*\{\s*"id": "bin_fixed",\s*"name": "Interviews"\s*\}\s*\]/)
  assert.match(text, /"binId": "bin_fixed"/)

  const plain = join(dir, 'plain.bay')
  await writeProjectFile(migrate(JSON.parse(V1_ON_DISK), plain), plain)
  assert.doesNotMatch(readFileSync(plain, 'utf8'), /"bins"|"binId"/)
})
