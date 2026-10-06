/**
 * The arithmetic behind the viewer's mask handles, pure so it is tested without a window.
 *
 * Two spaces meet here. The pointer arrives in **canvas** coordinates (`./geometry`); a mask is
 * stored as fractions of **the clip's own frame** (`@shared/shape-mask`). Between them sits the
 * clip's frame in pixels — its layout box, before its rotation and zoom — which is where a mask's
 * rotation and feather are measured. `canvasToClip` is the compositor's transform for the
 * uncropped box, inverted, so a handle sits on the edge that is drawn; every drag is then worked
 * out in clip pixels and written back as fractions.
 */

import type { Layout } from '@shared/project'
import {
  flattenPath,
  MAX_PATH_POINTS,
  MAX_SHAPE_FEATHER,
  MIN_PATH_POINTS,
  SHAPE_MASK_RANGES,
  type PathMask,
  type ShapeMask
} from '@shared/shape-mask'
import { fromLocal, handlePoint, itemFrame, resizeFrame, rotationFor, toLocal, zoomOfLayout, type Frame, type Handle, type Point } from './geometry'

export interface Size {
  width: number
  height: number
}

const DEG = Math.PI / 180
const clamp = (value: number, [low, high]: readonly [number, number]): number => Math.min(high, Math.max(low, value))
const round = (value: number, places: number): number => {
  const k = 10 ** places
  return Math.round(value * k) / k
}

/** A canvas point as a point of the clip's frame, in its own pixels (0..width, 0..height). Null when the clip draws nothing. */
export function canvasToClip(layout: Layout, p: Point): Point | null {
  const frame = itemFrame(layout)
  const zoom = zoomOfLayout(layout)
  if (!frame || zoom <= 0) return null
  const local = toLocal(frame, p)
  return { x: local.x / zoom + layout.width / 2, y: local.y / zoom + layout.height / 2 }
}

/** The inverse: a point of the clip's frame, where it is drawn on the canvas. */
export function clipToCanvas(layout: Layout, p: Point): Point | null {
  const frame = itemFrame(layout)
  if (!frame) return null
  const zoom = zoomOfLayout(layout)
  return fromLocal(frame, { x: (p.x - layout.width / 2) * zoom, y: (p.y - layout.height / 2) * zoom })
}

/** The mask's own box in clip pixels: centre, half-extents and rotation. */
export function maskFrame(mask: ShapeMask, size: Size): Frame {
  return {
    cx: mask.x * size.width,
    cy: mask.y * size.height,
    halfW: (Math.abs(mask.width) * size.width) / 2,
    halfH: (Math.abs(mask.height) * size.height) / 2,
    angle: (mask.rotation ?? 0) * DEG
  }
}

/** The mask's edge as a closed polygon in clip pixels, for drawing its outline. */
export function maskOutline(mask: ShapeMask, size: Size): Point[] {
  const frame = maskFrame(mask, size)
  const local: Point[] = []
  if (mask.kind === 'path') {
    const flat = flattenPath(mask.points, frame.halfW * 2, frame.halfH * 2)
    for (let i = 0; i < flat.length; i += 2) local.push({ x: flat[i]!, y: flat[i + 1]! })
  } else if (mask.kind === 'ellipse') {
    for (let i = 0; i < 72; i += 1) {
      const a = (i / 72) * Math.PI * 2
      local.push({ x: Math.cos(a) * frame.halfW, y: Math.sin(a) * frame.halfH })
    }
  } else {
    const r = Math.min(1, Math.max(0, mask.radius ?? 0)) * Math.min(frame.halfW, frame.halfH)
    const corner = (cx: number, cy: number, from: number): void => {
      if (r <= 0) {
        local.push({ x: cx, y: cy })
        return
      }
      for (let i = 0; i <= 8; i += 1) {
        const a = from + (i / 8) * (Math.PI / 2)
        local.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
      }
    }
    corner(frame.halfW - r, -frame.halfH + r, -Math.PI / 2)
    corner(frame.halfW - r, frame.halfH - r, 0)
    corner(-frame.halfW + r, frame.halfH - r, Math.PI / 2)
    corner(-frame.halfW + r, -frame.halfH + r, Math.PI)
  }
  return local.map((p) => fromLocal(frame, p))
}

/**
 * Where the feather handle sits, in clip pixels: on the mask's own right-hand axis, at the outer
 * end of the soft edge (half the feather beyond the box) plus `pad` so it never lands on the
 * resize handle there.
 */
export function featherHandle(mask: ShapeMask, size: Size, pad: number): Point {
  const frame = maskFrame(mask, size)
  return fromLocal(frame, { x: frame.halfW + (mask.feather ?? 0) / 2 + pad, y: 0 })
}

/** Each path point's position in clip pixels. */
export function pathPointPositions(mask: PathMask, size: Size): Point[] {
  const frame = maskFrame(mask, size)
  return mask.points.map((p) => fromLocal(frame, { x: (p.x - 0.5) * frame.halfW * 2, y: (p.y - 0.5) * frame.halfH * 2 }))
}

export type MaskDragMode =
  | { kind: 'move' }
  | { kind: 'resize'; handle: Handle }
  | { kind: 'rotate' }
  | { kind: 'feather'; pad: number }
  | { kind: 'point'; index: number }

export interface MaskDragStart {
  mode: MaskDragMode
  /** The mask when the drag began. */
  mask: ShapeMask
  /** The clip's frame in pixels (its layout box) when the drag began. */
  size: Size
  /** Where the pointer went down, in clip pixels. */
  pointer: Point
}

export interface MaskDragModifiers {
  /** ⇧: aspect lock on a corner, 15° steps when rotating, one axis when moving. */
  shift: boolean
  /** ⌥: resize about the centre. */
  alt: boolean
}

/**
 * The mask after dragging from `start.pointer` to `pointer` (clip pixels). Only the fields the
 * mode changes differ from `start.mask`, and every one stays inside the range `checkShapeMask`
 * accepts, so what a drag writes always draws.
 */
export function maskDragResult(start: MaskDragStart, pointer: Point, mods: MaskDragModifiers = { shift: false, alt: false }): ShapeMask {
  const { mask, size } = start
  if (!(size.width > 0) || !(size.height > 0)) return mask
  const frame = maskFrame(mask, size)
  const R = SHAPE_MASK_RANGES

  if (start.mode.kind === 'move') {
    let dx = pointer.x - start.pointer.x
    let dy = pointer.y - start.pointer.y
    if (mods.shift) {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0
      else dx = 0
    }
    return { ...mask, x: round(clamp(mask.x + dx / size.width, R.x), 4), y: round(clamp(mask.y + dy / size.height, R.y), 4) }
  }

  if (start.mode.kind === 'rotate') {
    const degrees = rotationFor(mask.rotation ?? 0, { x: frame.cx, y: frame.cy }, start.pointer, pointer, mods.shift)
    const next = { ...mask }
    if (degrees === 0) delete next.rotation
    else next.rotation = degrees
    return next
  }

  if (start.mode.kind === 'feather') {
    const along = toLocal(frame, pointer).x
    const feather = round(Math.min(MAX_SHAPE_FEATHER, Math.max(0, (along - frame.halfW - start.mode.pad) * 2)), 1)
    const next = { ...mask }
    if (feather <= 0) delete next.feather
    else next.feather = feather
    return next
  }

  if (start.mode.kind === 'point') {
    if (mask.kind !== 'path') return mask
    const index = start.mode.index
    const point = mask.points[index]
    if (!point || frame.halfW <= 0 || frame.halfH <= 0) return mask
    const local = toLocal(frame, pointer)
    const points = mask.points.slice()
    points[index] = {
      ...point,
      x: round(clamp(local.x / (frame.halfW * 2) + 0.5, R.point), 4),
      y: round(clamp(local.y / (frame.halfH * 2) + 0.5, R.point), 4)
    }
    return { ...mask, points }
  }

  // Resize: the grabbed handle keeps its offset from the pointer, and the opposite one stays put.
  const grab = handlePoint(frame, start.mode.handle)
  const target = { x: pointer.x + grab.x - start.pointer.x, y: pointer.y + grab.y - start.pointer.y }
  const next = resizeFrame(frame, start.mode.handle, target, { keepAspect: mods.shift, fromCentre: mods.alt, minHalf: 1 })
  return {
    ...mask,
    x: round(clamp(next.cx / size.width, R.x), 4),
    y: round(clamp(next.cy / size.height, R.y), 4),
    width: round(clamp((next.halfW * 2) / size.width, R.width), 4),
    height: round(clamp((next.halfH * 2) / size.height, R.height), 4)
  }
}

/**
 * `mask` with a new point at `p` (clip pixels), put between the two points whose side is nearest —
 * so the outline keeps its order and the new point lands on the edge that was clicked. Unchanged
 * at the point limit.
 */
export function insertPathPoint(mask: PathMask, size: Size, p: Point): { mask: PathMask; index: number } | null {
  if (mask.points.length >= MAX_PATH_POINTS) return null
  const frame = maskFrame(mask, size)
  if (frame.halfW <= 0 || frame.halfH <= 0) return null
  const at = pathPointPositions(mask, size)
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < at.length; i += 1) {
    const a = at[i]!
    const b = at[(i + 1) % at.length]!
    const ex = b.x - a.x
    const ey = b.y - a.y
    const length2 = ex * ex + ey * ey
    const t = length2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * ex + (p.y - a.y) * ey) / length2)) : 0
    const d = Math.hypot(p.x - (a.x + ex * t), p.y - (a.y + ey * t))
    if (d < bestDistance) {
      bestDistance = d
      best = i
    }
  }
  const local = toLocal(frame, p)
  const R = SHAPE_MASK_RANGES
  const point = {
    x: round(clamp(local.x / (frame.halfW * 2) + 0.5, R.point), 4),
    y: round(clamp(local.y / (frame.halfH * 2) + 0.5, R.point), 4)
  }
  const points = mask.points.slice()
  points.splice(best + 1, 0, point)
  return { mask: { ...mask, points }, index: best + 1 }
}

/** `mask` without point `index`; null when that would leave fewer than a shape needs. */
export function removePathPoint(mask: PathMask, index: number): PathMask | null {
  if (mask.points.length <= MIN_PATH_POINTS || index < 0 || index >= mask.points.length) return null
  return { ...mask, points: mask.points.filter((_, i) => i !== index) }
}
