import { useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useDrag } from '@/lib/useDrag'

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
  className
}: SliderProps): ReactNode {
  const trackRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<number | null>(null)
  const current = draft ?? value
  const fraction = max > min ? (current - min) / (max - min) : 0

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
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent/85"
          style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
        />
        <div
          className={cn(
            'absolute top-1/2 size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full',
            'border border-surface-0 bg-ink-0 t-fast',
            !disabled && 'group-hover:bg-white'
          )}
          style={{ left: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
        />
      </div>
    </div>
  )
}
