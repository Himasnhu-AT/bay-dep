/**
 * Freeze Frame (⌥F): hold the frame under the playhead as a still, inserted into the timeline.
 *
 * **Insert, not overwrite — as Final Cut's Add Freeze Frame.** The clip is split at the playhead
 * and the still goes between the halves, so the moment keeps playing after the hold instead of
 * being covered by it. That lengthens the programme, so **every unlocked track opens at the same
 * frame by the same amount**: clips after it move right, a clip that straddles it is split and
 * its tail moves with them. A picture's linked sound on another track is split and moved with
 * it, so nothing drifts out of sync; the hold itself is silent. This is `remove_range`'s
 * construction run the other way (`@shared/ripple`), for the same reason — an insert on one
 * track only would desynchronise every other track by the freeze's length.
 *
 * A locked track cannot open, so a locked track with anything at or after the playhead refuses
 * the whole edit and names the track. `remove_range` reports that drift instead of refusing,
 * because it has no other way to cut a take; a freeze can simply ask for the track to be
 * unlocked, and a drift would be a fault the person has to find later.
 *
 * The frame grabbed is the one the compositor draws at the playhead — `sourceSecondsAt`, which
 * honours the in-point, slip and speed — and the still takes the clip's look at that frame: its
 * framing (keyframes sampled there), crop, adjustments, grade and blend.
 */

import type { Asset, Frames, Item, Project, Timeline, Track } from './project'
import { findAsset, framesToUs, itemEnd } from './project'
import { animatedItemAt, sliceKeyframes } from './keyframes'

/** The clip a freeze acts on, and why there is none when there is not. */
export type FreezeTarget = { ok: true; item: Item; track: Track } | { ok: false; error: string }

function canFreeze(project: Project, item: Item): boolean {
  const asset = findAsset(project, item.assetId)
  return !!asset && asset.kind === 'video' && asset.hasVideo && !asset.error && !!asset.path
}

/**
 * The video clip under `frame` to freeze: a selected one if any is selected there, else the
 * topmost (the last video track drawn — tracks paint in order). A clip is under the frame from
 * its first frame to its last, so a freeze at a clip's first frame holds that frame before it.
 */
export function freezeTarget(
  project: Project,
  timeline: Timeline,
  selection: readonly string[],
  frame: Frames
): FreezeTarget {
  const at = Math.round(frame)
  const under: { item: Item; track: Track }[] = []
  for (const track of timeline.tracks) {
    if (track.kind !== 'video') continue
    for (const item of track.items) {
      if (at >= item.from && at < itemEnd(item)) under.push({ item, track })
    }
  }
  const chosen = under.filter(({ item }) => selection.includes(item.id))
  const pool = chosen.length > 0 ? chosen : under
  const found = [...pool].reverse().find(({ item }) => canFreeze(project, item))
  if (found) return { ok: true, ...found }
  if (pool.length > 0) {
    return { ok: false, error: 'The clip under the playhead is not video. Freeze Frame holds a frame of a video clip; a still or a title already holds.' }
  }
  return { ok: false, error: 'There is no video clip under the playhead to freeze. Move the playhead onto one.' }
}

/**
 * Whether a freeze of `item` at `frame` can go in, as the sentence to show when it cannot: the
 * clip's track and every track with anything at or after the playhead must be unlocked.
 */
export function freezeRefusal(timeline: Timeline, item: Item, frame: Frames): string | null {
  const at = Math.round(frame)
  if (at < item.from || at >= itemEnd(item)) return 'The playhead is not over that clip any more.'
  const blocked = timeline.tracks.filter((track) => track.locked && track.items.some((i) => itemEnd(i) > at))
  if (blocked.some((track) => track.items.some((i) => i.id === item.id))) {
    const own = blocked.find((track) => track.items.some((i) => i.id === item.id))!
    return `${own.name} is locked. Unlock it to add a freeze frame.`
  }
  if (blocked.length > 0) {
    return (
      `A freeze frame moves everything after the playhead on every track, and ${blocked.map((t) => t.name).join(', ')} ` +
      `${blocked.length === 1 ? 'is' : 'are'} locked with clips there, which would fall out of sync. Unlock ` +
      `${blocked.length === 1 ? 'it' : 'them'} first.`
    )
  }
  return null
}

export interface FreezeResult {
  freezeItemId: string
  /** Clips the insert cut in two: the head keeps its id, the tail is new. */
  split: { headId: string; tailId: string }[]
  /** Transitions whose two clips no longer meet — the one on the cut the freeze now sits in. */
  removedTransitionIds: string[]
}

/**
 * The still's item: `item`'s framing at `frame` (keys sampled there), with its crop, look and
 * blend. Silent and at speed 1; a still has no source time.
 */
export function freezeItem(item: Item, frame: Frames, still: Asset, frames: Frames, id: string): Item {
  const shown = animatedItemAt(item, frame)
  const freeze: Item = {
    id,
    assetId: still.id,
    trackId: item.trackId,
    from: Math.round(frame),
    durationInFrames: Math.max(1, Math.round(frames)),
    sourceStartUs: 0,
    layout: { ...shown.layout },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  }
  if (item.crop) freeze.crop = { ...item.crop }
  if (item.adjustments) freeze.adjustments = { ...item.adjustments }
  if (item.grade) freeze.grade = JSON.parse(JSON.stringify(item.grade)) as NonNullable<Item['grade']>
  if (item.blendMode) freeze.blendMode = item.blendMode
  return freeze
}

/**
 * Opens `frames` of time at `frame` on every unlocked track and puts a still of `itemId` there,
 * mutating `timeline`. The caller has checked `freezeRefusal`; this re-checks nothing but the
 * clip's presence, and returns null without changing anything when it is gone.
 */
export function applyFreezeFrame(
  timeline: Timeline,
  spec: { itemId: string; frame: Frames; frames: Frames; still: Asset },
  makeId: (prefix: string) => string
): FreezeResult | null {
  const at = Math.round(spec.frame)
  const span = Math.max(1, Math.round(spec.frames))
  const target = timeline.tracks.flatMap((t) => t.items).find((i) => i.id === spec.itemId)
  if (!target || at < target.from || at >= itemEnd(target)) return null
  const freeze = freezeItem(target, at, spec.still, span, makeId('itm'))

  const result: FreezeResult = { freezeItemId: freeze.id, split: [], removedTransitionIds: [] }
  const tailOf = new Map<string, string>()

  for (const track of timeline.tracks) {
    if (track.locked) continue
    const kept: Item[] = []
    for (const item of track.items) {
      const from = item.from
      const end = itemEnd(item)
      if (end <= at) {
        kept.push(item)
      } else if (from >= at) {
        item.from = from + span
        kept.push(item)
      } else {
        // Straddles the playhead: the head stays, the tail resumes after the hold, reading on
        // from exactly where the head stopped.
        const headFrames = at - from
        const tailFrames = end - at
        const tail: Item = {
          ...item,
          id: makeId('itm'),
          from: at + span,
          durationInFrames: tailFrames,
          sourceStartUs: item.sourceStartUs + Math.round(framesToUs(headFrames, timeline.fps) * item.speed),
          layout: { ...item.layout },
          fadeInFrames: 0,
          keyframes: sliceKeyframes(item.keyframes, headFrames, item.durationInFrames)
        }
        if (!tail.keyframes) delete tail.keyframes
        // A J lead belongs to the clip's first cut and an L trail to its last; the hold between
        // the halves is a hard cut in and out, so each half keeps only its own outer offset.
        delete tail.audioLeadFrames
        delete item.audioTrailFrames
        if (item.keyframes) item.keyframes = sliceKeyframes(item.keyframes, 0, headFrames)
        item.durationInFrames = headFrames
        item.fadeOutFrames = Math.min(item.fadeOutFrames, headFrames)
        tail.fadeOutFrames = Math.min(tail.fadeOutFrames, tailFrames)
        tailOf.set(item.id, tail.id)
        result.split.push({ headId: item.id, tailId: tail.id })
        kept.push(item, tail)
      }
    }
    if (track.items.some((i) => i.id === target.id)) kept.push(freeze)
    kept.sort((a, b) => a.from - b.from)
    track.items = kept
  }

  // A transition out of a split clip leaves from its tail now. Then any transition whose two
  // clips no longer meet on one track is gone: the one on the cut the freeze was inserted into
  // would otherwise name two clips with a still between them, and do nothing.
  if (timeline.transitions && timeline.transitions.length > 0) {
    const where = new Map<string, { item: Item; trackId: string }>()
    for (const track of timeline.tracks) for (const item of track.items) where.set(item.id, { item, trackId: track.id })
    timeline.transitions = timeline.transitions.filter((transition) => {
      const tail = tailOf.get(transition.fromItemId)
      if (tail) transition.fromItemId = tail
      const a = where.get(transition.fromItemId)
      const b = where.get(transition.toItemId)
      const meet = !!a && !!b && a.trackId === b.trackId && itemEnd(a.item) === b.item.from
      if (!meet) result.removedTransitionIds.push(transition.id)
      return meet
    })
  }

  for (const marker of timeline.markers ?? []) {
    if (marker.frame >= at) marker.frame += span
  }
  return result
}
