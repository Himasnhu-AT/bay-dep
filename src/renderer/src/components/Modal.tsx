import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { isInsideFloating } from './Floating'
import { IconButton } from './IconButton'

export interface ModalProps {
  open: boolean
  title: string
  onClose(): void
  children: ReactNode
  footer?: ReactNode
  /** Width in pixels. Dialogs here are documents, not layouts — they get a fixed width. */
  width?: number
}

/**
 * The one overlay in the app, and the one place a shadow is allowed.
 *
 * Focus moves into the dialog on open and Tab is trapped inside it, because the editor
 * behind is full of keyboard shortcuts — a Tab that escapes lands the user on a clip they
 * cannot see, and the next Space press plays the timeline instead of pressing Export.
 */
export function Modal({ open, title, onClose, children, footer, width = 480 }: ModalProps): ReactNode {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return
    const previous = document.activeElement as HTMLElement | null
    const focusables = (): HTMLElement[] =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      )
    focusables()[0]?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      // A menu or popover opened from inside the dialog owns its own Escape and Tab: Escape
      // there closes the menu, not the dialog under it.
      if (isInsideFloating(event.target)) return
      // Escape closes. Listed here rather than on the panel's React props because the panel
      // is not always what holds focus — a `<select>` inside it swallows keydown — and a
      // dialog that traps Tab but cannot be dismissed from the keyboard is a trap.
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    // On the window, not the panel: a native `<select>` popup takes focus out of the panel
    // entirely on macOS, and Escape pressed while it is open would otherwise reach nothing.
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      previous?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-black/55 p-8"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width }}
        className="t-panel flex max-h-full flex-col overflow-hidden rounded-md border border-line-strong bg-surface-1 shadow-pop"
      >
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-line pl-3 pr-1.5">
          {/* The dialog's name must outrank the section headings inside it, which are 13px
              semibold in Settings — at 13px medium it read as the smaller of the two. */}
          <h2 className="text-[14px] font-semibold text-ink-0">{title}</h2>
          <IconButton label="Close" icon={<X className="size-4" />} onClick={onClose} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-3 py-2.5">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body
  )
}
