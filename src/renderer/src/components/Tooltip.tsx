import { cloneElement, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

export interface TooltipProps {
  label: ReactNode
  /** Rendered after the label in a dimmer weight — "Play", "Space". */
  shortcut?: string
  side?: TooltipSide
  children: ReactElement<{
    onPointerEnter?: (event: React.PointerEvent) => void
    onPointerLeave?: (event: React.PointerEvent) => void
    onPointerDown?: (event: React.PointerEvent) => void
  }>
}

const DELAY_MS = 450

/**
 * Tooltips render into a portal on `document.body`. The timeline, the media pool and the
 * inspector are all scroll containers with `overflow: hidden` somewhere above them, and a
 * tooltip that lives inside one gets clipped by it — usually on exactly the control at the
 * edge of the panel, where the label matters most.
 */
export function Tooltip({ label, shortcut, side = 'bottom', children }: TooltipProps): ReactNode {
  const [box, setBox] = useState<DOMRect | null>(null)
  const timer = useRef<number | null>(null)

  const clear = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }

  const show = (event: React.PointerEvent): void => {
    const target = event.currentTarget as HTMLElement
    clear()
    timer.current = window.setTimeout(() => setBox(target.getBoundingClientRect()), DELAY_MS)
  }

  const hide = (): void => {
    clear()
    setBox(null)
  }

  const style: React.CSSProperties = box
    ? side === 'top'
      ? { left: box.left + box.width / 2, top: box.top - 6, transform: 'translate(-50%, -100%)' }
      : side === 'bottom'
        ? { left: box.left + box.width / 2, top: box.bottom + 6, transform: 'translate(-50%, 0)' }
        : side === 'left'
          ? { left: box.left - 6, top: box.top + box.height / 2, transform: 'translate(-100%, -50%)' }
          : { left: box.right + 6, top: box.top + box.height / 2, transform: 'translate(0, -50%)' }
    : {}

  // The child's own pointer handlers are kept and called first. `cloneElement` overwrites
  // props rather than merging them, so a tooltip wrapped around a control that listens for
  // `pointerdown` would silently disable it.
  const child = children.props
  return (
    <>
      {cloneElement(children, {
        onPointerEnter: (event: React.PointerEvent) => {
          child.onPointerEnter?.(event)
          show(event)
        },
        onPointerLeave: (event: React.PointerEvent) => {
          child.onPointerLeave?.(event)
          hide()
        },
        // A tooltip still hovering over the control you just clicked is noise.
        onPointerDown: (event: React.PointerEvent) => {
          child.onPointerDown?.(event)
          hide()
        }
      })}
      {box &&
        createPortal(
          <div
            role="tooltip"
            style={style}
            className="pointer-events-none fixed z-[100] rounded-sm border border-line-strong bg-surface-2 px-2 py-1 text-[11px] whitespace-nowrap text-ink-0 shadow-pop"
          >
            {label}
            {shortcut && <span className="ml-2 text-ink-2">{shortcut}</span>}
          </div>,
          document.body
        )}
    </>
  )
}
