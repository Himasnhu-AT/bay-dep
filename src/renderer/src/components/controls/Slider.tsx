import { useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useDrag } from '@/lib/useDrag'
import { Field } from '../Panel'
import { useGestureBracket, useWheelSteps, type Gesture } from './gesture'
import { clamp, decimalsOf, guardCommit, keyStep, modifiersOf, roundTo, MODIFIER_SCALE, type Modifiers } from './values'

export interface SliderProps {
  label: string
  value: number
  onCommit(value: number): void
  /** Fires continuously while dragging, for a readout that must track the thumb. */
  onInput?(value: number): void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  className?: string
  /**
   * Where the fill starts: `min` by default. A control with a neutral value inside its range
   * (pan at 0, brightness at 1, temperature at 0) fills from that value, so the bar shows which
   * way and how far rather than a level that is not there — filled from the left, every neutral
   * temperature and lift read as "half on". A tick marks the neutral point.
   */
  origin?: number
  /** Shorthand for `origin` at the middle of the range, for a symmetric control (-1…1). */
  bipolar?: boolean
  /** What a double-click on the track puts back, as one commit. Without it, nothing. */
  defaultValue?: number
  /** Live edits during a drag, as one undo step — see `Gesture`. */
  gesture?: Gesture
  /** The spoken value (`aria-valuetext`): the readout's text, with its unit. */
  valueText?(value: number): string
  /** A multi-selection that disagrees: the thumb goes hollow. */
  mixed?: boolean
  /** The scroll wheel steps the value while hovered and focused. Default true. */
  wheel?: boolean
}

/**
 * The track range for a control with a neutral value: `neutral` sits `reach` from each end, so an
 * untouched control's thumb rests on the neutral tick. A control whose stored range is lopsided
 * around its neutral (Gamma −0.9…4 at 0, Brightness 0…3 at 1) otherwise put its thumb at a fifth
 * or a third of the track, where it read as "turned down". The range stretches to include `value`,
 * so a value set past it (by the agent, whose range is wider) is shown where it is and an arrow key
 * moves it by a step instead of snapping it back to the end; `limit` keeps the track inside what
 * the field accepts.
 */
export function centredRange(
  neutral: number,
  reach: number,
  value: number,
  limit: { min: number; max: number } = { min: -Infinity, max: Infinity }
): { min: number; max: number; origin: number } {
  const shown = Number.isFinite(value) ? value : neutral
  return {
    min: Math.max(limit.min, Math.min(neutral - reach, shown)),
    max: Math.min(limit.max, Math.max(neutral + reach, shown)),
    origin: neutral
  }
}

/**
 * Drag-to-set, and the whole track is the target — a 10px thumb you have to hit first is
 * the difference between adjusting a fade and hunting for a handle.
 *
 * Keys: arrows step (Shift ×10, Cmd/Ctrl or Alt ×0.1, as everywhere in the kit), PageUp/PageDown
 * step ×10, Home/End go to the ends. A drag with Cmd/Ctrl or Alt held is fine: the value moves a
 * tenth as far as the pointer. Double-click resets to `defaultValue`.
 *
 * With a `gesture` the drag lands live and is one undo step; without one it commits on release.
 * Either way an opacity drag across a panel is one undo step, not two hundred.
 */
export function Slider({
  label,
  value,
  onCommit,
  onInput,
  min = 0,
  max = 1,
  step = 0.01,
  disabled = false,
  className,
  origin: originProp,
  bipolar = false,
  defaultValue,
  gesture,
  valueText,
  mixed = false,
  wheel = true
}: SliderProps): ReactNode {
  const commit = guardCommit(onCommit)
  const origin = originProp ?? (bipolar ? (min + max) / 2 : undefined)
  const trackRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<number | null>(null)
  const bracket = useGestureBracket(gesture)
  const current = draft ?? value
  const fraction = max > min ? (current - min) / (max - min) : 0
  const originFraction = origin !== undefined && max > min ? (origin - min) / (max - min) : 0
  const fillFrom = Math.max(0, Math.min(1, Math.min(originFraction, fraction)))
  const fillTo = Math.max(0, Math.min(1, Math.max(originFraction, fraction)))
  const decimals = decimalsOf(step)
  // The second press of a double-click must not set the value where it landed: the reset follows.
  const pressCount = useRef(0)
  const dragStart = useRef({ x: 0, value: 0 })
  const hollow = mixed && draft === null

  const valueAt = (clientX: number): number => {
    const track = trackRef.current
    if (!track) return current
    const box = track.getBoundingClientRect()
    if (box.width <= 0) return current
    const raw = min + ((clientX - box.left) / box.width) * (max - min)
    const snapped = Math.round(raw / step) * step
    // Floating-point step arithmetic leaves 0.30000000000000004 behind; the decimals of
    // `step` are exactly how many the result is allowed to keep.
    return roundTo(clamp(snapped, min, max), decimals)
  }

  /** Where a drag has reached: under the pointer, or — with a fine modifier — a tenth as far. */
  const reached = (x: number, mods: Modifiers): number => {
    if (!(mods.alt || mods.meta)) return valueAt(x)
    const width = trackRef.current?.getBoundingClientRect().width ?? 0
    if (width <= 0) return current
    const delta = ((x - dragStart.current.x) / width) * (max - min) * MODIFIER_SCALE.fine
    return roundTo(clamp(Math.round((dragStart.current.value + delta) / step) * step, min, max), decimals)
  }

  const onPointerDown = useDrag({
    onStart: (state, event) => {
      pressCount.current = event.detail
      if (disabled || event.detail >= 2) return
      dragStart.current = { x: state.x, value: current }
      if (state.alt || state.meta) return
      const next = valueAt(state.x)
      setDraft(next)
      onInput?.(next)
    },
    onMove: (state) => {
      if (disabled || pressCount.current >= 2) return
      const next = reached(state.x, state)
      setDraft(next)
      onInput?.(next)
      if (bracket.live) {
        bracket.begin()
        commit(next)
      }
    },
    onEnd: (state) => {
      if (disabled || pressCount.current >= 2) {
        bracket.end()
        return
      }
      setDraft(null)
      commit(reached(state.x, state))
      bracket.end()
    },
    // A click is still a set: the pointer landed somewhere on the track on purpose.
    onClick: (state) => {
      if (disabled || pressCount.current >= 2 || state.alt || state.meta) return
      setDraft(null)
      commit(valueAt(state.x))
    }
  })

  const commitKey = (next: number): void => commit(roundTo(clamp(next, min, max), decimals))

  useWheelSteps(trackRef, wheel && !disabled, (steps, mods) => {
    if (bracket.live) bracket.touch()
    commitKey(current + steps * keyStep(step, mods, decimals))
  }, bracket.rest)

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(current.toFixed(3))}
      aria-valuetext={hollow ? 'Mixed' : valueText?.(current)}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={disabled ? undefined : onPointerDown}
      onDoubleClick={() => {
        if (disabled || defaultValue === undefined) return
        setDraft(null)
        commitKey(defaultValue)
      }}
      onKeyDown={(event) => {
        if (disabled) return
        const one = keyStep(step, modifiersOf(event), decimals)
        let next: number | null = null
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = current - one
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = current + one
        if (event.key === 'PageDown') next = current - step * MODIFIER_SCALE.coarse
        if (event.key === 'PageUp') next = current + step * MODIFIER_SCALE.coarse
        if (event.key === 'Home') next = min
        if (event.key === 'End') next = max
        if (next === null) return
        event.preventDefault()
        commitKey(next)
      }}
      title={defaultValue !== undefined && !disabled ? 'Double-click to reset' : undefined}
      className={cn(
        'group relative flex h-7 w-full items-center rounded-sm',
        disabled ? 'opacity-40' : 'cursor-pointer',
        className
      )}
    >
      <div className="relative h-[3px] w-full rounded-full bg-surface-3">
        {origin !== undefined && originFraction > 0 && originFraction < 1 && (
          <div
            aria-hidden="true"
            className="absolute top-1/2 h-[9px] w-px -translate-x-1/2 -translate-y-1/2 bg-line-hover"
            style={{ left: `${originFraction * 100}%` }}
          />
        )}
        {!hollow && (
          <div
            className="absolute inset-y-0 rounded-full bg-accent/85"
            style={{ left: `${fillFrom * 100}%`, width: `${(fillTo - fillFrom) * 100}%` }}
          />
        )}
        <div
          className={cn(
            'absolute top-1/2 size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full t-press',
            // Hollow for a selection that disagrees: the thumb sits at the first clip's value,
            // which is not every clip's.
            hollow ? 'border-2 border-ink-1 bg-surface-1' : 'border border-surface-0 bg-ink-0',
            // Grows rather than changing colour: a literal white vanished into the light
            // theme's surface-3, and ink-0 is already the strongest ink in either theme.
            !disabled && 'group-hover:scale-[1.2]'
          )}
          style={{ left: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
        />
      </div>
    </div>
  )
}

export interface SliderFieldProps extends Omit<SliderProps, 'label' | 'onInput' | 'valueText'> {
  /** The visible caption, kept short enough for the Field's 64px label column. */
  label: string
  /** The accessible name, when it needs more than the caption (units, a longer word). */
  ariaLabel?: string
  /** The readout beside the track. Receives the live value while dragging. */
  format(value: number): string
}

/**
 * A captioned slider with a live readout — the row every inspector slider should be.
 *
 * A bare `Slider` carries its name only in `aria-label`, so a stack of them is a column of
 * identical lines: eight in Adjustments and ten in Grade shipped that way, and the only way to
 * tell Brightness from Contrast was to drag one and watch the picture. The readout has a fixed
 * width so every track in a section ends on the same line whatever the value's length.
 *
 * Double-click the caption, the track or the readout to reset to `defaultValue`.
 */
export function SliderField({
  label,
  ariaLabel,
  format,
  mixed = false,
  value,
  onCommit,
  defaultValue,
  disabled,
  ...slider
}: SliderFieldProps): ReactNode {
  const [live, setLive] = useState<number | null>(null)
  const shown = live ?? value
  const reset = (): void => {
    if (disabled || defaultValue === undefined) return
    onCommit(defaultValue)
  }
  const resetTitle = defaultValue !== undefined && !disabled ? `Double-click to reset to ${format(defaultValue)}` : undefined
  return (
    <Field
      label={
        <span onDoubleClick={reset} title={resetTitle} className={cn(defaultValue !== undefined && !disabled && 'cursor-default')}>
          {label}
        </span>
      }
      hint={
        <span className="inline-block w-11 text-right" onDoubleClick={reset} title={resetTitle}>
          {mixed && live === null ? 'Mixed' : format(shown)}
        </span>
      }
    >
      <Slider
        {...slider}
        disabled={disabled}
        mixed={mixed}
        defaultValue={defaultValue}
        label={ariaLabel ?? label}
        value={value}
        valueText={format}
        onInput={setLive}
        onCommit={(next) => {
          setLive(null)
          onCommit(next)
        }}
      />
    </Field>
  )
}
