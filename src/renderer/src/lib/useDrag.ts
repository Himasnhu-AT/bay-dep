import { useCallback, useRef } from 'react'

export interface DragState {
  /** Movement since the pointer went down, in CSS pixels. */
  dx: number
  dy: number
  /** Current client position. */
  x: number
  y: number
  shift: boolean
  alt: boolean
  meta: boolean
  /** Largest distance the pointer has been from its origin — a click is < 3. */
  travel: number
}

export interface DragSpec {
  onStart?(state: DragState, event: React.PointerEvent): void
  onMove?(state: DragState, event: PointerEvent): void
  onEnd?(state: DragState, event: PointerEvent): void
  /** Called instead of `onEnd` when the pointer never travelled far enough to be a drag. */
  onClick?(state: DragState, event: PointerEvent): void
  /** Pointer travel, in pixels, before a press counts as a drag. */
  threshold?: number
}

/**
 * One pointer-drag abstraction for the whole app: clips, trim handles, the playhead,
 * sliders and the drag-to-scrub number fields all go through it.
 *
 * It uses `setPointerCapture` rather than window listeners so a drag that leaves the
 * window — very easy to do when the timeline runs to the edge of the screen — keeps
 * delivering moves and, more importantly, still delivers its `pointerup`. A drag that
 * silently never ends leaves a clip stuck to the cursor.
 */
export function useDrag(spec: DragSpec): (event: React.PointerEvent) => void {
  // The spec is recreated on every render by every caller; reading it through a ref is
  // what stops a drag in flight from calling last render's closure.
  const latest = useRef(spec)
  latest.current = spec

  return useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return
    const element = event.currentTarget as HTMLElement
    const originX = event.clientX
    const originY = event.clientY
    let travel = 0

    const read = (e: PointerEvent | React.PointerEvent): DragState => {
      const dx = e.clientX - originX
      const dy = e.clientY - originY
      travel = Math.max(travel, Math.hypot(dx, dy))
      return {
        dx,
        dy,
        x: e.clientX,
        y: e.clientY,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey || e.ctrlKey,
        travel
      }
    }

    const move = (e: PointerEvent): void => {
      latest.current.onMove?.(read(e), e)
    }

    const finish = (e: PointerEvent): void => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', finish)
      element.removeEventListener('pointercancel', finish)
      const state = read(e)
      const threshold = latest.current.threshold ?? 3
      if (state.travel < threshold && latest.current.onClick) latest.current.onClick(state, e)
      else latest.current.onEnd?.(state, e)
    }

    element.setPointerCapture(event.pointerId)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', finish)
    element.addEventListener('pointercancel', finish)
    latest.current.onStart?.(read(event), event)
  }, [])
}
