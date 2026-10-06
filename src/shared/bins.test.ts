import { test } from 'node:test'
import assert from 'node:assert/strict'
import { binOf, createBin, findBin, groupByBin, moveAssetsToBin, removeBin, renameBin } from './bins'
import type { Asset, Project } from './project'

const asset = (id: string, binId?: string): Asset =>
  ({ id, kind: 'video', name: `${id}.mp4`, path: `/f/${id}.mp4`, durationUs: 1, width: 1, height: 1, createdAt: 1, ...(binId ? { binId } : {}) }) as Asset

function project(): Project {
  return {
    id: 'prj', name: 'P', version: 1, timelines: [], activeTimelineId: '', createdAt: 0, updatedAt: 0,
    assets: [asset('a'), asset('b'), asset('c')]
  } as Project
}

test('a bin is made, named, filled, renamed and removed — and a pool that ends with none has no trace of them', () => {
  const p = project()
  const untouched = JSON.stringify(p)

  const made = createBin(p, '  Interviews ', 'bin_1')
  assert.deepEqual(made, { bin: { id: 'bin_1', name: 'Interviews' } })
  assert.deepEqual(moveAssetsToBin(p, ['a', 'c'], 'bin_1'), { moved: ['a', 'c'], alreadyThere: [], bin: { id: 'bin_1', name: 'Interviews' } })
  assert.deepEqual(p.assets.map((item) => item.binId), ['bin_1', undefined, 'bin_1'])

  assert.deepEqual(renameBin(p, 'bin_1', 'Talking heads'), { bin: { id: 'bin_1', name: 'Talking heads' }, was: 'Interviews' })
  assert.equal(binOf(p, p.assets[0]!)?.name, 'Talking heads')

  const removed = removeBin(p, 'bin_1')
  assert.deepEqual(removed, { removed: { id: 'bin_1', name: 'Talking heads' }, released: ['a', 'c'] })
  // No media went with the bin, and the document is byte for byte what it was before any bin.
  assert.equal(JSON.stringify(p), untouched)
})

test('taking the last asset out of bins leaves the bins; removing the last bin removes the key', () => {
  const p = project()
  createBin(p, 'Music', 'bin_1')
  moveAssetsToBin(p, ['a'], 'bin_1')
  assert.deepEqual(moveAssetsToBin(p, ['a'], null), { moved: ['a'], alreadyThere: [], bin: null })
  assert.equal('binId' in p.assets[0]!, false, 'absent, not undefined: the key must not be written')
  assert.deepEqual(p.bins, [{ id: 'bin_1', name: 'Music' }], 'an empty bin is still a bin')
  removeBin(p, 'bin_1')
  assert.equal('bins' in p, false)
})

test('a move says which assets moved and which were already there, and changes nothing for the latter', () => {
  const p = project()
  createBin(p, 'A', 'bin_1')
  moveAssetsToBin(p, ['a'], 'bin_1')
  const before = JSON.stringify(p)
  assert.deepEqual(moveAssetsToBin(p, ['a'], 'bin_1'), { moved: [], alreadyThere: ['a'], bin: { id: 'bin_1', name: 'A' } })
  assert.equal(JSON.stringify(p), before)
  assert.deepEqual(moveAssetsToBin(p, ['a', 'b'], 'bin_1'), { moved: ['b'], alreadyThere: ['a'], bin: { id: 'bin_1', name: 'A' } })
})

test('refusals name what exists, and change nothing', () => {
  const p = project()
  createBin(p, 'Interviews', 'bin_1')
  const before = JSON.stringify(p)
  const error = (result: object): string => ('error' in result ? String(result.error) : `not refused: ${JSON.stringify(result)}`)

  assert.match(error(createBin(p, '   ', 'bin_2')), /A bin needs a name/)
  assert.match(error(createBin(p, 'interviews', 'bin_2')), /already a bin called “Interviews” \(bin_1\)/)
  assert.match(error(createBin(p, 'x'.repeat(81), 'bin_2')), /81 characters; a bin's name can be up to 80/)
  assert.match(error(renameBin(p, 'bin_9', 'X')), /No bin has the id "bin_9"\. The bins are: “Interviews” \(bin_1\)\./)
  assert.match(error(renameBin(p, 'bin_1', 'Interviews')), /already called “Interviews”/)
  assert.match(error(removeBin(p, 'bin_9')), /No bin has the id "bin_9"/)
  assert.match(error(moveAssetsToBin(p, ['a'], 'bin_9')), /No bin has the id "bin_9"\. The bins are/)
  assert.match(error(moveAssetsToBin(p, ['a', 'zzz'], 'bin_1')), /No asset has the id "zzz"\. Nothing was moved\./)
  assert.match(error(moveAssetsToBin(p, [], 'bin_1')), /Name at least one asset/)
  assert.equal(JSON.stringify(p), before)

  // The pairs: the nearest legal call to each.
  assert.ok('bin' in createBin(p, 'Interviews 2', 'bin_2'))
  assert.ok('bin' in renameBin(p, 'bin_1', 'INTERVIEWS'), 'a bin may change the case of its own name')
  assert.ok('moved' in moveAssetsToBin(p, ['a'], 'bin_2'))
})

test('a bin is found by id first, then by name whatever its case', () => {
  const p = project()
  createBin(p, 'B-Roll', 'bin_1')
  createBin(p, 'bin_1', 'bin_2') // a bin *named* like another's id: the id wins
  assert.equal(findBin(p, 'bin_1')?.name, 'B-Roll')
  assert.equal(findBin(p, ' b-roll ')?.id, 'bin_1')
  assert.equal(findBin(p, 'music'), undefined)
})

test('the pool lists every bin in the order made, then what is in none — and a stray bin id is in none', () => {
  const p = project()
  createBin(p, 'First', 'bin_1')
  createBin(p, 'Empty', 'bin_2')
  p.assets = [asset('a', 'bin_1'), asset('b'), asset('c', 'bin_gone'), asset('d', 'bin_1')]
  assert.deepEqual(
    groupByBin(p, p.assets).map((group) => [group.bin?.name ?? null, group.assets.map((item) => item.id)]),
    [['First', ['a', 'd']], ['Empty', []], [null, ['b', 'c']]]
  )
  assert.equal(binOf(p, p.assets[2]!), null)
  // With no bins there is one group: the pool as it always was.
  assert.deepEqual(groupByBin({}, p.assets).map((group) => [group.bin, group.assets.length]), [[null, 4]])
  // The stray id is cleared the next time bins are edited, not before: reading must not write.
  assert.equal(p.assets[2]!.binId, 'bin_gone')
  moveAssetsToBin(p, ['b'], 'bin_2')
  assert.equal('binId' in p.assets[2]!, false)
})
