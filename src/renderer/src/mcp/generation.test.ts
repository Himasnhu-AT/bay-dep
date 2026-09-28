/**
 * The generation tools through the real executor, with main's side stubbed on `window.bay`.
 *
 * What matters here: `validateOnly` prices a call and starts nothing (a paid request is the one
 * thing a dry run must never do); a real call sends main the validated request; a missing key is
 * refused with where to set it; and a landed job is imported through the ordinary import path —
 * with each refusal paired with the legal call beside it.
 */

import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Project } from '@shared/project'
import type { GenerationJob, GenerationRequest, GenerationSpending, ProviderKeyStatus } from '@shared/generation'
import { useEditor, emptyProject } from '@/store/editor'
import { executeToolCall } from './index'

const started: GenerationRequest[] = []
const imported: string[][] = []
let keys: ProviderKeyStatus[] = []
let jobs: GenerationJob[] = []
/** What main's spend guard reports. */
let spending: GenerationSpending = { spentUsd: 0, budgetUsd: 5, active: 0, maxActive: 3 }
/** Set to answer the next start with a job main already failed (a key the provider refused). */
let failNextStart: string | null = null

const asset = (id: string, extra: Partial<Asset>): Asset => ({
  id,
  kind: 'image',
  name: `${id}.png`,
  path: `/media/${id}.png`,
  durationUs: 5_000_000,
  width: 1024,
  height: 1024,
  fps: null,
  hasAudio: false,
  hasVideo: true,
  posterPath: null,
  waveformPath: null,
  createdAt: 0,
  ...extra
})

;(globalThis as { window?: unknown }).window = {
  bay: {
    generation: {
      keys: async () => keys,
      start: async (request: GenerationRequest) => {
        started.push(request)
        const job: GenerationJob = {
          id: `job-${started.length}`,
          provider: request.provider,
          model: request.model,
          kind: request.kind,
          status: failNextStart ? 'failed' : 'running',
          ...(failNextStart ? { error: failNextStart } : {}),
          request,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
        failNextStart = null
        jobs.unshift(job)
        spending = { ...spending, spentUsd: spending.spentUsd + 3.2 }
        return { ok: true, job, spending }
      },
      spending: async () => spending,
      job: async (id: string) => jobs.find((j) => j.id === id) ?? null,
      jobs: async () => jobs
    },
    media: {
      importPaths: async (paths: string[]) => {
        imported.push(paths)
        return paths.map((path) => ({
          asset: asset('generated1', { kind: 'video', name: 'surf.mp4', path, durationUs: 8_000_000, width: 1280, height: 720, fps: 24, hasAudio: true }),
          reused: false
        }))
      }
    }
  }
}

beforeEach(() => {
  started.length = 0
  imported.length = 0
  keys = [
    { provider: 'openai', set: true, persisted: true },
    { provider: 'gemini', set: true, persisted: true },
    { provider: 'kling', set: false, persisted: true }
  ]
  jobs = []
  spending = { spentUsd: 0, budgetUsd: 5, active: 0, maxActive: 3 }
  failNextStart = null
  const base = emptyProject()
  const project: Project = {
    ...base,
    assets: [asset('still', {}), asset('clip', { kind: 'video', name: 'clip.mp4', path: '/media/clip.mp4' })]
  }
  useEditor.getState().enterProject(project)
})

const call = (tool: string, args: Record<string, unknown>) => executeToolCall({ id: 't', tool, args })

test('validateOnly prices the call and starts nothing; the same call without it starts one job', async () => {
  const pastBefore = useEditor.getState().past.length
  const dry = await call('generate_video', { model: 'veo-3.1-generate-preview', prompt: 'surf at dawn', validateOnly: true })
  assert.equal(dry.ok, true)
  const value = dry.ok ? (dry.value as Record<string, unknown>) : {}
  assert.equal(value.valid, true)
  assert.equal(value.estimatedCostUsd, 3.2)
  assert.deepEqual(value.defaultsApplied, ['aspectRatio=16:9', 'durationSeconds=8', 'resolution=720p'])
  assert.equal(value.keySet, true)
  assert.equal(started.length, 0, 'a dry run must not start a paid job')
  assert.equal(useEditor.getState().past.length, pastBefore)

  const real = await call('generate_video', { model: 'veo-3.1-generate-preview', prompt: 'surf at dawn' })
  assert.equal(real.ok, true)
  assert.equal(started.length, 1)
  assert.equal(started[0]!.durationSeconds, 8)
  assert.match(String(real.ok ? (real.value as Record<string, unknown>).next : ''), /track_generation \{ jobId: "job-1", waitSeconds: 120 \}/)
})

test('an invalid option is refused before main is asked; a dry run says the same', async () => {
  const bad = await call('generate_video', { model: 'kling-v2-6', prompt: 'x', durationSeconds: 7 })
  assert.equal(bad.ok, false)
  assert.match(bad.ok ? '' : bad.error, /does not take durationSeconds 7\. Allowed: 5, 10\./)
  const dryBad = await call('generate_video', { model: 'kling-v2-6', prompt: 'x', durationSeconds: 7, validateOnly: true })
  assert.equal(dryBad.ok, false)
  assert.equal(started.length, 0)
})

test('with no key the real call is refused with where to set it, and a dry run reports it blocked', async () => {
  const refused = await call('generate_video', { model: 'kling-v2-6', prompt: 'x' })
  assert.equal(refused.ok, false)
  assert.match(refused.ok ? '' : refused.error, /No Kling key is set.*Preferences › AI providers.*never takes keys in chat/)
  const dry = await call('generate_video', { model: 'kling-v2-6', prompt: 'x', validateOnly: true })
  const value = dry.ok ? (dry.value as Record<string, unknown>) : {}
  assert.equal(value.keySet, false)
  assert.match(String(value.blocked), /No Kling key is set/)
  assert.equal(started.length, 0)
  // Positive control: a provider with a key starts.
  assert.equal((await call('generate_image', { model: 'gpt-image-1', prompt: 'x' })).ok, true)
})

test('a video asset as the reference is refused; an image asset is sent by its path', async () => {
  const refused = await call('generate_image', { model: 'gpt-image-1', prompt: 'x', referenceAssetId: 'clip' })
  assert.equal(refused.ok, false)
  assert.match(refused.ok ? '' : refused.error, /clip\.mp4 is a video; referenceAssetId takes an image asset/)
  const ok = await call('generate_image', { model: 'gpt-image-1', prompt: 'x', referenceAssetId: 'still' })
  assert.equal(ok.ok, true)
  assert.equal(started[0]!.referencePath, '/media/still.png')
})

test('track_generation: running reports and imports nothing; done imports and places', async () => {
  await call('generate_video', { model: 'veo-3.1-generate-preview', prompt: 'surf' })
  const running = await call('track_generation', { jobId: 'job-1', waitSeconds: 0 })
  assert.equal(running.ok, true)
  assert.match(String(running.ok ? (running.value as Record<string, unknown>).next : ''), /Call track_generation again with jobId "job-1" and waitSeconds/)
  assert.equal(imported.length, 0)

  Object.assign(jobs[0]!, { status: 'done', outputPath: '/data/generated/surf-abc.mp4', findings: [{ severity: 'warn', message: 'no sound' }] })
  const pastBefore = useEditor.getState().past.length
  const done = await call('track_generation', { jobId: 'job-1', place: true, atFrame: 0 })
  assert.equal(useEditor.getState().past.length, pastBefore + 1, 'import and place are one undo step')
  assert.equal(done.ok, true, done.ok ? '' : done.error)
  const value = done.ok ? (done.value as Record<string, unknown>) : {}
  assert.deepEqual(imported, [['/data/generated/surf-abc.mp4']])
  assert.equal((value.asset as Record<string, unknown>).id, 'generated1')
  assert.deepEqual(value.findings, [{ severity: 'warn', message: 'no sound' }])
  assert.ok(value.placed, 'placed on the timeline')
  assert.ok(useEditor.getState().project.assets.some((a) => a.id === 'generated1'))
  // Pictures: a video with sound also brings its linked sound clip (Preferences › Editing).
  const items = useEditor.getState().project.timelines[0]!.tracks.filter((t) => t.kind === 'video').flatMap((t) => t.items)
  assert.equal(items.filter((i) => i.assetId === 'generated1').length, 1)
})

test('track_generation: a placement that is refused still reports the asset as imported', async () => {
  await call('generate_video', { model: 'veo-3.1-generate-preview', prompt: 'surf' })
  Object.assign(jobs[0]!, { status: 'done', outputPath: '/data/generated/surf-abc.mp4', findings: [] })
  const result = await call('track_generation', { jobId: 'job-1', place: true, trackId: 'no-such-track' })
  assert.equal(result.ok, true)
  const value = result.ok ? (result.value as Record<string, unknown>) : {}
  assert.equal((value.asset as Record<string, unknown>).id, 'generated1')
  assert.match(String(value.next), /imported but was not placed: .*Retry with place_asset \{ assetId: "generated1" \}/)
  assert.ok(useEditor.getState().project.assets.some((a) => a.id === 'generated1'))
})

test('track_generation: an unknown id names the recent jobs; a known one answers', async () => {
  await call('generate_image', { model: 'gpt-image-1', prompt: 'x' })
  const unknown = await call('track_generation', { jobId: 'nope' })
  assert.equal(unknown.ok, false)
  assert.match(unknown.ok ? '' : unknown.error, /no generation job "nope"\. Recent jobs: job-1 \(image, running\)/)
  assert.equal((await call('track_generation', { jobId: 'job-1', waitSeconds: 0 })).ok, true)
})

test('a real call reports the session spend; a dry run reports the guard would refuse, before anything starts', async () => {
  const real = await call('generate_video', { model: 'veo-3.1-generate-preview', prompt: 'surf' })
  assert.equal(real.ok, true)
  const value = real.ok ? (real.value as Record<string, unknown>) : {}
  assert.equal(value.sessionSpendUsd, 3.2)
  assert.equal(value.sessionBudgetUsd, 5)

  // $3.20 spent of $5: a second 8-second Veo clip would pass the budget, and the dry run says so.
  const dry = await call('generate_video', { model: 'veo-3.1-generate-preview', prompt: 'surf', validateOnly: true })
  const planned = dry.ok ? (dry.value as Record<string, unknown>) : {}
  assert.match(String(planned.blocked), /\$3\.20 spent of \$5\.00.*Preferences › AI providers/)
  // Positive control: a call that fits is not blocked.
  const fits = await call('generate_video', { model: 'veo-3.1-generate-preview', prompt: 'surf', durationSeconds: 4, validateOnly: true })
  assert.equal((fits.ok ? (fits.value as Record<string, unknown>) : {}).blocked, undefined)
  assert.equal(started.length, 1, 'dry runs start nothing')
})

test('a job main has already failed comes back as the error, not as "call track_generation"', async () => {
  failNextStart = 'Incorrect API key provided.'
  const failed = await call('generate_image', { model: 'gpt-image-1', prompt: 'x' })
  assert.equal(failed.ok, false)
  assert.match(failed.ok ? '' : failed.error, /OpenAI refused the request: Incorrect API key provided\./)
  assert.doesNotMatch(failed.ok ? '' : failed.error, /track_generation/)
  // Positive control: a running job is handed to track_generation.
  const running = await call('generate_image', { model: 'gpt-image-1', prompt: 'x' })
  assert.match(String(running.ok ? (running.value as Record<string, unknown>).next : ''), /track_generation \{ jobId: "job-2", waitSeconds: 120 \}/)
})

test('track_generation with place: true on a job already placed does not place a second copy', async () => {
  await call('generate_video', { model: 'veo-3.1-generate-preview', prompt: 'surf' })
  Object.assign(jobs[0]!, { status: 'done', outputPath: '/data/generated/surf-abc.mp4', findings: [] })
  const first = await call('track_generation', { jobId: 'job-1', place: true, atFrame: 0 })
  assert.ok(first.ok && (first.value as Record<string, unknown>).placed, 'the first call places it')
  const pastBefore = useEditor.getState().past.length

  const again = await call('track_generation', { jobId: 'job-1', place: true, atFrame: 0 })
  assert.equal(again.ok, true)
  const value = again.ok ? (again.value as Record<string, unknown>) : {}
  assert.equal(value.placed, false)
  assert.match(String(value.note), /already imported and on the timeline \(item .+\), so it was not placed again\. Call place_asset \{ assetId: "generated1" \}/i)
  // Pictures: a video with sound also brings its linked sound clip (Preferences › Editing).
  const items = useEditor.getState().project.timelines[0]!.tracks.filter((t) => t.kind === 'video').flatMap((t) => t.items)
  assert.equal(items.filter((i) => i.assetId === 'generated1').length, 1, 'one copy on the timeline')
  assert.equal(useEditor.getState().past.length, pastBefore, 'no undo step for a call that changed nothing')
})
