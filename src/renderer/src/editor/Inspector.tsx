import type { ReactNode } from 'react'
import { FolderOpen, MousePointerClick, RotateCcw } from 'lucide-react'
import {
  CANVAS_PRESETS,
  findAsset,
  formatTimecode,
  itemEnd,
  type Item,
  positionFromOrigin,
  positionToOrigin,
  LAYOUT_ORIGINS,
  LAYOUT_ORIGIN_LABEL,
  DEFAULT_LAYOUT_ORIGIN,
  type LayoutOrigin,
  normaliseCrop,
  isCropped,
  type Crop
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
import { AdjustmentsSection } from './AdjustmentsSection'
import { CompositionSection } from './CompositionSection'
import { TextStyleSection } from './TextStyleSection'

/**
 * One value across a multi-selection, or `mixed` when they disagree.
 *
 * Showing the first item's value and pretending it speaks for the rest is how an
 * inspector silently flattens five different opacities into one on the next keystroke.
 */
/**
 * `===` plus NaN-equals-NaN, which `===` gets wrong and `Object.is` over-corrects.
 *
 * A single selected clip whose value is NaN reported "Mixed" — one item disagreeing with
 * itself — because `NaN !== NaN`. `Object.is` would fix that and introduce the mirror bug:
 * it separates `-0` from `0`, and `Math.round` produces `-0` readily, so two clips that
 * look identical would read as mixed instead.
 */
function same<T>(a: T, b: T): boolean {
  if (a === b) return true
  return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)
}

function common<T>(items: Item[], read: (item: Item) => T): { value: T; mixed: boolean } {
  const first = items[0]
  if (!first) return { value: undefined as T, mixed: false }
  const value = read(first)
  return { value, mixed: items.some((item) => !same(read(item), value)) }
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

/** Named in reading order, not object-key order: top and bottom belong beside each other. */
const CROP_EDGES: { edge: keyof Crop; label: string }[] = [
  { edge: 'top', label: 'Top' },
  { edge: 'bottom', label: 'Bottom' },
  { edge: 'left', label: 'Left' },
  { edge: 'right', label: 'Right' }
]

export function Inspector(): ReactNode {
  const selected = useSelectedItems()
  const timeline = useEditor(selectTimeline)
  const project = useEditor((state) => state.project)
  const patchLayout = useEditor((state) => state.patchLayout)
  const transact = useEditor((state) => state.transact)
  const setCrop = useEditor((state) => state.setCrop)
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
  const textItems = selected.filter((item) => findAsset(project, item.assetId)?.kind === 'text')
  const htmlItems = selected.filter((item) => findAsset(project, item.assetId)?.kind === 'html')
  const layout = (read: (item: Item) => number): { value: number; mixed: boolean } =>
    common(selected, read)

  const applyLayout = (patch: Parameters<typeof patchLayout>[1]): void => {
    for (const item of selected) patchLayout(item.id, patch)
  }
  const applyItem = (patch: Parameters<typeof patchItem>[1]): void => {
    for (const item of selected) patchItem(item.id, patch)
  }

  // X and Y are shown from whichever corner the clip is anchored to. `left` and `top` stay
  // absolute in the model — the conversion happens here, at the one place a person types a
  // number, so nothing that draws or exports has to know an origin exists.
  const frame = { width: timeline?.width ?? 0, height: timeline?.height ?? 0 }
  const origin = (selected[0]?.layout.origin ?? DEFAULT_LAYOUT_ORIGIN) as LayoutOrigin
  const positionOf = (item: Item): { x: number; y: number } =>
    positionFromOrigin(item.layout, frame, origin)

  const left = layout((item) => positionOf(item).x)
  const top = layout((item) => positionOf(item).y)

  /** Writes one axis back, keeping the other where the clip already is. */
  const setPosition = (axis: 'x' | 'y', next: number): void => {
    for (const item of selected) {
      const current = positionFromOrigin(item.layout, frame, origin)
      patchLayout(
        item.id,
        positionToOrigin({ ...current, [axis]: next }, item.layout, frame, origin)
      )
    }
  }

  const cropOf = (edge: keyof Crop): number =>
    normaliseCrop(selected[0]?.crop)[edge]
  const cropped = selected.some((item) => isCropped(item.crop))
  const applyCrop = (edge: keyof Crop, fraction: number): void => {
    transact(() => {
      for (const item of selected) setCrop(item.id, edge, fraction)
    })
  }
  const resetCrop = (): void => {
    transact(() => {
      for (const item of selected) {
        for (const { edge } of CROP_EDGES) setCrop(item.id, edge, 0)
      }
    })
  }

  /**
   * Re-anchor without moving the clip.
   *
   * The position is re-expressed from the new corner rather than reapplied, so choosing a
   * different origin never shifts anything — it changes the numbers, not the picture. An
   * origin that moved the clip would make the control feel like a transform.
   */
  const setOrigin = (next: LayoutOrigin): void => {
    transact(() => {
      for (const item of selected) patchLayout(item.id, { origin: next })
    })
  }
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
          {/* Wrapped in a Field for a visible caption: `Select` carries only an aria-label,
              which is enough when a Section title names it and not enough here, where it sits
              among X, Y, W and H and would otherwise be an unexplained dropdown. */}
          {/* "Origin" rather than "X and Y from": the Field label column truncates, and a
              caption that reads "X and Y fr..." names nothing. Origin is what design tools
              call this, and the aria-label carries the longer phrasing for a screen reader. */}
          <Field label="Origin" className="mb-1.5">
            <Select
              label="Measure X and Y from"
              value={origin}
              onChange={setOrigin}
              options={LAYOUT_ORIGINS.map((value) => ({
                value,
                label: LAYOUT_ORIGIN_LABEL[value]
              }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField
              label="X"
              value={left.value}
              mixed={left.mixed}
              onCommit={(next) => setPosition('x', next)}
              suffix="px"
            />
            <NumberField
              label="Y"
              value={top.value}
              mixed={top.mixed}
              onCommit={(next) => setPosition('y', next)}
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

        {/* Type controls only for text items: an outline width on a video clip would be a
            control that does nothing, which is the thing this codebase keeps finding. */}
        {textItems.length > 0 && (
          <TextStyleSection
            items={textItems}
            asset={findAsset(project, textItems[0]!.assetId)}
          />
        )}

        {/* Crop applies to anything with a picture. Audio has no edges to trim. */}
        {selected.some((item) => findAsset(project, item.assetId)?.hasVideo !== false) && (
          <Section
            title="Crop"
            actions={
              cropped ? (
                <IconButton
                  label="Remove the crop"
                  icon={<RotateCcw aria-hidden="true" className="size-3" />}
                  onClick={resetCrop}
                  size="sm"
                  variant="subtle"
                />
              ) : undefined
            }
          >
            <div className="grid grid-cols-2 gap-1.5">
              {CROP_EDGES.map(({ edge, label }) => (
                <NumberField
                  key={edge}
                  label={label}
                  // Shown as a percentage because that is what a person means by "take ten off
                  // the top"; stored as a fraction so it survives a change of source resolution.
                  value={Math.round(cropOf(edge) * 1000) / 10}
                  min={0}
                  max={98}
                  step={1}
                  precision={1}
                  suffix="%"
                  onCommit={(next) => applyCrop(edge, next / 100)}
                />
              ))}
            </div>
          </Section>
        )}

        {/* A composition's own controls, drawn from what it declares. Only for html items:
            every other kind declares nothing, and an empty section is worse than none. */}
        {htmlItems.length > 0 && (
          <CompositionSection
            items={htmlItems}
            asset={findAsset(project, htmlItems[0]!.assetId)}
          />
        )}

        {/* Adjustments apply to anything with a picture. Audio-only items have nothing to
            filter, so they get no section rather than a set of sliders that do nothing. */}
        {timeline && selected.some((item) => findAsset(project, item.assetId)?.hasVideo !== false) && (
          <AdjustmentsSection
            items={selected.filter((item) => findAsset(project, item.assetId)?.hasVideo !== false)}
            timeline={timeline}
          />
        )}

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
