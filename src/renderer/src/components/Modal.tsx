import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
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
    panel.addEventListener('keydown', onKeyDown)
    return () => {
      panel.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-8"
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
          <h2 className="text-[13px] font-medium text-ink-0">{title}</h2>
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
