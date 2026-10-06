import { useEffect, useRef, type ReactNode } from 'react'
import { AudioLines, FileText, Film, Palette, Rows3, Sparkles, Blend, Type } from 'lucide-react'
import {
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
  type Layout
} from '@shared/project'
import {
  AngleDial,
  Field,
  NumberField,
  TimecodeField,
  Panel,
  ScrollArea,
  Section,
  SectionReset,
  Select,
  SliderField,
  Tabs,
  type TabItem
} from '@/components'
import { SectionBars } from '@/components/Panel'
import { OPEN_SECTION_EVENT } from '@/lib/openSection'
import { useSelectedItems } from '@/lib/useSelectedItems'
import { selectTimeline, useEditor } from '@/store/editor'
import type { InspectorTab } from '@/store/types'
import { AdjustmentsSection, BlendSection, adjustmentsTouched } from './AdjustmentsSection'
import { GradeSection } from './GradeSection'
import { MasksSection } from './MasksSection'
import { isGradeableKind } from '@shared/grade'
import { CompositionSection } from './CompositionSection'
import { TextStyleSection } from './TextStyleSection'
import { KeyDiamond, KeyNavigation, Keyed, relativeFrame } from './KeyframeControls'
import { animatedLayoutAt, animatedVolumeAt, PICTURE_PROPERTIES } from '@shared/keyframes'
import { canSound, commonValue, hasSourceTime, isVisualItem, timingRefusal } from '@shared/inspector'
import { CLIP_SPEED_RANGE, retimedLength, speedNote, type SpeedPlan } from '@shared/speed'
import { AudioSection } from './AudioSection'
import { ClipSection, Readout } from './ClipSection'
import { KeyframesSection } from './KeyframesSection'
import { chooseTab, inspectorTabs, tabForSection, type SelectionShape } from './inspector/tabs'
import { TimelineTab } from './inspector/TimelineTab'
import { TransitionTab, transitionCount } from './inspector/TransitionTab'
import { useNarrow } from './inspector/useNarrow'
import { LIVE } from './liveGesture'

/** One value across the selection, or `mixed` — see `commonValue` in `@shared/inspector`. */
function common<T>(items: Item[], read: (item: Item) => T): { value: T; mixed: boolean } {
  const { value, mixed } = commonValue(items.map(read))
  return { value: value as T, mixed }
}

/** Named in reading order, not object-key order: top and bottom belong beside each other. */
const CROP_EDGES: { edge: keyof Crop; label: string }[] = [
  { edge: 'top', label: 'Top' },
  { edge: 'bottom', label: 'Bottom' },
  { edge: 'left', label: 'Left' },
  { edge: 'right', label: 'Right' }
]


const TAB_ICON: Record<InspectorTab, ReactNode> = {
  video: <Film aria-hidden="true" className="size-3.5 shrink-0" />,
  title: <Type aria-hidden="true" className="size-3.5 shrink-0" />,
  audio: <AudioLines aria-hidden="true" className="size-3.5 shrink-0" />,
  effects: <Sparkles aria-hidden="true" className="size-3.5 shrink-0" />,
  transition: <Blend aria-hidden="true" className="size-3.5 shrink-0" />,
  color: <Palette aria-hidden="true" className="size-3.5 shrink-0" />,
  file: <FileText aria-hidden="true" className="size-3.5 shrink-0" />,
  timeline: <Rows3 aria-hidden="true" className="size-3.5 shrink-0" />
}

/**
 * The tab row names its tabs in words at every width the inspector normally has (268px by
 * default, 220px at its smallest): Title, Transition and Color are three glyphs a person has to
 * learn, and three words they do not. Seven labels do not fit one row at 268px, so the row wraps
 * to two rather than truncating or dropping them. Icons join the labels once there is room for
 * both on one row; only below `TAB_LABELS_MIN_WIDTH` — narrower than the panel's own minimum,
 * so a host that squeezes it — does the row fall back to icons, with the active tab named in
 * the header.
 */
const TAB_ICONS_MIN_WIDTH = 480
const TAB_LABELS_MIN_WIDTH = 200

/**
 * The inspector, in tabs the way Resolve's is: Video · Title · Audio · Effects · Transition ·
 * Color · File for a selection, Timeline with nothing selected. A tab that does not apply is
 * greyed with the reason rather than removed, so the row never shifts; the tab chosen is kept in
 * the store (`inspectorTab`) and falls back to the first that applies when it does not. Each
 * tab's badge counts its groups that are off their defaults.
 */
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
  const count = timeline ? selected.length : 0

  const first = selected[0]
  const asset = first ? findAsset(project, first.assetId) : undefined
  const kindOf = (item: Item): AssetKind | undefined => findAsset(project, item.assetId)?.kind
  const trackKindOf = (item: Item): TrackKind | undefined =>
    timeline?.tracks.find((track) => track.id === item.trackId)?.kind

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

  const shape: SelectionShape = {
    count,
    visual: visualItems.length,
    text: textItems.length,
    composed: htmlItems.length,
    source: sourceItems.length,
    sound: soundItems.length,
    detached: selected.filter((item) => item.audioDetached).length
  }
  const tabStates = inspectorTabs(shape)
  const rememberedTab = useEditor((state) => state.inspectorTab)
  const setInspectorTab = useEditor((state) => state.setInspectorTab)
  const tab = chooseTab(rememberedTab, tabStates)

  // `openSection(id)` from outside (the viewer asks for `inspector.clip` to focus a title's
  // words): switch to the tab that holds it, so the section can mount and open. The section
  // itself hears the same event when it is already on screen.
  const shapeRef = useRef(shape)
  shapeRef.current = shape
  useEffect(() => {
    const onOpen = (event: Event): void => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id
      const target = id ? tabForSection(id, shapeRef.current) : null
      if (target) useEditor.getState().setInspectorTab(target)
    }
    window.addEventListener(OPEN_SECTION_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_SECTION_EVENT, onOpen)
  }, [])

  const tabRow = useRef<HTMLDivElement>(null)
  const narrow = useNarrow(tabRow, TAB_LABELS_MIN_WIDTH)
  const roomForIcons = !useNarrow(tabRow, TAB_ICONS_MIN_WIDTH)

  const shell = (badges: Partial<Record<InspectorTab, number>>, body: ReactNode): ReactNode => {
    const items: TabItem<InspectorTab>[] = tabStates.map((state) => ({
      value: state.value,
      label: state.label,
      icon: narrow || roomForIcons ? TAB_ICON[state.value] : undefined,
      disabled: !state.enabled,
      hint: state.hint,
      badge: badges[state.value]
    }))
    return (
      <Panel
        title={narrow && tabStates.length > 1 ? `Inspector · ${tabStates.find((state) => state.value === tab)?.label ?? ''}` : 'Inspector'}
        actions={
          count > 1 ? <span className="text-[11px] text-ink-1 tabular-nums">{count} clips</span> : undefined
        }
        className="h-full"
        bodyClassName="flex flex-col"
      >
        <div ref={tabRow}>
          <Tabs
            label="Inspector"
            value={tab}
            items={items}
            onChange={setInspectorTab}
            iconsOnly={narrow && items.length > 1}
            // Wraps to a second row rather than clipping a label; each tab keeps the bar's height.
            className={narrow ? undefined : 'h-auto flex-wrap [&>[role=tab]]:h-7'}
          />
        </div>
        <ScrollArea className="flex-1">
          <SectionBars>{body}</SectionBars>
        </ScrollArea>
      </Panel>
    )
  }

  if (count === 0 || !timeline) return shell({}, <TimelineTab />)

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
  // Where X and Y reset to: the first clip centred in the frame, in the chosen origin's numbers.
  const centreOf = (item: Item | undefined): { x: number; y: number } | undefined => {
    if (!item) return undefined
    const shown = view(item)
    return positionFromOrigin(
      { ...shown, left: (frame.width - shown.width) / 2, top: (frame.height - shown.height) / 2 },
      frame,
      origin
    )
  }
  const centre = centreOf(visualItems[0])

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
        if (!result.ok) refusals.push(result.userMessage ?? result.error)
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
  const notTime = (text: string): void =>
    notify(`“${text.trim()}” is not a time. Type a timecode (00:00:04:15), seconds (4.5s) or frames (135f).`, 'error')
  const longestSource = Math.max(0, ...timedItems.map((item) => findAsset(project, item.assetId)?.durationUs ?? 0))
  const transformTouched = visualItems.some((item) => {
    const l = item.layout
    return l.rotation !== 0 || (l.scale ?? 1) !== 1 || l.opacity !== 1
  })

  const retimed = selected.some((item) => item.speed !== 1 || item.fadeInFrames > 0 || item.fadeOutFrames > 0)
  const blended = visualItems.some((item) => (item.blendMode ?? 'normal') !== 'normal')
  const soundTouched =
    soundItems.some((item) => item.audioLeadFrames || item.audioTrailFrames || item.duck || item.pan) ||
    volume.mixed ||
    (soundItems.length > 0 && volume.value !== 1)
  const animated = selected.some((item) => item.keyframes && Object.values(item.keyframes).some((keys) => keys?.length))
  const graded = sourceItems.some((item) => item.grade)
  const badges: Partial<Record<InspectorTab, number>> = {
    video: [transformTouched, cropped, blended, visualItems.length > 0 && retimed].filter(Boolean).length,
    audio: soundTouched ? 1 : 0,
    effects: [visualItems.length > 0 && adjustmentsTouched(visualItems), animated].filter(Boolean).length,
    transition: transitionCount(project, timeline, visualItems),
    color: graded ? 1 : 0
  }

  // -- Timing, split the Resolve way: where the clip sits (File) apart from how it plays -------

  /** Start, duration, source in: where the clip is and what it reads. The File tab. */
  const placement = (
    <Section
      id="inspector.timing"
      title="Timing"
      collapsible
      hint="Times read hours:minutes:seconds:frames. Type a timecode (00:00:04:15), 4.5s for seconds or 135f for frames; a bare number is seconds. Source in slips the footage under the clip without moving it."
    >
      <div className="space-y-1.5">
        <TimecodeField
          row
          label="Start"
          ariaLabel="Start on the timeline"
          value={from.value}
          mixed={from.mixed}
          // `from` goes through `moveItem`, not `patchItem`: only the move path checks
          // for collisions, and a typed-in start that overlaps a neighbour must be
          // refused the same way a dragged one is.
          onCommit={(next) => {
            // The store refuses a collision or a locked track by doing nothing; say why
            // instead of letting the field snap back as if it were broken.
            const refusal = timingRefusal(project, timeline, selected.map((item) => item.id), { from: next })
            if (refusal) return notify(refusal, 'error')
            transact(() => {
              for (const item of selected) moveItem(item.id, next)
            })
          }}
          onInvalid={notTime}
          min={0}
          fps={fps}
        />
        <TimecodeField
          row
          label="Duration"
          value={durationInFrames.value}
          mixed={durationInFrames.mixed}
          onCommit={(next) => {
            const refusal = timingRefusal(project, timeline, selected.map((item) => item.id), { durationInFrames: next })
            if (refusal) return notify(refusal, 'error')
            // A clip cannot run past the end of its footage: each one stops at what its
            // source has left from its in-point at its speed, and says so rather than
            // silently holding a last frame the way a longer typed value used to.
            const shortfalls: string[] = []
            transact(() => {
              for (const item of selected) {
                const asset = findAsset(project, item.assetId)
                const { available } = retimedLength(item, asset?.durationUs ?? 0, item.speed, fps)
                const length = Math.min(next, available)
                if (length < next) shortfalls.push(`“${asset?.name ?? 'clip'}” has ${formatTimecode(available, fps)} of footage from its source in`)
                trimItem(item.id, 'end', item.from + length)
              }
            })
            if (shortfalls.length > 0) notify(`${shortfalls.join('; ')}, so Duration stops there.`)
          }}
          onInvalid={notTime}
          min={1}
          fps={fps}
        />
        {timedItems.length > 0 && (
          <TimecodeField
            row
            label="Source in"
            ariaLabel="Source in: where in the source this clip starts reading"
            value={sourceIn.value}
            mixed={sourceIn.mixed}
            onCommit={setSourceIn}
            min={0}
            defaultValue={0}
            max={longestSource > 0 ? usToFrames(longestSource, fps) : undefined}
            fps={fps}
          />
        )}
      </div>
      {first && count === 1 && (
        <div className="mt-2">
          <Readout label="Ends" value={formatTimecode(itemEnd(first), fps, true)} />
        </div>
      )}
    </Section>
  )

  /** Speed and fades: how the clip plays. The Video tab, or Audio for sound on its own. */
  const retime = (
    <Section
      id="inspector.retime"
      title={timedItems.length > 0 ? 'Speed & fades' : 'Fades'}
      collapsible
      hint={
        timedItems.length > 0
          ? 'Speed keeps the footage and changes the clip’s length, stopping at the next clip (Speed… in the clip menu can push later clips). Fades take a timecode, 0.5s or 15f.'
          : 'Fades take a timecode, 0.5s or 15f.'
      }
      actions={
        <SectionReset
          show={retimed}
          label="Reset fades"
          onReset={() => applyItem({ fadeInFrames: 0, fadeOutFrames: 0 })}
        />
      }
    >
      <div className="space-y-1.5">
        {timedItems.length > 0 && (
          <NumberField
            row
            label="Speed"
            value={speed.value}
            mixed={speed.mixed}
            // `setClipSpeed`, as the clip menu's Speed… and `edit_item({ speed })` do: the clip
            // keeps its footage, so its length changes, stopping at the next clip.
            onCommit={(next) => {
              const store = useEditor.getState()
              const plans: (SpeedPlan | null)[] = []
              store.transact(() => {
                for (const item of timedItems) plans.push(useEditor.getState().setClipSpeed(item.id, Math.max(CLIP_SPEED_RANGE.min, next)))
              })
              // Say when the length stopped short (at the next clip, or at the end of the
              // footage), the way the clip menu's Speed… does — silently getting 180 frames
              // for a 360-frame ask read as the field ignoring the value.
              const after = useEditor.getState()
              const tl = selectTimeline(after)
              if (!tl) return
              const notes = plans
                .map((plan) => (plan ? speedNote(after.project, tl, plan, (frame) => formatTimecode(frame, tl.fps)) : null))
                .filter((note): note is string => Boolean(note))
              if (notes.length > 0) after.notify(notes.join(' '))
            }}
            step={0.05}
            min={CLIP_SPEED_RANGE.min}
            max={CLIP_SPEED_RANGE.max}
            precision={2}
            suffix="×"
            defaultValue={1}
          />
        )}
        <TimecodeField
          row
          label="Fade in"
          value={fadeIn.value}
          mixed={fadeIn.mixed}
          onCommit={(next) => applyItem({ fadeInFrames: Math.max(0, Math.round(next)) })}
          onInvalid={notTime}
          min={0}
          defaultValue={0}
          fps={fps}
        />
        <TimecodeField
          row
          label="Fade out"
          value={fadeOut.value}
          mixed={fadeOut.mixed}
          onCommit={(next) => applyItem({ fadeOutFrames: Math.max(0, Math.round(next)) })}
          onInvalid={notTime}
          min={0}
          defaultValue={0}
          fps={fps}
        />
      </div>
    </Section>
  )

  // -- Video -----------------------------------------------------------------------------------

  const video = (
    <>
      {/* Transform, like Crop below, is for things with a picture — text included. An audio
          clip has a layout in the model (every item does), but X/Y/W/H/Rotate/Opacity on a
          music bed are six controls that move nothing anyone can see. */}
      <Section
        id="inspector.transform"
        title="Transform"
        collapsible
        hint={count > 1 ? 'Keyframe diamonds appear with one clip selected: a key is a frame of one clip.' : undefined}
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
              onCommit={(next) => setPosition('x', next)} suffix="px" defaultValue={centre?.x} gesture={LIVE} />
          </Keyed>
          <Keyed diamond={pictureDiamond('top')}>
            <NumberField row label="Y" ariaLabel="Y position" value={top.value} mixed={top.mixed}
              onCommit={(next) => setPosition('y', next)} suffix="px" defaultValue={centre?.y} gesture={LIVE} />
          </Keyed>
          <Keyed diamond={pictureDiamond('width')}>
            <NumberField row label="Width" value={width.value} mixed={width.mixed}
              onCommit={(next) => applyLayout({ width: Math.max(1, next) })} min={1} suffix="px" gesture={LIVE} />
          </Keyed>
          <Keyed diamond={pictureDiamond('height')}>
            <NumberField row label="Height" value={height.value} mixed={height.mixed}
              onCommit={(next) => applyLayout({ height: Math.max(1, next) })} min={1} suffix="px" gesture={LIVE} />
          </Keyed>
          <Keyed diamond={pictureDiamond('rotation')}>
            <div className="flex items-center gap-1.5">
              <NumberField row className="min-w-0 flex-1" label="Rotation" value={rotation.value} mixed={rotation.mixed}
                onCommit={(next) => applyLayout({ rotation: next })} precision={1} suffix="°" defaultValue={0} gesture={LIVE} />
              {/* A dial beside the number, as After Effects draws its angle controls: the number
                  keeps revolutions (720° is two turns), the dial shows where the clip points. */}
              <AngleDial
                label="Rotation dial"
                value={rotation.value}
                mixed={rotation.mixed}
                onCommit={(next) => applyLayout({ rotation: next })}
                defaultValue={0}
                gesture={LIVE}
              />
            </div>
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
              defaultValue={100}
              gesture={LIVE}
            />
          </Keyed>
          <Keyed diamond={pictureDiamond('opacity')}>
            <SliderField
              label="Opacity"
              value={opacity.value ?? 1}
              mixed={opacity.mixed}
              format={(v) => `${Math.round(v * 100)}%`}
              onCommit={(next) => applyLayout({ opacity: next })}
              defaultValue={1}
              gesture={LIVE}
            />
          </Keyed>
        </div>
      </Section>

      {/* Crop cuts a drawn source. Text draws glyphs straight into its box, which a crop does
          not reach, and audio has no edges. */}
      {sourceItems.length > 0 && (
        <Section
          id="inspector.crop"
          title="Cropping"
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
                  defaultValue={0}
                  gesture={LIVE}
                  onCommit={(next) => applyCrop(edge, next / 100)}
                />
              )
            })}
          </div>
        </Section>
      )}

      {/* Shape masks reach what a crop reaches: a drawn source. */}
      {sourceItems.length > 0 && <MasksSection items={sourceItems} />}

      <BlendSection items={visualItems} timeline={timeline} title="Composite" />
      {retime}
    </>
  )

  // -- Title: a text clip's words and type, or a composition's own declared controls ------------

  const title = (
    <>
      {textItems.length > 0 && count === textItems.length && (
        <ClipSection items={selected} asset={asset} visual />
      )}
      {/* Type controls only for text items: an outline width on a video clip would be a
          control that does nothing, which is the thing this codebase keeps finding. */}
      {textItems.length > 0 && (
        <TextStyleSection items={textItems} asset={findAsset(project, textItems[0]!.assetId)} />
      )}
      {/* A composition's own controls, drawn from what it declares. Only for html/brf items:
          every other kind declares nothing, and an empty section is worse than none. */}
      {htmlItems.length > 0 && (
        <CompositionSection items={htmlItems} asset={findAsset(project, htmlItems[0]!.assetId)} />
      )}
    </>
  )

  // -- Audio -------------------------------------------------------------------------------------

  const audio = (
    <>
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
        <Section id="inspector.audio" title="Audio">
          {/* A detached picture plays no sound, so a volume here would be a slider that does
              nothing; its level lives on the linked audio item. */}
          <p className="text-[11px] leading-relaxed text-ink-2">
            Sound detached — its volume, J/L cut and ducking are on the linked audio clip.
          </p>
        </Section>
      ) : null}
      {/* Sound on its own has no Video tab, so its speed and fades live here. */}
      {visualItems.length === 0 && retime}
    </>
  )

  // -- Effects: the filter look and the keyframes ------------------------------------------------

  const hasKeyframes = selected.some((item) => item.keyframes)
  const effects = (
    <>
      {/* Adjustments apply to anything with a picture, text included (its glyphs are drawn
          through the same look). Audio-only items have nothing to filter. Blend is in Video. */}
      {visualItems.length > 0 && <AdjustmentsSection items={visualItems} timeline={timeline} blend={false} />}
      <KeyframesSection items={selected} />
      {visualItems.length === 0 && !hasKeyframes && (
        <p className="px-3 py-6 text-center text-[11px] text-ink-2">
          No effects for sound yet. Keyframes on volume appear here.
        </p>
      )}
    </>
  )

  // -- Color -------------------------------------------------------------------------------------

  const color = (
    <GradeSection
      items={sourceItems}
      luts={project.assets.filter((candidate) => candidate.kind === 'lut' && !candidate.error)}
    />
  )

  // -- File --------------------------------------------------------------------------------------

  const file = (
    <>
      <ClipSection items={selected} asset={asset} visual={visualItems.length > 0} />
      {placement}
    </>
  )

  const body: Record<InspectorTab, ReactNode> = {
    video,
    title,
    audio,
    effects,
    transition: <TransitionTab items={visualItems} project={project} timeline={timeline} />,
    color,
    file,
    timeline: null
  }

  return shell(badges, body[tab])
}
