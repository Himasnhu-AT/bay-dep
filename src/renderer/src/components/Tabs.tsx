import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface TabItem<T extends string> {
  value: T
  label: string
  icon?: ReactNode
  /** A small count beside the label (sections with changes, markers, hits). */
  badge?: number
  /** Greyed rather than hidden, as Resolve does, so the tabs never shift under the pointer. */
  disabled?: boolean
  /** Why it is disabled, in the tooltip. */
  hint?: string
}

export interface TabsProps<T extends string> {
  /** Names the tab list for assistive tech. */
  label: string
  value: T
  items: readonly TabItem<T>[]
  onChange(value: T): void
  /** `bar` is a panel header strip; `pill` is the compact form inside a panel. */
  variant?: 'bar' | 'pill'
  /** Hide labels and show icons only (the label stays as the accessible name and tooltip). */
  iconsOnly?: boolean
  className?: string
}

/**
 * A row of tabs heading a panel: the inspector's Video / Audio / Effects…, the library's
 * Media Pool / Effects / Index. Arrow keys move between enabled tabs; the chosen tab is the one
 * tab stop, as in a radio group.
 */
export function Tabs<T extends string>({
  label,
  value,
  items,
  onChange,
  variant = 'bar',
  iconsOnly = false,
  className
}: TabsProps<T>): ReactNode {
  const enabled = items.filter((item) => !item.disabled)
  const move = (direction: number): void => {
    const index = enabled.findIndex((item) => item.value === value)
    const next = enabled[(index + direction + enabled.length) % enabled.length]
    if (next) onChange(next.value)
  }
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          move(1)
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault()
          move(-1)
        }
      }}
      className={cn(
        'flex min-w-0 shrink-0 items-stretch',
        variant === 'bar' ? 'h-8 gap-0 border-b border-line bg-chrome px-1' : 'h-7 gap-0.5 rounded-sm bg-surface-2 p-0.5',
        className
      )}
    >
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={iconsOnly ? item.label : undefined}
            title={item.disabled ? (item.hint ?? item.label) : iconsOnly ? item.label : undefined}
            disabled={item.disabled}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={cn(
              't-fast relative flex min-w-0 items-center justify-center gap-1.5 px-2 text-[11px] font-medium whitespace-nowrap',
              'disabled:pointer-events-none disabled:text-ink-3',
              variant === 'bar'
                ? active
                  ? 'text-ink-0 after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent'
                  : 'text-ink-2 hover:text-ink-0'
                : active
                  ? 'rounded-xs bg-surface-4 text-ink-0'
                  : 'rounded-xs text-ink-1 hover:text-ink-0'
            )}
          >
            {item.icon}
            {!iconsOnly && <span className="truncate">{item.label}</span>}
            {item.badge !== undefined && item.badge > 0 && (
              <span className="rounded-full bg-surface-4 px-1 font-mono text-[9px] leading-[14px] text-ink-1">
                {item.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
