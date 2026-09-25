/**
 * The render queue's records: every export this window has run since it opened, from the
 * Deliver page, the ⌘E dialog or bay's `export_timeline` tool, with where each one stands.
 *
 * Pure, so what the queue *says* about a job — above all, that a file which finished with wrong
 * frames is not "Complete" — is tested without a window. `export-session.ts` feeds it.
 */

import type { ExportProgress, IncompleteFrames } from '@shared/ipc'
import { hasBlocking } from '@shared/findings'

export interface RenderRecord {
  jobId: string
  /**
   * Who started it: this window's export form (Deliver or ⌘E), or `export_timeline` — a tool
   * call, which may be the in-app agent's or a client's on bay's socket (a terminal agent); this
   * window cannot tell which, so the queue does not claim either. Main sends a job's progress
   * only to the window that started it, so another window's export never arrives here.
   */
  origin: 'you' | 'tool'
  /** Where the file goes. A tool's job is known only by its progress, which names it on `done`. */
  outputPath: string | null
  /** The settings in a few words — "YouTube 1080p", "MP4 · 1920 × 1080". Null for a tool's job. */
  summary: string | null
  /** When this window first heard of it (ms since the epoch). */
  startedAt: number
  progress: ExportProgress
  /**
   * Frames written with something missing. Held apart from `progress`, because main's `done`
   * replaces the progress and only the renderer knows what the frames held.
   */
  incomplete: IncompleteFrames | null
}

const TERMINAL_STAGES: readonly ExportProgress['stage'][] = ['done', 'failed', 'cancelled']

export const isRunning = (record: Pick<RenderRecord, 'progress'>): boolean =>
  !TERMINAL_STAGES.includes(record.progress.stage)

/** Most recent first, and never more than this many: a long session is not a log file. */
export const HISTORY_LIMIT = 30

/** A job this window started, as it goes into the queue. Newest first. */
export function addRecord(history: readonly RenderRecord[], record: RenderRecord): readonly RenderRecord[] {
  return [record, ...history.filter((entry) => entry.jobId !== record.jobId)].slice(0, HISTORY_LIMIT)
}

/**
 * The queue after one progress report. A job it has not seen was started by a tool call (this
 * window's own jobs are added before their first report), and joins the queue. A report never reopens a
 * finished job: a late frame callback after `done` must not show it rendering again.
 */
export function applyProgress(history: readonly RenderRecord[], update: ExportProgress, now: number): readonly RenderRecord[] {
  const index = history.findIndex((entry) => entry.jobId === update.jobId)
  if (index === -1) {
    return addRecord(history, {
      jobId: update.jobId,
      origin: 'tool',
      outputPath: update.outputPath ?? null,
      summary: null,
      startedAt: now,
      progress: update,
      incomplete: update.incomplete ?? null
    })
  }
  const current = history[index]!
  if (!isRunning(current) && !TERMINAL_STAGES.includes(update.stage)) return history
  const next: RenderRecord = {
    ...current,
    progress: update,
    outputPath: update.outputPath ?? current.outputPath,
    incomplete: update.incomplete ?? current.incomplete
  }
  return history.map((entry, at) => (at === index ? next : entry))
}

/** Marks a record's frames incomplete, once the exporter has said so. */
export function markIncomplete(history: readonly RenderRecord[], jobId: string, incomplete: IncompleteFrames): readonly RenderRecord[] {
  return history.map((entry) => (entry.jobId === jobId ? { ...entry, incomplete } : entry))
}

export type RecordTone = 'running' | 'complete' | 'incomplete' | 'failed' | 'cancelled'

/**
 * What the queue says about one job: a short label beside it and the sentence under it. Written
 * first, before the type: a file that is on disk but holds wrong frames, or failed its read-back,
 * must never read "Complete", which is the one word a person stops reading at.
 */
export function recordStatus(record: RenderRecord): { tone: RecordTone; label: string; detail: string | null } {
  const { progress } = record
  if (isRunning(record)) {
    const percent = progress.progress === null ? null : Math.round(progress.progress * 100)
    const stage = progress.stage === 'preparing' ? 'Preparing' : progress.stage === 'encoding' ? 'Encoding' : 'Rendering'
    const frames = `${progress.framesDone}${progress.framesTotal ? ` of ${progress.framesTotal}` : ''} frames`
    return { tone: 'running', label: percent === null ? stage : `${stage} · ${percent}%`, detail: frames }
  }
  if (progress.stage === 'failed') return { tone: 'failed', label: 'Failed', detail: progress.error ?? 'The export stopped with an error.' }
  if (progress.stage === 'cancelled') return { tone: 'cancelled', label: 'Cancelled', detail: null }
  if (record.incomplete) return { tone: 'incomplete', label: 'Incomplete', detail: record.incomplete.message }
  const findings = progress.findings ?? []
  if (hasBlocking(findings)) {
    return {
      tone: 'incomplete',
      label: 'Delivered with a problem',
      detail: findings.filter((finding) => finding.severity === 'blocking').map((finding) => finding.message).join(' ')
    }
  }
  const notes = [progress.loudness?.summary, ...findings.map((finding) => finding.message)].filter(Boolean)
  return { tone: 'complete', label: 'Complete', detail: notes.length > 0 ? notes.join(' ') : null }
}

/** The file's name from its path, for a queue row: `/Users/me/Movies/cut.mp4` → `cut.mp4`. */
export function fileName(path: string | null): string | null {
  if (!path) return null
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

/** The folder a path is in, for the destination line: `/Users/me/Movies/cut.mp4` → `/Users/me/Movies`. */
export function folderOf(path: string | null): string | null {
  if (!path) return null
  const cut = path.lastIndexOf('/')
  return cut > 0 ? path.slice(0, cut) : '/'
}
