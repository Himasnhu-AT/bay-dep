import type { ReactNode } from 'react'
import { MousePointerClick } from 'lucide-react'
import {
  CANVAS_PRESETS,
  effectiveSpeed,
  findAsset,
  formatTimecode,
  itemEnd,
  usToFrames,
  type AssetKind,
  type Item,
  type TrackKind,
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
  NumberField,
  Panel,
  ScrollArea,
  Section,
  SectionReset,
  Select,
  SliderField
} from '@/components'
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
import { canSound, commonValue, hasSourceTime, isVisualItem } from '@shared/inspector'
import { AudioSection } from './AudioSection'
import { ClipSection, Readout } from './ClipSection'
import { KeyframesSection } from './KeyframesSection'
import { timecodeField } from './timecodeField'

/** One value across the selection, or `mixed` — see `commonValue` in `@shared/inspector`. */
function common<T>(items: Item[], read: (item: Item) => T): { value: T; mixed: boolean } {
  const { value, mixed } = commonValue(items.map(read))
  return { value: value as T, mixed }
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
      <Section id="inspector.canvas" title="Canvas" collapsible>
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
      <Section id="inspector.selection" title="Selection" collapsible>
        <div className="flex items-start gap-2 text-ink-2">
          <MousePointerClick aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <p className="text-[11px] leading-relaxed">
            Select a clip on the timeline to edit its timing, position, look and sound.
            Shift-click to add to the selection; fields then apply to every selected clip.
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
  const trimEdit = useEditor((state) => state.trimEdit)
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

  if (count === 0 || !timeline) {
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
  const kindOf = (item: Item): AssetKind | undefined => findAsset(project, item.assetId)?.kind
  const trackKindOf = (item: Item): TrackKind | undefined =>
    timeline.tracks.find((track) => track.id === item.trackId)?.kind

  // Which controls each clip gets is decided per clip by `@shared/inspector`, and each group of
  // fields writes to the clips it applies to — so a title and a music bed selected together get
  // one Opacity that moves the title and one Volume that moves the music, never the reverse.
  const visualItems = selected.filter((item) => isVisualItem(kindOf(item), trackKindOf(item)))
  const textItems = visualItems.filter((item) => kindOf(item) === 'text')
  const htmlItems = visualItems.filter((item) => {
    const kind = kindOf(item)
    return kind === 'html' || kind === 'brf'
  })
  // Crop and grade act on a drawn source; text draws glyphs, which neither reaches.
  const sourceItems = visualItems.filter((item) => isGradeableKind(kindOf(item)))
  const timedItems = selected.filter((item) => hasSourceTime(kindOf(item)))
  const soundItems = selected.filter((item) => canSound(findAsset(project, item.assetId), item))
  const singleVisual = single && visualItems.length === 1 ? single : undefined

  const layout = (read: (item: Item) => number, items: Item[] = visualItems): { value: number; mixed: boolean } =>
    common(items, read)
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
  const pictureDiamond = (property: KeyframeProperty): ReactNode =>
    singleVisual ? <KeyDiamond item={singleVisual} property={property} playhead={keyedPlayhead} /> : null

  /**
   * Every field on this panel writes to the whole selection, one store call per item, and
   * each of those is its own `edit()` — so without a transaction a field committed over
   * four clips is four undo entries, and Cmd+Z once leaves three of them changed and one
   * not. `transact` makes one commit one undo step, which is the promise the MCP tools
   * already keep.
   */
  const applyLayout = (patch: Parameters<typeof patchLayout>[1]): void => {
    transact(() => {
      for (const item of visualItems) {
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
  const applyItem = (patch: Parameters<typeof patchItem>[1], items: Item[] = selected): void => {
    transact(() => {
      for (const item of items) {
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
  const frame = { width: timeline.width, height: timeline.height }
  const origin = (visualItems[0]?.layout.origin ?? DEFAULT_LAYOUT_ORIGIN) as LayoutOrigin
  const positionOf = (item: Item): { x: number; y: number } =>
    positionFromOrigin(view(item), frame, origin)

  const left = layout((item) => positionOf(item).x)
  const top = layout((item) => positionOf(item).y)

  /** Writes one axis back, keeping the other where the clip already is. */
  const setPosition = (axis: 'x' | 'y', next: number): void => {
    transact(() => {
      for (const item of visualItems) {
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

  const cropOf = (edge: keyof Crop): { value: number; mixed: boolean } =>
    common(sourceItems, (item) => normaliseCrop(item.crop)[edge])
  const cropped = sourceItems.some((item) => isCropped(item.crop))
  const applyCrop = (edge: keyof Crop, fraction: number): void => {
    transact(() => {
      for (const item of sourceItems) setCrop(item.id, edge, fraction)
    })
  }
  const resetCrop = (): void => {
    transact(() => {
      for (const item of sourceItems) {
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
      for (const item of visualItems) patchLayout(item.id, { origin: next })
    })
  }

  /**
   * The source in-point, typed. The same store action as the Alt-drag slip on the timeline
   * (`trimEdit` with `mode: 'slip'`), so a typed slip is refused with the legal range exactly as
   * a dragged one is clamped by it — and the clip never moves on the timeline.
   */
  const setSourceIn = (sourceFrames: number): void => {
    const refusals: string[] = []
    transact(() => {
      for (const item of timedItems) {
        const current = usToFrames(item.sourceStartUs, fps)
        const deltaFrames = Math.round((sourceFrames - current) / effectiveSpeed(item.speed))
        if (deltaFrames === 0) continue
        const result = trimEdit({ itemId: item.id, mode: 'slip', deltaFrames })
        if (!result.ok) refusals.push(result.error)
      }
    })
    if (refusals[0]) notify(refusals[0], 'error')
  }

  const width = layout((item) => view(item).width)
  const height = layout((item) => view(item).height)
  const rotation = layout((item) => view(item).rotation)
  const scale = layout((item) => view(item).scale ?? 1)
  const opacity = layout((item) => view(item).opacity)
  const volume = layout(
    (item) => (item.keyframes?.volume && keyedPlayhead >= 0 ? animatedVolumeAt(item, keyedPlayhead) : item.volume),
    soundItems
  )
  const speed = layout((item) => item.speed, timedItems)
  const sourceIn = layout((item) => usToFrames(item.sourceStartUs, fps), timedItems)
  const fadeIn = layout((item) => item.fadeInFrames, selected)
  const fadeOut = layout((item) => item.fadeOutFrames, selected)
  const from = layout((item) => item.from, selected)
  const durationInFrames = layout((item) => item.durationInFrames, selected)
  const tc = timecodeField(fps)
  const longestSource = Math.max(0, ...timedItems.map((item) => findAsset(project, item.assetId)?.durationUs ?? 0))
  const transformTouched = visualItems.some((item) => {
    const l = item.layout
    return l.rotation !== 0 || (l.scale ?? 1) !== 1 || l.opacity !== 1
  })

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
        <ClipSection items={selected} asset={asset} visual={visualItems.length > 0} />

        <Section id="inspector.timing" title="Timing" collapsible>
          <div className="space-y-1.5">
            <NumberField
              row
              label="Start"
              ariaLabel="Start on the timeline"
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
              {...tc}
            />
            <NumberField
              row
              label="Duration"
              value={durationInFrames.value}
              mixed={durationInFrames.mixed}
              onCommit={(next) => {
                transact(() => {
                  for (const item of selected) trimItem(item.id, 'end', item.from + next)
                })
              }}
              min={1}
              {...tc}
            />
            {timedItems.length > 0 && (
              <NumberField
                row
                label="Source in"
                ariaLabel="Source in: where in the source this clip starts reading"
                value={sourceIn.value}
                mixed={sourceIn.mixed}
                onCommit={setSourceIn}
                min={0}
                max={longestSource > 0 ? usToFrames(longestSource, fps) : undefined}
                {...tc}
              />
            )}
            {timedItems.length > 0 && (
              <NumberField
                row
                label="Speed"
                value={speed.value}
                mixed={speed.mixed}
                onCommit={(next) => applyItem({ speed: Math.max(0.1, next) }, timedItems)}
                step={0.05}
                min={0.1}
                max={8}
                precision={2}
                suffix="×"
              />
            )}
            <NumberField
              row
              label="Fade in"
              value={fadeIn.value}
              mixed={fadeIn.mixed}
              onCommit={(next) => applyItem({ fadeInFrames: Math.max(0, Math.round(next)) })}
              min={0}
              {...tc}
            />
            <NumberField
              row
              label="Fade out"
              value={fadeOut.value}
              mixed={fadeOut.mixed}
              onCommit={(next) => applyItem({ fadeOutFrames: Math.max(0, Math.round(next)) })}
              min={0}
              {...tc}
            />
          </div>
          {first && count === 1 && (
            <div className="mt-2">
              <Readout label="Ends" value={formatTimecode(itemEnd(first), fps, true)} />
            </div>
          )}
          <p className="mt-1.5 text-[10px] leading-relaxed text-ink-2">
            Times read minutes:seconds:frames. Type a timecode, 4.5s or 135f.
            {timedItems.length > 0
              ? ' Source in slips the footage under the clip without moving it; speed changes how fast the source is read, not the clip’s length.'
              : ''}
          </p>
        </Section>

        {/* Transform, like Crop below, is for things with a picture — text included. An audio
            clip has a layout in the model (every item does), but X/Y/W/H/Rotate/Opacity on a
            music bed are six controls that move nothing anyone can see. */}
        {visualItems.length > 0 && (
          <Section
            id="inspector.transform"
            title="Transform"
            collapsible
            actions={
              <span className="flex items-center gap-0.5">
                {singleVisual?.keyframes ? (
                  <KeyNavigation item={singleVisual} properties={PICTURE_PROPERTIES} playhead={keyedPlayhead} />
                ) : null}
                <SectionReset
                  show={transformTouched}
                  label="Reset rotation, scale and opacity"
                  onReset={() => applyLayout({ rotation: 0, scale: 1, opacity: 1 })}
                />
              </span>
            }
          >
            {/* "Origin" rather than "X and Y from": the Field label column truncates, and a
                caption that reads "X and Y fr..." names nothing. */}
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
            {/* One field per row, label left and value right: two columns with a diamond beside
                each left the digits about 20px, and W read "19" for 1920. */}
            <div className="space-y-1.5">
              <Keyed diamond={pictureDiamond('left')}>
                <NumberField row label="X" ariaLabel="X position" value={left.value} mixed={left.mixed}
                  onCommit={(next) => setPosition('x', next)} suffix="px" />
              </Keyed>
              <Keyed diamond={pictureDiamond('top')}>
                <NumberField row label="Y" ariaLabel="Y position" value={top.value} mixed={top.mixed}
                  onCommit={(next) => setPosition('y', next)} suffix="px" />
              </Keyed>
              <Keyed diamond={pictureDiamond('width')}>
                <NumberField row label="Width" value={width.value} mixed={width.mixed}
                  onCommit={(next) => applyLayout({ width: Math.max(1, next) })} min={1} suffix="px" />
              </Keyed>
              <Keyed diamond={pictureDiamond('height')}>
                <NumberField row label="Height" value={height.value} mixed={height.mixed}
                  onCommit={(next) => applyLayout({ height: Math.max(1, next) })} min={1} suffix="px" />
              </Keyed>
              <Keyed diamond={pictureDiamond('rotation')}>
                <NumberField row label="Rotation" value={rotation.value} mixed={rotation.mixed}
                  onCommit={(next) => applyLayout({ rotation: next })} precision={1} suffix="°" />
              </Keyed>
              {/* A zoom about the centre, like Rotation: it enlarges a title rather than reflowing
                  it, and it is what a push-in keys. */}
              <Keyed diamond={pictureDiamond('scale')}>
                <NumberField
                  row
                  label="Scale"
                  value={Math.round(scale.value * 1000) / 10}
                  mixed={scale.mixed}
                  onCommit={(next) => applyLayout({ scale: Math.max(0, next) / 100 })}
                  min={0}
                  precision={1}
                  suffix="%"
                />
              </Keyed>
              <Keyed diamond={pictureDiamond('opacity')}>
                <SliderField
                  label="Opacity"
                  value={opacity.value ?? 1}
                  mixed={opacity.mixed}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onCommit={(next) => applyLayout({ opacity: next })}
                />
              </Keyed>
            </div>
            {count > 1 && (
              <p className="mt-1.5 text-[10px] leading-relaxed text-ink-2">
                Keyframe diamonds appear with one clip selected: a key is a frame of one clip.
              </p>
            )}
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

        {/* Crop cuts a drawn source. Text draws glyphs straight into its box, which a crop does
            not reach, and audio has no edges. */}
        {sourceItems.length > 0 && (
          <Section
            id="inspector.crop"
            title="Crop"
            collapsible
            defaultOpen={false}
            actions={<SectionReset show={cropped} label="Remove the crop" onReset={resetCrop} />}
          >
            <div className="space-y-1.5">
              {CROP_EDGES.map(({ edge, label }) => {
                const edgeValue = cropOf(edge)
                return (
                  <NumberField
                    key={edge}
                    row
                    label={label}
                    ariaLabel={`Crop ${label.toLowerCase()}`}
                    // Shown as a percentage because that is what a person means by "take ten off
                    // the top"; stored as a fraction so it survives a change of source resolution.
                    value={Math.round(edgeValue.value * 1000) / 10}
                    mixed={edgeValue.mixed}
                    min={0}
                    max={98}
                    step={1}
                    precision={1}
                    suffix="%"
                    onCommit={(next) => applyCrop(edge, next / 100)}
                  />
                )
              })}
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

        {/* Adjustments and blend apply to anything with a picture, text included (its glyphs are
            drawn through the same look). Audio-only items have nothing to filter. */}
        {visualItems.length > 0 && <AdjustmentsSection items={visualItems} timeline={timeline} />}

        {/* The grade runs only on picture sources — not text, which draws its own glyphs. */}
        {sourceItems.length > 0 && (
          <GradeSection
            items={sourceItems}
            luts={project.assets.filter((candidate) => candidate.kind === 'lut' && !candidate.error)}
          />
        )}

        {soundItems.length > 0 ? (
          <AudioSection
            items={soundItems}
            project={project}
            timeline={timeline}
            volume={{ value: volume.value ?? 1, mixed: volume.mixed }}
            onVolume={(gain) => applyItem({ volume: gain }, soundItems)}
            diamond={
              single && soundItems.length === 1 ? (
                <KeyDiamond item={single} property="volume" playhead={keyedPlayhead} />
              ) : null
            }
            navigation={
              single?.keyframes?.volume ? (
                <KeyNavigation item={single} properties={['volume']} playhead={keyedPlayhead} />
              ) : null
            }
          />
        ) : selected.some((item) => item.audioDetached) ? (
          <Section id="inspector.audio" title="Audio" collapsible>
            {/* A detached picture plays no sound, so a volume here would be a slider that does
                nothing; its level lives on the linked audio item. */}
            <p className="text-[11px] leading-relaxed text-ink-2">
              Sound detached — its volume, J/L cut and ducking are on the linked audio clip. Fades
              here fade the picture only.
            </p>
          </Section>
        ) : null}

        <KeyframesSection items={selected} />
      </ScrollArea>
    </Panel>
  )
}
