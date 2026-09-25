/**
 * Ripple trim: the Trim tool's ripple mode. One edge of a clip moves, and the clips after it on
 * its track (with their linked clips) move by the same amount, so no gap opens and nothing is
 * overwritten. Resolve's head ripple keeps the clip's start where it is: trimming frames off the
 * head pulls the rest of the clip, and everything after it, earlier.
 *
 * Like `delete_items({ ripple: true })`, it keeps one track (and what is linked to it) in step,
 * not every track: other tracks do not move. That is the difference from `remove_range`.
 *
 * The plan is pure — which clips move where, and the one store trim — so it is checked without a
 * window. `applyRippleTrim` runs it through the store's own `trimItem` and `moveItemsToTracks`,
 * as one undo step.
 */

import { effectiveSpeed, findItem, itemEnd, usToFrames, type Frames, type Item, type Timeline } from '@shared/project'
import { linkedPartners, withLinked } from '@shared/links'
import type { TrackMove } from '@shared/track-move'
import { selectTimeline, useEditor } from '@/store/editor'
import { refusableEdit } from './refusable'

export type RippleTrimPlan =
  | {
      ok: true
      /** Moves made first, to make room (the clip grows). */
      before: TrackMove[]
      /** The store trim: this edge of this clip to this frame. */
      trim: { itemId: string; edge: 'start' | 'end'; toFrame: Frames }
      /** Moves made after the trim, to close up behind it (the clip shrinks). */
      after: TrackMove[]
    }
  | { ok: false; error: string }

/**
 * How many frames a head ripple can add: the footage before the clip's in-point. Unlike
 * `trimBounds`, not limited by frame 0 — a head ripple keeps the clip's start where it is.
 */
export function rippleHeadRoom(item: Pick<Item, 'sourceStartUs' | 'speed'>, fps: number, hasFootage: boolean): number {
  if (!hasFootage) return Number.POSITIVE_INFINITY
  return Math.floor(usToFrames(Math.max(0, item.sourceStartUs), fps) / effectiveSpeed(item.speed))
}

/**
 * Plans rippling `edge` of `itemId` to `toFrame` — the frame the edge would reach by an ordinary
 * trim (the drag's own arithmetic). `linked` is linked selection: the clip's linked partners
 * trim with it and move with it.
 */
export function planRippleTrim(
  timeline: Timeline,
  itemId: string,
  edge: 'start' | 'end',
  toFrame: Frames,
  linked: boolean
): RippleTrimPlan {
  const found = findItem(timeline, itemId)
  if (!found) return { ok: false, error: 'That clip is no longer on the timeline.' }
  const { item, track } = found
  if (track.locked) return { ok: false, error: `${track.name} is locked. Unlock it in the track header to trim it.` }
  const group = new Set([item.id, ...(linked ? linkedPartners(timeline, item.id).map((partner) => partner.id) : [])])
  const at = (id: string): Item | undefined => findItem(timeline, id)?.item
  const trackOf = (id: string): string | undefined => findItem(timeline, id)?.track.id

  // What follows the clip on its own track, and what is linked to those.
  const startOfFollowers = itemEnd(item)
  const followers = withLinked(
    timeline,
    track.items.filter((other) => other.id !== item.id && other.from >= startOfFollowers).map((other) => other.id)
  ).filter((id) => !group.has(id))
  const shift = (ids: Iterable<string>, by: Frames, base?: (candidate: Item) => Frames): TrackMove[] => {
    const moves: TrackMove[] = []
    for (const id of ids) {
      const candidate = at(id)
      const trackId = trackOf(id)
      if (!candidate || !trackId) continue
      moves.push({ itemId: id, trackId, from: (base ? base(candidate) : candidate.from) + by })
    }
    return moves
  }

  if (edge === 'end') {
    const delta = Math.round(toFrame) - itemEnd(item)
    if (delta === 0) return { ok: true, before: [], trim: { itemId, edge, toFrame: itemEnd(item) }, after: [] }
    if (Math.round(toFrame) <= item.from) return { ok: false, error: 'A clip must keep at least one frame.' }
    const moves = shift(followers, delta)
    return delta > 0
      ? { ok: true, before: moves, trim: { itemId, edge, toFrame: Math.round(toFrame) }, after: [] }
      : { ok: true, before: [], trim: { itemId, edge, toFrame: Math.round(toFrame) }, after: moves }
  }

  // The head: frames come off (or go on) at the start, and the clip's start stays put.
  const delta = Math.round(toFrame) - item.from
  if (delta === 0) return { ok: true, before: [], trim: { itemId, edge, toFrame: item.from }, after: [] }
  if (Math.round(toFrame) >= itemEnd(item)) return { ok: false, error: 'A clip must keep at least one frame.' }
  if (delta > 0) {
    // Trim, then pull the clip back to where it started and everything after it by as much. The
    // store trim moves a linked partner's head by the same frames, so it goes back by as much too.
    return {
      ok: true,
      before: [],
      trim: { itemId, edge, toFrame: Math.round(toFrame) },
      after: [...shift(group, 0), ...shift(followers, -delta)]
    }
  }
  // Growing the head: push the clip (and what follows) later by the frames it gains, then trim
  // its start back to where it began.
  const grow = -delta
  return {
    ok: true,
    before: [...shift(group, grow), ...shift(followers, grow)],
    trim: { itemId, edge, toFrame: item.from },
    after: []
  }
}

/** Runs a ripple trim as one undo step. Returns the reason it could not, or null when it did. */
export function applyRippleTrim(itemId: string, edge: 'start' | 'end', toFrame: Frames): string | null {
  const store = useEditor.getState()
  const timeline = selectTimeline(store)
  if (!timeline) return 'No timeline is open.'
  const plan = planRippleTrim(timeline, itemId, edge, toFrame, store.linkedSelection)
  if (!plan.ok) return plan.error
  if (plan.before.length === 0 && plan.after.length === 0) {
    const before = findItem(timeline, itemId)?.item
    if (before && (edge === 'end' ? itemEnd(before) : before.from) === plan.trim.toFrame) return null
  }
  // A refusal found partway — room made, then the trim refused — leaves the project as it was,
  // the same object, so no undo step and no unsaved mark (`refusableEdit`).
  let warning: string | null = null
  const refused = refusableEdit(() => {
    if (plan.before.length > 0) {
      const moved = useEditor.getState().moveItemsToTracks(plan.before)
      if ('error' in moved) return `Could not make room: ${moved.error}`
    }
    const was = findItem(selectTimeline(useEditor.getState())!, itemId)?.item
    useEditor.getState().trimItem(itemId, edge, plan.trim.toFrame, { linked: store.linkedSelection })
    const now = findItem(selectTimeline(useEditor.getState())!, itemId)?.item
    const trimmed = was && now && (now.from !== was.from || now.durationInFrames !== was.durationInFrames)
    if (!trimmed) {
      return 'The trim was refused: it would run past the footage, or into a linked clip’s neighbour on another track.'
    }
    // A grow the store stopped short (the footage ran out) moved what follows by the whole ask;
    // pull it back by the shortfall, or a gap opens that nothing reports. The head ripple ends
    // with the clip's start back where it began, so its shortfall is how far past it the start is.
    if (plan.before.length > 0 && now) {
      const shortfall = edge === 'end' ? plan.trim.toFrame - itemEnd(now) : now.from - plan.trim.toFrame
      if (shortfall > 0) {
        const back = plan.before.map((move) => ({ ...move, from: move.from - shortfall }))
        const moved = useEditor.getState().moveItemsToTracks(back)
        if ('error' in moved) warning = `Trimmed as far as the footage goes, but a gap was left open: ${moved.error}`
      }
    }
    if (plan.after.length > 0) {
      const moved = useEditor.getState().moveItemsToTracks(plan.after)
      if ('error' in moved) warning = `Trimmed, but the gap was left open: ${moved.error}`
    }
    return null
  })
  return refused ?? warning
}
