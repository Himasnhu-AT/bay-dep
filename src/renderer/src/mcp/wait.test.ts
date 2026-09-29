/**
 * The status tools wait instead of being polled (`./wait.ts`).
 *
 * Measured before (2026-09-28): the in-app agent called `track_export` 176 times while a 62 s
 * export rendered, every answer in its context — a $11.89 turn. A model cannot sleep, so the
 * tool holds its answer until the job settles. What must hold, each against the real executor
 * with main stubbed on `window.bay`:
 *
 * - the wait ends the moment the job finishes, not when the wait runs out;
 * - a job still running at the cap comes back in progress, saying to call again with waitSeconds;
 * - a cancelled call (main's `mcpToolCancel`: the caller's socket closed) stops waiting at once;
 * - waits do not hold up each other or any other tool, and do not count as the agent acting.
 *
 * Every timing bound is loose on the fast side and far from the slow one: the failure each guards
 * is a wait of seconds, not milliseconds.
 */

import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { ExportProgress, ExportRequest } from '@shared/ipc'
import type { GenerationJob } from '@shared/generation'
import type { Asset, Item, Project } from '@shared/project'
import { emptyProject, useEditor } from '@/store/editor'
import { agentActingDepth } from '@/store/agent-turns'
import { cancelToolCall, executeToolCall } from './index'
import { forgetJobsForTest, recordJobForTest } from './exports'
import { setCeilingForTest, waitSecondsOf } from './wait'
import { WAIT_CEILING_SECONDS } from '@shared/tools/fields'

// A reload keeps sessionStorage and loses module state; this stands in for the storage.
const session = new Map<string, string>()
;(globalThis as { sessionStorage?: unknown }).sessionStorage = {
  getItem: (key: string) => session.get(key) ?? null,
  setItem: (key: string, value: string) => void session.set(key, value)
}

let emit: ((update: ExportProgress) => void) | null = null
let nextExport = 0
const cancels: string[] = []
let genJobs: GenerationJob[] = []
;(globalThis as { window?: unknown }).window = {
  bay: {
    export: {
      start: async (_request: ExportRequest) => {
        nextExport += 1
        return { jobId: `exp_${nextExport}` }
      },
      onProgress: (listener: (update: ExportProgress) => void) => {
        emit = listener
        return () => undefined
      },
      cancel: async (jobId: string) => {
        cancels.push(jobId)
      }
    },
    generation: {
      job: async (id: string) => genJobs.find((j) => j.id === id) ?? null,
      jobs: async () => genJobs
    },
    media: {
      importPaths: async (paths: string[]) =>
        paths.map((path) => ({ asset: { ...SOUND, id: 'generated', name: 'gen.png', kind: 'image', path, hasAudio: false, hasVideo: true, width: 64, height: 64 }, reused: false }))
    }
  }
}

const SOUND: Asset = {
  id: 'snd', kind: 'audio', name: 'vo.wav', path: '/m/vo.wav', durationUs: 10_000_000, width: 0, height: 0,
  fps: 0, hasAudio: true, hasVideo: false, posterPath: null, waveformPath: null, createdAt: 0
}

beforeEach(() => {
  const project: Project = emptyProject()
  project.assets = [SOUND]
  const audio = project.timelines[0]!.tracks.find((t) => t.kind === 'audio')!
  const item: Item = {
    id: 'itm_vo', assetId: 'snd', trackId: audio.id, from: 0, durationInFrames: 90, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
  }
  audio.items = [item]
  useEditor.getState().enterProject(project)
  genJobs = []
})

let callCounter = 0
async function call(tool: string, args: Record<string, unknown>, id = `call-${++callCounter}`): Promise<{ value: Record<string, unknown>; ms: number }> {
  const started = Date.now()
  const result = await executeToolCall({ id, tool, args })
  assert.ok(result.ok, result.ok ? '' : result.error)
  return { value: result.value as Record<string, unknown>, ms: Date.now() - started }
}

const RUNNING: Omit<ExportProgress, 'jobId'> = { progress: 0.4, framesDone: 36, framesTotal: 90, stage: 'rendering' }
const DONE: Omit<ExportProgress, 'jobId'> = { progress: 1, framesDone: 90, framesTotal: 90, stage: 'done', outputPath: '/tmp/a.mp4', findings: [] }

test('track_export answers the moment the export finishes, not when the wait runs out', { timeout: 10_000 }, async () => {
  const finish = recordJobForTest('job-early', RUNNING)
  setTimeout(() => finish(DONE), 150)
  const { value, ms } = await call('track_export', { jobId: 'job-early', waitSeconds: 5 })
  assert.equal(value.stage, 'done')
  assert.equal(value.finished, true)
  assert.equal(value.complete, true)
  assert.ok(ms >= 100 && ms < 1500, `answered after ${ms} ms; the job finished at 150 ms of a 5 s wait`)
  assert.ok(typeof value.waited === 'number' && value.waited < 1.5, `waited ${String(value.waited)}s`)
  assert.equal(value.note, undefined, 'a finished export has nothing to call again for')
})

test('an already-finished export costs no wait at all', { timeout: 10_000 }, async () => {
  recordJobForTest('job-finished', DONE)
  const { value, ms } = await call('track_export', { jobId: 'job-finished', waitSeconds: 60 })
  assert.equal(value.stage, 'done')
  assert.ok(ms < 200, `answered after ${ms} ms`)
  assert.equal(value.waited, 0)
})

test('a job still running when the bound runs out comes back in progress, naming the call that keeps waiting', { timeout: 10_000 }, async () => {
  recordJobForTest('job-slow', RUNNING)
  const { value, ms } = await call('track_export', { jobId: 'job-slow', waitSeconds: 0.6 })
  assert.equal(value.finished, false)
  assert.equal(value.stage, 'rendering')
  assert.equal(value.percent, 40)
  assert.ok(ms >= 550 && ms < 2000, `answered after ${ms} ms of a 0.6 s wait`)
  assert.match(String(value.note), /^Still rendering at 40% after 0\.\ds\. Call track_export \{ jobId: "job-slow" \} to keep waiting/)
  assert.doesNotMatch(String(value.note), /poll/i)
  // The control: waitSeconds 0 is one look.
  const once = await call('track_export', { jobId: 'job-slow', waitSeconds: 0 })
  assert.equal(once.value.finished, false)
  assert.ok(once.ms < 200, `waitSeconds 0 answered after ${once.ms} ms`)
})

test('with no waitSeconds the wait runs to the 30-minute ceiling; past the ceiling is refused, the ceiling itself accepted', { timeout: 10_000 }, async () => {
  // Waiting until the job finishes is the default, not an option the agent must know to pass.
  assert.equal(WAIT_CEILING_SECONDS, 1800)
  assert.equal(waitSecondsOf({}), WAIT_CEILING_SECONDS)
  assert.equal(waitSecondsOf({ waitSeconds: 0 }), 0)
  recordJobForTest('job-capped', DONE)
  const refused = await executeToolCall({ id: 'cap', tool: 'track_export', args: { jobId: 'job-capped', waitSeconds: 5000 } })
  assert.equal(refused.ok, false)
  assert.match(refused.ok ? '' : refused.error, /waitSeconds/)
  assert.match(refused.ok ? '' : refused.error, /1800/)
  const ok = await call('track_export', { jobId: 'job-capped', waitSeconds: 1800 })
  assert.equal(ok.value.stage, 'done')
})

test('a cancelled call stops waiting at once and says the job is still running', { timeout: 10_000 }, async () => {
  recordJobForTest('job-abandoned', RUNNING)
  setTimeout(() => cancelToolCall('the-call'), 150)
  const { value, ms } = await call('track_export', { jobId: 'job-abandoned', waitSeconds: 60 }, 'the-call')
  assert.ok(ms < 1500, `a cancelled wait answered after ${ms} ms`)
  assert.equal(value.finished, false)
  assert.match(String(value.note), /cancelled; the job itself is rendering at 40% and was not touched/)
  // The control: cancelling some other call's id does not stop this one early.
  recordJobForTest('job-other', RUNNING)
  setTimeout(() => cancelToolCall('not-this-call'), 50)
  const kept = await call('track_export', { jobId: 'job-other', waitSeconds: 0.5 }, 'this-call')
  assert.ok(kept.ms >= 450, `a cancel for another call cut this wait to ${kept.ms} ms`)
})

test('concurrent waits run side by side, and another tool answers while they wait', { timeout: 10_000 }, async () => {
  // The first wait never ends early; the two behind it finish at 0.2 and 0.3 s. Queued behind
  // the first, they would answer after its full second.
  recordJobForTest('job-long', RUNNING)
  const finishes = ['job-b', 'job-c'].map((id) => recordJobForTest(id, RUNNING))
  finishes.forEach((finish, i) => setTimeout(() => finish(DONE), 200 + i * 100))
  const long = call('track_export', { jobId: 'job-long', waitSeconds: 1 })
  const quick = ['job-b', 'job-c'].map((jobId) => call('track_export', { jobId, waitSeconds: 10 }))
  // While all three sleep, a read answers at once.
  await new Promise((resolve) => setTimeout(resolve, 50))
  const read = await call('read_project', {})
  assert.ok(read.ms < 150, `read_project took ${read.ms} ms while three waits were pending`)
  const done = await Promise.all(quick)
  assert.deepEqual(done.map((d) => d.value.stage), ['done', 'done'])
  for (const d of done) assert.ok(d.ms < 700, `a wait whose job finished by 0.3 s answered after ${d.ms} ms`)
  assert.equal((await long).value.finished, false)
})

test('time spent waiting is not the agent acting, so the user’s edits meanwhile stay theirs', { timeout: 10_000 }, async () => {
  const finish = recordJobForTest('job-idle', RUNNING)
  let depthDuring = -1
  setTimeout(() => {
    depthDuring = agentActingDepth()
    finish(DONE)
  }, 150)
  assert.equal(agentActingDepth(), 0)
  await call('track_export', { jobId: 'job-idle', waitSeconds: 5 })
  assert.equal(depthDuring, 0, 'the agent counted as acting while track_export slept')
  assert.equal(agentActingDepth(), 0, 'the depth is back where it was after the call')
})

test('export_timeline waits by default and returns the final result; wait: false returns the jobId at once', { timeout: 10_000 }, async () => {
  const quick = call('export_timeline', { outputPath: '/tmp/w.wav', format: 'wav' })
  // The job id is exp_N for the start just made; finish it a little later.
  setTimeout(() => {
    assert.ok(emit, 'export_timeline subscribes to progress')
    emit({ ...DONE, jobId: `exp_${nextExport}`, outputPath: '/tmp/w.wav' })
  }, 150)
  const { value, ms } = await quick
  assert.equal(value.stage, 'done')
  assert.equal(value.outputPath, '/tmp/w.wav')
  assert.equal(value.quality, 'good', 'the start’s own facts stay beside the status')
  assert.ok(ms >= 100 && ms < 1500, `answered after ${ms} ms; the export finished at 150 ms`)
  // The same shape track_export gives at done, so there is nothing left to ask about.
  assert.equal(value.finished, true)
  assert.equal(value.complete, true)
  assert.deepEqual(value.findings, [])
  assert.equal(value.note, undefined)

  const started = await call('export_timeline', { outputPath: '/tmp/x.wav', format: 'wav', wait: false })
  assert.equal(started.value.stage, undefined, 'with wait: false, nothing is waited for')
  assert.match(String(started.value.note), /track_export \{ jobId: "exp_\d+" \} waits until it finishes/)
  assert.ok(started.ms < 200)
})

test('export_timeline at the ceiling returns still rendering with the call that keeps waiting, never a failure', { timeout: 10_000 }, async () => {
  const restore = setCeilingForTest(0.5)
  try {
    const pending = call('export_timeline', { outputPath: '/tmp/long.wav', format: 'wav' })
    setTimeout(() => emit?.({ ...RUNNING, jobId: `exp_${nextExport}` }), 100)
    const { value, ms } = await pending
    assert.ok(ms >= 450 && ms < 2000, `answered after ${ms} ms of a 0.5 s ceiling`)
    assert.equal(value.finished, false)
    assert.equal(value.jobId, `exp_${nextExport}`)
    assert.match(String(value.note), /^Still rendering at 40% after 0\.\ds\. Call track_export \{ jobId: "exp_\d+" \} to keep waiting/)
  } finally {
    restore()
  }
})

test('cancelling export_timeline stops only the wait: the export is not cancelled and track_export still follows it', { timeout: 10_000 }, async () => {
  cancels.length = 0
  const pending = call('export_timeline', { outputPath: '/tmp/abandoned.wav', format: 'wav' }, 'export-call')
  setTimeout(() => {
    emit?.({ ...RUNNING, jobId: `exp_${nextExport}` })
    cancelToolCall('export-call')
  }, 150)
  const { value, ms } = await pending
  assert.ok(ms < 1500, `a cancelled export_timeline answered after ${ms} ms`)
  assert.equal(value.finished, false)
  assert.match(String(value.note), /cancelled; the job itself is rendering at 40% and was not touched/)
  assert.deepEqual(cancels, [], 'the export itself must not be cancelled')
  // The job lives on: a later track_export sees it finish.
  const jobId = String(value.jobId)
  setTimeout(() => emit?.({ ...DONE, jobId }), 100)
  const later = await call('track_export', { jobId })
  assert.equal(later.value.stage, 'done')
})

test('track_generation waits for main’s job to land, then imports it', { timeout: 10_000 }, async () => {
  const job: GenerationJob = {
    id: 'gen-1', provider: 'openai', model: 'gpt-image-1', kind: 'image', status: 'running',
    request: { provider: 'openai', model: 'gpt-image-1', kind: 'image', prompt: 'x' } as GenerationJob['request'],
    createdAt: Date.now(), updatedAt: Date.now()
  }
  genJobs = [job]
  setTimeout(() => {
    genJobs = [{ ...job, status: 'done', outputPath: '/tmp/gen.png', findings: [] }]
  }, 300)
  const { value, ms } = await call('track_generation', { jobId: 'gen-1', waitSeconds: 20 })
  assert.equal(value.status, 'done')
  assert.equal((value.asset as { id?: string } | undefined)?.id, 'generated')
  // Main is asked every 2 s, so it lands on the next look after 300 ms.
  assert.ok(ms < 3500, `answered after ${ms} ms; the job landed at 300 ms of a 20 s wait`)

  // Still running at the cap: in progress, with the call to make next.
  genJobs = [{ ...job, id: 'gen-2' }]
  const running = await call('track_generation', { jobId: 'gen-2', waitSeconds: 0.3 })
  assert.equal(running.value.status, 'running')
  assert.match(String(running.value.next), /^Still running after 0\.\ds\. Call track_generation \{ jobId: "gen-2" \} to keep waiting/)
})

test('track_export after a reload says the export was lost to it; an id never started here is still unknown', { timeout: 10_000 }, async () => {
  recordJobForTest('job-reloaded', RUNNING)
  forgetJobsForTest()
  const lost = await executeToolCall({ id: 'lost', tool: 'track_export', args: { jobId: 'job-reloaded', waitSeconds: 0 } })
  assert.equal(lost.ok, false)
  assert.match(lost.ok ? '' : lost.error, /Export "job-reloaded" was lost when the editor reloaded/)
  assert.match(lost.ok ? '' : lost.error, /Start it again with export_timeline/)
  const never = await executeToolCall({ id: 'never', tool: 'track_export', args: { jobId: 'job-never', waitSeconds: 0 } })
  assert.equal(never.ok, false)
  assert.match(never.ok ? '' : never.error, /No export job "job-never" in this session/)
})

test('a generation main forgets during the wait is reported gone, not still working', { timeout: 10_000 }, async () => {
  const job: GenerationJob = {
    id: 'gen-gone', provider: 'openai', model: 'gpt-image-1', kind: 'image', status: 'running',
    request: { provider: 'openai', model: 'gpt-image-1', kind: 'image', prompt: 'x' } as GenerationJob['request'],
    createdAt: Date.now(), updatedAt: Date.now()
  }
  const other = { ...job, id: 'gen-other', status: 'done' as const }
  genJobs = [job, other]
  setTimeout(() => {
    genJobs = [other]
  }, 300)
  const result = await executeToolCall({ id: 'gone', tool: 'track_generation', args: { jobId: 'gen-gone', waitSeconds: 10 } })
  assert.equal(result.ok, false, 'a job that no longer exists must not come back as a running one')
  const error = result.ok ? '' : result.error
  assert.match(error, /Generation job "gen-gone" is gone/)
  assert.match(error, /nothing was imported/)
  assert.match(error, /Recent jobs: gen-other \(image, done\)/)
  assert.doesNotMatch(error, /Still working/)
})
