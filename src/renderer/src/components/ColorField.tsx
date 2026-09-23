import { useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface ColorFieldProps {
  label: string
  value: string
  onCommit(value: string): void
  disabled?: boolean
  className?: string
}

/** `#abc` and `#aabbcc`, with or without the hash. Anything else is not committed. */
function normalise(input: string): string | null {
  const hex = input.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toUpperCase()
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex}`.toUpperCase()
  return null
}

/**
 * A colour swatch beside a hex field.
 *
 * The native picker is the swatch, because writing one is a lot of code to reproduce
 * something the OS already does better — macOS gives eyedropper and system palettes for
 * free. The hex field exists beside it because a brand colour arrives as a string, and
 * typing it beats hunting for it in a wheel.
 *
 * Like the other controls here it commits on release rather than on every change: the
 * native picker fires continuously while a user drags through a gradient, and each one
 * would be its own undo step.
 */
export function ColorField({
  label,
  value,
  onCommit,
  disabled = false,
  className
}: ColorFieldProps): ReactNode {
  const [draft, setDraft] = useState<string | null>(null)
  const live = useRef(value)

  const swatch = normalise(value) ?? '#000000'

  return (
    <div
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-sm border border-line bg-surface-2 pl-1 t-fast',
        disabled
          ? 'opacity-40'
          : 'hover:border-line-strong focus-within:border-accent focus-within:ring-1 focus-within:ring-accent',
        className
      )}
    >
      <input
        type="color"
        aria-label={label}
        disabled={disabled}
        value={swatch}
        onChange={(event) => {
          live.current = event.target.value.toUpperCase()
          setDraft(live.current)
        }}
        onBlur={() => {
          setDraft(null)
          if (live.current !== value) onCommit(live.current)
        }}
        // `change` on a native colour input fires on close in some engines and on every
        // drag in others; committing on both, guarded by a value comparison, is the only
        // shape that behaves the same either way.
        onKeyUp={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        className="size-5 shrink-0 cursor-pointer appearance-none rounded-xs border border-line-strong bg-transparent p-0 disabled:cursor-not-allowed [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-xs [&::-webkit-color-swatch]:border-0"
      />
      <input
        aria-label={`${label} hex`}
        disabled={disabled}
        value={draft ?? value.toUpperCase()}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => setDraft(value.toUpperCase())}
        onBlur={() => {
          const next = draft === null ? null : normalise(draft)
          setDraft(null)
          // An unparseable hex reverts rather than committing a colour nothing can render.
          if (next && next !== value) onCommit(next)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(null)
            event.currentTarget.blur()
          }
        }}
        className="min-w-0 flex-1 bg-transparent pr-2 text-[11px] text-ink-0 uppercase tabular-nums outline-none disabled:cursor-not-allowed"
      />
    </div>
  )
}
