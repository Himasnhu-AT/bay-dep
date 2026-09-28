import { useEffect, useRef } from 'react'
import { wheelAdjusts, wheelSteps, modifiersOf, type Modifiers } from './values'

/**
 * A live edit's bracket, supplied by the caller: the store's `beginGesture`/`endGesture` in the
 * editor. Components reach no store, so a control is handed this rather than importing it.
 *
 * With a gesture, a control commits on **every** move of a drag (the preview draws each one) and
 * the whole drag is still one undo step, as the on-canvas transform does. Without one it commits
 * once, on release — the right choice for a field whose commit has side effects that must not
 * repeat per pixel (a move that is refused with a message, a retime that reports a note).
 */
export interface Gesture {
  begin(): void
  end(): void
}

/** How long a wheel must rest before its run of notches closes as one undo step. */
export const WHEEL_GESTURE_IDLE_MS = 400

export interface GestureBracket {
  /** True when the caller supplied a gesture, so moves should commit live. */
  live: boolean
  begin(): void
  end(): void
  /** Opens the gesture if it is not open and closes it after `WHEEL_GESTURE_IDLE_MS` of rest. */
  touch(): void
  /**
   * The wheel has stopped for sure (the pointer left, focus left): a gesture opened by `touch`
   * closes now instead of at its timer. A drag's gesture is left alone — it ends on release.
   */
  rest(): void
}

/**
 * Keeps a caller's gesture paired, outside React so it can be tested: every `begin` the caller
 * sees gets exactly one `end` — on release, on an idle wheel (`touch`), and on `dispose` mid-drag,
 * because a gesture left open groups every later edit in the project into one undo step. A second
 * `begin` while open, or an `end` while closed, does nothing.
 */
export function createGestureBracket(
  read: () => Gesture | undefined,
  timers: { set(run: () => void, ms: number): unknown; clear(handle: unknown): void } = {
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
): Omit<GestureBracket, 'live'> & { dispose(): void } {
  let open = false
  let idle: unknown = null
  const cancelIdle = (): void => {
    if (idle !== null) timers.clear(idle)
    idle = null
  }
  const end = (): void => {
    cancelIdle()
    if (!open) return
    open = false
    read()?.end()
  }
  const begin = (): void => {
    const gesture = read()
    if (open || !gesture) return
    open = true
    gesture.begin()
  }
  return {
    begin,
    end,
    touch() {
      begin()
      cancelIdle()
      idle = timers.set(end, WHEEL_GESTURE_IDLE_MS)
    },
    rest() {
      if (idle !== null) end()
    },
    dispose: end
  }
}

/** `createGestureBracket` for a component: the latest gesture prop, closed on unmount. */
export function useGestureBracket(gesture: Gesture | undefined): GestureBracket {
  const latest = useRef(gesture)
  latest.current = gesture
  const bracket = useRef<ReturnType<typeof createGestureBracket> | null>(null)
  if (bracket.current === null) bracket.current = createGestureBracket(() => latest.current)
  const current = bracket.current
  useEffect(() => () => current.dispose(), [current])
  return { live: gesture !== undefined, begin: current.begin, end: current.end, touch: current.touch, rest: current.rest }
}

// One timestamp for the whole document: any scroll anywhere means a wheel belongs to the page.
let lastScroll = -Infinity
let watching = false
function watchScrolls(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  window.addEventListener('scroll', () => (lastScroll = performance.now()), { capture: true, passive: true })
}

/**
 * Wheel adjust on `element`: whole steps (with the event's modifiers) while it is hovered and
 * focused and the page is not mid-scroll (`wheelAdjusts`). A native, non-passive listener,
 * because React's `onWheel` is passive and cannot stop the inspector scrolling under a field
 * that is taking the wheel.
 */
export function useWheelSteps(
  element: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  onSteps: (steps: number, mods: Modifiers) => void,
  /**
   * Called when the pointer leaves the control or focus leaves it: a wheel's gesture closes
   * then rather than lingering for its idle timer, inside which anything else would land.
   */
  onRest?: () => void
): void {
  const latest = useRef(onSteps)
  latest.current = onSteps
  const rested = useRef(onRest)
  rested.current = onRest
  useEffect(() => {
    const target = element.current
    if (!target || !enabled) return
    watchScrolls()
    let hovered = false
    let rest = 0
    const enter = (): void => {
      hovered = true
      rest = 0
    }
    const leave = (): void => {
      hovered = false
      rested.current?.()
    }
    const blur = (event: FocusEvent): void => {
      if (!(event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) rested.current?.()
    }
    const wheel = (event: WheelEvent): void => {
      const focused = target.contains(document.activeElement)
      if (!wheelAdjusts({ hovered, focused, msSinceScroll: performance.now() - lastScroll })) return
      event.preventDefault()
      const { steps, rest: left } = wheelSteps(rest, event.deltaY, event.deltaMode)
      rest = left
      if (steps !== 0) latest.current(steps, modifiersOf(event))
    }
    target.addEventListener('pointerenter', enter)
    target.addEventListener('pointerleave', leave)
    target.addEventListener('wheel', wheel, { passive: false })
    target.addEventListener('focusout', blur)
    return () => {
      target.removeEventListener('focusout', blur)
      target.removeEventListener('pointerenter', enter)
      target.removeEventListener('pointerleave', leave)
      target.removeEventListener('wheel', wheel)
    }
  }, [element, enabled])
}

