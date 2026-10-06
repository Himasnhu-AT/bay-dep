/**
 * Making room for a source clip: the two halves of an NLE's Insert and Overwrite edits.
 *
 * **Insert** is `rippleDelete` run backwards, and it keeps sync for the same reason: it opens a
 * span of *time* at a frame on every unlocked track at once, splitting whatever the frame
 * crosses, so a separate sound track moves with its picture. Opening room on one track only
 * would slide that track's later clips away from everything above and below them for the rest
 * of the programme. A locked track cannot move, so it is named (`desyncedTrackIds`) rather than
 * silently left behind.
 *
 * **Overwrite** moves nothing: it clears `[from, to)` on one track — trimming or splitting what
 * the span cuts into, removing what it covers — so the new clip lands over what was there.
 *
 * Neither places anything; the caller places the clip into the room made, inside one
 * transaction, so the edit is one undo step.
 */

import type { Frames, Item, Timeline, Transition } from './project'
import { itemEnd, sourceEdgeAt } from './project'
import { rippleDelete } from './ripple'
import { sliceKeyframes } from './keyframes'

export interface OpenSpanResult {
  /** Items the frame fell strictly inside, now two pieces; the ids of the new later pieces. */
  createdItemIds: string[]
  /** The same splits as pairs: the head keeps its id, the tail is new. */
  split: { headId: string; tailId: string }[]
  /** Items removed because the overwritten span covered them completely. */
  removedItemIds: string[]
  /** Transitions dropped because the two clips they joined no longer meet. */
  removedTransitionIds: string[]
  /** Locked tracks with content after the insert point: they could not move and are now adrift. */
  desyncedTrackIds: string[]
}

/** Transitions whose two clips met before and do not now, or of which one clip is gone. */
function dropBrokenTransitions(timeline: Timeline, abuttedBefore: Set<string>, result: OpenSpanResult): void {
  if (!timeline.transitions || timeline.transitions.length === 0) return
  const byId = new Map<string, Item>()
  for (const track of timeline.tracks) for (const item of track.items) byId.set(item.id, item)
  const kept: Transition[] = []
  for (const transition of timeline.transitions) {
    const from = byId.get(transition.fromItemId)
    const to = byId.get(transition.toItemId)
    const meets = from !== undefined && to !== undefined && itemEnd(from) === to.from
    // One that did not meet before is not this edit's to judge — unless a clip it names is gone.
    const intact = from !== undefined && to !== undefined
    if (meets || (intact && !abuttedBefore.has(transition.id))) kept.push(transition)
    else result.removedTransitionIds.push(transition.id)
  }
  timeline.transitions = kept
}

function abutting(timeline: Timeline): Set<string> {
  const byId = new Map<string, Item>()
  for (const track of timeline.tracks) for (const item of track.items) byId.set(item.id, item)
  const out = new Set<string>()
  for (const transition of timeline.transitions ?? []) {
    const from = byId.get(transition.fromItemId)
    const to = byId.get(transition.toItemId)
    if (from && to && itemEnd(from) === to.from) out.add(transition.id)
  }
  return out
}

/** A transition leaving `itemId` (at its end) now leaves the later piece, which owns that end. */
function moveOutgoing(timeline: Timeline, itemId: string, toId: string): void {
  for (const transition of timeline.transitions ?? []) {
    if (transition.fromItemId === itemId) transition.fromItemId = toId
  }
}

/**
 * Opens `span` frames at `at` on every unlocked track, mutating `timeline`: clips at or after
 * `at` slide right by `span`, a clip `at` falls inside is split and its later piece slides, and
 * markers at or after `at` move with the time around them.
 */
export function insertTime(timeline: Timeline, at: Frames, span: Frames, makeId: () => string): OpenSpanResult {
  const start = Math.max(0, Math.round(at))
  const length = Math.round(span)
  const result: OpenSpanResult = { createdItemIds: [], split: [], removedItemIds: [], removedTransitionIds: [], desyncedTrackIds: [] }
  if (length <= 0) return result
  const abuttedBefore = abutting(timeline)

  for (const track of timeline.tracks) {
    if (track.locked) {
      if (track.items.some((item) => itemEnd(item) > start)) result.desyncedTrackIds.push(track.id)
      continue
    }
    const additions: Item[] = []
    for (const item of track.items) {
      if (item.from >= start) {
        item.from += length
        continue
      }
      const end = itemEnd(item)
      if (end <= start) continue
      // The frame falls inside this clip: the head stays, the tail reads on from where the head
      // stopped and lands after the opened span.
      const headFrames = start - item.from
      const tailFrames = item.durationInFrames - headFrames
      const tail: Item = {
        ...item,
        id: makeId(),
        from: start + length,
        durationInFrames: tailFrames,
        sourceStartUs: sourceEdgeAt(item, headFrames, timeline.fps),
        layout: { ...item.layout },
        fadeInFrames: 0,
        keyframes: sliceKeyframes(item.keyframes, headFrames, item.durationInFrames)
      }
      if (!tail.keyframes) delete tail.keyframes
      // A J lead belongs to the clip's first cut and an L trail to its last; the opened span
      // between the halves is a hard cut in and out, so each half keeps only its own outer offset.
      delete tail.audioLeadFrames
      delete item.audioTrailFrames
      if (item.keyframes) item.keyframes = sliceKeyframes(item.keyframes, 0, headFrames)
      item.durationInFrames = headFrames
      item.fadeOutFrames = Math.min(item.fadeOutFrames, headFrames)
      tail.fadeOutFrames = Math.min(tail.fadeOutFrames, tailFrames)
      moveOutgoing(timeline, item.id, tail.id)
      additions.push(tail)
      result.createdItemIds.push(tail.id)
      result.split.push({ headId: item.id, tailId: tail.id })
    }
    if (additions.length > 0) track.items.push(...additions)
    track.items.sort((a, b) => a.from - b.from)
  }

  for (const marker of timeline.markers ?? []) {
    if (marker.frame >= start) marker.frame += length
  }
  for (const comment of timeline.comments ?? []) {
    // A span the insert lands inside grows by it, like a clip straddling the point is split around it.
    if (comment.frame >= start) comment.frame += length
    if (comment.endFrame !== undefined && comment.endFrame > start) comment.endFrame += length
  }
  dropBrokenTransitions(timeline, abuttedBefore, result)
  return result
}

/**
 * Clears `[from, to)` on one track and moves nothing, mutating `timeline`. A locked or missing
 * track is refused with `null`; the caller says why.
 */
export function liftRange(
  timeline: Timeline,
  trackId: string,
  from: Frames,
  to: Frames,
  makeId: () => string
): OpenSpanResult | null {
  const track = timeline.tracks.find((t) => t.id === trackId)
  if (!track || track.locked) return null
  const start = Math.max(0, Math.round(from))
  const end = Math.round(to)
  const result: OpenSpanResult = { createdItemIds: [], split: [], removedItemIds: [], removedTransitionIds: [], desyncedTrackIds: [] }
  if (end <= start) return result
  const abuttedBefore = abutting(timeline)

  // The trimming is `rippleDelete`'s, run on this track alone (no transitions, no markers — those
  // are handled here), and then the shift it made is undone: everything it moved to or past
  // `start` goes back right by the span, which leaves each piece exactly where it was.
  const alone: Timeline = { ...timeline, tracks: [track], transitions: [], markers: [], comments: [] }
  const ripple = rippleDelete(alone, start, end, makeId)
  for (const item of track.items) if (item.from >= start) item.from += end - start
  // A span strictly inside one clip splits it: the original keeps the head, the new id is the tail.
  const [created] = ripple.createdItemIds
  const [trimmed] = ripple.trimmedItemIds
  if (created && trimmed && ripple.createdItemIds.length === 1) {
    moveOutgoing(timeline, trimmed, created)
    result.split.push({ headId: trimmed, tailId: created })
  }
  result.createdItemIds.push(...ripple.createdItemIds)
  result.removedItemIds.push(...ripple.removedItemIds)
  dropBrokenTransitions(timeline, abuttedBefore, result)
  return result
}
