import { useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useDrag } from '@/lib/useDrag'
import { useGestureBracket, useWheelSteps, type Gesture } from './gesture'
import { clamp, committable, createDragAccumulator, dragValue, keyStep, modifiersOf } from './values'

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
  /**
   * Called with the text when what was typed is not a value (`parse` said null), so the caller can
   * say what the field accepts. Without it the field quietly puts the old value back.
   */
  onInvalid?(text: string): void
  /**
   * Called when a typed or dragged value was outside `min`..`max` and was held to the limit, with
   * what was asked and what was kept — so the caller can say so instead of the number silently
   * changing under the person who typed it.
   */
  onClamp?(asked: number, kept: number): void
  /** Accessible name when the visible label is an abbreviation. */
  ariaLabel?: string
  /**
   * What a double-click on the label puts back, as one commit (one undo step). Without it a
   * double-click does nothing.
   */
  defaultValue?: number
  /**
   * The caller's live-edit bracket (`beginGesture`/`endGesture`). With one, a drag commits on
   * every move so the preview follows it, and is still one undo step; without one it commits
   * once, on release. See `Gesture`.
   */
  gesture?: Gesture
  /** The scroll wheel steps the value while the field is hovered and focused. Default true. */
  wheel?: boolean
  /** What a screen reader hears for a value, when the box's text is not a sentence (a timecode). */
  valueText?(value: number): string
}

/**
 * A number you can drag. Every NLE has this and its absence is immediately felt: without
 * it, nudging a clip's position means select-all, type, tab, repeat.
 *
 * Drag the label (or type in the box); Shift is coarse (×10), Cmd/Ctrl or Alt is fine (×0.1) —
 * for the drag, the arrow keys and the wheel alike (`MODIFIER_SCALE`). Double-click the label to
 * reset to `defaultValue`.
 *
 * **Live, one undo step per gesture.** The store snapshots the whole project for undo on each
 * mutation, so writing through on every move would bury the previous state under four hundred
 * one-pixel edits. A caller that passes `gesture` (the store's `beginGesture`/`endGesture`) gets
 * a live preview during the drag that still lands as one step; a caller that does not gets one
 * commit on release.
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
  onInvalid,
  onClamp,
  ariaLabel,
  defaultValue,
  gesture,
  wheel = true,
  valueText
}: NumberFieldProps): ReactNode {
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  // While dragging or typing the field shows its own value; otherwise it mirrors the store.
  const [draft, setDraft] = useState<string | null>(null)
  const drag = useRef(createDragAccumulator(0))
  // Escape blurs to leave the field; the blur must then neither commit nor complain about what
  // was typed. Read from a ref because the blur runs inside the same key event, before the
  // `setDraft(null)` above it has re-rendered the handler.
  const cancelling = useRef(false)
  const bracket = useGestureBracket(gesture)

  const shown = (n: number): string => (format ? format(n) : n.toFixed(precision))
  const read = (text: string): number | null => {
    if (text.trim() === '') return null
    const parsed = parse ? parse(text) : Number(text)
    return parsed !== null && Number.isFinite(parsed) ? parsed : null
  }
  const display = draft ?? (mixed ? 'Mixed' : shown(value))

  /** `live` commits are the moves inside a gesture: they write, but do not report a clamp. */
  const commit = (next: number, live = false): void => {
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
    const safe = committable(rounded)
    if (safe === null) return
    onCommit(safe)
    if (live) return
    // After the commit, so a caller that clears its note on every commit still shows this one.
    const asked = Number(next.toFixed(precision))
    if (Number.isFinite(asked) && asked !== rounded) onClamp?.(asked, rounded)
  }

  /** The drag so far, each move scaled by the modifier held during it (`createDragAccumulator`). */
  const dragged = (state: { dx: number; shift: boolean; alt: boolean; meta: boolean }): number =>
    drag.current.move(state.dx, 0, (ddx) => dragValue(0, ddx, step, state))

  const onPointerDown = useDrag({
    onStart: () => {
      if (disabled) return
      drag.current = createDragAccumulator(value)
      // A drag that starts on a 40px label and travels 300px must not look like a
      // text-selection gesture halfway across the inspector.
      document.body.style.cursor = 'ew-resize'
    },
    onMove: (state) => {
      if (disabled) return
      const next = clamp(dragged(state), min, max)
      setDraft(shown(Number(next.toFixed(precision))))
      if (bracket.live && state.travel >= 3) {
        bracket.begin()
        commit(next, true)
      }
    },
    onEnd: (state) => {
      document.body.style.cursor = ''
      if (disabled) {
        bracket.end()
        return
      }
      setDraft(null)
      commit(dragged(state))
      bracket.end()
    },
    onClick: () => {
      document.body.style.cursor = ''
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  })

  /** One arrow press or wheel notch: `steps` increments with the held modifier. */
  const nudge = (steps: number, mods: { shift: boolean; alt: boolean; meta: boolean }, fromDraft: boolean): void => {
    const base = fromDraft && draft !== null && draft !== '' ? read(draft) : value
    if (base === null || !Number.isFinite(base)) return
    const next = clamp(base + steps * keyStep(step, mods, precision), min, max)
    if (fromDraft) setDraft(shown(Number(next.toFixed(precision))))
    commit(next)
  }

  useWheelSteps(boxRef, wheel && !disabled && !mixed, (steps, mods) => {
    if (bracket.live) bracket.touch()
    nudge(steps, mods, true)
  }, bracket.rest)

  const reset = (): void => {
    if (disabled || defaultValue === undefined) return
    // A double-click's first click focused the box with the old value as its draft; leaving
    // that draft would commit the old value straight back on blur.
    if (document.activeElement === inputRef.current) {
      cancelling.current = true
      inputRef.current?.blur()
    }
    setDraft(null)
    commit(defaultValue)
  }

  const handle = (
    <span
      aria-hidden="true"
      onPointerDown={disabled ? undefined : onPointerDown}
      onDoubleClick={reset}
      title={defaultValue !== undefined && !disabled ? `Drag to change · double-click to reset to ${shown(defaultValue)}${suffix ? ` ${suffix}` : ''}` : undefined}
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
      ref={boxRef}
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
        role="spinbutton"
        aria-label={ariaLabel ?? label}
        aria-valuenow={mixed || !Number.isFinite(value) ? undefined : value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={mixed ? 'Mixed' : valueText ? valueText(value) : `${shown(value)}${suffix ? ` ${suffix}` : ''}`}
        aria-disabled={disabled || undefined}
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
          const cancelled = cancelling.current
          cancelling.current = false
          const parsed = draft === null || cancelled ? null : read(draft)
          setDraft(null)
          if (cancelled) return
          if (parsed !== null) commit(parsed)
          else if (draft !== null && draft.trim() !== '') onInvalid?.(draft)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            cancelling.current = true
            setDraft(null)
            event.currentTarget.blur()
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            nudge(event.key === 'ArrowUp' ? 1 : -1, modifiersOf(event), true)
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
