/**
 * `export_timeline` remembers the delivery decision on the timeline.
 *
 * The bug (2026-09-28): an export mastered to −14.1 LUFS, then a re-export of the same timeline
 * without `loudness`, which came out at −33.4 LUFS — mastering is per call, so the second call
 * silently dropped it. Held still here through the real handler and the real store, with a fake
 * bridge standing in for main: what request reaches `export.start`, and what the timeline keeps.
 * WAV so no frame pump runs; the loudness decision is the same for every format.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ExportProgress, ExportRequest } from '@shared/ipc'
import type { Asset, Item, Project, Timeline } from '@shared/project'
import { emptyProject, useEditor } from '@/store/editor'
import { exportTimeline } from './exports'
import { ToolError } from './helpers'

const requests: ExportRequest[] = []
let emit: ((update: ExportProgress) => void) | null = null
let nextJob = 0
;(globalThis as { window?: unknown }).window = {
  bay: {
    export: {
      start: async (request: ExportRequest) => {
        requests.push(request)
        nextJob += 1
        return { jobId: `job_${nextJob}` }
      },
      onProgress: (listener: (update: ExportProgress) => void) => {
        emit = listener
        return () => undefined
      }
    }
  }
}

const SOUND: Asset = {
  id: 'snd', kind: 'audio', name: 'vo.wav', path: '/m/vo.wav', durationUs: 10_000_000, width: 0, height: 0,
  fps: 0, hasAudio: true, hasVideo: false, posterPath: null, waveformPath: null, createdAt: 0
}

function clip(trackId: string): Item {
  return {
    id: `itm_${trackId}`, assetId: 'snd', trackId, from: 0, durationInFrames: 90, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
  }
}

/** A project of two timelines, each with sound on it; the first is active. */
function load(): { project: Project; first: string; second: string } {
  const project = emptyProject()
  project.assets = [SOUND]
  const first = project.timelines[0]!
  const audio = first.tracks.find((t) => t.kind === 'audio')!
  audio.items = [clip(audio.id)]
  const second: Timeline = structuredClone(first)
  second.id = 'tl_second'
  second.name = 'Cutdown'
  project.timelines.push(second)
  useEditor.getState().setProject(project)
  return { project, first: first.id, second: second.id }
}

const timelineOf = (id: string): Timeline => useEditor.getState().project.timelines.find((t) => t.id === id)!

function finishMastered(jobId: string, target: { integratedLufs: number; truePeakDb: number }): void {
  assert.ok(emit, 'the tool subscribes to progress when it starts a job')
  const measured = { integratedLufs: target.integratedLufs - 0.1, truePeakDb: target.truePeakDb - 0.4 }
  emit({
    jobId, progress: 1, framesDone: 90, framesTotal: 90, stage: 'done', outputPath: '/tmp/news.wav', findings: [],
    loudness: { status: 'met', target, measured, before: { integratedLufs: -33.4, truePeakDb: -12 }, gainDb: 19.3, limiterCeilingDb: -1.5, passes: 2, summary: 'Mastered.' },
    deliveredLoudness: measured
  })
}

const ARGS = { outputPath: '/tmp/news.wav', format: 'wav' }

test('a mastered export is remembered, and the next export without loudness masters to it and says so', async () => {
  const { first, second } = load()
  requests.length = 0

  const mastered = await exportTimeline({ ...ARGS, loudness: 'streaming' })
  assert.deepEqual(requests[0]!.loudness, { integratedLufs: -14, truePeakDb: -1 })
  assert.equal(timelineOf(first).delivery, undefined, 'nothing is remembered before the export succeeds')
  finishMastered(String(mastered.jobId), { integratedLufs: -14, truePeakDb: -1 })
  assert.deepEqual(timelineOf(first).delivery, { loudness: { integratedLufs: -14, truePeakDb: -1 } })

  // The re-export that came out at −33.4 LUFS: no loudness argument.
  const again = await exportTimeline(ARGS)
  assert.deepEqual(requests[1]!.loudness, { integratedLufs: -14, truePeakDb: -1 }, 'the remembered target reaches main')
  const said = again.loudness as { target: unknown; source: string; note: string }
  assert.equal(said.source, 'remembered from the last export')
  assert.deepEqual(said.target, { integratedLufs: -14, truePeakDb: -1 })
  assert.match(said.note, /loudness: "off"/, 'the result names how to turn it off')

  // Positive control: another timeline of the same project remembers nothing, so stays unmastered.
  useEditor.setState((state) => ({ project: { ...state.project, activeTimelineId: second } }))
  const other = await exportTimeline(ARGS)
  assert.equal(requests[2]!.loudness, undefined)
  assert.equal(other.loudness, undefined)
  assert.equal(timelineOf(second).delivery, undefined)
})

test('a finished export whose mastering did not run remembers nothing', async () => {
  const { first } = load()
  const started = await exportTimeline({ ...ARGS, loudness: 'podcast' })
  // Main delivers the unmastered mix when mastering fails: `done`, but no loudness report.
  emit!({ jobId: String(started.jobId), progress: 1, framesDone: 90, framesTotal: 90, stage: 'done', findings: [] })
  assert.equal(timelineOf(first).delivery, undefined)
})

test('"off" exports unmastered and forgets the remembered target', async () => {
  const { first } = load()
  requests.length = 0
  const started = await exportTimeline({ ...ARGS, loudness: 'podcast' })
  finishMastered(String(started.jobId), { integratedLufs: -16, truePeakDb: -1 })
  assert.deepEqual(timelineOf(first).delivery?.loudness, { integratedLufs: -16, truePeakDb: -1 }, 'the specimen: something is remembered')

  const off = await exportTimeline({ ...ARGS, loudness: 'off' })
  assert.equal(requests[1]!.loudness, undefined, 'unmastered')
  assert.equal('delivery' in timelineOf(first), false, 'forgotten, and no empty object left in the .bay')
  assert.match(String((off.loudness as { note: string }).note), /−16\.0 LUFS/, 'the result says what was forgotten')

  const after = await exportTimeline(ARGS)
  assert.equal(requests[2]!.loudness, undefined, 'and later exports stay unmastered')
  assert.equal(after.loudness, undefined)
})

test('a misspelled loudness is refused before anything starts, naming "off"', async () => {
  load()
  requests.length = 0
  await assert.rejects(
    () => exportTimeline({ ...ARGS, loudness: 'loud' }),
    (error: unknown) => error instanceof ToolError && /"streaming"/.test(error.message) && /"off"/.test(error.message)
  )
  assert.equal(requests.length, 0)
})
