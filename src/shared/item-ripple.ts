/**
 * Deleting clips with a ripple on *their own tracks only*: `delete_items({ ripple: true })` and
 * the clip menu's "Ripple Delete (This Track Only)" both plan through here, so the agent and the
 * menu close the same gaps and report the same tracks left behind.
 *
 * This is the per-track ripple. It closes exactly the gaps the deletion made, on each track it
 * removed from, and moves nothing anywhere else — so any other track with clips after the cut
 * is now out of step with the tracks that closed up. `remove_range` (⇧Delete) is the sync-safe
 * operation; this one exists because sometimes one lane is all you want to close, and it says
 * which lanes it left behind rather than letting that be found by ear.
 */

import { itemEnd, type Frames, type Timeline } from './project'

export interface ItemRippleShift {
  itemId: string
  /** Where the survivor starts after the ripple. */
  to: Frames
}

export interface ItemRipplePlan {
  /** Survivors that move, earliest destination first (the order that keeps every move legal). */
  shifts: ItemRippleShift[]
  /** Tracks whose clips closed up. */
  rippledTrackIds: string[]
  /**
   * Tracks that did not close up but have a clip that plays after the earliest deleted frame on
   * a track that did: those are now out of sync with it. Empty when nothing shifted.
   */
  outOfSyncTrackIds: string[]
}

/**
 * The ripple for deleting `ids` (already including anything linked to them). Computed before the
 * delete, because afterwards the items are gone and the shift cannot be derived. Each survivor
 * moves back by the total length of everything removed from its track that ended at or before
 * it, which closes exactly the gaps this deletion made and no gap that was already there.
 */
export function planItemRipple(timeline: Timeline, ids: readonly string[]): ItemRipplePlan {
  const doomed = new Set(ids)
  const shifts: ItemRippleShift[] = []
  const rippled: string[] = []
  let earliestCut = Number.POSITIVE_INFINITY
  for (const track of timeline.tracks) {
    const removed = track.items.filter((item) => doomed.has(item.id))
    if (removed.length === 0) continue
    let moved = false
    for (const survivor of track.items) {
      if (doomed.has(survivor.id)) continue
      const behind = removed.filter((r) => itemEnd(r) <= survivor.from)
      const shift = behind.reduce((total, r) => total + r.durationInFrames, 0)
      if (shift <= 0) continue
      shifts.push({ itemId: survivor.id, to: survivor.from - shift })
      moved = true
      earliestCut = Math.min(earliestCut, ...behind.map((r) => r.from))
    }
    if (moved) rippled.push(track.id)
  }
  shifts.sort((a, b) => a.to - b.to)

  const rippledSet = new Set(rippled)
  const touched = new Set(timeline.tracks.filter((t) => t.items.some((i) => doomed.has(i.id))).map((t) => t.id))
  const outOfSync =
    shifts.length === 0
      ? []
      : timeline.tracks
          .filter((track) => !rippledSet.has(track.id) && !touched.has(track.id))
          .filter((track) => track.items.some((item) => itemEnd(item) > earliestCut))
          .map((track) => track.id)
  return { shifts, rippledTrackIds: rippled, outOfSyncTrackIds: outOfSync }
}

/** The sentence a per-track ripple reports: which tracks closed up, and which were left behind. */
export function itemRippleNote(rippledTracks: readonly string[], outOfSyncTracks: readonly string[]): string {
  const moved = `Ripple moved items on ${rippledTracks.join(', ')} only.`
  if (outOfSyncTracks.length === 0) return `${moved} Nothing on another track plays after the cut, so nothing is out of sync.`
  const one = outOfSyncTracks.length === 1
  return (
    `${moved} ${outOfSyncTracks.join(', ')} did not move and ${one ? 'is' : 'are'} now out of sync ` +
    `after the cut unless you move ${one ? 'it' : 'them'} too.`
  )
}
