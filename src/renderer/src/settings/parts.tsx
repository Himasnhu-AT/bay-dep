import { createContext, useContext, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Switch } from '@/components'
import { cn } from '@/lib/cn'

/**
 * The building blocks of Preferences and Project Settings, in Resolve's arrangement: a page has a
 * title and one sentence, then groups; a group is a captioned box of rows split by hairlines; a
 * row is a label (and a short hint) on the left and its control on the right.
 */

/** One page: a title, an optional sentence, then its groups. */
export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }): ReactNode {
  return (
    <section className="flex flex-col gap-4 px-5 py-4">
      <div>
        <h3 className="text-[14px] font-semibold text-ink-0">{title}</h3>
        {description && <p className="mt-1 max-w-[60ch] text-[12px] text-pretty text-ink-2">{description}</p>}
      </div>
      {children}
    </section>
  )
}

/**
 * A captioned box of rows. The caption is a small heading above the box, so a page with three
 * groups reads as three things; the hairlines between rows are the box's own `divide-y`.
 */
export function Group({ title, note, children, className }: { title?: string; note?: ReactNode; children: ReactNode; className?: string }): ReactNode {
  return (
    <div className="flex flex-col gap-1.5">
      {(title || note) && (
        <div className="flex items-baseline justify-between gap-3 px-0.5">
          {title && <h4 className="text-[11px] font-semibold tracking-wide text-ink-1 uppercase">{title}</h4>}
          {note && <span className="text-[11px] text-ink-2">{note}</span>}
        </div>
      )}
      <div className={cn('flex flex-col divide-y divide-line overflow-hidden rounded-md border border-line bg-surface-0/40', className)}>
        {children}
      </div>
    </div>
  )
}

/** A line of small print under a group, or between rows when a row needs more than a hint. */
export function Note({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'danger' | 'success' }): ReactNode {
  return (
    <p
      className={cn(
        'px-0.5 text-[11px] text-pretty',
        tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-ink-2'
      )}
    >
      {children}
    </p>
  )
}

/** A label (and a hint under it) on the left, its control on the right. */
export function Row({ label, hint, children }: { label: string; hint?: ReactNode | undefined; children: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-11 items-center gap-4 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-ink-0">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] text-pretty text-ink-2">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

export function SwitchRow(props: { label: string; description: string; checked: boolean; disabled?: boolean; onChange(on: boolean): void }): ReactNode {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-4 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-ink-0">{props.label}</div>
        <p className="mt-0.5 text-[11px] text-pretty text-ink-2">{props.description}</p>
      </div>
      <Switch label={props.label} checked={props.checked} disabled={props.disabled} onChange={props.onChange} />
    </label>
  )
}

/**
 * A setting that lives on another page, named where someone would look for it. Not a second
 * control: every setting has one home, and this row is a signpost to it.
 */
export function LinkRow({ label, hint, action, onClick }: { label: string; hint?: string; action: string; onClick(): void }): ReactNode {
  return (
    <div className="flex min-h-11 items-center gap-4 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-ink-0">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] text-pretty text-ink-2">{hint}</div>}
      </div>
      <button
        type="button"
        onClick={onClick}
        className="t-fast flex shrink-0 items-center gap-0.5 rounded-sm px-1.5 py-1 text-[12px] text-accent hover:bg-surface-3"
      >
        {action}
        <ChevronRight aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  )
}

/** Moves Preferences to another page; set by the dialog so a page can point at another. */
export const PreferencesNavigation = createContext<((page: string) => void) | null>(null)

export function usePreferencesNavigation(): (page: string) => void {
  return useContext(PreferencesNavigation) ?? (() => undefined)
}
