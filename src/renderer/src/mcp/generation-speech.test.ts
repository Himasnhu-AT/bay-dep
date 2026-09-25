/**
 * `generate_speech`, `estimate_speech` and a voiceover through `track_generation`, via the real
 * executor with main's side stubbed on `window.bay`. The promises: a dry run prices and sizes the
 * read and starts nothing; main receives the validated request; a landed voiceover is imported
 * and placed on an audio track at the frame asked, in one undo step that undo takes back whole.
 */

import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Project } from '@shared/project'
import type { GenerationJob, GenerationRequest, ProviderKeyStatus } from '@shared/generation'
import { estimateSpeech } from '@shared/speech-duration'
import { useEditor, emptyProject } from '@/store/editor'
import { executeToolCall } from './index'

const started: GenerationRequest[] = []
const imported: string[][] = []
let keys: ProviderKeyStatus[] = []
let jobs: GenerationJob[] = []

const voiceAsset = (path: string): Asset => ({
  id: 'voice1',
  kind: 'audio',
  name: 'welcome.mp3',
  path,
  durationUs: 2_500_000,
  width: null,
  height: null,
  fps: null,
  hasAudio: true,
  hasVideo: false,
  posterPath: null,
  waveformPath: null,
  createdAt: 0
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
        return { ok: true, job, spending: { spentUsd: 0, budgetUsd: 5, active: 0, maxActive: 3 } }
      },
      spending: async () => ({ spentUsd: 0, budgetUsd: 5, active: 0, maxActive: 3 }),
      job: async (id: string) => jobs.find((j) => j.id === id) ?? null,
      jobs: async () => jobs
    },
    media: {
      importPaths: async (paths: string[]) => {
        imported.push(paths)
        return paths.map((path) => ({ asset: voiceAsset(path), reused: false }))
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
    { provider: 'kling', set: false, persisted: true },
    { provider: 'elevenlabs', set: false, persisted: true }
  ]
  jobs = []
  const project: Project = emptyProject()
  useEditor.getState().enterProject(project)
})

const call = (tool: string, args: Record<string, unknown>) => executeToolCall({ id: 't', tool, args })
const value = (result: Awaited<ReturnType<typeof call>>): Record<string, unknown> => (result.ok ? (result.value as Record<string, unknown>) : {})
const fps = (): number => useEditor.getState().project.timelines[0]!.fps

const TEXT = 'Every morning, millions of people open their laptops and start the same fight with their inbox.'

test('validateOnly prices and sizes the read and starts nothing; the same call without it starts one job', async () => {
  const pastBefore = useEditor.getState().past.length
  const dry = await call('generate_speech', { model: 'gpt-4o-mini-tts', text: TEXT, validateOnly: true })
  assert.equal(dry.ok, true, dry.ok ? '' : dry.error)
  const v = value(dry)
  assert.equal(v.valid, true)
  assert.deepEqual(v.defaultsApplied, ['voice=marin', 'style=natural'])
  const expected = estimateSpeech(TEXT, { pace: 'normal' })
  const spoken = v.estimatedSpeech as Record<string, unknown>
  assert.equal(spoken.seconds, expected.seconds)
  assert.equal(spoken.frames, Math.round(expected.seconds * fps()))
  assert.equal(v.estimatedCostUsd, Math.round(expected.seconds * 0.00025 * 10000) / 10000)
  assert.equal((v.request as Record<string, unknown>).characters, TEXT.length)
  assert.equal(started.length, 0, 'a dry run must not start a paid job')
  assert.equal(useEditor.getState().past.length, pastBefore)

  const real = await call('generate_speech', { model: 'gpt-4o-mini-tts', text: TEXT, voice: 'coral', style: 'warm' })
  assert.equal(real.ok, true, real.ok ? '' : real.error)
  assert.equal(started.length, 1)
  assert.equal(started[0]!.kind, 'speech')
  assert.equal(started[0]!.prompt, TEXT)
  assert.equal(started[0]!.voice, 'coral')
  assert.equal(started[0]!.style, 'warm')
  assert.match(String(value(real).next), /track_generation \{ jobId: "job-1" \}/)
  assert.equal(useEditor.getState().past.length, pastBefore, 'starting a job is not an edit')
})

test('an option the model does not take is refused before main is asked; the legal call beside it starts', async () => {
  const bad = await call('generate_speech', { model: 'gemini-3.8-flash-tts', text: 'Hi.', speed: 1.3 })
  assert.equal(bad.ok, false)
  assert.match(bad.ok ? '' : bad.error, /takes no speed\. Ask for the pace in instructions/)
  const dryBad = await call('generate_speech', { model: 'gemini-3.8-flash-tts', text: 'Hi.', speed: 1.3, validateOnly: true })
  assert.equal(dryBad.ok, false)
  assert.equal(started.length, 0)
  const ok = await call('generate_speech', { model: 'gemini-3.8-flash-tts', text: 'Hi.', instructions: 'speak slowly' })
  assert.equal(ok.ok, true, ok.ok ? '' : ok.error)
  assert.equal(started[0]!.instructions, 'speak slowly')
})

test('with no key the call is refused with where to set it, and a dry run reports it blocked', async () => {
  const refused = await call('generate_speech', { model: 'eleven_multilingual_v2', text: 'Hi.' })
  assert.equal(refused.ok, false)
  assert.match(refused.ok ? '' : refused.error, /No ElevenLabs key is set.*Preferences › AI providers.*never takes keys in chat/)
  const dry = value(await call('generate_speech', { model: 'eleven_multilingual_v2', text: 'Hi.', validateOnly: true }))
  assert.equal(dry.keySet, false)
  assert.match(String(dry.blocked), /No ElevenLabs key is set/)
  assert.equal(started.length, 0)
})

test('track_generation: a landed voiceover is imported and placed on an audio track at the frame, in one undo step', async () => {
  await call('generate_speech', { model: 'gpt-4o-mini-tts', text: 'Welcome to the launch.' })
  const running = await call('track_generation', { jobId: 'job-1' })
  assert.match(String(value(running).next), /again in 15–30 seconds/)
  assert.equal(imported.length, 0)

  Object.assign(jobs[0]!, { status: 'done', outputPath: '/data/generated/welcome-abc.mp3', findings: [] })
  const pastBefore = useEditor.getState().past.length
  const done = await call('track_generation', { jobId: 'job-1', place: true, atFrame: 45 })
  assert.equal(done.ok, true, done.ok ? '' : done.error)
  assert.equal(useEditor.getState().past.length, pastBefore + 1, 'import and place are one undo step')
  const v = value(done)
  assert.equal(v.measuredSeconds, 2.5)
  assert.equal(v.estimatedSeconds, started[0]!.estimatedSeconds)
  assert.equal((v.asset as Record<string, unknown>).kind, 'audio')
  const tracks = useEditor.getState().project.timelines[0]!.tracks
  const holding = tracks.filter((t) => t.items.some((i) => i.assetId === 'voice1'))
  assert.equal(holding.length, 1)
  assert.equal(holding[0]!.kind, 'audio', 'a voiceover goes on an audio track')
  const item = holding[0]!.items.find((i) => i.assetId === 'voice1')!
  assert.equal(item.from, 45)
  assert.equal(item.durationInFrames, Math.round(2.5 * fps()))

  // Asked again once it is placed: no second copy, and still the measured length beside the estimate.
  const again = value(await call('track_generation', { jobId: 'job-1', place: true, atFrame: 45 }))
  assert.equal(again.placed, false)
  assert.match(String(again.note), /Already imported and on the timeline/)
  assert.equal(again.measuredSeconds, 2.5)
  assert.equal(again.estimatedSeconds, started[0]!.estimatedSeconds)
  assert.equal(useEditor.getState().past.length, pastBefore + 1, 'the second look changed nothing')

  // One undo takes back the placement and the import together.
  useEditor.getState().undo()
  const after = useEditor.getState().project
  assert.equal(after.assets.some((a) => a.id === 'voice1'), false)
  assert.equal(after.timelines[0]!.tracks.some((t) => t.items.some((i) => i.assetId === 'voice1')), false)
})

test('track_generation: a voiceover aimed at a video track is imported, not placed, and says how to retry', async () => {
  await call('generate_speech', { model: 'gpt-4o-mini-tts', text: 'Hi.' })
  Object.assign(jobs[0]!, { status: 'done', outputPath: '/data/generated/hi-abc.mp3', findings: [] })
  const videoTrack = useEditor.getState().project.timelines[0]!.tracks.find((t) => t.kind === 'video')
  assert.ok(videoTrack, 'the empty project has a video track to aim at')
  const result = await call('track_generation', { jobId: 'job-1', place: true, trackId: videoTrack.id })
  assert.equal(result.ok, true)
  assert.match(String(value(result).next), /imported but was not placed: .*needs a audio track.*Retry with place_asset/)
  assert.ok(useEditor.getState().project.assets.some((a) => a.id === 'voice1'))
})

test('estimate_speech: seconds, frames and whether it fits; a bad pace or speed is refused with what is taken', async () => {
  const pastBefore = useEditor.getState().past.length
  const result = await call('estimate_speech', { text: TEXT, targetSeconds: 3 })
  assert.equal(result.ok, true, result.ok ? '' : result.error)
  const v = value(result)
  const expected = estimateSpeech(TEXT)
  assert.equal(v.seconds, expected.seconds)
  assert.equal(v.frames, Math.round(expected.seconds * fps()))
  assert.equal(v.syllables, expected.units)
  const target = v.target as Record<string, unknown>
  assert.equal(target.fits, false)
  assert.equal(target.overBySeconds, Math.round((expected.seconds - 3) * 100) / 100)
  assert.match(String(v.next), /syllables too long at a normal pace\. Cut words, or ask for a faster pace/)
  // Positive control: a target it fits says so, with the spare time.
  const roomy = value(await call('estimate_speech', { text: TEXT, targetSeconds: 10 }))
  assert.equal((roomy.target as Record<string, unknown>).fits, true)
  assert.equal(roomy.next, undefined)

  const bad = await call('estimate_speech', { text: TEXT, pace: 'brisk' })
  assert.equal(bad.ok, false)
  assert.match(bad.ok ? '' : bad.error, /"pace" must be one of "slow", "normal" or "fast", but got "brisk"/)
  const slow = await call('estimate_speech', { text: TEXT, speed: 0 })
  assert.equal(slow.ok, false)
  assert.match(slow.ok ? '' : slow.error, /speed must be a positive number \(1 is the voice’s own pace\), not 0/)
  assert.equal((await call('estimate_speech', { text: TEXT, pace: 'fast' })).ok, true)
  assert.equal(useEditor.getState().past.length, pastBefore, 'an estimate is not an edit')
})
