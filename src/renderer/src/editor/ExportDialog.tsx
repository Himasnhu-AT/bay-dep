import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, FolderOpen, Loader2, Upload } from 'lucide-react'
import type { ExportFormat, ExportProgress, IncompleteFrames } from '@shared/ipc'
import { formatTimecode } from '@shared/project'
import { Button, Field, Modal, Section, Select } from '@/components'
import { FrameExporter } from '@/engine'
import { bay, call } from '@/lib/bay'
import { cn } from '@/lib/cn'
import { selectDuration, selectTimeline, useEditor } from '@/store/editor'

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'mp4', label: 'MP4 · H.264' },
  { value: 'mov', label: 'MOV · QuickTime' },
  { value: 'webm', label: 'WebM · VP9' },
  { value: 'wav', label: 'WAV · audio only' },
  { value: 'mp3', label: 'MP3 · audio only' },
  { value: 'png-sequence', label: 'PNG sequence' }
]

const QUALITIES = [
  { value: 'draft', label: 'Draft — fast, soft' },
  { value: 'good', label: 'Good — the default' },
  { value: 'best', label: 'Best — slow, large' }
] as const

type Quality = (typeof QUALITIES)[number]['value']
type Scale = 'timeline' | '2160' | '1080' | '720' | '480'

const SCALES: { value: Scale; label: string }[] = [
  { value: 'timeline', label: 'Timeline size' },
  { value: '2160', label: '2160p · 4K' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' }
]

/** Scaled to the requested height, keeping the timeline's aspect, rounded to even pixels
 * because H.264 chroma subsampling cannot encode an odd dimension. */
function resolve(scale: Scale, width: number, height: number): { width: number; height: number } {
  if (scale === 'timeline') return { width, height }
  const target = Number(scale)
  const ratio = height > 0 ? width / height : 16 / 9
  const even = (value: number): number => Math.max(2, Math.round(value / 2) * 2)
  return { width: even(target * ratio), height: even(target) }
}

const AUDIO_ONLY: ExportFormat[] = ['wav', 'mp3']
const TERMINAL: ExportProgress['stage'][] = ['done', 'failed', 'cancelled']

export interface ExportFormProps {
  /** The left rail is 212px wide; the modal is not. */
  compact?: boolean
}

/**
 * The export form, shared by the modal and the left rail's Export panel so there is one
 * set of defaults and one progress subscription shape rather than two that drift.
 *
 * The dialog owns the *whole* export, not just its settings. `window.bay.export.start`
 * only opens a job on the encoder; the frames are produced here, by driving the engine's
 * `FrameExporter`, because nothing else is listening for that job. Without this the UI sat
 * at `preparing` forever and ffmpeg waited on a stream that never arrived.
 *
 * `FrameExporter.run()` calls `finish`/`cancel` on the bridge itself, so this must not.
 */
export function ExportForm({ compact = false }: ExportFormProps): ReactNode {
  const timeline = useEditor(selectTimeline)
  const duration = useEditor(selectDuration)
  const projectName = useEditor((state) => state.project.name)
  const project = useEditor((state) => state.project)
  const notify = useEditor((state) => state.notify)

  const [format, setFormat] = useState<ExportFormat>('mp4')
  const [quality, setQuality] = useState<Quality>('good')
  const [scale, setScale] = useState<Scale>('timeline')
  const [outputPath, setOutputPath] = useState<string | null>(null)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [starting, setStarting] = useState(false)
  /** Frames written with something still missing — held apart from `progress`, which main's
   * `done` event replaces wholesale and which may arrive after the exporter returns. */
  const [incomplete, setIncomplete] = useState<IncompleteFrames | null>(null)
  const jobRef = useRef<string | null>(null)
  const exporterRef = useRef<FrameExporter | null>(null)

  useEffect(() => {
    // Not routed through `call`: this registers a listener and hands back an unsubscribe,
    // so there is no promise to reject. A window with no bridge simply gets no progress,
    // and `start` will already have said why.
    const api = bay()
    if (!api) return
    return api.export.onProgress((update) => {
      // Several exports can be in flight from other windows; only ours may drive this UI.
      if (jobRef.current && update.jobId !== jobRef.current) return
      setProgress(update)
      if (update.stage === 'done') notify(`Exported to ${update.outputPath ?? outputPath ?? ''}`)
      if (update.stage === 'failed') notify(update.error ?? 'Export failed.', 'error')
    })
  }, [notify, outputPath])

  if (!timeline) return null

  const size = resolve(scale, timeline.width, timeline.height)
  const audioOnly = AUDIO_ONLY.includes(format)
  const running = progress !== null && !TERMINAL.includes(progress.stage)
  const empty = duration === 0

  const choosePath = async (): Promise<void> => {
    const chosen = await call('Choosing a destination', (api) =>
      api.export.chooseOutputPath(projectName, format)
    )
    if (chosen) setOutputPath(chosen)
  }

  const start = async (): Promise<void> => {
    let target = outputPath
    if (!target) {
      target = await call('Choosing a destination', (api) =>
        api.export.chooseOutputPath(projectName, format)
      )
      // Null here is either a failed call, already reported, or the user cancelling the
      // save panel. Neither should start an export.
      if (!target) return
      setOutputPath(target)
    }
    setStarting(true)
    setProgress(null)
    setIncomplete(null)
    const job = await call('Export', (api) =>
      api.export.start({
        project,
        timelineId: timeline.id,
        format,
        outputPath: target,
        width: size.width,
        height: size.height,
        fps: timeline.fps,
        quality
      })
    )
    setStarting(false)
    if (!job) return
    jobRef.current = job.jobId
    setProgress({
      jobId: job.jobId,
      progress: null,
      framesDone: 0,
      framesTotal: duration,
      stage: 'preparing'
    })

    // A WAV or MP3 has no pictures to push; main muxes those from the project alone, and
    // feeding RGBA frames to an audio encoder would be a stream it never reads.
    if (audioOnly) return

    const exporter = new FrameExporter({
      project,
      timelineId: timeline.id,
      jobId: job.jobId,
      width: size.width,
      height: size.height,
      onProgress: (report) =>
        setProgress((previous) => {
          // Main is the authority on the terminal stages — it owns the encoder — so a
          // late frame callback must not reopen an export that already finished or failed.
          if (previous && TERMINAL.includes(previous.stage)) return previous
          return {
            jobId: job.jobId,
            stage: 'rendering',
            framesDone: report.framesDone,
            framesTotal: report.framesTotal,
            progress: report.progress
          }
        })
    })
    exporterRef.current = exporter

    try {
      const outcome = await exporter.run()
      // An export that wrote frames with a graphic missing is not a clean one. Main says `done`
      // because the file closed; only the exporter knows what the frames held.
      if (outcome.incomplete) {
        setIncomplete(outcome.incomplete)
        notify(outcome.incomplete.message, 'error')
      }
    } catch (error) {
      setProgress((previous) => ({
        jobId: job.jobId,
        stage: 'failed',
        framesDone: previous?.framesDone ?? 0,
        framesTotal: previous?.framesTotal ?? null,
        progress: previous?.progress ?? null,
        error: error instanceof Error ? error.message : 'Export failed.'
      }))
      notify(error instanceof Error ? error.message : 'Export failed.', 'error')
    } finally {
      exporterRef.current = null
    }
  }

  const cancel = (): void => {
    const jobId = jobRef.current
    if (!jobId) return
    // Cancelling the frame pump is what actually stops the work; `run()` then tells the
    // encoder. Only reach for the bridge directly when there is no pump (audio-only).
    if (exporterRef.current) exporterRef.current.cancel()
    else void call('Cancelling the export', (api) => api.export.cancel(jobId))
  }

  const percent =
    progress && progress.progress !== null ? Math.round(progress.progress * 100) : null

  return (
    <div className={cn(compact && 'text-[11px]')}>
      <Section title="Format">
        <Field label="Container">
          <Select
            label="Export format"
            value={format}
            options={FORMATS}
            onChange={(next) => setFormat(next)}
            disabled={running}
          />
        </Field>
        <div className="mt-1.5">
          <Field label="Quality">
            <Select
              label="Export quality"
              value={quality}
              options={QUALITIES.map((entry) => ({ value: entry.value, label: entry.label }))}
              onChange={(next) => setQuality(next)}
              // Quality is a CRF for the video encoders; a WAV has nothing to apply it to.
              disabled={running || audioOnly}
            />
          </Field>
        </div>
        <div className="mt-1.5">
          <Field label="Size" hint={audioOnly ? '—' : `${size.width} × ${size.height}`}>
            <Select
              label="Export resolution"
              value={scale}
              options={SCALES}
              onChange={(next) => setScale(next)}
              disabled={running || audioOnly}
            />
          </Field>
        </div>
      </Section>

      <Section title="Destination">
        <div className="flex items-center gap-2">
          <p
            className="min-w-0 flex-1 truncate rounded-sm border border-line bg-surface-2 px-2 py-1.5 text-[11px] text-ink-1"
            title={outputPath ?? undefined}
          >
            {outputPath ?? 'No destination chosen'}
          </p>
          <Button
            variant="subtle"
            icon={<FolderOpen className="size-3.5" />}
            onClick={() => void choosePath()}
            disabled={running}
          >
            Choose
          </Button>
        </div>
        <div className="mt-2">
          <Field label="Range" hint={formatTimecode(duration, timeline.fps, true)}>
            <span className="text-[11px] text-ink-2">Whole timeline</span>
          </Field>
        </div>
      </Section>

      <Section title="Progress">
        {progress ? (
          <>
            <div className="mb-2 flex items-center gap-2">
              {progress.stage === 'done' ? (
                <Check aria-hidden="true" className="size-3.5 text-accent" />
              ) : progress.stage === 'failed' ? (
                <AlertTriangle aria-hidden="true" className="size-3.5 text-danger" />
              ) : (
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin text-ink-1" />
              )}
              <span className="text-[11px] text-ink-1 capitalize">{progress.stage}</span>
              <span className="ml-auto text-[11px] text-ink-2 tabular-nums">
                {percent === null ? '—' : `${percent}%`}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Export progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? undefined}
              className="h-1 w-full overflow-hidden rounded-full bg-surface-3"
            >
              <div
                className={cn(
                  'h-full rounded-full',
                  progress.stage === 'failed' ? 'bg-danger' : 'bg-accent'
                )}
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
            <p className="mt-1.5 text-[10px] text-ink-2 tabular-nums">
              {progress.framesDone}
              {progress.framesTotal ? ` / ${progress.framesTotal}` : ''} frames
              {progress.message ? ` · ${progress.message}` : ''}
            </p>
            {progress.error && <p className="mt-1 text-[11px] text-danger">{progress.error}</p>}
            {incomplete && (
              <p role="alert" className="mt-1 flex gap-1.5 text-[11px] text-warning">
                <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                <span>{incomplete.message}</span>
              </p>
            )}
          </>
        ) : (
          <p className="text-[11px] text-ink-2">
            {empty
              ? 'The timeline is empty — there is nothing to export yet.'
              : 'Nothing exporting. Choose a destination and start.'}
          </p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Button
            variant="primary"
            size="md"
            icon={<Upload className="size-3.5" />}
            onClick={() => void start()}
            disabled={empty || running || starting}
          >
            {starting ? 'Starting…' : 'Export'}
          </Button>
          {running && (
            <Button variant="danger" size="md" onClick={cancel}>
              Cancel
            </Button>
          )}
        </div>
      </Section>
    </div>
  )
}

export interface ExportDialogProps {
  open: boolean
  onClose(): void
}

export function ExportDialog({ open, onClose }: ExportDialogProps): ReactNode {
  return (
    <Modal
      open={open}
      title="Export"
      onClose={onClose}
      width={460}
      footer={
        <Button variant="ghost" size="md" onClick={onClose}>
          Close
        </Button>
      }
    >
      <ExportForm />
    </Modal>
  )
}
