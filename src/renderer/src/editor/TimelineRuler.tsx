import type { ReactNode, RefObject } from 'react'
import { formatTimecode, type Marker } from '@shared/project'
import { useDrag } from '@/lib/useDrag'
import { useEditor } from '@/store/editor'

export interface TimelineRulerProps {
  fps: number
  pixelsPerFrame: number
  /** Full scrollable width of the lane area, in CSS pixels. */
  contentWidth: number
  durationFrames: number
  /** Timeline markers, drawn as flags along the top edge. */
  markers: readonly Marker[]
  /** Visible frame window, so a two-hour timeline does not mount ten thousand ticks. */
  viewStart: number
  viewEnd: number
  /**
   * The ruler's own element. Timeline needs its rect to turn a `clientX` into a frame —
   * the ruler shares an x-origin with every lane, and unlike a lane it is always mounted.
   */
  innerRef: RefObject<HTMLDivElement | null>
  onScrubStart(): void
  onScrub(clientX: number): void
  onScrubEnd(): void
}

/**
 * Tick density adapts to zoom, and labels are always timecode.
 *
 * Raw frame numbers are the tempting thing to draw — they are what the model stores — but
 * nobody edits at frame 4,271. The step is chosen so a label gets at least 72px, which is
 * wide enough for `1:04:09` without two labels ever touching.
 */
function chooseStep(fps: number, pixelsPerFrame: number): { label: number; minor: number } {
  const seconds = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]
  for (const step of seconds) {
    const frames = Math.max(1, Math.round(step * fps))
    if (frames * pixelsPerFrame >= 72) {
      // Five subdivisions reads as a ruler; ten reads as hatching at this size.
      const minor = Math.max(1, Math.round(frames / 5))
      return { label: frames, minor: minor * pixelsPerFrame >= 5 ? minor : frames }
    }
  }
  const fallback = Math.max(1, Math.round(3600 * fps))
  return { label: fallback, minor: fallback }
}

export function TimelineRuler({
  fps,
  pixelsPerFrame,
  contentWidth,
  durationFrames,
  markers,
  viewStart,
  viewEnd,
  innerRef,
  onScrubStart,
  onScrub,
  onScrubEnd
}: TimelineRulerProps): ReactNode {
  const { label: labelStep, minor: minorStep } = chooseStep(fps, pixelsPerFrame)
  const withFrames = labelStep < fps

  const first = Math.max(0, Math.floor(viewStart / minorStep) * minorStep)
  const last = Math.ceil(viewEnd / minorStep) * minorStep
  const ticks: number[] = []
  // A hard ceiling: no combination of zoom and viewport may ask for an unbounded number
  // of nodes, whatever the arithmetic above produces.
  for (let frame = first; frame <= last && ticks.length < 900; frame += minorStep) {
    ticks.push(frame)
  }

  const onPointerDown = useDrag({
    onStart: (state) => {
      onScrubStart()
      onScrub(state.x)
    },
    onMove: (state) => onScrub(state.x),
    onEnd: () => onScrubEnd(),
    onClick: () => onScrubEnd()
  })

  return (
    <div
      ref={innerRef}
      role="slider"
      aria-label="Playhead — drag to scrub"
      aria-valuemin={0}
      aria-valuemax={durationFrames}
      // `aria-valuenow` is written imperatively by Timeline alongside the playhead's
      // position. Passing it as a prop would subscribe this component to the playhead and
      // re-render the whole ruler 30 times a second during playback.
      tabIndex={-1}
      onPointerDown={onPointerDown}
      className="relative h-[26px] shrink-0 cursor-ew-resize border-b border-line bg-surface-1 select-none"
      style={{ width: contentWidth }}
    >
      {/*
        Flags along the top edge, clear of the timecode labels at the bottom. Pointer events stay
        on so the label shows as a tooltip; a press still bubbles to the ruler and scrubs, so a
        marker never gets in the way of moving the playhead — and pressing one lands on it.
        Only markers inside the visible window are mounted, for the same reason ticks are.
      */}
      {/* Time ranges pinned in the agent composer: the stretch the agent has been told to stay
          inside, shown where the user can see it rather than only as a chip in a side panel. */}
      <PinnedRanges pixelsPerFrame={pixelsPerFrame} />
      {markers
        .filter((marker) => marker.frame >= viewStart && marker.frame <= viewEnd)
        .map((marker) => (
          <div
            key={marker.id}
            title={`${marker.label} · ${formatTimecode(marker.frame, fps, true)}`}
            aria-label={`Marker: ${marker.label}`}
            className="absolute top-0 z-[1] -ml-[4px] h-[9px] w-[9px]"
            style={{ left: marker.frame * pixelsPerFrame }}
          >
            <div
              aria-hidden="true"
              className="size-full [clip-path:polygon(0_0,100%_0,100%_60%,50%_100%,0_60%)]"
              style={{ backgroundColor: marker.color ?? 'var(--color-accent)' }}
            />
          </div>
        ))}
      {ticks.map((frame) => {
        const major = frame % labelStep === 0
        return (
          <div
            key={frame}
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0"
            style={{ left: frame * pixelsPerFrame }}
          >
            <div className={major ? 'h-2.5 w-px bg-line-strong' : 'h-1.5 w-px bg-line'} />
            {major && (
              <span className="absolute bottom-[11px] left-1 text-[10px] whitespace-nowrap text-ink-2 tabular-nums">
                {formatTimecode(frame, fps, withFrames)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function PinnedRanges({ pixelsPerFrame }: { pixelsPerFrame: number }): ReactNode {
  const ranges = useEditor((state) => state.agentPins).filter((pin) => pin.kind === 'range')
  if (ranges.length === 0) return null
  return (
    <>
      {ranges.map((range) =>
        range.kind === 'range' ? (
          <div
            key={`${range.fromFrame}-${range.toFrame}`}
            title="Pinned for the agent — it works only inside this range"
            className="pointer-events-none absolute inset-y-0 border-x border-accent/70 bg-accent/15"
            style={{
              left: range.fromFrame * pixelsPerFrame,
              width: Math.max(1, (range.toFrame - range.fromFrame) * pixelsPerFrame)
            }}
          />
        ) : null
      )}
    </>
  )
}
