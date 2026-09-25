/**
 * Dragging a transition from the Effects Library onto a cut on the timeline.
 *
 * The payload names the transition and the kind of track it is for; the lane that receives it
 * picks the cut nearest the pointer (`dropJunction`) and applies it there, the same edit a click
 * in the library makes (`applyTransitionAt`).
 */

import type { Frames, Project, Timeline, TransitionKind } from '@shared/project'
import { junctionsForTrack, type Junction } from './junctions'

export const TRANSITION_DRAG_TYPE = 'application/x-bay-transition'

export interface TransitionDrag {
  kind: TransitionKind
  trackKind: 'video' | 'audio'
  label: string
}

export function encodeTransitionDrag(drag: TransitionDrag): string {
  return JSON.stringify(drag)
}

export function decodeTransitionDrag(raw: string): TransitionDrag | null {
  try {
    const value = JSON.parse(raw) as Partial<TransitionDrag>
    if (typeof value.kind !== 'string' || (value.trackKind !== 'video' && value.trackKind !== 'audio')) return null
    return { kind: value.kind as TransitionKind, trackKind: value.trackKind, label: typeof value.label === 'string' ? value.label : value.kind }
  } catch {
    return null
  }
}

/** How far from a cut, in screen pixels, a drop still lands on it. */
export const DROP_REACH_PX = 24

/**
 * The cut on `trackId` a drop at `frame` lands on: the nearest one within `DROP_REACH_PX`, or null
 * when the lane has none that close — a drop in the middle of a clip is not a guess at a cut.
 */
export function dropJunction(
  project: Project,
  timeline: Timeline,
  trackId: string,
  frame: Frames,
  pixelsPerFrame: number
): Junction | null {
  const track = timeline.tracks.find((candidate) => candidate.id === trackId)
  if (!track) return null
  const reach = DROP_REACH_PX / Math.max(1e-6, pixelsPerFrame)
  let best: Junction | null = null
  for (const junction of junctionsForTrack(project, timeline, track)) {
    const distance = Math.abs(junction.cutFrame - frame)
    if (distance > reach) continue
    if (!best || distance < Math.abs(best.cutFrame - frame)) best = junction
  }
  return best
}
