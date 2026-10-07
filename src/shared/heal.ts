/**
 * Healing a through-edit: two clips that are one take with a cut in it, made one clip again.
 *
 * A through-edit is what a split leaves when nothing was done with it — the second clip starts on
 * the timeline where the first ends, and in the source where the first leaves off, and the two
 * are otherwise the same clip. Joining them is `splitItemAt` run backwards (`./split`), and that
 * is the definition used here rather than a looser "looks continuous": a pair is joined only if
 * splitting the result at the same frame would give the pair back. Anything else — a trimmed
 * frame, a different level, a grade on one half — is a real cut, and is refused with which.
 *
 * Linked clips go together, as they do for a split: joining a picture joins its detached sound
 * when that is a through-edit too, and if the sound is a real cut the whole join is refused
 * (naming it) unless `linked: false` asks for the one clip alone.
 */

import { linkedPartners } from './links'
import { sliceKeyframes } from './keyframes'
import { itemEnd, sourceEdgeAt, type Asset, type Frames, type Item, type Timeline, type Track } from './project'

/**
 * How far apart, in source time, the two halves may be and still be one take. A split puts the
 * second half exactly where the first ends, to the microsecond; a pair made by two splits can be a
 * microsecond or two out through rounding. A real trim moves by at least a frame — 8 ms at 120 fps.
 */
export const CONTIGUOUS_TOLERANCE_US = 1000

/** Fields that differ between the halves of any split, and so say nothing about whether a cut is real. */
const POSITIONAL = new Set<keyof Item>([
  'id',
  'from',
  'durationInFrames',
  'sourceStartUs',
  'fadeInFrames',
  'fadeOutFrames',
  'keyframes',
  'linkId'
])

/** Asset kinds with no time of their own: any frame of one is every frame of it. */
const TIMELESS = new Set<Asset['kind']>(['image', 'text'])

export interface Joined {
  /** The clip that remains: the earlier one, now running to the later one's end. */
  itemId: string
  /** The clip that is gone. */
  removedId: string
  trackId: string
  from: Frames
  durationInFrames: Frames
}

export interface JoinRefusal {
  leftId: string
  rightId: string
  /** A whole sentence a person can read: what makes this a real cut. No ids, no tool names. */
  reason: string
  /** For an agent: the call that would make them joinable, when there is one. */
  hint?: string
}

/** A refusal as one message for an agent: the reason, then how to get past it. */
export const refusalText = (refusal: Pick<JoinRefusal, 'reason' | 'hint'>): string =>
  refusal.hint ? `${refusal.reason} ${refusal.hint}` : refusal.reason

/** Order-insensitive deep equality: a field set later sits later in the object, and is still the same field. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    // Absent and `undefined` are the same thing to JSON, and so to a saved project.
    if (!same(left[key], right[key])) return false
  }
  return true
}

/** The keyframes of the joined clip, or null when the two halves' keys are not one animation cut in two. */
function joinKeyframes(left: Item, right: Item): { keyframes: Item['keyframes'] } | null {
  if (!left.keyframes && !right.keyframes) return { keyframes: undefined }
  const total = left.durationInFrames + right.durationInFrames
  const merged: Record<string, { frame: number; value: number; ease?: unknown }[]> = {}
  const add = (property: string, key: { frame: number; value: number; ease?: unknown }): boolean => {
    const list = (merged[property] ??= [])
    const at = list.find((existing) => existing.frame === key.frame)
    if (at) return same(at, key)
    list.push({ ...key })
    return true
  }
  for (const [property, keys] of Object.entries(left.keyframes ?? {})) {
    for (const key of keys ?? []) if (!add(property, key)) return null
  }
  for (const [property, keys] of Object.entries(right.keyframes ?? {})) {
    for (const key of keys ?? []) if (!add(property, { ...key, frame: key.frame + left.durationInFrames })) return null
  }
  for (const list of Object.values(merged)) list.sort((a, b) => a.frame - b.frame)
  const keyframes = merged as Item['keyframes']
  // The test that makes this the inverse of a split: cut the merged keys where the clips meet
  // and each half must get back exactly the keys it had.
  if (!same(sliceKeyframes(keyframes, 0, left.durationInFrames), left.keyframes)) return null
  if (!same(sliceKeyframes(keyframes, left.durationInFrames, total), right.keyframes)) return null
  return { keyframes }
}

const frames = (count: number): string => `${count} frame${count === 1 ? '' : 's'}`

/**
 * Why `left` and `right` cannot be joined, or what joining them makes. Reads only.
 * `left` is the earlier clip; both are on `track`.
 */
function planPair(
  timeline: Timeline,
  assets: readonly Asset[],
  track: Track,
  left: Item,
  right: Item
): { merged: Item } | { reason: string; hint?: string } {
  if (track.locked) return { reason: `${track.name} is locked, and a locked track cannot be edited. Unlock it to join clips on it.` }
  const gap = right.from - itemEnd(left)
  if (gap > 0) return { reason: `There is a gap of ${frames(gap)} between them. Close the gap first — a join does not move clips.` }
  if (gap < 0) return { reason: `They overlap by ${frames(-gap)}, so there is no cut between them to remove.` }
  if (left.assetId !== right.assetId) return { reason: 'They are clips of different media, so there is a real cut between them.' }

  const differing = [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => !POSITIONAL.has(key as keyof Item))
    .filter((key) => !same((left as unknown as Record<string, unknown>)[key], (right as unknown as Record<string, unknown>)[key]))
  if (differing.length > 0) {
    return {
      reason: `They differ in ${differing.join(', ')}, so joined they would not look or sound as they do now.`,
      hint: `Make ${differing.length === 1 ? 'that' : 'those'} the same on ${left.id} and ${right.id} (inspect_item shows each, edit_item sets them) and join again.`
    }
  }

  const asset = assets.find((candidate) => candidate.id === left.assetId)
  if (!asset || !TIMELESS.has(asset.kind)) {
    // Where the first clip stops reading — through the one mapping (`sourceEdgeAt`), which is what
    // `splitItemAt` writes into the second half. So a reversed or ramped clip that was split heals
    // too: its halves meet going *down* the file, or part way through a curve. Direction and speed
    // are compared above like any other field; the ramp's keys are joined below like any others.
    const expected = sourceEdgeAt(left, left.durationInFrames, timeline.fps)
    // Measured the way the clips play: later is further on in what is seen, which for a reversed
    // pair is earlier in the file.
    const off = (right.sourceStartUs - expected) * (left.reverse ? -1 : 1)
    if (Math.abs(off) > CONTIGUOUS_TOLERANCE_US) {
      const seconds = (Math.abs(off) / 1_000_000).toFixed(2)
      return {
        reason:
          off > 0
            ? `The second clip starts ${seconds}s later in the source than the first one ends: footage was removed at this cut, so it is not a through-edit.`
            : `The second clip starts ${seconds}s earlier in the source than the first one ends: footage repeats at this cut, so it is not a through-edit.`
      }
    }
  }

  if (right.fadeInFrames > 0) {
    return {
      reason: `The second clip fades in over ${frames(right.fadeInFrames)} at the cut, and a joined clip has no cut to fade at. Remove that fade first.`,
      hint: `edit_item ${right.id} with fadeInFrames: 0.`
    }
  }
  // A split leaves both halves with the whole clip's fade-out, each cut to its own length. So a
  // fade-out on the first half that is that copy goes with the cut; any other was put there on
  // purpose. When the second half is shorter than the fade, its copy was cut down and the first
  // half's is the one that still holds the original length.
  const cutDown = right.fadeOutFrames === right.durationInFrames && left.fadeOutFrames >= right.fadeOutFrames
  const copied = cutDown || left.fadeOutFrames === Math.min(right.fadeOutFrames, left.durationInFrames)
  if (left.fadeOutFrames > 0 && !copied) {
    return {
      reason: `The first clip fades out over ${frames(left.fadeOutFrames)} at the cut, and a joined clip has no cut to fade at. Remove that fade first.`,
      hint: `edit_item ${left.id} with fadeOutFrames: 0.`
    }
  }

  const transition = (timeline.transitions ?? []).find((t) => t.fromItemId === left.id && t.toItemId === right.id)
  if (transition) {
    return {
      reason: `There is a ${transition.kind} transition on this cut, and a joined clip has no cut for it to sit on. Remove the transition first.`,
      hint: `remove_transition ${transition.id}.`
    }
  }

  const keys = joinKeyframes(left, right)
  if (!keys) return { reason: 'Their keyframes are not one animation cut in two, so joined they would not move as they do now. Clear the keyframes on one of them, or make them continuous across the cut.' }

  const merged: Item = {
    ...left,
    durationInFrames: left.durationInFrames + right.durationInFrames,
    fadeOutFrames: cutDown ? left.fadeOutFrames : right.fadeOutFrames
  }
  if (keys.keyframes) merged.keyframes = keys.keyframes
  else delete merged.keyframes
  return { merged }
}

function locate(timeline: Timeline, itemId: string): { track: Track; item: Item } | undefined {
  for (const track of timeline.tracks) {
    const item = track.items.find((candidate) => candidate.id === itemId)
    if (item) return { track, item }
  }
  return undefined
}

/** The clip on `track` that starts exactly where `item` ends, if there is one. */
export function nextOnTrack(track: Track, item: Item): Item | undefined {
  return track.items.find((candidate) => candidate.id !== item.id && candidate.from === itemEnd(item))
}

/**
 * Join the cut between two clips, and the same cut in the clips linked to them. Mutates
 * `timeline` only when every clip involved can be joined; a refusal changes nothing.
 */
export function joinPair(
  timeline: Timeline,
  assets: readonly Asset[],
  firstId: string,
  secondId: string,
  options: { linked?: boolean } = {}
): { joined: Joined[] } | JoinRefusal {
  const a = locate(timeline, firstId)
  const b = locate(timeline, secondId)
  const refuse = (reason: string): JoinRefusal => ({ leftId: firstId, rightId: secondId, reason })
  if (!a) return refuse(`No clip has the id "${firstId}".`)
  if (!b) return refuse(`No clip has the id "${secondId}".`)
  if (a.item.id === b.item.id) return refuse('That is one clip, named twice. Name the clip on each side of the cut.')
  if (a.track.id !== b.track.id) {
    return refuse(`They are on different tracks (${a.track.name} and ${b.track.name}). A through-edit is a cut within one track.`)
  }
  const [left, right] = a.item.from <= b.item.from ? [a.item, b.item] : [b.item, a.item]

  // Every pair to join: the one asked for, then the same cut in whatever is linked to both sides.
  const pairs: { track: Track; left: Item; right: Item }[] = [{ track: a.track, left, right }]
  if (options.linked !== false) {
    const rightPartners = linkedPartners(timeline, right.id)
    for (const partner of linkedPartners(timeline, left.id)) {
      const mate = rightPartners.find((other) => other.trackId === partner.trackId && other.from === itemEnd(partner))
      const track = timeline.tracks.find((candidate) => candidate.id === partner.trackId)
      if (mate && track) pairs.push({ track, left: partner, right: mate })
    }
  }

  const plans: { track: Track; left: Item; right: Item; merged: Item }[] = []
  for (const pair of pairs) {
    const plan = planPair(timeline, assets, pair.track, pair.left, pair.right)
    if ('reason' in plan) {
      if (pair === pairs[0]) return { leftId: left.id, rightId: right.id, reason: plan.reason, ...(plan.hint ? { hint: plan.hint } : {}) }
      return {
        leftId: left.id,
        rightId: right.id,
        reason: `The clips linked to them on ${pair.track.name} are a real cut, so the pair cannot be joined together: ${plan.reason}`,
        hint: `The linked clips are ${pair.left.id} and ${pair.right.id}.${plan.hint ? ` ${plan.hint}` : ''} Or pass linked: false to join only the clips named.`
      }
    }
    plans.push({ ...pair, merged: plan.merged })
  }

  const joined: Joined[] = []
  for (const plan of plans) {
    plan.track.items = plan.track.items
      .filter((item) => item.id !== plan.right.id)
      .map((item) => (item.id === plan.left.id ? plan.merged : item))
    // What left the second clip now leaves the joined one, as a split re-points it the other way.
    for (const transition of timeline.transitions ?? []) {
      if (transition.fromItemId === plan.right.id) transition.fromItemId = plan.left.id
    }
    joined.push({
      itemId: plan.left.id,
      removedId: plan.right.id,
      trackId: plan.track.id,
      from: plan.merged.from,
      durationInFrames: plan.merged.durationInFrames
    })
  }
  return { joined }
}

export interface JoinResult {
  joined: Joined[]
  /** Cuts between the named clips that are real cuts, each with why. */
  refused: JoinRefusal[]
}

/**
 * Join every through-edit among `ids`: each cut where two of the named clips meet on one track.
 * One id names the cut at that clip's end — it is joined to the clip that follows it. Mutates
 * `timeline`; cuts that cannot be joined are reported and left alone.
 */
export function joinItems(
  timeline: Timeline,
  assets: readonly Asset[],
  ids: readonly string[],
  options: { linked?: boolean } = {}
): JoinResult {
  const result: JoinResult = { joined: [], refused: [] }
  const named = new Set(ids)
  const tried = new Set<string>()

  const nextCut = (): [string, string] | null => {
    for (const track of timeline.tracks) {
      for (const item of [...track.items].sort((x, y) => x.from - y.from)) {
        if (!named.has(item.id)) continue
        const next = nextOnTrack(track, item)
        // A lone id reaches for its neighbour; several ids join only among themselves.
        if (!next || (named.size > 1 && !named.has(next.id))) continue
        if (!tried.has(`${item.id}\n${next.id}`)) return [item.id, next.id]
      }
    }
    return null
  }

  for (let cut = nextCut(); cut; cut = nextCut()) {
    tried.add(`${cut[0]}\n${cut[1]}`)
    const outcome = joinPair(timeline, assets, cut[0], cut[1], options)
    if ('joined' in outcome) result.joined.push(...outcome.joined)
    else result.refused.push(outcome)
  }
  return result
}

/** Why nothing among `ids` could even be tried, in words — for a caller with no cut to report on. */
export function noCutReason(timeline: Timeline, ids: readonly string[]): string {
  if (ids.length === 0) return 'Select the clips on each side of a cut, or the clip before it, or park the playhead on the cut — then join.'
  const found = ids.map((id) => locate(timeline, id))
  const missing = ids.filter((_, index) => !found[index])
  if (missing.length > 0) return `No clip has the id ${missing.map((id) => `"${id}"`).join(', ')}.`
  if (ids.length === 1) {
    const only = found[0]!
    return `No clip starts where that clip ends on ${only.track.name} (frame ${itemEnd(only.item)}), so there is no cut there to remove.`
  }
  const tracks = new Set(found.map((entry) => entry!.track.id))
  if (tracks.size === ids.length) return 'Those clips are all on different tracks. A through-edit is a cut between two clips on one track.'
  return 'None of those clips meet: a through-edit is where one clip ends on the exact frame the next begins, on the same track.'
}
