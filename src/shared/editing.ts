/**
 * The small editing verbs a person reaches for from the keyboard: close a gap, nudge clips by a
 * frame, jump to the next cut or marker, trim a clip to the playhead. The planning half of each,
 * pure over a timeline, so the store applies a plan it did not have to invent and a test can ask
 * the same question without a window.
 *
 * Every planner refuses with a sentence that names the clip or track in the way and says what to
 * do about it. The store turns a refusal into a toast; nothing here moves anything.
 */

import { withLinked } from './links'
import { findAsset, findTrack, itemEnd, itemsOverlap, type Frames, type Item, type Project, type Timeline, type Track } from './project'

export interface Move {
  itemId: string
  from: Frames
}

export type MovePlan = { ok: true; moves: Move[] } | { ok: false; error: string }

/** A clip as a person names it: the asset's name, or its id when the asset is gone. */
export function clipName(project: Project, item: Item): string {
  return findAsset(project, item.assetId)?.name ?? item.id
}

function everyItem(timeline: Timeline): { item: Item; track: Track }[] {
  return timeline.tracks.flatMap((track) => track.items.map((item) => ({ item, track })))
}

/**
 * Plans moving `moves` together: every clip lands where asked or none does. A clip that would
 * start before frame 0, sits on a locked track, or would land on a clip that is not itself moving
 * refuses the whole plan, naming it.
 */
export function checkMoves(project: Project, timeline: Timeline, moves: readonly Move[]): MovePlan {
  const moving = new Map(moves.map((move) => [move.itemId, move.from]))
  const found = everyItem(timeline)
  for (const move of moves) {
    const entry = found.find(({ item }) => item.id === move.itemId)
    if (!entry) return { ok: false, error: `Clip ${move.itemId} is not on this timeline.` }
    const { item, track } = entry
    const name = clipName(project, item)
    if (track.locked) {
      return { ok: false, error: `${track.name} is locked, so ${name} cannot move. Unlock ${track.name} first.` }
    }
    if (move.from < 0) {
      return {
        ok: false,
        error: `${name} starts at frame ${item.from}, so it cannot move ${item.from - move.from} frames earlier.`
      }
    }
    const landed = { ...item, from: move.from }
    for (const other of track.items) {
      if (other.id === item.id || moving.has(other.id)) continue
      if (itemsOverlap(other, landed)) {
        return {
          ok: false,
          error:
            `${name} would run into ${clipName(project, other)} on ${track.name}. ` +
            `Move or trim ${clipName(project, other)} first, or move by fewer frames.`
        }
      }
    }
  }
  return { ok: true, moves: [...moves] }
}

/**
 * Nudging clips by `delta` frames, as one move. `linked` adds each clip's linked partners, so a
 * picture and its detached sound nudge together — the same rule a drag follows.
 */
export function planNudge(
  project: Project,
  timeline: Timeline,
  itemIds: readonly string[],
  delta: Frames,
  linked = true
): MovePlan {
  if (itemIds.length === 0) return { ok: false, error: 'Select the clips to nudge first.' }
  if (delta === 0) return { ok: true, moves: [] }
  const ids = linked ? withLinked(timeline, itemIds) : [...itemIds]
  const items = everyItem(timeline).filter(({ item }) => ids.includes(item.id))
  return checkMoves(
    project,
    timeline,
    items.map(({ item }) => ({ itemId: item.id, from: item.from + delta }))
  )
}

/** The empty stretch of one track that `frame` sits in, between two clips (or from 0). */
export interface Gap {
  trackId: string
  from: Frames
  /** Exclusive: the first frame of the clip after the gap. */
  to: Frames
}

export type GapLookup = { ok: true; gap: Gap } | { ok: false; error: string }

/**
 * The gap on `track` containing `frame`. A gap needs a clip after it — the empty runway past the
 * last clip is not a gap anything can close.
 */
export function gapAt(project: Project, track: Track, frame: Frames): GapLookup {
  const at = Math.round(frame)
  const under = track.items.find((item) => at >= item.from && at < itemEnd(item))
  if (under) {
    return {
      ok: false,
      error: `The playhead is on ${clipName(project, under)} on ${track.name}, not in a gap. Put it in the empty space between two clips.`
    }
  }
  const next = track.items.filter((item) => item.from > at).sort((a, b) => a.from - b.from)[0]
  if (!next) {
    return { ok: false, error: `Nothing on ${track.name} comes after frame ${at}, so there is no gap to close.` }
  }
  const from = Math.max(0, ...track.items.filter((item) => itemEnd(item) <= at).map(itemEnd))
  return { ok: true, gap: { trackId: track.id, from, to: next.from } }
}

export type CloseGapPlan = { ok: true; gap: Gap; moves: Move[] } | { ok: false; error: string }

/**
 * Closing the gap at `frame` on one track: every clip on that track after the gap moves left by
 * its length, and so does each of their linked clips on other tracks, so a picture keeps its
 * sound. Nothing else on other tracks moves — closing one lane's gap is a one-lane edit, and
 * `remove_range` is the operation that keeps every track in step.
 */
export function planCloseGap(project: Project, timeline: Timeline, trackId: string, frame: Frames): CloseGapPlan {
  const track = findTrack(timeline, trackId)
  if (!track) return { ok: false, error: `Track ${trackId} is not on this timeline.` }
  if (track.locked) return { ok: false, error: `${track.name} is locked. Unlock it to close its gap.` }
  const lookup = gapAt(project, track, frame)
  if (!lookup.ok) return lookup
  const { gap } = lookup
  const shifted = planPullBack(project, timeline, trackId, gap.to, gap.to - gap.from)
  if (!shifted.ok) return { ok: false, error: `Cannot close the gap: ${shifted.error}` }
  return { ok: true, gap, moves: shifted.moves }
}

/**
 * Every clip on one track starting at or after `fromFrame` moved `frames` earlier, with their
 * linked clips on other tracks: the ripple half of closing a gap or a ripple trim.
 */
export function planPullBack(
  project: Project,
  timeline: Timeline,
  trackId: string,
  fromFrame: Frames,
  frames: Frames
): MovePlan {
  const track = findTrack(timeline, trackId)
  if (!track) return { ok: false, error: `Track ${trackId} is not on this timeline.` }
  if (frames <= 0) return { ok: true, moves: [] }
  const after = track.items.filter((item) => item.from >= fromFrame).map((item) => item.id)
  const ids = withLinked(timeline, after)
  const moves = everyItem(timeline)
    .filter(({ item }) => ids.includes(item.id))
    .map(({ item }) => ({ itemId: item.id, from: item.from - frames }))
  return checkMoves(project, timeline, moves)
}

/** Sets `from` on each moved clip and re-sorts the tracks. Mutates `timeline`. */
export function applyMoves(timeline: Timeline, moves: readonly Move[]): void {
  const next = new Map(moves.map((move) => [move.itemId, move.from]))
  for (const track of timeline.tracks) {
    let touched = false
    for (const item of track.items) {
      const from = next.get(item.id)
      if (from === undefined) continue
      item.from = from
      touched = true
    }
    if (touched) track.items.sort((a, b) => a.from - b.from)
  }
}

/** Every frame a clip starts or ends on, on any track, ascending and unique. */
export function editPoints(timeline: Timeline): Frames[] {
  const points = new Set<Frames>([0])
  for (const track of timeline.tracks) {
    for (const item of track.items) {
      points.add(item.from)
      points.add(itemEnd(item))
    }
  }
  return [...points].sort((a, b) => a - b)
}

/** The nearest of `points` strictly after (`1`) or before (`-1`) `frame`, or null. */
export function adjacentPoint(points: readonly Frames[], frame: Frames, direction: 1 | -1): Frames | null {
  let best: Frames | null = null
  for (const point of points) {
    if (direction === 1 ? point <= frame : point >= frame) continue
    if (best === null || (direction === 1 ? point < best : point > best)) best = point
  }
  return best
}

/** Marker frames, ascending. */
export function markerPoints(timeline: Timeline): Frames[] {
  return [...new Set((timeline.markers ?? []).map((marker) => marker.frame))].sort((a, b) => a - b)
}

/**
 * The clips "trim to playhead" acts on: the selected clips the playhead crosses, or — with
 * nothing selected — every clip it crosses on an unlocked track. One per link group: trimming a
 * clip trims its linked partners, so a partner listed as well would be trimmed twice.
 */
export function clipsUnderPlayhead(timeline: Timeline, selection: readonly string[], frame: Frames): Item[] {
  const at = Math.round(frame)
  const out: Item[] = []
  const covered = new Set<string>()
  for (const { item, track } of everyItem(timeline)) {
    if (track.locked) continue
    if (selection.length > 0 && !selection.includes(item.id)) continue
    if (!(at > item.from && at < itemEnd(item))) continue
    if (covered.has(item.id)) continue
    out.push(item)
    for (const id of withLinked(timeline, [item.id])) covered.add(id)
  }
  return out
}

/**
 * What Loop Playback repeats: In to Out, either end defaulting to the timeline's, or null when
 * there is nothing to play. Out is exclusive, as everywhere a range is kept here.
 */
export function loopSpan(rangeIn: Frames | null, rangeOut: Frames | null, duration: Frames): { from: Frames; to: Frames } | null {
  const to = Math.min(rangeOut ?? duration, duration)
  const from = Math.max(0, Math.min(rangeIn ?? 0, to))
  if (to - from >= 1) return { from, to }
  return duration >= 1 ? { from: 0, to: duration } : null
}
