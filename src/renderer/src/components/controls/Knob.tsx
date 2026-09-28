import { useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useDrag } from '@/lib/useDrag'
import { angleDelta, foldAngle, knobAngle, knobDragValue, pointerAngle, positionDragScale, KNOB_SWEEP_DEG } from './dial'
import { useGestureBracket, useWheelSteps, type Gesture } from './gesture'
import { clamp, createDragAccumulator, decimalsOf, guardCommit, keyStep, modifiersOf, roundTo, MODIFIER_SCALE } from './values'

/** A point on a circle, `deg` clockwise from straight up. */
function polar(c: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  return [c + r * Math.sin(rad), c - r * Math.cos(rad)]
}

/** An SVG arc from `from`° to `to`°, clockwise from straight up. */
function arc(c: number, r: number, from: number, to: number): string {
  const [a, b] = [Math.min(from, to), Math.max(from, to)]
  if (b - a < 0.01) return ''
  const [x1, y1] = polar(c, r, a)
  const [x2, y2] = polar(c, r, b)
  return `M ${x1} ${y1} A ${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2}`
}

export interface KnobProps {
  /** The accessible name — "Dialogue pan". */
  label: string
  value: number
  onCommit(value: number): void
  min: number
  max: number
  /** Arrow-key step. Default a hundredth of the range. */
  step?: number
  /** Where the fill starts; a bipolar control (pan) fills from its centre. Default `min`. */
  origin?: number
  /** What double-click puts back — the centre, for pan. */
  defaultValue?: number
  /** The readout under the knob, and what it speaks: `L 30`, `C`, `R 100`. */
  format(value: number): string
  /** The spoken value, when the readout is terser than a sentence ("Left 30", "Centre"). */
  valueText?(value: number): string
  gesture?: Gesture
  disabled?: boolean
  mixed?: boolean
  /** Diameter in px. Default 28. */
  size?: number
  /**
   * Where the readout goes: under the knob (`true`, a mixer strip), beside it (`'side'`, an
   * inspector row, in the same fixed-width column a `SliderField` readout uses), or nowhere.
   */
  readout?: boolean | 'side'
  className?: string
}

/**
 * A knob, for pan and any bipolar or angular value: the audio-plugin convention (Premiere's track
 * mixer, Fairlight's panner). A 270° sweep with the fill from `origin`, so a centred pan reads as
 * nothing and a hard-left one as a full left arc.
 *
 * Drag up or right to increase (the whole range is 160px; any modifier is fine ×0.1). Arrows step
 * (Shift ×10, Cmd/Alt ×0.1), PageUp/PageDown ×10, Home/End the ends. Double-click resets to
 * `defaultValue`. The wheel steps it while hovered and focused.
 */
export function Knob({
  label,
  value,
  onCommit,
  min,
  max,
  step = (max - min) / 100,
  origin = min,
  defaultValue,
  format,
  valueText,
  gesture,
  disabled = false,
  mixed = false,
  size = 28,
  readout = true,
  className
}: KnobProps): ReactNode {
  const commit = guardCommit(onCommit)
  const ref = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<number | null>(null)
  const bracket = useGestureBracket(gesture)
  const drag = useRef(createDragAccumulator(0))
  const current = draft ?? value
  const decimals = decimalsOf(step)
  const hollow = mixed && draft === null
  const settle = (next: number): number => roundTo(clamp(Math.round(next / step) * step, min, max), decimals)
  /** The drag so far, each move scaled by the modifier held during it (`createDragAccumulator`). */
  const reach = (state: { dx: number; dy: number; shift: boolean; alt: boolean; meta: boolean }): number =>
    drag.current.move(state.dx, state.dy, (ddx, ddy) => knobDragValue(0, ddx, ddy, min, max, 160, positionDragScale(state)))

  const onPointerDown = useDrag({
    onStart: () => {
      if (disabled) return
      drag.current = createDragAccumulator(current, (v) => clamp(v, min, max))
      document.body.style.cursor = 'ns-resize'
    },
    onMove: (state) => {
      if (disabled) return
      const next = settle(reach(state))
      setDraft(next)
      if (bracket.live && state.travel >= 3) {
        bracket.begin()
        commit(next)
      }
    },
    onEnd: (state) => {
      document.body.style.cursor = ''
      if (!disabled) {
        setDraft(null)
        commit(settle(reach(state)))
      }
      bracket.end()
    },
    onClick: () => {
      document.body.style.cursor = ''
      ref.current?.focus()
    }
  })

  useWheelSteps(ref, !disabled, (steps, mods) => {
    if (bracket.live) bracket.touch()
    commit(settle(current + steps * keyStep(step, mods, decimals)))
  }, bracket.rest)

  const c = size / 2
  const r = c - 3
  const angle = knobAngle(current, min, max)
  const originAngle = knobAngle(origin, min, max)
  const [px, py] = polar(c, r - 3, angle)

  return (
    <div
      className={cn(
        'flex items-center',
        readout === 'side' ? 'flex-row justify-between gap-2' : 'flex-col gap-0.5',
        disabled && 'opacity-40',
        className
      )}
    >
      <div
        ref={ref}
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={roundTo(current, 3)}
        aria-valuetext={hollow ? 'Mixed' : (valueText ?? format)(current)}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        title={disabled ? undefined : `Drag up or down${defaultValue !== undefined ? ` · double-click for ${format(defaultValue)}` : ''}`}
        onPointerDown={disabled ? undefined : onPointerDown}
        onDoubleClick={() => {
          if (disabled || defaultValue === undefined) return
          setDraft(null)
          commit(defaultValue)
        }}
        onKeyDown={(event) => {
          if (disabled) return
          const one = keyStep(step, modifiersOf(event), decimals)
          let next: number | null = null
          if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next = current + one
          if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next = current - one
          if (event.key === 'PageUp') next = current + step * MODIFIER_SCALE.coarse
          if (event.key === 'PageDown') next = current - step * MODIFIER_SCALE.coarse
          if (event.key === 'Home') next = min
          if (event.key === 'End') next = max
          if (next === null) return
          event.preventDefault()
          commit(settle(next))
        }}
        className={cn(
          'group shrink-0 touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent',
          !disabled && 'cursor-ns-resize'
        )}
        style={{ width: size, height: size }}
      >
        <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <path d={arc(c, r, -KNOB_SWEEP_DEG / 2, KNOB_SWEEP_DEG / 2)} fill="none" stroke="var(--color-surface-4)" strokeWidth={2.5} strokeLinecap="round" />
          {!hollow && (
            <path d={arc(c, r, originAngle, angle)} fill="none" stroke="var(--color-accent)" strokeWidth={2.5} strokeLinecap="round" />
          )}
          <circle
            cx={c}
            cy={c}
            r={r - 4}
            className={cn('t-fast', hollow ? 'fill-surface-1 stroke-ink-1' : 'fill-surface-3 stroke-line-strong', !disabled && 'group-hover:fill-surface-4')}
            strokeWidth={1}
          />
          <line x1={c} y1={c} x2={px} y2={py} stroke={hollow ? 'var(--color-ink-2)' : 'var(--color-ink-0)'} strokeWidth={1.75} strokeLinecap="round" />
        </svg>
      </div>
      {readout && (
        <span
          aria-hidden="true"
          className={cn(
            'tabular-nums',
            readout === 'side' ? 'inline-block w-11 text-right text-[11px] text-ink-2' : 'font-mono text-[10px] leading-none text-ink-1'
          )}
        >
          {hollow ? 'Mixed' : format(current)}
        </span>
      )}
    </div>
  )
}

export interface AngleDialProps {
  label: string
  /** Degrees, unbounded: 720 is two turns, and the dial shows where it points. */
  value: number
  onCommit(degrees: number): void
  defaultValue?: number
  gesture?: Gesture
  disabled?: boolean
  mixed?: boolean
  /** Diameter in px. Default 24. */
  size?: number
  className?: string
}

/**
 * A rotation dial beside a rotation number, as After Effects draws its angle controls: drag
 * *around* it and the value follows the pointer, counting whole turns rather than wrapping (a
 * drag past straight down keeps going). Any modifier is fine (a tenth of the pointer's angle).
 * Arrows step 1° (Shift 10°, Cmd/Alt 0.1°). Double-click resets to `defaultValue`.
 */
export function AngleDial({
  label,
  value,
  onCommit,
  defaultValue,
  gesture,
  disabled = false,
  mixed = false,
  size = 24,
  className
}: AngleDialProps): ReactNode {
  const commit = guardCommit(onCommit)
  const ref = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<number | null>(null)
  const bracket = useGestureBracket(gesture)
  const drag = useRef({ value: 0, pointer: 0 })
  const current = draft ?? value
  const hollow = mixed && draft === null

  const pointerAt = (x: number, y: number): number => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return 0
    return pointerAngle(x - (box.left + box.width / 2), y - (box.top + box.height / 2))
  }

  /**
   * Follows the pointer around the dial: each move adds its own angle, scaled by the modifier held
   * during *that* move, so pressing Cmd mid-drag slows the rest rather than jumping the value.
   */
  const turn = (state: { x: number; y: number; shift: boolean; alt: boolean; meta: boolean }): number => {
    const now = pointerAt(state.x, state.y)
    drag.current.value += angleDelta(drag.current.pointer, now) * positionDragScale(state)
    drag.current.pointer = now
    return roundTo(drag.current.value, 1)
  }

  const onPointerDown = useDrag({
    onStart: (state) => {
      if (disabled) return
      drag.current = { value: current, pointer: pointerAt(state.x, state.y) }
    },
    onMove: (state) => {
      if (disabled) return
      const next = turn(state)
      setDraft(next)
      if (bracket.live && state.travel >= 3) {
        bracket.begin()
        commit(next)
      }
    },
    onEnd: (state) => {
      if (!disabled) {
        setDraft(null)
        commit(turn(state))
      }
      bracket.end()
    },
    onClick: () => ref.current?.focus()
  })

  useWheelSteps(ref, !disabled, (steps, mods) => {
    if (bracket.live) bracket.touch()
    commit(roundTo(current + steps * keyStep(1, mods, 1), 1))
  }, bracket.rest)

  const c = size / 2
  const r = c - 2
  const [px, py] = polar(c, r - 2, foldAngle(current))

  return (
    <div
      ref={ref}
      role="slider"
      aria-label={label}
      aria-valuenow={roundTo(current, 1)}
      aria-valuetext={hollow ? 'Mixed' : `${roundTo(current, 1)} degrees`}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      title={disabled ? undefined : `Drag around to rotate${defaultValue !== undefined ? ' · double-click to reset' : ''}`}
      onPointerDown={disabled ? undefined : onPointerDown}
      onDoubleClick={() => {
        if (disabled || defaultValue === undefined) return
        setDraft(null)
        commit(defaultValue)
      }}
      onKeyDown={(event) => {
        if (disabled) return
        const one = keyStep(1, modifiersOf(event), 1)
        let next: number | null = null
        if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next = current + one
        if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next = current - one
        if (next === null) return
        event.preventDefault()
        commit(roundTo(next, 1))
      }}
      className={cn(
        'group shrink-0 touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent',
        disabled ? 'opacity-40' : 'cursor-grab active:cursor-grabbing',
        className
      )}
      style={{ width: size, height: size }}
    >
      <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={c}
          cy={c}
          r={r}
          className={cn('t-fast', hollow ? 'fill-surface-1 stroke-ink-1' : 'fill-surface-2 stroke-line-strong', !disabled && 'group-hover:stroke-line-hover')}
          strokeWidth={1}
        />
        <circle cx={c} cy={c} r={1.25} className="fill-ink-2" />
        <line x1={c} y1={c} x2={px} y2={py} stroke={hollow ? 'var(--color-ink-2)' : 'var(--color-accent)'} strokeWidth={1.75} strokeLinecap="round" />
      </svg>
    </div>
  )
}
