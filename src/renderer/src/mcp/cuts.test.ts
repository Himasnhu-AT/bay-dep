/**
 * `detect_cuts` through the executor, with main's detector stood in by the cuts it would return.
 * What is held still: cuts come back as timeline frames mapped through *this clip* (its position,
 * in-point and speed), a cut at the clip's own first frame is not reported as one inside it, the
 * file form lists every placement, and each refusal says what to do instead. The detector itself
 * is `src/main/media/scene-cuts.test.ts`, against the real ffmpeg.
 */

import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project } from '@shared/project'
import { emptyProject, useEditor } from '@/store/editor'
import { executeToolCall } from './index'
import { cutsOnItem, detectCuts } from './cuts'

/** Shots change at 2 s, 5 s and 9 s of the file. */
const CUTS = [
  { us: 2_000_000, score: 40 },
  { us: 5_000_000, score: 12.5 },
  { us: 9_000_000, score: 55 }
]
const asked: { path: string; threshold: number | undefined }[] = []
;(globalThis as { window?: unknown }).window = {
  bay: {
    media: {
      cuts: async (path: string, options?: { threshold?: number }) => {
        asked.push({ path, threshold: options?.threshold })
        return { ok: true, cuts: CUTS }
      }
    }
  }
}

const asset = (id: string, extra: Partial<Asset>): Asset => ({
  id,
  kind: 'video',
  name: `${id}.mov`,
  path: `/footage/${id}.mov`,
  durationUs: 12_000_000,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio: true,
  hasVideo: true,
  posterPath: null,
  waveformPath: null,
  createdAt: 0,
  ...extra
})

const item = (id: string, assetId: string, extra: Partial<Item>): Item => ({
  id,
  assetId,
  trackId: 'v1',
  from: 0,
  durationInFrames: 60,
  sourceStartUs: 0,
  layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
  volume: 1,
  fadeInFrames: 0,
  fadeOutFrames: 0,
  speed: 1,
  ...extra
})

/** Enters at frame 100, from 1.0 s of the file, for 6 s (to 7 s): plays the 2 s and 5 s cuts. */
const TAKE = item('clip_take', 'take', { from: 100, durationInFrames: 180, sourceStartUs: 1_000_000 })
/** Starts exactly on the 5 s cut and runs to 8 s: that cut is its own head, not a cut inside it. */
const SECOND = item('clip_second', 'take', { from: 400, durationInFrames: 90, sourceStartUs: 5_000_000 })

beforeEach(() => {
  asked.length = 0
  const base = emptyProject()
  const project: Project = {
    ...base,
    assets: [asset('take', {}), asset('song', { kind: 'audio', hasVideo: false, width: null, height: null })],
    timelines: base.timelines.map((timeline) => ({
      ...timeline,
      fps: 30,
      tracks: [
        { id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items: [TAKE, SECOND] },
        { id: 'a1', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items: [item('clip_song', 'song', { trackId: 'a1' })] }
      ]
    }))
  }
  useEditor.getState().enterProject(project)
})

const run = (tool: string, args: Record<string, unknown>) => executeToolCall({ id: 't', tool, args })

test('cuts come back as timeline frames through the clip’s position and in-point', async () => {
  const result = await run('detect_cuts', { itemId: 'clip_take' })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const value = result.value as { cuts: { frame: number; seconds: number; score: number }[]; cutsInFile: number }
  // 2 s of the file is 1 s into the clip → frame 130; 5 s → 4 s in → frame 220. 9 s is past its end.
  assert.deepEqual(value.cuts, [
    { frame: 130, seconds: 2, score: 40 },
    { frame: 220, seconds: 5, score: 12.5 }
  ])
  assert.equal(value.cutsInFile, 3)
  assert.deepEqual(asked, [{ path: '/footage/take.mov', threshold: undefined }])
})

test('a cut on a clip’s first frame is not a cut inside it', async () => {
  const result = await run('detect_cuts', { itemId: 'clip_second', threshold: 20 })
  assert.ok(result.ok, result.ok ? '' : result.error)
  assert.deepEqual((result.value as { cuts: unknown[] }).cuts, [])
  assert.match((result.value as { next: string }).next, /none inside the part this clip plays/)
  assert.equal(asked[0]!.threshold, 20)
})

test('the file form gives seconds, and frames for every placement', async () => {
  const result = await run('detect_cuts', { assetId: 'take' })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const value = result.value as { cuts: { seconds: number }[]; placements: { itemId: string; frames: number[] }[] }
  assert.deepEqual(value.cuts.map((c) => c.seconds), [2, 5, 9])
  assert.deepEqual(value.placements, [
    { itemId: 'clip_take', frames: [130, 220] },
    { itemId: 'clip_second', frames: [] }
  ])
})

test('a cut maps to the first timeline frame of the new shot, not the nearest (30 fps timeline, 24 fps source)', () => {
  // Source frame 37 at 24 fps begins at 1.541667 s. On a 30 fps timeline, frame 46 shows 1.5333 s —
  // still the old shot — and frame 47 shows 1.5667 s, the first picture of the new one. Nearest
  // rounds 46.25 to 46 and puts the split one frame early.
  const clip = item('c', 'take', { from: 0, durationInFrames: 300, sourceStartUs: 0 })
  const cutUs = Math.round((37 / 24) * 1_000_000)
  const [cut] = cutsOnItem([{ us: cutUs, score: 50 }], clip, 30)
  assert.equal(cut?.frame, 47)
  assert.ok(((cut!.frame - 1) / 30) * 1_000_000 < cutUs, 'the frame before shows the old shot')
  assert.ok((cut!.frame / 30) * 1_000_000 >= cutUs - 1, 'this frame shows the new one')
  // Positive control: a cut exactly on a timeline frame stays on it, not the frame after.
  assert.deepEqual(cutsOnItem([{ us: 2_000_000, score: 50 }], clip, 30).map((c) => c.frame), [60])
  // And a cut the clip's last frame cannot show (it would start after the clip ends) is dropped.
  const short = item('s', 'take', { from: 0, durationInFrames: 46, sourceStartUs: 0 })
  assert.deepEqual(cutsOnItem([{ us: cutUs, score: 50 }], short, 30), [])
})

test('the threshold reported is the one scdet ran with, clamped to 1–100', async () => {
  // The handler itself: the catalog schema refuses 250 before it, but the schema is one entry
  // path, and main clamps whatever reaches it — the report must say what actually ran.
  assert.equal((await detectCuts({ itemId: 'clip_take', threshold: 250 })).threshold, 100)
  assert.equal((await detectCuts({ itemId: 'clip_take', threshold: 0.2 })).threshold, 1)
  // Positive control: an in-range threshold is reported as given, and none as the default.
  assert.equal((await detectCuts({ itemId: 'clip_take', threshold: 27 })).threshold, 27)
  assert.equal((await detectCuts({ itemId: 'clip_take' })).threshold, 10)
})

test('refusals say what to pass instead', async () => {
  const none = await run('detect_cuts', {})
  assert.equal(none.ok, false)
  assert.match(none.ok ? '' : none.error, /itemId .* or assetId/)
  const audio = await run('detect_cuts', { itemId: 'clip_song' })
  assert.equal(audio.ok, false)
  assert.match(audio.ok ? '' : audio.error, /not a video/)
  assert.equal(asked.length, 0, 'a refused call must not start a detection')
})
