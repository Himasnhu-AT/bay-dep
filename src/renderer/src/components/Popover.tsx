import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { FloatingSurface, type Anchor } from './Floating'
import type { FloatingAlign, FloatingSide } from './placement'

export interface PopoverProps {
  open: boolean
  onClose(): void
  /** The trigger element, or a point in viewport coordinates. */
  anchor: Anchor | null
  /** The panel's accessible name — "Edit marker", "Filter media". */
  label: string
  side?: FloatingSide
  align?: FloatingAlign
  /**
   * `'first'` focuses the first field or button inside (the usual choice: a popover is opened
   * to be used); `'surface'` focuses the panel itself.
   */
  initialFocus?: 'first' | 'surface'
  /** Width in px; popovers are small documents, like dialogs, not layouts. Default 240. */
  width?: number
  className?: string
  children: ReactNode
}

const FOCUSABLE =
  'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

/**
 * A small panel anchored to a control — a marker's name and colour, a filter, a clip's quick
 * settings. Non-modal: the editor stays live behind it. Same placement and dismissal as `Menu`
 * (Escape returns focus to the trigger; a pointer-down outside, window blur, resize or focus
 * leaving it closes it), `role="dialog"`. For choices from a list use `Menu`; for anything
 * that must be answered before going on use `Modal`.
 *
 * Wire a trigger with `useFloatingTrigger('dialog')`, spreading `surfaceProps` here.
 */
export function Popover({
  open,
  onClose,
  anchor,
  label,
  side,
  align,
  initialFocus = 'first',
  width = 240,
  className,
  children
}: PopoverProps): ReactNode {
  return (
    <FloatingSurface
      open={open}
      anchor={anchor}
      onClose={onClose}
      side={side}
      align={align}
      role="dialog"
      label={label}
      // A popover often holds fields inside a scrolling panel; scrolling its own list must not
      // close it, and it closes when focus leaves instead.
      closeOnScroll={false}
      closeOnFocusOut
      onPlaced={(element) => {
        const target = initialFocus === 'first' ? element.querySelector<HTMLElement>(FOCUSABLE) : null
        ;(target ?? element).focus({ preventScroll: true })
      }}
      className={cn('rounded-md border border-line-strong bg-surface-2 p-3 shadow-pop', className)}
    >
      <div style={{ width }}>{children}</div>
    </FloatingSurface>
  )
}
