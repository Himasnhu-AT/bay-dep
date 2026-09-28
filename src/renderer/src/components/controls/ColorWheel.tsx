import { useRef, useState, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useDrag } from '@/lib/useDrag'
import { useGestureBracket, type Gesture } from './gesture'
import { dragValue, keyStep, modifiersOf, roundTo, clamp } from './values'
import { positionDragScale } from './dial'
import { balanceOf, describeWheel, puckPixels, WHEEL_AXES_DEG, type WheelRgb } from './wheel'

export interface ColorWheelProps {
  /** "Lift", "Gamma", "Gain" — the caption above the wheel and the start of every spoken name. */
  label: string
  /** What the wheel works on, for the tooltip: "shadows", "mid-tones", "highlights". */
  hint?: string
  value: WheelRgb | undefined
  /** The puck moved: the new cast, in channel units (+x right, +y up), master unchanged. */
  onBalance(x: number, y: number): void
  /** The strip moved: the new master (mean of r, g, b), cast unchanged. */
  onMaster(master: number): void
  /** The master's range on the strip — the agent's per-channel range. */
  min: number
  max: number
  /** Channel units at the disc's rim. The puck stops at the rim; the value does not. */
  reach: number
  gesture?: Gesture
  disabled?: boolean
  /** A multi-selection that disagrees: the puck goes hollow and the readout says so. */
  mixed?: boolean
  /** Disc diameter in px. Default 64. */
  size?: number
}

/** Master units per pixel of strip drag, before the modifier. */
const MASTER_PER_PX = 0.002
/** The arrow-key step for the puck and the strip. */
const KEY_STEP = 0.005

const signed = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(3)}`

/**
 * A Resolve-style grading wheel: a disc whose puck sets the colour balance (a cast toward a hue,
 * keeping the level) and a master strip under it that sets the level of all three channels at once
 * (the old averaged slider, keeping the cast).
 *
 * Drag anywhere on the disc to move the puck from where it is (it never jumps to the pointer; any
 * modifier is fine ×0.1); drag the strip left or right for the master (Shift ×10, Cmd/Alt ×0.1).
 * Double-click the disc to reset the balance, the strip to reset the master, the arrow button to
 * reset both. Two tab stops: the puck (arrows move it) and the strip (arrows step it).
 */
export function ColorWheel({
  label,
  hint,
  value,
  onBalance,
  onMaster,
  min,
  max,
  reach,
  gesture,
  disabled = false,
  mixed = false,
  size = 64
}: ColorWheelProps): ReactNode {
  const discRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<{ x: number; y: number; master: number } | null>(null)
  const bracket = useGestureBracket(gesture)
  const start = useRef({ x: 0, y: 0, master: 0 })
  const stored = balanceOf(value)
  const shown = draft ?? stored
  const hollow = mixed && draft === null
  const radius = size / 2
  const puck = puckPixels(shown, radius, reach)
  const neutral = Math.abs(stored.x) < 1e-9 && Math.abs(stored.y) < 1e-9
  const flat = Math.abs(stored.master) < 1e-9

  const puckAt = (dx: number, dy: number, mods: { shift: boolean; alt: boolean; meta: boolean }): { x: number; y: number } => {
    const scale = (reach / radius) * positionDragScale(mods)
    return { x: roundTo(start.current.x + dx * scale, 4), y: roundTo(start.current.y - dy * scale, 4) }
  }

  const onDiscDown = useDrag({
    onStart: () => {
      if (disabled) return
      start.current = { ...stored }
    },
    onMove: (state) => {
      if (disabled) return
      const next = puckAt(state.dx, state.dy, state)
      setDraft({ ...next, master: stored.master })
      if (bracket.live && state.travel >= 3) {
        bracket.begin()
        onBalance(next.x, next.y)
      }
    },
    onEnd: (state) => {
      if (!disabled) {
        const next = puckAt(state.dx, state.dy, state)
        setDraft(null)
        onBalance(next.x, next.y)
      }
      bracket.end()
    },
    onClick: () => discRef.current?.focus()
  })

  const masterAt = (dx: number, mods: { shift: boolean; alt: boolean; meta: boolean }): number =>
    roundTo(clamp(dragValue(start.current.master, dx, MASTER_PER_PX, mods), min, max), 4)

  const onStripDown = useDrag({
    onStart: () => {
      if (disabled) return
      start.current = { ...stored }
      document.body.style.cursor = 'ew-resize'
    },
    onMove: (state) => {
      if (disabled) return
      const next = masterAt(state.dx, state)
      setDraft({ x: stored.x, y: stored.y, master: next })
      if (bracket.live && state.travel >= 3) {
        bracket.begin()
        onMaster(next)
      }
    },
    onEnd: (state) => {
      document.body.style.cursor = ''
      if (!disabled) {
        const next = masterAt(state.dx, state)
        setDraft(null)
        onMaster(next)
      }
      bracket.end()
    },
    onClick: () => stripRef.current?.focus()
  })

  // The hue ring runs clockwise from red through magenta, blue, cyan, green and yellow, with each
  // primary on its own axis — so the puck moves toward the colour it shows.
  const ring = `conic-gradient(from ${WHEEL_AXES_DEG.r}deg, #ff3b30, #ff2dd4, #3b6bff, #2de1ff, #34c759, #ffd60a, #ff3b30)`
  const stripFraction = max > min ? (clamp(shown.master, min, max) - min) / (max - min) : 0.5
  const zeroFraction = max > min ? (clamp(0, min, max) - min) / (max - min) : 0.5

  return (
    <div className={cn('flex min-w-0 flex-col items-center gap-1', disabled && 'opacity-40')} title={hint ? `${label}: ${hint}` : undefined}>
      <div className="flex w-full items-center justify-between gap-1 px-0.5">
        <span className="text-[11px] text-ink-1">{label}</span>
        <button
          type="button"
          aria-label={`Reset ${label.toLowerCase()}`}
          title={`Reset ${label.toLowerCase()}`}
          disabled={disabled || (neutral && flat && !mixed)}
          onClick={() => {
            bracket.begin()
            onBalance(0, 0)
            onMaster(0)
            bracket.end()
          }}
          className="t-fast rounded-xs p-0.5 text-ink-2 hover:text-ink-0 disabled:invisible"
        >
          <RotateCcw aria-hidden="true" className="size-3" />
        </button>
      </div>
      <div
        ref={discRef}
        role="slider"
        aria-label={`${label} colour balance`}
        aria-valuemin={0}
        aria-valuemax={roundTo(reach, 3)}
        aria-valuenow={roundTo(Math.hypot(shown.x, shown.y), 3)}
        aria-valuetext={hollow ? 'Mixed' : `${label}: ${describeWheel(value)}`}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={disabled ? undefined : onDiscDown}
        onDoubleClick={() => {
          if (disabled) return
          setDraft(null)
          onBalance(0, 0)
        }}
        onKeyDown={(event) => {
          if (disabled) return
          const one = keyStep(KEY_STEP, modifiersOf(event), 4)
          let dx = 0
          let dy = 0
          if (event.key === 'ArrowLeft') dx = -one
          else if (event.key === 'ArrowRight') dx = one
          else if (event.key === 'ArrowUp') dy = one
          else if (event.key === 'ArrowDown') dy = -one
          else return
          event.preventDefault()
          onBalance(roundTo(stored.x + dx, 4), roundTo(stored.y + dy, 4))
        }}
        className={cn(
          'relative shrink-0 touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent',
          !disabled && 'cursor-crosshair'
        )}
        style={{ width: size, height: size }}
      >
        <div aria-hidden="true" className="absolute inset-0 rounded-full opacity-45" style={{ background: ring }} />
        {/* Desaturated toward the centre, as a grading wheel is: the rim is the strongest cast. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-full"
          style={{ background: 'radial-gradient(circle, var(--color-surface-2) 0%, color-mix(in srgb, var(--color-surface-2) 55%, transparent) 62%, transparent 100%)' }}
        />
        <div aria-hidden="true" className="absolute inset-0 rounded-full border border-line-strong" />
        <div aria-hidden="true" className="absolute top-1/2 left-1/2 h-px w-2.5 -translate-x-1/2 -translate-y-1/2 bg-line-hover" />
        <div aria-hidden="true" className="absolute top-1/2 left-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-line-hover" />
        <div
          aria-hidden="true"
          className={cn(
            'absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 t-press',
            hollow ? 'border-ink-1 bg-transparent' : 'border-ink-0 bg-surface-0 shadow-[0_0_0_1px_var(--color-surface-0)]'
          )}
          style={{ left: puck.left, top: puck.top }}
        />
      </div>
      {/* The master strip: Resolve's jog wheel under each colour wheel, dragged sideways. */}
      <div
        ref={stripRef}
        role="slider"
        aria-label={`${label} master, all channels`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={roundTo(shown.master, 3)}
        aria-valuetext={hollow ? 'Mixed' : signed(shown.master)}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        title={disabled ? undefined : 'Drag sideways for the level · double-click to reset'}
        onPointerDown={disabled ? undefined : onStripDown}
        onDoubleClick={() => {
          if (disabled) return
          setDraft(null)
          onMaster(0)
        }}
        onKeyDown={(event) => {
          if (disabled) return
          const one = keyStep(KEY_STEP, modifiersOf(event), 4)
          let next: number | null = null
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = stored.master + one
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = stored.master - one
          if (next === null) return
          event.preventDefault()
          onMaster(roundTo(clamp(next, min, max), 4))
        }}
        className={cn(
          'relative h-2.5 w-full shrink-0 touch-none rounded-full border border-line bg-surface-3 outline-none focus-visible:ring-2 focus-visible:ring-accent',
          // Ridges, like a jog wheel's edge, so it reads as something to drag rather than a bar.
          'bg-[repeating-linear-gradient(90deg,transparent_0_3px,var(--color-line-strong)_3px_4px)]',
          !disabled && 'cursor-ew-resize'
        )}
      >
        <div aria-hidden="true" className="absolute inset-y-0 w-px bg-line-hover" style={{ left: `${zeroFraction * 100}%` }} />
        <div
          aria-hidden="true"
          className={cn('absolute top-1/2 h-3.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-xs', hollow ? 'border border-ink-1 bg-surface-1' : 'bg-ink-0')}
          style={{ left: `${stripFraction * 100}%` }}
        />
      </div>
      <span className="font-mono text-[10px] leading-none text-ink-2 tabular-nums">{hollow ? 'Mixed' : signed(shown.master)}</span>
    </div>
  )
}
