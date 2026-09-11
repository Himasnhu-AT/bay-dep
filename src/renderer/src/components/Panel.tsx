import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface PanelProps {
  title?: string
  /** Controls that sit on the title row, right-aligned. */
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

/**
 * A titled region. Panels are separated by a 1px `line`, never by a gap or a shadow —
 * borders are what keep a dense tool from looking like a page of floating cards.
 */
export function Panel({ title, actions, children, className, bodyClassName }: PanelProps): ReactNode {
  return (
    <section className={cn('flex min-h-0 min-w-0 flex-col bg-surface-1', className)}>
      {(title || actions) && (
        <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
          {title && (
            <h2 className="text-[11px] font-medium tracking-[0.06em] text-ink-2 uppercase">
              {title}
            </h2>
          )}
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cn('min-h-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  )
}

export interface SectionProps {
  title: string
  children: ReactNode
  actions?: ReactNode
  className?: string
}

/** A labelled group inside a panel body — the Inspector is built out of these. */
export function Section({ title, children, actions, className }: SectionProps): ReactNode {
  return (
    <div className={cn('border-b border-line px-3 py-3 last:border-b-0', className)}>
      <div className="mb-2 flex h-4 items-center justify-between">
        <h3 className="text-[10px] font-medium tracking-[0.08em] text-ink-2 uppercase">{title}</h3>
        {actions}
      </div>
      {children}
    </div>
  )
}

export interface FieldProps {
  label: string
  children: ReactNode
  /** Right-hand readout, e.g. the numeric value beside a slider. */
  hint?: ReactNode
  className?: string
}

/** A label above (or beside) a control, on the 4px grid. */
export function Field({ label, children, hint, className }: FieldProps): ReactNode {
  return (
    <div className={cn('grid grid-cols-[64px_1fr] items-center gap-2', className)}>
      <span className="truncate text-[11px] text-ink-1">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        {hint && (
          <span className="shrink-0 text-right text-[11px] text-ink-2 tabular-nums">{hint}</span>
        )}
      </div>
    </div>
  )
}
