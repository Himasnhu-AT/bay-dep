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
 *
 * Each segment carries its own horizontal padding and a hairline divides it from its
 * neighbour. Without them a text segment was exactly as wide as its word, and in a row whose
 * label takes the free space the control shrank to its content: "Dark", "Light" and "System"
 * read as one word, "DarkLightSystem". The divider hides beside the selected segment, whose
 * fill already marks the boundary.
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
        'flex h-7 items-stretch rounded-sm border border-line bg-surface-2 p-0.5',
        disabled && 'opacity-40',
        className
      )}
    >
      {options.map((option, index) => {
        const active = option.value === value
        const divided = index > 0 && !active && options[index - 1]?.value !== value
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
              't-fast relative flex min-w-fit flex-1 items-center justify-center rounded-xs text-[11px] whitespace-nowrap',
              option.icon ? 'px-2' : 'px-2.5',
              // The divider: a short hairline on the left edge, absent next to the selection.
              index > 0 &&
                'before:pointer-events-none before:absolute before:top-1 before:bottom-1 before:-left-px before:w-px before:bg-line-strong',
              !divided && 'before:opacity-0',
              active ? 'bg-accent/16 font-medium text-accent' : 'text-ink-1 hover:bg-surface-3 hover:text-ink-0',
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
