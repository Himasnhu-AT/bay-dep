import { useId, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

function remembered(id: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(`bay.section.${id}`)
    return stored === null ? fallback : stored === '1'
  } catch {
    return fallback
  }
}

/**
 * "More" inside a section: the advanced controls one level deeper, closed until asked for, and
 * remembered per id the way a `Section` is. A nested `Section` would draw a second border and a
 * second uppercase title inside the first, which reads as a sibling rather than a child.
 */
export function Disclosure({
  id,
  label,
  children,
  defaultOpen = false
}: {
  id: string
  label: string
  children: ReactNode
  defaultOpen?: boolean
}): ReactNode {
  const [open, setOpen] = useState(() => remembered(id, defaultOpen))
  const bodyId = useId()
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          setOpen(!open)
          try {
            localStorage.setItem(`bay.section.${id}`, open ? '0' : '1')
          } catch {
            // Not remembered this time; it still opens.
          }
        }}
        className="t-fast -mx-1 flex h-6 items-center gap-1 rounded-sm px-1 text-[11px] text-ink-1 hover:text-ink-0"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn('size-3 shrink-0 transition-[rotate] duration-(--duration-fast)', open && 'rotate-90')}
        />
        {label}
      </button>
      <div id={bodyId} hidden={!open} className="mt-1.5">
        {children}
      </div>
    </div>
  )
}
