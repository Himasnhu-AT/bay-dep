/**
 * Speech through the job table, as the app wires it (`withSpeech` beside each provider's
 * adapter), against the local stub: it lands as audio, a file with no sound never lands, a Gemini
 * interaction still running at quit resumes rather than being paid for twice, and main refuses
 * what the catalog refuses before anything is sent.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GenerationJob, GenerationRequest, ProbedOutput } from '@shared/generation'
import { validateSpeech } from '@shared/speech'
import { providerHttp, type Fetch } from './http'
import { GenerationJobs, type JobDeps } from './jobs'
import { kling } from './kling'
import { openaiImage } from './openai-image'
import { elevenlabsSpeech, geminiSpeech, openaiSpeech, pcmToWav, withSpeech } from './speech-adapters'
import { STUB_POLICY, json, startStub, type Stub } from './stub-server'

const realFetch: Fetch = (url, init) => fetch(url, init)
const MP3 = Buffer.from('fffb90640000000000000000', 'hex')
const WAV = pcmToWav(Buffer.alloc(24000 * 2), 24000, 1)
const voiceover: ProbedOutput = { durationUs: 1_200_000, width: null, height: null, hasVideo: false, hasAudio: true }

async function setup(stub: Stub, overrides: Partial<JobDeps> = {}): Promise<JobDeps> {
  const dir = await mkdtemp(join(tmpdir(), 'bay-speech-jobs-'))
  return {
    file: join(dir, 'generation-jobs.json'),
    outDir: join(dir, 'generated'),
    adapters: {
      openai: withSpeech(openaiImage, openaiSpeech),
      gemini: withSpeech(null, geminiSpeech),
      kling,
      elevenlabs: withSpeech(null, elevenlabsSpeech)
    },
    http: () => providerHttp(realFetch, STUB_POLICY, 'Stub'),
    baseUrl: () => stub.api,
    credentials: () => ({ apiKey: 'k' }),
    probe: async () => voiceover,
    pollDelayMs: () => 5,
    startWaitMs: 2000,
    ...overrides
  }
}

function req(input: Record<string, unknown>): GenerationRequest {
  const checked = validateSpeech(input)
  assert.ok(checked.ok, checked.ok ? '' : checked.errors.join(' '))
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

function audio(response: import('node:http').ServerResponse, bytes: Buffer): void {
  response.statusCode = 200
  response.setHeader('content-type', 'audio/mpeg')
  response.end(bytes)
}

test('an OpenAI voiceover lands as an .mp3 in the output folder, recorded as speech with its cost', { timeout: 10000 }, async () => {
  const stub = await startStub((_r, response) => audio(response, MP3))
  try {
    const deps = await setup(stub)
    const jobs = new GenerationJobs(deps)
    await jobs.load()
    const started = await jobs.start(req({ model: 'gpt-4o-mini-tts', text: 'Welcome to the launch.' }))
    assert.ok(started.ok, started.ok ? '' : started.error)
    const done = await until(jobs, started.job.id, ['done', 'failed'])
    assert.equal(done.status, 'done', done.error)
    assert.equal(done.kind, 'speech')
    assert.match(done.outputPath ?? '', /generated\/welcome-to-the-launch-[0-9a-f]{12}\.mp3$/)
    assert.deepEqual(await readFile(done.outputPath!), MP3)
    assert.deepEqual(done.findings, [])
    assert.ok((done.estimatedCostUsd ?? 0) > 0)
    assert.equal(stub.requests[0]!.url, '/v1/audio/speech')
    const row = (JSON.parse(await readFile(deps.file, 'utf8')) as { jobs: GenerationJob[] }).jobs[0]!
    assert.equal(row.kind, 'speech')
    assert.equal(row.request.voice, 'marin')
    await jobs.flush()
  } finally {
    await stub.close()
  }
})

test('a returned file with no audio stream fails the job and is never handed over; one with sound lands', { timeout: 10000 }, async () => {
  const stub = await startStub((_r, response) => audio(response, MP3))
  try {
    const silent: ProbedOutput = { durationUs: 2_000_000, width: 640, height: 360, hasVideo: true, hasAudio: false }
    const jobs = new GenerationJobs(await setup(stub, { probe: async () => silent }))
    await jobs.load()
    const started = await jobs.start(req({ model: 'eleven_flash_v2_5', text: 'Hello.' }))
    assert.ok(started.ok)
    const failed = await until(jobs, started.job.id, ['done', 'failed'])
    assert.equal(failed.status, 'failed')
    assert.equal(failed.outputPath, undefined)
    assert.match(failed.error ?? '', /no audio stream\. Nothing was imported/)
    assert.equal(failed.findings?.[0]?.severity, 'blocking')
    // Positive control: the same call with sound in the file lands.
    const good = new GenerationJobs(await setup(stub))
    await good.load()
    const second = await good.start(req({ model: 'eleven_flash_v2_5', text: 'Hello.' }))
    assert.ok(second.ok)
    assert.equal((await until(good, second.job.id, ['done', 'failed'])).status, 'done')
    await jobs.flush()
    await good.flush()
  } finally {
    await stub.close()
  }
})

test('a Gemini interaction still running at quit is polled after restart, never posted again', { timeout: 10000 }, async () => {
  let finished = false
  const stub = await startStub((request, response) => {
    if (request.method === 'POST') return json(response, 200, { id: 'int-9', status: 'in_progress' })
    if (!finished) return json(response, 200, { id: 'int-9', status: 'in_progress' })
    return json(response, 200, { id: 'int-9', status: 'completed', steps: [{ content: [{ type: 'audio', data: WAV.toString('base64'), mime_type: 'audio/wav' }] }] })
  })
  try {
    const deps = await setup(stub)
    const first = new GenerationJobs(deps)
    await first.load()
    const started = await first.start(req({ model: 'gemini-3.8-flash-tts', text: 'A long read.' }))
    assert.ok(started.ok)
    assert.equal(started.job.remote, 'speech:int-9')
    first.stop()
    await first.flush()

    finished = true
    const second = new GenerationJobs(deps)
    await second.load()
    const done = await until(second, started.job.id, ['done', 'failed'])
    assert.equal(done.status, 'done', done.error)
    assert.match(done.outputPath ?? '', /\.wav$/)
    assert.deepEqual(await readFile(done.outputPath!), WAV)
    assert.equal(stub.requests.filter((r) => r.method === 'POST').length, 1)
    second.stop()
    await second.flush()
  } finally {
    await stub.close()
  }
})

test('main refuses a speech request the catalog refuses, before any row or request; the legal one starts', { timeout: 10000 }, async () => {
  const stub = await startStub((_r, response) => audio(response, MP3))
  try {
    const deps = await setup(stub)
    const jobs = new GenerationJobs(deps)
    await jobs.load()
    const bad = { provider: 'gemini', model: 'gemini-3.8-flash-tts', kind: 'speech', prompt: 'Hi', voice: 'Kore', speed: 1.5 } as GenerationRequest
    const refused = await jobs.start(bad)
    assert.equal(refused.ok, false)
    assert.match(refused.ok ? '' : refused.error, /takes no speed/)
    assert.equal(stub.requests.length, 0)
    assert.equal(jobs.list().length, 0)
    const { speed: _speed, ...legal } = bad
    const ok = await jobs.start(legal)
    assert.equal(ok.ok, true)
    await jobs.flush()
  } finally {
    await stub.close()
  }
})
