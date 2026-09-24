import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Music2, Video } from 'lucide-react'
import { allItems, findAsset, itemEnd, type Item, type Marker, type Track } from '@shared/project'
import { planTrim, type TrimChange, type TrimMode } from '@shared/trim'
import { linkedPartners, withLinked } from '@shared/links'
import { ContextMenu, IconButton } from '@/components'
import { cn } from '@/lib/cn'
import { useDrag } from '@/lib/useDrag'
import { selectDuration, selectTimeline, useEditor } from '@/store/editor'
import { ASSET_DRAG_TYPE } from './MediaPanel'
import { junctionsForTrack } from '@/lib/junctions'
import { snapFrame, snapTargets } from '@/lib/snap'
import { Clip } from './Clip'
import { JunctionMarkers } from './JunctionMarkers'
import { TransitionDialog } from './TransitionDialog'
import { TimelineRuler } from './TimelineRuler'
import { TrackHeader } from './TrackHeader'
import { ClipDialogs, clipMenuEntries } from './ClipCommands'

/** One shared empty list, so a timeline without markers does not hand the ruler a new array each render. */
const NO_MARKERS: readonly Marker[] = []

const HEADER_WIDTH = 148
const RULER_HEIGHT = 26
const VIDEO_TRACK_HEIGHT = 58
const AUDIO_TRACK_HEIGHT = 46
/**
 * Snap tolerance in *pixels*, not frames. A frame-based threshold would be invisible when
 * zoomed in and would snap across half a minute when zoomed out.
 */
const SNAP_PX = 8
/** Empty runway past the last clip, so there is somewhere to drag to. */
const TAIL_SECONDS = 5

interface MoveGesture {
  /** The grabbed clip first; the rest of the selection follows it by the same delta. */
  itemIds: string[]
  anchorFrom: number
  sourceTrackId: string
  deltaFrames: number
  targetTrackId: string
}

interface TrimGesture {
  itemId: string
  edge: 'start' | 'end'
  from: number
  durationInFrames: number
}

/**
 * A slip, slide or roll in progress — Alt on a clip (slip), Alt+Shift on a clip (slide), Alt on
 * a trim handle (roll that cut).
 *
 * The legal range is asked for once, at pointer-down, and the drag is clamped to it: a gesture
 * that ran past the handles and was refused on release would read as the editor ignoring the
 * drag. The preview is the planner's own output, so what is drawn during the drag is exactly
 * what the store will commit on release.
 */
interface TrimModeGesture {
  itemId: string
  mode: TrimMode
  edge?: 'start' | 'end'
  range: { min: number; max: number }
  deltaFrames: number
  /** Every item the plan changes, keyed by id, as it will be after the edit. */
  preview: Map<string, TrimChange>
}

function trackHeight(track: Track): number {
  return track.kind === 'video' ? VIDEO_TRACK_HEIGHT : AUDIO_TRACK_HEIGHT
}

export function Timeline(): ReactNode {
  const timeline = useEditor(selectTimeline)
  const duration = useEditor(selectDuration)
  const project = useEditor((state) => state.project)
  const selection = useEditor((state) => state.selection)
  const pixelsPerFrame = useEditor((state) => state.pixelsPerFrame)

  const scrollRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const laneRefs = useRef(new Map<string, HTMLDivElement>())

  // Quantised: auto-scrolling during playback must not re-render the ruler on every frame,
  // so the visible window only changes in 256px steps and the ticks are drawn with margin.
  const [view, setView] = useState({ left: 0, width: 0 })
  const [move, setMove] = useState<MoveGesture | null>(null)
  const [trim, setTrim] = useState<TrimGesture | null>(null)
  const [trimMode, setTrimMode] = useState<TrimModeGesture | null>(null)
  // The junction under edit. Local because a cut is not a selectable object in the store —
  // `selection` holds item ids — and inventing a second kind of selection there to carry a
  // transient dialog would be a worse trade than holding it here.
  const [junctionKey, setJunctionKey] = useState<string | null>(null)
  // The clip menu (right-click), at the pointer, in viewport coordinates.
  const [menu, setMenu] = useState<{ itemId: string; x: number; y: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const fps = timeline?.fps ?? 30
  const tracks = timeline?.tracks ?? []

  // Looked up by key every render rather than held as an object: a trim or an undo while the
  // dialog is open changes what this cut can do, and a snapshot would keep describing the
  // project as it was. Resolves to null when the cut stops existing, which closes the dialog.
  const openJunction =
    junctionKey === null || !timeline
      ? null
      : (tracks
          .filter((track) => track.kind === 'video')
          .flatMap((track) => junctionsForTrack(project, timeline, track))
          .find((junction) => junction.key === junctionKey) ?? null)
  const contentFrames = Math.max(duration, fps * 10) + fps * TAIL_SECONDS
  const contentWidth = Math.max(contentFrames * pixelsPerFrame, view.width - HEADER_WIDTH, 320)

  // -- geometry -------------------------------------------------------------

  /** The ruler shares an x-origin with every lane and is always mounted, so it is the
   * one element worth measuring against. */
  const frameAtClientX = useCallback(
    (clientX: number): number => {
      const ruler = rulerRef.current
      if (!ruler) return 0
      return Math.max(0, (clientX - ruler.getBoundingClientRect().left) / pixelsPerFrame)
    },
    [pixelsPerFrame]
  )

  /** Snaps to the origin, the playhead, every other clip's two edges, markers and beats (`lib/snap`). */
  const snap = useCallback(
    (frame: number, ignore: Set<string>): number => {
      const state = useEditor.getState()
      // Snapping off (N) rounds to the frame; ⌘ during a drag suspends it either way.
      if (!timeline || !state.snapping) return Math.round(frame)
      return snapFrame(frame, snapTargets(state.project, timeline, state.playhead, ignore), SNAP_PX / pixelsPerFrame)
    },
    [timeline, pixelsPerFrame]
  )

  const trackAtClientY = useCallback(
    (clientY: number, kind: Track['kind']): string | null => {
      for (const [trackId, element] of laneRefs.current) {
        const box = element.getBoundingClientRect()
        if (clientY < box.top || clientY > box.bottom) continue
        const track = tracks.find((candidate) => candidate.id === trackId)
        return track && track.kind === kind && !track.locked ? trackId : null
      }
      return null
    },
    [tracks]
  )

  const autoScroll = useCallback((clientX: number): void => {
    const scroller = scrollRef.current
    if (!scroller) return
    const box = scroller.getBoundingClientRect()
    if (clientX > box.right - 48) scroller.scrollLeft += 24
    else if (clientX < box.left + HEADER_WIDTH + 48) scroller.scrollLeft -= 24
  }, [])

  // -- the playhead, driven imperatively ------------------------------------

  /**
   * The playhead moves at the project's frame rate during playback. Subscribing to it in
   * React would re-render every clip, every tick and every track header that often to move
   * one 1px line, so it is written straight to the DOM — this component never reads
   * `playhead` from the store during render.
   */
  useEffect(() => {
    const apply = (playhead: number): void => {
      const element = playheadRef.current
      const scroller = scrollRef.current
      if (!element || !scroller) return
      const x = playhead * pixelsPerFrame
      // Left of the lane area it would draw on top of the sticky track headers, which sit
      // below it in the stacking order.
      element.style.display = x < scroller.scrollLeft ? 'none' : 'block'
      element.style.transform = `translateX(${HEADER_WIDTH + x}px)`
      rulerRef.current?.setAttribute('aria-valuenow', String(Math.round(playhead)))
    }

    apply(useEditor.getState().playhead)
    return useEditor.subscribe((state, previous) => {
      if (state.playhead === previous.playhead) return
      apply(state.playhead)
      if (!state.playing) return
      const scroller = scrollRef.current
      if (!scroller) return
      const x = state.playhead * pixelsPerFrame
      const laneWidth = scroller.clientWidth - HEADER_WIDTH
      if (x < scroller.scrollLeft || x > scroller.scrollLeft + laneWidth - 24) {
        scroller.scrollLeft = Math.max(0, x - laneWidth * 0.25)
      }
    })
  }, [pixelsPerFrame])

  const onScroll = useCallback((): void => {
    const scroller = scrollRef.current
    if (!scroller) return
    const quantised = Math.floor(scroller.scrollLeft / 256) * 256
    setView((previous) =>
      previous.left === quantised && previous.width === scroller.clientWidth
        ? previous
        : { left: quantised, width: scroller.clientWidth }
    )
    const element = playheadRef.current
    if (element) {
      const x = useEditor.getState().playhead * pixelsPerFrame
      element.style.display = x < scroller.scrollLeft ? 'none' : 'block'
    }
  }, [pixelsPerFrame])

  useEffect(() => {
    onScroll()
    const scroller = scrollRef.current
    if (!scroller) return
    const observer = new ResizeObserver(onScroll)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [onScroll])

  // -- scrubbing ------------------------------------------------------------

  const onScrubStart = useCallback((): void => useEditor.getState().setScrubbing(true), [])
  const onScrubEnd = useCallback((): void => useEditor.getState().setScrubbing(false), [])
  const onScrub = useCallback(
    (clientX: number): void => useEditor.getState().setPlayhead(frameAtClientX(clientX)),
    [frameAtClientX]
  )

  // -- moving clips ---------------------------------------------------------

  /**
   * A clip being dragged is never re-parented into the destination lane while the pointer
   * is down. React would unmount the node it was mounted on, and that node is the one
   * holding the pointer capture — the drag would stop dead halfway across. The original
   * stays put and dimmed, and a ghost showing the landing position is drawn over the lanes.
   */
  const beginMove = useDrag({
    onMove: (state) => {
      if (!timeline) return
      autoScroll(state.x)
      setMove((current) => {
        if (!current) return current
        const raw = current.anchorFrom + state.dx / pixelsPerFrame
        // Cmd suspends snapping, which is the only way to place a clip one frame off an
        // edge it wants to snap to.
        const snapped = state.meta ? Math.round(raw) : snap(raw, new Set(current.itemIds))
        const source = timeline.tracks.find((track) => track.id === current.sourceTrackId)
        // Only a single clip may change lane. Carrying a multi-selection across tracks
        // needs a relative-track model the store does not have, and guessing wrong drops
        // clips silently onto the wrong lane.
        const targetTrackId =
          current.itemIds.length === 1 && source
            ? (trackAtClientY(state.y, source.kind) ?? current.sourceTrackId)
            : current.sourceTrackId
        return { ...current, deltaFrames: snapped - current.anchorFrom, targetTrackId }
      })
    },
    onEnd: () => {
      const current = move
      setMove(null)
      if (!current || !timeline) return
      if (current.deltaFrames === 0 && current.targetTrackId === current.sourceTrackId) return

      const store = useEditor.getState()
      const moving = allItems(timeline).filter((item) => current.itemIds.includes(item.id))
      // Moving right, the rightmost clip must vacate its space first — otherwise the one
      // behind it collides with a clip that is itself about to move out of the way.
      moving.sort((a, b) => (current.deltaFrames > 0 ? b.from - a.from : a.from - b.from))
      // One drag is one undo step. Without the transaction a four-clip drag pushes four
      // entries and a single Cmd+Z moves one clip back, leaving the selection spread across
      // two positions — a state nobody dragged to. The ordering above makes the intermediate
      // states legal, which is why the group can be built from single moves at all.
      // A linked clip moves its partners itself (`moveItem`), so a partner that is also selected
      // — clicking a linked clip selects the group — is not moved a second time.
      const moved = new Set<string>()
      store.transact(() => {
        for (const item of moving) {
          if (moved.has(item.id)) continue
          store.moveItem(
            item.id,
            item.from + current.deltaFrames,
            item.id === current.itemIds[0] ? current.targetTrackId : undefined,
            { linked: store.linkedSelection }
          )
          moved.add(item.id)
          if (store.linkedSelection) for (const partner of linkedPartners(timeline, item.id)) moved.add(partner.id)
        }
      })
    },
    onClick: () => setMove(null)
  })

  const beginTrim = useDrag({
    onMove: (state) => {
      if (!timeline) return
      autoScroll(state.x)
      setTrim((current) => {
        if (!current) return current
        const item = allItems(timeline).find((candidate) => candidate.id === current.itemId)
        if (!item) return current
        const raw = frameAtClientX(state.x)
        const frame = state.meta ? Math.round(raw) : snap(raw, new Set([item.id]))
        if (current.edge === 'start') {
          const from = Math.max(0, Math.min(frame, itemEnd(item) - 1))
          return { ...current, from, durationInFrames: itemEnd(item) - from }
        }
        return { ...current, from: item.from, durationInFrames: Math.max(1, frame - item.from) }
      })
    },
    onEnd: () => {
      const current = trim
      setTrim(null)
      if (!current) return
      const store = useEditor.getState()
      store.trimItem(
        current.itemId,
        current.edge,
        current.edge === 'start' ? current.from : current.from + current.durationInFrames,
        { linked: store.linkedSelection }
      )
    },
    onClick: () => setTrim(null)
  })

  const beginTrimMode = useDrag({
    onMove: (state) => {
      if (!timeline) return
      setTrimMode((current) => {
        if (!current) return current
        // A slip drags the *footage*: pulling right reveals what came before, the way the
        // picture moves under a fixed window. Slide and roll drag the clip or the cut itself.
        const raw = Math.round(state.dx / pixelsPerFrame) * (current.mode === 'slip' ? -1 : 1)
        const deltaFrames = Math.max(current.range.min, Math.min(current.range.max, raw))
        if (deltaFrames === current.deltaFrames) return current
        const plan =
          deltaFrames === 0
            ? null
            : planTrim(useEditor.getState().project, timeline, {
                itemId: current.itemId,
                mode: current.mode,
                deltaFrames,
                ...(current.edge ? { edge: current.edge } : {})
              })
        const preview = new Map<string, TrimChange>()
        if (plan?.ok) for (const change of plan.changes) preview.set(change.itemId, change)
        return { ...current, deltaFrames, preview }
      })
    },
    onEnd: () => {
      const current = trimMode
      setTrimMode(null)
      if (!current || current.deltaFrames === 0) return
      const store = useEditor.getState()
      const result = store.trimEdit({
        itemId: current.itemId,
        mode: current.mode,
        deltaFrames: current.deltaFrames,
        ...(current.edge ? { edge: current.edge } : {})
      })
      // Only reachable if the project changed under the drag; say why rather than dropping it.
      if (!result.ok) store.notify(result.error, 'error')
    },
    onClick: () => setTrimMode(null)
  })

  /**
   * Starts a slip, slide or roll if the pointer-down asked for one. Returns false when the
   * modifiers do not, so the caller falls through to an ordinary move or trim.
   */
  const startTrimMode = useCallback(
    (event: React.PointerEvent, item: Item, mode: TrimMode, edge?: 'start' | 'end'): boolean => {
      if (!timeline) return false
      const store = useEditor.getState()
      // A zero delta is refused with the legal range attached, which is exactly the question
      // "how far can this go" — one planner, asked before the drag instead of after it.
      const probe = planTrim(store.project, timeline, {
        itemId: item.id,
        mode,
        deltaFrames: 0,
        ...(edge ? { edge } : {})
      })
      if (probe.ok || !probe.range) {
        if (!probe.ok) store.notify(probe.error, 'error')
        return true
      }
      store.select([item.id])
      setTrimMode({ itemId: item.id, mode, edge, range: probe.range, deltaFrames: 0, preview: new Map() })
      beginTrimMode(event)
      return true
    },
    [timeline, beginTrimMode]
  )

  const onClipPointerDown = useCallback(
    (event: React.PointerEvent, item: Item): void => {
      const store = useEditor.getState()
      // Alt is the trim-mode modifier: alone it slips the footage inside the clip, with Shift it
      // slides the clip between its neighbours. Checked before the Shift-click branch below, so
      // Alt+Shift is a slide rather than a selection toggle.
      if (event.altKey) {
        startTrimMode(event, item, event.shiftKey ? 'slide' : 'slip')
        return
      }
      // Shift-click edits the selection and nothing else — dragging a shift-click would
      // move whatever was already selected, which is never what the gesture meant.
      if (event.shiftKey) {
        store.select([item.id], true)
        return
      }
      // Linked selection: a picture and its detached sound select, and so drag, together.
      if (!store.selection.includes(item.id)) {
        store.select(timeline && store.linkedSelection ? withLinked(timeline, [item.id]) : [item.id])
      }
      const track = tracks.find((candidate) => candidate.id === item.trackId)
      if (!track || track.locked) return
      const selected = useEditor.getState().selection
      const others = selected.filter((id) => id !== item.id)
      setMove({
        itemIds: [item.id, ...others],
        anchorFrom: item.from,
        sourceTrackId: track.id,
        deltaFrames: 0,
        targetTrackId: track.id
      })
      beginMove(event)
    },
    [timeline, tracks, beginMove, startTrimMode]
  )

  const onTrimPointerDown = useCallback(
    (event: React.PointerEvent, item: Item, edge: 'start' | 'end'): void => {
      const track = tracks.find((candidate) => candidate.id === item.trackId)
      if (!track || track.locked) return
      // Alt on a handle rolls the cut at that edge instead of trimming one side of it.
      if (event.altKey) {
        startTrimMode(event, item, 'roll', edge)
        return
      }
      useEditor.getState().select([item.id])
      setTrim({ itemId: item.id, edge, from: item.from, durationInFrames: item.durationInFrames })
      beginTrim(event)
    },
    [tracks, beginTrim, startTrimMode]
  )

  // -- clip menu --------------------------------------------------------------

  const onClipContextMenu = useCallback((event: React.MouseEvent, item: Item): void => {
    event.preventDefault()
    const store = useEditor.getState()
    const current = selectTimeline(store)
    if (!store.selection.includes(item.id)) {
      store.select(current && store.linkedSelection ? withLinked(current, [item.id]) : [item.id])
    }
    setMenu({ itemId: item.id, x: event.clientX, y: event.clientY })
  }, [])

  const menuItem = menu && timeline ? allItems(timeline).find((item) => item.id === menu.itemId) : undefined
  const menuTrack = menuItem ? tracks.find((track) => track.id === menuItem.trackId) : undefined
  const menuAsset = menuItem ? findAsset(project, menuItem.assetId) : undefined
  const menuLinked = menuItem && timeline ? linkedPartners(timeline, menuItem.id).length > 0 : false
  const canDetach = Boolean(
    menuItem &&
      menuTrack?.kind === 'video' &&
      !menuItem.audioDetached &&
      menuAsset?.hasVideo &&
      menuAsset.hasAudio &&
      !menuAsset.error
  )
  const canReattach = Boolean(
    menuItem && (menuItem.audioDetached || (timeline && linkedPartners(timeline, menuItem.id).some((p) => p.audioDetached)))
  )

  const runMenu = (action: 'detach' | 'unlink' | 'reattach'): void => {
    const target = menu?.itemId
    if (!target) return
    const store = useEditor.getState()
    if (action === 'unlink') {
      store.unlinkItems([target])
      return
    }
    const refused =
      action === 'detach' ? store.detachAudio([target]).refused : store.reattachAudio([target]).refused
    if (refused.length > 0) store.notify(refused.map((r) => r.reason).join('. ') + '.', 'error')
  }

  // -- render ---------------------------------------------------------------

  const margin = 400
  const viewStart = Math.max(0, (view.left - HEADER_WIDTH - margin) / pixelsPerFrame)
  const viewEnd = (view.left + view.width - HEADER_WIDTH + margin) / pixelsPerFrame

  const laneTops = new Map<string, number>()
  let cursor = RULER_HEIGHT
  for (const track of tracks) {
    laneTops.set(track.id, cursor)
    cursor += trackHeight(track)
  }

  const movingIds = move ? new Set(move.itemIds) : null
  const nothingPlaced = tracks.every((track) => track.items.length === 0)

  return (
    <div ref={panelRef} className="relative flex min-h-0 flex-1 flex-col border-t border-line bg-surface-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        // Found by Zoom to Fit (⇧Z), which needs the lanes' visible width.
        data-timeline-scroller=""
        data-lane-offset={HEADER_WIDTH}
        className="relative min-h-0 flex-1 overflow-auto"
      >
        <div className="relative" style={{ width: HEADER_WIDTH + contentWidth, minHeight: '100%' }}>
          <div className="sticky top-0 z-[35] flex">
            <div
              className="sticky left-0 z-10 flex shrink-0 items-center border-r border-b border-line bg-surface-1 px-2"
              style={{ width: HEADER_WIDTH, height: RULER_HEIGHT }}
            >
              <span className="text-[10px] font-medium tracking-[0.08em] text-ink-2 uppercase">
                Timeline
              </span>
            </div>
            <TimelineRuler
              fps={fps}
              pixelsPerFrame={pixelsPerFrame}
              contentWidth={contentWidth}
              durationFrames={duration}
              markers={timeline?.markers ?? NO_MARKERS}
              viewStart={viewStart}
              viewEnd={viewEnd}
              innerRef={rulerRef}
              onScrubStart={onScrubStart}
              onScrub={onScrub}
              onScrubEnd={onScrubEnd}
            />
          </div>

          {tracks.map((track) => {
            const height = trackHeight(track)
            const removable = tracks.filter((other) => other.kind === track.kind).length > 1
            return (
              <div key={track.id} className="flex" style={{ height }}>
                <div
                  className="sticky left-0 z-30 shrink-0 border-r border-line bg-surface-1"
                  style={{ width: HEADER_WIDTH }}
                >
                  <TrackHeader track={track} height={height} removable={removable} />
                </div>
                <div
                  // A lane really is a list of selectable things, and saying so is what
                  // makes the clips' `role="option"` and `aria-selected` legal ARIA.
                  role="listbox"
                  aria-multiselectable
                  aria-label={`${track.name} clips`}
                  ref={(element) => {
                    if (element) laneRefs.current.set(track.id, element)
                    else laneRefs.current.delete(track.id)
                  }}
                  onPointerDown={(event) => {
                    if (event.target === event.currentTarget) useEditor.getState().clearSelection()
                  }}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'copy'
                  }}
                  onDrop={(event) => {
                    const assetId = event.dataTransfer.getData(ASSET_DRAG_TYPE)
                    if (!assetId) return
                    event.preventDefault()
                    useEditor
                      .getState()
                      .placeAsset(assetId, Math.round(frameAtClientX(event.clientX)), track.id)
                  }}
                  className={cn(
                    'relative border-b border-line',
                    track.kind === 'video' ? 'bg-surface-1' : 'bg-surface-0/40',
                    track.locked && 'opacity-60'
                  )}
                  style={{ width: contentWidth, height }}
                >
                  {track.items.map((original) => {
                    const trimming = trim?.itemId === original.id
                    // During a slip, slide or roll, draw the item as the plan will leave it —
                    // including its read point, so a slipped filmstrip visibly moves.
                    const planned = trimMode?.preview.get(original.id)
                    const item: Item = planned
                      ? {
                          ...original,
                          from: planned.from,
                          durationInFrames: planned.durationInFrames,
                          sourceStartUs: planned.sourceStartUs,
                          fadeInFrames: planned.fadeInFrames,
                          fadeOutFrames: planned.fadeOutFrames
                        }
                      : original
                    return (
                      <Clip
                        key={item.id}
                        item={item}
                        asset={findAsset(project, item.assetId)}
                        fps={fps}
                        pixelsPerFrame={pixelsPerFrame}
                        height={height}
                        selected={selection.includes(item.id)}
                        locked={track.locked}
                        trackKind={track.kind}
                        previewFrom={trimming ? trim.from : item.from}
                        previewDuration={trimming ? trim.durationInFrames : item.durationInFrames}
                        dragging={(movingIds?.has(item.id) ?? false) || trimMode?.itemId === item.id}
                        onPointerDownBody={onClipPointerDown}
                        onPointerDownTrim={onTrimPointerDown}
                        onContextMenu={onClipContextMenu}
                      />
                    )
                  })}

                  {/* After the clips, so a marker sitting on a cut is never underneath the
                      clip edge it belongs to. Video only: an audio cut crossfades through
                      the mixer and has no picture to dissolve. */}
                  {timeline && track.kind === 'video' && (
                    <JunctionMarkers
                      project={project}
                      timeline={timeline}
                      track={track}
                      pixelsPerFrame={pixelsPerFrame}
                      height={height}
                      onOpen={(junction) => setJunctionKey(junction.key)}
                    />
                  )}
                </div>
              </div>
            )
          })}

          <div className="flex">
            <div
              className="sticky left-0 z-30 flex shrink-0 items-center gap-1 border-r border-b border-line bg-surface-1 px-2 py-1.5"
              style={{ width: HEADER_WIDTH }}
            >
              <span className="mr-auto text-[10px] text-ink-2">Add track</span>
              <IconButton
                size="xs"
                tooltipSide="top"
                label="Add video track"
                icon={<Video className="size-3" />}
                onClick={() => useEditor.getState().addTrack('video')}
              />
              <IconButton
                size="xs"
                tooltipSide="top"
                label="Add audio track"
                icon={<Music2 className="size-3" />}
                onClick={() => useEditor.getState().addTrack('audio')}
              />
            </div>
            <div className="border-b border-line" style={{ width: contentWidth, height: 30 }} />
          </div>

          {move && timeline && (
            <div className="pointer-events-none absolute inset-0 z-20">
              {allItems(timeline)
                .filter((item) => move.itemIds.includes(item.id))
                .map((item) => {
                  const laneId = item.id === move.itemIds[0] ? move.targetTrackId : item.trackId
                  const top = laneTops.get(laneId)
                  if (top === undefined) return null
                  const lane = tracks.find((candidate) => candidate.id === laneId)
                  return (
                    <div
                      key={item.id}
                      className="absolute rounded-sm border border-accent bg-accent/20"
                      style={{
                        left:
                          HEADER_WIDTH + Math.max(0, item.from + move.deltaFrames) * pixelsPerFrame,
                        width: Math.max(2, item.durationInFrames * pixelsPerFrame),
                        top: top + 4,
                        height: (lane ? trackHeight(lane) : VIDEO_TRACK_HEIGHT) - 8
                      }}
                    />
                  )
                })}
            </div>
          )}

          <div
            ref={playheadRef}
            aria-hidden="true"
            className="pointer-events-none absolute top-0 bottom-0 left-0 z-40 w-px bg-playhead"
          >
            <div className="absolute -top-px -left-[5px] size-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-playhead" />
          </div>
        </div>
      </div>

      {/* What the drag will do, in the units the result will be reported in. The range is
          shown because the drag stops at it, and a drag that stops for no visible reason reads
          as the editor sticking. */}
      {trimMode && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-50 -translate-x-1/2 rounded-sm border border-line bg-surface-2 px-2 py-1 text-[11px] text-ink-0 tabular-nums shadow-pop">
          {trimMode.mode === 'slip' ? 'Slip' : trimMode.mode === 'slide' ? 'Slide' : 'Roll'}{' '}
          {trimMode.deltaFrames > 0 ? '+' : ''}
          {trimMode.deltaFrames} frames
          <span className="ml-2 text-ink-2">
            {Number.isFinite(trimMode.range.min) ? trimMode.range.min : '−∞'} to{' '}
            {Number.isFinite(trimMode.range.max) ? `+${trimMode.range.max}` : '+∞'}
          </span>
        </div>
      )}

      {/* Centred on the *lanes*, not on the panel — otherwise it lands over the add-track
          row and reads as a label for it. `cursor` is where the last lane ends. */}
      {nothingPlaced && (
        <div
          className="pointer-events-none absolute right-0 left-0 flex items-center justify-center"
          style={{ top: RULER_HEIGHT, height: Math.max(0, cursor - RULER_HEIGHT) }}
        >
          <p className="rounded-sm border border-line bg-surface-1/90 px-3 py-1.5 text-[11px] text-ink-2">
            Drag media here, or click a clip in the media pool to place it at the playhead.
          </p>
        </div>
      )}

      <ContextMenu
        // `menu` itself, not a fresh `{ x, y }`: the timeline re-renders every frame while playing.
        at={menuItem ? menu : null}
        onClose={() => setMenu(null)}
        label="Clip"
        items={[
          ...(menuItem && menu ? clipMenuEntries(menuItem, menu) : []),
          { kind: 'separator' },
          { label: 'Detach audio', disabled: !canDetach, onSelect: () => runMenu('detach') },
          { label: 'Unlink', disabled: !menuLinked, onSelect: () => runMenu('unlink') },
          { label: 'Reattach audio', disabled: !canReattach, onSelect: () => runMenu('reattach') }
        ]}
      />

      <ClipDialogs />

      <TransitionDialog
        junction={openJunction}
        fps={fps}
        onClose={() => setJunctionKey(null)}
      />
    </div>
  )
}
