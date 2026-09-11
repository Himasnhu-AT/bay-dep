import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface SegmentedOption<T extends string> {
  value: T
  /** Shown when there is room; an icon-only segment still needs `label` for its name. */
  label: string
  icon?: ReactNode
}

export interface SegmentedControlProps<T extends string> {
  label: string
  value: T
  options: SegmentedOption<T>[]
  onChange(value: T): void
  disabled?: boolean
  className?: string
}

/**
 * A small set of mutually exclusive choices, all visible at once.
 *
 * A `Select` for three options hides two of them behind a click, and alignment is the kind
 * of property where seeing the alternatives is most of the control. `radiogroup` rather
 * than a row of buttons so the arrow keys work and a screen reader announces it as one
 * choice rather than three unrelated toggles.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className
}: SegmentedControlProps<T>): ReactNode {
  const move = (direction: number): void => {
    const index = options.findIndex((option) => option.value === value)
    const next = options[(index + direction + options.length) % options.length]
    if (next) onChange(next.value)
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => {
        if (disabled) return
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault()
          move(1)
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault()
          move(-1)
        }
      }}
      className={cn(
        'flex h-7 items-center gap-px rounded-sm border border-line bg-surface-2 p-px',
        disabled && 'opacity-40',
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            disabled={disabled}
            // Only the selected segment is in the tab order, which is how a radio group
            // behaves: one stop, then arrows within it.
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              't-fast flex h-full flex-1 items-center justify-center rounded-xs text-[11px]',
              active ? 'bg-accent/16 text-accent' : 'text-ink-1 hover:bg-surface-3 hover:text-ink-0',
              disabled && 'pointer-events-none'
            )}
          >
            {option.icon ?? option.label}
          </button>
        )
      })}
    </div>
  )
}
