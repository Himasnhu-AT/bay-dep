import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'
import { placeFloating, type FloatingAlign, type FloatingSide, type Placement } from './placement'
import { isolatePointerEvents } from './isolate'

/** What a floating surface hangs from: a trigger element, or a point (a right-click). */
export type Anchor = HTMLElement | { x: number; y: number }

/** Why a surface closed. Only a keyboard close or a choice puts focus back on the trigger. */
export type DismissReason = 'escape' | 'tab' | 'select' | 'outside' | 'blur' | 'scroll' | 'resize'

const RESTORES_FOCUS = new Set<DismissReason>(['escape', 'tab', 'select'])

/** Marks every floating surface, so Modal's Escape/Tab handling can leave them alone. */
export const FLOATING_ATTR = 'data-floating'

export function isInsideFloating(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${FLOATING_ATTR}]`) !== null
}

function anchorRect(anchor: Anchor): { left: number; top: number; width: number; height: number } {
  if (anchor instanceof HTMLElement) {
    const r = anchor.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  }
  return { left: anchor.x, top: anchor.y, width: 0, height: 0 }
}

export interface FloatingSurfaceProps {
  open: boolean
  anchor: Anchor | null
  onClose(reason: DismissReason): void
  side?: FloatingSide
  align?: FloatingAlign
  gap?: number
  /** Scrolling outside the surface closes it (menus). Popovers holding fields may opt out. */
  closeOnScroll?: boolean
  /** Close when focus moves to something outside (popovers; menus handle Tab themselves). */
  closeOnFocusOut?: boolean
  /** Called once the surface is placed, to move focus into it. */
  onPlaced?(surface: HTMLElement): void
  role: string
  label: string
  className?: string
  onKeyDown?(event: ReactKeyboardEvent<HTMLDivElement>): void
  surfaceRef?: RefObject<HTMLDivElement | null>
  /** Receives the surface's dismiss, for an owner that closes on a choice or on Tab. */
  dismissRef?: { current: Dismiss | null }
  children: ReactNode
}

/**
 * The shared body of `Menu`, `ContextMenu` and `Popover`: a portal on `document.body` (panels
 * clip), placed by `placeFloating`, growing from its anchor (`t-pop`), and dismissed the ways a
 * desktop popup is — Escape, a pointer-down outside, the window losing focus, a scroll or a
 * resize. Keys pressed inside stop here (⌘-combos excepted), so Space on a menu item activates
 * it instead of playing the timeline.
 */
export function FloatingSurface(props: FloatingSurfaceProps): ReactNode {
  const { open, anchor, side, align, gap, closeOnScroll = true, closeOnFocusOut } = props
  const localRef = useRef<HTMLDivElement | null>(null)
  const ref = props.surfaceRef ?? localRef
  const [placement, setPlacement] = useState<Placement | null>(null)
  const previous = useRef<HTMLElement | null>(null)
  const latest = useRef(props)
  latest.current = props

  const dismiss = useCallback(
    (reason: DismissReason) => {
      if (RESTORES_FOCUS.has(reason)) {
        const target = anchor instanceof HTMLElement ? anchor : previous.current
        target?.focus({ preventScroll: true })
      }
      latest.current.onClose(reason)
    },
    [anchor]
  )
  if (props.dismissRef) props.dismissRef.current = dismiss

  // Where focus was when it opened — once per opening, before anything moves it inside.
  useLayoutEffect(() => {
    if (open) {
      previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
  }, [open])

  // Place before paint, and again whenever the surface's own size changes (a filtered list).
  // Pass a stable `anchor` (state, not an object literal): a new one each render re-places it.
  useLayoutEffect(() => {
    if (!open || !anchor) {
      setPlacement(null)
      return
    }
    const surface = ref.current
    if (!surface) return
    const place = (): void => {
      setPlacement(
        placeFloating({
          anchor: anchorRect(anchor),
          size: { width: surface.offsetWidth, height: surface.offsetHeight },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          side,
          align,
          gap: gap ?? (anchor instanceof HTMLElement ? 4 : 0)
        })
      )
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(surface)
    return () => observer.disconnect()
  }, [open, anchor, side, align, gap, ref])

  const placed = placement !== null
  useEffect(() => {
    if (placed && ref.current) latest.current.onPlaced?.(ref.current)
  }, [placed, ref])

  useEffect(() => {
    if (!open) return
    const inside = (target: EventTarget | null): boolean =>
      target instanceof Node &&
      (ref.current?.contains(target) === true ||
        (anchor instanceof HTMLElement && anchor.contains(target)))
    const onPointerDown = (event: PointerEvent): void => {
      if (!inside(event.target)) dismiss('outside')
    }
    const onScroll = (event: Event): void => {
      if (!(event.target instanceof Node && ref.current?.contains(event.target))) dismiss('scroll')
    }
    const onBlur = (): void => dismiss('blur')
    const onResize = (): void => dismiss('resize')
    // Escape with focus nowhere — a field inside blurred on Enter and focus fell to <body> —
    // still closes the surface; otherwise it stayed open with nothing to close it but a click.
    // With focus on anything else, that element (or this surface's own handler) owns the key.
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const active = document.activeElement
      if (active !== null && active !== document.body) return
      // Capture phase, stopped here: the editor's own Escape (disarm a tool) must not also run.
      event.stopPropagation()
      dismiss('escape')
    }
    window.addEventListener('keydown', onEscape, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onResize)
    if (closeOnScroll) window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onEscape, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, anchor, closeOnScroll, dismiss, ref])

  if (!open || !anchor) return null

  const style: CSSProperties = placement
    ? { left: placement.left, top: placement.top, transformOrigin: placement.origin }
    : { left: 0, top: 0, visibility: 'hidden' }

  return createPortal(
    <div
      ref={ref}
      {...{ [FLOATING_ATTR]: '' }}
      role={props.role}
      aria-label={props.label}
      tabIndex={-1}
      style={style}
      {...isolatePointerEvents}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          dismiss('escape')
          return
        }
        props.onKeyDown?.(event)
        // The editor's shortcuts listen on the window. A key meant for this surface must not
        // also razor the timeline; ⌘-combos (Save, Undo) still pass.
        if (!event.metaKey && !event.ctrlKey) event.stopPropagation()
      }}
      onBlur={(event) => {
        if (!closeOnFocusOut) return
        const next = event.relatedTarget
        if (next instanceof Node && !ref.current?.contains(next)) dismiss('outside')
      }}
      className={cn(
        'fixed z-(--z-popover) outline-none',
        placed && 't-pop',
        props.className
      )}
    >
      {props.children}
    </div>,
    document.body
  )
}

/** Dismissal as the owner of a surface calls it — for `Menu` to close on a choice or Tab. */
export type Dismiss = (reason: DismissReason) => void

/**
 * Wiring for a trigger button: `triggerProps` go on the button (IconButton and Button accept
 * `ref`), `surfaceProps` on the `Menu`/`Popover`. Opening from the keyboard (Enter, Space,
 * ↓) focuses the first item; opening with a pointer focuses the surface, so no row lights up
 * under a mouse that has not moved yet.
 */
export function useFloatingTrigger(kind: 'menu' | 'dialog' = 'menu'): {
  open: boolean
  setOpen(open: boolean): void
  triggerProps: {
    ref(element: HTMLElement | null): void
    onClick(event: React.MouseEvent): void
    onKeyDown(event: React.KeyboardEvent): void
    'aria-haspopup': 'menu' | 'dialog'
    'aria-expanded': boolean
  }
  surfaceProps: {
    open: boolean
    anchor: HTMLElement | null
    onClose(): void
    initialFocus: 'first' | 'surface'
  }
} {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [initialFocus, setInitialFocus] = useState<'first' | 'surface'>('surface')
  return {
    open,
    setOpen,
    triggerProps: {
      ref: setAnchor,
      onClick: (event) => {
        // `detail` is 0 for a click synthesised by Enter or Space.
        setInitialFocus(event.detail === 0 ? 'first' : 'surface')
        setOpen((value) => !value)
      },
      onKeyDown: (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          setInitialFocus('first')
          setOpen(true)
        }
      },
      'aria-haspopup': kind,
      'aria-expanded': open
    },
    surfaceProps: { open, anchor, onClose: () => setOpen(false), initialFocus }
  }
}
