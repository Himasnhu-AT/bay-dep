/**
 * What a timeline drag snaps to, and the snap itself — out of `Timeline.tsx` so the target set
 * can be tested without mounting React.
 *
 * Targets: the origin, the playhead, every other clip's two edges, every marker, and every beat
 * of a placed clip whose file has been through `detect_beats` (`beatSnapFrames`, the same
 * mapping the tool reports, so a drag lands on the frame the agent was told).
 */

import { beatSnapFrames } from '@shared/beats'
import { allItems, itemEnd, type Frames, type Project, type Timeline } from '@shared/project'

export function snapTargets(project: Project, timeline: Timeline, playhead: Frames, ignore: ReadonlySet<string>): Frames[] {
  const targets: Frames[] = [0, playhead]
  for (const item of allItems(timeline)) {
    if (ignore.has(item.id)) continue
    targets.push(item.from, itemEnd(item))
  }
  for (const marker of timeline.markers ?? []) targets.push(marker.frame)
  targets.push(...beatSnapFrames(project, timeline, ignore))
  return targets
}

/**
 * The nearest target within `tolerance` frames of `frame`, or `frame` rounded when none is. The
 * tolerance is the caller's pixels over the zoom, so it is the same distance on screen at any zoom.
 */
export function snapFrame(frame: number, targets: readonly Frames[], tolerance: number): Frames {
  let best = Math.round(frame)
  let bestDistance = tolerance
  for (const candidate of targets) {
    const distance = Math.abs(candidate - frame)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return Math.max(0, Math.round(best))
}
