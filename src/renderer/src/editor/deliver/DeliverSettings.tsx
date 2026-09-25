import { useMemo, useState, type ReactNode } from 'react'
import { AudioLines, Captions, FolderOpen, SlidersHorizontal } from 'lucide-react'
import { formatTimecode } from '@shared/project'
import { EXPORT_PRESETS, isAudioOnly, matchExportPreset, resolveExportSize, type ExportPreset } from '@shared/export-presets'
import { Button, Panel, ScrollArea, Section, Tabs } from '@/components'
import { cn } from '@/lib/cn'
import { exportCaptions, hasCaptions } from '@/lib/mediaActions'
import { useEditor } from '@/store/editor'
import {
  chooseDestination,
  chooseRange,
  CustomRangeFields,
  DestinationField,
  LoudnessFields,
  useExportForm,
  VideoFields
} from '../ExportDialog'
import type { RangeKind } from '../export-session'
import { fileName, folderOf } from './queue'

type DeliverTab = 'video' | 'audio' | 'file'

const TABS: { value: DeliverTab; label: string }[] = [
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: 'file', label: 'File' }
]

export interface DeliverSettingsProps {
  className?: string
}

/**
 * The Deliver page's Render Settings, laid out as Resolve's: presets as a row of cards, then the
 * file's name and location, then what to render, then Video / Audio / File tabs.
 *
 * Every field here is one of the export dialog's own (`ExportDialog.tsx`) over the one export
 * session, so choosing a preset here and pressing ⌘E exports the same file, and the Render
 * button on the queue (`RenderQueue`) starts the same job the dialog's Export does.
 */
export function DeliverSettings({ className }: DeliverSettingsProps): ReactNode {
  const form = useExportForm()
  const [tab, setTab] = useState<DeliverTab>('video')
  if (!form) {
    return (
      <Panel title="Render Settings" className={cn('h-full', className)}>
        <p className="px-3 py-4 text-[11px] text-ink-2">Open a timeline to set up a render.</p>
      </Panel>
    )
  }
  const { settings } = form
  return (
    <Panel title="Render Settings" className={cn('h-full', className)} bodyClassName="flex flex-col">
      <ScrollArea className="flex-1">
        <Section title="Presets">
          <PresetCards />
        </Section>

        <Section title="File">
          <NameAndLocation />
        </Section>

        <Section title="Render">
          <RangeChoice />
        </Section>

        <Tabs<DeliverTab>
          label="Render settings"
          value={tab}
          items={TABS.map((item) =>
            item.value === 'video' && isAudioOnly(settings.format)
              ? { ...item, label: 'Video · none' }
              : item
          )}
          onChange={setTab}
          className="mt-1"
        />
        <div role="tabpanel" aria-label={TABS.find((item) => item.value === tab)?.label} className="px-3 py-3">
          {tab === 'video' && <VideoFields />}
          {tab === 'audio' && <AudioTab />}
          {tab === 'file' && <FileTab />}
        </div>
      </ScrollArea>
    </Panel>
  )
}

/** A preset's frame as a small outline of its shape, so a vertical preset looks vertical. */
function PresetGlyph({ preset, canvas }: { preset: ExportPreset; canvas: { width: number; height: number } }): ReactNode {
  if (isAudioOnly(preset.settings.format)) return <AudioLines aria-hidden="true" className="size-5 text-ink-1" />
  const size = resolveExportSize(preset.settings.size, canvas.width, canvas.height)
  const box = 22
  const scale = box / Math.max(size.width, size.height)
  return (
    <span className="flex size-6 items-center justify-center" aria-hidden="true">
      <span
        className="rounded-[2px] border-[1.5px] border-current text-ink-1"
        style={{ width: Math.max(6, size.width * scale), height: Math.max(6, size.height * scale) }}
      />
    </span>
  )
}

/**
 * The presets as a row of cards (Resolve's "scrollable row of icons"). The chosen one is the
 * preset the current settings match exactly; change any field and the row shows Custom instead,
 * so the cards never claim a preset the file will not be.
 */
export function PresetCards(): ReactNode {
  const form = useExportForm()
  if (!form) return null
  const { session, locked, timeline, settings } = form
  const current = matchExportPreset(settings)
  const custom = !EXPORT_PRESETS.some((preset) => preset.id === current)
  const canvas = { width: timeline.width, height: timeline.height }
  return (
    <div role="radiogroup" aria-label="Render preset" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {EXPORT_PRESETS.map((preset) => {
        const chosen = preset.id === current
        return (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-label={`${preset.label}: ${preset.description}`}
            title={preset.description}
            disabled={locked}
            onClick={() => session.setSettings(preset.settings)}
            className={cn(
              't-press flex w-[92px] shrink-0 flex-col items-center gap-1.5 rounded-sm border px-1.5 py-2 text-center',
              'disabled:pointer-events-none disabled:opacity-50',
              chosen ? 'border-accent bg-accent/10 text-ink-0' : 'border-line bg-surface-2 text-ink-1 hover:bg-surface-3 hover:text-ink-0'
            )}
          >
            <PresetGlyph preset={preset} canvas={canvas} />
            <span className="line-clamp-2 text-[10px] leading-tight font-medium">{preset.label}</span>
          </button>
        )
      })}
      <div
        role="radio"
        aria-checked={custom}
        aria-disabled="true"
        aria-label="Custom: your own settings"
        className={cn(
          'flex w-[92px] shrink-0 flex-col items-center gap-1.5 rounded-sm border px-1.5 py-2 text-center',
          custom ? 'border-accent bg-accent/10 text-ink-0' : 'border-dashed border-line text-ink-2'
        )}
      >
        <SlidersHorizontal aria-hidden="true" className="size-5" />
        <span className="text-[10px] leading-tight font-medium">Custom</span>
      </div>
    </div>
  )
}

/** The file's name and the folder it goes in, as Resolve shows them, with Browse. */
function NameAndLocation(): ReactNode {
  const form = useExportForm()
  const projectName = useEditor((state) => state.project.name)
  if (!form) return null
  const { session, locked } = form
  const path = session.outputPath
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[64px_1fr] items-center gap-2">
        <span className="text-[11px] text-ink-1">Name</span>
        <span className="truncate text-[12px] text-ink-0" title={path ?? undefined}>
          {fileName(path) ?? <span className="text-ink-2">{projectName} — chosen when you render</span>}
        </span>
      </div>
      <div className="grid grid-cols-[64px_1fr] items-center gap-2">
        <span className="text-[11px] text-ink-1">Location</span>
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink-1" title={folderOf(path) ?? undefined}>
            {folderOf(path) ?? <span className="text-ink-2">Not chosen yet</span>}
          </span>
          <Button variant="subtle" icon={<FolderOpen className="size-3.5" />} onClick={() => void chooseDestination()} disabled={locked}>
            Browse…
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Entire timeline, In/Out range, or custom — Resolve's render range selector — as three buttons. */
function RangeChoice(): ReactNode {
  const form = useExportForm()
  if (!form) return null
  const { timeline, duration, session, marksSet, rangeIn, rangeOut, locked, range } = form
  const fps = timeline.fps
  const options: { value: RangeKind; label: string; detail: string; disabled?: boolean }[] = [
    { value: 'whole', label: 'Entire timeline', detail: formatTimecode(duration, fps, true) },
    {
      value: 'marks',
      label: 'In/Out range',
      detail: marksSet
        ? `${formatTimecode(rangeIn ?? 0, fps, true)} – ${formatTimecode(rangeOut ?? duration, fps, true)}`
        : 'Mark In and Out with I and O',
      disabled: !marksSet
    },
    { value: 'custom', label: 'Custom', detail: 'Type the bounds' }
  ]
  return (
    <>
      <div role="radiogroup" aria-label="Render range" className="grid grid-cols-3 gap-1">
        {options.map((option) => {
          const chosen = session.rangeKind === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={chosen}
              disabled={locked || option.disabled}
              onClick={() => chooseRange(option.value, fps, duration)}
              className={cn(
                't-press flex min-w-0 flex-col items-start gap-0.5 rounded-sm border px-2 py-1.5 text-left',
                'disabled:pointer-events-none disabled:opacity-45',
                chosen ? 'border-accent bg-accent/10' : 'border-line bg-surface-2 hover:bg-surface-3'
              )}
            >
              <span className={cn('text-[11px] font-medium', chosen ? 'text-ink-0' : 'text-ink-1')}>{option.label}</span>
              <span className="w-full truncate text-[10px] text-ink-2 tabular-nums">{option.detail}</span>
            </button>
          )
        })}
      </div>
      <CustomRangeFields />
      {'error' in range && duration > 0 && <p className="mt-1.5 text-[11px] text-pretty text-danger">{range.error}</p>}
    </>
  )
}

function AudioTab(): ReactNode {
  const form = useExportForm()
  if (!form) return null
  const { settings } = form
  return (
    <>
      <LoudnessFields />
      <p className="mt-2 text-[11px] text-pretty text-ink-2">
        {settings.format === 'png-sequence'
          ? 'A PNG sequence has no sound.'
          : 'Mastering is measured on the encoded file and corrected until it meets the target; the render queue shows what the file measured.'}
      </p>
    </>
  )
}

function FileTab(): ReactNode {
  // Keyed on the project, not run as a selector: a selector runs on every store change, the
  // playhead's included, and turning the captions into SRT is not a per-frame cost.
  const project = useEditor((state) => state.project)
  const captions = useMemo(() => {
    void project
    return hasCaptions()
  }, [project])
  return (
    <>
      <p className="mb-1.5 text-[11px] text-ink-1">Destination</p>
      <DestinationField />
      <div className="mt-4 border-t border-line pt-3">
        <p className="mb-1.5 text-[11px] text-ink-1">Captions</p>
        <Button
          variant="subtle"
          icon={<Captions className="size-3.5" />}
          onClick={() => void exportCaptions()}
          disabled={!captions}
          title={captions ? undefined : 'This timeline has no captions. Import an .srt or .vtt first.'}
        >
          Export captions (.srt)…
        </Button>
        <p className="mt-1.5 text-[11px] text-pretty text-ink-2">
          {captions
            ? 'The timeline’s captions as a sidecar file, for platforms that take subtitles separately.'
            : 'No captions on this timeline yet.'}
        </p>
      </div>
    </>
  )
}
