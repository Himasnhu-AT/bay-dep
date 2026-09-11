import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  /** What to do next. An empty state that only says "nothing here" wastes the space. */
  hint?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, hint, action, className }: EmptyStateProps): ReactNode {
  return (
    <div
      className={cn(
        'flex h-full flex-col items-center justify-center gap-2 px-6 py-8 text-center',
        className
      )}
    >
      {icon && <div className="text-ink-2">{icon}</div>}
      <p className="text-[12px] text-ink-1">{title}</p>
      {hint && <p className="max-w-[34ch] text-[11px] leading-relaxed text-ink-2">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
