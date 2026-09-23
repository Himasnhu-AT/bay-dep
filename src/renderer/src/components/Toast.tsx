import { useEffect, type ReactNode } from 'react'
import { AlertTriangle, Info, X } from 'lucide-react'
import { cn } from '@/lib/cn'

const DISMISS_MS = { info: 4500, error: 9000 }

/**
 * The single notification surface, inline in the status bar rather than floating over the
 * timeline. A toast that covers the thing it is telling you about is worse than no toast,
 * and in an editor the bottom-right corner is where clips are.
 *
 * It takes the toast as a prop rather than reading the store: `components/` is the
 * presentational layer, and `src/shared/boundaries.test.ts` keeps the store out of it.
 */
export function Toast({
  toast,
  onDismiss: dismiss
}: {
  toast: { kind: 'info' | 'error'; text: string } | null
  onDismiss: () => void
}): ReactNode {
  useEffect(() => {
    if (!toast) return
    // The store hands back a fresh object with a fresh id on every notify, so two
    // identical messages in a row still restart the timer rather than sharing one.
    const handle = window.setTimeout(dismiss, DISMISS_MS[toast.kind])
    return () => window.clearTimeout(handle)
  }, [toast, dismiss])

  if (!toast) return null

  const error = toast.kind === 'error'
  return (
    <div
      role="status"
      aria-live={error ? 'assertive' : 'polite'}
      className={cn(
        'flex h-[18px] min-w-0 items-center gap-1.5 rounded-xs border px-1.5 text-[11px]',
        error
          ? 'border-danger/40 bg-danger/12 text-danger'
          : 'border-line-strong bg-surface-2 text-ink-1'
      )}
    >
      {error ? (
        <AlertTriangle aria-hidden="true" className="size-3 shrink-0" />
      ) : (
        <Info aria-hidden="true" className="size-3 shrink-0" />
      )}
      <span className="truncate">{toast.text}</span>
      <button
        type="button"
        aria-label="Dismiss message"
        onClick={dismiss}
        className="t-fast shrink-0 text-current opacity-60 hover:opacity-100"
      >
        <X aria-hidden="true" className="size-3" />
      </button>
    </div>
  )
}
