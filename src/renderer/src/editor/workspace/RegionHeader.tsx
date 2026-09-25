import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface RegionHeaderProps {
  /** The region's name, left. Omit it when `centre` names the region instead (the viewer). */
  title?: ReactNode
  /** Controls at the left, after the title. */
  leading?: ReactNode
  /** Centred on the strip, not on the space left over, so it does not drift as the sides change. */
  centre?: ReactNode
  /** Controls at the right. */
  actions?: ReactNode
  className?: string
}

/**
 * A region's title strip, as every Resolve panel has one: 28px on `chrome-raised`, a step apart
 * from the panel body under it, so a region reads as a band with a name rather than as another
 * patch of the same grey. Title left, actions right, an optional centred label (the viewer's
 * "Timeline — name").
 */
export function RegionHeader({ title, leading, centre, actions, className }: RegionHeaderProps): ReactNode {
  return (
    <header
      className={cn(
        'relative flex h-7 min-w-0 shrink-0 items-center gap-2 border-b border-line bg-chrome-raised px-2',
        className
      )}
    >
      {title && (
        <h2 className="shrink-0 truncate text-[11px] font-semibold text-ink-0 select-none">{title}</h2>
      )}
      {leading && <div className="flex min-w-0 shrink-0 items-center gap-1">{leading}</div>}
      {centre && (
        <div className="pointer-events-none absolute inset-x-0 flex justify-center">
          <div className="pointer-events-auto max-w-[50%] min-w-0 truncate">{centre}</div>
        </div>
      )}
      <div className="flex-1" />
      {actions && <div className="relative flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  )
}
