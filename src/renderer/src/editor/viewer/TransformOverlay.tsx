/**
 * On-canvas transform: select a clip by clicking it in the preview, drag it to move, drag a
 * handle to resize, drag the knob above it to rotate.
 *
 * All DOM over the canvas — nothing here ever draws into the compositor's canvas, so
 * `preview_frame` and export cannot see a handle. The geometry is `./geometry` (the
 * compositor's own transform, inverted), so the outline sits on what is drawn and a click lands
 * on the clip that is visible there.
 *
 * One drag is one undo step: `beginGesture` opens a group on the first real movement, every
 * pointer move lands live through the same store actions the inspector uses, and pointerup,
 * cancel or lost capture close it. A property that is animated gets a key at the playhead
 * instead of its static value, the inspector's rule (`keyed` there).
 */

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { findAsset, findItem, normaliseCrop, type Item, type KeyframeProperty, type Layout } from '@shared/project'
import { animatedItemAt } from '@shared/keyframes'
import { itemsToDraw } from '@/engine/compositor'
import { requestTextFocus, useViewer } from '@/lib/viewer'
import { selectTimeline, useEditor } from '@/store/editor'
import {
  boundsOf,
  contains,
  corners,
  CROP_INSETS,
  cropDragResult,
  dragResult,
  HANDLES,
  handlePoint,
  itemFrame,
  resizeCursor,
  snapTargets,
  topmostAt,
  type CropDragStart,
  type DragStart,
  type Frame,
  type Handle,
  type Point
} from './geometry'

/** Handle size and grab slop, CSS px. The visible square is small; the target is not. */
const HANDLE_PX = 7
const HANDLE_HIT_PX = 7
const ROTATE_OFFSET_PX = 22
/** Snap distance, CSS px — converted to canvas units by the current scale. */
const SNAP_PX = 6
/** How far the pointer must travel before a press becomes a drag, CSS px. */
const DRAG_SLOP_PX = 3

interface Entry {
  item: Item
  frame: Frame | null
  locked: boolean
}

/** The clips drawn at `frame`, in draw order, as drawn (keyframes resolved). */
function drawnEntries(frame: number): Entry[] {
  const state = useEditor.getState()
  const timeline = selectTimeline(state)
  if (!timeline) return []
  return itemsToDraw(state.project, timeline, frame).items.map((stored) => {
    const item = animatedItemAt(stored, frame)
    const track = findItem(timeline, stored.id)?.track
    return { item: stored, frame: itemFrame(item.layout, item.crop), locked: Boolean(track?.locked) }
  })
}

/**
 * Writes a layout patch to one item the way the inspector does: an animated property keys the
 * playhead, a static one is written as stored. Returns false when a keyed property cannot be
 * written because the playhead is off the clip.
 */
function applyPatch(itemId: string, patch: Partial<Layout>): boolean {
  const state = useEditor.getState()
  const timeline = selectTimeline(state)
  const found = timeline ? findItem(timeline, itemId) : undefined
  if (!found) return false
  const item = found.item
  const local = state.playhead - item.from
  const rest: Partial<Layout> = {}
  for (const [key, value] of Object.entries(patch) as [KeyframeProperty & keyof Layout, number][]) {
    if (item.keyframes?.[key]?.length) {
      if (local < 0 || local > item.durationInFrames) return false
      state.setKeyframe(itemId, key, local, value)
    } else {
      rest[key] = value
    }
  }
  if (Object.keys(rest).length > 0) state.patchLayout(itemId, rest)
  return true
}

/** A hit, with the entries it was judged against so the press acts on the same picture. */
type Hit =
  | ((
      | { kind: 'handle'; handle: Handle }
      | { kind: 'rotate' }
      | { kind: 'crop'; handle: Handle }
      | { kind: 'item' }
    ) & { entry: Entry; live: Entry[]; selected: Entry[] })
  | null

interface Drag {
  start: DragStart
  itemIds: string[]
  /** Every selected clip's layout at the start, for moving several together. */
  starts: Map<string, Layout>
  began: boolean
  /** Set when the drag is a crop handle (crop mode): the insets move, the layout does not. */
  crop?: CropDragStart
  screenStart: Point
  pointerId: number
}

export function TransformOverlay({
  scale,
  canvas
}: {
  /** CSS px per canvas unit. */
  scale: number
  canvas: { width: number; height: number }
}): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null)
  const selection = useEditor((state) => state.selection)
  const project = useEditor((state) => state.project)
  // The playhead only matters to the overlay through what it changes on screen: which selected
  // clips are present, and — for an animated one — where it is. So subscribe to exactly that,
  // not to the playhead, or a playing timeline re-renders this 30 times a second for nothing.
  const frameKey = useEditor((state) => {
    const timeline = selectTimeline(state)
    if (!timeline || state.selection.length === 0) return ''
    let key = ''
    for (const id of state.selection) {
      const item = findItem(timeline, id)?.item
      if (!item) continue
      if (item.keyframes) return `k${state.playhead}`
      if (state.playhead >= item.from && state.playhead < item.from + item.durationInFrames) key += `${id},`
    }
    return key
  })
  const drag = useRef<Drag | null>(null)
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null })
  const [cursor, setCursor] = useState<string>('default')
  const pending = useRef<{ point: Point; mods: { shift: boolean; alt: boolean; suspendSnap: boolean } } | null>(null)
  const raf = useRef<number | null>(null)
  const warned = useRef(false)

  // `project` and `frameKey` are subscribed only to re-render at the right moments; the entries
  // are then read fresh from the store (`drawnEntries`), so they are never a stale snapshot.
  void frameKey
  void project
  const selected = drawnEntries(useEditor.getState().playhead).filter((entry) => selection.includes(entry.item.id) && entry.frame)
  const single = selected.length === 1 ? selected[0] : undefined
  const cropMode = useViewer((state) => state.cropMode)
  // In crop mode, the whole uncropped box, dashed: what dragging an edge back out would reveal.
  const cropBox =
    cropMode && single && !single.locked ? itemFrame(animatedItemAt(single.item, useEditor.getState().playhead).layout) : null

  // Escape leaves crop mode (the app's own Escape only closes its dialogs). Not while a modal is
  // open — Escape there is the modal's.
  useEffect(() => {
    if (!cropMode) return
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || document.querySelector('[aria-modal="true"]')) return
      useViewer.getState().setCropMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cropMode])

  const toCanvas = (event: { clientX: number; clientY: number }): Point => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect || scale <= 0) return { x: 0, y: 0 }
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale }
  }

  /**
   * What is under a canvas point: a handle of the single selected clip, its rotate knob, or a
   * clip. Read from the store at the moment of asking — the playhead may have moved since the
   * last render, which only re-renders when the *selection's* picture changes.
   */
  const hit = (p: Point): Hit => {
    const live = drawnEntries(useEditor.getState().playhead)
    const liveSelected = live.filter((entry) => useEditor.getState().selection.includes(entry.item.id) && entry.frame)
    const one = liveSelected.length === 1 ? liveSelected[0] : undefined
    if (one?.frame && !one.locked && useViewer.getState().cropMode) {
      // Crop mode: the handles on what is drawn move the crop, and there is no rotate knob.
      const slop = HANDLE_HIT_PX / scale
      for (const { handle } of HANDLES) {
        if (dist(p, handlePoint(one.frame, handle)) <= slop) return { kind: 'crop', handle, entry: one, live, selected: liveSelected }
      }
    } else if (one?.frame && !one.locked) {
      const slop = HANDLE_HIT_PX / scale
      if (dist(p, rotateKnob(one.frame, scale)) <= slop) return { kind: 'rotate', entry: one, live, selected: liveSelected }
      for (const { handle } of HANDLES) {
        if (dist(p, handlePoint(one.frame, handle)) <= slop) return { kind: 'handle', handle, entry: one, live, selected: liveSelected }
      }
    }
    // A selected clip keeps the pointer even under another: you grabbed what you selected.
    const entry = liveSelected.find((e) => e.frame && contains(e.frame, p)) ?? topmostAt(live, p)
    return entry ? { kind: 'item', entry, live, selected: liveSelected } : null
  }

  const flush = (): void => {
    raf.current = null
    const current = drag.current
    const next = pending.current
    if (!current || !next) return
    const state = useEditor.getState()
    if (!current.began) {
      current.began = true
      state.beginGesture()
    }
    if (current.crop) {
      // The same `setCrop` the inspector's Crop fields write, one inset at a time, only where
      // it changed — all inside the gesture, so the drag is one undo step.
      const id = current.itemIds[0]!
      const timeline = selectTimeline(state)
      const now = normaliseCrop(timeline ? findItem(timeline, id)?.item.crop : undefined)
      const crop = cropDragResult(current.crop, next.point, { symmetric: next.mods.shift })
      for (const edge of CROP_INSETS) if (crop[edge] !== now[edge]) state.setCrop(id, edge, crop[edge])
      return
    }
    const result = dragResult(current.start, next.point, next.mods, SNAP_PX / scale)
    let ok = true
    if (current.start.mode.kind === 'move' && current.itemIds.length > 1) {
      // Several clips move by the grabbed one's delta, each from where it started.
      const dx = (result.patch.left ?? current.start.layout.left) - current.start.layout.left
      const dy = (result.patch.top ?? current.start.layout.top) - current.start.layout.top
      for (const id of current.itemIds) {
        const from = current.starts.get(id)
        if (from) ok = applyPatch(id, { left: from.left + dx, top: from.top + dy }) && ok
      }
    } else {
      ok = applyPatch(current.itemIds[0]!, result.patch)
    }
    if (!ok && !warned.current) {
      warned.current = true
      state.notify('Move the playhead over the clip to change its animated position or size: its keys set it everywhere.')
    }
    setGuides({ x: result.guideX, y: result.guideY })
  }

  const end = (): void => {
    if (raf.current !== null) {
      cancelAnimationFrame(raf.current)
      // The last position the pointer reached must land, even if its frame had not come yet.
      flush()
    }
    const current = drag.current
    drag.current = null
    pending.current = null
    setGuides({ x: null, y: null })
    if (current?.began) useEditor.getState().endGesture()
  }

  // A drag left open by an unmount would leave history grouping every later edit into one.
  useEffect(() => () => {
    if (drag.current?.began) useEditor.getState().endGesture()
    drag.current = null
  }, [])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    rootRef.current?.focus({ preventScroll: true })
    const p = toCanvas(event)
    const target = hit(p)
    const state = useEditor.getState()
    if (!target) {
      if (!event.shiftKey && !event.metaKey) state.clearSelection()
      return
    }
    const entry = target.entry
    let mode: DragStart['mode']
    if (target.kind === 'item') {
      mode = { kind: 'move' }
      const id = entry.item.id
      if (event.shiftKey || event.metaKey) {
        state.select([id], true)
        return
      }
      // Grabbing one of several selected clips moves them all; grabbing another selects it.
      if (!state.selection.includes(id)) state.select([id])
    } else {
      mode = target.kind === 'rotate' ? { kind: 'rotate' } : { kind: 'resize', handle: target.handle }
    }
    if (entry.locked) {
      state.notify('This clip’s track is locked. Unlock it in the track header to move it.')
      return
    }
    const timeline = selectTimeline(state)
    if (!timeline) return
    const grabbedSelected = target.selected.some((e) => e.item.id === entry.item.id)
    const moving = mode.kind === 'move' && grabbedSelected ? target.selected.map((e) => e.item.id) : [entry.item.id]
    const starts = new Map<string, Layout>()
    for (const id of moving) {
      const found = findItem(timeline, id)
      if (found && !found.track.locked) starts.set(id, animatedItemAt(found.item, state.playhead).layout)
    }
    const drawn = animatedItemAt(entry.item, state.playhead)
    const others = target.live
      .filter((e) => e.frame && !starts.has(e.item.id))
      .map((e) => boundsOf(e.frame!))
    drag.current = {
      start: { mode, layout: drawn.layout, crop: drawn.crop, pointer: p, targets: snapTargets(canvas, others) },
      itemIds: [...starts.keys()],
      starts,
      began: false,
      ...(target.kind === 'crop'
        ? { crop: { layout: drawn.layout, crop: normaliseCrop(drawn.crop), handle: target.handle, pointer: p } }
        : {}),
      screenStart: { x: event.clientX, y: event.clientY },
      pointerId: event.pointerId
    }
    warned.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (!current) {
      setCursor(cursorFor(hit(toCanvas(event))))
      return
    }
    if (!current.began && Math.hypot(event.clientX - current.screenStart.x, event.clientY - current.screenStart.y) < DRAG_SLOP_PX) {
      return
    }
    pending.current = {
      point: toCanvas(event),
      mods: { shift: event.shiftKey, alt: event.altKey, suspendSnap: event.metaKey || event.ctrlKey }
    }
    if (!current.began) {
      flush()
      return
    }
    if (raf.current === null) raf.current = requestAnimationFrame(flush)
  }

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = hit(toCanvas(event))
    if (target?.kind !== 'item') return
    const asset = findAsset(useEditor.getState().project, target.entry.item.assetId)
    if (asset?.kind === 'text') requestTextFocus(target.entry.item.id)
  }

  /** Arrows nudge the selection a pixel (⇧ ten) — only while the preview has focus. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 10 : 1
    const delta: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step }
    }
    const d = delta[event.key]
    if (!d || event.metaKey || event.ctrlKey || event.altKey) return
    const movable = drawnEntries(useEditor.getState().playhead).filter(
      (entry) => entry.frame && !entry.locked && useEditor.getState().selection.includes(entry.item.id)
    )
    // Nothing to nudge: let the key through, so arrows still step frames.
    if (movable.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    const state = useEditor.getState()
    let ok = true
    state.transact(() => {
      for (const entry of movable) {
        const layout = animatedItemAt(entry.item, state.playhead).layout
        ok = applyPatch(entry.item.id, { left: layout.left + d.x, top: layout.top + d.y }) && ok
      }
    })
    if (!ok) state.notify('Move the playhead over the clip to nudge its animated position.')
  }

  const toView = (p: Point): string => `${p.x * scale},${p.y * scale}`
  const guideLine = guides.x !== null || guides.y !== null

  return (
    <div
      ref={rootRef}
      role="application"
      aria-label="Preview canvas. Click a clip to select it, drag to move it, arrow keys nudge the selection."
      tabIndex={0}
      className="absolute inset-0 touch-none outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible">
        {guideLine && guides.x !== null && (
          <line x1={guides.x * scale} y1={0} x2={guides.x * scale} y2={canvas.height * scale} className="stroke-accent" strokeWidth={1} />
        )}
        {guideLine && guides.y !== null && (
          <line x1={0} y1={guides.y * scale} x2={canvas.width * scale} y2={guides.y * scale} className="stroke-accent" strokeWidth={1} />
        )}
        {selected.map((entry) => (
          <polygon
            key={entry.item.id}
            points={corners(entry.frame!).map(toView).join(' ')}
            className={entry.locked ? 'fill-none stroke-ink-2' : 'fill-none stroke-accent'}
            strokeWidth={1}
            strokeDasharray={entry.locked ? '4 3' : undefined}
          />
        ))}
        {cropBox && single?.frame && (
          <>
            <polygon
              points={corners(cropBox).map(toView).join(' ')}
              className="fill-none stroke-ink-2"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            {HANDLES.map(({ handle, x, y }) => {
              const at = handlePoint(single.frame!, handle)
              // Crop handles are bars along the edge (L-shapes at the corners), the mark every
              // editor uses for crop, so they read differently from the resize squares.
              const long = HANDLE_PX * 1.6
              const w = x === 0 ? long : 3
              const h = y === 0 ? long : 3
              const angle = (single.frame!.angle * 180) / Math.PI
              return x !== 0 && y !== 0 ? (
                <g key={handle} transform={`rotate(${angle} ${at.x * scale} ${at.y * scale})`} className="fill-accent">
                  <rect x={at.x * scale - (x > 0 ? long - 1.5 : 1.5)} y={at.y * scale - 1.5} width={long} height={3} />
                  <rect x={at.x * scale - 1.5} y={at.y * scale - (y > 0 ? long - 1.5 : 1.5)} width={3} height={long} />
                </g>
              ) : (
                <rect
                  key={handle}
                  x={at.x * scale - w / 2}
                  y={at.y * scale - h / 2}
                  width={w}
                  height={h}
                  transform={`rotate(${angle} ${at.x * scale} ${at.y * scale})`}
                  className="fill-accent"
                />
              )
            })}
          </>
        )}
        {single?.frame && !single.locked && !cropMode && (
          <>
            <line
              x1={handlePoint(single.frame, 'n').x * scale}
              y1={handlePoint(single.frame, 'n').y * scale}
              x2={rotateKnob(single.frame, scale).x * scale}
              y2={rotateKnob(single.frame, scale).y * scale}
              className="stroke-accent"
              strokeWidth={1}
            />
            <circle
              cx={rotateKnob(single.frame, scale).x * scale}
              cy={rotateKnob(single.frame, scale).y * scale}
              r={HANDLE_PX / 2 + 0.5}
              className="fill-surface-0 stroke-accent"
              strokeWidth={1}
            />
            {HANDLES.map(({ handle }) => {
              const at = handlePoint(single.frame!, handle)
              return (
                <rect
                  key={handle}
                  x={at.x * scale - HANDLE_PX / 2}
                  y={at.y * scale - HANDLE_PX / 2}
                  width={HANDLE_PX}
                  height={HANDLE_PX}
                  transform={`rotate(${(single.frame!.angle * 180) / Math.PI} ${at.x * scale} ${at.y * scale})`}
                  className="fill-surface-0 stroke-accent"
                  strokeWidth={1}
                />
              )
            })}
          </>
        )}
      </svg>
    </div>
  )
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** The rotate knob: a fixed screen distance beyond the top edge, along the clip's own up. */
function rotateKnob(frame: Frame, scale: number): Point {
  const offset = ROTATE_OFFSET_PX / Math.max(scale, 1e-6)
  const top = handlePoint(frame, 'n')
  return { x: top.x + Math.sin(frame.angle) * offset, y: top.y - Math.cos(frame.angle) * offset }
}

function cursorFor(target: Hit): string {
  if (!target) return 'default'
  if (target.kind === 'rotate') return 'grab'
  if (target.kind === 'handle' || target.kind === 'crop') return resizeCursor(target.handle, target.entry.frame?.angle ?? 0)
  return target.entry.locked ? 'not-allowed' : 'move'
}
