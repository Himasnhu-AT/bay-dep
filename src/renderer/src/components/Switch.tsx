import type { ReactNode } from 'react'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface SwitchProps {
  checked: boolean
  onChange(checked: boolean): void
  /**
   * The accessible name. Required unless `id` is given and a `<label htmlFor={id}>` names it —
   * a visible caption elsewhere is not a name until it is associated.
   */
  label?: string
  id?: string
  disabled?: boolean
  className?: string
}

/**
 * An on/off setting that takes effect at once (`role="switch"`). For a choice that is only
 * applied later — an option in a form, one of several in a list — use `Checkbox`.
 *
 * `h-5 w-9`: on is `accent` with an `accent-ink` knob, off is `surface-3` with an `ink-0` knob.
 * The knob slides with `t-fast`-timed motion, which the reduced-motion rule zeroes.
 */
export function Switch({ checked, onChange, label, id, disabled, className }: SwitchProps): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'no-drag t-press relative h-5 w-9 shrink-0 rounded-full border active:scale-[0.96]',
        'disabled:pointer-events-none disabled:opacity-40',
        checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface-3 hover:border-line-hover',
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-[2px] left-[2px] size-3.5 rounded-full',
          'transition-[translate,background-color] duration-(--duration-fast) ease-[cubic-bezier(0.2,0,0,1)]',
          checked ? 'translate-x-4 bg-accent-ink' : 'translate-x-0 bg-ink-0'
        )}
      />
    </button>
  )
}

export interface CheckboxProps {
  /** `'mixed'` for a parent row whose children disagree. */
  checked: boolean | 'mixed'
  onChange(checked: boolean): void
  /** Visible text beside the box. It names the checkbox, and clicking it toggles. */
  label?: ReactNode
  /** Accessible name when there is no visible `label`. */
  ariaLabel?: string
  disabled?: boolean
  className?: string
}

/**
 * A checkbox: an option in a form or a row in a multi-select list. `rounded-xs`, the same
 * tokens as `Switch`. With `label` it renders as a `<label>` around the box, so the whole line
 * is the hit target; a `'mixed'` box toggles to checked.
 */
export function Checkbox({ checked, onChange, label, ariaLabel, disabled, className }: CheckboxProps): ReactNode {
  const on = checked === true
  const box = (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked === 'mixed' ? 'mixed' : on}
      aria-label={label === undefined ? ariaLabel : undefined}
      disabled={disabled}
      onClick={() => onChange(checked !== true)}
      className={cn(
        'no-drag t-press flex size-3.5 shrink-0 items-center justify-center rounded-xs border active:scale-[0.96]',
        // With a label, the label dims the whole line; dimming the box again would halve it.
        'disabled:pointer-events-none',
        label === undefined && 'disabled:opacity-40',
        checked !== false
          ? 'border-accent bg-accent text-accent-ink'
          : 'border-line-strong bg-surface-2 hover:border-line-hover',
        label === undefined && className
      )}
    >
      {checked === 'mixed' ? (
        <Minus aria-hidden="true" className="size-3" strokeWidth={3} />
      ) : on ? (
        <Check aria-hidden="true" className="size-3" strokeWidth={3} />
      ) : null}
    </button>
  )
  if (label === undefined) return box
  return (
    <label
      className={cn(
        'inline-flex cursor-default items-center gap-2 text-[12px] text-ink-0',
        disabled && 'opacity-40',
        className
      )}
    >
      {box}
      <span className="min-w-0">{label}</span>
    </label>
  )
}
