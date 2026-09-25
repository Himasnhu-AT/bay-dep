/**
 * What a cut between two touching clips can do with a transition.
 *
 * A transition belongs to the junction rather than to either clip, so the junction has to
 * exist as a thing the interface can point at, count, and explain. This module is that
 * thing — and it is deliberately the **only** answer to "can this cut take a transition, and
 * if not why not", because the MCP handler and the timeline both have to answer it and two
 * copies of that reasoning would drift into telling an agent one story and a user another.
 *
 * Nothing here is presentation. It is derived from `handlesFor` and `resolveTransition` in
 * `@shared/project`, which own the arithmetic; this adds the *question a caller actually
 * asks*, which is about a cut rather than about a stored record.
 */

import {
  findAsset,
  findItem,
  handlesFor,
  itemEnd,
  resolveTransition,
  type Frames,
  type Item,
  type Project,
  type ResolvedTransition,
  type Timeline,
  type Track,
  type Transition
} from '@shared/project'
import { transitionLengthFrames } from '@/store/editing-prefs'

/** How much source each side of a cut has to spend, and the longest transition that allows. */
export interface JunctionRoom {
  /** Frames the outgoing clip can keep playing past its own end. */
  fromRoom: Frames
  /** Frames the incoming clip can start early by. */
  toRoom: Frames
  /**
   * The longest transition this cut can actually play, in frames. Zero means none at all.
   *
   * Always even: a transition is centred on the cut and spends the same number of frames
   * either side, so an odd total would have to round somewhere and `resolveTransition`
   * rounds down. Reporting an odd capacity would promise a frame that cannot be used.
   */
  capacityInFrames: Frames
}

export interface Junction extends JunctionRoom {
  /** Stable across renders as long as the two clips are the same pair. */
  key: string
  trackId: string
  from: Item
  to: Item
  /** The frame the two clips meet on. */
  cutFrame: Frames
  /** The transition stored on this cut, if one is. */
  transition: Transition | undefined
  /** What that transition will actually draw, or null when it will draw nothing. */
  resolved: ResolvedTransition | null
}

/**
 * Frames of handle either side of a cut, each already capped by its own clip's length.
 *
 * The cap matters and is easy to miss: a clip with two minutes of unused source still cannot
 * lend more frames than it occupies on the timeline, or the transition would begin before the
 * clip it is leaving. `handlesFor` reports the source available; this reports the source
 * *spendable*.
 */
export function roomAt(project: Project, timeline: Timeline, from: Item, to: Item): JunctionRoom {
  const fromRoom = Math.min(
    handlesFor(findAsset(project, from.assetId), from, timeline.fps).after,
    from.durationInFrames
  )
  const toRoom = Math.min(
    handlesFor(findAsset(project, to.assetId), to, timeline.fps).before,
    to.durationInFrames
  )
  return { fromRoom, toRoom, capacityInFrames: Math.min(fromRoom, toRoom) * 2 }
}

/**
 * Why this cut cannot take a transition at all, or null when it can.
 *
 * The sentence has to name which side is short, because "no handles" sends someone to trim
 * the wrong clip half the time. It also has to say what a handle *is* — most people meeting
 * this refusal have never had to think about the frames past a clip's out-point, and a
 * refusal that assumes the vocabulary it is explaining teaches nobody anything.
 */
export function whyNoRoom(room: JunctionRoom): string | null {
  if (room.capacityInFrames >= 2) return null
  const bothEmpty = room.fromRoom < 1 && room.toRoom < 1
  const side = bothEmpty
    ? 'Neither clip has footage to spare across this cut'
    : room.fromRoom < 1
      ? 'The outgoing clip has no footage past its end'
      : 'The incoming clip has no footage before its start'
  return (
    `${side}, so there is nothing to blend between. A transition does not shorten the ` +
    `timeline — it keeps the outgoing clip playing a little past the cut and starts the ` +
    `incoming one a little early, which needs source either side. Trim one of them shorter ` +
    `than its source and the cut will take one.`
  )
}

/**
 * Why a *stored* transition will draw nothing.
 *
 * `resolveTransition` returns null for three different reasons and a null cannot be told
 * apart from a null. An earlier version of this reported all three as "the clips are no
 * longer adjacent", which was wrong in the most common case: two clips that abut perfectly
 * but each use their whole source have nowhere to dissolve from, and being told they are not
 * adjacent sends someone to move clips that are already touching.
 */
export function whyInactive(
  project: Project,
  timeline: Timeline,
  transition: Transition
): string {
  const from = findItem(timeline, transition.fromItemId)?.item
  const to = findItem(timeline, transition.toItemId)?.item
  if (!from || !to) {
    return 'One of the two clips no longer exists. Remove the transition, or re-add it between clips that do.'
  }
  if (itemEnd(from) !== to.from) {
    return (
      `The clips are no longer adjacent — ${transition.fromItemId} ends at ${itemEnd(from)} and ` +
      `${transition.toItemId} starts at ${to.from}. Close the gap and it will draw again.`
    )
  }
  return whyNoRoom(roomAt(project, timeline, from, to)) ?? 'The clips abut and have room; this should be drawing.'
}

/**
 * Every cut on one track, in timeline order.
 *
 * Only *touching* pairs are junctions. A gap is not a cut — there is no single frame where
 * one clip becomes the other — so it gets no marker rather than a marker that refuses. The
 * items are sorted here rather than trusted to arrive sorted: this reads the track to decide
 * what is adjacent, and adjacency computed from an unsorted list is silently wrong.
 */
export function junctionsForTrack(project: Project, timeline: Timeline, track: Track): Junction[] {
  const items = [...track.items].sort((a, b) => a.from - b.from)
  const transitions = timeline.transitions ?? []
  const junctions: Junction[] = []
  for (let i = 0; i < items.length - 1; i++) {
    const from = items[i]
    const to = items[i + 1]
    if (!from || !to) continue
    if (itemEnd(from) !== to.from) continue
    const transition = transitions.find((t) => t.fromItemId === from.id && t.toItemId === to.id)
    junctions.push({
      key: `${from.id}:${to.id}`,
      trackId: track.id,
      from,
      to,
      cutFrame: to.from,
      transition,
      resolved: transition ? resolveTransition(project, timeline, transition) : null,
      ...roomAt(project, timeline, from, to)
    })
  }
  return junctions
}

/**
 * The length a transition gets when nobody chose one: Preferences › Editing's transition length (a
 * second unless changed), or the most the cut can take when that is less. `add_transition` with
 * no `durationInFrames`, ⌘T and the transition dialog all use it, so an agent and a person
 * adding "a transition" to the same cut get the same one.
 */
export function defaultTransitionFrames(room: JunctionRoom, fps: number): Frames {
  return Math.min(transitionLengthFrames(fps), Math.max(2, room.capacityInFrames))
}

/**
 * The cut nearest `frame` on a video track, preferring cuts on `preferTrackIds` (the selection's
 * tracks) when there are any. Ties go to the earlier cut. Null when the timeline has no cut.
 */
export function nearestJunction(
  project: Project,
  timeline: Timeline,
  frame: Frames,
  preferTrackIds: readonly string[] = []
): Junction | null {
  const all = timeline.tracks
    .filter((track) => track.kind === 'video')
    .flatMap((track) => junctionsForTrack(project, timeline, track))
  const preferred = all.filter((junction) => preferTrackIds.includes(junction.trackId))
  const pool = preferred.length > 0 ? preferred : all
  let best: Junction | null = null
  for (const junction of pool) {
    if (!best || Math.abs(junction.cutFrame - frame) < Math.abs(best.cutFrame - frame)) best = junction
  }
  return best
}
