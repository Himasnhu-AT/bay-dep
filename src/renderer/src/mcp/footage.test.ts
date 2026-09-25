/**
 * `index_footage` and `search_footage` through the executor, with main's vision service stood in.
 * What is held still: which files are sent (videos with pictures and images, never audio), that
 * the user's "Download models when needed" is what decides a download, that validateOnly only
 * plans, that a missing model is refused with where to get it, and that hits come back mapped onto
 * the timeline through the clips that play them. The service itself is `main/vision/service.test.ts`;
 * the real model is `main/vision/model.test.ts`.
 */

import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project } from '@shared/project'
import { describeJob, VISION_NOT_INSTALLED, type VisionAssetRef, type VisionIndexAnswer, type VisionIndexJob, type VisionSearchAnswer, type VisionSearchRequest, type VisionStatus } from '@shared/visual-search'
import { emptyProject, useEditor } from '@/store/editor'
import { tool as indexFootageTool } from '@shared/tools/index-footage'
import { executeToolCall } from './index'

const JOB: VisionIndexJob = { state: 'running', phase: 'indexing', checking: 0, alreadyIndexed: 0, filesTotal: 2, filesDone: 0, framesDone: 0, current: null, failed: [], startedAt: 0, finishedAt: null }

const calls: { method: string; args: unknown[] }[] = []
let installed = true
let indexAnswer: VisionIndexAnswer
let searchAnswer: VisionSearchAnswer
let jobRunning = false
/** The job status reports when none is running: the last one this session, if any. */
let lastJob: VisionIndexJob | null = null
let planAnswer: VisionIndexAnswer | null = null

const status = (): VisionStatus => ({
  installed,
  modelDir: '/models',
  bytesOnDisk: 0,
  download: null,
  index: jobRunning ? { ...JOB, filesTotal: 3, filesDone: 1, framesDone: 40, current: 'beach.mov' } : lastJob
})

;(globalThis as { window?: unknown }).window = {
  bay: {
    vision: {
      status: async () => status(),
      index: async (assets: VisionAssetRef[], options?: { dryRun?: boolean; download?: boolean }) => {
        calls.push({ method: 'index', args: [assets, options] })
        return options?.dryRun && planAnswer ? planAnswer : indexAnswer
      },
      cancelIndex: async () => {
        calls.push({ method: 'cancelIndex', args: [] })
      },
      search: async (request: VisionSearchRequest) => {
        calls.push({ method: 'search', args: [request] })
        return searchAnswer
      }
    }
  }
}

const asset = (id: string, extra: Partial<Asset> = {}): Asset => ({
  id,
  kind: 'video',
  name: `${id}.mov`,
  path: `/footage/${id}.mov`,
  durationUs: 20_000_000,
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

const PLAN = { files: 2, indexed: 0, toIndex: 2, frames: 11, estimatedSeconds: 1, unavailable: [] }

beforeEach(() => {
  calls.length = 0
  installed = true
  jobRunning = false
  lastJob = null
  planAnswer = null
  indexAnswer = { ok: true, started: true, downloading: false, job: { ...JOB, phase: 'planning', checking: 2, filesTotal: 0 } }
  searchAnswer = { ok: true, hits: [], separation: 0, framesSearched: 0, unindexed: [] }
  useEditor.getState().setAutoDownloadModels(false)
  const base = emptyProject()
  const project: Project = {
    ...base,
    assets: [
      asset('beach'),
      asset('still', { kind: 'image', name: 'still.png', path: '/footage/still.png', durationUs: 0 }),
      asset('song', { kind: 'audio', name: 'song.wav', path: '/footage/song.wav', hasVideo: false, width: null, height: null }),
      asset('title', { kind: 'text', name: 'Title', path: null })
    ],
    timelines: base.timelines.map((timeline) => ({
      ...timeline,
      fps: 30,
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          name: 'V1',
          locked: false,
          muted: false,
          hidden: false,
          // From 4 s of the file at frame 100, for 5 s; and a 2× clip of it from 0 s at frame 300.
          items: [item('clip_a', 'beach', { from: 100, durationInFrames: 150, sourceStartUs: 4_000_000 }), item('clip_fast', 'beach', { from: 300, durationInFrames: 90, speed: 2 })]
        }
      ]
    }))
  }
  useEditor.getState().enterProject(project)
})

const run = (tool: string, args: Record<string, unknown>) => executeToolCall({ id: 't', tool, args })
const sentAssets = (): VisionAssetRef[] => calls.find((c) => c.method === 'index' || c.method === 'search')!.args[0] as VisionAssetRef[]

test('index_footage sends every video and image, never audio or a title, with their lengths', async () => {
  const pastBefore = useEditor.getState().past.length
  const result = await run('index_footage', {})
  assert.ok(result.ok, result.ok ? '' : result.error)
  assert.equal(useEditor.getState().past.length, pastBefore, 'indexing never edits the project')
  assert.deepEqual(sentAssets(), [
    { assetId: 'beach', name: 'beach.mov', path: '/footage/beach.mov', kind: 'video', durationUs: 20_000_000 },
    { assetId: 'still', name: 'still.png', path: '/footage/still.png', kind: 'image', durationUs: 0 }
  ])
  assert.match((result.value as { next: string }).next, /background/)
  assert.match((result.value as { progress: string }).progress, /Checking which files need indexing: 0 of 2 checked/)
})

test('when the model must download first, index_footage answers at once and says so', async () => {
  useEditor.getState().setAutoDownloadModels(true)
  indexAnswer = { ok: true, started: true, downloading: true, job: { ...JOB, phase: 'download', checking: 2, filesTotal: 0 } }
  const result = await run('index_footage', {})
  assert.ok(result.ok, result.ok ? '' : result.error)
  const value = result.value as { started: boolean; downloading: boolean; progress: string; next: string }
  assert.equal(value.downloading, true)
  assert.match(value.progress, /Waiting for the visual search model to download before indexing 2 files\./)
  assert.match(value.next, /downloading first; indexing starts when it arrives\. Call index_footage again/)
  // Positive control: no download, no such sentence.
  indexAnswer = { ok: true, started: true, downloading: false, job: JOB }
  const plain = await run('index_footage', {})
  assert.ok(plain.ok)
  assert.doesNotMatch((plain.value as { next: string }).next, /downloading/)
})

test('index_footage has a deadline sized for its dry run, beyond the default', () => {
  assert.ok((indexFootageTool.timeoutMs ?? 0) >= 60_000, `timeoutMs: ${indexFootageTool.timeoutMs}`)
  assert.match(indexFootageTool.description, /before the model download/)
})

test('an audio asset named for indexing is refused by name; a video beside it is accepted', async () => {
  const refused = await run('index_footage', { assetIds: ['song'] })
  assert.equal(refused.ok, false)
  assert.match(refused.ok ? '' : refused.error, /"song\.wav" is audio.*Only videos and images/)
  const accepted = await run('index_footage', { assetIds: ['beach'] })
  assert.ok(accepted.ok, accepted.ok ? '' : accepted.error)
  assert.deepEqual(sentAssets().map((a) => a.assetId), ['beach'])
})

test('validateOnly asks for a plan only, and reports files, frames and time', async () => {
  indexAnswer = { ok: true, started: false, plan: { ...PLAN, estimatedSeconds: 125, frames: 2000 }, job: null }
  const result = await run('index_footage', { validateOnly: true })
  assert.ok(result.ok, result.ok ? '' : result.error)
  assert.deepEqual((calls[0]!.args[1] as { dryRun: boolean }).dryRun, true)
  const value = result.value as { toIndex: number; frames: number; plan: string; note: string }
  assert.equal(value.toIndex, 2)
  assert.match(value.plan, /2 files to index \(2000 frames, about 2 minutes on this Mac\)/)
  assert.match(value.note, /Nothing was started/)
  // Without the model, a plan still answers — and says where the model comes from.
  installed = false
  const planned = await run('index_footage', { validateOnly: true })
  assert.ok(planned.ok)
  assert.match((planned.value as { note: string }).note, /Settings \(⌘,\) → Visual search/)
})

test('the user’s "Download models when needed" decides whether main may download the model', async () => {
  await run('index_footage', {})
  assert.equal((calls[0]!.args[1] as { download: boolean }).download, false)
  calls.length = 0
  useEditor.getState().setAutoDownloadModels(true)
  await run('index_footage', {})
  assert.equal((calls[0]!.args[1] as { download: boolean }).download, true)
})

test('a missing model is refused with the recovery sentence, not a bare failure', async () => {
  indexAnswer = { ok: false, error: VISION_NOT_INSTALLED }
  const result = await run('index_footage', {})
  assert.equal(result.ok, false)
  assert.equal(result.ok ? '' : result.error, VISION_NOT_INSTALLED)
  searchAnswer = { ok: false, error: VISION_NOT_INSTALLED }
  const search = await run('search_footage', { query: 'a dog on a beach' })
  assert.equal(search.ok ? '' : search.error, VISION_NOT_INSTALLED)
})

test('while a job runs, a bare call reports progress instead of starting another', async () => {
  jobRunning = true
  const result = await run('index_footage', {})
  assert.ok(result.ok)
  assert.equal(calls.length, 0)
  assert.match((result.value as { progress: string }).progress, /Indexing beach\.mov — 1 of 3 files, 40 frames/)
  const cancel = await run('index_footage', { cancel: true })
  assert.ok(cancel.ok)
  assert.deepEqual(calls.map((c) => c.method), ['cancelIndex'])
})

test('hits come back with the file time and the timeline frame of every clip that plays it', async () => {
  searchAnswer = {
    ok: true,
    hits: [
      { assetId: 'beach', us: 5_000_000, score: 0.12 },
      { assetId: 'still', us: 0, score: 0.08 },
      { assetId: 'beach', us: 16_000_000, score: 0.05 }
    ],
    separation: 0.09,
    framesSearched: 11,
    unindexed: []
  }
  const result = await run('search_footage', { query: 'a dog on a beach', limit: 3 })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const request = calls[0]!.args[0] as VisionSearchRequest
  assert.equal(request.query, 'a dog on a beach')
  assert.equal(request.limit, 3)
  const hits = (result.value as { hits: { asset: string; seconds: number; onTimeline?: { itemId: string; frame: number }[] }[] }).hits
  // 5 s of the file: clip_a (from 4 s at frame 100) → 1 s in → frame 130; clip_fast at 2× → 2.5 s in → frame 375.
  assert.deepEqual(hits[0], { rank: 1, assetId: 'beach', asset: 'beach.mov', seconds: 5, us: 5_000_000, score: 0.12, onTimeline: [{ itemId: 'clip_a', frame: 130 }, { itemId: 'clip_fast', frame: 375 }] })
  // An image not on the timeline has no frames; 16 s is past both clips (clip_fast plays 0–6 s).
  assert.equal(hits[1]!.onTimeline, undefined)
  assert.equal(hits[2]!.onTimeline, undefined)
})

test('a hit is placed on clips that show the picture, never on the same file\'s sound on an audio track', async () => {
  // clip_a's sound, detached onto an audio track: same asset, same span, no picture.
  const state = useEditor.getState()
  const tl = state.project.timelines[0]!
  useEditor.getState().enterProject({
    ...state.project,
    timelines: [
      {
        ...tl,
        tracks: [
          ...tl.tracks,
          { id: 'a1', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items: [item('clip_a_sound', 'beach', { trackId: 'a1', from: 100, durationInFrames: 150, sourceStartUs: 4_000_000 })] }
        ]
      },
      ...state.project.timelines.slice(1)
    ]
  })
  searchAnswer = { ok: true, hits: [{ assetId: 'beach', us: 5_000_000, score: 0.12 }], separation: 0.09, framesSearched: 11, unindexed: [] }
  const result = await run('search_footage', { query: 'a dog on a beach' })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const placements = (result.value as { hits: { onTimeline?: { itemId: string }[] }[] }).hits[0]!.onTimeline!.map((p) => p.itemId)
  assert.deepEqual(placements, ['clip_a', 'clip_fast'])
})

test('similarTo sends the asset and the moment in microseconds; a weak match says so', async () => {
  searchAnswer = { ok: true, hits: [{ assetId: 'still', us: 0, score: 0.3 }], separation: 0.004, framesSearched: 11, unindexed: ['still'], reference: { assetId: 'beach', us: 12_000_000 } }
  const result = await run('search_footage', { similarTo: { assetId: 'beach', seconds: 12.5 }, assetIds: ['still'] })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const request = calls[0]!.args[0] as VisionSearchRequest
  assert.deepEqual(request.similarTo, { assetId: 'beach', us: 12_500_000 })
  // The reference is searched even when assetIds did not name it.
  assert.deepEqual(request.assets.map((a) => a.assetId).sort(), ['beach', 'still'])
  const value = result.value as { comparedWith: unknown; next: string; notIndexed: string[] }
  assert.deepEqual(value.comparedWith, { assetId: 'beach', seconds: 12 })
  assert.match(value.next, /barely stands out/)
  assert.deepEqual(value.notIndexed, ['still.png'])
  // Neither query nor similarTo: refused naming both.
  const empty = await run('search_footage', {})
  assert.match(empty.ok ? '' : empty.error, /query.*similarTo/)
})

test('each job state has its own sentence', () => {
  const base = { ...JOB, filesTotal: 4, filesDone: 2, framesDone: 90, current: 'b.mov' }
  const sentences = new Set([
    describeJob({ ...base, state: 'running', phase: 'download', checking: 4, filesTotal: 0 }),
    describeJob({ ...base, state: 'running', phase: 'planning', checking: 2, filesTotal: 1, alreadyIndexed: 1 }),
    describeJob({ ...base, state: 'running' }),
    describeJob({ ...base, state: 'cancelled' }),
    describeJob({ ...base, state: 'failed', error: 'Downloading SigLIP failed: offline' }),
    describeJob({ ...base, state: 'done', filesDone: 4 }),
    describeJob({ ...base, state: 'done', filesTotal: 0, filesDone: 0, alreadyIndexed: 4 }),
    describeJob({ ...base, state: 'done', filesDone: 4, failed: [{ assetId: 'x', name: 'x.mov', error: 'moov atom not found' }] })
  ])
  assert.equal(sentences.size, 8)
  assert.match(describeJob({ ...base, state: 'running', phase: 'planning', checking: 2, filesTotal: 1, alreadyIndexed: 1 }), /2 of 4 checked, 1 to index; 1 already indexed/)
  assert.equal(describeJob({ ...base, state: 'done', filesTotal: 0, filesDone: 0, alreadyIndexed: 4 }), 'All 4 files were already indexed.')
  assert.match(describeJob({ ...base, state: 'done', filesDone: 4, failed: [{ assetId: 'x', name: 'x.mov', error: 'moov atom not found' }] }), /3 of 4 files indexed.*x\.mov \(moov atom not found\)/)
})

test('a bare call after a job finished reports it and starts nothing; a new file still starts a job', async () => {
  lastJob = { ...JOB, state: 'done', phase: 'indexing', checking: 0, filesTotal: 2, filesDone: 2, framesDone: 19, finishedAt: 1 }
  planAnswer = { ok: true, started: false, plan: { ...PLAN, indexed: 2, toIndex: 0, frames: 0, estimatedSeconds: 0 }, job: lastJob }
  const polled = await run('index_footage', {})
  assert.ok(polled.ok, polled.ok ? '' : polled.error)
  const value = polled.value as { done?: boolean; lastJob?: string; started?: boolean }
  assert.equal(value.done, true)
  assert.match(value.lastJob ?? '', /2 of 2 files indexed \(19 frames\)/)
  assert.deepEqual(calls.map((c) => (c.args[1] as { dryRun?: boolean }).dryRun), [true], 'only the plan was asked for; no job started')

  // The same poll with a new file in the project: the plan says one to index, so a job starts.
  calls.length = 0
  planAnswer = { ok: true, started: false, plan: { ...PLAN, indexed: 2, toIndex: 1, frames: 10 }, job: lastJob }
  const fresh = await run('index_footage', {})
  assert.ok(fresh.ok)
  assert.equal((fresh.value as { started?: boolean }).started, true)
  assert.deepEqual(calls.map((c) => (c.args[1] as { dryRun?: boolean }).dryRun), [true, false])
})
