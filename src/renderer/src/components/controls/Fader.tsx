import { useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useDrag } from '@/lib/useDrag'
import { faderDb, faderPosition, faderStep, parseDb, positionDragScale, FADER_UNITY } from './dial'
import { useGestureBracket, useWheelSteps, type Gesture } from './gesture'
import { createDragAccumulator, guardCommit, keyStep, modifiersOf, roundTo, MODIFIER_SCALE } from './values'

export interface FaderProps {
  /** The accessible name — "Dialogue volume". */
  label: string
  /** Level in dB; `-Infinity` (or anything at or below `floorDb`) is silence. */
  value: number
  onCommit(db: number): void
  /** The bottom of the travel, where the fader reads −∞. */
  floorDb: number
  /** The top of the travel. */
  maxDb: number
  /** Arrow-key step in dB. Default 0.5. */
  step?: number
  /** What double-click puts back. Default 0 dB (unity), as on every console. */
  defaultValue?: number
  gesture?: Gesture
  disabled?: boolean
  /** A multi-selection that disagrees: the cap goes hollow and the readout says so. */
  mixed?: boolean
  /** How a level reads in the box under the fader: `0dB`, `−6.0dB`, `−∞`. */
  format(db: number): string
  /** Print the scale's dB marks beside the track. Default true. */
  marks?: boolean
  className?: string
}

/** The marks a fader prints, in dB. Unity is drawn stronger than the rest. */
const MARKS = [6, 0, -6, -12, -24, -40]

/**
 * A vertical dB fader, the way a console draws one: unity (0 dB) three quarters up and marked, a
 * log taper below it (`faderPosition`), −∞ at the bottom.
 *
 * Grab anywhere on the track and drag — the cap moves from where it was, it never jumps to the
 * pointer, so a stray click cannot slam a level. Any modifier makes the drag fine (the travel
 * already spans the range). Arrows step 0.5 dB (Shift ×10, Cmd/Alt ×0.1), PageUp/PageDown 5 dB,
 * Home is −∞ and End the top. Double-click resets to 0 dB. The box under it takes a typed level.
 */
export function Fader({
  label,
  value,
  onCommit,
  floorDb,
  maxDb,
  step = 0.5,
  defaultValue = 0,
  gesture,
  disabled = false,
  mixed = false,
  format,
  marks = true,
  className
}: FaderProps): ReactNode {
  // −∞ is a level (silence); NaN from the store is not, and is never written back.
  const commit = guardCommit(onCommit, true)
  const trackRef = useRef<HTMLDivElement>(null)
  // The travel: the track less half a cap at each end, so the cap sits inside it at both ends.
  const travelRef = useRef<HTMLDivElement>(null)
  const cancelling = useRef(false)
  const [draft, setDraft] = useState<number | null>(null)
  const [typing, setTyping] = useState<string | null>(null)
  const bracket = useGestureBracket(gesture)
  const start = useRef(createDragAccumulator(0))
  const current = draft ?? value
  const position = faderPosition(current, floorDb, maxDb)
  const hollow = mixed && draft === null

  const clampDb = (db: number): number => (db <= floorDb ? Number.NEGATIVE_INFINITY : Math.min(maxDb, db))
  /** A dragged level, rounded to a tenth of a dB (finer is below anything audible). */
  const tidy = (db: number): number => (Number.isFinite(db) ? roundTo(db, 1) : db)

  const reached = (dy: number, mods: { shift: boolean; alt: boolean; meta: boolean }): number => {
    const height = travelRef.current?.getBoundingClientRect().height ?? 0
    if (height <= 0) return current
    // Each move scaled by the modifier held during it: Cmd pressed mid-drag slows the rest.
    const next = start.current.move(0, dy, (_ddx, ddy) => -(ddy / height) * positionDragScale(mods))
    return tidy(faderDb(next, floorDb, maxDb))
  }

  const onPointerDown = useDrag({
    onStart: () => {
      if (disabled) return
      start.current = createDragAccumulator(position, (p) => Math.max(0, Math.min(1, p)))
      document.body.style.cursor = 'ns-resize'
    },
    onMove: (state) => {
      if (disabled) return
      const next = reached(state.dy, state)
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
        commit(reached(state.dy, state))
      }
      bracket.end()
    },
    onClick: () => {
      document.body.style.cursor = ''
      trackRef.current?.focus()
    }
  })

  /** A step in dB from where the level is; from −∞ the first step up lands on the floor. */
  const stepBy = (db: number): number => faderStep(current, db, floorDb, maxDb)

  useWheelSteps(trackRef, !disabled, (steps, mods) => {
    if (bracket.live) bracket.touch()
    commit(stepBy(steps * keyStep(step, mods, 1)))
  }, bracket.rest)

  const shown = hollow ? 'Mixed' : format(current)
  const spoken = hollow ? 'Mixed' : Number.isFinite(current) && current > floorDb ? `${roundTo(current, 1)} dB` : 'minus infinity'

  return (
    <div className={cn('flex min-h-0 flex-col items-center gap-1', disabled && 'opacity-40', className)}>
      <div className="flex min-h-0 w-full flex-1 justify-center gap-1">
        {marks && (
          <div aria-hidden="true" className="relative w-5 shrink-0 font-mono text-[9px] leading-none text-ink-2">
            <div className="absolute inset-x-0 inset-y-1.5">
              {MARKS.filter((db) => db <= maxDb).map((db) => (
                <span
                  key={db}
                  className={cn('absolute right-0 translate-y-1/2 tabular-nums', db === 0 && 'text-ink-1')}
                  style={{ bottom: `${faderPosition(db, floorDb, maxDb) * 100}%` }}
                >
                  {db > 0 ? `+${db}` : db === 0 ? '0' : `−${-db}`}
                </span>
              ))}
              <span className="absolute right-0 bottom-0 translate-y-1/2">−∞</span>
            </div>
          </div>
        )}
        <div
          ref={trackRef}
          role="slider"
          aria-label={label}
          aria-orientation="vertical"
          aria-valuemin={floorDb}
          aria-valuemax={roundTo(maxDb, 2)}
          aria-valuenow={Number.isFinite(current) ? roundTo(Math.max(floorDb, current), 2) : floorDb}
          aria-valuetext={spoken}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : 0}
          title={disabled ? undefined : 'Drag to set · double-click for 0 dB'}
          onPointerDown={disabled ? undefined : onPointerDown}
          onDoubleClick={() => {
            if (disabled) return
            setDraft(null)
            commit(defaultValue)
          }}
          onKeyDown={(event) => {
            if (disabled) return
            const mods = modifiersOf(event)
            let next: number | null = null
            if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next = stepBy(keyStep(step, mods, 1))
            if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next = stepBy(-keyStep(step, mods, 1))
            if (event.key === 'PageUp') next = stepBy(step * MODIFIER_SCALE.coarse)
            if (event.key === 'PageDown') next = stepBy(-step * MODIFIER_SCALE.coarse)
            if (event.key === 'Home') next = Number.NEGATIVE_INFINITY
            if (event.key === 'End') next = maxDb
            if (next === null) return
            event.preventDefault()
            commit(next)
          }}
          className={cn(
            'group relative w-6 shrink-0 touch-none rounded-sm outline-none',
            'focus-visible:ring-2 focus-visible:ring-accent',
            !disabled && 'cursor-ns-resize'
          )}
        >
          {/* The groove, and a tick per mark across it; unity reaches wider. */}
          <div aria-hidden="true" className="absolute inset-y-1 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-surface-3" />
          <div ref={travelRef} aria-hidden="true" className="absolute inset-x-0 inset-y-1.5">
          {MARKS.filter((db) => db <= maxDb).map((db) => (
            <div
              key={db}
              aria-hidden="true"
              className={cn('absolute left-1/2 h-px -translate-x-1/2', db === 0 ? 'w-5 bg-line-hover' : 'w-3 bg-line-strong')}
              style={{ bottom: `${faderPosition(db, floorDb, maxDb) * 100}%` }}
            />
          ))}
          <div
            aria-hidden="true"
            className="absolute left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-accent/70"
            style={{ bottom: 0, height: `${Math.min(position, FADER_UNITY) * 100}%`, display: hollow || position === 0 ? 'none' : undefined }}
          />
          {/* The cap: a console fader's grip, with its centre line on the level. */}
          <div
            aria-hidden="true"
            className={cn(
              'absolute left-1/2 flex h-3 w-6 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-xs border t-press',
              hollow ? 'border-ink-1 bg-surface-1' : 'border-surface-0 bg-ink-1 shadow-[0_1px_2px_var(--color-shadow)]',
              !disabled && 'group-hover:bg-ink-0'
            )}
            style={{ bottom: `${position * 100}%` }}
          >
            <span className={cn('h-px w-4', hollow ? 'bg-ink-1' : 'bg-surface-0')} />
          </div>
          </div>
        </div>
      </div>
      <input
        aria-label={`${label}, typed in dB`}
        disabled={disabled}
        value={typing ?? shown}
        spellCheck={false}
        onFocus={(event) => {
          setTyping(hollow ? '' : Number.isFinite(current) ? String(roundTo(current, 1)) : '-inf')
          event.currentTarget.select()
        }}
        onChange={(event) => setTyping(event.target.value)}
        onBlur={() => {
          const cancelled = cancelling.current
          cancelling.current = false
          const parsed = typing === null || cancelled ? null : parseDb(typing)
          setTyping(null)
          if (parsed !== null) commit(clampDb(parsed))
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            cancelling.current = true
            event.currentTarget.blur()
          }
        }}
        className="h-5 w-full min-w-0 rounded-xs border border-line bg-surface-2 text-center font-mono text-[10px] text-ink-0 tabular-nums outline-none focus:border-accent disabled:cursor-not-allowed"
      />
    </div>
  )
}
