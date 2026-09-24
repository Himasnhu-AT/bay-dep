import type { InputHTMLAttributes, ReactNode, Ref } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Required: the accessible name. A visible caption comes from wrapping it in `Field`. */
  label: string
  ref?: Ref<HTMLInputElement>
  /** Monospace, for paths, ids and code. */
  mono?: boolean
  /** Draws the box in `danger`; put the message itself in a hint below. */
  invalid?: boolean
  /** Inside the box, before the text: an icon. */
  leading?: ReactNode
  /** Inside the box, after the text: a unit, a clear button. */
  trailing?: ReactNode
  /** Classes for the box (the bordered wrapper). */
  className?: string
  /** Classes for the `<input>` inside it. */
  inputClassName?: string
}

/**
 * A one-line text input. The ring is on the box (`focus-within`), like NumberField, Select and
 * ColorField, so a leading icon or trailing button sits inside the focused outline.
 * `h-7 rounded-sm border-line bg-surface-2 px-2 text-[12px]`. Props other than those below go
 * to the `<input>` itself (`value`, `onChange`, `onKeyDown`, `placeholder`, `autoFocus`…).
 */
export function TextField({
  label,
  ref,
  mono,
  invalid,
  leading,
  trailing,
  className,
  inputClassName,
  disabled,
  ...input
}: TextFieldProps): ReactNode {
  return (
    <div
      className={cn(
        't-fast flex h-7 min-w-0 items-center gap-1.5 rounded-sm border bg-surface-2 px-2',
        invalid
          ? 'border-danger focus-within:ring-1 focus-within:ring-danger'
          : 'border-line hover:border-line-strong focus-within:border-accent focus-within:ring-1 focus-within:ring-accent',
        disabled && 'pointer-events-none opacity-40',
        className
      )}
    >
      {leading && <span className="flex shrink-0 text-ink-2">{leading}</span>}
      <input
        ref={ref}
        aria-label={label}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        spellCheck={false}
        {...input}
        className={cn(
          'h-full w-full min-w-0 bg-transparent text-[12px] text-ink-0 outline-none placeholder:text-ink-2',
          mono && 'font-mono',
          inputClassName
        )}
      />
      {trailing}
    </div>
  )
}

export interface SearchFieldProps
  extends Omit<TextFieldProps, 'value' | 'onChange' | 'leading' | 'trailing' | 'type'> {
  value: string
  onValueChange(value: string): void
}

/**
 * A filter box: a leading search icon, a clear button whenever there is text, and Escape clears
 * it — and only when there is something to clear, so an empty field's Escape still reaches
 * whatever else Escape closes. A filter that stays applied with no visible way out reads as
 * "my things are gone", which is why the clear button is not optional.
 */
export function SearchField({ value, onValueChange, onKeyDown, ...props }: SearchFieldProps): ReactNode {
  return (
    <TextField
      {...props}
      type="search"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && value !== '') {
          event.stopPropagation()
          onValueChange('')
        }
        onKeyDown?.(event)
      }}
      leading={<Search aria-hidden="true" className="size-3.5" />}
      inputClassName={cn('[&::-webkit-search-cancel-button]:hidden', props.inputClassName)}
      trailing={
        value !== '' ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onValueChange('')}
            className="t-press grid size-5 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-surface-3 hover:text-ink-0 active:scale-[0.96]"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        ) : undefined
      }
    />
  )
}
