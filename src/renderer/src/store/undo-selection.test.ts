/**
 * Undo and redo keep the selection for every clip that still exists. They used to clear it, so a
 * ⌘Z made in the inspector emptied the inspector. A clip the step removes drops out of the
 * selection — the control that this is filtering, not keeping blindly.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

test('undo keeps a selected clip that survives the step, and drops one that does not', async () => {
  const { useEditor, emptyProject } = await import('./editor')
  const s = () => useEditor.getState()
  s().setProject(emptyProject(), { resetHistory: true })
  s().addAssets([
    {
      id: 'ast_t', kind: 'text', name: 'Title', path: null, durationUs: 0, width: null, height: null, fps: null,
      hasAudio: false, hasVideo: false, posterPath: null, waveformPath: null, text: 'Title', createdAt: 0
    }
  ])
  const itemId = s().placeAsset('ast_t', 0)
  assert.ok(itemId)
  s().patchItem(itemId, { fadeInFrames: 5 })
  s().select([itemId])

  s().undo()
  assert.deepEqual(s().selection, [itemId], 'the fade came off; the clip is still there, still selected')
  s().redo()
  assert.deepEqual(s().selection, [itemId], 'and redo keeps it too')

  s().undo()
  s().undo()
  assert.deepEqual(s().selection, [], 'undoing the placement removes the clip, so it leaves the selection')
})
