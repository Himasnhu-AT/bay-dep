/**
 * Ripple delete: remove a span of time and close the hole behind it.
 *
 * `deleteSelected` lifts — it removes clips and leaves the gap where they were. That is the
 * right default for replacing a shot, and the wrong one for the job bay is mostly used for.
 * Cutting a podcast means removing the bits nobody should hear and letting everything after
 * slide up, and doing that by hand is: select, delete, then drag every later clip left by the
 * exact length you removed, on every track, without losing sync.
 *
 * **The operation takes a time range, not a selection, and that is the whole design.** A
 * selection lives on one track. Ripple a range on one track only and every other track keeps
 * its old timing, so a separate audio track drifts by the removed duration and stays drifted
 * for the rest of the programme — the failure is silent, arrives late, and gets worse with
 * each cut. Removing a *span* of the timeline is the operation that cannot desync, because
 * every unlocked track is shifted by the same amount.
 *
 * A locked track is the one case where sync cannot be preserved: bay must not move its items,
 * and leaving them is a drift. So the result reports which tracks were left behind rather
 * than quietly producing it — see `desyncedTrackIds`.
 */

import type { Frames, Item, Timeline, Transition } from './project'
import { framesToUs, itemEnd } from './project'
import { shiftKeyframes, sliceKeyframes } from './keyframes'

export interface RippleDeleteResult {
  /** How much timeline was removed. Zero means nothing overlapped and nothing moved. */
  removedFrames: Frames
  /** Items the range covered completely. */
  removedItemIds: string[]
  /** Items the range cut into, which survive shorter. */
  trimmedItemIds: string[]
  /** Items created because the range fell strictly inside one clip, splitting it in two. */
  createdItemIds: string[]
  /** Transitions dropped because a clip they joined is gone, or the cut they sat on is. */
  removedTransitionIds: string[]
  /**
   * Unlocked tracks shift; locked ones cannot. Any locked track holding content at or after
   * the cut is now out of sync with the rest by `removedFrames`, and this names it so a caller
   * can say so. Empty is the normal case and means sync was preserved everywhere.
   */
  desyncedTrackIds: string[]
}

const EMPTY: RippleDeleteResult = {
  removedFrames: 0,
  removedItemIds: [],
  trimmedItemIds: [],
  createdItemIds: [],
  removedTransitionIds: [],
  desyncedTrackIds: []
}

/** How far into a source `frames` of timeline reaches, at this item's speed. */
function sourceAdvanceUs(frames: Frames, fps: number, speed: number): number {
  return Math.round(framesToUs(frames, fps) * speed)
}

/**
 * Removes `[fromFrame, toFrame)` from `timeline`, mutating it, and shifts everything after.
 *
 * Half-open on purpose: `toFrame` is the first frame that survives, so the caller's "remove
 * frames 100 to 150" never has an off-by-one about whether 150 goes. Two adjacent calls with
 * a shared bound remove exactly the union, and a zero-length range removes nothing.
 *
 * @param makeId used for the two-piece case; supplied by the caller so ids come from one
 *   generator and tests can predict them.
 */
export function rippleDelete(
  timeline: Timeline,
  fromFrame: Frames,
  toFrame: Frames,
  makeId: () => string
): RippleDeleteResult {
  const start = Math.max(0, Math.round(fromFrame))
  const end = Math.round(toFrame)
  const span = end - start
  if (span <= 0) return { ...EMPTY }

  const result: RippleDeleteResult = {
    removedFrames: span,
    removedItemIds: [],
    trimmedItemIds: [],
    createdItemIds: [],
    removedTransitionIds: [],
    desyncedTrackIds: []
  }

  for (const track of timeline.tracks) {
    if (track.locked) {
      // Only a drift worth reporting is worth reporting: a locked track whose content all sits
      // before the cut is unaffected, and naming it would train the caller to ignore the field.
      if (track.items.some((item) => itemEnd(item) > start)) {
        result.desyncedTrackIds.push(track.id)
      }
      continue
    }

    const kept: Item[] = []
    for (const item of track.items) {
      const itemFrom = item.from
      const itemTo = itemEnd(item)

      // Entirely before the cut: untouched.
      if (itemTo <= start) {
        kept.push(item)
        continue
      }

      // Entirely after: slides left by the whole span.
      if (itemFrom >= end) {
        item.from = itemFrom - span
        kept.push(item)
        continue
      }

      // Entirely swallowed.
      if (itemFrom >= start && itemTo <= end) {
        result.removedItemIds.push(item.id)
        continue
      }

      // The range falls strictly inside one clip: it becomes two, abutting, with the middle
      // of the source skipped. This is a jump cut within a single take — the commonest thing
      // a transcript-driven cut produces, and the reason this branch exists at all.
      if (itemFrom < start && itemTo > end) {
        const headFrames = start - itemFrom
        const tailFrames = itemTo - end
        const tail: Item = {
          ...item,
          id: makeId(),
          from: start,
          durationInFrames: tailFrames,
          // The tail reads from where the *removed* part ended, not where the head stopped.
          sourceStartUs:
            item.sourceStartUs + sourceAdvanceUs(end - itemFrom, timeline.fps, item.speed),
          layout: { ...item.layout },
          // A fade-in belongs to the clip's original start, which the tail is not.
          fadeInFrames: 0,
          // Each side keeps the keys that shape it, so both draw exactly what the take did.
          keyframes: sliceKeyframes(item.keyframes, end - itemFrom, item.durationInFrames)
        }
        if (!tail.keyframes) delete tail.keyframes
        if (item.keyframes) item.keyframes = sliceKeyframes(item.keyframes, 0, headFrames)
        item.durationInFrames = headFrames
        item.fadeOutFrames = Math.min(item.fadeOutFrames, headFrames)
        tail.fadeOutFrames = Math.min(tail.fadeOutFrames, tailFrames)

        result.trimmedItemIds.push(item.id)
        result.createdItemIds.push(tail.id)
        kept.push(item, tail)
        continue
      }

      // Overlaps the cut's start: keep the head, drop the rest.
      if (itemFrom < start) {
        const headFrames = start - itemFrom
        item.durationInFrames = headFrames
        item.fadeOutFrames = Math.min(item.fadeOutFrames, headFrames)
        result.trimmedItemIds.push(item.id)
        kept.push(item)
        continue
      }

      // Overlaps the cut's end: drop the head, keep the tail, and land on the cut.
      const lost = end - itemFrom
      const tailFrames = itemTo - end
      item.from = start
      item.durationInFrames = tailFrames
      item.sourceStartUs += sourceAdvanceUs(lost, timeline.fps, item.speed)
      // The head went and the tail landed on the cut: keys stay on the footage they were on.
      if (item.keyframes) item.keyframes = shiftKeyframes(item.keyframes, -lost)
      item.fadeInFrames = Math.min(item.fadeInFrames, tailFrames)
      item.fadeOutFrames = Math.min(item.fadeOutFrames, tailFrames)
      result.trimmedItemIds.push(item.id)
      kept.push(item)
    }

    kept.sort((a, b) => a.from - b.from)
    track.items = kept
  }

  if (timeline.transitions && timeline.transitions.length > 0) {
    const gone = new Set(result.removedItemIds)
    const surviving = new Set<string>()
    for (const track of timeline.tracks) for (const item of track.items) surviving.add(item.id)

    const keptTransitions: Transition[] = []
    for (const transition of timeline.transitions) {
      // A transition joins two specific clips. If either is gone the junction is gone with it,
      // and a transition naming a missing item is a control that silently does nothing.
      const intact =
        !gone.has(transition.fromItemId) &&
        !gone.has(transition.toItemId) &&
        surviving.has(transition.fromItemId) &&
        surviving.has(transition.toItemId)
      if (intact) keptTransitions.push(transition)
      else result.removedTransitionIds.push(transition.id)
    }
    timeline.transitions = keptTransitions
  }

  // Markers name moments in the program, so they move with the time around them: after the cut
  // they slide up by the span, like every unlocked track. One *inside* the removed span names a
  // moment that no longer exists; it lands on the cut rather than vanishing, because a note
  // someone left is worth more than the exact frame it was on, and the cut is where that
  // moment went.
  for (const marker of timeline.markers ?? []) {
    if (marker.frame >= end) marker.frame -= span
    else if (marker.frame >= start) marker.frame = start
  }
  // Comments move the same way. A span loses whatever of it was removed, and one left with no
  // frames becomes a note on the cut.
  for (const comment of timeline.comments ?? []) {
    const shift = (frame: number): number => (frame >= end ? frame - span : frame >= start ? start : frame)
    comment.frame = shift(comment.frame)
    if (comment.endFrame !== undefined) {
      const endFrame = shift(comment.endFrame)
      if (endFrame > comment.frame) comment.endFrame = endFrame
      else delete comment.endFrame
    }
  }

  return result
}
