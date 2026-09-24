import type { ReactNode } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/cn'

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

const BADGE_TONES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-1',
  accent: 'bg-accent/15 text-accent',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger'
}

export interface BadgeProps {
  tone?: Tone
  children: ReactNode
  className?: string
}

/**
 * A short status beside a name — "In use", "Installed", "Missing". Sentence case, 10px, square
 * (`rounded-xs`): a state, not a pill and not an eyebrow. If it says nothing a person would act
 * on or check, it should not be there.
 */
export function Badge({ tone = 'neutral', children, className }: BadgeProps): ReactNode {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-xs px-1.5 py-px text-[10px] font-medium whitespace-nowrap',
        BADGE_TONES[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

export interface ProgressBarProps {
  /** 0…1, or null while the total is unknown (drawn as an unfilled track with `aria-busy`). */
  value: number | null
  /** The accessible name — "Downloading base.en". */
  label: string
  className?: string
}

/** A thin determinate bar: `h-1` `surface-3` track, `accent` fill, `role="progressbar"`. */
export function ProgressBar({ value, label, className }: ProgressBarProps): ReactNode {
  const fraction = value === null || !Number.isFinite(value) ? null : Math.min(1, Math.max(0, value))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
      aria-busy={fraction === null || undefined}
      className={cn('h-1 w-full overflow-hidden rounded-full bg-surface-3', className)}
    >
      {fraction !== null && (
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: `${fraction * 100}%` }}
        />
      )}
    </div>
  )
}

export type AlertTone = 'notice' | 'warning' | 'danger'

const ALERT_TONES: Record<AlertTone, string> = {
  notice: 'border-line-strong bg-surface-2 text-ink-1',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  danger: 'border-danger/40 bg-danger/10 text-danger'
}

const ALERT_ICONS: Record<AlertTone, typeof Info> = {
  notice: Info,
  warning: AlertTriangle,
  danger: AlertTriangle
}

export interface InlineAlertProps {
  tone: AlertTone
  children: ReactNode
  /** Replaces the tone's icon; `null` for none. */
  icon?: ReactNode
  className?: string
}

/**
 * A tinted block inside a panel or dialog that says something is off and what to do about it.
 * `danger`: it cannot be done. `warning`: it will be done differently from what was asked.
 * `notice`: worth knowing, nothing wrong. Never `accent` — the accent means "selected", not
 * "careful".
 */
export function InlineAlert({ tone, children, icon, className }: InlineAlertProps): ReactNode {
  const Icon = ALERT_ICONS[tone]
  return (
    // No live-region role: these sit in the reading order beside what they explain, and an
    // `alert` would re-announce on every re-render of a dialog that is being edited.
    <div
      className={cn(
        'flex items-start gap-1.5 rounded-sm border p-2 text-[11px] leading-relaxed text-pretty',
        ALERT_TONES[tone],
        className
      )}
    >
      {icon === undefined ? <Icon aria-hidden="true" className="mt-px size-3.5 shrink-0" /> : icon}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
