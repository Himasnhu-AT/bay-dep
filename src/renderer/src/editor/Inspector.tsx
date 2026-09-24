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
  type Crop,
  KEYFRAME_PROPERTIES,
  type KeyframeProperty,
  type Layout,
  FRAME_RATES,
  formatFps,
  matchFrameRate
} from '@shared/project'
import {
  Button,
  Field,
  IconButton,
  NumberField,
  Panel,
  ScrollArea,
  Section,
  Select,
  SliderField
} from '@/components'
import { call, formatSourceDuration } from '@/lib/bay'
import { useSelectedItems } from '@/lib/useSelectedItems'
import { selectTimeline, useEditor } from '@/store/editor'
import { useProjectSettingsDialog } from '@/store/project-settings-dialog'
import { AdjustmentsSection } from './AdjustmentsSection'
import { GradeSection } from './GradeSection'
import { isGradeableKind } from '@shared/grade'
import { CompositionSection } from './CompositionSection'
import { TextStyleSection } from './TextStyleSection'
import { KeyDiamond, KeyNavigation, Keyed, relativeFrame } from './KeyframeControls'
import { animatedLayoutAt, animatedVolumeAt, PICTURE_PROPERTIES } from '@shared/keyframes'

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
  const setFps = useEditor((state) => state.setFps)
  const notify = useEditor((state) => state.notify)
  if (!timeline) return null

  const matching = CANVAS_PRESETS.find(
    (preset) => preset.width === timeline.width && preset.height === timeline.height
  )
  const matchingRate = matchFrameRate(timeline.fps)

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
            onChange={(id) => {
              // Refits clips the way set_canvas does (fit: auto); say so, since it moved them.
              const result = setCanvasPreset(id)
              if ('error' in result) notify(result.error, 'error')
              else if (result.refitted > 0) notify(`Canvas changed; ${result.refitted} clip${result.refitted === 1 ? '' : 's'} refitted. Undo to put them back.`)
            }}
          />
        </Field>
        {/* A rate, not a readout, because every clip's position is *expressed in* this number —
            so it is the one canvas property whose change has to move the timeline, and leaving
            it read-only meant a project could only ever be 30fps. Changing it keeps wall-clock
            time and reports any clip it had to nudge a frame, because a retime that moved
            something silently is found three exports later. */}
        <Field label="Frame rate">
          <Select
            label="Frame rate"
            value={matchingRate?.id ?? 'custom'}
            options={[
              ...FRAME_RATES.map((rate) => ({ value: rate.id, label: rate.label })),
              ...(matchingRate
                ? []
                : [{ value: 'custom', label: `${formatFps(timeline.fps)} · custom`, disabled: true }])
            ]}
            onChange={(id) => {
              const rate = FRAME_RATES.find((candidate) => candidate.id === id)
              if (!rate) return
              const { nudged } = setFps(rate.fps)
              if (nudged > 0) {
                notify(
                  `Retimed to ${formatFps(rate.fps)} fps. ${nudged} clip${nudged === 1 ? '' : 's'} ` +
                    `moved a frame to stay in order.`
                )
              }
            }}
          />
        </Field>
        <div className="mt-2">
          <Readout label="Resolution" value={`${timeline.width} × ${timeline.height}`} />
          <Readout label="Tracks" value={timeline.tracks.length} />
        </div>
        {/* Custom sizes, how clips refit, and the background are in Project Settings. */}
        <Button variant="subtle" className="mt-2 w-full" onClick={() => useProjectSettingsDialog.getState().show()}>
          Project Settings…
        </Button>
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
  const setKeyframe = useEditor((state) => state.setKeyframe)
  const notify = useEditor((state) => state.notify)
  // The playhead only when one animated clip is selected: every other inspector state shows
  // stored values, and subscribing to the playhead for those would re-render at the frame rate.
  const single = selected.length === 1 ? selected[0] : undefined
  const keyedPlayhead = useEditor((state) => (single?.keyframes ? state.playhead : -1))
  // The diamonds draw from this too: filled or hollow matters only once there are keys, and
  // their clicks read the live playhead, so nothing else needs to subscribe.

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
  const htmlItems = selected.filter((item) => {
    const kind = findAsset(project, item.assetId)?.kind
    return kind === 'html' || kind === 'brf'
  })
  const layout = (read: (item: Item) => number): { value: number; mixed: boolean } =>
    common(selected, read)
  /** What a clip shows at the playhead: its keyed values when it is animated, else as stored. */
  const view = (item: Item): Layout =>
    item.keyframes && keyedPlayhead >= 0 ? animatedLayoutAt(item, keyedPlayhead) : item.layout

  /**
   * Writes `value` to `property` on `item` at the playhead if the property is animated — adding a
   * key there or editing the one already there — and returns true; false means "not animated,
   * write the stored field". An animated property's stored field draws nowhere, so writing it
   * would be a control that changes nothing.
   */
  const keyed = (item: Item, property: KeyframeProperty, value: number): boolean => {
    if (!item.keyframes?.[property]?.length) return false
    const frame = relativeFrame(item, useEditor.getState().playhead)
    if (frame === null) {
      notify(`Move the playhead over the clip to change its animated ${property}: its keys set it everywhere.`)
      return true
    }
    setKeyframe(item.id, property, frame, value)
    return true
  }
  const diamond = (property: KeyframeProperty): ReactNode =>
    single ? <KeyDiamond item={single} property={property} playhead={keyedPlayhead} /> : null
  const hasPicture = selected.some((item) => findAsset(project, item.assetId)?.hasVideo !== false)

  /**
   * Every field on this panel writes to the whole selection, one store call per item, and
   * each of those is its own `edit()` — so without a transaction a field committed over
   * four clips is four undo entries, and Cmd+Z once leaves three of them changed and one
   * not. `transact` makes one commit one undo step, which is the promise the MCP tools
   * already keep. Crop and origin were written this way; these four were older and were not.
   */
  const applyLayout = (patch: Parameters<typeof patchLayout>[1]): void => {
    transact(() => {
      for (const item of selected) {
        const rest: Partial<Layout> = {}
        for (const [key, value] of Object.entries(patch) as [keyof Layout, never][]) {
          if ((KEYFRAME_PROPERTIES as readonly string[]).includes(key) && typeof value === 'number' &&
              keyed(item, key as KeyframeProperty, value)) continue
          rest[key] = value
        }
        if (Object.keys(rest).length > 0) patchLayout(item.id, rest)
      }
    })
  }
  const applyItem = (patch: Parameters<typeof patchItem>[1]): void => {
    transact(() => {
      for (const item of selected) {
        if (patch.volume !== undefined && keyed(item, 'volume', patch.volume)) {
          const { volume: _keyed, ...rest } = patch
          if (Object.keys(rest).length > 0) patchItem(item.id, rest)
          continue
        }
        patchItem(item.id, patch)
      }
    })
  }

  // X and Y are shown from whichever corner the clip is anchored to. `left` and `top` stay
  // absolute in the model — the conversion happens here, at the one place a person types a
  // number, so nothing that draws or exports has to know an origin exists.
  const frame = { width: timeline?.width ?? 0, height: timeline?.height ?? 0 }
  const origin = (selected[0]?.layout.origin ?? DEFAULT_LAYOUT_ORIGIN) as LayoutOrigin
  const positionOf = (item: Item): { x: number; y: number } =>
    positionFromOrigin(view(item), frame, origin)

  const left = layout((item) => positionOf(item).x)
  const top = layout((item) => positionOf(item).y)

  /** Writes one axis back, keeping the other where the clip already is. */
  const setPosition = (axis: 'x' | 'y', next: number): void => {
    transact(() => {
      for (const item of selected) {
        const shown = view(item)
        const current = positionFromOrigin(shown, frame, origin)
        const patch = positionToOrigin({ ...current, [axis]: next }, shown, frame, origin)
        // An animated X or Y keys the playhead; the other axis, if static, is written as before.
        const rest: Partial<Layout> = {}
        if (patch.left !== undefined && !keyed(item, 'left', patch.left)) rest.left = patch.left
        if (patch.top !== undefined && !keyed(item, 'top', patch.top)) rest.top = patch.top
        if (Object.keys(rest).length > 0) patchLayout(item.id, rest)
      }
    })
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
  const width = layout((item) => view(item).width)
  const height = layout((item) => view(item).height)
  const rotation = layout((item) => view(item).rotation)
  const scale = layout((item) => view(item).scale ?? 1)
  const opacity = layout((item) => view(item).opacity)
  const volume = layout((item) =>
    item.keyframes?.volume && keyedPlayhead >= 0 ? animatedVolumeAt(item, keyedPlayhead) : item.volume
  )
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
              {hasPicture && (
                <Readout
                  label="Size"
                  value={asset?.width && asset.height ? `${asset.width} × ${asset.height}` : '—'}
                />
              )}
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
                transact(() => {
                  for (const item of selected) moveItem(item.id, next)
                })
              }}
              min={0}
              suffix="f"
            />
            <NumberField
              label="Len"
              value={durationInFrames.value}
              mixed={durationInFrames.mixed}
              onCommit={(next) => {
                transact(() => {
                  for (const item of selected) trimItem(item.id, 'end', item.from + next)
                })
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

        {/* Transform, like Crop below, is for things with a picture. An audio clip has a layout
            in the model (every item does), but X/Y/W/H/Rotate/Opacity on a music bed are six
            controls that move nothing anyone can see. */}
        {hasPicture && (
        <Section
          title="Transform"
          actions={
            single?.keyframes ? (
              <KeyNavigation item={single} properties={PICTURE_PROPERTIES} playhead={keyedPlayhead} />
            ) : undefined
          }
        >
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
            <Keyed diamond={diamond('left')}>
              <NumberField
                label="X"
                value={left.value}
                mixed={left.mixed}
                onCommit={(next) => setPosition('x', next)}
                suffix="px"
              />
            </Keyed>
            <Keyed diamond={diamond('top')}>
              <NumberField
                label="Y"
                value={top.value}
                mixed={top.mixed}
                onCommit={(next) => setPosition('y', next)}
                suffix="px"
              />
            </Keyed>
            <Keyed diamond={diamond('width')}>
              <NumberField
                label="W"
                value={width.value}
                mixed={width.mixed}
                onCommit={(next) => applyLayout({ width: Math.max(1, next) })}
                min={1}
                suffix="px"
              />
            </Keyed>
            <Keyed diamond={diamond('height')}>
              <NumberField
                label="H"
                value={height.value}
                mixed={height.mixed}
                onCommit={(next) => applyLayout({ height: Math.max(1, next) })}
                min={1}
                suffix="px"
              />
            </Keyed>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <Keyed diamond={diamond('rotation')}>
              <NumberField
                label="Rotate"
                value={rotation.value}
                mixed={rotation.mixed}
                onCommit={(next) => applyLayout({ rotation: next })}
                suffix="°"
              />
            </Keyed>
            {/* A zoom about the centre, like Rotate: it enlarges a title rather than reflowing
                it, and it is what a push-in keys. */}
            <Keyed diamond={diamond('scale')}>
              <NumberField
                label="Scale"
                // Whole percent: the half-width field clips a decimal ("130.0" read "13(").
                value={Math.round(scale.value * 100)}
                mixed={scale.mixed}
                onCommit={(next) => applyLayout({ scale: Math.max(0, next) / 100 })}
                min={0}
                step={1}
                precision={0}
                suffix="%"
              />
            </Keyed>
          </div>
          <div className="mt-2">
            <Keyed diamond={diamond('opacity')}>
              <SliderField
                label="Opacity"
                value={opacity.value ?? 1}
                mixed={opacity.mixed}
                format={(v) => `${Math.round(v * 100)}%`}
                onCommit={(next) => applyLayout({ opacity: next })}
              />
            </Keyed>
          </div>
        </Section>
        )}

        {/* Type controls only for text items: an outline width on a video clip would be a
            control that does nothing, which is the thing this codebase keeps finding. */}
        {textItems.length > 0 && (
          <TextStyleSection
            items={textItems}
            asset={findAsset(project, textItems[0]!.assetId)}
          />
        )}

        {/* Crop applies to anything with a picture. Audio has no edges to trim. */}
        {hasPicture && (
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

        {/* The grade runs only on picture sources — not text, which draws its own glyphs. */}
        {selected.some((item) => isGradeableKind(findAsset(project, item.assetId)?.kind)) && (
          <GradeSection
            items={selected.filter((item) => isGradeableKind(findAsset(project, item.assetId)?.kind))}
            luts={project.assets.filter((asset) => asset.kind === 'lut' && !asset.error)}
          />
        )}

        <Section
          title="Audio & speed"
          actions={
            single?.keyframes?.volume ? (
              <KeyNavigation item={single} properties={['volume']} playhead={keyedPlayhead} />
            ) : undefined
          }
        >
          {/* A detached picture plays no sound, so a volume here would be a slider that does
              nothing; its level lives on the linked audio item. Fades still fade the picture. */}
          {selected.every((item) => item.audioDetached) ? (
            <p className="text-[11px] text-ink-2">
              Sound detached — level, fades and duck of the sound are on the linked audio clip. Fades
              here fade the picture only.
            </p>
          ) : (
            <Keyed diamond={asset?.hasAudio || asset?.kind === 'html' ? diamond('volume') : null}>
              <SliderField
                label="Volume"
                min={0}
                max={2}
                step={0.01}
                value={volume.value ?? 1}
                mixed={volume.mixed}
                format={(v) => `${Math.round(v * 100)}%`}
                onCommit={(next) => applyItem({ volume: next })}
              />
            </Keyed>
          )}
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
