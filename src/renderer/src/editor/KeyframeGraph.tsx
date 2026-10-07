import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { formatTimecode, type Item, type Keyframe, type KeyframeProperty } from '@shared/project'
import { KEYFRAME_REGISTRY } from '@shared/keyframe-registry'
import { keyframeValueAt } from '@shared/keyframes'
import { cn } from '@/lib/cn'
import { useDrag } from '@/lib/useDrag'
import { useEditor } from '@/store/editor'
import { dragKey, frameAtX, graphPath, graphRange, graphX, graphY, valueAtY, type GraphScale } from './graphMath'

const BOX = { width: 240, height: 116, pad: 10 }

export interface KeyframeGraphProps {
  item: Item
  property: KeyframeProperty
  fps: number
  /** The key the list below has selected, by its frame. */
  selectedFrame: number | null
  onSelect(frame: number): void
  /** Commits a whole key list for the property, through `edit_item`. Returns whether it was accepted. */
  onCommit(keys: Keyframe[]): boolean
}

/**
 * One property's curve: its value over the clip's time, with its keys as handles.
 *
 * Drag a key to move it in time and value at once; it stops a frame short of its neighbours and
 * inside the property's range. Focus a key and use the arrows (←→ a frame, ↑↓ a step of value;
 * Shift ×10). The shape of the stretch after a key is its ease, edited in the box under the list.
 * The curve is sampled from the sampler the compositor draws from, and the playhead is drawn on
 * it, so the value under the line is the value on screen.
 *
 * A drag commits once, on release: the write goes through `edit_item`, whose refusal would
 * otherwise be said once per pixel.
 */
export function KeyframeGraph({ item, property, fps, selectedFrame, onSelect, onCommit }: KeyframeGraphProps): ReactNode {
  const stored = item.keyframes?.[property] ?? []
  const info = KEYFRAME_REGISTRY[property]
  const playhead = useEditor((state) => state.playhead)
  const svg = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<{ index: number; keys: Keyframe[] } | null>(null)
  const keys = drag?.keys ?? stored
  // The axis holds still through a drag: rescaling under the pointer would move the key away from it.
  const [held, setHeld] = useState<{ min: number; max: number } | null>(null)
  const range = held ?? graphRange(stored, info)
  const scale: GraphScale = { ...BOX, duration: item.durationInFrames, min: range.min, max: range.max }

  const toLocal = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = svg.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return { x: 0, y: 0 }
    return { x: ((clientX - rect.left) / rect.width) * BOX.width, y: ((clientY - rect.top) / rect.height) * BOX.height }
  }

  const active = useRef<number>(-1)
  const startDrag = useDrag({
    onStart: () => setHeld(range),
    onMove: (state) => {
      const index = active.current
      if (index < 0) return
      const at = toLocal(state.x, state.y)
      setDrag({ index, keys: dragKey(stored, index, frameAtX(at.x, scale), valueAtY(at.y, scale), item.durationInFrames, info) })
    },
    onEnd: (state) => {
      const index = active.current
      const at = toLocal(state.x, state.y)
      const next = dragKey(stored, index, frameAtX(at.x, scale), valueAtY(at.y, scale), item.durationInFrames, info)
      setDrag(null)
      setHeld(null)
      if (index >= 0 && onCommit(next)) onSelect(next[index]!.frame)
    },
    onClick: () => {
      setDrag(null)
      setHeld(null)
      const key = stored[active.current]
      if (key) onSelect(key.frame)
    }
  })

  const nudge = (event: KeyboardEvent, index: number): void => {
    const key = stored[index]
    if (!key) return
    const big = event.shiftKey ? 10 : 1
    const step = ((range.max - range.min) / 50) * big
    const move =
      event.key === 'ArrowLeft' ? { frame: key.frame - big, value: key.value }
      : event.key === 'ArrowRight' ? { frame: key.frame + big, value: key.value }
      : event.key === 'ArrowUp' ? { frame: key.frame, value: key.value + step }
      : event.key === 'ArrowDown' ? { frame: key.frame, value: key.value - step }
      : null
    if (!move) return
    event.preventDefault()
    const next = dragKey(stored, index, move.frame, move.value, item.durationInFrames, info)
    if (onCommit(next)) onSelect(next[index]!.frame)
  }

  const local = playhead - item.from
  const playheadOn = local >= 0 && local <= item.durationInFrames
  // From the list being shown, so the readout follows a drag in flight.
  const sampled = playheadOn ? keyframeValueAt(keys, local) : undefined
  const now = sampled === undefined || !Number.isFinite(sampled) ? null : sampled

  return (
    <figure className="mt-2">
      <svg
        ref={svg}
        viewBox={`0 0 ${BOX.width} ${BOX.height}`}
        className="block w-full touch-none rounded-sm border border-line bg-surface-0"
        role="group"
        aria-label={`${info.label} over the clip: ${stored.length} key${stored.length === 1 ? '' : 's'}`}
      >
        {/* The top and bottom of the range, and the clip's two ends. */}
        <rect x={BOX.pad} y={BOX.pad} width={BOX.width - BOX.pad * 2} height={BOX.height - BOX.pad * 2} fill="none" className="stroke-line" strokeWidth={1} />
        {playheadOn && <line x1={graphX(local, scale)} x2={graphX(local, scale)} y1={2} y2={BOX.height - 2} className="stroke-ink-2" strokeWidth={1} />}
        <path d={graphPath(keys, scale)} fill="none" className="stroke-accent" strokeWidth={1.5} strokeLinejoin="round" />
        {keys.map((key, index) => {
          const on = key.frame >= 0 && key.frame <= item.durationInFrames
          const isSelected = selectedFrame === (drag ? stored[index]?.frame : key.frame)
          return (
            <circle
              key={index}
              cx={graphX(Math.min(item.durationInFrames, Math.max(0, key.frame)), scale)}
              cy={graphY(Math.min(range.max, Math.max(range.min, key.value)), scale)}
              r={isSelected ? 5 : 4}
              tabIndex={0}
              role="slider"
              aria-label={`${info.label} key at ${formatTimecode(item.from + Math.max(0, key.frame), fps, true)}`}
              aria-valuenow={key.value}
              aria-valuemin={Number.isFinite(info.min) ? info.min : undefined}
              aria-valuemax={Number.isFinite(info.max) ? info.max : undefined}
              aria-valuetext={info.format(key.value)}
              className={cn(
                'cursor-grab outline-none focus-visible:stroke-ink-0',
                isSelected ? 'fill-accent stroke-ink-0' : on ? 'fill-surface-0 stroke-accent' : 'fill-surface-0 stroke-ink-2'
              )}
              strokeWidth={1.5}
              onPointerDown={(event) => {
                active.current = index
                startDrag(event)
              }}
              onKeyDown={(event) => nudge(event, index)}
              onFocus={() => onSelect(key.frame)}
            />
          )
        })}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[10px] tabular-nums text-ink-2">
        <span>{`${info.format(range.min)} – ${info.format(range.max)}`}</span>
        <span>{now === null ? 'Playhead off the clip' : `At playhead ${info.format(now)}`}</span>
      </figcaption>
    </figure>
  )
}
