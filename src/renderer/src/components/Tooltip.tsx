import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'
import { Kbd } from './Kbd'
import { placeFloating, type Placement } from './placement'
import { isInsideFloating } from './Floating'
import { onFloatingChange, tooltipAllowed } from './floatingStack'

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

export interface TooltipProps {
  label: ReactNode
  /**
   * The key that does the same thing, drawn dim after the label. Pass a binding in
   * `@shared/shortcuts` spelling — best of all straight from the registry,
   * `shortcutOf('clip.split')` — and it is drawn as the platform shows it (`⌘B`).
   */
  shortcut?: string
  /** A second line of explanation — a reason, a consequence. Not for shortcuts. */
  detail?: ReactNode
  side?: TooltipSide
  children: ReactElement<{
    onPointerEnter?: (event: React.PointerEvent) => void
    onPointerLeave?: (event: React.PointerEvent) => void
    onPointerDown?: (event: React.PointerEvent) => void
    onFocus?: (event: React.FocusEvent) => void
    onBlur?: (event: React.FocusEvent) => void
    'aria-describedby'?: string
  }>
}

const DELAY_MS = 450

/**
 * Tooltips render into a portal on `document.body`. The timeline, the media pool and the
 * inspector are all scroll containers with `overflow: hidden` somewhere above them, and a
 * tooltip that lives inside one gets clipped by it — usually on exactly the control at the
 * edge of the panel, where the label matters most.
 *
 * They open for the keyboard too: at once on a `:focus-visible` focus (a keyboard user asked
 * for this control; the hover delay is for a pointer passing over), closed on blur and Escape.
 * While open the trigger is `aria-describedby` the tooltip. Placement is clamped to the window
 * and flips to the other side when there is no room.
 */
export function Tooltip({ label, shortcut, detail, side = 'bottom', children }: TooltipProps): ReactNode {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const tip = useRef<HTMLDivElement | null>(null)
  const timer = useRef<number | null>(null)
  const id = useId()

  const clear = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }

  // Never over an open menu or popover, unless this trigger is inside it (`floatingStack`).
  const reveal = (element: HTMLElement): void => {
    if (tooltipAllowed(isInsideFloating(element))) setTarget(element)
  }

  const show = (element: HTMLElement, delay: number): void => {
    clear()
    if (delay === 0) reveal(element)
    else timer.current = window.setTimeout(() => reveal(element), delay)
  }

  const hide = (): void => {
    clear()
    setTarget(null)
    setPlacement(null)
  }

  useEffect(() => clear, [])

  // A menu opening while this tooltip shows (a right-click on its trigger) takes it away.
  useEffect(() => {
    if (!target) return
    return onFloatingChange(() => {
      if (!tooltipAllowed(isInsideFloating(target))) hide()
    })
  }, [target])

  useLayoutEffect(() => {
    if (!target || !tip.current) return
    const r = target.getBoundingClientRect()
    setPlacement(
      placeFloating({
        anchor: { left: r.left, top: r.top, width: r.width, height: r.height },
        size: { width: tip.current.offsetWidth, height: tip.current.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        side,
        align: 'center',
        gap: 6
      })
    )
  }, [target, side, label, shortcut, detail])

  useEffect(() => {
    if (!target) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [target])

  // The child's own handlers are kept and called first. `cloneElement` overwrites props rather
  // than merging them, so a tooltip wrapped around a control that listens for `pointerdown`
  // would silently disable it.
  const child = children.props
  return (
    <>
      {cloneElement(children, {
        onPointerEnter: (event: React.PointerEvent) => {
          child.onPointerEnter?.(event)
          show(event.currentTarget as HTMLElement, DELAY_MS)
        },
        onPointerLeave: (event: React.PointerEvent) => {
          child.onPointerLeave?.(event)
          hide()
        },
        // A tooltip still hovering over the control you just clicked is noise.
        onPointerDown: (event: React.PointerEvent) => {
          child.onPointerDown?.(event)
          hide()
        },
        onFocus: (event: React.FocusEvent) => {
          child.onFocus?.(event)
          const element = event.currentTarget as HTMLElement
          if (element.matches(':focus-visible')) show(element, 0)
        },
        onBlur: (event: React.FocusEvent) => {
          child.onBlur?.(event)
          hide()
        },
        'aria-describedby': target ? id : child['aria-describedby']
      })}
      {target &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role="tooltip"
            style={
              placement
                ? { left: placement.left, top: placement.top }
                : { left: 0, top: 0, visibility: 'hidden' }
            }
            className={cn(
              'pointer-events-none fixed z-(--z-tooltip) rounded-sm border border-line-strong bg-surface-2 px-2 py-1 text-[11px] text-ink-0 shadow-pop',
              detail ? 'max-w-72 whitespace-normal' : 'whitespace-nowrap'
            )}
          >
            {label}
            {shortcut && <Kbd shortcut={shortcut} className="ml-2" />}
            {detail && <div className="mt-0.5 text-ink-2 text-pretty">{detail}</div>}
          </div>,
          document.body
        )}
    </>
  )
}
