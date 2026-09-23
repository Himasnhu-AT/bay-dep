/**
 * Today's writer still emits every key a version-1 `.bay` file has — checked against the store
 * itself, not against an object this test builds.
 *
 * This is the half of the additive-only rule that a loader test cannot see. Rename
 * `durationInFrames` to `duration` across the codebase and every load test still passes: the
 * loader carries the old key through untouched, and the round trip reads back what it wrote.
 * What breaks is every *older* build of version 1 that opens a file this build saved, and every
 * file on disk that this build now reads a field from which is not there. So the writer has to
 * be the one under test, and the store's `emptyProject`/`placeAsset` are where the project,
 * timeline, track, item and layout records are actually minted.
 *
 * Assets are not covered here: they are minted in main by `media/import.ts`, which imports
 * Electron and so cannot run under `pnpm test`. The loader-side fixture test still pins their
 * keys on the way in.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset } from '@shared/project'
import { V1_ON_DISK } from '@shared/project-fixtures'
import { useEditor, emptyProject } from './editor'

/** Every key path in a JSON value, arrays collapsed to `[]` so element order does not matter. */
function keyPaths(value: unknown, prefix = ''): Set<string> {
  const out = new Set<string>()
  const walk = (node: unknown, at: string): void => {
    if (Array.isArray(node)) {
      for (const element of node) walk(element, `${at}[]`)
      return
    }
    if (node === null || typeof node !== 'object') return
    for (const [key, child] of Object.entries(node)) {
      const path = at ? `${at}.${key}` : key
      out.add(path)
      walk(child, path)
    }
  }
  walk(value, prefix)
  return out
}

test('the key-path walk sees nested keys inside arrays', () => {
  // The instrument first: a walk that stopped at arrays would pass the real test vacuously,
  // since every key that matters sits under `timelines[]`.
  const paths = keyPaths(JSON.parse(V1_ON_DISK))
  assert.ok(paths.has('timelines[].tracks[].items[].layout.opacity'))
  assert.ok(paths.has('timelines[].tracks[].items[].durationInFrames'))
})

test('a project the store writes today carries every key of the version-1 document', () => {
  const onDisk = keyPaths(JSON.parse(V1_ON_DISK))

  // An asset, so `placeAsset` has something to place. Its own keys are not what is under test
  // (see the header), so it is built here and its paths are excluded below.
  const asset: Asset = {
    id: 'asset_writer',
    kind: 'video',
    name: 'clip.mp4',
    path: '/footage/clip.mp4',
    durationUs: 5_000_000,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    hasVideo: true,
    posterPath: null,
    waveformPath: null,
    createdAt: 1
  }
  useEditor.getState().setProject(emptyProject())
  useEditor.getState().addAssets([asset])
  const itemId = useEditor.getState().placeAsset(asset.id, 0)
  assert.ok(itemId, 'the store must place the asset, or there is no item to check')

  // Through JSON, exactly as `writeProjectFile` serialises it: a key holding `undefined` is not
  // written, and must not count as emitted.
  const written = keyPaths(JSON.parse(JSON.stringify(useEditor.getState().project)))
  const missing = [...onDisk].filter((path) => !path.startsWith('assets') && !written.has(path))
  assert.deepEqual(
    missing,
    [],
    `Today's store no longer writes ${missing.join(', ')}. Files already on disk carry these ` +
      `keys and older builds read them. Renaming or removing a persisted field needs a ` +
      `PROJECT_VERSION bump and a migration (src/main/project/migrations.ts), not a refactor.`
  )
})
