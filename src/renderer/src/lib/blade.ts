/**
 * The blade tool's arithmetic, out of `Timeline.tsx` so it can be tested without a window: which
 * frame a click on a clip cuts at, and which part of a clip the pointer is over.
 */

import type { Frames } from '@shared/project'

/**
 * The frame a blade click at `raw` (fractional frames under the pointer) cuts `clip` at, or null
 * when there is no cut to make there.
 *
 * `snap` is the timeline's own snap (playhead, other clips' edges, markers, beats — suspended
 * with ⌘ or when snapping is off). A snap that lands on or outside the clip's own edges is not
 * taken: a cut on an edge makes a zero-length clip, which the split refuses, so the click would
 * do nothing. It falls back to the frame under the pointer instead, and only that frame landing
 * on an edge too means there is no cut.
 */
export function bladeFrame(raw: number, clip: { from: Frames; durationInFrames: Frames }, snap: (frame: number) => Frames): Frames | null {
  const end = clip.from + clip.durationInFrames
  const inside = (frame: Frames): boolean => frame > clip.from && frame < end
  const snapped = snap(raw)
  if (inside(snapped)) return snapped
  const under = Math.round(raw)
  return inside(under) ? under : null
}

/** Pixels at each end of a clip that are its trim handle (`Clip.tsx` draws them `w-2`). */
export const TRIM_HANDLE_PX = 8

/**
 * Which part of a clip `x` (pixels from the clip's left edge) is over: a trim handle or the
 * body. The end handle is drawn after the start one, so where two overlap on a sliver of a clip
 * the end handle is on top and takes the press — and so it wins here.
 */
export function clipZone(x: number, widthPx: number): 'start' | 'end' | 'body' {
  if (x >= widthPx - TRIM_HANDLE_PX) return 'end'
  if (x < TRIM_HANDLE_PX) return 'start'
  return 'body'
}

/** The nearer edge of a clip to `x` — where an armed roll (no handle grabbed) rolls. */
export function nearerEdge(x: number, widthPx: number): 'start' | 'end' {
  return x < widthPx / 2 ? 'start' : 'end'
}
