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
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
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
    adapters: { openai: openaiImage, gemini: gemini(), kling },
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
    // Two 8-second Veo clips are $6.40 of estimate, past the $5 default the guard holds a session to.
    const { deps } = await setup(stub, { probe: async () => probed, limits: () => ({ budgetUsd: 10, maxActive: 3 }) })
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

test('a job resumed long after it was created is polled and collected, not failed for its age', { timeout: 10000 }, async () => {
  const stub = await startStub((r, response) => {
    if (r.url.includes('/operations/old')) {
      return json(response, 200, { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `${stub.cdn}/old.mp4` } }] } } })
    }
    if (r.url === '/old.mp4') {
      response.setHeader('content-type', 'video/mp4')
      return void response.end('mp4')
    }
    json(response, 404, {})
  })
  try {
    // Two hours old — past the 45-minute limit — and finished at the provider while bay was quit.
    const { deps } = await setup(stub, { maxAgeMs: 45 * 60 * 1000 })
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000
    const row = {
      id: 'veo-old',
      provider: 'gemini',
      model: 'veo-3.1-generate-preview',
      kind: 'video',
      request: req({ model: 'veo-3.1-generate-preview', prompt: 'old' }, 'video'),
      status: 'running',
      remote: 'models/v/operations/old',
      createdAt: twoHoursAgo,
      updatedAt: twoHoursAgo
    }
    await writeFile(deps.file, JSON.stringify({ version: 1, jobs: [row] }))
    const jobs = new GenerationJobs(deps)
    await jobs.load()
    const done = await until(jobs, 'veo-old', ['done', 'failed'])
    assert.equal(done.status, 'done', done.error)
    assert.ok(stub.requests.some((r) => r.url.includes('/operations/old')), 'it was asked before anything was decided')
    await jobs.flush()
  } finally {
    await stub.close()
  }
})

test('the age limit still fails a job that keeps running, counted from when this process began polling', { timeout: 10000 }, async () => {
  const stub = await startStub((_r, response) => json(response, 200, { done: false, metadata: { progressPercent: 10 } }))
  try {
    // Created just now, so a limit read from `createdAt` and one read from the first poll agree:
    // the positive control that the limit is enforced at all.
    const { deps } = await setup(stub, { maxAgeMs: 60 })
    const row = {
      id: 'veo-stuck',
      provider: 'gemini',
      model: 'veo-3.1-generate-preview',
      kind: 'video',
      request: req({ model: 'veo-3.1-generate-preview', prompt: 'stuck' }, 'video'),
      status: 'running',
      remote: 'models/v/operations/stuck',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    await writeFile(deps.file, JSON.stringify({ version: 1, jobs: [row] }))
    const jobs = new GenerationJobs(deps)
    await jobs.load()
    const failed = await until(jobs, 'veo-stuck', ['done', 'failed'])
    assert.equal(failed.status, 'failed')
    assert.match(failed.error ?? '', /Still unfinished after .* of waiting.*dashboard/)
    assert.ok(stub.requests.length >= 2, 'polled more than once before giving up')
    await jobs.flush()
  } finally {
    await stub.close()
  }
})

test('if the row cannot be written, nothing is sent and the call says why; where it can, the same call starts', { timeout: 10000 }, async () => {
  const stub = await startStub((_r, response) => json(response, 200, { data: [{ b64_json: PNG.toString('base64') }] }))
  try {
    const { deps, dir } = await setup(stub)
    // A folder that does not exist: the write fails the way a full or read-only disk does.
    const unwritable = new GenerationJobs({ ...deps, file: join(dir, 'missing', 'generation-jobs.json') })
    const refused = await unwritable.start(req({ model: 'gpt-image-1', prompt: 'x' }, 'image'))
    assert.equal(refused.ok, false)
    assert.match(refused.ok ? '' : refused.error, /could not record this request before sending it .*not sent and nothing was charged/)
    assert.equal(stub.requests.length, 0, 'no paid request without a row')
    assert.equal(unwritable.list().length, 0)
    assert.equal(unwritable.spending().spentUsd, 0, 'a refused call is not counted against the budget')

    const writable = new GenerationJobs(deps)
    const started = await writable.start(req({ model: 'gpt-image-1', prompt: 'x' }, 'image'))
    assert.equal(started.ok, true)
    assert.equal(stub.requests.length, 1)
    await writable.flush()
  } finally {
    await stub.close()
  }
})

test('a job started before the table was read keeps every row the file held', { timeout: 10000 }, async () => {
  const stub = await startStub((_r, response) => json(response, 200, { data: [{ b64_json: PNG.toString('base64') }] }))
  try {
    const { deps } = await setup(stub)
    const earlier = {
      id: 'earlier-1',
      provider: 'openai',
      model: 'gpt-image-1',
      kind: 'image',
      request: req({ model: 'gpt-image-1', prompt: 'earlier' }, 'image'),
      status: 'done',
      outputPath: '/generated/earlier.png',
      createdAt: 1,
      updatedAt: 1
    }
    await writeFile(deps.file, JSON.stringify({ version: 1, jobs: [earlier] }))
    const jobs = new GenerationJobs(deps)
    // No `load()` first: the app's IPC can reach `start` while the file is still being read.
    const started = await jobs.start(req({ model: 'gpt-image-1', prompt: 'now' }, 'image'))
    assert.ok(started.ok)
    await until(jobs, started.job.id, ['done', 'failed'])
    await jobs.flush()
    const onDisk = (JSON.parse(await readFile(deps.file, 'utf8')) as { jobs: GenerationJob[] }).jobs.map((j) => j.id).sort()
    assert.deepEqual(onDisk, ['earlier-1', started.job.id].sort())
    assert.equal(jobs.get('earlier-1')?.outputPath, '/generated/earlier.png')
  } finally {
    await stub.close()
  }
})

test('the spend guard refuses a call past the session budget, naming spent, limit and where to raise it', { timeout: 10000 }, async () => {
  const stub = await startStub((_r, response) => json(response, 200, { data: [{ b64_json: PNG.toString('base64') }] }))
  try {
    // gpt-image-1 at medium is $0.06 (0.063 rounded): one fits under $0.10, a second does not.
    const { deps } = await setup(stub, { limits: () => ({ budgetUsd: 0.1, maxActive: 3 }) })
    const jobs = new GenerationJobs(deps)
    const first = await jobs.start(req({ model: 'gpt-image-1', prompt: 'one' }, 'image'))
    assert.ok(first.ok, first.ok ? '' : first.error)
    assert.deepEqual({ spent: first.spending.spentUsd, budget: first.spending.budgetUsd }, { spent: 0.06, budget: 0.1 })
    await until(jobs, first.job.id, ['done', 'failed'])

    const second = await jobs.start(req({ model: 'gpt-image-1', prompt: 'two' }, 'image'))
    assert.equal(second.ok, false)
    assert.match(
      second.ok ? '' : second.error,
      /This call \(~\$0\.06\) would take generation spending this session past its limit: \$0\.06 spent of \$0\.10\. Nothing was sent\. .*Settings › Providers/
    )
    assert.equal(stub.requests.length, 1, 'the refused call reached no provider')
    // Positive control: a cheaper call that fits is still taken.
    const cheap = await jobs.start(req({ model: 'gpt-image-1', prompt: 'three', quality: 'low' }, 'image'))
    assert.equal(cheap.ok, true)
    await jobs.flush()
  } finally {
    await stub.close()
  }
})

test('the spend guard caps jobs at once, and two calls racing for the last place get one between them', { timeout: 10000 }, async () => {
  let operations = 0
  const stub = await startStub((r, response) => {
    if (r.url.endsWith(':predictLongRunning')) return json(response, 200, { name: `models/m/operations/o${++operations}` })
    json(response, 200, { done: false })
  })
  try {
    const { deps } = await setup(stub, { limits: () => ({ budgetUsd: 100, maxActive: 2 }), pollDelayMs: () => 1000 })
    const jobs = new GenerationJobs(deps)
    const first = await jobs.start(req({ model: 'veo-3.1-fast-generate-preview', prompt: 'a', durationSeconds: 4 }, 'video'))
    assert.ok(first.ok)
    const [b, c] = await Promise.all([
      jobs.start(req({ model: 'veo-3.1-fast-generate-preview', prompt: 'b', durationSeconds: 4 }, 'video')),
      jobs.start(req({ model: 'veo-3.1-fast-generate-preview', prompt: 'c', durationSeconds: 4 }, 'video'))
    ])
    assert.deepEqual([b.ok, c.ok].sort(), [false, true])
    const refused = b.ok ? c : b
    assert.match(refused.ok ? '' : refused.error, /2 generation jobs are already running, and the limit is 2 at once\. Nothing was sent\..*Settings › Providers/)
    assert.equal(stub.requests.filter((r) => r.url.endsWith(':predictLongRunning')).length, 2)
    assert.equal(jobs.spending().active, 2)
    jobs.stop()
    await jobs.flush()
  } finally {
    await stub.close()
  }
})

test('a reference path that walks out of an allowed folder with .. is judged as the file it names', async () => {
  const stub = await startStub((_r, response) => json(response, 200, { data: [{ b64_json: PNG.toString('base64') }] }))
  try {
    const { dir } = await setup(stub)
    const media = join(dir, 'media')
    await mkdir(media)
    await writeFile(join(media, 'ok.png'), PNG)
    await writeFile(join(dir, 'secret.png'), PNG)
    // A directory-prefix rule, the shape `isAllowed` has for bay's cache.
    const underMedia = (p: string): boolean => p.startsWith(media + sep)
    // Built by concatenation: `join` would normalise the `..` away and test nothing.
    const escape = media + sep + '..' + sep + 'secret.png'
    assert.ok(underMedia(escape), 'the raw specimen must beat a naive prefix check, or this test proves nothing')

    const { deps } = await setup(stub, { referenceAllowed: underMedia })
    const jobs = new GenerationJobs(deps)
    const refused = await jobs.start(req({ model: 'gpt-image-1', prompt: 'x', referencePath: escape }, 'image'))
    assert.equal(refused.ok, false)
    assert.match(refused.ok ? '' : refused.error, /"secret\.png" is not media in this project/)
    assert.equal(stub.requests.length, 0)
    // Positive control: the file really under the folder is sent.
    const started = await jobs.start(req({ model: 'gpt-image-1', prompt: 'x', referencePath: join(media, 'ok.png') }, 'image'))
    assert.equal(started.ok, true)
    await jobs.flush()
  } finally {
    await stub.close()
  }
})
