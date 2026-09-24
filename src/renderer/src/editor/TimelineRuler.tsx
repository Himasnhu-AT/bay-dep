import { useLayoutEffect, type ReactNode, type RefObject } from 'react'
import { formatTimecode, type Marker } from '@shared/project'
import { useDrag } from '@/lib/useDrag'
import { useEditor } from '@/store/editor'
import { RulerMarkers } from './TimelineMarkers'

/** A label starts this far right of its tick (`left-1`). */
const LABEL_INSET = 4

/**
 * Hides each time label whose start has scrolled under the sticky track headers. Partly covered,
 * `0:00` read as `):00` — a label cut off at the header's edge reads as a different number, so
 * one is shown whole or not at all. Imperative, like the playhead: the lanes scroll far more
 * often than React should render the ruler. Called by the timeline on scroll and after every
 * ruler render.
 */
export function hideCoveredRulerLabels(ruler: HTMLElement | null, scrollLeft: number): void {
  if (!ruler) return
  for (const label of ruler.querySelectorAll<HTMLElement>('[data-ruler-label]')) {
    const left = Number(label.dataset.rulerLabel)
    label.style.visibility = left < scrollLeft ? 'hidden' : ''
  }
}

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

  // New labels (a zoom, a scroll past the render window) mount visible; recheck them at once.
  useLayoutEffect(() => {
    const ruler = innerRef.current
    const scroller = ruler?.closest<HTMLElement>('[data-timeline-scroller]')
    if (scroller) hideCoveredRulerLabels(ruler, scroller.scrollLeft)
  })

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
        Flags along the top edge, clear of the timecode labels at the bottom. A flag is a
        control: click to edit, drag to move (`TimelineMarkers`); the rest of the ruler scrubs.
      */}
      {/* Time ranges pinned in the agent composer: the stretch the agent has been told to stay
          inside, shown where the user can see it rather than only as a chip in a side panel. */}
      <PinnedRanges pixelsPerFrame={pixelsPerFrame} />
      <InOutRange pixelsPerFrame={pixelsPerFrame} durationFrames={durationFrames} fps={fps} />
      <RulerMarkers
        markers={markers}
        fps={fps}
        pixelsPerFrame={pixelsPerFrame}
        viewStart={viewStart}
        viewEnd={viewEnd}
      />
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
              <span
                data-ruler-label={frame * pixelsPerFrame + LABEL_INSET}
                className="absolute bottom-[11px] left-1 text-[10px] whitespace-nowrap text-ink-2 tabular-nums"
              >
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

/**
 * The In/Out range (I / O), shaded across the ruler. Either end alone reaches the timeline's edge.
 * Out is exclusive, so the shade stops where the Out frame begins. Neutral rather than accent, so
 * it never reads as the agent's pinned range, which is drawn in the same place.
 */
function InOutRange({
  pixelsPerFrame,
  durationFrames,
  fps
}: {
  pixelsPerFrame: number
  durationFrames: number
  fps: number
}): ReactNode {
  const rangeIn = useEditor((state) => state.rangeIn)
  const rangeOut = useEditor((state) => state.rangeOut)
  if (rangeIn === null && rangeOut === null) return null
  const from = rangeIn ?? 0
  const to = rangeOut ?? Math.max(from + 1, durationFrames)
  const label =
    `In ${rangeIn === null ? 'start' : formatTimecode(rangeIn, fps, true)} · ` +
    `Out ${rangeOut === null ? 'end' : formatTimecode(rangeOut, fps, true)}`
  return (
    <div
      data-in-out-range
      title={`${label}. ⌥X clears.`}
      aria-label={`In to Out range: ${label}`}
      className="pointer-events-none absolute inset-y-0 bg-ink-0/10"
      style={{ left: from * pixelsPerFrame, width: Math.max(1, (to - from) * pixelsPerFrame) }}
    >
      {rangeIn !== null && <div aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-ink-1" />}
      {rangeOut !== null && <div aria-hidden="true" className="absolute inset-y-0 right-0 w-0.5 bg-ink-1" />}
    </div>
  )
}
