/**
 * Slip, slide and roll: the three trims that change *what plays* without changing how long the
 * track is.
 *
 * `trimItem` in the store moves one edge of one clip and leaves a gap or eats into the
 * neighbour's space. These three are the editor's other vocabulary, and each keeps something
 * fixed that an ordinary trim does not:
 *
 * - **slip** keeps the clip exactly where it is on the timeline and changes which part of the
 *   source it reads. Nothing else moves.
 * - **slide** moves the clip along its track and lets its neighbours absorb the move — the one
 *   before it gets longer or shorter at its out-point, the one after at its in-point — so the
 *   clip's own content is untouched and the track's total length is unchanged. A side with
 *   a gap instead of a neighbour lets the gap absorb it, up to the gap's size; a side with no
 *   neighbour at all needs the other side to have one (otherwise it is just a move). The one
 *   case where length changes is the last clip on a track sliding right: nothing follows it
 *   to absorb the move, so the track ends later by the same amount.
 * - **roll** moves one cut between two abutting clips: the outgoing clip's out-point and the
 *   incoming clip's in-point move together, so the program length is unchanged.
 *
 * All three spend **handles** — source footage beyond a clip's visible range — and all three
 * refuse rather than clamp when the handles run out, naming the range that *would* work. A
 * clamp would reach an agent as "slid by 40" when it slid by 12, which is the playhead that
 * clamps without saying so, again.
 *
 * **Plan, then apply.** `planTrim` computes every change without touching the timeline, so the
 * UI can draw a live preview of a drag from the same arithmetic the store will commit, and a
 * refusal is guaranteed to leave nothing behind. `applyTrimPlan` writes a plan onto a timeline.
 *
 * **Transitions.** Every one of these operations preserves every abutment it started with: slip
 * moves no edge, slide moves both of the clip's edges together with its neighbours' matching
 * edges, and roll moves a cut that both clips still share. So a transition never ends up naming
 * a pair that no longer meets, and none is removed. What *can* change is how much handle each
 * side of a junction has, which changes how long `resolveTransition` will let a transition be.
 * The plan reports every transition touching a changed clip, as `resolveTransition` sees it
 * after the edit, so a caller can say "the dissolve at this cut is now 8 frames" rather than
 * leaving the viewer to discover it.
 *
 * Signs: a positive `deltaFrames` slips to **later** source material, slides the clip **right**
 * (later), and rolls the cut **later**.
 */

import {
  findAsset,
  findItem,
  framesToUs,
  itemEnd,
  resolveTransition,
  US_PER_SECOND,
  type Asset,
  type Frames,
  type Item,
  type Micros,
  type Project,
  type Timeline,
  type Track
} from './project'

export type TrimMode = 'slip' | 'slide' | 'roll'

export interface TrimSpec {
  itemId: string
  mode: TrimMode
  deltaFrames: Frames
  /**
   * Roll only: which of the item's cuts to roll. `'end'` (the default) is the cut with the
   * clip that starts where this one ends; `'start'` the cut with the clip that ends where this
   * one starts.
   */
  edge?: 'start' | 'end'
}

/** One item's timing after the edit. Every field is the value to store, not a delta. */
export interface TrimChange {
  itemId: string
  from: Frames
  durationInFrames: Frames
  sourceStartUs: Micros
  fadeInFrames: Frames
  fadeOutFrames: Frames
}

export interface TrimTransitionReport {
  transitionId: string
  fromItemId: string
  toItemId: string
  /** Null when the junction no longer has the two frames of handle a transition needs. */
  effectiveDurationInFrames: Frames | null
  requestedDurationInFrames: Frames
  clampedBecause: string | null
}

export type TrimPlan = {
  ok: true
  mode: TrimMode
  deltaFrames: Frames
  /** The legal range for this trim, inclusive, before it was applied. */
  range: { min: Frames; max: Frames }
  changes: TrimChange[]
}

export type TrimRefusal = {
  ok: false
  error: string
  /** Present when the refusal is about the size of the move: the range that would be accepted. */
  range?: { min: Frames; max: Frames }
}

// ---------------------------------------------------------------------------
// Source room
// ---------------------------------------------------------------------------

/**
 * Tolerance, in frames, for reading a whole number of frames back out of microseconds.
 *
 * `framesToUs` rounds to the nearest microsecond, so ten frames at 30fps is stored as 333,333µs
 * — which divides back to 9.99999 frames. A plain `floor` would call that nine and refuse a
 * slip back to the very start the clip came from. A thousandth of a frame is far larger than
 * any rounding the conversions can produce and far smaller than anything a person could mean.
 */
const FRAME_EPSILON = 1e-3

/**
 * Whole timeline frames of source before a clip's in-point and after its out-point.
 *
 * Not `handlesFor`, deliberately, although it answers the same question. `handlesFor` rounds
 * to the nearest frame, which is right for sizing a transition — the draw path clamps — and
 * wrong here, where a half-frame handle rounded up to one lets a slip write a *negative*
 * `sourceStartUs`. This floors, so it never promises footage that is not there.
 *
 * A still has no source duration and can be held for any length: its room is unbounded, which
 * is what lets a still absorb any slide or roll.
 */
export function sourceRoom(
  asset: Asset | undefined,
  item: Item,
  fps: number
): { before: Frames; after: Frames } {
  if (!asset || asset.durationUs <= 0) {
    return { before: Number.POSITIVE_INFINITY, after: Number.POSITIVE_INFINITY }
  }
  const speed = item.speed > 0 ? item.speed : 1
  const usPerFrame = (US_PER_SECOND / fps) * speed
  const consumedUs = framesToUs(item.durationInFrames, fps) * speed
  const beforeUs = Math.max(0, item.sourceStartUs)
  const afterUs = Math.max(0, asset.durationUs - (item.sourceStartUs + consumedUs))
  return {
    before: Math.floor(beforeUs / usPerFrame + FRAME_EPSILON),
    after: Math.floor(afterUs / usPerFrame + FRAME_EPSILON)
  }
}

/** How far `frames` of timeline reaches into a source at this item's speed. Same as ripple's. */
function sourceAdvanceUs(frames: Frames, fps: number, speed: number): Micros {
  return Math.round(framesToUs(frames, fps) * speed)
}

/**
 * A read point moved by `frames`, kept so the clip's whole window stays inside the source.
 *
 * The clamp absorbs only the disagreement between `sourceRoom`'s epsilon and `framesToUs`'s
 * rounding — at most a microsecond or two; the range check has already refused anything real,
 * so this is not a silent clamp of a request. It is live, not defensive: a read point one
 * microsecond short of a frame boundary (333,332µs at 30fps) passes the epsilon as ten whole
 * frames of room, and slipping back ten lands on -1µs without it. The upper bound is the
 * start that makes the *end* of the window meet the end of the source, for `durationInFrames`
 * — the clip's length after the edit — because capping the start alone at the source's end
 * would still let the window read past it.
 */
function movedSourceStart(
  item: Item,
  asset: Asset | undefined,
  frames: Frames,
  fps: number,
  durationInFrames: Frames
): Micros {
  const next = item.sourceStartUs + sourceAdvanceUs(frames, fps, item.speed)
  if (!asset || asset.durationUs <= 0) return Math.max(0, next)
  const latest = asset.durationUs - sourceAdvanceUs(durationInFrames, fps, item.speed)
  return Math.max(0, Math.min(next, latest))
}

// ---------------------------------------------------------------------------
// Neighbours
// ---------------------------------------------------------------------------

function sortedItems(track: Track): Item[] {
  return [...track.items].sort((a, b) => a.from - b.from)
}

/** The item ending exactly where `item` starts, if any. */
function abuttingBefore(track: Track, item: Item): Item | undefined {
  return track.items.find((other) => other.id !== item.id && itemEnd(other) === item.from)
}

/** The item starting exactly where `item` ends, if any. */
function abuttingAfter(track: Track, item: Item): Item | undefined {
  return track.items.find((other) => other.id !== item.id && other.from === itemEnd(item))
}

/** Free frames between `item` and whatever precedes it — back to frame 0 if nothing does. */
function gapBefore(track: Track, item: Item): Frames {
  let edge = 0
  for (const other of sortedItems(track)) {
    if (other.id === item.id) continue
    const end = itemEnd(other)
    if (end <= item.from && end > edge) edge = end
  }
  return item.from - edge
}

/** Free frames between `item` and whatever follows it, or null if nothing follows. */
function gapAfter(track: Track, item: Item): Frames | null {
  const end = itemEnd(item)
  let next: number | null = null
  for (const other of track.items) {
    if (other.id === item.id) continue
    if (other.from >= end && (next === null || other.from < next)) next = other.from
  }
  return next === null ? null : next - end
}

function change(item: Item): TrimChange {
  return {
    itemId: item.id,
    from: item.from,
    durationInFrames: item.durationInFrames,
    sourceStartUs: item.sourceStartUs,
    fadeInFrames: item.fadeInFrames,
    fadeOutFrames: item.fadeOutFrames
  }
}

/** Fades are clamped to the new length, the way every other trim here does it. */
function clampFades(next: TrimChange): TrimChange {
  next.fadeInFrames = Math.min(next.fadeInFrames, next.durationInFrames)
  next.fadeOutFrames = Math.min(next.fadeOutFrames, next.durationInFrames)
  return next
}

/** `+12` / `-3` / `0` — how a signed range reads in a sentence. */
function signed(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? 'unlimited' : '-unlimited'
  return n > 0 ? `+${n}` : String(n)
}

function outOfRange(
  what: string,
  delta: Frames,
  range: { min: Frames; max: Frames },
  why: { min: string; max: string }
): TrimRefusal {
  const text = (n: number): string =>
    n === 0 ? 'not at all' : Number.isFinite(n) ? `${n} frames at most` : 'without limit'
  const minText = text(Math.abs(range.min))
  const maxText = text(range.max)
  return {
    ok: false,
    range,
    error:
      `${what} by ${signed(delta)} frames is out of range: the legal deltaFrames here is ` +
      `${signed(range.min)} to ${signed(range.max)}. ` +
      `Negative: ${minText}, because ${why.min}. Positive: ${maxText}, because ${why.max}.`
  }
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/**
 * Work out what a slip, slide or roll would do, without doing it.
 *
 * Refuses a locked track, an unknown item, a zero delta (and says what range *would* work, so
 * a zero delta doubles as the question "how far can this go?"), and any delta past the handles.
 */
export function planTrim(project: Project, timeline: Timeline, spec: TrimSpec): TrimPlan | TrimRefusal {
  const found = findItem(timeline, spec.itemId)
  if (!found) return { ok: false, error: `No item ${spec.itemId} on this timeline.` }
  const { item, track } = found
  if (track.locked) {
    return {
      ok: false,
      error: `Track ${track.name} is locked, so ${spec.mode} is refused. Unlock it first.`
    }
  }
  const delta = Math.round(spec.deltaFrames)
  if (!Number.isFinite(delta)) {
    return { ok: false, error: `deltaFrames must be a whole number of frames; got ${spec.deltaFrames}.` }
  }
  if (spec.edge !== undefined && spec.mode !== 'roll') {
    return {
      ok: false,
      error:
        `edge only applies to roll, which has to know which of the clip's two cuts to move. ` +
        `A ${spec.mode} moves ${spec.mode === 'slip' ? 'no cut' : 'both of the clip\'s edges'}; ` +
        `omit edge.`
    }
  }

  switch (spec.mode) {
    case 'slip':
      return planSlip(project, timeline, item, delta)
    case 'slide':
      return planSlide(project, timeline, track, item, delta)
    case 'roll':
      return planRoll(project, timeline, track, item, delta, spec.edge ?? 'end')
  }
}

function zeroDelta(mode: TrimMode, range: { min: Frames; max: Frames }): TrimRefusal {
  return {
    ok: false,
    range,
    error:
      `deltaFrames is 0, which changes nothing. This ${mode} can go from ` +
      `${signed(range.min)} to ${signed(range.max)} frames.`
  }
}

function planSlip(
  project: Project,
  timeline: Timeline,
  item: Item,
  delta: Frames
): TrimPlan | TrimRefusal {
  const asset = findAsset(project, item.assetId)
  if (!asset || asset.durationUs <= 0) {
    // A still reads the same picture wherever its read point is, so a slip would be stored,
    // change nothing on screen, and report success: the control that does not do what it says.
    return {
      ok: false,
      error:
        `Item ${item.id} draws ${asset ? `a ${asset.kind}` : 'a missing asset'} with no source ` +
        `duration, so there is no window to slip — every read point shows the same picture. ` +
        `To change what it shows, edit the asset or place a different one.`
    }
  }
  const room = sourceRoom(asset, item, timeline.fps)
  const range = { min: -room.before, max: room.after }
  if (delta === 0) return zeroDelta('slip', range)
  if (delta < range.min || delta > range.max) {
    return outOfRange(`Slipping ${item.id}`, delta, range, {
      min: `only ${room.before} frames of ${asset.name} come before its in-point`,
      max: `only ${room.after} frames of ${asset.name} come after its out-point`
    })
  }
  const next = change(item)
  next.sourceStartUs = movedSourceStart(item, asset, delta, timeline.fps, item.durationInFrames)
  return { ok: true, mode: 'slip', deltaFrames: delta, range, changes: [next] }
}

function planSlide(
  project: Project,
  timeline: Timeline,
  track: Track,
  item: Item,
  delta: Frames
): TrimPlan | TrimRefusal {
  const left = abuttingBefore(track, item)
  const right = abuttingAfter(track, item)
  if (!left && !right) {
    // With nothing on either side to absorb the move, a slide is just a move — and a move has
    // its own tool with its own collision rules. Accepting it here would teach a caller that
    // slide and move are interchangeable, which is exactly false the moment a neighbour exists.
    return {
      ok: false,
      error:
        `Item ${item.id} does not touch a clip on either side, so there is nothing for a slide ` +
        `to trim — that is an ordinary move. Use edit_item with a new "from" instead.`
    }
  }
  const fps = timeline.fps

  // Negative (left): the left side gives up frames, the right side gains them.
  let minLimit: number
  let minWhy: string
  if (left) {
    minLimit = left.durationInFrames - 1
    minWhy = `${left.id} before it is ${left.durationInFrames} frames long and must keep at least 1`
  } else {
    minLimit = gapBefore(track, item)
    minWhy = `there are only ${minLimit} free frames before it`
  }
  if (right) {
    const rightRoom = sourceRoom(findAsset(project, right.assetId), right, fps).before
    if (rightRoom < minLimit) {
      minLimit = rightRoom
      minWhy = `${right.id} after it has only ${rightRoom} frames of source before its in-point`
    }
  }

  // Positive (right): the left side gains, the right side gives up.
  let maxLimit: number
  let maxWhy: string
  if (right) {
    maxLimit = right.durationInFrames - 1
    maxWhy = `${right.id} after it is ${right.durationInFrames} frames long and must keep at least 1`
  } else {
    const gap = gapAfter(track, item)
    maxLimit = gap ?? Number.POSITIVE_INFINITY
    maxWhy =
      gap === null ? 'nothing follows it' : `there are only ${gap} free frames after it`
  }
  if (left) {
    const leftRoom = sourceRoom(findAsset(project, left.assetId), left, fps).after
    if (leftRoom < maxLimit) {
      maxLimit = leftRoom
      maxWhy = `${left.id} before it has only ${leftRoom} frames of source after its out-point`
    }
  }

  const range = { min: -Math.max(0, minLimit), max: Math.max(0, maxLimit) }
  if (delta === 0) return zeroDelta('slide', range)
  if (delta < range.min || delta > range.max) {
    return outOfRange(`Sliding ${item.id}`, delta, range, { min: minWhy, max: maxWhy })
  }

  const changes: TrimChange[] = []
  const moved = change(item)
  moved.from = item.from + delta
  changes.push(moved)
  if (left) {
    const next = change(left)
    next.durationInFrames = left.durationInFrames + delta
    changes.push(clampFades(next))
  }
  if (right) {
    const next = change(right)
    next.from = right.from + delta
    next.durationInFrames = right.durationInFrames - delta
    next.sourceStartUs = movedSourceStart(
      right,
      findAsset(project, right.assetId),
      delta,
      fps,
      next.durationInFrames
    )
    changes.push(clampFades(next))
  }
  return { ok: true, mode: 'slide', deltaFrames: delta, range, changes }
}

function planRoll(
  project: Project,
  timeline: Timeline,
  track: Track,
  item: Item,
  delta: Frames,
  edge: 'start' | 'end'
): TrimPlan | TrimRefusal {
  const outgoing = edge === 'end' ? item : abuttingBefore(track, item)
  const incoming = edge === 'end' ? abuttingAfter(track, item) : item
  if (!outgoing || !incoming) {
    const gap = edge === 'end' ? gapAfter(track, item) : gapBefore(track, item)
    return {
      ok: false,
      error:
        `There is no cut at the ${edge} of ${item.id}: no clip ${edge === 'end' ? 'starts where it ends' : 'ends where it starts'}` +
        (gap === null ? ' — nothing follows it on the track.' : `, there are ${gap} free frames there.`) +
        ` A roll moves a cut shared by two abutting clips; to move one edge alone, use edit_item.`
    }
  }
  const fps = timeline.fps
  const outRoom = sourceRoom(findAsset(project, outgoing.assetId), outgoing, fps).after
  const inRoom = sourceRoom(findAsset(project, incoming.assetId), incoming, fps).before

  let minLimit = outgoing.durationInFrames - 1
  let minWhy = `${outgoing.id} before the cut is ${outgoing.durationInFrames} frames long and must keep at least 1`
  if (inRoom < minLimit) {
    minLimit = inRoom
    minWhy = `${incoming.id} after the cut has only ${inRoom} frames of source before its in-point`
  }
  let maxLimit = incoming.durationInFrames - 1
  let maxWhy = `${incoming.id} after the cut is ${incoming.durationInFrames} frames long and must keep at least 1`
  if (outRoom < maxLimit) {
    maxLimit = outRoom
    maxWhy = `${outgoing.id} before the cut has only ${outRoom} frames of source after its out-point`
  }

  const range = { min: -Math.max(0, minLimit), max: Math.max(0, maxLimit) }
  if (delta === 0) return zeroDelta('roll', range)
  if (delta < range.min || delta > range.max) {
    return outOfRange(`Rolling the cut at frame ${incoming.from}`, delta, range, {
      min: minWhy,
      max: maxWhy
    })
  }

  const out = change(outgoing)
  out.durationInFrames = outgoing.durationInFrames + delta
  const inc = change(incoming)
  inc.from = incoming.from + delta
  inc.durationInFrames = incoming.durationInFrames - delta
  inc.sourceStartUs = movedSourceStart(
    incoming,
    findAsset(project, incoming.assetId),
    delta,
    fps,
    inc.durationInFrames
  )
  return {
    ok: true,
    mode: 'roll',
    deltaFrames: delta,
    range,
    changes: [clampFades(out), clampFades(inc)]
  }
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/** Writes a plan onto `timeline`, mutating it. Keeps each track's items in time order. */
export function applyTrimPlan(timeline: Timeline, plan: TrimPlan): void {
  const touched = new Set<Track>()
  for (const next of plan.changes) {
    const found = findItem(timeline, next.itemId)
    if (!found) continue
    Object.assign(found.item, {
      from: next.from,
      durationInFrames: next.durationInFrames,
      sourceStartUs: next.sourceStartUs,
      fadeInFrames: next.fadeInFrames,
      fadeOutFrames: next.fadeOutFrames
    })
    touched.add(found.track)
  }
  for (const track of touched) track.items.sort((a, b) => a.from - b.from)
}

/**
 * Every transition touching an item the plan changed, as `resolveTransition` sees it now.
 *
 * Call after `applyTrimPlan`. The stored duration is what was asked for; this is what the new
 * handles allow — the authority, per the model's own rule.
 */
export function transitionsAfterTrim(
  project: Project,
  timeline: Timeline,
  plan: TrimPlan
): TrimTransitionReport[] {
  const changed = new Set(plan.changes.map((c) => c.itemId))
  const reports: TrimTransitionReport[] = []
  for (const transition of timeline.transitions ?? []) {
    if (!changed.has(transition.fromItemId) && !changed.has(transition.toItemId)) continue
    const resolved = resolveTransition(project, timeline, transition)
    reports.push({
      transitionId: transition.id,
      fromItemId: transition.fromItemId,
      toItemId: transition.toItemId,
      requestedDurationInFrames: transition.durationInFrames,
      effectiveDurationInFrames: resolved ? resolved.durationInFrames : null,
      clampedBecause: resolved
        ? resolved.clampedBecause
        : 'the junction has less than one frame of handle on a side, so nothing will draw'
    })
  }
  return reports
}
