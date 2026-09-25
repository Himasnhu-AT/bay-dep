import { useEffect, useState, type ReactNode } from 'react'
import { Bookmark, Plus, Trash2 } from 'lucide-react'
import { formatTimecode, type Marker } from '@shared/project'
import { shortcutOf } from '@shared/commands'
import { Button, IconButton, Kbd, Popover, TextField, useFloatingTrigger } from '@/components'
import { cn } from '@/lib/cn'
import { useDrag } from '@/lib/useDrag'
import { selectTimeline, useEditor } from '@/store/editor'

/**
 * Marker colours: a small fixed set, so markers stay a vocabulary (red = fix, green = good…)
 * rather than a colour picker. `null` is the default marker colour (the accent), stored as
 * absence. These are *data* — written into the project as the model's hex — not chrome.
 */
export const MARKER_COLORS: readonly { value: string | null; name: string }[] = [
  { value: null, name: 'Default' },
  { value: '#E5484D', name: 'Red' },
  { value: '#F5A524', name: 'Amber' },
  { value: '#30A46C', name: 'Green' },
  { value: '#3E8BF5', name: 'Blue' },
  { value: '#8E4EC6', name: 'Purple' }
]

const NO_MARKERS: readonly Marker[] = []

function markerColor(marker: Marker): string {
  return marker.color ?? 'var(--color-accent)'
}

/** Label, colour, jump and delete for one marker — the body of the marker's popover. */
function MarkerEditor({ marker, fps, onDone }: { marker: Marker; fps: number; onDone(): void }): ReactNode {
  const [draft, setDraft] = useState(marker.label)
  useEffect(() => setDraft(marker.label), [marker.label])

  const commitLabel = (): void => {
    const next = draft.trim()
    if (!next) setDraft(marker.label)
    else if (next !== marker.label) useEditor.getState().patchMarker(marker.id, { label: next })
  }

  return (
    <div className="flex flex-col gap-2">
      <TextField
        label="Marker name"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitLabel}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitLabel()
            onDone()
          }
        }}
      />
      <div role="radiogroup" aria-label="Marker colour" className="flex items-center gap-1.5">
        {MARKER_COLORS.map((option) => {
          const checked = (marker.color ?? null) === option.value
          return (
            <button
              key={option.name}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={option.name}
              title={option.name}
              onClick={() => useEditor.getState().patchMarker(marker.id, { color: option.value })}
              className={cn(
                't-press size-5 rounded-xs border active:scale-[0.96]',
                checked ? 'border-ink-0 ring-1 ring-ink-0' : 'border-line-strong'
              )}
              style={{ backgroundColor: option.value ?? 'var(--color-accent)' }}
            />
          )
        })}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="mr-auto text-[11px] text-ink-2 tabular-nums">{formatTimecode(marker.frame, fps, true)}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            useEditor.getState().setPlayhead(marker.frame)
            onDone()
          }}
        >
          Go to
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon={<Trash2 className="size-3" />}
          onClick={() => {
            onDone()
            useEditor.getState().removeMarker(marker.id)
          }}
        >
          Delete
        </Button>
      </div>
    </div>
  )
}

/**
 * One flag on the ruler. Click opens its popover; drag moves it (one undo step, on release);
 * Enter/Space open it from the keyboard and ←/→ nudge it a frame (⇧ for ten).
 *
 * A press on a flag does not reach the ruler — it would scrub the playhead to the pointer on
 * every attempt to grab a marker.
 */
function MarkerFlag({ marker, fps, pixelsPerFrame }: { marker: Marker; fps: number; pixelsPerFrame: number }): ReactNode {
  const [dragFrame, setDragFrame] = useState<number | null>(null)
  const popover = useFloatingTrigger('dialog')

  const begin = useDrag({
    onMove: (state) => setDragFrame(Math.max(0, Math.round(marker.frame + state.dx / pixelsPerFrame))),
    onEnd: (state) => {
      const frame = Math.max(0, Math.round(marker.frame + state.dx / pixelsPerFrame))
      setDragFrame(null)
      if (frame !== marker.frame) useEditor.getState().moveMarker(marker.id, frame)
    },
    onClick: () => {
      setDragFrame(null)
      popover.setOpen(true)
    }
  })

  const frame = dragFrame ?? marker.frame
  return (
    <>
      <button
        ref={popover.triggerProps.ref}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={popover.open}
        aria-label={`Marker ${marker.label} at ${formatTimecode(marker.frame, fps, true)}. Enter to edit, arrows to move`}
        title={`${marker.label} · ${formatTimecode(frame, fps, true)} — drag to move, click to edit`}
        onPointerDown={(event) => {
          event.stopPropagation()
          begin(event)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            popover.setOpen(true)
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            event.stopPropagation()
            const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowLeft' ? -1 : 1)
            useEditor.getState().moveMarker(marker.id, Math.max(0, marker.frame + step))
          }
        }}
        className={cn(
          'absolute top-0 z-[2] -ml-[5px] h-[10px] w-[11px] cursor-grab active:cursor-grabbing',
          dragFrame !== null && 'z-[3]'
        )}
        style={{ left: frame * pixelsPerFrame }}
      >
        <span
          aria-hidden="true"
          className="block size-full [clip-path:polygon(0_0,100%_0,100%_60%,50%_100%,0_60%)]"
          style={{ backgroundColor: markerColor(marker) }}
        />
      </button>
      {dragFrame !== null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-[11px] z-[3] -translate-x-1/2 rounded-xs border border-line bg-surface-2 px-1 text-[10px] text-ink-0 tabular-nums shadow-pop"
          style={{ left: frame * pixelsPerFrame }}
        >
          {formatTimecode(frame, fps, true)}
        </span>
      )}
      <Popover {...popover.surfaceProps} label={`Edit marker ${marker.label}`} side="bottom" align="start">
        <MarkerEditor marker={marker} fps={fps} onDone={() => popover.setOpen(false)} />
      </Popover>
    </>
  )
}

/**
 * The flags along the ruler's top edge. Only markers inside the visible window are mounted, for
 * the same reason ticks are. The strip sits above the playhead's head (which starts below it),
 * so a marker on the playhead frame stays visible.
 */
export function RulerMarkers({
  markers,
  fps,
  pixelsPerFrame,
  viewStart,
  viewEnd
}: {
  markers: readonly Marker[]
  fps: number
  pixelsPerFrame: number
  viewStart: number
  viewEnd: number
}): ReactNode {
  return (
    <>
      {markers
        .filter((marker) => marker.frame >= viewStart && marker.frame <= viewEnd)
        .map((marker) => (
          <MarkerFlag key={marker.id} marker={marker} fps={fps} pixelsPerFrame={pixelsPerFrame} />
        ))}
    </>
  )
}

/**
 * Every marker in time order, with jump-to — the toolbar's Markers button. The one place a
 * marker off-screen, or under a clip edge, can be found.
 */
export function MarkerListButton({ fps }: { fps: number }): ReactNode {
  const markers = useEditor((state) => selectTimeline(state)?.markers ?? NO_MARKERS)
  const list = useFloatingTrigger('dialog')
  const sorted = [...markers].sort((a, b) => a.frame - b.frame)

  return (
    <>
      <IconButton
        {...list.triggerProps}
        size="xs"
        label={markers.length === 0 ? 'Markers — none yet' : `Markers (${markers.length})`}
        icon={<Bookmark className="size-3" />}
        active={list.open}
      />
      <Popover {...list.surfaceProps} label="Markers" side="bottom" align="start" width={260}>
        <div className="flex flex-col gap-2">
          {sorted.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-ink-2">
              No markers yet. Press <Kbd shortcut={shortcutOf('mark.add') ?? 'M'} /> to add one at the playhead.
            </p>
          ) : (
            <ul className="-mx-1 flex max-h-64 flex-col overflow-y-auto">
              {sorted.map((marker) => (
                <li key={marker.id}>
                  <button
                    type="button"
                    onClick={() => {
                      useEditor.getState().setPlayhead(marker.frame)
                      list.setOpen(false)
                    }}
                    className="t-fast flex h-7 w-full items-center gap-2 rounded-sm px-1 text-left text-[12px] text-ink-0 hover:bg-surface-4"
                  >
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-xs" style={{ backgroundColor: markerColor(marker) }} />
                    <span className="min-w-0 flex-1 truncate">{marker.label}</span>
                    <span className="text-[11px] text-ink-2 tabular-nums">{formatTimecode(marker.frame, fps, true)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button
            size="sm"
            icon={<Plus className="size-3" />}
            onClick={() => {
              const state = useEditor.getState()
              state.addMarker(state.playhead)
            }}
          >
            Add marker at playhead
          </Button>
        </div>
      </Popover>
    </>
  )
}
