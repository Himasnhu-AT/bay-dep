/**
 * The export in progress, and the settings for the next one — one of each for the window.
 *
 * It used to be component state inside the form. So the dialog and the rail's Export panel were
 * two exports with two sets of settings, and closing the dialog mid-export threw away the only
 * view of a job that kept running: reopening it showed "Nothing exporting" over a live encode,
 * and a second press of Export started a second one. Here the job outlives whatever is showing
 * it, and every surface that shows the export shows this one.
 *
 * The frames are still produced in the renderer by `FrameExporter` — `export.start` only opens
 * a job on the encoder, and nothing else feeds it.
 */

import { create } from 'zustand'
import type { ExportProgress, IncompleteFrames } from '@shared/ipc'
import {
  DEFAULT_EXPORT_SETTINGS,
  exportRequestFields,
  isAudioOnly,
  loudnessTarget,
  resolveExportRange,
  type ExportRangeChoice,
  type ExportSettings
} from '@shared/export-presets'
import { findTimeline, timelineDuration } from '@shared/project'
import { parseTime } from '@shared/pins'
import { FrameExporter } from '@/engine'
import { bay, call } from '@/lib/bay'
import { useEditor } from '@/store/editor'

export const TERMINAL: readonly ExportProgress['stage'][] = ['done', 'failed', 'cancelled']

export type RangeKind = ExportRangeChoice['kind']

interface ExportSession {
  settings: ExportSettings
  rangeKind: RangeKind
  /** The custom range's bounds as typed, so a half-typed value survives closing the dialog. */
  customStart: string
  customEnd: string
  outputPath: string | null
  progress: ExportProgress | null
  /** Frames written with something missing. Apart from `progress`, which main's `done` replaces. */
  incomplete: IncompleteFrames | null
  starting: boolean
  setSettings(next: ExportSettings): void
  setRangeKind(kind: RangeKind): void
  setCustom(bounds: { start?: string; end?: string }): void
  setOutputPath(path: string | null): void
  start(): Promise<void>
  cancel(): void
}

let jobId: string | null = null
let exporter: FrameExporter | null = null
let subscribed = false

/** The In/Out marks, read without depending on the editing slice's types being present. */
export function readMarks(state: unknown): { rangeIn: number | null; rangeOut: number | null } {
  const marks = state as { rangeIn?: number | null; rangeOut?: number | null }
  return {
    rangeIn: typeof marks.rangeIn === 'number' ? marks.rangeIn : null,
    rangeOut: typeof marks.rangeOut === 'number' ? marks.rangeOut : null
  }
}

/** The session's Range as the pure resolver's choice, with the custom text parsed at `fps`. */
export function rangeChoice(session: Pick<ExportSession, 'rangeKind' | 'customStart' | 'customEnd'>, fps: number): ExportRangeChoice {
  if (session.rangeKind !== 'custom') return { kind: session.rangeKind }
  return { kind: 'custom', start: parseTime(session.customStart, fps), end: parseTime(session.customEnd, fps) }
}

/**
 * Why Export cannot start with these settings, as the sentence to show, or null when it can.
 * The form's hint and both Export buttons read this one answer.
 */
export function exportBlocker(
  session: Pick<ExportSession, 'rangeKind' | 'customStart' | 'customEnd' | 'settings'>,
  fps: number,
  duration: number,
  marks: { rangeIn: number | null; rangeOut: number | null }
): string | null {
  if (duration === 0) return 'The timeline is empty — there is nothing to export yet.'
  const range = resolveExportRange(rangeChoice(session, fps), duration, marks)
  if ('error' in range) return range.error
  if (session.settings.format !== 'png-sequence') {
    const loudness = loudnessTarget(session.settings.loudness)
    if ('error' in loudness) return loudness.error
  }
  return null
}

function subscribe(): void {
  if (subscribed) return
  const api = bay()
  if (!api) return
  subscribed = true
  api.export.onProgress((update) => {
    // Other windows and the agent export too; only this session's job drives this view.
    if (update.jobId !== jobId) return
    useExportSession.setState({ progress: update })
    const notify = useEditor.getState().notify
    if (update.stage === 'done') notify(`Exported to ${update.outputPath ?? useExportSession.getState().outputPath ?? ''}`)
    if (update.stage === 'failed') notify(update.error ?? 'Export failed.', 'error')
  })
}

export const useExportSession = create<ExportSession>((set, get) => ({
  settings: DEFAULT_EXPORT_SETTINGS,
  rangeKind: 'whole',
  customStart: '',
  customEnd: '',
  outputPath: null,
  progress: null,
  incomplete: null,
  starting: false,

  setSettings(next) {
    const before = get().settings
    // A destination was chosen with the old format's extension; exporting WebM into `cut.mp4`
    // is a file that lies about what it is. Choose again rather than guess a rename.
    set({ settings: next, ...(next.format !== before.format ? { outputPath: null } : {}) })
  },
  setRangeKind(kind) {
    set({ rangeKind: kind })
  },
  setCustom({ start, end }) {
    set({ ...(start !== undefined ? { customStart: start } : {}), ...(end !== undefined ? { customEnd: end } : {}) })
  },
  setOutputPath(path) {
    set({ outputPath: path })
  },

  async start() {
    const session = get()
    if (session.starting || (session.progress && !TERMINAL.includes(session.progress.stage))) return
    const editor = useEditor.getState()
    const project = editor.project
    const timeline = findTimeline(project, project.activeTimelineId)
    if (!timeline) return
    const notify = editor.notify

    const range = resolveExportRange(rangeChoice(session, timeline.fps), timelineDuration(timeline), readMarks(editor))
    if ('error' in range) {
      notify(range.error, 'error')
      return
    }
    const fields = exportRequestFields(session.settings, timeline.width, timeline.height)
    if ('error' in fields) {
      notify(fields.error, 'error')
      return
    }

    let target = session.outputPath
    if (!target) {
      target = await call('Choosing a destination', (api) => api.export.chooseOutputPath(project.name, fields.format))
      // Null is a failed call (already reported) or a cancelled save panel; neither starts one.
      if (!target) return
      set({ outputPath: target })
    }

    subscribe()
    set({ starting: true, progress: null, incomplete: null })
    const job = await call('Export', (api) =>
      api.export.start({
        project,
        timelineId: timeline.id,
        outputPath: target,
        fps: timeline.fps,
        fromFrame: range.fromFrame,
        toFrame: range.toFrame,
        ...fields
      })
    )
    set({ starting: false })
    if (!job) return
    jobId = job.jobId
    set({
      progress: {
        jobId: job.jobId,
        progress: null,
        framesDone: 0,
        framesTotal: range.toFrame - range.fromFrame + 1,
        stage: 'preparing'
      }
    })

    // A WAV or MP3 has no pictures to push; main muxes those from the project alone.
    if (isAudioOnly(fields.format)) return

    const running = new FrameExporter({
      project,
      timelineId: timeline.id,
      jobId: job.jobId,
      ...(fields.width !== undefined ? { width: fields.width } : {}),
      ...(fields.height !== undefined ? { height: fields.height } : {}),
      fromFrame: range.fromFrame,
      toFrame: range.toFrame,
      onProgress: (report) => {
        const previous = get().progress
        // Main owns the terminal stages; a late frame callback must not reopen a finished job.
        if (previous && TERMINAL.includes(previous.stage)) return
        set({
          progress: {
            jobId: job.jobId,
            stage: 'rendering',
            framesDone: report.framesDone,
            framesTotal: report.framesTotal,
            progress: report.progress
          }
        })
      }
    })
    exporter = running
    try {
      const outcome = await running.run()
      // Main says `done` because the file closed; only the exporter knows what the frames held.
      if (outcome.incomplete) {
        set({ incomplete: outcome.incomplete })
        notify(outcome.incomplete.message, 'error')
      }
    } catch (error) {
      const previous = get().progress
      const message = error instanceof Error ? error.message : 'Export failed.'
      set({
        progress: {
          jobId: job.jobId,
          stage: 'failed',
          framesDone: previous?.framesDone ?? 0,
          framesTotal: previous?.framesTotal ?? null,
          progress: previous?.progress ?? null,
          error: message
        }
      })
      notify(message, 'error')
    } finally {
      if (exporter === running) exporter = null
    }
  },

  cancel() {
    const id = jobId
    if (!id) return
    // Cancelling the frame pump is what stops the work; `run()` then tells the encoder. Only
    // reach for the bridge directly when there is no pump (audio-only).
    if (exporter) exporter.cancel()
    else void call('Cancelling the export', (api) => api.export.cancel(id))
  }
}))
