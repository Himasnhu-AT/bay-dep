/**
 * "Text behind the subject" as an arrangement: the clip, then the title, then the clip again cut
 * out to the person. Pure, over a timeline the caller has already cloned — the store runs it in
 * one `edit()` (one undo step), the tool and the one-click action both reach it through there.
 *
 *     above the title   cut-out copy of the clip   masks: [{ kind: 'subject' }]   (made here)
 *     the title's track the title / graphic                                        (moved up if it was under the clip)
 *     the clip's track  the clip                                                   (unchanged)
 *
 * The copy has the clip's asset, in-point, span, speed, layout, crop, grade, look and keys, so
 * the compositor draws it from **the same media element** (`elementSlots` shares a slot between
 * two drawings of one moment of one file) and it cannot be a frame off the picture under it. It
 * shares the clip's `linkId`, so a move, trim, slip, split or delete of either keeps both; and it
 * plays no sound (`audioDetached`): the clip's sound is already playing.
 *
 * Refusals say what the caller can do instead: which ids, which frames, which track is locked.
 */

import { itemEnd, type Item, type Timeline, type Track } from './project'
import { subjectMaskOf, type SubjectMask } from './matte'

export interface BehindSubjectSpec {
  /** The clip with the person in it. */
  videoItemId: string
  /** The title, text or graphic to put behind the person. */
  overlayItemId: string
  /** Softening of the cut-out's edge, in timeline pixels. */
  feather?: number
}

export interface BehindSubjectOptions {
  makeId(prefix: string): string
  /** A new, empty video track, named by the caller. */
  makeVideoTrack(timeline: Timeline): Track
}

export type BehindSubjectResult =
  | {
      ok: true
      cutoutItemId: string
      cutoutTrackId: string
      overlayTrackId: string
      videoTrackId: string
      /** The overlay was under the clip and was moved to a track above it. */
      movedOverlay: boolean
      createdTrackIds: string[]
      /** The cut-out already existed; nothing changed but its feather. */
      reused: boolean
      warnings: string[]
    }
  | { ok: false; error: string }

function locate(timeline: Timeline, itemId: string): { item: Item; track: Track; index: number } | null {
  for (let index = 0; index < timeline.tracks.length; index += 1) {
    const track = timeline.tracks[index]!
    const item = track.items.find((candidate) => candidate.id === itemId)
    if (item) return { item, track, index }
  }
  return null
}

function overlaps(a: { from: number; durationInFrames: number }, b: { from: number; durationInFrames: number }): boolean {
  return a.from < b.from + b.durationInFrames && b.from < a.from + a.durationInFrames
}

function freeFor(track: Track, span: { from: number; durationInFrames: number }, except?: string): boolean {
  return !track.items.some((other) => other.id !== except && overlaps(other, span))
}

/**
 * The track directly above `index` if it is a free, unlocked video track for `span`; otherwise a
 * new video track inserted there. Never a track further up: anything on a track between the title
 * and the cut-out would be put behind the person too.
 */
function trackAbove(timeline: Timeline, index: number, span: { from: number; durationInFrames: number }, options: BehindSubjectOptions, created: string[]): { track: Track; index: number } {
  const next = timeline.tracks[index + 1]
  if (next && next.kind === 'video' && !next.locked && freeFor(next, span)) return { track: next, index: index + 1 }
  const track = options.makeVideoTrack(timeline)
  timeline.tracks.splice(index + 1, 0, track)
  created.push(track.id)
  return { track, index: index + 1 }
}

export function planBehindSubject(timeline: Timeline, spec: BehindSubjectSpec, options: BehindSubjectOptions): BehindSubjectResult {
  const video = locate(timeline, spec.videoItemId)
  const overlay = locate(timeline, spec.overlayItemId)
  if (!video) return { ok: false, error: `No clip ${spec.videoItemId} on this timeline. read_project lists the clips.` }
  if (!overlay) return { ok: false, error: `No item ${spec.overlayItemId} on this timeline. read_project lists the items.` }
  if (video.item.id === overlay.item.id) {
    return { ok: false, error: 'videoItemId and the title are the same item. Pass the title (textItemId or itemId) and the clip with the person (videoItemId).' }
  }
  if (video.track.kind !== 'video' || overlay.track.kind !== 'video') {
    return { ok: false, error: 'Both the clip and the title must be on video tracks.' }
  }
  if (!overlaps(video.item, overlay.item)) {
    return {
      ok: false,
      error:
        `The title (${overlay.item.id}, frames ${overlay.item.from}–${itemEnd(overlay.item)}) and the clip ` +
        `(${video.item.id}, frames ${video.item.from}–${itemEnd(video.item)}) never play at the same time. ` +
        `Move the title over the clip first (edit_item with from), then ask again.`
    }
  }
  if (video.track.locked) return { ok: false, error: `The clip's track ${video.track.name} is locked. Unlock it, then ask again.` }

  const warnings: string[] = []
  const created: string[] = []
  const mask: SubjectMask = { kind: 'subject', ...(spec.feather && spec.feather > 0 ? { feather: spec.feather } : {}) }

  // Already done: a cut-out of this clip above it. Its feather follows the new call; nothing moves.
  const existing = timeline.tracks
    .flatMap((track, index) => track.items.map((item) => ({ item, track, index })))
    .find(({ item, index }) => item.id !== video.item.id && index > video.index && subjectMaskOf(item) && !subjectMaskOf(item)?.assetId &&
      item.assetId === video.item.assetId && item.from === video.item.from && item.sourceStartUs === video.item.sourceStartUs && item.speed === video.item.speed)
  if (existing && existing.index > overlay.index) {
    if (existing.track.locked) {
      return {
        ok: false,
        error:
          `The cut-out ${existing.item.id} for this clip is already there, on ${existing.track.name}, which is locked, so its edge cannot be changed. ` +
          `Unlock ${existing.track.name} and ask again, or leave it as it is.`
      }
    }
    existing.item.masks = [mask]
    return {
      ok: true,
      cutoutItemId: existing.item.id,
      cutoutTrackId: existing.track.id,
      overlayTrackId: overlay.track.id,
      videoTrackId: video.track.id,
      movedOverlay: false,
      createdTrackIds: [],
      reused: true,
      warnings
    }
  }

  // The title must draw over the clip: under it (or level with it), it moves to the track above.
  let overlayTrack = overlay.track
  let overlayIndex = overlay.index
  let movedOverlay = false
  if (overlay.index < video.index) {
    if (overlay.track.locked) {
      return { ok: false, error: `The title is under the clip, on ${overlay.track.name}, which is locked, so it cannot be moved above the clip. Unlock ${overlay.track.name} or move the title above the clip, then ask again.` }
    }
    overlay.track.items = overlay.track.items.filter((item) => item.id !== overlay.item.id)
    // Indices shift down by one after the removal only when the title's track was below the clip;
    // it is (overlay.index < video.index), and the clip's own track keeps its place in the array.
    const videoIndex = timeline.tracks.indexOf(video.track)
    const above = trackAbove(timeline, videoIndex, overlay.item, options, created)
    overlay.item.trackId = above.track.id
    above.track.items.push(overlay.item)
    above.track.items.sort((a, b) => a.from - b.from)
    overlayTrack = above.track
    overlayIndex = above.index
    movedOverlay = true
  }

  const place = trackAbove(timeline, overlayIndex, video.item, options, created)
  const linkId = video.item.linkId ?? options.makeId('lnk')
  video.item.linkId = linkId
  const cutout: Item = {
    ...structuredClone(video.item),
    id: options.makeId('itm'),
    trackId: place.track.id,
    masks: [mask],
    linkId,
    // Its sound is the clip's; a second copy would double it.
    audioDetached: true
  }
  delete cutout.disabled
  place.track.items.push(cutout)
  place.track.items.sort((a, b) => a.from - b.from)

  if ((timeline.transitions ?? []).some((t) => t.fromItemId === video.item.id || t.toItemId === video.item.id)) {
    warnings.push('The clip has a transition, and the cut-out does not: through the transition the person cuts rather than dissolves. Trim the cut-out (trim_item) to end before the transition if that shows.')
  }
  if (video.item.adjustments || video.item.grade) {
    warnings.push('The cut-out copied the clip\'s grade and adjustments. If you change the clip\'s look later, change the cut-out\'s too, or the person\'s edge will show the difference.')
  }

  return {
    ok: true,
    cutoutItemId: cutout.id,
    cutoutTrackId: place.track.id,
    overlayTrackId: overlayTrack.id,
    videoTrackId: video.track.id,
    movedOverlay,
    createdTrackIds: created,
    reused: false,
    warnings
  }
}
