import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { Project, Timeline, Track } from '@shared/project'
import { Tooltip } from '@/components'
import { cn } from '@/lib/cn'
import { junctionsForTrack, whyNoRoom, type Junction } from '@/lib/junctions'

const KIND_LABEL: Record<string, string> = {
  'cross-dissolve': 'Cross dissolve',
  'dip-to-black': 'Dip to black',
  'dip-to-white': 'Dip to white',
  wipe: 'Wipe',
  push: 'Push',
  slide: 'Slide',
  iris: 'Iris'
}

/**
 * A handle on every cut in a track, whether or not it carries a transition.
 *
 * Cuts without one are marked too, faintly, and that is the point rather than an oversight:
 * a transition lives on the junction, so the junction is what someone has to be able to
 * click. The alternative — dragging a transition from a panel onto a clip — has to guess
 * which of the clip's two edges was meant, and gives a refusal nowhere to appear when the
 * answer is "this cut cannot take one".
 *
 * The marker says what the transition will actually *play*, not what was asked for. A
 * 30-frame dissolve clamped to 8 by a clip with no handles is invisible on the canvas and
 * indistinguishable from a straight cut, so the badge carries the effective number and a
 * warning glyph when the two differ.
 */
export function JunctionMarkers({
  project,
  timeline,
  track,
  pixelsPerFrame,
  height,
  onOpen
}: {
  project: Project
  timeline: Timeline
  track: Track
  pixelsPerFrame: number
  height: number
  onOpen(junction: Junction): void
}): ReactNode {
  const junctions = junctionsForTrack(project, timeline, track)
  if (junctions.length === 0) return null

  return (
    <>
      {junctions.map((junction) => {
        const resolved = junction.resolved
        const stored = junction.transition
        const noRoom = whyNoRoom(junction)
        const clamped = resolved?.clampedBecause != null
        // Stored but drawing nothing is its own state, and the worst one to leave silent:
        // the project says there is a dissolve here and the picture cuts.
        const broken = stored != null && resolved === null

        const label = stored
          ? `${KIND_LABEL[stored.kind] ?? stored.kind}${
              resolved ? `, ${resolved.durationInFrames} frames` : ''
            }`
          : 'No transition on this cut'

        const detail = broken
          ? 'Stored, but nothing is drawing here.'
          : clamped
            ? `Asked for ${stored?.durationInFrames}, playing ${resolved?.durationInFrames} — ${resolved?.clampedBecause}.`
            : noRoom !== null
              ? 'This cut cannot take one — click to see why.'
              : `Room for up to ${junction.capacityInFrames} frames. Click to add one.`

        return (
          <Tooltip key={junction.key} side="top" label={label} detail={detail}>
            <button
              type="button"
              aria-label={`Transition at frame ${junction.cutFrame}. ${label}. ${detail}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                onOpen(junction)
              }}
              className={cn(
                'absolute z-20 flex -translate-x-1/2 items-center justify-center rounded-xs border t-fast',
                // Present but quiet when there is nothing here yet; a row of loud badges
                // across every cut would make the timeline unreadable.
                stored
                  ? broken || clamped
                    ? 'border-danger/70 bg-danger/25 text-danger'
                    : 'border-accent/70 bg-accent/25 text-accent'
                  : noRoom !== null
                    ? 'border-line bg-surface-3/60 text-ink-2 opacity-0 hover:opacity-100'
                    : 'border-line-strong bg-surface-3 text-ink-1 opacity-40 hover:opacity-100'
              )}
              style={{
                left: junction.cutFrame * pixelsPerFrame,
                top: Math.max(2, height / 2 - 7),
                height: 14,
                minWidth: 14,
                paddingInline: stored ? 3 : 0
              }}
            >
              {broken || clamped ? (
                <AlertTriangle aria-hidden="true" className="size-2.5" />
              ) : stored ? (
                <span className="text-[9px] leading-none tabular-nums">
                  {resolved?.durationInFrames}
                </span>
              ) : (
                // An hourglass-ish pinch: two triangles meeting at the cut. Reads as
                // "things cross here" at 14px, which a plus sign does not.
                <svg viewBox="0 0 8 10" aria-hidden="true" className="size-2">
                  <path d="M0 0 L4 5 L0 10 Z M8 0 L4 5 L8 10 Z" fill="currentColor" />
                </svg>
              )}
            </button>
          </Tooltip>
        )
      })}
    </>
  )
}
