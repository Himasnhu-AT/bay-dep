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

import type { ExportFormat, ExportProgress, IncompleteFrames } from '@shared/ipc'
import { timelineDuration } from '@shared/project'
import { chooseExportLoudness, describeTarget, unmasteredLevelWarning, type LoudnessTarget } from '@shared/loudness'
import { checkExportRange } from '@shared/export-presets'
import { hasBlocking, type Finding } from '@shared/findings'
import { FrameExporter } from '@/engine'
import { bay } from '@/lib/bay'
import { fail, project, store, timeline, type Handlers } from './helpers'

interface Job {
  jobId: string
  /** Where the delivery decision is remembered when a mastered export finishes. */
  projectId: string
  timelineId: string
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
    if (!job) return
    job.progress = update
    // A mastered export finished: that target is now the timeline's delivery decision, so the
    // next export without a `loudness` argument keeps it rather than silently dropping it.
    if (update.stage === 'done' && update.loudness) {
      store().rememberDelivery(job.projectId, job.timelineId, update.loudness.target)
    }
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

  const quality = args.quality === undefined ? 'good' : String(args.quality)
  if (quality !== 'draft' && quality !== 'good' && quality !== 'best') {
    fail(`quality must be "draft", "good" or "best"; got "${quality}".`)
  }

  const tl = timeline()
  // Refused before anything starts: an export that ran for minutes and then ignored a
  // misspelled preset would deliver a file at the wrong level with no word about it. No
  // argument means the timeline's remembered target, when it has one.
  const loudness = chooseExportLoudness(args.loudness, tl.delivery?.loudness)
  if ('error' in loudness) fail(loudness.error)
  const duration = timelineDuration(tl)
  if (duration === 0) {
    fail(
      'The timeline is empty, so an export would produce a file with no frames. Place ' +
        'something with place_asset first.'
    )
  }

  // The one range check, shared with the export form's Range (`@shared/export-presets`).
  const range = checkExportRange(
    args.fromFrame === undefined ? undefined : Number(args.fromFrame),
    args.toFrame === undefined ? undefined : Number(args.toFrame),
    duration
  )
  if ('error' in range) fail(range.error)
  const { fromFrame, toFrame } = range

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
      toFrame,
      quality,
      ...(loudness.target ? { loudness: loudness.target } : {})
    })
  } catch (error) {
    fail(`Export could not start: ${error instanceof Error ? error.message : String(error)}`)
  }
  const projectId = project().id
  // "off" is a decision too: this export is unmastered, and so are the next ones until asked.
  if (loudness.forget) store().rememberDelivery(projectId, tl.id, null)

  const record: Job = {
    jobId: job.jobId,
    projectId,
    timelineId: tl.id,
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
    quality,
    ...(loudness.target ? { loudnessTarget: loudness.target } : {}),
    ...loudnessResult(loudness.target, loudness.source, loudness.forget),
    note: 'Poll track_export with this jobId. Do not assume success — check the final stage.'
  }
}

/**
 * How the export's loudness was decided, said in the result so a remembered target is never a
 * surprise and a forgotten one is never silent.
 */
function loudnessResult(
  target: LoudnessTarget | null,
  source: 'argument' | 'remembered' | 'off' | 'default',
  forgot: LoudnessTarget | null
): Record<string, unknown> {
  if (source === 'remembered' && target) {
    return {
      loudness: {
        target,
        source: 'remembered from the last export',
        note: `Mastering to ${describeTarget(target)} because the last export of this timeline did. Pass loudness: "off" to export unmastered (and forget it).`
      }
    }
  }
  if (source === 'argument' && target) return { loudness: { target, source: 'this call' } }
  if (source === 'off' && forgot) {
    return {
      loudness: {
        target: null,
        source: 'off',
        note: `Unmastered, and the remembered target (${describeTarget(forgot)}) is forgotten: later exports stay unmastered until one passes loudness.`
      }
    }
  }
  return {}
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

  // Read live from the exporter, not from main's progress: main encodes what it is handed and
  // cannot know a frame was missing something. Final before `done` can arrive (see the getter).
  return exportStatus(job.progress, job.outputPath, job.exporter?.incomplete ?? null)
}

/**
 * What `track_export` answers for a job in this state. Apart from the job map so the answer can
 * be held still without an encoder.
 */
export function exportStatus(
  progress: ExportProgress,
  outputPath: string,
  incomplete: IncompleteFrames | null
): Record<string, unknown> {
  const finished = ['done', 'failed', 'cancelled'].includes(progress.stage)
  // Main's read-back of the file is the only thing that can say it lacks audio or runs short;
  // the frames' own faults are known only here. Any blocking one makes the export not complete.
  const findings = progress.stage === 'done' ? doneFindings(progress, incomplete) : null
  const levelWarning = progress.stage === 'done' ? unmasteredLevelWarning(progress) : null
  const status: Record<string, unknown> = {
    jobId: progress.jobId,
    stage: progress.stage,
    framesDone: progress.framesDone,
    framesTotal: progress.framesTotal,
    percent: progress.progress === null ? null : Math.round(progress.progress * 100),
    finished,
    ...(progress.stage === 'done' ? { outputPath: progress.outputPath ?? outputPath } : {}),
    ...(progress.error ? { error: progress.error } : {}),
    // What the delivered file measures, not what was asked for: the loop verifies the encoded
    // bytes, and a `missed` status is said here in numbers rather than left to be discovered.
    ...(progress.loudness
      ? {
          loudness: {
            status: progress.loudness.status,
            targetLufs: progress.loudness.target.integratedLufs,
            ceilingDbtp: progress.loudness.target.truePeakDb,
            measuredLufs: progress.loudness.measured?.integratedLufs ?? null,
            measuredTruePeakDbtp: progress.loudness.measured?.truePeakDb ?? null,
            gainDb: Number(progress.loudness.gainDb.toFixed(2)),
            passes: progress.loudness.passes,
            summary: progress.loudness.summary
          }
        }
      : {}),
    // Every export with sound, mastered or not: the level the file will play at.
    ...(progress.stage === 'done' && progress.deliveredLoudness
      ? {
          deliveredLoudness: {
            integratedLufs: finiteOrNull(progress.deliveredLoudness.integratedLufs),
            truePeakDbtp: finiteOrNull(progress.deliveredLoudness.truePeakDb),
            mastered: progress.loudness !== undefined
          }
        }
      : {}),
    ...(progress.message && progress.stage === 'done' ? { message: progress.message } : {}),
    ...(finished
      ? {}
      : { note: 'Still working. Poll again in a few seconds rather than in a tight loop.' }),
    // The catalog warns that an export can finish having written nothing; saying it here
    // means the agent sees it at the moment it is about to report success.
    ...(progress.stage === 'done' && progress.framesDone === 0
      ? { warning: 'The export finished with zero frames — the range held nothing.' }
      : {}),
    // A file with a graphic missing from some frames is not a clean export, and `done` alone
    // would let the agent report it as one. `complete: true` is claimed only once the job is done.
    ...(findings ? { findings } : {}),
    ...(incomplete
      ? {
          complete: false,
          incompleteFrames: {
            frames: incomplete.frames,
            ranges: incomplete.ranges,
            items: incomplete.items,
            gradeIssues: incomplete.gradeIssues,
            placeholders: incomplete.placeholders
          },
          warning: incomplete.message
        }
      : findings
        ? // Every blocking finding, not only main's: a zero-frame export has no read-back fault
          // and is still not done.
          hasBlocking(findings)
          ? { complete: false, warning: findings.find((f) => f.severity === 'blocking')!.message }
          : { complete: true }
        : {})
  }
  // After the faults that make the export not complete, which hide better and matter more.
  if (levelWarning) status.warning = typeof status.warning === 'string' ? `${status.warning} ${levelWarning}` : levelWarning
  return status
}

/** One decimal for the reader; `null` for the −∞ of digital silence, which JSON cannot carry. */
function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? Number(value.toFixed(1)) : null
}

/**
 * Everything wrong with a finished export, blocking first: what main found reading the file back,
 * then the frames written with something missing, then a range that held nothing. The agent's
 * rule is simple — a blocking finding means the export is not done — so every fault that means
 * that has to arrive here, not only in a warning string beside it.
 */
export function doneFindings(progress: ExportProgress, incomplete: IncompleteFrames | null): Finding[] {
  const out: Finding[] = [...(progress.findings ?? [])]
  if (incomplete) {
    out.push({
      severity: 'blocking',
      message: incomplete.message,
      fix: 'Wait for the named items to load (or fix the ones that failed), then export again.'
    })
  }
  const level = unmasteredLevelWarning(progress)
  if (level) out.push({ severity: 'warn', message: level, fix: 'Export again with loudness: "streaming" (or "podcast"), and it is remembered for later exports.' })
  if (progress.framesDone === 0 && progress.framesTotal !== 0) {
    out.push({ severity: 'blocking', message: 'The export finished with zero frames.', fix: 'Check fromFrame/toFrame cover the edit, and export again.' })
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'blocking' ? -1 : 1))
}

/** Test seam: forget everything this session knows about exports. */

export const handlers: Handlers = {
  export_timeline: (args) => exportTimeline(args),
  track_export: (args) => trackExport(args),
}
