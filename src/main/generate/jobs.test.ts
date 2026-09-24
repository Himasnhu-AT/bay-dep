/**
 * The job table's promises, each against a stub provider:
 *
 * - the row is on disk *before* the request reaches the provider;
 * - a restart resumes polling a running job and never submits it again;
 * - a job interrupted before it had a handle is failed with the sentence, not resubmitted;
 * - a result with no picture in it fails the job rather than landing;
 * - no key, no row and no request.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GenerationJob, GenerationRequest, ProbedOutput } from '@shared/generation'
import { validateGeneration } from '@shared/generation'
import { providerHttp, type Fetch } from './http'
import { GenerationJobs, type JobDeps } from './jobs'
import { geminiImage } from './gemini-image'
import { kling } from './kling'
import { openaiImage } from './openai-image'
import { veo } from './veo'
import type { Adapter } from './adapter'
import { STUB_POLICY, json, startStub, type Stub } from './stub-server'

const realFetch: Fetch = (url, init) => fetch(url, init)
const PNG = Buffer.from('89504e470d0a1a0a0000', 'hex')

const video: ProbedOutput = { durationUs: 8_000_000, width: 1280, height: 720, hasVideo: true, hasAudio: true }
const picture: ProbedOutput = { durationUs: 0, width: 1024, height: 1024, hasVideo: true, hasAudio: false }

function gemini(): Adapter {
  return {
    start: (r, c) => (r.kind === 'video' ? veo : geminiImage).start(r, c),
    poll: (h, c) => veo.poll!(h, c),
    collect: (l, c) => veo.collect!(l, c)
  }
}

async function setup(stub: Stub, overrides: Partial<JobDeps> = {}): Promise<{ deps: JobDeps; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'bay-gen-'))
  const deps: JobDeps = {
    file: join(dir, 'generation-jobs.json'),
    outDir: join(dir, 'generated'),
    adapters: { openai: openaiImage, gemini: gemini(), kling, elevenlabs: openaiImage },
    http: () => providerHttp(realFetch, STUB_POLICY, 'Stub'),
    baseUrl: () => stub.api,
    credentials: () => ({ apiKey: 'k', accessKey: 'ak', secretKey: 'sk' }),
    probe: async (path) => (path.endsWith('.mp4') ? video : picture),
    pollDelayMs: () => 5,
    startWaitMs: 2000,
    ...overrides
  }
  return { deps, dir }
}

function req(input: Record<string, unknown>, kind: 'image' | 'video'): GenerationRequest {
  const checked = validateGeneration(input, kind)
  assert.ok(checked.ok)
  return checked.request
}

async function until(jobs: GenerationJobs, id: string, statuses: string[], ms = 5000): Promise<GenerationJob> {
  const start = Date.now()
  for (;;) {
    const job = jobs.get(id)
    if (job && statuses.includes(job.status)) return job
    if (Date.now() - start > ms) throw new Error(`job ${id} stayed ${job?.status}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('the row is on disk before the provider sees the request, and the picture lands content-addressed', { timeout: 10000 }, async () => {
  let onDiskAtRequest: GenerationJob[] | null = null
  let file = ''
  const stub = await startStub(async (_r, response) => {
    onDiskAtRequest = (JSON.parse(await readFile(file, 'utf8')) as { jobs: GenerationJob[] }).jobs
    json(response, 200, { data: [{ b64_json: PNG.toString('base64') }] })
  })
  try {
    const { deps } = await setup(stub)
    file = deps.file
    const jobs = new GenerationJobs(deps)
    await jobs.load()
    const started = await jobs.start(req({ model: 'gpt-image-1', prompt: 'A Red Kite!' }, 'image'))
    assert.ok(started.ok)
    const done = await until(jobs, started.job.id, ['done', 'failed'])
    assert.equal(done.status, 'done', done.error)
    const seen = onDiskAtRequest as GenerationJob[] | null
    assert.ok(seen, 'the stub was reached')
    assert.equal(seen.find((j) => j.id === started.job.id)?.status, 'queued', 'persisted before submit')
    assert.match(done.outputPath ?? '', /\/generated\/a-red-kite-[0-9a-f]{12}\.png$/)
    assert.deepEqual(await readFile(done.outputPath!), PNG)
    assert.deepEqual(done.findings, [])
    await jobs.flush()
  } finally {
    await stub.close()
  }
})

test('a restart resumes polling a running video job and does not submit it again', { timeout: 10000 }, async () => {
  let release = false
  const stub = await startStub((r, response) => {
    if (r.url.endsWith(':predictLongRunning')) return json(response, 200, { name: 'models/veo-3.1-fast-generate-preview/operations/op1' })
    if (r.url.includes('/operations/op1')) {
      if (!release) return json(response, 200, { done: false, metadata: { progressPercent: 40 } })
      return json(response, 200, { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `${stub.cdn}/clip.mp4` } }] } } })
    }
    if (r.url === '/clip.mp4') {
      response.setHeader('content-type', 'video/mp4')
      return void response.end('mp4')
    }
    json(response, 404, {})
  })
  try {
    const { deps } = await setup(stub)
    const first = new GenerationJobs(deps)
    await first.load()
    const started = await first.start(req({ model: 'veo-3.1-fast-generate-preview', prompt: 'surf' }, 'video'))
    assert.ok(started.ok)
    const running = await until(first, started.job.id, ['running'])
    assert.equal(running.remote, 'models/veo-3.1-fast-generate-preview/operations/op1')
    // Let it poll at least once, then "quit".
    await new Promise((resolve) => setTimeout(resolve, 50))
    first.stop()
    await first.flush()
    assert.equal(first.get(started.job.id)?.progress, 0.4)

    release = true
    const submissionsBefore = stub.requests.filter((r) => r.url.endsWith(':predictLongRunning')).length
    const second = new GenerationJobs(deps)
    await second.load()
    const done = await until(second, started.job.id, ['done', 'failed'])
    assert.equal(done.status, 'done', done.error)
    assert.match(done.outputPath ?? '', /\.mp4$/)
    const submissionsAfter = stub.requests.filter((r) => r.url.endsWith(':predictLongRunning')).length
    assert.equal(submissionsBefore, 1)
    assert.equal(submissionsAfter, 1, 'the resumed job must not be paid for twice')
    await second.flush()
  } finally {
    await stub.close()
  }
})

test('a job interrupted before it had a handle is failed with the reason; a running one with a handle is not', { timeout: 10000 }, async () => {
  const stub = await startStub((_r, response) => json(response, 200, { done: false }))
  try {
    const { deps } = await setup(stub)
    const base = { provider: 'openai', model: 'gpt-image-1', kind: 'image', request: req({ model: 'gpt-image-1', prompt: 'x' }, 'image'), createdAt: Date.now(), updatedAt: Date.now() }
    const rows = [
      { ...base, id: 'queued-1', status: 'queued' },
      { ...base, id: 'inflight-1', status: 'running' },
      { ...base, id: 'veo-1', provider: 'gemini', model: 'veo-3.1-generate-preview', kind: 'video', request: req({ model: 'veo-3.1-generate-preview', prompt: 'y' }, 'video'), status: 'running', remote: 'models/v/operations/o' }
    ]
    await writeFile(deps.file, JSON.stringify({ version: 1, jobs: rows }))
    const jobs = new GenerationJobs(deps)
    await jobs.load()
    for (const id of ['queued-1', 'inflight-1']) {
      const job = jobs.get(id)!
      assert.equal(job.status, 'failed')
      assert.match(job.error ?? '', /cannot tell whether the provider started \(and charged for\) it.*dashboard/)
    }
    // Positive control: the one with a handle is still running and being polled.
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(jobs.get('veo-1')?.status, 'running')
    assert.ok(stub.requests.some((r) => r.url === '/v1beta/models/v/operations/o'))
    assert.equal(stub.requests.filter((r) => r.method === 'POST').length, 0, 'nothing is resubmitted')
    jobs.stop()
    await jobs.flush()
  } finally {
    await stub.close()
  }
})

test('a result with no video stream fails the job with a blocking finding; one with sound missing lands with a warning', { timeout: 10000 }, async () => {
  const stub = await startStub((r, response) => {
    if (r.url.endsWith(':predictLongRunning')) return json(response, 200, { name: 'models/m/operations/o' })
    if (r.url.includes('/operations/o')) return json(response, 200, { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `${stub.cdn}/c.mp4` } }] } } })
    response.setHeader('content-type', 'video/mp4')
    response.end(r.url)
  })
  try {
    let probed: ProbedOutput = { ...video, hasVideo: false }
    const { deps } = await setup(stub, { probe: async () => probed })
    const jobs = new GenerationJobs(deps)
    await jobs.load()
    const bad = await jobs.start(req({ model: 'veo-3.1-generate-preview', prompt: 'a' }, 'video'))
    assert.ok(bad.ok)
    const failed = await until(jobs, bad.job.id, ['done', 'failed'])
    assert.equal(failed.status, 'failed')
    assert.equal(failed.outputPath, undefined)
    assert.deepEqual(failed.findings?.map((f) => f.severity), ['blocking'])
    assert.match(failed.error ?? '', /no video stream/)

    probed = { ...video, hasAudio: false }
    const ok = await jobs.start(req({ model: 'veo-3.1-generate-preview', prompt: 'b' }, 'video'))
    assert.ok(ok.ok)
    const landed = await until(jobs, ok.job.id, ['done', 'failed'])
    assert.equal(landed.status, 'done')
    assert.deepEqual(landed.findings?.map((f) => f.severity), ['warn'])
    assert.match(landed.findings?.[0]?.message ?? '', /play silent/)
    await jobs.flush()
  } finally {
    await stub.close()
  }
})

test('with no key there is no row and no request; with one the same call starts', { timeout: 10000 }, async () => {
  const stub = await startStub((_r, response) => json(response, 200, { data: [{ b64_json: PNG.toString('base64') }] }))
  try {
    let keyed = false
    const { deps, dir } = await setup(stub, { credentials: () => (keyed ? { apiKey: 'k' } : null) })
    const jobs = new GenerationJobs(deps)
    await jobs.load()
    const refused = await jobs.start(req({ model: 'gpt-image-1', prompt: 'x' }, 'image'))
    assert.equal(refused.ok, false)
    assert.match(refused.ok ? '' : refused.error, /No OpenAI key is set.*Settings › Providers.*never ask for a key in chat/)
    assert.equal(stub.requests.length, 0)
    assert.equal(jobs.list().length, 0)
    assert.equal((await readdir(dir)).includes('generation-jobs.json'), false)

    keyed = true
    const started = await jobs.start(req({ model: 'gpt-image-1', prompt: 'x' }, 'image'))
    assert.equal(started.ok, true)
    await jobs.flush()
  } finally {
    await stub.close()
  }
})

test('main re-validates: a request the renderer should have refused is refused here too', async () => {
  const stub = await startStub((_r, response) => json(response, 200, {}))
  try {
    const { deps } = await setup(stub)
    const jobs = new GenerationJobs(deps)
    const bad = { ...req({ model: 'veo-3.1-generate-preview', prompt: 'x' }, 'video'), durationSeconds: 12 }
    const refused = await jobs.start(bad)
    assert.equal(refused.ok, false)
    assert.match(refused.ok ? '' : refused.error, /does not take durationSeconds 12\. Allowed: 4, 6, 8/)
    assert.equal(stub.requests.length, 0)
  } finally {
    await stub.close()
  }
})

test('a reference that is not admitted media is refused before anything is sent', async () => {
  const stub = await startStub((_r, response) => json(response, 200, { data: [{ b64_json: PNG.toString('base64') }] }))
  try {
    const { deps, dir } = await setup(stub, { referenceAllowed: (path) => path.endsWith('/ok.png') })
    const okPath = join(dir, 'ok.png')
    await writeFile(okPath, PNG)
    await writeFile(join(dir, 'secret.png'), PNG)
    const jobs = new GenerationJobs(deps)
    const refused = await jobs.start(req({ model: 'gpt-image-1', prompt: 'x', referencePath: join(dir, 'secret.png') }, 'image'))
    assert.equal(refused.ok, false)
    assert.match(refused.ok ? '' : refused.error, /not media in this project\. Import it first/)
    assert.equal(stub.requests.length, 0)
    // Positive control: an admitted picture is sent.
    const started = await jobs.start(req({ model: 'gpt-image-1', prompt: 'x', referencePath: okPath }, 'image'))
    assert.equal(started.ok, true)
    assert.equal(stub.requests[0]?.url, '/v1/images/edits')
    await jobs.flush()
  } finally {
    await stub.close()
  }
})
