import { useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useDrag } from '@/lib/useDrag'
import { Field } from './Panel'

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
}

/**
 * Drag-to-set, and the whole track is the target — a 10px thumb you have to hit first is
 * the difference between adjusting a fade and hunting for a handle.
 *
 * Like `NumberField`, it commits on release: an opacity drag across a panel is one undo
 * step, not two hundred.
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
  bipolar = false
}: SliderProps): ReactNode {
  const origin = originProp ?? (bipolar ? (min + max) / 2 : undefined)
  const trackRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<number | null>(null)
  const current = draft ?? value
  const fraction = max > min ? (current - min) / (max - min) : 0
  const originFraction = origin !== undefined && max > min ? (origin - min) / (max - min) : 0
  const fillFrom = Math.max(0, Math.min(1, Math.min(originFraction, fraction)))
  const fillTo = Math.max(0, Math.min(1, Math.max(originFraction, fraction)))

  const valueAt = (clientX: number): number => {
    const track = trackRef.current
    if (!track) return current
    const box = track.getBoundingClientRect()
    if (box.width <= 0) return current
    const raw = min + ((clientX - box.left) / box.width) * (max - min)
    const snapped = Math.round(raw / step) * step
    // Floating-point step arithmetic leaves 0.30000000000000004 behind; the decimals of
    // `step` are exactly how many the result is allowed to keep.
    const decimals = (String(step).split('.')[1] ?? '').length
    return Number(Math.min(max, Math.max(min, snapped)).toFixed(decimals))
  }

  const onPointerDown = useDrag({
    onStart: (state) => {
      if (disabled) return
      const next = valueAt(state.x)
      setDraft(next)
      onInput?.(next)
    },
    onMove: (state) => {
      if (disabled) return
      const next = valueAt(state.x)
      setDraft(next)
      onInput?.(next)
    },
    onEnd: (state) => {
      if (disabled) return
      setDraft(null)
      onCommit(valueAt(state.x))
    },
    // A click is still a set: the pointer landed somewhere on the track on purpose.
    onClick: (state) => {
      if (disabled) return
      setDraft(null)
      onCommit(valueAt(state.x))
    }
  })

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(current.toFixed(3))}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={disabled ? undefined : onPointerDown}
      onKeyDown={(event) => {
        if (disabled) return
        const big = event.shiftKey ? 10 : 1
        let next: number | null = null
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = current - step * big
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = current + step * big
        if (event.key === 'Home') next = min
        if (event.key === 'End') next = max
        if (next === null) return
        event.preventDefault()
        const decimals = (String(step).split('.')[1] ?? '').length
        onCommit(Number(Math.min(max, Math.max(min, next)).toFixed(decimals)))
      }}
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
        <div
          className="absolute inset-y-0 rounded-full bg-accent/85"
          style={{ left: `${fillFrom * 100}%`, width: `${(fillTo - fillFrom) * 100}%` }}
        />
        <div
          className={cn(
            'absolute top-1/2 size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full',
            'border border-surface-0 bg-ink-0 t-press',
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

export interface SliderFieldProps extends Omit<SliderProps, 'label' | 'onInput'> {
  /** The visible caption, kept short enough for the Field's 64px label column. */
  label: string
  /** The accessible name, when it needs more than the caption (units, a longer word). */
  ariaLabel?: string
  /** The readout beside the track. Receives the live value while dragging. */
  format(value: number): string
  /** A multi-selection that disagrees: the readout says so rather than showing one clip's value. */
  mixed?: boolean
}

/**
 * A captioned slider with a live readout — the row every inspector slider should be.
 *
 * A bare `Slider` carries its name only in `aria-label`, so a stack of them is a column of
 * identical lines: eight in Adjustments and ten in Grade shipped that way, and the only way to
 * tell Brightness from Contrast was to drag one and watch the picture. The readout has a fixed
 * width so every track in a section ends on the same line whatever the value's length.
 */
export function SliderField({
  label,
  ariaLabel,
  format,
  mixed = false,
  value,
  onCommit,
  ...slider
}: SliderFieldProps): ReactNode {
  const [live, setLive] = useState<number | null>(null)
  const shown = live ?? value
  return (
    <Field
      label={label}
      hint={
        <span className="inline-block w-11 text-right">
          {mixed && live === null ? 'Mixed' : format(shown)}
        </span>
      }
    >
      <Slider
        {...slider}
        label={ariaLabel ?? label}
        value={value}
        onInput={setLive}
        onCommit={(next) => {
          setLive(null)
          onCommit(next)
        }}
      />
    </Field>
  )
}
