import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { Project, Timeline, Track } from '@shared/project'
import { Tooltip } from '@/components'
import { cn } from '@/lib/cn'
import { junctionsForTrack, whyNoRoom, type Junction } from '@/lib/junctions'
import { junctionTarget } from '@/lib/timelineLayout'

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
 * Cuts without one get a small target too — faint while the lane is hovered, full on hover and on
 * keyboard focus, so Tab walks the cuts — and that is the point rather than an oversight:
 * a transition lives on the junction, so the junction is what someone has to be able to
 * click. The alternative — dragging a transition from a panel onto a clip — has to guess
 * which of the clip's two edges was meant, and gives a refusal nowhere to appear when the
 * answer is "this cut cannot take one".
 *
 * A transition is drawn over the window it actually *plays*, not the one asked for. A 30-frame
 * dissolve clamped to 8 by a clip with no handles is invisible on the canvas and
 * indistinguishable from a straight cut, so the overlay spans the effective window, carries the
 * effective number, and turns to a warning when the two differ.
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
  /** `dialog`: ⌥-click, which asks for the transition dialog rather than the Inspector. */
  onOpen(junction: Junction, how: { dialog: boolean }): void
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
              : `Room for up to ${junction.capacityInFrames} frames. Click to add one in the Inspector, ⌥-click for a dialog.`

        // A transition that plays is drawn over the window it occupies, centred on the cut and
        // labelled, the way editors draw one — a 14px "20" badge read as a glyph, not an edit.
        if (stored && resolved) {
          const left = resolved.firstFrame * pixelsPerFrame
          const width = Math.max(14, (resolved.lastFrame + 1 - resolved.firstFrame) * pixelsPerFrame)
          const name = KIND_LABEL[stored.kind] ?? stored.kind
          const band = junctionTarget(0, height)
          return (
            <Tooltip key={junction.key} side="top" label={label} detail={clamped ? detail : 'Click to change or remove it in the Inspector, ⌥-click for a dialog.'}>
              <button
                type="button"
                aria-label={`Transition at frame ${junction.cutFrame}. ${label}. ${detail}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onOpen(junction, { dialog: event.altKey })
                }}
                className={cn(
                  't-fast absolute z-20 flex items-center justify-center gap-1 overflow-hidden rounded-xs border px-1 text-[10px] leading-none whitespace-nowrap',
                  clamped
                    ? 'border-danger/70 bg-danger/25 text-on-media hover:bg-danger/40'
                    : 'border-accent/80 bg-accent/30 text-on-media hover:bg-accent/45'
                )}
                // The same band of the lane as a bare cut's target, so the handles and fade
                // corners above and below it stay reachable under a transition too.
                style={{ left, width, top: band.top, height: band.height }}
              >
                {clamped && <AlertTriangle aria-hidden="true" className="size-2.5 shrink-0" />}
                {/* Name when it fits, frames always: the frame count is what the handles allowed. */}
                {/* Roughly 5.5px a character at 10px, plus the frame count and padding: a name
                    that would truncate to "Cross dis…" is left out rather than cut. */}
                {width >= name.length * 5.5 + 36 && <span className="truncate">{name}</span>}
                <span className="shrink-0 tabular-nums">{resolved.durationInFrames}f</span>
              </button>
            </Tooltip>
          )
        }

        const target = junctionTarget(junction.cutFrame * pixelsPerFrame, height)
        return (
          <Tooltip key={junction.key} side="top" label={label} detail={detail}>
            <button
              type="button"
              aria-label={`Transition at frame ${junction.cutFrame}. ${label}. ${detail}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                onOpen(junction, { dialog: event.altKey })
              }}
              className={cn(
                // A short pill in the middle of the lane (`junctionTarget`): the top and bottom
                // of the cut stay with the two trim handles and the fade corners, which a
                // full-height zone here used to cover. Faint while the lane is hovered, full on
                // hover or focus; Tab reaches it.
                't-fast absolute z-20 flex items-center justify-center',
                // Stored but drawing nothing is never hidden: it is a fault, not an affordance.
                broken
                  ? 'opacity-100'
                  : 'opacity-0 group-hover/lane:opacity-50 hover:opacity-100! focus-visible:opacity-100!'
              )}
              style={target}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-full items-center justify-center rounded-xs border',
                  broken
                    ? 'border-danger/70 bg-danger/25 text-danger'
                    : noRoom !== null
                      ? 'border-line bg-surface-3 text-ink-2'
                      : 'border-accent/80 bg-surface-2 text-accent'
                )}
              >
                {broken ? (
                  <AlertTriangle className="size-2.5" />
                ) : (
                  // An hourglass-ish pinch: two triangles meeting at the cut. Reads as
                  // "things cross here" at 16px, which a plus sign does not.
                  <svg viewBox="0 0 8 10" className="size-2">
                    <path d="M0 0 L4 5 L0 10 Z M8 0 L4 5 L8 10 Z" fill="currentColor" />
                  </svg>
                )}
              </span>
            </button>
          </Tooltip>
        )
      })}
    </>
  )
}
