import type { ReactNode } from 'react'
import { FolderOpen, MousePointerClick } from 'lucide-react'
import {
  CANVAS_PRESETS,
  findAsset,
  formatTimecode,
  itemEnd,
  type Item
} from '@shared/project'
import {
  Field,
  IconButton,
  NumberField,
  Panel,
  ScrollArea,
  Section,
  Select,
  Slider
} from '@/components'
import { call, formatSourceDuration } from '@/lib/bay'
import { useSelectedItems } from '@/lib/useSelectedItems'
import { selectTimeline, useEditor } from '@/store/editor'

/**
 * One value across a multi-selection, or `mixed` when they disagree.
 *
 * Showing the first item's value and pretending it speaks for the rest is how an
 * inspector silently flattens five different opacities into one on the next keystroke.
 */
function common<T>(items: Item[], read: (item: Item) => T): { value: T; mixed: boolean } {
  const first = items[0]
  if (!first) return { value: undefined as T, mixed: false }
  const value = read(first)
  return { value, mixed: items.some((item) => read(item) !== value) }
}

function Readout({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="shrink-0 text-[11px] text-ink-2">{label}</span>
      <span className="truncate text-right text-[11px] text-ink-1 tabular-nums">{value}</span>
    </div>
  )
}

function TimelineInspector(): ReactNode {
  const timeline = useEditor(selectTimeline)
  const setCanvasPreset = useEditor((state) => state.setCanvasPreset)
  if (!timeline) return null

  const matching = CANVAS_PRESETS.find(
    (preset) => preset.width === timeline.width && preset.height === timeline.height
  )

  return (
    <>
      <Section title="Canvas">
        <Field label="Preset">
          <Select
            label="Canvas preset"
            value={matching?.id ?? 'custom'}
            options={[
              ...CANVAS_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
              ...(matching ? [] : [{ value: 'custom', label: 'Custom', disabled: true }])
            ]}
            onChange={setCanvasPreset}
          />
        </Field>
        <div className="mt-2">
          <Readout label="Resolution" value={`${timeline.width} × ${timeline.height}`} />
          <Readout label="Frame rate" value={`${timeline.fps} fps`} />
          <Readout label="Tracks" value={timeline.tracks.length} />
        </div>
      </Section>
      <Section title="Selection">
        <div className="flex items-start gap-2 text-ink-2">
          <MousePointerClick aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <p className="text-[11px] leading-relaxed">
            Select a clip on the timeline to edit its position, size, fades and speed.
            Shift-click to add to the selection.
          </p>
        </div>
      </Section>
    </>
  )
}

export function Inspector(): ReactNode {
  const selected = useSelectedItems()
  const timeline = useEditor(selectTimeline)
  const project = useEditor((state) => state.project)
  const patchLayout = useEditor((state) => state.patchLayout)
  const patchItem = useEditor((state) => state.patchItem)
  const moveItem = useEditor((state) => state.moveItem)
  const trimItem = useEditor((state) => state.trimItem)

  const fps = timeline?.fps ?? 30
  const count = selected.length

  if (count === 0) {
    return (
      <Panel title="Inspector" className="h-full" bodyClassName="flex flex-col">
        <ScrollArea className="flex-1">
          <TimelineInspector />
        </ScrollArea>
      </Panel>
    )
  }

  const first = selected[0]
  const asset = first ? findAsset(project, first.assetId) : undefined
  const layout = (read: (item: Item) => number): { value: number; mixed: boolean } =>
    common(selected, read)

  const applyLayout = (patch: Parameters<typeof patchLayout>[1]): void => {
    for (const item of selected) patchLayout(item.id, patch)
  }
  const applyItem = (patch: Parameters<typeof patchItem>[1]): void => {
    for (const item of selected) patchItem(item.id, patch)
  }

  const left = layout((item) => item.layout.left)
  const top = layout((item) => item.layout.top)
  const width = layout((item) => item.layout.width)
  const height = layout((item) => item.layout.height)
  const rotation = layout((item) => item.layout.rotation)
  const opacity = layout((item) => item.layout.opacity)
  const volume = layout((item) => item.volume)
  const speed = layout((item) => item.speed)
  const fadeIn = layout((item) => item.fadeInFrames)
  const fadeOut = layout((item) => item.fadeOutFrames)
  const from = layout((item) => item.from)
  const durationInFrames = layout((item) => item.durationInFrames)

  return (
    <Panel
      title="Inspector"
      actions={
        count > 1 ? (
          <span className="text-[11px] text-ink-1 tabular-nums">{count} clips</span>
        ) : undefined
      }
      className="h-full"
      bodyClassName="flex flex-col"
    >
      <ScrollArea className="flex-1">
        <Section
          title="Source"
          actions={
            asset?.path ? (
              <IconButton
                size="xs"
                tooltipSide="left"
                label="Reveal in Finder"
                icon={<FolderOpen className="size-3" />}
                onClick={() =>
                  void call('Reveal in Finder', (api) =>
                    api.media.revealInFolder(asset.path as string)
                  )
                }
              />
            ) : undefined
          }
        >
          {count > 1 ? (
            <p className="text-[11px] text-ink-2">
              {count} clips selected. Shared values are shown; differing ones read “Mixed”.
            </p>
          ) : (
            <>
              <Readout label="Name" value={asset?.name ?? 'Missing media'} />
              <Readout label="Kind" value={asset?.kind ?? '—'} />
              <Readout
                label="Size"
                value={asset?.width && asset.height ? `${asset.width} × ${asset.height}` : '—'}
              />
              <Readout label="Source length" value={formatSourceDuration(asset?.durationUs ?? 0)} />
              {asset?.error && (
                <p className="mt-1 text-[11px] text-danger">{asset.error}</p>
              )}
            </>
          )}
        </Section>

        <Section title="Timing">
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField
              label="In"
              value={from.value}
              mixed={from.mixed}
              // `from` goes through `moveItem`, not `patchItem`: only the move path checks
              // for collisions, and a typed-in start that overlaps a neighbour must be
              // refused the same way a dragged one is.
              onCommit={(next) => {
                for (const item of selected) moveItem(item.id, next)
              }}
              min={0}
              suffix="f"
            />
            <NumberField
              label="Len"
              value={durationInFrames.value}
              mixed={durationInFrames.mixed}
              onCommit={(next) => {
                for (const item of selected) trimItem(item.id, 'end', item.from + next)
              }}
              min={1}
              suffix="f"
            />
          </div>
          {first && count === 1 && (
            <div className="mt-2">
              <Readout label="Starts" value={formatTimecode(first.from, fps, true)} />
              <Readout label="Ends" value={formatTimecode(itemEnd(first), fps, true)} />
              <Readout
                label="Duration"
                value={formatTimecode(first.durationInFrames, fps, true)}
              />
            </div>
          )}
        </Section>

        <Section title="Transform">
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField
              label="X"
              value={left.value}
              mixed={left.mixed}
              onCommit={(next) => applyLayout({ left: next })}
              suffix="px"
            />
            <NumberField
              label="Y"
              value={top.value}
              mixed={top.mixed}
              onCommit={(next) => applyLayout({ top: next })}
              suffix="px"
            />
            <NumberField
              label="W"
              value={width.value}
              mixed={width.mixed}
              onCommit={(next) => applyLayout({ width: Math.max(1, next) })}
              min={1}
              suffix="px"
            />
            <NumberField
              label="H"
              value={height.value}
              mixed={height.mixed}
              onCommit={(next) => applyLayout({ height: Math.max(1, next) })}
              min={1}
              suffix="px"
            />
          </div>
          <div className="mt-1.5">
            <NumberField
              label="Rotate"
              value={rotation.value}
              mixed={rotation.mixed}
              onCommit={(next) => applyLayout({ rotation: next })}
              suffix="°"
            />
          </div>
          <div className="mt-2">
            <Field label="Opacity" hint={`${Math.round((opacity.value ?? 1) * 100)}%`}>
              <Slider
                label="Opacity"
                value={opacity.value ?? 1}
                onCommit={(next) => applyLayout({ opacity: next })}
              />
            </Field>
          </div>
        </Section>

        <Section title="Audio & speed">
          <Field label="Volume" hint={`${Math.round((volume.value ?? 1) * 100)}%`}>
            <Slider
              label="Volume"
              min={0}
              max={2}
              step={0.01}
              value={volume.value ?? 1}
              onCommit={(next) => applyItem({ volume: next })}
            />
          </Field>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <NumberField
              label="In"
              value={fadeIn.value}
              mixed={fadeIn.mixed}
              onCommit={(next) => applyItem({ fadeInFrames: Math.max(0, next) })}
              min={0}
              suffix="f"
            />
            <NumberField
              label="Out"
              value={fadeOut.value}
              mixed={fadeOut.mixed}
              onCommit={(next) => applyItem({ fadeOutFrames: Math.max(0, next) })}
              min={0}
              suffix="f"
            />
          </div>
          <div className="mt-1.5">
            <NumberField
              label="Speed"
              value={speed.value}
              mixed={speed.mixed}
              onCommit={(next) => applyItem({ speed: Math.max(0.1, next) })}
              step={0.05}
              min={0.1}
              max={8}
              precision={2}
              suffix="×"
            />
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-ink-2">
            Fades are in frames and apply to this clip’s own picture and sound. Speed changes
            how fast the source is read; it does not change the clip’s length on the timeline.
          </p>
        </Section>
      </ScrollArea>
    </Panel>
  )
}
