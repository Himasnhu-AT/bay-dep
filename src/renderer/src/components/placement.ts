/**
 * Where a floating surface (menu, popover, tooltip) goes: beside its anchor, flipped to the
 * other side when it does not fit, then clamped inside the viewport. Pure, so the geometry is
 * tested without a window (`placement.test.ts`); the DOM half is `Floating.tsx`.
 *
 * The returned `origin` is the CSS `transform-origin` that makes the surface grow out of its
 * anchor — the point on the surface's own box nearest the anchor — so an entrance animation
 * reads as coming from the thing that was clicked.
 */

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export type FloatingSide = 'top' | 'bottom' | 'left' | 'right'
export type FloatingAlign = 'start' | 'center' | 'end'

export interface PlaceOptions {
  anchor: Rect
  size: { width: number; height: number }
  viewport: { width: number; height: number }
  side?: FloatingSide
  align?: FloatingAlign
  /** Space between anchor and surface. */
  gap?: number
  /** Closest the surface may come to the viewport edge. */
  margin?: number
}

export interface Placement {
  left: number
  top: number
  /** The side actually used, after any flip. */
  side: FloatingSide
  /** CSS `transform-origin`, in px of the surface's own box. */
  origin: string
}

const OPPOSITE: Record<FloatingSide, FloatingSide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left'
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function placeFloating(options: PlaceOptions): Placement {
  const { anchor, size, viewport } = options
  const gap = options.gap ?? 4
  const margin = options.margin ?? 8
  let side = options.side ?? 'bottom'
  const align = options.align ?? 'start'
  const vertical = side === 'top' || side === 'bottom'

  // Main axis: the preferred side if it fits, else the opposite if that fits, else whichever
  // has more room (and the clamp below keeps it on screen).
  const room = (s: FloatingSide): number =>
    s === 'bottom'
      ? viewport.height - (anchor.top + anchor.height) - gap - margin
      : s === 'top'
        ? anchor.top - gap - margin
        : s === 'right'
          ? viewport.width - (anchor.left + anchor.width) - gap - margin
          : anchor.left - gap - margin
  const need = vertical ? size.height : size.width
  if (room(side) < need && room(OPPOSITE[side]) > room(side)) side = OPPOSITE[side]

  let left: number
  let top: number
  if (vertical) {
    top = side === 'bottom' ? anchor.top + anchor.height + gap : anchor.top - gap - size.height
    const at = (a: FloatingAlign): number =>
      a === 'start'
        ? anchor.left
        : a === 'end'
          ? anchor.left + anchor.width - size.width
          : anchor.left + anchor.width / 2 - size.width / 2
    left = at(align)
    // Cross-axis flip before clamping: a context menu near the right edge opens leftward from
    // the pointer, the way native menus do, rather than sliding under it.
    if (align === 'start' && left + size.width > viewport.width - margin) left = at('end')
    else if (align === 'end' && left < margin) left = at('start')
  } else {
    left = side === 'right' ? anchor.left + anchor.width + gap : anchor.left - gap - size.width
    const at = (a: FloatingAlign): number =>
      a === 'start'
        ? anchor.top
        : a === 'end'
          ? anchor.top + anchor.height - size.height
          : anchor.top + anchor.height / 2 - size.height / 2
    top = at(align)
    if (align === 'start' && top + size.height > viewport.height - margin) top = at('end')
    else if (align === 'end' && top < margin) top = at('start')
  }

  left = clamp(left, margin, Math.max(margin, viewport.width - margin - size.width))
  top = clamp(top, margin, Math.max(margin, viewport.height - margin - size.height))

  // The anchor's centre, in the surface's coordinates, pinned to the touching edge.
  const cx = clamp(anchor.left + anchor.width / 2 - left, 0, size.width)
  const cy = clamp(anchor.top + anchor.height / 2 - top, 0, size.height)
  const origin =
    side === 'bottom'
      ? `${cx}px 0px`
      : side === 'top'
        ? `${cx}px ${size.height}px`
        : side === 'right'
          ? `0px ${cy}px`
          : `${size.width}px ${cy}px`

  return { left, top, side, origin }
}
