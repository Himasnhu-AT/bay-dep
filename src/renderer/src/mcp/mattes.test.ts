/**
 * `put_behind_subject` through the executor: what it asks main for, what it records, what it
 * arranges in one undo step — and each refusal carrying what to do instead, beside the nearest
 * call that succeeds. Main's matte is a stub here; the real one is `main/matte/matte.test.ts`,
 * and the pixels are `engine/subjectMask.test.ts` and `test/app/mask.mjs`.
 */

import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project } from '@shared/project'
import type { SubjectMatteRequest, SubjectMatteResult } from '@shared/matte'
import { emptyProject, useEditor } from '@/store/editor'
import { executeToolCall } from './index'

const asked: SubjectMatteRequest[] = []
const found = (request: SubjectMatteRequest): SubjectMatteResult => ({
  ok: true,
  matte: { key: 'f'.repeat(32), fromUs: request.fromUs, toUs: request.toUs, engine: 'apple-vision-person-balanced', frames: 90, width: 512, height: 384 },
  report: { cached: false, frames: 90, coverage: 0.97, meanArea: 0.3, msPerFrame: 11, visionMsMedian: 9, visionMsP90: 10, bytes: 800_000, megabytesPerMinute: 15, engineBuild: 'Version 26.6.2', seconds: 1 }
})
let answer: (request: SubjectMatteRequest) => SubjectMatteResult = found
;(globalThis as { window?: unknown }).window = {
  bay: {
    media: {
      subjectMatte: async (request: SubjectMatteRequest) => {
        asked.push(request)
        return answer(request)
      }
    }
  }
}

const asset = (id: string, extra: Partial<Asset>): Asset => ({
  id, kind: 'video', name: `${id}.mp4`, path: `/footage/${id}.mp4`, durationUs: 60_000_000, width: 1920, height: 1080, fps: 30,
  hasAudio: true, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 0, ...extra
})
const item = (id: string, assetId: string, trackId: string, extra: Partial<Item>): Item => ({
  id, assetId, trackId, from: 0, durationInFrames: 90, sourceStartUs: 0,
  layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
  volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...extra
})

beforeEach(() => {
  asked.length = 0
  answer = found
  const base = emptyProject()
  const project: Project = {
    ...base,
    assets: [
      asset('talk', {}),
      asset('title', { kind: 'text', path: null, text: 'HELLO', hasAudio: false, hasVideo: false, width: null, height: null, fps: null, durationUs: 0 }),
      asset('logo', { kind: 'image', path: '/footage/logo.png', hasAudio: false, durationUs: 0 })
    ],
    timelines: base.timelines.map((timeline) => ({
      ...timeline,
      fps: 30,
      tracks: [
        { id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items: [item('clip', 'talk', 'v1', { from: 30, durationInFrames: 120, sourceStartUs: 4_000_000 })] },
        { id: 'v2', kind: 'video', name: 'V2', locked: false, muted: false, hidden: false, items: [item('words', 'title', 'v2', { from: 60, durationInFrames: 60 }), item('late', 'title', 'v2', { from: 400, durationInFrames: 30 })] },
        { id: 'a1', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items: [] }
      ]
    }))
  }
  useEditor.getState().enterProject(project)
})

const run = (args: Record<string, unknown>) => executeToolCall({ id: 't', tool: 'put_behind_subject', args })

async function refusal(args: Record<string, unknown>): Promise<string> {
  const result = await run(args)
  assert.equal(result.ok, false, `expected ${JSON.stringify(args)} to be refused`)
  return result.ok ? '' : result.error
}

test('it asks main for the matte of exactly the source the clip plays, records it silently, and arranges in one undo step', async () => {
  const past = useEditor.getState().past.length
  const result = await run({ textItemId: 'words', videoItemId: 'clip' })
  assert.ok(result.ok, result.ok ? '' : result.error)
  // 120 frames at 30 fps from a 4 s in-point: 4 s to 8 s, one source frame (33 ms) either side.
  assert.deepEqual(asked, [{ path: '/footage/talk.mp4', fromUs: 3_966_667, toUs: 8_033_333 }])
  const state = useEditor.getState()
  assert.equal(state.past.length, past + 1, 'one undo step for the arrangement; recording the matte is not one')
  const talk = state.project.assets.find((a) => a.id === 'talk')
  assert.equal(talk?.subjectMattes?.[0]?.key, 'f'.repeat(32))
  const value = result.value as { cutoutItemId: string; placed: string; next: string; matte: { personInFrames: string } }
  const tl = state.project.timelines[0]!
  const names = tl.tracks.map((t) => [t.name, t.items.map((i) => i.id)])
  assert.deepEqual(names.slice(0, 3), [['V1', ['clip']], ['V2', ['words', 'late']], [names[2]![0], [value.cutoutItemId]]])
  assert.match(value.placed, /V1: the clip clip \(unchanged\)\. V2: the title words\. V\d: .* cut out to the person/)
  assert.match(value.next, /preview_frame/)
  assert.equal(value.matte.personInFrames, '97%')
  // Undo takes the arrangement back in one step.
  state.undo()
  assert.equal(useEditor.getState().project.timelines[0]!.tracks.flatMap((t) => t.items).length, 3)
})

test('not a person-shaped clip: refused with the coverage and what to do; nothing arranged (positive control above)', async () => {
  answer = (request) => ({
    ok: true,
    matte: { key: 'e'.repeat(32), fromUs: request.fromUs, toUs: request.toUs, engine: 'apple-vision-person-balanced', frames: 90, width: 512, height: 384 },
    report: { cached: false, frames: 90, coverage: 0.1, meanArea: 0.01, msPerFrame: 11, visionMsMedian: 9, visionMsP90: 10, bytes: 1, megabytesPerMinute: 1, engineBuild: 'x', seconds: 1 }
  })
  const past = useEditor.getState().past.length
  const error = await refusal({ textItemId: 'words', videoItemId: 'clip' })
  assert.match(error, /not a person-shaped clip: Apple Vision found a person in 10% of its 90 frames \(it needs 50%\)\. Pick a clip/)
  assert.equal(useEditor.getState().past.length, past)
  assert.equal(useEditor.getState().project.assets.find((a) => a.id === 'talk')?.subjectMattes, undefined, 'a refused matte is not recorded')
})

test('the matte failing or Vision missing is refused in words, with nothing changed', async () => {
  answer = () => ({ ok: false, code: 'unavailable', error: 'Apple Vision person segmentation needs macOS 12 or later; this Mac is Version 11.7.' })
  const unavailable = await refusal({ textItemId: 'words', videoItemId: 'clip' })
  assert.match(unavailable, /Apple Vision is not available here.*macOS 12 or later.*title can still go over the clip/)
  answer = () => ({ ok: false, code: 'failed', error: 'The subject matte could not be computed: ffmpeg could not read /footage/talk.mp4: moov atom not found' })
  const failed = await refusal({ textItemId: 'words', videoItemId: 'clip' })
  assert.match(failed, /moov atom not found.*Nothing was changed/)
  assert.equal(useEditor.getState().project.timelines[0]!.tracks.flatMap((t) => t.items).length, 3)
})

test('refusals name the ids and frames a retry needs; the nearest legal call succeeds', async () => {
  // Not a video clip: the candidates under the title are named.
  const notVideo = await refusal({ textItemId: 'words', videoItemId: 'late' })
  assert.match(notVideo, /late is a text .*not a video clip.*Video clips playing under the title: clip\./)
  // Never at the same time.
  const apart = await refusal({ textItemId: 'late', videoItemId: 'clip' })
  assert.match(apart, /frames 400–430.*frames 30–150\) never play at the same time.*edit_item from/)
  // textItemId on something that is not text points at itemId.
  const image = await refusal({ textItemId: 'clip', videoItemId: 'clip' })
  assert.match(image, /same item|not a text item/)
  const noTitle = await refusal({ videoItemId: 'clip' })
  assert.match(noTitle, /textItemId .* or itemId/)
  const feather = await refusal({ textItemId: 'words', videoItemId: 'clip', feather: 999 })
  assert.match(feather, /"feather" must be at most 200, but got 999/)
  assert.equal(asked.length, 0, 'every refusal came before main was asked for anything')
  // The positive control for all of them.
  const ok = await run({ textItemId: 'words', videoItemId: 'clip', feather: 3 })
  assert.ok(ok.ok, ok.ok ? '' : ok.error)
})

test('asked twice, the cut-out is reused rather than stacked', async () => {
  const first = await run({ textItemId: 'words', videoItemId: 'clip' })
  const second = await run({ textItemId: 'words', videoItemId: 'clip' })
  assert.ok(first.ok && second.ok)
  assert.equal((second.value as { cutoutItemId: string }).cutoutItemId, (first.value as { cutoutItemId: string }).cutoutItemId)
  const masked = useEditor.getState().project.timelines[0]!.tracks.flatMap((t) => t.items).filter((i) => i.masks)
  assert.equal(masked.length, 1)
})
