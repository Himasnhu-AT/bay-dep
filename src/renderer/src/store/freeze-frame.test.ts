/**
 * Freeze Frame through the store and the renderer's half of the grab: the whole insert (asset and
 * timeline) is one undo step, a refusal changes nothing, and the time asked of main is the
 * compositor's own seek for that frame.
 *
 * The planner is tested in `@shared/freeze-frame.test.ts`, the grab against the real ffmpeg in
 * `main/media/frame-grab.test.ts`. The command's round trip through main (IPC, import) needs the
 * app and is not covered here.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeTimeline, type Asset, type Item } from '@shared/project'
import { sourceSecondsAt, FRAME_EDGE_SECONDS } from '@/engine/sync'
import { freezeRequest } from '@/lib/freezeFrame'
import { emptyProject, useEditor } from './editor'

function shot(): Asset {
  return {
    id: 'shot', kind: 'video', name: 'shot.mp4', path: '/m/shot.mp4', durationUs: 10_000_000, width: 1920,
    height: 1080, fps: 30, hasAudio: true, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 0
  }
}

const STILL: Asset = {
  id: 'ast_still', kind: 'image', name: 'Freeze · shot.mp4', path: '/g/freeze.png', durationUs: 0, width: 1920,
  height: 1080, fps: null, hasAudio: false, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 0
}

function clip(id: string, trackId: string, from: number, duration: number, over: Partial<Item> = {}): Item {
  return {
    id, assetId: 'shot', trackId, from, durationInFrames: duration, sourceStartUs: 2_000_000,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...over
  }
}

function load(): { video: string; audio: string } {
  const project = emptyProject()
  project.assets = [shot()]
  const timeline = project.timelines[0]!
  const video = timeline.tracks.find((t) => t.kind === 'video')!
  const audio = timeline.tracks.find((t) => t.kind === 'audio')!
  video.items = [clip('A', video.id, 0, 90), clip('B', video.id, 90, 60)]
  audio.items = [clip('S', audio.id, 0, 150)]
  useEditor.getState().setProject(project)
  return { video: video.id, audio: audio.id }
}

const timeline = () => activeTimeline(useEditor.getState().project)!

test('a freeze is one undo step that adds the still and opens every track; undo takes both back', () => {
  load()
  const before = useEditor.getState().project
  const past = useEditor.getState().past.length
  const result = useEditor.getState().insertFreezeFrame({ itemId: 'A', frame: 45, frames: 60, still: STILL })
  assert.ok(!('error' in result), JSON.stringify(result))
  assert.equal(useEditor.getState().past.length, past + 1, 'one undo step')
  assert.ok(useEditor.getState().project.assets.some((a) => a.id === STILL.id), 'the still is in the pool')
  assert.deepEqual(useEditor.getState().selection, [result.freezeItemId], 'the hold is selected')
  const spans = (kind: 'video' | 'audio') =>
    timeline().tracks.find((t) => t.kind === kind)!.items.map((i) => [i.assetId, i.from, i.durationInFrames])
  assert.deepEqual(spans('video'), [['shot', 0, 45], ['ast_still', 45, 60], ['shot', 105, 45], ['shot', 150, 60]])
  // The sound on the other track opened by the same 60 frames: sync is kept, the hold is silent.
  assert.deepEqual(spans('audio'), [['shot', 0, 45], ['shot', 105, 105]])

  useEditor.getState().undo()
  assert.equal(JSON.stringify(useEditor.getState().project.timelines), JSON.stringify(before.timelines))
  assert.ok(!useEditor.getState().project.assets.some((a) => a.id === STILL.id), 'undo removes the still too')
})

test('a refusal changes nothing and leaves no undo step; the same freeze on an unlocked timeline goes in', () => {
  const { audio } = load()
  useEditor.getState().patchTrack(audio, { locked: true })
  const past = useEditor.getState().past.length
  const refused = useEditor.getState().insertFreezeFrame({ itemId: 'A', frame: 45, frames: 60, still: STILL })
  assert.ok('error' in refused)
  assert.match(refused.error, /A1 is locked with clips there/)
  assert.equal(useEditor.getState().past.length, past)
  assert.ok(!useEditor.getState().project.assets.some((a) => a.id === STILL.id))
  // Positive control.
  useEditor.getState().patchTrack(audio, { locked: false })
  assert.ok(!('error' in useEditor.getState().insertFreezeFrame({ itemId: 'A', frame: 45, frames: 60, still: STILL })))
})

test('the time asked of main is the compositor\'s seek at that frame: in-point, slip, speed and the frame edge', () => {
  const asset = shot()
  // 2 s in, at 2×: frame 15 of the clip is 0.5 s of timeline, so 1 s of source past the in-point.
  const item = clip('K', 'v', 100, 60, { speed: 2 })
  const request = freezeRequest(item, asset, 115, 30)
  assert.ok(request)
  assert.equal(request.path, asset.path)
  assert.ok(Math.abs(request.seconds - (3 + FRAME_EDGE_SECONDS)) < 1e-9, `${request.seconds}`)
  // The same function the compositor seeks with, including its clamp inside the source.
  assert.equal(request.seconds, sourceSecondsAt(item, asset, 115, 30))
  const late = freezeRequest({ ...item, sourceStartUs: 9_900_000 }, asset, 159, 30)!
  assert.ok(late.seconds < 10, `clamped inside the 10 s source: ${late.seconds}`)
  // A slip moves the grab by exactly the slip.
  const slipped = freezeRequest({ ...item, sourceStartUs: 2_500_000 }, asset, 115, 30)!
  assert.ok(Math.abs(slipped.seconds - request.seconds - 0.5) < 1e-9)
  // No file, no request.
  assert.equal(freezeRequest(item, { ...asset, path: null }, 115, 30), null)
})
