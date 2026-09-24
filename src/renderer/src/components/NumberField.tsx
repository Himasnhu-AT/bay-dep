import { useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useDrag } from '@/lib/useDrag'

export interface NumberFieldProps {
  label: string
  value: number
  onCommit(value: number): void
  /** Units per pixel of horizontal drag, and the arrow-key increment. */
  step?: number
  min?: number
  max?: number
  /** Decimal places shown. Values are rounded to this before committing. */
  precision?: number
  suffix?: string
  disabled?: boolean
  /** Multi-selection where the selected items disagree: shows "Mixed" until edited. */
  mixed?: boolean
  className?: string
  /**
   * Label beside the box, in the 64px column every `Field` and `SliderField` uses, instead of
   * inside it. The inspector's rows use this: inside the box the label and suffix took the
   * width the digits needed, and a half-width W field read "19" for 1920.
   */
  row?: boolean
  /** What the box shows for a value — a timecode for a frame count. Default: `toFixed(precision)`. */
  format?(value: number): string
  /** Reads what was typed back to a value; null when it is not one. Default: `Number`. */
  parse?(text: string): number | null
  /** Accessible name when the visible label is an abbreviation. */
  ariaLabel?: string
}

function clamp(value: number, min: number | undefined, max: number | undefined): number {
  let out = value
  if (min !== undefined) out = Math.max(min, out)
  if (max !== undefined) out = Math.min(max, out)
  return out
}

/**
 * A number you can drag. Every NLE has this and its absence is immediately felt: without
 * it, nudging a clip's position means select-all, type, tab, repeat.
 *
 * **It commits on release, not on every move.** The store snapshots the whole project for
 * undo on each mutation, so writing through on `pointermove` would bury the previous state
 * under four hundred one-pixel edits. The trade is that the preview does not update live
 * during a drag — that needs a transient-edit mode on the store, which does not exist yet.
 */
export function NumberField({
  label,
  value,
  onCommit,
  step = 1,
  min,
  max,
  precision = 0,
  suffix,
  disabled = false,
  mixed = false,
  className,
  row = false,
  format,
  parse,
  ariaLabel
}: NumberFieldProps): ReactNode {
  const inputRef = useRef<HTMLInputElement>(null)
  // While dragging or typing the field shows its own value; otherwise it mirrors the store.
  const [draft, setDraft] = useState<string | null>(null)
  const dragStart = useRef(0)

  const shown = (n: number): string => (format ? format(n) : n.toFixed(precision))
  const read = (text: string): number | null => {
    if (text.trim() === '') return null
    const parsed = parse ? parse(text) : Number(text)
    return parsed !== null && Number.isFinite(parsed) ? parsed : null
  }
  const display = draft ?? (mixed ? 'Mixed' : shown(value))

  const commit = (next: number): void => {
    const rounded = Number(clamp(next, min, max).toFixed(precision))
    // Not defensive — measured. Every *typed* route into here is already gated by a
    // `Number.isFinite` at its call site, so it is tempting to read this as unreachable and
    // delete it. The reachable input is a non-finite value arriving from the store: drag
    // the label of a field whose value is NaN and the arithmetic stays NaN all the way in.
    //
    // Told apart differentially, with the undo stack as the observable, because the value
    // is NaN both before and after and cannot distinguish "wrote" from "returned early":
    // without this line, seeding `layout.left = NaN` and dragging takes `past` 3 -> 4 and
    // commits NaN to the project; with it, 3 -> 3.
    if (!Number.isFinite(rounded)) return
    onCommit(rounded)
  }

  const onPointerDown = useDrag({
    onStart: () => {
      if (disabled) return
      dragStart.current = value
      // A drag that starts on a 40px label and travels 300px must not look like a
      // text-selection gesture halfway across the inspector.
      document.body.style.cursor = 'ew-resize'
    },
    onMove: (state) => {
      if (disabled) return
      // Shift is fine (1/10), Alt is coarse (10×) — the convention every editor shares.
      const scale = state.shift ? 0.1 : state.alt ? 10 : 1
      const next = clamp(dragStart.current + state.dx * step * scale, min, max)
      setDraft(shown(Number(next.toFixed(precision))))
    },
    onEnd: (state) => {
      document.body.style.cursor = ''
      if (disabled) return
      const scale = state.shift ? 0.1 : state.alt ? 10 : 1
      setDraft(null)
      commit(dragStart.current + state.dx * step * scale)
    },
    onClick: () => {
      document.body.style.cursor = ''
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  })

  const handle = (
    <span
      aria-hidden="true"
      onPointerDown={disabled ? undefined : onPointerDown}
      className={cn(
        'shrink-0 text-[11px] select-none',
        // Two lines rather than an ellipsis: "Letter spacing" is wider than the column, and
        // "Letter spa…" names nothing. Two 11px lines still fit the 28px row.
        row ? 'line-clamp-2 leading-tight text-ink-1' : 'pl-2 pr-1.5 leading-none text-ink-2',
        !disabled && 'cursor-ew-resize hover:text-ink-0'
      )}
    >
      {label}
    </span>
  )

  const box = (
    <div
      className={cn(
        'flex h-7 min-w-0 items-center rounded-sm border border-line bg-surface-2 t-fast',
        // The global focus ring is a 2px accent outline; a composite control's input has its
        // outline off (the box is the control), so the box carries the same 2px here — a 1px
        // border at 70% was the weakest focus indicator in the app.
        'focus-within:border-accent focus-within:ring-1 focus-within:ring-accent',
        disabled ? 'opacity-40' : 'hover:border-line-strong',
        !row && className
      )}
    >
      {!row && handle}
      <input
        ref={inputRef}
        aria-label={ariaLabel ?? label}
        disabled={disabled}
        inputMode="decimal"
        value={display}
        className={cn(
          'min-w-0 flex-1 bg-transparent pr-2 text-right text-[12px] text-ink-0 tabular-nums outline-none disabled:cursor-not-allowed',
          row && 'pl-2'
        )}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => setDraft(mixed ? '' : shown(value))}
        onBlur={() => {
          const parsed = draft === null ? null : read(draft)
          setDraft(null)
          if (parsed !== null) commit(parsed)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            setDraft(null)
            event.currentTarget.blur()
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            const direction = event.key === 'ArrowUp' ? 1 : -1
            const scale = event.shiftKey ? 10 : 1
            const base = draft !== null && draft !== '' ? read(draft) : value
            if (base === null || !Number.isFinite(base)) return
            const next = clamp(base + direction * step * scale, min, max)
            setDraft(shown(Number(next.toFixed(precision))))
            commit(next)
          }
        }}
      />
      {suffix && (
        <span aria-hidden="true" className="shrink-0 pr-2 text-[11px] text-ink-2">
          {suffix}
        </span>
      )}
    </div>
  )

  if (!row) return box
  return (
    <div className={cn('grid grid-cols-[64px_1fr] items-center gap-2', className)}>
      {handle}
      {box}
    </div>
  )
}
