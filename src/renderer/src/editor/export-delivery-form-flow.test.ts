/**
 * The export form's side of the remembered loudness, through `start()` with a fake bridge:
 *
 * - only Off chosen by the user in the Loudness menu forgets the remembered target — a preset
 *   that is unmastered (the ProRes master) is not that decision — and only once the export is done;
 * - a decision remembered while the form's own job ran (an agent export) reaches the form when
 *   that job ends, instead of being dropped.
 *
 * WAV, so no frame pump runs. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ExportProgress, ExportRequest } from '@shared/ipc'
import type { Asset, Item } from '@shared/project'
import { EXPORT_PRESETS } from '@shared/export-presets'
import { emptyProject, useEditor } from '@/store/editor'
import { useExportSession } from './export-session'

let emit: ((update: ExportProgress) => void) | null = null
let nextJob = 0
const requests: ExportRequest[] = []
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

const PODCAST = { integratedLufs: -16, truePeakDb: -1 }
const session = () => useExportSession.getState()
const remembered = () => {
  const project = useEditor.getState().project
  return project.timelines.find((t) => t.id === project.activeTimelineId)!.delivery?.loudness
}

/** A project with sound and a remembered target; the form set to WAV at `loudness`. */
function load(): string {
  const project = emptyProject()
  project.assets = [SOUND]
  const timeline = project.timelines[0]!
  const audio = timeline.tracks.find((t) => t.kind === 'audio')!
  const clip: Item = {
    id: 'itm_vo', assetId: 'snd', trackId: audio.id, from: 0, durationInFrames: 90, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
  }
  audio.items = [clip]
  timeline.delivery = { loudness: { ...PODCAST } }
  useEditor.getState().setProject(project)
  useExportSession.setState({ progress: null, starting: false, outputPath: '/tmp/form.wav' })
  return timeline.id
}

/** A destination, set after the format: changing the format clears it, as it should. */
async function start(): Promise<void> {
  session().setOutputPath('/tmp/form.wav')
  await session().start()
}

async function exportAndEnd(stage: ExportProgress['stage']): Promise<void> {
  await start()
  const jobId = `job_${nextJob}`
  assert.equal(session().progress?.jobId, jobId, 'the form started its job')
  emit!({ jobId, progress: stage === 'done' ? 1 : null, framesDone: 90, framesTotal: 90, stage, findings: [] })
}

test('a preset that happens to be unmastered does not forget the remembered target', async () => {
  load()
  const master = EXPORT_PRESETS.find((preset) => preset.settings.loudness === 'off')
  assert.ok(master, 'the specimen: a preset whose loudness is Off (the ProRes master)')
  session().setSettings({ ...master.settings, format: 'wav' })
  assert.equal(session().settings.loudness, 'off')
  assert.equal(session().loudnessOffChosen, false)
  await exportAndEnd('done')
  assert.deepEqual(remembered(), PODCAST)
})

test('Off chosen in the menu forgets it once the export is done — not when it fails', async () => {
  load()
  session().setSettings({ ...session().settings, format: 'wav', loudness: 'podcast' })
  session().chooseLoudness('off')
  assert.equal(session().loudnessOffChosen, true)
  await exportAndEnd('failed')
  assert.deepEqual(remembered(), PODCAST, 'kept after a failed export')

  load()
  session().setSettings({ ...session().settings, format: 'wav', loudness: 'podcast' })
  session().chooseLoudness('off')
  await start()
  assert.deepEqual(remembered(), PODCAST, 'kept while the export runs')
  emit!({ jobId: `job_${nextJob}`, progress: 1, framesDone: 90, framesTotal: 90, stage: 'done', findings: [] })
  assert.equal(remembered(), undefined, 'forgotten once done')
})

test('any other change of the loudness withdraws the Off choice', () => {
  session().chooseLoudness('off')
  assert.equal(session().loudnessOffChosen, true)
  session().setSettings({ ...session().settings, loudness: 'streaming' })
  assert.equal(session().loudnessOffChosen, false)
})

test('a target remembered while the form’s job runs reaches the form when that job ends', async () => {
  const timelineId = load()
  session().setSettings({ ...session().settings, format: 'wav', loudness: 'broadcast' })
  await start()
  // An agent export finishes meanwhile and remembers streaming; the field offers it, and the
  // running job refuses it.
  useEditor.getState().rememberDelivery(useEditor.getState().project.id, timelineId, { integratedLufs: -14, truePeakDb: -1 })
  assert.equal(session().adoptRememberedLoudness(timelineId, remembered()), false, 'refused while running')
  assert.equal(session().settings.loudness, 'broadcast')
  emit!({ jobId: `job_${nextJob}`, progress: 1, framesDone: 90, framesTotal: 90, stage: 'done', findings: [] })
  assert.equal(session().settings.loudness, 'streaming', 'adopted when the job ended')
})
