import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { trimBounds } from '@shared/speed'
import { allItems, findAsset, formatTimecode, itemEnd, textAssetName, type Asset, type Item, type Marker, type Track } from '@shared/project'
import { shortcutOf } from '@shared/commands'
import { planTrim, type TrimChange, type TrimMode } from '@shared/trim'
import { linkedPartners, withLinked } from '@shared/links'
import { Button, ContextMenu, Kbd, ToolButton, type MenuEntry } from '@/components'
import { cn } from '@/lib/cn'
import { runCommand } from '@/lib/commands'
import {
  boxFrom,
  autoScrollDelta,
  combineSelection,
  displayOrder,
  formatDelta,
  gapAt,
  marqueeHits,
  trackHeightFor,
  trimEdgeFrame,
  type Box,
  type Gap
} from '@/lib/timelineLayout'
import { closeGap, useTimelineView } from '@/lib/timelineView'
import { useDrag } from '@/lib/useDrag'
import { newId, selectDuration, selectTimeline, useEditor } from '@/store/editor'
import { editingPrefs } from '@/store/editing-prefs'
import { ASSET_DRAG_TYPE } from './MediaPanel'
import { decodeTransitionDrag, dropJunction, TRANSITION_DRAG_TYPE } from '@/lib/transitionDrag'
import { applyTransitionAt } from './library/transitions'
import { addEffectTo } from './library/VideoEffects'
import { decodeEffectDrag, EFFECT_DRAG_TYPE, effectDropTarget } from '@/lib/effectDrag'
import { junctionsForTrack, type Junction } from '@/lib/junctions'
import { snapFrame, snapTargets } from '@/lib/snap'
import { Clip } from './Clip'
import { JunctionMarkers } from './JunctionMarkers'
import { TransitionDialog } from './TransitionDialog'
import { hideCoveredRulerLabels, TimelineRuler } from './TimelineRuler'
import { TimelineToolbar } from './TimelineToolbar'
import { TrackHeader } from './TrackHeader'
import { trackNumbers } from '@shared/track-order'
import { ClipDialogs, clipMenuEntries, rippleDeleteEntries, type ClipMenuPage } from './ClipCommands'
import { detachToEntries, rippleDeleteThisTrack, trimModeEntries } from './clipMenuExtras'
import { canDetachAudio, canReattachAudio, isLinked, runAudioLink } from './timeline/audioLink'
import { bladeFrame, clipZone, nearerEdge } from '@/lib/blade'
import { TRIM_TOOL_MODES, useTimelineTool } from '@/lib/timelineTool'
import { pointerHint } from '@/lib/pointerHint'
import { planTrackShift, type TrackMove } from '@shared/track-move'
import { applyRippleTrim, rippleHeadRoom } from './timeline/rippleTrim'
import { addAdjustmentLayerHere } from './AdjustmentLayerButton'

const CLIP_MENU_PAGE_NAME: Record<ClipMenuPage, string> = { main: '', trim: 'Trim', audio: 'Audio', ripple: 'Ripple Delete' }

/** One shared empty list, so a timeline without markers does not hand the ruler a new array each render. */
const NO_MARKERS: readonly Marker[] = []

const HEADER_WIDTH = 148
/** `TimelineRuler`'s height: a marker lane on top, the timecode labels under it. */
const RULER_HEIGHT = 34
/** The marker strip along the ruler's top edge; the playhead starts below it so it never covers a flag. */
const MARKER_STRIP = 11
/**
 * Snap tolerance in *pixels*, not frames. A frame-based threshold would be invisible when
 * zoomed in and would snap across half a minute when zoomed out.
 */
const SNAP_PX = 8
/** Height of `TimelineToolbar` (`h-9`), which sits above the scroller. */
const TOOLBAR_HEIGHT = 36

/**
 * "Add text here": a title clip on this track at this frame, selected so the inspector is on it.
 * The same asset shape the Text panel mints (text is the one kind with no file behind it).
 */
function addTextAt(frame: number, trackId: string): void {
  const store = useEditor.getState()
  const text = 'Title'
  const asset: Asset = {
    id: newId('ast'),
    kind: 'text',
    name: textAssetName(text),
    path: null,
    durationUs: 0,
    width: null,
    height: null,
    fps: null,
    hasAudio: false,
    hasVideo: false,
    posterPath: null,
    waveformPath: null,
    text,
    createdAt: Date.now()
  }
  store.transact(() => {
    store.addAssets([asset])
    const itemId = store.placeAsset(asset.id, frame, trackId)
    if (itemId) store.select([itemId])
  })
}

/** Empty runway past the last clip, so there is somewhere to drag to. */
const TAIL_SECONDS = 5

interface MoveGesture {
  /** The grabbed clip first; the rest of the selection follows it by the same delta. */
  itemIds: string[]
  anchorFrom: number
  sourceTrackId: string
  deltaFrames: number
  targetTrackId: string
  /** A multi-clip drag onto other lanes: where each clip lands (`planTrackShift`). */
  lanes?: TrackMove[]
  /** Why a multi-clip drag is staying on its own tracks, shown in the readout. */
  blocked?: string
}

/** What the pointer is over, for the blade's cut line and the ⌥ / armed-trim hints. */
interface Hover {
  itemId: string
  trackId: string
  zone: 'start' | 'end' | 'body'
  /** The frame a blade click would cut at; null when not in blade mode or on an edge. */
  frame: number | null
}

const sameHover = (a: Hover | null, b: Hover | null): boolean =>
  a === b ||
  (a !== null && b !== null && a.itemId === b.itemId && a.zone === b.zone && a.frame === b.frame && a.trackId === b.trackId)

interface TrimGesture {
  itemId: string
  edge: 'start' | 'end'
  from: number
  durationInFrames: number
  /** The Trim tool's ripple: later clips on the track follow the edge, and a head trim keeps the start. */
  ripple?: boolean
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

/** A rubber band in progress, in the content box's coordinates (scrolls with the lanes). */
interface MarqueeGesture {
  originX: number
  originY: number
  x: number
  y: number
  base: string[]
  mode: 'replace' | 'add' | 'toggle'
}

/** Selection edits by modifier: ⇧ adds, ⌘ toggles, a plain click replaces. */
function clickMode(event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): 'replace' | 'add' | 'toggle' {
  if (event.metaKey || event.ctrlKey) return 'toggle'
  return event.shiftKey ? 'add' : 'replace'
}

const sameGap = (a: Gap | null, b: Gap | null): boolean =>
  a === b || (a !== null && b !== null && a.trackId === b.trackId && a.from === b.from && a.to === b.to)

export function Timeline(): ReactNode {
  const timeline = useEditor(selectTimeline)
  const duration = useEditor(selectDuration)
  const project = useEditor((state) => state.project)
  const selection = useEditor((state) => state.selection)
  const pixelsPerFrame = useEditor((state) => state.pixelsPerFrame)
  const trackSizes = useTimelineView((state) => state.trackSizes)
  const selectedGap = useTimelineView((state) => state.selectedGap)

  const scrollRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const laneRefs = useRef(new Map<string, HTMLDivElement>())
  const contentRef = useRef<HTMLDivElement>(null)

  // Quantised: auto-scrolling during playback must not re-render the ruler on every frame,
  // so the visible window only changes in 256px steps and the ticks are drawn with margin.
  const [view, setView] = useState({ left: 0, width: 0 })
  const [move, setMove] = useState<MoveGesture | null>(null)
  const [trim, setTrim] = useState<TrimGesture | null>(null)
  const trimScrollAtGrab = useRef(0)
  const [trimMode, setTrimMode] = useState<TrimModeGesture | null>(null)
  // The junction under edit. Local because a cut is not a selectable object in the store —
  // `selection` holds item ids — and inventing a second kind of selection there to carry a
  // transient dialog would be a worse trade than holding it here.
  const [junctionKey, setJunctionKey] = useState<string | null>(null)
  // The clip menu (right-click), at the pointer, in viewport coordinates.
  const [menu, setMenu] = useState<{ itemId: string; x: number; y: number; page: ClipMenuPage } | null>(null)
  // The menu as last opened: a `›` row's page reopens it after Menu has closed it.
  const lastMenu = useRef(menu)
  if (menu) lastMenu.current = menu
  // The empty-lane menu: which track, which frame, and where the pointer was.
  const [laneMenu, setLaneMenu] = useState<{ trackId: string; frame: number; x: number; y: number } | null>(null)
  const [marquee, setMarquee] = useState<MarqueeGesture | null>(null)
  const [hoverGap, setHoverGap] = useState<Gap | null>(null)
  // The cut a transition dragged from the library would land on, while it is over a lane.
  const [dropCut, setDropCut] = useState<{ trackId: string; cutFrame: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const tool = useTimelineTool((state) => state.tool)
  const armed = useTimelineTool((state) => state.armed)
  const trimToolMode = useTimelineTool((state) => state.trimMode)
  const [hover, setHover] = useState<Hover | null>(null)
  // ⌥ and ⇧ as held now — for the cursor and the hint while the pointer rests on a clip.
  const [mods, setMods] = useState({ alt: false, shift: false })

  useEffect(() => {
    const sync = (event: KeyboardEvent): void => {
      const next = { alt: event.altKey, shift: event.shiftKey }
      setMods((current) => (current.alt === next.alt && current.shift === next.shift ? current : next))
    }
    const clear = (): void => setMods((current) => (current.alt || current.shift ? { alt: false, shift: false } : current))
    // Escape puts the blade down and cancels an armed trim. The app's own Escape handler only
    // closes its dialogs, and a modal open now owns the key.
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || document.querySelector('[aria-modal="true"]')) return
      const tools = useTimelineTool.getState()
      if (tools.tool !== 'select' || tools.armed) tools.setTool('select')
    }
    window.addEventListener('keydown', sync)
    window.addEventListener('keyup', sync)
    window.addEventListener('keydown', onEscape)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', sync)
      window.removeEventListener('keyup', sync)
      window.removeEventListener('keydown', onEscape)
      window.removeEventListener('blur', clear)
    }
  }, [])

  const fps = timeline?.fps ?? 30
  const tracks = useMemo(() => timeline?.tracks ?? [], [timeline])
  // Listed top to bottom as the picture stacks: the front video layer first, audio below.
  const ordered = useMemo(() => displayOrder(tracks), [tracks])
  // Resolve's track numbers: V1 is the first video track in the stack (drawn lowest), A1 the first audio.
  const badges = useMemo(() => trackNumbers(tracks), [tracks])
  const heightOf = useCallback(
    (track: Track): number => trackHeightFor(track.kind, trackSizes[track.id]),
    [trackSizes]
  )

  // A gap and a clip are never selected together: selecting a clip drops the gap.
  useEffect(
    () =>
      useEditor.subscribe((state, previous) => {
        if (state.selection !== previous.selection && state.selection.length > 0) {
          if (useTimelineView.getState().selectedGap) useTimelineView.setState({ selectedGap: null })
        }
      }),
    []
  )
  // …and a gap that stopped existing (an undo, a move into it) stops being selected.
  useEffect(() => {
    if (!selectedGap) return
    const track = tracks.find((candidate) => candidate.id === selectedGap.trackId)
    if (!sameGap(track ? (gapAt(track, selectedGap.from) ?? null) : null, selectedGap)) {
      useTimelineView.getState().selectGap(null)
    }
  }, [tracks, selectedGap])

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

  /**
   * A click on a cut: the two clips either side are selected and the Inspector shows its
   * Transition tab, where the cut's transition is edited inline, as in Resolve. ⌥-click, or a
   * page with no Inspector showing (only the Edit page has one), opens the transition dialog here.
   */
  const openJunctionAt = useCallback((junction: Junction, how: { dialog: boolean }): void => {
    const store = useEditor.getState()
    if (how.dialog || store.page !== 'edit' || store.hiddenRegions.inspector) {
      setJunctionKey(junction.key)
      return
    }
    store.select([junction.from.id, junction.to.id])
    store.setInspectorTab('transition')
  }, [])

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

  /** The lane under the pointer, whatever its kind or lock — the planner says why it cannot be used. */
  const laneAtClientY = useCallback((clientY: number): string | null => {
    for (const [trackId, element] of laneRefs.current) {
      const box = element.getBoundingClientRect()
      if (clientY >= box.top && clientY <= box.bottom) return trackId
    }
    return null
  }, [])

  // The last pointer x a drag reported, and when: a gap longer than a drag's move interval means a
  // new drag, whose first move has no direction yet and so never scrolls.
  const lastDragX = useRef<{ x: number; at: number } | null>(null)
  const autoScroll = useCallback((clientX: number): void => {
    const scroller = scrollRef.current
    if (!scroller) return
    const box = scroller.getBoundingClientRect()
    const now = performance.now()
    const previous = lastDragX.current && now - lastDragX.current.at < 250 ? lastDragX.current.x : null
    lastDragX.current = { x: clientX, at: now }
    scroller.scrollLeft += autoScrollDelta(clientX, previous, { left: box.left + HEADER_WIDTH, right: box.right })
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
      if (!state.playing || !editingPrefs().followPlayhead) return
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
    hideCoveredRulerLabels(rulerRef.current, scroller.scrollLeft)
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
        const deltaFrames = snapped - current.anchorFrom
        if (current.itemIds.length === 1 || !source) {
          const targetTrackId = source ? (trackAtClientY(state.y, source.kind) ?? current.sourceTrackId) : current.sourceTrackId
          return { ...current, deltaFrames, targetTrackId }
        }
        // Several clips change lanes by whole lanes of the grabbed clip's kind, or not at all:
        // the plan either lands every clip on free time on an unlocked lane of its kind, or it
        // says why not and the clips stay on their tracks (`@shared/track-move`).
        const over = laneAtClientY(state.y)
        if (!over || over === current.sourceTrackId) {
          return { ...current, deltaFrames, targetTrackId: current.sourceTrackId, lanes: undefined, blocked: undefined }
        }
        const store = useEditor.getState()
        const plan = planTrackShift(store.project, timeline, {
          // A linked clip goes where its partner goes, as it does in a same-lane drag.
          itemIds: store.linkedSelection ? withLinked(timeline, current.itemIds) : current.itemIds,
          anchorId: current.itemIds[0]!,
          targetTrackId: over,
          deltaFrames,
          order: ordered.map((track) => track.id)
        })
        return plan.ok
          ? { ...current, deltaFrames, targetTrackId: over, lanes: plan.moves, blocked: undefined }
          : { ...current, deltaFrames, targetTrackId: current.sourceTrackId, lanes: undefined, blocked: plan.error }
      })
    },
    onEnd: () => {
      const current = move
      setMove(null)
      if (!current || !timeline) return
      if (current.deltaFrames === 0 && current.targetTrackId === current.sourceTrackId) {
        if (current.blocked) useEditor.getState().notify(`Kept on their tracks: ${current.blocked}`)
        return
      }

      const store = useEditor.getState()
      if (current.lanes) {
        // One edit, all clips or none: the plan is checked again against the timeline as it is.
        const result = store.moveItemsToTracks(current.lanes)
        if ('error' in result) store.notify(result.error, 'error')
        return
      }
      // Released over a lane the group could not go to: it moved in time on its own tracks.
      if (current.blocked) store.notify(`Kept on their tracks: ${current.blocked}`)
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
        // The edge moves by the pointer's travel, not to the pointer: a handle grabbed 4px in
        // must not jump 4px (20 frames at a wide zoom) on the first move.
        // Travel includes what auto-scroll moved the lanes under the pointer.
        const scrolled = (scrollRef.current?.scrollLeft ?? 0) - trimScrollAtGrab.current
        const raw = trimEdgeFrame(current.edge === 'start' ? item.from : itemEnd(item), state.dx + scrolled, pixelsPerFrame)
        const frame = state.meta ? Math.round(raw) : snap(raw, new Set([item.id]))
        // The edge stops where the footage does, so what is drawn is what the store keeps.
        const footageUs = findAsset(project, item.assetId)?.durationUs ?? 0
        const bounds = trimBounds(item, footageUs, timeline.fps)
        if (current.edge === 'start') {
          // A ripple head keeps the clip's start, so frame 0 does not limit it; the footage does.
          const earliest = current.ripple ? item.from - rippleHeadRoom(item, timeline.fps, footageUs > 0) : bounds.earliestFrom
          const from = Math.max(earliest, Math.min(frame, itemEnd(item) - 1))
          return { ...current, from, durationInFrames: itemEnd(item) - from }
        }
        const end = Math.min(frame, bounds.latestEnd)
        return { ...current, from: item.from, durationInFrames: Math.max(1, end - item.from) }
      })
    },
    onEnd: () => {
      const current = trim
      setTrim(null)
      if (!current) return
      const store = useEditor.getState()
      const toFrame = current.edge === 'start' ? current.from : current.from + current.durationInFrames
      if (current.ripple) {
        const error = applyRippleTrim(current.itemId, current.edge, toFrame)
        if (error) store.notify(error, 'error')
        return
      }
      store.trimItem(current.itemId, current.edge, toFrame, { linked: store.linkedSelection })
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

  /** Starts dragging one edge of a clip: an ordinary trim, or with `ripple` the Trim tool's ripple. */
  const startEdgeTrim = useCallback(
    (event: React.PointerEvent, item: Item, edge: 'start' | 'end', ripple: boolean): void => {
      const track = tracks.find((candidate) => candidate.id === item.trackId)
      const store = useEditor.getState()
      if (!track) return
      if (track.locked) {
        store.notify(`Track ${track.name} is locked — unlock it in the track header to trim it.`)
        return
      }
      store.select([item.id])
      trimScrollAtGrab.current = scrollRef.current?.scrollLeft ?? 0
      setTrim({ itemId: item.id, edge, from: item.from, durationInFrames: item.durationInFrames, ripple })
      beginTrim(event)
    },
    [tracks, beginTrim]
  )

  /** The frame a blade click at `clientX` on `item` cuts at (`lib/blade`), or null on its edge. */
  const bladeFrameAt = useCallback(
    (clientX: number, item: Item, suspendSnap: boolean): number | null => {
      // Its own edges (and its linked partner's, which coincide) would snap the cut onto an edge.
      const ignore = new Set(timeline ? withLinked(timeline, [item.id]) : [item.id])
      return bladeFrame(frameAtClientX(clientX), item, (frame) => (suspendSnap ? Math.round(frame) : snap(frame, ignore)))
    },
    [timeline, frameAtClientX, snap]
  )

  /**
   * The blade's click: `splitAt` at the frame under the pointer — the store action ⌘B runs, with
   * the clicked clip (and what is linked to it) as the selection it cuts. ⇧ cuts every unlocked
   * track there, as ⇧⌘B does at the playhead.
   */
  const bladeCut = useCallback(
    (event: React.PointerEvent, item: Item): void => {
      const store = useEditor.getState()
      const track = tracks.find((candidate) => candidate.id === item.trackId)
      if (!track || !timeline) return
      if (track.locked && !event.shiftKey) {
        store.notify(`Track ${track.name} is locked — unlock it in the track header to cut it.`)
        return
      }
      const frame = bladeFrameAt(event.clientX, item, event.metaKey || event.ctrlKey)
      if (frame === null) {
        store.notify('That is the clip’s edge, so there is nothing to cut. Click inside the clip.')
        return
      }
      if (event.shiftKey) {
        store.splitAt(frame, { allTracks: true })
        return
      }
      store.select(store.linkedSelection ? withLinked(timeline, [item.id]) : [item.id])
      store.splitAt(frame)
    },
    [tracks, timeline, bladeFrameAt]
  )

  const onClipPointerDown = useCallback(
    (event: React.PointerEvent, item: Item): void => {
      const store = useEditor.getState()
      const tools = useTimelineTool.getState()
      if (tools.tool === 'blade') {
        bladeCut(event, item)
        return
      }
      // The Trim tool: every drag is the trim picked in its menu. On the body, ripple and roll
      // act on the nearer edge; slip and slide on the clip.
      if (tools.tool === 'trim') {
        const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
        const edge = nearerEdge(event.clientX - box.left, box.width)
        if (tools.trimMode === 'ripple') startEdgeTrim(event, item, edge, true)
        else startTrimMode(event, item, tools.trimMode, tools.trimMode === 'roll' ? edge : undefined)
        return
      }
      // A trim mode armed from the clip menu is this drag's, then it disarms. A roll needs a
      // cut, so on the body it rolls the nearer one.
      if (tools.armed) {
        const mode = tools.armed
        tools.arm(null)
        const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
        startTrimMode(event, item, mode, mode === 'roll' ? nearerEdge(event.clientX - box.left, box.width) : undefined)
        return
      }
      // Alt is the trim-mode modifier: alone it slips the footage inside the clip, with Shift it
      // slides the clip between its neighbours. Checked before the Shift-click branch below, so
      // Alt+Shift is a slide rather than a selection toggle.
      if (event.altKey) {
        startTrimMode(event, item, event.shiftKey ? 'slide' : 'slip')
        return
      }
      // Shift-click edits the selection and nothing else — dragging a shift-click would
      // move whatever was already selected, which is never what the gesture meant.
      // ⌘-click toggles one clip in or out of the selection; ⇧-click adds it (and its links).
      const mode = clickMode(event)
      if (mode !== 'replace') {
        const ids = timeline && store.linkedSelection ? withLinked(timeline, [item.id]) : [item.id]
        store.select(combineSelection(store.selection, ids, mode))
        return
      }
      // Linked selection: a picture and its detached sound select, and so drag, together.
      if (!store.selection.includes(item.id)) {
        store.select(timeline && store.linkedSelection ? withLinked(timeline, [item.id]) : [item.id])
      }
      const track = tracks.find((candidate) => candidate.id === item.trackId)
      if (!track) return
      if (track.locked) {
        // Selected (so the inspector shows it) but not movable — and said so, since a drag that
        // does nothing reads as the editor being stuck.
        store.notify(`Track ${track.name} is locked — unlock it in the track header.`)
        return
      }
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
    [timeline, tracks, beginMove, startTrimMode, bladeCut, startEdgeTrim]
  )

  const onTrimPointerDown = useCallback(
    (event: React.PointerEvent, item: Item, edge: 'start' | 'end'): void => {
      const track = tracks.find((candidate) => candidate.id === item.trackId)
      if (!track || track.locked) return
      const tools = useTimelineTool.getState()
      if (tools.tool === 'trim') {
        if (tools.trimMode === 'ripple') startEdgeTrim(event, item, edge, true)
        else startTrimMode(event, item, tools.trimMode, tools.trimMode === 'roll' ? edge : undefined)
        return
      }
      // An armed slip or slide acts on the clip wherever it is grabbed; an armed roll rolls this edge.
      if (tools.armed) {
        const mode = tools.armed
        tools.arm(null)
        startTrimMode(event, item, mode, mode === 'roll' ? edge : undefined)
        return
      }
      // Alt on a handle rolls the cut at that edge instead of trimming one side of it.
      if (event.altKey) {
        startTrimMode(event, item, 'roll', edge)
        return
      }
      startEdgeTrim(event, item, edge, false)
    },
    [tracks, startTrimMode, startEdgeTrim]
  )

  // -- empty lanes: marquee, gaps, the lane menu ------------------------------

  /** A client point in the content box's coordinates — the box scrolls with the lanes. */
  const contentPoint = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const box = contentRef.current?.getBoundingClientRect()
    return box ? { x: clientX - box.left, y: clientY - box.top } : { x: clientX, y: clientY }
  }, [])

  /** Every clip on an unlocked track, as a rectangle in content coordinates. */
  const clipRects = useCallback((): (Box & { id: string })[] => {
    const rects: (Box & { id: string })[] = []
    let top = RULER_HEIGHT
    for (const track of ordered) {
      const height = heightOf(track)
      if (!track.locked) {
        for (const item of track.items) {
          const left = HEADER_WIDTH + item.from * pixelsPerFrame
          rects.push({ id: item.id, left, right: left + Math.max(2, item.durationInFrames * pixelsPerFrame), top: top + 4, bottom: top + height - 4 })
        }
      }
      top += height
    }
    return rects
  }, [ordered, heightOf, pixelsPerFrame])

  const beginMarquee = useDrag({
    onMove: (state) => {
      autoScroll(state.x)
      setMarquee((current) => {
        if (!current) return current
        const point = contentPoint(state.x, state.y)
        const band = boxFrom(current.originX, current.originY, point.x, point.y)
        const hits = marqueeHits(band, clipRects())
        const store = useEditor.getState()
        const withLinks = timeline && store.linkedSelection ? withLinked(timeline, hits) : hits
        store.select(combineSelection(current.base, withLinks, current.mode))
        return { ...current, x: point.x, y: point.y }
      })
    },
    onEnd: () => setMarquee(null),
    onClick: () => setMarquee(null)
  })

  const onLanePointerDown = (event: React.PointerEvent<HTMLDivElement>, track: Track): void => {
    if (event.button !== 0 || event.target !== event.currentTarget) return
    const frame = frameAtClientX(event.clientX)
    const mode = clickMode(event)
    const store = useEditor.getState()
    // A press on an empty lane is a click (select the gap under it, or clear the selection) or
    // the start of a rubber band — which of the two is decided by how far the pointer travels.
    if (mode === 'replace') {
      const gap = gapAt(track, frame) ?? null
      useTimelineView.getState().selectGap(gap)
      if (!gap) store.clearSelection()
    }
    const origin = contentPoint(event.clientX, event.clientY)
    setMarquee({ originX: origin.x, originY: origin.y, x: origin.x, y: origin.y, base: mode === 'replace' ? [] : store.selection, mode })
    beginMarquee(event)
  }

  const onLanePointerMove = (event: React.PointerEvent<HTMLDivElement>, track: Track): void => {
    if (marquee || move || trim || trimMode) return
    const next = event.target === event.currentTarget ? (gapAt(track, frameAtClientX(event.clientX)) ?? null) : null
    setHoverGap((current) => (sameGap(current, next) ? current : next))

    // The clip under the pointer (a clip's events bubble here): where the blade would cut, and
    // which part of the clip a ⌥-drag would slip, slide or roll.
    const altNow = event.altKey
    if (altNow !== mods.alt || event.shiftKey !== mods.shift) setMods({ alt: altNow, shift: event.shiftKey })
    const raw = frameAtClientX(event.clientX)
    const item = event.target === event.currentTarget ? undefined : track.items.find((i) => raw >= i.from && raw < itemEnd(i))
    const hovered: Hover | null = item
      ? {
          itemId: item.id,
          trackId: track.id,
          zone: clipZone((raw - item.from) * pixelsPerFrame, item.durationInFrames * pixelsPerFrame),
          frame: tool === 'blade' ? bladeFrameAt(event.clientX, item, event.metaKey || event.ctrlKey) : null
        }
      : null
    setHover((current) => (sameHover(current, hovered) ? current : hovered))
  }

  const onLaneContextMenu = (event: React.MouseEvent<HTMLDivElement>, track: Track): void => {
    if (event.target !== event.currentTarget) return
    event.preventDefault()
    setLaneMenu({ trackId: track.id, frame: Math.round(frameAtClientX(event.clientX)), x: event.clientX, y: event.clientY })
  }

  const laneMenuTrack = laneMenu ? tracks.find((track) => track.id === laneMenu.trackId) : undefined
  const laneMenuGap = laneMenu && laneMenuTrack ? gapAt(laneMenuTrack, laneMenu.frame) : undefined
  const hasClipboard = useEditor((state) => state.clipboard !== null)
  const laneMenuItems: MenuEntry[] =
    !laneMenu || !laneMenuTrack
      ? []
      : [
          {
            // ⌘V's store action, at this frame and on this track (the planner takes both). A
            // disabled row says why, as "Close gap — not on a gap" does.
            label: laneMenuTrack.locked
              ? `Paste here — ${laneMenuTrack.name} is locked`
              : hasClipboard
                ? 'Paste here'
                : 'Paste here — nothing copied',
            disabled: !hasClipboard || laneMenuTrack.locked,
            shortcut: shortcutOf('edit.paste'),
            onSelect: () => void useEditor.getState().paste(laneMenu.frame, laneMenuTrack.id)
          },
          {
            label:
              laneMenuTrack.kind !== 'video'
                ? 'Add text here — text goes on a video track'
                : laneMenuTrack.locked
                  ? `Add text here — ${laneMenuTrack.name} is locked`
                  : 'Add text here',
            disabled: laneMenuTrack.kind !== 'video' || laneMenuTrack.locked,
            onSelect: () => addTextAt(laneMenu.frame, laneMenuTrack.id)
          },
          {
            // Always above everything, whichever lane was clicked: a layer changes the tracks below it.
            label: 'Add adjustment layer at this frame',
            onSelect: () => addAdjustmentLayerHere(laneMenu.frame)
          },
          {
            label: 'Add marker here',
            shortcut: shortcutOf('mark.add'),
            onSelect: () => useEditor.getState().addMarker(laneMenu.frame)
          },
          { kind: 'separator' },
          {
            label: laneMenuGap ? `Close gap (${laneMenuGap.to - laneMenuGap.from}f)` : 'Close gap — not on a gap',
            disabled: !laneMenuGap || laneMenuTrack.locked,
            onSelect: () => {
              if (laneMenuGap) closeGap(laneMenuGap)
            }
          },
          {
            label: `Select all on ${laneMenuTrack.name}`,
            disabled: laneMenuTrack.items.length === 0,
            onSelect: () => useEditor.getState().select(laneMenuTrack.items.map((item) => item.id))
          }
        ]

  // -- clip menu --------------------------------------------------------------

  const onClipContextMenu = useCallback((event: React.MouseEvent, item: Item): void => {
    event.preventDefault()
    const store = useEditor.getState()
    const current = selectTimeline(store)
    if (!store.selection.includes(item.id)) {
      store.select(current && store.linkedSelection ? withLinked(current, [item.id]) : [item.id])
    }
    setMenu({ itemId: item.id, x: event.clientX, y: event.clientY, page: 'main' })
  }, [])

  const menuItem = menu && timeline ? allItems(timeline).find((item) => item.id === menu.itemId) : undefined
  const menuTrack = menuItem ? tracks.find((track) => track.id === menuItem.trackId) : undefined
  const menuLinked = menuItem && timeline ? isLinked(timeline, menuItem.id) : false
  const canDetach = Boolean(menuItem && timeline && canDetachAudio(project, timeline, menuItem.id))
  const canReattach = Boolean(menuItem && timeline && canReattachAudio(timeline, menuItem.id))
  const menuLocked = menuTrack?.locked ?? true
  // A `›` row closes the menu (Menu dismisses before it runs a row) and this reopens it, on the
  // row's page, at the same point.
  const openMenuPage = useCallback(
    (page: ClipMenuPage): void => setMenu(lastMenu.current ? { ...lastMenu.current, page } : null),
    []
  )

  const menuPageEntries = (): MenuEntry[] => {
    if (!menuItem || !menu || !timeline) return []
    const back: MenuEntry[] = [{ label: '‹ Back', onSelect: () => openMenuPage('main') }, { kind: 'separator' }]
    switch (menu.page) {
      case 'main':
        return clipMenuEntries(menuItem, menu, openMenuPage)
      case 'trim':
        return [...back, { kind: 'label', label: 'Next drag on the clip' }, ...trimModeEntries(menuLocked)]
      case 'ripple':
        return [...back, ...rippleDeleteEntries(menuLocked, rippleDeleteThisTrack)]
      case 'audio':
        return [
          ...back,
          { label: 'Detach Audio', disabled: !canDetach, onSelect: () => runAudioLink('detach', [menuItem.id]) },
          ...detachToEntries(menuItem, timeline, canDetach),
          { kind: 'separator' },
          { label: 'Unlink', disabled: !menuLinked, onSelect: () => runAudioLink('unlink', [menuItem.id]) },
          { label: 'Reattach Audio', disabled: !canReattach, onSelect: () => runAudioLink('reattach', [menuItem.id]) }
        ]
    }
  }

  // -- render ---------------------------------------------------------------

  const margin = 400
  const viewStart = Math.max(0, (view.left - HEADER_WIDTH - margin) / pixelsPerFrame)
  const viewEnd = (view.left + view.width - HEADER_WIDTH + margin) / pixelsPerFrame

  const laneTops = new Map<string, number>()
  let cursor = RULER_HEIGHT
  for (const track of ordered) {
    laneTops.set(track.id, cursor)
    cursor += heightOf(track)
  }

  const movingIds = move ? new Set(move.itemIds) : null
  const nothingPlaced = tracks.every((track) => track.items.length === 0)

  return (
    <div
      ref={panelRef}
      // What a drag on a clip will do right now, for the clips' cursors (`Clip.tsx` reads it with
      // `in-data-[trim-hint=…]`, so holding ⌥ re-renders no clip).
      data-trim-hint={
        tool === 'trim' ? trimToolMode : (armed ?? (mods.alt && tool === 'select' ? (mods.shift ? 'slide' : 'slip') : undefined))
      }
      className="relative flex min-h-0 flex-1 flex-col border-t border-line bg-surface-1"
    >
      <TimelineToolbar fps={fps} />
      <div
        ref={scrollRef}
        onScroll={onScroll}
        // Found by Zoom to Fit (⇧Z), which needs the lanes' visible width.
        data-timeline-scroller=""
        data-lane-offset={HEADER_WIDTH}
        className="relative min-h-0 flex-1 overflow-auto"
      >
        <div ref={contentRef} className="relative" style={{ width: HEADER_WIDTH + contentWidth, minHeight: '100%' }}>
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

          {ordered.map((track) => {
            const height = heightOf(track)
            const removable = tracks.filter((other) => other.kind === track.kind).length > 1
            const laneGaps: Gap[] = []
            if (hoverGap?.trackId === track.id) laneGaps.push(hoverGap)
            if (selectedGap?.trackId === track.id && !sameGap(selectedGap, hoverGap)) laneGaps.push(selectedGap)
            return (
              <div key={track.id} className="flex" style={{ height }}>
                <div
                  className="sticky left-0 z-30 shrink-0 border-r border-line bg-surface-1"
                  style={{ width: HEADER_WIDTH }}
                >
                  <TrackHeader
                    track={track}
                    badge={badges.get(track.id) ?? ''}
                    height={height}
                    size={trackSizes[track.id] ?? 'medium'}
                    removable={removable}
                  />
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
                  onPointerDown={(event) => onLanePointerDown(event, track)}
                  onPointerMove={(event) => onLanePointerMove(event, track)}
                  onPointerLeave={() => {
                    setHoverGap(null)
                    setHover(null)
                  }}
                  onContextMenu={(event) => onLaneContextMenu(event, track)}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes(TRANSITION_DRAG_TYPE)) {
                      const cut = timeline ? dropJunction(project, timeline, track.id, frameAtClientX(event.clientX), pixelsPerFrame) : null
                      if (!cut) {
                        if (dropCut) setDropCut(null)
                        return
                      }
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'copy'
                      if (dropCut?.trackId !== track.id || dropCut.cutFrame !== cut.cutFrame) setDropCut({ trackId: track.id, cutFrame: cut.cutFrame })
                      return
                    }
                    if (event.dataTransfer.types.includes(EFFECT_DRAG_TYPE)) {
                      // A video effect lands on the clip under the pointer; over a gap it is not a drop.
                      if (!timeline || !effectDropTarget(project, timeline, track.id, frameAtClientX(event.clientX))) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'copy'
                      return
                    }
                    if (!event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'copy'
                  }}
                  onDragLeave={() => {
                    if (dropCut?.trackId === track.id) setDropCut(null)
                  }}
                  onDrop={(event) => {
                    const transition = decodeTransitionDrag(event.dataTransfer.getData(TRANSITION_DRAG_TYPE))
                    if (transition) {
                      event.preventDefault()
                      setDropCut(null)
                      if (transition.trackKind !== track.kind) {
                        useEditor.getState().notify(`${transition.label} is ${transition.trackKind === 'video' ? 'a picture transition' : 'an audio transition'}; drop it on a cut on ${transition.trackKind === 'video' ? 'a video' : 'an audio'} track.`)
                        return
                      }
                      const cut = timeline ? dropJunction(project, timeline, track.id, frameAtClientX(event.clientX), pixelsPerFrame) : null
                      if (cut) applyTransitionAt(cut, transition.kind, transition.label)
                      return
                    }
                    const effect = decodeEffectDrag(event.dataTransfer.getData(EFFECT_DRAG_TYPE))
                    if (effect) {
                      event.preventDefault()
                      const target = timeline ? effectDropTarget(project, timeline, track.id, frameAtClientX(event.clientX)) : null
                      if (!target) return
                      if (!target.ok) {
                        useEditor.getState().notify(target.reason)
                        return
                      }
                      // Selected, so the inspector shows the clip the effect went to.
                      useEditor.getState().select([target.item.id])
                      addEffectTo([target.item], effect.kind, effect.label)
                      return
                    }
                    const assetId = event.dataTransfer.getData(ASSET_DRAG_TYPE)
                    if (!assetId) return
                    event.preventDefault()
                    useEditor
                      .getState()
                      .placeAsset(assetId, Math.round(frameAtClientX(event.clientX)), track.id)
                  }}
                  className={cn(
                    'group/lane relative border-b border-line',
                    track.kind === 'video' ? 'bg-surface-1' : 'bg-surface-0/40',
                    track.locked && 'opacity-60'
                  )}
                  style={{
                    width: contentWidth,
                    height,
                    // Locked reads as locked before anything is clicked: a hatch across the lane.
                    backgroundImage: track.locked
                      ? 'repeating-linear-gradient(135deg, var(--color-line-strong) 0 1px, transparent 1px 7px)'
                      : undefined
                  }}
                >
                  {/* The gap under the pointer, and the selected one. Pointer-transparent, so a
                      press still lands on the lane and can start a rubber band. */}
                  {dropCut?.trackId === track.id && (
                    // Where the dragged transition will land: the cut, lit.
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 z-30 w-1 -translate-x-1/2 rounded-full bg-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_35%,transparent)]"
                      style={{ left: dropCut.cutFrame * pixelsPerFrame }}
                    />
                  )}
                  {laneGaps.map((gap) => {
                    const selectedHere = sameGap(gap, selectedGap)
                    const width = Math.max(2, (gap.to - gap.from) * pixelsPerFrame)
                    return (
                      <div
                        key={`${gap.from}-${selectedHere ? 's' : 'h'}`}
                        aria-hidden="true"
                        className={cn(
                          'pointer-events-none absolute inset-y-1 rounded-xs border',
                          selectedHere ? 'border-accent bg-accent/15' : 'border-line-strong bg-surface-3/50'
                        )}
                        style={{ left: gap.from * pixelsPerFrame, width }}
                      >
                        {selectedHere && width >= 120 && (
                          <span className="absolute inset-x-1 top-1/2 -translate-y-1/2 truncate text-center text-[10px] text-ink-1 tabular-nums">
                            Gap {gap.to - gap.from}f — Delete closes it
                          </span>
                        )}
                      </div>
                    )
                  })}
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
                        hidden={track.kind === 'video' && track.hidden}
                        trackKind={track.kind}
                        // A ripple head keeps the clip's start: the frames come off (or go on) at
                        // the head of the footage, and the clip's end moves instead.
                        previewFrom={trimming && !(trim.ripple && trim.edge === 'start') ? trim.from : item.from}
                        previewDuration={trimming ? trim.durationInFrames : item.durationInFrames}
                        dragging={(movingIds?.has(item.id) ?? false) || trimMode?.itemId === item.id}
                        blade={tool === 'blade'}
                        trimTool={tool === 'trim'}
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
                      onOpen={openJunctionAt}
                    />
                  )}
                </div>
              </div>
            )
          })}

          {/* Pinned to the bottom of the scroller while the lanes overflow it: at the default
              Edit layout three tracks already fill the panel, and the row sat half under its
              bottom edge ("+ Video + Audio" cut off), reachable only by scrolling. Scrolled to
              the end it rests after the last lane as before. Only the header cell is opaque;
              the lane side lets the last lane show and takes no pointer. */}
          <div className="pointer-events-none sticky bottom-0 z-[36] flex">
            <div
              className="pointer-events-auto sticky left-0 z-30 flex shrink-0 items-center gap-1 border-t border-r border-b border-line bg-surface-1 px-2 py-1.5"
              style={{ width: HEADER_WIDTH }}
            >
              {/* Words, not two bare glyphs: a camera and a note read as media, not as tracks. */}
              <ToolButton
                label="Add video track"
                icon={
                  <span className="flex items-center gap-1 text-[11px]">
                    <Plus className="size-3" /> Video
                  </span>
                }
                showLabel={false}
                tooltipSide="top"
                className="h-6 w-auto! flex-1 px-1.5!"
                onClick={() => useEditor.getState().addTrack('video')}
              />
              <ToolButton
                label="Add audio track"
                icon={
                  <span className="flex items-center gap-1 text-[11px]">
                    <Plus className="size-3" /> Audio
                  </span>
                }
                showLabel={false}
                tooltipSide="top"
                className="h-6 w-auto! flex-1 px-1.5!"
                onClick={() => useEditor.getState().addTrack('audio')}
              />
            </div>
            <div style={{ width: contentWidth, height: 30 }} />
          </div>

          {move && timeline && (
            <div className="pointer-events-none absolute inset-0 z-20">
              {allItems(timeline)
                .filter((item) => move.itemIds.includes(item.id))
                .map((item) => {
                  const laneId =
                    move.lanes?.find((planned) => planned.itemId === item.id)?.trackId ??
                    (item.id === move.itemIds[0] ? move.targetTrackId : item.trackId)
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
                        height: (lane ? heightOf(lane) : trackHeightFor('video')) - 8
                      }}
                    />
                  )
                })}
            </div>
          )}

          {/* The blade's cut: on the clip under the pointer, or down every lane with ⇧ — where a
              click would cut, snapped as the click will be. */}
          {tool === 'blade' && hover?.frame != null && (() => {
            const lane = tracks.find((candidate) => candidate.id === hover.trackId)
            const laneTop = laneTops.get(hover.trackId)
            if (!lane || laneTop === undefined) return null
            const top = mods.shift ? RULER_HEIGHT : laneTop + 2
            const height = mods.shift ? cursor - RULER_HEIGHT : heightOf(lane) - 4
            return (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute z-[41] w-px bg-accent"
                style={{ left: HEADER_WIDTH + hover.frame * pixelsPerFrame, top, height }}
              />
            )
          })()}

          {marquee && (marquee.x !== marquee.originX || marquee.y !== marquee.originY) && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute z-[45] rounded-xs border border-accent bg-accent/10"
              style={(() => {
                const band = boxFrom(marquee.originX, marquee.originY, marquee.x, marquee.y)
                return { left: band.left, top: band.top, width: band.right - band.left, height: band.bottom - band.top }
              })()}
            />
          )}

          {/* Red, as in Resolve, 2px, with a dark outline: the white 1px line vanished over a light
              clip. `danger` is the theme's red; the line is centred on the frame's left edge. */}
          <div
            ref={playheadRef}
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 z-40 -ml-px w-0.5 bg-danger shadow-[0_0_0_1px_rgb(0_0_0/0.5)]"
            style={{ top: MARKER_STRIP }}
          >
            <div className="absolute -top-px left-1/2 h-2.5 w-[13px] -translate-x-1/2 bg-danger [clip-path:polygon(0_0,100%_0,100%_55%,50%_100%,0_55%)] drop-shadow-[0_0_1px_rgb(0_0_0/0.8)]" />
          </div>
        </div>
      </div>

      {/* What the drag will do, in the units the result will be reported in. The range is
          shown because the drag stops at it, and a drag that stops for no visible reason reads
          as the editor sticking. */}
      {trimMode && (
        <div className="pointer-events-none absolute top-[3px] left-1/2 z-50 -translate-x-1/2 rounded-sm border border-line bg-surface-2 px-2 py-1 text-[11px] text-ink-0 tabular-nums shadow-pop">
          {trimMode.mode === 'slip' ? 'Slip' : trimMode.mode === 'slide' ? 'Slide' : 'Roll'}{' '}
          {trimMode.deltaFrames > 0 ? '+' : ''}
          {trimMode.deltaFrames} frames
          <span className="ml-2 text-ink-2">
            {Number.isFinite(trimMode.range.min) ? trimMode.range.min : '−∞'} to{' '}
            {Number.isFinite(trimMode.range.max) ? `+${trimMode.range.max}` : '+∞'}
          </span>
        </div>
      )}

      {/* The same readout for a move or a trim: how far, and where it lands, in timecode. */}
      {((move && (move.deltaFrames || move.lanes || move.blocked)) || trim) && timeline ? (
        <div className="pointer-events-none absolute top-[3px] left-1/2 z-50 max-w-[50%] -translate-x-1/2 rounded-sm border border-line bg-surface-2 px-2 py-1 text-[11px] text-ink-0 tabular-nums shadow-pop">
          {move ? (
            <>
              Move {formatDelta(move.deltaFrames)}
              <span className="ml-2 text-ink-2">
                starts {formatTimecode(Math.max(0, move.anchorFrom + move.deltaFrames), fps, true)}
                {move.lanes && (() => {
                  const target = tracks.find((track) => track.id === move.targetTrackId)
                  return target ? ` · to ${target.name}` : ''
                })()}
              </span>
              {move.blocked && <span className="mt-0.5 block text-pretty text-ink-1">Stays on its tracks: {move.blocked}</span>}
            </>
          ) : trim ? (
            (() => {
              const original = allItems(timeline).find((item) => item.id === trim.itemId)
              const delta = original ? trim.durationInFrames - original.durationInFrames : 0
              return (
                <>
                  {trim.ripple ? 'Ripple trim' : 'Trim'} {trim.edge === 'start' ? 'start' : 'end'}{' '}
                  {formatDelta(trim.edge === 'start' ? -delta : delta)}
                  <span className="ml-2 text-ink-2">duration {formatTimecode(trim.durationInFrames, fps, true)}</span>
                </>
              )
            })()
          ) : null}
        </div>
      ) : null}

      {/* Before any drag: what the tool in hand, an armed trim, or ⌥ over a clip will do. The
          gestures have no other visible affordance, so this is where they are learned. */}
      {!move && !trim && !trimMode && !marquee && (() => {
        const hint =
          tool === 'trim'
            ? (() => {
                const mode = TRIM_TOOL_MODES.find((option) => option.mode === trimToolMode)
                return mode ? `Trim tool, ${mode.label}: ${mode.detail}. A or Escape for Select.` : null
              })()
            : pointerHint(tool, armed, mods, hover, fps)
        return hint ? (
          <div
            className="pointer-events-none absolute top-[3px] left-1/2 z-50 max-w-[50%] -translate-x-1/2 truncate rounded-sm border border-line bg-surface-2 px-2 py-1 text-[11px] text-ink-0 tabular-nums shadow-pop"
          >
            {hint}
          </div>
        ) : null
      })()}

      {/* Centred on the *lanes*, not on the panel — otherwise it lands over the add-track
          row and reads as a label for it. `cursor` is where the last lane ends. */}
      {nothingPlaced && (
        <div
          className="pointer-events-none absolute right-0 left-0 flex items-center justify-center"
          style={{ top: RULER_HEIGHT + TOOLBAR_HEIGHT, height: Math.max(0, cursor - RULER_HEIGHT), left: HEADER_WIDTH }}
        >
          {/* The drop is taken by the lane underneath (pointer-transparent here); the button is
              the one live part, for someone who has no media yet. */}
          <div className="flex items-center gap-2 rounded-md border border-dashed border-line-strong bg-surface-1/90 px-3 py-2 text-[11px] text-ink-2">
            <span>
              Drag media here or press <Kbd shortcut={shortcutOf('file.import') ?? 'Mod+I'} /> to import
            </span>
            <Button size="sm" variant="subtle" className="pointer-events-auto" onClick={() => runCommand('file.import')}>
              Import media…
            </Button>
          </div>
        </div>
      )}

      <ContextMenu
        // A page is a fresh menu, so it takes focus and is placed as one.
        key={menu?.page ?? 'main'}
        // `menu` itself, not a fresh `{ x, y }`: the timeline re-renders every frame while playing.
        at={menuItem ? menu : null}
        onClose={() => setMenu(null)}
        label={menu?.page === 'main' || !menu ? 'Clip' : `Clip ${CLIP_MENU_PAGE_NAME[menu.page]}`}
        // 15 rows on the main page: the default 24rem cap would scroll the last two.
        className="max-h-[min(30rem,calc(100vh-16px))]"
        items={menuPageEntries()}
      />

      <ContextMenu at={laneMenuTrack ? laneMenu : null} onClose={() => setLaneMenu(null)} label="Timeline" items={laneMenuItems} />

      <ClipDialogs />

      <TransitionDialog
        junction={openJunction}
        fps={fps}
        onClose={() => setJunctionKey(null)}
      />
    </div>
  )
}
