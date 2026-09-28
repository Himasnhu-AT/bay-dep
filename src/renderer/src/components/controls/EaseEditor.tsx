import { useRef, useState, type ReactNode } from 'react'
import type { KeyframeEase } from '@shared/project'
import { cn } from '@/lib/cn'
import { useDrag } from '@/lib/useDrag'
import { useFloatingTrigger } from '../Floating'
import { Popover } from '../Popover'
import {
  bezierOf,
  curvePath,
  describeBezier,
  easeFromBezier,
  presetOf,
  snapHandle,
  EASE_PRESETS,
  HANDLE_Y,
  HANDLE_Y_UNIT,
  type Bezier,
  type HandleRange
} from './ease'
import { useGestureBracket, type Gesture } from './gesture'
import { keyStep, modifiersOf, roundTo } from './values'

export interface EaseEditorProps {
  /** The accessible name — "Ease from this key to the next". */
  label: string
  value: KeyframeEase | undefined
  onChange(ease: KeyframeEase): void
  gesture?: Gesture
  disabled?: boolean
  /** A multi-selection that disagrees. */
  mixed?: boolean
  /**
   * Whether a handle may take the curve past 0…1 (a keyframe's value overshooting). False for a
   * transition, whose progress cannot leave 0…1.
   */
  overshoot?: boolean
}

/** The curve box: its size, and the progress range it shows (room above and below for overshoot). */
const BOX = { width: 176, height: 132, yMin: -0.5, yMax: 1.5 }

/** A small drawing of an ease, for the trigger and the preset buttons. */
function MiniCurve({ ease, size = 18 }: { ease: KeyframeEase | undefined; size?: number }): ReactNode {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox={`-2 -2 ${size + 4} ${size + 4}`} className="shrink-0">
      <path d={curvePath(ease, size, size, 0, 1, 24)} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * An ease: presets as a row of drawn curves (Linear, In, Out, In-out, Hold), and a cubic-bezier box
 * with two handles for anything else — After Effects' keyframe velocity, drawn the CSS way. The
 * curve in the box is sampled from the same function the compositor and the audio use, so what it
 * shows is what plays.
 *
 * Drag a handle (Shift snaps it to 0.05); focus one and use the arrows (←→ time, ↑↓ value; Shift
 * ×10, Cmd/Alt ×0.1). x stays within 0…1 — time cannot run backwards — and y may overshoot.
 * Double-click the box to go back to linear. A handle dragged back onto a preset's curve stores the
 * preset's name.
 */
export function EaseEditor({ label, value, onChange, gesture, disabled = false, mixed = false, overshoot = true }: EaseEditorProps): ReactNode {
  const trigger = useFloatingTrigger('dialog')
  const preset = mixed ? 'custom' : presetOf(value)
  const name = mixed ? 'Mixed' : preset === 'custom' ? 'Custom curve' : (EASE_PRESETS.find((p) => p.value === preset)?.label ?? 'Linear')
  return (
    <>
      <button
        type="button"
        {...trigger.triggerProps}
        disabled={disabled}
        aria-label={`${label}: ${name}`}
        className={cn(
          'flex h-7 w-full min-w-0 items-center gap-2 rounded-sm border border-line bg-surface-2 px-2 text-left text-[12px] text-ink-0 t-fast',
          disabled ? 'cursor-not-allowed opacity-40' : 'hover:border-line-strong'
        )}
      >
        <span className="text-ink-1">
          <MiniCurve ease={mixed ? undefined : value} size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
      </button>
      <Popover {...trigger.surfaceProps} label={label} width={BOX.width + 8}>
        <EasePanel label={label} value={mixed ? undefined : value} onChange={onChange} gesture={gesture} range={overshoot ? HANDLE_Y : HANDLE_Y_UNIT} />
      </Popover>
    </>
  )
}

function EasePanel({
  label,
  value,
  onChange,
  gesture,
  range
}: {
  label: string
  value: KeyframeEase | undefined
  onChange(ease: KeyframeEase): void
  gesture?: Gesture
  range: HandleRange
}): ReactNode {
  const [draft, setDraft] = useState<Bezier | null>(null)
  const bracket = useGestureBracket(gesture)
  const boxRef = useRef<SVGSVGElement>(null)
  const current: KeyframeEase | undefined = draft ? easeFromBezier(draft, range) : value
  const handles = draft ?? bezierOf(value)
  const preset = presetOf(current)
  const toX = (x: number): number => x * BOX.width
  const toY = (y: number): number => BOX.height - ((y - BOX.yMin) / (BOX.yMax - BOX.yMin)) * BOX.height

  const commit = (next: Bezier): void => onChange(easeFromBezier(next, range))

  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label={`${label}: presets`} className="grid grid-cols-5 gap-1">
        {EASE_PRESETS.map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={preset === choice.value}
            aria-label={choice.label}
            title={choice.label}
            onClick={() => {
              setDraft(null)
              onChange(choice.value)
            }}
            className={cn(
              'flex h-7 items-center justify-center rounded-sm border t-fast',
              preset === choice.value ? 'border-accent bg-accent/14 text-ink-0' : 'border-line bg-surface-1 text-ink-1 hover:text-ink-0'
            )}
          >
            <MiniCurve ease={choice.value} size={16} />
          </button>
        ))}
      </div>
      <div className="relative rounded-sm border border-line bg-surface-1 p-1">
        <svg
          ref={boxRef}
          width={BOX.width}
          height={BOX.height}
          className="block overflow-visible"
          onDoubleClick={() => {
            setDraft(null)
            onChange('linear')
          }}
        >
          <title>Double-click for linear</title>
          {/* The unit square the curve runs across, and the diagonal linear would be. */}
          <rect x={0} y={toY(1)} width={BOX.width} height={toY(0) - toY(1)} fill="none" stroke="var(--color-line-strong)" />
          <line x1={toX(0)} y1={toY(0)} x2={toX(1)} y2={toY(1)} stroke="var(--color-line)" strokeDasharray="3 3" />
          {handles && (
            <>
              <line x1={toX(0)} y1={toY(0)} x2={toX(handles[0])} y2={toY(handles[1])} stroke="var(--color-ink-2)" />
              <line x1={toX(1)} y1={toY(1)} x2={toX(handles[2])} y2={toY(handles[3])} stroke="var(--color-ink-2)" />
            </>
          )}
          <path
            d={curvePath(current, BOX.width, BOX.height, BOX.yMin, BOX.yMax, 64)}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={2}
            strokeLinecap="round"
          />
          {handles &&
            ([0, 1] as const).map((which) => (
              <Handle
                key={which}
                which={which}
                handles={handles}
                box={boxRef}
                toX={toX}
                toY={toY}
                range={range}
                onDrag={(next, live) => {
                  setDraft(next)
                  if (live && bracket.live) {
                    bracket.begin()
                    commit(next)
                  }
                }}
                onDone={(next) => {
                  setDraft(null)
                  commit(next)
                  bracket.end()
                }}
              />
            ))}
        </svg>
      </div>
      <p className="font-mono text-[10px] text-ink-2 tabular-nums">{describeBezier(current)}</p>
    </div>
  )
}

function Handle({
  which,
  handles,
  box,
  toX,
  toY,
  range,
  onDrag,
  onDone
}: {
  which: 0 | 1
  handles: Bezier
  box: React.RefObject<SVGSVGElement | null>
  toX(x: number): number
  toY(y: number): number
  range: HandleRange
  onDrag(next: Bezier, live: boolean): void
  onDone(next: Bezier): void
}): ReactNode {
  const ix = which === 0 ? 0 : 2
  const x = handles[ix]!
  const y = handles[ix + 1]!

  const at = (clientX: number, clientY: number, snap: boolean): Bezier => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect) return handles
    let nx = (clientX - rect.left) / rect.width
    let ny = BOX.yMin + ((rect.bottom - clientY) / rect.height) * (BOX.yMax - BOX.yMin)
    if (snap) {
      nx = snapHandle(nx)
      ny = snapHandle(ny)
    }
    const next: Bezier = [...handles]
    next[ix] = roundTo(Math.max(0, Math.min(1, nx)), 3)
    next[ix + 1] = roundTo(Math.max(range.min, Math.min(range.max, ny)), 3)
    return next
  }

  const onPointerDown = useDrag({
    threshold: 1,
    onMove: (state) => onDrag(at(state.x, state.y, state.shift), state.travel >= 2),
    onEnd: (state) => onDone(at(state.x, state.y, state.shift))
  })

  const name = which === 0 ? 'First handle' : 'Second handle'
  return (
    <circle
      role="slider"
      aria-label={`${name}: arrows move it, left and right in time, up and down in value`}
      aria-valuenow={x}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuetext={`time ${roundTo(x, 2)}, value ${roundTo(y, 2)}`}
      tabIndex={0}
      cx={toX(x)}
      cy={toY(y)}
      r={5}
      onPointerDown={(event) => {
        event.stopPropagation()
        onPointerDown(event)
      }}
      onKeyDown={(event) => {
        const one = keyStep(0.01, modifiersOf(event), 3)
        const next: Bezier = [...handles]
        if (event.key === 'ArrowLeft') next[ix] = Math.max(0, x - one)
        else if (event.key === 'ArrowRight') next[ix] = Math.min(1, x + one)
        else if (event.key === 'ArrowUp') next[ix + 1] = Math.min(range.max, y + one)
        else if (event.key === 'ArrowDown') next[ix + 1] = Math.max(range.min, y - one)
        else return
        event.preventDefault()
        next[ix] = roundTo(next[ix]!, 3)
        next[ix + 1] = roundTo(next[ix + 1]!, 3)
        onDone(next)
      }}
      className="cursor-grab fill-surface-0 stroke-ink-0 outline-none focus-visible:stroke-accent active:cursor-grabbing"
      strokeWidth={2}
    />
  )
}
