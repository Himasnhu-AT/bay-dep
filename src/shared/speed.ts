/**
 * Changing a clip's speed, the way every editor does it: the clip keeps the *footage* it plays,
 * so its length on the timeline changes — twice as fast, half as long.
 *
 * It used to keep the length instead. A 5-second clip at 2× then read 10 seconds of a 5-second
 * file and froze on the last frame for half its length, with nothing on the timeline to say so;
 * at 0.5× it silently dropped the second half of what the clip had shown. Both the clip menu's
 * Speed…, the inspector's Speed field and `edit_item({ speed })` plan through here, so the person
 * and the agent get the same length, the same clamp and the same ripple.
 *
 * Lengthening can run into the next clip. Then either the later clips on the clip's track (and on
 * its linked clips' tracks) move by the change — `ripple` — or the clip stops at the next clip and
 * the plan says by how much it fell short. It never overlaps anything and never runs past the end
 * of its footage. Keyframes are item-relative and stay where they are (CLAUDE.md: speed leaves
 * them); fades are kept inside the new length.
 */

import { linkedPartners } from './links'
import {
  effectiveSpeed,
  findAsset,
  findItem,
  itemEnd,
  usToFrames,
  type Frames,
  type Item,
  type Project,
  type Timeline
} from './project'

/**
 * The speeds a person can type into the Inspector and the clip menu's Speed… — one range for both,
 * where the two had 8× and 16× ceilings.
 *
 * The model itself takes any speed above 0 (`edit_item` refuses only ≤ 0) and export's `atempo`
 * chain handles any of them. What does not is the preview: a media element honours `playbackRate`
 * only within 1/16…16 and plays silence outside it (`playbackRateFor` in `engine/sync.ts`, which
 * clamps to this ceiling). So 16× is the fastest speed whose sound the preview and the export
 * agree on, and it is the ceiling. The floor stays 0.1×: the element's own 0.0625 reads as
 * "0.06×" at two decimals, and nothing asked for slower.
 */
export const CLIP_SPEED_RANGE = { min: 0.1, max: 16 } as const

export interface SpeedPlan {
  itemId: string
  speed: number
  /** The clip's length before. */
  fromLength: Frames
  /** The length that plays the same footage at the new speed (before any clamp). */
  wanted: Frames
  /** The length the clip gets. */
  length: Frames
  /** Why `length` is short of `wanted`, if it is. */
  clampedBy: null | { kind: 'footage'; available: Frames } | { kind: 'next-clip'; itemId: string; trackId: string; at: Frames }
  /** Items that move so the change fits (ripple only): each by `length - fromLength`. */
  shifts: { itemId: string; to: Frames }[]
  /** Tracks whose later clips moved. */
  rippledTrackIds: string[]
  /** Tracks with clips after the change that did not move, so are now out of step. */
  outOfSyncTrackIds: string[]
}

/**
 * The length that plays the same stretch of source at `speed`, and the most the footage allows
 * from the clip's in-point. A source with no duration (a still, a title) has no stretch to keep,
 * so its length does not change.
 */
export function retimedLength(
  item: Pick<Item, 'durationInFrames' | 'speed' | 'sourceStartUs'>,
  sourceDurationUs: number,
  speed: number,
  fps: number
): { wanted: Frames; available: Frames } {
  if (!(sourceDurationUs > 0)) return { wanted: item.durationInFrames, available: Number.POSITIVE_INFINITY }
  const next = effectiveSpeed(speed)
  const wanted = Math.max(1, Math.round((item.durationInFrames * effectiveSpeed(item.speed)) / next))
  const available = Math.max(
    1,
    Math.floor(usToFrames(Math.max(0, sourceDurationUs - item.sourceStartUs), fps) / next)
  )
  return { wanted, available }
}

/**
 * The speed change for `itemId`, planned against the timeline as it is. Null when there is no
 * such item. The caller applies it with `applySpeedPlan` inside one edit.
 */
export function planSpeed(
  project: Project,
  timeline: Timeline,
  itemId: string,
  speed: number,
  options: { ripple?: boolean } = {}
): SpeedPlan | null {
  const found = findItem(timeline, itemId)
  if (!found) return null
  const { item } = found
  const asset = findAsset(project, item.assetId)
  const { wanted, available } = retimedLength(item, asset?.durationUs ?? 0, speed, timeline.fps)
  const plan: SpeedPlan = {
    itemId,
    speed: effectiveSpeed(speed),
    fromLength: item.durationInFrames,
    wanted,
    length: Math.min(wanted, available),
    clampedBy: wanted > available ? { kind: 'footage', available } : null,
    shifts: [],
    rippledTrackIds: [],
    outOfSyncTrackIds: []
  }

  // The clip and its linked clips change length by the same amount (`patchItem` carries it).
  const partners = linkedPartners(timeline, itemId).filter((p) => !timeline.tracks.find((t) => t.id === p.trackId)?.locked)
  const members = [item, ...partners]
  const memberIds = new Set(members.map((m) => m.id))
  const delta = (): number => plan.length - plan.fromLength
  // Later clips per member: those starting at or after its end, on its track.
  const later = (member: Item): Item[] =>
    (timeline.tracks.find((t) => t.id === member.trackId)?.items ?? []).filter(
      (other) => !memberIds.has(other.id) && other.from >= itemEnd(member)
    )

  if (delta() === 0) return plan

  if (options.ripple) {
    const tracks = new Set<string>()
    const moved = new Set<string>()
    for (const member of members) {
      const track = timeline.tracks.find((t) => t.id === member.trackId)
      if (!track || track.locked) continue
      for (const other of later(member)) {
        if (moved.has(other.id)) continue
        moved.add(other.id)
        plan.shifts.push({ itemId: other.id, to: Math.max(0, other.from + delta()) })
        tracks.add(track.id)
      }
    }
    plan.shifts.sort((a, b) => (delta() > 0 ? b.to - a.to : a.to - b.to))
    plan.rippledTrackIds = [...tracks]
    if (plan.shifts.length > 0) {
      const memberTracks = new Set(members.map((m) => m.trackId))
      const cut = itemEnd(item)
      plan.outOfSyncTrackIds = timeline.tracks
        .filter((t) => !memberTracks.has(t.id) && t.items.some((other) => itemEnd(other) > cut))
        .map((t) => t.id)
    }
    return plan
  }

  // No ripple: a longer clip stops at the first clip in its way, on its track or a linked one's.
  if (delta() > 0) {
    for (const member of members) {
      const next = later(member).sort((a, b) => a.from - b.from)[0]
      if (!next) continue
      const room = next.from - member.from - member.durationInFrames // frames free after the member
      if (room < delta()) {
        plan.length = Math.max(1, plan.fromLength + room)
        plan.clampedBy = { kind: 'next-clip', itemId: next.id, trackId: next.trackId, at: next.from }
      }
    }
  }
  return plan
}

/**
 * Applies a plan to a timeline the caller has cloned (inside `edit()`): the clip's speed and
 * length, its linked clips' speed and the same change of length, fades kept inside, and the
 * ripple's moves.
 */
export function applySpeedPlan(timeline: Timeline, plan: SpeedPlan): void {
  const found = findItem(timeline, plan.itemId)
  if (!found || found.track.locked) return
  const delta = plan.length - plan.fromLength
  const partners = linkedPartners(timeline, plan.itemId).filter(
    (p) => !timeline.tracks.find((t) => t.id === p.trackId)?.locked
  )
  for (const member of [found.item, ...partners]) {
    member.speed = plan.speed
    member.durationInFrames = Math.max(1, member.durationInFrames + delta)
    if (member.fadeInFrames + member.fadeOutFrames > member.durationInFrames) {
      member.fadeOutFrames = Math.max(0, Math.min(member.fadeOutFrames, member.durationInFrames - member.fadeInFrames))
      member.fadeInFrames = Math.min(member.fadeInFrames, member.durationInFrames)
    }
  }
  for (const shift of plan.shifts) {
    const moved = findItem(timeline, shift.itemId)
    if (moved) moved.item.from = shift.to
  }
  for (const track of timeline.tracks) track.items.sort((a, b) => a.from - b.from)
}

/** What a speed change did, for a person: only said when it did something other than the obvious. */
export function speedNote(
  project: Project,
  timeline: Timeline,
  plan: SpeedPlan,
  formatFrame: (frame: Frames) => string
): string | null {
  const nameOf = (id: string): string => {
    const item = findItem(timeline, id)?.item
    return `"${(item && findAsset(project, item.assetId)?.name) || 'the next clip'}"`
  }
  const trackName = (id: string): string => timeline.tracks.find((t) => t.id === id)?.name ?? id
  const clamp = plan.clampedBy
  if (clamp?.kind === 'footage') {
    return `The footage runs out after ${plan.length} frames at ${plan.speed}×, so the clip is ${plan.length} frames, not ${plan.wanted}.`
  }
  if (clamp?.kind === 'next-clip') {
    return (
      `${nameOf(clamp.itemId)} starts at ${formatFrame(clamp.at)} on ${trackName(clamp.trackId)}, so the clip stops ` +
      `there: ${plan.length} frames instead of ${plan.wanted}, and it plays less of its footage. ` +
      `To make room, use Speed… in the clip’s right-click menu with "Push later clips" on.`
    )
  }
  if (plan.outOfSyncTrackIds.length > 0) {
    const names = plan.outOfSyncTrackIds.map(trackName).join(', ')
    return `Later clips on ${plan.rippledTrackIds.map(trackName).join(', ')} moved; ${names} did not and ${plan.outOfSyncTrackIds.length === 1 ? 'is' : 'are'} now out of step after the clip.`
  }
  return null
}

/**
 * How far a clip's edges can be dragged before they run out of footage: the earliest start
 * (source time 0 at this speed) and the latest end (`retimedLength`'s `available` from the
 * in-point). Infinite for a source with no duration — a still or a title. The trim preview uses
 * it so the edge it draws is the edge the store will keep; unclamped, a drag drew the clip past
 * its footage and then snapped back on release without a word.
 */
export function trimBounds(
  item: Pick<Item, 'from' | 'durationInFrames' | 'speed' | 'sourceStartUs'>,
  sourceDurationUs: number,
  fps: number
): { earliestFrom: Frames; latestEnd: Frames } {
  if (!(sourceDurationUs > 0)) return { earliestFrom: 0, latestEnd: Number.POSITIVE_INFINITY }
  const speed = effectiveSpeed(item.speed)
  const before = Math.floor(usToFrames(Math.max(0, item.sourceStartUs), fps) / speed)
  const { available } = retimedLength(item, sourceDurationUs, item.speed, fps)
  return { earliestFrom: Math.max(0, item.from - before), latestEnd: item.from + available }
}
