/**
 * `plan_dub`, `apply_dub` and `track_dub` through the real executor, with main stubbed on
 * `window.bay` — a spend guard that behaves like main's (`spendRefusalOf` on every start, with
 * reservations drawn from first), and a dub store that keeps what it is given the way main's
 * does, so a "reload" (`forgetDubs`) can be followed by the same dub resuming.
 *
 * The promises: the plan is sentence cues with slots and changes nothing; cue ids name where a
 * cue starts, and a plan that no longer matches the clip is refused; an over-long line is refused
 * by name before anything is spent; a dry run prices the whole dub and starts nothing; the whole
 * dub is reserved with main before any line starts, and a line refused for room waits rather than
 * failing; when the lines land, placement, tempo fitting and ducking are one undo step; a mute is
 * a duck that silences the original under the lines even when its volume is keyframed; an older
 * dub never overwrites a newer one's lines; and a dub survives a reload and an undo.
 */

import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project, Timeline } from '@shared/project'
import { spendRefusalOf, type GenerationJob, type GenerationRequest, type GenerationSpending } from '@shared/generation'
import { itemAudioGainAt } from '@shared/audio-gain'
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

let segments: TranscriptSegment[] = SEGMENTS
let spending: GenerationSpending
let jobs: GenerationJob[] = []
const started: { request: GenerationRequest; reservationId?: string }[] = []
/** Measured seconds of the generated file, by the text it speaks. Default 1 s. */
let measured: Record<string, number> = {}
/** Main's reservations: what is left of each. */
let reservations = new Map<string, number>()
/** Main's dub store. */
let savedDubs = new Map<string, unknown>()
/** How many starts main refuses for room regardless of the count (another tool got there first). */
let roomRefusals = 0
let reserveRefusal: string | null = null

const reservedUsd = (): number => [...reservations.values()].reduce((sum, n) => sum + n, 0)
const now = (): GenerationSpending => ({ ...spending, active: jobs.filter((j) => j.status === 'running').length, reservedUsd: reservedUsd() })

;(globalThis as { window?: unknown }).window = {
  bay: {
    media: {
      transcribe: async () => ({ ok: true, segments, model: 'ggml-base.en.bin', language: 'en' }),
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
      spending: async () => now(),
      // Main's guard, as main applies it: every start, whoever calls, a reservation drawn first.
      start: async (request: GenerationRequest, options?: { reservationId?: string }) => {
        if (roomRefusals > 0) {
          roomRefusals -= 1
          return { ok: false, reason: 'room', error: '3 generation jobs are already running, and the limit is 3 at once.' }
        }
        const cost = speechCost(findSpeechModel(request.model)!, request.prompt.length, request.estimatedSeconds ?? 0)
        const held = options?.reservationId ? reservations.get(options.reservationId) : undefined
        const covered = held !== undefined ? Math.min(held, cost) : 0
        const refused = spendRefusalOf(now(), cost - covered)
        if (refused) return { ok: false, reason: refused.reason, error: refused.error }
        if (held !== undefined) reservations.set(options!.reservationId!, held - covered)
        started.push({ request, ...(options?.reservationId ? { reservationId: options.reservationId } : {}) })
        spending = { ...spending, spentUsd: spending.spentUsd + cost }
        const job: GenerationJob = {
          id: `job${started.length}`, provider: request.provider, model: request.model, kind: 'speech',
          status: 'running', request, createdAt: Date.now(), updatedAt: Date.now()
        }
        jobs.push(job)
        return { ok: true, job, spending: now() }
      },
      reserve: async (total: number) => {
        if (reserveRefusal) return { ok: false, reason: 'budget', error: reserveRefusal }
        const refused = spendRefusalOf({ ...now(), active: 0 }, total)
        if (refused) return { ok: false, reason: refused.reason, error: refused.error }
        const reservationId = `res${reservations.size + 1}`
        reservations.set(reservationId, total)
        return { ok: true, reservationId, spending: now() }
      },
      release: async (id: string) => {
        reservations.delete(id)
        return now()
      },
      dubs: async () => [...savedDubs.values()].map((d) => structuredClone(d)),
      saveDub: async (record: { id: string }) => {
        savedDubs.set(record.id, structuredClone(record))
        return { ok: true }
      },
      job: async (id: string) => jobs.find((j) => j.id === id) ?? null,
      jobs: async () => jobs
    }
  }
}

/** Every running job lands (or just the ones named), with a file named after it. */
function finish(ids?: string[]): void {
  for (const job of jobs) {
    if (job.status === 'running' && (!ids || ids.includes(job.id))) Object.assign(job, { status: 'done', outputPath: `/generated/${job.id}.mp3` })
  }
}
const finishAll = (): void => finish()

function seed(patch: Partial<Item> | ((timeline: Timeline) => Partial<Item>) = {}): void {
  const project: Project = emptyProject()
  const tl = project.timelines[0]!
  const clipPatch = typeof patch === 'function' ? patch(tl) : patch
  assert.equal(tl.fps, FPS, 'the fixture assumes a 30 fps timeline')
  const talk: Asset = {
    id: 'talk', kind: 'video', name: 'talk.mp4', path: '/footage/talk.mp4', durationUs: 20_000_000,
    width: 1920, height: 1080, fps: FPS, hasAudio: true, hasVideo: true, posterPath: null,
    waveformPath: null, createdAt: 0
  }
  const clip: Item = {
    id: 'clip', assetId: 'talk', trackId: tl.tracks[0]!.id, from: 0, durationInFrames: 300,
    sourceStartUs: 0, layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1,
    ...clipPatch
  }
  project.assets.push(talk)
  tl.tracks[0]!.items.push(clip)
  useEditor.getState().enterProject(project)
}

beforeEach(() => {
  forgetTranscripts()
  forgetDubs()
  segments = SEGMENTS
  spending = { spentUsd: 0, budgetUsd: 5, active: 0, maxActive: 3 }
  jobs = []
  started.length = 0
  measured = {}
  reservations = new Map()
  savedDubs = new Map()
  roomRefusals = 0
  reserveRefusal = null
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
const tl = () => state().project.timelines[0]!
const itemById = (id: string) => tl().tracks.flatMap((t) => t.items).find((i) => i.id === id)
const dubTrack = () => tl().tracks.find((t) => t.name === 'Dub (es)')

const LINES = {
  'c@0': 'Hola, amigos.',
  'c@75': 'Esto es una prueba de doblaje.',
  'c@240': 'Adiós.'
}
type CueId = keyof typeof LINES
const translations = (overrides: Partial<Record<CueId, string>> = {}) =>
  Object.entries({ ...LINES, ...overrides }).map(([cueId, text]) => ({ cueId, text }))
const BASE = { itemId: 'clip', language: 'es', model: 'gpt-4o-mini-tts' }

test('plan_dub groups whisper lines into sentences with slots, drops sound tags, and changes nothing', async () => {
  const before = past()
  const plan = value(await call('plan_dub', { itemId: 'clip', language: 'es' }))
  const cues = plan.cues as { cueId: string; fromFrame: number; toFrame: number; slotSeconds: number; text: string; budget: string }[]
  assert.deepEqual(
    cues.map((c) => [c.cueId, c.fromFrame, c.toFrame, c.slotSeconds, c.text]),
    [
      ['c@0', 0, 60, 2.5, 'Hello there, my friends.'],
      // Next cue at 240 is far: the slot stops at the gap tolerance past its end.
      ['c@75', 75, 150, 4, 'This is a test of dubbing.'],
      // The last runs to the clip's end at most.
      ['c@240', 240, 270, 2, 'Bye.']
    ]
  )
  assert.match(String(plan.planId), /^plan-[0-9a-f]{16}$/)
  assert.match(String(plan.next), new RegExp(`planId: "${String(plan.planId)}"`))
  assert.match(cues[0]!.budget, /^about \d+ syllables$/)
  assert.ok((plan.instructions as string[]).some((rule) => /3 cues before and after/.test(rule)))
  assert.ok((plan.instructions as string[]).some((rule) => /add(s)? no (new )?facts/.test(rule)))
  assert.equal(past(), before, 'a plan is not an edit')
})

test('a range narrows the cues and keeps their ids; the same call without it returns them all', async () => {
  const ranged = value(await call('plan_dub', { itemId: 'clip', language: 'es', fromFrame: 70, toFrame: 200 }))
  assert.deepEqual((ranged.cues as { cueId: string; text: string }[]).map((c) => [c.cueId, c.text]), [['c@75', 'This is a test of dubbing.']])
  const whole = value(await call('plan_dub', { itemId: 'clip', language: 'es' }))
  assert.equal((whole.cues as unknown[]).length, 3)
  assert.notEqual(ranged.planId, whole.planId)
})

test('translations checked against a plan the clip no longer matches are refused, naming the cues as they are now', async () => {
  const ranged = value(await call('plan_dub', { itemId: 'clip', language: 'es', fromFrame: 70, toFrame: 200 }))
  // The whole clip is not the plan the translations were written for.
  const stale = errorOf(await call('apply_dub', { ...BASE, planId: ranged.planId, translations: translations(), validateOnly: true }))
  assert.match(stale, new RegExp(`no longer reads as the plan ${String(ranged.planId)} did`))
  assert.match(stale, /Its cues are now c@0 "Hello there, my friends\.", c@75 "This is a test of dubbing\.", c@240 "Bye\."/)
  assert.match(stale, /call plan_dub again/)
  assert.equal(started.length, 0)
  // Positive control: the plan that does match, passed back, is accepted.
  const whole = value(await call('plan_dub', { itemId: 'clip', language: 'es' }))
  const dry = value(await call('apply_dub', { ...BASE, planId: whole.planId, translations: translations(), validateOnly: true }))
  assert.equal(dry.valid, true)
  assert.equal(dry.planId, whole.planId)
})

test('a range that ends mid-sentence ends that sentence\'s slot too', async () => {
  // "This is a test of dubbing." runs 75–150; the range stops at 100.
  const ranged = value(await call('plan_dub', { itemId: 'clip', language: 'es', fromFrame: 70, toFrame: 100 }))
  const cues = ranged.cues as { cueId: string; toFrame: number; slotSeconds: number }[]
  assert.equal(cues[0]!.toFrame, 150, 'the specimen: the cue itself runs past the range')
  assert.equal(cues[0]!.slotSeconds, round2(25 / FPS), 'its line may take only the 25 frames left in the range')
  // Positive control: the whole clip gives it its own length plus the pause after.
  const whole = value(await call('plan_dub', { itemId: 'clip', language: 'es' }))
  assert.equal((whole.cues as { slotSeconds: number }[])[1]!.slotSeconds, 4)
})

const round2 = (n: number): number => Math.round(n * 100) / 100

test('an over-long line is refused by name with its overage and cut, and nothing starts; the fitting lines pass', async () => {
  const long = 'Adiós a todos, muchas gracias por ver este vídeo hasta el final y nos vemos pronto.'
  const refused = errorOf(await call('apply_dub', { ...BASE, translations: translations({ 'c@240': long }) }))
  assert.match(refused, /1 of 3 translated lines will not fit its slot/)
  assert.match(refused, /c@240: estimated [\d.]+s for a 2s slot — [\d.]+s over \(needs [\d.]+×; bay speeds a line up to 1\.25×\)\. Cut about \d+ characters \(to \d+ or fewer\)/)
  assert.doesNotMatch(refused, /c@0:|c@75:/)
  assert.equal(started.length, 0, 'nothing may be generated for a refused dub')
  // Positive control: the same call with the short line passes validation.
  const dry = value(await call('apply_dub', { ...BASE, translations: translations(), validateOnly: true }))
  assert.equal(dry.valid, true)
})

test('every cue needs a line unless partial; unknown ids are named with the real ones', async () => {
  const missing = errorOf(await call('apply_dub', { ...BASE, translations: translations().slice(0, 2), validateOnly: true }))
  assert.match(missing, /1 cue has no translation: c@240\..*partial: true/)
  const unknown = errorOf(await call('apply_dub', { ...BASE, translations: [...translations(), { cueId: 'c3', text: 'x' }], validateOnly: true }))
  assert.match(unknown, /no cue c3 in this plan; its cues are c@0, c@75, c@240/)
  const partial = value(await call('apply_dub', { ...BASE, translations: translations().slice(0, 2), partial: true, validateOnly: true }))
  assert.equal(partial.lines, 2)
})

test('validateOnly returns the whole plan and its total cost, and starts and reserves nothing', async () => {
  const before = past()
  const dry = value(await call('apply_dub', { ...BASE, translations: translations(), validateOnly: true }))
  const expected = Object.values(LINES).reduce((sum, text) => {
    const checked = validateSpeech({ model: 'gpt-4o-mini-tts', text, language: 'es' })
    assert.ok(checked.ok)
    return sum + checked.estimatedCostUsd
  }, 0)
  assert.equal(dry.totalEstimatedCostUsd, Math.round(expected * 10000) / 10000)
  assert.ok((dry.totalEstimatedCostUsd as number) > 0)
  assert.deepEqual((dry.plan as { cueId: string }[]).map((p) => p.cueId), ['c@0', 'c@75', 'c@240'])
  assert.equal(dry.track, 'Dub (es)')
  assert.equal(dry.blocked, undefined)
  assert.equal(started.length, 0, 'a dry run must not start a paid job')
  assert.equal(reservations.size, 0, 'nor hold any budget')
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
  assert.match(refused, /The whole dub \(3 lines\) is estimated at .*past its limit.*Preferences › AI providers/)
  assert.equal(started.length, 0)

  spending = { ...spending, spentUsd: 0 }
  const ok = value(await call('apply_dub', { ...BASE, translations: translations() }))
  assert.equal(started.length, 3)
  assert.match(String(ok.next), /track_dub \{ dubId: "dub-/)
})

test('the whole dub is held with main before a line starts; its lines draw on the hold; the hold goes once none is left to start', async () => {
  spending = { ...spending, maxActive: 1 }
  const applied = value(await call('apply_dub', { ...BASE, translations: translations() }))
  const total = applied.totalEstimatedCostUsd as number
  assert.equal(started.length, 1)
  assert.equal(started[0]!.reservationId, 'res1', 'the first line starts against the hold')
  assert.ok(reservedUsd() > 0 && reservedUsd() < total, 'what the queued lines need stays held')

  // Meanwhile another tool spends: only what the hold does not cover is free.
  const free = spending.budgetUsd - spending.spentUsd - reservedUsd()
  assert.ok(free < spending.budgetUsd - spending.spentUsd, 'the specimen must hold something back')

  const dubId = String(applied.dubId)
  finishAll()
  value(await call('track_dub', { dubId }))
  finishAll()
  value(await call('track_dub', { dubId }))
  assert.equal(started.length, 3)
  assert.ok(started.every((s) => s.reservationId === 'res1'))
  assert.equal(reservations.size, 0, 'released once every line has started')

  // A hold main refuses refuses the dub, and nothing starts.
  reserveRefusal = 'This call (~$0.01) would take generation spending this session past its limit: $4.99 spent of $5.00.'
  const refused = errorOf(await call('apply_dub', { ...BASE, translations: translations() }))
  assert.match(refused, /The whole dub \(3 lines\) is estimated at \$[\d.]+\. This call .* past its limit/)
  assert.equal(started.length, 3)
})

test('a line main refuses for room stays queued and starts on a later poll; a budget refusal fails it', async () => {
  roomRefusals = 1
  const applied = value(await call('apply_dub', { ...BASE, translations: translations() }))
  assert.deepEqual([applied.running, applied.queued, applied.failed], [0, 3, 0], 'a full room is not a failure')
  const polled = value(await call('track_dub', { dubId: applied.dubId }))
  assert.equal(polled.status, 'generating')
  assert.equal(started.length, 3, 'the waiting lines start once there is room')
  assert.equal(polled.failed, 0)

  // Positive control for the difference: a budget refusal does fail the line and the rest.
  finishAll()
  spending = { ...spending, maxActive: 1 }
  const second = value(await call('apply_dub', { ...BASE, translations: translations() }))
  assert.equal(second.queued, 2)
  // The budget is gone by the time the queued lines try (their hold dropped by hand).
  reservations.clear()
  spending = { ...spending, spentUsd: spending.budgetUsd }
  finishAll()
  const failed = value(await call('track_dub', { dubId: second.dubId }))
  assert.equal(failed.queued, 0)
  assert.ok((failed.failed as number) >= 2 || failed.status === 'placed', JSON.stringify(failed))
  const lines = (failed.failedLines as string[] | undefined) ?? []
  assert.match(lines.join(' '), /past its limit/)
})

test('lines start within the jobs-at-once limit, the rest as slots free, and placement is one undo step', async () => {
  spending = { ...spending, maxActive: 2 }
  // c@75 lands a little long (sped up quietly), c@0 long enough to warn, c@240 far too long to place.
  measured = { [LINES['c@0']]: 2.5 * 1.3, [LINES['c@75']]: 4 * 1.2, [LINES['c@240']]: 2 * 1.6 }
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

  const dub = dubTrack()
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
  assert.match((placed.warnings as string[])[0]!, /^c@0 plays at 1\.3×/)
  assert.match((placed.refused as string[])[0]!, /^c@240: generated 3\.2s for a 2s slot \(needs 1\.6×, beyond the 1\.4× bay allows\)\. Cut about \d+ characters/)
  assert.match(String(placed.next), /Rewrite or retry c@240 .*partial: true/)
  assert.deepEqual((placed.captionCues as { fromFrame: number; text: string }[]).map((c) => [c.fromFrame, c.text]), [[0, LINES['c@0']], [75, LINES['c@75']]])

  assert.deepEqual(itemById('clip')!.duck, { keyTrackId: dub.id, amountDb: 18, attackFrames: 8, releaseFrames: 15 })

  // Polling again returns the same result and places nothing twice.
  const again = value(await call('track_dub', { dubId }))
  assert.equal(again.status, 'placed')
  assert.equal(past() - before, 1)

  state().undo()
  assert.equal(JSON.stringify(state().project.timelines), projectBefore, 'one undo takes the whole placement back')
})

test('an undone placement is placed again by the next poll, from the files already generated', async () => {
  const applied = value(await call('apply_dub', { ...BASE, translations: translations() }))
  finishAll()
  value(await call('track_dub', { dubId: applied.dubId }))
  assert.equal(dubTrack()?.items.length, 3)
  const paid = started.length
  state().undo()
  assert.equal(dubTrack()?.items.length ?? 0, 0, 'the specimen: undo took the lines away')

  const again = value(await call('track_dub', { dubId: applied.dubId }))
  assert.equal(again.status, 'placed')
  assert.match(String(again.note), /placed again from the files already generated — nothing was generated or paid for again/)
  assert.equal(dubTrack()?.items.length, 3)
  assert.equal(started.length, paid, 'no job was started again')

  // Positive control: with the lines standing, a poll changes nothing.
  const before = past()
  const same = value(await call('track_dub', { dubId: applied.dubId }))
  assert.match(String(same.note), /^Already placed/)
  assert.equal(past(), before)
})

test('a dub outlives a reload: its queued lines still start and its landed lines are still placed', async () => {
  spending = { ...spending, maxActive: 2 }
  const applied = value(await call('apply_dub', { ...BASE, translations: translations() }))
  assert.equal(applied.queued, 1)
  const dubId = String(applied.dubId)

  forgetDubs() // the window reloads: everything this module held is gone
  finishAll()
  const resumed = value(await call('track_dub', { dubId }))
  assert.equal(resumed.status, 'generating')
  assert.equal(started.length, 3, 'the line queued before the reload starts after it')
  forgetDubs()
  finishAll()
  const placed = value(await call('track_dub', { dubId }))
  assert.equal(placed.status, 'placed')
  assert.equal(dubTrack()?.items.length, 3)
  const listed = value(await call('track_dub', {}))
  assert.deepEqual((listed.dubs as { dubId: string; placed: boolean }[]).map((d) => [d.dubId, d.placed]), [[dubId, true]])

  // Negative control: a dub main never kept is still unknown, and the refusal names the ones there are.
  assert.match(errorOf(await call('track_dub', { dubId: 'dub-nope' })), new RegExp(`There is no dub "dub-nope"\\. Dubs: ${dubId}\\.`))
})

test('an older dub finishing after a newer redo does not overwrite the newer lines, and says so', async () => {
  spending = { ...spending, maxActive: 5 }
  const first = value(await call('apply_dub', { ...BASE, translations: translations(), original: 'keep' }))
  const olderJobs = jobs.map((j) => j.id)
  const redo = value(await call('apply_dub', { ...BASE, translations: [{ cueId: 'c@75', text: 'Esto es otra prueba.' }], partial: true, original: 'keep' }))
  const newerJob = jobs.at(-1)!.id
  // The redo lands and is placed first.
  finish([newerJob])
  const newer = value(await call('track_dub', { dubId: redo.dubId }))
  assert.equal(newer.placed, 1)
  const newerItem = dubTrack()!.items[0]!
  assert.equal(newerItem.assetId, `ast_${newerJob}`)

  // Then the older dub lands.
  finish(olderJobs)
  const older = value(await call('track_dub', { dubId: first.dubId }))
  assert.equal(older.placed, 2)
  assert.deepEqual(older.skippedForNewerDub, [`c@75: not placed — ${String(redo.dubId)}, applied after this dub, already placed a line there.`])
  const items = dubTrack()!.items.map((i) => [i.from, i.assetId])
  assert.deepEqual(items, [[0, `ast_${olderJobs[0]}`], [75, `ast_${newerJob}`], [240, `ast_${olderJobs[2]}`]], 'the newer line stands')
})

test('mute silences the original under each dubbed line — keyframed volume included — and only there', async () => {
  // Volume keys: the static `volume` is not what plays, so setting it to 0 would silence nothing.
  seed({ keyframes: { volume: [{ frame: 0, value: 0.8 }, { frame: 299, value: 0.8 }] } })
  const applied = value(await call('apply_dub', { ...BASE, translations: translations(), original: 'mute' }))
  finishAll()
  const placed = value(await call('track_dub', { dubId: applied.dubId }))
  assert.deepEqual(placed.muted, ['clip'])
  assert.match(String(placed.muteNote), /silenced \(−40 dB\) under each dubbed line/)
  const project = state().project
  const clip = itemById('clip')!
  assert.equal(clip.volume, 1, 'the static volume is left alone')
  // Under the first line (frames 0–29): at most −40 dB of the keyed 0.8.
  const under = itemAudioGainAt(project, tl(), clip, 10)
  assert.ok(under <= 0.8 * 0.0101, `still audible under the dub: ${under}`)
  // Between lines (the second ends at 105, released by 120; the third's attack starts at 232), untouched.
  assert.equal(itemAudioGainAt(project, tl(), clip, 200), 0.8)
})

test('mute on a detached sound silences the audio item, not the picture; keep leaves it alone', async () => {
  state().detachAudio(['clip'])
  const audioItem = () => tl().tracks.flatMap((t) => t.items).find((i) => i.linkId && i.id !== 'clip')!
  assert.ok(audioItem(), 'the fixture must have a detached audio item')
  const applied = value(await call('apply_dub', { ...BASE, translations: translations(), original: 'mute' }))
  finishAll()
  value(await call('track_dub', { dubId: applied.dubId }))
  assert.deepEqual(audioItem().duck, { keyTrackId: dubTrack()!.id, amountDb: 40, attackFrames: 8, releaseFrames: 15 })
  assert.equal(audioItem().volume, 1)
  assert.equal(itemById('clip')!.duck, undefined, 'the picture item is not the sound, so it is left alone')

  const kept = value(await call('apply_dub', { ...BASE, translations: translations(), original: 'keep', partial: true }))
  const before = JSON.stringify(audioItem())
  finishAll()
  const result = value(await call('track_dub', { dubId: kept.dubId }))
  assert.match(String(result.replaced), /3 earlier dub line/, 'dubbing again replaces the lines rather than stacking')
  assert.equal(JSON.stringify(audioItem()), before)
})

test('a duck the original already had is reported as replaced, naming the track it ducked under', async () => {
  // Ducked under another track of the timeline (its last, whatever it is called).
  seed((timeline) => ({ duck: { keyTrackId: timeline.tracks.at(-1)!.id, amountDb: 6, attackFrames: 0, releaseFrames: 0 } }))
  const keyedTo = itemById('clip')!.duck!.keyTrackId
  const keyName = tl().tracks.find((t) => t.id === keyedTo)!.name
  assert.ok(keyName, 'the specimen must be keyed to a named track')
  const applied = value(await call('apply_dub', { ...BASE, translations: translations() }))
  finishAll()
  const placed = value(await call('track_dub', { dubId: applied.dubId }))
  assert.deepEqual(placed.replacedDucks, [`clip was ducked under the track "${keyName}"; that duck was replaced by the dub's. Undo takes it back, or set it again with edit_item.`])

  // Positive control: an original with no duck of its own reports nothing replaced.
  seed()
  forgetDubs()
  const fresh = value(await call('apply_dub', { ...BASE, translations: translations() }))
  finishAll()
  const clean = value(await call('track_dub', { dubId: fresh.dubId }))
  assert.equal(clean.replacedDucks, undefined)
})

test('a failed line is reported and the rest are placed', async () => {
  const applied = value(await call('apply_dub', { ...BASE, translations: translations() }))
  Object.assign(jobs[1]!, { status: 'failed', error: 'provider said no' })
  finishAll()
  const placed = value(await call('track_dub', { dubId: applied.dubId }))
  assert.equal(placed.placed, 2)
  assert.deepEqual(placed.failedLines, ['c@75: provider said no'])
  assert.match(String(placed.next), /retry c@75/)
})

test('placeDub refuses new lines that overlap each other, and places lines that meet end to start', () => {
  const asset: Asset = {
    id: 'line', kind: 'audio', name: 'line.mp3', path: '/g/line.mp3', durationUs: 2_000_000, width: null, height: null,
    fps: null, hasAudio: true, hasVideo: false, posterPath: null, waveformPath: null, createdAt: 0
  }
  const before = past()
  const overlapping = state().placeDub({
    trackName: 'Dub (es)',
    clips: [{ asset, from: 0, durationInFrames: 40, speed: 1 }, { asset, from: 30, durationInFrames: 20, speed: 1 }],
    original: { itemIds: ['clip'], mode: 'keep', amountDb: 18 }
  })
  assert.ok('error' in overlapping)
  assert.match(overlapping.error, /Two dub lines overlap: one at frame 0 runs 40 frames, past the next at 30\. Nothing was placed\./)
  assert.equal(past(), before)
  const meeting = state().placeDub({
    trackName: 'Dub (es)',
    clips: [{ asset, from: 0, durationInFrames: 30, speed: 1 }, { asset, from: 30, durationInFrames: 20, speed: 1 }],
    original: { itemIds: ['clip'], mode: 'keep', amountDb: 18 }
  })
  assert.ok(!('error' in meeting))
  assert.equal(dubTrack()?.items.length, 2)
})
