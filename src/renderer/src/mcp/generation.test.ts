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
import type { GenerationJob, GenerationRequest, ProviderKeyStatus } from '@shared/generation'
import { useEditor, emptyProject } from '@/store/editor'
import { executeToolCall } from './index'

const started: GenerationRequest[] = []
const imported: string[][] = []
let keys: ProviderKeyStatus[] = []
let jobs: GenerationJob[] = []

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
          status: 'running',
          request,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
        jobs.unshift(job)
        return { ok: true, job }
      },
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
  assert.match(String(real.ok ? (real.value as Record<string, unknown>).next : ''), /track_generation \{ jobId: "job-1" \} every 15–30 seconds/)
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
  assert.match(refused.ok ? '' : refused.error, /No Kling key is set.*Settings › Providers.*never takes keys in chat/)
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
  const running = await call('track_generation', { jobId: 'job-1' })
  assert.equal(running.ok, true)
  assert.match(String(running.ok ? (running.value as Record<string, unknown>).next : ''), /again in 15–30 seconds/)
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
  const items = useEditor.getState().project.timelines[0]!.tracks.flatMap((t) => t.items)
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
  assert.equal((await call('track_generation', { jobId: 'job-1' })).ok, true)
})
