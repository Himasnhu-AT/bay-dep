import type { ReactNode } from 'react'
import { AlertTriangle, Check, FolderOpen, Loader2, Upload } from 'lucide-react'
import type { ExportFormat } from '@shared/ipc'
import { formatFps, formatTimecode, timelineDuration } from '@shared/project'
import type { LoudnessPreset } from '@shared/loudness'
import { parseTime } from '@shared/pins'
import {
  EXPORT_PRESETS,
  exportAspectMismatch,
  isAudioOnly,
  loudnessTarget,
  matchExportPreset,
  resolveExportRange,
  resolveExportSize,
  type ExportQuality,
  type ExportSettings,
  type ExportSize
} from '@shared/export-presets'
import { Button, Field, InlineAlert, Modal, NumberField, ProgressBar, Section, Select, TextField } from '@/components'
import { call } from '@/lib/bay'
import { cn } from '@/lib/cn'
import { selectTimeline, useEditor } from '@/store/editor'
import { useProjectSettingsDialog } from '@/store/project-settings-dialog'
import { exportBlocker, rangeChoice, TERMINAL, useExportSession, type RangeKind } from './export-session'

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'mp4', label: 'MP4 · H.264' },
  { value: 'mov', label: 'MOV · QuickTime' },
  { value: 'webm', label: 'WebM · VP9' },
  { value: 'wav', label: 'WAV · audio only' },
  { value: 'mp3', label: 'MP3 · audio only' },
  { value: 'png-sequence', label: 'PNG sequence' }
]

const QUALITIES: { value: ExportQuality; label: string }[] = [
  { value: 'draft', label: 'Draft — small, soft' },
  { value: 'good', label: 'Good — the default' },
  { value: 'best', label: 'Best — largest file' }
]

type LoudnessChoice = 'off' | LoudnessPreset | 'custom'

/** Off by default: mastering moves the file's level away from the level the preview played. */
const LOUDNESS: { value: LoudnessChoice; label: string }[] = [
  { value: 'off', label: 'Off — as mixed' },
  { value: 'streaming', label: 'Streaming — −14 LUFS' },
  { value: 'podcast', label: 'Podcast — −16 LUFS' },
  { value: 'broadcast', label: 'Broadcast — −23 LUFS' },
  { value: 'custom', label: 'Custom target…' }
]

const HEIGHTS = [2160, 1080, 720, 480]

/** The Size select's value for a size: `timeline`, `h:1080`, `f:1080x1920`. */
function sizeValue(size: ExportSize): string {
  if (size.kind === 'timeline') return 'timeline'
  if (size.kind === 'height') return `h:${size.height}`
  return `f:${size.width}x${size.height}`
}

function parseSizeValue(value: string): ExportSize | null {
  if (value === 'timeline') return { kind: 'timeline' }
  const height = /^h:(\d+)$/.exec(value)
  if (height) return { kind: 'height', height: Number(height[1]) }
  const frame = /^f:(\d+)x(\d+)$/.exec(value)
  if (frame) return { kind: 'frame', width: Number(frame[1]), height: Number(frame[2]) }
  return null
}

/** Every frame size a preset delivers, once each, for the Size menu. */
const PRESET_FRAMES = [
  ...new Map(
    EXPORT_PRESETS.flatMap((preset) =>
      preset.settings.size.kind === 'frame' ? [[sizeValue(preset.settings.size), preset.settings.size] as const] : []
    )
  ).values()
]

function aspectName(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const d = gcd(width, height) || 1
  const named: Record<string, string> = { '16:9': '16:9', '9:16': '9:16', '1:1': '1:1', '4:5': '4:5', '64:27': '21:9' }
  const exact = `${width / d}:${height / d}`
  return named[exact] ?? (width >= height ? `${(width / height).toFixed(2)}:1` : `1:${(height / width).toFixed(2)}`)
}

export interface ExportFormProps {
  /** The left rail is 212px wide; the modal is not. The rail draws its own Export button. */
  compact?: boolean
}

/**
 * The export form. Its settings and the job it starts live in `useExportSession`, so the dialog
 * and the rail's Export panel are one export, and closing either leaves a running job running
 * and visible the next time either opens.
 */
export function ExportForm({ compact = false }: ExportFormProps): ReactNode {
  const timeline = useEditor(selectTimeline)
  const duration = useEditor((state) => {
    const tl = selectTimeline(state)
    return tl ? timelineDuration(tl) : 0
  })
  const rangeIn = useEditor((state) => state.rangeIn)
  const rangeOut = useEditor((state) => state.rangeOut)
  const session = useExportSession()

  if (!timeline) return null

  const { settings, progress, incomplete } = session
  const audioOnly = isAudioOnly(settings.format)
  const running = progress !== null && !TERMINAL.includes(progress.stage)
  const locked = running || session.starting
  const size = resolveExportSize(settings.size, timeline.width, timeline.height)
  const presetId = matchExportPreset(settings)
  const preset = EXPORT_PRESETS.find((candidate) => candidate.id === presetId)
  const mismatch = exportAspectMismatch(settings, timeline.width, timeline.height)
  const marksSet = rangeIn !== null || rangeOut !== null
  const range = resolveExportRange(rangeChoice(session, timeline.fps), duration, { rangeIn, rangeOut })
  const loudnessChoice: LoudnessChoice = typeof settings.loudness === 'string' ? settings.loudness : 'custom'
  const loudnessProblem = settings.format !== 'png-sequence' ? loudnessTarget(settings.loudness) : null

  const update = (patch: Partial<ExportSettings>): void => session.setSettings({ ...settings, ...patch })

  const sizeOptions = [
    { value: 'timeline', label: `Canvas size · ${timeline.width} × ${timeline.height}` },
    ...HEIGHTS.map((height) => ({ value: `h:${height}`, label: height === 2160 ? '2160p · 4K' : `${height}p` })),
    ...PRESET_FRAMES.map((frame) => ({
      value: sizeValue(frame),
      label: `${frame.width} × ${frame.height} · ${aspectName(frame.width, frame.height)}`
    }))
  ]

  const choosePath = async (): Promise<void> => {
    const chosen = await call('Choosing a destination', (api) =>
      api.export.chooseOutputPath(useEditor.getState().project.name, settings.format)
    )
    if (chosen) session.setOutputPath(chosen)
  }

  const blockedBy = exportBlocker(session, timeline.fps, duration, { rangeIn, rangeOut })

  const percent = progress && progress.progress !== null ? Math.round(progress.progress * 100) : null
  const doneAt = progress?.stage === 'done' ? (progress.outputPath ?? session.outputPath) : null

  return (
    <div className={cn(compact && 'text-[11px]')}>
      <Section title="Preset">
        <Select
          label="Export preset"
          value={presetId}
          options={[
            ...EXPORT_PRESETS.map((candidate) => ({ value: candidate.id, label: candidate.label })),
            ...(preset ? [] : [{ value: 'custom', label: 'Custom' }])
          ]}
          onChange={(id) => {
            const next = EXPORT_PRESETS.find((candidate) => candidate.id === id)
            if (next) session.setSettings(next.settings)
          }}
          disabled={locked}
        />
        <p className="mt-1.5 text-[11px] text-pretty text-ink-2">
          {preset ? preset.description : 'Your own settings. Choose a preset to start from one.'}
        </p>
      </Section>

      <Section title="Format">
        <Field label="Container">
          <Select label="Export format" value={settings.format} options={FORMATS} onChange={(format) => update({ format })} disabled={locked} />
        </Field>
        <div className="mt-1.5">
          <Field label="Quality">
            <Select
              label="Export quality"
              value={settings.quality}
              options={QUALITIES}
              onChange={(quality) => update({ quality })}
              // Quality drives the video encoder (VideoToolbox -q:v, VP9 CRF); a WAV has nothing to apply it to.
              disabled={locked || audioOnly}
            />
          </Field>
        </div>
        <div className="mt-1.5">
          <Field label="Size">
            <Select
              label="Export resolution"
              value={sizeValue(settings.size)}
              options={sizeOptions}
              onChange={(value) => {
                const next = parseSizeValue(value)
                if (next) update({ size: next })
              }}
              disabled={locked || audioOnly}
            />
          </Field>
        </div>
        <div className="mt-1.5">
          <Field label="Loudness">
            <Select
              label="Loudness mastering"
              value={loudnessChoice}
              options={LOUDNESS}
              onChange={(choice) => {
                if (choice === 'custom') {
                  const current = loudnessTarget(settings.loudness)
                  const seed = 'target' in current && current.target ? current.target : { integratedLufs: -14, truePeakDb: -1 }
                  update({ loudness: { ...seed } })
                } else {
                  update({ loudness: choice })
                }
              }}
              // A PNG sequence has no audio to master.
              disabled={locked || settings.format === 'png-sequence'}
            />
          </Field>
        </div>
        {typeof settings.loudness === 'object' && settings.format !== 'png-sequence' && (
          <div className="mt-1.5 grid grid-cols-[64px_1fr] gap-2">
            <span aria-hidden="true" />
            <div className="grid grid-cols-2 gap-1.5">
              <NumberField
                label="Target"
                value={settings.loudness.integratedLufs}
                step={0.5}
                min={-40}
                max={-5}
                precision={1}
                suffix="LUFS"
                disabled={locked}
                onCommit={(integratedLufs) =>
                  typeof settings.loudness === 'object' && update({ loudness: { ...settings.loudness, integratedLufs } })
                }
              />
              <NumberField
                label="Peak"
                value={settings.loudness.truePeakDb}
                step={0.5}
                min={-12}
                max={0}
                precision={1}
                suffix="dBTP"
                disabled={locked}
                onCommit={(truePeakDb) =>
                  typeof settings.loudness === 'object' && update({ loudness: { ...settings.loudness, truePeakDb } })
                }
              />
            </div>
          </div>
        )}
        {loudnessProblem && 'error' in loudnessProblem && <p className="mt-1.5 text-[11px] text-pretty text-danger">{loudnessProblem.error}</p>}

        {/* What the file will be. No size estimate: VideoToolbox's quality mode has no fixed
            bitrate, so any number here would be a guess dressed as a fact. */}
        <p className="mt-2 text-[11px] text-ink-2 tabular-nums">
          {audioOnly
            ? 'Audio only'
            : `${size.width} × ${size.height} · ${formatFps(timeline.fps)} fps`}
          {'error' in range
            ? ''
            : ` · ${formatTimecode(range.toFrame - range.fromFrame + 1, timeline.fps, true)} · ${range.toFrame - range.fromFrame + 1} frames`}
        </p>

        {mismatch && (
          <InlineAlert tone="warning" className="mt-2">
            <p>
              Your canvas is {aspectName(timeline.width, timeline.height)} ({timeline.width} × {timeline.height}) and
              this file is {aspectName(mismatch.frame.width, mismatch.frame.height)}. The whole picture is kept, with black
              bars {mismatch.bars === 'pillarbox' ? 'left and right' : 'above and below'}. To fill the frame instead, change
              the canvas to that shape and choose how clips refit.
            </p>
            <Button
              variant="subtle"
              className="mt-1.5"
              disabled={locked}
              onClick={() =>
                useProjectSettingsDialog.getState().show({
                  width: mismatch.frame.width,
                  height: mismatch.frame.height,
                  reason: `Proposed by Export: ${mismatch.frame.width} × ${mismatch.frame.height} matches the file, so it fills the frame without bars. Nothing changes until you apply it, and it can be undone.`
                })
              }
            >
              Change canvas to {mismatch.frame.width} × {mismatch.frame.height}…
            </Button>
          </InlineAlert>
        )}
      </Section>

      <Section title="Range">
        <Select<RangeKind>
          label="Export range"
          value={session.rangeKind}
          options={[
            { value: 'whole', label: `Whole timeline · ${formatTimecode(duration, timeline.fps, true)}` },
            {
              value: 'marks',
              label: marksSet
                ? `In to Out · ${formatTimecode(rangeIn ?? 0, timeline.fps, true)} – ${formatTimecode(rangeOut ?? duration, timeline.fps, true)}`
                : 'In to Out · none marked (I and O)',
              disabled: !marksSet
            },
            { value: 'custom', label: 'Custom…' }
          ]}
          onChange={(kind) => {
            if (kind === 'custom' && !session.customStart && !session.customEnd) {
              // Seeded with the whole timeline, so the fields show the format they accept.
              session.setCustom({ start: formatTimecode(0, timeline.fps, true), end: formatTimecode(duration, timeline.fps, true) })
            }
            session.setRangeKind(kind)
          }}
          disabled={locked}
        />
        {session.rangeKind === 'custom' && (
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <TextField
              label="Range start"
              leading={<span className="text-[11px]">From</span>}
              value={session.customStart}
              onChange={(event) => session.setCustom({ start: event.target.value })}
              invalid={parseTime(session.customStart, timeline.fps) === null}
              disabled={locked}
              className="tabular-nums"
            />
            <TextField
              label="Range end, the first frame not exported"
              leading={<span className="text-[11px]">To</span>}
              value={session.customEnd}
              onChange={(event) => session.setCustom({ end: event.target.value })}
              invalid={parseTime(session.customEnd, timeline.fps) === null}
              disabled={locked}
              className="tabular-nums"
            />
          </div>
        )}
        {session.rangeKind === 'marks' && !marksSet && (
          <p className="mt-1.5 text-[11px] text-ink-2">Mark In and Out on the timeline with I and O.</p>
        )}
        {'error' in range && duration > 0 && <p className="mt-1.5 text-[11px] text-pretty text-danger">{range.error}</p>}
      </Section>

      <Section title="Destination">
        <div className="flex items-center gap-2">
          <p
            className="min-w-0 flex-1 truncate rounded-sm border border-line bg-surface-2 px-2 py-1.5 text-[11px] text-ink-1"
            title={session.outputPath ?? undefined}
          >
            {session.outputPath ?? 'Asked when you export'}
          </p>
          <Button variant="subtle" icon={<FolderOpen className="size-3.5" />} onClick={() => void choosePath()} disabled={locked}>
            Choose…
          </Button>
        </div>
      </Section>

      <Section title="Progress">
        {progress ? (
          <>
            <div className="mb-2 flex items-center gap-2">
              {progress.stage === 'done' ? (
                <Check aria-hidden="true" className="size-3.5 text-success" />
              ) : progress.stage === 'failed' ? (
                <AlertTriangle aria-hidden="true" className="size-3.5 text-danger" />
              ) : progress.stage === 'cancelled' ? null : (
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin text-ink-1" />
              )}
              <span className="text-[11px] text-ink-1 capitalize">{progress.stage}</span>
              <span className="ml-auto text-[11px] text-ink-2 tabular-nums">{percent === null ? '—' : `${percent}%`}</span>
            </div>
            <ProgressBar value={percent === null ? null : percent / 100} label="Export progress" />
            <p className="mt-1.5 text-[10px] text-ink-2 tabular-nums">
              {progress.framesDone}
              {progress.framesTotal ? ` / ${progress.framesTotal}` : ''} frames
              {progress.message ? ` · ${progress.message}` : ''}
            </p>
            {progress.error && <p className="mt-1 text-[11px] text-pretty text-danger">{progress.error}</p>}
            {incomplete && (
              <InlineAlert tone="warning" className="mt-1.5">
                {incomplete.message}
              </InlineAlert>
            )}
            {doneAt && <DoneActions path={doneAt} />}
          </>
        ) : (
          <p className="text-[11px] text-ink-2">{blockedBy ?? 'Nothing exporting yet.'}</p>
        )}
        {(compact || running) && (
          <div className="mt-3 flex items-center gap-2">
            {compact && <StartButton blockedBy={blockedBy} />}
            {running && (
              <Button variant="danger" size="md" onClick={session.cancel}>
                Cancel
              </Button>
            )}
          </div>
        )}
      </Section>
    </div>
  )
}

function DoneActions({ path }: { path: string }): ReactNode {
  const notify = useEditor((state) => state.notify)
  const act = async (action: 'reveal' | 'open'): Promise<void> => {
    const ok = await call(action === 'reveal' ? 'Showing the file' : 'Opening the file', (api) => api.export[action](path))
    if (ok === false) notify('That file is not one this window exported, so bay will not open it.', 'error')
  }
  return (
    <div className="mt-2 flex items-center gap-2">
      <Button variant="subtle" onClick={() => void act('reveal')}>
        Show in Finder
      </Button>
      <Button variant="subtle" onClick={() => void act('open')}>
        Open
      </Button>
    </div>
  )
}

function StartButton({ blockedBy }: { blockedBy: string | null }): ReactNode {
  const running = useExportSession((state) => state.progress !== null && !TERMINAL.includes(state.progress.stage))
  const starting = useExportSession((state) => state.starting)
  const start = useExportSession((state) => state.start)
  return (
    <Button
      variant="primary"
      size="md"
      icon={<Upload className="size-3.5" />}
      onClick={() => void start()}
      disabled={blockedBy !== null || running || starting}
      title={blockedBy ?? undefined}
    >
      {starting ? 'Starting…' : 'Export'}
    </Button>
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
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            Close
          </Button>
          <DialogStart />
        </>
      }
    >
      <ExportForm />
    </Modal>
  )
}

/** The dialog's primary action, in the footer where a dialog's primary action belongs. */
function DialogStart(): ReactNode {
  const timeline = useEditor(selectTimeline)
  const duration = timeline ? timelineDuration(timeline) : 0
  const session = useExportSession()
  const rangeIn = useEditor((state) => state.rangeIn)
  const rangeOut = useEditor((state) => state.rangeOut)
  if (!timeline) return null
  const blockedBy = exportBlocker(session, timeline.fps, duration, { rangeIn, rangeOut })
  return <StartButton blockedBy={blockedBy} />
}
