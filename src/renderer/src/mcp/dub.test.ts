/**
 * `plan_dub`, `apply_dub` and `track_dub` through the real executor, with main stubbed on
 * `window.bay` — including a spend guard that behaves like main's (`spendRefusal` on every start).
 *
 * The promises: the plan is sentence cues with slots and changes nothing; an over-long line is
 * refused by name before anything is spent; a dry run prices the whole dub and starts nothing;
 * the budget is checked for the whole dub and lines start within the jobs-at-once limit; and when
 * they land, placement, tempo fitting and ducking are one undo step that undo takes back whole.
 */

import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project } from '@shared/project'
import { spendRefusal, type GenerationJob, type GenerationRequest, type GenerationSpending } from '@shared/generation'
import { findSpeechModel, speechCost, validateSpeech } from '@shared/speech'
import type { TranscriptSegment } from '@shared/transcribe'
import { useEditor, emptyProject } from '@/store/editor'
import { executeToolCall } from './index'
import { forgetTranscripts } from './transcribe'
import { forgetDubs } from './dub'

const FPS = 30
const SEGMENTS: TranscriptSegment[] = [
  // whisper's lines are not sentences: the first sentence spans two of them.
  { startSeconds: 0, endSeconds: 1, text: 'Hello there,' },
  { startSeconds: 1, endSeconds: 2, text: 'my friends.' },
  { startSeconds: 2.5, endSeconds: 5, text: 'This is a test of dubbing.' },
  { startSeconds: 8, endSeconds: 9, text: '(music) Bye.' }
]

let spending: GenerationSpending
let jobs: GenerationJob[] = []
const started: GenerationRequest[] = []
/** Measured seconds of the generated file, by the text it speaks. Default 1 s. */
let measured: Record<string, number> = {}

;(globalThis as { window?: unknown }).window = {
  bay: {
    media: {
      transcribe: async () => ({ ok: true, segments: SEGMENTS, model: 'ggml-base.en.bin', language: 'en' }),
      importPaths: async (paths: string[]) =>
        paths.map((path) => {
          const job = jobs.find((j) => j.outputPath === path)!
          const asset: Asset = {
            id: `ast_${job.id}`, kind: 'audio', name: `${job.id}.mp3`, path,
            durationUs: Math.round((measured[job.request.prompt] ?? 1) * 1_000_000),
            width: null, height: null, fps: null, hasAudio: true, hasVideo: false,
            posterPath: null, waveformPath: null, createdAt: 0
          }
          return { asset, reused: false }
        })
    },
    generation: {
      keys: async () => [{ provider: 'openai', set: true, persisted: true }],
      spending: async () => ({ ...spending, active: jobs.filter((j) => j.status === 'running').length }),
      // Main's guard, as main applies it: every start, whoever calls.
      start: async (request: GenerationRequest) => {
        const now = { ...spending, active: jobs.filter((j) => j.status === 'running').length }
        const cost = speechCost(findSpeechModel(request.model)!, request.prompt.length, request.estimatedSeconds ?? 0)
        const refusal = spendRefusal(now, cost)
        if (refusal) return { ok: false, error: refusal }
        started.push(request)
        spending = { ...spending, spentUsd: spending.spentUsd + cost }
        const job: GenerationJob = {
          id: `job${started.length}`, provider: request.provider, model: request.model, kind: 'speech',
          status: 'running', request, createdAt: Date.now(), updatedAt: Date.now()
        }
        jobs.push(job)
        return { ok: true, job, spending: { ...spending, active: now.active + 1 } }
      },
      job: async (id: string) => jobs.find((j) => j.id === id) ?? null,
      jobs: async () => jobs
    }
  }
}

/** Every running job lands, with a file named after it. */
function finishAll(): void {
  for (const job of jobs) {
    if (job.status === 'running') Object.assign(job, { status: 'done', outputPath: `/generated/${job.id}.mp3` })
  }
}

function seed(): void {
  const project: Project = emptyProject()
  const tl = project.timelines[0]!
  assert.equal(tl.fps, FPS, 'the fixture assumes a 30 fps timeline')
  const talk: Asset = {
    id: 'talk', kind: 'video', name: 'talk.mp4', path: '/footage/talk.mp4', durationUs: 20_000_000,
    width: 1920, height: 1080, fps: FPS, hasAudio: true, hasVideo: true, posterPath: null,
    waveformPath: null, createdAt: 0
  }
  const clip: Item = {
    id: 'clip', assetId: 'talk', trackId: tl.tracks[0]!.id, from: 0, durationInFrames: 300,
    sourceStartUs: 0, layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
  }
  project.assets.push(talk)
  tl.tracks[0]!.items.push(clip)
  useEditor.getState().enterProject(project)
}

beforeEach(() => {
  forgetTranscripts()
  forgetDubs()
  spending = { spentUsd: 0, budgetUsd: 5, active: 0, maxActive: 3 }
  jobs = []
  started.length = 0
  measured = {}
  seed()
})

const call = (tool: string, args: Record<string, unknown>) => executeToolCall({ id: tool, tool, args })
const value = (result: Awaited<ReturnType<typeof call>>): Record<string, unknown> => {
  assert.ok(result.ok, result.ok ? '' : result.error)
  return result.value as Record<string, unknown>
}
const errorOf = (result: Awaited<ReturnType<typeof call>>): string => {
  assert.equal(result.ok, false, 'the call must be refused')
  return result.ok ? '' : result.error
}
const state = () => useEditor.getState()
const past = () => state().past.length

const LINES = {
  c1: 'Hola, amigos.',
  c2: 'Esto es una prueba de doblaje.',
  c3: 'Adiós.'
}
const translations = (overrides: Partial<Record<keyof typeof LINES, string>> = {}) =>
  Object.entries({ ...LINES, ...overrides }).map(([cueId, text]) => ({ cueId, text }))
const BASE = { itemId: 'clip', language: 'es', model: 'gpt-4o-mini-tts' }

test('plan_dub groups whisper lines into sentences with slots, drops sound tags, and changes nothing', async () => {
  const before = past()
  const plan = value(await call('plan_dub', { itemId: 'clip', language: 'es' }))
  const cues = plan.cues as { cueId: string; fromFrame: number; toFrame: number; slotSeconds: number; text: string; budget: string }[]
  assert.deepEqual(
    cues.map((c) => [c.cueId, c.fromFrame, c.toFrame, c.slotSeconds, c.text]),
    [
      ['c1', 0, 60, 2.5, 'Hello there, my friends.'],
      // Next cue at 240 is far: the slot stops at the gap tolerance past its end.
      ['c2', 75, 150, 4, 'This is a test of dubbing.'],
      // The last runs to the clip's end at most.
      ['c3', 240, 270, 2, 'Bye.']
    ]
  )
  assert.match(cues[0]!.budget, /^about \d+ syllables$/)
  assert.ok((plan.instructions as string[]).some((rule) => /3 cues before and after/.test(rule)))
  assert.ok((plan.instructions as string[]).some((rule) => /add(s)? no (new )?facts/.test(rule)))
  assert.equal(past(), before, 'a plan is not an edit')
})

test('a range narrows the cues; the same call without it returns them all', async () => {
  const ranged = value(await call('plan_dub', { itemId: 'clip', language: 'es', fromFrame: 70, toFrame: 200 }))
  assert.deepEqual((ranged.cues as { cueId: string; text: string }[]).map((c) => c.text), ['This is a test of dubbing.'])
  const whole = value(await call('plan_dub', { itemId: 'clip', language: 'es' }))
  assert.equal((whole.cues as unknown[]).length, 3)
})

test('an over-long line is refused by name with its overage and cut, and nothing starts; the fitting lines pass', async () => {
  const long = 'Adiós a todos, muchas gracias por ver este vídeo hasta el final y nos vemos pronto.'
  const refused = errorOf(await call('apply_dub', { ...BASE, translations: translations({ c3: long }) }))
  assert.match(refused, /1 of 3 translated lines will not fit its slot/)
  assert.match(refused, /c3: estimated [\d.]+s for a 2s slot — [\d.]+s over \(needs [\d.]+×; bay speeds a line up to 1\.25×\)\. Cut about \d+ characters \(to \d+ or fewer\)/)
  assert.doesNotMatch(refused, /c1:|c2:/)
  assert.equal(started.length, 0, 'nothing may be generated for a refused dub')
  // Positive control: the same call with the short line passes validation.
  const dry = value(await call('apply_dub', { ...BASE, translations: translations(), validateOnly: true }))
  assert.equal(dry.valid, true)
})

test('every cue needs a line unless partial; unknown ids are named with the real ones', async () => {
  const missing = errorOf(await call('apply_dub', { ...BASE, translations: translations().slice(0, 2), validateOnly: true }))
  assert.match(missing, /1 cue has no translation: c3\..*partial: true/)
  const unknown = errorOf(await call('apply_dub', { ...BASE, translations: [...translations(), { cueId: 'c9', text: 'x' }], validateOnly: true }))
  assert.match(unknown, /no cue c9 in this plan; its cues are c1, c2, c3/)
  const partial = value(await call('apply_dub', { ...BASE, translations: translations().slice(0, 2), partial: true, validateOnly: true }))
  assert.equal(partial.lines, 2)
})

test('validateOnly returns the whole plan and its total cost, and starts nothing', async () => {
  const before = past()
  const dry = value(await call('apply_dub', { ...BASE, translations: translations(), validateOnly: true }))
  const expected = Object.values(LINES).reduce((sum, text) => {
    const checked = validateSpeech({ model: 'gpt-4o-mini-tts', text, language: 'es' })
    assert.ok(checked.ok)
    return sum + checked.estimatedCostUsd
  }, 0)
  assert.equal(dry.totalEstimatedCostUsd, Math.round(expected * 10000) / 10000)
  assert.ok((dry.totalEstimatedCostUsd as number) > 0)
  assert.deepEqual((dry.plan as { cueId: string }[]).map((p) => p.cueId), ['c1', 'c2', 'c3'])
  assert.equal(dry.track, 'Dub (es)')
  assert.equal(dry.blocked, undefined)
  assert.equal(started.length, 0, 'a dry run must not start a paid job')
  assert.equal(past(), before)
})

test('the session budget is checked for the whole dub: refused with nothing started; with room, it starts', async () => {
  // Room for one line's cost but not three: a guard applied per line would start some of them.
  const dry = value(await call('apply_dub', { ...BASE, translations: translations(), validateOnly: true }))
  const total = dry.totalEstimatedCostUsd as number
  spending = { ...spending, spentUsd: 5 - total / 2 }
  const dryBlocked = value(await call('apply_dub', { ...BASE, translations: translations(), validateOnly: true }))
  assert.match(String(dryBlocked.blocked), /past its limit/)
  const refused = errorOf(await call('apply_dub', { ...BASE, translations: translations() }))
  assert.match(refused, /The whole dub \(3 lines\) is estimated at .*past its limit.*Settings › Providers/)
  assert.equal(started.length, 0)

  spending = { ...spending, spentUsd: 0 }
  const ok = value(await call('apply_dub', { ...BASE, translations: translations() }))
  assert.equal(started.length, 3)
  assert.match(String(ok.next), /track_dub \{ dubId: "dub-/)
})

test('lines start within the jobs-at-once limit, the rest as slots free, and placement is one undo step', async () => {
  spending = { ...spending, maxActive: 2 }
  // c2 lands a little long (sped up quietly), c1 long enough to warn, c3 far too long to place.
  measured = { [LINES.c1]: 2.5 * 1.3, [LINES.c2]: 4 * 1.2, [LINES.c3]: 2 * 1.6 }
  const applied = value(await call('apply_dub', { ...BASE, translations: translations() }))
  assert.equal(applied.running, 2)
  assert.equal(applied.queued, 1)
  assert.equal(started.length, 2)

  const before = past()
  const projectBefore = JSON.stringify(state().project.timelines)
  const dubId = String(applied.dubId)
  const generating = value(await call('track_dub', { dubId }))
  assert.equal(generating.status, 'generating')
  assert.equal(started.length, 2, 'no slot is free while two run')

  finishAll()
  const second = value(await call('track_dub', { dubId }))
  assert.equal(second.status, 'generating', 'the queued line starts once a slot frees')
  assert.equal(started.length, 3)
  assert.equal(past(), before, 'nothing is placed until every line has landed')

  finishAll()
  const placed = value(await call('track_dub', { dubId }))
  assert.equal(placed.status, 'placed')
  assert.equal(past() - before, 1, 'placement, fitting and ducking are one undo step')

  const tl = state().project.timelines[0]!
  const dub = tl.tracks.find((t) => t.name === 'Dub (es)')
  assert.ok(dub, 'a Dub (es) audio track is made')
  assert.equal(dub.kind, 'audio')
  assert.deepEqual(
    dub.items.map((i) => [i.from, i.speed, i.durationInFrames]),
    [
      [0, 1.3, 75],
      [75, 1.2, 120]
    ]
  )
  assert.equal((placed.warnings as string[]).length, 1)
  assert.match((placed.warnings as string[])[0]!, /^c1 plays at 1\.3×/)
  assert.match((placed.refused as string[])[0]!, /^c3: generated 3\.2s for a 2s slot \(needs 1\.6×, beyond the 1\.4× bay allows\)\. Cut about \d+ characters/)
  assert.match(String(placed.next), /Rewrite or retry c3 .*partial: true/)
  assert.deepEqual((placed.captionCues as { fromFrame: number; text: string }[]).map((c) => [c.fromFrame, c.text]), [[0, LINES.c1], [75, LINES.c2]])

  const clip = tl.tracks.flatMap((t) => t.items).find((i) => i.id === 'clip')!
  assert.deepEqual(clip.duck, { keyTrackId: dub.id, amountDb: 18, attackFrames: 8, releaseFrames: 15 })

  // Polling again returns the same result and places nothing twice.
  const again = value(await call('track_dub', { dubId }))
  assert.equal(again.status, 'placed')
  assert.equal(past() - before, 1)

  state().undo()
  assert.equal(JSON.stringify(state().project.timelines), projectBefore, 'one undo takes the whole placement back')
})

test('mute sets the detached sound silent rather than the picture, and keep leaves it alone', async () => {
  // Detach the clip's sound: the audio item is where its level now lives.
  state().detachAudio(['clip'])
  const audioItem = () => state().project.timelines[0]!.tracks.flatMap((t) => t.items).find((i) => i.linkId && i.id !== 'clip')!
  assert.ok(audioItem(), 'the fixture must have a detached audio item')
  const applied = value(await call('apply_dub', { ...BASE, translations: translations(), original: 'mute' }))
  finishAll()
  value(await call('track_dub', { dubId: applied.dubId }))
  assert.equal(audioItem().volume, 0)
  const clip = state().project.timelines[0]!.tracks.flatMap((t) => t.items).find((i) => i.id === 'clip')!
  assert.equal(clip.volume, 1, 'the picture item is not the sound, so it is left alone')

  const kept = value(await call('apply_dub', { ...BASE, translations: translations(), original: 'keep', partial: true }))
  const before = JSON.stringify(audioItem())
  finishAll()
  const result = value(await call('track_dub', { dubId: kept.dubId }))
  assert.match(String(result.replaced), /3 earlier dub line/, 'dubbing again replaces the lines rather than stacking')
  assert.equal(JSON.stringify(audioItem()), before)
})

test('a failed line is reported and the rest are placed', async () => {
  const applied = value(await call('apply_dub', { ...BASE, translations: translations() }))
  Object.assign(jobs[1]!, { status: 'failed', error: 'provider said no' })
  finishAll()
  const placed = value(await call('track_dub', { dubId: applied.dubId }))
  assert.equal(placed.placed, 2)
  assert.deepEqual(placed.failedLines, ['c2: provider said no'])
  assert.match(String(placed.next), /retry c2/)
})

test('an unknown dubId names the dubs there are', async () => {
  const applied = value(await call('apply_dub', { ...BASE, translations: translations() }))
  assert.match(errorOf(await call('track_dub', { dubId: 'dub-nope' })), new RegExp(`Dubs: ${String(applied.dubId)}`))
})
