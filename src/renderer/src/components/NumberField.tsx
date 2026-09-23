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
  className
}: NumberFieldProps): ReactNode {
  const inputRef = useRef<HTMLInputElement>(null)
  // While dragging or typing the field shows its own value; otherwise it mirrors the store.
  const [draft, setDraft] = useState<string | null>(null)
  const dragStart = useRef(0)

  const display = draft ?? (mixed ? 'Mixed' : value.toFixed(precision))

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
      setDraft(next.toFixed(precision))
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

  return (
    <div
      className={cn(
        'flex h-7 items-center rounded-sm border border-line bg-surface-2 t-fast',
        // The global focus ring is a 2px accent outline; a composite control's input has its
        // outline off (the box is the control), so the box carries the same 2px here — a 1px
        // border at 70% was the weakest focus indicator in the app.
        'focus-within:border-accent focus-within:ring-1 focus-within:ring-accent',
        disabled ? 'opacity-40' : 'hover:border-line-strong',
        className
      )}
    >
      <span
        aria-hidden="true"
        onPointerDown={disabled ? undefined : onPointerDown}
        className={cn(
          'shrink-0 pl-2 pr-1.5 text-[11px] leading-none text-ink-2 select-none',
          !disabled && 'cursor-ew-resize hover:text-ink-1'
        )}
      >
        {label}
      </span>
      <input
        ref={inputRef}
        aria-label={label}
        disabled={disabled}
        inputMode="decimal"
        value={display}
        className="min-w-0 flex-1 bg-transparent pr-2 text-right text-[12px] text-ink-0 tabular-nums outline-none disabled:cursor-not-allowed"
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => setDraft(mixed ? '' : value.toFixed(precision))}
        onBlur={() => {
          const parsed = Number(draft)
          setDraft(null)
          if (draft !== null && draft.trim() !== '' && Number.isFinite(parsed)) commit(parsed)
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
            const base = draft !== null && draft !== '' ? Number(draft) : value
            if (!Number.isFinite(base)) return
            const next = clamp(base + direction * step * scale, min, max)
            setDraft(next.toFixed(precision))
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
}
