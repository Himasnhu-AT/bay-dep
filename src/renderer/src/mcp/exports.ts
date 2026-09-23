/**
 * `export_timeline` and `track_export`.
 *
 * An export is the one tool that outlives its call. `export_timeline` returns a job id
 * immediately because encoding takes minutes, so the progress has to live somewhere between
 * calls — here, in a module-level map fed by `window.bay.export.onProgress`. That is not a
 * second path into the project: no export writes to the store, and the frames come from the
 * engine's `FrameExporter`, the same one the export dialog drives.
 *
 * The frame pump runs in the renderer on purpose. `export.start` only opens a job on the
 * encoder; if nothing feeds it, ffmpeg waits on a stream that never arrives and the agent
 * polls a job that will never finish. That exact gap shipped once already.
 */

import type { ExportFormat, ExportProgress } from '@shared/ipc'
import { timelineDuration } from '@shared/project'
import { FrameExporter } from '@/engine'
import { bay } from '@/lib/bay'
import { fail, project, timeline, type Handlers } from './helpers'

interface Job {
  jobId: string
  outputPath: string
  format: ExportFormat
  fromFrame: number
  toFrame: number
  progress: ExportProgress
  exporter: FrameExporter | null
}

const jobs = new Map<string, Job>()
let subscribed = false

/** Audio-only containers have no pictures to push; main muxes those from the project alone. */
const AUDIO_ONLY: ExportFormat[] = ['wav', 'mp3']

function subscribe(): void {
  if (subscribed) return
  const api = bay()
  if (!api) return
  subscribed = true
  api.export.onProgress((update) => {
    const job = jobs.get(update.jobId)
    if (job) job.progress = update
  })
}

export async function exportTimeline(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const api = bay()
  if (!api) fail('This window has no bridge to the app, so nothing can be exported.')

  const outputPath = String(args.outputPath)
  if (!outputPath.startsWith('/')) {
    fail(`outputPath must be absolute; got "${outputPath}".`)
  }
  const format = String(args.format) as ExportFormat

  const tl = timeline()
  const duration = timelineDuration(tl)
  if (duration === 0) {
    fail(
      'The timeline is empty, so an export would produce a file with no frames. Place ' +
        'something with place_asset first.'
    )
  }

  const fromFrame = args.fromFrame === undefined ? 0 : Math.max(0, Math.round(Number(args.fromFrame)))
  const toFrame =
    args.toFrame === undefined ? duration - 1 : Math.max(0, Math.round(Number(args.toFrame)))
  if (toFrame < fromFrame) {
    fail(`toFrame (${toFrame}) is before fromFrame (${fromFrame}), so the range is empty.`)
  }
  if (fromFrame >= duration) {
    fail(
      `fromFrame ${fromFrame} is past the end of the timeline (${duration} frames), so the ` +
        `range holds nothing. Export from 0, or shorten fromFrame.`
    )
  }

  subscribe()
  let job
  try {
    job = await api.export.start({
      project: project(),
      timelineId: tl.id,
      format,
      outputPath,
      width: tl.width,
      height: tl.height,
      fps: tl.fps,
      fromFrame,
      toFrame
    })
  } catch (error) {
    fail(`Export could not start: ${error instanceof Error ? error.message : String(error)}`)
  }

  const record: Job = {
    jobId: job.jobId,
    outputPath,
    format,
    fromFrame,
    toFrame,
    progress: {
      jobId: job.jobId,
      progress: null,
      framesDone: 0,
      framesTotal: toFrame - fromFrame + 1,
      stage: 'preparing'
    },
    exporter: null
  }
  jobs.set(job.jobId, record)

  if (!AUDIO_ONLY.includes(format)) {
    const exporter = new FrameExporter({
      project: project(),
      timelineId: tl.id,
      jobId: job.jobId,
      width: tl.width,
      height: tl.height,
      fromFrame,
      toFrame,
      onProgress: (report) => {
        const current = jobs.get(job.jobId)
        if (!current) return
        if (['done', 'failed', 'cancelled'].includes(current.progress.stage)) return
        current.progress = {
          jobId: job.jobId,
          stage: 'rendering',
          framesDone: report.framesDone,
          framesTotal: report.framesTotal,
          progress: report.progress
        }
      }
    })
    record.exporter = exporter
    // Deliberately not awaited: the tool returns a job id so the agent can poll rather than
    // hold a turn open for minutes. Failures land on the job record, which is what
    // track_export reads.
    void exporter.run().catch((error: unknown) => {
      const current = jobs.get(job.jobId)
      if (!current) return
      current.progress = {
        ...current.progress,
        stage: 'failed',
        error: error instanceof Error ? error.message : String(error)
      }
    })
  }

  return {
    jobId: job.jobId,
    outputPath,
    format,
    fromFrame,
    toFrame,
    framesTotal: toFrame - fromFrame + 1,
    note: 'Poll track_export with this jobId. Do not assume success — check the final stage.'
  }
}

export function trackExport(args: Record<string, unknown>): Record<string, unknown> {
  const jobId = String(args.jobId)
  const job = jobs.get(jobId)
  if (!job) {
    const known = [...jobs.keys()]
    fail(
      `No export job "${jobId}" in this session.` +
        (known.length > 0
          ? ` Jobs started here: ${known.join(', ')}.`
          : ' No export has been started from this session yet — call export_timeline first.')
    )
  }

  const { progress } = job
  const finished = ['done', 'failed', 'cancelled'].includes(progress.stage)
  return {
    jobId,
    stage: progress.stage,
    framesDone: progress.framesDone,
    framesTotal: progress.framesTotal,
    percent: progress.progress === null ? null : Math.round(progress.progress * 100),
    finished,
    ...(progress.stage === 'done' ? { outputPath: progress.outputPath ?? job.outputPath } : {}),
    ...(progress.error ? { error: progress.error } : {}),
    ...(finished
      ? {}
      : { note: 'Still working. Poll again in a few seconds rather than in a tight loop.' }),
    // The catalog warns that an export can finish having written nothing; saying it here
    // means the agent sees it at the moment it is about to report success.
    ...(progress.stage === 'done' && progress.framesDone === 0
      ? { warning: 'The export finished with zero frames — the range held nothing.' }
      : {})
  }
}

/** Test seam: forget everything this session knows about exports. */

export const handlers: Handlers = {
  export_timeline: (args) => exportTimeline(args),
  track_export: (args) => trackExport(args),
}
