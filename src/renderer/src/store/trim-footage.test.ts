/**
 * A trim handle cannot pull a clip's tail past the end of its footage — past it the clip would
 * hold its last frame. The head already stopped at source 0; the tail did not, while the
 * inspector's Duration field did, so the two disagreed. A still has no end and stays unlimited.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset } from '@shared/project'

const base = { path: '/m.mp4', width: 1280, height: 720, fps: 30, hasAudio: false, posterPath: null, waveformPath: null, createdAt: 0 }

test('dragging a video clip’s end past its footage stops at the footage; a still keeps going', async () => {
  const { useEditor, emptyProject } = await import('./editor')
  const s = () => useEditor.getState()
  s().setProject(emptyProject(), { resetHistory: true })
  const video: Asset = { ...base, id: 'ast_v', kind: 'video', name: 'five.mp4', durationUs: 5_000_000, hasVideo: true }
  const still: Asset = { ...base, id: 'ast_s', kind: 'image', name: 'still.png', path: '/s.png', durationUs: 0, fps: null, hasVideo: true }
  s().addAssets([video, still])
  const v = s().placeAsset('ast_v', 0)
  assert.ok(v)
  const clip = () => s().project.timelines[0]!.tracks.flatMap((t) => t.items).find((i) => i.id === v)!
  assert.equal(clip().durationInFrames, 150, 'placed at the full 5 s')

  s().trimItem(v, 'end', 190)
  assert.equal(clip().durationInFrames, 150, 'a +40f drag past the footage stays at 150f')
  s().trimItem(v, 'end', 120)
  assert.equal(clip().durationInFrames, 120, 'shortening still works')
  s().trimItem(v, 'end', 190)
  assert.equal(clip().durationInFrames, 150, 'and extending back stops at the footage again')

  const st = s().placeAsset('ast_s', 400)
  assert.ok(st)
  const stillClip = () => s().project.timelines[0]!.tracks.flatMap((t) => t.items).find((i) => i.id === st)!
  const before = stillClip().durationInFrames
  s().trimItem(st, 'end', stillClip().from + before + 60)
  assert.equal(stillClip().durationInFrames, before + 60, 'a still has no end of footage')
})
