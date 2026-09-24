/**
 * Dragging several clips to other tracks at once: the grabbed clip's lane change, applied to
 * every selected clip of its kind as a whole number of lanes.
 *
 * The rule is the one every NLE follows for a vertical group drag: count lanes, not pixels. Drag
 * the grabbed clip from V1 to V2 and every selected video clip goes up one video lane; clips of
 * the other kind (a picture's linked sound, typically) stay on their own tracks and shift in time
 * only, because a picture dragged up must not drag its sound into a different lane of audio.
 *
 * All or nothing: if any clip would leave the stack, land on a locked track or on a clip that is
 * not itself moving, the plan refuses with a sentence naming it, and the drag keeps the clips on
 * their own tracks — the refusal is shown while dragging, so the reason is seen before letting go.
 */

import { clipName } from './editing'
import { findTrack, itemsOverlap, type Frames, type Item, type Project, type Timeline, type Track } from './project'

export interface TrackMove {
  itemId: string
  from: Frames
  trackId: string
}

export type TrackMovePlan = { ok: true; moves: TrackMove[]; lanes: number } | { ok: false; error: string }

export interface TrackShiftRequest {
  /** Every clip moving, grabbed one included. Linked partners are the caller's to add. */
  itemIds: readonly string[]
  /** The clip under the pointer: its lane change is the one applied to the rest. */
  anchorId: string
  /** The lane the pointer is over. */
  targetTrackId: string
  deltaFrames: Frames
  /** Every track id top to bottom as the timeline draws them (`displayOrder`). */
  order: readonly string[]
}

function locate(timeline: Timeline, itemId: string): { item: Item; track: Track } | undefined {
  for (const track of timeline.tracks) {
    const item = track.items.find((candidate) => candidate.id === itemId)
    if (item) return { item, track }
  }
  return undefined
}

export function planTrackShift(project: Project, timeline: Timeline, request: TrackShiftRequest): TrackMovePlan {
  const anchor = locate(timeline, request.anchorId)
  if (!anchor) return { ok: false, error: `Clip ${request.anchorId} is not on this timeline.` }
  const target = findTrack(timeline, request.targetTrackId)
  if (!target) return { ok: false, error: `Track ${request.targetTrackId} is not on this timeline.` }
  const kind = anchor.track.kind
  if (target.kind !== kind) {
    return {
      ok: false,
      error: `${target.name} is an ${target.kind} track, and ${clipName(project, anchor.item)} is on a ${kind} track. Drag onto a ${kind} track.`
    }
  }
  // Lanes of the grabbed clip's kind, top to bottom.
  const lanes = request.order.filter((id) => findTrack(timeline, id)?.kind === kind)
  const offset = lanes.indexOf(target.id) - lanes.indexOf(anchor.track.id)

  const moves: TrackMove[] = []
  for (const id of request.itemIds) {
    const found = locate(timeline, id)
    if (!found) return { ok: false, error: `Clip ${id} is not on this timeline.` }
    const { item, track } = found
    let trackId = track.id
    if (track.kind === kind && offset !== 0) {
      const index = lanes.indexOf(track.id) + offset
      const destination = lanes[index]
      if (destination === undefined) {
        return {
          ok: false,
          error:
            `${clipName(project, item)} is on ${track.name}, and there is no ${kind} track ${Math.abs(offset)} ` +
            `${offset < 0 ? 'above' : 'below'} it. Add a ${kind} track, or drag fewer tracks.`
        }
      }
      trackId = destination
    }
    moves.push({ itemId: id, from: item.from + request.deltaFrames, trackId })
  }

  const checked = checkTrackMoves(project, timeline, moves)
  return checked.ok ? { ok: true, moves: checked.moves, lanes: offset } : checked
}

/**
 * Every clip lands where asked or none does: not before frame 0, not off or onto a locked track,
 * and not onto a clip that is not itself moving.
 */
export function checkTrackMoves(
  project: Project,
  timeline: Timeline,
  moves: readonly TrackMove[]
): { ok: true; moves: TrackMove[] } | { ok: false; error: string } {
  const moving = new Set(moves.map((move) => move.itemId))
  for (const move of moves) {
    const found = locate(timeline, move.itemId)
    if (!found) return { ok: false, error: `Clip ${move.itemId} is not on this timeline.` }
    const { item, track } = found
    const name = clipName(project, item)
    const destination = findTrack(timeline, move.trackId)
    if (!destination) return { ok: false, error: `Track ${move.trackId} is not on this timeline.` }
    if (track.locked) return { ok: false, error: `${track.name} is locked, so ${name} cannot move. Unlock ${track.name} first.` }
    if (destination.locked) {
      return { ok: false, error: `${destination.name} is locked, so ${name} cannot move onto it. Unlock ${destination.name} first.` }
    }
    if (destination.kind !== track.kind) {
      return { ok: false, error: `${name} is ${track.kind} and ${destination.name} is an ${destination.kind} track.` }
    }
    if (move.from < 0) {
      return { ok: false, error: `${name} starts at frame ${item.from}, so it cannot move ${item.from - move.from} frames earlier.` }
    }
    const landed = { ...item, from: move.from }
    for (const other of destination.items) {
      if (moving.has(other.id)) continue
      if (itemsOverlap(other, landed)) {
        return {
          ok: false,
          error: `${name} would land on ${clipName(project, other)} on ${destination.name}. Drag to free time, or move ${clipName(project, other)} first.`
        }
      }
    }
  }
  return { ok: true, moves: [...moves] }
}

/** Applies checked moves: each clip to its track and frame, tracks re-sorted. Mutates `timeline`. */
export function applyTrackMoves(timeline: Timeline, moves: readonly TrackMove[]): void {
  // Lifting a clip whose destination does not exist would drop it from the timeline; refuse the
  // whole set instead, since a partial group move is a state nobody dragged to.
  if (moves.some((move) => !findTrack(timeline, move.trackId))) return
  const byId = new Map(moves.map((move) => [move.itemId, move]))
  const lifted: Item[] = []
  for (const track of timeline.tracks) {
    track.items = track.items.filter((item) => {
      if (!byId.has(item.id)) return true
      lifted.push(item)
      return false
    })
  }
  for (const item of lifted) {
    const move = byId.get(item.id)!
    const destination = findTrack(timeline, move.trackId)!
    item.from = move.from
    item.trackId = destination.id
    destination.items.push(item)
  }
  for (const track of timeline.tracks) track.items.sort((a, b) => a.from - b.from)
}
