/**
 * Mask handles on the viewer: with a mask chosen in the inspector's Masks section, drag inside it
 * to move it, a square to resize, the knob above to rotate, the round handle to its right to
 * feather, and — on a path — its points.
 *
 * It sits above `TransformOverlay` and takes the pointer while a mask is being edited (as crop
 * mode does for the crop), so a drag meant for the mask can never move the clip. Like every
 * overlay it is DOM over the canvas: `preview_frame` and export cannot see a handle.
 *
 * The geometry is `./maskGeometry`; the write is the store's `setShapeMasks`, the inspector's own
 * action. One drag is one undo step (`beginGesture`/`endGesture`), applied live.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { defaultLayout, findAsset, findItem, itemEnd, type Item } from '@shared/project'
import { isAdjustmentAsset } from '@shared/adjustment-layer'
import { animatedItemAt } from '@shared/keyframes'
import { cutoutPartner } from '@shared/behind-subject'
import { isShapeMask, type PathMask, type ShapeMask } from '@shared/shape-mask'
import { useViewer } from '@/lib/viewer'
import { selectTimeline, useEditor } from '@/store/editor'
import { HANDLES, handlePoint, resizeCursor, zoomOfLayout, type Handle, type Point } from './geometry'
import {
  canvasToClip,
  clipToCanvas,
  featherHandle,
  insertPathPoint,
  maskDragResult,
  maskFrame,
  maskOutline,
  pathPointPositions,
  removePathPoint,
  type MaskDragMode,
  type MaskDragStart
} from './maskGeometry'

const HANDLE_PX = 7
const HANDLE_HIT_PX = 8
const ROTATE_OFFSET_PX = 22
const FEATHER_PAD_PX = 16
const DRAG_SLOP_PX = 3

interface Target {
  item: Item
  /** The clip as drawn at the playhead (keyframes resolved). */
  drawn: Item
  locked: boolean
  shapes: ShapeMask[]
  index: number
  mask: ShapeMask
}

/** The mask being edited, read fresh from the stores; null when there is none to show. */
function currentTarget(): Target | null {
  const index = useViewer.getState().maskEdit
  if (index === null) return null
  const state = useEditor.getState()
  const timeline = selectTimeline(state)
  if (!timeline || state.selection.length !== 1) return null
  const found = findItem(timeline, state.selection[0]!)
  if (!found) return null
  // A subject cut-out draws with its clip's picture and masks: the clip is what is edited.
  const item = cutoutPartner(timeline, found.item) ?? found.item
  const track = findItem(timeline, item.id)?.track
  if (!track || track.hidden || item.disabled) return null
  if (state.playhead < item.from || state.playhead >= itemEnd(item)) return null
  const shapes = (item.masks ?? []).filter(isShapeMask)
  const mask = shapes[index]
  if (!mask) return null
  const animated = animatedItemAt(item, state.playhead)
  // An adjustment layer's masks are fractions of the whole frame, whatever its own box says.
  const drawn = isAdjustmentAsset(findAsset(state.project, item.assetId)) ? { ...animated, layout: defaultLayout(timeline) } : animated
  return { item, drawn, locked: track.locked, shapes, index, mask }
}

type Hit = { mode: MaskDragMode; cursor: string } | null

interface Drag {
  start: MaskDragStart
  itemId: string
  index: number
  began: boolean
  screenStart: Point
}

export function MaskOverlay({ scale }: { /** CSS px per canvas unit. */ scale: number }): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null)
  const maskEdit = useViewer((state) => state.maskEdit)
  // Subscribed only to re-render when the picture under the handles can have changed; the target
  // itself is read fresh (`currentTarget`), never from a stale snapshot.
  useEditor((state) => state.project)
  useEditor((state) => state.selection)
  useEditor((state) => (maskEdit === null ? 0 : state.playhead))
  const drag = useRef<Drag | null>(null)
  const pending = useRef<{ point: Point; mods: { shift: boolean; alt: boolean } } | null>(null)
  const raf = useRef<number | null>(null)
  const [cursor, setCursor] = useState('default')
  const [activePoint, setActivePoint] = useState<number | null>(null)

  const target = currentTarget()

  // Escape leaves mask editing — not while a modal is open, whose Escape that is.
  useEffect(() => {
    if (maskEdit === null) return
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || document.querySelector('[aria-modal="true"]')) return
      useViewer.getState().setMaskEdit(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [maskEdit])

  // A drag left open by an unmount would leave history grouping every later edit into one.
  useEffect(() => () => {
    if (drag.current?.began) useEditor.getState().endGesture()
    drag.current = null
  }, [])

  useEffect(() => setActivePoint(null), [maskEdit])

  if (maskEdit === null || !target || scale <= 0) return null

  const size = { width: target.drawn.layout.width, height: target.drawn.layout.height }
  const zoom = Math.max(1e-6, zoomOfLayout(target.drawn.layout))
  /** Clip pixels per CSS pixel: how big a screen distance is where the mask is measured. */
  const perPx = 1 / (scale * zoom)

  const toClip = (event: { clientX: number; clientY: number }, of: Target): Point | null => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return null
    return canvasToClip(of.drawn.layout, { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale })
  }

  const rotateKnob = (mask: ShapeMask): Point => {
    const frame = maskFrame(mask, size)
    const top = handlePoint(frame, 'n')
    const offset = ROTATE_OFFSET_PX * perPx
    return { x: top.x + Math.sin(frame.angle) * offset, y: top.y - Math.cos(frame.angle) * offset }
  }

  const hit = (p: Point, of: Target): Hit => {
    const slop = HANDLE_HIT_PX * perPx
    const near = (q: Point): boolean => Math.hypot(p.x - q.x, p.y - q.y) <= slop
    const frame = maskFrame(of.mask, size)
    if (of.mask.kind === 'path') {
      const at = pathPointPositions(of.mask, size)
      for (let i = 0; i < at.length; i += 1) if (near(at[i]!)) return { mode: { kind: 'point', index: i }, cursor: 'crosshair' }
    }
    const pad = FEATHER_PAD_PX * perPx
    if (near(featherHandle(of.mask, size, pad))) return { mode: { kind: 'feather', pad }, cursor: 'ew-resize' }
    if (near(rotateKnob(of.mask))) return { mode: { kind: 'rotate' }, cursor: 'grab' }
    for (const { handle } of HANDLES) {
      if (near(handlePoint(frame, handle))) {
        const clipAngle = ((of.drawn.layout.rotation ?? 0) * Math.PI) / 180
        return { mode: { kind: 'resize', handle }, cursor: resizeCursor(handle, frame.angle + clipAngle) }
      }
    }
    const cos = Math.cos(-frame.angle)
    const sin = Math.sin(-frame.angle)
    const lx = (p.x - frame.cx) * cos - (p.y - frame.cy) * sin
    const ly = (p.x - frame.cx) * sin + (p.y - frame.cy) * cos
    if (Math.abs(lx) <= frame.halfW + slop && Math.abs(ly) <= frame.halfH + slop) return { mode: { kind: 'move' }, cursor: 'move' }
    return null
  }

  const write = (itemId: string, index: number, next: ShapeMask): void => {
    const now = currentTarget()
    if (!now || now.item.id !== itemId) return
    const shapes = now.shapes.slice()
    shapes[index] = next
    useEditor.getState().setShapeMasks(itemId, shapes)
  }

  const flush = (): void => {
    raf.current = null
    const current = drag.current
    const next = pending.current
    if (!current || !next) return
    if (!current.began) {
      current.began = true
      useEditor.getState().beginGesture()
    }
    write(current.itemId, current.index, maskDragResult(current.start, next.point, next.mods))
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
    if (current?.began) useEditor.getState().endGesture()
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    rootRef.current?.focus({ preventScroll: true })
    const now = currentTarget()
    const p = now ? toClip(event, now) : null
    if (!now || !p) return
    const found = hit(p, now)
    // Mask editing owns the viewer: a press that misses the mask does nothing, rather than
    // selecting or moving a clip underneath.
    event.preventDefault()
    if (!found) return
    if (now.locked) {
      useEditor.getState().notify('This clip’s track is locked. Unlock it in the track header to change its masks.')
      return
    }
    setActivePoint(found.mode.kind === 'point' ? found.mode.index : null)
    drag.current = {
      start: { mode: found.mode, mask: now.mask, size, pointer: p },
      itemId: now.item.id,
      index: now.index,
      began: false,
      screenStart: { x: event.clientX, y: event.clientY }
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    const now = currentTarget()
    const p = now ? toClip(event, now) : null
    if (!now || !p) return
    if (!current) {
      setCursor(hit(p, now)?.cursor ?? 'default')
      return
    }
    if (!current.began && Math.hypot(event.clientX - current.screenStart.x, event.clientY - current.screenStart.y) < DRAG_SLOP_PX) return
    pending.current = { point: p, mods: { shift: event.shiftKey, alt: event.altKey } }
    if (!current.began) {
      flush()
      return
    }
    if (raf.current === null) raf.current = requestAnimationFrame(flush)
  }

  /** Double-click a path's edge to add a point there; double-click a point to remove it. */
  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const now = currentTarget()
    const p = now ? toClip(event, now) : null
    if (!now || !p || now.locked || now.mask.kind !== 'path') return
    const found = hit(p, now)
    if (found?.mode.kind === 'point') {
      const next = removePathPoint(now.mask, found.mode.index)
      if (next) write(now.item.id, now.index, next)
      else useEditor.getState().notify('A path needs at least three points.')
      setActivePoint(null)
      return
    }
    const inserted = insertPathPoint(now.mask, size, p)
    if (!inserted) return
    write(now.item.id, now.index, inserted.mask)
    setActivePoint(inserted.index)
  }

  /** Arrows nudge the mask (or the chosen path point) a pixel, ⇧ ten; Delete removes the chosen point. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const now = currentTarget()
    if (!now || now.locked || event.metaKey || event.ctrlKey || event.altKey) return
    if ((event.key === 'Delete' || event.key === 'Backspace') && activePoint !== null && now.mask.kind === 'path') {
      event.preventDefault()
      event.stopPropagation()
      const next = removePathPoint(now.mask, activePoint)
      if (next) write(now.item.id, now.index, next)
      else useEditor.getState().notify('A path needs at least three points.')
      setActivePoint(null)
      return
    }
    const step = event.shiftKey ? 10 : 1
    const delta: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step }
    }
    const d = delta[event.key]
    if (!d) return
    event.preventDefault()
    event.stopPropagation()
    const mode: MaskDragMode = activePoint !== null && now.mask.kind === 'path' ? { kind: 'point', index: activePoint } : { kind: 'move' }
    const origin = mode.kind === 'point' ? pathPointPositions(now.mask as PathMask, size)[mode.index]! : { x: 0, y: 0 }
    write(now.item.id, now.index, maskDragResult({ mode, mask: now.mask, size, pointer: origin }, { x: origin.x + d.x, y: origin.y + d.y }))
  }

  const toView = (p: Point): Point => {
    const c = clipToCanvas(target.drawn.layout, p) ?? { x: 0, y: 0 }
    return { x: c.x * scale, y: c.y * scale }
  }
  const points = (list: Point[]): string => list.map(toView).map((p) => `${p.x},${p.y}`).join(' ')
  const frame = maskFrame(target.mask, size)
  const box = (['nw', 'ne', 'se', 'sw'] as Handle[]).map((handle) => handlePoint(frame, handle))
  const angle = ((frame.angle + ((target.drawn.layout.rotation ?? 0) * Math.PI) / 180) * 180) / Math.PI
  const knob = toView(rotateKnob(target.mask))
  const top = toView(handlePoint(frame, 'n'))
  const east = toView(handlePoint(frame, 'e'))
  const feather = toView(featherHandle(target.mask, size, FEATHER_PAD_PX * perPx))

  return (
    <div
      ref={rootRef}
      role="application"
      aria-label={
        `Mask ${target.index + 1} on the viewer. Drag inside it to move it, a square handle to resize, the knob above to rotate, ` +
        'the round handle on its right to feather. Arrow keys nudge it; Escape finishes.'
      }
      tabIndex={0}
      data-mask-overlay=""
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
        {/* The mask's box, dashed; the shape's own edge, solid. Dark under light so it reads on any picture. */}
        <polygon points={points(box)} className="fill-none stroke-ink-2" strokeWidth={1} strokeDasharray="3 3" />
        <polygon points={points(maskOutline(target.mask, size))} className="fill-none stroke-surface-0" strokeWidth={3} strokeOpacity={0.6} />
        <polygon points={points(maskOutline(target.mask, size))} className="fill-none stroke-accent" strokeWidth={1.5} />
        {!target.locked && (
          <>
            <line x1={top.x} y1={top.y} x2={knob.x} y2={knob.y} className="stroke-accent" strokeWidth={1} />
            <circle cx={knob.x} cy={knob.y} r={HANDLE_PX / 2 + 0.5} className="fill-surface-0 stroke-accent" strokeWidth={1} />
            <line x1={east.x} y1={east.y} x2={feather.x} y2={feather.y} className="stroke-accent" strokeWidth={1} strokeDasharray="2 2" />
            <circle cx={feather.x} cy={feather.y} r={HANDLE_PX / 2 + 1} className="fill-accent stroke-surface-0" strokeWidth={1} />
            {HANDLES.map(({ handle }) => {
              const at = toView(handlePoint(frame, handle))
              return (
                <rect
                  key={handle}
                  x={at.x - HANDLE_PX / 2}
                  y={at.y - HANDLE_PX / 2}
                  width={HANDLE_PX}
                  height={HANDLE_PX}
                  transform={`rotate(${angle} ${at.x} ${at.y})`}
                  className="fill-surface-0 stroke-accent"
                  strokeWidth={1}
                />
              )
            })}
            {target.mask.kind === 'path' &&
              pathPointPositions(target.mask, size).map((p, i) => {
                const at = toView(p)
                return (
                  <circle
                    key={i}
                    cx={at.x}
                    cy={at.y}
                    r={HANDLE_PX / 2 + 1}
                    className={i === activePoint ? 'fill-accent stroke-surface-0' : 'fill-surface-0 stroke-accent'}
                    strokeWidth={1.5}
                  />
                )
              })}
          </>
        )}
      </svg>
    </div>
  )
}
