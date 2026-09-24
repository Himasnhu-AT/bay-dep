import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface SelectOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

export interface SelectProps<T extends string> {
  label: string
  value: T
  options: SelectOption<T>[]
  onChange(value: T): void
  disabled?: boolean
  className?: string
}

/**
 * A native `<select>` with the platform chrome stripped. The menu itself stays native:
 * macOS draws it in the system dark appearance, it is keyboard-accessible for free, and
 * a hand-rolled listbox is a lot of code to get a popup that is marginally darker.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className
}: SelectProps<T>): ReactNode {
  return (
    <div
      className={cn(
        'relative flex h-7 items-center rounded-sm border border-line bg-surface-2 t-fast',
        disabled
          ? 'opacity-40'
          : 'hover:border-line-strong focus-within:border-accent focus-within:ring-1 focus-within:ring-accent',
        className
      )}
    >
      <select
        aria-label={label}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-full w-full cursor-pointer appearance-none bg-transparent pl-2 pr-6 text-[12px] text-ink-0 outline-none disabled:cursor-not-allowed"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-1.5 size-3.5 text-ink-2"
      />
    </div>
  )
}
