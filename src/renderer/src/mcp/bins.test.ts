/**
 * Bins through the store and through `organize_assets` / `browse_assets`, and what they are on
 * disk. The on-disk half uses a literal document (CLAUDE.md, persisted data): `bins` and `binId`
 * are key names in users' `.bay` files from the day this ships.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Project } from '@shared/project'
import { useEditor, emptyProject, newId, type EditorStore } from '@/store/editor'
import { executeToolCall } from './index'

const asset = (id: string, name: string): Asset => ({
  id, kind: 'video', name, path: `/footage/${name}`, durationUs: 5_000_000, width: 1920, height: 1080, fps: 30,
  hasAudio: true, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 1
})

function load(extra: Partial<Project> = {}): void {
  const project: Project = { ...emptyProject(), assets: [asset('ast_a', 'interview.mp4'), asset('ast_b', 'broll.mp4'), asset('ast_c', 'song.mp3')], ...extra }
  useEditor.getState().enterProject(project)
}
const state = (): EditorStore => useEditor.getState()
const call = (tool: string, args: Record<string, unknown>) => executeToolCall({ id: newId('call'), tool, args })
const value = <T,>(result: Awaited<ReturnType<typeof call>>): T => {
  assert.ok(result.ok, result.ok ? '' : result.error)
  return result.value as T
}
const errorOf = (result: Awaited<ReturnType<typeof call>>): string => (result.ok ? `not refused: ${JSON.stringify(result.value)}` : result.error)

test('a project that never had a bin is written without the keys, before and after bins come and go', () => {
  load()
  const before = JSON.stringify({ ...state().project, updatedAt: 0 })
  assert.doesNotMatch(before, /"bins"|"binId"/)
  const made = state().createBin('Interviews')
  assert.ok('bin' in made)
  state().moveAssetsToBin(['ast_a'], made.bin.id)
  assert.match(JSON.stringify(state().project), /"bins":\[\{"id":"bin_[^"]+","name":"Interviews"\}\]/)
  assert.match(JSON.stringify(state().project), /"binId":"bin_/)
  state().removeBin(made.bin.id)
  assert.equal(JSON.stringify({ ...state().project, updatedAt: 0 }), before)
})

test('bins on disk load field for field — these key names are a promise to saved files', () => {
  // As a `.bay` holds them, spelled out; not built from the type, which a rename would follow.
  const onDisk = JSON.parse(`{
    "bins": [{ "id": "bin_fixed", "name": "Interviews" }, { "id": "bin_empty", "name": "Music" }],
    "assets": [
      { "id": "ast_a", "kind": "video", "name": "interview.mp4", "path": "/footage/interview.mp4", "durationUs": 5000000, "width": 1920, "height": 1080, "createdAt": 1, "binId": "bin_fixed" },
      { "id": "ast_b", "kind": "video", "name": "broll.mp4", "path": "/footage/broll.mp4", "durationUs": 5000000, "width": 1920, "height": 1080, "createdAt": 1 }
    ]
  }`) as Pick<Project, 'bins' | 'assets'>
  load(onDisk)
  const listed = state().project
  assert.deepEqual(listed.bins, [{ id: 'bin_fixed', name: 'Interviews' }, { id: 'bin_empty', name: 'Music' }])
  assert.equal(listed.assets[0]!.binId, 'bin_fixed')
  // And today's writer still emits every key the literal has.
  const written = JSON.parse(JSON.stringify(listed)) as Record<string, unknown>
  assert.deepEqual(written.bins, onDisk.bins)
  assert.equal((written.assets as { binId?: string }[])[0]!.binId, 'bin_fixed')
})

test('each bin action is one undo step, and a refused one is none', () => {
  load()
  const steps = (): number => state().past.length
  let at = steps()
  const made = state().createBin('Interviews')
  assert.ok('bin' in made)
  assert.equal(steps() - at, 1)
  at = steps()
  assert.ok('error' in state().createBin('interviews'))
  assert.ok('error' in state().renameBin(made.bin.id, 'Interviews'))
  assert.ok('error' in state().moveAssetsToBin(['ast_zzz'], made.bin.id))
  assert.ok('error' in state().removeBin('bin_nope'))
  assert.equal(steps() - at, 0)
  state().moveAssetsToBin(['ast_a', 'ast_b'], made.bin.id)
  state().renameBin(made.bin.id, 'Talking heads')
  state().removeBin(made.bin.id)
  assert.equal(steps() - at, 3)
  state().undo()
  assert.deepEqual(state().project.bins, [{ id: made.bin.id, name: 'Talking heads' }])
  assert.deepEqual(state().project.assets.map((item) => item.binId), [made.bin.id, made.bin.id, undefined])
})

test('organize_assets files assets by a new name — the bin and the move are one step — and browse_assets shows it', async () => {
  load()
  const browsedBefore = value<{ bins?: unknown; assets: { bin?: unknown }[] }>(await call('browse_assets', {}))
  assert.equal('bins' in browsedBefore, false, 'a pool with no bins reads exactly as it did')
  assert.ok(browsedBefore.assets.every((item) => !('bin' in item)))

  const past = state().past.length
  const filed = value<{ moved: string[]; bin: { id: string; name: string }; createdBin?: boolean; bins: { name: string; assetIds: string[] }[] }>(
    await call('organize_assets', { assetIds: ['ast_a', 'ast_b'], bin: 'Footage' })
  )
  assert.equal(state().past.length - past, 1)
  assert.deepEqual(filed.moved, ['ast_a', 'ast_b'])
  assert.equal(filed.createdBin, true)
  assert.deepEqual(filed.bins, [{ id: filed.bin.id, name: 'Footage', assetIds: ['ast_a', 'ast_b'] }])

  // By name again, whatever the case: the same bin, not a second one.
  const again = value<{ moved: string[]; createdBin?: boolean }>(await call('organize_assets', { assetIds: ['ast_c'], bin: 'footage' }))
  assert.deepEqual(again.moved, ['ast_c'])
  assert.equal(again.createdBin, undefined)
  assert.equal(state().project.bins?.length, 1)

  const browsed = value<{ bins: { id: string; name: string; assetCount: number }[]; assets: { id: string; bin: { name: string } | null }[] }>(await call('browse_assets', {}))
  assert.deepEqual(browsed.bins, [{ id: filed.bin.id, name: 'Footage', assetCount: 3 }])
  assert.deepEqual(browsed.assets.map((item) => item.bin?.name), ['Footage', 'Footage', 'Footage'])

  const out = value<{ moved: string[]; bin: null }>(await call('organize_assets', { assetIds: ['ast_c'], toTopOfPool: true }))
  assert.deepEqual([out.moved, out.bin], [['ast_c'], null])
  const after = value<{ assets: { id: string; bin: unknown }[] }>(await call('browse_assets', {}))
  assert.equal(after.assets[2]!.bin, null, 'in a pool with bins, an unfiled asset says so')
})

test('organize_assets makes, renames and removes a bin; removing keeps the media', async () => {
  load()
  const made = value<{ created: { id: string; name: string } }>(await call('organize_assets', { bin: 'Music' }))
  assert.equal(made.created.name, 'Music')
  await call('organize_assets', { assetIds: ['ast_c'], bin: made.created.id })
  const renamed = value<{ renamed: { was: string; name: string } }>(await call('organize_assets', { renameBin: { bin: 'music', name: 'Score' } }))
  assert.deepEqual([renamed.renamed.was, renamed.renamed.name], ['Music', 'Score'])
  const removed = value<{ backAtTopOfPool: string[]; bins: unknown[] }>(await call('organize_assets', { removeBin: 'Score' }))
  assert.deepEqual(removed.backAtTopOfPool, ['ast_c'])
  assert.deepEqual(removed.bins, [])
  assert.equal(state().project.assets.length, 3)
})

test('organize_assets refuses with what would work next', async () => {
  load()
  await call('organize_assets', { bin: 'Music' })
  const snapshot = JSON.stringify(state().project)
  assert.match(errorOf(await call('organize_assets', {})), /Nothing to do: pass assetIds with bin/)
  assert.match(errorOf(await call('organize_assets', { removeBin: 'Music', bin: 'Other' })), /One thing per call/)
  assert.match(errorOf(await call('organize_assets', { bin: 'music' })), /already a bin called “Music”.*Pass assetIds with it/)
  assert.match(errorOf(await call('organize_assets', { removeBin: 'Voice' })), /No bin is called or has the id "Voice"\. The bins are: “Music” \(bin_/)
  assert.match(errorOf(await call('organize_assets', { assetIds: ['ast_a'] })), /Say where the assets go/)
  assert.match(errorOf(await call('organize_assets', { assetIds: ['ast_a'], bin: 'Music', toTopOfPool: true })), /two different places/)
  assert.match(errorOf(await call('organize_assets', { assetIds: ['ast_a'], toTopOfPool: true })), /That asset is not in any bin\. Nothing was moved\./)
  assert.equal(errorOf(await call('organize_assets', { assetIds: ['ast_nope'], bin: 'Music' })).startsWith('not refused'), false)
  assert.equal(JSON.stringify(state().project), snapshot, 'a refusal changes nothing')
  // The pair: the nearest legal call.
  value(await call('organize_assets', { assetIds: ['ast_a'], bin: 'Music' }))
  assert.match(errorOf(await call('organize_assets', { assetIds: ['ast_a'], bin: 'Music' })), /already in “Music”\. Nothing was moved\./)
})

test('a dry run files nothing and makes no bin', async () => {
  load()
  const before = JSON.stringify(state().project)
  const dry = await call('organize_assets', { assetIds: ['ast_a'], bin: 'Footage', validateOnly: true })
  assert.ok(dry.ok)
  assert.equal(JSON.stringify(state().project), before)
})
