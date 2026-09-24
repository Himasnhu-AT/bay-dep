/**
 * The arithmetic behind the preview's on-canvas transform handles, kept pure so it can be
 * tested without a window.
 *
 * Everything here is in **timeline (canvas) coordinates** — the space `item.layout` is written
 * in and the compositor draws in. The overlay converts the pointer once, at the edge
 * (`viewToCanvas`), and converts back only to draw.
 *
 * The one geometry that matters is the compositor's (`engine/compositor.ts`): the layout box,
 * cropped by `cropDestRect`, then rotated and zoomed about the **box's** centre by
 * `applyRotation`. `itemFrame` is that same transform, so the outline sits on the picture and a
 * click lands on what is drawn there. Handles act on what you see (the cropped, zoomed, rotated
 * rectangle) and `layoutForFrame` inverts the transform back to the box the model stores, so a
 * cropped or pushed-in clip resizes under the pointer rather than by some other amount.
 */

import { normaliseCrop, type Crop, type Layout } from '@shared/project'

export interface Point {
  x: number
  y: number
}

/**
 * The rectangle a clip shows, as drawn: its centre, half-extents along its own axes, and the
 * rotation of those axes (radians, clockwise on screen since y points down).
 */
export interface Frame {
  cx: number
  cy: number
  halfW: number
  halfH: number
  angle: number
}

export interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

const DEG = Math.PI / 180

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** `layout.scale` as the compositor reads it (`zoomOf`): 1 when absent or not usable. */
export function zoomOfLayout(layout: Layout): number {
  const scale = layout.scale
  return scale === undefined || !Number.isFinite(scale) || scale < 0 ? 1 : scale
}

function rotate(v: Point, angle: number): Point {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos }
}

/** The kept part of the box, as an offset of its centre from the box centre and its size. */
function visible(width: number, height: number, crop: Crop | undefined): { ox: number; oy: number; w: number; h: number } {
  const c = normaliseCrop(crop)
  return {
    ox: (width * (c.left - c.right)) / 2,
    oy: (height * (c.top - c.bottom)) / 2,
    w: width * (1 - c.left - c.right),
    h: height * (1 - c.top - c.bottom)
  }
}

/** What the compositor draws for this layout and crop, or null when it draws nothing. */
export function itemFrame(layout: Layout, crop?: Crop): Frame | null {
  const width = finite(layout.width, 0)
  const height = finite(layout.height, 0)
  if (width <= 0 || height <= 0) return null
  const zoom = zoomOfLayout(layout)
  const angle = (finite(layout.rotation, 0) % 360) * DEG
  const v = visible(width, height, crop)
  const boxCx = finite(layout.left, 0) + width / 2
  const boxCy = finite(layout.top, 0) + height / 2
  const offset = rotate({ x: v.ox * zoom, y: v.oy * zoom }, angle)
  return {
    cx: boxCx + offset.x,
    cy: boxCy + offset.y,
    halfW: (v.w * zoom) / 2,
    halfH: (v.h * zoom) / 2,
    angle
  }
}

/**
 * The layout box that draws `frame`, keeping the layout's zoom and the item's crop: the inverse
 * of `itemFrame`. Null when the zoom or the crop leave nothing to size (a zero zoom).
 */
export function layoutForFrame(
  frame: Frame,
  layout: Layout,
  crop?: Crop
): Pick<Layout, 'left' | 'top' | 'width' | 'height'> | null {
  const zoom = zoomOfLayout(layout)
  const c = normaliseCrop(crop)
  const keptW = 1 - c.left - c.right
  const keptH = 1 - c.top - c.bottom
  if (zoom <= 0 || keptW <= 0 || keptH <= 0) return null
  const width = (frame.halfW * 2) / (zoom * keptW)
  const height = (frame.halfH * 2) / (zoom * keptH)
  const v = visible(width, height, crop)
  const offset = rotate({ x: v.ox * zoom, y: v.oy * zoom }, frame.angle)
  const boxCx = frame.cx - offset.x
  const boxCy = frame.cy - offset.y
  return { left: boxCx - width / 2, top: boxCy - height / 2, width, height }
}

/** A canvas point in the frame's own axes, relative to its centre. */
export function toLocal(frame: Frame, p: Point): Point {
  return rotate({ x: p.x - frame.cx, y: p.y - frame.cy }, -frame.angle)
}

/** A point in the frame's own axes back to the canvas. */
export function fromLocal(frame: Frame, p: Point): Point {
  const v = rotate(p, frame.angle)
  return { x: frame.cx + v.x, y: frame.cy + v.y }
}

/** Whether `p` lands on the frame, rotation included. `slop` widens it (canvas units). */
export function contains(frame: Frame, p: Point, slop = 0): boolean {
  const local = toLocal(frame, p)
  return Math.abs(local.x) <= frame.halfW + slop && Math.abs(local.y) <= frame.halfH + slop
}

/** Corners, clockwise from top-left in the frame's own axes. */
export function corners(frame: Frame): [Point, Point, Point, Point] {
  const { halfW: w, halfH: h } = frame
  return [
    fromLocal(frame, { x: -w, y: -h }),
    fromLocal(frame, { x: w, y: -h }),
    fromLocal(frame, { x: w, y: h }),
    fromLocal(frame, { x: -w, y: h })
  ]
}

/** The axis-aligned bounds of what is drawn — what snapping lines up. */
export function boundsOf(frame: Frame): Bounds {
  const pts = corners(frame)
  return {
    left: Math.min(...pts.map((p) => p.x)),
    top: Math.min(...pts.map((p) => p.y)),
    right: Math.max(...pts.map((p) => p.x)),
    bottom: Math.max(...pts.map((p) => p.y))
  }
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** Each handle's direction from the centre, in the frame's axes. */
export const HANDLES: readonly { handle: Handle; x: -1 | 0 | 1; y: -1 | 0 | 1 }[] = [
  { handle: 'nw', x: -1, y: -1 },
  { handle: 'n', x: 0, y: -1 },
  { handle: 'ne', x: 1, y: -1 },
  { handle: 'e', x: 1, y: 0 },
  { handle: 'se', x: 1, y: 1 },
  { handle: 's', x: 0, y: 1 },
  { handle: 'sw', x: -1, y: 1 },
  { handle: 'w', x: -1, y: 0 }
]

export function handleDirection(handle: Handle): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
  return HANDLES.find((h) => h.handle === handle)!
}

export function handlePoint(frame: Frame, handle: Handle): Point {
  const d = handleDirection(handle)
  return fromLocal(frame, { x: d.x * frame.halfW, y: d.y * frame.halfH })
}

export interface ResizeOptions {
  /** Corner handles only: scale both axes by the same factor. */
  keepAspect?: boolean
  /** Resize about the centre instead of the opposite handle. */
  fromCentre?: boolean
  /** The smallest half-extent allowed, in canvas units. */
  minHalf?: number
}

/**
 * `start` resized by dragging `handle` to `target` (a canvas point, grab offset already added).
 * Works in the frame's own axes, so a rotated clip resizes along its own edges and the opposite
 * handle (or the centre, with `fromCentre`) stays exactly where it was.
 */
export function resizeFrame(start: Frame, handle: Handle, target: Point, opts: ResizeOptions = {}): Frame {
  const d = handleDirection(handle)
  const min = opts.minHalf ?? 1
  const p = toLocal(start, target)
  let halfW = start.halfW
  let halfH = start.halfH
  let centre: Point = { x: 0, y: 0 }

  if (opts.fromCentre) {
    if (d.x !== 0) halfW = Math.max(min, p.x * d.x)
    if (d.y !== 0) halfH = Math.max(min, p.y * d.y)
  } else {
    const anchorX = -d.x * start.halfW
    const anchorY = -d.y * start.halfH
    if (d.x !== 0) halfW = Math.max(min, ((p.x - anchorX) * d.x) / 2)
    if (d.y !== 0) halfH = Math.max(min, ((p.y - anchorY) * d.y) / 2)
  }

  if (opts.keepAspect && d.x !== 0 && d.y !== 0 && start.halfW > 0 && start.halfH > 0) {
    // Follow whichever axis the pointer pulled further, so the corner stays under it on one side.
    const s = Math.max(halfW / start.halfW, halfH / start.halfH)
    halfW = Math.max(min, start.halfW * s)
    halfH = Math.max(min, start.halfH * s)
  }

  if (!opts.fromCentre) {
    centre = {
      x: d.x === 0 ? 0 : -d.x * start.halfW + d.x * halfW,
      y: d.y === 0 ? 0 : -d.y * start.halfH + d.y * halfH
    }
  }
  const c = fromLocal(start, centre)
  return { cx: c.x, cy: c.y, halfW, halfH, angle: start.angle }
}

/**
 * The rotation in degrees after dragging the rotate handle from `from` to `to` about `pivot`,
 * starting at `startDegrees`. `snap` rounds to 15°. Normalised to (-180, 180].
 */
export function rotationFor(startDegrees: number, pivot: Point, from: Point, to: Point, snap = false): number {
  const a0 = Math.atan2(from.y - pivot.y, from.x - pivot.x)
  const a1 = Math.atan2(to.y - pivot.y, to.x - pivot.x)
  let degrees = startDegrees + (a1 - a0) / DEG
  if (snap) degrees = Math.round(degrees / 15) * 15
  degrees = ((((degrees + 180) % 360) + 360) % 360) - 180
  if (degrees === -180) degrees = 180
  // Two decimals: a rotation typed as 12.3456789° by a mouse is noise in the inspector.
  return Math.round(degrees * 100) / 100
}

/** Lines something can snap to, in canvas units. */
export interface SnapTargets {
  x: readonly number[]
  y: readonly number[]
}

/** The canvas's edges and centre lines, plus every other clip's edges and centres. */
export function snapTargets(canvas: { width: number; height: number }, others: readonly Bounds[]): SnapTargets {
  const x = [0, canvas.width / 2, canvas.width]
  const y = [0, canvas.height / 2, canvas.height]
  for (const b of others) {
    x.push(b.left, (b.left + b.right) / 2, b.right)
    y.push(b.top, (b.top + b.bottom) / 2, b.bottom)
  }
  return { x, y }
}

export interface SnapResult {
  dx: number
  dy: number
  /** The line snapped to on each axis, for drawing a guide; null when that axis did not snap. */
  guideX: number | null
  guideY: number | null
}

function nearest(lines: readonly number[], targets: readonly number[], threshold: number): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null
  for (const line of lines) {
    for (const target of targets) {
      const delta = target - line
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, at: target }
      }
    }
  }
  return best
}

/**
 * The correction that brings a moved clip's edges or centre onto the nearest target within
 * `threshold` (canvas units), each axis on its own.
 */
export function snapBounds(bounds: Bounds, targets: SnapTargets, threshold: number): SnapResult {
  const xs = [bounds.left, (bounds.left + bounds.right) / 2, bounds.right]
  const ys = [bounds.top, (bounds.top + bounds.bottom) / 2, bounds.bottom]
  const sx = nearest(xs, targets.x, threshold)
  const sy = nearest(ys, targets.y, threshold)
  return { dx: sx?.delta ?? 0, dy: sy?.delta ?? 0, guideX: sx?.at ?? null, guideY: sy?.at ?? null }
}

/** A single point (a dragged handle) snapped to the targets on each axis it moves along. */
export function snapPoint(
  p: Point,
  targets: SnapTargets,
  threshold: number,
  axes: { x: boolean; y: boolean }
): { point: Point; guideX: number | null; guideY: number | null } {
  const sx = axes.x ? nearest([p.x], targets.x, threshold) : null
  const sy = axes.y ? nearest([p.y], targets.y, threshold) : null
  return {
    point: { x: p.x + (sx?.delta ?? 0), y: p.y + (sy?.delta ?? 0) },
    guideX: sx?.at ?? null,
    guideY: sy?.at ?? null
  }
}

/**
 * The topmost entry whose drawn frame contains `p`, or null. `entries` are in draw order —
 * the compositor's `itemsToDraw` order, where later is on top — so this walks them backwards.
 */
export function topmostAt<T extends { frame: Frame | null }>(entries: readonly T[], p: Point, slop = 0): T | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]!
    if (entry.frame && contains(entry.frame, p, slop)) return entry
  }
  return null
}

/** The preview's scale: CSS pixels per canvas unit. */
export function viewToCanvas(p: Point, scale: number): Point {
  return scale > 0 ? { x: p.x / scale, y: p.y / scale } : { x: 0, y: 0 }
}

/** The on-screen size of a viewer zoom choice: `fit` fills the box, a number is CSS px per canvas px. */
export function viewerSize(
  zoom: 'fit' | number,
  canvas: { width: number; height: number },
  box: { width: number; height: number },
  inset = 24
): { width: number; height: number } {
  if (zoom !== 'fit') {
    return { width: Math.round(canvas.width * zoom), height: Math.round(canvas.height * zoom) }
  }
  const aspect = canvas.height > 0 ? canvas.width / canvas.height : 16 / 9
  const available = Math.max(0, box.width - inset)
  const availableHeight = Math.max(0, box.height - inset)
  if (available <= 0 || availableHeight <= 0 || aspect <= 0) return { width: 0, height: 0 }
  const byWidth = available / aspect
  return byWidth <= availableHeight
    ? { width: Math.floor(available), height: Math.floor(byWidth) }
    : { width: Math.floor(availableHeight * aspect), height: Math.floor(availableHeight) }
}

/**
 * The scroll offset that puts `centre` (a fraction of the scrolled content, 0.5 = its middle) in
 * the middle of the viewport, held to what the scroller can reach. A zoomed viewer used to stay at
 * (0, 0), so 200% showed the canvas's top-left corner; zooming now centres, and a resize keeps
 * whatever was in the middle there.
 */
export function scrollForCentre(centre: number, scrollSize: number, clientSize: number): number {
  const max = Math.max(0, scrollSize - clientSize)
  const at = Math.round((Number.isFinite(centre) ? centre : 0.5) * scrollSize - clientSize / 2)
  return Math.min(max, Math.max(0, at))
}

/** Which fraction of the scrolled content sits in the middle of the viewport now. */
export function centreOfScroll(scroll: number, scrollSize: number, clientSize: number): number {
  return scrollSize > 0 ? (scroll + clientSize / 2) / scrollSize : 0.5
}

/** What a drag on the preview is doing. */
export type DragMode = { kind: 'move' } | { kind: 'resize'; handle: Handle } | { kind: 'rotate' }

/** Everything a drag needs from the moment it began; the pointer is the only thing that moves. */
export interface DragStart {
  mode: DragMode
  /** The layout as drawn at the playhead when the drag began (keyed values included). */
  layout: Layout
  crop?: Crop
  /** Where the pointer went down, canvas units. */
  pointer: Point
  /** Canvas lines the drag may snap to (other clips and the frame), already excluding itself. */
  targets: SnapTargets
}

export interface DragModifiers {
  /** ⇧: aspect lock on a corner, 15° steps when rotating, one axis when moving. */
  shift: boolean
  /** ⌥: resize about the centre. */
  alt: boolean
  /** ⌘: no snapping, as on the timeline. */
  suspendSnap: boolean
}

export interface DragResult {
  patch: Partial<Pick<Layout, 'left' | 'top' | 'width' | 'height' | 'rotation'>>
  guideX: number | null
  guideY: number | null
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * The layout fields a drag writes, for the pointer at `pointer`. Only the fields the mode
 * changes are in the patch — a move never rewrites the size — so a keyed property the drag does
 * not touch is never keyed by it. `threshold` is the snap distance in canvas units.
 */
export function dragResult(start: DragStart, pointer: Point, mods: DragModifiers, threshold: number): DragResult {
  const none = { guideX: null, guideY: null }
  const frame = itemFrame(start.layout, start.crop)
  if (!frame) return { patch: {}, ...none }

  if (start.mode.kind === 'rotate') {
    const pivot = { x: start.layout.left + start.layout.width / 2, y: start.layout.top + start.layout.height / 2 }
    return { patch: { rotation: rotationFor(start.layout.rotation, pivot, start.pointer, pointer, mods.shift) }, ...none }
  }

  if (start.mode.kind === 'move') {
    let dx = pointer.x - start.pointer.x
    let dy = pointer.y - start.pointer.y
    if (mods.shift) {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0
      else dx = 0
    }
    let guideX: number | null = null
    let guideY: number | null = null
    if (!mods.suspendSnap) {
      const b = boundsOf(frame)
      const snap = snapBounds({ left: b.left + dx, right: b.right + dx, top: b.top + dy, bottom: b.bottom + dy }, start.targets, threshold)
      // With ⇧ held the constrained axis stays put, whatever it would snap to.
      if (!(mods.shift && dx === 0)) {
        dx += snap.dx
        guideX = snap.guideX
      }
      if (!(mods.shift && dy === 0)) {
        dy += snap.dy
        guideY = snap.guideY
      }
    }
    return { patch: { left: round2(start.layout.left + dx), top: round2(start.layout.top + dy) }, guideX, guideY }
  }

  const handle = start.mode.handle
  // The grab offset: the pointer rarely lands on the handle's exact centre, and the handle must
  // keep that offset rather than jump under the pointer on the first move.
  const grab = handlePoint(frame, handle)
  let target = { x: pointer.x + grab.x - start.pointer.x, y: pointer.y + grab.y - start.pointer.y }
  let guideX: number | null = null
  let guideY: number | null = null
  // Snapping a handle lines its edge up with a line, which only means something while the
  // clip's edges are upright (0°, 90°, 180°, 270°).
  const sin = Math.abs(Math.sin(frame.angle))
  const cos = Math.abs(Math.cos(frame.angle))
  if (!mods.suspendSnap && (sin < 1e-9 || cos < 1e-9)) {
    const d = handleDirection(handle)
    // Turned a quarter, the handle's own x moves along the canvas's y.
    const axis = sin < 1e-9 ? { x: d.x !== 0, y: d.y !== 0 } : { x: d.y !== 0, y: d.x !== 0 }
    const snapped = snapPoint(target, start.targets, threshold, axis)
    target = snapped.point
    guideX = snapped.guideX
    guideY = snapped.guideY
  }
  const next = resizeFrame(frame, handle, target, { keepAspect: mods.shift, fromCentre: mods.alt, minHalf: 1 })
  const box = layoutForFrame(next, start.layout, start.crop)
  if (!box) return { patch: {}, ...none }
  return {
    patch: { left: round2(box.left), top: round2(box.top), width: round2(box.width), height: round2(box.height) },
    guideX,
    guideY
  }
}

/** The resize cursor for a handle on a frame turned by `angle`: the nearest of the four. */
export function resizeCursor(handle: Handle, angle: number): 'ns-resize' | 'nesw-resize' | 'ew-resize' | 'nwse-resize' {
  const d = handleDirection(handle)
  const degrees = (Math.atan2(d.y, d.x) + angle) / DEG
  const octant = ((Math.round(degrees / 45) % 4) + 4) % 4
  return (['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const)[octant]!
}

// ---------------------------------------------------------------------------
// Crop on canvas
// ---------------------------------------------------------------------------

/**
 * The least of each axis a crop leaves, as `normaliseCrop` (`@shared/project`) enforces it. Kept
 * here too because a drag has to stop at it *before* writing: `normaliseCrop` clamps only the
 * right and bottom edges against their opposites, so a left edge dragged past the right one
 * would be written as-is and push the right edge instead of stopping.
 */
const MIN_KEPT = 0.02

export interface CropDragStart {
  /** The layout as drawn when the drag began (its zoom and rotation place the box). */
  layout: Layout
  /** The crop when the drag began, normalised. */
  crop: Crop
  /** The handle grabbed on the *cropped* frame: an edge moves one inset, a corner two. */
  handle: Handle
  /** Where the pointer went down, canvas units. */
  pointer: Point
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000

/**
 * The crop insets after dragging a crop handle from `start.pointer` to `pointer`. The insets are
 * fractions of the *uncropped* box, measured along its own (rotated, zoomed) axes, so an edge
 * follows the pointer at any rotation or push-in. With `symmetric` (⇧) the opposite inset takes
 * the same value, cropping evenly about the centre. Each inset stays in [0, 1) and leaves at
 * least 2% of the source on its axis, the rule `normaliseCrop` applies.
 */
export function cropDragResult(start: CropDragStart, pointer: Point, opts: { symmetric?: boolean } = {}): Crop {
  const box = itemFrame(start.layout)
  const c = normaliseCrop(start.crop)
  if (!box || box.halfW <= 0 || box.halfH <= 0) return c
  const from = toLocal(box, start.pointer)
  const to = toLocal(box, pointer)
  const du = (to.x - from.x) / (box.halfW * 2)
  const dv = (to.y - from.y) / (box.halfH * 2)
  const d = handleDirection(start.handle)
  const next: Crop = { ...c }

  const axis = (low: 'left' | 'top', high: 'right' | 'bottom', dir: -1 | 0 | 1, delta: number): void => {
    if (dir === 0) return
    const moving = dir < 0 ? low : high
    const opposite = dir < 0 ? high : low
    // Dragging the low edge towards +axis crops more; the high edge crops more towards −axis.
    const raw = c[moving] + (dir < 0 ? delta : -delta)
    if (opts.symmetric) {
      const value = Math.min((1 - MIN_KEPT) / 2, Math.max(0, raw))
      next[moving] = round4(value)
      next[opposite] = round4(value)
    } else {
      next[moving] = round4(Math.min(1 - MIN_KEPT - c[opposite], Math.max(0, raw)))
    }
  }
  axis('left', 'right', d.x, du)
  axis('top', 'bottom', d.y, dv)
  return next
}

/** The four inset names, for writing a crop one edge at a time (`setCrop`). */
export const CROP_INSETS: readonly (keyof Crop)[] = ['left', 'top', 'right', 'bottom']
